# Recommendation Reason Authority audit

> 此為上一輪紀錄，後續實機驗收 FAIL。新 runtime root cause、controlled trace 與修正請見 [Recommendation reviews runtime 診斷](recommendation-review-runtime-diagnosis.md)。

## 修改前確認（2026-09-23）

- Home/Explore：`buildUnifiedPlaceCard(s)` → `buildDiversePlaceRecommendationReasons` → `assignDiversePlaceReasons`。`collectPlaceReasonEvidence` 沒有 reviews；late_hours/popularity/review_count/rating 在主要 evidence tier，且 batch `used` 使同一地點因同批其他地點不同而改理由。
- Search primary 使用 unified card；map detail 又接受 `place.reason || generatePlaceReason`。單筆 `generatePlaceReason` → `buildPlaceRecommendationReason` 是另一條 identity template path；categoryIntent 甚至能把真實餐廳改成 shopping_mall。
- 全域 Place Detail（Nearby、Search、Favorites、Chat、Itinerary handoff）走 `resolvePlaceDetailReasonWithSource`：保留傳入 reason，否則 `buildPlaceMetadataReason` 只用評分、評論數、營業時間。`mergeFetchedPlace` 預設保留舊文案，取得完整資料也未重建 reason。
- Chat `mapPlaceResultToChatItem` 接受外部 ctx.reason；batch 走 diversity；AI payload 自带 reason/reasonSource。`normalizeRecommendationItem` 只保留文字。Planner 經 recommendation mapper；Itinerary 保存文字 recommendationReason，handoff 不保存評論 evidence。
- `PLACE_DETAILS_FIELD_MASK`（intro）已含 reviews；intro mapper 只留下前三段文字，`buildPlaceIntroFromFacts` 直接拼最多兩段，並錯標 rich deterministic intro 為 ai。`PLACE_DETAILS_SCREEN_FIELD_MASK` 不含 reviews；列表 search field mask 也不含 reviews。現有 PlaceResult 沒有 canonical review evidence。
- 既有 `recommendation/engine/reasons.ts` 是排序分數解釋碼，不是 Place prose authority；不改 ranking。
- 既有 Chat/Planner LLM 可以產生 reason，但本地 formatter/diversity/intro 都是 deterministic，沒有每 render 呼叫 LLM。應使地點推薦 prose 在輸出邊界回到 canonical evidence formatter，不把 LLM 字串當已驗證 evidence。

Root cause：評論 sample 在 intro 支線，未流入共用 Place evidence；多個 formatter 與文字 fallback authority 並存，priority 和 batch diversity 又偏向 hours/rating/popularity。

## 實作方向

擴充既有 `buildPlaceRecommendationReason`；review extraction 是其 structured evidence 模組，不建立第二個 reason engine。Detail 在原本必要的單次 screen request 取得 review sample；不對每張 search/browse card 補 Details、不新增 review fetch。使用既有 canonical Place cache/runtime cache 與可序列化 evidence，same snapshot 保持相同核心理由。短／標準／詳情只改呈現長度。原有 request-storm、Favorites 修改與已知 cancelled-search cache audit issue 保留，不偷偷混入前輪修復。

Google 官方文件：每個 Place 最多回傳 5 則相關評論，不代表全體評論；reviews field 屬 Enterprise + Atmosphere。加入既有 screen Details mask 不增加請求數，但會改變該請求的計價級別。

- https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places
- https://developers.google.com/maps/documentation/places/web-service/data-fields


## A–D. 原有架構、問題與 surface 差異

| Surface / pipeline | 原 authority | 根本問題 |
|---|---|---|
| Home Nearby、Explore Browse/Search | unified card → diversity evidence selector | hours/popularity 優先，沒有 review signals；同批其他卡片影響文案 |
| Map preview / Explore Detail | 傳入 reason 或單筆 generatePlaceReason | 單筆與 batch 模板不同 |
| 共用 Detail：Search / Nearby / Favorites / Chat / Itinerary | handoff 文字 → metadata fallback | 保存舊字串；完整 Details 抵達也不重新建立 evidence reason |
| Chat / Planner recommendations | LLM JSON、mapper、server verified merge | AI prose 可覆蓋 deterministic fallback；有限 claim blacklist 不等於 facts verification |
| Itinerary / trip persistence | recommendationReason 字串 | evidence 沒有穿過保存、恢復與 delivery schema |
| Place intro | Details 的前三則文字，直接拼接兩則 | reviews 只在支線；未抽取獨立支持數，deterministic intro 卻標示 ai |

