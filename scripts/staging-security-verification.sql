-- STAGING ONLY. Replace every variable with disposable staging fixtures.
-- Run with psql as a DB administrator. All mutations roll back.
\set ON_ERROR_STOP on
\set user_a '00000000-0000-0000-0000-000000000001'
\set user_b '00000000-0000-0000-0000-000000000002'
\set admin_user '00000000-0000-0000-0000-000000000003'
\set trip_a '00000000-0000-0000-0000-000000000010'
\set pending_invite 'REPLACE_PENDING_TOKEN_AT_LEAST_20_CHARS'
\set expired_invite 'REPLACE_EXPIRED_TOKEN_AT_LEAST_20_CHARS'
\set cancelled_invite 'REPLACE_CANCELLED_TOKEN_AT_LEAST_20_CHARS'

BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.assert_true(value boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(value, false) THEN RAISE EXCEPTION 'assertion failed: %', message; END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_denied(statement text, message text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'expected denial: %', message;
EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN raise_exception THEN
    IF SQLERRM LIKE 'expected denial:%' THEN RAISE; END IF;
END $$;

-- Authenticated A: own resolve succeeds; cross-user/admin/profile authority is denied.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'user_a', 'role', 'authenticated')::text, true);
SELECT pg_temp.assert_true(public.resolve_user_plus_entitlement(:'user_a'::uuid) ? 'has_plus', 'A resolves A');
SELECT pg_temp.expect_denied(format('SELECT public.resolve_user_plus_entitlement(%L::uuid)', :'user_b'), 'A resolves B');
SELECT pg_temp.expect_denied(format('SELECT public.admin_grant_plus_entitlement(%L::uuid,%L)', :'user_a', 'admin_grant'), 'A grants Plus');
SELECT pg_temp.expect_denied('SELECT public.admin_revoke_plus_entitlement(gen_random_uuid())', 'A revokes Plus');
SELECT pg_temp.expect_denied(format('UPDATE public.profiles SET plan_tier=%L WHERE id=%L::uuid', 'plus', :'user_a'), 'A edits subscription');

-- Authenticated B: direct membership, invalid invites, owner takeover, private profile and debug credits are denied.
SELECT set_config('request.jwt.claims', json_build_object('sub', :'user_b', 'role', 'authenticated')::text, true);
SELECT pg_temp.expect_denied(format('INSERT INTO public.trip_members(trip_id,user_id,is_owner,status) VALUES (%L::uuid,%L::uuid,false,%L)', :'trip_a', :'user_b', 'accepted'), 'membership without invite');
SELECT pg_temp.expect_denied(format('SELECT public.accept_trip_invite(%L)', :'expired_invite'), 'expired invite');
SELECT pg_temp.expect_denied(format('SELECT public.accept_trip_invite(%L)', :'cancelled_invite'), 'cancelled invite');
SELECT pg_temp.assert_true(public.accept_trip_invite(:'pending_invite') = :'trip_a'::uuid, 'valid invite');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.trip_members WHERE trip_id=:'trip_a'::uuid AND user_id=:'user_b'::uuid), 'membership dedupe');
UPDATE public.saved_trips SET updated_at=now() WHERE id=:'trip_a'::uuid;
SELECT pg_temp.expect_denied(format('UPDATE public.saved_trips SET user_id=%L::uuid WHERE id=%L::uuid', :'user_b', :'trip_a'), 'owner immutable');
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1 FROM jsonb_object_keys(COALESCE((SELECT to_jsonb(p) FROM public.get_trip_member_public_profiles(:'trip_a'::uuid) p LIMIT 1),'{}'::jsonb)) key
  WHERE key NOT IN ('user_id','display_name','avatar_url')), 'public profile fields only');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=:'user_a'::uuid), 'B cannot read A profile');
SELECT pg_temp.expect_denied('SELECT public.credits_debug_reset()', 'debug credit RPC');
SELECT pg_temp.expect_denied(format('SELECT public.credits_release_stale_reservations(%L::uuid, interval %L)', :'user_a', '5 minutes'), 'B cleans A credits');
SELECT public.credits_release_my_stale_reservations();

-- Service role: grant/revoke and global cleanup succeed; active reservations remain active.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'admin_user', 'role', 'service_role')::text, true);
SELECT public.admin_grant_plus_entitlement(:'user_a'::uuid,'admin_grant',NULL,'staging verification',:'admin_user'::uuid);
SELECT pg_temp.assert_true((public.resolve_user_plus_entitlement(:'user_a'::uuid)->>'has_plus')::boolean, 'admin Plus active');
SELECT pg_temp.assert_true(public.resolve_user_plus_entitlement(:'user_a'::uuid)->>'effective_source'='admin_grant', 'admin precedence');
SELECT pg_temp.assert_true(public.credits_release_stale_reservations(:'user_a'::uuid, interval '5 minutes') >= 0, 'global cleanup');
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1 FROM public.credit_ledger WHERE user_id=:'user_a'::uuid AND status='rolled_back'
  AND rolled_back_at >= now()-interval '10 seconds' AND created_at >= now()-interval '5 minutes'), 'active reservation retained');

ROLLBACK;
