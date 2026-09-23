# Final Release Audit — HOLD

使用者已回報最新實機 PASS。本次 audit 不否定該驗收結果，但補充的 completion-order 與 adapter-provenance 測試發現兩項 release-critical 缺口，因此目前不建議 commit / release。沒有新增功能、UX、review extraction 或分類規則；僅清理診斷、移除已確認 generated 複本、加入失敗重現與此報告。

HEAD：`0acaf2e4ca39ca20b68687f972adffd855a7e7bc`。

## 阻擋項目

### R1 — 已取消搜尋仍覆寫新 cache（前輪已記錄，本輪再確認）

`src/lib/places-search-dedupe.ts:141` 的 completion handler 在寫入 search / per-place cache 前沒有檢查 signal 或 pending owner。取消後同 key 新請求可以啟動，finally 的 ownership guard 卻只防止刪錯 promise，沒有防止舊 response 寫回。

受控結果：`fresh=new-result → cancelled old completes → cached=old-result`，下次讀取沒有 refetch，直接取得舊結果。route 的 stale render guard 無法修復已污染的 cache。此為 release blocker，不因 storm 14 項通過而略過。正式功能未在 audit 中修改。

### R2 — Normalizer 將 types[0] 冒充 provider primary identity（本輪新發現）

`src/lib/ai/normalize-google-place.ts:125`：`raw.primaryType ?? raw.type ?? types[0]`。

provider 缺 primaryType、name=`Example Sky Bar`、types 相同僅順序不同：

| types | normalizer 產生的 primaryType | reason identity |
|---|---|---|
| breakfast_restaurant, bar, restaurant | breakfast_restaurant | 早餐店 |
| restaurant, bar, breakfast_restaurant | restaurant | 酒吧 |

Canonical classifier 正確尊重「primary」後，反而把 adapter 合成的第一個 type 當成 Google authority。既有 45 項直接 classifier 測試未涵蓋這條 normalize → classify 的順序不變性。這不是實機 Stellar response 的推測，也沒有 hardcode 店名；是一般 provider-missing-primary case 的確定性整合缺口。

新增 `scripts/verify-release-authority-boundaries.mjs` 同時保留兩項 FAIL；零 provider requests。執行：

```sh
node_modules/.bin/vite-node --config scripts/vite.verify.config.mjs scripts/verify-release-authority-boundaries.mjs
```

## A — Working tree 統計

**83 檔；+6931 / −2916**（含 untracked 檔案）。

開始時 84 檔。清理 generated metadata 與兩份重複 config（3 檔），新增 boundary regression 與此報告（2 檔）。數字含既有全部未提交 source/tests/docs，非只有本次清理。Additions/deletions = tracked diff numstat + untracked text files 的完整行數。

## B — 完整檔案邊界與分組

每檔列一次，按主要責任分組；跨組依賴：Places masks/cache 同時服務 Explore、Reviews、Identity；Itinerary schema/handoff 保存 review evidence；Map cards 同時接 progressive loading 與 canonical renderer。

### A. Explore Search / Places request orchestration（20 檔）

- `src/components/GoogleMap.tsx`
- `src/components/map/GoogleMapBackground.tsx`
- `src/components/map/MapExplorePlaceCards.tsx`
- `src/lib/explore-category-search.ts`
- `src/lib/explore-city-popular-places.ts`
- `src/lib/explore-map-search.ts`
- `src/lib/explore-primary-place.ts`
- `src/lib/explore-recommend-mode.ts`
- `src/lib/explore-request-session.ts`
- `src/lib/explore-search-presentation.ts`
- `src/lib/explore-selected-place.ts`
- `src/lib/map-places-cache.ts`
- `src/lib/places-api-guard.ts`
- `src/lib/places-search-dedupe.ts`
- `src/lib/places-search-unified.ts`
- `src/lib/trip-stop-search-unified.ts`
- `src/lib/unified-place-cache.ts`
- `src/routes/_app.map.tsx`
- `src/services/placesService.ts`
- `src/services/requestCache.ts`

