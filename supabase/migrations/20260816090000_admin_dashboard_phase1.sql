-- Roamie Admin Dashboard Phase 1: read-only aggregate query.
-- The function is callable only by service_role and never changes product rows or RLS.

CREATE OR REPLACE FUNCTION public.admin_dashboard_phase1(
  p_search text DEFAULT NULL,
  p_sort text DEFAULT 'recently_active',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
WITH
params AS (
  SELECT
    NULLIF(btrim(COALESCE(p_search, '')), '') AS search_term,
    CASE
      WHEN p_sort IN ('active_7d', 'active_30d', 'recently_active', 'newest', 'oldest')
        THEN p_sort
      ELSE 'recently_active'
    END AS sort_key,
    GREATEST(1, p_page) AS page_number,
    LEAST(50, GREATEST(1, p_page_size)) AS page_size,
    now() AS observed_at
),
activity_events AS (
  SELECT user_id, created_at, 'chat'::text AS activity_type
  FROM public.chat_messages
  WHERE role = 'user'
  UNION ALL
  SELECT user_id, created_at, 'trip'::text
  FROM public.saved_trips
  UNION ALL
  SELECT user_id, created_at, 'saved_place'::text
  FROM public.saved_places
),
activity_by_user AS (
  SELECT
    user_id,
    MAX(created_at) AS last_active_at,
    COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::integer AS actions_7d,
    COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::integer AS actions_30d,
    COUNT(*) FILTER (WHERE activity_type = 'chat')::integer AS chat_count,
    COUNT(*) FILTER (WHERE activity_type = 'trip')::integer AS trip_count,
    COUNT(*) FILTER (WHERE activity_type = 'saved_place')::integer AS saved_place_count
  FROM activity_events
  GROUP BY user_id
),
user_rows AS (
  SELECT
    u.id AS user_id,
    NULLIF(btrim(p.display_name), '') AS display_name,
    u.email,
    u.created_at,
    u.last_sign_in_at,
    a.last_active_at,
    COALESCE(a.actions_7d, 0) AS actions_7d,
    COALESCE(a.actions_30d, 0) AS actions_30d,
    COALESCE(a.chat_count, 0) AS chat_count,
    COALESCE(a.trip_count, 0) AS trip_count,
    COALESCE(a.saved_place_count, 0) AS saved_place_count,
    CASE
      WHEN p.plan_tier = 'plus' AND p.subscription_status IN ('active', 'trialing')
        THEN 'plus'
      ELSE 'free'
    END AS plan
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  LEFT JOIN activity_by_user a ON a.user_id = u.id
),
filtered_users AS (
  SELECT u.*
  FROM user_rows u
  CROSS JOIN params q
  WHERE q.search_term IS NULL
    OR COALESCE(u.display_name, '') ILIKE '%' || q.search_term || '%'
    OR COALESCE(u.email, '') ILIKE '%' || q.search_term || '%'
    OR u.user_id::text ILIKE '%' || q.search_term || '%'
),
paged_users AS (
  SELECT u.*
  FROM filtered_users u
  CROSS JOIN params q
  ORDER BY
    CASE WHEN q.sort_key = 'active_7d' THEN u.actions_7d END DESC NULLS LAST,
    CASE WHEN q.sort_key = 'active_30d' THEN u.actions_30d END DESC NULLS LAST,
    CASE WHEN q.sort_key = 'recently_active' THEN u.last_active_at END DESC NULLS LAST,
    CASE WHEN q.sort_key = 'newest' THEN u.created_at END DESC NULLS LAST,
    CASE WHEN q.sort_key = 'oldest' THEN u.created_at END ASC NULLS LAST,
    u.user_id
  LIMIT (SELECT page_size FROM params)
  OFFSET (SELECT (page_number - 1) * page_size FROM params)
),
top_users AS (
  SELECT *
  FROM user_rows
  WHERE last_active_at IS NOT NULL
  ORDER BY actions_7d DESC, actions_30d DESC, last_active_at DESC, user_id
  LIMIT 20
),
raw_destinations AS (
  SELECT
    COALESCE(
      NULLIF(btrim(payload->>'destination'), ''),
      NULLIF(btrim(payload->'destinationLocation'->>'displayLabel'), ''),
      NULLIF(btrim(payload->'destinationLocation'->>'city'), ''),
      NULLIF(btrim(payload->'destinationLocation'->>'name'), '')
    ) AS destination,
    id,
    user_id,
    created_at
  FROM public.saved_trips
),
destination_aggregates AS (
  SELECT
    destination,
    COUNT(DISTINCT id)::integer AS trip_count,
    COUNT(DISTINCT user_id)::integer AS unique_users,
    array_agg(DISTINCT user_id::text) AS user_ids,
    MAX(created_at) AS last_saved_at
  FROM raw_destinations
  WHERE destination IS NOT NULL
  GROUP BY destination
  ORDER BY COUNT(DISTINCT id) DESC, MAX(created_at) DESC
  LIMIT 200
),
credit_breakdown AS (
  SELECT feature_type, SUM(amount)::integer AS credits
  FROM public.credit_ledger
  WHERE status = 'committed'
    AND environment = 'production'
    AND committed_at >= now() - interval '30 days'
  GROUP BY feature_type
  ORDER BY feature_type
)
SELECT jsonb_build_object(
  'observedAt', (SELECT observed_at FROM params),
  'summary', jsonb_build_object(
    'totalUsers', (SELECT COUNT(*)::integer FROM auth.users),
    'newUsersToday', (SELECT COUNT(*)::integer FROM auth.users WHERE created_at >= date_trunc('day', now())),
    'newUsers7d', (SELECT COUNT(*)::integer FROM auth.users WHERE created_at >= now() - interval '7 days'),
    'newUsers30d', (SELECT COUNT(*)::integer FROM auth.users WHERE created_at >= now() - interval '30 days'),
    'dau', (SELECT COUNT(DISTINCT user_id)::integer FROM activity_events WHERE created_at >= now() - interval '24 hours'),
    'wau', (SELECT COUNT(DISTINCT user_id)::integer FROM activity_events WHERE created_at >= now() - interval '7 days'),
    'mau', (SELECT COUNT(DISTINCT user_id)::integer FROM activity_events WHERE created_at >= now() - interval '30 days'),
    'userChatsToday', (SELECT COUNT(*)::integer FROM public.chat_messages WHERE role = 'user' AND created_at >= date_trunc('day', now())),
    'userChats7d', (SELECT COUNT(*)::integer FROM public.chat_messages WHERE role = 'user' AND created_at >= now() - interval '7 days'),
    'savedTripsToday', (SELECT COUNT(DISTINCT id)::integer FROM public.saved_trips WHERE created_at >= date_trunc('day', now())),
    'savedTrips7d', (SELECT COUNT(DISTINCT id)::integer FROM public.saved_trips WHERE created_at >= now() - interval '7 days'),
    'savedPlaces7d', (SELECT COUNT(DISTINCT id)::integer FROM public.saved_places WHERE created_at >= now() - interval '7 days'),
    'freeUsers', (SELECT COUNT(*)::integer FROM user_rows WHERE plan = 'free'),
    'plusUsers', (SELECT COUNT(*)::integer FROM user_rows WHERE plan = 'plus'),
    'committedCreditsToday', (SELECT COALESCE(SUM(amount), 0)::integer FROM public.credit_ledger WHERE status = 'committed' AND environment = 'production' AND committed_at >= date_trunc('day', now())),
    'committedCredits7d', (SELECT COALESCE(SUM(amount), 0)::integer FROM public.credit_ledger WHERE status = 'committed' AND environment = 'production' AND committed_at >= now() - interval '7 days'),
    'committedCredits30d', (SELECT COALESCE(SUM(amount), 0)::integer FROM public.credit_ledger WHERE status = 'committed' AND environment = 'production' AND committed_at >= now() - interval '30 days')
  ),
  'users', COALESCE((SELECT jsonb_agg(to_jsonb(paged_users)) FROM paged_users), '[]'::jsonb),
  'usersTotal', (SELECT COUNT(*)::integer FROM filtered_users),
  'topUsers', COALESCE((SELECT jsonb_agg(to_jsonb(top_users)) FROM top_users), '[]'::jsonb),
  'rawDestinations', COALESCE((SELECT jsonb_agg(to_jsonb(destination_aggregates)) FROM destination_aggregates), '[]'::jsonb),
  'creditBreakdown30d', COALESCE((SELECT jsonb_agg(to_jsonb(credit_breakdown)) FROM credit_breakdown), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_phase1(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_dashboard_phase1(text, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.admin_dashboard_phase1(text, text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_phase1(text, text, integer, integer) TO service_role;
