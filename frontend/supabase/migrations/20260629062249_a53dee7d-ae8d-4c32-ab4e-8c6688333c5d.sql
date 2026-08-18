
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM public, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

DROP POLICY IF EXISTS "Admins read all roles" ON public.user_roles;
CREATE POLICY "Admins read all roles" ON public.user_roles FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Profiles self read" ON public.profiles;
CREATE POLICY "Profiles self read" ON public.profiles FOR SELECT TO authenticated USING ((auth.uid() = id) OR private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Cadets self read" ON public.cadets;
CREATE POLICY "Cadets self read" ON public.cadets FOR SELECT TO authenticated USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage cadets" ON public.cadets;
CREATE POLICY "Admins manage cadets" ON public.cadets FOR ALL TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Cadets see own requests" ON public.leave_requests;
CREATE POLICY "Cadets see own requests" ON public.leave_requests FOR SELECT TO authenticated USING ((EXISTS (SELECT 1 FROM public.cadets c WHERE c.id = leave_requests.cadet_id AND c.user_id = auth.uid())) OR private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage requests" ON public.leave_requests;
CREATE POLICY "Admins manage requests" ON public.leave_requests FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins delete requests" ON public.leave_requests;
CREATE POLICY "Admins delete requests" ON public.leave_requests FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Gate events self read" ON public.gate_events;
CREATE POLICY "Gate events self read" ON public.gate_events FOR SELECT TO authenticated USING ((EXISTS (SELECT 1 FROM public.cadets c WHERE c.id = gate_events.cadet_id AND c.user_id = auth.uid())) OR private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins log gate events" ON public.gate_events;
CREATE POLICY "Admins log gate events" ON public.gate_events FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
