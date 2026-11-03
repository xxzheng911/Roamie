-- Trip Workspace V1 phase 4: shared trip expenses.
--
-- Tables : trip_expenses, trip_expense_payers, trip_expense_shares
-- Access : SELECT only, for accepted trip members / trip owner (RLS).
--          All writes go through SECURITY DEFINER RPCs:
--            upsert_trip_expense(p_trip_id, p_expense, p_expected_version)
--            delete_trip_expense(p_expense_id, p_expected_version)
--            restore_trip_expense(p_expense_id)
--          Any accepted member (owner included) may create / edit / delete /
--          restore any expense in the trip (co-editing). No credits / Plus checks.
--
-- user_id / created_by / updated_by intentionally have NO foreign key to
-- auth.users: when a member deletes their account, their payer / share rows in
-- other people's trips are kept (shown as "deleted user"). Expenses of trips
-- the deleted user owns are removed by the saved_trips ON DELETE CASCADE.
--
-- Split rules (server recomputes and rejects mismatches):
--   equal  : q = floor(amount / n), r = amount - q * n; shares ordered by
--            user_id ascending (uuid byte order == lowercase hex string order);
--            the first r users get q + 1, the rest q.
--   percent: base_i = floor(amount * bp_i / 10000), rem_i = (amount * bp_i) % 10000;
--            leftover = amount - sum(base_i) units go one each to users ordered by
--            rem_i DESC, then user_id ASC. sum(bp) must be 10000.
--   exact  : share_minor as given; sum must equal amount.
--
-- Error codes raised (RAISE EXCEPTION '<code>'):
--   not_authenticated, not_trip_member, expense_malformed, expense_invalid_kind,
--   expense_invalid_title, expense_invalid_amount, expense_invalid_currency,
--   expense_invalid_date, expense_invalid_split_method, expense_invalid_note,
--   expense_payers_mismatch, expense_shares_mismatch, expense_percent_mismatch,
--   expense_split_mismatch, expense_duplicate_participant,
--   expense_participant_not_member, expense_invalid_settlement,
--   expense_not_found, expense_deleted, expense_conflict, expense_limit_reached
--
-- Not added to supabase_realtime publication. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trip_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.saved_trips(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('expense', 'settlement')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 10000000000000),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  currency_exponent smallint NOT NULL CHECK (currency_exponent BETWEEN 0 AND 4),
  spent_on date NOT NULL,
  split_method text NOT NULL CHECK (split_method IN ('equal', 'exact', 'percent')),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT trip_expenses_trip_client_request_key UNIQUE (trip_id, client_request_id),
  CONSTRAINT trip_expenses_settlement_exact CHECK (kind <> 'settlement' OR split_method = 'exact')
);

COMMENT ON COLUMN public.trip_expenses.currency_exponent IS
  'ISO 4217 minor-unit exponent snapshot at write time (amount = amount_minor / 10^exponent).';
COMMENT ON COLUMN public.trip_expenses.created_by IS
  'auth.uid() of creator. No FK: kept after account deletion (shown as deleted user).';

CREATE TABLE IF NOT EXISTS public.trip_expense_payers (
  expense_id uuid NOT NULL REFERENCES public.trip_expenses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 10000000000000),
  PRIMARY KEY (expense_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.trip_expense_shares (
  expense_id uuid NOT NULL REFERENCES public.trip_expenses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  share_minor bigint NOT NULL CHECK (share_minor >= 0 AND share_minor <= 10000000000000),
  percent_bp integer CHECK (percent_bp IS NULL OR percent_bp BETWEEN 0 AND 10000),
  PRIMARY KEY (expense_id, user_id)
);

CREATE INDEX IF NOT EXISTS trip_expenses_trip_spent_idx
  ON public.trip_expenses (trip_id, spent_on DESC, created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. RLS + table privileges (read-only for clients)
-- ---------------------------------------------------------------------------
ALTER TABLE public.trip_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_expense_payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_expense_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trip_expenses_member_select ON public.trip_expenses;
CREATE POLICY trip_expenses_member_select ON public.trip_expenses
  FOR SELECT TO authenticated
  USING (public.is_trip_accepted_member(trip_id) OR public.is_trip_owner(trip_id));

DROP POLICY IF EXISTS trip_expense_payers_member_select ON public.trip_expense_payers;
CREATE POLICY trip_expense_payers_member_select ON public.trip_expense_payers
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.trip_expenses e
    WHERE e.id = trip_expense_payers.expense_id
      AND (public.is_trip_accepted_member(e.trip_id) OR public.is_trip_owner(e.trip_id))
  ));

