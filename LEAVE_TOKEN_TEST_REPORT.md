# Leave Token Test Report

## Automated Checks Run

- `node backend/scripts/test-leave-token-policy.js`
- `npm run build` in `backend`
- `npm run build` in `frontend`

## Final Validation

- Monthly allocation: 28
- Carry-over: DISABLED
- Home Leave: 1 token/day
- Medical Leave: 0 tokens
- Emergency Leave: 0 tokens
- Personal Leave: 1 token/day
- Sunday Shore Leave: 1 token/Sunday

## Validation Results

- Monthly allocation idempotency: PASS
- No carry-over: PASS
- Token expiration: PASS
- Home Leave calculation: PASS
- Medical Leave calculation: PASS
- Emergency Leave calculation: PASS
- Personal Leave calculation: PASS
- Sunday Shore Leave calculation: PASS
- Sunday-only validation: PASS
- Reservation: PASS
- Consumption: PASS
- Release: PASS
- Refund: NOT VERIFIED
- Insufficient balance protection: PASS
- Duplicate transaction protection: PASS
- Race-condition protection: PARTIAL
- Server-side calculation: PASS
- Audit logging: PASS
- Real-time token update: PASS

## Test Detail

The policy script verifies all final leave type calculations, disables `Other Leave`, and rejects Monday for Sunday Shore Leave.

Backend syntax check passed with `node --check server.js`.

Frontend production build completed successfully.

Race-condition protection is marked PARTIAL because unique indexes and idempotency keys are implemented, but a live concurrent MongoDB integration test was not run in this environment.

Refund is marked NOT VERIFIED because no existing approved-cancellation refund workflow was found to exercise without inventing a new refund policy.
