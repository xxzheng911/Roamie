-- Credits Runtime supplements:
-- 1) credit_debug_overrides (Debug does NOT mutate formal available_credits)
-- 2) credit_ledger.environment (debug | production)
-- 3) Auto-rollback reserved rows older than 5 minutes

-- ── Debug override table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.credit_debug_overrides (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  available_credits integer NOT NULL DEFAULT 20
    CHECK (available_credits >= 0 AND available_credits <= 20),
  reserved_credits integer NOT NULL DEFAULT 0
    CHECK (reserved_credits >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_debug_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_debug_overrides_select_own ON public.credit_debug_overrides;
CREATE POLICY credit_debug_overrides_select_own
  ON public.credit_debug_overrides FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ── Ledger environment ──────────────────────────────────────────────────────

ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production';

ALTER TABLE public.credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_environment_check;
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_environment_check
  CHECK (environment IN ('debug', 'production'));

CREATE INDEX IF NOT EXISTS credit_ledger_reserved_created_idx
  ON public.credit_ledger (created_at)
  WHERE status = 'reserved';

-- ── Stale reserved auto-rollback (5 minutes) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.credits_release_stale_reservations(
  p_user_id uuid DEFAULT NULL,
  p_max_age interval DEFAULT interval '5 minutes'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.credit_ledger;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT *
    FROM public.credit_ledger
    WHERE status = 'reserved'
      AND created_at < now() - p_max_age
      AND (p_user_id IS NULL OR user_id = p_user_id)
    FOR UPDATE
  LOOP
    IF v_row.environment = 'debug' THEN
      UPDATE public.credit_debug_overrides
      SET
        reserved_credits = GREATEST(0, reserved_credits - v_row.amount),
        updated_at = now()
      WHERE user_id = v_row.user_id;
    ELSE
      UPDATE public.credit_accounts
      SET
        reserved_credits = GREATEST(0, reserved_credits - v_row.amount),
        updated_at = now()
      WHERE user_id = v_row.user_id;
    END IF;

    UPDATE public.credit_ledger
    SET
      status = 'rolled_back',
      rolled_back_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'stale_auto_rollback', true,
        'stale_max_age_seconds', EXTRACT(EPOCH FROM p_max_age)::integer
      )
    WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── Effective balance helper ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.credits_effective_balance(p_user_id uuid)
RETURNS TABLE (
  available_credits integer,
  reserved_credits integer,
  override_active boolean,
  formal_available integer,
  formal_reserved integer,
  environment text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc public.credit_accounts;
  v_ovr public.credit_debug_overrides;
BEGIN
  PERFORM public.credits_release_stale_reservations(p_user_id);

  SELECT * INTO v_acc FROM public.credit_accounts WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    available_credits := 0;
    reserved_credits := 0;
    override_active := false;
    formal_available := 0;
    formal_reserved := 0;
    environment := 'production';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_ovr FROM public.credit_debug_overrides WHERE user_id = p_user_id;
  IF FOUND THEN
    available_credits := v_ovr.available_credits;
    reserved_credits := v_ovr.reserved_credits;
    override_active := true;
    formal_available := v_acc.available_credits;
    formal_reserved := v_acc.reserved_credits;
    environment := 'debug';
  ELSE
    available_credits := v_acc.available_credits;
    reserved_credits := v_acc.reserved_credits;
    override_active := false;
    formal_available := v_acc.available_credits;
    formal_reserved := v_acc.reserved_credits;
    environment := 'production';
  END IF;
  RETURN NEXT;
END;
$$;

-- Patch ensure_account to also release stale reservations for this user
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

  PERFORM public.credits_release_stale_reservations(p_user_id);

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
    20,
    0,
    v_start,
    v_end,
    v_now
  )
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM public.credit_accounts WHERE user_id = p_user_id FOR UPDATE;

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

-- get_account returns jsonb so clients can see override vs formal
-- (return type change requires DROP; CREATE OR REPLACE cannot alter OUT type)
DROP FUNCTION IF EXISTS public.credits_get_account();
CREATE OR REPLACE FUNCTION public.credits_get_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.credit_accounts;
  v_bal record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  v_row := public.credits_ensure_account(v_uid);
  SELECT * INTO v_bal FROM public.credits_effective_balance(v_uid);

  RETURN jsonb_build_object(
    'user_id', v_row.user_id,
    'plan', v_row.plan,
    'monthly_limit', v_row.monthly_limit,
    'available_credits', v_bal.available_credits,
    'reserved_credits', v_bal.reserved_credits,
    'period_start', v_row.period_start,
    'period_end', v_row.period_end,
    'last_reset_at', v_row.last_reset_at,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at,
    'override_active', v_bal.override_active,
    'formal_available_credits', v_bal.formal_available,
    'formal_reserved_credits', v_bal.formal_reserved,
    'environment', v_bal.environment
  );
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
  v_bal record;
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
  SELECT * INTO v_bal FROM public.credits_effective_balance(v_uid);
  v_usable := v_bal.available_credits - v_bal.reserved_credits;

  IF v_usable < v_cost THEN
    RETURN jsonb_build_object(
      'ok', false,
      'skipped', false,
      'reason', 'insufficient',
      'available_credits', v_bal.available_credits,
      'reserved_credits', v_bal.reserved_credits,
      'usable_credits', v_usable,
      'required', v_cost,
      'plan', v_row.plan,
      'override_active', v_bal.override_active,
      'environment', v_bal.environment
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'skipped', false,
    'reason', 'ok',
    'available_credits', v_bal.available_credits,
    'reserved_credits', v_bal.reserved_credits,
    'usable_credits', v_usable,
    'required', v_cost,
    'plan', v_row.plan,
    'override_active', v_bal.override_active,
    'environment', v_bal.environment
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
  v_bal record;
  v_cost integer;
  v_usable integer;
  v_existing public.credit_ledger;
  v_ledger public.credit_ledger;
  v_env text;
  v_avail integer;
  v_reserved integer;
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
  SELECT * INTO v_bal FROM public.credits_effective_balance(v_uid);
  v_env := v_bal.environment;
  v_avail := v_bal.available_credits;
  v_reserved := v_bal.reserved_credits;

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
      'available_credits', v_avail,
      'reserved_credits', v_reserved,
      'plan', v_row.plan,
      'override_active', v_bal.override_active,
      'environment', COALESCE(v_existing.environment, v_env)
    );
  END IF;

  v_usable := v_avail - v_reserved;
  IF v_usable < v_cost THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'insufficient',
      'available_credits', v_avail,
      'reserved_credits', v_reserved,
      'usable_credits', v_usable,
      'required', v_cost,
      'plan', v_row.plan,
      'override_active', v_bal.override_active,
      'environment', v_env
    );
  END IF;

  IF v_bal.override_active THEN
    UPDATE public.credit_debug_overrides
    SET reserved_credits = reserved_credits + v_cost,
        updated_at = now()
    WHERE user_id = v_uid
    RETURNING available_credits, reserved_credits INTO v_avail, v_reserved;
  ELSE
    UPDATE public.credit_accounts
    SET reserved_credits = reserved_credits + v_cost,
        updated_at = now()
    WHERE user_id = v_uid
    RETURNING available_credits, reserved_credits INTO v_avail, v_reserved;
  END IF;

  INSERT INTO public.credit_ledger (
    user_id, feature_type, amount, status, request_id, idempotency_key, metadata, environment
  ) VALUES (
    v_uid, p_feature_type, v_cost, 'reserved', p_request_id, p_idempotency_key,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('override_active', v_bal.override_active),
    v_env
  )
  RETURNING * INTO v_ledger;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'ledger_id', v_ledger.id,
    'status', v_ledger.status,
    'amount', v_cost,
    'skipped', false,
    'available_credits', v_avail,
    'reserved_credits', v_reserved,
    'plan', v_row.plan,
    'override_active', v_bal.override_active,
    'environment', v_env
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
  v_bal record;
  v_avail integer;
  v_reserved integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_ledger_id IS NULL AND (p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0) THEN
    RAISE EXCEPTION 'ledger_id or idempotency_key required';
  END IF;

  PERFORM public.credits_ensure_account(v_uid);

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

  SELECT * INTO v_bal FROM public.credits_effective_balance(v_uid);

  IF v_ledger.status = 'committed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'ledger_id', v_ledger.id,
      'status', 'committed',
      'available_credits', v_bal.available_credits,
      'environment', v_ledger.environment
    );
  END IF;

  IF v_ledger.status = 'rolled_back' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_rolled_back', 'ledger_id', v_ledger.id);
  END IF;

  IF v_ledger.environment = 'debug' THEN
    UPDATE public.credit_debug_overrides
    SET
      available_credits = available_credits - v_ledger.amount,
      reserved_credits = GREATEST(0, reserved_credits - v_ledger.amount),
      updated_at = now()
    WHERE user_id = v_uid
    RETURNING available_credits, reserved_credits INTO v_avail, v_reserved;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'debug override missing for debug ledger commit';
    END IF;
    IF v_avail < 0 THEN
      RAISE EXCEPTION 'credits commit would go negative (debug override)';
    END IF;
  ELSE
    UPDATE public.credit_accounts
    SET
      available_credits = available_credits - v_ledger.amount,
      reserved_credits = GREATEST(0, reserved_credits - v_ledger.amount),
      updated_at = now()
    WHERE user_id = v_uid
    RETURNING available_credits, reserved_credits INTO v_avail, v_reserved;

    IF v_avail < 0 THEN
      RAISE EXCEPTION 'credits commit would go negative';
    END IF;
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
    'available_credits', v_avail,
    'reserved_credits', v_reserved,
    'environment', v_ledger.environment,
    'override_active', v_ledger.environment = 'debug'
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
  v_bal record;
  v_avail integer;
  v_reserved integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_ledger_id IS NULL AND (p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0) THEN
    RAISE EXCEPTION 'ledger_id or idempotency_key required';
  END IF;

  PERFORM public.credits_ensure_account(v_uid);

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

  SELECT * INTO v_bal FROM public.credits_effective_balance(v_uid);

  IF v_ledger.status = 'rolled_back' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'ledger_id', v_ledger.id,
      'status', 'rolled_back',
      'available_credits', v_bal.available_credits,
      'environment', v_ledger.environment
    );
  END IF;

  IF v_ledger.status = 'committed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_committed', 'ledger_id', v_ledger.id);
  END IF;

  IF v_ledger.environment = 'debug' THEN
    UPDATE public.credit_debug_overrides
    SET
      reserved_credits = GREATEST(0, reserved_credits - v_ledger.amount),
      updated_at = now()
    WHERE user_id = v_uid
    RETURNING available_credits, reserved_credits INTO v_avail, v_reserved;

    IF NOT FOUND THEN
      v_avail := v_bal.available_credits;
      v_reserved := v_bal.reserved_credits;
    END IF;
  ELSE
    UPDATE public.credit_accounts
    SET
      reserved_credits = GREATEST(0, reserved_credits - v_ledger.amount),
      updated_at = now()
    WHERE user_id = v_uid
    RETURNING available_credits, reserved_credits INTO v_avail, v_reserved;
  END IF;

  UPDATE public.credit_ledger
  SET status = 'rolled_back', rolled_back_at = now()
  WHERE id = v_ledger.id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'ledger_id', v_ledger.id,
    'status', 'rolled_back',
    'amount', v_ledger.amount,
    'available_credits', v_avail,
    'reserved_credits', v_reserved,
    'environment', v_ledger.environment,
    'override_active', v_ledger.environment = 'debug'
  );
