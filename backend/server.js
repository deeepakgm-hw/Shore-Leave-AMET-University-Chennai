require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const cron = require('node-cron');
const PDFDocument = require('pdfkit');
const { spawn } = require('child_process');
const { OpenAI } = require('openai');
const webPush = require('web-push');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const { validateFaceFrame } = require('./services/opencvEnrollment');
const { createGatePassAssets, formatDate } = require('./services/gatePass');
const { uploadBuffer, uploadDataUrl, verifyConnection, deleteObject } = require('./services/supabaseStorage');
const { createBadgeService, BADGE_DEFINITIONS } = require('./services/badgeService');
const { createXpService, LEVELS } = require('./services/xpService');
const { createStreakService } = require('./services/streakService');
const { createLootService, PRIZE_POOL } = require('./services/lootService');
const NFCTag = require('./models/NFCTag');
const NFCCounter = require('./models/NFCCounter');
const DeviceConfig = require('./models/DeviceConfig');
const GateHistory = require('./models/GateHistory');
const nfcService = require('./services/nfcService');
const { createGateDecisionService } = require('./services/gateDecisionService');
const { createNfcRouter } = require('./routes/nfc');
const { createFingerprintRuntime } = require('./modules/fingerprint/routes');
const { isEncryptionConfigured } = require('./modules/fingerprint/utils');
const FingerprintTemplate = require('./modules/fingerprint/model');

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: true, credentials: true }
});
global.io = io;
let activeDeviceConfig = null;
let supabaseHealthCache = { checkedAt: 0, online: false };
let fingerprintAdapterProcess = null;
const LOG_DIR = process.env.LOG_DIR || __dirname;
const OUT_LOG = path.join(LOG_DIR, 'server.out.log');
const ERR_LOG = path.join(LOG_DIR, 'server.err.log');
fs.mkdirSync(LOG_DIR, { recursive: true });

const SENSITIVE_LOG_KEY = /(authorization|cookie|credential|password|passphrase|private.?key|secret|token|api.?key|connection.?string|mongo(?:db)?_?uri|email|phone|contact|name|roll|student.?id|device.?fingerprint|ip(?:address)?|location|address|lat(?:itude)?|lng|longitude|recipient|\bto\b|\bfrom\b)/i;
const SENSITIVE_ENV_NAMES = [
  'MONGODB_URI', 'MONGO_URI', 'JWT_SECRET', 'QR_SECRET', 'OTP_ENCRYPTION_KEY',
  'SMTP_PASS', 'VAPID_PRIVATE_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY',
  'FINGERPRINT_ENCRYPTION_KEY', 'FINGERPRINT_BRIDGE_TOKEN', 'OPENAI_API_KEY',
  'DEFAULT_ADMIN_PASSWORD', 'DEFAULT_DUTY_PASSWORD'
];

function redactString(value) {
  let output = String(value || '');
  for (const name of SENSITIVE_ENV_NAMES) {
    const secret = String(process.env[name] || '');
    if (secret.length >= 6) output = output.split(secret).join(`[REDACTED:${name}]`);
  }
  return output
    .replace(/(mongodb(?:\+srv)?:\/\/)([^@\s/]+)@/gi, '$1[REDACTED]@')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED:JWT]')
    .replace(/((?:password|passphrase|secret|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)[^\s,;}]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED:EMAIL]')
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, '[REDACTED:PHONE]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED:IP]')
    .replace(/\bAMET[A-Z/0-9_-]{4,}\b/gi, '[REDACTED:ROLL]');
}

function redactLogValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactString(value);
  if (depth > 5) return '[TRUNCATED]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: redactString(value.stack)
    };
  }
  if (typeof value !== 'object') return redactString(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => redactLogValue(item, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_LOG_KEY.test(key) ? '[REDACTED]' : redactLogValue(item, depth + 1, seen)
  ]));
}

function logLine(file, level, message, meta) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message: redactString(message),
    ...(meta ? { meta: redactLogValue(meta) } : {})
  });
  fs.appendFile(file, `${line}\n`, () => {});
}

function logInfo(message, meta) {
  logLine(OUT_LOG, 'info', message, meta);
  console.info(redactString(message), meta ? redactLogValue(meta) : '');
}

function logWarn(message, meta) {
  logLine(ERR_LOG, 'warn', message, meta);
  console.warn(redactString(message), meta ? redactLogValue(meta) : '');
}

function logError(message, error) {
  const safeError = redactLogValue(error || '');
  logLine(ERR_LOG, 'error', message, safeError);
  console.error(redactString(message), safeError);
}

process.on('unhandledRejection', (err) => {
  logError('[PROCESS] Unhandled promise rejection', err);
});

process.on('uncaughtException', (err) => {
  logError('[PROCESS] Uncaught exception', err);
  process.exitCode = 1;
});

function getMongoUri() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI (or legacy MONGO_URI) is required. Configure MongoDB Atlas before starting the backend.');
  }
  return mongoUri;
}

function describeMongoTarget(mongoUri) {
  try {
    const parsed = new URL(mongoUri);
    return `${parsed.hostname}${parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : ''}`;
  } catch (_) {
    return 'configured MongoDB host';
  }
}

function validateProductionEnv() {
  if (process.env.NODE_ENV !== 'production') return;
  const required = [
    'JWT_SECRET',
    'OTP_ENCRYPTION_KEY',
    'FACE_SERVICE_URL',
    'CORS_ORIGINS',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'FINGERPRINT_ENCRYPTION_KEY'
  ];
  const missing = required.filter(name => !process.env[name]);
  if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
    missing.unshift('MONGODB_URI');
  }
  if (missing.length) {
    missing.forEach(name => logError(`Missing required env variable: ${name}. Add it to your .env file and restart.`));
    process.exit(1);
  }
}

function requireRuntimeSecret(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required. Configure it in the backend environment before starting.`);
  return value;
}

validateProductionEnv();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self)');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.supabase.co",
    "connect-src 'self' https://nominatim.openstreetmap.org",
    "worker-src 'self' blob:"
  ].join('; '));
  next();
});

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  const allowed = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (allowed.includes(origin)) return true;

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    const isLocalNetwork =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '192.168.1.8' ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);
    const isMobileTunnel = hostname.endsWith('.loca.lt');
    return isLocalNetwork || isMobileTunnel;
  } catch (error) {
    return false;
  }
}

app.use(cors({
  origin(origin, callback) {
    if (isAllowedCorsOrigin(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '25mb' })); // 3 face photos (JPEG 0.87) â‰ˆ 6â€“8MB each, total â‰ˆ 20MB max

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getRequestUserIdentity(req) {
  if (req.user?.roll) return `cadet:${req.user.roll}`;
  if (req.user?.username) return `officer:${req.user.username}`;
  if (req.user?.email) return `user:${req.user.email}`;
  if (req.officer?.username) return `officer:${req.officer.username}`;
  const token = getBearerToken(req);
  if (token) {
    try {
      const payload = jwt.decode(token) || {};
      if (payload.roll) return `cadet:${payload.roll}`;
      if (payload.username) return `officer:${payload.username}`;
      if (payload.email) return `user:${payload.email}`;
      if (payload.id) return `user:${payload.id}`;
    } catch (_) {
      // Fall back to IP below. Authentication middleware still verifies tokens.
    }
  }
  return null;
}

const RATE_LIMIT_DEBUG = process.env.RATE_LIMIT_DEBUG !== 'false';
const rateLimitDiagnostics = new Map();

function logRateLimitDiagnostic(req, label, entry, limit, extra = {}) {
  if (!RATE_LIMIT_DEBUG) return;
  const now = Date.now();
  const ip = getClientIp(req);
  const identity = getRequestUserIdentity(req) || 'anonymous';
  const routeKey = `${label}:${identity}:${req.method}:${req.originalUrl || req.url}`;
  const previous = rateLimitDiagnostics.get(routeKey);
  const duplicateWithinMs = previous ? now - previous.lastAt : null;
  const snapshot = {
    label,
    method: req.method,
    endpoint: req.originalUrl || req.url,
    userId: identity,
    ip,
    count: entry?.count || 0,
    limit,
    duplicateWithinMs,
    ...extra
  };
  rateLimitDiagnostics.set(routeKey, {
    lastAt: now,
    count: (previous?.count || 0) + 1
  });
  if (extra.rateLimited || duplicateWithinMs !== null && duplicateWithinMs < 750 || (entry?.count || 0) >= Math.ceil(limit * 0.8)) {
    logWarn('[RATE_LIMIT_DIAGNOSTIC]', snapshot);
  }
}

function createRateLimiter({ windowMs, max, keyPrefix, keyGenerator }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = getClientIp(req);
    const identityKey = typeof keyGenerator === 'function' ? keyGenerator(req) : null;
    const keyId = identityKey || ip;
    const identityAwareKey = `${keyPrefix}:${keyId}`;
    const entry = hits.get(identityAwareKey) || { count: 0, resetAt: now + windowMs };

    if (entry.resetAt <= now) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    hits.set(identityAwareKey, entry);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));

    if (entry.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('X-RateLimit-Reset', String(entry.resetAt));
      logRateLimitDiagnostic(req, keyPrefix, entry, max, { rateLimited: true, retryAfterSeconds });
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again shortly.',
        retryAfterSeconds,
        resetAt: new Date(entry.resetAt).toISOString()
      });
    }

    logRateLimitDiagnostic(req, keyPrefix, entry, max);
    next();
  };
}

const authenticatedDashboardRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTHENTICATED_DASHBOARD_RATE_LIMIT_MAX || 1200),
  keyPrefix: 'dashboard-api',
  keyGenerator: req => getRequestUserIdentity(req)
});
const notificationPollingRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.NOTIFICATION_RATE_LIMIT_MAX || 1800),
  keyPrefix: 'notifications-api',
  keyGenerator: req => getRequestUserIdentity(req)
});

app.use(
  [
    '/api/admin/cadets',
    '/api/admin/leave-requests',
    '/api/admin/leave-token-control',
    '/api/dashboard',
    '/api/audit-logs',
    '/api/auth/me'
  ],
  authenticatedDashboardRateLimit
);
app.use('/api/notifications', notificationPollingRateLimit);

// â”€â”€â”€ ASYNC HANDLER WRAPPER â”€â”€â”€
// Wraps async route handlers so unhandled promise rejections are caught
// and returned as 500 responses instead of crashing the server.
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);


const LEGACY_UPLOADS_DIR = path.join(__dirname, 'uploads');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
// Read-only compatibility for existing MongoDB records. New files are never written here.
app.use('/uploads', express.static(LEGACY_UPLOADS_DIR));
app.use((req, res, next) => {
  const hostname = String(req.hostname || '').toLowerCase();
  const isLocalDevelopment = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  const isFrontendAsset = /\.(?:html|css|js|json|webmanifest)$/i.test(req.path) || req.path === '/';
  if (isLocalDevelopment && isFrontendAsset) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  next();
});
app.use(express.static(FRONTEND_DIR));
app.get('/cadet-dashboard', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'cadet-dashboard.html'));
});

const JWT_SECRET = requireRuntimeSecret('JWT_SECRET');
const FACE_SERVICE_PORT = process.env.FACE_SERVICE_PORT || '5001';
const FACE_SERVICE_BASE_URL = process.env.FACE_SERVICE_URL || `http://127.0.0.1:${FACE_SERVICE_PORT}`;
const FACE_SERVICE_PUBLIC_PATH = '/face-service';
let faceServiceProcess = null;
let faceServiceOnline = false;
const OTP_SECRET = crypto.createHash('sha256').update(requireRuntimeSecret('OTP_ENCRYPTION_KEY')).digest();
const OTP_EXPIRY_MS = 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_OTP_ATTEMPTS = 3;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginRateLimit = createRateLimiter({ windowMs: LOGIN_LOCK_MS, max: MAX_LOGIN_ATTEMPTS, keyPrefix: 'login' });
const otpRateLimit = createRateLimiter({ windowMs: LOGIN_LOCK_MS, max: 8, keyPrefix: 'otp' });
// Keep the sliding session window aligned with the longest issued JWT by default.
// A 30 minute cutoff made otherwise-valid sessions impossible to refresh after an
// idle browser tab, which looked like a random logout to users.
const SESSION_ACTIVITY_WINDOW_MS = Number(process.env.SESSION_ACTIVITY_WINDOW_MS || 24 * 60 * 60 * 1000);
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@shoreleave.local',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

// â”€â”€â”€ MONGOOSE MODELS â”€â”€â”€
const CadetSchema = new mongoose.Schema({
  roll: { type: String, required: true, unique: true },
  name: String,
  email: { type: String, set: normalizeEmail },
  batch: String,
  branch: String,
  year: Number,
  studentId: String,
  serialNo: String,
  course: String,
  rank: String,
  idNo: String,
  vessel: String,
  company: String,
  agent: String,
  port: String,
  authorizedOfficer: String,
  officerTitle: String,
  gender: String,
  offeredDate: Date,
  contactNo: String,
  faceDescriptor: [Number],
  faceDescriptors: [[Number]],
  photoUrl: String,
  faceImages: {
    front: String,
    left: String,
    right: String
  },
  faceEnrollmentData: {
    enrolled: { type: Boolean, default: false },
    enrolledAt: Date,
    enrolledBy: String,
    enrollmentVersion: { type: Number, default: 0 },
    deviceInfo: String
  },
  fingerprintEnrolled: { type: Boolean, default: false, index: true },
  fingerprintTemplateId: { type: String, default: null },
  fingerprintLastUpdated: Date,
  fingerprint: {
    enrolled: { type: Boolean, default: false },
    templateId: { type: String, default: null },
    templateReference: { type: String, default: null },
    templateVersion: String,
    deviceModel: String,
    deviceSerial: String,
    enrolledBy: String,
    enrolledAt: Date,
    lastVerifiedAt: Date,
    verificationCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['ACTIVE', 'NOT_ENROLLED'],
      default: 'NOT_ENROLLED'
    }
  },
  nfc: {
    uid: { type: String, default: null },
    code: { type: String, default: null },
    assigned: { type: Boolean, default: false },
    status: { type: String, enum: ['ACTIVE', 'UNASSIGNED'], default: 'UNASSIGNED' },
    assignedAt: Date,
    assignedBy: String,
    lastSeen: Date,
    lastUsed: Date,
    lastUpdated: Date,
    useCount: { type: Number, default: 0 },
    history: [{
      uid: String,
      assignedAt: Date,
      assignedBy: String,
      removedAt: Date,
      status: { type: String, enum: ['ACTIVE', 'REPLACED', 'LOST', 'DISABLED'] }
    }],
    replacementHistory: [{
      uid: String,
      assignedAt: Date,
      assignedBy: String,
      replacedAt: Date,
      status: { type: String, enum: ['REPLACED', 'LOST', 'DISABLED'] }
    }]
  },
  enrollmentStatus: { type: String, enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLOCKED', 'GRADUATED', 'PENDING_FACE'], default: 'ACTIVE', index: true },
  attendanceStatus: { type: String, enum: ['INSIDE', 'OUTSIDE'], default: 'INSIDE', index: true },
  leaveStatus: { type: String, enum: ['NONE', 'APPROVED', 'ON_LEAVE', 'LEAVE_EXPIRED', 'COMPLETED', 'LATE_RETURN'], default: 'NONE', index: true },
  gateStatus: { type: String, enum: ['INSIDE', 'OUTSIDE'], default: 'INSIDE', index: true },
  status: { type: String, default: 'returned' }, // 'out' or 'returned'
  activeSessionId: String,
  deviceFingerprint: String,
  isBlocked: { type: Boolean, default: false },
  leaveBlocked: { type: Boolean, default: false, index: true },
  leaveBlockedReason: { type: String, default: '' },
  leaveBlockedBy: { type: String, default: '' },
  leaveBlockedDate: Date,
  leaveBlockedUntil: Date,
  leaveUnblockedBy: { type: String, default: '' },
  leaveUnblockedDate: Date,
  pendingLeave: { type: Object, default: null },
  loginAttempts: { type: Number, default: 0 },
  lockedUntil: Date,
  lastLoginAt: Date,
  verificationHistory: { type: [Object], default: [] },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  currentStreak: { type: Number, default: 0 },
  longestStreak: { type: Number, default: 0 },
  lastReturnDate: Date,
  leaveTokens: { type: Number, default: 4 },
  totalCratesOpened: { type: Number, default: 0 },
  cratesAvailable: { type: Number, default: 0 },
  badges: [{
    id: String,
    name: String,
    earnedAt: Date,
    icon: String
  }],
  complianceScore: { type: Number, default: 100 },
  prizes: [{
    tier: String,
    prize: String,
    earnedAt: Date,
    collected: { type: Boolean, default: false },
    collectedAt: Date,
    physical: Boolean
  }],
  monthlyTokenReset: Date,
  profileTheme: { type: String, default: 'default' }
});
const Cadet = mongoose.model('Cadet', CadetSchema);

const CadetXpLogSchema = new mongoose.Schema({
  cadetId: { type: String, index: true },
  roll: { type: String, index: true },
  action: { type: String, index: true },
  xp: Number,
  timestamp: { type: Date, default: Date.now, index: true },
  note: String
}, { collection: 'cadet_xp_log' });
const CadetXpLog = mongoose.model('CadetXpLog', CadetXpLogSchema);

const OfficerSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  adminNumber: { type: String, trim: true, uppercase: true },
  email: { type: String, trim: true, lowercase: true },
  branch: { type: String, trim: true, uppercase: true },
  passwordHash: String,
  role: { type: String, enum: ['admin', 'duty_officer'], default: 'duty_officer' },
  isActive: { type: Boolean, default: true },
  createdBy: String,
  verifiedAt: Date,
  activeSessionId: String,
  lastLoginAt: Date
});
const Officer = mongoose.model('Officer', OfficerSchema);

const OfficerProvisioningSchema = new mongoose.Schema({
  sessionToken: { type: String, required: true, index: true },
  adminNumber: { type: String, required: true, index: true },
  email: { type: String, required: true, index: true },
  branch: { type: String, required: true },
  passwordHash: { type: String, required: true },
  otpHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  requestedBy: { type: String, required: true }
}, { timestamps: true, collection: 'officer_provisioning_otps' });
const OfficerProvisioning = mongoose.model('OfficerProvisioning', OfficerProvisioningSchema);

const OTPSchema = new mongoose.Schema({
  roll: String,
  email: String,
  encryptedOTP: String,
  otpHash: String,
  expiresAt: Date,
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 3 },
  sessionToken: { type: String, index: true },
  lastSentAt: Date,
  verified: { type: Boolean, default: false }
});
const OTP = mongoose.model('OTP', OTPSchema);

const LeaveRecordSchema = new mongoose.Schema({
  roll: String,
  name: String,
  email: String,
  batch: String,
  course: String,
  studentId: String,
  dest: String,
  checkOutTime: String,
  checkInTime: String,
  checkOutDate: Date,
  checkInDate: Date,
  fromDate: Date,
  toDate: Date,
  fromTime: String,
  toTime: String,
  returnDate: Date,
  status: String,
  checkOutPhotoUrl: String,
  checkInPhotoUrl: String,
  faceMatchScore: Number,
  locationAddress: String,
  checkOutLat: String,
  checkInLat: String,
  checkOutLng: String,
  checkInLng: String,
  leaveType: { type: String, default: 'Shore Leave' },
  leaveReason: String,
  leaveDocumentUrl: String,
  approvalStatus: String,
  approvedBy: String,
  approvedAt: Date,
  rejectionReason: String,
  passId: String,
  passVerificationToken: String,
  emergencyVerificationCode: { type: String, index: true },
  emergencyCodeGeneratedAt: Date,
  emergencyCodeExpiresAt: Date,
  emergencyGateOutUsed: { type: Boolean, default: false },
  emergencyGateInUsed: { type: Boolean, default: false },
  emergencyGateOutUsedAt: Date,
  emergencyGateInUsedAt: Date,
  emergencyGateOutOfficer: String,
  emergencyGateInOfficer: String,
  emergencyGateOutReason: String,
  emergencyGateInReason: String,
  expired: { type: Boolean, default: false },
  reminderPushSentAt: Date,
  overduePushSentAt: Date,
  gatePassMessage: String,
  passIssuedAt: Date,
  gatePassPdfUrl: String,
  gatePass: Object,
  storageStatus: String,
  storageUploadedAt: Date
});
const LeaveRecord = mongoose.model('LeaveRecord', LeaveRecordSchema);

const ChatbotLogSchema = new mongoose.Schema({
  sessionId: String,
  userMessage: String,
  botResponse: String,
  timestamp: { type: Date, default: Date.now }
});
const ChatbotLog = mongoose.model('ChatbotLog', ChatbotLogSchema);

const PushSubscriptionSchema = new mongoose.Schema({
  roll: { type: String, index: true },
  endpoint: { type: String, unique: true },
  subscription: Object,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true }
});
const PushSubscription = mongoose.model('PushSubscription', PushSubscriptionSchema);

const NotificationSchema = new mongoose.Schema({
  notificationId: { type: String, default: () => crypto.randomUUID(), unique: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, default: 'system', index: true },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  createdAt: { type: Date, default: Date.now, index: true },
  read: { type: Boolean, default: false, index: true },
  readAt: Date,
  archived: { type: Boolean, default: false, index: true },
  archivedAt: Date,
  deletedAt: Date,
  userRole: { type: String, default: 'cadet', index: true },
  recipientRoll: { type: String, index: true },
  recipientUsername: { type: String, index: true },
  actor: String,
  entity: Object,
  url: String,
  dedupeKey: { type: String, unique: true, sparse: true }
}, { collection: 'notifications' });
const Notification = mongoose.model('Notification', NotificationSchema);

const AuditLogSchema = new mongoose.Schema({
  action: String,
  roll: String,
  details: Object,
  timestamp: { type: Date, default: Date.now }
});
AuditLogSchema.post('save', async function persistAdminNotification(document) {
  try {
    await createPersistentNotification({
      userRole: 'admin',
      payload: {
        title: String(document.action || 'System event').replace(/_/g, ' '),
        body: document.roll ? `Cadet ${document.roll}` : 'A privileged system event was recorded.',
        type: 'audit',
        priority: /FAILED|DENIED|OVERDUE|LATE/.test(String(document.action || '')) ? 'high' : 'normal',
        entity: { auditLogId: String(document._id), roll: document.roll, action: document.action }
      },
      actor: document.details?.username || document.details?.reviewedBy || document.details?.updatedBy || 'system',
      dedupeKey: `audit:${document._id}`
    });
  } catch (error) {
    logError('[NOTIFICATIONS] Could not persist audit notification', error);
  }
});
const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

const FailedEmailSchema = new mongoose.Schema({
  to: String,
  subject: String,
  text: String,
  html: String,
  attachments: { type: [Object], default: [] },
  error: String,
  timestamp: { type: Date, default: Date.now },
  retried: { type: Number, default: 0 },
  lastRetryAt: Date,
  deliveredAt: Date
});
const FailedEmail = mongoose.model('FailedEmail', FailedEmailSchema);

const DailyReportSchema = new mongoose.Schema({
  reportDate: { type: Date, index: true },
  generatedAt: { type: Date, default: Date.now },
  generatedBy: String,
  format: { type: String, default: 'pdf' },
  bucket: String,
  storagePath: String,
  publicUrl: String,
  signedUrl: String,
  status: { type: String, default: 'generated' },
  summary: Object,
  metadata: Object
});
const DailyReport = mongoose.model('DailyReport', DailyReportSchema, 'daily_reports');

const ReportSettingsSchema = new mongoose.Schema({
  singleton: { type: String, default: 'default', unique: true },
  enabled: { type: Boolean, default: true },
  runTime: { type: String, default: '21:00' },
  recipients: { type: [String], default: [] },
  formats: { type: [String], default: ['pdf'] },
  updatedBy: String,
  updatedAt: { type: Date, default: Date.now }
});
const ReportSettings = mongoose.model('ReportSettings', ReportSettingsSchema, 'report_settings');

const GateOTPSchema = new mongoose.Schema({
  roll: { type: String, index: true },
  email: String,
  purpose: { type: String, enum: ['CHECK_IN', 'CHECK_OUT', 'VERIFY'], default: 'VERIFY' },
  otpHash: String,
  sessionToken: { type: String, index: true },
  expiresAt: Date,
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 3 },
  verified: { type: Boolean, default: false },
  verifiedAt: Date,
  issuedBy: String,
  issuedAt: { type: Date, default: Date.now },
  lastSentAt: Date,
  validation: Object
});
const GateOTP = mongoose.model('GateOTP', GateOTPSchema, 'gate_otps');

// â”€â”€â”€ EMAIL SETUP â”€â”€â”€
let transporter;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpConfig = process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: smtpPort,
        secure: process.env.SMTP_SECURE === 'true' || smtpPort === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      }
    : {
        service: process.env.SMTP_SERVICE || 'gmail',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      };

  transporter = nodemailer.createTransport(smtpConfig);
  logInfo('[EMAIL] Real SMTP transport is configured.');
} else {
  logWarn('[EMAIL] Real SMTP is not configured. Local OTP fallback is enabled for development only.');
}

function nowTime() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function nowTime24() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function parseDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(dateValue) {
  const date = new Date(dateValue);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(dateValue) {
  const date = new Date(dateValue);
  date.setHours(23, 59, 59, 999);
  return date;
}

function isLeaveTypeValid(leaveType) {
  return ['Medical', 'Special Leave', 'Others'].includes(leaveType);
}

function buildGatePassUrl(req, passId, token) {
  return `${req.protocol}://${req.get('host')}/gate_pass.html?id=${encodeURIComponent(passId)}&token=${encodeURIComponent(token)}`;
}

function syntheticGatePassRequest(req) {
  if (req && typeof req.get === 'function') return req;
  const baseUrl = String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const parsed = new URL(baseUrl);
  return {
    protocol: parsed.protocol.replace(':', ''),
    get: (name) => String(name || '').toLowerCase() === 'host' ? parsed.host : undefined
  };
}

function buildCadetDashboardUrl(req) {
  return `${req.protocol}://${req.get('host')}/cadet-dashboard.html`;
}

function isSessionWithinActivityWindow(lastActiveAt) {
  if (!lastActiveAt) return false;
  return Date.now() - new Date(lastActiveAt).getTime() <= SESSION_ACTIVITY_WINDOW_MS;
}

function signOfficerToken(officer, sessionId) {
  return jwt.sign(
    { username: officer.username, role: officer.role || 'duty_officer', sessionId },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function signCadetToken(cadet, sessionId) {
  return jwt.sign({ roll: cadet.roll, sessionId, role: 'cadet' }, JWT_SECRET, { expiresIn: '24h' });
}

function signCadetPendingFaceToken(roll, sessionId) {
  return jwt.sign({ roll, sessionId, role: 'cadet_pending_face' }, JWT_SECRET, { expiresIn: '10m' });
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeIdentifier(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function extractImageBase64(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.startsWith('data:image')) {
      return candidate;
    }
  }
  return null;
}

function formatConfidenceScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 1) return Number((numeric * 100).toFixed(1));
  return Number(numeric.toFixed(1));
}

function matchesCadetFromFaceService(cadet, result) {
  if (!cadet || !result) return false;
  const expectedIds = new Set(
    [cadet.studentId, cadet.serialNo, cadet.roll]
      .filter(Boolean)
      .map(normalizeIdentifier)
  );

  const resultId = normalizeIdentifier(result.cadetId);
  if (resultId && expectedIds.has(resultId)) {
    return true;
  }

  return normalizeName(result.cadetName) === normalizeName(cadet.name);
}

function imagePayloadDiagnostics(imageBase64) {
  const value = typeof imageBase64 === 'string' ? imageBase64 : '';
  const base64Part = value.includes(',') ? value.split(',', 2)[1] : value;
  const mimeMatch = value.match(/^data:([^;]+);base64,/i);
  return {
    present: !!value,
    hasDataUrlPrefix: value.startsWith('data:'),
    mimeType: mimeMatch ? mimeMatch[1] : null,
    characters: value.length,
    base64Characters: base64Part.length,
    estimatedBytes: Math.floor((base64Part.length * 3) / 4)
  };
}

function faceVerificationStatus(verification, cadet, matchedCadet) {
  if (!verification) {
    return {
      code: 'FACE_SERVICE_NO_RESPONSE',
      reason: 'face_service_no_response',
      message: 'Face verification service did not return a result.'
    };
  }

  if (verification.code) {
    if (verification.matched && !matchedCadet) {
      return {
        code: 'CADET_MISMATCH',
        reason: 'cadet_mismatch',
        message: 'The detected face belongs to a different enrolled cadet.'
      };
    }
    return {
      code: verification.code,
      reason: verification.reason || String(verification.code).toLowerCase(),
      message: verification.message || verification.error || 'Face verification failed.'
    };
  }

  if (!verification.faceDetected && verification.matched === false) {
    return {
      code: 'NO_FACE_DETECTED',
      reason: 'no_face_detected',
      message: verification.error || 'No face detected. Please look directly at the camera.'
    };
  }

  if (verification.matched && !matchedCadet) {
    return {
      code: 'CADET_MISMATCH',
      reason: 'cadet_mismatch',
      message: 'The detected face belongs to a different enrolled cadet.'
    };
  }

  return {
    code: 'FACE_NOT_RECOGNIZED',
    reason: 'face_not_recognized',
    message: verification.error || 'Face not recognized. Please retry with a clear front-facing frame.'
  };
}

function buildFaceVerificationDiagnostics({ verification, cadet, matchedCadet, imageBase64, durationMs }) {
  const confidence = formatConfidenceScore(verification?.confidence);
  const similarity = Number.isFinite(Number(verification?.similarity))
    ? Number(Number(verification.similarity).toFixed(6))
    : (confidence !== null ? Number((confidence / 100).toFixed(6)) : null);
  const threshold = Number.isFinite(Number(verification?.threshold))
    ? Number(verification.threshold)
    : null;
  const status = faceVerificationStatus(verification, cadet, matchedCadet);
  return {
    ...status,
    matched: !!verification?.matched,
    matchedCadet: !!matchedCadet,
    faceDetected: verification?.faceDetected === true || Number(verification?.faceCount) > 0,
    faceCount: Number.isFinite(Number(verification?.faceCount)) ? Number(verification.faceCount) : null,
    embeddingGenerated: verification?.embeddingGenerated === true,
    detectionScore: Number.isFinite(Number(verification?.detectionScore)) ? Number(verification.detectionScore) : null,
    similarity,
    confidence,
    threshold,
    durationMs,
    image: verification?.image || verification?.diagnostics?.image || imagePayloadDiagnostics(imageBase64)
  };
}

function buildFaceVerificationFailureResponse(diagnostics, statusCode = 401) {
  return {
    success: false,
    verified: false,
    error: diagnostics.message,
    message: diagnostics.message,
    code: diagnostics.code,
    reason: diagnostics.reason,
    retryable: !['NO_ENROLLED_FACE', 'NO_ENROLLED_FACE_FOR_CADET', 'NO_ENROLLED_FACES'].includes(diagnostics.code),
    diagnostics: {
      faceDetected: diagnostics.faceDetected,
      faceCount: diagnostics.faceCount,
      embeddingGenerated: diagnostics.embeddingGenerated,
      detectionScore: diagnostics.detectionScore,
      similarity: diagnostics.similarity,
      confidence: diagnostics.confidence,
      threshold: diagnostics.threshold,
      matched: diagnostics.matched,
      matchedCadet: diagnostics.matchedCadet
    },
    statusCode
  };
}

async function callFaceService(pathname, payload) {
  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.FACE_SERVICE_TIMEOUT_MS || 30000));
  try {
    response = await fetch(`${FACE_SERVICE_BASE_URL}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    const serviceError = new Error('Face service unavailable. Use OTP check-in as backup.');
    serviceError.statusCode = 503;
    throw serviceError;
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const serviceError = new Error(data.error || data.message || `Face service request failed with ${response.status}`);
    serviceError.statusCode = response.status >= 500 ? 502 : response.status;
    serviceError.serviceResponse = data;
    throw serviceError;
  }

  return data;
}

async function enrollFaceWithService(cadet, imageBase64) {
  return callFaceService('/enroll', {
    cadetId: cadet.studentId || cadet.roll,
    cadetName: cadet.name || cadet.roll,
    imageBase64
  });
}

async function verifyFaceWithService(imageBase64) {
  return callFaceService('/verify', { imageBase64 });
}

function faceEmbeddingsCollection() {
  // The InsightFace service stores embeddings in its dedicated Atlas database.
  // Use the same database here so enrollment status and verification read the
  // records written by the Python service, even when the main app DB is `test`.
  const databaseName = process.env.FACE_DATABASE_NAME || 'shoreleave';
  return mongoose.connection.client.db(databaseName).collection('face_embeddings');
}

function faceEnrollmentIdsForCadet(cadet) {
  return [cadet?.studentId, cadet?.serialNo, cadet?.roll]
    .filter(Boolean)
    .map(value => String(value).trim())
    .filter(Boolean);
}

function faceEnrollmentIdVariantsForCadet(cadet) {
  const ids = faceEnrollmentIdsForCadet(cadet);
  if (cadet?._id) ids.push(String(cadet._id));
  return [...new Set(ids.flatMap(id => [id, normalizeIdentifier(id)]).filter(Boolean))];
}

function canonicalFaceCadetId(cadet) {
  return String(cadet?.studentId || cadet?.serialNo || cadet?.roll || '').trim();
}

async function findFaceEmbeddingForCadet(cadetOrId) {
  if (!mongoose.connection.db) return null;
  const ids = typeof cadetOrId === 'string'
    ? [cadetOrId]
    : faceEnrollmentIdsForCadet(cadetOrId);
  if (!ids.length) return null;
  return faceEmbeddingsCollection().findOne(
    { cadetId: { $in: ids } },
    { projection: { embedding: 0 }, sort: { enrolledAt: -1 } }
  );
}

async function removeDuplicateFaceEmbeddingsForCadet(cadet, keepDocumentId) {
  if (!mongoose.connection.db) return { deletedCount: 0 };
  const ids = faceEnrollmentIdsForCadet(cadet);
  if (!ids.length || !keepDocumentId) return { deletedCount: 0 };

  const keepId = typeof keepDocumentId === 'string' && mongoose.Types.ObjectId.isValid(keepDocumentId)
    ? new mongoose.Types.ObjectId(keepDocumentId)
    : keepDocumentId;

  return faceEmbeddingsCollection().deleteMany({
    cadetId: { $in: ids },
    _id: { $ne: keepId }
  });
}

async function deleteFaceEmbeddingsForCadet(cadet) {
  if (!mongoose.connection.db) return { deletedCount: 0, cadetIds: [] };
  const ids = faceEnrollmentIdVariantsForCadet(cadet);
  if (!ids.length) return { deletedCount: 0, cadetIds: [] };
  const result = await faceEmbeddingsCollection().deleteMany({ cadetId: { $in: ids } });
  return { deletedCount: result.deletedCount || 0, cadetIds: ids };
}

async function ensureFaceEmbeddingIndex() {
  try {
    await faceEmbeddingsCollection().createIndex(
      { cadetId: 1 },
      { unique: true, partialFilterExpression: { cadetId: { $type: 'string' } } }
    );
    logInfo('[DB] Unique index ready: face_embeddings.cadetId');
  } catch (error) {
    logError('[DB] Could not create unique face_embeddings.cadetId index. Run backend/scripts/fix_face_duplicates.js, then restart.', error);
  }
}

function defaultIndexName(keys) {
  return Object.entries(keys).map(([key, value]) => `${key}_${value}`).join('_');
}

function sameIndexKey(existingKey, requestedKey) {
  return JSON.stringify(existingKey || {}) === JSON.stringify(requestedKey || {});
}

function comparableIndexOptions(index) {
  const options = {};
  for (const key of ['expireAfterSeconds', 'unique', 'sparse', 'partialFilterExpression']) {
    if (Object.prototype.hasOwnProperty.call(index || {}, key)) options[key] = index[key];
  }
  return options;
}

async function ensureMigratedIndex(collection, keys, options = {}) {
  const indexName = options.name || defaultIndexName(keys);
  const requestedOptions = { ...options, name: indexName };
  const existingIndexes = await collection.indexes();
  const existingByName = existingIndexes.find(index => index.name === indexName);
  const existingByKey = existingIndexes.find(index => sameIndexKey(index.key, keys));
  const existing = existingByName || existingByKey;

  if (!existing) {
    await collection.createIndex(keys, requestedOptions);
    logInfo(`[DB] Created index ${collection.collectionName}.${indexName}`);
    return { action: 'created', indexName };
  }

  if (!sameIndexKey(existing.key, keys)) {
    throw new Error(`Index ${collection.collectionName}.${indexName} exists with different keys. Existing=${JSON.stringify(existing.key)} requested=${JSON.stringify(keys)}`);
  }

  const existingOptions = comparableIndexOptions(existing);
  const requiredOptions = comparableIndexOptions(requestedOptions);
  if (JSON.stringify(existingOptions) === JSON.stringify(requiredOptions)) {
    return { action: 'unchanged', indexName };
  }

  const isTtlMigration = Object.prototype.hasOwnProperty.call(requiredOptions, 'expireAfterSeconds');
  if (!isTtlMigration || existing.name === '_id_') {
    throw new Error(`Index ${collection.collectionName}.${existing.name} option mismatch. Existing=${JSON.stringify(existingOptions)} requested=${JSON.stringify(requiredOptions)}`);
  }

  logWarn(`[DB] Migrating index ${collection.collectionName}.${existing.name}: ${JSON.stringify(existingOptions)} -> ${JSON.stringify(requiredOptions)}`);
  await collection.dropIndex(existing.name);
  await collection.createIndex(keys, requestedOptions);
  logInfo(`[DB] Recreated index ${collection.collectionName}.${indexName}`);
  return { action: 'migrated', indexName };
}

async function ensureCoreIndexes() {
  const db = mongoose.connection.db;
  if (!db) return;

  await Cadet.collection.createIndex({ roll: 1 }, { unique: true });
  await Cadet.collection.createIndex({ rollNumber: 1 }, { unique: true, sparse: true });
  await Cadet.collection.createIndex({ email: 1 });
  await Cadet.collection.createIndex({ xp: -1, complianceScore: -1 });
  await Cadet.collection.createIndex({ leaveTokens: 1 });
  await Cadet.collection.createIndex(
    { 'nfc.uid': 1 },
    { unique: true, partialFilterExpression: { 'nfc.uid': { $type: 'string' } } }
  );
  await CadetXpLog.collection.createIndex({ cadetId: 1, action: 1, timestamp: -1 });
  await LeaveRecord.collection.createIndex({ roll: 1, status: 1 });
  await LeaveRecord.collection.createIndex({ createdAt: -1 });
  await OTP.collection.createIndex({ sessionToken: 1 });
  await OTP.collection.createIndex({ expiresAt: 1 });
  await FailedEmail.collection.createIndex({ timestamp: -1 });
  await Notification.collection.createIndex({ recipientRoll: 1, archived: 1, createdAt: -1 });
  await Notification.collection.createIndex({ userRole: 1, archived: 1, createdAt: -1 });
  await Notification.collection.createIndex({ recipientUsername: 1, archived: 1, createdAt: -1 });
  await DailyReport.collection.createIndex({ reportDate: -1, format: 1 }, { unique: true });
  await ReportSettings.collection.createIndex({ singleton: 1 }, { unique: true });
  await GateOTP.collection.createIndex({ sessionToken: 1 });
  await GateOTP.collection.createIndex({ roll: 1, purpose: 1, issuedAt: -1 });
  await ensureMigratedIndex(GateOTP.collection, { expiresAt: 1 }, { expireAfterSeconds: 0 });
  await NFCTag.collection.createIndex({ uid: 1 }, { unique: true });
  await NFCTag.collection.createIndex({ cadetId: 1 }, { unique: true });
  await NFCCounter.collection.createIndex({ year: 1 }, { unique: true });
  await DeviceConfig.collection.createIndex({ deviceId: 1 }, { unique: true });
  await GateHistory.collection.createIndex({ uid: 1, timestamp: -1 });
  await GateHistory.collection.createIndex({ cadetId: 1, timestamp: -1 });
  await GateHistory.collection.createIndex({ gate: 1, timestamp: -1 });

  await db.collection('leaverequests').createIndex({ cadetId: 1, status: 1 });
  await db.collection('leaverequests').createIndex({ createdAt: -1 });
  await db.collection('face_embeddings').createIndex({ enrolledAt: -1 });
  await db.collection('nfctokens').createIndex({ token: 1 }, { unique: true, sparse: true });
  await db.collection('nfctokens').createIndex({ cadetId: 1 });
  await ensureMigratedIndex(db.collection('nfctokens'), { expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('sessions').createIndex({ token: 1 }, { unique: true, sparse: true });
  await ensureMigratedIndex(db.collection('sessions'), { expiresAt: 1 }, { expireAfterSeconds: 0 });
}

async function upsertFallbackFaceEmbedding(cadet, descriptor, enrolledAt, enrolledBy) {
  if (!Array.isArray(descriptor) || descriptor.length < 64) {
    throw new Error('A valid browser face descriptor is required when the Python face service is unavailable.');
  }

  const cadetId = canonicalFaceCadetId(cadet);
  if (!cadetId) {
    throw new Error('Cadet identifier is required before saving a face embedding.');
  }
  const embedding = descriptor.map(value => Number(value));
  if (embedding.some(value => !Number.isFinite(value))) {
    throw new Error('Face descriptor contains invalid numeric values.');
  }

  await faceEmbeddingsCollection().updateOne(
    { cadetId },
    {
      $set: {
        cadetId,
        cadetName: cadet.name || cadet.roll,
        embedding,
        enrolledAt,
        enrolledBy,
        updatedAt: enrolledAt,
        provider: 'faceapi-browser-fallback'
      },
      $setOnInsert: { createdAt: enrolledAt }
    },
    { upsert: true }
  );

  const saved = await faceEmbeddingsCollection().findOne(
    { cadetId },
    { projection: { embedding: 0 } }
  );
  if (!saved) {
    throw new Error('Fallback face embedding save verification failed.');
  }
  return saved;
}

async function checkFaceServiceHealth() {
  try {
    const response = await fetch(`${FACE_SERVICE_BASE_URL}/health`);
    if (!response.ok) throw new Error(`Health check failed with ${response.status}`);
    faceServiceOnline = true;
    return true;
  } catch (error) {
    faceServiceOnline = false;
    logWarn('Face service offline. Use OTP check-in as backup.');
    return false;
  }
}

function startFaceServiceWorker() {
  if (faceServiceProcess) return;

  const pythonCommand = process.env.PYTHON || 'python';
  faceServiceProcess = spawn(pythonCommand, ['face_service.py'], {
    cwd: __dirname,
    env: {
      ...process.env,
      FACE_SERVICE_PORT,
      FACE_SERVICE_HOST: '127.0.0.1',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  faceServiceProcess.stdout.on('data', (chunk) => {
    logLine(OUT_LOG, 'info', `[FaceService] ${String(chunk).trim()}`);
  });

  faceServiceProcess.stderr.on('data', (chunk) => {
    logLine(ERR_LOG, 'warn', `[FaceService] ${String(chunk).trim()}`);
  });

  faceServiceProcess.on('exit', (code) => {
    console.warn(`[FaceService] stopped with code ${code}`);
    faceServiceProcess = null;
  });
}

async function waitForFaceService(timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await checkFaceServiceHealth()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function ensureFaceServiceRunning() {
  if (await checkFaceServiceHealth()) {
    console.log(`[FaceService] Ready at ${FACE_SERVICE_PUBLIC_PATH} via port ${process.env.PORT || 3000}`);
    return true;
  }

  console.log('[FaceService] Starting internal face recognition worker...');
  startFaceServiceWorker();
  const ready = await waitForFaceService();

  if (ready) {
    console.log(`[FaceService] Ready at ${FACE_SERVICE_PUBLIC_PATH} via port ${process.env.PORT || 3000}`);
  } else {
    console.warn('[FaceService] Could not start. Face recognition routes will return unavailable until it is running.');
  }

  return ready;
}

process.on('exit', () => {
  if (faceServiceProcess) faceServiceProcess.kill();
});

app.get(['/face-service', '/face'], asyncHandler(async (req, res) => {
  const response = await fetch(`${FACE_SERVICE_BASE_URL}/`);
  const body = await response.text();

  res
    .status(response.status)
    .type(response.headers.get('content-type') || 'text/html')
    .send(
      body
        .replace(/Service port<\/dt>\s*<dd>5001<\/dd>/, 'Service path</dt><dd>localhost:3000/face-service</dd>')
        .replace(/<code>GET \/health<\/code>/g, '<code>GET /api/face/health</code>')
    );
}));

app.get('/api/face/health', asyncHandler(async (req, res) => {
  const response = await fetch(`${FACE_SERVICE_BASE_URL}/health`);
  const data = await response.json().catch(() => ({}));
  faceServiceOnline = response.ok;
  res.status(response.status).json({
    ...data,
    hostedAt: `http://localhost:${process.env.PORT || 3000}/face-service`,
  });
}));

