-- Trip Workspace V1 phase 3: invite hardening.
--
-- * Long-lived share links (is_link = true): one open link per trip, created
--   only through SECURITY DEFINER RPCs, never consumed by acceptance.
-- * Legacy one-time invites (is_link = false, inserted by older app builds)
--   keep their original expiry and single-use rules. Client INSERT on
--   trip_invites is intentionally kept for older app versions.
-- * Public preview RPC exposes only display-safe fields (no trip_id / email).
-- * get_trip_invite_by_token is no longer callable by clients.
--
-- Error codes raised (RAISE EXCEPTION '<code>'):
--   not_authenticated, invite_malformed, invite_not_found, invite_revoked,
--   invite_invalid, invite_expired, trip_full, not_trip_owner,
--   invite_rate_limited, invite_link_server_only, invite_field_immutable
--
-- Not added to supabase_realtime publication. Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1. Columns and indexes
-- ---------------------------------------------------------------------------
ALTER TABLE public.trip_invites ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.trip_invites ADD COLUMN IF NOT EXISTS is_link boolean NOT NULL DEFAULT false;
ALTER TABLE public.trip_invites ALTER COLUMN expires_at DROP NOT NULL;

COMMENT ON COLUMN public.trip_invites.revoked_at IS
  'Set when the owner disables the invite; a revoked token is never revived.';
COMMENT ON COLUMN public.trip_invites.is_link IS
  'true = long-lived share link created by create_trip_invite (not consumed on accept); false = legacy one-time invite.';

CREATE UNIQUE INDEX IF NOT EXISTS trip_invites_one_open_link_per_trip
  ON public.trip_invites (trip_id)
  WHERE is_link AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS trip_invites_link_created_idx
  ON public.trip_invites (trip_id, created_at)
  WHERE is_link;

-- ---------------------------------------------------------------------------
-- 2. Guard: clients cannot create share links or tamper with link fields.
--    SECURITY DEFINER RPCs run as the function owner and are not affected.
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
  THEN
    RAISE EXCEPTION 'invite_field_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_trip_invite_client_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trip_invites_guard_client_write ON public.trip_invites;
CREATE TRIGGER trip_invites_guard_client_write
  BEFORE INSERT OR UPDATE ON public.trip_invites
  FOR EACH ROW EXECUTE FUNCTION public.guard_trip_invite_client_write();

