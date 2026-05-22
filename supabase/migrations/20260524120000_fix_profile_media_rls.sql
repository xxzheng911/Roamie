-- Fix profile-media storage RLS and profiles update policies (WITH CHECK for upsert/update)

-- profiles: explicit WITH CHECK so upsert/update of avatar_url / cover_image_url succeeds
DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles self insert" ON public.profiles;
CREATE POLICY "profiles self insert"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Helper: path must be {userId}/avatar.jpg or {userId}/cover.jpg
CREATE OR REPLACE FUNCTION public.profile_media_path_allowed(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND split_part(object_name, '/', 1) = auth.uid()::text
    AND split_part(object_name, '/', 2) IN ('avatar.jpg', 'cover.jpg')
    AND split_part(object_name, '/', 3) = '';
$$;

-- Storage policies (drop & recreate with USING + WITH CHECK)
DROP POLICY IF EXISTS "profile_media_public_read" ON storage.objects;
CREATE POLICY "profile_media_public_read"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'profile-media');

DROP POLICY IF EXISTS "profile_media_insert_own" ON storage.objects;
CREATE POLICY "profile_media_insert_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-media'
    AND public.profile_media_path_allowed(name)
  );

DROP POLICY IF EXISTS "profile_media_update_own" ON storage.objects;
CREATE POLICY "profile_media_update_own"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'profile-media'
    AND public.profile_media_path_allowed(name)
  )
  WITH CHECK (
    bucket_id = 'profile-media'
    AND public.profile_media_path_allowed(name)
  );

DROP POLICY IF EXISTS "profile_media_delete_own" ON storage.objects;
CREATE POLICY "profile_media_delete_own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'profile-media'
    AND public.profile_media_path_allowed(name)
  );
