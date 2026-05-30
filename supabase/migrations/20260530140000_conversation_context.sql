-- Persistent travel conversation memory (one row per user, cross-device)

CREATE TABLE IF NOT EXISTS public.conversation_context (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  destination text,
  travel_date text,
  travel_days integer CHECK (travel_days IS NULL OR (travel_days >= 1 AND travel_days <= 30)),
  season text,
  weather text,
  budget text,
  transportation text,
  companions text,
  mood text,
  selected_places jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Roamie Plus: long-term prefs, saved-place patterns, travel personality (reserved)
  plus_memory jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Ephemeral anchors: lastDiscussedPlace, nearbyAnchor, interests, travelMonth, etc.
  session_extras jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_context_updated_at_idx
  ON public.conversation_context (updated_at DESC);

COMMENT ON TABLE public.conversation_context IS
  'Cross-device AI travel context; updated after each chat turn (parser + client sync).';
COMMENT ON COLUMN public.conversation_context.plus_memory IS
  'Plus reserved: likes, dislikes, countries, saved-place analysis, travel personality.';
COMMENT ON COLUMN public.conversation_context.session_extras IS
  'Non-column context: pronoun anchors, interests, outfit, travelDateEnd.';

ALTER TABLE public.conversation_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_context self all" ON public.conversation_context;
CREATE POLICY "conversation_context self all"
  ON public.conversation_context
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_context TO authenticated;

NOTIFY pgrst, 'reload schema';
