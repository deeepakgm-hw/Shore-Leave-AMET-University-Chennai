
-- Branch enum
CREATE TYPE public.branch_code AS ENUM (
  'BE-MAERSK','BSC-MAERSK','ETO-MAERSK','DNS-VSHIPS','BE-VSHIPS'
);

ALTER TABLE public.cadets         ADD COLUMN branch_code public.branch_code;
ALTER TABLE public.leave_requests ADD COLUMN branch_code public.branch_code;

UPDATE public.cadets SET branch_code = 'BE-MAERSK' WHERE branch_code IS NULL;
UPDATE public.leave_requests lr
  SET branch_code = c.branch_code
  FROM public.cadets c
  WHERE lr.cadet_id = c.id AND lr.branch_code IS NULL;
UPDATE public.leave_requests SET branch_code = 'BE-MAERSK' WHERE branch_code IS NULL;

ALTER TABLE public.cadets         ALTER COLUMN branch_code SET NOT NULL;
ALTER TABLE public.leave_requests ALTER COLUMN branch_code SET NOT NULL;

ALTER TABLE public.user_roles ADD COLUMN branch_code public.branch_code;

CREATE OR REPLACE FUNCTION public.set_leave_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_code IS NULL THEN
    SELECT branch_code INTO NEW.branch_code FROM public.cadets WHERE id = NEW.cadet_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_leave_branch ON public.leave_requests;
CREATE TRIGGER trg_set_leave_branch
BEFORE INSERT ON public.leave_requests
FOR EACH ROW EXECUTE FUNCTION public.set_leave_branch();

-- Helper functions
CREATE OR REPLACE FUNCTION private.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','admin')
  )
$$;

CREATE OR REPLACE FUNCTION private.user_can_see_branch(_user_id uuid, _branch public.branch_code)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    private.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id AND role = 'hod' AND branch_code = _branch
    )
$$;

CREATE OR REPLACE FUNCTION private.current_hod_branch(_user_id uuid)
RETURNS public.branch_code
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT branch_code FROM public.user_roles
   WHERE user_id = _user_id AND role = 'hod' AND branch_code IS NOT NULL
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION private.is_super_admin(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION private.user_can_see_branch(uuid, public.branch_code) FROM public, anon;
REVOKE ALL ON FUNCTION private.current_hod_branch(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.is_super_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.user_can_see_branch(uuid, public.branch_code) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_hod_branch(uuid) TO authenticated, service_role;

-- Cadets RLS
DROP POLICY IF EXISTS "Admins manage cadets" ON public.cadets;
DROP POLICY IF EXISTS "Cadets read own" ON public.cadets;

CREATE POLICY "Staff see branch cadets"
ON public.cadets FOR SELECT
TO authenticated
USING (
  private.user_can_see_branch(auth.uid(), branch_code)
  OR user_id = auth.uid()
);

CREATE POLICY "Staff modify branch cadets"
ON public.cadets FOR UPDATE
TO authenticated
USING (private.user_can_see_branch(auth.uid(), branch_code))
WITH CHECK (private.user_can_see_branch(auth.uid(), branch_code));

CREATE POLICY "Super admin insert cadets"
ON public.cadets FOR INSERT
TO authenticated
WITH CHECK (private.is_super_admin(auth.uid()) OR private.user_can_see_branch(auth.uid(), branch_code));

CREATE POLICY "Super admin delete cadets"
ON public.cadets FOR DELETE
TO authenticated
USING (private.is_super_admin(auth.uid()));

-- Leave RLS
DROP POLICY IF EXISTS "Admins manage leaves" ON public.leave_requests;
DROP POLICY IF EXISTS "Cadets read own leaves" ON public.leave_requests;
DROP POLICY IF EXISTS "Cadets insert own leaves" ON public.leave_requests;
DROP POLICY IF EXISTS "Cadets update own pending" ON public.leave_requests;

CREATE POLICY "Staff see branch leaves"
ON public.leave_requests FOR SELECT
TO authenticated
USING (
  private.user_can_see_branch(auth.uid(), branch_code)
  OR EXISTS (SELECT 1 FROM public.cadets c WHERE c.id = cadet_id AND c.user_id = auth.uid())
);

CREATE POLICY "Staff update branch leaves"
ON public.leave_requests FOR UPDATE
TO authenticated
USING (private.user_can_see_branch(auth.uid(), branch_code))
WITH CHECK (private.user_can_see_branch(auth.uid(), branch_code));

CREATE POLICY "Cadets insert own leaves"
ON public.leave_requests FOR INSERT
TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.cadets c WHERE c.id = cadet_id AND c.user_id = auth.uid()));

-- Gate events RLS
DROP POLICY IF EXISTS "Admins manage gate" ON public.gate_events;
DROP POLICY IF EXISTS "Cadets read own gate" ON public.gate_events;

CREATE POLICY "Staff see branch gate"
ON public.gate_events FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cadets c
    WHERE c.id = cadet_id
      AND (private.user_can_see_branch(auth.uid(), c.branch_code) OR c.user_id = auth.uid())
  )
);

CREATE POLICY "Staff insert branch gate"
ON public.gate_events FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.cadets c
    WHERE c.id = cadet_id AND private.user_can_see_branch(auth.uid(), c.branch_code)
  )
);
