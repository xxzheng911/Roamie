-- Roamie AI Credits (RAOS)
-- Credit Account + Ledger + Reserve/Commit/Rollback RPCs
-- Source of truth: Supabase. Client must not UPDATE balances directly.

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.credit_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'plus')),
  monthly_limit integer NOT NULL DEFAULT 20,
  available_credits integer NOT NULL DEFAULT 20,
  reserved_credits integer NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  last_reset_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_accounts_available_nonneg CHECK (available_credits >= 0),
  CONSTRAINT credit_accounts_reserved_nonneg CHECK (reserved_credits >= 0)
);

CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_type text NOT NULL
    CHECK (feature_type IN ('PLACE_RECOMMENDATION', 'ITINERARY_GENERATION')),
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'committed', 'rolled_back')),
  request_id text NOT NULL,
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  rolled_back_at timestamptz,
  CONSTRAINT credit_ledger_user_idempotency UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx
  ON public.credit_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_ledger_user_request_idx
  ON public.credit_ledger (user_id, request_id);
CREATE INDEX IF NOT EXISTS credit_ledger_status_idx
  ON public.credit_ledger (status)
  WHERE status = 'reserved';

ALTER TABLE public.credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_accounts_select_own ON public.credit_accounts;
CREATE POLICY credit_accounts_select_own
  ON public.credit_accounts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS credit_ledger_select_own ON public.credit_ledger;
CREATE POLICY credit_ledger_select_own
  ON public.credit_ledger FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No direct INSERT/UPDATE/DELETE for clients — mutations go through RPCs.

