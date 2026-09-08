-- Keep Plus resolution callable by authenticated clients for their own snapshot,
-- while reserving cross-user resolution for the service-role runtime authority.

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
    AND (
      auth.uid() IS NULL
      OR auth.uid() IS DISTINCT FROM p_user_id
    ) THEN
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
  INTO v_admin_active, v_promo_active, v_admin_permanent, v_promo_permanent,
    v_entitlement_expiry
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
    'expires_at', CASE
      WHEN v_subscription_active OR v_admin_permanent OR v_promo_permanent THEN NULL
      ELSE v_entitlement_expiry
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_user_plus_entitlement(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_user_plus_entitlement(uuid)
  TO authenticated, service_role;
