-- =============================================================================
-- profile-media：移除匿名可列舉的 SELECT 政策，改為只能讀自己資料夾
-- =============================================================================
--
-- 目的
--   bucket `profile-media` 為 public = true。storage.objects 上原有兩條
--   沒有限制角色、條件只有 bucket_id 的 SELECT 政策：
--     - "profile_media_public_read"（repo 20260524120000 建立）
--     - "profile-media public read"（後台手動建立）
--   這兩條讓 anon 可以透過 Storage API list 整個 bucket。
--   本 migration：
--     1. 移除上述兩條 public SELECT 政策。
--     2. 新增 "profile_media_select_own"：authenticated 只能 SELECT
--        自己 {uid}/ 資料夾下的物件。
--     3. 把後台手動建立的 3 條寫入政策（upload / update / delete）納入 repo，
--        名稱與條件與線上一致。行程封面 {uid}/trips/{tripId}/... 靠這 3 條上傳／刪除。
--   不改 bucket 設定；不改既有 profile_media_insert_own / update_own / delete_own
--   與 public.profile_media_path_allowed；不動其他表、函式或 bucket。
--
-- 可以重跑
--   所有語句都是 DROP POLICY IF EXISTS 後再 CREATE POLICY，可重複執行。
--
-- 角色欄位注意事項
--   已確認：線上 roles 為 {authenticated}，本檔與線上一致。
--   （"profile-media authenticated upload／update／delete" 與
--   profile_media_*_own 皆為 {authenticated}；兩條 public read 為 {public}。）
--   查詢指令：
--     select policyname, roles, cmd, qual, with_check
--       from pg_policies
--      where schemaname = 'storage' and tablename = 'objects'
--      order by policyname;
--
-- 對 App 的影響
--   圖片顯示走公開網址 /storage/v1/object/public/...，不經 SELECT 政策，不受影響；
--   頭像 upsert、移除需要 SELECT 權限，由新的 select_own 政策涵蓋。
--
-- 套用後的驗證方法
--   1. SQL Editor 執行：
--        select policyname, roles, cmd from pg_policies
--         where schemaname='storage' and tablename='objects'
--         order by policyname;
--      結果應該不再出現 "profile_media_public_read" 與 "profile-media public read"，
--      並出現 "profile_media_select_own"。
--   2. 匿名 list 測試（以 anon 身分呼叫 Storage API list，應回傳空陣列 []）：
--        curl -X POST "https://<專案>.supabase.co/storage/v1/object/list/profile-media" \
--          -H "apikey: <ANON_KEY>" \
--          -H "Authorization: Bearer <ANON_KEY>" \
--          -H "Content-Type: application/json" \
--          -d '{"prefix":"","limit":10}'
--      <專案> 與 <ANON_KEY> 由使用者自行填入，請勿把實際值寫進任何檔案。
--   3. App 實測：
--      - 換頭像成功。
--      - 上傳行程封面成功。
--      - 移除頭像成功。
--      - 刪除行程封面成功。
--      - 其他成員看得到共享行程的封面。
-- =============================================================================

-- 1. 移除兩條 public SELECT 政策
DROP POLICY IF EXISTS "profile_media_public_read" ON storage.objects;
DROP POLICY IF EXISTS "profile-media public read" ON storage.objects;

-- 2. 只能 SELECT 自己資料夾下的物件
DROP POLICY IF EXISTS "profile_media_select_own" ON storage.objects;
CREATE POLICY "profile_media_select_own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'profile-media'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

-- 3. 後台手動建立的 3 條寫入政策納入 repo（名稱與條件與線上一致）
DROP POLICY IF EXISTS "profile-media authenticated upload" ON storage.objects;
CREATE POLICY "profile-media authenticated upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-media'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "profile-media authenticated update" ON storage.objects;
CREATE POLICY "profile-media authenticated update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'profile-media'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'profile-media'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "profile-media authenticated delete" ON storage.objects;
CREATE POLICY "profile-media authenticated delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'profile-media'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

-- =============================================================================
-- Rollback（僅供參考，不要在本 migration 內執行）
-- 還原兩條 public SELECT 政策；select_own 與 3 條寫入政策可保留或自行移除。
--
--   DROP POLICY IF EXISTS "profile_media_public_read" ON storage.objects;
--   CREATE POLICY "profile_media_public_read"
--     ON storage.objects
--     FOR SELECT
--     USING (bucket_id = 'profile-media');
--
--   DROP POLICY IF EXISTS "profile-media public read" ON storage.objects;
--   CREATE POLICY "profile-media public read"
--     ON storage.objects
--     FOR SELECT
--     TO public
--     USING (bucket_id = 'profile-media');
--
--   -- 視需要移除新增的 select_own：
--   -- DROP POLICY IF EXISTS "profile_media_select_own" ON storage.objects;
-- =============================================================================
