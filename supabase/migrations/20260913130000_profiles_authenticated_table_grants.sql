-- Make the profiles client ACL explicit so fresh/preview databases do not
-- depend on owner-specific default privileges. RLS remains the row authority.

GRANT USAGE ON SCHEMA public TO authenticated;

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
REVOKE DELETE ON TABLE public.profiles FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;

-- Trusted backend operations, including subscription synchronization and
-- account deletion, continue to use the service role.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;

NOTIFY pgrst, 'reload schema';
