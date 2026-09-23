# Explore request storm：第二輪診斷與修正

日期：2026-09-23。使用者已回報實機驗收通過；最終 commit audit 發現取消請求仍能覆寫 cache，依指示暫停 commit。未 push、Archive。詳見文末最終 audit。

本報告取代第一輪報告對 Explore 修復完整性的判斷。第一輪 Favorites 圖片修正保留。證據分為實際 source、使用者提供的實機 log、執行 production modules 的受控 provider fixture；以下不把 fixture 數字當作實機測量。

## A. Request storm 真正 Root Cause

1. **搜尋選取後錯誤恢復 browse authority。** 舊 route 的 `isFreeText = !!query.trim() && !searchSelectedCenter`：選 autocomplete 結果設定 `searchSelectedCenter`、關閉 dropdown 後，即使 query 仍是「首爾塔」，也會進入 category recommendation。`all` 隨即啟動五分類 hydration。
2. **多層不同 query 擴張。** `searchExploreAllPlacesMerged` 原本 `Promise.all` 五分類；city sight 又並行 popular/bootstrap 與 category search。city bootstrap 的 query budget 為 24、每批 4；category fallback 可走 16 個 query，結果不足又補 bootstrap。它們是不同 request key，same-key dedupe 不會阻止這種 fan-out。
3. **autocomplete 額外 Details fan-out。** 舊 suggestions 流程為了距離／卡片資料解析最多 10 個地點；weather／reasonProfile 變更又可重跑 autocomplete effect，增加重複工作。
4. **guard admission 與實際 dispatch 分離。** 舊 guard 先檢查 rate window，再等待 concurrency slot。多個請求同時通過檢查後入隊，出隊沒有重新檢查，實際可超過上限。
5. **優先級與 foreground grant 未正確連接。** `postPlaces` 原本除 Home 特例外，把 Explore recommendation 也標成 foreground；真正 Explore explicit search 沒有建立並攜帶 foreground grant。背景吃滿共用 window 後，使用者 direct search 被擋住。
6. **本地 budget 被升級成 provider protection。** unified adapter 曾把本地 `isPlacesRateLimited()` 轉成 `notePlacesRateLimited()`，即使沒有 Google HTTP 429，也啟動較長的 provider protection。

因此第一輪只保護 primary rendering 還不夠：provider request 根本可能無法送出。

## B. 完整 trigger chain 與 effect authority

主要 source：`src/routes/_app.map.tsx`、`explore-category-search.ts`、`explore-city-popular-places.ts`、`places-search-unified.ts`、`places.functions.ts`、`places-api-guard.ts`。

```text
Explore mount
  → effective location / geoReady / isReadyForPlaces
  → recommendCenter（selection / browse gesture / effective location / user location）
  → main search effect
      ├─ cache hit → 顯示 cache
      ├─ 非空 query、dropdown 開啟 → 交給 autocomplete effect
      ├─ explicit submit → Text Search → primary / marker / count
      └─ 空 query browse → category authority
          → all → coffee / sight / district / food / night
          → category → raw pool / nearby / city category / popular bootstrap
          → existing provider adapter → shared Places guard → provider

input callback → 新 search session、abort 舊 session
  → autocomplete effect（320 ms）→ autocomplete suggestions
select callback → 新 search session → 一個 screen Details → primary
submit / Enter → 新 search session → immediate Text Search
result card selection / handoff → selectedPlace + programmatic map pan
user dragend（空 query、移動至少 500 m）→ browseCenter + refresh trigger

卡片 mount → 圖片 hook → saved/runtime metadata 或缺資料時 Details discovery
  → signed photo URL cache / sign endpoint → photo proxy / browser image load
```

### 實際 dependencies 與十項問題