-- ── Helpers ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.credits_month_bounds(p_now timestamptz DEFAULT now())
RETURNS TABLE (period_start timestamptz, period_end timestamptz)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    date_trunc('month', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS period_start,
    (date_trunc('month', p_now AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC' AS period_end;
$$;

CREATE OR REPLACE FUNCTION public.credits_feature_cost(p_feature_type text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_feature_type
    WHEN 'PLACE_RECOMMENDATION' THEN 1
    WHEN 'ITINERARY_GENERATION' THEN 7
    ELSE NULL
  END;
$$;

-- Ensure account exists + roll natural month if needed. Sync plan from profiles when present.
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
  v_status text := 'inactive';
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'credits_ensure_account: user_id required';
  END IF;

  SELECT b.period_start, b.period_end INTO v_start, v_end
  FROM public.credits_month_bounds(v_now) AS b;

  SELECT COALESCE(p.plan_tier, 'free'), COALESCE(p.subscription_status, 'inactive')
    INTO v_plan, v_status
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_plan = 'plus' AND v_status NOT IN ('active', 'trialing') THEN
    v_plan := 'free';
  END IF;
  IF v_plan IS NULL OR v_plan NOT IN ('free', 'plus') THEN
    v_plan := 'free';
  END IF;

  INSERT INTO public.credit_accounts (
    user_id, plan, monthly_limit, available_credits, reserved_credits,
    period_start, period_end, last_reset_at
  )
  VALUES (
    p_user_id,
    v_plan,
    20,
    CASE WHEN v_plan = 'plus' THEN 20 ELSE 20 END,
    0,
    v_start,
    v_end,
    v_now
  )
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM public.credit_accounts WHERE user_id = p_user_id FOR UPDATE;

  -- Natural month reset (no rollover)
  IF v_now >= v_row.period_end THEN
    UPDATE public.credit_accounts
    SET
      available_credits = monthly_limit,
      reserved_credits = 0,
      period_start = v_start,
      period_end = v_end,
      last_reset_at = v_now,
      updated_at = v_now,
      plan = v_plan
    WHERE user_id = p_user_id
    RETURNING * INTO v_row;
  ELSIF v_row.plan IS DISTINCT FROM v_plan THEN
    UPDATE public.credit_accounts
    SET plan = v_plan, updated_at = v_now
    WHERE user_id = p_user_id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.credits_get_account()
RETURNS public.credit_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  RETURN public.credits_ensure_account(v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.credits_check(
  p_feature_type text,
  p_amount integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.credit_accounts;
  v_cost integer;
  v_usable integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_cost := COALESCE(p_amount, public.credits_feature_cost(p_feature_type));
  IF v_cost IS NULL OR v_cost <= 0 THEN
    RAISE EXCEPTION 'invalid feature_type or amount';
  END IF;

  v_row := public.credits_ensure_account(v_uid);

  -- Charging is client-gated for Plus (hasPlusAccess). Server always evaluates Free balance
  -- so Debug Force Free still works even when profiles.plan_tier is plus.
  v_usable := v_row.available_credits - v_row.reserved_credits;
  IF v_usable < v_cost THEN
    RETURN jsonb_build_object(
      'ok', false,
      'skipped', false,
      'reason', 'insufficient',
      'available_credits', v_row.available_credits,
      'reserved_credits', v_row.reserved_credits,
      'usable_credits', v_usable,
      'required', v_cost,
      'plan', v_row.plan
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'skipped', false,
    'reason', 'ok',
    'available_credits', v_row.available_credits,
    'reserved_credits', v_row.reserved_credits,
    'usable_credits', v_usable,
    'required', v_cost,
    'plan', v_row.plan
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.credits_reserve(
  p_feature_type text,
  p_request_id text,
  p_idempotency_key text,
  p_amount integer DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.credit_accounts;
  v_cost integer;
  v_usable integer;
  v_existing public.credit_ledger;
  v_ledger public.credit_ledger;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_request_id IS NULL OR length(trim(p_request_id)) = 0 THEN
    RAISE EXCEPTION 'request_id required';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key required';
  END IF;

  v_cost := COALESCE(p_amount, public.credits_feature_cost(p_feature_type));
  IF v_cost IS NULL OR v_cost <= 0 THEN
    RAISE EXCEPTION 'invalid feature_type or amount';
  END IF;

  v_row := public.credits_ensure_account(v_uid);

  -- Plus skip is enforced on the client (hasPlusAccess). When reserve is invoked,
  -- always create a Free reservation so Debug Force Free can validate real ledger.

  -- Idempotent: return existing row for same key
  SELECT * INTO v_existing
  FROM public.credit_ledger
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'ledger_id', v_existing.id,
      'status', v_existing.status,
      'amount', v_existing.amount,
      'skipped', false,
      'available_credits', v_row.available_credits,
      'reserved_credits', v_row.reserved_credits,
      'plan', v_row.plan
    );
  END IF;

  v_usable := v_row.available_credits - v_row.reserved_credits;
  IF v_usable < v_cost THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'insufficient',
      'available_credits', v_row.available_credits,
      'reserved_credits', v_row.reserved_credits,
      'usable_credits', v_usable,
      'required', v_cost,
      'plan', v_row.plan
    );
  END IF;

  UPDATE public.credit_accounts
  SET reserved_credits = reserved_credits + v_cost,
      updated_at = now()
  WHERE user_id = v_uid
  RETURNING * INTO v_row;

  INSERT INTO public.credit_ledger (
    user_id, feature_type, amount, status, request_id, idempotency_key, metadata
  ) VALUES (
    v_uid, p_feature_type, v_cost, 'reserved', p_request_id, p_idempotency_key,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_ledger;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'ledger_id', v_ledger.id,
    'status', v_ledger.status,
    'amount', v_cost,
    'skipped', false,
    'available_credits', v_row.available_credits,
    'reserved_credits', v_row.reserved_credits,
    'plan', v_row.plan
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.credits_commit(
  p_ledger_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ledger public.credit_ledger;
  v_row public.credit_accounts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_ledger_id IS NULL AND (p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0) THEN
    RAISE EXCEPTION 'ledger_id or idempotency_key required';
  END IF;

  IF p_ledger_id IS NOT NULL THEN
    SELECT * INTO v_ledger FROM public.credit_ledger
    WHERE id = p_ledger_id AND user_id = v_uid FOR UPDATE;
  ELSE
    SELECT * INTO v_ledger FROM public.credit_ledger
    WHERE user_id = v_uid AND idempotency_key = p_idempotency_key FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_ledger.status = 'committed' THEN
    v_row := public.credits_ensure_account(v_uid);
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'ledger_id', v_ledger.id,
      'status', 'committed',
      'available_credits', v_row.available_credits
    );
  END IF;

  IF v_ledger.status = 'rolled_back' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_rolled_back', 'ledger_id', v_ledger.id);
  END IF;

  UPDATE public.credit_accounts
  SET
    available_credits = available_credits - v_ledger.amount,
    reserved_credits = GREATEST(0, reserved_credits - v_ledger.amount),
    updated_at = now()
  WHERE user_id = v_uid
  RETURNING * INTO v_row;

  IF v_row.available_credits < 0 THEN
    RAISE EXCEPTION 'credits commit would go negative';
  END IF;

  UPDATE public.credit_ledger
  SET status = 'committed', committed_at = now()
  WHERE id = v_ledger.id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'ledger_id', v_ledger.id,
    'status', 'committed',
    'amount', v_ledger.amount,
    'available_credits', v_row.available_credits,
    'reserved_credits', v_row.reserved_credits
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.credits_rollback(
  p_ledger_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ledger public.credit_ledger;
  v_row public.credit_accounts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_ledger_id IS NULL AND (p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0) THEN
    RAISE EXCEPTION 'ledger_id or idempotency_key required';
  END IF;

  IF p_ledger_id IS NOT NULL THEN
    SELECT * INTO v_ledger FROM public.credit_ledger
    WHERE id = p_ledger_id AND user_id = v_uid FOR UPDATE;
  ELSE
    SELECT * INTO v_ledger FROM public.credit_ledger
    WHERE user_id = v_uid AND idempotency_key = p_idempotency_key FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'not_found', 'noop', true);
  END IF;

  IF v_ledger.status = 'rolled_back' THEN
    v_row := public.credits_ensure_account(v_uid);
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'ledger_id', v_ledger.id,
      'status', 'rolled_back',
      'available_credits', v_row.available_credits
    );
  END IF;

  IF v_ledger.status = 'committed' THEN
    -- Do not silently undo committed charges via rollback; caller must use debug tools.
    RETURN jsonb_build_object('ok', false, 'reason', 'already_committed', 'ledger_id', v_ledger.id);
  END IF;

  UPDATE public.credit_accounts
  SET
    reserved_credits = GREATEST(0, reserved_credits - v_ledger.amount),
    updated_at = now()
  WHERE user_id = v_uid
  RETURNING * INTO v_row;

  UPDATE public.credit_ledger
  SET status = 'rolled_back', rolled_back_at = now()
  WHERE id = v_ledger.id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'ledger_id', v_ledger.id,
    'status', 'rolled_back',
    'amount', v_ledger.amount,
    'available_credits', v_row.available_credits,
    'reserved_credits', v_row.reserved_credits
  );
END;
$$;

-- Debug: set available credits (developer / QA only at UI layer)
CREATE OR REPLACE FUNCTION public.credits_debug_set(
  p_available integer,
  p_force_plan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.credit_accounts;
  v_plan text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_available IS NULL OR p_available < 0 OR p_available > 20 THEN
    RAISE EXCEPTION 'available must be 0..20';
  END IF;

  v_row := public.credits_ensure_account(v_uid);
  v_plan := v_row.plan;
  IF p_force_plan IN ('free', 'plus') THEN
    v_plan := p_force_plan;
  END IF;

  UPDATE public.credit_accounts
  SET
    available_credits = p_available,
    reserved_credits = 0,
    plan = v_plan,
    updated_at = now()
  WHERE user_id = v_uid
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'available_credits', v_row.available_credits,
    'reserved_credits', v_row.reserved_credits,
    'plan', v_row.plan
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.credits_debug_reset()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.credits_debug_set(20, 'free');
END;
$$;

CREATE OR REPLACE FUNCTION public.credits_debug_deduct(p_amount integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.credit_accounts;
  v_next integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  v_row := public.credits_ensure_account(v_uid);
  v_next := GREATEST(0, v_row.available_credits - p_amount);

  UPDATE public.credit_accounts
  SET available_credits = v_next, updated_at = now()
  WHERE user_id = v_uid
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'available_credits', v_row.available_credits,
    'deducted', p_amount,
    'plan', v_row.plan
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.credits_get_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_check(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_reserve(text, text, text, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_commit(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_rollback(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_debug_set(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_debug_reset() TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_debug_deduct(integer) TO authenticated;
