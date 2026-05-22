-- Roamie app profile fields (not OAuth display data)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS language text DEFAULT 'zh-TW',
  ADD COLUMN IF NOT EXISTS notifications_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_provider text;

-- Migrate bio from legacy ai_preferences JSON
UPDATE public.profiles
SET bio = COALESCE(
  NULLIF(TRIM(bio), ''),
  NULLIF(TRIM(ai_preferences->>'bio'), ''),
  '慢慢的旅人'
)
WHERE bio IS NULL OR TRIM(bio) = '';

-- New signups: Roamie defaults only (OAuth is auth-only)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  provider text;
BEGIN
  provider := COALESCE(
    NEW.raw_app_meta_data->>'provider',
    (SELECT i.provider FROM auth.identities i WHERE i.user_id = NEW.id LIMIT 1),
    'email'
  );

  INSERT INTO public.profiles (
    id,
    display_name,
    avatar_url,
    cover_image_url,
    bio,
    language,
    notifications_enabled,
    auth_provider
  )
  VALUES (
    NEW.id,
    '旅人',
    NULL,
    NULL,
    '慢慢的旅人',
    'zh-TW',
    false,
    provider
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
