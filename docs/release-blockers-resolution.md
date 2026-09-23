# Release blockers resolution

本輪僅修復 Final Release Audit 的 R1 / R2。未改 UX 文案、reviews extraction、opening hours、Favorites、taxonomy、request budget、dependencies、Pods 或 Xcode settings。未 commit / push / Archive。

## A–D：Cancelled / stale search commit authority

Root cause：原本 `getPlacesSearchCachedOrRun` 在 admission / in-flight join 處檢查 abort，但 `.then` 收到 response 後會直接 normalize、寫 search cache、寫逐筆 Place cache，並 resolve 給 caller。只有 `.finally` 檢查 pending owner，僅能防止清掉新 promise，不能阻止舊 response 寫入。

實際路徑：Explore session → unified search adapter → provider guard/server transport → response → search-cache normalization → `writeUnifiedPlaceSearchCache` → unified memory + localStorage → returned result → route publication / enrichment。Route requestId guard 原本只保護最後 UI，無法回復已污染的 cache。

修正：

- 沿用每個 cache key 的 pending promise ownership，加入 caller-scoped `isCurrent` callback；不新增全域 latest-search cache framework。
- admission、dedupe join、cache-hit publication 以及 completion publication 都驗證 caller validity。
- normalization 前、cache commit 前驗證 **同 key pending owner + !aborted + caller/session validity**。memory、persistent、逐筆 Place 寫入在同一 synchronous commit 段完成，沒有 await 讓 authority 在其間切換。
- stale success / failure 以 `AbortError` 拒絕，不回傳 old normalized result、不寫 cache、不寫 failed-key TTL，不執行 consumer 的成功 enrichment callback。
- unified adapter 綁定已存在 Explore session identity；不使用 request budget 剩餘量判斷 completion validity（最後一個合法 request 完成時 budget 可已耗盡）。
- provider guard 也在 runner completion 檢查 abort / generation，避免不支援 abort 的 transport 將舊 result 傳到下游。Explore 以自己的 session signal 為準；不把不相關 global generation 當成 scoped completion authority。
- 同 key 有效 request 繼續 dedupe；不同 key 的合法工作互不取消。新 generation 不會被舊 promise 的 finally 清除。

原 audit 受控 completion 順序：A starts → B starts → B resolves new-result → A resolves old-result。

```json
{"UI":"new-result","memory":"new-result","persistent":"new-result","downstream":0,"refetches":0}
```

其中 UI 為 controlled consumer state，memory 使用 production cache read，persistent 直接檢查 localStorage envelope；不是宣稱新的實機測量。並驗證舊 Place 的 detail alias key 及全部 persistent entries 沒有 old-result。

## E–H：primaryType provenance

Root cause：`normalizeGooglePlace` 的 `raw.primaryType ?? raw.type ?? types[0]` 將 legacy/candidate evidence 升級為 explicit provider primary，canonical classifier 無法辨識合成來源。

修正後只有 `raw.primaryType` 可填入 normalized primaryType；缺失、空字串為 `null`。`types[]` 與 legacy type 保留在原有 candidate path，不能因 array position 取得 primary authority。未變更 canonical classifier 或增加 taxonomy。

| Permutation（provider 無 primary） | normalized primaryType | identity |
|---|---|---|
| breakfast_restaurant, bar, restaurant | null | 酒吧 |
| bar, restaurant, breakfast_restaurant | null | 酒吧 |
| restaurant, breakfast_restaurant, bar | null | 酒吧 |

同一 name/provider evidence 下三者一致。額外測試 hotel/lodging/generic 的全部 24 permutations，以及 explicit bar、breakfast、hotel、hot_pot primary 均保留 authority。

## I：既有 controlled identity

85°C → 咖啡廳；Amor → 蛋糕店；糖村 → 蛋糕店；Stellar scenario → 酒吧；karaksa scenario → 飯店，全部 PASS。前 3 案使用既有 provider capture；後 2 案維持原本清楚標示的 controlled fixtures，不冒充新的 runtime capture。使用者前輪已回報實機 PASS。

## J：本輪修改邊界