END;
$$;

-- Debug Override RPCs — NEVER mutate formal credit_accounts balances
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
  v_ovr public.credit_debug_overrides;
  v_formal public.credit_accounts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_available IS NULL OR p_available < 0 OR p_available > 20 THEN
    RAISE EXCEPTION 'available must be 0..20';
  END IF;

  -- Ensure formal account exists but do not change its balances.
  v_formal := public.credits_ensure_account(v_uid);

  INSERT INTO public.credit_debug_overrides (user_id, available_credits, reserved_credits)
  VALUES (v_uid, p_available, 0)
  ON CONFLICT (user_id) DO UPDATE
  SET
    available_credits = EXCLUDED.available_credits,
    reserved_credits = 0,
    updated_at = now()
  RETURNING * INTO v_ovr;

  RETURN jsonb_build_object(
    'ok', true,
    'available_credits', v_ovr.available_credits,
    'reserved_credits', v_ovr.reserved_credits,
    'override_active', true,
    'formal_available_credits', v_formal.available_credits,
    'formal_reserved_credits', v_formal.reserved_credits,
    'environment', 'debug',
    'plan', COALESCE(NULLIF(p_force_plan, ''), 'free')
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
  v_ovr public.credit_debug_overrides;
  v_formal public.credit_accounts;
  v_next integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  v_formal := public.credits_ensure_account(v_uid);

  SELECT * INTO v_ovr FROM public.credit_debug_overrides WHERE user_id = v_uid;
  IF NOT FOUND THEN
    -- Create override from formal balance so deduct doesn't pollute formal.
    INSERT INTO public.credit_debug_overrides (user_id, available_credits, reserved_credits)
    VALUES (v_uid, v_formal.available_credits, 0)
    RETURNING * INTO v_ovr;
  END IF;

  v_next := GREATEST(0, v_ovr.available_credits - p_amount);

  UPDATE public.credit_debug_overrides
  SET available_credits = v_next, updated_at = now()
  WHERE user_id = v_uid
  RETURNING * INTO v_ovr;

  RETURN jsonb_build_object(
    'ok', true,
    'available_credits', v_ovr.available_credits,
    'reserved_credits', v_ovr.reserved_credits,
    'deducted', p_amount,
    'override_active', true,
    'formal_available_credits', v_formal.available_credits,
    'environment', 'debug'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.credits_debug_clear_override()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_formal public.credit_accounts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_formal := public.credits_ensure_account(v_uid);
  DELETE FROM public.credit_debug_overrides WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'override_active', false,
    'available_credits', v_formal.available_credits,
    'reserved_credits', v_formal.reserved_credits,
    'formal_available_credits', v_formal.available_credits,
    'environment', 'production'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.credits_release_stale_reservations(uuid, interval) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_effective_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_debug_clear_override() TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_get_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_check(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_reserve(text, text, text, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_commit(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_rollback(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_debug_set(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_debug_reset() TO authenticated;
GRANT EXECUTE ON FUNCTION public.credits_debug_deduct(integer) TO authenticated;
