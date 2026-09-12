-- ROAMIE STAGING DYNAMIC SECURITY VERIFICATION -- STAGING PREVIEW BRANCH ONLY
-- Execute as one complete batch. Every fixture mutation is rolled back.
-- Requires migration 20260913130000_profiles_authenticated_table_grants.

BEGIN;

CREATE TEMP TABLE security_test_context (
  user_a uuid NOT NULL, user_b uuid NOT NULL, trip_a uuid NOT NULL,
  pending_invite_1 text NOT NULL, pending_invite_2 text NOT NULL,
  expired_invite text NOT NULL, cancelled_invite text NOT NULL,
  active_ledger uuid NOT NULL, stale_ledger uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO security_test_context SELECT
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  'stg_' || replace(gen_random_uuid()::text, '-', ''),
  'stg_' || replace(gen_random_uuid()::text, '-', ''),
  'stg_' || replace(gen_random_uuid()::text, '-', ''),
  'stg_' || replace(gen_random_uuid()::text, '-', ''),
  gen_random_uuid(), gen_random_uuid();

CREATE TEMP TABLE security_test_results (
  test_name text PRIMARY KEY, passed boolean NOT NULL DEFAULT true
) ON COMMIT DROP;

GRANT SELECT ON TABLE pg_temp.security_test_context TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE pg_temp.security_test_results TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_value boolean, p_test_name text
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF NOT COALESCE(p_value, false) THEN
    RAISE EXCEPTION 'assertion failed: %', p_test_name;
  END IF;
  INSERT INTO pg_temp.security_test_results(test_name) VALUES (p_test_name)
  ON CONFLICT (test_name) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_sqlstate(
  p_statement text, p_expected_state text, p_test_name text
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE actual_state text; actual_message text;
BEGIN
  BEGIN
    EXECUTE p_statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      actual_state = RETURNED_SQLSTATE, actual_message = MESSAGE_TEXT;
    IF actual_state = p_expected_state THEN
      INSERT INTO pg_temp.security_test_results(test_name) VALUES (p_test_name)
      ON CONFLICT (test_name) DO NOTHING;
      RETURN;
    END IF;
    RAISE EXCEPTION 'test "%" expected SQLSTATE %, got %: %',
      p_test_name, p_expected_state, actual_state, actual_message;
  END;
  RAISE EXCEPTION 'test "%" expected SQLSTATE %, but statement succeeded',
    p_test_name, p_expected_state;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_denied_or_zero_rows(
  p_statement text, p_test_name text
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_row_count bigint;
  v_sqlstate text;
BEGIN
  BEGIN
    EXECUTE p_statement;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 0 THEN
      RAISE EXCEPTION 'test "%" unexpectedly changed % row(s)',
        p_test_name, v_row_count;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '42501' THEN
      RAISE;
    END IF;
  END;

  INSERT INTO pg_temp.security_test_results(test_name) VALUES (p_test_name)
  ON CONFLICT (test_name) DO NOTHING;
END;
$$;

-- Transaction-local Auth users. The auth trigger creates their profiles.
INSERT INTO auth.users (id, email, raw_app_meta_data)
SELECT user_a, 'security-a-' || replace(user_a::text, '-', '') || '@example.invalid',
  '{"provider":"google"}'::jsonb
FROM pg_temp.security_test_context
UNION ALL
SELECT user_b, 'security-b-' || replace(user_b::text, '-', '') || '@example.invalid',
  '{"provider":"apple"}'::jsonb
FROM pg_temp.security_test_context;

SELECT pg_temp.assert_true((
  SELECT count(*) = 2
  FROM public.profiles
  WHERE id IN (
    SELECT user_a FROM pg_temp.security_test_context
    UNION ALL SELECT user_b FROM pg_temp.security_test_context
  )
), 'Google and Apple signup trigger bootstraps profiles');

SELECT pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT')
  AND has_table_privilege('authenticated', 'public.profiles', 'INSERT')
  AND has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'authenticated profile table privileges are least privilege'
);

-- Defensive profiles in case the auth trigger is disabled.
INSERT INTO public.profiles (id, display_name)
SELECT user_a, 'Security Test A' FROM pg_temp.security_test_context
UNION ALL
SELECT user_b, 'Security Test B' FROM pg_temp.security_test_context
ON CONFLICT (id) DO NOTHING;

UPDATE public.profiles SET
  plan_tier = 'free', subscription_status = 'inactive',
  subscription_provider = 'none', plus_available = false
WHERE id IN (
  SELECT user_a FROM pg_temp.security_test_context
  UNION ALL SELECT user_b FROM pg_temp.security_test_context
);

DELETE FROM public.user_plus_entitlements WHERE user_id IN (
  SELECT user_a FROM pg_temp.security_test_context
  UNION ALL SELECT user_b FROM pg_temp.security_test_context
);

-- Trip and invite fixtures.
INSERT INTO public.saved_trips (id, user_id, title, payload)
SELECT trip_a, user_a, '__staging_security_verification__', '{}'::jsonb
FROM pg_temp.security_test_context;

INSERT INTO public.trip_invites
  (trip_id, inviter_id, invitee_email, token, status, expires_at)
SELECT trip_a, user_a, 'security-verification@example.invalid',
  pending_invite_1, 'pending', now() + interval '1 day'
FROM pg_temp.security_test_context
UNION ALL
SELECT trip_a, user_a, 'security-verification@example.invalid',
  pending_invite_2, 'pending', now() + interval '1 day'
FROM pg_temp.security_test_context
UNION ALL
SELECT trip_a, user_a, 'security-verification@example.invalid',
  expired_invite, 'pending', now() - interval '1 day'
FROM pg_temp.security_test_context
UNION ALL
SELECT trip_a, user_a, 'security-verification@example.invalid',
  cancelled_invite, 'cancelled', now() + interval '1 day'
FROM pg_temp.security_test_context;

-- Credit fixtures: A has one active reservation; B has one stale reservation.
SELECT set_config('request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text, true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;

DO $$
DECLARE a uuid; b uuid;
BEGIN
  SELECT user_a, user_b INTO a, b FROM pg_temp.security_test_context;
  PERFORM public.credits_ensure_account(a);
  PERFORM public.credits_ensure_account(b);
END;
$$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

INSERT INTO public.credit_ledger
  (id, user_id, feature_type, amount, status, request_id,
   idempotency_key, metadata, environment, created_at)
SELECT active_ledger, user_a, 'PLACE_RECOMMENDATION', 1, 'reserved',
  '__staging_security_active__',
  '__staging_security_active_' || active_ledger::text,
  '{}'::jsonb, 'production', now()
FROM pg_temp.security_test_context
UNION ALL
SELECT stale_ledger, user_b, 'PLACE_RECOMMENDATION', 1, 'reserved',
  '__staging_security_stale__',
  '__staging_security_stale_' || stale_ledger::text,
  '{}'::jsonb, 'production', now() - interval '10 minutes'
FROM pg_temp.security_test_context;

UPDATE public.credit_accounts AS account
SET reserved_credits = account.reserved_credits + 1
WHERE account.user_id IN (
  SELECT user_a FROM pg_temp.security_test_context
  UNION ALL SELECT user_b FROM pg_temp.security_test_context
);

-- ANON
SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE anon;

SELECT pg_temp.expect_sqlstate(
  format('SELECT public.resolve_user_plus_entitlement(%L::uuid)',
    (SELECT user_a::text FROM pg_temp.security_test_context)),
  '42501', 'anon cannot resolve entitlement'
);
SELECT pg_temp.expect_denied_or_zero_rows(
  format('UPDATE public.profiles SET display_name=%L WHERE id=%L::uuid',
    '__anon_profile_update_must_not_persist__',
    (SELECT user_a::text FROM pg_temp.security_test_context)),
  'anon cannot update profile'
);
RESET ROLE;

-- AUTHENTICATED USER A
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', (SELECT user_a FROM pg_temp.security_test_context),
  'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub',
  (SELECT user_a::text FROM pg_temp.security_test_context), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT pg_temp.assert_true(
  public.resolve_user_plus_entitlement(
    (SELECT user_a FROM pg_temp.security_test_context)) ? 'has_plus',
  'A resolves own entitlement'
);
SELECT pg_temp.expect_sqlstate(
  format('SELECT public.resolve_user_plus_entitlement(%L::uuid)',
    (SELECT user_b::text FROM pg_temp.security_test_context)),
  '42501', 'A cannot resolve B entitlement'
);
SELECT pg_temp.expect_sqlstate(
  format('SELECT public.admin_grant_plus_entitlement(%L::uuid, %L)',
    (SELECT user_a::text FROM pg_temp.security_test_context), 'admin_grant'),
  '42501', 'authenticated cannot grant Plus'
);
SELECT pg_temp.expect_sqlstate(
  'SELECT public.admin_revoke_plus_entitlement(gen_random_uuid())',
  '42501', 'authenticated cannot revoke Plus'
);
SELECT pg_temp.expect_sqlstate(
  format('UPDATE public.profiles SET plan_tier = %L WHERE id = %L::uuid',
    'plus', (SELECT user_a::text FROM pg_temp.security_test_context)),
  '42501', 'authenticated cannot modify protected subscription columns'
);
UPDATE public.profiles
SET display_name = 'Security Test A Normal Update'
WHERE id = (SELECT user_a FROM pg_temp.security_test_context);
SELECT pg_temp.assert_true((
  SELECT display_name = 'Security Test A Normal Update'
  FROM public.profiles
  WHERE id = (SELECT user_a FROM pg_temp.security_test_context)
), 'authenticated can update normal profile fields');
SELECT pg_temp.assert_true(
  public.credits_release_my_stale_reservations() = 0,
  'self cleanup does not remove active reservation'
);
RESET ROLE;

-- AUTHENTICATED USER B
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', (SELECT user_b FROM pg_temp.security_test_context),
  'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub',
  (SELECT user_b::text FROM pg_temp.security_test_context), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_sqlstate(
  format('INSERT INTO public.trip_members
    (trip_id,user_id,is_owner,status) VALUES (%L::uuid,%L::uuid,false,%L)',
    (SELECT trip_a::text FROM pg_temp.security_test_context),
    (SELECT user_b::text FROM pg_temp.security_test_context), 'accepted'),
  '42501', 'B cannot self-enroll without invite'
);
SELECT pg_temp.expect_sqlstate(
  format('SELECT public.accept_trip_invite(%L)',
    (SELECT expired_invite FROM pg_temp.security_test_context)),
  '42501', 'expired invite is rejected'
);
SELECT pg_temp.expect_sqlstate(
  format('SELECT public.accept_trip_invite(%L)',
    (SELECT cancelled_invite FROM pg_temp.security_test_context)),
  '42501', 'cancelled invite is rejected'
);
SELECT pg_temp.assert_true(
  public.accept_trip_invite(
    (SELECT pending_invite_1 FROM pg_temp.security_test_context)) =
    (SELECT trip_a FROM pg_temp.security_test_context),
  'valid invite is accepted'
);
SELECT pg_temp.assert_true(
  public.accept_trip_invite(
    (SELECT pending_invite_2 FROM pg_temp.security_test_context)) =
    (SELECT trip_a FROM pg_temp.security_test_context),
  'second valid invite is accepted idempotently'
);
SELECT pg_temp.assert_true((
  SELECT count(*) = 1 FROM public.trip_members
  WHERE trip_id = (SELECT trip_a FROM pg_temp.security_test_context)
    AND user_id = (SELECT user_b FROM pg_temp.security_test_context)
), 'membership is deduplicated');

UPDATE public.saved_trips
SET description = '__staging_collaborator_update__'
WHERE id = (SELECT trip_a FROM pg_temp.security_test_context);

SELECT pg_temp.assert_true((
  SELECT description = '__staging_collaborator_update__'
  FROM public.saved_trips
  WHERE id = (SELECT trip_a FROM pg_temp.security_test_context)
), 'collaborator can update permitted trip content');

SELECT pg_temp.expect_sqlstate(
  format('UPDATE public.saved_trips SET user_id=%L::uuid WHERE id=%L::uuid',
    (SELECT user_b::text FROM pg_temp.security_test_context),
    (SELECT trip_a::text FROM pg_temp.security_test_context)),
  '42501', 'saved trip owner is immutable'
);
SELECT pg_temp.assert_true((
  SELECT count(*) = 2 FROM public.get_trip_member_public_profiles(
    (SELECT trip_a FROM pg_temp.security_test_context))
), 'collaborator public profile RPC returns accepted members');
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1 FROM public.get_trip_member_public_profiles(
    (SELECT trip_a FROM pg_temp.security_test_context)) AS profile
  CROSS JOIN LATERAL jsonb_object_keys(to_jsonb(profile)) AS key
  WHERE key NOT IN ('user_id','display_name','avatar_url')
), 'collaborator public profile exposes only minimal fields');
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1 FROM public.profiles
  WHERE id = (SELECT user_a FROM pg_temp.security_test_context)
), 'B cannot directly read A private profile');
SELECT pg_temp.expect_sqlstate(
  'SELECT public.credits_debug_reset()', '42501',
  'authenticated cannot execute credits debug RPC'
);
SELECT pg_temp.expect_sqlstate(
  format('SELECT public.credits_release_stale_reservations(%L::uuid,interval %L)',
    (SELECT user_a::text FROM pg_temp.security_test_context), '5 minutes'),
  '42501', 'B cannot run cross-user stale cleanup'
);
RESET ROLE;

