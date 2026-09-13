const assert = require('node:assert/strict');
const {
  MONTHLY_LEAVE_TOKEN_ALLOWANCE,
  calculateRequiredTokens,
  validateSundayOnly
} = require('../services/leaveTokenPolicy');

function tokens(leaveType, fromDate, toDate) {
  const result = calculateRequiredTokens({ leaveType, fromDate, toDate });
  if (!result.valid) throw new Error(result.message || 'Invalid token calculation');
  return result.requiredTokens;
}

assert.equal(MONTHLY_LEAVE_TOKEN_ALLOWANCE, 28, 'monthly allocation is 28');
assert.equal(tokens('Home Leave', '2026-09-01T09:00:00', '2026-09-03T18:00:00'), 3, 'home leave costs 1 token/day');
assert.equal(tokens('Personal Leave', '2026-09-05T09:00:00', '2026-09-06T18:00:00'), 2, 'personal leave costs 1 token/day');
assert.equal(tokens('Medical Leave', '2026-09-05T09:00:00', '2026-09-08T18:00:00'), 0, 'medical leave costs 0');
assert.equal(tokens('Emergency Leave', '2026-09-05T09:00:00', '2026-09-08T18:00:00'), 0, 'emergency leave costs 0');
assert.equal(tokens('Sunday Shore Leave', '2026-09-06T09:00:00', '2026-09-06T18:00:00'), 1, 'Sunday shore leave costs 1 per Sunday');
assert.equal(validateSundayOnly('2026-09-07T09:00:00', '2026-09-07T18:00:00').valid, false, 'Monday is rejected for Sunday Shore Leave');
assert.equal(calculateRequiredTokens({ leaveType: 'Sunday Shore Leave', fromDate: '2026-09-06T09:00:00', toDate: '2026-09-13T18:00:00' }).valid, false, 'Sunday Shore Leave does not accept ranges containing Monday-Saturday');
assert.equal(calculateRequiredTokens({ leaveType: 'Other Leave', fromDate: '2026-09-01', toDate: '2026-09-01' }).valid, false, 'Other Leave is disabled');

console.log('Leave token policy tests passed');
