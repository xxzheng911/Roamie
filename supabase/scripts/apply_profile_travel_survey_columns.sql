-- =============================================================================
-- 僅套用 Plus 旅行偏好測驗欄位（idempotent，可重複執行）
-- 用法：Supabase Dashboard → SQL Editor → 貼上並 Run
-- 不會刪表、不會 reset database
-- =============================================================================

-- travel_personality：早期 migration 已建立，此處只確認存在
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'travel_personality'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN travel_personality jsonb NOT NULL DEFAULT '{}'::jsonb;
    RAISE NOTICE 'Added column travel_personality';
  ELSE
    RAISE NOTICE 'Column travel_personality already exists';
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS travel_style text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS travel_preferences jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS travel_tags jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS survey_completed boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS survey_completed_at timestamptz;

COMMENT ON COLUMN public.profiles.travel_style IS '旅行人格標題（測驗結果）';
COMMENT ON COLUMN public.profiles.travel_preferences IS '興趣與偏好標籤陣列';
COMMENT ON COLUMN public.profiles.travel_tags IS '測驗衍生標籤';
COMMENT ON COLUMN public.profiles.survey_completed IS '是否完成 Plus 旅行偏好測驗';
COMMENT ON COLUMN public.profiles.survey_completed_at IS '測驗完成時間';

-- 執行後請再跑 verify_profile_survey_columns.sql 確認 6 個欄位都在
