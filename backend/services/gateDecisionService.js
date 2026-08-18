const VALID_ACCOUNT_STATES = new Set(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLOCKED', 'GRADUATED', 'PENDING_FACE']);

function normalizedAccountStatus(cadet) {
  if (cadet?.isBlocked) return 'BLOCKED';
  const status = String(cadet?.enrollmentStatus || 'ACTIVE').toUpperCase();
  return VALID_ACCOUNT_STATES.has(status) ? status : 'INACTIVE';
}

function isLeaveBlockActive(cadet) {
  if (!cadet?.leaveBlocked) return false;
  if (!cadet.leaveBlockedUntil) return true;
  const until = new Date(cadet.leaveBlockedUntil);
  if (Number.isNaN(until.getTime())) return true;
  return until > new Date();
}

function resolveGateStatus(cadet, activeLeave) {
  if (activeLeave) return 'OUTSIDE';
  const explicit = String(cadet?.gateStatus || '').toUpperCase();
  if (explicit === 'INSIDE' || explicit === 'OUTSIDE') return explicit;
  return String(cadet?.status || '').toLowerCase() === 'out' ? 'OUTSIDE' : 'INSIDE';
}

function resolveLeaveEnd(leave) {
  const value = leave?.toDate || leave?.returnDate || leave?.checkInDate;
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function resolveLeaveStart(leave) {
  const value = leave?.fromDate || leave?.checkOutDate;
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function createGateDecisionService({
  Cadet,
  LeaveRecord,
  NFCTag,
  GateHistory,
  AuditLog,
  DeviceConfig,
  nfcService,
  io,
  nowTime,
  onReturn,
  onBeforeCheckOut,
  onDecisionApplied
}) {
  async function deviceContext() {
    const device = await DeviceConfig.findOne({ deviceId: process.env.NFC_DEVICE_ID || 'gate-1' }).lean();
    const readerStatus = nfcService.getReaderStatus();
    return {
      gate: device?.deviceName || 'Gate-1',
      location: device?.location || 'Main Gate',
      reader: readerStatus.readerName || device?.reader || 'ACS ACR122U'
    };
  }

  async function findAssignedCadet(uid) {
    return Cadet.findOne({
      'nfc.uid': uid,
      $or: [
        { 'nfc.assigned': true },
        { 'nfc.status': 'ACTIVE' }
      ]
    });
  }

  async function evaluateCadetAccess({ cadet, gateType = 'AUTO', uid = null, device }) {
    const accountStatus = normalizedAccountStatus(cadet);
    const activeLeave = await LeaveRecord.findOne({
      roll: cadet.roll,
      status: { $in: ['out', 'overdue'] },
      $or: [{ checkInDate: null }, { checkInDate: { $exists: false } }]
    }).sort({ checkOutDate: -1, _id: -1 });
    const gateStatus = resolveGateStatus(cadet, activeLeave);
    const requestedGateType = String(gateType || 'AUTO').toUpperCase();
    const requestedDirection = requestedGateType === 'CHECK_IN'
      ? 'ENTRY'
      : requestedGateType === 'CHECK_OUT'
        ? 'EXIT'
        : requestedGateType;

    if (['SUSPENDED', 'BLOCKED', 'GRADUATED', 'INACTIVE'].includes(accountStatus)) {
      return {
        allowed: false,
        action: 'NONE',
        direction: gateStatus === 'OUTSIDE' ? 'ENTRY' : 'EXIT',
        reason: `Cadet account is ${accountStatus.toLowerCase()}.`,
        httpStatus: 403,
        uid,
        cadet,
        activeLeave,
        accountStatus,
        gateStatus,
        device
      };
    }

    if (requestedDirection === 'EXIT' && (activeLeave || gateStatus === 'OUTSIDE')) {
      return {
        allowed: false,
        action: 'NONE',
        direction: 'EXIT',
        reason: 'Cadet is already outside campus.',
        httpStatus: 409,
        uid,
        cadet,
        activeLeave,
        accountStatus,
        gateStatus,
        device
      };
    }

    if (activeLeave || gateStatus === 'OUTSIDE' || requestedDirection === 'ENTRY') {
      if (!activeLeave) {
        return { allowed: false, action: 'NONE', direction: 'ENTRY', reason: 'No active leave found for this cadet.', httpStatus: 400, uid, cadet, accountStatus, gateStatus, device };
      }
      const now = new Date();
      const leaveEnd = resolveLeaveEnd(activeLeave);
      const late = Boolean(leaveEnd && now > leaveEnd);
      return {
        allowed: true,
        action: 'CHECK_IN',
        direction: 'ENTRY',
        reason: late ? 'Leave expired - late return allowed.' : 'Approved leave return.',
        updateAttendance: true,
        closeLeave: true,
        notifyAdmin: late,
        late,
        uid,
        cadet,
        activeLeave,
        accountStatus,
        gateStatus,
        device
      };
    }

    const approvedLeave = cadet.pendingLeave?.approvalStatus === 'approved' ? cadet.pendingLeave : null;
    if (isLeaveBlockActive(cadet)) {
      return {
        allowed: false,
        action: 'NONE',
        direction: 'EXIT',
        reason: cadet.leaveBlockedReason || 'Leave privileges suspended.',
        httpStatus: 403,
        code: 'LEAVE_BLOCKED',
        uid,
        cadet,
        accountStatus,
        gateStatus,
        device,
        metadata: {
          leaveBlocked: true,
          leaveBlockedReason: cadet.leaveBlockedReason || 'Administrative Hold',
          leaveBlockedDate: cadet.leaveBlockedDate || null,
          leaveBlockedUntil: cadet.leaveBlockedUntil || null
        }
      };
    }
    if (!approvedLeave) {
      return { allowed: false, action: 'NONE', direction: 'EXIT', reason: 'No approved leave is available for exit.', httpStatus: 403, uid, cadet, accountStatus, gateStatus, device };
    }
    const now = new Date();
    const leaveStart = resolveLeaveStart(approvedLeave);
    const leaveEnd = resolveLeaveEnd(approvedLeave);
    if (leaveStart && now < leaveStart) {
      return { allowed: false, action: 'NONE', direction: 'EXIT', reason: 'Approved leave has not started.', httpStatus: 403, uid, cadet, approvedLeave, accountStatus, gateStatus, device };
    }
    if (leaveEnd && now > leaveEnd) {
      return { allowed: false, action: 'NONE', direction: 'EXIT', reason: 'Approved leave expired before exit.', httpStatus: 403, uid, cadet, approvedLeave, accountStatus, gateStatus, device };
    }
    return {
      allowed: true,
      action: 'CHECK_OUT',
      direction: 'EXIT',
      reason: 'Approved leave departure.',
      updateAttendance: true,
      closeLeave: false,
      notifyAdmin: false,
      uid,
      cadet,
      approvedLeave,
      accountStatus,
      gateStatus,
      device
    };
  }

  async function evaluateGateAccess(rawUid, gateType = 'AUTO') {
    const uid = nfcService.normalizeUid(rawUid);
    const device = await deviceContext();
    if (!uid) {
      return { allowed: false, action: 'NONE', direction: 'UNKNOWN', reason: 'NFC UID is required.', httpStatus: 400, uid, device };
    }

    const cadet = await findAssignedCadet(uid);
    if (!cadet) {
      return { allowed: false, action: 'NONE', direction: 'UNKNOWN', reason: 'Unknown Card', httpStatus: 404, uid, device };
    }

    return evaluateCadetAccess({ cadet, gateType, uid, device });
  }

  async function recordDecision(decision, extra = {}) {
    const method = String(extra.method || decision.verification?.method || 'NFC').toUpperCase();
    const history = await GateHistory.create({
      uid: decision.uid || `${method}:${decision.cadet?.roll || 'unknown'}`,
      cadetId: decision.cadet?.roll || null,
      cadetName: decision.cadet?.name || null,
      gate: decision.device?.gate || 'Gate-1',
      location: decision.device?.location,
      reader: decision.device?.reader,
      direction: decision.direction || 'UNKNOWN',
      decision: decision.allowed ? 'ALLOWED' : 'DENIED',
      action: decision.action || 'NONE',
      reason: decision.reason,
      leaveId: extra.leaveId || decision.activeLeave?._id || null,
      leaveStatus: extra.leaveStatus || null,
      attendanceStatus: extra.attendanceStatus || decision.cadet?.attendanceStatus || null,
      metadata: {
        accountStatus: decision.accountStatus || null,
        late: Boolean(decision.late),
        verificationMethod: method,
        officerTerminal: decision.verification?.terminal || null,
        officerId: decision.verification?.actor || null,
        score: decision.verification?.score ?? null,
        ...extra.metadata
      }
    });
    await AuditLog.create({
      action: decision.allowed
        ? `${method}_GATE_${decision.action}_ALLOWED`
        : (method === 'NFC' && decision.httpStatus === 404 ? 'NFC_UNKNOWN_CARD' : `${method}_GATE_ACCESS_DENIED`),
      roll: decision.cadet?.roll,
      details: {
        uid: decision.uid,
        gate: decision.device?.gate,
        location: decision.device?.location,
        reader: decision.device?.reader,
        direction: decision.direction,
        decision: decision.allowed ? 'ALLOWED' : 'DENIED',
        reason: decision.reason,
        gateHistoryId: history._id,
        verificationMethod: method,
        officerTerminal: decision.verification?.terminal || null,
        officerId: decision.verification?.actor || null,
        gatePassId: extra.metadata?.gatePassId || null
      }
    });
    return history;
  }

  async function applyCheckIn(decision) {
    const { cadet, activeLeave, uid } = decision;
    const checkInDate = new Date();
    const leaveStatus = decision.late ? 'LATE_RETURN' : 'COMPLETED';
    activeLeave.status = decision.late ? 'late_return' : 'returned';
    activeLeave.checkInTime = nowTime();
    activeLeave.checkInDate = checkInDate;
    activeLeave.expired = true;
    await activeLeave.save();

    cadet.status = 'returned';
    cadet.attendanceStatus = 'INSIDE';
    cadet.gateStatus = 'INSIDE';
    cadet.leaveStatus = leaveStatus;
    if (cadet.pendingLeave && activeLeave.leaveType !== 'Shore Leave') cadet.pendingLeave = null;
    if (uid) {
      cadet.nfc.lastSeen = checkInDate;
      cadet.nfc.lastUsed = checkInDate;
      cadet.nfc.lastUpdated = checkInDate;
      cadet.nfc.useCount = Number(cadet.nfc.useCount || 0) + 1;
      cadet.markModified('nfc');
    }
    await cadet.save();
    if (uid) await NFCTag.updateOne({ uid }, { $set: { lastUsed: checkInDate }, $inc: { useCount: 1 } });

    const callbackResult = await onReturn?.({ cadet, activeLeave, late: decision.late, checkInDate }) || {};
    const method = decision.verification?.method || 'NFC';
    await recordDecision(decision, {
      method,
      leaveId: activeLeave._id,
      leaveStatus,
      attendanceStatus: 'INSIDE',
      metadata: { xpGained: callbackResult.xpGained || 0 }
    });
    if (decision.notifyAdmin) io.to('admin').emit('nfc:late-return', { roll: cadet.roll, name: cadet.name, returnedAt: checkInDate, leaveEndedAt: resolveLeaveEnd(activeLeave) });
    return {
      success: true,
      ok: true,
      allowed: true,
      action: 'CHECK_IN',
      reason: decision.reason,
      cadetId: cadet.roll,
      cadetName: cadet.name,
      cadet: { id: cadet.roll, name: cadet.name },
      rollNumber: cadet.roll,
      photo: callbackResult.photo || cadet.photoUrl || activeLeave.checkOutPhotoUrl || '',
      leaveType: activeLeave.leaveType || '-',
      timeOut: activeLeave.checkOutTime || '-',
      timeIn: activeLeave.checkInTime,
      returnStatus: decision.late ? 'late' : callbackResult.returnStatus || 'onTime',
      status: decision.late ? 'LATE' : callbackResult.status || 'ON TIME',
      xpGained: callbackResult.xpGained || 0,
      method
    };
  }

  async function applyCheckOut(decision) {
    const { cadet, approvedLeave, uid } = decision;
    const checkOutDate = new Date();
    const method = decision.verification?.method || 'NFC';
    const gatePassDelivery = await onBeforeCheckOut?.({
      cadet,
      approvedLeave,
      checkOutDate,
      method,
      verification: decision.verification || null
    }) || {};
    const payload = {
      roll: cadet.roll,
      name: cadet.name,
      email: cadet.email,
      batch: cadet.batch,
      course: cadet.course,
      studentId: cadet.studentId,
      dest: approvedLeave.dest,
      checkOutTime: nowTime(),
      checkOutDate,
      checkInTime: null,
      checkInDate: null,
      fromDate: approvedLeave.fromDate,
      toDate: approvedLeave.toDate,
      fromTime: approvedLeave.fromTime,
      toTime: approvedLeave.toTime,
      returnDate: approvedLeave.returnDate,
      status: 'out',
      leaveType: approvedLeave.leaveType || 'Shore Leave',
      leaveReason: approvedLeave.reason || approvedLeave.leaveReason,
      leaveDocumentUrl: approvedLeave.documentUrl,
      approvalStatus: 'approved',
      approvedBy: approvedLeave.reviewedBy || approvedLeave.approvedBy,
      approvedAt: approvedLeave.reviewedAt || approvedLeave.approvedAt,
      passId: approvedLeave.passId,
      passVerificationToken: approvedLeave.passVerificationToken,
      emergencyVerificationCode: approvedLeave.emergencyVerificationCode || approvedLeave.passVerificationToken,
      emergencyCodeGeneratedAt: approvedLeave.emergencyCodeGeneratedAt,
      emergencyCodeExpiresAt: approvedLeave.emergencyCodeExpiresAt || approvedLeave.toDate,
      gatePassPdfUrl: approvedLeave.gatePassPdfUrl,
      gatePass: approvedLeave.gatePass,
      storageStatus: approvedLeave.storageStatus,
      storageUploadedAt: approvedLeave.storageUploadedAt,
      expired: false,
      passIssuedAt: approvedLeave.passIssuedAt || checkOutDate,
      gatePassStatus: approvedLeave.gatePassStatus || 'issued_at_checkout',
      gatePassEmailSentAt: approvedLeave.gatePassEmailSentAt
    };
    let leaveRecord = approvedLeave.passId ? await LeaveRecord.findOne({ roll: cadet.roll, passId: approvedLeave.passId }) : null;
    if (leaveRecord) {
      Object.assign(leaveRecord, payload);
      await leaveRecord.save();
    } else {
      leaveRecord = await LeaveRecord.create(payload);
    }

    cadet.status = 'out';
    cadet.attendanceStatus = 'OUTSIDE';
    cadet.gateStatus = 'OUTSIDE';
    cadet.leaveStatus = 'ON_LEAVE';
    cadet.pendingLeave.travelStatus = 'checked_out';
    cadet.pendingLeave.checkedOutAt = checkOutDate;
    cadet.markModified('pendingLeave');
    if (uid) {
      cadet.nfc.lastSeen = checkOutDate;
      cadet.nfc.lastUsed = checkOutDate;
      cadet.nfc.lastUpdated = checkOutDate;
      cadet.nfc.useCount = Number(cadet.nfc.useCount || 0) + 1;
      cadet.markModified('nfc');
    }
    await cadet.save();
    if (uid) await NFCTag.updateOne({ uid }, { $set: { lastUsed: checkOutDate }, $inc: { useCount: 1 } });
    await recordDecision(decision, {
      method,
      leaveId: leaveRecord._id,
      leaveStatus: 'ON_LEAVE',
      attendanceStatus: 'OUTSIDE',
      metadata: { gatePassId: leaveRecord.passId || approvedLeave.passId || null }
    });
    return {
      success: true,
      ok: true,
      allowed: true,
      action: 'CHECK_OUT',
      reason: decision.reason,
      cadetId: cadet.roll,
      cadetName: cadet.name,
      cadet: { id: cadet.roll, name: cadet.name },
      rollNumber: cadet.roll,
      leaveType: leaveRecord.leaveType,
      timeOut: leaveRecord.checkOutTime,
      timeIn: '-',
      status: 'EXITED',
      method,
      passId: leaveRecord.passId,
      gatePassUrl: gatePassDelivery.gatePassUrl || approvedLeave.gatePassUrl || null,
      accessGranted: true,
      gateAccess: 'APPROVED',
      checkedOutAt: checkOutDate
    };
  }

  async function processNfcTap(uid, gateType = 'AUTO') {
    const decision = await evaluateGateAccess(uid, gateType);
    if (!decision.allowed) {
      await recordDecision(decision);
      return { success: false, allowed: false, action: 'NONE', httpStatus: decision.httpStatus, message: decision.reason, reason: decision.reason };
    }
    const result = decision.action === 'CHECK_IN' ? await applyCheckIn(decision) : await applyCheckOut(decision);
    io.to('admin').emit(decision.action === 'CHECK_IN' ? 'cadet:checkin' : 'cadet:checkout', result);
    await onDecisionApplied?.(result);
    return result;
  }

  async function processVerifiedIdentity(cadetId, gateType = 'CHECK_OUT', verification = {}) {
    const value = String(cadetId || '').trim();
    const device = await deviceContext();
    const identityQueries = [{ roll: value }, { studentId: value }];
    if (/^[a-f\d]{24}$/i.test(value)) identityQueries.unshift({ _id: value });
    const cadet = value ? await Cadet.findOne({ $or: identityQueries }) : null;
    if (!cadet) {
      return {
        success: false,
        allowed: false,
        action: 'NONE',
        httpStatus: 404,
        code: 'CADET_NOT_FOUND',
        message: 'Cadet not found.'
      };
    }

    const decision = await evaluateCadetAccess({ cadet, gateType, device });
    decision.verification = {
      method: String(verification.method || 'BIOMETRIC').toUpperCase(),
      actor: verification.actor || null,
      terminal: verification.terminal || null,
      score: verification.score ?? null,
      threshold: verification.threshold ?? null,
      ipAddress: verification.ipAddress || null
    };
    if (!decision.allowed) {
      await recordDecision(decision, { method: decision.verification.method });
      return {
        success: false,
        allowed: false,
        action: 'NONE',
        httpStatus: decision.httpStatus || 403,
        code: decision.code || 'GATE_ACCESS_DENIED',
        message: decision.reason,
        reason: decision.reason
      };
    }

    const result = decision.action === 'CHECK_IN'
      ? await applyCheckIn(decision)
      : await applyCheckOut(decision);
    io.to('admin').emit(decision.action === 'CHECK_IN' ? 'cadet:checkin' : 'cadet:checkout', result);
    io.to('admin').emit('gate:access-approved', {
      roll: cadet.roll,
      action: decision.action,
      method: decision.verification.method,
      passId: result.passId || null,
      terminal: decision.verification.terminal || null,
      timestamp: new Date()
    });
    await onDecisionApplied?.(result);
    return result;
  }

  return { evaluateGateAccess, processNfcTap, processVerifiedIdentity };
}

module.exports = {
  createGateDecisionService,
  normalizedAccountStatus,
  resolveGateStatus,
  resolveLeaveStart,
  resolveLeaveEnd
};
