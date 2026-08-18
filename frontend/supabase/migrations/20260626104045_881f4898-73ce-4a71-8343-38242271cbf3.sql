
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'cadet');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users read their own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles self read" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Profiles self update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Auto profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email);
  -- Default everyone to cadet; admins promoted via DB
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'cadet');
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Cadets
CREATE TABLE public.cadets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cadet_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  branch TEXT NOT NULL,
  wing TEXT NOT NULL,
  year INT NOT NULL,
  phone TEXT,
  photo_url TEXT,
  face_enrolled BOOLEAN NOT NULL DEFAULT false,
  nfc_card_id TEXT,
  is_outside BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadets TO authenticated;
GRANT ALL ON public.cadets TO service_role;
ALTER TABLE public.cadets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cadets self read" ON public.cadets
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage cadets" ON public.cadets
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Leave requests
CREATE TYPE public.leave_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

CREATE TABLE public.leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cadet_id UUID NOT NULL REFERENCES public.cadets(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  reason TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status public.leave_status NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES auth.users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_requests TO authenticated;
GRANT ALL ON public.leave_requests TO service_role;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cadets see own requests" ON public.leave_requests
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.cadets c WHERE c.id = cadet_id AND c.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );
CREATE POLICY "Cadets create own requests" ON public.leave_requests
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.cadets c WHERE c.id = cadet_id AND c.user_id = auth.uid())
  );
CREATE POLICY "Admins manage requests" ON public.leave_requests
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete requests" ON public.leave_requests
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX leave_requests_status_idx ON public.leave_requests(status, created_at DESC);
CREATE INDEX leave_requests_cadet_idx ON public.leave_requests(cadet_id, created_at DESC);

-- Gate events
CREATE TYPE public.gate_direction AS ENUM ('entry', 'exit');
CREATE TYPE public.verify_method AS ENUM ('face', 'nfc', 'qr');

CREATE TABLE public.gate_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cadet_id UUID NOT NULL REFERENCES public.cadets(id) ON DELETE CASCADE,
  direction public.gate_direction NOT NULL,
  method public.verify_method NOT NULL,
  gate_name TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.gate_events TO authenticated;
GRANT ALL ON public.gate_events TO service_role;
ALTER TABLE public.gate_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gate events self read" ON public.gate_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.cadets c WHERE c.id = cadet_id AND c.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );
CREATE POLICY "Admins log gate events" ON public.gate_events
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX gate_events_recent_idx ON public.gate_events(occurred_at DESC);