### B. Favorites image loading / cache（4 檔）

- `src/components/saved/SavedPlaceCoverThumb.tsx`
- `src/hooks/use-place-image.ts`
- `src/services/placeImageService.ts`
- `src/services/signed-place-photo.ts`

### C. Recommendation Reason Authority（18 檔）

- `src/components/MapPlacePreview.tsx`
- `src/components/PlaceRecommendationReason.tsx`
- `src/components/RoamieResponseView.tsx`
- `src/components/home/HomeNearbyPlaceCards.tsx`
- `src/components/map/PlaceDetailSheet.tsx`
- `src/lib/ai/meal-intent-parser.ts`
- `src/lib/ai/service.server.ts`
- `src/lib/build-place-recommendation-reason.ts`
- `src/lib/chat-session.ts`
- `src/lib/enrich-roamie-places.server.ts`
- `src/lib/place-detail-resolve.ts`
- `src/lib/place-reason-diversity.ts`
- `src/lib/recommendation-display-locale.ts`
- `src/lib/recommendation-place-handoff.ts`
- `src/lib/recommendation/merge-verified.server.ts`
- `src/lib/recommendation/place-intro.ts`
- `src/lib/trip/trip-itinerary-place-handoff.ts`
- `src/lib/unified-place-card.ts`

### D. Review Evidence runtime / propagation（12 檔）

- `src/lib/ai/itinerary-candidate-recovery.ts`
- `src/lib/ai/itinerary-deliverable-stop.ts`
- `src/lib/ai/itinerary-google-identity.ts`
- `src/lib/ai/itinerary-validator/from-payload.ts`
- `src/lib/ai/types.ts`
- `src/lib/google-maps-api.ts`
- `src/lib/itinerary.functions.ts`
- `src/lib/place-result.ts`
- `src/lib/place-review-evidence.ts`
- `src/lib/place-runtime-cache.ts`
- `src/lib/places.functions.ts`
- `src/lib/trip/trip-place-input.ts`

### E. Opening Hours（2 檔）

- `src/lib/filter-available-places.ts`
- `src/lib/normalized-opening-status.ts`

### F. Place Identity / semantic classification（2 檔）

- `src/lib/ai/normalize-google-place.ts`
- `src/lib/place-identity.ts`

### G. Regression / verification scripts（17 檔）

- `package.json`
- `scripts/fixtures/place-identity-live.json`
- `scripts/verify-explore-native-search.mjs`
- `scripts/verify-explore-progressive-search.mjs`
- `scripts/verify-explore-request-storm.mjs`
- `scripts/verify-favorites-photo-runtime.mjs`
- `scripts/verify-opening-layout-localization.mjs`
- `scripts/verify-p22-recommendation-reason-persistence.mjs`
- `scripts/verify-place-detail-device-regressions.mjs`
- `scripts/verify-place-identity-multispecific.mjs`
- `scripts/verify-place-identity-runtime.mjs`
- `scripts/verify-place-reason-diversity.mjs`
- `scripts/verify-recommendation-reason-authority.mjs`
- `scripts/verify-recommendation-reason-template-pipeline.mjs`
- `scripts/verify-recommendation-review-browser.mjs`
- `scripts/verify-recommendation-review-runtime.mjs`
- `scripts/verify-release-authority-boundaries.mjs`

### H. Diagnostics / audit documents（8 檔）

- `docs/explore-favorites-loading-diagnosis.md`
- `docs/explore-request-storm-diagnosis.md`
- `docs/final-release-audit.md`
- `docs/place-identity-multispecific-audit.md`
- `docs/place-identity-runtime-diagnosis.md`
- `docs/recommendation-reason-authority-audit.md`
- `docs/recommendation-review-runtime-diagnosis.md`
- `src/lib/recommendation-reason-trace.ts`

### I. Generated / unrelated files（0 檔）

