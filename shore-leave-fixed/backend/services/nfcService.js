const RECONNECT_DELAY_MS = 3000;
const DEFAULT_SCAN_TIMEOUT_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 5000;

let nfcInstance = null;
let socketServer = null;
let readerName = null;
let readerConnected = false;
let initialized = false;
let reconnectTimer = null;
let lastScannedUID = null;
let lastScannedAt = null;
let onTapCallback = null;
let enrollmentTapCallback = null;
let enrollmentTimer = null;
let heartbeatTimer = null;
let currentMode = 'GATE_ENTRY';
const scanWaiters = [];

function normalizeUid(uid) {
  return String(uid || '').replace(/\s+/g, '').toLowerCase();
}

function getReaderStatus() {
  return {
    readerConnected,
    readerName,
    waiting: readerConnected && scanWaiters.length > 0,
    // The raw card UID is an access credential and must not be broadcast in health data.
    lastUid: lastScannedUID ? '[REDACTED]' : null,
    lastScannedAt,
    mode: currentMode,
    heartbeatAt: new Date(),
    // Compatibility keys used by the existing health and NFC routes.
    connected: readerConnected,
    reader: readerName
  };
}

function emitStatus(extra = {}) {
  socketServer?.emit('nfc:status', { ...getReaderStatus(), ...extra });
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const status = getReaderStatus();
    socketServer?.emit('nfc:heartbeat', status);
    socketServer?.emit('nfc:status', status);
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
}

function clearReconnectTimer() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function rejectScanWaiters(error) {
  while (scanWaiters.length) {
    const waiter = scanWaiters.shift();
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
}

function resolveNextScanWaiter(tapData) {
  const waiter = scanWaiters.shift();
  if (!waiter) return false;
  clearTimeout(waiter.timer);
  waiter.resolve(tapData);
  emitStatus();
  return true;
}

function handleCardScan(card) {
  const tapData = { uid: normalizeUid(card?.uid), timestamp: new Date() };
  if (!tapData.uid) return;

  lastScannedUID = tapData.uid;
  lastScannedAt = tapData.timestamp;
  console.log('NFC Card scanned.');
  socketServer?.emit('nfc:card', tapData);
  const consumedByWaiter = resolveNextScanWaiter(tapData);

  if (enrollmentTapCallback) {
    const callback = enrollmentTapCallback;
    exitEnrollmentMode();
    Promise.resolve(callback(tapData)).catch(() => console.error('NFC enrollment tap failed.'));
    return;
  }

  // Registration/test scans must never fall through into a real gate check-in.
  if (consumedByWaiter) return;

  if (onTapCallback) {
    Promise.resolve(onTapCallback(tapData)).catch(() => console.error('NFC tap callback failed.'));
  }
}

function attachReader(reader) {
  readerName = reader.name;
  readerConnected = true;
  console.log('NFC Reader Connected:', reader.name);
  console.log('Waiting for NFC Card...');
  emitStatus();

  reader.on('card', handleCardScan);
  reader.on('card.off', () => console.log('NFC Card removed.'));
  reader.on('error', () => {
    console.error('NFC Reader error.');
    socketServer?.emit('nfc:error', { message: 'NFC reader error' });
  });
  reader.on('end', () => {
    console.log('NFC Reader Removed:', reader.name);
    readerConnected = false;
    readerName = null;
    exitEnrollmentMode();
    rejectScanWaiters(new Error('NFC reader disconnected.'));
    emitStatus();
    // nfc-pcsc keeps monitoring PC/SC and emits `reader` again after replug.
  });
}

function disposeInstance() {
  if (!nfcInstance) return;
  try {
    nfcInstance.removeAllListeners?.();
    nfcInstance.close?.();
  } catch (error) {
    console.error('NFC cleanup error.');
  }
  nfcInstance = null;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initialized = false;
    disposeInstance();
    initializeNFC(socketServer);
  }, RECONNECT_DELAY_MS);
  reconnectTimer.unref?.();
}

function initializeNFC(io = socketServer) {
  if (io) socketServer = io;
  startHeartbeat();
  if (initialized && nfcInstance) return getReaderStatus();

  initialized = true;
  clearReconnectTimer();
  try {
    const { NFC } = require('nfc-pcsc');
    nfcInstance = new NFC();
    nfcInstance.on('reader', attachReader);
    nfcInstance.on('error', error => {
      console.error('NFC Service error.');
      readerConnected = false;
      readerName = null;
      exitEnrollmentMode();
      rejectScanWaiters(new Error('NFC service unavailable.'));
      emitStatus();
      scheduleReconnect();
    });
    console.log('NFC Service initialized. Waiting for reader...');
  } catch (error) {
    console.error('NFC initialization failed.');
    console.log('Backend remains online; emergency code, OTP, and manual check-in are still available.');
    readerConnected = false;
    readerName = null;
    emitStatus();
    scheduleReconnect();
  }
  return getReaderStatus();
}

function getLastScannedUID() {
  return lastScannedUID;
}

function waitForNextScan(timeoutMs = DEFAULT_SCAN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!readerConnected) {
      reject(new Error('NFC reader is disconnected.'));
      return;
    }

    const waiter = { resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      const index = scanWaiters.indexOf(waiter);
      if (index >= 0) scanWaiters.splice(index, 1);
      emitStatus();
      reject(new Error('No NFC card detected before timeout.'));
    }, Math.max(1000, Number(timeoutMs) || DEFAULT_SCAN_TIMEOUT_MS));
    waiter.timer.unref?.();
    scanWaiters.push(waiter);
    emitStatus();
  });
}

function cancelPendingScans(reason = 'NFC scan cancelled.') {
  rejectScanWaiters(new Error(reason));
  emitStatus();
}

function setMode(mode) {
  const normalized = String(mode || '').toUpperCase();
  if (!['REGISTRATION', 'ATTENDANCE', 'GATE_ENTRY', 'VERIFICATION'].includes(normalized)) {
    throw new Error('Invalid NFC reader mode.');
  }
  currentMode = normalized;
  emitStatus({ mode: currentMode });
  return currentMode;
}

function getMode() {
  return currentMode;
}

function setOnTapCallback(callback) {
  onTapCallback = callback;
}

function enterEnrollmentMode(callback, timeoutMs = DEFAULT_SCAN_TIMEOUT_MS) {
  exitEnrollmentMode();
  enrollmentTapCallback = callback;
  enrollmentTimer = setTimeout(() => {
    const timeoutCallback = enrollmentTapCallback;
    exitEnrollmentMode();
    timeoutCallback?.onTimeout?.();
  }, timeoutMs);
  enrollmentTimer.unref?.();
}

function exitEnrollmentMode() {
  if (enrollmentTimer) clearTimeout(enrollmentTimer);
  enrollmentTimer = null;
  enrollmentTapCallback = null;
}

module.exports = {
  initializeNFC,
  getReaderStatus,
  getLastScannedUID,
  waitForNextScan,
  cancelPendingScans,
  setMode,
  getMode,
  normalizeUid,
  setOnTapCallback,
  enterEnrollmentMode,
  exitEnrollmentMode,
  // Compatibility aliases for the integration already wired into server.js.
  startNFCService: initializeNFC,
  getStatus: getReaderStatus
};
