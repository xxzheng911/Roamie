-- Authoritative Plus entitlement authority. App Store state remains in profiles until
-- the receipt/webhook pipeline is implemented; admin/promo grants live separately.

CREATE TABLE IF NOT EXISTS public.user_plus_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('admin_grant', 'promo')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_plus_entitlements_expiry_check
    CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS user_plus_entitlements_user_lookup_idx
  ON public.user_plus_entitlements (user_id, source, starts_at, expires_at);
CREATE INDEX IF NOT EXISTS user_plus_entitlements_active_lookup_idx
  ON public.user_plus_entitlements (user_id, source)
  WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_plus_entitlements_one_unrevoked_source_idx
  ON public.user_plus_entitlements (user_id, source)
  WHERE revoked_at IS NULL;

DROP TRIGGER IF EXISTS user_plus_entitlements_set_updated_at ON public.user_plus_entitlements;
CREATE TRIGGER user_plus_entitlements_set_updated_at
  BEFORE UPDATE ON public.user_plus_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_plus_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_plus_entitlements FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.user_plus_entitlements TO service_role;

-- There are intentionally no anon/authenticated base-table policies. Users read only
-- the resolved snapshot below, never grant rows or their audit metadata.

CREATE OR REPLACE FUNCTION public.resolve_user_plus_entitlement(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), '');
  v_subscription_active boolean := false;
  v_admin_active boolean := false;
  v_promo_active boolean := false;
  v_admin_permanent boolean := false;
  v_promo_permanent boolean := false;
  v_entitlement_expiry timestamptz;
  v_sources jsonb := '[]'::jsonb;
  v_effective_source text := 'none';
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
  END IF;
  IF v_role <> 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin')
    AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized to resolve this entitlement' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    p.plan_tier = 'plus' AND p.subscription_status IN ('active', 'trialing'),
    false
  ) INTO v_subscription_active
  FROM public.profiles p
  WHERE p.id = p_user_id;

  SELECT
    COALESCE(bool_or(source = 'admin_grant'), false),
    COALESCE(bool_or(source = 'promo'), false),
    COALESCE(bool_or(source = 'admin_grant' AND expires_at IS NULL), false),
    COALESCE(bool_or(source = 'promo' AND expires_at IS NULL), false),
    max(expires_at)
  INTO v_admin_active, v_promo_active, v_admin_permanent, v_promo_permanent, v_entitlement_expiry
  FROM public.user_plus_entitlements
  WHERE user_id = p_user_id
    AND starts_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
    AND revoked_at IS NULL;

  IF v_admin_active THEN
    v_sources := v_sources || jsonb_build_array('admin_grant');
    v_effective_source := 'admin_grant';
  END IF;
  IF v_promo_active THEN
    v_sources := v_sources || jsonb_build_array('promo');
    IF v_effective_source = 'none' THEN v_effective_source := 'promo'; END IF;
  END IF;
  IF v_subscription_active THEN
    v_sources := v_sources || jsonb_build_array('app_store');
    IF v_effective_source = 'none' THEN v_effective_source := 'app_store'; END IF;
  END IF;

  RETURN jsonb_build_object(
    'has_plus', v_subscription_active OR v_admin_active OR v_promo_active,
    'effective_source', v_effective_source,
    'active_sources', v_sources,
    -- App Store expiry is not yet persisted; null means permanent or unknown/unbounded.
    'expires_at', CASE
      WHEN v_subscription_active OR v_admin_permanent OR v_promo_permanent THEN NULL
      ELSE v_entitlement_expiry
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_user_plus_entitlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_user_plus_entitlement(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_grant_plus_entitlement(
  p_user_id uuid,
  p_source text,
  p_expires_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_granted_by uuid DEFAULT NULL,
  p_starts_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE v_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_source NOT IN ('admin_grant', 'promo') THEN
    RAISE EXCEPTION 'invalid entitlement source' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= p_starts_at THEN
    RAISE EXCEPTION 'expires_at must be after starts_at' USING ERRCODE = '22023';
  END IF;

  -- Preserve history while ensuring one current grant per user/source.
  UPDATE public.user_plus_entitlements
  SET revoked_at = now(), revocation_reason = 'superseded_by_new_grant'
  WHERE user_id = p_user_id AND source = p_source AND revoked_at IS NULL;

  INSERT INTO public.user_plus_entitlements (
    user_id, source, starts_at, expires_at, granted_by, reason
  ) VALUES (
    p_user_id, p_source, p_starts_at, p_expires_at, p_granted_by, NULLIF(btrim(p_reason), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_plus_entitlement(
  p_entitlement_id uuid,
  p_reason text DEFAULT NULL,
  p_revoked_by uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE v_count integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.user_plus_entitlements
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_by = COALESCE(revoked_by, p_revoked_by),
      revocation_reason = COALESCE(revocation_reason, NULLIF(btrim(p_reason), ''))
  WHERE id = p_entitlement_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_plus_entitlement(uuid, text, timestamptz, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_revoke_plus_entitlement(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_plus_entitlement(uuid, text, timestamptz, text, uuid, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_plus_entitlement(uuid, text, uuid)
  TO service_role;

-- Protect legacy App Store state even though users retain normal profile editing.
CREATE OR REPLACE FUNCTION public.protect_profile_subscription_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, auth
AS $$
DECLARE v_privileged boolean := auth.role() = 'service_role'
  OR session_user IN ('postgres', 'supabase_admin');
BEGIN
  IF v_privileged THEN RETURN NEW; END IF;
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

DROP TRIGGER IF EXISTS profiles_protect_subscription_columns ON public.profiles;
CREATE TRIGGER profiles_protect_subscription_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_subscription_columns();

-- Credits consume the same authority rather than rebuilding subscription logic.
CREATE OR REPLACE FUNCTION public.credits_ensure_account(p_user_id uuid)
RETURNS public.credit_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
  v_row public.credit_accounts;
  v_plan text := 'free';
  v_entitlement jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'credits_ensure_account: user_id required';
  END IF;
  PERFORM public.credits_release_stale_reservations(p_user_id);
  SELECT b.period_start, b.period_end INTO v_start, v_end
  FROM public.credits_month_bounds(v_now) AS b;

  v_entitlement := public.resolve_user_plus_entitlement(p_user_id);
  IF COALESCE((v_entitlement->>'has_plus')::boolean, false) THEN v_plan := 'plus'; END IF;

  INSERT INTO public.credit_accounts (
    user_id, plan, monthly_limit, available_credits, reserved_credits,
    period_start, period_end, last_reset_at
  ) VALUES (p_user_id, v_plan, 20, 20, 0, v_start, v_end, v_now)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM public.credit_accounts WHERE user_id = p_user_id FOR UPDATE;
  IF v_now >= v_row.period_end THEN
    UPDATE public.credit_accounts SET
      available_credits = monthly_limit, reserved_credits = 0,
      period_start = v_start, period_end = v_end, last_reset_at = v_now,
      updated_at = v_now, plan = v_plan
    WHERE user_id = p_user_id RETURNING * INTO v_row;
  ELSIF v_row.plan IS DISTINCT FROM v_plan THEN
    UPDATE public.credit_accounts SET plan = v_plan, updated_at = v_now
    WHERE user_id = p_user_id RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;

-- Preserve the existing dashboard query, but replace every surfaced plan/count with
-- authoritative resolver output. This avoids duplicating its unrelated analytics SQL.
-- Capture the pre-entitlement dashboard implementation exactly once.  A prior
-- attempt may have completed the rename but failed before creating the wrapper;
-- conversely, the current name may already be the wrapper on a retry.  Identify
-- the wrapper by its stable marker instead of renaming whatever owns the name.
DO $$
DECLARE
  v_current_oid regprocedure := to_regprocedure(
    'public.admin_dashboard_phase1(text,text,integer,integer)'
  );
  v_legacy_oid regprocedure := to_regprocedure(
    'public.admin_dashboard_phase1_subscription_legacy(text,text,integer,integer)'
  );
  v_current_definition text;
BEGIN
  IF v_current_oid IS NOT NULL THEN
    v_current_definition := pg_get_functiondef(v_current_oid);
  END IF;

  IF v_legacy_oid IS NULL THEN
    IF v_current_oid IS NULL THEN
      RAISE EXCEPTION 'admin_dashboard_phase1 prerequisite is missing';
    END IF;
    IF position('ROAMIE_PLUS_ENTITLEMENT_DASHBOARD_WRAPPER_V1' IN v_current_definition) > 0 THEN
      RAISE EXCEPTION 'entitlement dashboard wrapper exists without its legacy dependency';
    END IF;
    ALTER FUNCTION public.admin_dashboard_phase1(text, text, integer, integer)
      RENAME TO admin_dashboard_phase1_subscription_legacy;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_dashboard_phase1(
  p_search text DEFAULT NULL,
  p_sort text DEFAULT 'recently_active',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  -- ROAMIE_PLUS_ENTITLEMENT_DASHBOARD_WRAPPER_V1
DECLARE
  v_result jsonb;
  v_users jsonb;
  v_top_users jsonb;
  v_plus_count integer;
  v_free_count integer;
BEGIN
  v_result := public.admin_dashboard_phase1_subscription_legacy(
    p_search, p_sort, p_page, p_page_size
  );

  SELECT COALESCE(jsonb_agg(
    item || jsonb_build_object(
      'plan', CASE WHEN COALESCE(
        (public.resolve_user_plus_entitlement((item->>'user_id')::uuid)->>'has_plus')::boolean,
        false
      ) THEN 'plus' ELSE 'free' END
    )
  ), '[]'::jsonb) INTO v_users
  FROM jsonb_array_elements(COALESCE(v_result->'users', '[]'::jsonb)) item;

  SELECT COALESCE(jsonb_agg(
    item || jsonb_build_object(
      'plan', CASE WHEN COALESCE(
        (public.resolve_user_plus_entitlement((item->>'user_id')::uuid)->>'has_plus')::boolean,
        false
      ) THEN 'plus' ELSE 'free' END
    )
  ), '[]'::jsonb) INTO v_top_users
  FROM jsonb_array_elements(COALESCE(v_result->'topUsers', '[]'::jsonb)) item;

  SELECT
    count(*) FILTER (WHERE has_plus),
    count(*) FILTER (WHERE NOT has_plus)
  INTO v_plus_count, v_free_count
  FROM (
    SELECT COALESCE(
      (public.resolve_user_plus_entitlement(u.id)->>'has_plus')::boolean,
      false
    ) AS has_plus
    FROM auth.users u
  ) resolved;

  v_result := jsonb_set(v_result, '{users}', v_users);
  v_result := jsonb_set(v_result, '{topUsers}', v_top_users);
  v_result := jsonb_set(v_result, '{summary,plusUsers}', to_jsonb(v_plus_count));
  v_result := jsonb_set(v_result, '{summary,freeUsers}', to_jsonb(v_free_count));
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_phase1_subscription_legacy(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_dashboard_phase1(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_phase1(text, text, integer, integer)
  TO service_role;