清理後無未提交 generated/native/unrelated 檔案。

## C — 無關修改與檔案清理

發現並處理：`src/generated/app-bundle-meta.ts` 為 build metadata；`ios/App/App/config 2.xml`、`config 3.xml` 與正式 `config.xml` 逐 byte 相同（SHA-256 `e9dcda493e663c5c4db9e3cb3bd968477a6e90aa8840bcbba40d72ed54b767ce`）。已備份至 `/tmp/roamie-release-cleanup-backup`，metadata 還原 HEAD、兩份複本移除。production build 後再次還原 metadata。

其餘 source diff 可追溯至 Explore/Favorites、canonical reason、runtime review、hours、identity 的已驗收需求。既有檔案中的 formatting 變動保留，未額外全面 format。package.json 僅增加 verification commands，無 dependency/version/lockfile 修改。未見未提交 Pods、Xcode project、DerivedData、Archive 或不明來源功能差異。

## D — Diagnostics cleanup

- 移除 `HomeNearbyPlaceCards` 每次 props 更新對每張卡輸出的 `HOME_NEARBY_IMAGE_INPUT` effect。
- 移除 canonical builder 每次計算都輸出的重複 `RECOMMENDATION_REASON_RESOLVED`；保留更完整且去重的 reason trace。
- Explore session、hydration、route/category/search/selection、provider mapping、photo signing 的 info/debug 改走既有 `devVerboseInfo`，正常 production 不輸出。保留真正 error/warn 與既有 lifecycle telemetry。
- `RECOMMENDATION_REASON_TRACE` / `PLACE_IDENTITY_TRACE` 原有明確 scoped opt-in 或 verbose gating、最多 120 signature entries、相同 place/surface/內容去重，繼續保留；schema 僅儲存 topic/count/confidence/rejection reason，沒有完整 review text 或 review author 個資。
- 本地 `.env` 的 debug flag 不在 production public-env allowlist；production-build 會暫時隱藏 `.env`，本次 shell 也沒有開啟 verbose/debug env，因此這次 production build 的一般 verbose path 關閉。
- 所有清理僅影響輸出與診斷 effect，未改 cache、request、budget、reason、identity 功能邏輯。

## E — Final authority

| 領域 | Authority 與結論 |
|---|---|
| Search / Browse | ExploreRequestSession + route lifecycle，category entry 使用 canRunExploreBrowse；explicit search 不啟動 ALL |
| Request budget / priority | places-api-guard 統一 dispatch admission / concurrency queue；20 window 上限未提高；background 16 reserve、concurrency 1，總 concurrency 2；foreground grant 保留 runaway/provider protection |
| Stale / dedupe | route requestId/session abort、provider pending、capability cache 各負責不同層級；沒有另一套 budget，但 search-cache completion 邊界缺失（R1） |
| Favorites | 既有 image service/request cache → signed photo URL authority；逐卡獨立 hook，卡片 render 不等待圖片 |
| Reason | buildPlaceRecommendationReason 為正式 prose builder；generatePlaceReason、diversity、metadata、intro、handoff 皆轉接。legacy collectPlaceReasonEvidence 仍供 ranking/availableCodes，已不生成第二套 prose |
| Evidence | place-review-evidence 擷取 → screen_reviews_v2 capability cache → runtime projection → reactive renderer；空 reviews sample 亦可快取，無每-render fetch |
| Hours | normalized-opening-status.placeReasonHours 生成事實補充；營業狀態/排程仍使用既有 hours normalization，非另一套 identity inference |
| Identity | place-identity classifier 為 semantic authority；但 normalize-google-place 仍會合成 primary，故不能宣稱 provider authority 已完全一致（R2） |

UI category chips / search-intent categories 與 semantic identity 是不同用途，不應合併成同一 classifier。仍需先關閉 R1/R2 才能宣告全部 authority 完整通過。

## F — Regression 結果

