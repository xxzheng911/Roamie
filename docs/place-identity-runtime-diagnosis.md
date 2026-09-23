# Canonical Place Identity runtime audit（2026-09-23）

## A. Root cause

三個指定分店的真實 Google Text Search / Details response 都包含 specific types；不是 Google 沒提供 cafe / bakery。

原 `resolvePlaceIdentity` 第一個判斷為 `isBlacklisted(types) → unsupported`，其 blacklist 包含 `wholesaler`，且掃描所有附帶 types。三個分店都含 wholesaler，於是 cafe / cake_shop / bakery 尚未被判斷就被否決，最後 unsupported label 為「地點」。這是三個案例共同、可由實際 response 重現的主因。

另發現：

- cake_shop 未在舊完整 identity mapping；specific subtype 與 legacy base identity 分散處理。
- 舊 retail fallback 把一般 store 當 shopping_mall；generic / specific 缺少一致排序。
- primaryTypeDisplayName 原 mask 未要求、adapter 未保存；現在沿必要請求傳遞。
- 已有 handoff 會將「咖啡廳」等中文 semantic type 放入 primaryType。只認 provider token 會令 enriched / persisted handoff 再退回 generic。
- `normalizeGooglePlace` 原來在 types 缺少時，先依名稱自行猜 cafe / restaurant 等，甚至預設 tourist_attraction。這條繞過 compatible evidence 的猜測已移除。
- incomplete enrichment 的 generic/null types 可能覆蓋已有具體分類；現在 identity fields 共用非破壞性 merge。

這次未修改 Review Evidence extraction，也未重建 Recommendation Reason Engine。

## B–D. 三個實際 controlled traces

各做一次真實 Text Search + Details（共 6 個診斷請求），只要求 identity 欄位，不重新抓評論。回傳保存為 identity-only fixture：`scripts/fixtures/place-identity-live.json`。不含 key、評論文字或私人資料。

| 地點 | Canonical Place ID | Primary type / display name | 重要 raw types | Normalized → semantic | Selection source | Final identity |
|---|---|---|---|---|---|---|
| 85°C 高雄富國店 | ChIJ29H3cAMFbjQRREyGNMQlOTw | cafe / 咖啡館 | cafe, cake_shop, bakery, dessert_shop, confectionery, food_store, gift_shop, store, manufacturer, wholesaler, service, food, point_of_interest, establishment | 保留上述 types；cafe 在 specificity 同分時由 primary 勝出 | provider_primary_type | 咖啡廳 |
| 阿默高雄立文店（Google 名稱 Amo阿默典藏蛋糕） | ChIJiRr-eQAFbjQRL2eKfDjtfqg | cake_shop / 蛋糕專賣店 | cake_shop, bakery, food_store, manufacturer, wholesaler, service, store, food, point_of_interest, establishment | cake_shop > bakery > store/food | provider_primary_type | 蛋糕店 |
| 糖村高雄立文店 | ChIJcbgvtn8EbjQRgBdobqxxz3Q | gift_shop / 禮品店 | cake_shop, gift_shop, candy_store, bakery, manufacturer, wholesaler, confectionery, food_store, store, service, food, point_of_interest, establishment | cake_shop > bakery/confectionery > gift_shop/store | provider_types_specificity | 蛋糕店 |

三個案例 existingCategory=null，fallbackReason 為空；Google Search 與 Details 的 types 順序不同，結果仍一致。沒有以品牌名稱 hardcode。

Fixture 會分別走正式 `normalizeGooglePlace`（Search）及 `fetchPlaceDetailsForScreenWithKey(...requestPath:capacitor_client)`（Details adapter）重播，檢查 normalized types、primary/display fields、classifier、builder 全鏈。這是「真實網路 response + production/native 共用 adapter replay」，不冒稱已完成新一輪裝置 E2E。

Identity-only response 的 final reasons 分別為「這是一間咖啡廳。」「這是一間蛋糕店。」「這是一間蛋糕店。」因本次受控請求刻意未要求 reviews/hours，不能用它們冒充這三家新的評論實測。

## E–F. Specificity 與 evidence priority

既有 `place-identity.ts` 收斂成一個 `classifyPlaceIdentity` decision。`resolvePlaceIdentity` 保留原 coarse identity 介面（例如 cake_shop → dessert，餐廳 subtype → restaurant），`recommendationPlaceType` 使用相同 decision 的精確自然 label，不建立另一套 reason generator。

優先：

1. Structured specific primaryType / types，以明確 specificity 排序；同分優先 primaryType，再以固定 token 次序。
2. 既有 normalized type/category、trusted semantic category（包含 handoff 中文 label）。
3. 已取得的 provider primaryTypeDisplayName，僅使用可辨識的對照。
4. Compatible name hint：只在 provider 分類不足時，以已存在的 food/store/restaurant/attraction evidence 限制 refinement。
5. Generic fallback。

具體例：hot_pot/barbecue/italian/ramen > restaurant；observation_deck/museum > tourist_attraction；shopping_mall > store；cake_shop > bakery > food/store。Cafe 與 cake_shop 同層，因此 85°C 由明確 primary cafe 決定；不列出全部類型，不依 UI 搜尋字詞硬分類。

名稱範例：Bakery + food/store → bakery；Café + compatible food evidence → cafe；火鍋 + restaurant → hot_pot_restaurant。Park/Hospital 名稱中出現 Cafe 不會變成咖啡廳；provider 全無相容 evidence 的 Unknown Café 不憑名稱發明 types。

