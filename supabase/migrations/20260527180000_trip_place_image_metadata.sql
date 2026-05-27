-- Trip cover metadata + place image cache columns

ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS cover_source text,
  ADD COLUMN IF NOT EXISTS cover_query text;

COMMENT ON COLUMN public.saved_trips.cover_image IS 'Cover image URL (Unsplash, upload, or default)';
COMMENT ON COLUMN public.saved_trips.cover_source IS 'google | unsplash | upload | roamie | default';
COMMENT ON COLUMN public.saved_trips.cover_query IS 'Unsplash search query used for cover';

ALTER TABLE public.saved_places
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS image_source text;

UPDATE public.saved_places
SET image_url = cover_image
WHERE image_url IS NULL AND cover_image IS NOT NULL;

NOTIFY pgrst, 'reload schema';