-- ---------------------------------------------------------------------------
-- 3. create_trip_invite(p_trip_id) -> TABLE(invite_id uuid, invite_token text)
--    Owner only. Returns the open link if one exists, otherwise creates one.
--    New links are limited to 20 per trip per rolling 24 hours.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_trip_invite(uuid);
CREATE FUNCTION public.create_trip_invite(p_trip_id uuid)
RETURNS TABLE (invite_id uuid, invite_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  v_id uuid;
  v_token text;
  v_recent integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_trip_id IS NULL OR NOT public.is_trip_owner(p_trip_id) THEN
    RAISE EXCEPTION 'not_trip_owner' USING ERRCODE = '42501';
  END IF;

  -- Serialize link creation / acceptance per trip.
  PERFORM pg_advisory_xact_lock(hashtextextended('trip_invite:' || p_trip_id::text, 0));

  SELECT ti.id, ti.token INTO v_id, v_token
  FROM public.trip_invites ti
  WHERE ti.trip_id = p_trip_id AND ti.is_link AND ti.revoked_at IS NULL
  LIMIT 1;
  IF FOUND THEN
    invite_id := v_id; invite_token := v_token;
    RETURN NEXT;
    RETURN;
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

-- ---------------------------------------------------------------------------
-- 4. set_trip_invite_link_enabled(p_trip_id, p_enabled)
--    -> TABLE(enabled boolean, invite_id uuid, invite_token text)
--    false: revoke the open link (row returned with NULL id/token).
--    true : return the open link or create a new token (revoked tokens are
--           never revived; subject to the same daily limit).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_trip_invite_link_enabled(uuid, boolean);
CREATE FUNCTION public.set_trip_invite_link_enabled(p_trip_id uuid, p_enabled boolean)
RETURNS TABLE (enabled boolean, invite_id uuid, invite_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  v_id uuid;
  v_token text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_trip_id IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'invite_malformed' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_trip_owner(p_trip_id) THEN
    RAISE EXCEPTION 'not_trip_owner' USING ERRCODE = '42501';
  END IF;

  IF NOT p_enabled THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('trip_invite:' || p_trip_id::text, 0));
    UPDATE public.trip_invites ti
    SET revoked_at = now(), status = 'cancelled'
    WHERE ti.trip_id = p_trip_id AND ti.is_link AND ti.revoked_at IS NULL;
    enabled := false; invite_id := NULL; invite_token := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT c.invite_id, c.invite_token INTO v_id, v_token
  FROM public.create_trip_invite(p_trip_id) c;
  enabled := true; invite_id := v_id; invite_token := v_token;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.set_trip_invite_link_enabled(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_trip_invite_link_enabled(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. get_trip_invite_preview(invite_token)
--    Always returns exactly one row.
--    state: valid | full | revoked | expired | invalid
--    Trip details are filled only for valid / full; other states return NULLs.
--    Never returns trip_id, token, inviter id, or any email.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_trip_invite_preview(text);
CREATE FUNCTION public.get_trip_invite_preview(invite_token text)
RETURNS TABLE (
  state text,
  trip_title text,
  date_start text,
  date_end text,
  cover_url text,
  inviter_display_name text,
  member_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv public.trip_invites%ROWTYPE;
  t public.saved_trips%ROWTYPE;
  v_members integer;
  v_settings jsonb;
BEGIN
  state := 'invalid';
  IF invite_token IS NULL OR length(invite_token) < 20 OR length(invite_token) > 256
    OR invite_token !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO inv FROM public.trip_invites ti WHERE ti.token = invite_token LIMIT 1;
  IF NOT FOUND THEN RETURN NEXT; RETURN; END IF;

  SELECT * INTO t FROM public.saved_trips st WHERE st.id = inv.trip_id;
  IF NOT FOUND THEN RETURN NEXT; RETURN; END IF;

  IF inv.revoked_at IS NOT NULL OR inv.status = 'cancelled' THEN
    state := 'revoked'; RETURN NEXT; RETURN;
  END IF;
  IF inv.status <> 'pending'
    OR (inv.expires_at IS NOT NULL AND inv.expires_at <= now()) THEN
    state := 'expired'; RETURN NEXT; RETURN;
  END IF;

  SELECT count(*)::integer INTO v_members
  FROM public.trip_members tm
  WHERE tm.trip_id = inv.trip_id AND tm.status = 'accepted';

  state := CASE WHEN v_members >= 20 THEN 'full' ELSE 'valid' END;
  trip_title := COALESCE(
    CASE WHEN t.is_title_customized THEN NULLIF(btrim(t.custom_title), '') END,
    NULLIF(btrim(t.title), '')
  );
  v_settings := COALESCE(t.payload -> 'tripSettings', t.trip_data -> 'tripSettings');
  date_start := NULLIF(btrim(v_settings ->> 'tripStartDate'), '');
  date_end := COALESCE(NULLIF(btrim(v_settings ->> 'tripEndDate'), ''), date_start);
  cover_url := COALESCE(
    CASE WHEN t.is_cover_customized
      THEN COALESCE(NULLIF(btrim(t.custom_cover_image_url), ''), NULLIF(btrim(t.cover_image_url), ''))
    END,
    NULLIF(btrim(t.cover_image), '')
  );
  SELECT NULLIF(btrim(p.display_name), '') INTO inviter_display_name
  FROM public.profiles p WHERE p.id = inv.inviter_id;
  member_count := v_members;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.get_trip_invite_preview(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trip_invite_preview(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. accept_trip_invite(invite_token) -> uuid (signature unchanged)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_trip_invite(invite_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  inv public.trip_invites%ROWTYPE;
  uid uuid := auth.uid();
  v_trip_id uuid;
  v_members integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF invite_token IS NULL OR length(invite_token) < 20 OR length(invite_token) > 256
    OR invite_token !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'invite_malformed' USING ERRCODE = '22023';
  END IF;

  SELECT ti.trip_id INTO v_trip_id FROM public.trip_invites ti WHERE ti.token = invite_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002'; END IF;

  -- Lock order (advisory, then invite row) matches create/set_* to avoid deadlocks.
  PERFORM pg_advisory_xact_lock(hashtextextended('trip_invite:' || v_trip_id::text, 0));
  SELECT * INTO inv FROM public.trip_invites
  WHERE token = invite_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002'; END IF;

  -- Already an accepted member: idempotent success.
  IF EXISTS (
    SELECT 1 FROM public.trip_members tm
    WHERE tm.trip_id = inv.trip_id AND tm.user_id = uid AND tm.status = 'accepted'
  ) THEN
    RETURN inv.trip_id;
  END IF;

  IF inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_revoked' USING ERRCODE = '42501';
  END IF;
  IF inv.status <> 'pending' THEN RAISE EXCEPTION 'invite_invalid' USING ERRCODE = '42501'; END IF;
  IF inv.expires_at IS NOT NULL AND inv.expires_at <= now() THEN
    UPDATE public.trip_invites SET status = 'expired' WHERE id = inv.id;
    RAISE EXCEPTION 'invite_expired' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO v_members
  FROM public.trip_members tm
  WHERE tm.trip_id = inv.trip_id AND tm.status = 'accepted';
  IF v_members >= 20 THEN
    RAISE EXCEPTION 'trip_full' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.trip_members (trip_id, user_id, is_owner, status, invited_by)
  VALUES (inv.trip_id, uid, false, 'accepted', inv.inviter_id)
  ON CONFLICT (trip_id, user_id) DO UPDATE
    SET status = 'accepted', invited_by = EXCLUDED.invited_by, updated_at = now();

  -- Legacy one-time invites are consumed; long-lived links are not, and never
  -- record an invitee (so account deletion of one acceptor cannot drop the link).
  IF NOT inv.is_link THEN
    UPDATE public.trip_invites SET status = 'accepted', invitee_user_id = uid WHERE id = inv.id;
  END IF;
  RETURN inv.trip_id;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_trip_invite(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_trip_invite(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Retire get_trip_invite_by_token for clients (returned full row incl. email).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.get_trip_invite_by_token(text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_trip_invite_by_token(text) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
