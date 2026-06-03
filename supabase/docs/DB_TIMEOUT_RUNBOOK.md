# Supabase / DB 連線逾時排查（Dashboard Users 失敗）

若 **Supabase Dashboard → Authentication → Users** 顯示：

`Failed to retrieve users` / `Connection terminated due to connection timeout`

代表 **專案 Postgres 或連線池層級** 有問題，App 端 Apple token exchange 逾時通常是同一原因，不是 OAuth UI。

## 程式端已排查結論

| 項目 | 結論 |
|------|------|
| 慢查詢 / RPC | `roamie_backfill_saved_places_images()` 僅 migration 手動呼叫，**不會**在登入時跑 |
| auth trigger | `handle_new_user` 曾 `SELECT auth.identities` → 可能與註冊競爭鎖；已提供 migration `20260603120000_handle_new_user_fast_path.sql` 移除 |
| 未完成連線 | 用 `scripts/diagnose_db_connection_health.sql` 查 `idle in transaction` |
| RLS 卡住 auth.users | **不適用** — Dashboard 查 auth schema；public RLS 不直接擋 Admin Users 列表 |
| cache 表 | `destination_cover_cache` / `place_image_cache` **無 trigger、無 FK 到 auth**；僅 server upsert，可暫停 App 寫入但非 Users 列表主因 |

## 建議操作順序

1. **Dashboard → Project Settings → Infrastructure**  
   確認專案未 Paused、無維護公告；必要時重啟 / 升級 compute。

2. **SQL Editor** 執行  
   [`scripts/diagnose_db_connection_health.sql`](../scripts/diagnose_db_connection_health.sql)  
   - 若腳本也 timeout → 連線池耗盡或實例過載，先處理 infra。  
   - 看 `idle in transaction`、`pg_blocking_pids`、`saved_trips` 體積。

3. **套用 migration**（需 `supabase db push` 或 Dashboard SQL）  
   [`migrations/20260603120000_handle_new_user_fast_path.sql`](../migrations/20260603120000_handle_new_user_fast_path.sql)

4. **仍無法註冊時（診斷用）**  
   [`scripts/emergency_auth_trigger_off.sql`](../scripts/emergency_auth_trigger_off.sql)  
   暫停 `on_auth_user_created`；App 仍可用 `ensureUserProfile` 補 profile。

5. **大 payload**  
   若 `saved_trips.payload` 過大，PostgREST 與 Auth 共用 pool 時會互相拖慢；確認分階段寫入已上線（App `trip-staged-persist`）。

## App 端 fallback（已實作）

- `isSupabaseConnectivityError()` — statement timeout / connection timeout / 要求逾時  
- 登入、規劃頁、存行程失敗 → toast **雲端服務暫時無法連線** + **必定** `finally` 清 loading  
- Apple 登入失敗 → `clearAuthState` + 不保留半套 session  

## Google 登入

未改 OAuth 流程；僅 Supabase client `global.fetch` 在原生走 CapacitorHttp（與連線修復一致）。