DROP POLICY IF EXISTS trip_expense_shares_member_select ON public.trip_expense_shares;
CREATE POLICY trip_expense_shares_member_select ON public.trip_expense_shares
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.trip_expenses e
    WHERE e.id = trip_expense_shares.expense_id
      AND (public.is_trip_accepted_member(e.trip_id) OR public.is_trip_owner(e.trip_id))
  ));

REVOKE ALL ON TABLE public.trip_expenses, public.trip_expense_payers, public.trip_expense_shares
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.trip_expenses, public.trip_expense_payers, public.trip_expense_shares
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. upsert_trip_expense(p_trip_id, p_expense, p_expected_version)
--    -> TABLE(expense_id uuid, expense_version integer, replayed boolean)
--
--    p_expense (jsonb object):
--      id                 uuid | null   omit / null = create; set = update
--      client_request_id  uuid          required on create (idempotency key);
--                                       ignored on update
--      kind               'expense' | 'settlement'
--      title              text, trimmed length 1..80
--      amount_minor       integer (JSON number or digit string) 1..10^13
--      currency           'TWD' etc. ^[A-Z]{3}$
--      currency_exponent  integer 0..4
--      spent_on           'YYYY-MM-DD'
--      split_method       'equal' | 'exact' | 'percent'
--      note               text | null, trimmed length <= 500 (empty -> null)
--      payers             [{ user_id uuid, amount_minor integer > 0 }]  1..50
--      shares             [{ user_id uuid, share_minor integer >= 0,
--                            percent_bp integer 0..10000 | null }]   1..50
--                         percent_bp required for 'percent', stored NULL otherwise.
--    p_expected_version: ignored on create (pass null); required on update.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_trip_expense(uuid, jsonb, integer);
CREATE FUNCTION public.upsert_trip_expense(p_trip_id uuid, p_expense jsonb, p_expected_version integer)
RETURNS TABLE (expense_id uuid, expense_version integer, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  uid uuid := auth.uid();
  c_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_int_re constant text := '^[0-9]{1,14}$';
  c_max_amount constant bigint := 10000000000000;
  v_id uuid;
  v_req uuid;
  v_kind text;
  v_title text;
  v_amount bigint;
  v_currency text;
  v_exponent smallint;
  v_spent date;
  v_method text;
  v_note text;
  v_txt text;
  v_elem jsonb;
  v_payer_ids uuid[] := '{}';
  v_payer_amts bigint[] := '{}';
  v_share_ids uuid[] := '{}';
  v_share_amts bigint[] := '{}';
  v_share_bps integer[] := '{}';
  v_q bigint;
  v_r bigint;
  v_leftover bigint;
  v_count integer;
  v_old_participants uuid[] := '{}';
  v_existing public.trip_expenses%ROWTYPE;
  v_new_version integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_trip_id IS NULL
    OR NOT (public.is_trip_accepted_member(p_trip_id) OR public.is_trip_owner(p_trip_id)) THEN
    RAISE EXCEPTION 'not_trip_member' USING ERRCODE = '42501';
  END IF;
  IF p_expense IS NULL OR jsonb_typeof(p_expense) <> 'object' THEN
    RAISE EXCEPTION 'expense_malformed' USING ERRCODE = '22023';
  END IF;

  -- ---- scalar fields -------------------------------------------------------
  v_txt := NULLIF(p_expense ->> 'id', '');
  IF v_txt IS NOT NULL THEN
    IF v_txt !~ c_uuid_re THEN RAISE EXCEPTION 'expense_malformed' USING ERRCODE = '22023'; END IF;
    v_id := v_txt::uuid;
  END IF;

  v_txt := NULLIF(p_expense ->> 'client_request_id', '');
  IF v_txt IS NOT NULL THEN
    IF v_txt !~ c_uuid_re THEN RAISE EXCEPTION 'expense_malformed' USING ERRCODE = '22023'; END IF;
    v_req := v_txt::uuid;
  END IF;
  IF v_id IS NULL AND v_req IS NULL THEN
    RAISE EXCEPTION 'expense_malformed' USING ERRCODE = '22023';
  END IF;

  v_kind := p_expense ->> 'kind';
  IF v_kind IS NULL OR v_kind NOT IN ('expense', 'settlement') THEN
    RAISE EXCEPTION 'expense_invalid_kind' USING ERRCODE = '22023';
  END IF;

  v_title := btrim(p_expense ->> 'title');
  IF v_title IS NULL OR char_length(v_title) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'expense_invalid_title' USING ERRCODE = '22023';
  END IF;

  v_txt := p_expense ->> 'amount_minor';
  IF v_txt IS NULL OR v_txt !~ c_int_re THEN
    RAISE EXCEPTION 'expense_invalid_amount' USING ERRCODE = '22023';
  END IF;
  v_amount := v_txt::bigint;
  IF v_amount < 1 OR v_amount > c_max_amount THEN
    RAISE EXCEPTION 'expense_invalid_amount' USING ERRCODE = '22023';
  END IF;

  v_currency := p_expense ->> 'currency';
  v_txt := p_expense ->> 'currency_exponent';
  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' OR v_txt IS NULL OR v_txt !~ '^[0-4]$' THEN
    RAISE EXCEPTION 'expense_invalid_currency' USING ERRCODE = '22023';
  END IF;
  v_exponent := v_txt::smallint;

  v_txt := p_expense ->> 'spent_on';
  IF v_txt IS NULL OR v_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'expense_invalid_date' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_spent := v_txt::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'expense_invalid_date' USING ERRCODE = '22023';
  END;

  v_method := p_expense ->> 'split_method';
  IF v_method IS NULL OR v_method NOT IN ('equal', 'exact', 'percent') THEN
    RAISE EXCEPTION 'expense_invalid_split_method' USING ERRCODE = '22023';
  END IF;

  IF p_expense ? 'note' AND jsonb_typeof(p_expense -> 'note') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'expense_invalid_note' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(COALESCE(p_expense ->> 'note', '')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'expense_invalid_note' USING ERRCODE = '22023';
  END IF;

  -- ---- payers --------------------------------------------------------------
  IF jsonb_typeof(p_expense -> 'payers') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_expense -> 'payers') > 50 THEN
    RAISE EXCEPTION 'expense_malformed' USING ERRCODE = '22023';
  END IF;
  FOR v_elem IN SELECT e.value FROM jsonb_array_elements(p_expense -> 'payers') AS e(value) LOOP
    IF jsonb_typeof(v_elem) <> 'object'
      OR COALESCE(v_elem ->> 'user_id', '') !~ c_uuid_re THEN
      RAISE EXCEPTION 'expense_malformed' USING ERRCODE = '22023';
    END IF;
    v_txt := v_elem ->> 'amount_minor';
    IF v_txt IS NULL OR v_txt !~ c_int_re THEN
      RAISE EXCEPTION 'expense_payers_mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_txt::bigint < 1 OR v_txt::bigint > c_max_amount THEN
      RAISE EXCEPTION 'expense_payers_mismatch' USING ERRCODE = '22023';
    END IF;
    v_payer_ids := array_append(v_payer_ids, (v_elem ->> 'user_id')::uuid);
    v_payer_amts := array_append(v_payer_amts, v_txt::bigint);
  END LOOP;

  -- ---- shares --------------------------------------------------------------
  IF jsonb_typeof(p_expense -> 'shares') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_expense -> 'shares') > 50 THEN
    RAISE EXCEPTION 'expense_malformed' USING ERRCODE = '22023';
  END IF;
  FOR v_elem IN SELECT e.value FROM jsonb_array_elements(p_expense -> 'shares') AS e(value) LOOP
    IF jsonb_typeof(v_elem) <> 'object'
      OR COALESCE(v_elem ->> 'user_id', '') !~ c_uuid_re THEN
      RAISE EXCEPTION 'expense_malformed' USING ERRCODE = '22023';
    END IF;
    v_txt := v_elem ->> 'share_minor';
    IF v_txt IS NULL OR v_txt !~ c_int_re THEN
      RAISE EXCEPTION 'expense_shares_mismatch' USING ERRCODE = '22023';
    END IF;
    IF v_txt::bigint > c_max_amount THEN
      RAISE EXCEPTION 'expense_shares_mismatch' USING ERRCODE = '22023';
    END IF;
    v_share_ids := array_append(v_share_ids, (v_elem ->> 'user_id')::uuid);
    v_share_amts := array_append(v_share_amts, v_txt::bigint);
    v_txt := v_elem ->> 'percent_bp';
    IF v_method = 'percent' THEN
      IF v_txt IS NULL OR v_txt !~ '^[0-9]{1,5}$' THEN
        RAISE EXCEPTION 'expense_percent_mismatch' USING ERRCODE = '22023';
      END IF;
      IF v_txt::integer > 10000 THEN
        RAISE EXCEPTION 'expense_percent_mismatch' USING ERRCODE = '22023';
      END IF;
      v_share_bps := array_append(v_share_bps, v_txt::integer);
    ELSE
      v_share_bps := array_append(v_share_bps, NULL::integer);
    END IF;
  END LOOP;

  -- ---- totals / shape ------------------------------------------------------
  IF cardinality(v_payer_ids) < 1
    OR (SELECT sum(a) FROM unnest(v_payer_amts) AS t(a)) <> v_amount THEN
    RAISE EXCEPTION 'expense_payers_mismatch' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_share_ids) < 1
    OR (SELECT sum(a) FROM unnest(v_share_amts) AS t(a)) <> v_amount THEN
    RAISE EXCEPTION 'expense_shares_mismatch' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT u) FROM unnest(v_payer_ids) AS t(u)) <> cardinality(v_payer_ids)
    OR (SELECT count(DISTINCT u) FROM unnest(v_share_ids) AS t(u)) <> cardinality(v_share_ids) THEN
    RAISE EXCEPTION 'expense_duplicate_participant' USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'settlement' AND (
       cardinality(v_payer_ids) <> 1
    OR cardinality(v_share_ids) <> 1
    OR v_payer_ids[1] = v_share_ids[1]
    OR v_method <> 'exact') THEN
    RAISE EXCEPTION 'expense_invalid_settlement' USING ERRCODE = '22023';
  END IF;

  -- ---- server-side split recomputation -------------------------------------
  IF v_method = 'equal' THEN
    v_q := v_amount / cardinality(v_share_ids);
    v_r := v_amount - v_q * cardinality(v_share_ids);
    IF EXISTS (
      SELECT 1
      FROM (
        SELECT s.u, s.a, row_number() OVER (ORDER BY s.u) AS rn
        FROM unnest(v_share_ids, v_share_amts) AS s(u, a)
      ) z
      WHERE z.a <> v_q + CASE WHEN z.rn <= v_r THEN 1 ELSE 0 END
    ) THEN
      RAISE EXCEPTION 'expense_split_mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF v_method = 'percent' THEN
    IF (SELECT sum(b) FROM unnest(v_share_bps) AS t(b)) <> 10000 THEN
      RAISE EXCEPTION 'expense_percent_mismatch' USING ERRCODE = '22023';
    END IF;
    SELECT v_amount - sum((v_amount * s.b) / 10000) INTO v_leftover
    FROM unnest(v_share_bps) AS s(b);
    IF EXISTS (
      SELECT 1
      FROM (
        SELECT s.a,
               (v_amount * s.b) / 10000 AS base,
               row_number() OVER (ORDER BY (v_amount * s.b) % 10000 DESC, s.u) AS rn
        FROM unnest(v_share_ids, v_share_amts, v_share_bps) AS s(u, a, b)
      ) z
      WHERE z.a <> z.base + CASE WHEN z.rn <= v_leftover THEN 1 ELSE 0 END
    ) THEN
      RAISE EXCEPTION 'expense_split_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- exact: sums already verified.

  -- ---- write ---------------------------------------------------------------
  PERFORM pg_advisory_xact_lock(hashtextextended('trip_expense:' || p_trip_id::text, 0));

  IF v_id IS NULL THEN
    -- Create (idempotent on client_request_id).
    SELECT * INTO v_existing FROM public.trip_expenses te
    WHERE te.trip_id = p_trip_id AND te.client_request_id = v_req;
    IF FOUND THEN
      expense_id := v_existing.id; expense_version := v_existing.version; replayed := true;
      RETURN NEXT;
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM unnest(v_payer_ids || v_share_ids) AS p(u)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.trip_members m
        WHERE m.trip_id = p_trip_id AND m.user_id = p.u AND m.status = 'accepted'
      )
    ) THEN
      RAISE EXCEPTION 'expense_participant_not_member' USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::integer INTO v_count FROM public.trip_expenses te
    WHERE te.trip_id = p_trip_id AND te.deleted_at IS NULL;
    IF v_count >= 2000 THEN
      RAISE EXCEPTION 'expense_limit_reached' USING ERRCODE = '54000';
    END IF;

    INSERT INTO public.trip_expenses (
      trip_id, kind, title, amount_minor, currency, currency_exponent, spent_on,
      split_method, note, created_by, updated_by, version, client_request_id
    ) VALUES (
      p_trip_id, v_kind, v_title, v_amount, v_currency, v_exponent, v_spent,
      v_method, v_note, uid, uid, 1, v_req
    )
    RETURNING id INTO v_id;
    v_new_version := 1;
  ELSE
    -- Update.
    SELECT * INTO v_existing FROM public.trip_expenses te
    WHERE te.id = v_id AND te.trip_id = p_trip_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002'; END IF;
    IF v_existing.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'expense_deleted' USING ERRCODE = '55000';
    END IF;
    IF p_expected_version IS NULL OR p_expected_version <> v_existing.version THEN
      RAISE EXCEPTION 'expense_conflict' USING ERRCODE = '40001';
    END IF;

    SELECT COALESCE(array_agg(x.user_id), '{}') INTO v_old_participants
    FROM (
      SELECT tp.user_id FROM public.trip_expense_payers tp WHERE tp.expense_id = v_id
      UNION
      SELECT ts.user_id FROM public.trip_expense_shares ts WHERE ts.expense_id = v_id
    ) x;

    -- Members who left may stay on an existing expense; new people must be members.
    IF EXISTS (
      SELECT 1 FROM unnest(v_payer_ids || v_share_ids) AS p(u)
      WHERE NOT (p.u = ANY (v_old_participants))
        AND NOT EXISTS (
          SELECT 1 FROM public.trip_members m
          WHERE m.trip_id = p_trip_id AND m.user_id = p.u AND m.status = 'accepted'
        )
    ) THEN
      RAISE EXCEPTION 'expense_participant_not_member' USING ERRCODE = '22023';
    END IF;

    UPDATE public.trip_expenses te
    SET kind = v_kind,
        title = v_title,
        amount_minor = v_amount,
        currency = v_currency,
        currency_exponent = v_exponent,
        spent_on = v_spent,
        split_method = v_method,
        note = v_note,
        updated_by = uid,
        version = te.version + 1,
        updated_at = now()
    WHERE te.id = v_id
    RETURNING te.version INTO v_new_version;

    DELETE FROM public.trip_expense_payers tp WHERE tp.expense_id = v_id;
    DELETE FROM public.trip_expense_shares ts WHERE ts.expense_id = v_id;
  END IF;

  INSERT INTO public.trip_expense_payers (expense_id, user_id, amount_minor)
  SELECT v_id, p.u, p.a FROM unnest(v_payer_ids, v_payer_amts) AS p(u, a);

  INSERT INTO public.trip_expense_shares (expense_id, user_id, share_minor, percent_bp)
  SELECT v_id, s.u, s.a, s.b FROM unnest(v_share_ids, v_share_amts, v_share_bps) AS s(u, a, b);

  expense_id := v_id; expense_version := v_new_version; replayed := false;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_trip_expense(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_trip_expense(uuid, jsonb, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. delete_trip_expense(p_expense_id, p_expected_version)
--    -> TABLE(expense_id uuid, expense_version integer)
--    Soft delete. Any accepted member (owner included). Deleting an already
--    deleted expense is a no-op returning the current version.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.delete_trip_expense(uuid, integer);
CREATE FUNCTION public.delete_trip_expense(p_expense_id uuid, p_expected_version integer)
RETURNS TABLE (expense_id uuid, expense_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  uid uuid := auth.uid();
  v_trip uuid;
  v_row public.trip_expenses%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_expense_id IS NULL THEN RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002'; END IF;

  SELECT te.trip_id INTO v_trip FROM public.trip_expenses te WHERE te.id = p_expense_id;
  -- Non-members get expense_not_found (no existence oracle).
  IF NOT FOUND
    OR NOT (public.is_trip_accepted_member(v_trip) OR public.is_trip_owner(v_trip)) THEN
    RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('trip_expense:' || v_trip::text, 0));
  SELECT * INTO v_row FROM public.trip_expenses te WHERE te.id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002'; END IF;

  IF v_row.deleted_at IS NOT NULL THEN
    expense_id := v_row.id; expense_version := v_row.version;
    RETURN NEXT;
    RETURN;
  END IF;
  IF p_expected_version IS NULL OR p_expected_version <> v_row.version THEN
    RAISE EXCEPTION 'expense_conflict' USING ERRCODE = '40001';
  END IF;

  UPDATE public.trip_expenses te
  SET deleted_at = now(), updated_by = uid, updated_at = now(), version = te.version + 1
  WHERE te.id = p_expense_id
  RETURNING te.id, te.version INTO expense_id, expense_version;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_trip_expense(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_trip_expense(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. restore_trip_expense(p_expense_id)
--    -> TABLE(expense_id uuid, expense_version integer)
--    Same permission as delete. Restoring a live expense is a no-op.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.restore_trip_expense(uuid);
CREATE FUNCTION public.restore_trip_expense(p_expense_id uuid)
RETURNS TABLE (expense_id uuid, expense_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  uid uuid := auth.uid();
  v_trip uuid;
  v_row public.trip_expenses%ROWTYPE;
  v_count integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_expense_id IS NULL THEN RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002'; END IF;

  SELECT te.trip_id INTO v_trip FROM public.trip_expenses te WHERE te.id = p_expense_id;
  IF NOT FOUND
    OR NOT (public.is_trip_accepted_member(v_trip) OR public.is_trip_owner(v_trip)) THEN
    RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('trip_expense:' || v_trip::text, 0));
  SELECT * INTO v_row FROM public.trip_expenses te WHERE te.id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002'; END IF;

  IF v_row.deleted_at IS NULL THEN
    expense_id := v_row.id; expense_version := v_row.version;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_count FROM public.trip_expenses te
  WHERE te.trip_id = v_trip AND te.deleted_at IS NULL;
  IF v_count >= 2000 THEN
    RAISE EXCEPTION 'expense_limit_reached' USING ERRCODE = '54000';
  END IF;

  UPDATE public.trip_expenses te
  SET deleted_at = NULL, updated_by = uid, updated_at = now(), version = te.version + 1
  WHERE te.id = p_expense_id
  RETURNING te.id, te.version INTO expense_id, expense_version;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.restore_trip_expense(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_trip_expense(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