共 41 個不同 suites/checks：36 PASS、4 組 HEAD 既有 FAIL、1 組新 boundary regression FAIL（2 cases）。Opening layout 初次被 sandbox 限制 Chrome 啟動，允許本機 Chrome 後 PASS，未算作功能 failure。

| Suite | 最終結果 |
|---|---|
| explore-request-storm | PASS |
| explore-progressive-search | PASS |
| places-request-orchestration | PASS |
| explore-native-search | PASS |
| explore-offline-recovery | PASS |
| explore-city-logic | PASS |
| favorites-refresh-race | PASS |
| signed-place-photo-surfaces | PASS |
| place-photo-security | PASS |
| place-photo-proxy | PASS |
| recommendation-reason-authority | PASS |
| recommendation-review-runtime | PASS |
| place-identity-runtime | PASS |
| place-identity-multispecific | PASS |
| place-detail-device-regressions | PASS |
| place-detail-opening | PASS |
| canonical-place-identity | PASS |
| places-cost-cache | PASS |
| place-recommendation-authority | PASS |
| p22-recommendation-reason-persistence | PASS |
| itinerary-core | PASS |
| p35-server-google-identity | PASS |
| p38-deliverable-rebuild | PASS |
| place-reason-diversity | PASS |
| recommendation-reason-template-pipeline | PASS |
| plus-personalization-v1 | PASS |
| credits | PASS |
| plus-entitlement | PASS |
| itinerary-insufficient-credits | HEAD / current 均 FAIL；見 I |
| itinerary-regression | HEAD / current 均 FAIL；見 I |
| place-detail-chat | HEAD / current 均 FAIL；見 I |
| explore-map-cache | HEAD / current 均 FAIL；見 I |
| general-recommendation-opening-hours | PASS |
| opening-layout-localization | PASS |
| production-debug-boundary | PASS |
| production-lifecycle-logging | PASS |
| pie-facade | PASS |
| release-readiness | PASS |
| recommendation-review-browser | PASS，四個 mounted renderers 更新；hotel reviews/hours 保留；0 fetch |
| favorites-photo-runtime | PASS，獨立載入/cache/圖片失敗隔離 |
| release-authority-boundaries | FAIL 0/2：R1、R2 |

重點 scenario：storm 14、reason authority 30、review runtime 23、identity runtime 28、multi-specific 45 均 PASS。新 boundary suite 的 FAIL 不被這些 PASS 抵銷。實機 PASS 是使用者驗收結果，本機 browser/provider fixture 不冒充新實機測量。

## G / H — Build 與 diff

`npm run build` PASS，含 release-artifacts（2 artifact roots）。`git diff --check` PASS。

仍有 mixed static/dynamic imports、chunk-size warnings；不是 TypeScript clean build 宣告。native fixture 有既有 CJS import.meta warning。Build 沒有 push、Archive；ignored dist 為驗證產物，不納入 commit。

## I — HEAD vs current 精確診斷比對

HEAD 使用 `git archive HEAD` 建立 `/tmp/roamie-release-head` 獨立 snapshot，共用同一 node_modules，不修改工作檔案或 git index。

| 項目 | HEAD | Current | 差異判定 |
|---|---:|---:|---|
| TypeScript | 327 | 321 | 321 項逐一對到同檔、同 source statement/映射位置、同 TS code；新增 0、移除 6 |
| ESLint authored src/scripts errors | 8236 | 7945 | 依相對路徑、ruleId、severity、完整 message、occurrence 比對；新增 0 |
| ESLint authored src/scripts warnings | 71 | 70 | Hook message 只有 source 行號變動先正規化；新增 0 |

TypeScript 的部分展開型別文字因 reviewEvidence 欄位、union 順序、absolute snapshot path 改變，已檢查對應診斷及 leaf cause（如同一 nullable string、不存在屬性、radius 缺欄），未把字串变化誤當新錯誤，也未只用總數或 file+code 數量判定。完整一對一對照：`/tmp/roamie-release-ts-comparison.json`；lint occurrence delta：`/tmp/roamie-release-lint-comparison.json`。Lint 範圍為全部 src/scripts authored source，包含本批每個修改 code/test；未將 native/generated/依賴資料夾的噪音混入。

