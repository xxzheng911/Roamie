-- Allow trip co-members to read each other's public profile fields (display name, avatar).

CREATE OR REPLACE FUNCTION public.get_trip_member_public_profiles(p_trip_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  email text,
  full_name text,
  username text,
  profile_updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS user_id,
    p.display_name,
    p.avatar_url,
    u.email::text,
    COALESCE(
      NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''),
      NULLIF(trim(u.raw_user_meta_data->>'name'), '')
    ) AS full_name,
    COALESCE(
      NULLIF(trim(u.raw_user_meta_data->>'user_name'), ''),
      NULLIF(trim(u.raw_user_meta_data->>'username'), ''),
      NULLIF(trim(u.raw_user_meta_data->>'preferred_username'), '')
    ) AS username,
    p.updated_at AS profile_updated_at
  FROM public.profiles p
  INNER JOIN public.trip_members tm ON tm.user_id = p.id
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE tm.trip_id = p_trip_id
    AND tm.status = 'accepted'
    AND public.is_trip_accepted_member(p_trip_id);
$$;

GRANT EXECUTE ON FUNCTION public.get_trip_member_public_profiles(uuid) TO authenticated;

-- Realtime: member list updates when collaborators join or leave
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_members;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