原始 call graph：

```text
Search/Nearby Google Place (無 reviews)
  → PlaceResult → unified card → diversity selector → list reason
  → handoff 字串 → Detail metadata fallback
Intro Details (有 reviews)
  → 前三段 review text → 直接引用 intro（獨立支線）
LLM Chat/Planner → freeform reason → merge/persistence → 另一種字串
```

真正 LLM 呼叫在 `ai/service.server.ts`；formatter、diversity、intro 是 deterministic。此次没有新增模型呼叫，也不向 LLM 傳送 raw reviews 來自由摘要。

## E. 單一正式入口

延用 `buildPlaceRecommendationReason`，`generatePlaceReason`、batch diversity、unified card、Detail、intro、Chat/Itinerary normalizers 均委派至此。

```text
既有必要的 screen Place Details request（reviews mask）
  → extractPlaceReviewEvidence
  → PlaceResult.reviewEvidence + canonical Google Place ID
  → 既有 unified Details cache / runtime projection
  → Chat / Planner / Trip serializable snapshot
  → resolveRecommendationReasonPlace
  → buildPlaceRecommendationReason
  → PlaceRecommendationReason / canonical handoff reason
  → Home、Explore/Search、Preview、各來源 Detail、Chat、Itinerary
```

優先順序為 semantic identity → 有支持的 review signals → factual claim evidence → 確切 hours → rating/count。移除 batch rotation 對核心 reason 的影響；不以 popularity 代替已有 review insight。Ranking、候選選取、行程描述及使用者 notes 不改為這個 prose engine。

LLM response 的三個入口先經 `normalizeAiGeneratedResponse` 移除模型自行輸出的 reviewEvidence；server candidate merge 只使用已驗證候選的 structured evidence。不得把 AI prose 當 provider facts。共用 renderer 不發請求、不呼叫 LLM。

## F–G. Review schema、抽取與強度

```ts
{
  version: 1,
  placeId: "canonical Google Place ID",
  source: "google_review_sample",
  sampleSize: 0..5,
  signals: [{
    topic, // parking/outlets/work/service/quiet/view/food/gratin/meat/
           // variety/dessert/family/queue/crowds/value/portion
    sentiment: "positive" | "negative",
    supportCount: 1..5,
    strength: "single" | "multiple" | "strong",
    confidence: "low" | "medium" | "high"
  }]
}
```

- 最多處理合法回傳的五則 sample；依 review ID、author URI、正規化同文去重。翻譯與原文不重複計數，每則每 topic 最多一次。
- 保守 zh/en phrase rules；排除可辨識否定、條件、傳聞、引述；同則同 topic 有負向時不算正向。不是完整自然語言理解，不保證辨識所有反諷／同義詞；未知內容直接省略。日韓 review text 尚無專門抽取詞庫，四語輸出已有支援。
- single=1；multiple>=2；strong>=3、無同 topic 反向訊號且至少佔可用 sample 60%。schema 再檢查 supportCount 不超過 sampleSize，strength 不能自行升級。
- 文案每個 topic 個別標示「一則／多則／多則一致」，明說「可取得的評論中」，不宣稱全體 Google 評論多數。最多選兩個正向 topic；數量相同用穩定 topic 次序，不因 surface 或 batch 改選。
- 只在有正向 evidence 時附加 repeated queue/crowds 限制。單一負評不进入主 reason；其他負向 topic 可抑制衝突的正向描述。
- 咖啡廳、餐廳、景觀類型本身不產生插座、好吃、安靜、工作等特色。確實存在的 factual claim evidence 可作 fallback。

## H–I. Semantic type 與 hours