app.get('/health', asyncHandler(async (req, res) => {
  const mongodbConnected = mongoose.connection.readyState === 1;
  const [cadets, faceEnrollments, activeLeaves, pendingApprovals] = mongodbConnected
    ? await Promise.all([
        Cadet.countDocuments(),
        faceEmbeddingsCollection().countDocuments(),
        LeaveRecord.countDocuments({ status: 'out' }),
        Cadet.countDocuments({ 'pendingLeave.approvalStatus': 'pending_approval' })
      ])
    : [0, 0, 0, 0];

  const uptimeSeconds = Math.floor(process.uptime());
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: `${hours}h ${minutes}m`,
    services: {
      node: 'running',
      mongodb: mongodbConnected ? 'connected' : 'disconnected',
      faceService: faceServiceOnline ? 'online' : 'offline',
      nfcReader: nfcService.getReaderStatus().readerConnected ? 'connected' : 'disconnected'
    },
    database: {
      cadets,
      faceEnrollments,
      activeLeaves,
      pendingApprovals
    },
    memory: process.memoryUsage()
  });
}));

async function generateUniqueEmergencyVerificationCode(passId) {
  const year = new Date().getFullYear();
  const numericPart = String(passId || '').match(/(\d{4})$/)?.[1] || String(crypto.randomInt(0, 10000)).padStart(4, '0');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const code = `AMET-SL-${year}-${numericPart}-${suffix}`;
    const [recordExists, pendingExists] = await Promise.all([
      LeaveRecord.exists({ emergencyVerificationCode: code }),
      Cadet.exists({ 'pendingLeave.emergencyVerificationCode': code })
    ]);
    if (!recordExists && !pendingExists) return code;
  }
  return `AMET-SL-${year}-${numericPart}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function resolveLeaveWindow(leaveRequest) {
  const fallbackBase = parseDateValue(leaveRequest?.requestedAt) || new Date();
  const resolvedFrom = combineDateAndTime(leaveRequest?.fromDate, leaveRequest?.fromTime)
    || parseDateValue(leaveRequest?.fromDate)
    || startOfDay(fallbackBase);
  const resolvedToRaw = combineDateAndTime(leaveRequest?.toDate, leaveRequest?.toTime)
    || parseDateValue(leaveRequest?.toDate)
    || parseDateValue(leaveRequest?.returnDate)
    || endOfDay(resolvedFrom);
  const resolvedReturn = parseDateValue(leaveRequest?.returnDate);
  const hasFromTime = isValidTimeString(leaveRequest?.fromTime);
  const hasToTime = isValidTimeString(leaveRequest?.toTime);
  const normalizedFrom = hasFromTime ? resolvedFrom : startOfDay(resolvedFrom);
  const normalizedTo = hasToTime ? resolvedToRaw : endOfDay(resolvedToRaw < normalizedFrom ? normalizedFrom : resolvedToRaw);

  return {
    fromDate: normalizedFrom,
    toDate: normalizedTo,
    returnDate: resolvedReturn ? endOfDay(resolvedReturn) : null
  };
}

function isValidTimeString(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function combineDateAndTime(dateValue, timeValue) {
  if (!dateValue || !isValidTimeString(timeValue)) return null;
  const dateText = String(dateValue).slice(0, 10);
  const combined = new Date(`${dateText}T${timeValue}:00`);
  return Number.isNaN(combined.getTime()) ? null : combined;
}

function validateLeaveDateTimes({ fromDate, toDate, fromTime, toTime }) {
  if (!fromTime) return 'From Time is required.';
  if (!toTime) return 'To Time is required.';
  if (!isValidTimeString(fromTime) || !isValidTimeString(toTime)) return 'From Time and To Time must use HH:MM format.';
  const fromDateTime = combineDateAndTime(fromDate, fromTime);
  const toDateTime = combineDateAndTime(toDate, toTime);
  if (!fromDateTime || !toDateTime) return 'Valid From Date, To Date, From Time and To Time are required.';
  if (fromDateTime < new Date()) return 'From DateTime must not be in the past.';
  if (toDateTime <= fromDateTime) return 'To DateTime must be after From DateTime.';
  return null;
}

async function generateUniquePassId() {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const suffix = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    const passId = `SL/${year}/${suffix}`;
    const exists = await LeaveRecord.exists({ passId });
    if (!exists) return passId;
  }

  return `SL/${year}/${String(Date.now()).slice(-4)}`;
}

function mapCadetForGatePass(cadet) {
  if (!cadet) return null;
  return {
    cadetId: cadet.studentId || cadet.roll,
    name: cadet.name || '',
    rank: cadet.rank || 'CADET',
    idNo: cadet.idNo || cadet.studentId || cadet.serialNo || cadet.roll,
    vessel: cadet.vessel || 'AMET CAMPUS',
    company: cadet.company || 'AMET EDUCATIONAL INSTITUTIONS',
    agent: cadet.agent || 'AMET DUTY OFFICE',
    port: cadet.port || 'CHENNAI, INDIA',
    authorizedOfficer: cadet.authorizedOfficer || 'ADMINISTRATOR',
    officerTitle: cadet.officerTitle || 'Campus Security Office',
    email: cadet.email || '',
    course: cadet.course || cadet.batch || '',
    batch: cadet.batch || cadet.course || '',
    studentId: cadet.studentId || '',
    roll: cadet.roll
  };
}

function escapeEmailHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendSystemEmail({ to, subject, text, html, attachments = [] }) {
  if (!to) return { deliveryMode: 'skipped' };
  if (!transporter) {
      logInfo('[EMAIL][DEV] Delivery skipped because SMTP is unavailable', { subject });
    return { deliveryMode: 'console' };
  }

  const mail = {
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || 'shoreleave-local@example.com',
    to,
    subject,
    text,
    html,
    attachments
  };

  try {
    const info = await transporter.sendMail(mail);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) logInfo(`[EMAIL] Preview: ${previewUrl}`);
    return {
      deliveryMode: 'email',
      previewUrl,
      messageId: info.messageId,
      accepted: info.accepted || [],
      rejected: info.rejected || []
    };
  } catch (error) {
    logError(`[EMAIL] Failed to send ${subject}`, error);
    await FailedEmail.create({
      to,
      subject,
      text,
      html,
      attachments,
      error: error.message || String(error),
      timestamp: new Date(),
      retried: 0
    }).catch((recordError) => logError('[EMAIL] Could not store failed email', recordError));
    return { deliveryMode: 'failed_queued', error: error.message || 'Email delivery failed' };
  }
}

async function retryFailedEmails() {
  if (!transporter) return;
  const pending = await FailedEmail.find({ deliveredAt: { $exists: false } })
    .sort({ timestamp: 1 })
    .limit(25);

  for (const failed of pending) {
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER || 'shoreleave-local@example.com',
        to: failed.to,
        subject: failed.subject,
        text: failed.text,
        html: failed.html,
        attachments: failed.attachments || []
      });
      failed.deliveredAt = new Date();
      failed.lastRetryAt = new Date();
      failed.retried += 1;
      await failed.save();
      failed.to = '[DELIVERED]';
      failed.text = '';
      failed.html = '';
      failed.attachments = [];
      failed.error = '';
      await failed.save();
      logInfo('[EMAIL] Retried queued email successfully');
    } catch (error) {
      failed.lastRetryAt = new Date();
      failed.retried += 1;
      failed.error = error.message || String(error);
      await failed.save();
      logError('[EMAIL] Retry of queued email failed', error);
    }
  }
}

function getActiveLeaveToken(cadet) {
  if (cadet?.pendingLeave?.approvalStatus === 'approved' && cadet?.pendingLeave?.passVerificationToken) {
    return cadet.pendingLeave.passVerificationToken;
  }
  return null;
}

function getLeaveEndDate(record) {
  return parseDateValue(record?.toDate) || parseDateValue(record?.checkInDate) || parseDateValue(record?.checkOutDate);
}

function getLeaveReturnDate(record) {
  return parseDateValue(record?.checkInDate);
}

function getLeaveTimeliness(record, now = new Date()) {
  const leaveEnd = getLeaveEndDate(record);
  const returnedAt = getLeaveReturnDate(record);
  if (!leaveEnd) return { status: 'unknown', label: 'Unknown', lateMs: 0 };
  if (returnedAt) {
    if (returnedAt.getTime() <= leaveEnd.getTime()) {
      return { status: 'on_time', label: 'On Time', lateMs: 0 };
    }
    return { status: 'late', label: 'Late Return', lateMs: returnedAt.getTime() - leaveEnd.getTime() };
  }
  if (now.getTime() > leaveEnd.getTime()) {
    return { status: 'overdue', label: 'Overdue', lateMs: now.getTime() - leaveEnd.getTime() };
  }
  return { status: 'not_returned', label: 'Not returned yet', lateMs: 0 };
}

function getLeaveDays(record) {
  const start = parseDateValue(record?.fromDate) || parseDateValue(record?.checkOutDate);
  const end = parseDateValue(record?.toDate) || parseDateValue(record?.checkInDate);
  if (!start || !end) return 0;
  return Math.max(1, Math.ceil((endOfDay(end) - startOfDay(start)) / (24 * 60 * 60 * 1000)));
}

function getTodayAt(hour, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function isShoreLeave(record) {
  return String(record?.leaveType || '').toLowerCase() === 'shore leave';
}

function buildHistoryStats(history, pendingLeave = null) {
  const currentYear = new Date().getFullYear();
  const yearRecords = history.filter(record => {
    const date = parseDateValue(record.checkOutDate) || parseDateValue(record.fromDate);
    return date && date.getFullYear() === currentYear;
  });
  const completed = history.filter(record => getLeaveReturnDate(record));
  const onTime = completed.filter(record => getLeaveTimeliness(record).status === 'on_time').length;
  const lateReturns = history.filter(record => getLeaveTimeliness(record).status === 'late').length;
  const overdue = history.filter(record => getLeaveTimeliness(record).status === 'overdue').length;
  const totalDaysOutside = yearRecords.reduce((sum, record) => sum + getLeaveDays(record), 0);
  return {
    totalLeavesThisYear: yearRecords.length,
    totalDaysOutside,
    onTimeReturnRate: completed.length ? Math.round((onTime / completed.length) * 100) : 100,
    lateReturns,
    overdue,
    hasPendingLeave: pendingLeave?.approvalStatus === 'pending_approval'
  };
}

async function createPersistentNotification({ roll, userRole = 'cadet', username, payload, actor = 'system', entity, dedupeKey }) {
  const values = {
    title: String(payload?.title || 'Shore Leave'),
    message: String(payload?.body || payload?.message || 'You have a Shore Leave update.'),
    type: String(payload?.type || 'system'),
    priority: String(payload?.priority || 'normal'),
    userRole,
    recipientRoll: roll ? normalizeRoll(roll) : undefined,
    recipientUsername: username || undefined,
    actor,
    entity: entity || payload?.entity || undefined,
    url: payload?.url || undefined,
    dedupeKey: dedupeKey || payload?.dedupeKey || undefined
  };
  const notification = values.dedupeKey
    ? await Notification.findOneAndUpdate(
        { dedupeKey: values.dedupeKey },
        { $setOnInsert: values },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    : await Notification.create(values);
  const dto = notification.toObject ? notification.toObject() : notification;
  if (global.io) {
    if (values.recipientRoll) global.io.to(`cadet:${values.recipientRoll}`).emit('notification:created', dto);
    global.io.to('admin').emit('notification:created', dto);
  }
  return notification;
}

async function sendPushToCadet(roll, payload) {
  const persistent = await createPersistentNotification({ roll, payload });
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { deliveryMode: 'stored', reason: 'VAPID keys not configured', notificationId: persistent.notificationId };
  }

  const subscriptions = await PushSubscription.find({ roll, isActive: true });
  if (!subscriptions.length) return { deliveryMode: 'stored', reason: 'No push subscription', notificationId: persistent.notificationId };

  let sent = 0;
  for (const record of subscriptions) {
    try {
      await webPush.sendNotification(record.subscription, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        record.isActive = false;
        await record.save();
      }
    }
  }

  return { deliveryMode: sent ? 'push' : 'stored', sent, notificationId: persistent.notificationId };
}

function emitCadetEvent(cadet, event, payload) {
  const roll = typeof cadet === 'string' ? cadet : cadet?.roll;
  const body = { roll, ...(payload || {}) };
  if (global.io && typeof global.io.to === 'function') {
    global.io.to(`cadet:${roll}`).emit(event, body);
  }
}

function emitAdminEvent(event, payload) {
  if (global.io && typeof global.io.to === 'function') {
    global.io.to('admin').emit(event, payload);
  }
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || getBearerToken({
      headers: {
        authorization: '',
        cookie: socket.handshake.headers?.cookie || ''
      }
    });
    if (!token) return next(new Error('Authentication required'));
    const user = jwt.verify(token, JWT_SECRET);
    if (['admin', 'duty_officer', 'officer'].includes(user.role)) {
      const officer = await Officer.findOne({ username: user.username, isActive: true }).select('username role activeSessionId');
      if (!officer || (officer.activeSessionId && officer.activeSessionId !== user.sessionId)) {
        return next(new Error('Administrator session expired'));
      }
      socket.user = user;
      return next();
    }
    if (user.role !== 'cadet') return next(new Error('Cadet access required'));
    const cadet = await Cadet.findOne({ roll: user.roll }).select('roll activeSessionId');
    if (!cadet || cadet.activeSessionId !== user.sessionId) {
      return next(new Error('Session expired'));
    }
    socket.user = user;
    next();
  } catch (error) {
    next(new Error('Invalid session'));
  }
});

io.on('connection', socket => {
  if (socket.user.role === 'cadet') {
    socket.join(`cadet:${socket.user.roll}`);
    socket.emit('dashboard:connected', { roll: socket.user.roll });
  } else {
    socket.join('admin');
    socket.emit('dashboard:connected', { role: socket.user.role });
  }
});

const badgeService = createBadgeService({ Cadet, sendPushToCadet, emitCadetEvent });
const xpService = createXpService({ Cadet, CadetXpLog, sendPushToCadet, emitCadetEvent });
const streakService = createStreakService({ Cadet, xpService, badgeService, emitCadetEvent });
const lootService = createLootService({ Cadet, sendPushToCadet, emitCadetEvent, emitAdminEvent });

function leaveTokenCost(leaveType) {
  const key = String(leaveType || '').trim().toLowerCase();
  if (key === 'medical' || key === 'medical leave') return 0;
  if (key === 'special leave') return 2;
  return 1;
}

function hasActiveLeaveRequest(cadet) {
  const status = String(cadet?.pendingLeave?.approvalStatus || '').toLowerCase();
  return ['pending_approval', 'approved'].includes(status);
}

async function findOpenShoreLeaveRecord(roll) {
  return LeaveRecord.findOne({
    roll,
    leaveType: 'Shore Leave',
    checkInDate: { $exists: false },
    status: { $nin: ['returned', 'late_return', 'rejected'] }
  }).sort({ checkOutDate: -1, passIssuedAt: -1, _id: -1 });
}

function levelTitle(level) {
  const match = LEVELS.find(item => item.level === Number(level));
  return match ? match.title : 'New Cadet';
}

function nextLevelInfo(xp) {
  const sorted = [...LEVELS].sort((a, b) => a.xp - b.xp);
  return sorted.find(item => Number(xp || 0) < item.xp) || sorted[sorted.length - 1];
}

async function calculateComplianceScore(roll) {
  const records = await LeaveRecord.find({
    roll,
    checkInDate: { $exists: true, $ne: null }
  }).select('toDate checkInDate status');
  if (!records.length) return 100;
  const onTime = records.filter(record => getLeaveTimeliness(record).status === 'on_time').length;
  return Math.round((onTime / records.length) * 100);
}

async function updateCadetCompliance(cadetOrRoll) {
  const roll = typeof cadetOrRoll === 'string' ? cadetOrRoll : cadetOrRoll.roll;
  const score = await calculateComplianceScore(roll);
  await Cadet.updateOne({ roll }, { $set: { complianceScore: score } });
  return score;
}

function returnStatusForRecord(record, checkInDate = new Date()) {
  const returnTime = new Date(checkInDate);
  if (record?.toDate && returnTime > new Date(record.toDate)) return 'late';
  if (returnTime.getHours() < 17) return 'early';
  return 'onTime';
}

async function awardReturnGamification(cadet, record, returnStatus) {
  if (returnStatus === 'early') {
    await xpService.awardXP(cadet._id, 'EARLY_RETURN', 'Returned before 17:00').catch(() => {});
    await badgeService.awardBadge(cadet._id, 'early_bird').catch(() => {});
  } else if (returnStatus === 'onTime') {
    await xpService.awardXP(cadet._id, 'ON_TIME_RETURN', 'Returned on time').catch(() => {});
  } else if (returnStatus === 'late') {
    await xpService.awardXP(cadet._id, 'LATE_RETURN', 'Late return').catch(() => {});
  } else if (returnStatus === 'overdue') {
    await xpService.awardXP(cadet._id, 'OVERDUE', 'Overdue return').catch(() => {});
  }
  await streakService.updateStreak(cadet._id, returnStatus).catch(() => {});
  const complianceScore = await updateCadetCompliance(cadet.roll).catch(() => cadet.complianceScore || 100);
  emitCadetEvent(cadet, 'compliance:updated', { complianceScore });
}

const gateDecisionService = createGateDecisionService({
  Cadet,
  LeaveRecord,
  NFCTag,
  GateHistory,
  AuditLog,
  DeviceConfig,
  nfcService,
  io,
  nowTime,
  onReturn: async ({ cadet, activeLeave, late }) => {
    const oldXp = Number(cadet.xp || 0);
    const returnStatus = late ? 'late' : returnStatusForRecord(activeLeave, new Date());
    await awardReturnGamification(cadet, activeLeave, returnStatus);
    const refreshedCadet = await Cadet.findById(cadet._id);
    await sendWelcomeBackEmail(refreshedCadet || cadet, activeLeave)
      .catch(error => logError('[NFC] Welcome email failed', error));
    return {
      xpGained: Number(refreshedCadet?.xp || 0) - oldXp,
      returnStatus,
      status: late ? 'LATE' : returnStatus === 'early' ? 'EARLY' : 'ON TIME',
      photo: cadet.photoUrl || getFrontFaceImage(cadet) || activeLeave.checkOutPhotoUrl || ''
    };
  },
  onBeforeCheckOut: async ({ cadet, approvedLeave, checkOutDate, method, verification }) => {
    return issueGatePassForCheckout(null, cadet, approvedLeave, {
      issuedBy: verification?.actor || (method === 'NFC' ? 'NFC_GATE' : 'BIOMETRIC_GATE'),
      issuedAt: checkOutDate,
      method,
      persist: async () => {
        cadet.markModified('pendingLeave');
        await cadet.save();
      }
    });
  },
  onDecisionApplied: async () => {
    if (typeof dashboardSnapshotCache !== 'undefined') dashboardSnapshotCache.expiresAt = 0;
    const snapshot = await buildDashboardSnapshot();
    io.to('admin').emit('stats:update', snapshot.stats);
  }
});

async function verifyNfcTap(rawUid, gateType = 'AUTO') {
  return gateDecisionService.processNfcTap(rawUid, gateType);
}

app.use('/api/nfc', createNfcRouter({
  requireOfficer,
  asyncHandler,
  Cadet,
  GateHistory,
  nfcService,
  io,
  verifyNfcTap,
  AuditLog
}));

async function maybeAwardLeaveBadges(cadet) {
  const shoreLeaves = await LeaveRecord.countDocuments({ roll: cadet.roll, leaveType: 'Shore Leave' });
  if (shoreLeaves >= 1) await badgeService.awardBadge(cadet._id, 'first_leave').catch(() => {});
  if (shoreLeaves >= 10) await badgeService.awardBadge(cadet._id, 'explorer').catch(() => {});
  const overdueCount = await LeaveRecord.countDocuments({ roll: cadet.roll, status: 'overdue' });
  if (!overdueCount) await badgeService.awardBadge(cadet._id, 'clean_record').catch(() => {});
}

function buildShoreLeaveStats(history) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const yearRecords = history.filter(record => {
    const date = parseDateValue(record.checkOutDate) || parseDateValue(record.fromDate);
    return date && date.getFullYear() === currentYear;
  });
  const monthRecords = yearRecords.filter(record => {
    const date = parseDateValue(record.checkOutDate) || parseDateValue(record.fromDate);
    return date && date.getMonth() === currentMonth;
  });
  const completed = history.filter(record => parseDateValue(record.checkInDate));
  const onTime = completed.filter(record => {
    const checkIn = parseDateValue(record.checkInDate);
    if (!checkIn) return false;
    const sixPm = new Date(checkIn);
    sixPm.setHours(18, 0, 0, 0);
    return checkIn <= sixPm;
  }).length;
  return {
    totalThisMonth: monthRecords.length,
    totalThisYear: yearRecords.length,
    onTimeBefore18Rate: completed.length ? Math.round((onTime / completed.length) * 100) : 100
  };
}

async function saveBase64Image(base64String, prefix, bucket = 'verification-images', folder = '') {
  if (!base64String || typeof base64String !== 'string') return null;
  try {
    const uploaded = await uploadDataUrl({
      bucket,
      folder,
      filename: prefix,
      dataUrl: base64String,
      upsert: true
    });
    return uploaded.publicUrl;
  } catch (err) {
    logError(`[SUPABASE] Failed to upload ${bucket}/${prefix}`, err);
    throw err;
  }
}

const LEAVE_DOCUMENT_BUCKET = 'verification-images';
const LEAVE_DOCUMENT_FOLDER = 'leave-documents';
const LEAVE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const LEAVE_DOCUMENT_ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function normalizeLeaveDocumentPayload(document) {
  if (!document) return null;
  if (typeof document === 'string') {
    return {
      dataUrl: document,
      fileName: 'supporting-document',
      declaredType: null,
      declaredSize: null
    };
  }
  if (typeof document === 'object') {
    return {
      dataUrl: document.dataUrl || document.base64 || document.content || document.file,
      fileName: document.name || document.fileName || 'supporting-document',
      declaredType: document.type || document.contentType || null,
      declaredSize: Number.isFinite(Number(document.size)) ? Number(document.size) : null
    };
  }
  return null;
}

function parseLeaveDocumentDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    const err = new Error('Supporting document is required.');
    err.statusCode = 400;
    throw err;
  }
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    const err = new Error('Supporting document must be sent as a base64 data URL.');
    err.statusCode = 400;
    throw err;
  }
  const contentType = match[1].toLowerCase();
  if (!LEAVE_DOCUMENT_ALLOWED_TYPES.has(contentType)) {
    const err = new Error('Supporting document must be PDF, JPG, JPEG, or PNG.');
    err.statusCode = 400;
    throw err;
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) {
    const err = new Error('Supporting document is empty.');
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > LEAVE_DOCUMENT_MAX_BYTES) {
    const err = new Error('Supporting document must be 10 MB or smaller.');
    err.statusCode = 413;
    throw err;
  }
  return { contentType, size: buffer.length };
}

async function uploadLeaveSupportingDocument({ document, cadet, leaveType }) {
  const payload = normalizeLeaveDocumentPayload(document);
  if (!payload?.dataUrl) return null;
  const parsed = parseLeaveDocumentDataUrl(payload.dataUrl);
  const rollPart = normalizeRoll(cadet.roll || cadet.rollNumber || cadet.studentId || 'cadet').replace(/[^a-zA-Z0-9_-]/g, '_');
  const uploaded = await uploadDataUrl({
    bucket: LEAVE_DOCUMENT_BUCKET,
    folder: `${LEAVE_DOCUMENT_FOLDER}/${rollPart}`,
    filename: `${Date.now()}_${payload.fileName}`,
    dataUrl: payload.dataUrl,
    upsert: true
  });
  const publicUrl = uploaded.publicUrl || uploaded.url;
  return {
    url: publicUrl,
    publicUrl,
    bucket: uploaded.bucket || LEAVE_DOCUMENT_BUCKET,
    path: uploaded.objectPath || uploaded.path,
    storagePath: uploaded.objectPath || uploaded.path,
    fileName: payload.fileName,
    contentType: parsed.contentType,
    size: parsed.size,
    leaveType,
    uploadedAt: new Date(),
    status: 'uploaded'
  };
}

function encryptOTP(otp) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', OTP_SECRET, iv);
  const encrypted = Buffer.concat([cipher.update(otp, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function normalizeRoll(roll) {
  return String(roll || '').trim().toUpperCase();
}

function buildOfficerDto(officer) {
  return {
    id: officer?.username || null,
    username: officer?.username || '',
    role: officer?.role || 'duty_officer',
    fullName: officer?.fullName || officer?.username || 'Officer',
    type: 'officer'
  };
}

function buildCadetDto(cadet) {
  return {
    id: cadet?.roll || null,
    roll: cadet?.roll || '',
    rollNumber: cadet?.rollNumber || cadet?.roll || '',
    studentId: cadet?.studentId || '',
    name: cadet?.name || cadet?.roll || '',
    email: cadet?.email || '',
    role: 'cadet',
    type: 'cadet',
    status: cadet?.status || 'returned',
    enrollmentStatus: cadet?.enrollmentStatus || 'ACTIVE',
    leaveBlocked: isLeaveBlockActive(cadet),
    leaveBlockedReason: cadet?.leaveBlockedReason || '',
    leaveBlockedDate: cadet?.leaveBlockedDate || null,
    leaveBlockedUntil: cadet?.leaveBlockedUntil || null,
    photoUrl: cadet?.photoUrl || getFrontFaceImage(cadet) || ''
  };
}

function actorUsername(req) {
  return req.officer?.username || req.user?.username || req.user?.email || 'system';
}

function publicCadetRecord(cadet) {
  const record = cadet?.toObject ? cadet.toObject() : { ...(cadet || {}) };
  for (const field of [
    '_id', '__v', 'faceDescriptor', 'faceDescriptors', 'activeSessionId',
    'deviceFingerprint', 'loginAttempts', 'lockedUntil', 'fingerprintTemplate',
    'fingerprintTemplateEncrypted', 'fingerprintTemplateReference', 'verificationHistory'
  ]) delete record[field];
  if (record.nfc) {
    record.nfc = {
      assigned: Boolean(record.nfc.uid || record.nfc.assigned),
      status: record.nfc.status || (record.nfc.uid ? 'ASSIGNED' : 'UNASSIGNED'),
      assignedAt: record.nfc.assignedAt || null,
      lastUsed: record.nfc.lastUsed || record.nfc.lastSeen || null
    };
  }
  record.leaveBlock = buildLeaveBlockStatus(record);
  return record;
}

function publicOfficerRecord(officer) {
  const record = officer?.toObject ? officer.toObject() : { ...(officer || {}) };
  return {
    username: record.username || '',
    adminNumber: record.adminNumber || record.username || '',
    email: record.email || '',
    role: record.role || '',
    branch: record.branch || '',
    isActive: record.isActive !== false,
    createdBy: record.createdBy || '',
    verifiedAt: record.verifiedAt || null,
    lastLoginAt: record.lastLoginAt || null
  };
}

function publicEmailDeliveryResult(result) {
  return {
    deliveryMode: result?.deliveryMode || 'unknown',
    queued: result?.deliveryMode === 'failed_queued'
  };
}

function publicNotificationRecord(notification) {
  const record = notification?.toObject ? notification.toObject() : { ...(notification || {}) };
  delete record._id;
  delete record.__v;
  delete record.recipientRoll;
  delete record.recipientUsername;
  return record;
}

function publicAuditRecord(entry) {
  const record = entry?.toObject ? entry.toObject() : { ...(entry || {}) };
  delete record._id;
  delete record.__v;
  record.details = redactLogValue(record.details || {});
  return record;
}

function publicLeaveRecord(record) {
  const source = record?.toObject ? record.toObject() : { ...(record || {}) };
  return {
    roll: source.roll || '',
    name: source.name || '',
    batch: source.batch || '',
    course: source.course || '',
    studentId: source.studentId || '',
    dest: source.dest || '',
    checkOutTime: source.checkOutTime || '',
    checkInTime: source.checkInTime || '',
    checkOutDate: source.checkOutDate || null,
    checkInDate: source.checkInDate || null,
    fromDate: source.fromDate || null,
    toDate: source.toDate || null,
    fromTime: source.fromTime || '',
    toTime: source.toTime || '',
    returnDate: source.returnDate || null,
    status: source.status || '',
    checkOutPhotoUrl: source.checkOutPhotoUrl || '',
    checkInPhotoUrl: source.checkInPhotoUrl || '',
    locationAddress: source.locationAddress || '',
    checkOutLat: source.checkOutLat || '',
    checkInLat: source.checkInLat || '',
    checkOutLng: source.checkOutLng || '',
    checkInLng: source.checkInLng || '',
    leaveType: source.leaveType || '',
    leaveReason: source.leaveReason || '',
    leaveDocumentUrl: source.leaveDocumentUrl || '',
    approvalStatus: source.approvalStatus || '',
    approvedBy: source.approvedBy || '',
    approvedAt: source.approvedAt || null,
    rejectionReason: source.rejectionReason || '',
    passId: source.passId || '',
    expired: Boolean(source.expired),
    passIssuedAt: source.passIssuedAt || null,
    gatePassPdfUrl: source.gatePassPdfUrl || source.gatePass?.publicUrl || ''
  };
}

function isLeaveBlockActive(cadet) {
  if (!cadet?.leaveBlocked) return false;
  if (!cadet.leaveBlockedUntil) return true;
  const until = new Date(cadet.leaveBlockedUntil);
  if (Number.isNaN(until.getTime())) return true;
  return until > new Date();
}

function buildLeaveBlockStatus(cadet) {
  const blocked = isLeaveBlockActive(cadet);
  return {
    blocked,
    reason: blocked ? (cadet?.leaveBlockedReason || 'Administrative Hold') : '',
    blockedBy: blocked ? (cadet?.leaveBlockedBy || '') : '',
    blockedAt: blocked ? (cadet?.leaveBlockedDate || null) : null,
    blockedUntil: blocked ? (cadet?.leaveBlockedUntil || null) : null,
    unblockedBy: cadet?.leaveUnblockedBy || '',
    unblockedAt: cadet?.leaveUnblockedDate || null
  };
}

function sendLeaveBlockedResponse(res, cadet) {
  return res.status(403).json({
    success: false,
    code: 'LEAVE_BLOCKED',
    message: 'Your leave privileges have been suspended. Please contact the administration.',
    reason: cadet?.leaveBlockedReason || 'Administrative Hold',
    blockDate: cadet?.leaveBlockedDate || null,
    blockedUntil: cadet?.leaveBlockedUntil || null
  });
}

function parseLeaveBlockUntil(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error('Block Until Date is invalid.');
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

async function notifyLeaveBlockChange(cadet, blocked, details = {}) {
  const adminName = details.admin || 'Administrator';
  const blockDate = details.date || new Date();
  if (blocked) {
    const parts = [
      `Reason: ${details.reason || 'Administrative Hold'}`,
      `Blocked on: ${formatDate(blockDate)}`,
      `Administrator: ${adminName}`
    ];
    if (details.until) parts.push(`Until: ${formatDate(details.until)}`);
    return sendPushToCadet(cadet.roll, {
      title: 'Leave Privileges Suspended',
      body: parts.join(' | '),
      type: 'leave_block',
      priority: 'high',
      url: '/cadet-dashboard.html',
      entity: { roll: cadet.roll, reason: details.reason || '', blockedUntil: details.until || null }
    });
  }
  return sendPushToCadet(cadet.roll, {
    title: 'Leave Privileges Restored',
    body: `You can apply for leave again. Updated by ${adminName}.`,
    type: 'leave_block',
    priority: 'normal',
    url: '/cadet-dashboard.html',
    entity: { roll: cadet.roll, restoredAt: blockDate }
  });
}

async function blockCadetLeave({ cadet, req, reason, blockedUntil }) {
  const now = new Date();
  const admin = actorUsername(req);
  cadet.leaveBlocked = true;
  cadet.leaveBlockedReason = reason;
  cadet.leaveBlockedBy = admin;
  cadet.leaveBlockedDate = now;
  cadet.leaveBlockedUntil = blockedUntil || null;
  cadet.leaveUnblockedBy = '';
  cadet.leaveUnblockedDate = null;
  await cadet.save();
  await AuditLog.create({
    action: 'LEAVE_BLOCKED',
    roll: cadet.roll,
    details: {
      cadetId: String(cadet._id),
      cadetName: cadet.name || cadet.roll,
      adminId: admin,
      reason,
      expiryDate: blockedUntil || null,
      ipAddress: clientIp(req)
    }
  });
  await notifyLeaveBlockChange(cadet, true, { admin, reason, until: blockedUntil, date: now });
  emitCadetEvent(cadet, 'leave:block_updated', buildLeaveBlockStatus(cadet));
  emitAdminEvent('cadet:leave_blocked', { roll: cadet.roll, cadetName: cadet.name || cadet.roll, ...buildLeaveBlockStatus(cadet) });
  return cadet;
}

async function unblockCadetLeave({ cadet, req }) {
  const now = new Date();
  const admin = actorUsername(req);
  cadet.leaveBlocked = false;
  cadet.leaveBlockedReason = '';
  cadet.leaveBlockedBy = cadet.leaveBlockedBy || '';
  cadet.leaveBlockedUntil = null;
  cadet.leaveUnblockedBy = admin;
  cadet.leaveUnblockedDate = now;
  await cadet.save();
  await AuditLog.create({
    action: 'LEAVE_UNBLOCKED',
    roll: cadet.roll,
    details: {
      cadetId: String(cadet._id),
      cadetName: cadet.name || cadet.roll,
      adminId: admin,
      ipAddress: clientIp(req)
    }
  });
  await notifyLeaveBlockChange(cadet, false, { admin, date: now });
  emitCadetEvent(cadet, 'leave:block_updated', buildLeaveBlockStatus(cadet));
  emitAdminEvent('cadet:leave_unblocked', { roll: cadet.roll, cadetName: cadet.name || cadet.roll, ...buildLeaveBlockStatus(cadet) });
  return cadet;
}

function buildCadetMutationPayload(body = {}, { requireRoll = false } = {}) {
  const roll = normalizeRoll(body.roll || body.rollNumber || body.application_no || body.applicationNo);
  if (requireRoll && !roll) {
    const error = new Error('Cadet roll number is required.');
    error.statusCode = 400;
    throw error;
  }

  const payload = {};
  if (roll) {
    payload.roll = roll;
    payload.rollNumber = roll;
  }

  const stringFields = [
    'name',
    'batch',
    'studentId',
    'serialNo',
    'course',
    'rank',
    'idNo',
    'vessel',
    'company',
    'agent',
    'port',
    'authorizedOfficer',
    'officerTitle',
    'gender',
    'contactNo'
  ];
  for (const field of stringFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = String(body[field] || '').trim();
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    const email = normalizeEmail(body.email);
    if (email && !isValidEmail(email)) {
      const error = new Error('Enter a valid cadet email address.');
      error.statusCode = 400;
      throw error;
    }
    payload.email = email;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'offeredDate')) {
    payload.offeredDate = body.offeredDate ? new Date(body.offeredDate) : null;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'isBlocked')) {
    payload.isBlocked = body.isBlocked === true;
    payload.enrollmentStatus = payload.isBlocked ? 'BLOCKED' : 'ACTIVE';
  } else if (Object.prototype.hasOwnProperty.call(body, 'enrollmentStatus')) {
    const status = String(body.enrollmentStatus || '').toUpperCase();
    const allowed = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLOCKED', 'GRADUATED', 'PENDING_FACE'];
    if (!allowed.includes(status)) {
      const error = new Error('Invalid enrollmentStatus.');
      error.statusCode = 400;
      throw error;
    }
    payload.enrollmentStatus = status;
    payload.isBlocked = status === 'BLOCKED';
  }

  return payload;
}

function parseReportDate(value) {
  const parsed = parseDateValue(value);
  return startOfDay(parsed || new Date());
}

function dateRangeForReport(value) {
  const start = parseReportDate(value);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

async function buildDailyReportSummary(dateValue) {
  const { start, end } = dateRangeForReport(dateValue);
  const recordsQuery = {
    $or: [
      { createdAt: { $gte: start, $lt: end } },
      { checkOutDate: { $gte: start, $lt: end } },
      { checkInDate: { $gte: start, $lt: end } },
      { reviewedAt: { $gte: start, $lt: end } },
      { passIssuedAt: { $gte: start, $lt: end } }
    ]
  };

  const [
    totalCadets,
    activeCadets,
    leaveRecords,
    gateEvents,
    auditLogs,
    pendingLeaves,
    outsideCadets
  ] = await Promise.all([
    Cadet.countDocuments({}),
    Cadet.countDocuments({ enrollmentStatus: 'ACTIVE' }),
    LeaveRecord.find(recordsQuery).select('-checkOutPhotoUrl -checkInPhotoUrl').sort({ createdAt: -1, _id: -1 }).lean(),
    GateHistory.find({ timestamp: { $gte: start, $lt: end } }).sort({ timestamp: -1 }).limit(100).lean(),
    AuditLog.find({ timestamp: { $gte: start, $lt: end } }).sort({ timestamp: -1 }).limit(100).lean(),
    Cadet.countDocuments({ 'pendingLeave.approvalStatus': 'pending_approval' }),
    LeaveRecord.countDocuments({ status: { $in: ['out', 'overdue'] } })
  ]);

  const approvals = leaveRecords.filter(record => record.approvalStatus === 'approved').length;
  const rejected = leaveRecords.filter(record => record.approvalStatus === 'rejected').length;
  const checkOuts = leaveRecords.filter(record => record.checkOutDate).length;
  const checkIns = leaveRecords.filter(record => record.checkInDate).length;
  const overdue = leaveRecords.filter(record => record.status === 'overdue').length;
  const emergencyCodesGenerated = leaveRecords.filter(record => record.emergencyVerificationCode || record.passVerificationToken).length;
  const gatePassGenerated = leaveRecords.filter(record => record.gatePass || record.gatePassPdfUrl).length;

  return {
    date: start.toISOString().slice(0, 10),
    range: { start, end },
    generatedAt: new Date().toISOString(),
    totals: {
      cadets: totalCadets,
      activeCadets,
      leaveRecords: leaveRecords.length,
      pendingLeaves,
      approvals,
      rejected,
      checkOuts,
      checkIns,
      outsideCadets,
      overdue,
      emergencyCodesGenerated,
      gatePassGenerated,
      gateEvents: gateEvents.length,
      auditEvents: auditLogs.length
    },
    leaveRecords: leaveRecords.map(record => ({
      id: String(record._id),
      roll: record.roll,
      name: record.name,
      leaveType: record.leaveType,
      status: record.status,
      approvalStatus: record.approvalStatus,
      passId: record.passId,
      destination: record.dest,
      checkOutTime: record.checkOutTime,
      checkInTime: record.checkInTime,
      checkOutDate: record.checkOutDate,
      checkInDate: record.checkInDate
    })),
    gateEvents: gateEvents.map(event => ({
      id: String(event._id),
      roll: event.roll || event.cadetId || '',
      uid: event.uid,
      gate: event.gate,
      direction: event.direction,
      decision: event.decision,
      reason: event.reason,
      timestamp: event.timestamp
    })),
    auditLogs: auditLogs.map(log => ({
      id: String(log._id),
      action: log.action,
      roll: log.roll || '',
      timestamp: log.timestamp,
      details: log.details || {}
    }))
  };
}

function createDailyReportPdfBuffer(summary) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(20).text('Shore Leave Daily Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Date: ${summary.date}`);
    doc.text(`Generated: ${summary.generatedAt}`);
    doc.moveDown();

    doc.fontSize(14).text('Summary');
    Object.entries(summary.totals || {}).forEach(([key, value]) => {
      doc.fontSize(10).text(`${key}: ${value}`);
    });
    doc.moveDown();

    doc.fontSize(14).text('Leave Records');
    if (!summary.leaveRecords.length) {
      doc.fontSize(10).text('No leave records for this day.');
    } else {
      summary.leaveRecords.slice(0, 40).forEach(record => {
        doc.fontSize(9).text(`${record.roll || '-'} | ${record.name || '-'} | ${record.leaveType || '-'} | ${record.status || '-'} | ${record.passId || '-'}`);
      });
    }
    doc.moveDown();

    doc.fontSize(14).text('Gate Events');
    if (!summary.gateEvents.length) {
      doc.fontSize(10).text('No gate events for this day.');
    } else {
      summary.gateEvents.slice(0, 40).forEach(event => {
        doc.fontSize(9).text(`${event.timestamp || '-'} | ${event.gate || '-'} | ${event.direction || '-'} | ${event.decision || '-'} | ${event.reason || '-'}`);
      });
    }
    doc.end();
  });
}

