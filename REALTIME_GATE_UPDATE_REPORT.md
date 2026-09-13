# Realtime Gate Update Report

## Existing Mechanism

The project already uses Socket.IO. Cadets join `cadet:{roll}` rooms and officers/admin users join the `admin` room.

## Checkout Events

After a successful backend check-out transaction:

- `cadet:checkout` is emitted to the admin room by the gate decision service.
- `gate:access-approved` is emitted to the admin room.
- `gate:checkout-success` is emitted to the cadet room.
- `stats:update` is emitted to the admin room after dashboard cache invalidation.
- An important persistent notification titled `Shore Leave Started` is created.

## Check-In Events

After a successful backend check-in transaction:

- `cadet:checkin` is emitted to the admin room by the gate decision service.
- `gate:access-approved` is emitted to the admin room.
- `gate:checkin-success` is emitted to the cadet room.
- `stats:update` is emitted to the admin room after dashboard cache invalidation.
- An important persistent notification titled `Welcome Back to Campus` is created.

## Validation

- Existing Socket.IO mechanism reused: PASS
- New separate WebSocket system created: PASS, no new system created
- Event emitted only after backend transaction path: PASS
- Sensitive biometric data emitted: PASS, no template/OTP emitted
- Live dashboard observed updating in browser: NOT TESTED
