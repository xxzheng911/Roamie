-- Pre-release security remediation: collaboration, profile privacy, and credits.

-- Membership is invite-authoritative. Owner membership is created only by the
-- trusted saved_trips trigger; clients never insert membership rows directly.
DROP POLICY IF EXISTS "trip_members_insert_owner" ON public.trip_members;
REVOKE INSERT ON public.trip_members FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_trip_invite(invite_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  inv public.trip_invites%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF invite_token IS NULL OR length(invite_token) < 20 OR length(invite_token) > 256
    OR invite_token !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'invite_malformed' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO inv FROM public.trip_invites
  WHERE token = invite_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002'; END IF;
  IF inv.status <> 'pending' THEN RAISE EXCEPTION 'invite_invalid' USING ERRCODE = '42501'; END IF;
  IF inv.expires_at IS NOT NULL AND inv.expires_at <= now() THEN
    UPDATE public.trip_invites SET status = 'expired' WHERE id = inv.id;
    RAISE EXCEPTION 'invite_expired' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.trip_members (trip_id, user_id, is_owner, status, invited_by)
  VALUES (inv.trip_id, uid, false, 'accepted', inv.inviter_id)
  ON CONFLICT (trip_id, user_id) DO UPDATE
    SET status = 'accepted', invited_by = EXCLUDED.invited_by, updated_at = now();
  UPDATE public.trip_invites SET status = 'accepted', invitee_user_id = uid WHERE id = inv.id;
  RETURN inv.trip_id;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_trip_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_trip_invite(text) TO authenticated;

-- The owner identity is immutable through ordinary row updates.
CREATE OR REPLACE FUNCTION public.protect_saved_trip_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'saved trip owner is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS saved_trips_protect_owner ON public.saved_trips;
CREATE TRIGGER saved_trips_protect_owner BEFORE UPDATE ON public.saved_trips
FOR EACH ROW EXECUTE FUNCTION public.protect_saved_trip_owner();

-- Collaborators use the minimal public-profile RPC. Direct co-member profile
-- reads exposed every profile column and are intentionally removed.
DROP POLICY IF EXISTS "profiles trip co-member select" ON public.profiles;
DROP FUNCTION IF EXISTS public.get_trip_member_public_profiles(uuid);
CREATE OR REPLACE FUNCTION public.get_trip_member_public_profiles(p_trip_id uuid)
RETURNS TABLE (user_id uuid, display_name text, avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name, p.avatar_url
  FROM public.profiles p
  JOIN public.trip_members tm ON tm.user_id = p.id
  WHERE tm.trip_id = p_trip_id AND tm.status = 'accepted'
    AND (public.is_trip_accepted_member(p_trip_id) OR public.is_trip_owner(p_trip_id));
$$;
REVOKE ALL ON FUNCTION public.get_trip_member_public_profiles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trip_member_public_profiles(uuid) TO authenticated;

-- Debug credits must never be client-authoritative in production.
REVOKE ALL ON FUNCTION public.credits_debug_set(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credits_debug_reset() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credits_debug_deduct(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credits_debug_clear_override() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credits_debug_set(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.credits_debug_reset() TO service_role;
GRANT EXECUTE ON FUNCTION public.credits_debug_deduct(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.credits_debug_clear_override() TO service_role;

-- Client cleanup is self-scoped and uses a fixed safe age. Global cleanup is a
-- separate service-only operation.
CREATE OR REPLACE FUNCTION public.credits_release_my_stale_reservations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  RETURN public.credits_release_stale_reservations(auth.uid(), interval '5 minutes');
END;
$$;
REVOKE ALL ON FUNCTION public.credits_release_my_stale_reservations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credits_release_my_stale_reservations() TO authenticated;
REVOKE ALL ON FUNCTION public.credits_release_stale_reservations(uuid, interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credits_release_stale_reservations(uuid, interval) TO service_role;
REVOKE ALL ON FUNCTION public.credits_effective_balance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credits_ensure_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credits_effective_balance(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.credits_ensure_account(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.credits_release_stale_reservations(
  p_user_id uuid DEFAULT NULL,
  p_max_age interval DEFAULT interval '5 minutes'
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_row public.credit_ledger; v_count integer := 0;
BEGIN
  -- EXECUTE is service-role-only. Keeping authorization in grants also permits
  -- trusted SECURITY DEFINER credit functions owned by the same role to call it.
  IF p_max_age < interval '1 minute' OR p_max_age > interval '30 days' THEN
    RAISE EXCEPTION 'invalid stale reservation age' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN SELECT * FROM public.credit_ledger
    WHERE status = 'reserved' AND created_at < now() - p_max_age
      AND (p_user_id IS NULL OR user_id = p_user_id) FOR UPDATE
  LOOP
    IF v_row.environment = 'debug' THEN
      UPDATE public.credit_debug_overrides SET reserved_credits = GREATEST(0, reserved_credits-v_row.amount), updated_at=now() WHERE user_id=v_row.user_id;
    ELSE
      UPDATE public.credit_accounts SET reserved_credits = GREATEST(0, reserved_credits-v_row.amount), updated_at=now() WHERE user_id=v_row.user_id;
    END IF;
    UPDATE public.credit_ledger SET status='rolled_back', rolled_back_at=now(),
      metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('stale_auto_rollback',true)
      WHERE id=v_row.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.credits_release_stale_reservations(uuid, interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credits_release_stale_reservations(uuid, interval) TO service_role;

NOTIFY pgrst, 'reload schema';