async function uploadDailyReport(summary, format, generatedBy) {
  const reportFormat = String(format || 'pdf').toLowerCase() === 'json' ? 'json' : 'pdf';
  const buffer = reportFormat === 'json'
    ? Buffer.from(JSON.stringify(summary, null, 2), 'utf8')
    : await createDailyReportPdfBuffer(summary);
  const contentType = reportFormat === 'json' ? 'application/json' : 'application/pdf';
  const objectPath = `${summary.date.slice(0, 4)}/${summary.date.slice(5, 7)}/daily-report-${summary.date}.${reportFormat}`;
  const uploaded = await uploadBuffer({
    bucket: process.env.SUPABASE_DAILY_REPORTS_BUCKET || 'daily-reports',
    objectPath,
    buffer,
    contentType,
    upsert: true
  });
  const report = await DailyReport.findOneAndUpdate(
    { reportDate: parseReportDate(summary.date), format: reportFormat },
    {
      reportDate: parseReportDate(summary.date),
      generatedAt: new Date(),
      generatedBy,
      format: reportFormat,
      bucket: uploaded.bucket,
      storagePath: uploaded.path,
      publicUrl: uploaded.publicUrl,
      signedUrl: uploaded.signedUrl,
      status: 'uploaded',
      summary,
      metadata: {
        size: uploaded.size,
        sha256: uploaded.sha256,
        contentType: uploaded.contentType,
        uploadedAt: uploaded.uploadedAt
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return { report, uploaded };
}

async function getReportSettings() {
  return ReportSettings.findOneAndUpdate(
    { singleton: 'default' },
    { $setOnInsert: { singleton: 'default', enabled: true, runTime: '21:00', recipients: [], formats: ['pdf'] } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
}

async function evaluateGateOtpEligibility(cadet, purpose) {
  const now = new Date();
  const activeLeave = await LeaveRecord.findOne({
    roll: cadet.roll,
    status: { $in: ['out', 'overdue'] }
  }).sort({ checkOutDate: -1, _id: -1 }).lean();
  const approvedPending = await LeaveRecord.findOne({
    roll: cadet.roll,
    approvalStatus: 'approved',
    status: { $nin: ['out', 'returned', 'checked_in'] }
  }).sort({ passIssuedAt: -1, createdAt: -1, _id: -1 }).lean();

  if (cadet.isBlocked || ['SUSPENDED', 'BLOCKED'].includes(cadet.enrollmentStatus)) {
    return { allowed: false, reason: 'Cadet is blocked or suspended.', activeLeave, approvedPending };
  }
  if (purpose === 'CHECK_OUT' && isLeaveBlockActive(cadet)) {
    return {
      allowed: false,
      code: 'LEAVE_BLOCKED',
      reason: cadet.leaveBlockedReason || 'Administrative Hold',
      message: 'Your leave privileges have been suspended. Please contact the administration.',
      activeLeave,
      approvedPending,
      leaveBlock: buildLeaveBlockStatus(cadet)
    };
  }
  if (purpose === 'CHECK_IN' && !activeLeave) {
    return { allowed: false, reason: 'No active outside leave record found.', activeLeave, approvedPending };
  }
  if (purpose === 'CHECK_OUT' && !approvedPending) {
    return { allowed: false, reason: 'No approved pending exit found.', activeLeave, approvedPending };
  }

  const late = activeLeave?.toDate ? now > new Date(activeLeave.toDate) : false;
  return {
    allowed: true,
    reason: late ? 'Late return allowed with audit flag.' : 'Gate OTP allowed.',
    late,
    activeLeave,
    approvedPending
  };
}

async function buildEmergencyCodeAnalytics(from, to) {
  const start = from ? parseDateValue(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = to ? parseDateValue(to) : new Date();
  const range = { $gte: startOfDay(start || new Date()), $lte: endOfDay(end || new Date()) };
  const [records, events] = await Promise.all([
    LeaveRecord.find({
      $or: [
        { passIssuedAt: range },
        { checkOutDate: range },
        { checkInDate: range },
        { createdAt: range }
      ]
    }).select('roll name passId approvalStatus status emergencyVerificationCode gatePass passIssuedAt checkOutDate checkInDate storageStatus emergencyGateOutUsed emergencyGateInUsed').lean(),
    AuditLog.find({
      timestamp: range,
      action: {
        $in: [
          'EMERGENCY_CODE_GENERATED',
          'EMERGENCY_GATE_OUT',
          'EMERGENCY_GATE_IN',
          'EMERGENCY_CODE_INVALID',
          'EMERGENCY_CODE_EXPIRED'
        ]
      }
    }).sort({ timestamp: -1 }).limit(250).lean()
  ]);

  const generated = records.filter(record => record.emergencyVerificationCode || record.passId).length;
  const uploaded = records.filter(record => record.gatePass?.uploaded || record.gatePassPdfUrl).length;
  const scanned = records.filter(record => record.checkOutDate || record.checkInDate).length;
  const expired = records.filter(record => record.status === 'overdue').length;

  return {
    range: { from: range.$gte, to: range.$lte },
    totals: {
      generated,
      uploaded,
      scanned,
      expired,
      active: records.filter(record => ['out', 'approved'].includes(record.status)).length,
      failedEvents: events.filter(event => ['EMERGENCY_CODE_INVALID', 'EMERGENCY_CODE_EXPIRED'].includes(event.action)).length
    },
    records: records.map(record => ({
      roll: record.roll,
      name: record.name,
      passId: record.passId,
      status: record.status,
      approvalStatus: record.approvalStatus,
      emergencyVerificationCode: record.emergencyVerificationCode,
      storageStatus: record.storageStatus,
      passIssuedAt: record.passIssuedAt,
      checkOutDate: record.checkOutDate,
      checkInDate: record.checkInDate
    })),
    events: events.map(event => ({
      event: event.action,
      roll: event.roll,
      passId: event.details?.passId,
      source: event.details?.source || 'emergency_code',
      success: !['EMERGENCY_CODE_INVALID', 'EMERGENCY_CODE_EXPIRED'].includes(event.action),
      timestamp: event.timestamp,
      details: event.details || {}
    }))
  };
}

function normalizeEmail(email) {
  let value = String(email || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();

  const bracketedEmail = value.match(/<([^<>]+)>/);
  if (bracketedEmail) value = bracketedEmail[1];

  return value
    .replace(/^mailto:/i, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  const [localPart, domain = ''] = normalized.split('@');
  if (!localPart || !domain) return '';

  const maskedLocal = `${localPart[0]}${'*'.repeat(Math.min(Math.max(localPart.length - 1, 2), 6))}`;
  const domainParts = domain.split('.');
  const domainName = domainParts.shift() || '';
  const maskedDomain = `${domainName[0] || '*'}${'*'.repeat(Math.min(Math.max(domainName.length - 1, 2), 6))}`;
  const suffix = domainParts.length ? `.${domainParts.join('.')}` : '';
  return `${maskedLocal}@${maskedDomain}${suffix}`;
}

function emailMismatchResponse(res, registeredEmail) {
  const hint = maskEmail(registeredEmail);
  return res.status(403).json({
    error: hint
      ? `Email does not match the registered address (${hint}).`
      : 'Email does not match the registered address.',
    code: 'EMAIL_MISMATCH',
    registeredEmailHint: hint
  });
}

function getPrimaryFaceDescriptor(cadet) {
  if (Array.isArray(cadet?.faceDescriptor) && cadet.faceDescriptor.length > 0) {
    return cadet.faceDescriptor;
  }
  if (Array.isArray(cadet?.faceDescriptors) && Array.isArray(cadet.faceDescriptors[0]) && cadet.faceDescriptors[0].length > 0) {
    return cadet.faceDescriptors[0];
  }
  return null;
}

function getFrontFaceImage(cadet) {
  return cadet?.faceImages?.front || cadet?.photoUrl || null;
}

function getRequestIp(req) {
  const forwardedFor = req.headers?.['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

function extractSupabaseStorageObject(url, expectedBucket) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const markers = ['/storage/v1/object/public/', '/storage/v1/object/sign/'];
    const marker = markers.find(item => parsed.pathname.includes(item));
    if (!marker) return null;
    const remainder = decodeURIComponent(parsed.pathname.slice(parsed.pathname.indexOf(marker) + marker.length));
    const slashIndex = remainder.indexOf('/');
    if (slashIndex <= 0) return null;
    const bucket = remainder.slice(0, slashIndex);
    const objectPath = remainder.slice(slashIndex + 1);
    if (!bucket || !objectPath) return null;
    if (expectedBucket && bucket !== expectedBucket) return null;
    return { bucket, objectPath };
  } catch (_) {
    return null;
  }
}

function candidateFaceStorageObjects(cadet) {
  const urls = [
    cadet?.faceImages?.front,
    cadet?.faceImages?.left,
    cadet?.faceImages?.right,
    cadet?.photoUrl
  ];
  const seen = new Set();
  return urls
    .map(url => extractSupabaseStorageObject(url, 'face-images'))
    .filter(object => {
      if (!object) return false;
      const key = `${object.bucket}/${object.objectPath}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function deleteCadetFaceImagesFromStorage(cadet) {
  const objects = candidateFaceStorageObjects(cadet);
  const deleted = [];
  for (const object of objects) {
    const result = await deleteObject(object.bucket, object.objectPath);
    deleted.push({
      bucket: object.bucket,
      path: object.objectPath,
      success: result?.success !== false
    });
  }
  return { attempted: objects.length, deleted };
}

async function validateEnrollmentCapture(frontPhoto) {
  const validation = await validateFaceFrame(frontPhoto);
  if (!validation || !validation.success || !validation.faceImage) {
    const error = new Error((validation && validation.message) || 'Front-face validation failed');
    error.statusCode = 400;
    error.validation = validation && validation.checks ? validation.checks : null;
    throw error;
  }
  return validation;
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice('Bearer '.length).trim();
    if (bearer) return bearer;
  }
  const cookieHeader = String(req.headers.cookie || '');
  const cookie = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith('shoreleave_session='));
  return cookie ? decodeURIComponent(cookie.slice('shoreleave_session='.length)) : null;
}

function setAuthCookie(res, token, maxAgeMs) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `shoreleave_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`);
}

function clearAuthCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `shoreleave_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

async function requireOfficer(req, res, next) {
  if (req.officer) return next();
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Administrator authentication required' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!['admin', 'duty_officer', 'officer'].includes(payload.role)) {
      return res.status(403).json({ error: 'Administrator role required' });
    }

    const officer = await Officer.findOne({ username: payload.username, isActive: true });
    if (!officer) {
      return res.status(401).json({ error: 'Administrator account inactive or not found' });
    }
    if (!isSessionWithinActivityWindow(officer.lastLoginAt)) {
      return res.status(401).json({ error: 'Administrator session inactive. Please log in again.' });
    }

    officer.lastLoginAt = new Date();
    await officer.save();
    req.officer = { username: officer.username, role: officer.role, sessionId: payload.sessionId };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired administrator session' });
  }
}

function requireAdmin(req, res, next) {
  const role = req.officer?.role || req.user?.role;
  if (role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin role required.' });
  }
  next();
}

const fingerprintRuntime = createFingerprintRuntime({
  requireOfficer,
  requireAdmin,
  Cadet,
  AuditLog,
  io,
  onVerified: ({ cadetId, direction, actor, ipAddress, terminal, score, threshold }) =>
    gateDecisionService.processVerifiedIdentity(cadetId, direction, {
      method: 'FINGERPRINT',
      actor,
      ipAddress,
      terminal,
      score,
      threshold
    }),
  logger: {
    info: logInfo,
    warn: logWarn,
    error: logError
  }
});

app.use('/api/fingerprint', fingerprintRuntime.fingerprintRouter);
app.use('/api/biometric', fingerprintRuntime.biometricRouter);

async function currentSupabaseHealth() {
  const now = Date.now();
  if (now - supabaseHealthCache.checkedAt < 15000) return supabaseHealthCache.online;
  const result = await verifyConnection();
  supabaseHealthCache = { checkedAt: now, online: result.online };
  return result.online;
}

app.get('/api/device/status', requireOfficer, asyncHandler(async (req, res) => {
  const [supabaseOnline, device] = await Promise.all([
    currentSupabaseHealth(),
    DeviceConfig.findOne({ deviceId: process.env.NFC_DEVICE_ID || 'gate-1' }).lean()
  ]);
  const nfc = nfcService.getReaderStatus();
  res.json({
    mongodb: mongoose.connection.readyState === 1 ? 'online' : 'offline',
    supabase: supabaseOnline ? 'online' : 'offline',
    nfc: device?.enabled !== false && nfc.readerConnected ? 'online' : 'offline',
    face: faceServiceOnline ? 'online' : 'offline',
    camera: faceServiceOnline ? 'online' : 'offline',
    device: device || null,
    reader: nfc,
    checkedAt: new Date().toISOString()
  });
}));

app.get('/api/device/config', requireOfficer, asyncHandler(async (req, res) => {
  const config = await DeviceConfig.findOne({ deviceId: process.env.NFC_DEVICE_ID || 'gate-1' }).lean();
  res.json(config);
}));

app.put('/api/device/config', requireOfficer, asyncHandler(async (req, res) => {
  if (req.officer.role !== 'admin') return res.status(403).json({ error: 'Super administrator role required.' });
  const allowedModes = ['REGISTRATION', 'ATTENDANCE', 'GATE_ENTRY', 'VERIFICATION'];
  const update = {};
  for (const key of ['deviceName', 'reader', 'location']) {
    if (typeof req.body?.[key] === 'string' && req.body[key].trim()) update[key] = req.body[key].trim();
  }
  if (typeof req.body?.enabled === 'boolean') update.enabled = req.body.enabled;
  if (req.body?.mode) {
    const mode = String(req.body.mode).toUpperCase();
    if (!allowedModes.includes(mode)) return res.status(400).json({ error: 'Invalid NFC device mode.' });
    update.mode = mode;
    nfcService.setMode(mode);
  }
  update.updatedBy = req.officer.username;
  activeDeviceConfig = await DeviceConfig.findOneAndUpdate(
    { deviceId: process.env.NFC_DEVICE_ID || 'gate-1' },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  io.to('admin').emit('device:config', activeDeviceConfig);
  res.json(activeDeviceConfig);
}));

// â”€â”€â”€ MIDDLEWARE â”€â”€â”€
const authenticateJWT = asyncHandler(async (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let user;
  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  if (['admin', 'duty_officer', 'officer'].includes(user.role)) {
    const officer = await Officer.findOne({ username: user.username, isActive: true });
    if (!officer) {
      return res.status(401).json({ error: 'Administrator account inactive or not found' });
    }
    if (!isSessionWithinActivityWindow(officer.lastLoginAt)) {
      return res.status(401).json({ error: 'Administrator session inactive. Please log in again.' });
    }

    officer.lastLoginAt = new Date();
    await officer.save();
    req.officer = { username: officer.username, role: officer.role, sessionId: user.sessionId };
    req.user = user;
    return next();
  }

  if (user.role === 'cadet_pending_face' || user.role === 'cadet') {
    const cadet = await Cadet.findOne({ roll: user.roll });
    if (!cadet || cadet.activeSessionId !== user.sessionId) {
      return res.status(401).json({ error: 'Cadet session expired or replaced' });
    }
    if (!isSessionWithinActivityWindow(cadet.lastLoginAt)) {
      return res.status(401).json({ error: 'Cadet session inactive. Please log in again.' });
    }

    cadet.lastLoginAt = new Date();
    await cadet.save();
    req.cadet = cadet;
    req.user = user;
    return next();
  }

  return res.status(403).json({ error: 'Unauthorized role' });
});

// â”€â”€â”€ AUTHENTICATION APIs â”€â”€â”€

app.get('/api/notifications/config', (req, res) => {
  res.json({
    enabled: !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY),
    publicKey: VAPID_PUBLIC_KEY
  });
});

function notificationAccessQuery(req) {
  if (req.cadet) return { recipientRoll: req.cadet.roll, userRole: { $in: ['cadet', 'all'] } };
  if (req.officer) {
    return {
      $or: [
        { userRole: { $in: ['admin', 'officer', 'duty_officer', 'all'] } },
        { recipientUsername: req.officer.username }
      ]
    };
  }
  return { _id: null };
}

app.get(['/api/notifications', '/api/notifications/history'], authenticateJWT, asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const query = {
    ...notificationAccessQuery(req),
    deletedAt: { $exists: false },
    archived: req.path.endsWith('/history') || req.query.archived === 'true'
  };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (!Number.isNaN(before.getTime())) query.createdAt = { $lt: before };
  }
  const notifications = await Notification.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  const unread = await Notification.countDocuments({ ...notificationAccessQuery(req), deletedAt: { $exists: false }, archived: false, read: false });
  res.json({ success: true, notifications: notifications.map(publicNotificationRecord), unread, hasMore: notifications.length === limit });
}));

app.patch('/api/notifications/:id/read', authenticateJWT, asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { notificationId: req.params.id, ...notificationAccessQuery(req), deletedAt: { $exists: false } },
    { $set: { read: true, readAt: new Date() } },
    { new: true }
  ).lean();
  if (!notification) return res.status(404).json({ success: false, error: 'Notification not found' });
  res.json({ success: true, notification: publicNotificationRecord(notification) });
}));

app.post('/api/notifications/mark-all-read', authenticateJWT, asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { ...notificationAccessQuery(req), deletedAt: { $exists: false }, archived: false, read: false },
    { $set: { read: true, readAt: new Date() } }
  );
  res.json({ success: true, updated: result.modifiedCount || 0 });
}));

app.patch('/api/notifications/:id/archive', authenticateJWT, asyncHandler(async (req, res) => {
  const archived = req.body?.archived !== false;
  const notification = await Notification.findOneAndUpdate(
    { notificationId: req.params.id, ...notificationAccessQuery(req), deletedAt: { $exists: false } },
    { $set: { archived, archivedAt: archived ? new Date() : null } },
    { new: true }
  ).lean();
  if (!notification) return res.status(404).json({ success: false, error: 'Notification not found' });
  res.json({ success: true, notification: publicNotificationRecord(notification) });
}));

app.delete('/api/notifications/:id', authenticateJWT, asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { notificationId: req.params.id, ...notificationAccessQuery(req), deletedAt: { $exists: false } },
    { $set: { deletedAt: new Date(), archived: true, archivedAt: new Date() } },
    { new: true }
  ).lean();
  if (!notification) return res.status(404).json({ success: false, error: 'Notification not found' });
  res.json({ success: true });
}));

app.post('/api/notifications/subscribe', authenticateJWT, asyncHandler(async (req, res) => {
  if (!req.cadet) return res.status(403).json({ error: 'Cadet login required for notification subscription.' });
  const { subscription } = req.body || {};
  if (!subscription || typeof subscription !== 'object' || typeof subscription.endpoint !== 'string' || !subscription.endpoint.trim()) {
    return res.status(400).json({ error: 'Valid push subscription is required.' });
  }
  if (!subscription.keys || typeof subscription.keys.p256dh !== 'string' || typeof subscription.keys.auth !== 'string') {
    return res.status(400).json({ error: 'Push subscription keys are required.' });
  }

  await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      roll: req.cadet.roll,
      endpoint: subscription.endpoint,
      subscription,
      isActive: true,
      updatedAt: new Date()
    },
    { upsert: true, new: true }
  );

  res.json({ success: true });
}));

app.post('/api/notifications/send', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const { cadetId, roll, title, body, url } = req.body || {};
  const targetRoll = normalizeRoll(roll || cadetId || '');
  if (!targetRoll) return res.status(400).json({ error: 'cadetId or roll is required.' });
  const result = await sendPushToCadet(targetRoll, {
    title: title || 'Shore Leave',
    body: body || 'You have a Shore Leave update.',
    url: url || '/cadet-dashboard.html'
  });
  res.json({ success: true, ...result });
}));
// Administrator Login
app.post('/api/auth/officer/login', loginRateLimit, asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const normalizedUsername = String(username || '').trim();
  let officer = await Officer.findOne({
    isActive: true,
    $or: [
      { username: normalizedUsername },
      { adminNumber: normalizedUsername.toUpperCase() },
      { email: normalizedUsername.toLowerCase() }
    ]
  });
  if (!officer && ['administrator', 'admin@123'].includes(normalizedUsername.toLowerCase())) {
    officer =
      await Officer.findOne({ username: 'admin@123', isActive: true }) ||
      await Officer.findOne({ username: 'administrator', isActive: true }) ||
      await Officer.findOne({ username: 'duty_officer', isActive: true });
  }
  if (officer && await bcrypt.compare(password, officer.passwordHash)) {
    const sessionId = crypto.randomBytes(16).toString('hex');
    const role = officer.role || 'duty_officer';
    officer.activeSessionId = sessionId;
    officer.lastLoginAt = new Date();
    await officer.save();
    const token = signOfficerToken({ username: officer.username, role }, sessionId);
    await AuditLog.create({ action: 'ADMINISTRATOR_LOGIN', details: { username: officer.username } });
    setAuthCookie(res, token, 12 * 60 * 60 * 1000);
    res.json({ token, role });
  } else {
    await AuditLog.create({ action: 'ADMINISTRATOR_LOGIN_FAILED', details: { username: normalizedUsername } });
    res.status(401).json({ error: 'Invalid credentials' });
  }
}));

app.post('/api/auth/refresh', asyncHandler(async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Session refresh token missing' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
  } catch (error) {
    return res.status(401).json({ error: 'Session refresh failed' });
  }

  if (['admin', 'duty_officer', 'officer'].includes(payload.role)) {
    const officer = await Officer.findOne({ username: payload.username, isActive: true });
    if (!officer) {
      return res.status(401).json({ error: 'Administrator account inactive or not found' });
    }
    if (!isSessionWithinActivityWindow(officer.lastLoginAt)) {
      return res.status(401).json({ error: 'Administrator session inactive. Please log in again.' });
    }

    officer.lastLoginAt = new Date();
    await officer.save();
    const nextToken = signOfficerToken(officer, payload.sessionId);
    setAuthCookie(res, nextToken, 12 * 60 * 60 * 1000);
    return res.json({ token: nextToken, role: officer.role });
  }

  if (payload.role === 'cadet_pending_face' || payload.role === 'cadet') {
    const cadet = await Cadet.findOne({ roll: payload.roll });
    if (!cadet || cadet.activeSessionId !== payload.sessionId) {
      return res.status(401).json({ error: 'Cadet session expired or replaced' });
    }
    if (!isSessionWithinActivityWindow(cadet.lastLoginAt)) {
      return res.status(401).json({ error: 'Cadet session inactive. Please log in again.' });
    }

    cadet.lastLoginAt = new Date();
    await cadet.save();
    const nextToken = payload.role === 'cadet_pending_face'
      ? signCadetPendingFaceToken(cadet.roll, payload.sessionId)
      : signCadetToken(cadet, payload.sessionId);

    setAuthCookie(res, nextToken, payload.role === 'cadet' ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000);
    return res.json({ token: nextToken, role: payload.role });
  }

  return res.status(403).json({ error: 'Unsupported session role' });
}));

app.get('/api/auth/me', authenticateJWT, asyncHandler(async (req, res) => {
  if (req.officer) {
    const officer = await Officer.findOne({ username: req.officer.username, isActive: true }).lean();
    if (!officer) {
      return res.status(401).json({ success: false, error: 'Administrator account inactive or not found' });
    }
    return res.json({
      success: true,
      authenticated: true,
      role: officer.role || req.officer.role,
      user: buildOfficerDto(officer),
      officer: buildOfficerDto(officer)
    });
  }

  if (req.cadet) {
    return res.json({
      success: true,
      authenticated: true,
      role: 'cadet',
      user: buildCadetDto(req.cadet),
      cadet: buildCadetDto(req.cadet)
    });
  }

  return res.status(401).json({ success: false, error: 'Authenticated user not found' });
}));

app.post('/api/auth/logout', authenticateJWT, asyncHandler(async (req, res) => {
  if (req.officer) await Officer.updateOne({ username: req.officer.username }, { $unset: { activeSessionId: 1 } });
  if (req.cadet) await Cadet.updateOne({ roll: req.cadet.roll }, { $unset: { activeSessionId: 1, deviceFingerprint: 1 } });
  clearAuthCookie(res);
  res.json({ success: true });
}));

function storageReferenceFromUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
    return match ? { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) } : null;
  } catch {
    return null;
  }
}

function collectStorageReferences(value, output = new Map()) {
  if (!value) return output;
  if (typeof value === 'string') {
    const parsed = storageReferenceFromUrl(value);
    if (parsed) output.set(`${parsed.bucket}:${parsed.path}`, parsed);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStorageReferences(item, output);
    return output;
  }
  if (typeof value !== 'object') return output;
  const bucket = value.bucket;
  const objectPath = value.path || value.storagePath || value.objectPath;
  if (bucket && objectPath) output.set(`${bucket}:${objectPath}`, { bucket, path: objectPath });
  for (const item of Object.values(value)) collectStorageReferences(item, output);
  return output;
}

app.delete('/api/auth/account', authenticateJWT, asyncHandler(async (req, res) => {
  if (!req.cadet || req.user?.role !== 'cadet') {
    return res.status(403).json({ success: false, error: 'Cadet account required' });
  }

  const roll = normalizeRoll(req.cadet.roll);
  if (normalizeRoll(req.body?.confirmRoll) !== roll) {
    return res.status(400).json({ success: false, error: 'Enter your roll number to confirm account deletion' });
  }

  const cadet = await Cadet.findOne({ roll });
  if (!cadet) return res.status(404).json({ success: false, error: 'Cadet account not found' });

  const leaveRecords = await LeaveRecord.find({ roll }).lean();
  const storageReferences = collectStorageReferences(cadet.toObject());
  collectStorageReferences(leaveRecords, storageReferences);
  const storageFailures = [];
  for (const reference of storageReferences.values()) {
    try {
      await deleteObject(reference.bucket, reference.path);
    } catch (error) {
      storageFailures.push({ bucket: reference.bucket, pathHash: crypto.createHash('sha256').update(reference.path).digest('hex').slice(0, 12) });
      logError('[PRIVACY] Object deletion failed', { bucket: reference.bucket, error });
    }
  }
  if (storageFailures.length) {
    return res.status(503).json({
      success: false,
      error: 'Account deletion is temporarily unavailable because personal files could not be removed. Please retry.',
      failedObjects: storageFailures.length
    });
  }

  const anonymousId = `deleted:${crypto.createHash('sha256').update(`${cadet._id}:${roll}:${process.env.JWT_SECRET}`).digest('hex').slice(0, 20)}`;
  const now = new Date();
  const gateHistoryIdentityClauses = [{ cadetId: String(cadet._id) }];
  if (cadet.nfc?.uid) gateHistoryIdentityClauses.push({ uid: cadet.nfc.uid });
  await Promise.all([
    OTP.deleteMany({ roll }),
    GateOTP.deleteMany({ roll }),
    PushSubscription.deleteMany({ roll }),
    Notification.deleteMany({ recipientRoll: roll }),
    FailedEmail.deleteMany({ to: normalizeEmail(cadet.email) }),
    ChatbotLog.deleteMany({ sessionId: { $in: [roll, cadet.activeSessionId].filter(Boolean) } }),
    CadetXpLog.deleteMany({ roll }),
    FingerprintTemplate.deleteMany({ $or: [{ cadetId: cadet._id }, { roll }] }),
    NFCTag.deleteMany({ $or: [{ cadetId: String(cadet._id) }, { rollNumber: roll }] }),
    LeaveRecord.updateMany({ roll }, {
      $set: { roll: anonymousId, name: 'Deleted Cadet', leaveReason: '[REDACTED]' },
      $unset: {
        email: 1, studentId: 1, dest: 1, locationAddress: 1,
        checkOutLat: 1, checkOutLng: 1, checkInLat: 1, checkInLng: 1,
        checkOutPhotoUrl: 1, checkInPhotoUrl: 1, leaveDocumentUrl: 1,
        supportingDocument: 1, gatePassPdfUrl: 1, gatePassUrl: 1, pdfUrl: 1,
        gatePass: 1, passVerificationToken: 1, emergencyVerificationCode: 1
      }
    }),
    GateHistory.updateMany({ $or: gateHistoryIdentityClauses }, {
      $set: { cadetId: anonymousId, cadetName: 'Deleted Cadet', uid: '[REDACTED]', metadata: {} }
    }),
    AuditLog.updateMany({ roll }, { $set: { roll: anonymousId, details: { anonymized: true } } })
  ]);

  await Cadet.deleteOne({ _id: cadet._id });
  await AuditLog.create({ action: 'ACCOUNT_DELETED', roll: anonymousId, details: { anonymized: true, deletedAt: now } });
  clearAuthCookie(res);
  res.json({ success: true, message: 'Your personal account data has been deleted or anonymized.' });
}));

async function sendLocalOtp(email, roll) {
  const otp = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
  const sessionToken = crypto.randomUUID();
  const otpHash = await bcrypt.hash(otp, 12);

  const existing = await OTP.findOne({ roll, verified: false }).sort({ lastSentAt: -1 });
  if (existing?.lastSentAt && Date.now() - existing.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    const remaining = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - existing.lastSentAt.getTime())) / 1000);
    const error = new Error(`Please wait ${remaining}s before requesting a new OTP.`);
    error.status = 429;
    throw error;
  }

  await OTP.deleteMany({ roll, verified: false });
  await OTP.findOneAndUpdate(
    { sessionToken },
    {
      roll,
      email,
      encryptedOTP: encryptOTP(otp),
      otpHash,
      expiresAt,
      attempts: 0,
      maxAttempts: MAX_OTP_ATTEMPTS,
      sessionToken,
      lastSentAt: new Date(),
      verified: false
    },
    { upsert: true, new: true }
  );

  if (!transporter) {
    if (process.env.NODE_ENV === 'test' && process.env.ALLOW_TEST_OTP_RESPONSE === 'true') {
      return { sessionToken, expiresIn: 60, resendCooldown: 30, devOtp: otp, deliveryMode: 'test' };
    }
    await OTP.deleteOne({ sessionToken });
    const error = new Error('Email delivery is not configured. Please contact the administrator.');
    error.status = 503;
    throw error;
  }

  const emailResult = await sendSystemEmail({
    to: email,
    subject: 'AMET IST Shore Leave Management System - Cadet Login Verification',
    text:
      `AMET IST\n` +
      `Shore Leave Management System\n\n` +
      `Cadet Login Verification\n\n` +
      `Dear Cadet,\n\n` +
      `A secure login request has been received for your AMET IST Shore Leave Management System account.\n\n` +
      `Your One-Time Password (OTP) is:\n\n` +
      `${otp}\n\n` +
      `This OTP is valid for 60 seconds and can only be used once.\n\n` +
      `Security Instructions:\n` +
      `- Never share this OTP with anyone.\n` +
      `- AMET IST or TEAM findiT will never ask for your OTP.\n` +
      `- If you did not request this login, please ignore this email and contact the system administrator immediately.\n\n` +
      `Regards,\n\n` +
      `AMET IST\n` +
      `Shore Leave Management System\n` +
      `TEAM findiT\n\n` +
      `This is an automatically generated email. Please do not reply.\n\n` +
      `© 2026 AMET IST. All Rights Reserved.`,
    html:
      `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:640px;margin:0 auto;padding:24px;">` +
      `<h2 style="margin:0 0 4px;">AMET IST</h2>` +
      `<div style="font-size:16px;margin-bottom:24px;">Shore Leave Management System</div>` +
      `<h3 style="margin:0 0 16px;">Cadet Login Verification</h3>` +
      `<p>Dear Cadet,</p>` +
      `<p>A secure login request has been received for your AMET IST Shore Leave Management System account.</p>` +
      `<p>Your One-Time Password (OTP) is:</p>` +
      `<div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center;margin:18px 0;">${otp}</div>` +
      `<p>This OTP is valid for <strong>60 seconds</strong> and can only be used once.</p>` +
      `<p><strong>Security Instructions:</strong></p>` +
      `<ul>` +
      `<li>Never share this OTP with anyone.</li>` +
      `<li>AMET IST or TEAM findiT will never ask for your OTP.</li>` +
      `<li>If you did not request this login, please ignore this email and contact the system administrator immediately.</li>` +
      `</ul>` +
      `<p>Regards,<br>AMET IST<br>Shore Leave Management System<br>TEAM findiT</p>` +
      `<p style="font-size:12px;color:#64748b;">This is an automatically generated email. Please do not reply.</p>` +
      `<p style="font-size:12px;color:#64748b;">© 2026 AMET IST. All Rights Reserved.</p>` +
      `</div>`
  });
  return {
    sessionToken,
    expiresIn: 60,
    resendCooldown: 30,
    deliveryMode: emailResult.deliveryMode,
    ...(emailResult.deliveryMode === 'failed_queued' ? { message: 'OTP generated. Email delivery is queued for retry.' } : {})
  };
}