新增／確認 labels 包含 café、bakery、cake_shop、dessert、restaurant subtypes、shop、展望台、博物館、公園、購物中心、佛教／印度教寺廟等。[Google 官方 Place Types](https://developers.google.com/maps/documentation/places/web-service/place-types) 已列 cake_shop / hot_pot_restaurant 等 API New types。`temple`、`shopping_center` 等既有 Roamie/legacy aliases 只用於輸入語意相容，不作新的 provider request type。

Category context 本輪不介入同分排序，以維持同 snapshot 跨 surface 一致；provider primary + deterministic priority 已能解決多類型案例。

## G–H. Enrichment、reviews、hours

`mergePlaceIdentityFields` 用於 unified factual merge、Detail merge、reason snapshot projection；generic / 缺少 types 的 enrichment 不抹除既有 specific types。Fresh specific evidence 可正常替換舊 generic identity。

沿用上一輪 external-store renderer：Chrome 實際掛載四份 renderer，cold generic「地點」→ Details bakery evidence →「烘焙店」；review 插座訊號與 10:00–18:00 hours 同時保留，四份 reason 一致，render 發出 0 requests。

Review extraction、strength thresholds、review cache capability 與 reason prose priority 均沿用已驗收版本。新增分類測試亦驗證 identity upgrade 後 review/hours 不消失。

## I. API 與 cache

Product classification / recompute **0 新增 Places requests**。上述 6 個真實請求只屬這次明確要求的 controlled diagnostics。

既有必要 Search/Details field mask 加入 primaryTypeDisplayName，adapter 保存 rawTypes/display metadata；沒有新 fetch、list fan-out、capability version bump、cache purge、timeout 或 budget 提升。舊 cache 即使沒有 display-name metadata，只要保留原 primaryType/types 就可立即重新分類；真的欠缺所有 evidence 時仍誠實 fallback，不額外逐卡补抓。

## Scoped diagnostic

`PLACE_IDENTITY_TRACE` 輸出 placeId/name/surface、rawTypes、normalizedTypes、primaryType/display、existingCategory、candidateSemanticTypes、selectedSemanticType、selectionSource、fallbackReason、finalIdentityLabel。

Production 預設關閉，沿用 verbose/debug gate；也可用指定 Place ID 開啟：

```js
localStorage.setItem("roamie:identity-trace-place-id", "ChIJ29H3cAMFbjQRREyGNMQlOTw")
// 關閉
localStorage.removeItem("roamie:identity-trace-place-id")
```

相同 trace 去重、記錄容量上限 120；不記錄 API key 或 raw review text。

## J. 本輪檔案

1. `src/lib/place-identity.ts`：canonical decision、specificity、aliases、safe hints、trace、identity merge。
2. `src/lib/place-result.ts`：optional rawTypes / primaryTypeDisplayName。
3. `src/lib/google-maps-api.ts`：既有 masks 增加 display-name 欄位。
4. `src/lib/places.functions.ts`：Details identity metadata 保留。
5. `src/lib/ai/normalize-google-place.ts`：Search identity metadata；移除未受約束 name guess / invented attraction。
6. `src/lib/build-place-recommendation-reason.ts`：接入 identity metadata merge/surface trace；reason engine 不改。
7. `src/lib/unified-place-cache.ts`：factual identity merge。
8. `src/lib/place-detail-resolve.ts`：Detail identity merge。
9. `scripts/verify-place-identity-runtime.mjs`：30 項測試。
10. `scripts/fixtures/place-identity-live.json`：真實三店 identity response。
11. `scripts/verify-recommendation-review-browser.mjs`：generic → bakery mounted regression。
12. `package.json`：verification command。
13. 本文件。

## K. Regression

- 新 identity runtime **30 項**，涵蓋指定 22 項，加上 provider primary tie、incomplete merge、category/display fallback、context 不覆蓋 provider、name-only 拒絕、中文 handoff、normalizer 不發明 types。
- Recommendation Review runtime **23 項**：PASS。
- Recommendation Authority **30 項**：PASS。
- Explore request storm **14 項**：PASS；Places orchestration / budget / in-flight dedupe：PASS。
- Native search adapter、Favorites refresh race：PASS。
- Planner/Itinerary core、P35 Google identity、P38 deliverable rebuild、P22 persistence：PASS。
- Place Detail device / opening、既有 place-recommendation-authority / reason-diversity、Plus personalization：PASS。
- Chrome mounted generic→specific、review/hours retention、four-renderer parity、0 fetch：PASS。

保留限制：Chrome 測的是共用 renderer，非所有 route 的完整裝置 E2E；目前等待使用者重新實機驗收。前輪已確認的 baseline test 限制與 cancelled-search cache race 沒混入此次 identity scope。

## L. Build / static verification

Production build / postbuild / release artifacts：PASS。`git diff --check`：PASS。

TypeScript 全專案仍 321 項既有 diagnostics，與本輪前按檔案及 TS error code 比對無新增。Scoped lint（本輪 10 個 TS/TSX/MJS 檔案）9 項既有 formatting errors、0 warnings，基準 rule/message 比對無新增；不是全專案 lint/typecheck 綠燈。Build 仍有 mixed static/dynamic imports、chunk size 類 warnings。

Generated bundle metadata 已還原；重現的完全相同 config 2.xml 留暫存備份後移除，不納入 diff。沒有修改 dependencies/Pods/lockfile。

## M. Diff / delivery

本輪 13 檔，見 J。累積 working tree 共 79 檔，+6052 / −2870（包含 untracked source/tests/docs 與前輪尚未提交的 Explore/Favorites/reviews 修改，不能全算成本輪變更）。

Staged files=0；working tree 保留修改，未 commit、未 push、未 Archive。完成後停止，等待使用者重新實機驗收。
