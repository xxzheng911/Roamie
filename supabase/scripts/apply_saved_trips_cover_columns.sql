-- Supabase Dashboard → SQL Editor
-- Target: public.saved_trips ONLY (not profiles)
-- Idempotent: safe to run multiple times; uses ADD COLUMN IF NOT EXISTS

-- ── Title ──
ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS custom_title text;

ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS is_title_customized boolean NOT NULL DEFAULT false;

-- ── Cover metadata ──
ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS cover_source text,
  ADD COLUMN IF NOT EXISTS cover_query text;

ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS custom_cover_image_url text;

ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS is_cover_customized boolean NOT NULL DEFAULT false;

-- Optional explicit URLs (App 目前主要仍讀 cover_image 作為 AI 封面)
ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS ai_generated_cover_image_url text;

ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS default_cover_image_url text;

-- Backfill from legacy cover_image when helpful
UPDATE public.saved_trips
SET ai_generated_cover_image_url = cover_image
WHERE ai_generated_cover_image_url IS NULL
  AND cover_image IS NOT NULL
  AND btrim(cover_image) <> '';

COMMENT ON COLUMN public.saved_trips.custom_title IS 'User-edited trip title';
COMMENT ON COLUMN public.saved_trips.is_title_customized IS 'true when custom_title is in use';
COMMENT ON COLUMN public.saved_trips.cover_source IS 'google | unsplash | upload | roamie | default';
COMMENT ON COLUMN public.saved_trips.cover_query IS 'Unsplash search query used for cover';
COMMENT ON COLUMN public.saved_trips.custom_cover_image_url IS 'User-uploaded cover URL';
COMMENT ON COLUMN public.saved_trips.is_cover_customized IS 'true when custom cover is in use';
COMMENT ON COLUMN public.saved_trips.ai_generated_cover_image_url IS 'AI/Unsplash generated cover URL';
COMMENT ON COLUMN public.saved_trips.default_cover_image_url IS 'Fallback default cover URL';
COMMENT ON COLUMN public.saved_trips.cover_image IS 'Primary cover URL (app read/write today)';

NOTIFY pgrst, 'reload schema';
