# Leave Token Policy

## Current Policy

- Monthly allocation: 28 leave tokens per eligible cadet per calendar month.
- Allocation key: Cadet ID, year, and month.
- Carry-over: Disabled.
- Month-end unused tokens: Expire and remain auditable in the token ledger.

## Final Leave Types

1. Home Leave - 1 token per chargeable day.
2. Medical Leave - 0 tokens.
3. Emergency Leave - 0 tokens.
4. Personal Leave - 1 token per chargeable day.
5. Sunday Shore Leave - 1 token per Sunday.

`Other Leave`, `Special Leave`, and generic `Shore Leave` are no longer accepted as final leave application types. Legacy aliases are normalized only where needed for compatibility.

## Token Lifecycle

Pending token-based leave requests reserve tokens first.

Approval converts reserved tokens into consumed tokens.

Rejection releases reserved tokens.

Medical Leave and Emergency Leave still require the normal approval workflow, but they create no reservation because their required token cost is zero.

## Security Rules

The backend is the authority for monthly allocation, balance, token cost, reservation, consumption, release, refund, and expiration.

The frontend must not provide trusted token costs or balances.

Token ledger entries never store passwords, OTPs, fingerprint templates, face embeddings, or raw biometric images.
