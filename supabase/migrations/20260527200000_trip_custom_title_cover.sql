-- Trip custom title / cover (device-persistent; not overwritten by stop edits)

ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS custom_title text;

ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS is_title_customized boolean NOT NULL DEFAULT false;

ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS custom_cover_image_url text;

ALTER TABLE public.saved_trips
  ADD COLUMN IF NOT EXISTS is_cover_customized boolean NOT NULL DEFAULT false;

-- Legacy: user uploads were stored in cover_image_url
UPDATE public.saved_trips
SET
  is_cover_customized = true,
  custom_cover_image_url = COALESCE(custom_cover_image_url, cover_image_url)
WHERE cover_image_url IS NOT NULL
  AND btrim(cover_image_url) <> ''
  AND (cover_source = 'upload' OR is_cover_customized = false);

NOTIFY pgrst, 'reload schema';
