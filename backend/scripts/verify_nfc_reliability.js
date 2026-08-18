const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { io } = require('socket.io-client');

const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function main() {
  const username = String(process.env.DEFAULT_ADMIN_USERNAME || '').trim();
  const password = String(process.env.DEFAULT_ADMIN_PASSWORD || '').trim();
  if (!username || !password) {
    throw new Error('DEFAULT_ADMIN_USERNAME and DEFAULT_ADMIN_PASSWORD are required for this verification script.');
  }

  const login = await request('/api/auth/officer/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password
    })
  });
  if (!login.response.ok || !login.body.token) {
    throw new Error(`Admin login failed (${login.response.status}).`);
  }

  const headers = {
    Authorization: `Bearer ${login.body.token}`,
    'Content-Type': 'application/json'
  };
  const [health, config] = await Promise.all([
    request('/api/device/status', { headers }),
    request('/api/device/config', { headers })
  ]);

  const socket = io(baseUrl, { auth: { token: login.body.token }, transports: ['websocket'] });
  const heartbeatPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('NFC heartbeat timeout.')), 8000);
    socket.once('nfc:heartbeat', heartbeat => {
      clearTimeout(timeout);
      resolve(heartbeat);
    });
  });

  const firstScanPromise = request('/api/nfc/scan', { method: 'POST', headers, body: '{}' });
  await sleep(400);
  const secondScan = await request('/api/nfc/scan', { method: 'POST', headers, body: '{}' });
  await request('/api/nfc/cancel', { method: 'POST', headers, body: '{}' });
  const firstScan = await firstScanPromise;

  let timeoutCheck = null;
  if (process.env.FULL_NFC_TEST === '1') {
    const startedAt = Date.now();
    const keepAlive = setInterval(() => {}, 1000);
    const timedOutScan = await request('/api/nfc/scan', { method: 'POST', headers, body: '{}' });
    clearInterval(keepAlive);
    timeoutCheck = {
      status: timedOutScan.response.status,
      code: timedOutScan.body.code,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000)
    };
  }

  const unknownUid = `testunknown${Date.now()}`;
  const unknown = await request('/api/nfc/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify({ uid: unknownUid })
  });
  await sleep(300);
  const audits = await request('/api/audit-logs', { headers });
  const auditList = Array.isArray(audits.body)
    ? audits.body
    : (audits.body.logs || audits.body.data || []);
  const unknownAudit = auditList.find(entry => (
    entry.action === 'NFC_UNKNOWN_CARD' && entry.details?.uid === unknownUid
  ));
  const heartbeat = await heartbeatPromise;
  socket.close();

  const result = {
    health: {
      mongodb: health.body.mongodb,
      supabase: health.body.supabase,
      nfc: health.body.nfc,
      face: health.body.face,
      camera: health.body.camera
    },
    device: {
      deviceName: config.body.deviceName,
      reader: config.body.reader,
      location: config.body.location,
      enabled: config.body.enabled,
      mode: config.body.mode
    },
    lock: {
      status: secondScan.response.status,
      code: secondScan.body.code,
      message: secondScan.body.error
    },
    cancelledFirstScan: {
      status: firstScan.response.status,
      message: firstScan.body.error
    },
    timeout: timeoutCheck,
    unknownCard: {
      status: unknown.response.status,
      message: unknown.body.error,
      auditCreated: Boolean(unknownAudit),
      auditDevice: unknownAudit?.details?.deviceName || null
    },
    heartbeat: {
      received: Boolean(heartbeat),
      connected: heartbeat.readerConnected,
      readerName: heartbeat.readerName,
      mode: heartbeat.mode
    }
  };

  console.log(JSON.stringify({
    firstScanStatus: firstScan.response.status,
    secondScanStatus: secondScan.response.status,
    duplicateProtectionPassed: secondScan.response.status === 409
  }, null, 2));
  const passed = secondScan.response.status === 409
    && secondScan.body.code === 'NFC_READER_LOCKED'
    && (!timeoutCheck || (timeoutCheck.status === 408 && timeoutCheck.code === 'NFC_SCAN_TIMEOUT' && timeoutCheck.elapsedSeconds >= 59))
    && unknown.response.status === 404
    && Boolean(unknownAudit)
    && Boolean(heartbeat.readerConnected);
  if (!passed) process.exitCode = 1;
}

main().catch(error => {
  console.error('NFC reliability verification failed.', { code: error?.code || 'NFC_RELIABILITY_TEST_FAILED' });
  process.exitCode = 1;
});
