
DROP POLICY IF EXISTS "Cadet self insert" ON public.cadets;
DROP POLICY IF EXISTS "Cadet self update" ON public.cadets;

DROP POLICY IF EXISTS "daily-reports admin insert" ON storage.objects;
DROP POLICY IF EXISTS "daily-reports admin update" ON storage.objects;
DROP POLICY IF EXISTS "daily-reports admin delete" ON storage.objects;

CREATE POLICY "daily-reports admin insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'daily-reports' AND private.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "daily-reports admin update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'daily-reports' AND private.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (bucket_id = 'daily-reports' AND private.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "daily-reports admin delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'daily-reports' AND private.has_role(auth.uid(), 'super_admin'::public.app_role));
