-- Ensure trip collaboration tables exist (idempotent; fixes PostgREST schema cache)
-- trip_id → public.saved_trips(id) (app stores itineraries in saved_trips.payload)

-- ---------------------------------------------------------------------------
-- trip_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trip_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.saved_trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_owner boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS trip_members_user_id_idx ON public.trip_members(user_id);
CREATE INDEX IF NOT EXISTS trip_members_trip_id_idx ON public.trip_members(trip_id);

-- ---------------------------------------------------------------------------
-- trip_invites
-- token = invite_token, inviter_id = created_by
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trip_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.saved_trips(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invitee_email text,
  invitee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.trip_invites.token IS 'invite_token — unique share token for roamie://trip-invite/{token}';
COMMENT ON COLUMN public.trip_invites.inviter_id IS 'created_by — user who created this invite';

CREATE INDEX IF NOT EXISTS trip_invites_trip_id_idx ON public.trip_invites(trip_id);
CREATE INDEX IF NOT EXISTS trip_invites_token_idx ON public.trip_invites(token);

ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_invites ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_trip_accepted_member(trip_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trip_members m
    WHERE m.trip_id = trip_uuid
      AND m.user_id = auth.uid()
      AND m.status = 'accepted'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_trip_owner(trip_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trip_members m
    WHERE m.trip_id = trip_uuid
      AND m.user_id = auth.uid()
      AND m.is_owner = true
      AND m.status = 'accepted'
  )
  OR EXISTS (
    SELECT 1
    FROM public.saved_trips t
    WHERE t.id = trip_uuid
      AND t.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_saved_trip_owner(trip_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_trip_owner(trip_uuid);
$$;

-- Owner row on new saved trip
CREATE OR REPLACE FUNCTION public.ensure_trip_owner_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.trip_members (trip_id, user_id, is_owner, status, invited_by)
  VALUES (NEW.id, NEW.user_id, true, 'accepted', NEW.user_id)
  ON CONFLICT (trip_id, user_id) DO UPDATE
    SET is_owner = true, status = 'accepted', updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS saved_trips_owner_member ON public.saved_trips;
CREATE TRIGGER saved_trips_owner_member
  AFTER INSERT ON public.saved_trips
  FOR EACH ROW EXECUTE FUNCTION public.ensure_trip_owner_member();

INSERT INTO public.trip_members (trip_id, user_id, is_owner, status, invited_by)
SELECT id, user_id, true, 'accepted', user_id
FROM public.saved_trips
ON CONFLICT (trip_id, user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Accept invite (RPC) — invitee reads invite by token via SECURITY DEFINER
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_trip_invite(invite_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.trip_invites%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO inv
  FROM public.trip_invites
  WHERE token = invite_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF inv.status = 'cancelled' OR inv.status = 'expired' THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  IF inv.expires_at IS NOT NULL AND inv.expires_at < now() AND inv.status = 'pending' THEN
    UPDATE public.trip_invites SET status = 'expired' WHERE id = inv.id;
    RAISE EXCEPTION 'invite_expired';
  END IF;

  INSERT INTO public.trip_members (trip_id, user_id, is_owner, status, invited_by)
  VALUES (inv.trip_id, uid, false, 'accepted', inv.inviter_id)
  ON CONFLICT (trip_id, user_id) DO UPDATE
    SET status = 'accepted', updated_at = now();

  UPDATE public.trip_invites
  SET status = 'accepted', invitee_user_id = uid
  WHERE id = inv.id;

  RETURN inv.trip_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_trip_invite(text) TO authenticated;

-- Read invite by token (authenticated users holding the token)
CREATE OR REPLACE FUNCTION public.get_trip_invite_by_token(invite_token text)
RETURNS public.trip_invites
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.trip_invites
  WHERE token = invite_token
    AND auth.uid() IS NOT NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_trip_invite_by_token(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS: saved_trips shared access (idempotent)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "saved_trips_select_own" ON public.saved_trips;
DROP POLICY IF EXISTS "saved_trips_update_own" ON public.saved_trips;
DROP POLICY IF EXISTS "saved_trips_delete_own" ON public.saved_trips;

DROP POLICY IF EXISTS "saved_trips_select_member" ON public.saved_trips;
CREATE POLICY "saved_trips_select_member" ON public.saved_trips
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_trip_accepted_member(id));

DROP POLICY IF EXISTS "saved_trips_update_member" ON public.saved_trips;
CREATE POLICY "saved_trips_update_member" ON public.saved_trips
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.is_trip_accepted_member(id))
  WITH CHECK (auth.uid() = user_id OR public.is_trip_accepted_member(id));

DROP POLICY IF EXISTS "saved_trips_delete_owner" ON public.saved_trips;
CREATE POLICY "saved_trips_delete_owner" ON public.saved_trips
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.is_trip_owner(id));

-- ---------------------------------------------------------------------------
-- RLS: trip_members
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "trip_members_select" ON public.trip_members;
CREATE POLICY "trip_members_select" ON public.trip_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_trip_accepted_member(trip_id)
    OR public.is_trip_owner(trip_id)
  );

DROP POLICY IF EXISTS "trip_members_insert_owner" ON public.trip_members;
CREATE POLICY "trip_members_insert_owner" ON public.trip_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_trip_owner(trip_id) OR (user_id = auth.uid() AND is_owner = false)
  );

DROP POLICY IF EXISTS "trip_members_delete_owner" ON public.trip_members;
CREATE POLICY "trip_members_delete_owner" ON public.trip_members
  FOR DELETE TO authenticated
  USING (
    (public.is_trip_owner(trip_id) AND NOT is_owner)
    OR (user_id = auth.uid() AND NOT is_owner)
  );

DROP POLICY IF EXISTS "trip_members_update_owner" ON public.trip_members;
CREATE POLICY "trip_members_update_owner" ON public.trip_members
  FOR UPDATE TO authenticated
  USING (public.is_trip_owner(trip_id))
  WITH CHECK (public.is_trip_owner(trip_id));

-- ---------------------------------------------------------------------------
-- RLS: trip_invites
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "trip_invites_select" ON public.trip_invites;
DROP POLICY IF EXISTS "trip_invites_select_inviter" ON public.trip_invites;
CREATE POLICY "trip_invites_select_inviter" ON public.trip_invites
  FOR SELECT TO authenticated
  USING (
    inviter_id = auth.uid()
    OR public.is_trip_owner(trip_id)
    OR invitee_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "trip_invites_insert_owner" ON public.trip_invites;
DROP POLICY IF EXISTS "trip_invites_insert_own_trip" ON public.trip_invites;
CREATE POLICY "trip_invites_insert_own_trip" ON public.trip_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    inviter_id = auth.uid()
    AND public.is_trip_owner(trip_id)
  );

DROP POLICY IF EXISTS "trip_invites_update_owner" ON public.trip_invites;
CREATE POLICY "trip_invites_update_owner" ON public.trip_invites
  FOR UPDATE TO authenticated
  USING (public.is_trip_owner(trip_id) OR inviter_id = auth.uid())
  WITH CHECK (public.is_trip_owner(trip_id) OR inviter_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trip_invites TO authenticated;

NOTIFY pgrst, 'reload schema';
