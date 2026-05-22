-- Profile cover image URL
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cover_image_url text;

-- Storage bucket for avatar & cover (separate paths per user)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-media',
  'profile-media',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read
CREATE POLICY "profile_media_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile-media');

-- Authenticated users manage own folder: {user_id}/avatar.jpg | cover.jpg
CREATE POLICY "profile_media_insert_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "profile_media_update_own"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "profile_media_delete_own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
