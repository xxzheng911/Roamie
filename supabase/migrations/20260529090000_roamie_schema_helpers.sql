-- Safe column checks + saved_places image backfill (no-op when columns missing)

CREATE OR REPLACE FUNCTION public.roamie_has_column(p_table text, p_column text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table
      AND column_name = p_column
  );
$$;

COMMENT ON FUNCTION public.roamie_has_column IS
  'Returns true when public.{table} has {column}; use before legacy backfill UPDATEs.';

-- Canonical saved_places image columns:
--   cover_image  — primary display URL (app read/write)
--   image_url    — mirror of cover_image for API/cache
--   image_source — google | unsplash | default
-- Legacy sources (only if column exists): photo_url, metadata JSON keys.
CREATE OR REPLACE FUNCTION public.roamie_backfill_saved_places_images()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.roamie_has_column('saved_places', 'id') THEN
    RETURN;
  END IF;

  ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS cover_image text;
  ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS image_url text;
  ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS image_source text;

  IF public.roamie_has_column('saved_places', 'photo_url')
     AND public.roamie_has_column('saved_places', 'cover_image') THEN
    UPDATE public.saved_places
    SET cover_image = photo_url
    WHERE cover_image IS NULL
      AND photo_url IS NOT NULL
      AND btrim(photo_url) <> '';
  END IF;

  IF public.roamie_has_column('saved_places', 'image_url')
     AND public.roamie_has_column('saved_places', 'cover_image') THEN
    UPDATE public.saved_places
    SET image_url = cover_image
    WHERE image_url IS NULL
      AND cover_image IS NOT NULL
      AND btrim(cover_image) <> '';
  END IF;

  IF public.roamie_has_column('saved_places', 'metadata')
     AND public.roamie_has_column('saved_places', 'cover_image') THEN
    UPDATE public.saved_places
    SET cover_image = COALESCE(
      cover_image,
      NULLIF(btrim(metadata->>'image_url'), ''),
      NULLIF(btrim(metadata->>'photoUrl'), ''),
      NULLIF(btrim(metadata->>'photo_url'), ''),
      NULLIF(btrim(metadata->>'cover_image'), ''),
      NULLIF(btrim(metadata->>'google_photo_url'), ''),
      NULLIF(btrim(metadata->'place'->>'photoUrl'), '')
    )
    WHERE cover_image IS NULL
      AND (
        metadata ? 'image_url'
        OR metadata ? 'photoUrl'
        OR metadata ? 'photo_url'
        OR metadata ? 'cover_image'
        OR metadata ? 'google_photo_url'
        OR metadata->'place' ? 'photoUrl'
      );

    IF public.roamie_has_column('saved_places', 'image_url') THEN
      UPDATE public.saved_places
      SET image_url = cover_image
      WHERE image_url IS NULL
        AND cover_image IS NOT NULL
        AND btrim(cover_image) <> '';
    END IF;
  END IF;
END;
$$;
