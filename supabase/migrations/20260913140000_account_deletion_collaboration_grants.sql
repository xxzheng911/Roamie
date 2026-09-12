-- Account deletion uses a trusted service-role client to remove invitations
-- addressed to the authenticated user before auth.users is deleted. RLS bypass
-- does not replace the underlying table privileges required by PostgREST.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, DELETE ON TABLE public.trip_invites TO service_role;

NOTIFY pgrst, 'reload schema';