async function sendRejectionEmail(cadet, leaveRequest, rejectionReason, reviewer) {
  const leaveWindow = resolveLeaveWindow(leaveRequest);
  const subject = 'Leave Request Update â€” Shore Leave System';
  const text =
    `Dear ${cadet.name || cadet.roll},\n\n` +
    `Status: REJECTED\n` +
    `Leave Type: ${leaveRequest.leaveType}\n` +
    `Leave Dates: ${formatDate(leaveWindow.fromDate)} to ${formatDate(leaveWindow.toDate)}\n` +
    `Reviewed By: ${reviewer}\n\n` +
    `Rejection Reason: ${rejectionReason}\n\n` +
    `Contact your HOD for further clarification`;

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:24px;color:#10214d;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
        <div style="padding:22px 24px;background:#fee2e2;color:#991b1b;">
          <div style="font-size:13px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">Leave Request Update</div>
          <div style="margin-top:8px;font-size:26px;font-weight:800;">Request Rejected</div>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">Dear ${cadet.name || cadet.roll}, your ${leaveRequest.leaveType} request has been reviewed by the Administrator.</p>
          <div style="padding:16px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;margin-bottom:14px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#475569;">Status</div>
            <div style="margin-top:8px;font-size:18px;font-weight:800;color:#991b1b;">REJECTED</div>
            <div style="margin-top:8px;font-size:14px;color:#334155;">Leave Dates: ${formatDate(leaveWindow.fromDate)} to ${formatDate(leaveWindow.toDate)}</div>
          </div>
          <div style="padding:16px;border-radius:14px;background:#fff7ed;border:1px solid #fdba74;">
            <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9a3412;">Reason for rejection</div>
            <div style="margin-top:8px;font-size:15px;color:#7c2d12;">${rejectionReason}</div>
          </div>
          <p style="margin:16px 0 0;font-size:13px;color:#64748b;">Contact your HOD for further clarification</p>
        </div>
      </div>
    </div>`;

  return sendSystemEmail({
    to: cadet.email,
    subject,
    text,
    html
  });
}

async function sendLeaveSubmittedEmail(req, cadet, leaveRequest) {
  const leaveWindow = resolveLeaveWindow(leaveRequest);
  const dashboardUrl = buildCadetDashboardUrl(req);
  const subject = 'Leave Request Received - Shore Leave System';
  const text =
    `Dear ${cadet.name || cadet.roll},\n\n` +
    `Your leave request is received and is now pending HOD approval.\n` +
    `Leave Type: ${leaveRequest.leaveType}\n` +
    `Leave Dates: ${formatDate(leaveWindow.fromDate)} to ${formatDate(leaveWindow.toDate)}\n\n` +
    `You will receive an email when approved.\n` +
    `Track Status: ${dashboardUrl}`;

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:24px;color:#10214d;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
        <div style="padding:22px 24px;background:#fef3c7;color:#92400e;">
          <div style="font-size:13px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">Leave Request Received</div>
          <div style="margin-top:8px;font-size:26px;font-weight:800;">Pending HOD Approval</div>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 14px;font-size:15px;line-height:1.65;">Dear ${cadet.name || cadet.roll}, your leave request has been received.</p>
          <div style="padding:16px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;margin-bottom:14px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#475569;">Current Status</div>
            <div style="margin-top:8px;font-size:18px;font-weight:800;color:#92400e;">PENDING</div>
            <div style="margin-top:8px;font-size:14px;color:#334155;">${leaveRequest.leaveType} - ${formatDate(leaveWindow.fromDate)} to ${formatDate(leaveWindow.toDate)}</div>
          </div>
          <p style="margin:0 0 18px;font-size:13px;color:#64748b;">You will receive an email when approved.</p>
          <a href="${dashboardUrl}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#0f172a;color:#fff;text-decoration:none;font-weight:800;font-size:13px;">Open My Dashboard</a>
        </div>
      </div>
    </div>`;

  return sendSystemEmail({ to: cadet.email, subject, text, html });
}

async function sendWelcomeBackEmail(cadet, leaveRecord) {
  const subject = 'Welcome Back to Campus';
  const text =
    `Dear ${cadet.name || cadet.roll},\n\n` +
    `Welcome back to campus.\n` +
    `Your shore leave has been checked in successfully at ${leaveRecord.checkInTime || nowTime()}.\n\n` +
    `Status: ${leaveRecord.status === 'late_return' ? 'Late Return Recorded' : 'Checked In'}`;

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:24px;color:#10214d;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
        <div style="padding:22px 24px;background:#dcfce7;color:#166534;">
          <div style="font-size:13px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">Shore Leave In</div>
          <div style="margin-top:8px;font-size:26px;font-weight:800;">Welcome back to campus</div>
        </div>
        <div style="padding:24px;">
          <p style="margin:0;font-size:15px;line-height:1.65;">Dear ${cadet.name || cadet.roll}, your return has been recorded successfully.</p>
          <div style="margin-top:14px;padding:16px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
            <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#475569;">Check-in time</div>
            <div style="margin-top:8px;font-size:18px;font-weight:800;color:#166534;">${leaveRecord.checkInTime || nowTime()}</div>
          </div>
        </div>
      </div>
    </div>`;

  return sendSystemEmail({ to: cadet.email, subject, text, html });
}

async function sendShoreLeaveApprovedEmail(req, cadet, leaveRecord) {
  const gatePassUrl = buildGatePassUrl(req, leaveRecord.passId, leaveRecord.emergencyVerificationCode || leaveRecord.passVerificationToken);
  const assets = await createGatePassAssets({
    passId: leaveRecord.passId,
    emergencyVerificationCode: leaveRecord.emergencyVerificationCode,
    name: cadet.name || cadet.roll,
    roll: cadet.roll,
    studentId: cadet.studentId,
    rank: cadet.rank || 'CADET',
    idNo: cadet.idNo || cadet.studentId || cadet.roll,
    batch: cadet.batch,
    course: cadet.course,
    leaveType: 'Shore Leave',
    reason: leaveRecord.leaveReason,
    fromDate: leaveRecord.fromDate,
    toDate: leaveRecord.toDate,
    generatedAt: leaveRecord.passIssuedAt || new Date(),
    issuedBy: 'Auto Approved',
    gatePassUrl,
    passStatusText: 'ACTIVE UNTIL 18:00 HRS'
  });
  applyGatePassAssetMetadata(leaveRecord, assets);
  await leaveRecord.save();

  const text =
    `Cadet name: ${cadet.name || cadet.roll}\n` +
    `ID: ${cadet.studentId || cadet.roll}\n` +
    `Date: ${formatDate(leaveRecord.fromDate)}\n` +
    `Destination: ${leaveRecord.dest || '-'}\n` +
    `Time Out: ${leaveRecord.checkOutTime || '-'}\n` +
    `Time In: 18:00 HRS\n` +
    `Pass Number: ${leaveRecord.passId}\n\n` +
    `Safe Journey âœˆ\n\n` +
    `Download Gate Pass PDF: ${assets.gatePassPdfSignedUrl || assets.gatePassPdfUrl}`;

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
      <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
        <div style="padding:22px 24px;background:#0f172a;color:#fff;">
          <div style="font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">Shore Leave Approved</div>
          <div style="margin-top:8px;font-size:26px;font-weight:900;">Safe Journey âœˆ</div>
        </div>
        <div style="padding:24px;">
          <p><strong>Cadet:</strong> ${escapeEmailHtml(cadet.name || cadet.roll)}</p>
          <p><strong>ID:</strong> ${escapeEmailHtml(cadet.studentId || cadet.roll)}</p>
          <p><strong>Date:</strong> ${escapeEmailHtml(formatDate(leaveRecord.fromDate))}</p>
          <p><strong>Destination:</strong> ${escapeEmailHtml(leaveRecord.dest || '-')}</p>
          <p><strong>Time Out:</strong> ${escapeEmailHtml(leaveRecord.checkOutTime || '-')}</p>
          <p><strong>Time In:</strong> 18:00 HRS</p>
          <p><strong>Pass Number:</strong> ${escapeEmailHtml(leaveRecord.passId)}</p>
          <div style="padding:18px;border-radius:16px;background:#fff7ed;border:1px solid #fed7aa;">
            <p style="margin:0;font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#9a3412;">Emergency Verification Code</p>
            <p style="margin:8px 0 0;font-size:22px;font-weight:900;color:#0f172a;">${escapeEmailHtml(leaveRecord.emergencyVerificationCode || '-')}</p>
            <p style="margin:8px 0 0;font-size:13px;color:#475569;">For authorized gate officer use only if fingerprint and face verification are unavailable.</p>
          </div>
          <div style="margin-top:18px;text-align:center;"><a href="${assets.gatePassPdfSignedUrl || assets.gatePassPdfUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#0f172a;color:#fff;text-decoration:none;font-weight:700;">Download Gate Pass PDF</a></div>
          <div style="margin-top:20px;text-align:center;font-size:18px;font-weight:900;">Safe Journey âœˆ</div>
        </div>
      </div>
    </div>`;

  const emailResult = await sendSystemEmail({
    to: cadet.email,
    subject: 'Shore Leave Approved â€” Safe Journey âœˆ',
    text,
    html,
    attachments: buildGatePassEmailAttachments(assets, leaveRecord.passId)
  });

  return { emailResult, gatePassUrl, gatePassPdfUrl: assets.gatePassPdfUrl };
}

async function sendOverdueAlertEmail(cadet, leaveEndDate) {
  if (!cadet?.email) return { deliveryMode: 'skipped' };
  const expiryText = formatDate(leaveEndDate);
  return sendSystemEmail({
    to: cadet.email,
    subject: 'Urgent: Shore Leave Overdue',
    text:
      `Dear ${cadet.name || cadet.roll},\n\n` +
      `Your leave expired on ${expiryText}.\n` +
      `Please report to campus immediately.\n\n` +
      `AMET Shore Leave System`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#fef2f2;padding:24px;color:#7f1d1d;">
        <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #fecaca;border-radius:18px;padding:24px;">
          <div style="font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">Shore Leave Overdue</div>
          <h2 style="margin:8px 0 12px;font-size:26px;">Please report to campus immediately</h2>
          <p style="margin:0;font-size:15px;line-height:1.6;">Dear ${escapeEmailHtml(cadet.name || cadet.roll)}, your leave expired on <strong>${escapeEmailHtml(expiryText)}</strong>.</p>
        </div>
      </div>`
  });
}

function applyGatePassAssetMetadata(target, assets) {
  target.gatePassPdfUrl = assets.gatePassPdfUrl;
  target.gatePass = assets.gatePass;
  target.storageStatus = 'uploaded';
  target.storageUploadedAt = new Date();
}

function buildGatePassEmailAttachments(assets, passId) {
  const safePassId = String(passId || 'gate-pass').replace(/[^\w-]+/g, '-');
  return [
    {
      filename: `gate-pass-${safePassId}.pdf`,
      content: assets.pdfBuffer,
      contentType: 'application/pdf'
    }
  ];
}

async function sendGatePassEmail(req, cadet, leaveRequest, { beforeSend } = {}) {
  const leaveWindow = resolveLeaveWindow(leaveRequest);
  const gatePassUrl = buildGatePassUrl(req, leaveRequest.passId, leaveRequest.emergencyVerificationCode || leaveRequest.passVerificationToken);
  const safePassId = String(leaveRequest.passId || 'gate-pass').replace(/[^\w-]+/g, '-');
  const assets = await createGatePassAssets({
    passId: leaveRequest.passId,
    emergencyVerificationCode: leaveRequest.emergencyVerificationCode,
    name: cadet.name || cadet.roll,
    roll: cadet.roll,
    studentId: cadet.studentId,
    rank: cadet.rank || 'CADET',
    idNo: cadet.idNo || cadet.studentId || cadet.roll,
    batch: cadet.batch,
    course: cadet.course,
    leaveType: leaveRequest.leaveType,
    reason: leaveRequest.reason,
    fromDate: leaveWindow.fromDate,
    toDate: leaveWindow.toDate,
    returnDate: leaveWindow.returnDate,
    generatedAt: leaveRequest.approvedAt || new Date(),
    issuedBy: leaveRequest.reviewedBy || 'Administrator',
    gatePassUrl,
    passStatusText: 'ACTIVE'
  });
  applyGatePassAssetMetadata(leaveRequest, assets);
  if (beforeSend) await beforeSend({ assets, gatePassUrl });

  const subject = 'Gate Pass Approved \u2014 Safe Journey \u2708';
  const text =
    `Dear ${cadet.name || cadet.roll},\n\n` +
    `Your gate pass has been approved.\n` +
    `Cadet Name: ${cadet.name || cadet.roll}\n` +
    `Rank: ${cadet.rank || 'CADET'}\n` +
    `ID: ${cadet.idNo || cadet.studentId || cadet.roll}\n` +
    `Pass Number: ${leaveRequest.passId}\n` +
    `Emergency Verification Code: ${leaveRequest.emergencyVerificationCode || '-'}\n` +
    `Leave Type: ${leaveRequest.leaveType}\n` +
    `From: ${formatDate(leaveWindow.fromDate)}\n` +
    `To: ${formatDate(leaveWindow.toDate)}\n\n` +
    `Safe Journey âœˆ\n\n` +
    `Open Gate Pass: ${gatePassUrl}\n` +
    `Download Gate Pass PDF: ${assets.gatePassPdfSignedUrl || assets.gatePassPdfUrl}`;

  const emailResult = await sendSystemEmail({
    to: cadet.email,
    subject,
    text,
    html: assets.gatePassEmailHtml,
    attachments: buildGatePassEmailAttachments(assets, safePassId)
  });

  return {
    gatePassUrl,
    emailResult,
    gatePassPdfUrl: assets.gatePassPdfUrl,
    gatePass: assets.gatePass
  };
}

async function issueGatePassForCheckout(req, cadet, leaveRequest, {
  issuedBy = 'GATE_OFFICER',
  issuedAt = new Date(),
  method = 'GATE_CHECKOUT',
  persist
} = {}) {
  if (!leaveRequest || leaveRequest.approvalStatus !== 'approved') {
    throw new Error('No approved leave is available for gate pass issue.');
  }

  if (!leaveRequest.passId) {
    leaveRequest.passId = await generateUniquePassId();
  }
  if (!leaveRequest.emergencyVerificationCode && !leaveRequest.passVerificationToken) {
    const code = await generateUniqueEmergencyVerificationCode(leaveRequest.passId);
    leaveRequest.emergencyVerificationCode = code;
    leaveRequest.passVerificationToken = code;
  } else {
    const code = leaveRequest.emergencyVerificationCode || leaveRequest.passVerificationToken;
    leaveRequest.emergencyVerificationCode = code;
    leaveRequest.passVerificationToken = code;
  }

  leaveRequest.passIssuedAt = issuedAt;
  leaveRequest.gatePassStatus = 'issued_at_checkout';
  leaveRequest.gatePassIssuedBy = issuedBy;
  leaveRequest.gatePassIssueMethod = method;
  leaveRequest.emergencyCodeGeneratedAt = leaveRequest.emergencyCodeGeneratedAt || issuedAt;
  leaveRequest.emergencyCodeExpiresAt = leaveRequest.emergencyCodeExpiresAt || leaveRequest.toDate;

  const delivery = await sendGatePassEmail(syntheticGatePassRequest(req), cadet, leaveRequest, {
    beforeSend: async ({ assets, gatePassUrl }) => {
      applyGatePassAssetMetadata(leaveRequest, assets);
      leaveRequest.gatePassUrl = gatePassUrl;
      leaveRequest.gatePassEmailSentAt = new Date();
      if (persist) await persist({ assets, gatePassUrl });
    }
  });

  return delivery;
}

async function verifyLocalOtp({ roll, email, otp, sessionToken }) {
  const record = await OTP.findOne({ roll, email, sessionToken, verified: false }).select('+otpHash');
  if (!record) return { success: false, message: 'Please request a new OTP.' };
  if (record.expiresAt < new Date()) {
    await OTP.deleteOne({ _id: record._id });
    return { success: false, message: 'OTP expired. Please request a new one.' };
  }
  if (record.attempts >= record.maxAttempts) {
    await OTP.deleteOne({ _id: record._id });
    return { success: false, message: 'Too many attempts. Please request a new OTP.' };
  }
  const valid = await bcrypt.compare(String(otp).trim(), record.otpHash);
  if (!valid) {
    record.attempts += 1;
    await record.save();
    return { success: false, message: 'Invalid OTP.' };
  }

  record.verified = true;
  await record.save();
  return { success: true };
}

// Request OTP (Cadet)
app.post('/api/auth/cadet/request-otp', otpRateLimit, asyncHandler(async (req, res) => {
  const { roll, email } = req.body;
  const requestedRoll = normalizeRoll(roll);
  const requestedEmail = normalizeEmail(email);
  if (!requestedEmail) return res.status(400).json({ error: 'Email address is required.' });
  if (!isValidEmail(requestedEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });

  const cadet = await Cadet.findOne({ roll: requestedRoll });
  if (!cadet) {
    await AuditLog.create({ action: 'CADET_LOGIN_BLOCKED_RECORD_NOT_FOUND', roll: requestedRoll });
    return res.status(404).json({ error: 'Cadet Record Not Found' });
  }

  if (!cadet.email) {
    return res.status(400).json({ error: 'No email registered for this cadet. Please contact Admin to update your profile.' });
  }
  if (normalizeEmail(cadet.email) !== requestedEmail) {
    await AuditLog.create({ action: 'CADET_LOGIN_BLOCKED_EMAIL_MISMATCH', roll: cadet.roll });
    return emailMismatchResponse(res, cadet.email);
  }
  if (cadet.lockedUntil && cadet.lockedUntil > new Date()) {
    return res.status(423).json({ error: 'Account temporarily locked. Please try again later.' });
  }
  if (cadet.enrollmentStatus !== 'ACTIVE') {
    await AuditLog.create({ action: 'CADET_LOGIN_BLOCKED_INACTIVE', roll: cadet.roll, details: { enrollmentStatus: cadet.enrollmentStatus } });
    return res.status(403).json({ error: 'Cadet account is not active/enrolled.' });
  }

  if (process.env.OTP_SERVICE_URL) {
  try {
    const response = await fetch(`${process.env.OTP_SERVICE_URL}/api/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email', value: requestedEmail })
    });
    
    const result = await response.json();
    
    if (result.success) {
      await AuditLog.create({ action: 'OTP_REQUESTED', roll: cadet.roll });
      res.json({ success: true, message: 'OTP sent to registered email' });
    } else {
      res.status(400).json({ error: result.message || 'Failed to send OTP' });
    }
  } catch (error) {
    logError('OTP service error', error);
    res.status(500).json({ error: 'OTP service is currently unavailable.' });
  }
    return;
  }

  try {
    const otpInfo = await sendLocalOtp(requestedEmail, cadet.roll);
    await AuditLog.create({ action: 'OTP_REQUESTED', roll: cadet.roll });
    res.json({ success: true, message: 'OTP sent to registered email', ...otpInfo });
  } catch (error) {
    logError('[OTP] Delivery failed', error);
    res.status(error.status || 500).json({ error: error.message || 'Could not send OTP. Please try again.' });
  }
}));

