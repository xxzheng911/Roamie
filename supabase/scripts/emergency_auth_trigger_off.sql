-- =============================================================================
-- 緊急：暫停 auth.users → handle_new_user（僅用於診斷 DB timeout）
-- 執行後：新註冊不會自動建 profiles，需靠 App ensureUserProfile 補建
-- 恢復：見 supabase/migrations/*_handle_new_user_fast_path.sql 或重新建立 trigger
-- =============================================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 確認已移除
SELECT tgname
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal;
