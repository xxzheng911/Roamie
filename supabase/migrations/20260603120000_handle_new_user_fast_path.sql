-- 加速新使用者註冊：handle_new_user 不再查 auth.identities（避免與 Apple/Google 註冊競爭鎖、逾時）
-- Dashboard Users / token exchange 若仍 timeout，請執行 scripts/diagnose_db_connection_health.sql

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  provider text;
BEGIN
  provider := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');

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

COMMENT ON FUNCTION public.handle_new_user IS
  'AFTER INSERT on auth.users: minimal profile row; no auth.identities lookup.';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