`place-identity.ts` 的 `recommendationPlaceType` 擴充既有 identity：火鍋、燒肉、義大利料理、咖啡、景觀咖啡、寺廟、展望台及既有夜市、商場、公園、博物館等。intent 不再覆蓋真實類型；Google raw type 不直接當文案。名稱 fallback 需符合相應 semantic category。

`normalized-opening-status.ts` 的 `placeReasonHours` 重用今日 hours authority，支援分段營業與明確今日公休；只知道 closed_now 不寫成今日公休。未知或無法可靠解析就省略。不猜關門時間。

繁中一般為 1–3 句；compact 移除 supporting hours/rating，保留相同 identity/review 核心，standard/detail 共用同一核心與 supporting sentence。語系支援 zh-TW / en / ja / ko。

## J–K. Cross-surface evidence 與 cache / API

- 使用既有 `resolveCanonicalPlaceIdentity`，相同 Google Place ID（含 `places/` 前綴）共用 snapshot。
- existing runtime cache 中新增 reasonPlace projection；沿用 30 分鐘 TTL、120 entries 上限。既有 Details cache read/write 可恢復 projection，沒有第二套持久快取。
- renderer 訂閱既有 runtime cache 更新事件，只刷新文字；沒有 per-card Details hydration，也不等待 enrichment 才 render。
- reviewEvidence 經 recommendation、trip、itinerary、Planner input/delivery/recovery schema 保留；舊資料無 evidence 安全使用 identity/factual fallback。使用者 notes 與行程 description 保留。
- screen Details 原有必要請求加入 reviews；intro 可重用 screen cache，即使 sample 為空也不為更多評論另打一次。
- Nearby/Text Search mask 未加入 reviews；無評論的冷列表先顯示 fallback，不能期待未開過 Details 的所有卡片都已有評論共識。已有 Details cache/evidence 時跨 surface 使用同一核心。
- 沒有新增 background fan-out、budget 提升、timeout、LLM per-render 或 dependency；原 Search/Browse priority、dedupe、Favorites image 流程不變。
- **計費差異**：reviews 是 Google Places Enterprise + Atmosphere field。既有 screen Details 請求數不增加，但該請求 SKU 可能提高，不能稱為成本不變。最多五則 relevance sample，非全量評論。見上方官方文件。
- Plus profile / preference provenance、ranking 與 credits 邊界保留；核心地點 prose 不再依人格、batch 或 surface 隨機變化。本輪沒有新增依 profile 客製 review topic ranking。

## L. 本輪修改檔案分組

- Authority / evidence：`build-place-recommendation-reason.ts`、新增 `place-review-evidence.ts`、`place-reason-diversity.ts`、`place-identity.ts`、`normalized-opening-status.ts`、`place-result.ts`。
- Provider / cache：`google-maps-api.ts`、`places.functions.ts`、`place-runtime-cache.ts`、`unified-place-cache.ts`。
- Renderers：新增 `PlaceRecommendationReason.tsx`；`MapPlacePreview.tsx`、`RoamieResponseView.tsx`、`home/HomeNearbyPlaceCards.tsx`、`map/MapExplorePlaceCards.tsx`、`map/PlaceDetailSheet.tsx`。
- Adapters：`unified-place-card.ts`、`chat-session.ts`、`place-detail-resolve.ts`、`recommendation-place-handoff.ts`、`recommendation-display-locale.ts`、`recommendation/place-intro.ts`、`recommendation/merge-verified.server.ts`、`enrich-roamie-places.server.ts`。
- AI / Planner / Trip：`ai/types.ts`、`ai/service.server.ts`、`ai/meal-intent-parser.ts`、`itinerary.functions.ts`、`ai/itinerary-{candidate-recovery,deliverable-stop,google-identity}.ts`、`ai/itinerary-validator/from-payload.ts`、`trip/trip-place-input.ts`、`trip/trip-itinerary-place-handoff.ts`。
- Verification：`package.json`、新增 `verify-recommendation-reason-authority.mjs`，更新 diversity、template pipeline、P22 persistence、Detail device、opening-layout scripts；本文件。
- 路徑以上除 components/scripts/package/docs 外均在 `src/lib/`。Working tree 另含前輪 Explore/Favorites 修改，沒有把它們算成此次新實作。

## M. 新 regression

