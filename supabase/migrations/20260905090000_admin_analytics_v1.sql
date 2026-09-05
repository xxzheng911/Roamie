-- Admin Analytics v1. New event-backed metrics start at this migration's deployment time.
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  event_name text NOT NULL CHECK (event_name IN (
    'chat_session_started', 'itinerary_generation_started',
    'itinerary_generation_succeeded', 'itinerary_generation_failed',
    'recommendation_requested', 'recommendation_surfaced',
    'place_card_opened', 'affiliate_cta_impression',
    'affiliate_cta_clicked', 'affiliate_outbound_open_succeeded'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tier text CHECK (tier IS NULL OR tier IN ('free', 'plus')),
  session_id text,
  surface text,
  place_id text,
  recommendation_family text,
  provider text,
  failure_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_events_idempotency UNIQUE (event_id, event_name)
);

CREATE INDEX IF NOT EXISTS analytics_events_name_time_idx
  ON public.analytics_events (event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_session_idx
  ON public.analytics_events (session_id) WHERE session_id IS NOT NULL;

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analytics_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.analytics_events TO service_role;

CREATE OR REPLACE FUNCTION public.admin_analytics_v1(p_period text DEFAULT '30d')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
WITH params AS (
  SELECT now() AS observed_at,
    CASE p_period WHEN 'today' THEN date_trunc('day', now()) WHEN '7d' THEN now() - interval '7 days'
      WHEN 'all' THEN '-infinity'::timestamptz ELSE now() - interval '30 days' END AS starts_at,
    CASE WHEN p_period IN ('today','7d','30d','all') THEN p_period ELSE '30d' END AS period
), e AS (
  SELECT a.* FROM public.analytics_events a, params p WHERE a.occurred_at >= p.starts_at
), recommendation_counts AS (
  SELECT recommendation_family, count(*)::integer AS requested_count
  FROM e WHERE event_name = 'recommendation_requested' AND recommendation_family IS NOT NULL
  GROUP BY recommendation_family ORDER BY count(*) DESC, recommendation_family LIMIT 5
), surface_counts AS (
  SELECT surface, count(*)::integer AS click_count FROM e
  WHERE event_name = 'place_card_opened' AND surface IS NOT NULL
  GROUP BY surface ORDER BY count(*) DESC, surface
), affiliate_counts AS (
  SELECT provider,
    count(*) FILTER (WHERE event_name='affiliate_cta_impression')::integer AS impressions,
    count(*) FILTER (WHERE event_name='affiliate_cta_clicked')::integer AS clicks,
    count(*) FILTER (WHERE event_name='affiliate_outbound_open_succeeded')::integer AS opens
  FROM e WHERE provider IS NOT NULL AND event_name LIKE 'affiliate_%'
  GROUP BY provider ORDER BY clicks DESC, provider
), counts AS (
  SELECT
    count(*) FILTER (WHERE event_name='chat_session_started')::integer AS chat_sessions,
    count(*) FILTER (WHERE event_name='itinerary_generation_started')::integer AS itinerary_attempts,
    count(*) FILTER (WHERE event_name='itinerary_generation_succeeded')::integer AS itinerary_successes,
    count(*) FILTER (WHERE event_name='itinerary_generation_failed')::integer AS itinerary_failures,
    count(*) FILTER (WHERE event_name='place_card_opened')::integer AS place_clicks,
    count(DISTINCT place_id) FILTER (WHERE event_name='place_card_opened')::integer AS unique_places,
    count(*) FILTER (WHERE event_name='affiliate_cta_impression')::integer AS affiliate_impressions,
    count(*) FILTER (WHERE event_name='affiliate_cta_clicked')::integer AS affiliate_clicks,
    count(*) FILTER (WHERE event_name='affiliate_outbound_open_succeeded')::integer AS affiliate_opens
  FROM e
)
SELECT jsonb_build_object(
  'observedAt', p.observed_at, 'period', p.period,
  'trackingStartedAt', '2026-09-05T00:00:00Z',
  'chatSessions', c.chat_sessions,
  'itineraryAttempts', c.itinerary_attempts,
  'itinerarySuccesses', c.itinerary_successes,
  'itineraryFailures', c.itinerary_failures,
  'itinerarySuccessRate', CASE WHEN c.itinerary_successes+c.itinerary_failures=0 THEN 0
    ELSE round(100.0*c.itinerary_successes/(c.itinerary_successes+c.itinerary_failures),1) END,
  'popularRecommendationFamilies', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM recommendation_counts r),'[]'::jsonb),
  'placeCardClicks', c.place_clicks, 'uniqueClickedPlaces', c.unique_places,
  'placeClickSurfaces', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM surface_counts s),'[]'::jsonb),
  'affiliateImpressions', c.affiliate_impressions, 'affiliateClicks', c.affiliate_clicks,
  'affiliateOpenSuccesses', c.affiliate_opens,
  'affiliateCtr', CASE WHEN c.affiliate_impressions=0 THEN 0 ELSE round(100.0*c.affiliate_clicks/c.affiliate_impressions,1) END,
  'affiliateByProvider', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM affiliate_counts a),'[]'::jsonb)
) FROM params p CROSS JOIN counts c;
$$;

REVOKE ALL ON FUNCTION public.admin_analytics_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_analytics_v1(text) TO service_role;
