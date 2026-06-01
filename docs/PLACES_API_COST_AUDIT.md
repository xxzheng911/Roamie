# Google Places API 成本稽核

> 稽核日期：2026-06-01  
> 背景：Google Cloud Places API 原始費用約 NT$11,240（折抵後約 NT$1,782）

---

## 執行摘要

**主要成本來源不是「完全沒快取」，而是：**

1. **首頁一次開啟可能觸發 2–3 輪完整附近搜尋**（天氣就緒、GPS 更新、心情重置 → cache key 改變）
2. **每輪搜尋並行打 6 個分類**，multi 分類一次 3 個 Nearby Search
3. **搜尋結果已含營業時間，仍額外打 Place Details 補齊**
4. **AI 推薦管線 `fetchVerifiedCandidates` 繞過 server/client 快取**
5. **AI 回覆後 `lookupPlacesHoursBatch` 對每個店名再打 Text Search**
6. **Place Photos 每次 `<img>` 載入都計費**（僅 URL 快取，非圖片 bytes）
7. **探索地圖預設分類 `all` = 6 組 Nearby Search**

保守估計：**冷啟動首頁一次 ≈ 25–45 次 Google SKU 呼叫**（不含點心情、不含 AI）。

---

## 1. 首頁附近推薦是否重複呼叫？

**是，存在結構性重複。**

