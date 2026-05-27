# Cloudflare Workers 部署（Web + iOS API origin）

Roamie 的正式網域與 `/api/*` 都跑在同一個 **Cloudflare Worker**（TanStack Start + `dist/client` 靜態資源）。

## 525 常見原因

Cloudflare 顯示 **525 SSL handshake failed** 且 **Host Error**，通常代表：

- DNS 已指向 Cloudflare（橘雲），但 **沒有 Worker / Pages 在該網域上接流量**，或
- 橘雲 A 記錄指向錯誤的 origin（舊 VPS、無有效 SSL 的 IP）

**解法：** 部署 Worker 並在 `roamie.tw` zone 上設定 **Worker Routes**（`roamie.tw/*`），讓流量進 Worker，而不是橘雲 A 記錄指向無 SSL 的舊 origin。

> 若 DNS 已有手動 A/CNAME，`custom_domain: true` 可能失敗（錯誤 100117）。本專案使用 **zone route**（見 `wrangler.jsonc`），與現有橘雲 DNS 相容。

## 前置條件

1. `roamie.tw` 已加入 Cloudflare 帳號（與 `wrangler whoami` 相同帳號）
2. 本機已登入：`npx wrangler login`
3. `.env` 已填 Supabase、OpenAI、Maps 等（`npm run sync:env` 會同步到 `.dev.vars`）

## 部署步驟

```bash
npm run deploy
```

（等同 `sync:env` → `build` → `wrangler secret bulk` → `wrangler deploy --name roamie`）

成功後應看到：

- `https://roamie.<account-subdomain>.workers.dev`（帳號子網域依 Cloudflare 而定）
- Worker Routes：`roamie.tw/*`、`www.roamie.tw/*`

驗證：

```bash
curl -sI https://roamie.tw | head -5
curl -sI https://roamie.tw/api/roamie | head -5
```

兩者應為 **HTTP/2 200**（或 API 的 JSON），**不可再出現 525**。

## `VITE_APP_ORIGIN`

iOS TestFlight / bundled 建置會把 `VITE_APP_ORIGIN` 烘焙進 App，用於呼叫 `/api/roamie`、place-photo 等。

| 狀態 | 建議值 |
|------|--------|
| `roamie.tw` 已正常 | `VITE_APP_ORIGIN=https://roamie.tw` |
| 自訂網域尚未就緒 | `VITE_APP_ORIGIN=https://roamie.<account-subdomain>.workers.dev`（例：`https://roamie.vvbwb6bw52.workers.dev`） |

設定後重新建置 iOS：

```bash
npm run ios:release
```

## SSL/TLS 建議

在 Cloudflare Dashboard → **SSL/TLS**：

- 使用 **Full** 或 **Full (strict)**（Worker Custom Domain 由 Cloudflare 終止 TLS，無需 origin 證書）
- 勿對「僅 Worker、無實體 origin」的網域使用指向錯誤 IP 的 **Full** + 手動 A 記錄

## `wrangler.jsonc` 摘要

- `name`: Worker 名稱（目前 `roamie`）
- `main`: `src/server.ts`（TanStack Start server entry）
- `routes`: `roamie.tw/*`、`www.roamie.tw/*`（`zone_name: roamie.tw`）

## 疑難排解

| 症狀 | 檢查 |
|------|------|
| 525 | Worker 是否已 deploy；Custom Domain 是否已綁定；DNS 是否與 Dashboard 衝突 |
| workers.dev 正常、自訂網域 525 | `roamie.tw` zone 是否在同一 Cloudflare 帳號；重新 `wrangler deploy` |
| API 404 HTML | 路徑是否為 `/api/roamie`；是否打到 SPA fallback（應為 Worker 路由） |
| iOS 仍連不到 API | 是否用壞掉的 origin build；改 `VITE_APP_ORIGIN` 後 `npm run ios:release` |
