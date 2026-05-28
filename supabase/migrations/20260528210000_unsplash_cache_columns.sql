-- Unsplash metadata on shared image caches (replaces AI-only columns)

ALTER TABLE public.destination_cover_cache
  ADD COLUMN IF NOT EXISTS query text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS photographer_name text,
  ADD COLUMN IF NOT EXISTS photographer_url text,
  ADD COLUMN IF NOT EXISTS unsplash_photo_id text;

ALTER TABLE public.place_image_cache
  ADD COLUMN IF NOT EXISTS query text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS photographer_name text,
  ADD COLUMN IF NOT EXISTS photographer_url text,
  ADD COLUMN IF NOT EXISTS unsplash_photo_id text;

UPDATE public.destination_cover_cache
SET image_url = ai_generated_destination_cover_url
WHERE image_url IS NULL AND ai_generated_destination_cover_url IS NOT NULL;

UPDATE public.place_image_cache
SET image_url = ai_generated_place_image_url
WHERE image_url IS NULL AND ai_generated_place_image_url IS NOT NULL;

UPDATE public.destination_cover_cache SET source = 'unsplash' WHERE source = 'ai';
UPDATE public.place_image_cache SET place_image_source = 'unsplash' WHERE place_image_source = 'ai';

COMMENT ON COLUMN public.destination_cover_cache.image_url IS 'Unsplash image URL';
COMMENT ON COLUMN public.destination_cover_cache.query IS 'Unsplash search query used';
COMMENT ON COLUMN public.destination_cover_cache.source IS 'unsplash';
COMMENT ON COLUMN public.place_image_cache.image_url IS 'Unsplash image URL';
COMMENT ON COLUMN public.place_image_cache.place_image_source IS 'unsplash';

NOTIFY pgrst, 'reload schema';
