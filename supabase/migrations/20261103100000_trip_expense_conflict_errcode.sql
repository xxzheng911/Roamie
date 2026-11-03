-- 20261103100000_trip_expense_conflict_errcode.sql
--
-- Fix: expense_conflict was raised with SQLSTATE 40001 (serialization_failure).
--      40001 is a retryable transaction error class; the stale-version conflict
--      is deterministic, so automatic retries never succeed and the request
--      ends in "upstream request timeout" instead of an immediate error.
--
-- Change: redefine upsert_trip_expense and delete_trip_expense with bodies
--         identical to 20261102120000_trip_expenses.sql, except that
--         'expense_conflict' now uses ERRCODE 'P0001' (raise_exception, class
--         P0 = PL/pgSQL error; not class 40 transaction rollback, never retried).
--         The error message text 'expense_conflict' is unchanged; clients match
--         on the message.
--
-- Signatures, return types, SECURITY DEFINER, search_path and grants are
-- unchanged. CREATE OR REPLACE keeps existing privileges; REVOKE/GRANT are
-- repeated so the migration is safe to re-run.

-- ---------------------------------------------------------------------------
-- upsert_trip_expense(p_trip_id, p_expense, p_expected_version)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_trip_expense(p_trip_id uuid, p_expense jsonb, p_expected_version integer)
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
      RAISE EXCEPTION 'expense_conflict' USING ERRCODE = 'P0001';
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
-- delete_trip_expense(p_expense_id, p_expected_version)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_trip_expense(p_expense_id uuid, p_expected_version integer)
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
    RAISE EXCEPTION 'expense_conflict' USING ERRCODE = 'P0001';
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

NOTIFY pgrst, 'reload schema';
