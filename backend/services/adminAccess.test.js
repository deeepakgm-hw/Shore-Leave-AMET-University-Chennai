const assert = require('node:assert/strict');
const { getOfficerAccess } = require('./adminAccess');

const now = new Date('2026-10-22T10:00:00.000Z');
const active = { startsAt: '2026-10-22T09:00:00.000Z', expiresAt: '2026-10-22T11:00:00.000Z' };

assert.equal(getOfficerAccess({ role: 'duty_officer', temporaryAdminGrant: active }, now).effectiveRole, 'admin');
assert.equal(getOfficerAccess({ role: 'duty_officer', temporaryAdminGrant: { ...active, revokedAt: now } }, now).effectiveRole, 'duty_officer');
assert.equal(getOfficerAccess({ role: 'duty_officer', temporaryAdminGrant: { ...active, expiresAt: '2026-10-22T10:00:00.000Z' } }, now).effectiveRole, 'duty_officer');
assert.equal(getOfficerAccess({ role: 'admin', temporaryAdminGrant: active }, now).isPermanentAdmin, true);
assert.equal(getOfficerAccess({ role: 'admin', temporaryAdminGrant: active }, now).temporaryAdmin, false);
console.log('admin access tests passed');