1. `src/lib/places-search-dedupe.ts` — scoped completion/cache/publication guards。
2. `src/lib/places-search-unified.ts` — 連接既有 session validity、取消失敗不標記 failed cache。
3. `src/lib/places-api-guard.ts` — provider completion stale guard。
4. `src/lib/ai/normalize-google-place.ts` — explicit primary provenance（只改該行及說明）。
5. `scripts/verify-release-authority-boundaries.mjs` — 原 2 項 boundary 加 UI/memory/persistent/alias/publication assertions。
6. `scripts/verify-search-commit-authority.mjs` — 新增 13 項 completion / provenance tests。
7. `scripts/verify-explore-native-search.mjs` — cancelled search 改驗證 AbortError，立即接 rejection handler；保留新 request、dedupe、capacity assertions。
8. `docs/release-blockers-resolution.md` — 本報告。

本輪 8 檔，+381 / −14（相對本輪開始，含兩個新增檔案）。

## K：Verification

- 原 audit boundary：**2/2 PASS**。
- 新 search commit/provenance：**13/13 PASS**（另含 24 permutations）。
- Explore storm/orchestration/progressive/stale、native adapter、offline/city：PASS。
- Place Identity runtime 28、multi-specific 45：PASS。
- Recommendation Review runtime 23、Authority 30：PASS。
- cache capability、Place Details/opening、canonical identity、recommendation persistence、reason diversity/template pipeline：PASS。
- Favorites refresh race、signed photo surfaces/security/proxy、Chrome independent image/cache：PASS。
- Itinerary core、server Google identity、deliverable rebuild、Plus personalization、credits、Plus entitlement：PASS。
- Chrome recommendation renderer（包含 hotel upgrade 保留 reviews/hours）、opening layout：PASS。
- production debug/lifecycle boundary、PIE facade、release-readiness：PASS。

Native regression 的舊測試原本 `await stale` 假定 cancellation 正常 resolve；已改成預期 AbortError，避免把取消當成正常 result publication。不是移除失敗 assertion 或放寬新搜尋成功條件。

4 組歷史 failure 重新執行 HEAD/current：itinerary-regression 的 10 個 failure blocks 相同；insufficient-credits 舊 source regex 相同；place-detail-chat .mjs syntax parser failure 相同；explore-map-cache 舊 key-format assertion 均失敗（HEAD screen_v1 / current screen_reviews_v2）。不修改既有 technical debt。

所有本輪新增測試為 deferred promise / local fixtures；未新增 Google API request。Chrome 需要 sandbox 外 localhost/瀏覽器執行權限，測試不連 Google。

## L：HEAD baseline comparison

HEAD `0acaf2e4ca39ca20b68687f972adffd855a7e7bc` 獨立 archive snapshot，與 current 使用相同 dependencies。兩側重新執行 tsc 及完整 authored src/scripts lint。

TypeScript：HEAD 327、current 321；321 項均有來源位置與原因對應，新增 0、移除 6。Lint：HEAD 8236 errors / 71 warnings；current 7945 errors / 70 warnings；8015 項逐項配對，新增 0、移除 292。另人工確認 4 個相同 formatting diagnostic span，其 console helper／return expression 外圍改名不構成新 diagnostic。

比對檔案、source statement / diff 映射行號、error/rule code、message 及 occurrence。TS expanded type 裡新增 reviewEvidence、union 展開顺序、截斷 member count 等文字差異與舊 leaf cause 對照；不只用總數判斷。Lint message 僅正規化 hook 內嵌的來源行號；保留兩側實際 line/column 與完整 message。

逐項 artifacts：`/tmp/roamie-blockers-ts-comparison.json`、`/tmp/roamie-blockers-lint-comparison.json`；執行 logs：`/tmp/roamie-blockers-*`。

## M / N：Build、diff、status

`npm run build` PASS（含 release-artifacts）；`git diff --check` PASS。既有 mixed import / chunk-size warnings、native fixture CJS import.meta warnings仍在。Build generated metadata 已還原，未納入本輪差異。

累積 working tree：85 檔，+7301 / −2919；60 tracked modified、25 untracked，staged=0，非 clean。

兩個被指定修復的 blocker 已通過受控驗證；先前 audit 的 R1/R2 HOLD 狀態以本報告更新。此結論不是全專案既有 TypeScript/lint/tests 全綠，也不是新一輪實機 PASS 宣告。

完成後停止，未 commit、未 push、未 Archive。
