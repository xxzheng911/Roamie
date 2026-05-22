-- Saved trips & places (idempotent; compatible with Roamie app columns)

CREATE TABLE IF NOT EXISTS public.saved_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  cover_image_url text,
  trip_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS mood text;
ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS cover_image text;
ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;

UPDATE public.saved_trips
SET payload = trip_data
WHERE (payload IS NULL OR payload = '{}'::jsonb) AND trip_data IS NOT NULL;

UPDATE public.saved_trips
SET cover_image = cover_image_url
WHERE cover_image IS NULL AND cover_image_url IS NOT NULL;

ALTER TABLE public.saved_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trips self all" ON public.saved_trips;
CREATE POLICY "trips self all" ON public.saved_trips
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_saved_trips_user ON public.saved_trips (user_id, created_at DESC);

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.saved_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_id text,
  name text,
  address text,
  lat double precision,
  lng double precision,
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS mood_tag text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS cover_image text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.saved_places
SET cover_image = photo_url
WHERE cover_image IS NULL AND photo_url IS NOT NULL;

ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "places self select" ON public.saved_places;
DROP POLICY IF EXISTS "places self insert" ON public.saved_places;
DROP POLICY IF EXISTS "places self update" ON public.saved_places;
DROP POLICY IF EXISTS "places self delete" ON public.saved_places;
DROP POLICY IF EXISTS "places self all" ON public.saved_places;

CREATE POLICY "places self all" ON public.saved_places
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_saved_places_user ON public.saved_places (user_id, created_at DESC);