既有失敗逐一重跑 HEAD：

- itinerary-regression：HEAD/current 均 10 個 failure；failure 名稱及完整 failure blocks 相同，涵蓋 landmark dedupe、sparse itinerary、chat flow 與 real-pool gate。
- itinerary-insufficient-credits：同一 `insufficientCredits ? 402 : 500` 舊 source-regex assertion。credits、plus-entitlement 本身 PASS；不為了這次 audit 改無關 regex。
- place-detail-chat：同一 .mjs 中 TypeScript syntax 造成 parser error。
- explore-map-cache：同一 legacy `/\|detail\|zh-TW$/` expectation 不符；HEAD key 是 `screen_v1`，current 為本次 reviews capability `screen_reviews_v2`，不是相同 actual string；兩者均不符合舊 key-format assertion。新版 cache/review/native capability tests 通過。

R1/R2 是新增 audit contract 測試，HEAD 沒有該 suite，不能歸類成 harmless baseline failure。

## J — Release-critical 行為

- 已驗證：foreground primary progressive display、bounded browse、explicit search suppression、dispatch-time capacity/foreground protection、same-key dedupe、map gesture/programmatic 分離。
- 已驗證：Favorites 卡片不等圖片、獨立成功/失敗/cache reuse。
- 已驗證：reviews 入 reason、hours 保留、generic → hotel upgrade 保留 reviews/hours；canonical building 不增加 provider request。
- 既有 controlled cases：Stellar 酒吧、karaksa 飯店、85°C 咖啡廳、Amor/糖村 蛋糕店 PASS；使用者另已回報實機 PASS。
- 尚未通過：取消後 cache completion（R1）、provider 缺 primary 時 adapter type-order invariance（R2）。因此 stale protection / identity authority 的最終 release check 為 HOLD。

本輪所有新增 verification 使用本地 mocks/fixtures，沒有新增 Google API request。累積修正的 screen Details 增加 reviews capability，既有 Intro/screen fetch 共用；這是先前已驗收的必要資料取得，不是本輪 audit 新增流量。

## K — Diff hygiene

未發現本批新增 production Stellar/karaksa/85°C/Amor/糖村 hardcode、test-only bypass、dependency/Pods 人工改動、commented-out experimental production path 或新增 arbitrary timeout。Controlled business fixtures 僅在 regression。Explore 320ms 為輸入 debounce；provider retry / pagination 等等待有原本節流語意，沒有以等待時間掩蓋分類或 loading。

新增兩項失敗測試是刻意保留的 release gates，不是把期望改成錯誤行為來做綠燈。所有歷史 audit documents 為診斷沿革，最終狀態以本報告為準。

## L — Commit strategy

建議 **單一 coherent release-stability commit**，但必須先修復 R1/R2 並完成相應驗證，再另行取得 commit 指示。本批從 Explore provider owner/cache、screen_reviews_v2、PlaceResult/itinerary schema、canonical reason、reactive renderer 到 semantic identity 相互依賴；中途拆開可能讓 consumer 缺 evidence、舊 cache capability 被誤用或退回舊 reason authority。Favorites 可理論上獨立，但也共用 runtime/request cache，為 history 外觀拆分沒有明顯安全收益。

建議 title：`fix: stabilize place loading and recommendation authority`。目前沒有 stage 或 commit。

## M — Git status / 停止點

Working tree 非 clean：60 tracked modified、23 untracked，staged=0；共 83 檔。Generated/native duplicates 已排除。

未 commit、未 push、未 Archive。依使用者指示在 audit 回報後停止，不自行修正兩個功能 blocker。完整原始 logs / baseline 在 `/tmp/roamie-release-*`；相關讀取與驗證不含真實 Google review 全文。
