-- 在 Supabase Dashboard → SQL Editor 執行：檢查 profiles 測驗相關欄位
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name IN (
    'travel_style',
    'travel_preferences',
    'travel_personality',
    'travel_tags',
    'survey_completed',
    'survey_completed_at'
  )
ORDER BY column_name;
