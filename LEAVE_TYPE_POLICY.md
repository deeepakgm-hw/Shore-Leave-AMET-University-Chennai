# Leave Type Policy

Only these leave types are valid for new cadet leave requests:

1. Home Leave
2. Medical Leave
3. Emergency Leave
4. Personal Leave
5. Sunday Shore Leave

Sunday Shore Leave is restricted to Sundays. If a cadet selects Monday through Saturday, the backend rejects the request with:

`Sunday Shore Leave is available only on Sundays.`

Medical Leave and Emergency Leave cost 0 tokens, but they are not automatically approved.

Home Leave and Personal Leave use the shared chargeable-day calculation isolated in `backend/services/leaveTokenPolicy.js`.
