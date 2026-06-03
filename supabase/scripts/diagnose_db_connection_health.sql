-- =============================================================================
-- Supabase / Postgres 連線與逾時診斷（Dashboard Users 失敗時請在 SQL Editor 執行）
-- 若本腳本本身也 timeout → 專案層級連線池/實例過載，請到 Dashboard → Reports / Support
-- =============================================================================

-- 1) 目前連線數（是否接近上限）
SELECT
  count(*) FILTER (WHERE state = 'active') AS active,
  count(*) FILTER (WHERE state = 'idle') AS idle,
  count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx,
  count(*) AS total
FROM pg_stat_activity
WHERE datname = current_database();

-- 2) 執行超過 5 秒的查詢（慢查詢 / 卡住）
SELECT
  pid,
  now() - query_start AS duration,
  state,
  wait_event_type,
  wait_event,
  left(query, 200) AS query_preview
FROM pg_stat_activity
WHERE datname = current_database()
  AND state <> 'idle'
  AND query_start < now() - interval '5 seconds'
  AND query NOT ILIKE '%pg_stat_activity%'
ORDER BY query_start
LIMIT 30;

-- 3) 鎖等待（profiles / auth 相關）
SELECT
  blocked.pid AS blocked_pid,
  blocking.pid AS blocking_pid,
  left(blocked.query, 120) AS blocked_query,
  left(blocking.query, 120) AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_stat_activity blocking
  ON blocking.pid = ANY (pg_catalog.pg_blocking_pids(blocked.pid))
WHERE blocked.datname = current_database()
LIMIT 20;

-- 4) statement_timeout 設定
SHOW statement_timeout;
SHOW lock_timeout;

-- 5) auth.users 上的 trigger（註冊時若卡住，常見於 handle_new_user）
SELECT
  t.tgname AS trigger_name,
  p.proname AS function_name,
  pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'auth'
  AND c.relname = 'users'
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- 6) handle_new_user 函式定義（是否含 auth.identities 子查詢）
SELECT pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'handle_new_user';

-- 7) 大表列數與體積（saved_trips 大 jsonb 會拖慢 PostgREST）
SELECT
  relname AS table_name,
  n_live_tup AS est_rows,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 15;

-- 8) cache 表（通常不影響 auth；僅確認是否有異常膨脹）
SELECT 'destination_cover_cache' AS t, count(*) FROM public.destination_cover_cache
UNION ALL
SELECT 'place_image_cache', count(*) FROM public.place_image_cache;

-- 9) profiles 與 auth.users 數量差（backfill / trigger 異常指標）
SELECT
  (SELECT count(*) FROM auth.users) AS auth_users,
  (SELECT count(*) FROM public.profiles) AS profiles;
