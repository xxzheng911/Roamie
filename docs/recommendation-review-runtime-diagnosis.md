# Recommendation reviews runtime 修正（2026-09-23）

## A. reviews 消失層與診斷範圍

已重現三個獨立缺口；沒有裝置上的本次 trace，不能宣稱每個實機地點都必然同一原因：

1. **Cache capability**：舊 `screen_v1` 的 hit validator 只驗證 id/name/coordinates，沒有 reviews capability；handoff 會直接 return，provider 不會被呼叫。前輪加入 field mask 沒讓舊 persisted details 升級。
2. **Extraction**：用真正 Google Places 台北101觀景台 response（5 則、都有 localized text），原 extractor sampleSize=5 但 signals=[]。詞彙規則缺少「視野絕佳／開闊／遼闊」等同義語意，不是 normalization 把文字全丟掉，也不是要求三則才接納。
3. **Hours**：screen mapper 沒保存 currentOpeningHours，intro mapper 也未完整保存 hours；reason hours 只讀 regular schedule，且只辨識 24 小時數字格式。只有 current schedule、上午／下午、AM/PM、全形星期分隔符或 periods-only 的資料會缺句。

原 formatter 單一 mention 本來就可接受，這次沒有把 threshold 降到無 evidence，也沒有更換 reason 文案。

## B. Controlled trace（真正 provider response）

以現有 Google Places key 執行一次 Text Search 定位、一次 Details 請求。只對一個地點，未重複要求更多評論。原始 response 僅留本機暫存，未加入 repo、未把原文或作者寫入 diagnostic。

- placeId：`ChIJSTLZ6barQjQRMdkCqrP3CNU`
- placeName：台北101觀景台
- response locale：zh-TW
- rawReviewsCount：5
- normalizedReviewsCount：5
- reviewsWithTextCount：5
- 修正前：sampleSize=5，signals=[]。
- 修正後 candidateSignals：view/supportCount=3、queue/supportCount=1。
- acceptedSignals：view / positive / supportCount=3 / strong / high。
- rejectedSignals：queue/supportCount=1，negated_conditional_or_quoted；不把「不用排隊」當成需排隊。
- placeType：tourist_attraction；semantic identity 為展望台。
- openingHoursAvailable=true；openingHoursRendered=true；ratingAvailable=true；reviewCountAvailable=true。
- reasonEvidenceSources：place_identity、google_review_sample、opening_hours。

Final reason：

> 這是一座展望台，可取得的評論中，有多則一致提到景色受到好評。今天 10:00–21:00 營業。

實際網路 response 隨後透過正式 `fetchPlaceDetailsForScreenWithKey` adapter 重播驗證 mapping → extraction → cache → builder；這是 captured live response replay，不冒稱新一輪裝置驗收。Trace 可用以下命令重播（raw 檔案不提交）：

```sh
node_modules/.bin/vite-node --config scripts/vite.verify.config.mjs scripts/verify-recommendation-review-runtime.mjs --response=/tmp/roamie-live-review-response.json
```

## C. Google response schema

實際 reviews[] 包含 name、rating、text、originalText、authorAttribution 等；text 與 originalText 都是 `{ text, languageCode }`。讀取 `review.text.text`，若空白／缺少则讀 originalText.text；不是任意猜 `localizedText` 或 legacy string 欄位。rating 和 author 不是保留文字的必要條件。