-- SERVICE ROLE
SELECT set_config('request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text, true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;

UPDATE public.profiles
SET plus_available = true
WHERE id = (SELECT user_a FROM pg_temp.security_test_context);
SELECT pg_temp.assert_true((
  SELECT plus_available
  FROM public.profiles
  WHERE id = (SELECT user_a FROM pg_temp.security_test_context)
), 'service role can update protected subscription columns');
UPDATE public.profiles
SET plus_available = false
WHERE id = (SELECT user_a FROM pg_temp.security_test_context);

SELECT public.admin_grant_plus_entitlement(
  (SELECT user_a FROM pg_temp.security_test_context),
  'admin_grant', NULL, '__staging_security_verification__', NULL
);
SELECT pg_temp.assert_true((
  public.resolve_user_plus_entitlement(
    (SELECT user_a FROM pg_temp.security_test_context))->>'has_plus'
)::boolean, 'service role permanent Plus grant is active');
SELECT pg_temp.assert_true(
  public.resolve_user_plus_entitlement(
    (SELECT user_a FROM pg_temp.security_test_context))->>'effective_source' = 'admin_grant',
  'admin grant has expected Plus precedence'
);
SELECT pg_temp.assert_true(
  public.credits_release_stale_reservations(
    (SELECT user_b FROM pg_temp.security_test_context), interval '5 minutes') = 1,
  'service role global cleanup releases stale reservation'
);
SELECT pg_temp.assert_true(public.admin_revoke_plus_entitlement((
  SELECT id FROM public.user_plus_entitlements
  WHERE user_id = (SELECT user_a FROM pg_temp.security_test_context)
    AND source = 'admin_grant' AND revoked_at IS NULL
  ORDER BY granted_at DESC LIMIT 1
), '__staging_security_verification_revoke__', NULL),
  'service role can revoke Plus grant'
);
SELECT pg_temp.assert_true(NOT (
  public.resolve_user_plus_entitlement(
    (SELECT user_a FROM pg_temp.security_test_context))->>'has_plus'
)::boolean, 'revoked admin grant no longer grants Plus');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

-- Exact ledger outcome assertions as the SQL Editor administrator.
SELECT pg_temp.assert_true(EXISTS (
  SELECT 1 FROM public.credit_ledger
  WHERE id = (SELECT active_ledger FROM pg_temp.security_test_context)
    AND status = 'reserved' AND rolled_back_at IS NULL
), 'active reservation remains reserved');
SELECT pg_temp.assert_true(EXISTS (
  SELECT 1 FROM public.credit_ledger
  WHERE id = (SELECT stale_ledger FROM pg_temp.security_test_context)
    AND status = 'rolled_back'
), 'stale reservation was rolled back');

DO $$
DECLARE assertion_count integer;
BEGIN
  SELECT count(*) INTO assertion_count FROM pg_temp.security_test_results;
  IF assertion_count <> 32 THEN
    RAISE EXCEPTION 'expected 32 completed security assertions, got %', assertion_count;
  END IF;
END;
$$;

SELECT test_name, passed FROM pg_temp.security_test_results ORDER BY test_name;
SELECT jsonb_build_object(
  'status','PASS', 'assertionCount',count(*), 'transactionWillRollback',true
) AS staging_security_verification
FROM pg_temp.security_test_results;

ROLLBACK;

-- This result appears only after ROLLBACK. Every count must be zero.
SELECT jsonb_build_object(
  'status', 'ROLLBACK_COMPLETE',
  'authUsersRemaining', (
    SELECT count(*) FROM auth.users
    WHERE email LIKE 'security-a-%@example.invalid'
       OR email LIKE 'security-b-%@example.invalid'
  ),
  'profilesRemaining', (
    SELECT count(*) FROM public.profiles
    WHERE display_name IN (
      'Security Test A',
      'Security Test B',
      'Security Test A Normal Update',
      '__anon_profile_update_must_not_persist__'
    )
  ),
  'tripsRemaining', (
    SELECT count(*) FROM public.saved_trips
    WHERE title = '__staging_security_verification__'
  ),
  'invitesRemaining', (
    SELECT count(*) FROM public.trip_invites
    WHERE invitee_email = 'security-verification@example.invalid'
  ),
  'entitlementsRemaining', (
    SELECT count(*) FROM public.user_plus_entitlements
    WHERE reason = '__staging_security_verification__'
       OR revocation_reason = '__staging_security_verification_revoke__'
  ),
  'creditRowsRemaining', (
    SELECT count(*) FROM public.credit_ledger
    WHERE request_id IN ('__staging_security_active__','__staging_security_stale__')
  )
) AS rollback_verification;