// Verify OTP (Cadet)
app.post('/api/auth/cadet/verify-otp', otpRateLimit, asyncHandler(async (req, res) => {
  const { roll, email, otp, sessionToken } = req.body;
  const requestedRoll = normalizeRoll(roll);
  const requestedEmail = normalizeEmail(email);
  if (!requestedEmail) return res.status(400).json({ error: 'Email address missing.' });
  if (!isValidEmail(requestedEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });

  try {
    const cadetForValidation = await Cadet.findOne({ roll: requestedRoll });
    if (!cadetForValidation) return res.status(404).json({ error: 'Cadet Record Not Found' });
    if (normalizeEmail(cadetForValidation.email) !== requestedEmail) return emailMismatchResponse(res, cadetForValidation.email);
    if (cadetForValidation.enrollmentStatus !== 'ACTIVE') return res.status(403).json({ error: 'Cadet account is not active/enrolled.' });

    let result;
    if (process.env.OTP_SERVICE_URL) {
      const extRes = await fetch(`${process.env.OTP_SERVICE_URL}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'email', value: requestedEmail, code: otp })
      });
      const extData = await extRes.json();
      result = { success: extData.success === true || extRes.ok, message: extData.message || extData.error || 'Verification failed' };
    } else {
      result = await verifyLocalOtp({ roll: requestedRoll, email: requestedEmail, otp, sessionToken });
    }
    
    if (result.success) {
      const sessionId = crypto.randomBytes(16).toString('hex');
      await Cadet.findOneAndUpdate(
        { roll: requestedRoll },
        {
          $set: {
            activeSessionId: sessionId,
            loginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: new Date()
          },
          $unset: { deviceFingerprint: 1 }
        }
      );

      // Give a temporary token for face verification step
      const tempToken = signCadetPendingFaceToken(requestedRoll, sessionId);
      setAuthCookie(res, tempToken, 10 * 60 * 1000);
      
      await AuditLog.create({ action: 'OTP_VERIFIED_PENDING_FACE', roll: requestedRoll });
      res.json({ tempToken });
    } else {
      const attempts = (cadetForValidation.loginAttempts || 0) + 1;
      const lockUpdate = attempts >= MAX_LOGIN_ATTEMPTS ? { lockedUntil: new Date(Date.now() + LOGIN_LOCK_MS) } : {};
      await Cadet.updateOne({ roll: requestedRoll }, { loginAttempts: attempts, ...lockUpdate });
      await AuditLog.create({ action: 'OTP_FAILED', roll: requestedRoll });
      res.status(400).json({ error: result.message || 'Invalid OTP' });
    }
  } catch (error) {
    logError('OTP service error', error);
    res.status(500).json({ error: 'OTP service is currently unavailable.' });
  }
}));

app.post('/api/cadets/ping', authenticateJWT, asyncHandler(async (req, res) => {
  if (!req.cadet || req.user?.role !== 'cadet') return res.status(403).json({ error: 'Cadet authentication required.' });
  const { location, lat, lng } = req.body;
  const roll = req.cadet.roll;
  if (!location) return res.status(400).json({ error: 'Location is required.' });
  const latitude = Number(lat);
  const longitude = Number(lng);
  if ((lat != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (lng != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    return res.status(400).json({ error: 'Invalid location coordinates.' });
  }

  const activeRecord = await LeaveRecord.findOne({ roll: roll.toUpperCase(), status: 'out' });
  if (!activeRecord) return res.status(404).json({ error: 'No active shore leave found for this roll number.' });

  activeRecord.locationAddress = location;
  if (Number.isFinite(latitude)) activeRecord.checkInLat = latitude;
  if (Number.isFinite(longitude)) activeRecord.checkInLng = longitude;
  await activeRecord.save();
  await AuditLog.create({ action: 'LIVE_LOCATION_PING', roll: roll.toUpperCase(), details: { updated: true } });

  res.json({ success: true });
}));

// Finalize Login with Face Verification
app.post('/api/auth/cadet/verify-face', authenticateJWT, asyncHandler(async (req, res) => {
  if (req.user.role !== 'cadet_pending_face') return res.status(403).json({ error: 'Invalid token state' });

  const { imageBase64 } = req.body || {};

  const cadet = await Cadet.findOne({ roll: req.user.roll });
  if (!cadet) {
    return res.status(400).json({ error: 'No enrolled face found for this cadet. Please contact Admin.' });
  }

  if (imageBase64) {
    const startedAt = Date.now();
    const enrolledFace = await findFaceEmbeddingForCadet(cadet);
    if (!enrolledFace) {
      const diagnostics = buildFaceVerificationDiagnostics({
        verification: {
          matched: false,
          code: 'NO_ENROLLED_FACE',
          reason: 'no_enrolled_face',
          message: 'No enrolled face embedding was found for this cadet. Please contact Admin.',
          faceDetected: null,
          embeddingGenerated: false
        },
        cadet,
        matchedCadet: false,
        imageBase64,
        durationMs: Date.now() - startedAt
      });
      await AuditLog.create({
        action: 'CADET_LOGIN_FACE_FAILED',
        roll: cadet.roll,
        details: {
          source: 'insightface',
          ...diagnostics
        }
      });
      logWarn('[FaceVerify] Verification rejected', diagnostics);
      const body = buildFaceVerificationFailureResponse(diagnostics, 400);
      delete body.statusCode;
      return res.status(400).json(body);
    }

    let verification;
    try {
      verification = await verifyFaceWithService(imageBase64);
    } catch (error) {
      const serviceResponse = error.serviceResponse || {};
      const diagnostics = buildFaceVerificationDiagnostics({
        verification: {
          matched: false,
          code: serviceResponse.code || 'FACE_SERVICE_ERROR',
          reason: serviceResponse.reason || 'face_service_error',
          message: serviceResponse.message || serviceResponse.error || error.message,
          ...serviceResponse
        },
        cadet,
        matchedCadet: false,
        imageBase64,
        durationMs: Date.now() - startedAt
      });
      await AuditLog.create({
        action: 'CADET_LOGIN_FACE_FAILED',
        roll: cadet.roll,
        details: {
          source: 'insightface',
          statusCode: error.statusCode || 502,
          ...diagnostics
        }
      });
      logWarn('[FaceVerify] Verification unavailable', diagnostics);
      const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 503;
      const body = buildFaceVerificationFailureResponse(diagnostics, statusCode);
      delete body.statusCode;
      return res.status(statusCode).json(body);
    }

    const confidence = formatConfidenceScore(verification.confidence);
    const matchedCadet = verification.matched && matchesCadetFromFaceService(cadet, verification);
    const diagnostics = buildFaceVerificationDiagnostics({
      verification,
      cadet,
      matchedCadet,
      imageBase64,
      durationMs: Date.now() - startedAt
    });

    if (!matchedCadet) {
      await AuditLog.create({
        action: 'CADET_LOGIN_FACE_FAILED',
        roll: cadet.roll,
        details: {
          source: 'insightface',
          ...diagnostics
        }
      });
      logWarn('[FaceVerify] Similarity rejected', diagnostics);
      const body = buildFaceVerificationFailureResponse(diagnostics, 401);
      delete body.statusCode;
      return res.status(401).json(body);
    }

    cadet.lastLoginAt = new Date();
    await cadet.save();
    const token = signCadetToken(cadet, req.user.sessionId);
    setAuthCookie(res, token, 24 * 60 * 60 * 1000);
    await xpService.awardXP(cadet._id, 'PWA_DAILY_LOGIN', 'Daily cadet login').catch(() => {});
    await AuditLog.create({
      action: 'CADET_LOGIN_SUCCESS',
      roll: cadet.roll,
      details: {
        source: 'insightface',
        faceDetected: diagnostics.faceDetected,
        embeddingGenerated: diagnostics.embeddingGenerated,
        durationMs: Date.now() - startedAt
      }
    });
    logInfo('[FaceVerify] Verification succeeded', {
      code: 'FACE_MATCHED',
      durationMs: Date.now() - startedAt
    });
    return res.json({
      token,
      message: 'Face verified successfully',
      matched: true,
      cadetId: verification.cadetId || cadet.studentId || cadet.roll,
      cadetName: verification.cadetName || cadet.name,
      confidence
    });
  }

  const diagnostics = {
    code: 'IMAGE_REQUIRED',
    reason: 'image_required',
    message: 'A captured face image is required for InsightFace verification.',
    matched: false,
    matchedCadet: false,
    faceDetected: false,
    faceCount: 0,
    embeddingGenerated: false,
    detectionScore: null,
    similarity: null,
    confidence: null,
    threshold: null,
    distance: null,
    durationMs: null,
    image: null,
    engine: 'InsightFace',
    acceptedInput: 'imageBase64',
    localRecognitionAllowed: false,
    descriptorProvided: Array.isArray(req.body?.descriptor)
  };
  await AuditLog.create({ action: 'CADET_LOGIN_FACE_FAILED', roll: cadet.roll, details: diagnostics });
  const body = buildFaceVerificationFailureResponse(diagnostics, 400);
  delete body.statusCode;
  return res.status(400).json(body);
}));

// Cadet gate-pass emergency code endpoint.
app.get('/api/cadet/gate-pass-code', authenticateJWT, asyncHandler(async (req, res) => {
  if (req.user.role !== 'cadet') return res.status(403).json({ error: 'Unauthorized' });

  const cadet = await Cadet.findOne({ roll: req.user.roll });
  if (!cadet || cadet.activeSessionId !== req.user.sessionId) {
    return res.status(401).json({ error: 'Session invalid or logged in from another device.' });
  }
  if (isLeaveBlockActive(cadet)) return sendLeaveBlockedResponse(res, cadet);

  if (cadet.status === 'out') {
    const activeRecord = await LeaveRecord.findOne({ roll: cadet.roll, status: 'out' }).sort({ checkOutDate: -1 });
    const emergencyVerificationCode = activeRecord?.emergencyVerificationCode || activeRecord?.passVerificationToken || getActiveLeaveToken(cadet);
    return res.json({
      emergencyVerificationCode,
      gatePassCode: emergencyVerificationCode,
      passId: activeRecord?.passId || cadet?.pendingLeave?.passId || null,
      gatePassUrl: activeRecord?.passId && emergencyVerificationCode
        ? buildGatePassUrl(req, activeRecord.passId, emergencyVerificationCode)
        : null,
      name: cadet.name,
      photoUrl: cadet.photoUrl,
      batch: cadet.batch,
      status: 'out',
      activeLeave: activeRecord ? {
        leaveType: activeRecord.leaveType,
        fromDate: activeRecord.fromDate,
        toDate: activeRecord.toDate,
        returnDate: activeRecord.returnDate
      } : null
    });
  }

  if (!cadet.pendingLeave) {
    return res.json({ requiresConfig: true, name: cadet.name, photoUrl: cadet.photoUrl, status: 'returned' });
  }

  if (cadet.pendingLeave.approvalStatus === 'pending_approval') {
    return res.json({
      isPendingApproval: true,
      name: cadet.name,
      photoUrl: cadet.photoUrl,
      status: 'returned',
      leaveRequest: cadet.pendingLeave
    });
  }

  if (cadet.pendingLeave.approvalStatus === 'rejected') {
    return res.json({
      wasRejected: true,
      name: cadet.name,
      photoUrl: cadet.photoUrl,
      status: 'returned',
      leaveRequest: cadet.pendingLeave
    });
  }

  res.json({
    emergencyVerificationCode: cadet.pendingLeave.emergencyVerificationCode || cadet.pendingLeave.passVerificationToken,
    gatePassCode: cadet.pendingLeave.emergencyVerificationCode || cadet.pendingLeave.passVerificationToken,
    passId: cadet.pendingLeave.passId,
    gatePassUrl: buildGatePassUrl(req, cadet.pendingLeave.passId, cadet.pendingLeave.emergencyVerificationCode || cadet.pendingLeave.passVerificationToken),
    codeAvailableFrom: cadet.pendingLeave.fromDate,
    name: cadet.name,
    photoUrl: cadet.photoUrl,
    batch: cadet.batch,
    status: 'returned',
    approvedLeave: cadet.pendingLeave
  });
}));

// â”€â”€â”€ LEAVE REQUEST APIs â”€â”€â”€
app.get('/api/cadet/dashboard', authenticateJWT, asyncHandler(async (req, res) => {
  if (req.user.role !== 'cadet') return res.status(403).json({ error: 'Unauthorized' });

  const cadet = await Cadet.findOne({ roll: req.user.roll }).select('-faceDescriptor -faceDescriptors');
  if (!cadet || cadet.activeSessionId !== req.user.sessionId) {
    return res.status(401).json({ error: 'Session invalid or logged in from another device.' });
  }
  const leaveBlock = buildLeaveBlockStatus(cadet);

  const history = await LeaveRecord.find({ roll: cadet.roll })
    .sort({ checkOutDate: -1, _id: -1 })
    .limit(20)
    .select('-checkOutPhotoUrl -checkInPhotoUrl');
  const now = new Date();
  for (const record of history) {
    if (isShoreLeave(record) && !record.checkInDate && record.toDate && now > new Date(record.toDate) && record.status !== 'overdue') {
      record.status = 'overdue';
      record.expired = true;
      if (!record.overdueAlertSentAt) {
        const emailResult = await sendOverdueAlertEmail(cadet, record.toDate);
        record.overdueAlertSentAt = new Date();
        record.overdueEmailDeliveryMode = emailResult.deliveryMode || 'unknown';
      }
      await record.save();
    }
  }
  const refreshedHistory = await LeaveRecord.find({ roll: cadet.roll })
    .sort({ checkOutDate: -1, _id: -1 })
    .limit(50)
    .select('-checkOutPhotoUrl -checkInPhotoUrl');
  const shoreLeaveHistory = refreshedHistory.filter(isShoreLeave);
  const approvalHistory = refreshedHistory.filter(record => !isShoreLeave(record));

  let leaveStatus = 'NO_ACTIVE_LEAVE';
  let statusText = 'Apply for Leave';
  if (cadet.pendingLeave?.approvalStatus === 'pending_approval') {
    leaveStatus = 'PENDING';
    statusText = 'Awaiting HOD approval';
  } else if (cadet.pendingLeave?.approvalStatus === 'approved') {
    leaveStatus = 'APPROVED';
    statusText = 'Gate pass ready';
  } else if (cadet.pendingLeave?.approvalStatus === 'rejected') {
    leaveStatus = 'REJECTED';
    statusText = 'Rejected by HOD';
  }

  const pendingLeave = cadet.pendingLeave || null;
  const gatePassUrl = pendingLeave?.approvalStatus === 'approved' && pendingLeave.passId && pendingLeave.passVerificationToken
    ? buildGatePassUrl(req, pendingLeave.passId, pendingLeave.passVerificationToken)
    : null;
  const overdueRecord = refreshedHistory.find(record => getLeaveTimeliness(record).status === 'overdue');
  const shoreOverdue = shoreLeaveHistory.find(record => record.status === 'overdue' || getLeaveTimeliness(record).status === 'overdue');
  let overdueAlert = null;
  if (shoreOverdue) {
    overdueAlert = {
      expiredOn: shoreOverdue.toDate,
      type: 'shore_leave',
      message: `âš  Shore Leave expired at 18:00 HRS\nReport to campus immediately`
    };
  } else if (cadet.status === 'out' && pendingLeave?.toDate && new Date() > new Date(pendingLeave.toDate)) {
    overdueAlert = {
      expiredOn: pendingLeave.toDate,
      message: `Your leave expired on ${formatDate(pendingLeave.toDate)}. Please report to campus immediately.`
    };
    if (!pendingLeave.overdueAlertSentAt) {
      const emailResult = await sendOverdueAlertEmail(cadet, pendingLeave.toDate);
      cadet.pendingLeave.overdueAlertSentAt = new Date();
      cadet.pendingLeave.overdueEmailDeliveryMode = emailResult.deliveryMode || 'unknown';
      cadet.markModified('pendingLeave');
      await cadet.save();
      await AuditLog.create({ action: 'CADET_OVERDUE_ALERT_SENT', roll: cadet.roll, details: { emailDeliveryMode: emailResult.deliveryMode || 'unknown' } });
    }
  } else if (overdueRecord) {
    overdueAlert = {
      expiredOn: overdueRecord.toDate,
      message: `Your leave expired on ${formatDate(overdueRecord.toDate)}. Please report to campus immediately.`
    };
  }

  const faceEmbedding = await findFaceEmbeddingForCadet(cadet);
  const recentXp = await CadetXpLog.find({ cadetId: String(cadet._id) })
    .sort({ timestamp: -1 })
    .limit(5)
    .lean();
  const topCadets = await Cadet.find({ enrollmentStatus: 'ACTIVE' })
    .select('roll name photoUrl xp level currentStreak complianceScore')
    .sort({ xp: -1, complianceScore: -1, currentStreak: -1, name: 1 })
    .limit(10)
    .lean();
  const betterRankCount = await Cadet.countDocuments({
    $or: [
      { xp: { $gt: cadet.xp || 0 } },
      { xp: cadet.xp || 0, complianceScore: { $gt: cadet.complianceScore || 100 } }
    ]
  });
  const nextLevel = nextLevelInfo(cadet.xp || 0);
  const nextCrateXp = (Math.floor(Number(cadet.xp || 0) / 500) + 1) * 500;
  const emergencyVerificationCode = pendingLeave?.approvalStatus === 'approved'
    ? (pendingLeave.emergencyVerificationCode || pendingLeave.passVerificationToken || null)
    : null;

  res.json({
    cadet: {
      name: cadet.name || cadet.roll,
      roll: cadet.roll,
      studentId: cadet.studentId || cadet.idNo || cadet.roll,
      rank: cadet.rank || 'CADET',
      batch: cadet.batch || cadet.course || '',
      email: cadet.email || '',
      photoUrl: cadet.photoUrl || '',
      course: cadet.course || '',
      department: cadet.course || cadet.batch || '',
      leaveBlocked: leaveBlock.blocked,
      leaveBlockedReason: leaveBlock.reason,
      leaveBlockedDate: leaveBlock.blockedAt,
      leaveBlockedUntil: leaveBlock.blockedUntil
    },
    leave: {
      status: leaveStatus,
      statusText,
      request: pendingLeave,
      rejectionReason: pendingLeave?.rejectionReason || '',
      gatePassUrl,
      passId: pendingLeave?.passId || null,
      emergencyVerificationCode,
      gatePassCode: emergencyVerificationCode,
      gatePassPdfUrl: pendingLeave?.gatePassPdfUrl || pendingLeave?.gatePass?.publicUrl || null
    },
    gamification: {
      xp: cadet.xp || 0,
      level: cadet.level || 1,
      levelTitle: levelTitle(cadet.level || 1),
      nextLevelXp: nextLevel.xp,
      nextLevelTitle: nextLevel.title,
      nextCrateXp,
      xpToNextCrate: Math.max(0, nextCrateXp - Number(cadet.xp || 0)),
      leaveTokens: cadet.leaveTokens ?? 4,
      maxLeaveTokens: 8,
      currentStreak: cadet.currentStreak || 0,
      longestStreak: cadet.longestStreak || 0,
      cratesAvailable: cadet.cratesAvailable || 0,
      totalCratesOpened: cadet.totalCratesOpened || 0,
      complianceScore: cadet.complianceScore ?? 100,
      profileTheme: cadet.profileTheme || 'default',
      badges: cadet.badges || [],
      badgeDefinitions: BADGE_DEFINITIONS,
      prizes: cadet.prizes || [],
      recentXp,
      levelThresholds: LEVELS,
      prizePool: PRIZE_POOL
    },
    leaderboard: {
      rank: betterRankCount + 1,
      top: topCadets.map((item, index) => ({
        rank: index + 1,
        roll: item.roll,
        name: item.name || item.roll,
        photoUrl: item.photoUrl || '',
        xp: item.xp || 0,
        level: item.level || 1,
        currentStreak: item.currentStreak || 0,
        complianceScore: item.complianceScore ?? 100,
        isCurrentCadet: item.roll === cadet.roll
      }))
    },
    face: {
      enrolled: !!faceEmbedding,
      enrolledAt: faceEmbedding?.enrolledAt || cadet.faceEnrollmentData?.enrolledAt || null
    },
    shoreLeave: {
      status: cadet.status === 'out' ? 'Currently on leave' : 'Checked in',
      rawStatus: cadet.status || 'returned'
    },
    history: approvalHistory,
    shoreLeaveHistory,
    historyStats: buildHistoryStats(approvalHistory, pendingLeave),
    shoreLeaveStats: buildShoreLeaveStats(shoreLeaveHistory),
    overdueAlert,
    leaveBlock
  });
}));

app.post('/api/cadet/send-gate-pass-email', authenticateJWT, asyncHandler(async (req, res) => {
  if (req.user.role !== 'cadet') return res.status(403).json({ error: 'Unauthorized' });

  const cadet = await Cadet.findOne({ roll: req.user.roll });
  if (!cadet || cadet.activeSessionId !== req.user.sessionId) {
    return res.status(401).json({ error: 'Session invalid or logged in from another device.' });
  }
  if (isLeaveBlockActive(cadet)) return sendLeaveBlockedResponse(res, cadet);
  if (!cadet.email) {
    return res.status(400).json({ error: 'No registered email found for this cadet.' });
  }

  let leaveRequest = cadet.pendingLeave;
  let activeRecord = null;
  if (!leaveRequest || leaveRequest.approvalStatus !== 'approved') {
    activeRecord = await LeaveRecord.findOne({
      roll: cadet.roll,
      passVerificationToken: { $exists: true, $ne: null },
      approvalStatus: 'approved'
    }).sort({ checkOutDate: -1, passIssuedAt: -1, _id: -1 });

    if (activeRecord) {
      leaveRequest = {
        passId: activeRecord.passId,
        passVerificationToken: activeRecord.passVerificationToken,
        leaveType: activeRecord.leaveType,
        reason: activeRecord.leaveReason,
        fromDate: activeRecord.fromDate,
        toDate: activeRecord.toDate,
        returnDate: activeRecord.returnDate,
        reviewedAt: activeRecord.approvedAt || activeRecord.passIssuedAt,
        reviewedBy: activeRecord.approvedBy
      };
    }
  }

  if (!leaveRequest || leaveRequest.approvalStatus === 'pending_approval' || !leaveRequest.passVerificationToken || !leaveRequest.passId) {
    return res.status(400).json({ error: 'No approved gate pass is available to email.' });
  }

  const leaveWindow = resolveLeaveWindow(leaveRequest);
  const gatePassUrl = buildGatePassUrl(req, leaveRequest.passId, leaveRequest.passVerificationToken);
  const assets = await createGatePassAssets({
    passId: leaveRequest.passId,
    emergencyVerificationCode: leaveRequest.emergencyVerificationCode || leaveRequest.passVerificationToken,
    name: cadet.name || cadet.roll,
    roll: cadet.roll,
    studentId: cadet.studentId,
    rank: cadet.rank || 'CADET',
    idNo: cadet.idNo || cadet.studentId || cadet.roll,
    batch: cadet.batch,
    course: cadet.course,
    leaveType: leaveRequest.leaveType,
    reason: leaveRequest.reason,
    fromDate: leaveWindow.fromDate,
    toDate: leaveWindow.toDate,
    returnDate: leaveWindow.returnDate,
    generatedAt: leaveRequest.reviewedAt || new Date(),
    issuedBy: leaveRequest.reviewedBy || 'Administrator',
    gatePassUrl,
    passStatusText: 'ACTIVE'
  });
  if (activeRecord) {
    applyGatePassAssetMetadata(activeRecord, assets);
    await activeRecord.save();
  } else if (cadet.pendingLeave?.passId === leaveRequest.passId) {
    applyGatePassAssetMetadata(cadet.pendingLeave, assets);
    cadet.markModified('pendingLeave');
    await cadet.save();
  }

  const safe = {
    name: escapeEmailHtml(cadet.name || cadet.roll),
    rank: escapeEmailHtml(cadet.rank || 'CADET'),
    id: escapeEmailHtml(cadet.idNo || cadet.studentId || cadet.roll),
    passId: escapeEmailHtml(leaveRequest.passId),
    from: escapeEmailHtml(formatDate(leaveWindow.fromDate)),
    to: escapeEmailHtml(formatDate(leaveWindow.toDate))
  };

  const subject = 'Your Gate Pass â€” Safe Journey âœˆ';
  const text =
    `Cadet name: ${cadet.name || cadet.roll}\n` +
    `Rank: ${cadet.rank || 'CADET'}\n` +
    `ID: ${cadet.idNo || cadet.studentId || cadet.roll}\n` +
    `Leave dates: ${formatDate(leaveWindow.fromDate)} to ${formatDate(leaveWindow.toDate)}\n` +
    `Gate pass number: ${leaveRequest.passId}\n\n` +
    `Safe Journey âœˆ`;

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
        <div style="padding:22px 24px;background:#0f172a;color:#ffffff;">
          <div style="font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.82;">AMET Shore Leave</div>
          <div style="margin-top:8px;font-size:26px;font-weight:900;">Your Gate Pass</div>
        </div>
        <div style="padding:24px;">
          <div style="display:grid;gap:10px;margin-bottom:18px;">
            <div><strong>Cadet name:</strong> ${safe.name}</div>
            <div><strong>Rank:</strong> ${safe.rank}</div>
            <div><strong>ID:</strong> ${safe.id}</div>
            <div><strong>Leave dates:</strong> ${safe.from} to ${safe.to}</div>
            <div><strong>Gate pass number:</strong> ${safe.passId}</div>
          </div>
          <div style="text-align:center;padding:18px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;">
            <div style="font-size:12px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Emergency Verification Code</div>
            <div style="margin-top:8px;font-size:24px;font-weight:900;color:#0f172a;letter-spacing:.08em;">${escapeEmailHtml(leaveRequest.emergencyVerificationCode || leaveRequest.passVerificationToken)}</div>
          </div>
          <div style="margin-top:18px;text-align:center;"><a href="${assets.gatePassPdfSignedUrl || assets.gatePassPdfUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#0f172a;color:#fff;text-decoration:none;font-weight:700;">Download Gate Pass PDF</a></div>
          <div style="margin-top:20px;text-align:center;font-size:18px;font-weight:900;color:#0f172a;">Safe Journey âœˆ</div>
        </div>
      </div>
    </div>`;

  const emailResult = await sendSystemEmail({
    to: cadet.email,
    subject,
    text,
    html,
    attachments: buildGatePassEmailAttachments(assets, leaveRequest.passId)
  });

  await AuditLog.create({
    action: 'CADET_GATE_PASS_EMAIL_SENT',
    roll: cadet.roll,
    details: {
      passId: leaveRequest.passId,
      emailDeliveryMode: emailResult.deliveryMode || 'unknown'
    }
  });

  res.json({ success: true, emailResult: publicEmailDeliveryResult(emailResult) });
}));

app.post('/api/loot/open-crate', authenticateJWT, asyncHandler(async (req, res) => {
  if (req.user.role !== 'cadet') return res.status(403).json({ error: 'Unauthorized' });
  const cadet = await Cadet.findOne({ roll: req.user.roll });
  if (!cadet || cadet.activeSessionId !== req.user.sessionId) {
    return res.status(401).json({ error: 'Session invalid or logged in from another device.' });
  }
  const result = await lootService.openCrate(cadet._id);
  res.json({ success: true, ...result });
}));

app.post('/api/admin/grant-tokens', requireOfficer, asyncHandler(async (req, res) => {
  const { cadetId, tokens, reason } = req.body || {};
  const amount = Math.max(1, Math.min(4, Number(tokens || 0)));
  if (!cadetId || !amount) return res.status(400).json({ error: 'cadetId and tokens are required.' });
  const cadet = await Cadet.findOne({
    $or: [
      { roll: normalizeRoll(cadetId) },
      { studentId: String(cadetId).trim() },
      { _id: mongoose.Types.ObjectId.isValid(cadetId) ? cadetId : undefined }
    ].filter(item => Object.values(item)[0])
  });
  if (!cadet) return res.status(404).json({ error: 'Cadet not found.' });

  const monthStart = startOfMonth(new Date());
  const grantedThisMonth = await AuditLog.aggregate([
    {
      $match: {
        action: 'LEAVE_TOKENS_GRANTED',
        roll: cadet.roll,
        timestamp: { $gte: monthStart }
      }
    },
    { $group: { _id: '$roll', total: { $sum: '$details.tokens' } } }
  ]);
  const alreadyGranted = grantedThisMonth[0]?.total || 0;
  if (alreadyGranted + amount > 4) {
    return res.status(400).json({ error: `HOD can grant max 4 bonus tokens per cadet/month. Already granted: ${alreadyGranted}.` });
  }

  cadet.leaveTokens = Math.min(8, Number(cadet.leaveTokens ?? 4) + amount);
  await cadet.save();
  await AuditLog.create({
    action: 'LEAVE_TOKENS_GRANTED',
    roll: cadet.roll,
    details: { tokens: amount, reason: reason || '', grantedBy: req.officer.username }
  });
  await sendPushToCadet(cadet.roll, {
    title: 'Bonus leave tokens granted',
    body: `You now have ${cadet.leaveTokens} tokens.`,
    url: '/cadet-dashboard.html'
  }).catch(() => {});
  emitCadetEvent(cadet, 'token:granted', { tokens: amount, leaveTokens: cadet.leaveTokens, reason: reason || '' });
  res.json({ success: true, roll: cadet.roll, leaveTokens: cadet.leaveTokens });
}));

app.get('/api/admin/prizes/pending', requireOfficer, asyncHandler(async (req, res) => {
  const cadets = await Cadet.find({ 'prizes.collected': false })
    .select('roll name email photoUrl prizes')
    .lean();
  const prizes = [];
  cadets.forEach(cadet => {
    (cadet.prizes || []).forEach((prize, index) => {
      if (prize.collected) return;
      const physical = /pen|keychain|cap|t-?shirt|hoodie/i.test(prize.prize || '');
      if (!physical) return;
      prizes.push({
        cadetId: String(cadet._id),
        roll: cadet.roll,
        name: cadet.name || cadet.roll,
        email: cadet.email || '',
        photoUrl: cadet.photoUrl || '',
        prizeIndex: index,
        prize: prize.prize,
        tier: prize.tier,
        earnedAt: prize.earnedAt
      });
    });
  });
  prizes.sort((a, b) => new Date(b.earnedAt || 0) - new Date(a.earnedAt || 0));
  res.json({ prizes });
}));

app.post('/api/admin/prizes/:roll/:index/collect', requireOfficer, asyncHandler(async (req, res) => {
  const cadet = await Cadet.findOne({ roll: normalizeRoll(req.params.roll) });
  const index = Number(req.params.index);
  if (!cadet || !cadet.prizes || !cadet.prizes[index]) return res.status(404).json({ error: 'Prize not found.' });
  cadet.prizes[index].collected = true;
  cadet.prizes[index].collectedAt = new Date();
  const prizeName = cadet.prizes[index].prize;
  await cadet.save();
  const emailResult = await sendSystemEmail({
    to: cadet.email,
    subject: `Your ${prizeName} has been collected`,
    text: `Your ${prizeName} has been collected.\nCongratulations from Team Find It!`,
    html: `<p>Your <strong>${escapeEmailHtml(prizeName)}</strong> has been collected.</p><p>Congratulations from Team Find It!</p>`
  });
  emitCadetEvent(cadet, 'prize:collected', { prize: prizeName, index });
  res.json({ success: true, emailResult: publicEmailDeliveryResult(emailResult) });
}));

app.post('/api/cadet/shore-leave-request', authenticateJWT, asyncHandler(async (req, res) => {
  if (req.user.role !== 'cadet') return res.status(403).json({ error: 'Unauthorized' });
  const cadet = await Cadet.findOne({ roll: req.user.roll });
  if (!cadet || cadet.activeSessionId !== req.user.sessionId) {
    return res.status(401).json({ error: 'Session invalid or logged in from another device.' });
  }
  if (cadet.isBlocked) return res.status(403).json({ error: 'You are blocked from shore leave requests.' });
  if (isLeaveBlockActive(cadet)) return sendLeaveBlockedResponse(res, cadet);
  if (cadet.status === 'out' || hasActiveLeaveRequest(cadet) || await findOpenShoreLeaveRecord(cadet.roll)) {
    return res.status(400).json({
      error: 'You already have an active shore leave. Please return/check in before applying again.'
    });
  }
  const shoreLeaveCost = leaveTokenCost('Shore Leave');
  if (Number(cadet.leaveTokens ?? 4) < shoreLeaveCost) {
    return res.status(400).json({
      error: `Not enough leave tokens. You have ${cadet.leaveTokens ?? 4} tokens. This leave costs ${shoreLeaveCost} token.`
    });
  }

  const now = new Date();
  const expiresAt = getTodayAt(18, 0);

  const { destination, reason } = req.body || {};
  if (!String(destination || '').trim()) return res.status(400).json({ error: 'Destination is required.' });
  if (!String(reason || '').trim()) return res.status(400).json({ error: 'Purpose/Reason is required.' });

  const passId = await generateUniquePassId();
  const requestId = crypto.randomUUID();
  const emergencyVerificationCode = await generateUniqueEmergencyVerificationCode(passId);

  const record = new LeaveRecord({
    roll: cadet.roll,
    name: cadet.name,
    email: cadet.email,
    batch: cadet.batch,
    course: cadet.course,
    studentId: cadet.studentId,
    dest: String(destination).trim(),
    checkOutTime: nowTime24(),
    checkInTime: '18:00',
    checkOutDate: now,
    fromDate: now,
    toDate: expiresAt,
    fromTime: nowTime24(),
    toTime: '18:00',
    status: 'approved',
    leaveType: 'Shore Leave',
    leaveReason: String(reason).trim(),
    approvalStatus: 'approved',
    approvedBy: 'AUTO_APPROVED',
    approvedAt: now,
    passId,
    passVerificationToken: emergencyVerificationCode,
    emergencyVerificationCode,
    emergencyCodeGeneratedAt: now,
    emergencyCodeExpiresAt: expiresAt,
    emergencyGateOutUsed: false,
    emergencyGateInUsed: false,
    expired: false,
    gatePassMessage: 'Safe Journey',
    passIssuedAt: now
  });

  const { emailResult, gatePassUrl } = await sendShoreLeaveApprovedEmail(req, cadet, record);
  cadet.leaveTokens = Math.max(0, Number(cadet.leaveTokens ?? 4) - shoreLeaveCost);
  await cadet.save();
  await xpService.awardXP(cadet._id, 'FIRST_SHORE_LEAVE', 'First shore leave').catch(() => {});
  if (now.getHours() >= 16) await badgeService.awardBadge(cadet._id, 'night_owl').catch(() => {});
  await maybeAwardLeaveBadges(cadet).catch(() => {});
  emitCadetEvent(cadet, 'leave:approved', { passId, gatePassUrl, emergencyVerificationCode, leaveTokens: cadet.leaveTokens });
  await sendPushToCadet(cadet.roll, {
    title: 'Shore Leave approved',
    body: 'Remember to return by 18:00 HRS.',
    url: '/cadet-dashboard.html'
  });
  await AuditLog.insertMany([
    {
      action: 'SHORE_LEAVE_AUTO_APPROVED',
      roll: cadet.roll,
      details: { passId, destination: record.dest, emailDeliveryMode: emailResult.deliveryMode || 'unknown' }
    },
    {
      action: 'EMERGENCY_CODE_GENERATED',
      roll: cadet.roll,
      details: { passId, requestId, emergencyVerificationCode, expiresAt }
    },
    {
      action: 'GATE_PASS_GENERATED',
      roll: cadet.roll,
      details: { passId, gatePassPdfUrl: record.gatePassPdfUrl || null }
    },
    {
      action: 'GATE_PASS_EMAILED',
      roll: cadet.roll,
      details: { passId, emailDeliveryMode: emailResult.deliveryMode || 'unknown' }
    }
  ]);

  res.status(201).json({
    success: true,
    message: 'Shore Leave Approved!',
    email: cadet.email,
    passId,
    emergencyVerificationCode,
    gatePassUrl,
    record
  });
}));

app.post('/api/cadet/leave-request', authenticateJWT, asyncHandler(async (req, res) => {
  if (req.user.role !== 'cadet') return res.status(403).json({ error: 'Unauthorized' });

  const { leaveType, fromDate, toDate, fromTime, toTime, returnDate, dest, reason, document } = req.body;
  const cadet = await Cadet.findOne({ roll: req.user.roll });
  
  if (!cadet) return res.status(404).json({ error: 'Cadet not found' });
  if (cadet.isBlocked) return res.status(403).json({ error: 'You are blocked from leave requests.' });
  if (isLeaveBlockActive(cadet)) return sendLeaveBlockedResponse(res, cadet);
  if (cadet.status === 'out') return res.status(400).json({ error: 'You already have an active leave in progress.' });
  if (hasActiveLeaveRequest(cadet)) {
    return res.status(400).json({ error: 'You already have a leave request in progress. Please wait until it is completed before applying again.' });
  }
  if (await findOpenShoreLeaveRecord(cadet.roll)) {
    return res.status(400).json({ error: 'You already have an active shore leave. Please return/check in before applying again.' });
  }
  if (!isLeaveTypeValid(leaveType)) return res.status(400).json({ error: 'Leave type must be Medical, Special Leave, or Others.' });
  const tokenCost = leaveTokenCost(leaveType);
  if (Number(cadet.leaveTokens ?? 4) < tokenCost) {
    return res.status(400).json({
      error: `Not enough leave tokens. You have ${cadet.leaveTokens ?? 4} tokens. This leave costs ${tokenCost} token${tokenCost === 1 ? '' : 's'}.`
    });
  }

  const parsedFromDate = parseDateValue(fromDate);
  const parsedToDate = parseDateValue(toDate);
  const parsedReturnDate = returnDate ? parseDateValue(returnDate) : null;

  if (!parsedFromDate || !parsedToDate) {
    return res.status(400).json({ error: 'From date and To date are required.' });
  }
  const timeError = validateLeaveDateTimes({ fromDate, toDate, fromTime, toTime });
  if (timeError) {
    return res.status(400).json({ error: timeError });
  }
  if (endOfDay(parsedToDate) < startOfDay(parsedFromDate)) {
    return res.status(400).json({ error: 'To date cannot be earlier than From date.' });
  }
  if (leaveType === 'Others' && !parsedReturnDate) {
    return res.status(400).json({ error: 'Date of Return to College is required for Others leave.' });
  }
  if (parsedReturnDate && endOfDay(parsedReturnDate) < startOfDay(parsedToDate)) {
    return res.status(400).json({ error: 'Date of Return to College cannot be earlier than the leave end date.' });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'Leave reason is required.' });
  }

  const documentRequired = ['Medical', 'Special Leave'].includes(leaveType);
  if (documentRequired && !document) {
    return res.status(400).json({ error: `${leaveType} requires a supporting document.` });
  }

  let documentUrl = null;
  let supportingDocument = null;
  if (document) {
    supportingDocument = await uploadLeaveSupportingDocument({ document, cadet, leaveType });
    documentUrl = supportingDocument?.publicUrl || supportingDocument?.url || null;
  }

  cadet.pendingLeave = {
    requestId: crypto.randomUUID(),
    leaveType,
    fromDate: combineDateAndTime(fromDate, fromTime) || startOfDay(parsedFromDate),
    toDate: combineDateAndTime(toDate, toTime) || endOfDay(parsedToDate),
    fromTime,
    toTime,
    returnDate: parsedReturnDate ? endOfDay(parsedReturnDate) : null,
    dest: dest || 'Unknown',
    reason: reason.trim(),
    documentUrl,
    supportingDocument,
    approvalStatus: 'pending_approval',
    requestedAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    passId: null,
    passVerificationToken: null,
    tokenCost
  };
  
  await cadet.save();
  await AuditLog.create({
    action: 'LEAVE_REQUESTED',
    roll: cadet.roll,
    details: {
      leaveType,
      fromDate: cadet.pendingLeave.fromDate,
      toDate: cadet.pendingLeave.toDate,
      fromTime: cadet.pendingLeave.fromTime,
      toTime: cadet.pendingLeave.toTime,
      returnDate: cadet.pendingLeave.returnDate
    }
  });
  if (new Date().getHours() >= 16) await badgeService.awardBadge(cadet._id, 'night_owl').catch(() => {});
  const emailResult = await sendLeaveSubmittedEmail(req, cadet, cadet.pendingLeave);
  res.json({
    success: true,
    status: 'pending_approval',
    requestId: cadet.pendingLeave.requestId,
    submittedAt: cadet.pendingLeave.requestedAt,
    details: cadet.pendingLeave,
    emailResult: publicEmailDeliveryResult(emailResult)
  });
}));


// â”€â”€â”€ FACE ENROLLMENT â”€â”€â”€
app.post('/api/cadets/validate-face-frame', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const { frame } = req.body || {};
  if (!frame || !String(frame).startsWith('data:image')) {
    return res.status(400).json({ success: false, message: 'A camera frame image is required.' });
  }

  try {
    const validation = await validateFaceFrame(frame);
    if (!validation.success) {
      return res.status(422).json(validation);
    }

    res.json(validation);
  } catch (error) {
    logWarn('[FACE] OpenCV frame validation unavailable; accepting browser-validated frame.', {
      message: error.message
    });
    res.json({
      success: true,
      message: 'Accepted browser-validated frame.',
      faceImage: frame,
      checks: {
        fallback: true,
        fallbackReason: error.message
      }
    });
  }
}));

app.post(['/api/cadets/enroll-face', '/api/face/enroll/complete', '/api/face/enrollment/complete'], authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const { roll, name, email, batch, descriptor, descriptors, photo, photos, imageBase64, frontImage, frame, deviceInfo } = req.body;

  // â”€â”€ Validate inputs â”€â”€
  const normRoll = normalizeRoll(roll);
  const enrollmentImage = extractImageBase64(
    photo,
    imageBase64,
    frontImage,
    frame,
    photos && typeof photos === 'object' ? photos.front : null
  );
  if (!normRoll) return res.status(400).json({ error: 'Roll number is required' });
  if (!enrollmentImage) {
    return res.status(400).json({ error: 'A front-face image is required' });
  }

  // â”€â”€ Validate descriptor values â”€â”€
  const allDescriptors = [];
  if (Array.isArray(descriptors) && Array.isArray(descriptors[0])) {
    allDescriptors.push(descriptors[0]);
  } else if (Array.isArray(descriptor)) {
    allDescriptors.push(descriptor);
  }
  for (let i = 0; i < allDescriptors.length; i++) {
    if (!Array.isArray(allDescriptors[i]) || allDescriptors[i].length < 64) {
      return res.status(400).json({ error: `Descriptor ${i + 1} is invalid or too short` });
    }
  }

  // â”€â”€ Confirm cadet exists â”€â”€
  const cadet = await Cadet.findOne({ roll: normRoll });
  if (!cadet) return res.status(404).json({ error: 'Cadet not found. Check the registration number.' });
  const existingFaceEmbedding = await findFaceEmbeddingForCadet(cadet);
  const isReEnrollment = !!existingFaceEmbedding ||
    cadet.faceEnrollmentData?.enrolled === true ||
    !!getPrimaryFaceDescriptor(cadet) ||
    !!getFrontFaceImage(cadet);

  // â”€â”€ Backup previous face data (stored in audit log, nothing is lost) â”€â”€
  const previousFaceData = {
    hadDescriptor: !!getPrimaryFaceDescriptor(cadet) || !!existingFaceEmbedding,
    enrollmentVersion: (cadet.faceEnrollmentData && cadet.faceEnrollmentData.enrollmentVersion) || 0,
    oldPhotoUrl: getFrontFaceImage(cadet),
    oldFaceImages: cadet.faceImages && cadet.faceImages.toObject ? cadet.faceImages.toObject() : (cadet.faceImages || null),
    oldFaceEmbeddingDocumentId: existingFaceEmbedding?._id ? String(existingFaceEmbedding._id) : null,
  };

  // â”€â”€ Build the $set payload â€” ONLY face fields, never touch status/leave/block â”€â”€
  const enrolledAt = new Date();
  const enrolledBy  = req.officer.username;
  const newVersion  = previousFaceData.enrollmentVersion + 1;

  const $set = {
    enrollmentStatus:  'ACTIVE',
    'faceEnrollmentData.enrolled':          true,
    'faceEnrollmentData.enrolledAt':        enrolledAt,
    'faceEnrollmentData.enrolledBy':        enrolledBy,
    'faceEnrollmentData.enrollmentVersion': newVersion,
    'faceEnrollmentData.deviceInfo':        deviceInfo || req.headers['user-agent'] || 'unknown',
  };
  if (allDescriptors.length > 0) {
    $set.faceDescriptor = allDescriptors[0];
    $set.faceDescriptors = allDescriptors;
  }

  // Only update name/email/batch if provided (never blank them out)
  if (name  && name.trim())  $set.name  = name.trim();
  if (email && email.trim()) $set.email = normalizeEmail(email);
  if (batch && batch.trim()) $set.batch = batch.trim();

  let provider = 'insightface';
  let serviceEnrollment = null;
  let fallbackEmbedding = null;
  let captureChecks = {};
  let validatedFaceImage = enrollmentImage;
  let validationMode = 'opencv';

  try {
    serviceEnrollment = await enrollFaceWithService(cadet, enrollmentImage);
  } catch (error) {
    provider = 'faceapi-browser-fallback';
    logWarn('[FACE] Python face service unavailable during enrollment; saving browser descriptor fallback.', {
      roll: normRoll,
      message: error.message
    });
    if (allDescriptors.length === 0) {
      throw error;
    }
    fallbackEmbedding = await upsertFallbackFaceEmbedding(cadet, allDescriptors[0], enrolledAt, enrolledBy);
  }

  try {
    const validatedCapture = await validateEnrollmentCapture(enrollmentImage);
    validatedFaceImage = validatedCapture.faceImage;
    captureChecks = validatedCapture.checks || {};
  } catch (error) {
    validationMode = 'browser-capture-fallback';
    captureChecks = { fallbackReason: error.message };
    logWarn('[FACE] OpenCV capture validation unavailable; saving browser-validated capture.', {
      roll: normRoll,
      message: error.message
    });
  }

  // â”€â”€ Save face images to disk AFTER we know the cadet exists â”€â”€
  // Images use deterministic filenames â†’ re-enrollment overwrites, no orphaned files.
  const frontUrl = await saveBase64Image(validatedFaceImage, `face_${normRoll}_front`, 'face-images', 'enrollments');
  if (!frontUrl) {
    return res.status(500).json({ error: 'Could not save the front-face image. Please retry.' });
  }

  // Merge with existing faceImages â€” never null out an angle that was previously set
  $set['faceImages.front'] = frontUrl;
  $set['faceImages.left']  = null;
  $set['faceImages.right'] = null;

  // photoUrl = front pose photo, keep old one if no new front was captured
  $set.photoUrl = frontUrl;

  // â”€â”€ Atomic update â€” only touches face fields, never status/pendingLeave/isBlocked â”€â”€
  const updated = await Cadet.findOneAndUpdate(
    { roll: normRoll },
    { $set },
    { returnDocument: 'after', runValidators: false }
  );

  if (!updated) {
    // Extremely unlikely (cadet was deleted between findOne and findOneAndUpdate)
    return res.status(404).json({ error: 'Cadet record disappeared during save. Please retry.' });
  }
  const currentFaceEmbedding = await findFaceEmbeddingForCadet(updated);
  const duplicateCleanup = await removeDuplicateFaceEmbeddingsForCadet(
    updated,
    currentFaceEmbedding?._id || serviceEnrollment?.documentId || fallbackEmbedding?._id
  );
  await xpService.awardXP(updated._id, 'FACE_ENROLLED', 'Face enrollment completed').catch(() => {});

  // â”€â”€ Audit log â€” records both new enrollment and what was backed up â”€â”€
  const auditAction = isReEnrollment ? 'FACE_REENROLLED' : 'FACE_ENROLLED';
  await AuditLog.create({
    action: auditAction,
    roll: normRoll,
    timestamp: enrolledAt,
    details: {
      cadet: {
        id: String(updated._id),
        roll: updated.roll,
        name: updated.name || updated.roll,
        studentId: updated.studentId || null,
        serialNo: updated.serialNo || null
      },
      officer: {
        username: enrolledBy,
        id: req.officer?._id ? String(req.officer._id) : (req.user?.id || null),
        role: req.officer?.role || req.user?.role || null
      },
      enrolledBy,
      provider,
      validationMode,
      captureMode: 'front_only',
      angles: ['front'],
      descriptorCount: allDescriptors.length,
      enrollmentVersion: newVersion,
      previousVersion: previousFaceData.enrollmentVersion,
      reEnrollment: isReEnrollment,
      previousPhotoUrl: previousFaceData.oldPhotoUrl,
      previousFaceEmbeddingDocumentId: previousFaceData.oldFaceEmbeddingDocumentId,
      identifiers: {
        roll: updated.roll,
        cadetId: updated.studentId || null,
        institutionalEmail: updated.email || null
      },
      faceEmbeddingDocumentId: currentFaceEmbedding?._id
        ? String(currentFaceEmbedding._id)
        : (serviceEnrollment?.documentId || (fallbackEmbedding?._id ? String(fallbackEmbedding._id) : null)),
      duplicateEmbeddingsRemoved: duplicateCleanup.deletedCount || 0,
      captureChecks
    }
  });
  res.json({
    success: true,
    roll: updated.roll,
    name: updated.name,
    photoUrl: updated.photoUrl,
    faceImages: updated.faceImages,
    enrollmentVersion: newVersion,
    descriptorCount: allDescriptors.length,
    captureChecks,
    provider,
    validationMode,
    reEnrollment: isReEnrollment,
    auditAction,
    faceEmbeddingDocumentId: currentFaceEmbedding?._id
      ? String(currentFaceEmbedding._id)
      : (serviceEnrollment?.documentId || (fallbackEmbedding?._id ? String(fallbackEmbedding._id) : null)),
  });
}));

// Get Face Descriptor
app.get('/api/cadets/face/:roll', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const cadet = await Cadet.findOne({ roll: req.params.roll.toUpperCase() });
  if (!cadet) return res.status(404).json({ error: 'Cadet not found' });
  const storedDescriptor = getPrimaryFaceDescriptor(cadet);
  if (!storedDescriptor) {
    return res.status(404).json({ error: 'No face enrolled for this cadet' });
  }
  res.json({
    enrolled:           true,
    photoUrl:           getFrontFaceImage(cadet),
    faceImages:         {
      front: getFrontFaceImage(cadet),
      left: null,
      right: null
    },
    name:               cadet.name,
    roll:               cadet.roll,
    enrollmentStatus:   cadet.enrollmentStatus
  });
}));

app.get('/api/face/enrollment-status/:cadetId', authenticateJWT, asyncHandler(async (req, res) => {
  const requestedId = String(req.params.cadetId || '').trim();
  if (!requestedId) return res.status(400).json({ error: 'cadetId is required.' });

  const normalizedRoll = normalizeRoll(requestedId);
  const cadet = await Cadet.findOne({
    $or: [
      { roll: normalizedRoll },
      { studentId: requestedId },
      { serialNo: requestedId }
    ]
  }).select('roll studentId serialNo name email photoUrl faceImages faceEnrollmentData verificationHistory');

  const userRole = req.user?.role;
  if (userRole === 'cadet' || userRole === 'cadet_pending_face') {
    if (!cadet || normalizeRoll(req.user.roll) !== cadet.roll) {
      return res.status(403).json({ error: 'You can only view your own face enrollment status.' });
    }
  } else if (!['admin', 'duty_officer'].includes(userRole)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const embedding = cadet ? await findFaceEmbeddingForCadet(cadet) : await findFaceEmbeddingForCadet(requestedId);
  const enrolledAt = embedding?.enrolledAt || cadet?.faceEnrollmentData?.enrolledAt || null;
  const enrolled = !!embedding || cadet?.faceEnrollmentData?.enrolled === true;
  const lastVerification = Array.isArray(cadet?.verificationHistory)
    ? [...cadet.verificationHistory].reverse().find(item => item && item.faceMatchScore != null)
    : null;

  res.json({
    enrolled,
    enrolledAt,
    cadetName: embedding?.cadetName || cadet?.name || '',
    cadetId: embedding?.cadetId || requestedId,
    roll: cadet?.roll || null,
    documentId: embedding?._id ? String(embedding._id) : null,
    enrolledBy: embedding?.enrolledBy || cadet?.faceEnrollmentData?.enrolledBy || null,
    facePhotoUrl: cadet?.faceImages?.front || cadet?.photoUrl || '',
    lastConfidence: formatConfidenceScore(lastVerification?.faceMatchScore)
  });
}));


// â”€â”€â”€ LEAVE MANAGEMENT APIs â”€â”€â”€
app.get('/api/admin/face-enrollment-status', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const cadets = await Cadet.find()
    .select('roll studentId serialNo name email photoUrl faceImages faceEnrollmentData verificationHistory')
    .sort({ name: 1, roll: 1 });
  const embeddings = await faceEmbeddingsCollection()
    .find({}, { projection: { embedding: 0 } })
    .toArray();
  const embeddingsByCadetId = new Map(embeddings.map(doc => [normalizeIdentifier(doc.cadetId), doc]));
  const reminderCounts = await AuditLog.aggregate([
    { $match: { action: 'FACE_ENROLLMENT_REMINDER_SENT' } },
    { $group: { _id: '$roll', count: { $sum: 1 }, lastSentAt: { $max: '$timestamp' } } }
  ]);
  const remindersByRoll = new Map(reminderCounts.map(item => [normalizeRoll(item._id), item]));

  const completed = [];
  const pending = [];

  cadets.forEach(cadet => {
    const embedding = faceEnrollmentIdsForCadet(cadet)
      .map(id => embeddingsByCadetId.get(normalizeIdentifier(id)))
      .find(Boolean);
    const lastVerification = Array.isArray(cadet.verificationHistory)
      ? [...cadet.verificationHistory].reverse().find(item => item && item.faceMatchScore != null)
      : null;
    const reminder = remindersByRoll.get(cadet.roll) || {};
    const item = {
      roll: cadet.roll,
      name: cadet.name || cadet.roll,
      email: cadet.email || '',
      photoUrl: cadet.photoUrl || '',
      facePhotoUrl: cadet.faceImages?.front || '',
      enrolledAt: embedding?.enrolledAt || cadet.faceEnrollmentData?.enrolledAt || null,
      documentId: embedding?._id ? String(embedding._id) : null,
      lastConfidence: formatConfidenceScore(lastVerification?.faceMatchScore),
      reminderCount: reminder.count || 0,
      reminderLastSentAt: reminder.lastSentAt || null
    };
    // The cadet record is updated atomically when enrollment succeeds. Treat it
    // as authoritative even if the separate embedding lookup has not caught up
    // yet or was stored under another supported cadet identifier.
    const isEnrolled = !!embedding || cadet.faceEnrollmentData?.enrolled === true;
    if (isEnrolled) completed.push(item);
    else pending.push(item);
  });

  completed.sort((a, b) => new Date(b.enrolledAt || 0) - new Date(a.enrolledAt || 0));
  pending.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  res.json({
    completed,
    pending,
    counts: { completed: completed.length, pending: pending.length }
  });
}));

app.post('/api/admin/face-enrollment-reminder/:roll', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const cadet = await Cadet.findOne({ roll: normalizeRoll(req.params.roll) })
    .select('roll studentId serialNo name email faceImages faceEnrollmentData');
  if (!cadet) return res.status(404).json({ error: 'Cadet not found.' });

  const isEnrolled = !!(await findFaceEmbeddingForCadet(cadet)) || cadet.faceEnrollmentData?.enrolled === true;
  if (isEnrolled) return res.status(400).json({ error: 'Cadet has already completed face enrollment.' });
  if (!cadet.email) return res.status(400).json({ error: 'Cadet email is not available.' });

  const collegeName = process.env.COLLEGE_NAME || 'AMET';
  const enrollmentUrl = process.env.FACE_ENROLLMENT_URL || `http://localhost:${process.env.PORT || 3000}/enroll.html`;
  const emailResult = await sendSystemEmail({
    to: cadet.email,
    subject: 'Please complete face enrollment',
    text: `Dear ${cadet.name || cadet.roll},\n\nPlease complete face enrollment at ${collegeName} shore leave system.\nVisit: ${enrollmentUrl}\nThis is required for gate check-in.\n\nShore Leave System`,
    html: `<p>Dear ${escapeEmailHtml(cadet.name || cadet.roll)},</p><p>Please complete face enrollment at ${escapeEmailHtml(collegeName)} shore leave system.</p><p>Visit: <a href="${escapeEmailHtml(enrollmentUrl)}">${escapeEmailHtml(enrollmentUrl)}</a></p><p>This is required for gate check-in.</p><p>Shore Leave System</p>`
  });
  await AuditLog.create({
    action: 'FACE_ENROLLMENT_REMINDER_SENT',
    roll: cadet.roll,
    details: { deliveryMode: emailResult.deliveryMode || 'unknown' }
  });

  const reminderCount = await AuditLog.countDocuments({
    action: 'FACE_ENROLLMENT_REMINDER_SENT',
    roll: cadet.roll
  });

  res.json({ success: true, reminderCount, emailResult: publicEmailDeliveryResult(emailResult) });
}));

app.get('/api/cadets', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const records = await LeaveRecord.find().sort({ _id: -1 }).lean();
  res.json(records.map(publicLeaveRecord));
}));

app.get('/api/cadets/:id', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const requestedId = String(req.params.id || '').trim();
  if (!requestedId) return res.status(400).json({ error: 'Cadet ID is required.' });

  const cadet = await Cadet.findOne({
    $or: [
      { studentId: requestedId },
      { serialNo: requestedId },
      { roll: normalizeRoll(requestedId) }
    ]
  }).select('-faceDescriptor -faceDescriptors');

  if (!cadet) return res.status(404).json({ error: 'Cadet not found.' });
  res.json(mapCadetForGatePass(cadet));
}));

