const { FingerprintError, isEncryptionConfigured, publicError } = require('./utils');

function allowRoles(roles) {
  const allowed = new Set(roles);
  return (req, res, next) => {
    const role = req.officer?.role || req.user?.role;
    if (!allowed.has(role)) {
      return res.status(403).json({
        success: false,
        code: 'FINGERPRINT_PERMISSION_DENIED',
        message: 'You are not authorized to perform this fingerprint action.'
      });
    }
    next();
  };
}

function createRateLimit({ windowMs, max }) {
  const entries = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of entries) {
      if (value.resetAt <= now) entries.delete(key);
    }
  }, Math.max(windowMs, 30_000));
  cleanup.unref?.();

  return (req, res, next) => {
    const actor = req.officer?.username || req.user?.username || req.ip;
    const key = `${actor}:${req.baseUrl}:${req.route?.path || req.path}`;
    const now = Date.now();
    const current = entries.get(key);
    const entry = !current || current.resetAt <= now
      ? { count: 1, resetAt: now + windowMs }
      : { count: current.count + 1, resetAt: current.resetAt };
    entries.set(key, entry);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        code: 'FINGERPRINT_RATE_LIMITED',
        message: `Too many fingerprint requests. Retry in ${retryAfter} seconds.`,
        retryAfter
      });
    }
    next();
  };
}

function fingerprintErrorHandler(error, req, res, next) {
  if (!error) return next();
  const status = Number(error.statusCode) || 500;
  if (status >= 500) {
    console.error('[FINGERPRINT] Request failed', {
      code: error.code,
      path: req.originalUrl
    });
  }
  return res.status(status).json(publicError(error));
}

function assertConfigured() {
  if (!isEncryptionConfigured()) {
    throw new FingerprintError('Fingerprint encryption is not configured.', {
      code: 'FINGERPRINT_ENCRYPTION_NOT_CONFIGURED',
      statusCode: 503
    });
  }
}

function requireFingerprintEncryption(req, res, next) {
  try {
    assertConfigured();
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  allowRoles,
  createRateLimit,
  fingerprintErrorHandler,
  assertConfigured,
  requireFingerprintEncryption
};
