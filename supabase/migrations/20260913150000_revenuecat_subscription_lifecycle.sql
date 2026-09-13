-- Canonical RevenueCat lifecycle state. Webhooks and foreground recovery sync
-- converge here; admin/promo grants remain in user_plus_entitlements.
CREATE TABLE IF NOT EXISTS public.revenuecat_subscription_states (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revenuecat_customer_id text NOT NULL,
  entitlement_id text NOT NULL,
  product_id text,
  status text NOT NULL CHECK (status IN ('active','cancelled','billing_issue','paused','expired','revoked','inactive')),
  purchased_at timestamptz,
  expiration_at timestamptz,
  latest_event_at timestamptz NOT NULL,
  cancellation_at timestamptz,
  billing_issue_at timestamptz,
  store text,
  environment text,
  latest_event_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.revenuecat_webhook_events (
  event_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_timestamp timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

ALTER TABLE public.revenuecat_subscription_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenuecat_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.revenuecat_subscription_states FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.revenuecat_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.revenuecat_subscription_states TO service_role;
GRANT ALL ON public.revenuecat_webhook_events TO service_role;

CREATE INDEX IF NOT EXISTS revenuecat_state_active_idx
  ON public.revenuecat_subscription_states (status, expiration_at);

CREATE OR REPLACE FUNCTION public.apply_revenuecat_subscription_event(
  p_event_id text,
  p_user_id uuid,
  p_event_type text,
  p_event_at timestamptz,
  p_customer_id text,
  p_entitlement_id text,
  p_product_id text,
  p_status text,
  p_purchased_at timestamptz,
  p_expiration_at timestamptz,
  p_cancellation_at timestamptz,
  p_billing_issue_at timestamptz,
  p_store text,
  p_environment text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_inserted integer; v_applied integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR btrim(p_event_id) = '' OR p_user_id IS NULL
    OR p_event_at IS NULL OR p_customer_id IS NULL OR p_entitlement_id IS NULL THEN
    RAISE EXCEPTION 'invalid revenuecat event' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('processed', false, 'reason', 'unknown_user');
  END IF;

  INSERT INTO public.revenuecat_webhook_events(event_id,user_id,event_type,event_timestamp)
  VALUES (p_event_id,p_user_id,p_event_type,p_event_at)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN RETURN jsonb_build_object('processed', false, 'reason', 'duplicate'); END IF;

  INSERT INTO public.revenuecat_subscription_states(
    user_id,revenuecat_customer_id,entitlement_id,product_id,status,purchased_at,
    expiration_at,latest_event_at,cancellation_at,billing_issue_at,store,environment,latest_event_id
  ) VALUES (
    p_user_id,p_customer_id,p_entitlement_id,p_product_id,p_status,p_purchased_at,
    p_expiration_at,p_event_at,p_cancellation_at,p_billing_issue_at,p_store,p_environment,p_event_id
  ) ON CONFLICT (user_id) DO UPDATE SET
    revenuecat_customer_id=EXCLUDED.revenuecat_customer_id,
    entitlement_id=EXCLUDED.entitlement_id, product_id=EXCLUDED.product_id,
    status=EXCLUDED.status, purchased_at=EXCLUDED.purchased_at,
    expiration_at=EXCLUDED.expiration_at, latest_event_at=EXCLUDED.latest_event_at,
    cancellation_at=EXCLUDED.cancellation_at, billing_issue_at=EXCLUDED.billing_issue_at,
    store=EXCLUDED.store, environment=EXCLUDED.environment,
    latest_event_id=EXCLUDED.latest_event_id, updated_at=now()
  WHERE revenuecat_subscription_states.latest_event_at <= EXCLUDED.latest_event_at;
  GET DIAGNOSTICS v_applied = ROW_COUNT;
  -- Keep the protected legacy mirror current during a staged rollout. The
  -- canonical resolver switches in the following migration only after every
  -- legacy App Store Plus row has lifecycle state.
  IF v_applied = 1 THEN
    UPDATE public.profiles
    SET plan_tier = CASE
          WHEN p_status IN ('active','cancelled','billing_issue','paused')
            AND p_expiration_at IS NOT NULL AND p_expiration_at > now()
            THEN 'plus'
          ELSE 'free'
        END,
        subscription_status = CASE
          WHEN p_status IN ('active','cancelled','billing_issue','paused')
            AND p_expiration_at IS NOT NULL AND p_expiration_at > now()
            THEN 'active'
          ELSE 'inactive'
        END
    WHERE id = p_user_id;
  END IF;
  RETURN jsonb_build_object('processed', true, 'applied', v_applied = 1,
    'reason', CASE WHEN v_applied = 1 THEN 'applied' ELSE 'out_of_order' END);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_revenuecat_subscription_event(text,uuid,text,timestamptz,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_revenuecat_subscription_event(text,uuid,text,timestamptz,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text,text)
  TO service_role;