app.get('/api/gate-pass/:passId', asyncHandler(async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Gate pass token is required.' });

  const record = await LeaveRecord.findOne({ passId: req.params.passId });
  if (record) {
    if (record.passVerificationToken !== token) return res.status(403).json({ error: 'Invalid gate pass token.' });

    return res.json({
      passId: record.passId,
      emergencyVerificationCode: record.emergencyVerificationCode || record.passVerificationToken,
      gatePassCode: record.emergencyVerificationCode || record.passVerificationToken,
      name: record.name,
      roll: record.roll,
      email: record.email,
      studentId: record.studentId,
      batch: record.batch,
      course: record.course,
      leaveType: record.leaveType,
      reason: record.leaveReason,
      dest: record.dest,
      fromDate: record.fromDate,
      toDate: record.toDate,
      returnDate: record.returnDate,
      approvedBy: record.approvedBy,
      approvedAt: record.approvedAt,
      codeStatus: record.expired ? 'closed' : (record.status === 'out' ? 'active' : 'approved'),
      expired: record.expired === true,
      generatedAt: record.passIssuedAt || record.approvedAt || record.checkOutDate || new Date()
    });
  }

  const cadet = await Cadet.findOne({
    'pendingLeave.passId': req.params.passId,
    'pendingLeave.approvalStatus': 'approved'
  });
  if (!cadet || !cadet.pendingLeave) return res.status(404).json({ error: 'Gate pass not found.' });
  if (cadet.pendingLeave.passVerificationToken !== token) return res.status(403).json({ error: 'Invalid gate pass token.' });

  const leaveWindow = resolveLeaveWindow(cadet.pendingLeave);
  return res.json({
    passId: cadet.pendingLeave.passId,
    emergencyVerificationCode: cadet.pendingLeave.emergencyVerificationCode || cadet.pendingLeave.passVerificationToken,
    gatePassCode: cadet.pendingLeave.emergencyVerificationCode || cadet.pendingLeave.passVerificationToken,
    name: cadet.name,
    roll: cadet.roll,
    email: cadet.email,
    studentId: cadet.studentId,
    batch: cadet.batch,
    course: cadet.course,
    leaveType: cadet.pendingLeave.leaveType,
    reason: cadet.pendingLeave.reason,
    dest: cadet.pendingLeave.dest,
    fromDate: leaveWindow.fromDate,
    toDate: leaveWindow.toDate,
    returnDate: leaveWindow.returnDate,
    approvedBy: cadet.pendingLeave.reviewedBy,
    approvedAt: cadet.pendingLeave.reviewedAt,
    codeStatus: cadet.pendingLeave.travelStatus === 'checked_out' ? 'active' : 'approved',
    expired: false,
    generatedAt: cadet.pendingLeave.reviewedAt || cadet.pendingLeave.requestedAt || new Date()
  });
}));

app.post('/api/leave/generate-pass', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const { cadetId, leaveType, dateOut, timeOut, dateIn, timeIn, purpose, dateOfReturn } = req.body || {};
  if (!cadetId) return res.status(400).json({ error: 'cadetId is required.' });
  if (!isLeaveTypeValid(leaveType)) return res.status(400).json({ error: 'leaveType must be Medical, Special Leave, or Others.' });
  if (!dateOut || !dateIn || !timeOut || !timeIn || !purpose) {
    return res.status(400).json({ error: 'dateOut, timeOut, dateIn, timeIn, and purpose are required.' });
  }
  if (leaveType === 'Others' && !dateOfReturn) {
    return res.status(400).json({ error: 'Date of Return is required for Others leave.' });
  }

  const fromDate = parseDateValue(dateOut);
  const toDate = parseDateValue(dateIn);
  const returnDate = dateOfReturn ? parseDateValue(dateOfReturn) : null;
  if (!fromDate || !toDate) return res.status(400).json({ error: 'dateOut and dateIn must be valid dates.' });
  if (endOfDay(toDate) < startOfDay(fromDate)) return res.status(400).json({ error: 'dateIn cannot be earlier than dateOut.' });
  if (returnDate && endOfDay(returnDate) < startOfDay(toDate)) {
    return res.status(400).json({ error: 'Date of Return cannot be earlier than dateIn.' });
  }

  const cadet = await Cadet.findOne({
    $or: [
      { studentId: String(cadetId).trim() },
      { serialNo: String(cadetId).trim() },
      { roll: normalizeRoll(cadetId) }
    ]
  });
  if (!cadet) return res.status(404).json({ error: 'Cadet not found.' });
  if (isLeaveBlockActive(cadet)) return sendLeaveBlockedResponse(res, cadet);

  const passId = await generateUniquePassId();
  const issuedAt = new Date();
  const emergencyVerificationCode = await generateUniqueEmergencyVerificationCode(passId);

  const record = await LeaveRecord.create({
    roll: cadet.roll,
    name: cadet.name,
    email: cadet.email,
    batch: cadet.batch,
    course: cadet.course,
    studentId: cadet.studentId,
    dest: purpose,
    checkOutTime: timeOut,
    checkInTime: timeIn,
    checkOutDate: startOfDay(fromDate),
    checkInDate: endOfDay(toDate),
    fromDate: startOfDay(fromDate),
    toDate: endOfDay(toDate),
    fromTime: timeOut,
    toTime: timeIn,
    returnDate: returnDate ? endOfDay(returnDate) : null,
    status: 'pass_generated',
    leaveType,
    leaveReason: purpose,
    approvalStatus: 'approved',
    approvedBy: req.officer.username,
    approvedAt: issuedAt,
    passId,
    passVerificationToken: emergencyVerificationCode,
    emergencyVerificationCode,
    emergencyCodeGeneratedAt: issuedAt,
    emergencyCodeExpiresAt: endOfDay(toDate),
    emergencyGateOutUsed: false,
    emergencyGateInUsed: false,
    expired: false,
    gatePassMessage: 'Safe Journey',
    passIssuedAt: issuedAt
  });

  const gatePassDelivery = await sendGatePassEmail(req, cadet, {
    passId,
    passVerificationToken: emergencyVerificationCode,
    emergencyVerificationCode,
    leaveType,
    reason: purpose,
    fromDate: record.fromDate,
    toDate: record.toDate,
    returnDate: record.returnDate,
    approvedAt: issuedAt,
    reviewedBy: req.officer.username
  }, {
    beforeSend: async ({ assets }) => {
      applyGatePassAssetMetadata(record, assets);
      await record.save();
    }
  });
  const emailResult = gatePassDelivery.emailResult;

  await AuditLog.create({
    action: 'GATE_PASS_GENERATED',
    roll: cadet.roll,
    details: {
      cadetId: cadet.studentId || cadet.roll,
      passId,
      leaveType,
      dateOut: record.fromDate,
      dateIn: record.toDate,
      generatedBy: req.officer.username,
      emailDeliveryMode: emailResult.deliveryMode || 'unknown'
    }
  });

  res.status(201).json({
    success: true,
    passId,
    gatePassUrl: buildGatePassUrl(req, passId, emergencyVerificationCode),
    emergencyVerificationCode,
    emailResult: publicEmailDeliveryResult(emailResult),
    cadet: mapCadetForGatePass(cadet)
  });
}));

app.post('/api/cadets/checkout', asyncHandler(async (req, res) => {
  const { emergencyCode, emergencyVerificationCode, roll: bodyRoll, faceMatchScore, checkOutPhotoUrl, dest, locationAddress, checkOutLat, checkOutLng, method, nfcUid, uid } = req.body;
  const submittedEmergencyCode = String(emergencyVerificationCode || emergencyCode || '').trim();
  if (String(method || '').toLowerCase() === 'nfc') {
    const result = await verifyNfcTap(nfcUid || uid, 'CHECK_OUT');
    if (!result.success) {
      return res.status(result.httpStatus || 403).json({
        success: false,
        error: result.message || result.reason || 'NFC checkout denied.',
        reason: result.reason
      });
    }
    return res.json(result);
  }

  try {
    let roll = String(bodyRoll || '').trim();
    if (!roll && submittedEmergencyCode) {
      const codeRecord = await LeaveRecord.findOne({ emergencyVerificationCode: submittedEmergencyCode, approvalStatus: 'approved' }).sort({ passIssuedAt: -1 });
      roll = codeRecord?.roll || roll;
    }
    if (!roll) return res.status(400).json({ error: 'Roll number or emergency verification code is required.' });

    const cadet = await Cadet.findOne({ roll });
    if (!cadet) return res.status(404).json({ error: 'Cadet not found' });
    if (cadet.isBlocked) return res.status(403).json({ error: 'Cadet is blocked from shore leave' });
    if (isLeaveBlockActive(cadet)) return sendLeaveBlockedResponse(res, cadet);

    const codeRecord = submittedEmergencyCode
      ? await LeaveRecord.findOne({ roll, emergencyVerificationCode: submittedEmergencyCode, approvalStatus: 'approved' }).sort({ passIssuedAt: -1 })
      : null;
    const generatedPass = !submittedEmergencyCode
      ? await LeaveRecord.findOne({
          roll,
          approvalStatus: 'approved',
          status: { $in: ['approved', 'pass_generated'] }
        }).sort({ passIssuedAt: -1, approvedAt: -1 })
      : null;
    const approvedLeave = codeRecord || generatedPass || cadet.pendingLeave;

    if (!approvedLeave || approvedLeave.approvalStatus !== 'approved') {
       return res.status(403).json({ error: 'Cadet has not requested or approved leave.' });
    }
    if (submittedEmergencyCode && approvedLeave.emergencyVerificationCode !== submittedEmergencyCode && approvedLeave.passVerificationToken !== submittedEmergencyCode) {
      return res.status(403).json({ error: 'This emergency verification code does not match the active approved leave.' });
    }

    const today = new Date();
    const leaveStart = parseDateValue(approvedLeave.fromDate);
    if (leaveStart && today < leaveStart) {
      return res.status(403).json({ error: `This gate pass becomes active on ${formatDate(approvedLeave.fromDate)}.` });
    }
    if (approvedLeave.toDate && today > new Date(approvedLeave.toDate)) {
      return res.status(403).json({ error: 'This gate pass has expired.' });
    }

    const existingOut = await LeaveRecord.findOne({ roll, status: 'out' });
    if (existingOut) return res.status(400).json({ error: 'Already checked out' });

    const verificationImage = extractImageBase64(checkOutPhotoUrl);
    if (!verificationImage) {
      return res.status(400).json({ error: 'A valid checkout face image is required.' });
    }
    const verification = await verifyFaceWithService(verificationImage);
    const confidence = formatConfidenceScore(verification.confidence);
    if (!verification.matched || !matchesCadetFromFaceService(cadet, verification)) {
      await AuditLog.create({
        action: 'CHECKOUT_FAILED_FACE',
        roll,
        details: {
          source: 'insightface',
          matched: !!verification.matched,
          reason: 'identity_verification_failed'
        }
      });
      return res.status(403).json({ error: 'Face Verification Failed. Alert sent to Administrator.' });
    }

    const photoUrl = await saveBase64Image(checkOutPhotoUrl, `${roll}_out`, 'verification-images', 'check-out');
    let gatePassDelivery;
    try {
      gatePassDelivery = await issueGatePassForCheckout(req, cadet, approvedLeave, {
        issuedBy: 'GATE_OFFICER',
        issuedAt: new Date(),
        method: submittedEmergencyCode ? 'EMERGENCY_CODE_CHECKOUT' : 'FACE_CHECKOUT',
        persist: async () => {
          if (!codeRecord) {
            cadet.markModified('pendingLeave');
            await cadet.save();
          } else {
            await codeRecord.save();
          }
        }
      });
    } catch (error) {
      logError(`[CHECKOUT] Gate pass issue failed for ${cadet.roll}`, error);
      await AuditLog.create({
        action: 'GATE_PASS_CHECKOUT_DELIVERY_FAILED',
        roll: cadet.roll,
        details: {
          error: error.message || String(error),
          method: submittedEmergencyCode ? 'EMERGENCY_CODE_CHECKOUT' : 'FACE_CHECKOUT'
        }
      });
      return res.status(502).json({
        success: false,
        error: 'Gate pass generation or storage failed. Cadet was not checked out and no broken email was sent.'
      });
    }

    const checkoutPayload = {
      roll,
      name: cadet.name,
      email: cadet.email,
      studentId: cadet.studentId,
      batch: cadet.batch,
      course: cadet.course,
      dest: approvedLeave.dest || dest,
      status: 'out',
      checkOutTime: nowTime(), checkOutDate: new Date(), checkOutPhotoUrl: photoUrl,
      faceMatchScore: confidence, locationAddress, checkOutLat, checkOutLng,
      fromDate: approvedLeave.fromDate,
      toDate: approvedLeave.toDate,
      fromTime: approvedLeave.fromTime,
      toTime: approvedLeave.toTime,
      returnDate: approvedLeave.returnDate,
      leaveType: approvedLeave.leaveType,
      leaveReason: approvedLeave.reason || approvedLeave.leaveReason,
      leaveDocumentUrl: approvedLeave.documentUrl || approvedLeave.supportingDocument?.publicUrl || approvedLeave.supportingDocument?.url,
      supportingDocument: approvedLeave.supportingDocument || null,
      approvalStatus: approvedLeave.approvalStatus,
      approvedBy: approvedLeave.reviewedBy || approvedLeave.approvedBy,
      approvedAt: approvedLeave.reviewedAt || approvedLeave.approvedAt,
      rejectionReason: approvedLeave.rejectionReason,
      passId: approvedLeave.passId,
      passVerificationToken: approvedLeave.passVerificationToken,
      emergencyVerificationCode: approvedLeave.emergencyVerificationCode || approvedLeave.passVerificationToken,
      emergencyCodeGeneratedAt: approvedLeave.emergencyCodeGeneratedAt,
      emergencyCodeExpiresAt: approvedLeave.emergencyCodeExpiresAt || approvedLeave.toDate,
      emergencyGateOutUsed: !!submittedEmergencyCode,
      emergencyGateOutUsedAt: submittedEmergencyCode ? new Date() : null,
      emergencyGateOutOfficer: submittedEmergencyCode ? 'GATE_OFFICER' : null,
      emergencyGateOutReason: submittedEmergencyCode ? 'Emergency code checkout' : null,
      expired: false,
      gatePassMessage: 'Safe Journey',
      passIssuedAt: approvedLeave.passIssuedAt || new Date(),
      gatePassStatus: approvedLeave.gatePassStatus || 'issued_at_checkout',
      gatePassPdfUrl: approvedLeave.gatePassPdfUrl,
      gatePass: approvedLeave.gatePass,
      storageStatus: approvedLeave.storageStatus,
      storageUploadedAt: approvedLeave.storageUploadedAt,
      gatePassUrl: gatePassDelivery.gatePassUrl,
      gatePassEmailSentAt: approvedLeave.gatePassEmailSentAt
    };

    if (codeRecord) {
      Object.assign(codeRecord, checkoutPayload);
      await codeRecord.save();
    } else {
      await LeaveRecord.create(checkoutPayload);
    }

    cadet.status = 'out';
    cadet.attendanceStatus = 'OUTSIDE';
    cadet.gateStatus = 'OUTSIDE';
    cadet.leaveStatus = 'ON_LEAVE';
    if (!codeRecord) {
      cadet.pendingLeave.checkedOutAt = new Date();
      cadet.pendingLeave.travelStatus = 'checked_out';
      cadet.markModified('pendingLeave');
    }
    await cadet.save();
    await AuditLog.create({
      action: 'CHECKOUT_SUCCESS',
      roll,
      details: {
        source: 'insightface',
        faceMatchScore: confidence,
        cadetId: verification.cadetId || cadet.studentId || cadet.roll,
        cadetName: verification.cadetName || cadet.name,
        passId: approvedLeave.passId,
        gatePassUrl: gatePassDelivery.gatePassUrl
      }
    });
    res.json({ success: true, roll, passId: approvedLeave.passId, gatePassUrl: gatePassDelivery.gatePassUrl, emergencyVerificationCode: approvedLeave.emergencyVerificationCode || approvedLeave.passVerificationToken });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      return res.status(400).json({ error: 'Invalid or expired emergency verification code.' });
    }
    throw err;
  }
}));

app.post('/api/cadets/scan-status', asyncHandler(async (req, res) => {
  const { emergencyCode, emergencyVerificationCode, roll: fallbackRoll } = req.body || {};
  const submittedEmergencyCode = String(emergencyVerificationCode || emergencyCode || '').trim();
  let roll = String(fallbackRoll || '').trim();

  if (!roll && submittedEmergencyCode) {
    const codeRecord = await LeaveRecord.findOne({ emergencyVerificationCode: submittedEmergencyCode }).sort({ passIssuedAt: -1 });
    roll = codeRecord?.roll || roll;
  }

  if (!roll) return res.status(400).json({ error: 'Roll number or emergency verification code is required.' });

  const cadet = await Cadet.findOne({ roll });
  if (!cadet) return res.status(404).json({ error: 'Cadet not found' });

  const activeRecord = await LeaveRecord.findOne({ roll, status: { $in: ['out', 'overdue'] } }).sort({ checkOutDate: -1 });
  const approvedPending = cadet.pendingLeave?.approvalStatus === 'approved' ? cadet.pendingLeave : null;
  const activeToken = activeRecord?.emergencyVerificationCode || activeRecord?.passVerificationToken || cadet.pendingLeave?.emergencyVerificationCode || cadet.pendingLeave?.passVerificationToken || null;
  const emergencyCodeMatchesActiveLeave = !submittedEmergencyCode || !activeToken || activeToken === submittedEmergencyCode;
  const now = new Date();
  const leaveStart = parseDateValue(approvedPending?.fromDate);
  const leaveEnd = parseDateValue(approvedPending?.toDate);
  const insideLeaveWindow = (!leaveStart || now >= leaveStart) && (!leaveEnd || now <= leaveEnd);
  const canCheckOut = !activeRecord && !!approvedPending && emergencyCodeMatchesActiveLeave && insideLeaveWindow;

  res.json({
    roll: cadet.roll,
    name: cadet.name,
    email: cadet.email,
    phone: cadet.contactNo,
    batch: cadet.batch,
    photoUrl: cadet.photoUrl,
    status: activeRecord ? 'out' : 'returned',
    canCheckIn: !!activeRecord && emergencyCodeMatchesActiveLeave && !activeRecord.expired,
    canCheckOut,
    emergencyCodeMatchesActiveLeave,
    activeLeave: activeRecord ? {
      passId: activeRecord.passId,
      leaveType: activeRecord.leaveType,
      dest: activeRecord.dest,
      purpose: activeRecord.leaveReason,
      checkOutTime: activeRecord.checkOutTime,
      checkOutDate: activeRecord.checkOutDate,
      checkOutPhotoUrl: activeRecord.checkOutPhotoUrl,
      returnDate: activeRecord.returnDate || activeRecord.toDate
    } : null,
    approvedLeave: approvedPending ? {
      passId: approvedPending.passId,
      leaveType: approvedPending.leaveType,
      dest: approvedPending.dest,
      purpose: approvedPending.reason || approvedPending.leaveReason,
      fromDate: approvedPending.fromDate,
      toDate: approvedPending.toDate,
      fromTime: approvedPending.fromTime,
      toTime: approvedPending.toTime
    } : null
  });
}));

app.post('/api/cadets/checkin', asyncHandler(async (req, res) => {
  const { emergencyCode, emergencyVerificationCode, roll: bodyRoll, faceMatchScore, checkInPhotoUrl, locationAddress, checkInLat, checkInLng } = req.body;
  const submittedEmergencyCode = String(emergencyVerificationCode || emergencyCode || '').trim();

  try {
    let roll = String(bodyRoll || '').trim();
    if (!roll && submittedEmergencyCode) {
      const codeRecord = await LeaveRecord.findOne({ emergencyVerificationCode: submittedEmergencyCode, status: { $in: ['out', 'overdue'] } }).sort({ checkOutDate: -1 });
      roll = codeRecord?.roll || roll;
    }
    if (!roll) return res.status(400).json({ error: 'Roll number or emergency verification code is required.' });

    const activeRecord = await LeaveRecord.findOne({ roll, status: { $in: ['out', 'overdue'] } });
    if (!activeRecord) return res.status(400).json({ error: 'No active shore leave found.' });
    if (submittedEmergencyCode && activeRecord.emergencyVerificationCode !== submittedEmergencyCode && activeRecord.passVerificationToken !== submittedEmergencyCode) {
      return res.status(403).json({ error: 'This emergency verification code does not match the active leave record.' });
    }
    if (activeRecord.expired) {
      return res.status(403).json({ error: 'This gate pass has already been closed on campus return.' });
    }

    const cadet = await Cadet.findOne({ roll });
    if (!cadet) return res.status(404).json({ error: 'Cadet not found' });

    const verificationImage = extractImageBase64(checkInPhotoUrl);
    if (!verificationImage) {
      return res.status(400).json({ error: 'A valid check-in face image is required.' });
    }
    const verification = await verifyFaceWithService(verificationImage);
    const confidence = formatConfidenceScore(verification.confidence);
    if (!verification.matched || !matchesCadetFromFaceService(cadet, verification)) {
      await AuditLog.create({
        action: 'CHECKIN_FAILED_FACE',
        roll,
        details: {
          source: 'insightface',
          matched: !!verification.matched,
          reason: 'identity_verification_failed'
        }
      });
      return res.status(403).json({ error: 'Face Verification Failed.' });
    }

    const photoUrl = await saveBase64Image(checkInPhotoUrl, `${roll}_in`, 'verification-images', 'check-in');

    const checkInDate = new Date();
    const hoursElapsed = (checkInDate - activeRecord.checkOutDate) / (1000 * 60 * 60);
    
    const returnStatus = returnStatusForRecord(activeRecord, checkInDate);
    activeRecord.status = returnStatus === 'late' ? 'late_return' : 'returned';
    activeRecord.checkInTime = nowTime();
    activeRecord.checkInDate = checkInDate;
    activeRecord.checkInPhotoUrl = photoUrl;
    activeRecord.faceMatchScore = confidence;
    activeRecord.expired = true;
    activeRecord.emergencyGateInUsed = !!submittedEmergencyCode;
    activeRecord.emergencyGateInUsedAt = submittedEmergencyCode ? checkInDate : null;
    activeRecord.emergencyGateInOfficer = submittedEmergencyCode ? 'GATE_OFFICER' : null;
    activeRecord.emergencyGateInReason = submittedEmergencyCode ? 'Emergency code check-in' : null;
    if (locationAddress) activeRecord.locationAddress = locationAddress;
    if (checkInLat) activeRecord.checkInLat = checkInLat;
    if (checkInLng) activeRecord.checkInLng = checkInLng;

    await activeRecord.save();
    const emailResult = await sendWelcomeBackEmail(cadet, activeRecord);
    await awardReturnGamification(cadet, activeRecord, returnStatus);
    const cadetUpdate = activeRecord.leaveType === 'Shore Leave'
      ? { status: 'returned' }
      : { status: 'returned', pendingLeave: null };
    await Cadet.findOneAndUpdate({ roll }, cadetUpdate);
    await AuditLog.create({
      action: 'CHECKIN_SUCCESS',
      roll,
      details: {
        source: 'insightface',
        faceMatchScore: confidence,
        cadetId: verification.cadetId || cadet.studentId || cadet.roll,
        cadetName: verification.cadetName || cadet.name,
        emailDeliveryMode: emailResult.deliveryMode || 'unknown'
      }
    });
    res.json({ success: true, roll });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      return res.status(400).json({ error: 'Invalid or expired emergency verification code.' });
    }
    throw err;
  }
}));

app.post('/api/checkin/emergency-code', asyncHandler(async (req, res) => {
  const rawToken = String(req.body?.token || req.body?.emergencyCode || req.body?.emergencyVerificationCode || '').trim();
  const fallbackRoll = String(req.body?.roll || req.body?.cadetId || '').trim();
  let parsedPayload = null;
  let roll = fallbackRoll;
  let passNo = String(req.body?.passNo || '').trim();
  let tokenForMatch = '';

  if (rawToken) {
    if (rawToken.split('.').length === 3) {
      return res.status(400).json({ error: 'UNSUPPORTED LEGACY TOKEN' });
    } else {
      try {
        parsedPayload = JSON.parse(rawToken);
        roll = parsedPayload.roll || parsedPayload.rollNo || parsedPayload.studentId || parsedPayload.cadetId || roll;
        passNo = parsedPayload.passNo || parsedPayload.passId || passNo;
        tokenForMatch = parsedPayload.emergencyVerificationCode || parsedPayload.token || parsedPayload.passVerificationToken || '';
      } catch (error) {
        tokenForMatch = rawToken;
      }
    }
  }

  roll = normalizeRoll(roll);
  const recordQuery = passNo
    ? { passId: passNo }
    : tokenForMatch
      ? { $or: [{ emergencyVerificationCode: tokenForMatch }, { passVerificationToken: tokenForMatch }] }
      : { roll };

  const activeRecord = await LeaveRecord.findOne({
    ...recordQuery,
    status: { $in: ['out', 'overdue'] }
  }).sort({ checkOutDate: -1, _id: -1 });

  if (!activeRecord) {
    const closedRecord = await LeaveRecord.findOne({
      ...recordQuery,
      status: { $in: ['returned', 'late_return'] }
    }).sort({ checkInDate: -1, _id: -1 });
    if (closedRecord) return res.status(409).json({ error: 'ALREADY CHECKED IN' });
    return res.status(400).json({ error: 'INVALID OR EXPIRED CODE' });
  }

  if (tokenForMatch && activeRecord.emergencyVerificationCode !== tokenForMatch && activeRecord.passVerificationToken !== tokenForMatch) {
    return res.status(403).json({ error: 'INVALID OR EXPIRED CODE' });
  }
  if (activeRecord.expired) {
    return res.status(409).json({ error: 'ALREADY CHECKED IN' });
  }

  const cadet = await Cadet.findOne({ roll: activeRecord.roll });
  if (!cadet) return res.status(404).json({ error: 'INVALID OR EXPIRED CODE' });

  const checkInDate = new Date();
  const returnStatus = returnStatusForRecord(activeRecord, checkInDate);
  activeRecord.status = returnStatus === 'late' ? 'late_return' : 'returned';
  activeRecord.checkInTime = nowTime();
  activeRecord.checkInDate = checkInDate;
  activeRecord.expired = true;
  activeRecord.emergencyGateInUsed = !!tokenForMatch;
  activeRecord.emergencyGateInUsedAt = tokenForMatch ? checkInDate : null;
  activeRecord.emergencyGateInOfficer = tokenForMatch ? 'GATE_OFFICER' : null;
  activeRecord.emergencyGateInReason = tokenForMatch ? 'Emergency code check-in' : null;
  await activeRecord.save();

  await awardReturnGamification(cadet, activeRecord, returnStatus);
  const cadetUpdate = activeRecord.leaveType === 'Shore Leave'
    ? { status: 'returned' }
    : { status: 'returned', pendingLeave: null };
  await Cadet.findOneAndUpdate({ roll: activeRecord.roll }, cadetUpdate);
  await AuditLog.create({
    action: tokenForMatch ? 'EMERGENCY_GATE_IN' : 'CHECKIN_SUCCESS',
    roll: activeRecord.roll,
    details: {
      source: parsedPayload ? 'gate_pass_json' : tokenForMatch ? 'emergency_code' : 'manual',
      passId: activeRecord.passId
    }
  });
  res.json({
    success: true,
    cadet: {
      name: cadet.name || activeRecord.name || activeRecord.roll,
      roll: activeRecord.roll,
      photoUrl: cadet.photoUrl || getFrontFaceImage(cadet) || activeRecord.checkOutPhotoUrl || ''
    },
    leaveType: activeRecord.leaveType || '-',
    timeOut: activeRecord.checkOutTime || '-',
    returnedTime: activeRecord.checkInTime,
    status: activeRecord.status === 'late_return' ? 'LATE RETURN' : 'ON TIME',
    passNo: activeRecord.passId || passNo || ''
  });
}));

const EMERGENCY_GATE_REASONS = new Set([
  'Login Issue',
  'Fingerprint Scanner Failure',
  'Camera Failure',
  'Network Failure',
  'Phone Lost',
  'Emergency',
  'Other'
]);

app.post('/api/gate/emergency-verify', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const roll = normalizeRoll(req.body?.roll || req.body?.cadetRoll || '');
  const code = String(req.body?.emergencyVerificationCode || req.body?.emergencyCode || '').trim();
  const direction = String(req.body?.direction || req.body?.gateDirection || '').trim().toUpperCase();
  const reason = String(req.body?.reason || '').trim();
  const gate = String(req.body?.gate || req.body?.gateName || 'Main Gate').trim();

  if (!roll || !code || !direction || !reason) {
    return res.status(400).json({
      success: false,
      message: 'Roll number, emergency code, direction, and reason are required.'
    });
  }
  if (!EMERGENCY_GATE_REASONS.has(reason)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid emergency verification reason.'
    });
  }

  const cadet = await Cadet.findOne({ roll }).select('-faceDescriptor -faceDescriptors');
  if (!cadet) {
    await AuditLog.create({
      action: 'EMERGENCY_CODE_INVALID',
      roll,
      details: { code, direction, reason, gate, failure: 'CADET_NOT_FOUND', officer: req.user?.username || req.user?.email || req.user?.id }
    });
    return res.status(404).json({ success: false, code: 'CADET_NOT_FOUND', message: 'Cadet not found.' });
  }

  const query = {
    roll: cadet.roll,
    $or: [{ emergencyVerificationCode: code }, { passVerificationToken: code }]
  };
  const record = await LeaveRecord.findOne(query)
    .sort({ checkOutDate: -1, passIssuedAt: -1, createdAt: -1, _id: -1 });

  if (!record) {
    await AuditLog.create({
      action: 'EMERGENCY_CODE_INVALID',
      roll: cadet.roll,
      details: { code, direction, reason, gate, failure: 'NO_MATCHING_LEAVE', officer: req.user?.username || req.user?.email || req.user?.id }
    });
    return res.status(403).json({ success: false, code: 'EMERGENCY_CODE_INVALID', message: 'Invalid emergency verification code.' });
  }

  const now = new Date();
  if (record.emergencyCodeExpiresAt && now > new Date(record.emergencyCodeExpiresAt) && ['OUT', 'CHECK_OUT', 'EXIT'].includes(direction)) {
    await AuditLog.create({
      action: 'EMERGENCY_CODE_EXPIRED',
      roll: cadet.roll,
      details: { passId: record.passId, direction, reason, gate, officer: req.user?.username || req.user?.email || req.user?.id }
    });
    return res.status(403).json({ success: false, code: 'EMERGENCY_CODE_EXPIRED', message: 'Emergency verification code has expired.' });
  }

  const officerId = req.user?.username || req.user?.email || req.user?.id || 'GATE_OFFICER';
  let action;
  if (['OUT', 'CHECK_OUT', 'EXIT'].includes(direction)) {
    if (!['approved', 'pending_exit'].includes(record.status) && record.approvalStatus !== 'approved') {
      return res.status(409).json({ success: false, code: 'INVALID_LEAVE_STATE', message: 'Leave is not approved for gate exit.' });
    }
    record.status = 'out';
    record.checkOutDate = record.checkOutDate || now;
    record.checkOutTime = record.checkOutTime || nowTime();
    record.emergencyGateOutUsed = true;
    record.emergencyGateOutUsedAt = now;
    record.emergencyGateOutOfficer = officerId;
    record.emergencyGateOutReason = reason;
    cadet.status = 'out';
    action = 'EMERGENCY_GATE_OUT';
  } else if (['IN', 'CHECK_IN', 'ENTRY', 'RETURN'].includes(direction)) {
    if (!['out', 'overdue'].includes(record.status)) {
      return res.status(409).json({ success: false, code: 'INVALID_LEAVE_STATE', message: 'Cadet is not currently outside on this leave.' });
    }
    const returnStatus = returnStatusForRecord(record, now);
    record.status = returnStatus === 'late' ? 'late_return' : 'returned';
    record.checkInDate = now;
    record.checkInTime = nowTime();
    record.expired = true;
    record.emergencyGateInUsed = true;
    record.emergencyGateInUsedAt = now;
    record.emergencyGateInOfficer = officerId;
    record.emergencyGateInReason = reason;
    cadet.status = 'returned';
    if (cadet.pendingLeave?.passId === record.passId) cadet.pendingLeave = null;
    action = 'EMERGENCY_GATE_IN';
  } else {
    return res.status(400).json({ success: false, code: 'INVALID_DIRECTION', message: 'Direction must be CHECK_IN or CHECK_OUT.' });
  }

  await Promise.all([record.save(), cadet.save()]);
  await AuditLog.create({
    action,
    roll: cadet.roll,
    details: {
      passId: record.passId,
      reason,
      gate,
      officer: officerId,
      emergencyVerificationCode: code,
      direction
    }
  });

  res.json({
    success: true,
    action,
    cadet: buildCadetDto(cadet),
    leave: {
      passId: record.passId,
      status: record.status,
      checkOutDate: record.checkOutDate,
      checkInDate: record.checkInDate
    }
  });
}));

app.post('/api/cadets/bulk-checkin', asyncHandler(async (req, res) => {
  const { emergencyCode, emergencyVerificationCode, roll: bodyRoll, scannerFrameBase64, checkInTime, locationAddress } = req.body || {};
  const submittedEmergencyCode = String(emergencyVerificationCode || emergencyCode || '').trim();
  let roll = String(bodyRoll || '').trim();

  if (!roll && submittedEmergencyCode) {
    const codeRecord = await LeaveRecord.findOne({
      emergencyVerificationCode: submittedEmergencyCode,
      status: { $in: ['out', 'overdue'] }
    }).sort({ checkOutDate: -1 });
    roll = codeRecord?.roll || roll;
  }

  if (!roll) return res.status(400).json({ error: 'Roll number or emergency verification code is required.' });

  const activeRecord = await LeaveRecord.findOne({ roll, status: { $in: ['out', 'overdue'] } });
  if (!activeRecord) return res.status(400).json({ error: 'No active shore leave found.' });
  if (submittedEmergencyCode && ![activeRecord.emergencyVerificationCode, activeRecord.passVerificationToken].filter(Boolean).includes(submittedEmergencyCode)) {
    return res.status(403).json({ error: 'This emergency verification code does not match the active leave record.' });
  }
  if (activeRecord.expired) {
    return res.status(403).json({ error: 'This leave record has already been closed on campus return.' });
  }

  const cadet = await Cadet.findOne({ roll });
  if (!cadet) return res.status(404).json({ error: 'Cadet not found' });

  const checkInDate = new Date();
  const hoursElapsed = (checkInDate - activeRecord.checkOutDate) / (1000 * 60 * 60);
  const scanPhotoUrl = extractImageBase64(scannerFrameBase64)
    ? await saveBase64Image(scannerFrameBase64, `${roll}_bulk_in`, 'verification-images', 'bulk-check-in')
    : '';

  const returnStatus = returnStatusForRecord(activeRecord, checkInDate);
  activeRecord.status = returnStatus === 'late' ? 'late_return' : 'returned';
  activeRecord.checkInTime = checkInTime || nowTime();
  activeRecord.checkInDate = checkInDate;
  if (scanPhotoUrl) activeRecord.checkInPhotoUrl = scanPhotoUrl;
  activeRecord.expired = true;
  activeRecord.emergencyGateInUsed = !!submittedEmergencyCode;
  activeRecord.emergencyGateInUsedAt = submittedEmergencyCode ? checkInDate : activeRecord.emergencyGateInUsedAt;
  activeRecord.emergencyGateInOfficer = submittedEmergencyCode ? 'GATE_OFFICER' : activeRecord.emergencyGateInOfficer;
  activeRecord.emergencyGateInReason = submittedEmergencyCode ? 'Emergency code bulk check-in' : activeRecord.emergencyGateInReason;
  if (locationAddress) activeRecord.locationAddress = locationAddress;

  await activeRecord.save();
  await awardReturnGamification(cadet, activeRecord, returnStatus);
  const cadetUpdate = activeRecord.leaveType === 'Shore Leave'
    ? { status: 'returned' }
    : { status: 'returned', pendingLeave: null };
  await Cadet.findOneAndUpdate({ roll }, cadetUpdate);
  await AuditLog.create({
    action: submittedEmergencyCode ? 'EMERGENCY_GATE_IN' : 'CHECKIN_SUCCESS_BULK',
    roll,
    details: {
      source: submittedEmergencyCode ? 'emergency_code' : 'manual',
      passId: activeRecord.passId,
      scannerFrameSaved: !!scanPhotoUrl
    }
  });
  res.json({
    success: true,
    roll,
    name: cadet.name,
    checkInTime: activeRecord.checkInTime,
    checkInPhotoUrl: activeRecord.checkInPhotoUrl || ''
  });
}));

// Admin reset
app.post('/api/cadets/reset', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  await LeaveRecord.deleteMany({});
  await Cadet.updateMany({}, { status: 'returned' });
  res.json({ success: true });
}));

app.delete('/api/cadets/:id', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  // Try treating id as roll no for simplicity in mock UI
  await LeaveRecord.deleteMany({ roll: req.params.id });
  res.json({ success: true });
}));

// â”€â”€â”€ CHATBOT API â”€â”€â”€
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
app.post('/api/chatbot', asyncHandler(async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const safeMessage = String(message).slice(0, 2000)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL REDACTED]')
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, '[PHONE REDACTED]')
    .replace(/\bAMET[A-Z/0-9_-]{4,}\b/gi, '[ROLL REDACTED]');
  const safeSessionId = crypto.createHash('sha256').update(String(sessionId || 'anonymous')).digest('hex');

  try {
    let botReply = "I am the institutional support bot. If you are not in the list, please write an email to the Administrator regarding your enrollment enquiry. You must provide your Roll Number and Official Email.";
    
    if (openai) {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: 'You are the official Shore Leave AI Support Bot for AMET Institute. Guide unregistered cadets on enrollment, shore leave, and medical leave workflows. If a cadet says they are not in the system or asks how to enroll, explicitly instruct them to write a mail to the administrator regarding the enquiry.' },
          { role: 'user', content: safeMessage }
        ],
        model: 'gpt-3.5-turbo',
      });
      botReply = completion.choices[0].message.content;
    } else {
      // Mock response for missing keys
      if (safeMessage.toLowerCase().includes('enroll') || safeMessage.toLowerCase().includes('register') || safeMessage.toLowerCase().includes('not in')) {
        botReply = "If your Roll Number is not found in the official Master Database, please write a mail to the Administrator regarding the enquiry to get registered.";
      } else if (safeMessage.toLowerCase().includes('leave')) {
        botReply = "Normal Shore Leave is auto-approved upon entry. Special/Medical Leave requires Administrator or HOD approval. You must be registered first.";
      }
    }

    await ChatbotLog.create({ sessionId: safeSessionId, userMessage: safeMessage, botResponse: botReply });
    res.json({ reply: botReply });
  } catch (err) {
    logError('Chatbot request failed', err);
    res.status(500).json({ error: 'Failed to process message' });
  }
}));

// â”€â”€â”€ ADMIN & DASHBOARD APIs â”€â”€â”€

const DASHBOARD_CACHE_MS = Number(process.env.DASHBOARD_CACHE_MS || 3000);
let dashboardSnapshotCache = { expiresAt: 0, promise: null, value: null };

