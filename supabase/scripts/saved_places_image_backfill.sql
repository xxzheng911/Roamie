-- Supabase Dashboard → SQL Editor
-- Safe backfill when migrations failed on photo_url.
-- Requires: roamie_has_column + roamie_backfill_saved_places_images (migration 20260529090000)

SELECT public.roamie_backfill_saved_places_images();

-- Verify columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'saved_places'
  AND column_name IN (
    'cover_image',
    'image_url',
    'image_source',
    'photo_url',
    'metadata'
  )
ORDER BY column_name;
