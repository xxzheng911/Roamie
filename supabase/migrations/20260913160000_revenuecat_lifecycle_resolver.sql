-- Switch the Plus resolver only after every legacy App Store entitlement has
-- been synchronized into canonical RevenueCat lifecycle state. This assertion
-- makes an accidental one-step production rollout fail closed without removing
-- existing subscribers' access.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.plan_tier = 'plus'
      AND p.subscription_status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_plus_entitlements upe
        WHERE upe.user_id = p.id
          AND upe.source IN ('admin_grant', 'promo')
          AND upe.starts_at <= now()
          AND (upe.expires_at IS NULL OR upe.expires_at > now())
          AND upe.revoked_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.revenuecat_subscription_states rcs
        WHERE rcs.user_id = p.id
          AND rcs.entitlement_id = 'premium'
      )
  ) THEN
    RAISE EXCEPTION 'RevenueCat lifecycle backfill required before resolver activation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_user_plus_entitlement(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_role text := COALESCE(auth.role(),''); v_app boolean := false;
  v_admin boolean := false; v_promo boolean := false; v_exp timestamptz;
  v_sources jsonb := '[]'::jsonb; v_source text := 'none';
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id required' USING ERRCODE='22023'; END IF;
  IF v_role <> 'service_role' AND (auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION 'not authorized to resolve this entitlement' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(status IN ('active','cancelled','billing_issue','paused')
    AND expiration_at IS NOT NULL AND expiration_at > now(), false), expiration_at
    INTO v_app, v_exp FROM public.revenuecat_subscription_states
    WHERE user_id=p_user_id AND entitlement_id='premium';
  SELECT COALESCE(bool_or(source='admin_grant'),false), COALESCE(bool_or(source='promo'),false),
    GREATEST(v_exp,max(expires_at)) INTO v_admin,v_promo,v_exp
    FROM public.user_plus_entitlements WHERE user_id=p_user_id AND starts_at<=now()
      AND (expires_at IS NULL OR expires_at>now()) AND revoked_at IS NULL;
  IF v_admin THEN v_sources:=v_sources||jsonb_build_array('admin_grant'); v_source:='admin_grant'; END IF;
  IF v_promo THEN v_sources:=v_sources||jsonb_build_array('promo'); IF v_source='none' THEN v_source:='promo'; END IF; END IF;
  IF v_app THEN v_sources:=v_sources||jsonb_build_array('app_store'); IF v_source='none' THEN v_source:='app_store'; END IF; END IF;
  RETURN jsonb_build_object('has_plus',v_app OR v_admin OR v_promo,'effective_source',v_source,
    'active_sources',v_sources,'expires_at',v_exp);
END; $$;
REVOKE ALL ON FUNCTION public.resolve_user_plus_entitlement(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_user_plus_entitlement(uuid) TO authenticated, service_role;