const DASHBOARD_RECORD_FIELDS = [
  'roll',
  'name',
  'dest',
  'locationAddress',
  'leaveType',
  'status',
  'approvalStatus',
  'checkOutTime',
  'checkInTime',
  'checkOutDate',
  'checkInDate',
  'fromDate',
  'toDate',
  'fromTime',
  'toTime',
  'passIssuedAt',
  'approvedAt',
  'passId',
  'checkOutPhotoUrl',
  'checkInPhotoUrl'
].join(' ');

function normalizeDashboardLeaveType(type) {
  const value = String(type || '').trim().toLowerCase();
  if (value === 'medical' || value === 'medical leave') return 'Medical';
  if (value === 'special' || value === 'special leave') return 'Special Leave';
  if (value === 'shore' || value === 'shore leave') return 'Shore Leave';
  return type || 'Leave';
}

function dashboardRowFromPending(cadet) {
  const leave = cadet.pendingLeave || {};
  const toDate = parseDateValue(leave.toDate);
  const isOverdue = toDate && leave.approvalStatus === 'approved' && new Date() > toDate;
  return {
    roll: cadet.roll,
    name: cadet.name || cadet.roll,
    leaveType: normalizeDashboardLeaveType(leave.leaveType),
    status: isOverdue ? 'overdue' : (leave.approvalStatus || 'pending_approval'),
    approvalStatus: leave.approvalStatus || null,
    fromDate: leave.fromDate || null,
    toDate: leave.toDate || null,
    fromTime: leave.fromTime || '',
    toTime: leave.toTime || '',
    checkOutTime: leave.fromDate ? formatDate(leave.fromDate) : '-',
    checkInTime: leave.toDate ? formatDate(leave.toDate) : '-',
    locationAddress: leave.dest || '-',
    checkOutDate: leave.fromDate || leave.requestedAt || null,
    checkInDate: null,
    sortAt: leave.requestedAt || leave.fromDate || new Date(0),
    source: 'pendingLeave'
  };
}

function dashboardRowFromRecord(record) {
  const row = record.toObject ? record.toObject() : record;
  const isOverdue = row.toDate && !row.checkInDate && new Date() > new Date(row.toDate);
  return {
    ...row,
    leaveType: normalizeDashboardLeaveType(row.leaveType),
    status: isOverdue ? 'overdue' : (row.status || 'approved'),
    sortAt: row.checkInDate || row.checkOutDate || row.passIssuedAt || row.approvedAt || new Date(0),
    source: 'leaveRecord'
  };
}

function parseDashboardTimeMinutes(value) {
  if (!value) return null;
  const text = String(value).trim();
  let match = text.match(/^(\d{1,2}):(\d{2})/);
  if (match) return (Number(match[1]) * 60) + Number(match[2]);

  match = text.match(/^(\d{1,2})(\d{2})$/);
  if (match) return (Number(match[1]) * 60) + Number(match[2]);

  match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (match) {
    let hours = Number(match[1]);
    const minutes = Number(match[2] || 0);
    const suffix = match[3].toUpperCase();
    if (suffix === 'PM' && hours < 12) hours += 12;
    if (suffix === 'AM' && hours === 12) hours = 0;
    return (hours * 60) + minutes;
  }

  return null;
}

function recordCheckoutMinutes(record) {
  const checkoutDate = parseDateValue(record.checkOutDate);
  if (checkoutDate) return (checkoutDate.getHours() * 60) + checkoutDate.getMinutes();
  return parseDashboardTimeMinutes(record.checkOutTime);
}

function dashboardFilterStatus(record) {
  if (record.status === 'out') return 'Currently Outside';
  if (record.status === 'overdue' || (record.toDate && !record.checkInDate && new Date() > new Date(record.toDate))) return 'Overdue';
  if (record.status === 'returned' || record.status === 'late_return' || record.checkInDate) return 'Returned';
  if (record.status === 'pending_approval') return 'Pending HOD';
  return record.status === 'approved' ? 'Outside' : (record.status || 'Outside');
}

async function buildDashboardSnapshot() {
  const now = new Date();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const [records, cadetsWithPending, totalCadets, blockedCadets] = await Promise.all([
    LeaveRecord.find()
      .select(DASHBOARD_RECORD_FIELDS)
      .sort({ checkOutDate: -1, passIssuedAt: -1, _id: -1 })
      .limit(250)
      .lean(),
    Cadet.find({ pendingLeave: { $ne: null } })
      .select('roll name email pendingLeave status')
      .lean(),
    Cadet.countDocuments(),
    Cadet.countDocuments({
      leaveBlocked: true,
      $or: [
        { leaveBlockedUntil: null },
        { leaveBlockedUntil: { $exists: false } },
        { leaveBlockedUntil: { $gt: now } }
      ]
    })
  ]);

  const rowsByKey = new Map();
  records.forEach(record => {
    const row = dashboardRowFromRecord(record);
    rowsByKey.set(row.passId ? `${row.roll}:${row.passId}` : `${row.roll}:record:${record._id}`, row);
  });

  cadetsWithPending.forEach(cadet => {
    if (!cadet.pendingLeave || cadet.pendingLeave.approvalStatus === 'rejected') return;
    const key = cadet.pendingLeave.passId
      ? `${cadet.roll}:${cadet.pendingLeave.passId}`
      : `${cadet.roll}:pending:${cadet.pendingLeave.requestId || 'active'}`;
    if (!rowsByKey.has(key)) rowsByKey.set(key, dashboardRowFromPending(cadet));
  });

  const allRows = Array.from(rowsByKey.values());
  const activeRows = allRows.filter(row => !['returned', 'late_return', 'rejected'].includes(row.status));
  const todayCheckins = allRows
    .filter(row => row.checkInDate && new Date(row.checkInDate) >= startOfToday && new Date(row.checkInDate) < endOfToday)
    .sort((a, b) => new Date(b.checkInDate) - new Date(a.checkInDate));
  const recentCheckins = todayCheckins.slice(0, 8);
  const pendingHodCount = cadetsWithPending
    .filter(cadet => cadet.pendingLeave?.approvalStatus === 'pending_approval')
    .length;

  const byType = type => activeRows.filter(row => row.leaveType === type).length;
  const pendingByType = type => allRows.filter(row => row.leaveType === type && row.approvalStatus === 'pending_approval').length;
  const rejectedByType = type => allRows.filter(row => row.leaveType === type && (row.approvalStatus === 'rejected' || row.status === 'rejected')).length;
  const expiredByType = type => allRows.filter(row => row.leaveType === type && (row.status === 'overdue' || row.status === 'expired')).length;
  const stats = {
    totalShoreLeave: byType('Shore Leave'),
    totalMedicalLeave: byType('Medical'),
    totalSpecialLeave: byType('Special Leave'),
    totalOverdue: activeRows.filter(row => row.status === 'overdue' || (row.toDate && !row.checkInDate && now > new Date(row.toDate))).length,
    totalPendingHodApproval: pendingHodCount,
    totalCheckedInToday: todayCheckins.length,
    totalCheckedOut: activeRows.filter(row => row.status === 'out').length,
    totalLateReturns: allRows.filter(row => row.status === 'late_return').length,
    totalLeavesToday: allRows.filter(row => row.checkOutDate && new Date(row.checkOutDate) >= startOfToday && new Date(row.checkOutDate) < endOfToday).length,
    totalCadets,
    blockedCadets,
    blockedCadetPercentage: totalCadets ? Math.round((blockedCadets / totalCadets) * 100) : 0
  };

  const liveStatus = activeRows
    .sort((a, b) => new Date(b.sortAt || 0) - new Date(a.sortAt || 0))
    .slice(0, 50);

  return {
    stats,
    liveStatus,
    recentCheckins,
    chart: {
      labels: ['Shore', 'Medical', 'Special', 'Overdue', 'Checked In'],
      active: [stats.totalShoreLeave, stats.totalMedicalLeave, stats.totalSpecialLeave, stats.totalOverdue, stats.totalCheckedInToday],
      pending: [
        pendingByType('Shore Leave'),
        pendingByType('Medical'),
        pendingByType('Special Leave'),
        0,
        0
      ],
      rejected: [
        rejectedByType('Shore Leave'),
        rejectedByType('Medical'),
        rejectedByType('Special Leave'),
        0,
        0
      ],
      expired: [
        0,
        0,
        0,
        expiredByType('Shore Leave') + expiredByType('Medical') + expiredByType('Special Leave'),
        0
      ]
    }
  };
}

function getCachedDashboardSnapshot() {
  const now = Date.now();
  if (dashboardSnapshotCache.value && dashboardSnapshotCache.expiresAt > now) {
    return Promise.resolve(dashboardSnapshotCache.value);
  }
  if (dashboardSnapshotCache.promise) return dashboardSnapshotCache.promise;

  dashboardSnapshotCache.promise = buildDashboardSnapshot()
    .then(snapshot => {
      dashboardSnapshotCache.value = snapshot;
      dashboardSnapshotCache.expiresAt = Date.now() + DASHBOARD_CACHE_MS;
      return snapshot;
    })
    .finally(() => {
      dashboardSnapshotCache.promise = null;
    });

  return dashboardSnapshotCache.promise;
}

app.get('/api/dashboard/live', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  res.json(await getCachedDashboardSnapshot());
}));

app.get('/api/dashboard/filter', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const { date, timeFrom, timeTo, leaveType, status } = req.query;
  const selectedDate = parseDateValue(date) || new Date();
  const start = startOfDay(selectedDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const fromMinutes = parseDashboardTimeMinutes(timeFrom);
  const toMinutes = parseDashboardTimeMinutes(timeTo);

  const query = {
    $or: [
      { checkOutDate: { $gte: start, $lt: end } },
      { fromDate: { $gte: start, $lt: end } },
      { fromDate: { $lt: end }, toDate: { $gte: start } }
    ]
  };

  const [records, cadetsWithPending] = await Promise.all([
    LeaveRecord.find(query)
      .select(DASHBOARD_RECORD_FIELDS)
      .sort({ checkOutDate: -1, fromDate: -1, _id: -1 })
      .lean(),
    Cadet.find({
      pendingLeave: { $ne: null },
      $or: [
        { 'pendingLeave.fromDate': { $gte: start, $lt: end } },
        { 'pendingLeave.requestedAt': { $gte: start, $lt: end } },
        { 'pendingLeave.fromDate': { $lt: end }, 'pendingLeave.toDate': { $gte: start } }
      ]
    })
      .select('roll name email pendingLeave status')
      .lean()
  ]);
  const normalizedType = leaveType && leaveType !== 'All Types' ? normalizeDashboardLeaveType(leaveType) : null;
  const normalizedStatus = String(status || 'All').toLowerCase();

  const rowsByKey = new Map();
  records.forEach(record => {
    const row = dashboardRowFromRecord(record);
    rowsByKey.set(row.passId ? `${row.roll}:${row.passId}` : `${row.roll}:record:${record._id}`, row);
  });
  cadetsWithPending.forEach(cadet => {
    if (!cadet.pendingLeave || cadet.pendingLeave.approvalStatus === 'rejected') return;
    const row = dashboardRowFromPending(cadet);
    const key = cadet.pendingLeave.passId
      ? `${cadet.roll}:${cadet.pendingLeave.passId}`
      : `${cadet.roll}:pending:${cadet.pendingLeave.requestId || 'active'}`;
    if (!rowsByKey.has(key)) rowsByKey.set(key, row);
  });

  const results = Array.from(rowsByKey.values())
    .filter(record => {
      if (normalizedType && record.leaveType !== normalizedType) return false;
      const minutes = recordCheckoutMinutes(record);
      if (fromMinutes !== null && (minutes === null || minutes < fromMinutes)) return false;
      if (toMinutes !== null && (minutes === null || minutes > toMinutes)) return false;

      const displayStatus = dashboardFilterStatus(record).toLowerCase();
      if (normalizedStatus === 'currently outside') return displayStatus === 'currently outside' || displayStatus === 'outside';
      if (normalizedStatus === 'returned') return displayStatus === 'returned';
      if (normalizedStatus === 'overdue') return displayStatus === 'overdue';
      return true;
    })
    .sort((a, b) => new Date(b.sortAt || b.checkOutDate || b.fromDate || 0) - new Date(a.sortAt || a.checkOutDate || a.fromDate || 0))
    .map(record => ({
      name: record.name || '-',
      roll: record.roll || '-',
      leaveType: record.leaveType || '-',
      checkOutTime: record.checkOutTime || '-',
      checkInTime: record.checkInTime || (record.leaveType === 'Shore Leave' ? '18:00' : '-'),
      status: dashboardFilterStatus(record),
      destination: record.dest || record.locationAddress || '-',
      fromDate: record.fromDate || record.checkOutDate || null,
      toDate: record.toDate || null,
      fromTime: record.fromTime || record.checkOutTime || '',
      toTime: record.toTime || record.checkInTime || '',
      checkOutDate: record.checkOutDate || record.fromDate || null,
      checkInDate: record.checkInDate || null,
      checkOutPhotoUrl: record.checkOutPhotoUrl || '',
      checkInPhotoUrl: record.checkInPhotoUrl || ''
    }));

  res.json({
    results,
    count: results.length,
    filters: {
      date: start.toISOString().slice(0, 10),
      timeFrom: timeFrom || '',
      timeTo: timeTo || '',
      leaveType: leaveType || 'All Types',
      status: status || 'All'
    }
  });
}));

// Report Settings
app.get('/api/reports/settings', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const settings = await getReportSettings();
  res.json({ success: true, settings });
}));

app.put('/api/reports/settings', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const updates = {};
  if (typeof req.body.enabled === 'boolean') updates.enabled = req.body.enabled;
  if (typeof req.body.runTime === 'string') updates.runTime = req.body.runTime.trim();
  if (Array.isArray(req.body.recipients)) {
    updates.recipients = req.body.recipients.map(normalizeEmail).filter(Boolean);
  }
  if (Array.isArray(req.body.formats)) {
    updates.formats = req.body.formats.map((format) => String(format).toLowerCase()).filter(Boolean);
  }
  updates.updatedBy = req.officer.username;
  updates.updatedAt = new Date();

  const settings = await ReportSettings.findOneAndUpdate(
    { singleton: 'default' },
    { $set: updates, $setOnInsert: { singleton: 'default' } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  await AuditLog.create({ action: 'REPORT_SETTINGS_UPDATED', details: { updatedBy: req.officer.username, settings } });
  res.json({ success: true, settings });
}));

app.patch('/api/reports/settings', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  req.method = 'PUT';
  const updates = {};
  if (typeof req.body.enabled === 'boolean') updates.enabled = req.body.enabled;
  if (typeof req.body.runTime === 'string') updates.runTime = req.body.runTime.trim();
  if (Array.isArray(req.body.recipients)) updates.recipients = req.body.recipients.map(normalizeEmail).filter(Boolean);
  if (Array.isArray(req.body.formats)) updates.formats = req.body.formats.map((format) => String(format).toLowerCase()).filter(Boolean);
  updates.updatedBy = req.officer.username;
  updates.updatedAt = new Date();

  const settings = await ReportSettings.findOneAndUpdate(
    { singleton: 'default' },
    { $set: updates, $setOnInsert: { singleton: 'default' } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  await AuditLog.create({ action: 'REPORT_SETTINGS_UPDATED', details: { updatedBy: req.officer.username, settings } });
  res.json({ success: true, settings });
}));

// Daily Reports
app.get(['/api/reports/daily', '/api/admin/reports/daily'], authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const date = parseReportDate(req.query.date);
  const summary = await buildDailyReportSummary(date);
  const reports = await DailyReport.find({ reportDate: summary.range.start })
    .sort({ generatedAt: -1 })
    .lean();
  res.json({ success: true, date: summary.date, range: summary.range, summary, reports });
}));

app.post(['/api/reports/generate', '/api/reports/daily/generate'], authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const date = parseReportDate(req.body.date || req.query.date);
  const format = String(req.body.format || req.query.format || 'pdf').toLowerCase();
  if (format !== 'pdf') {
    return res.status(400).json({ success: false, error: 'Only PDF report generation is currently supported' });
  }

  const summary = await buildDailyReportSummary(date);
  try {
    const generated = await uploadDailyReport(summary, format, req.officer.username);
    await AuditLog.create({
      action: 'DAILY_REPORT_GENERATED',
      details: { generatedBy: req.officer.username, date: summary.date, reportId: generated.report._id, path: generated.report.storagePath }
    });
    res.json({ success: true, report: generated.report, uploaded: generated.uploaded, summary });
  } catch (error) {
    logError('Daily report generation failed', error);
    await AuditLog.create({
      action: 'DAILY_REPORT_GENERATION_FAILED',
      details: { generatedBy: req.officer.username, date: summary.date, error: error.message }
    });
    res.status(502).json({ success: false, error: 'Daily report generation failed', details: error.message });
  }
}));

// Gate-issued OTP
app.post(['/api/gate/otp/generate', '/api/gate/generate-otp'], authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const purpose = String(req.body.purpose || 'VERIFY').toUpperCase();
  if (!['CHECK_IN', 'CHECK_OUT', 'VERIFY'].includes(purpose)) {
    return res.status(400).json({ success: false, error: 'Invalid gate OTP purpose' });
  }

  const normRoll = normalizeRoll(req.body.roll || req.body.studentId || req.body.cadetId);
  const cadetSelectors = [
    { roll: normRoll },
    { studentId: normRoll },
    { serialNo: normRoll },
    { _id: mongoose.Types.ObjectId.isValid(req.body.cadetId) ? req.body.cadetId : undefined }
  ].filter((item) => Object.values(item)[0]);
  if (cadetSelectors.length === 0) {
    return res.status(400).json({ success: false, error: 'Cadet roll number or id is required' });
  }
  const cadet = await Cadet.findOne({ $or: cadetSelectors });
  if (!cadet) {
    return res.status(404).json({ success: false, error: 'Cadet not found' });
  }

  const validation = await evaluateGateOtpEligibility(cadet, purpose);
  if (!validation.allowed) {
    await AuditLog.create({ action: 'GATE_OTP_DENIED', details: { roll: cadet.roll, purpose, reason: validation.reason, issuedBy: req.officer.username } });
    return res.status(403).json({ success: false, error: validation.reason, validation });
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const sessionToken = crypto.randomUUID();
  const otpHash = await bcrypt.hash(otp, 12);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await GateOTP.deleteMany({ roll: cadet.roll, purpose, verified: false });
  const gateOtp = await GateOTP.create({
    roll: cadet.roll,
    email: cadet.email,
    purpose,
    otpHash,
    sessionToken,
    expiresAt,
    issuedBy: req.officer.username,
    lastSentAt: new Date(),
    validation
  });

  if (cadet.email) {
    await sendSystemEmail({
      to: cadet.email,
      subject: `Shore Leave Gate OTP - ${purpose.replace('_', ' ')}`,
      text: `Your gate OTP is ${otp}. It expires in 5 minutes.`,
      html: `<p>Your gate OTP is <strong>${otp}</strong>.</p><p>It expires in 5 minutes.</p>`
    });
  }

  await AuditLog.create({ action: 'GATE_OTP_GENERATED', details: { roll: cadet.roll, purpose, issuedBy: req.officer.username, emailSent: !!cadet.email } });
  const payload = {
    success: true,
    sessionToken: gateOtp.sessionToken,
    expiresAt: gateOtp.expiresAt,
    expiresIn: 300,
    purpose,
    deliveryMode: cadet.email ? 'email' : 'none',
    cadet: buildCadetDto(cadet),
    validation
  };
  if (process.env.EXPOSE_TEST_OTPS === 'true') payload.testOtp = otp;
  res.json(payload);
}));

app.post(['/api/gate/otp/verify', '/api/gate/verify-otp'], authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const otp = String(req.body.otp || '').trim();
  const purpose = String(req.body.purpose || 'VERIFY').toUpperCase();
  const normRoll = normalizeRoll(req.body.roll || req.body.studentId);
  if (!otp || otp.length !== 6) {
    return res.status(400).json({ success: false, error: 'A valid 6-digit OTP is required' });
  }

  const query = {
    verified: false,
    expiresAt: { $gt: new Date() },
    ...(req.body.sessionToken ? { sessionToken: req.body.sessionToken } : {}),
    ...(normRoll ? { roll: normRoll } : {}),
    ...(purpose ? { purpose } : {})
  };
  const gateOtp = await GateOTP.findOne(query).sort({ issuedAt: -1 });
  if (!gateOtp) {
    return res.status(400).json({ success: false, error: 'Gate OTP is invalid or expired' });
  }
  if (gateOtp.attempts >= gateOtp.maxAttempts) {
    return res.status(429).json({ success: false, error: 'Gate OTP attempt limit reached' });
  }

  gateOtp.attempts += 1;
  const valid = await bcrypt.compare(otp, gateOtp.otpHash);
  if (!valid) {
    await gateOtp.save();
    await AuditLog.create({ action: 'GATE_OTP_VERIFY_FAILED', details: { roll: gateOtp.roll, purpose: gateOtp.purpose, attempts: gateOtp.attempts } });
    return res.status(401).json({ success: false, error: 'Invalid gate OTP', attemptsRemaining: Math.max(gateOtp.maxAttempts - gateOtp.attempts, 0) });
  }

  const cadet = await Cadet.findOne({ roll: gateOtp.roll });
  if (!cadet) {
    return res.status(404).json({ success: false, error: 'Cadet not found for this OTP' });
  }
  const validation = await evaluateGateOtpEligibility(cadet, gateOtp.purpose);
  if (!validation.allowed) {
    return res.status(403).json({ success: false, error: validation.reason, validation });
  }

  gateOtp.verified = true;
  gateOtp.verifiedAt = new Date();
  gateOtp.validation = validation;
  await gateOtp.save();
  await AuditLog.create({ action: 'GATE_OTP_VERIFIED', details: { roll: cadet.roll, purpose: gateOtp.purpose, verifiedBy: req.officer.username } });

  res.json({
    success: true,
    verified: true,
    purpose: gateOtp.purpose,
    cadet: buildCadetDto(cadet),
    gatePass: mapCadetForGatePass(cadet),
    validation
  });
}));

// Emergency verification analytics and statistics
app.get(['/api/emergency-codes/analytics', '/api/admin/emergency-codes/analytics'], authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const analytics = await buildEmergencyCodeAnalytics(req.query.from, req.query.to);
  res.json({ success: true, analytics });
}));

app.get(['/api/emergency-codes/statistics', '/api/admin/emergency-codes/statistics'], authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const analytics = await buildEmergencyCodeAnalytics(req.query.from, req.query.to);
  res.json({
    success: true,
    range: analytics.range,
    statistics: analytics.totals,
    hourly: analytics.hourly,
    topPasses: analytics.topPasses
  });
}));

// Stats
app.get('/api/stats', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  try {
    const snapshot = await buildDashboardSnapshot();
    res.json(snapshot.stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
}));

// Audit Logs
app.get('/api/audit-logs', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  try {
    const logs = await AuditLog.find().sort({ timestamp: -1 }).limit(100);
    res.json(logs.map(publicAuditRecord));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
}));

// Admin Cadets CRUD
app.get('/api/admin/cadets', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const cadets = await Cadet.find().select('-faceDescriptor -faceDescriptors').sort({ name: 1, roll: 1 });
  res.json(cadets.map(publicCadetRecord));
}));

app.delete('/api/admin/cadets/:roll/face', authenticateJWT, requireAdmin, asyncHandler(async (req, res) => {
  const roll = normalizeRoll(req.params.roll);
  const cadet = await Cadet.findOne({ roll });

  if (!cadet) {
    return res.status(404).json({ success: false, message: 'Cadet not found.' });
  }

  const existingEmbedding = await findFaceEmbeddingForCadet(cadet);
  const hasDescriptor = !!getPrimaryFaceDescriptor(cadet);
  const hasStoredFaceImage = !!(
    cadet.faceImages?.front ||
    cadet.faceImages?.left ||
    cadet.faceImages?.right ||
    extractSupabaseStorageObject(cadet.photoUrl, 'face-images')
  );
  const isMarkedEnrolled = cadet.faceEnrollmentData?.enrolled === true;

  if (!existingEmbedding && !hasDescriptor && !hasStoredFaceImage && !isMarkedEnrolled) {
    return res.status(404).json({ success: false, message: 'No enrolled face found.' });
  }

  let storageDeletion;
  try {
    storageDeletion = await deleteCadetFaceImagesFromStorage(cadet);
  } catch (error) {
    logError('[FACE_DELETE] Supabase face image delete failed', error);
    return res.status(502).json({
      success: false,
      message: 'Face image storage deletion failed. Face enrollment was not changed.'
    });
  }

  const embeddingDeletion = await deleteFaceEmbeddingsForCadet(cadet);
  const previousPhotoUrl = cadet.photoUrl || null;
  const previousFrontFaceUrl = cadet.faceImages?.front || null;
  const photoIsFaceStorageObject = !!extractSupabaseStorageObject(previousPhotoUrl, 'face-images');

  cadet.faceEnrollmentData = {
    ...(cadet.faceEnrollmentData?.toObject ? cadet.faceEnrollmentData.toObject() : (cadet.faceEnrollmentData || {})),
    enrolled: false,
    enrolledAt: null,
    enrolledBy: null,
    deviceInfo: null,
    lastUpdated: new Date()
  };
  cadet.faceDescriptor = [];
  cadet.faceDescriptors = [];
  cadet.faceImages = { front: null, left: null, right: null };
  if ((previousFrontFaceUrl && previousPhotoUrl === previousFrontFaceUrl) || (!previousFrontFaceUrl && photoIsFaceStorageObject)) {
    cadet.photoUrl = null;
  }
  cadet.markModified('faceEnrollmentData');
  cadet.markModified('faceImages');
  cadet.markModified('faceDescriptor');
  cadet.markModified('faceDescriptors');
  await cadet.save();

  await AuditLog.create({
    action: 'FACE_DELETED',
    roll: cadet.roll,
    details: {
      cadetRoll: cadet.roll,
      cadetName: cadet.name || cadet.roll,
      adminUserId: req.user?.username || req.user?.id || req.user?._id || req.officer?.username || null,
      adminUsername: actorUsername(req),
      ipAddress: getRequestIp(req),
      deletedAt: new Date(),
      embeddingsDeleted: embeddingDeletion.deletedCount || 0,
      storageDeletion
    }
  });

  res.json({ success: true, message: 'Face enrollment deleted successfully.' });
}));

app.get('/api/admin/cadets/:roll', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const cadet = await Cadet.findOne({ roll: normalizeRoll(req.params.roll) }).select('-faceDescriptor -faceDescriptors');
  if (!cadet) return res.status(404).json({ error: 'Cadet Record Not Found' });
  res.json(publicCadetRecord(cadet));
}));

app.post('/api/admin/cadets', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  let payload;
  try {
    payload = buildCadetMutationPayload(req.body, { requireRoll: true });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }
  const exists = await Cadet.findOne({ roll: payload.roll }).select('roll');
  if (exists) return res.status(409).json({ error: 'Cadet already exists for this roll number.' });

  const cadet = await Cadet.create({
    ...payload,
    status: payload.status || 'returned',
    attendanceStatus: 'INSIDE',
    leaveStatus: 'NONE',
    gateStatus: 'INSIDE',
    enrollmentStatus: payload.enrollmentStatus || 'ACTIVE',
    fingerprintEnrolled: false,
    fingerprintTemplateId: null,
    fingerprintLastUpdated: null
  });
  await AuditLog.create({
    action: 'CADET_CREATED',
    roll: cadet.roll,
    details: { createdBy: actorUsername(req), cadet: buildCadetDto(cadet) }
  });
  res.status(201).json({ success: true, cadet: publicCadetRecord(cadet) });
}));

app.put('/api/admin/cadets/:roll', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const roll = normalizeRoll(req.params.roll);
  if (!roll) return res.status(400).json({ error: 'Cadet roll number is required.' });

  let payload;
  try {
    payload = buildCadetMutationPayload({ ...req.body, roll });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }
  delete payload.roll;
  delete payload.rollNumber;

  const before = await Cadet.findOne({ roll }).select('-faceDescriptor -faceDescriptors');
  if (!before) return res.status(404).json({ error: 'Cadet Record Not Found' });

  const cadet = await Cadet.findOneAndUpdate(
    { roll },
    { $set: payload },
    { returnDocument: 'after', runValidators: true }
  ).select('-faceDescriptor -faceDescriptors');

  await AuditLog.create({
    action: 'CADET_UPDATED',
    roll,
    details: {
      updatedBy: actorUsername(req),
      fields: Object.keys(payload),
      before: publicCadetRecord(before),
      after: publicCadetRecord(cadet)
    }
  });
  res.json({ success: true, cadet: publicCadetRecord(cadet) });
}));

app.post('/api/admin/import-cadets', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const { cadets } = req.body || {};
  if (!Array.isArray(cadets)) return res.status(400).json({ error: 'cadets array is required' });
  if (cadets.length === 0) return res.status(400).json({ error: 'At least one cadet row is required' });
  if (cadets.length > 5000) return res.status(413).json({ error: 'A maximum of 5000 cadets can be imported at once' });

  const inferImportBranch = (value) => {
    const text = String(value || '').toLowerCase();
    if (text.includes('b.sc') || text.includes('bsc') || text.includes('nautical')) return 'BSC';
    if (text.includes('b.e') || text.includes('bme') || text.includes('marine engineering')) return 'BME';
    return String(value || '').trim();
  };
  const inferImportYear = (row) => {
    const explicit = Number(row.year || row.current_year || row.study_year);
    if (Number.isInteger(explicit) && explicit >= 1 && explicit <= 6) return explicit;
    const roll = String(row.application_no || row.roll || row.roll_number || '');
    return roll.includes('/2025/') ? 1 : NaN;
  };
  const inferImportBatch = (row, branch) => {
    const batch = String(row.batch || '').trim();
    if (batch) return batch;
    const roll = String(row.application_no || row.roll || row.roll_number || '');
    return roll.includes('/2025/') ? '2025-2028 Batch 2' : branch;
  };

  let imported = 0;
  let skipped = 0;
  const failed = [];
  const skippedRows = [];
  const seenRolls = new Set();
  const seenEmails = new Set();
  const prepared = [];
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  cadets.forEach((row, index) => {
    const rowNumber = index + 2;
    const roll = normalizeRoll(row.application_no || row.roll || row.roll_number || '');
    const name = String(row.full_name || row.name || '').trim();
    const email = normalizeEmail(row.email_id || row.email || '');
    const branch = inferImportBranch(row.branch || row.department || row.course || '');
    const year = inferImportYear(row);
    const errors = [];
    if (!roll) errors.push('Roll Number is required');
    if (!name) errors.push('Name is required');
    if (!email || !emailPattern.test(email)) errors.push('Valid Email is required');
    if (!branch) errors.push('Branch is required');
    if (!Number.isInteger(year) || year < 1 || year > 6) errors.push('Year must be an integer from 1 to 6');
    if (roll && seenRolls.has(roll)) errors.push('Duplicate Roll Number in file');
    if (email && seenEmails.has(email)) errors.push('Duplicate Email in file');
    if (errors.length) {
      failed.push({ row: rowNumber, roll, email, errors });
      return;
    }
    seenRolls.add(roll);
    seenEmails.add(email);
    prepared.push({ rowNumber, row, roll, name, email, branch, year });
  });

  const [existingRolls, existingEmails] = await Promise.all([
    Cadet.find({ roll: { $in: prepared.map(item => item.roll) } }).select('roll').lean(),
    Cadet.find({ email: { $in: prepared.map(item => item.email) } }).select('email roll').lean()
  ]);
  const existingRollSet = new Set(existingRolls.map(item => normalizeRoll(item.roll)));
  const existingEmailMap = new Map(existingEmails.map(item => [normalizeEmail(item.email), item.roll]));

  for (const item of prepared) {
    if (existingRollSet.has(item.roll) || existingEmailMap.has(item.email)) {
      skipped += 1;
      skippedRows.push({
        row: item.rowNumber,
        roll: item.roll,
        email: item.email,
        reason: existingRollSet.has(item.roll)
          ? 'Roll Number already exists'
          : `Email already belongs to ${existingEmailMap.get(item.email)}`
      });
      continue;
    }
    try {
      const row = item.row;
      await Cadet.create({
        roll: item.roll,
        name: item.name,
        email: item.email,
        branch: item.branch,
        year: item.year,
        batch: inferImportBatch(row, item.branch),
        course: String(row.course || item.branch).trim(),
        studentId: String(row.student_id || row.studentId || '').trim(),
        serialNo: String(row.serial_no || row.serialNo || '').trim(),
        rank: String(row.rank || row.designation || 'CADET').trim(),
        idNo: String(row.id_no || row.idNo || row.student_id || '').trim(),
        gender: String(row.gender || '').trim(),
        contactNo: String(row.contact_no || row.phone || '').trim(),
        status: 'returned',
        attendanceStatus: 'INSIDE',
        leaveStatus: 'NONE',
        gateStatus: 'INSIDE',
        isBlocked: false,
        enrollmentStatus: 'ACTIVE'
      });
      imported += 1;
    } catch (error) {
      failed.push({ row: item.rowNumber, roll: item.roll, email: item.email, errors: [error.message || 'Database insert failed'] });
    }
  }

  await AuditLog.create({
    action: 'CADETS_IMPORTED',
    details: { imported, skipped, failed: failed.length, total: cadets.length, importedBy: actorUsername(req) }
  });
  res.json({ success: true, imported, skipped, failed: failed.length, skippedRows, failedRows: failed, total: cadets.length });
}));

async function handleLeaveBlockMutation(req, res, forceBlock = null) {
  const roll = normalizeRoll(req.params.roll);
  const cadet = await Cadet.findOne({ roll });
  if (!cadet) return res.status(404).json({ success: false, message: 'Cadet not found' });

  const requestedBlock = forceBlock !== null
    ? forceBlock
    : Boolean(req.body?.leaveBlocked ?? req.body?.blocked ?? req.body?.isBlocked);

  if (requestedBlock) {
    const reason = String(req.body?.reason || req.body?.leaveBlockedReason || '').trim();
    if (!reason) return res.status(400).json({ success: false, message: 'Blocking reason is required.' });
    const blockedUntil = parseLeaveBlockUntil(req.body?.blockUntil || req.body?.blockedUntil || req.body?.leaveBlockedUntil);
    await blockCadetLeave({ cadet, req, reason, blockedUntil });
  } else {
    await unblockCadetLeave({ cadet, req });
  }

  res.json({
    success: true,
    cadet: publicCadetRecord(cadet),
    leaveBlock: buildLeaveBlockStatus(cadet)
  });
}

app.put('/api/admin/cadets/:roll/block', authenticateJWT, requireOfficer, requireAdmin, asyncHandler(async (req, res) => {
  return handleLeaveBlockMutation(req, res);
}));

app.post('/api/admin/cadets/:roll/block-leave', authenticateJWT, requireOfficer, requireAdmin, asyncHandler(async (req, res) => {
  return handleLeaveBlockMutation(req, res, true);
}));

app.post('/api/admin/cadets/:roll/unblock-leave', authenticateJWT, requireOfficer, requireAdmin, asyncHandler(async (req, res) => {
  return handleLeaveBlockMutation(req, res, false);
}));

