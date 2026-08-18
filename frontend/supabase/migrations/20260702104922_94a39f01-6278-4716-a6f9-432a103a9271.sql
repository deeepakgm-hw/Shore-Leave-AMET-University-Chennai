
CREATE POLICY "Daily reports bucket: staff read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'daily-reports'
    AND (private.has_role(auth.uid(),'super_admin')
      OR private.has_role(auth.uid(),'admin')
      OR private.has_role(auth.uid(),'hod')));
