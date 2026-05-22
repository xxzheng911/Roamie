-- Remove OAuth provider photos from profiles; Roamie uses default avatar until user uploads.
UPDATE public.profiles p
SET avatar_url = NULL
FROM auth.users u
WHERE p.id = u.id
  AND p.avatar_url IS NOT NULL
  AND (
    p.avatar_url = (u.raw_user_meta_data->>'avatar_url')
    OR p.avatar_url = (u.raw_user_meta_data->>'picture')
  );
