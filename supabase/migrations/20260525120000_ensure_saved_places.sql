-- Ensure saved_places exists with RLS (idempotent; fixes missing schema cache)

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.saved_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_id text,
  name text NOT NULL,
  address text,
  lat double precision,
  lng double precision,
  category text,
  city text,
  notes text,
  mood_tag text,
  photo_url text,
  cover_image text,
  rating double precision,
  place_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS place_id text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS mood_tag text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS cover_image text;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS rating double precision;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS place_data jsonb;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.saved_places ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.saved_places SET name = '未命名地點' WHERE name IS NULL OR btrim(name) = '';
UPDATE public.saved_places SET metadata = COALESCE(metadata, place_data, '{}'::jsonb) WHERE metadata IS NULL;
UPDATE public.saved_places SET cover_image = photo_url WHERE cover_image IS NULL AND photo_url IS NOT NULL;

ALTER TABLE public.saved_places ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.saved_places ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saved_places_user_id_fkey'
      AND conrelid = 'public.saved_places'::regclass
  ) THEN
    ALTER TABLE public.saved_places
      ADD CONSTRAINT saved_places_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "places self select" ON public.saved_places;
DROP POLICY IF EXISTS "places self insert" ON public.saved_places;
DROP POLICY IF EXISTS "places self update" ON public.saved_places;
DROP POLICY IF EXISTS "places self delete" ON public.saved_places;
DROP POLICY IF EXISTS "places self all" ON public.saved_places;
DROP POLICY IF EXISTS "saved_places select own" ON public.saved_places;
DROP POLICY IF EXISTS "saved_places insert own" ON public.saved_places;
DROP POLICY IF EXISTS "saved_places update own" ON public.saved_places;
DROP POLICY IF EXISTS "saved_places delete own" ON public.saved_places;

CREATE POLICY "saved_places select own"
  ON public.saved_places
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "saved_places insert own"
  ON public.saved_places
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "saved_places update own"
  ON public.saved_places
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "saved_places delete own"
  ON public.saved_places
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS saved_places_set_updated_at ON public.saved_places;
CREATE TRIGGER saved_places_set_updated_at
  BEFORE UPDATE ON public.saved_places
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_saved_places_user ON public.saved_places (user_id, created_at DESC);

GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_places TO authenticated;

NOTIFY pgrst, 'reload schema';
