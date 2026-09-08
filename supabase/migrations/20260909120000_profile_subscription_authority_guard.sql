-- Profile subscription columns are server-managed. Normal authenticated profile
-- edits remain governed by the existing self-update RLS policy.

CREATE OR REPLACE FUNCTION public.protect_profile_subscription_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, auth
AS $$
DECLARE
  v_privileged boolean := COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF v_privileged THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.plan_tier, 'free') <> 'free'
      OR COALESCE(NEW.subscription_status, 'inactive') <> 'inactive'
      OR COALESCE(NEW.subscription_provider, 'none') <> 'none'
      OR COALESCE(NEW.plus_available, false) <> false THEN
      RAISE EXCEPTION 'subscription columns are server-managed' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.plan_tier IS DISTINCT FROM OLD.plan_tier
    OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
    OR NEW.subscription_provider IS DISTINCT FROM OLD.subscription_provider
    OR NEW.plus_available IS DISTINCT FROM OLD.plus_available THEN
    RAISE EXCEPTION 'subscription columns are server-managed' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- The existing trigger remains bound to this OID after CREATE OR REPLACE. Fail the
-- migration if the expected binding is absent instead of silently losing protection.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_row
    JOIN pg_proc function_row ON function_row.oid = trigger_row.tgfoid
    JOIN pg_namespace function_schema ON function_schema.oid = function_row.pronamespace
    WHERE trigger_row.tgrelid = 'public.profiles'::regclass
      AND trigger_row.tgname = 'profiles_protect_subscription_columns'
      AND NOT trigger_row.tgisinternal
      AND function_schema.nspname = 'public'
      AND function_row.proname = 'protect_profile_subscription_columns'
  ) THEN
    RAISE EXCEPTION 'profiles subscription protection trigger is missing';
  END IF;
END;
$$;