| 問題 | Source 結論與目前處理 |
| --- | --- |
| 1. 哪些 effect/callback 發請求？ | main search effect、debounced autocomplete effect、explicit selection callback；browse category/cache refill 經同一 session。GPS readiness／重新定位、category、明確 refresh 可觸發 main effect。卡片圖片 hook 是獨立流程。 |
| 2. 哪些 state 重跑 main effect？ | query、cat.id、searchPlacesFn、geoReady、effectiveLocation.locationKey/isReadyForPlaces、locale、searchTrigger、dropdown、recommendCenter 座標/source、selected center label/ID、cityRecommendMode、networkOnline、t。selected center 更新原本會改變分支，現在仍可重跑 effect，但已完成 primary 的非空搜尋直接返回。 |
| 3. map pan／center 有 loop 嗎？ | 未找到。原 GoogleMap 沒有把 center_changed/idle 回寫 route；panTo 是單向 effect。不能只因 log 相邻就判定有 loop。 |
| 4. primary 改 center 會再發 recommendation？ | 舊 selection 改 searchSelectedCenter，改變 recommendCenter 與 isFreeText，確實可觸發 recommendation；不是 Google map 事件回授。新搜尋分支禁止 browse。 |
| 5. recommendation results 會再改 recommendation center？ | results 並非 recommendCenter 的來源，也不在主請求 effect dependencies；沒有找到這條遞迴鏈。 |
| 6. selectedPlace 會啟動 hydration？ | selectedPlace 是 detail UI state，不是 main effect dependency。要區分 searchSelectedCenter；後者才是舊版分支切換原因。 |
| 7. all 是否五分類 fan-out？ | 是，舊版並行五分類，再各自擴張；新版分類逐一補齊且受 provider budget 限制。 |
| 8. 每個 query 同時 direct + hydration？ | 並非每個 keystroke 都同時啟動三者；dropdown 開啟主要走 debounce autocomplete。問題是選取／關閉 dropdown 後進入 hydration，以及 autocomplete 自身 Details 擴張。現在 submit 直接 Text Search，selection 只 Details，非空 query 不走 ALL。 |
| 9. miss 會重複 fetch？ | 舊 cache 在查 in-flight 前記 persistent miss，miss 數不等於 HTTP 數；底層已有部分 dedupe，但不同 query／capability 無法合併，Lite discovery 又可走另一條路。新版先 join pending，再查 persistence；screen_v1 canonical ID 實際測試只有一次 provider fetch。 |
| 10. dependency instability？ | main effect 使用 category ID、center scalar，沒有 results／mapCenter／selectedPlace dependency。舊 autocomplete 依賴 weather／reasonProfile，會造成額外重跑；已移除這些呈現資料與 suggestion Details hydration。server function／locale／t 仍是實際依賴，不能聲稱任何重 render 都不會重跑；session cancellation、cache、in-flight guard 負責保護。 |

## C. 為什麼 callsInWindow 會到 25

實際 `RATE_MAX_CALLS = 20`，並不是 25。用 HEAD 原始 `places-api-guard.ts`、25 個不同 key、受控延遲 runner 重現：

```json
{"baselineProviderCalls":25,"callsInWindow":25,"directResult":null,
 "lastLedger":{"blocked":true,"counted":false,"blockedReason":"request_budget","requestType":"searchText"}}
```

重現工具：`/tmp/roamie-storm-baseline.mjs`（讀取 HEAD guard、mock 外部 cache 與 provider，沒有實際 Google 請求）。因 admission 發生在排隊前，25 個呼叫可以在 window 尚空時一起通過。修正為**取得 slot 後、每次實際 provider attempt 前，原子檢查並計數**；retry 也各自計數。

## D. 為什麼 foreground 被擋／如何保護

舊 Explore 沒有接上既有 foreground request grant，且推薦誤標 foreground，故 window=25 時 explicit search 被一般 request_budget 擋下。

現在：

- global window 上限仍 20；background 最多使用到 16，保留 4 給 foreground。
- scoped explicit search 首次 dispatch 建立既有 foreground grant，携帶同一 generation/session ID。既有 hot-window grant 與 runaway 限制仍在，沒有新增無限 bypass。
- queue 優先服務 foreground；總 concurrency 2，其中 background 最多 1。
- input／submit／selection 立即 abort 舊 session，queued 工作退出、active fetch 收到 AbortSignal。取消前已送到 provider 的請求仍可能計費，不能撤回。
- 真實 HTTP 429/503 的 provider protection 保留；本地 window 滿不再偽裝成 provider 429。

受控測試：25 個 background 工作只允許 16 次 dispatch，接續 foreground 成功成為第 17 次；另測既有 window=25 時合法 foreground grant 仍可執行。這不代表真實 provider quota 或 runaway protection 永不阻擋搜尋。

## E. Search mode / Browse mode authority

| 行為 | Search | Browse |
| --- | --- | --- |
| 模式條件 | query.trim() 非空／explicit session | query 空且沒有 explicit search |
| input | 立即取消舊工作，320 ms autocomplete debounce | 清空 query 後可恢復 |
| submit / select | 不等 debounce；Text Search / 單一 Details | 不適用 |
| ALL / popular / nearby enrichment | 不啟動；目前 primary 後也不自動補推薦 | 分類循序 progressive hydration |
| 背景限制 | 舊 session 失效，不得繼續消耗 capacity | 每 session 最多 10 provider attempts、每分類最多 2；背景 HTTP concurrency 1 |
| loading | active foreground 決定 full loading；primary 到達立即可呈現 | 背景狀態獨立 |

