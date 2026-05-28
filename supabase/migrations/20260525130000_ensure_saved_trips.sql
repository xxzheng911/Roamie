-- Ensure saved_trips exists with RLS (idempotent; fixes missing schema cache)
-- Table name is always public.saved_trips (quoted where needed to avoid parser issues)

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.saved_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  mood text,
  cover_image text,
  cover_image_url text,
  trip_data jsonb DEFAULT '{}'::jsonb,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS mood text;
ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS cover_image text;
ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS cover_image_url text;
ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS trip_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.saved_trips ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.saved_trips SET title = '未命名行程' WHERE title IS NULL OR btrim(title) = '';
UPDATE public.saved_trips
SET payload = COALESCE(NULLIF(payload, '{}'::jsonb), trip_data, '{}'::jsonb)
WHERE payload IS NULL OR payload = '{}'::jsonb;
UPDATE public.saved_trips
SET trip_data = COALESCE(NULLIF(trip_data, '{}'::jsonb), payload, '{}'::jsonb)
WHERE trip_data IS NULL OR trip_data = '{}'::jsonb;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'saved_trips' AND column_name = 'cover_image_url'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'saved_trips' AND column_name = 'cover_image'
  ) THEN
    UPDATE public.saved_trips
    SET cover_image = cover_image_url
    WHERE cover_image IS NULL
      AND cover_image_url IS NOT NULL
      AND btrim(cover_image_url) <> '';
  END IF;
END $$;

ALTER TABLE public.saved_trips ALTER COLUMN title SET NOT NULL;
ALTER TABLE public.saved_trips ALTER COLUMN payload SET DEFAULT '{}'::jsonb;
ALTER TABLE public.saved_trips ALTER COLUMN trip_data SET DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saved_trips_user_id_fkey'
      AND conrelid = 'public.saved_trips'::regclass
  ) THEN
    ALTER TABLE public.saved_trips
      ADD CONSTRAINT saved_trips_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

ALTER TABLE public.saved_trips ENABLE ROW LEVEL SECURITY;

-- Legacy policy names (old migrations)
DROP POLICY IF EXISTS "trips self all" ON public.saved_trips;
DROP POLICY IF EXISTS "trips self select" ON public.saved_trips;
DROP POLICY IF EXISTS "trips self insert" ON public.saved_trips;
DROP POLICY IF EXISTS "trips self update" ON public.saved_trips;
DROP POLICY IF EXISTS "trips self delete" ON public.saved_trips;
DROP POLICY IF EXISTS "saved_trips select own" ON public.saved_trips;
DROP POLICY IF EXISTS "saved_trips insert own" ON public.saved_trips;
DROP POLICY IF EXISTS "saved_trips update own" ON public.saved_trips;
DROP POLICY IF EXISTS "saved_trips delete own" ON public.saved_trips;

-- New policy names (no spaces; explicit table)
DROP POLICY IF EXISTS saved_trips_select_own ON public.saved_trips;
DROP POLICY IF EXISTS saved_trips_insert_own ON public.saved_trips;
DROP POLICY IF EXISTS saved_trips_update_own ON public.saved_trips;
DROP POLICY IF EXISTS saved_trips_delete_own ON public.saved_trips;

CREATE POLICY saved_trips_select_own
  ON public.saved_trips
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY saved_trips_insert_own
  ON public.saved_trips
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY saved_trips_update_own
  ON public.saved_trips
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY saved_trips_delete_own
  ON public.saved_trips
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS saved_trips_set_updated_at ON public.saved_trips;
CREATE TRIGGER saved_trips_set_updated_at
  BEFORE UPDATE ON public.saved_trips
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_saved_trips_user ON public.saved_trips (user_id, created_at DESC);

GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.saved_trips TO authenticated;

NOTIFY pgrst, 'reload schema';
