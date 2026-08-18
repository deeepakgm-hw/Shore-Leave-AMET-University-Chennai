const express = require('express');
const NFCTag = require('../models/NFCTag');
const DeviceConfig = require('../models/DeviceConfig');
const { generateNFCCode } = require('../services/nfcCodeService');

const SCAN_TIMEOUT_MS = 60000;
let pendingManagementScan = null;

function createNfcRouter({ requireOfficer, asyncHandler, Cadet, GateHistory, nfcService, io, verifyNfcTap, AuditLog }) {
  const router = express.Router();

  function actor(req) {
    return req.officer?.username || 'Administrator';
  }

  async function findCadet(cadetId) {
    const value = String(cadetId || '').trim();
    if (!value) return null;
    return Cadet.findOne({ $or: [{ roll: value.toUpperCase() }, { studentId: value }] });
  }

  async function assertUidAvailable(uid) {
    const owner = await Cadet.findOne({
      $or: [{ 'nfc.uid': uid }, { 'nfc.history.uid': uid }, { 'nfc.replacementHistory.uid': uid }]
    }).select('roll name nfc');
    if (owner) {
      const error = new Error(`Card already assigned to ${owner.roll} - ${owner.name || 'Unknown cadet'}`);
      error.statusCode = 409;
      error.code = 'NFC_DUPLICATE';
      error.owner = { roll: owner.roll, name: owner.name };
      throw error;
    }
  }

  async function waitForManagementScan(type, cadetId, requestedBy) {
    if (pendingManagementScan) {
      const error = new Error('Reader currently in use by another administrator.');
      error.statusCode = 409;
      error.code = 'NFC_READER_LOCKED';
      throw error;
    }
    if (!nfcService.getReaderStatus().readerConnected) {
      const error = new Error('NFC reader is offline. Connect the ACR122U and try again.');
      error.statusCode = 503;
      throw error;
    }

    pendingManagementScan = { type, cadetId, requestedBy, startedAt: new Date(), timeoutSeconds: 60 };
    nfcService.setMode(type === 'TEST' ? 'VERIFICATION' : 'REGISTRATION');
    io.to('admin').emit('nfc:management', { state: 'SCANNING', type, cadetId });
    try {
      return await nfcService.waitForNextScan(SCAN_TIMEOUT_MS);
    } catch (error) {
      if (/timeout/i.test(error.message)) {
        error.statusCode = 408;
        error.code = 'NFC_SCAN_TIMEOUT';
        io.to('admin').emit('nfc:management', { state: 'TIMEOUT', type, cadetId });
      }
      throw error;
    } finally {
      pendingManagementScan = null;
      nfcService.setMode('GATE_ENTRY');
      io.to('admin').emit('nfc:management', { state: 'IDLE' });
    }
  }

  async function synchronizeCadetNfc(cadet, tag, action, requestedBy, reason = null) {
    const now = new Date();
    const current = cadet.nfc?.toObject ? cadet.nfc.toObject() : (cadet.nfc || {});
    const history = Array.isArray(current.history) ? [...current.history] : [];
    const replacementHistory = Array.isArray(current.replacementHistory) ? [...current.replacementHistory] : [];

    if (action === 'REGISTER') {
      history.push({ uid: tag.uid, assignedAt: now, assignedBy: requestedBy, status: 'ACTIVE' });
      cadet.nfc = {
        uid: tag.uid,
        code: tag.nfcCode,
        assigned: true,
        status: 'ACTIVE',
        assignedAt: now,
        assignedBy: requestedBy,
        lastUsed: null,
        lastUpdated: now,
        useCount: 0,
        history,
        replacementHistory
      };
    } else if (action === 'REPLACE') {
      const oldUid = current.uid;
      for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index].uid === oldUid && history[index].status === 'ACTIVE') {
          history[index] = { ...history[index], removedAt: now, status: 'REPLACED' };
          break;
        }
      }
      history.push({ uid: tag.uid, assignedAt: now, assignedBy: requestedBy, status: 'ACTIVE' });
      if (oldUid) {
        replacementHistory.push({
          uid: oldUid,
          assignedAt: current.assignedAt,
          assignedBy: current.assignedBy,
          replacedAt: now,
          status: 'REPLACED'
        });
      }
      cadet.nfc = {
        uid: tag.uid,
        code: tag.nfcCode,
        assigned: true,
        status: 'ACTIVE',
        assignedAt: now,
        assignedBy: requestedBy,
        lastUsed: tag.lastUsed || null,
        lastUpdated: now,
        useCount: tag.useCount || 0,
        history,
        replacementHistory
      };
    } else if (action === 'REMOVE') {
      for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index].uid === current.uid && history[index].status === 'ACTIVE') {
          history[index] = { ...history[index], removedAt: now, status: reason };
          break;
        }
      }
      cadet.nfc = {
        uid: null,
        code: current.code || tag?.nfcCode || null,
        assigned: false,
        status: 'UNASSIGNED',
        assignedAt: null,
        assignedBy: null,
        lastUsed: current.lastUsed || tag?.lastUsed || null,
        lastUpdated: now,
        useCount: current.useCount || tag?.useCount || 0,
        history,
        replacementHistory: [
          ...replacementHistory,
          ...(current.uid ? [{
            uid: current.uid,
            assignedAt: current.assignedAt,
            assignedBy: current.assignedBy,
            replacedAt: now,
            status: reason
          }] : [])
        ]
      };
    }
    cadet.markModified('nfc');
    await cadet.save();
  }

  router.get('/status', requireOfficer, (req, res) => {
    const status = nfcService.getReaderStatus();
    res.json({
      readerConnected: status.readerConnected,
      readerName: status.readerName,
      waiting: !!pendingManagementScan || status.waiting,
      lastUid: status.lastUid,
      lastScannedAt: status.lastScannedAt,
      operation: pendingManagementScan
    });
  });

  router.post('/scan', requireOfficer, asyncHandler(async (req, res) => {
    const tap = await waitForManagementScan('TEST', null, actor(req));
    await AuditLog.create({ action: 'NFC_READER_TEST', details: { uid: tap.uid, officer: actor(req) } });
    res.json({ success: true, uid: tap.uid, scannedAt: tap.timestamp });
  }));

  router.post('/cancel', requireOfficer, (req, res) => {
    nfcService.cancelPendingScans('NFC scan cancelled by administrator.');
    nfcService.exitEnrollmentMode();
    pendingManagementScan = null;
    nfcService.setMode('GATE_ENTRY');
    io.to('admin').emit('nfc:management', { state: 'IDLE' });
    res.json({ success: true });
  });

  router.post('/register', requireOfficer, asyncHandler(async (req, res) => {
    const cadet = await findCadet(req.body?.cadetId);
    if (!cadet) return res.status(404).json({ error: 'Cadet not found.' });
    if (cadet.nfc?.status === 'ACTIVE' && cadet.nfc?.uid) {
      return res.status(409).json({ error: 'Cadet already has an active NFC card. Use Replace Card.', code: 'NFC_REPLACE_REQUIRED' });
    }

    const requestedBy = actor(req);
    const tap = await waitForManagementScan('REGISTER', cadet.roll, requestedBy);
    await assertUidAvailable(tap.uid);

    let tag = await NFCTag.findOne({ cadetId: cadet.roll });
    if (!tag) tag = new NFCTag({ cadetId: cadet.roll, nfcCode: await generateNFCCode() });
    tag.uid = tap.uid;
    tag.cadetName = cadet.name;
    tag.rollNumber = cadet.roll;
    tag.active = true;
    tag.enrolledAt = new Date();
    tag.enrolledBy = requestedBy;
    await tag.save();
    await synchronizeCadetNfc(cadet, tag, 'REGISTER', requestedBy);
    await AuditLog.create({ action: 'NFC_REGISTERED', roll: cadet.roll, details: { uid: tag.uid, nfcCode: tag.nfcCode, assignedBy: requestedBy } });
    io.to('admin').emit('nfc:registration', { success: true, action: 'REGISTERED', cadetId: cadet.roll });
    res.json({ success: true, uid: tag.uid, nfcCode: tag.nfcCode, cadetId: cadet.roll, cadetName: cadet.name });
  }));

  router.post('/replace', requireOfficer, asyncHandler(async (req, res) => {
    if (req.body?.confirmed !== true) return res.status(400).json({ error: 'Replacement confirmation is required.' });
    const cadet = await findCadet(req.body?.cadetId);
    if (!cadet) return res.status(404).json({ error: 'Cadet not found.' });
    const tag = await NFCTag.findOne({ cadetId: cadet.roll, active: true });
    if (!tag || cadet.nfc?.status !== 'ACTIVE') return res.status(400).json({ error: 'No active NFC card to replace. Use Register Card.' });

    const requestedBy = actor(req);
    const tap = await waitForManagementScan('REPLACE', cadet.roll, requestedBy);
    if (tap.uid === tag.uid) return res.status(409).json({ error: 'The scanned card is already assigned to this cadet.' });
    await assertUidAvailable(tap.uid);

    tag.previousTags.push({
      uid: tag.uid,
      assignedAt: tag.enrolledAt,
      assignedBy: tag.enrolledBy,
      deactivatedAt: new Date(),
      reason: 'replaced',
      status: 'REPLACED'
    });
    const oldUid = tag.uid;
    tag.uid = tap.uid;
    tag.active = true;
    tag.enrolledAt = new Date();
    tag.enrolledBy = requestedBy;
    await tag.save();
    await synchronizeCadetNfc(cadet, tag, 'REPLACE', requestedBy);
    await AuditLog.create({ action: 'NFC_REPLACED', roll: cadet.roll, details: { oldUid, newUid: tag.uid, nfcCode: tag.nfcCode, assignedBy: requestedBy } });
    io.to('admin').emit('nfc:registration', { success: true, action: 'REPLACED', cadetId: cadet.roll });
    res.json({ success: true, uid: tag.uid, oldUid, nfcCode: tag.nfcCode, cadetId: cadet.roll, cadetName: cadet.name });
  }));

  router.post('/remove', requireOfficer, asyncHandler(async (req, res) => {
    if (req.body?.confirmed !== true) return res.status(400).json({ error: 'Removal confirmation is required.' });
    const reason = String(req.body?.reason || 'DISABLED').toUpperCase();
    if (!['LOST', 'DISABLED'].includes(reason)) return res.status(400).json({ error: 'reason must be LOST or DISABLED.' });
    const cadet = await findCadet(req.body?.cadetId);
    if (!cadet) return res.status(404).json({ error: 'Cadet not found.' });
    const tag = await NFCTag.findOne({ cadetId: cadet.roll });
    if (!tag || !tag.active) return res.status(400).json({ error: 'Cadet has no active NFC card.' });

    tag.previousTags.push({
      uid: tag.uid,
      assignedAt: tag.enrolledAt,
      assignedBy: tag.enrolledBy,
      deactivatedAt: new Date(),
      reason: reason.toLowerCase(),
      status: reason
    });
    const removedUid = tag.uid;
    tag.active = false;
    await tag.save();
    await synchronizeCadetNfc(cadet, tag, 'REMOVE', actor(req), reason);
    await AuditLog.create({ action: 'NFC_REMOVED', roll: cadet.roll, details: { uid: removedUid, reason, removedBy: actor(req) } });
    io.to('admin').emit('nfc:registration', { success: true, action: reason, cadetId: cadet.roll });
    res.json({ success: true, cadetId: cadet.roll, uid: removedUid, status: 'UNASSIGNED', reason });
  }));

  router.post('/verify', requireOfficer, asyncHandler(async (req, res) => {
    const uid = nfcService.normalizeUid(req.body?.uid || nfcService.getLastScannedUID());
    if (!uid) return res.status(400).json({ error: 'No NFC card has been scanned.' });
    const cadet = await Cadet.findOne({
      'nfc.uid': uid,
      $or: [{ 'nfc.assigned': true }, { 'nfc.status': 'ACTIVE' }]
    }).select('-faceDescriptor -faceDescriptors');
    if (!cadet) {
      const device = await DeviceConfig.findOne({ deviceId: 'gate-1' }).lean();
      await AuditLog.create({
        action: 'NFC_UNKNOWN_CARD',
        details: {
          uid,
          scannedAt: new Date(),
          deviceName: device?.deviceName || 'Gate-1',
          location: device?.location || 'Main Gate',
          reader: nfcService.getReaderStatus().readerName || device?.reader || 'ACS ACR122U'
        }
      });
      return res.status(404).json({ success: false, error: 'Unknown Card' });
    }
    await AuditLog.create({ action: 'NFC_VERIFIED', roll: cadet.roll, details: { uid, verifiedBy: actor(req) } });
    res.json({ success: true, cadet });
  }));

  // Compatibility endpoints retained for the existing gate and earlier admin clients.
  router.post('/enrollment-mode/start', requireOfficer, (req, res) => {
    if (pendingManagementScan) {
      return res.status(409).json({
        success: false,
        code: 'NFC_READER_LOCKED',
        error: 'Reader currently in use by another administrator.'
      });
    }
    const status = nfcService.getReaderStatus();
    if (!status.readerConnected) return res.status(503).json({ success: false, message: 'NFC reader is disconnected.' });
    const requestedBy = actor(req);
    pendingManagementScan = { type: 'LEGACY_ENROLLMENT', cadetId: null, requestedBy, startedAt: new Date(), timeoutSeconds: 60 };
    nfcService.setMode('REGISTRATION');
    const releaseLegacyLock = state => {
      pendingManagementScan = null;
      nfcService.setMode('GATE_ENTRY');
      io.to('admin').emit('nfc:management', { state });
    };
    nfcService.enterEnrollmentMode(Object.assign(
      tapData => {
        io.to('admin').emit('nfc:enroll:tap', { detected: Boolean(tapData.uid) });
        releaseLegacyLock('IDLE');
      },
      { onTimeout: () => {
        io.to('admin').emit('nfc:enroll:timeout', {});
        releaseLegacyLock('TIMEOUT');
      } }
    ), SCAN_TIMEOUT_MS);
    io.to('admin').emit('nfc:management', { state: 'SCANNING', type: 'LEGACY_ENROLLMENT' });
    res.json({ success: true, timeoutSeconds: 60 });
  });
  router.post('/enrollment-mode/stop', requireOfficer, (req, res) => {
    nfcService.exitEnrollmentMode();
    pendingManagementScan = null;
    nfcService.setMode('GATE_ENTRY');
    io.to('admin').emit('nfc:management', { state: 'IDLE' });
    res.json({ success: true });
  });
  router.post('/enroll', requireOfficer, asyncHandler(async (req, res) => {
    return res.status(410).json({ error: 'Use /api/nfc/register or /api/nfc/replace. Manual UID enrollment is disabled.' });
  }));

  router.get('/tags', requireOfficer, asyncHandler(async (req, res) => {
    res.json(await NFCTag.find().sort({ enrolledAt: -1 }).lean());
  }));
  router.get('/tags/:cadetId', requireOfficer, asyncHandler(async (req, res) => {
    const cadet = await findCadet(req.params.cadetId);
    if (!cadet) return res.status(404).json({ error: 'Cadet not found.' });
    const tag = await NFCTag.findOne({ cadetId: cadet.roll }).lean();
    if (!tag) return res.status(404).json({ error: 'No NFC tag enrolled for this cadet.' });
    res.json({ ...tag, cadetNfc: cadet.nfc });
  }));
  router.get('/gate-history', requireOfficer, asyncHandler(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const filter = {};
    if (req.query.cadetId) filter.cadetId = String(req.query.cadetId).toUpperCase();
    if (req.query.gate) filter.gate = String(req.query.gate);
    if (req.query.decision) filter.decision = String(req.query.decision).toUpperCase();
    res.json(await GateHistory.find(filter).sort({ timestamp: -1 }).limit(limit).lean());
  }));
  router.delete('/tags/:cadetId', requireOfficer, asyncHandler(async (req, res) => {
    req.body = { ...(req.body || {}), cadetId: req.params.cadetId, confirmed: true, reason: 'DISABLED' };
    const cadet = await findCadet(req.params.cadetId);
    if (!cadet) return res.status(404).json({ error: 'Cadet not found.' });
    const tag = await NFCTag.findOne({ cadetId: cadet.roll });
    if (!tag || !tag.active) return res.status(400).json({ error: 'Cadet has no active NFC card.' });
    tag.previousTags.push({ uid: tag.uid, assignedAt: tag.enrolledAt, assignedBy: tag.enrolledBy, deactivatedAt: new Date(), reason: 'disabled', status: 'DISABLED' });
    const removedUid = tag.uid;
    tag.active = false;
    await tag.save();
    await synchronizeCadetNfc(cadet, tag, 'REMOVE', actor(req), 'DISABLED');
    await AuditLog.create({ action: 'NFC_REMOVED', roll: cadet.roll, details: { uid: removedUid, reason: 'DISABLED', removedBy: actor(req) } });
    io.to('admin').emit('nfc:registration', { success: true, action: 'DISABLED', cadetId: cadet.roll });
    res.json({ success: true });
  }));

  return router;
}

module.exports = { createNfcRouter };
