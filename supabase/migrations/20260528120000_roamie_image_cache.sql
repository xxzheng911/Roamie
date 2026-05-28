-- Shared Unsplash image caches (place cards + destination trip covers)

CREATE TABLE IF NOT EXISTS public.destination_cover_cache (
  normalized_destination_key text PRIMARY KEY,
  destination_name text NOT NULL,
  query text NOT NULL DEFAULT '',
  image_url text NOT NULL,
  ai_generated_destination_cover_url text,
  photographer_name text,
  photographer_url text,
  unsplash_photo_id text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'unsplash'
);

CREATE TABLE IF NOT EXISTS public.place_image_cache (
  cache_key text PRIMARY KEY,
  place_id text,
  place_name text NOT NULL,
  query text NOT NULL DEFAULT '',
  image_url text NOT NULL,
  ai_generated_place_image_url text,
  photographer_name text,
  photographer_url text,
  unsplash_photo_id text,
  place_image_source text NOT NULL DEFAULT 'unsplash',
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS place_image_cache_place_id_idx
  ON public.place_image_cache (place_id)
  WHERE place_id IS NOT NULL;

ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS destination_name text,
  ADD COLUMN IF NOT EXISTS normalized_destination_key text,
  ADD COLUMN IF NOT EXISTS ai_generated_destination_cover_url text;

COMMENT ON TABLE public.destination_cover_cache IS 'Shared Unsplash destination covers keyed by normalized_destination_key';
COMMENT ON TABLE public.place_image_cache IS 'Shared Unsplash place images keyed by placeId or name hash';
COMMENT ON COLUMN public.saved_trips.destination_name IS 'Primary destination label for cover';
COMMENT ON COLUMN public.saved_trips.normalized_destination_key IS 'Normalized key for destination cover cache';
COMMENT ON COLUMN public.saved_trips.ai_generated_destination_cover_url IS 'Unsplash destination cover URL when not customized';

NOTIFY pgrst, 'reload schema';
