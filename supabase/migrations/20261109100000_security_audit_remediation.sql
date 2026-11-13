-- Security audit remediation (run-1 + run-2, 2026-11-09).
--
-- Section A (audit #2, AI credits refund-while-streaming; run-2 issues 1, 2):
--   credits_commit no longer skips a ledger row that was already rolled back
--   (cancel header or stale auto-release). The row is charged and marked
--   committed; the database is authoritative.
--   Run-2: reserve / commit / rollback take a trailing p_user_id (DEFAULT NULL).
--   * service_role (the Worker) must pass p_user_id = the verified user; it no
--     longer depends on the user's JWT surviving until settlement.
--   * authenticated callers keep the exact old behaviour for their own rows;
--     p_user_id must be NULL or equal auth.uid() (no impersonation).
--   * Ledger rows reserved by service_role get metadata.service_managed = true
--     (set by the function only; a caller-supplied value is stripped). Rows
--     with a 'server:' key and that flag can only be committed / rolled back
--     by service_role: a client can no longer roll back a Worker reservation.
--     All Worker reservations (/api/roamie, /api/chat and the itinerary
--     server-function middleware) use the service role. Rows reserved with a
--     user JWT (client runtime) keep the old behaviour.
--   * credits_reserve has no 'server:' guard (only commit / rollback do): a
--     client reserving a 'server:' key can only hold its own credits, and that
--     row lacks service_managed, so it grants nothing extra; if it collides
--     with a Worker key, the Worker's reserve returns idempotent and the
--     endpoint answers 409 without generating.
--   The old 2/5-argument signatures are dropped first so PostgREST never sees
--   two candidates for the same named arguments.
--
-- Section B (audit #3, removed member rejoins with reusable share link):
--   remove_trip_member(p_trip_id, p_member_user_id) — SECURITY DEFINER, owner
--   only, cannot remove the owner. Deletes the membership and revokes the open
--   share link(s) of the trip in the same transaction, plus pending legacy
--   one-time invites addressed to the removed member (invitee_user_id or
--   invitee_email; run-2 issue 7). Client DELETE on
--   trip_members is revoked (no other client feature deletes membership rows).
--
-- Section C (audit #4, owner rewrites trip_members.user_id / trip_id):
--   Client UPDATE on trip_members is revoked and the UPDATE policy dropped.
--   SECURITY DEFINER functions (accept_trip_invite, ensure_trip_owner_member,
--   section D) run as the function owner and are unaffected.
--
-- Section D (account deletion keeps shared trips, option A):
--   transfer_owned_shared_trips_for_deletion(p_user_id) — service_role only.
--   Every saved_trip owned by p_user_id that has another accepted member is
--   handed to the earliest accepted member (trip_members.created_at, then id).
--   protect_saved_trip_owner now lets trusted roles (non anon/authenticated)
--   change saved_trips.user_id; clients remain blocked.
--   service_role gets column-level SELECT/UPDATE on saved_trips cover columns
--   so account deletion can repoint covers moved out of the deleted user's
--   storage prefix.
--
-- Safe to re-run (CREATE OR REPLACE / IF EXISTS / idempotent grants).
-- Not added to supabase_realtime publication.

-- ===========================================================================
-- Section A. Credits: service-role settlement for 'server:' reservations;
-- credits_commit charges even when the reservation was rolled back.
-- ===========================================================================

-- A1. Reserve (body identical to 20260723130000 except caller resolution and
-- the service_managed flag). No 'server:' guard here; see the header note.
DROP FUNCTION IF EXISTS public.credits_reserve(text, text, text, integer, jsonb);
CREATE OR REPLACE FUNCTION public.credits_reserve(
  p_feature_type text,
  p_request_id text,
  p_idempotency_key text,
  p_amount integer DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_uid uuid;
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
  IF v_service THEN
    v_uid := p_user_id;
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not authenticated';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> v_uid THEN
      RAISE EXCEPTION 'user_id mismatch' USING ERRCODE = '42501';
    END IF;
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
    -- service_managed is set here only (a caller-supplied value is stripped).
    (COALESCE(p_metadata, '{}'::jsonb) - 'service_managed')
      || jsonb_build_object('override_active', v_bal.override_active)
      || CASE WHEN v_service THEN jsonb_build_object('service_managed', true)
              ELSE '{}'::jsonb END,
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
REVOKE ALL ON FUNCTION public.credits_reserve(text, text, text, integer, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credits_reserve(text, text, text, integer, jsonb, uuid)
  TO authenticated, service_role;

-- A2. Commit: charge even when the reservation was rolled back.
DROP FUNCTION IF EXISTS public.credits_commit(uuid, text);
CREATE OR REPLACE FUNCTION public.credits_commit(
  p_ledger_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_uid uuid;
  v_ledger public.credit_ledger;
  v_bal record;
  v_avail integer;
  v_reserved integer;
  v_after_rollback boolean := false;
BEGIN
  IF v_service THEN
    v_uid := p_user_id;
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not authenticated';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> v_uid THEN
      RAISE EXCEPTION 'user_id mismatch' USING ERRCODE = '42501';
    END IF;
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

  -- Worker-managed reservations ('server:%' reserved by service_role) are
  -- settled by the Worker only.
  IF NOT v_service
    AND v_ledger.idempotency_key LIKE 'server:%'
    AND COALESCE(v_ledger.metadata ->> 'service_managed', '') = 'true'
  THEN
    RAISE EXCEPTION 'server_managed_ledger' USING ERRCODE = '42501';
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

  v_after_rollback := v_ledger.status = 'rolled_back';

  IF v_ledger.environment = 'debug' THEN
    IF v_after_rollback THEN
      -- Reserved hold was already released by the rollback; only charge.
      UPDATE public.credit_debug_overrides
      SET
        available_credits = GREATEST(0, available_credits - v_ledger.amount),
        updated_at = now()
      WHERE user_id = v_uid
      RETURNING available_credits, reserved_credits INTO v_avail, v_reserved;
    ELSE
      UPDATE public.credit_debug_overrides
      SET
        available_credits = available_credits - v_ledger.amount,
        reserved_credits = GREATEST(0, reserved_credits - v_ledger.amount),
        updated_at = now()
      WHERE user_id = v_uid
      RETURNING available_credits, reserved_credits INTO v_avail, v_reserved;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'debug override missing for debug ledger commit';
    END IF;
    IF v_avail < 0 THEN
      RAISE EXCEPTION 'credits commit would go negative (debug override)';
    END IF;
  ELSE
    IF v_after_rollback THEN
      -- Credits may have been re-reserved after the rollback; never go negative.
      UPDATE public.credit_accounts
      SET
        available_credits = GREATEST(0, available_credits - v_ledger.amount),
        updated_at = now()
      WHERE user_id = v_uid
      RETURNING available_credits, reserved_credits INTO v_avail, v_reserved;
    ELSE
      UPDATE public.credit_accounts
      SET
        available_credits = available_credits - v_ledger.amount,
        reserved_credits = GREATEST(0, reserved_credits - v_ledger.amount),
        updated_at = now()
      WHERE user_id = v_uid
      RETURNING available_credits, reserved_credits INTO v_avail, v_reserved;
    END IF;

    IF v_avail < 0 THEN
      RAISE EXCEPTION 'credits commit would go negative';
    END IF;
  END IF;

  UPDATE public.credit_ledger
  SET
    status = 'committed',
    committed_at = now(),
    metadata = CASE
      WHEN v_after_rollback THEN COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object('committed_after_rollback', true)
      ELSE metadata
    END
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
    'override_active', v_ledger.environment = 'debug',
    'committed_after_rollback', v_after_rollback
  );
END;
$$;

REVOKE ALL ON FUNCTION public.credits_commit(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credits_commit(uuid, text, uuid) TO authenticated, service_role;

-- A3. Rollback (body identical to 20260723130000 except caller resolution and
-- the 'server:' guard). A client can no longer release a server reservation and
-- re-reserve the same credit while the first request is still in flight.
DROP FUNCTION IF EXISTS public.credits_rollback(uuid, text);
CREATE OR REPLACE FUNCTION public.credits_rollback(
  p_ledger_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_uid uuid;
  v_ledger public.credit_ledger;
  v_bal record;
  v_avail integer;
  v_reserved integer;
BEGIN
  IF v_service THEN
    v_uid := p_user_id;
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not authenticated';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> v_uid THEN
      RAISE EXCEPTION 'user_id mismatch' USING ERRCODE = '42501';
    END IF;
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

  -- Worker-managed reservations ('server:%' reserved by service_role) are
  -- settled by the Worker only; a client cannot release them.
  IF NOT v_service
    AND v_ledger.idempotency_key LIKE 'server:%'
    AND COALESCE(v_ledger.metadata ->> 'service_managed', '') = 'true'
  THEN
    RAISE EXCEPTION 'server_managed_ledger' USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION public.credits_rollback(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credits_rollback(uuid, text, uuid) TO authenticated, service_role;

-- ===========================================================================
-- Section B. remove_trip_member + revoke client DELETE on trip_members
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.remove_trip_member(p_trip_id uuid, p_member_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  v_owner uuid;
  v_removed integer := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_trip_id IS NULL OR p_member_user_id IS NULL THEN
    RAISE EXCEPTION 'member_malformed' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_trip_owner(p_trip_id) THEN
    RAISE EXCEPTION 'not_trip_owner' USING ERRCODE = '42501';
  END IF;

  -- Same lock as create_trip_invite / accept_trip_invite (lock order: advisory first).
  PERFORM pg_advisory_xact_lock(hashtextextended('trip_invite:' || p_trip_id::text, 0));

  SELECT st.user_id INTO v_owner FROM public.saved_trips st WHERE st.id = p_trip_id;
  IF p_member_user_id = uid
    OR p_member_user_id IS NOT DISTINCT FROM v_owner
    OR EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = p_trip_id AND tm.user_id = p_member_user_id AND tm.is_owner
    )
  THEN
    RAISE EXCEPTION 'cannot_remove_owner' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.trip_members tm
  WHERE tm.trip_id = p_trip_id AND tm.user_id = p_member_user_id AND NOT tm.is_owner;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  IF v_removed > 0 THEN
    -- The removed member may hold the reusable link; retire it (never revived).
    -- The owner's next create_trip_invite issues a fresh token.
    UPDATE public.trip_invites ti
    SET revoked_at = now(),
        status = CASE WHEN ti.status = 'pending' THEN 'cancelled' ELSE ti.status END
    WHERE ti.trip_id = p_trip_id AND ti.is_link AND ti.revoked_at IS NULL;

    -- Pending legacy one-time invites addressed to the removed member would let
    -- them rejoin; cancel only those (invites for other people are untouched).
    UPDATE public.trip_invites ti
    SET revoked_at = now(), status = 'cancelled'
    WHERE ti.trip_id = p_trip_id
      AND NOT ti.is_link
      AND ti.status = 'pending'
      AND ti.revoked_at IS NULL
      AND (
        ti.invitee_user_id = p_member_user_id
        OR (
          ti.invitee_email IS NOT NULL
          AND lower(ti.invitee_email) = (
            SELECT lower(u.email) FROM auth.users u WHERE u.id = p_member_user_id
          )
        )
      );
  END IF;

  RETURN v_removed > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.remove_trip_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_trip_member(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "trip_members_delete_owner" ON public.trip_members;
REVOKE DELETE ON public.trip_members FROM anon, authenticated;

-- ===========================================================================
-- Section C. Revoke client UPDATE on trip_members
-- ===========================================================================
DROP POLICY IF EXISTS "trip_members_update_owner" ON public.trip_members;
REVOKE UPDATE ON public.trip_members FROM anon, authenticated;

-- ===========================================================================
-- Section D. Account deletion: hand shared trips to the earliest member
-- ===========================================================================

-- Owner identity stays immutable for clients; trusted roles (SECURITY DEFINER
-- function owner, service_role) may transfer ownership.
CREATE OR REPLACE FUNCTION public.protect_saved_trip_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
    AND current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'saved trip owner is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_saved_trip_owner() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.transfer_owned_shared_trips_for_deletion(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trip_id uuid;
  v_new_owner uuid;
  v_count integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_malformed' USING ERRCODE = '22023';
  END IF;

  FOR v_trip_id IN
    SELECT st.id FROM public.saved_trips st
    WHERE st.user_id = p_user_id
    ORDER BY st.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('trip_invite:' || v_trip_id::text, 0));

    -- Re-check under lock (idempotent on retry / concurrent run).
    PERFORM 1 FROM public.saved_trips st
    WHERE st.id = v_trip_id AND st.user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_new_owner := NULL;
    SELECT tm.user_id INTO v_new_owner
    FROM public.trip_members tm
    WHERE tm.trip_id = v_trip_id
      AND tm.user_id <> p_user_id
      AND tm.status = 'accepted'
    ORDER BY tm.created_at ASC, tm.id ASC
    LIMIT 1;

    -- Solo trip: left as-is; deleteUser's FK cascade removes it.
    IF v_new_owner IS NULL THEN CONTINUE; END IF;

    UPDATE public.trip_members
    SET is_owner = false, updated_at = now()
    WHERE trip_id = v_trip_id AND is_owner AND user_id <> v_new_owner;

    UPDATE public.trip_members
    SET is_owner = true, status = 'accepted', updated_at = now()
    WHERE trip_id = v_trip_id AND user_id = v_new_owner;

    UPDATE public.saved_trips
    SET user_id = v_new_owner
    WHERE id = v_trip_id;

    DELETE FROM public.trip_members
    WHERE trip_id = v_trip_id AND user_id = p_user_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_owned_shared_trips_for_deletion(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_owned_shared_trips_for_deletion(uuid) TO service_role;

-- Account deletion (service-role client) relocates covers of surviving trips
-- out of the deleted user's storage prefix and repoints these columns. RLS
-- bypass does not replace table privileges; grant only the columns used.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT (id, user_id, custom_cover_image_url, cover_image_url, cover_image)
  ON public.saved_trips TO service_role;
GRANT UPDATE (custom_cover_image_url, cover_image_url, cover_image)
  ON public.saved_trips TO service_role;

NOTIFY pgrst, 'reload schema';