卡片圖片不參與 primary loading。圖片 sign/proxy 流量也不算 search session 的 Places search/Details 指標；缺照片 metadata 的獨立圖片 discovery 仍屬圖片服務流程。本次沒有宣稱所有圖片網路活動都被搜尋 session 取消。

新增 `EXPLORE_SEARCH_SESSION`：searchSessionId、query、foregroundRequests、backgroundRequests、dedupedRequests、abortedRequests、blockedRequests、primaryResultMs、totalRequestsBeforePrimary。primary 記錄由 route 在 primary state commit 後 effect 發出；不是螢幕 paint 或真實裝置首幀測量。empty/error/superseded 有 lifecycle 摘要。逐筆 provider/cache ledger 改為 verbose gating，避免 production 常態大量輸出。

## F. Map center feedback loop

沒有證據支持 Google map event feedback loop；已確認的問題是 route selection authority。新增 `dragend` callback 表示真實 user gesture，只有空 query 且移動至少 500 m 才刷新 browse。programmatic panTo 不使用 center_changed/idle callback，不啟動 browse。清空搜尋後，browse 以目前可見中心恢復；gesture cache key 使用實際 center bucket。

## G. In-flight dedupe / cache

- 沿用現有 cache，沒有新增平行 persistent authority。
- Text query 統一 trim／空白／大小寫；key 保留 request type、category、center bucket、locale、bias policy。direct 無偏置搜尋不能誤用 recommendation 有偏置結果。
- Place ID canonicalization 不改其大小寫；Details 使用 Place ID + locale + capability，screen_v1 只接受完整度合格資料，不把 search_v1 冒充 screen_v1。
- unified Place cache、search cache、request cache 先 join active pending；同一 canonical screen Details miss 共用 Promise。
- 已取消 pending 不供新 session 重用；finally 只刪除自己的 Promise，避免舊請求清掉新 owner；aborted 結果不寫 cache。
- category/raw-pool 的 in-flight ownership 加入 session；persistent identity 維持原來語意。新 browse 不受舊 cancelled session throttle 阻擋。
- native fallback 的 sticky attempted/cooldown 不阻止新 scoped same-key 搜尋；autocomplete 不再為 10 個 suggestions 各發 Details。

## H. 修改檔案

本輪 request authority：

- `src/lib/explore-request-session.ts`：session、取消、budget、diagnostics。
- `src/lib/places-api-guard.ts`：dispatch admission、priority queue、foreground reserve、retry 計數、abort。
- `src/routes/_app.map.tsx`：search/browse 分離、input/submit/select、loading、progressive browse。
- `src/lib/explore-category-search.ts`：循序 ALL、session ownership、progress callback。
- `src/lib/places.functions.ts`、`places-search-unified.ts`、`trip-stop-search-unified.ts`：provider owner/native adapter/autocomplete/Details。
- `src/lib/explore-map-search.ts`、`explore-primary-place.ts`、`src/services/placesService.ts`：傳遞 scoped owner。
- `src/lib/unified-place-cache.ts`、`places-search-dedupe.ts`、`map-places-cache.ts`、`src/services/requestCache.ts`：in-flight/cache cancellation。
- `src/components/GoogleMap.tsx`、`src/components/map/GoogleMapBackground.tsx`：真正 dragend。
- `package.json`、兩個新 storm/native verification scripts、既有 progressive script 更新。

第一輪仍保留：city/POI identity、primary presentation，以及 `SavedPlaceCoverThumb`、`use-place-image`、`placeImageService`、`signed-place-photo` 的 Favorites 圖片修正。詳細清單與第一輪測試見 [先前報告](./explore-favorites-loading-diagnosis.md)。

## I. 新增 regression tests

`npm run verify:explore-request-storm` 共 14 個 scenario：

1. explicit search 禁止 ALL hydration。
2. 背景 window reserve 保護 foreground。
3. programmatic pan 不刷新 browse。
4. 真實 gesture 可刷新 browse。
5. identical pending request 共用 fetch。
6. stale active／queued request abort，舊結果忽略。
7. primary 呈現不等待背景。
8. background failure 不清除 primary。
9. search 清空後恢復 browse。
10. ALL browse provider attempts 有界、背景 concurrency 1。
11. canonical Place ID persistent miss + in-flight 只有一次 screen Details fetch。
12. typing 使用 debounce。
13. submit 立即執行。
14. hot-window 合法 foreground grant；首爾塔 direct pipeline 不 fan-out。