| 觸發點 | 位置 | 說明 |
|--------|------|------|
| `useEffect([loadNearbyPicks])` | `_app.index.tsx:420` | 每次 `loadNearbyPicks`  identity 改變即執行 |
| `userLocation` 更新 | `useHomeWeather` GPS watch | 座標 grid 若變 → 新 cache key → 整包重打 |
| `weather` 就緒 | `loadNearbyPicks` deps | 天氣 null→有值時 `pickCategoriesForHome` 分類改變 → 新 cache key |
| `selectedMood` 重置 | focus / pathname effect | 回到首頁清 mood → cache key 改變 → 可能重打 |
| `PREFS_UPDATED` / `ACCESS_CHANGED` | `_app.index.tsx:424–437 | 偏好或 Plus 切換 → 強制 reload |

**單次 `loadHomeNearbyPicks`（cache miss）**：

- 最多 **6 個分類** 並行（`pickCategoriesForHome` max: 6）
- 每分類 1 次 primary search；`multi` 模式 = **3 次 Nearby Search**
- `coffee` / `district` 結果不足時追加 **Text Search fallback**（最多數次）
- 完成後 `enrichHomeNearbyPicksHours` 對 `openStatus === "unknown"` 的 pick 各打 **1 次 Place Details**

**快取**：`home-nearby-cache.ts` TTL **8 分鐘**，但 **未 persist**（重開 App 失效）。

---

## 2. 探索地圖是否每次 render 都重新請求？

**否 — 但有條件性重打。**

`MapView` 搜尋 effect（`_app.map.tsx:493–739`）有 guard：

- `locationMovedEnough`（120m 門檻）
- `queryDirty` / `catDirty` 檢查
- `searchRequestIdRef` 取消過期請求

**會重打的情況**：

- 分類切換 `cat.id`
- 搜尋文字 `query`（debounce 450ms）
- GPS 移動 >120m
- `weatherCacheKey(weather)` 改變
- `searchTrigger` 手動遞增

**不會**因普通 re-render 重打（`reasonProfile`、`sheetMode` 不在 deps）。

**但**：預設分類為 `EXPLORE_CATEGORIES[0]` = **`all`**，一次搜尋 = **6 組 Nearby Search**。

---

## 3. useEffect 是否缺少 dependency array？

**未發現首頁/地圖核心路徑缺少 dependency array 的 useEffect。**

已確認均有 `[]` 或完整 deps。  
問題不在「無 deps 無限 loop」，而在 **deps 設計導致合法但頻繁的 re-fetch**（weather / location / mood）。

---

## 4. 是否同時重複呼叫 Nearby / Text / Details / Photos？

**是，且常疊加。**

| API 類型 | 呼叫位置 | 快取 |
|----------|----------|------|
| **Nearby Search** | `searchNearby` / `searchMultiNearby` | server 8min + client 8min |
| **Text Search** | fallback、coffee/district、mood 推薦、`lookupPlacesHoursBatch` | 同上（mood 走 unified） |
| **Place Details** | 首頁 hours enrich、地點詳情、intro | server 24h 記憶體；client persist 24h（詳情頁有，**首頁 enrich 無 client cache**） |
| **Place Photos** | `PlaceCardCover` → `buildPlacePhotoUrl` / `/api/place-photo` | URL 24h；**圖片 bytes 每次載入可能計費** |

**特別嚴重**：

- `fetch-candidates.server.ts` → `executeExploreSearch` **繞過** `getServerCachedExploreSearch`
- `enrich-roamie-places.server.ts` → `lookupPlacesHoursBatch`：每個 AI 推薦店名 **1 次 Text Search**（concurrency 4）

---

## 5. 是否每次開啟首頁都重新抓取所有景點？

**8 分鐘內同 grid + 同分類 + 同 mood：否（命中 cache）。**  
**冷啟動 / 天氣就緒 / GPS 更新 / mood 重置：是，完整重抓。**

首頁 **不** 一次抓「所有景點」，而是 **6 分類 × 每分類 2 筆 ≈ 最多 12 筆**（dedupe 後約 8–10 筆）。

---

## 6. 快取機制現況

| 快取 | TTL | Persist | 問題 |
|------|-----|---------|------|
| `home-nearby-cache` | 8 min | ❌ | 重開 App 失效；key 不含 weather 但含 categoryIds（天氣間接影響） |
| `places-explore-cache`（client） | 8 min | ❌ | 僅 session 記憶體 |
| `places-search-server-cache` | 8 min | ❌ | Cloudflare Worker 重啟/多 instance 不共享 |
| `places-details-server-cache` | 24 h | ❌ | 同上 |
| `place-details-request-cache` | 24 h | ✅ localStorage | **首頁 enrich 未使用** |
| `place-photo-url-cache` | 24 h | ✅ | 只快取 URL 字串 |
| `/api/place-photo` | CDN 24h | HTTP cache | 首次仍打 Google |

**未達「附近景點 30 分鐘」目標**（目前 8 分鐘且多層不 persist）。

---

## 7. 同一景點是否重複請求 Place Details？

**是。**

1. 首頁 `enrichHomeNearbyPicksHours` → `getPlaceDetails`（server cache only）
2. 使用者點卡片 → `navigateToNearbyPlaceDetail` → 可能再 fetch
3. 地點詳情頁 → `getCachedPlaceDetailsForScreen`（client persist）— **若從首頁進入，前兩步可能已打 2 次**
4. 地圖 sheet → `getPlaceIntro` → `fetchPlaceDetailsForIntro`（另一 field mask / cache bucket）

搜尋 field mask **已含** `currentOpeningHours` / `regularOpeningHours`，多數 enrich Details 呼叫 **可省略**。

---

## 8. Place Photos 是否每次重新下載？

**URL 有快取，圖片載入仍可能每次計費。**

- `PlaceCardCover` 用 `<img src={google media url}>` 或 proxy
- 捲動離開再回來、cache bust、不同 width → 可能重新請求
- proxy 設 `Cache-Control: max-age=86400`，但 **無 Supabase/CDN 永久 object storage**
- 失敗時 fallback 候選 URL 可能 **同一 photo 打 2 次**（direct + proxy）

---

## 9. 每次開啟首頁平均 Google API 次數（估算）

### 假設：一般使用者、冷 cache、台北、晴天、未點心情

| 階段 | Nearby | Text | Details | Photos* |
|------|--------|------|---------|---------|
| 第 1 輪（mount，weather=null，4 分類 nearby） | 4 | 0 | 0–4 | 0 |
| 第 2 輪（weather 就緒，4 分類含 2 multi×3） | 8 | 0 | 0–6 | 0 |
| 第 3 輪（GPS 微調，若 grid 相同） | 0 | 0 | 0 | 0 |
| 卡片渲染（8 張封面） | — | — | — | **8** |

\*Photos = 瀏覽器載入 `<img>` 時的 Place Photo SKU

**冷啟動首頁合計：約 12–18 次 Search/Details + 8 次 Photo ≈ 20–26 次 SKU**  
**若 GPS grid 也變：再 +12–18 次 → 32–44 次**

### 加上使用者行為

| 行為 | 額外呼叫 |
|------|----------|
| 點 1 個心情 → AI 推薦 | +6 category search（places-first）+ 3–5 mood text + 3–5 lookupPlacesHoursBatch text |
| 進探索地圖（all 分類） | +6 nearby |
| 切換 3 個分類 | +3×(1–6) nearby |

**重度 session（首頁 + 心情 AI + 地圖）可輕易 >80 次/次使用。**

---

## 10. 成本優化方案（目標：降低 70%+ 呼叫量）

### P0 — 立即（預估 −50~65%）

| # | 措施 | 預估節省 |
|---|------|----------|
| 1 | **首頁只打 1 輪**：等 `weatherStatus === 'ready'` 後才 `loadNearbyPicks`；合併 location debounce 500ms | −30% 首頁 search |
| 2 | **取消或限縮 `enrichHomeNearbyPicksHours`**：搜尋結果已有 hours field mask | −6~12 Details/首頁 |
| 3 | **`fetchVerifiedCandidates` 改走 `getServerCachedExploreSearch`** | −100% AI 管線重複 search |
| 4 | **移除 `lookupPlacesHoursBatch` Text Search**：改用 place_id Details 或搜尋階段 hours | −3~8 Text/AI 回覆 |
| 5 | **首頁分類 6→3**（只保留 coffee / food / sight 或依 mood 2+1） | −50% 首頁 search |
| 6 | **home-nearby cache persist + TTL 30min** | −40% 回訪 |

### P1 — 一週內（再 −15~25%）

| # | 措施 |
|---|------|
| 7 | 地圖預設分類改 `coffee` 或 `sight`，非 `all`（6 groups） |
| 8 | 首頁 enrich / 詳情共用 `getCachedPlaceDetailsForScreen`（client persist） |
| 9 | Place Photo：首屏只載 2 張，其餘 Intersection Observer lazy |
| 10 | Server cache 改 KV / Supabase（跨 Worker instance 共享） |
| 11 | 合併 multi category：首頁用單次 nearby + 本地 filter，非 3 次 parallel |

### P2 — 架構（長期 −80%+）

| # | 措施 |
|---|------|
| 12 | 背景預取：登入後 1 次 batched search 寫入 Supabase `cached_nearby_places` |
| 13 | Photo 永久化：`roamie_image_cache` 已有 migration，Places photo 首次抓取後存 R2 |
| 14 | Field mask 分 tier：列表用精簡 mask（去掉 reviews/editorial） |
| 15 | 監控：Cloud Logging 計數 `[PLACES_API]` + 每日 per-user quota |

### 優先實作順序

```
P0-1 weather gate → P0-5 減分類 → P0-2 停 Details enrich → P0-3 AI cache → P0-6 persist 30min
```

**預期**：僅 P0 五項即可達 **70–75% 呼叫量下降**（以首頁 + AI 為主場景）。

---

## 相關程式位置

| 項目 | 檔案 |
|------|------|
| 首頁 nearby 載入 | `src/routes/_app.index.tsx` |
| 分類選擇 | `src/lib/recommendation/categories.ts` |
| 分類搜尋 + Details enrich | `src/lib/explore-category-search.ts` |
| 快取 TTL | `src/lib/places-cache-config.ts` |
| Server search | `src/lib/places.functions.ts` |
| AI 候選（無 cache） | `src/lib/recommendation/fetch-candidates.server.ts` |
| AI hours Text Search | `src/lib/enrich-roamie-places.server.ts` → `lookupPlacesHoursBatch` |
| 地圖搜尋 | `src/routes/_app.map.tsx` |
| 相片載入 | `src/components/media/PlaceCardCover.tsx` |
