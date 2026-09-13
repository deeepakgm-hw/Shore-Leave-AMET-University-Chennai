# Leave Token Implementation Report

## Summary

Implemented a backend-authoritative monthly leave token system integrated into the existing cadet leave request and admin approval workflow.

## Backend

- Added `backend/services/leaveTokenPolicy.js` for final leave type normalization, Sunday validation, monthly policy constants, and token calculation.
- Added MongoDB models in `backend/server.js`:
  - `LeaveTokenAllocation`
  - `LeaveTokenLedger`
- Added unique protection for one allocation per cadet/month.
- Added unique ledger idempotency keys for duplicate allocation, reservation, consumption, release, and expiration protection.
- Added ledger transaction types:
  - `TOKEN_MONTHLY_ALLOCATION`
  - `TOKEN_RESERVED`
  - `TOKEN_RESERVATION_RELEASED`
  - `TOKEN_CONSUMED`
  - `TOKEN_REFUNDED`
  - `TOKEN_EXPIRED`
- Updated cadet leave submission to reserve tokens.
- Updated admin approval to consume reserved tokens.
- Updated admin rejection to release reserved tokens.
- Updated legacy shore leave endpoint to create a pending Sunday Shore Leave request instead of auto-approving and deducting tokens.
- Added month-end expiration and idempotent monthly allocation job behavior.
- Added startup allocation sweep with database-level idempotency.
- Added cadet token APIs:
  - `GET /api/cadet/leave-tokens`
  - `POST /api/cadet/leave-token-quote`

## Frontend

- Updated Cadet leave form to offer only the final five leave types.
- Added backend token quote display showing required, available, and remaining tokens.
- Added current month token details and transaction history display to the Cadet Leave tab.

## Real-Time

Existing Socket.IO cadet room events are reused. Token balance payloads are emitted through existing leave events where reservation, approval, rejection, and monthly allocation change token state.

## Notes

Refund after approved cancellation was prepared at the ledger level but no dedicated existing cancellation endpoint was found in the inspected workflow. No new refund rule was invented.