其中 debounce／submit 與 route/map callback wiring 包含 source assertion，並非完整 React browser E2E；其他測試直接執行 production guard/category/cache/presentation 模組與受控 provider。

`npm run verify:explore-native-search` 額外執行真正 native adapter 分支：hot-window grant、相同 query 去重、取消後同 key 新搜尋、10 suggestions 只發 1 autocomplete／0 Details。mock 的是 HTTP、server registration/auth 環境，不是 production adapter 邏輯；沒有連線 Google。

## J. Verification

| 檢查 | 結果 |
| --- | --- |
| 新 storm 14 scenarios | PASS |
| 新 native adapter fixture | PASS；fixture bundle 有 CJS import.meta 警告 |
| progressive search | PASS |
| shared Places request orchestration | PASS（含其他 foreground 使用者、runaway、provider quota protection） |
| city logic / offline recovery / canonical identity | PASS |
| release readiness / PIE facade | PASS |
| Favorites refresh race / signed photo surfaces | PASS |
| Favorites headless Chrome runtime | PASS |
| production build + release-artifacts | PASS |
| 本輪 16 個 request-storm code files targeted lint | 0 errors、7 warnings；仍有 hook dependency warnings |
| TypeScript | 未全綠：326 errors；既有 baseline 327，沒有新增 file+TS-code 類別，移除一項 route label error |
| 全專案 authored-source lint | 未全綠：8185 errors、70 warnings；排除 native/generated artifact/Python dependency directories。不能宣稱本 PR 通過全專案 lint |
| git diff --check | PASS |

先前已確認 `verify-explore-map-cache` 的 legacy Details key assertion 在 HEAD 同樣失敗；本輪沒有把它列為 PASS。此次改動已有 canonical/cache-miss/native fixture 補強，但不能據此宣稱所有歷史測試全綠。

本機 logs：`/tmp/roamie-storm-tests.log`、`roamie-native-search.log`、`roamie-storm-regressions.log`、`roamie-storm-favorites.log`、`roamie-storm-build.log`、`roamie-storm-tsc.log`、`roamie-storm-target-lint.log`、`roamie-storm-full-lint.log`。

Build 自動產生的 `src/generated/app-bundle-meta.ts` 已回復至原內容；沒有把 build metadata 混入修改。

## K. 首爾塔修正前後比較

| 情境 | 修正前 | 修正後 |
| --- | --- | --- |
| 冷 cache explicit submit | 可經 autocomplete／Details／選取狀態進入五分類；不同 queries 持續擴張 | submit 直接 Text Search；成功 primary 後不補整個城市 |
| autocomplete selection | Details 後 selected center 可恢復 ALL | 一個必要 Details，立即 primary；cache hit 可為 0 provider fetch |
| queued 25 工作 fixture | HEAD guard 實際放行 25，下一個 direct request_budget blocked | background 到 16 停止，foreground 成為第 17 次並成功 |
| 首爾塔 direct success fixture | 使用者 log 證明有阻擋，但無完整 session 計數，不能推定單次實機總數 | foreground=1、background=0、deduped=0、blocked=0、beforePrimary=1 |
| 同 query 兩個並行 caller native fixture | 舊 persistent miss log 無法代表 duplicate HTTP 數量 | foreground=1、deduped=1，只有一次 HTTP |

以上成功 fixture 無 retry；真實網路失敗可能重試，已逐 attempt 計數。輸入時已發出的 autocomplete 屬前一個 typing session；submit 會取消該 session 並新建 explicit session。驗收時要連同相鄰 session 看完整操作成本，不能只看 submit 一筆宣稱整段輸入只有一次請求。圖片 sign/proxy 另計。此次未取得新的實機 latency，`primaryResultMs` 留待下一次裝置 log 驗證。

## L. Git diff summary

目前累計包含第一輪未提交修正：24 個 tracked files 修改，1131 insertions、630 deletions；另有 8 個新檔（兩份報告、四支 verification scripts、request-session 與 search-presentation 模組）。`git diff --stat` 不包含 untracked 新檔，不能把 tracked stat 當成全部工作量。

改動集中在 route authority、shared guard、現有 caches/adapters，以及保留的 Favorites 圖片修正。沒有 commit、push 或 Archive。下一步由使用者重新實機驗收：檢查「首爾塔」session 的背景數是否為 0、primary 是否立即呈現、清空搜尋後 browse 是否恢復，以及 Favorites 圖片是否穩定載入。


## 最終 commit audit：BLOCKED（2026-09-23）

