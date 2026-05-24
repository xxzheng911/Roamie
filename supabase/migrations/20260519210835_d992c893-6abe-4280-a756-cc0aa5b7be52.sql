-- saved_places table (idempotent)
CREATE TABLE IF NOT EXISTS public.saved_places (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  address TEXT,
  city TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  notes TEXT,
  mood_tag TEXT,
  cover_image TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "places self select" ON public.saved_places;
CREATE POLICY "places self select" ON public.saved_places
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "places self insert" ON public.saved_places;
CREATE POLICY "places self insert" ON public.saved_places
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "places self update" ON public.saved_places;
CREATE POLICY "places self update" ON public.saved_places
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "places self delete" ON public.saved_places;
CREATE POLICY "places self delete" ON public.saved_places
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS saved_places_set_updated_at ON public.saved_places;
CREATE TRIGGER saved_places_set_updated_at
  BEFORE UPDATE ON public.saved_places
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_saved_places_user ON public.saved_places(user_id, created_at DESC);

-- Add updated_at trigger for profiles if missing
DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
