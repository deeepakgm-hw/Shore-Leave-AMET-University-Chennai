# Gate Check-In / Check-Out Flow

## Primary Flow

1. Gate operator opens Check-In or Check-Out terminal.
2. Terminal defaults to Fingerprint Verification.
3. Operator optionally enters cadet email or roll if identification mode is unavailable.
4. Backend captures fingerprint through the configured Mantra MFS110 provider.
5. Backend matches the fingerprint against enrolled templates.
6. Matched identity is passed to `gateDecisionService.processVerifiedIdentity`.
7. The unified gate service validates cadet status, leave status, duplicate state, and current operation.
8. On success, backend records check-in or check-out, writes audit/gate history, updates cadet and leave state, and emits real-time events.

## Email + OTP Fallback

1. Operator selects Email + OTP.
2. Operator enters registered cadet email.
3. Backend verifies the email against the authoritative cadet record.
4. Backend generates a hashed six-digit OTP, invalidates previous pending OTPs, and sends through the existing email service.
5. Operator enters OTP.
6. Backend verifies expiration, attempts, one-time use, and cadet eligibility.
7. Successful OTP verification calls the same `processVerifiedIdentity` gate authorization path used by fingerprint.

## Check-Out Result

- Cadet status changes to outside/on leave.
- Leave record is created or updated with check-out timestamp.
- Gate pass is generated only after authorization.
- Gate pass PDF is stored through the existing gate pass service.
- Gate pass email is sent or queued through existing email failure handling.
- Important app notification is created.
- Socket.IO emits updates to admin and cadet channels.

## Check-In Result

- Active leave is marked returned or late return.
- Cadet status changes to inside/on campus.
- Welcome Back email is sent or queued through existing email failure handling.
- Important app notification is created.
- Socket.IO emits updates to admin and cadet channels.
