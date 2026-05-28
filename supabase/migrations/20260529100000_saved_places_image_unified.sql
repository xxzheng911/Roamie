-- Unify saved_places image columns (safe; never references missing columns)

SELECT public.roamie_backfill_saved_places_images();

COMMENT ON COLUMN public.saved_places.cover_image IS
  'Primary place card image URL (Google / Unsplash / default)';
COMMENT ON COLUMN public.saved_places.image_url IS
  'Mirror of cover_image for queries; keep in sync with cover_image';
COMMENT ON COLUMN public.saved_places.image_source IS
  'google | unsplash | default';

NOTIFY pgrst, 'reload schema';