// Admin fetching leave requests for the live Leave Requests dashboard.
app.get('/api/admin/leave-requests', requireOfficer, asyncHandler(async (req, res) => {
  const reviewedStatuses = ['pending_approval', 'approved', 'rejected'];
  const cadets = await Cadet.find({ 'pendingLeave.approvalStatus': { $in: reviewedStatuses } })
    .select('roll name email batch course studentId contactNo pendingLeave')
    .sort({ 'pendingLeave.reviewedAt': -1, 'pendingLeave.requestedAt': -1, _id: -1 })
    .limit(150);

  const enriched = await Promise.all(cadets.map(async (cadet) => {
    const history = await LeaveRecord.find({ roll: cadet.roll })
      .sort({ checkOutDate: -1, _id: -1 })
      .limit(50)
      .select('-checkOutPhotoUrl -checkInPhotoUrl');
    const stats = buildHistoryStats(history, cadet.pendingLeave);
    return {
      ...cadet.toObject(),
      historyStats: stats,
      overdueLabel: stats.overdue > 0 ? 'OVERDUE â€” Not returned' : ''
    };
  }));

  const seen = new Set(enriched.map((row) => {
    const leave = row.pendingLeave || {};
    return leave.requestId || leave.passId || `${row.roll}:${leave.approvalStatus || ''}:${leave.fromDate || ''}:${leave.toDate || ''}`;
  }));

  const recentRecords = await LeaveRecord.find({
    $or: [
      { approvalStatus: { $in: ['approved', 'rejected'] } },
      { status: { $in: ['approved', 'rejected', 'out', 'overdue', 'returned', 'in'] } }
    ]
  })
    .sort({ approvedAt: -1, passIssuedAt: -1, createdAt: -1, _id: -1 })
    .limit(150)
    .select('-checkOutPhotoUrl -checkInPhotoUrl')
    .lean();

  const recentReviewed = recentRecords
    .map((record) => {
      const approvalStatus = record.approvalStatus === 'rejected'
        ? 'rejected'
        : record.approvalStatus === 'approved' || ['approved', 'out', 'overdue', 'returned', 'in'].includes(record.status)
          ? 'approved'
          : null;
      if (!approvalStatus) return null;
      const key = record.passId || `${record.roll}:${approvalStatus}:${record.fromDate || record.checkOutDate || ''}:${record.toDate || record.checkInDate || ''}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        _id: record._id,
        roll: record.roll,
        name: record.name,
        email: record.email,
        batch: record.batch,
        course: record.course,
        studentId: record.studentId,
        pendingLeave: {
          requestId: String(record._id),
          leaveType: record.leaveType || 'Shore Leave',
          reason: record.leaveReason || record.leaveType || null,
          dest: record.dest || record.locationAddress || '—',
          fromDate: record.fromDate || record.checkOutDate || record.createdAt,
          toDate: record.toDate || record.returnDate || record.checkInDate || record.createdAt,
          returnDate: record.returnDate || record.toDate || record.checkInDate || null,
          approvalStatus,
          reviewedAt: record.approvedAt || record.passIssuedAt || record.createdAt || record._id?.getTimestamp?.(),
          reviewedBy: record.approvedBy || null,
          passId: record.passId || null,
          gatePassPdfUrl: record.gatePassPdfUrl || record.gatePass?.publicUrl || null,
          rejectionReason: record.rejectionReason || null
        },
        historyStats: buildHistoryStats([record], null),
        overdueLabel: record.status === 'overdue' ? 'OVERDUE â€” Not returned' : ''
      };
    })
    .filter(Boolean);

  res.json([...enriched, ...recentReviewed]);
}));

app.get('/api/admin/leave-token-control', requireOfficer, asyncHandler(async (req, res) => {
  const [cadetsWithRequests, leaveRecords] = await Promise.all([
    Cadet.find({ pendingLeave: { $exists: true, $ne: null } })
      .select('roll name email batch course studentId pendingLeave leaveTokens leaveStatus status leaveBlocked leaveBlockedReason leaveBlockedUntil')
      .lean(),
    LeaveRecord.find()
      .sort({ checkOutDate: -1, createdAt: -1, _id: -1 })
      .limit(500)
      .select('roll name studentId leaveType fromDate toDate fromTime toTime returnDate dest status approvalStatus passId passVerificationToken emergencyVerificationCode gatePassUrl gatePassPdfUrl pdfUrl leaveDocumentUrl supportingDocument checkOutDate checkInDate createdAt')
      .lean()
  ]);

  const rows = [];
  for (const cadet of cadetsWithRequests) {
    const leave = cadet.pendingLeave || {};
    rows.push({
      id: leave.requestId || `${cadet.roll}-pending`,
      source: 'cadet.pendingLeave',
      roll: cadet.roll,
      cadetName: cadet.name,
      leaveTokens: Number(cadet.leaveTokens ?? 4),
      leaveType: leave.leaveType || 'Unknown',
      startDate: leave.fromDate || null,
      endDate: leave.toDate || null,
      leaveStatus: leave.approvalStatus || leave.status || 'pending',
      tokenStatus: leave.tokenStatus || (leave.emergencyVerificationCode || leave.passVerificationToken ? 'generated' : 'not_generated'),
      passNo: leave.passId || null,
      emergencyVerificationCode: leave.emergencyVerificationCode || leave.passVerificationToken || null,
      passUrl: leave.gatePassUrl || leave.gatePassPdfUrl || leave.gatePass?.publicUrl || null,
      documentUrl: leave.documentUrl || leave.supportingDocument?.publicUrl || leave.supportingDocument?.url || null,
      supportingDocument: leave.supportingDocument || null,
      leaveBlocked: isLeaveBlockActive(cadet),
      leaveBlockedReason: cadet.leaveBlockedReason || ''
    });
  }

  for (const record of leaveRecords) {
    rows.push({
      id: String(record._id),
      source: 'leave_records',
      roll: record.roll,
      cadetName: record.name,
      leaveTokens: null,
      leaveType: record.leaveType || 'Shore Leave',
      startDate: record.fromDate || record.checkOutDate || null,
      endDate: record.toDate || record.checkInDate || null,
      leaveStatus: record.status || record.approvalStatus || 'unknown',
      tokenStatus: record.tokenStatus || (record.emergencyVerificationCode || record.passVerificationToken ? 'generated' : 'not_generated'),
      passNo: record.passId || null,
      emergencyVerificationCode: record.emergencyVerificationCode || record.passVerificationToken || null,
      passUrl: record.gatePassUrl || record.gatePassPdfUrl || record.pdfUrl || record.gatePass?.publicUrl || null,
      documentUrl: record.leaveDocumentUrl || record.supportingDocument?.publicUrl || record.supportingDocument?.url || null,
      supportingDocument: record.supportingDocument || null
    });
  }

  res.json({ success: true, requests: rows });
}));

app.post('/api/admin/leave-token-control/:roll/:action', requireOfficer, asyncHandler(async (req, res) => {
  const roll = normalizeRoll(req.params.roll);
  const action = String(req.params.action || '').toLowerCase();
  if (!['generate', 'revoke', 'reissue'].includes(action)) {
    return res.status(400).json({ error: 'Unsupported leave token action.' });
  }

  const cadet = await Cadet.findOne({ roll });
  if (!cadet || !cadet.pendingLeave) return res.status(404).json({ error: 'Leave request not found' });
  if (cadet.pendingLeave.approvalStatus !== 'approved') {
    return res.status(400).json({ error: 'Leave token actions require an approved leave request.' });
  }
  if (action !== 'revoke' && isLeaveBlockActive(cadet)) return sendLeaveBlockedResponse(res, cadet);

  if (action === 'revoke') {
    cadet.pendingLeave.emergencyCodeRevoked = true;
    cadet.pendingLeave.tokenStatus = 'revoked';
    cadet.pendingLeave.revokedAt = new Date();
    cadet.pendingLeave.revokedBy = req.officer.username;
  } else {
    const leaveWindow = resolveLeaveWindow(cadet.pendingLeave);
    const previousToken = cadet.pendingLeave.emergencyVerificationCode || cadet.pendingLeave.passVerificationToken || null;
    const previousPassId = cadet.pendingLeave.passId || null;
    const passId = await generateUniquePassId();
    const emergencyVerificationCode = await generateUniqueEmergencyVerificationCode(passId);
    cadet.pendingLeave.passId = passId;
    cadet.pendingLeave.passVerificationToken = emergencyVerificationCode;
    cadet.pendingLeave.emergencyVerificationCode = emergencyVerificationCode;
    cadet.pendingLeave.emergencyCodeGeneratedAt = new Date();
    cadet.pendingLeave.emergencyCodeExpiresAt = leaveWindow.toDate;
    cadet.pendingLeave.emergencyCodeRevoked = false;
    cadet.pendingLeave.tokenStatus = 'generated';
    cadet.pendingLeave.tokenIssuedAt = new Date();
    cadet.pendingLeave.tokenIssuedBy = req.officer.username;
    if (action === 'reissue') {
      cadet.pendingLeave.tokenHistory = Array.isArray(cadet.pendingLeave.tokenHistory)
        ? cadet.pendingLeave.tokenHistory
        : [];
      cadet.pendingLeave.tokenHistory.push({
        passId: previousPassId,
        emergencyVerificationCode: previousToken,
        replacedAt: new Date(),
        replacedBy: req.officer.username
      });
    }
  }

  cadet.markModified('pendingLeave');
  await cadet.save();
  await AuditLog.create({
    action: `LEAVE_TOKEN_${action.toUpperCase()}`,
    roll: cadet.roll,
    details: {
      passId: cadet.pendingLeave.passId || null,
      tokenStatus: cadet.pendingLeave.tokenStatus || null,
      emergencyVerificationCode: cadet.pendingLeave.emergencyVerificationCode || null,
      actor: req.officer.username
    }
  });
  emitCadetEvent(cadet, 'leave:token_updated', {
    action,
    passId: cadet.pendingLeave.passId || null,
    tokenStatus: cadet.pendingLeave.tokenStatus || null,
    emergencyVerificationCode: cadet.pendingLeave.emergencyVerificationCode || null
  });
  res.json({ success: true, action, pendingLeave: cadet.pendingLeave });
}));

app.get('/api/admin/cadets/:roll/history', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const roll = normalizeRoll(req.params.roll);
  const cadet = await Cadet.findOne({ roll }).select('roll name email batch course studentId rank pendingLeave status');
  if (!cadet) return res.status(404).json({ error: 'Cadet not found' });
  const history = await LeaveRecord.find({ roll })
    .sort({ checkOutDate: -1, _id: -1 })
    .limit(100)
    .select('-checkOutPhotoUrl -checkInPhotoUrl');
  res.json({
    cadet,
    history,
    historyStats: buildHistoryStats(history, cadet.pendingLeave)
  });
}));

// Admin approving/rejecting leave
app.put('/api/admin/leave-requests/:roll/approve', requireOfficer, asyncHandler(async (req, res) => {
  const { status, reason } = req.body; // 'approved' or 'rejected'
  const cadet = await Cadet.findOne({ roll: req.params.roll.toUpperCase() });
  
  if (!cadet || !cadet.pendingLeave) return res.status(404).json({ error: 'Leave request not found' });
  if (cadet.pendingLeave.approvalStatus !== 'pending_approval') {
    return res.status(400).json({ error: 'This leave request has already been reviewed.' });
  }
  
  if (status === 'rejected') {
    const leaveWindow = resolveLeaveWindow(cadet.pendingLeave);
    cadet.pendingLeave.fromDate = leaveWindow.fromDate;
    cadet.pendingLeave.toDate = leaveWindow.toDate;
    cadet.pendingLeave.returnDate = leaveWindow.returnDate;
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'Rejection reason is required.' });
    }
    cadet.pendingLeave.approvalStatus = 'rejected';
    cadet.pendingLeave.rejectionReason = reason.trim();
    cadet.pendingLeave.reviewedAt = new Date();
    cadet.pendingLeave.reviewedBy = req.officer.username;
    cadet.markModified('pendingLeave');
    await cadet.save();
    const emailResult = await sendRejectionEmail(cadet, cadet.pendingLeave, reason.trim(), req.officer.username);
    await sendPushToCadet(cadet.roll, {
      title: 'Leave request rejected',
      body: `Reason: ${reason.trim()}`,
      url: '/cadet-dashboard.html'
    });
    emitCadetEvent(cadet, 'leave:rejected', { reason: reason.trim() });
    await AuditLog.create({
      action: 'LEAVE_REJECTED',
      roll: cadet.roll,
      details: { reason: reason.trim(), emailDeliveryMode: emailResult.deliveryMode || 'unknown' }
    });
    return res.json({ success: true, status, emailResult: publicEmailDeliveryResult(emailResult) });
  } else {
    const leaveWindow = resolveLeaveWindow(cadet.pendingLeave);
    if (isLeaveBlockActive(cadet)) return sendLeaveBlockedResponse(res, cadet);
    const tokenCost = Number(cadet.pendingLeave.tokenCost ?? leaveTokenCost(cadet.pendingLeave.leaveType));
    if (Number(cadet.leaveTokens ?? 4) < tokenCost) {
      return res.status(400).json({
        error: `Not enough leave tokens. Cadet has ${cadet.leaveTokens ?? 4} tokens. This leave costs ${tokenCost} token${tokenCost === 1 ? '' : 's'}.`
      });
    }
    cadet.pendingLeave.fromDate = leaveWindow.fromDate;
    cadet.pendingLeave.toDate = leaveWindow.toDate;
    cadet.pendingLeave.returnDate = leaveWindow.returnDate;
    cadet.pendingLeave.approvalStatus = 'approved';
    cadet.pendingLeave.reviewedAt = new Date();
    cadet.pendingLeave.reviewedBy = req.officer.username;
    cadet.pendingLeave.rejectionReason = null;
    cadet.pendingLeave.passId = null;
    cadet.pendingLeave.passVerificationToken = null;
    cadet.pendingLeave.emergencyVerificationCode = null;
    cadet.pendingLeave.emergencyCodeGeneratedAt = null;
    cadet.pendingLeave.emergencyCodeExpiresAt = null;
    cadet.pendingLeave.emergencyGateOutUsed = false;
    cadet.pendingLeave.emergencyGateInUsed = false;
    cadet.pendingLeave.gatePassStatus = 'pending_checkout';
    cadet.pendingLeave.gatePassUrl = null;
    cadet.pendingLeave.gatePassPdfUrl = null;
    cadet.pendingLeave.gatePass = null;
    cadet.pendingLeave.passIssuedAt = null;
    cadet.pendingLeave.tokenCost = tokenCost;
    cadet.leaveStatus = 'APPROVED';
    cadet.leaveTokens = Math.max(0, Number(cadet.leaveTokens ?? 4) - tokenCost);
    cadet.markModified('pendingLeave');
    await cadet.save();
    await sendPushToCadet(cadet.roll, {
      title: 'Your leave is approved',
      body: 'Report to the gate for checkout verification. Your gate pass will be issued after checkout.',
      url: '/cadet-dashboard.html'
    });
    emitCadetEvent(cadet, 'leave:approved', { gatePassStatus: 'pending_checkout', leaveTokens: cadet.leaveTokens });
    await AuditLog.create({
      action: 'LEAVE_APPROVED',
      roll: cadet.roll,
      details: {
        reviewedBy: req.officer.username,
        gatePassStatus: 'pending_checkout',
        gatePassIssuePolicy: 'issued_at_checkout'
      }
    });
    return res.json({
      success: true,
      status,
      gatePassStatus: 'pending_checkout',
      message: 'Leave approved. Gate pass will be issued after gate checkout verification.'
    });
  }
  
  res.json({ success: true, status });
}));

app.delete('/api/admin/cadets/:roll', authenticateJWT, requireOfficer, asyncHandler(async (req, res) => {
  const roll = normalizeRoll(req.params.roll);
  const cadet = await Cadet.findOne({ roll }).select('-faceDescriptor -faceDescriptors');
  if (!cadet) return res.status(404).json({ error: 'Cadet Record Not Found' });
  await Cadet.deleteOne({ roll });
  await AuditLog.create({
    action: 'CADET_DELETED',
    roll,
    details: { deletedBy: actorUsername(req), cadet: publicCadetRecord(cadet) }
  });
  res.json({ success: true });
}));

// Admin Officers CRUD
app.get('/api/admin/officers', requireOfficer, requireAdmin, asyncHandler(async (req, res) => {
  const officers = await Officer.find().select('-passwordHash');
  res.json(officers.map(publicOfficerRecord));
}));

app.post('/api/admin/officers', requireOfficer, requireAdmin, asyncHandler(async (_req, res) => {
  res.status(409).json({
    success: false,
    code: 'OTP_CONFIRMATION_REQUIRED',
    message: 'Use the OTP-confirmed administrator provisioning workflow.'
  });
}));

app.post('/api/admin/officers/provision/request-otp', requireOfficer, requireAdmin, asyncHandler(async (req, res) => {
  const adminNumber = String(req.body?.adminNumber || '').trim().toUpperCase();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const branch = String(req.body?.branch || '').trim().toUpperCase();
  const password = String(req.body?.password || '');
  const validBranches = new Set(['BE-MAERSK', 'BSC-MAERSK', 'ETO-MAERSK', 'DNS-VSHIPS', 'BE-VSHIPS']);

  if (!/^[A-Z0-9][A-Z0-9/_-]{3,31}$/.test(adminNumber)) {
    return res.status(400).json({ success: false, message: 'Enter a valid unique administrator number.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Enter a valid administrator email.' });
  }
  if (!validBranches.has(branch)) {
    return res.status(400).json({ success: false, message: 'Select a valid branch.' });
  }
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ success: false, message: 'Password must contain at least 8 characters, uppercase, lowercase, and a number.' });
  }

  const duplicate = await Officer.exists({
    $or: [{ username: adminNumber }, { adminNumber }, { email }]
  });
  if (duplicate) return res.status(409).json({ success: false, message: 'Administrator number or email already exists.' });

  await OfficerProvisioning.deleteMany({ $or: [{ adminNumber }, { email }, { expiresAt: { $lte: new Date() } }] });
  const otp = String(crypto.randomInt(100000, 1000000));
  const sessionToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const provisioning = await OfficerProvisioning.create({
    sessionToken,
    adminNumber,
    email,
    branch,
    passwordHash: await bcrypt.hash(password, 12),
    otpHash: await bcrypt.hash(otp, 10),
    expiresAt,
    requestedBy: actorUsername(req)
  });

  const delivery = await sendSystemEmail({
    to: email,
    subject: 'AMET IST administrator account verification',
    text: `Your administrator account verification OTP is ${otp}. It expires in 5 minutes.`,
    html: `<p>Your AMET IST administrator account verification OTP is:</p><h2>${otp}</h2><p>This OTP expires in 5 minutes and can be used once.</p>`
  });
  if (delivery.deliveryMode !== 'email') {
    await OfficerProvisioning.deleteOne({ _id: provisioning._id });
    return res.status(503).json({ success: false, message: 'Verification email could not be delivered. No administrator account was created.' });
  }

  await AuditLog.create({
    action: 'ADMIN_ACCOUNT_OTP_REQUESTED',
    details: { adminNumber, email, branch, requestedBy: actorUsername(req), ipAddress: getRequestIp(req) }
  });
  res.json({ success: true, sessionToken, expiresInSeconds: 300, message: 'Verification OTP sent.' });
}));

app.post('/api/admin/officers/provision/confirm', requireOfficer, requireAdmin, asyncHandler(async (req, res) => {
  const sessionToken = String(req.body?.sessionToken || '').trim();
  const otp = String(req.body?.otp || '').trim();
  if (!sessionToken || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ success: false, message: 'A valid provisioning session and 6-digit OTP are required.' });
  }

  const provisioning = await OfficerProvisioning.findOne({ sessionToken });
  if (!provisioning || provisioning.expiresAt <= new Date()) {
    if (provisioning) await OfficerProvisioning.deleteOne({ _id: provisioning._id });
    return res.status(410).json({ success: false, message: 'Administrator verification session expired. Request a new OTP.' });
  }
  if (provisioning.attempts >= provisioning.maxAttempts) {
    await OfficerProvisioning.deleteOne({ _id: provisioning._id });
    return res.status(429).json({ success: false, message: 'Too many invalid OTP attempts. Request a new OTP.' });
  }
  if (!(await bcrypt.compare(otp, provisioning.otpHash))) {
    provisioning.attempts += 1;
    await provisioning.save();
    return res.status(401).json({ success: false, message: 'Invalid verification OTP.' });
  }

  const duplicate = await Officer.exists({
    $or: [
      { username: provisioning.adminNumber },
      { adminNumber: provisioning.adminNumber },
      { email: provisioning.email }
    ]
  });
  if (duplicate) {
    await OfficerProvisioning.deleteOne({ _id: provisioning._id });
    return res.status(409).json({ success: false, message: 'Administrator number or email already exists.' });
  }

  const officer = await Officer.create({
    username: provisioning.adminNumber,
    adminNumber: provisioning.adminNumber,
    email: provisioning.email,
    branch: provisioning.branch,
    passwordHash: provisioning.passwordHash,
    role: 'duty_officer',
    isActive: true,
    createdBy: actorUsername(req),
    verifiedAt: new Date()
  });
  await OfficerProvisioning.deleteOne({ _id: provisioning._id });
  await AuditLog.create({
    action: 'ADMIN_ACCOUNT_CREATED',
    details: {
      adminNumber: officer.adminNumber,
      email: officer.email,
      branch: officer.branch,
      createdBy: actorUsername(req),
      ipAddress: getRequestIp(req)
    }
  });
  res.status(201).json({ success: true, message: 'Administrator account created successfully.', officer: publicOfficerRecord(officer) });
}));

app.delete('/api/admin/officers/:username', requireOfficer, requireAdmin, asyncHandler(async (req, res) => {
  await Officer.deleteOne({ username: req.params.username });
  res.json({ success: true });
}));

// CSV Exports
app.get('/api/admin/export/leave-records', requireOfficer, asyncHandler(async (req, res) => {
  const records = await LeaveRecord.find().lean();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="leave-records.csv"');
  
  if (records.length === 0) return res.send('roll,name,dest,checkOutTime,checkInTime,status\n');
  
  const headers = ['roll', 'name', 'dest', 'checkOutTime', 'checkInTime', 'status'];
  let csv = headers.join(',') + '\n';
  
  records.forEach(r => {
    const row = headers.map(h => {
      let val = r[h] || '';
      if (typeof val === 'string') val = val.replace(/"/g, '""');
      return `"${val}"`;
    });
    csv += row.join(',') + '\n';
  });
  
  res.send(csv);
}));

app.get('/api/admin/export/audit-logs', requireOfficer, asyncHandler(async (req, res) => {
  const logs = await AuditLog.find().sort({ timestamp: -1 }).lean();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
  
  if (logs.length === 0) return res.send('timestamp,action,roll,details\n');
  
  const headers = ['timestamp', 'action', 'roll', 'details'];
  let csv = headers.join(',') + '\n';
  
  logs.forEach(l => {
    const row = headers.map(h => {
      let val = l[h] || '';
      if (h === 'details') val = JSON.stringify(val);
      if (typeof val === 'string') val = val.replace(/"/g, '""');
      return `"${val}"`;
    });
    csv += row.join(',') + '\n';
  });
  
  res.send(csv);
}));


function startPushReminderJobs() {
  cron.schedule('* * * * *', async () => {
    const now = new Date();
    const inThirtyMinutes = new Date(now.getTime() + (30 * 60 * 1000));

    const reminderRecords = await LeaveRecord.find({
      status: 'out',
      checkInDate: { $exists: false },
      toDate: { $gte: now, $lte: inThirtyMinutes },
      reminderPushSentAt: { $exists: false }
    }).limit(50);

    for (const record of reminderRecords) {
      await sendPushToCadet(record.roll, {
        title: 'Return reminder',
        body: `You must be back at campus by ${record.checkInTime || formatDate(record.toDate)}.`,
        url: '/cadet-dashboard.html'
      });
      record.reminderPushSentAt = new Date();
      await record.save();
    }

    const overdueRecords = await LeaveRecord.find({
      status: 'out',
      checkInDate: { $exists: false },
      toDate: { $lt: now },
      overduePushSentAt: { $exists: false }
    }).limit(50);

    for (const record of overdueRecords) {
      await sendPushToCadet(record.roll, {
        title: 'Leave expired',
        body: 'Your leave has expired. Report to campus immediately.',
        url: '/cadet-dashboard.html'
      });
      record.overduePushSentAt = new Date();
      await record.save();
    }
  });
}

function startDailyBackupJob() {
  cron.schedule('0 0 * * *', () => {
    runBackupScript('Daily backup');
  });
}

function startMonthlyTokenResetJob() {
  cron.schedule('0 0 1 * *', async () => {
    try {
      const result = await streakService.resetMonthlyTokens();
      await AuditLog.create({ action: 'MONTHLY_TOKEN_RESET', details: { modifiedCount: result.modifiedCount || 0 } });
      const cadets = await Cadet.find().select('roll leaveTokens').limit(500);
      for (const cadet of cadets) {
        await sendPushToCadet(cadet.roll, {
          title: 'Leave tokens reset',
          body: `Your leave tokens have been reset. You now have ${cadet.leaveTokens ?? 4} tokens.`,
          url: '/cadet-dashboard.html'
        }).catch(() => {});
        emitCadetEvent(cadet, 'token:granted', { leaveTokens: cadet.leaveTokens ?? 4, monthlyReset: true });
      }
    } catch (error) {
      logError('[TOKENS] Monthly reset failed', error);
    }
  });
}

function runBackupScript(label) {
  const backupScript = path.join(__dirname, 'scripts', 'backup.js');
  const child = spawn(process.execPath, [backupScript], {
    cwd: __dirname,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => logInfo(`[BACKUP] ${String(chunk).trim()}`));
  child.stderr.on('data', chunk => logWarn(`[BACKUP] ${String(chunk).trim()}`));
  child.on('exit', code => {
    if (code === 0) logInfo(`[BACKUP] ${label} completed`);
    else logWarn(`[BACKUP] ${label} exited with code ${code}`);
  });
  return child;
}

function hasRecentFaceBackup() {
  const faceBackupDir = path.join(__dirname, '..', 'backups', 'face');
  if (!fs.existsSync(faceBackupDir)) return false;
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  return fs.readdirSync(faceBackupDir)
    .filter(name => /^face_backup_\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .some(name => {
      const stat = fs.statSync(path.join(faceBackupDir, name));
      return stat.mtimeMs >= cutoff;
    });
}

function ensureRecentFaceBackup() {
  try {
    if (hasRecentFaceBackup()) {
      logInfo('[BACKUP] Recent face embedding backup found');
      return;
    }
    logWarn('[BACKUP] No face embedding backup from the last 24 hours. Running backup now.');
    const backupScript = path.join(__dirname, 'scripts', 'backup.js');
    const child = spawn(process.execPath, [backupScript], {
      cwd: __dirname,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => logInfo(`[BACKUP] ${String(chunk).trim()}`));
    child.stderr.on('data', chunk => logWarn(`[BACKUP] ${String(chunk).trim()}`));
    child.on('exit', code => {
      if (code === 0) logInfo('[BACKUP] Startup face backup completed');
      else logWarn(`[BACKUP] Startup face backup exited with code ${code}`);
    });
  } catch (error) {
    logError('[BACKUP] Could not verify recent face backup', error);
  }
}

async function connectMongoWithRetry(mongoUri, maxAttempts = 10) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      logInfo(`[DB] Connected to MongoDB Atlas at ${describeMongoTarget(mongoUri)}`);
      return true;
    } catch (error) {
      lastError = error;
      logError(`[DB] Connection attempt ${attempt}/${maxAttempts} failed`, error);
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  throw lastError;
}

function configureMongoEventLogging() {
  mongoose.connection.on('disconnected', () => logWarn('[DB] MongoDB disconnected'));
  mongoose.connection.on('error', (error) => logError('[DB] MongoDB connection error', error));
  mongoose.connection.on('reconnected', () => logInfo('[DB] MongoDB reconnected'));
}

async function validateFingerprintStartup() {
  const nodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
  const encryptionEnabled = isEncryptionConfigured();
  let status = null;

  try {
    status = await fingerprintRuntime.status();
  } catch (error) {
    status = {
      connected: false,
      configured: false,
      provider: process.env.FINGERPRINT_DEVICE_TYPE || 'MANTRA_MFS110',
      providerMode: 'UNAVAILABLE',
      code: error?.code || 'PROVIDER_STATUS_FAILED',
      error: error?.message || 'Fingerprint provider status check failed'
    };
    logError('[FINGERPRINT] Provider startup status check failed', error);
  }

  const provider = status?.provider || process.env.FINGERPRINT_DEVICE_TYPE || 'MANTRA_MFS110';
  const providerMode = status?.providerMode || 'UNKNOWN';
  const deviceCode = status?.code || (status?.connected ? 'ONLINE' : 'OFFLINE');
  const productionFallbackActive = nodeEnv === 'production' && providerMode === 'LOCAL_WORKFLOW_ADAPTER';
  const liveCaptureConfigured = Boolean(
    process.env.MANTRA_MFS110_LOCAL_ADAPTER_URL ||
    process.env.MANTRA_MFS110_BRIDGE_URL ||
    process.env.FINGERPRINT_OFFICIAL_SDK_ENABLED === 'true'
  );

  if (!encryptionEnabled) {
    logError(
      '[FINGERPRINT] FINGERPRINT_ENCRYPTION_KEY is missing or shorter than 32 characters. Enrollment endpoints are disabled until it is configured.',
      new Error('FINGERPRINT_ENCRYPTION_KEY_REQUIRED')
    );
  }

  if (productionFallbackActive) {
    logError(
      '[FINGERPRINT] LOCAL_WORKFLOW_ADAPTER is not allowed in production. Configure Mantra L1 AVDM bridge or the official SDK provider.',
      new Error('FINGERPRINT_PRODUCTION_FALLBACK_BLOCKED')
    );
  }

  if (providerMode === 'MANTRA_L1_AVDM' && !liveCaptureConfigured) {
    logWarn('[FINGERPRINT] Mantra L1 AVDM status is available, but live template capture requires MANTRA_MFS110_LOCAL_ADAPTER_URL, MANTRA_MFS110_BRIDGE_URL, or the future official SDK provider.');
  }

  logInfo('[FINGERPRINT] Startup validation summary');
  logInfo(`[FINGERPRINT] ${mongoose.connection.readyState === 1 ? '✓' : '✗'} MongoDB Connected`);
  logInfo(`[FINGERPRINT] ${status ? '✓' : '✗'} Provider Loaded`);
  logInfo(`[FINGERPRINT] ✓ Provider: ${provider}`);
  logInfo(`[FINGERPRINT] ✓ Mode: ${providerMode}`);
  logInfo(`[FINGERPRINT] ${status?.connected ? '✓' : '✗'} Device Status: ${deviceCode}`);
  logInfo(`[FINGERPRINT] ${encryptionEnabled ? '✓' : '✗'} Encryption: ${encryptionEnabled ? 'ENABLED' : 'DISABLED'}`);
  logInfo('[FINGERPRINT] ✓ APIs Registered: /api/fingerprint/* and /api/biometric/*');

  return {
    encryptionEnabled,
    provider,
    providerMode,
    deviceStatus: deviceCode,
    deviceOnline: Boolean(status?.connected),
    liveCaptureConfigured,
    productionFallbackActive
  };
}

function configuredFingerprintAdapterUrl() {
  return String(
    process.env.MANTRA_MFS110_LOCAL_ADAPTER_URL
    || process.env.MANTRA_MFS110_BRIDGE_URL
    || ''
  ).replace(/\/+$/, '');
}

async function fingerprintAdapterReachable(adapterUrl) {
  if (!adapterUrl) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    // Any HTTP response proves the adapter process is reachable. Scanner status
    // may correctly be 503 while the USB device is disconnected.
    await fetch(`${adapterUrl}/status`, { signal: controller.signal });
    return true;
  } catch (_error) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureLocalFingerprintAdapter() {
  const adapterUrl = configuredFingerprintAdapterUrl();
  if (!adapterUrl) return false;

  let parsed;
  try {
    parsed = new URL(adapterUrl);
  } catch (_error) {
    logWarn('[FINGERPRINT] Local adapter URL is invalid; automatic startup skipped.');
    return false;
  }
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname.toLowerCase())) return false;
  if (await fingerprintAdapterReachable(adapterUrl)) return true;

  const adapterScript = path.join(__dirname, 'local-fingerprint-adapter.js');
  if (!fs.existsSync(adapterScript)) {
    logWarn('[FINGERPRINT] Local adapter script is missing; capture remains unavailable.');
    return false;
  }

  logInfo('[FINGERPRINT] Starting local fingerprint adapter.');
  fingerprintAdapterProcess = spawn(process.execPath, [adapterScript], {
    cwd: __dirname,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  fingerprintAdapterProcess.stdout?.on('data', data => logInfo(`[FINGERPRINT ADAPTER] ${String(data).trim()}`));
  fingerprintAdapterProcess.stderr?.on('data', data => logWarn(`[FINGERPRINT ADAPTER] ${String(data).trim()}`));
  fingerprintAdapterProcess.once('exit', code => {
    if (code && code !== 0) logWarn(`[FINGERPRINT] Local adapter exited with code ${code}.`);
    fingerprintAdapterProcess = null;
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (await fingerprintAdapterReachable(adapterUrl)) {
      logInfo('[FINGERPRINT] Local fingerprint adapter is reachable.');
      return true;
    }
  }
  logWarn('[FINGERPRINT] Local fingerprint adapter did not become reachable within 5 seconds.');
  return false;
}

process.on('exit', () => {
  if (fingerprintAdapterProcess && !fingerprintAdapterProcess.killed) {
    fingerprintAdapterProcess.kill();
  }
});

// â”€â”€â”€ STARTUP â”€â”€â”€
async function startServer() {
  const mongoUri = getMongoUri();
  configureMongoEventLogging();

  try {
    await connectMongoWithRetry(mongoUri);
  } catch (err) {
    logError('[DB] MongoDB Atlas is unavailable; startup aborted to protect data consistency', err);
    throw err;
  }

  const supabaseStartup = await verifyConnection();
  logInfo('[SUPABASE] Configuration', supabaseStartup.diagnostics);
  if (supabaseStartup.online) {
    logInfo(`[SUPABASE] Connected. Buckets: ${supabaseStartup.buckets.join(', ')}`);
  } else {
    const authError = new Error(supabaseStartup.error?.message || 'Supabase Storage unavailable');
    authError.code = supabaseStartup.error?.code;
    authError.status = supabaseStartup.error?.status;
    logError('[SUPABASE] Authentication failed', authError);
  }

  await ensureLocalFingerprintAdapter();
  await validateFingerprintStartup();

  activeDeviceConfig = await DeviceConfig.findOneAndUpdate(
    { deviceId: process.env.NFC_DEVICE_ID || 'gate-1' },
    {
      $setOnInsert: {
        deviceName: process.env.NFC_DEVICE_NAME || 'Gate-1',
        reader: process.env.NFC_READER_NAME || 'ACS ACR122U',
        location: process.env.NFC_DEVICE_LOCATION || 'Main Gate',
        enabled: true,
        mode: 'GATE_ENTRY'
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  nfcService.setMode(activeDeviceConfig.mode || 'GATE_ENTRY');
  logInfo(`[NFC] Device configuration loaded: ${activeDeviceConfig.deviceName} (${activeDeviceConfig.location})`);

  // Seed default officer
  const adminSeed = {
    username: String(process.env.DEFAULT_ADMIN_USERNAME || '').trim(),
    password: String(process.env.DEFAULT_ADMIN_PASSWORD || '')
  };
  const dutySeed = {
    username: String(process.env.DEFAULT_DUTY_USERNAME || '').trim(),
    password: String(process.env.DEFAULT_DUTY_PASSWORD || '')
  };
  if (adminSeed.username && adminSeed.password) {
    const hash = await bcrypt.hash(adminSeed.password, 10);
    await Officer.updateOne(
      { username: adminSeed.username },
      { $set: { username: adminSeed.username, passwordHash: hash, role: 'admin', isActive: true } },
      { upsert: true }
    );
  }
  if (dutySeed.username && dutySeed.password) {
    const dutyHash = await bcrypt.hash(dutySeed.password, 10);
    await Officer.updateOne(
      { username: dutySeed.username },
      { $setOnInsert: { username: dutySeed.username, passwordHash: dutyHash, role: 'duty_officer', isActive: true } },
      { upsert: true }
    );
  }
  if (!adminSeed.username && !adminSeed.password && !dutySeed.username && !dutySeed.password) {
    logInfo('[DB] Default officer seed is disabled. Create officers explicitly or configure complete seed credentials.');
  } else if ((!adminSeed.username !== !adminSeed.password) || (!dutySeed.username !== !dutySeed.password)) {
    logWarn('[DB] Incomplete default officer seed configuration was ignored. Both username and password are required.');
  }
  await Cadet.updateMany(
    { $or: [{ enrollmentStatus: { $exists: false } }, { enrollmentStatus: null }] },
    { enrollmentStatus: 'ACTIVE', loginAttempts: 0 }
  );
  await Cadet.updateMany(
    { $or: [{ nfc: { $exists: false } }, { nfc: null }] },
    {
      $set: {
        nfc: {
          uid: null,
          code: null,
          assigned: false,
          status: 'UNASSIGNED',
          assignedAt: null,
          assignedBy: null,
          lastUsed: null,
          lastUpdated: new Date(),
          useCount: 0,
          history: [],
          replacementHistory: []
        }
      }
    }
  );
  const legacyNfcTags = await NFCTag.find({ active: true }).lean();
  for (const tag of legacyNfcTags) {
    const cadet = await Cadet.findOne({ roll: tag.rollNumber || tag.cadetId });
    if (!cadet || cadet.nfc?.status === 'ACTIVE') continue;
    cadet.nfc = {
      uid: tag.uid,
      code: tag.nfcCode,
      assigned: true,
      status: 'ACTIVE',
      assignedAt: tag.enrolledAt,
      assignedBy: tag.enrolledBy,
      lastUsed: tag.lastUsed,
      lastUpdated: new Date(),
      useCount: tag.useCount || 0,
      history: [{
        uid: tag.uid,
        assignedAt: tag.enrolledAt,
        assignedBy: tag.enrolledBy,
        status: 'ACTIVE'
      }],
      replacementHistory: []
    };
    cadet.markModified('nfc');
    await cadet.save();
  }
  await Cadet.updateMany(
    { 'nfc.uid': { $type: 'string' }, 'nfc.assigned': { $ne: true } },
    { $set: { 'nfc.assigned': true } }
  );
  await Cadet.updateMany(
    { $or: [{ attendanceStatus: { $exists: false } }, { gateStatus: { $exists: false } }, { leaveStatus: { $exists: false } }] },
    [
      {
        $set: {
          attendanceStatus: { $ifNull: ['$attendanceStatus', { $cond: [{ $eq: ['$status', 'out'] }, 'OUTSIDE', 'INSIDE'] }] },
          gateStatus: { $ifNull: ['$gateStatus', { $cond: [{ $eq: ['$status', 'out'] }, 'OUTSIDE', 'INSIDE'] }] },
          leaveStatus: {
            $ifNull: [
              '$leaveStatus',
              {
                $cond: [
                  { $eq: ['$status', 'out'] },
                  'ON_LEAVE',
                  { $cond: [{ $eq: ['$pendingLeave.approvalStatus', 'approved'] }, 'APPROVED', 'NONE'] }
                ]
              }
            ]
          }
        }
      }
    ],
    { updatePipeline: true }
  );
  const cadetsWithEmail = await Cadet.find({ email: { $exists: true, $ne: '' } }).select('_id email');
  for (const cadet of cadetsWithEmail) {
    const normalizedEmail = normalizeEmail(cadet.email);
    if (normalizedEmail && normalizedEmail !== cadet.email) {
      await Cadet.updateOne({ _id: cadet._id }, { $set: { email: normalizedEmail } });
    }
  }
  await Cadet.updateMany(
    {
      $or: [
        { xp: { $exists: false } },
        { level: { $exists: false } },
        { leaveTokens: { $exists: false } },
        { complianceScore: { $exists: false } }
      ]
    },
    {
      $set: {
        xp: 0,
        level: 1,
        currentStreak: 0,
        longestStreak: 0,
        leaveTokens: 4,
        totalCratesOpened: 0,
        cratesAvailable: 0,
        badges: [],
        prizes: [],
        complianceScore: 100,
        profileTheme: 'default'
      }
    }
  );
  await ensureFaceEmbeddingIndex();
  await ensureCoreIndexes();

  // Seed default cadet if json exists
  try {
    if (process.env.NODE_ENV === 'production' && process.env.SEED_SAMPLE_CADETS !== 'true') {
      throw new Error('Sample cadet seed disabled in production');
    }
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'data', 'sample-cadets.json'), 'utf8'));
    for (const c of data) {
      await Cadet.updateOne(
        { roll: c.roll },
        { $setOnInsert: { roll: c.roll, name: c.name, email: normalizeEmail(c.email), batch: c.batch || 'B.Sc NS', course: c.batch || 'B.Sc NS', enrollmentStatus: 'ACTIVE' } },
        { upsert: true }
      );
    }
    logInfo(`[DB] Seeded ${data.length} sample cadets`);
  } catch (e) {
    logInfo('[DB] No sample data found to seed');
  }

  await ensureFaceServiceRunning();
  setInterval(checkFaceServiceHealth, 60 * 1000).unref();
  setInterval(() => {
    retryFailedEmails().catch((error) => logError('[EMAIL] Retry job failed', error));
  }, 10 * 60 * 1000).unref();
  startPushReminderJobs();
  startDailyBackupJob();
  startMonthlyTokenResetJob();
  ensureRecentFaceBackup();

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logError(`[SERVER] Port ${PORT} is already in use. Stop the existing process before starting another instance.`, error);
    } else {
      logError('[SERVER] HTTP server failed', error);
    }
    process.exitCode = 1;
  });
  httpServer.listen(PORT, () => {
    logInfo(`Secure Backend Running on port ${PORT}`);
    if (activeDeviceConfig?.enabled !== false) {
      nfcService.initializeNFC(io);
    } else {
      logWarn('[NFC] Reader initialization skipped because the device is disabled.');
    }
    nfcService.setOnTapCallback(async tapData => {
      try {
        const result = await verifyNfcTap(tapData.uid);
        io.to('admin').emit('nfc:tap:result', result);
      } catch (error) {
        logError('[NFC] Verification failed', error);
        io.to('admin').emit('nfc:tap:result', { success: false, message: 'Verification failed' });
      }
    });
  });
}


// â”€â”€â”€ GLOBAL ERROR HANDLER â”€â”€â”€
// Catches any unhandled errors from async routes (via asyncHandler)
// and returns a clean JSON response instead of crashing.
app.use((err, req, res, next) => {
  logError('[ERROR]', err);
  const status = err.status || err.statusCode || 500;
  if (res.headersSent) return next(err);
  const response = {
    success: false,
    code: err.code || undefined,
    message: status >= 500 ? 'Something went wrong. Please try again.' : (err.message || 'Request failed')
  };
  if (process.env.NODE_ENV !== 'production' && status < 500) response.error = response.message;
  res.status(status).json(response);
});

startServer().catch((error) => {
  logError('[STARTUP] Backend failed to start', error);
  process.exitCode = 1;
});


