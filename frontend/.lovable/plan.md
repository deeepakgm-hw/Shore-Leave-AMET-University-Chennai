# Gate Operations Enhancement — Implementation Plan

Extends the existing Leave workflow without redesigning it. Adapts the spec to this project's stack: Supabase (not MongoDB), pg_cron (not node-cron), Lovable Emails, and TanStack server functions.

## 1. Database (single migration)

New enum `attendance_state`: `INSIDE | OUTSIDE | ON_LEAVE | RETURNED | LATE_RETURN | BLOCKED | UNKNOWN`.

Extend `cadets`:
- `attendance_state attendance_state default 'INSIDE'`
- `nfc_uid text unique` (permanent; only admins/HODs can change)
- `current_leave_id uuid` (nullable, references active leave)

New tables (with GRANTs + RLS scoped by branch, mirroring existing policies):
- `gate_history` — permanent movement log: gate_id, gate_name, cadet_id, cadet_name, roll_number, nfc_uid, officer_id, direction (`CHECK_IN`/`CHECK_OUT`), device, leave_id, leave_status, face_verified, qr_verified, result (`SUCCESS`/`DENIED`/`LATE`/`UNKNOWN_NFC`), remarks, occurred_at.
- `nfc_unknown_attempts` — uid, device, officer_id, attempted_at.
- `audit_logs` — actor_id, action, entity, entity_id, meta jsonb, created_at.
- `daily_reports` — report_date, generated_at, pdf_path, storage_url, recipients jsonb, delivery_status, error.
- `report_settings` — singleton: run_time (default 21:00), enabled, recipients jsonb, formats jsonb.

Storage bucket `daily-reports` (private).

## 2. Server functions (`src/lib/gate.functions.ts`)

- `nfcCheckOut({ leaveId, nfcUid, device })` — validates: NFC belongs to cadet, leave approved & not expired, cadet INSIDE, no active checkout. On success: insert `gate_events` + `gate_history`, set cadet `attendance_state='OUTSIDE'`, `is_outside=true`, `current_leave_id=leaveId`, audit log.
- `nfcCheckIn({ nfcUid, device })` — finds active leave for cadet, marks returned. If `now > end_at` → state `LATE_RETURN` + notification row; else `RETURNED` then `INSIDE`. Writes gate_history + audit.
- `assignNfcUid({ cadetId, uid })` — admin/HOD only, replaces permanent UID.
- Denied paths log to `gate_history` with result and to `nfc_unknown_attempts` when UID unknown.

All use `requireSupabaseAuth`; branch-scoped via existing `has_role` pattern.

## 3. Admin UI updates (existing admin route only)

- Check-Out view: pick approved leave → NFC tap input (text field simulating reader) → call `nfcCheckOut`.
- Check-In view: NFC tap input → `nfcCheckIn`; surfaces LATE badge.
- Cadets view: add "Assign NFC" action.
- Dashboard tiles: Inside, Outside, Today Check-ins, Today Check-outs, Late Returns, Unknown NFC, Denied Entries + Recent Gate Activity feed (from `gate_history`).
- New Settings tab: edit report time, recipients, enable/disable, formats.

Cadet dashboard untouched.

## 4. Daily report

- Server route `/api/public/hooks/daily-report` (POST): aggregates the report content, renders HTML + PDF (using `@react-pdf/renderer` or `pdf-lib`), uploads to `daily-reports` bucket, records `daily_reports` row, emails recipients via Lovable Emails template `daily-ops-report` with PDF link (attachments unsupported → signed URL in email).
- pg_cron job `daily-ops-report` scheduled from `report_settings.run_time` (default 21:00 server time) via `pg_net.http_post` to the route with anon apikey header.
- Retries: route retries email + upload up to 3× with backoff; failures update `delivery_status='failed'` + `error`, plus notification row for admins.

## 5. Email

Lovable Emails app-email template `daily-ops-report` with summary + signed PDF link. Requires email domain — if not configured, will prompt setup dialog when wiring.

## 6. Deliverables

Files added:
- `supabase` migration
- `src/lib/gate.functions.ts`
- `src/lib/report.functions.ts`
- `src/routes/api/public/hooks/daily-report.ts`
- `src/lib/email-templates/daily-ops-report.tsx` (+ registry update)
- Admin UI: extend Check-In / Check-Out / Cadets / Dashboard / new Settings tab in `src/routes/_authenticated/admin.tsx`

Existing Leave approval flow, QR, face enrollment, and cadet dashboard remain unchanged.

## Notes / deviations from spec

- Storage = Supabase (project doesn't use MongoDB Atlas).
- Scheduler = pg_cron + pg_net (Lovable Cloud has no Node runtime for node-cron).
- Email attachments unsupported by Lovable Emails → PDF delivered as signed download link in the email.
- Placeholder recipients seeded: principal@example.com, vicePrincipal@example.com, hod@example.com, warden@example.com, duty@example.com.