`npm run verify:recommendation-reason-authority`：30 項情境，涵蓋要求的 20 項，另加否定／矛盾、semantic subtype、closed_now、AI prose 拒絕、server merge 與 locale、Planner delivery、LLM fabricated evidence、malformed strength、canonical prefix、四語 presentation。

實際 provider adapter fixture：一次 Details 取得 reviews；第二次 Details 與 Intro 均 cache hit，總 provider requests = 1。重複 extraction/render 不產生 fetch；search field mask 沒有 reviews。

原 diversity suite 保留 19 項距離／Plus provenance／claim validator／navigation 等相容測試，只替換與新 authority 衝突的 batch 文案輪替政策。P22 改測 structured evidence 保存、notes 分離與跨 trip consistency；Google Maps CTA source assertion 改對現有 i18n key，不要求已淘汰的中文字面值。

## N. Verification

通過：

- 新 authority 30 scenarios + actual provider/cache/intro reuse。
- Explore request storm 14 scenarios（foreground=1、background=0、duplicate=0、blocked=0、beforePrimary=1）；progressive search；Places request orchestration（含 budget dispatch / foreground / dedupe / stale / map authority）。
- Native adapter、offline recovery、release readiness、PIE facade。
- Favorites refresh race、signed photo surfaces；Favorites 圖片 headless browser runtime。
- Diversity / Plus personalization / reason template pipeline / P22 14 項 persistence。
- Place Detail device / opening / general recommendation hours / PIE Detail；opening localized browser layout 48 cases。
- canonical-place-identity（直接 vite-node 執行；package 沒有同名 npm script）。
- Itinerary core、P35 Google identity、P38 deliverable rebuild、credits。

限制（未為了綠燈改無關程式）：

- `verify:itinerary-regression`：10 項 real pool gate 失敗，candidateTotal=0；HEAD snapshot 同樣失敗。
- `verify:itinerary-insufficient-credits`：舊 source regex 要求 `insufficientCredits ? 402 : 500`；HEAD 同樣失敗。獨立 `verify:credits` 通過。
- `verify-place-detail-chat.mjs`：.mjs 內 TypeScript 型別標註導致 parser failure；HEAD `node --check` 同樣失敗。
- 前輪已確認 `verify-explore-map-cache` 的舊 key-format assertion 在 HEAD 也失敗。
- 前輪 final audit 發現 cancelled old search 可覆寫較新同 key cache（`places-search-dedupe.ts`）；已報告且未 commit。本輪不混入修復，這個已知問題仍待獨立處理，不能把本報告當整個 working tree 的 release 核准。
- 這次沒有新的實機驗收；完成後等待使用者測試 review reason surfaces。


最終 production build / postbuild / release-artifact verification：PASS。仍有 mixed static/dynamic imports 不拆 chunk、bundle size 類 build warnings；不代表 build failure。

TypeScript：全專案 321 項 diagnostics；本輪前 working tree 326，HEAD 327。依檔案與 TS error code 計數無新增；不是宣稱全專案 typecheck 綠燈。

Lint：變更中的 TS/TSX/MJS 檔案共 66 檔，171 errors / 8 warnings；與本輪前 baseline 比對 rule/message（排除訊息內行號位移）無新增。剩餘為原有 formatting、prefer-const、hook dependency 等，不修改無關問題。

`git diff --check`：PASS。Build 改寫的 `src/generated/app-bundle-meta.ts` 已還原，build output 仍為 ignored artifacts，沒有納入 diff。沒有修改 dependencies / Pods / lockfile，也沒有執行 Archive。

## O. Diff summary 與交付狀態

- 本輪 authority 工作觸及 42 個檔案（包含新增 formatter renderer、review evidence、regression script、audit 文件）；完整檔案分組見 L。
- 整體 working tree（包含前輪未提交的 Explore/Favorites 修正及 untracked source/docs/tests）：70 files，+4447 / −2529。
- Working tree 不是 clean，符合保留修改待實機驗收的狀態；沒有 staged commit、沒有 push、沒有 Archive。
- 本輪完成後停止修改，等待使用者實機驗收；不是 release approval，前輪已知 cancelled-search cache race 仍列在 N。
