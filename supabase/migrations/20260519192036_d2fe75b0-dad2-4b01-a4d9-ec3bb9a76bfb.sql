
-- profiles (idempotent — skip if remote already has table)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  travel_personality jsonb DEFAULT '{}'::jsonb,
  ai_preferences jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles self select" ON public.profiles;
CREATE POLICY "profiles self select" ON public.profiles FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles self insert" ON public.profiles;
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles self delete" ON public.profiles;
CREATE POLICY "profiles self delete" ON public.profiles FOR DELETE USING (auth.uid() = id);

-- saved_trips
CREATE TABLE IF NOT EXISTS public.saved_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mood text,
  title text NOT NULL,
  cover_image text,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trips self all" ON public.saved_trips;
CREATE POLICY "trips self all" ON public.saved_trips FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- chat_messages
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat self all" ON public.chat_messages;
CREATE POLICY "chat self all" ON public.chat_messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- itineraries
CREATE TABLE IF NOT EXISTS public.itineraries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  city text,
  mood text,
  blocks jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.itineraries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "itin self all" ON public.itineraries;
CREATE POLICY "itin self all" ON public.itineraries FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at trigger for profiles
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
