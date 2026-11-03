-- Trip Workspace V1 phase 3 follow-up: share-link guard.
--
-- * Clients (anon / authenticated) can no longer change status or expires_at
--   on long-lived share links (is_link = true). Revoking via revoked_at is
--   still allowed (one-way, as before); SECURITY DEFINER RPCs are unaffected.
-- * create_trip_invite treats a link as open only when
--     revoked_at IS NULL AND status = 'pending'
--     AND (expires_at IS NULL OR expires_at > now()).
--   A stale unrevoked link is revoked first, then a new link is created
--   (keeps the one-open-link unique index valid).
--   Signature, grants and the 20-per-24h limit are unchanged.
--
-- Error codes raised: same as 20261102100000 (invite_field_immutable now also
-- covers status / expires_at on share links).
--
-- Not added to supabase_realtime publication. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Guard trigger function (trigger itself is unchanged)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_trip_invite_client_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_link OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'invite_link_server_only' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.is_link IS DISTINCT FROM OLD.is_link
    OR NEW.token IS DISTINCT FROM OLD.token
    OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (OLD.is_link AND (
          NEW.status IS DISTINCT FROM OLD.status
          OR NEW.expires_at IS DISTINCT FROM OLD.expires_at))
  THEN
    RAISE EXCEPTION 'invite_field_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_trip_invite_client_write() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. create_trip_invite(p_trip_id) -> TABLE(invite_id uuid, invite_token text)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_trip_invite(p_trip_id uuid)
RETURNS TABLE (invite_id uuid, invite_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  v_id uuid;
  v_token text;
  v_status text;
  v_expires timestamptz;
  v_recent integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_trip_id IS NULL OR NOT public.is_trip_owner(p_trip_id) THEN
    RAISE EXCEPTION 'not_trip_owner' USING ERRCODE = '42501';
  END IF;

  -- Serialize link creation / acceptance per trip.
  PERFORM pg_advisory_xact_lock(hashtextextended('trip_invite:' || p_trip_id::text, 0));

  SELECT ti.id, ti.token, ti.status, ti.expires_at INTO v_id, v_token, v_status, v_expires
  FROM public.trip_invites ti
  WHERE ti.trip_id = p_trip_id AND ti.is_link AND ti.revoked_at IS NULL
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    IF v_status = 'pending' AND (v_expires IS NULL OR v_expires > now()) THEN
      invite_id := v_id; invite_token := v_token;
      RETURN NEXT;
      RETURN;
    END IF;
    -- Stale link (cancelled / expired / past expiry): retire it, never revive.
    UPDATE public.trip_invites ti
    SET revoked_at = now(),
        status = CASE WHEN ti.status = 'pending' THEN 'cancelled' ELSE ti.status END
    WHERE ti.id = v_id;
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.trip_invites ti
  WHERE ti.trip_id = p_trip_id AND ti.is_link
    AND ti.created_at > now() - interval '24 hours';
  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'invite_rate_limited' USING ERRCODE = '54000';
  END IF;

  -- 32 random bytes -> 43-char base64url (no padding).
  v_token := translate(encode(gen_random_bytes(32), 'base64'), E'+/=\n', '-_');

  INSERT INTO public.trip_invites (trip_id, inviter_id, token, status, expires_at, is_link)
  VALUES (p_trip_id, uid, v_token, 'pending', NULL, true)
  RETURNING id INTO v_id;

  invite_id := v_id; invite_token := v_token;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.create_trip_invite(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_trip_invite(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
