
-- 1) attendance state enum
DO $$ BEGIN
  CREATE TYPE public.attendance_state AS ENUM ('INSIDE','OUTSIDE','ON_LEAVE','RETURNED','LATE_RETURN','BLOCKED','UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.gate_direction_v2 AS ENUM ('CHECK_IN','CHECK_OUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.gate_result AS ENUM ('SUCCESS','DENIED','LATE','UNKNOWN_NFC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) extend cadets
ALTER TABLE public.cadets
  ADD COLUMN IF NOT EXISTS attendance_state public.attendance_state NOT NULL DEFAULT 'INSIDE',
  ADD COLUMN IF NOT EXISTS nfc_uid TEXT,
  ADD COLUMN IF NOT EXISTS current_leave_id UUID;

DO $$ BEGIN
  ALTER TABLE public.cadets ADD CONSTRAINT cadets_nfc_uid_unique UNIQUE (nfc_uid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) gate_history table
CREATE TABLE IF NOT EXISTS public.gate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id TEXT,
  gate_name TEXT NOT NULL DEFAULT 'Main Gate',
  cadet_id UUID REFERENCES public.cadets(id) ON DELETE SET NULL,
  cadet_name TEXT,
  roll_number TEXT,
  nfc_uid TEXT,
  officer_id UUID,
  direction public.gate_direction_v2 NOT NULL,
  device TEXT,
  leave_id UUID REFERENCES public.leave_requests(id) ON DELETE SET NULL,
  leave_status TEXT,
  face_verified BOOLEAN NOT NULL DEFAULT false,
  qr_verified BOOLEAN NOT NULL DEFAULT false,
  result public.gate_result NOT NULL DEFAULT 'SUCCESS',
  remarks TEXT,
  branch_code public.branch_code,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.gate_history TO authenticated;
GRANT ALL ON public.gate_history TO service_role;
ALTER TABLE public.gate_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Gate history: super_admin/admin all"
  ON public.gate_history FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'super_admin') OR private.has_role(auth.uid(),'admin'));
CREATE POLICY "Gate history: HOD sees branch"
  ON public.gate_history FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'hod')
    AND branch_code IN (SELECT ur.branch_code FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role='hod'));
CREATE POLICY "Gate history: cadet sees own"
  ON public.gate_history FOR SELECT TO authenticated
  USING (cadet_id IN (SELECT id FROM public.cadets WHERE user_id = auth.uid()));
CREATE POLICY "Gate history: staff inserts"
  ON public.gate_history FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(),'super_admin') OR private.has_role(auth.uid(),'admin') OR private.has_role(auth.uid(),'hod'));

CREATE INDEX IF NOT EXISTS gate_history_occurred_at_idx ON public.gate_history (occurred_at DESC);
CREATE INDEX IF NOT EXISTS gate_history_cadet_idx ON public.gate_history (cadet_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS gate_history_branch_idx ON public.gate_history (branch_code, occurred_at DESC);

-- 4) nfc_unknown_attempts
CREATE TABLE IF NOT EXISTS public.nfc_unknown_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid TEXT NOT NULL,
  device TEXT,
  officer_id UUID,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.nfc_unknown_attempts TO authenticated;
GRANT ALL ON public.nfc_unknown_attempts TO service_role;
ALTER TABLE public.nfc_unknown_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Unknown NFC: staff read"
  ON public.nfc_unknown_attempts FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'super_admin') OR private.has_role(auth.uid(),'admin') OR private.has_role(auth.uid(),'hod'));
CREATE POLICY "Unknown NFC: staff insert"
  ON public.nfc_unknown_attempts FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(),'super_admin') OR private.has_role(auth.uid(),'admin') OR private.has_role(auth.uid(),'hod'));

-- 5) audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id UUID,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Audit: admin read"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'super_admin') OR private.has_role(auth.uid(),'admin'));
CREATE POLICY "Audit: staff insert"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(),'super_admin') OR private.has_role(auth.uid(),'admin') OR private.has_role(auth.uid(),'hod'));

-- 6) daily_reports
CREATE TABLE IF NOT EXISTS public.daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by TEXT DEFAULT 'system',
  pdf_path TEXT,
  storage_url TEXT,
  recipients JSONB DEFAULT '[]'::jsonb,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  summary JSONB DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE ON public.daily_reports TO authenticated;
GRANT ALL ON public.daily_reports TO service_role;
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Daily reports: admin read"
  ON public.daily_reports FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'super_admin') OR private.has_role(auth.uid(),'admin') OR private.has_role(auth.uid(),'hod'));

-- 7) report_settings (singleton)
CREATE TABLE IF NOT EXISTS public.report_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  run_time TIME NOT NULL DEFAULT '21:00',
  enabled BOOLEAN NOT NULL DEFAULT true,
  recipients JSONB NOT NULL DEFAULT '["principal@example.com","vice-principal@example.com","hod@example.com","warden@example.com","duty@example.com"]'::jsonb,
  formats JSONB NOT NULL DEFAULT '["pdf","html"]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.report_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
GRANT SELECT, UPDATE ON public.report_settings TO authenticated;
GRANT ALL ON public.report_settings TO service_role;
ALTER TABLE public.report_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Report settings: staff read"
  ON public.report_settings FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'super_admin') OR private.has_role(auth.uid(),'admin') OR private.has_role(auth.uid(),'hod'));
CREATE POLICY "Report settings: admin update"
  ON public.report_settings FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(),'super_admin') OR private.has_role(auth.uid(),'admin'))
  WITH CHECK (private.has_role(auth.uid(),'super_admin') OR private.has_role(auth.uid(),'admin'));

-- realtime for gate_history
ALTER PUBLICATION supabase_realtime ADD TABLE public.gate_history;
