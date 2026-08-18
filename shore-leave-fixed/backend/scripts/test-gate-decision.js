const assert = require('assert');
const { createGateDecisionService } = require('../services/gateDecisionService');

function createHarness({ cadet = null, activeLeave = null } = {}) {
  const noOpModel = { create: async value => value };
  const service = createGateDecisionService({
    Cadet: { findOne: async () => cadet },
    LeaveRecord: { findOne: () => ({ sort: async () => activeLeave }) },
    NFCTag: { updateOne: async () => ({}) },
    GateHistory: noOpModel,
    AuditLog: noOpModel,
    DeviceConfig: { findOne: () => ({ lean: async () => ({ deviceName: 'Gate-1', location: 'Main Gate', reader: 'ACS ACR122U' }) }) },
    nfcService: {
      normalizeUid: value => String(value || '').toLowerCase(),
      getReaderStatus: () => ({ readerName: 'ACS ACR122 0' })
    },
    io: { emit: () => {} },
    nowTime: () => '10:00',
    onReturn: async () => ({}),
    onDecisionApplied: async () => {}
  });
  return service;
}

function cadet(overrides = {}) {
  return {
    roll: 'AMETUG2025_21247',
    name: 'Test Cadet',
    enrollmentStatus: 'ACTIVE',
    isBlocked: false,
    status: 'returned',
    gateStatus: 'INSIDE',
    nfc: { uid: '04a1f2bc34', assigned: true },
    pendingLeave: null,
    ...overrides
  };
}

async function main() {
  const unknown = await createHarness().evaluateGateAccess('unknown');
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.httpStatus, 404);

  const blocked = await createHarness({ cadet: cadet({ isBlocked: true }) }).evaluateGateAccess('04a1f2bc34');
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /blocked/i);

  const noLeave = await createHarness({ cadet: cadet() }).evaluateGateAccess('04a1f2bc34');
  assert.equal(noLeave.allowed, false);
  assert.equal(noLeave.direction, 'EXIT');

  const validLeave = { status: 'out', toDate: new Date(Date.now() + 3600000), checkOutDate: new Date() };
  const validReturn = await createHarness({ cadet: cadet({ status: 'out', gateStatus: 'OUTSIDE' }), activeLeave: validLeave }).evaluateGateAccess('04a1f2bc34');
  assert.equal(validReturn.allowed, true);
  assert.equal(validReturn.action, 'CHECK_IN');
  assert.equal(validReturn.late, false);

  const expiredLeave = { status: 'overdue', toDate: new Date(Date.now() - 3600000), checkOutDate: new Date(Date.now() - 7200000) };
  const lateReturn = await createHarness({ cadet: cadet({ status: 'out', gateStatus: 'OUTSIDE' }), activeLeave: expiredLeave }).evaluateGateAccess('04a1f2bc34');
  assert.equal(lateReturn.allowed, true);
  assert.equal(lateReturn.action, 'CHECK_IN');
  assert.equal(lateReturn.late, true);
  assert.equal(lateReturn.notifyAdmin, true);

  const approved = {
    approvalStatus: 'approved',
    fromDate: new Date(Date.now() - 60000),
    toDate: new Date(Date.now() + 3600000),
    leaveType: 'Shore Leave'
  };
  const exit = await createHarness({ cadet: cadet({ pendingLeave: approved }) }).evaluateGateAccess('04a1f2bc34');
  assert.equal(exit.allowed, true);
  assert.equal(exit.action, 'CHECK_OUT');

  console.log('PASS: Gate Decision Engine rules verified (6 scenarios).');
}

main().catch(error => {
  console.error('FAIL: Gate Decision Engine verification failed.', { code: error?.code || 'GATE_DECISION_TEST_FAILED' });
  process.exitCode = 1;
});