此結果與 [Google Places Review / LocalizedText 官方 schema](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#Review) 一致。Native client 與 web/server 共用 `fetchScreenDetailsNetwork`、同一 reviews field mask 與 screen mapper；沒有另一路 native JSON normalization 丟棄 reviews。尚未在使用者裝置直接擷取 response。

## D. Capability upgrade

- 新 Detail capability `screen_reviews_v2`；保留 legacy `screen_v1`／其他 cache，不粗暴清除。
- `reviewEvidence.extractionVersion=2` 標記本輪 extractor capability；validator 同時驗證 evidence schema 與 canonical ID。
- 空 sample 也表示已完成 capability request，不因 acceptedSignals=0 反覆抓 API。
- TTL 統一使用既有 screen 30 分鐘，而非原 generic get-or-fetch 的 24 小時預設。
- Handoff concurrent callers 共用 pending promise；Intro 也委派至同一 screen request/cache，避免兩條網路路徑同時抓。
- Detail cache 不再要求 photo/rating 完整才保存 review capability，合法缺圖也能重用。
- Runtime projection 不會被舊 extraction-version payload 降級覆蓋。
- 這是按開啟地點的必要升級，沒有 list/card fan-out、budget 提升、render fetch 或 timer refresh。TTL 過期、失敗後重試、locale 改變仍遵循原 cache 邊界，並非永久只允許一個請求。

## E. Evidence normalization / strength

保留 single=1、multiple>=2、strong>=3 且無反向訊號及 sample 內一致性條件。加入明確同義詞：提供插座／座位旁插座、焗烤推薦／最喜歡焗烤、附近停車場，以及視野絕佳／開闊／遼闊等。topic 合併後按獨立評論支持數計算；重複作者／review ID／同文仍去重。保留否定、条件及引述 guard。

仍為有限 phrase-based extractor，未宣稱能理解所有自然語言或反諷；不認識的特色省略。未新增 LLM 或以 type 猜特色。

## F. Hours

保留 current + regular schedules 與 utcOffsetMinutes；優先 current weekday descriptions，支援中文上午／下午、English AM/PM、全形分隔符、明確同日 periods fallback。closed_now 不等於今日公休；未知時省略。畸形 optional hours 不得使整個 reason throw 或影響 sibling card。

受控 101 response 的當日文字本身是 10:00–21:00，故該地點 hours 原本可解析；其他 hours 缺口用獨立 regression 重現，不把推測當作這個真實 sample 的觀察。

## G. Cold/stale reason

Structured evidence 仍優先於 persisted reason。Detail enrichment 成功後更新既有 runtime projection，renderer derive current reason。

Renderer 改用 `useSyncExternalStore`，讓 React 在訂閱後檢查 snapshot，涵蓋 render/subscribe 交界更新。Chrome 實際掛載四份 production renderer：cold identity → cache enrichment event → 四份都更新為相同 review + hours，0 provider requests。這驗證共用 renderer，不等同四條完整 route 的裝置 E2E。

測試初次 failure 是 harness HTTP 未標 UTF-8 charset，導致中文字串與 regex 的解碼不同；已修測試 server。正式 Capacitor HTML 本來有 UTF-8 meta，未將測試編碼問題誤列為產品 root cause；也未證明舊 effect 在使用者裝置確實漏事件。

## H. Scoped diagnostic

`RECOMMENDATION_REASON_TRACE` 包含 requested counts、candidate/accepted/rejected topics、support/strength/confidence、rejection reasons、type、hours/rating/count availability、evidence sources、surface、finalReason。未取得 review capability 時 count 為 null，不偽裝成 provider 回傳零則。

沿用 verbose/debug gate，也可針對一個 Place ID 開啟：

```js
localStorage.setItem("roamie:reason-trace-place-id", "ChIJSTLZ6barQjQRMdkCqrP3CNU")
// 關閉
localStorage.removeItem("roamie:reason-trace-place-id")
```

同 Place/surface 相同 trace 去重，記錄容量有上限；沒有 raw review text、作者或 API key。Production 預設不輸出，scoped enabled 僅指定地點。

## I. 本輪修改

- `src/lib/place-review-evidence.ts`：extraction version、normalization counts、topic synonyms、reject metadata。
- 新 `src/lib/recommendation-reason-trace.ts`：安全 scoped trace。
- `src/lib/build-place-recommendation-reason.ts`：接入 trace、optional malformed hours isolation；文案模板不變。
- `src/lib/unified-place-cache.ts`、`places.functions.ts`、`place-detail-resolve.ts`、`place-runtime-cache.ts`：capability upgrade、single-flight、Intro 共用、projection 防降級。
- `src/lib/place-result.ts`、`filter-available-places.ts`、`normalized-opening-status.ts`：current hours handoff 與解析。
- `src/components/PlaceRecommendationReason.tsx`：external-store 訂閱。
- 新 runtime / browser verification scripts、package commands、本診斷文件。

## J–K. Regression

新增 runtime suite 23 項：raw/normalized/text counts、Google localizedText、single weak wording、語意等價、獨立支持強度、final reason、current hours、cold identity、persisted legacy cache 升級、四 surface + Intro concurrent single-flight、stale reason recompute、缺圖仍 cache、cross-surface evidence、20 次 recompute 零額外請求、不清其他 cache、originalText fallback、否定 guard、trace 不含原文、AM/PM、period-only hours，以及 native client 空評論 response 重用、不重抓。

Chrome mounted renderer cold→enriched：PASS；四份同核心、0 requests。

既有 authority 30 scenarios、Explore storm 14 scenarios、Places orchestration、progressive search、native adapter、Place Detail device/opening、general hours、P22 persistence、Favorites refresh race、reason diversity/template regression：通過。完整 route 實機驗收仍待使用者重新測試。

## L. Build / diagnostics

Production build / postbuild / release-artifact verification：PASS。`git diff --check`：PASS。

TypeScript 全專案仍 321 項既有 diagnostics，與本輪前按檔案／TS code 比對無新增。修改檔案 scoped lint 剩 7 項既有 formatting errors，無新增 diagnostics。不是全專案 lint/typecheck 綠燈；前輪既有測試限制仍見上一份 audit。

Build 仍有 mixed static/dynamic imports 與 chunk size 類 warnings。Generated bundle metadata 已還原；重現的完全相同 config 2.xml 另留暫存備份後移除，未納入 diff。前輪 cancelled-search cache race 不屬本次修正，仍待獨立處理。

## M. Diff / delivery

本輪觸及 16 個檔案（含前輪新增檔案的再修改，以及歷史 audit 狀態註記）。

整體 working tree：75 檔，+5269 / −2633（含 untracked source/tests/docs）。此統計包含前兩輪未提交修改，不能全算成本輪新修改。未 commit、未 push、未 Archive；staged files=0，working tree 保留修改待實機驗收。