使用者回報本輪實機驗收通過，授權在 audit 無新增問題後建立單一 commit。最終 audit 額外驗證取消後 response completion ordering，發現以下缺口，因此**未建立 commit，也未在此輪自行修改功能邏輯**。

### 阻擋問題：已取消的舊搜尋仍可覆寫較新 cache

`src/lib/places-search-dedupe.ts` 的 `getPlacesSearchCachedOrRun` 會跳過已取消的 in-flight Promise，允許新的同 key 請求開始；但舊 Promise 的 `.then()` 在寫 `writeUnifiedPlaceSearchCache` 前沒有檢查 `options.signal.aborted`。因此 completion 順序可以是：

1. 舊請求 A 開始。
2. abort A；同 key 新請求 B 開始。
3. B 完成，cache 寫入 `new-result`。
4. A 的 transport 未取消或已完成傳輸、稍後才 resolve，cache 被改寫成 `old-result`。
5. 再次搜尋同 key 直接讀到 `old-result`，不發 provider request。

這不是宣稱舊結果直接穿過 route requestId guard 覆蓋當前 UI；問題在共用 cache，會污染後續搜尋。browser server transport 沒有把 session AbortSignal 傳進 `serverFn`，因此不能依賴 fetch 一定 reject 來避免這種順序。

受控重現執行真實 `getPlacesSearchCachedOrRun`，輸出：

```json
{"freshResult":"new-result","cachedAfterCancelledResponse":"old-result","thirdProvider":0,"passed":false}
```

重現檔：`/tmp/roamie-final-cache-audit.mjs`，只 mock runner completion，沒有呼叫 Google。前文 G 的「aborted 結果不寫 cache」僅在 unified Details/map cache 成立，對 search cache 的概括不正確，以本段 audit 更正。

需補的修正與 regression：搜尋 cache 在 success 寫入與 failure 標記前檢查取消狀態；驗證 B 先完成、A 最後完成時 cache 仍為 B，以及 cancelled failure 不污染後續 retry。依使用者「發現新增 regression 先停止並回報」要求，本轮沒有直接套用修正或提交。

### 已完成的重新驗證

- PASS：14 項 Explore request-storm scenario、progressive rendering（含 stale guard）、shared Places orchestration、native adapter、offline recovery、city logic、canonical Place identity、release readiness、PIE facade、Favorites refresh race、signed photo surfaces、photo security、photo proxy、production lifecycle logging、Favorites headless Chrome runtime。
- PASS：production build（含 Capacitor prepare 與 release-artifacts）、git diff --check。
- `verify-explore-map-cache`：working tree 與獨立 HEAD snapshot 均在同一 legacy key assertion 失敗（預期 `|detail|zh-TW`，實際 `details|ChIJx123|zh-TW|screen_v1`），非本次新增。
- TypeScript：HEAD 327，working tree 326。按完整訊息比對並排除行號與 inferred type 的 `... N more ...` 欄位數變動後，新增 diagnostics 為 0；兩項 radius 型別問題在 HEAD 同樣存在。
- 全 authored-source lint：HEAD 8236 errors / 71 warnings；working tree 8185 errors / 70 warnings。以檔案、rule、完整 message 與出現次數比較，新增 diagnostics 為 0。六個新 code/test files lint 皆無 errors/warnings。沒有為消除既有 diagnostics 修改無關檔案。
- 測試中的 fixture IDs／controlled timing 僅在 scripts，不是 production hardcode。新 production delay 為既有 debounce contract，沒有靠新增任意等待掩蓋 storm。
- diagnostics：逐筆 ledger/provider/cache access 已經 verbose-gated；保留 structured lifecycle。此次未清除 telemetry contract，也未因清 log 改動正式邏輯。

### Working tree 與 artifacts

- 累計修正仍是 24 個 tracked files，加 8 個新 code/test/document files；均屬本次要求的範圍。
- 本輪開始時另有 generated bundle metadata 與重複 `ios/App/App/config 2.xml`；後者已逐 byte 確認與 `config.xml` 相同。兩者先備份至 `/tmp/roamie-final-audit-backup`，metadata 回復 HEAD，重複檔移出 repository。production build 後再次回復 generated metadata。
- 沒有 dependency/lockfile/Pods 人工修改，沒有把 build artifacts、DerivedData、Archive 加入 diff。
- 未 staging、未 commit、未 push、未 Archive；working tree 保留修正，**不是 clean**。

Logs：`/tmp/roamie-final-*.log`，lint JSON：`/tmp/roamie-final-lint-{head,working}.json`，測試 exit codes：`/tmp/roamie-final-regression-results.json`。
