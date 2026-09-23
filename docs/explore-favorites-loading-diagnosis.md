# Explore / Favorites loading 診斷與修正

日期：2026-09-23。未 commit、push 或 Archive。

> 本文件保留第一輪診斷與 Favorites 修正紀錄。後續實機驗收發現 request storm；Explore 的最新 root cause、修正與驗證以 [第二輪報告](./explore-request-storm-diagnosis.md) 為準，第一輪測試通過不代表實機問題已解決。

## A. Root cause

### Explore

1. `isCityRecommendSelection` 的城市名稱 regex 只有開頭錨點，`首爾塔`、`Tokyo Tower` 等名稱會命中城市前綴。`isPinnableSearchSelection` 因此回傳 false，主卡根本沒有建立；頁面改等整批城市推薦。這是可由程式與固定輸入重現的問題，並非從實機網路 trace 推測的 API 回應。
2. `pickExploreCitySuggestion` 又允許 query 包含較短的城市名稱。多語 Google POI 名稱沒有 literal match 時，可能選到城市 suggestion，而不是 Google 排在前面的地點。
3. fallback Text Search 在 API adapter 套用附近距離／推薦資格，route 再套 category／quality／distance filter；direct result 沒有獨立 authority。`finalizeMapResults` 也對 primary 套用營業推薦資格。
4. `loading` 同時代表 direct search 與背景推薦，count 等整批 category search（含 raw pool/bootstrap）完成；既有 primary 雖有保留分支，但城市誤判時沒有 primary 可保留。
5. 明確選取／提交後的 Details 沒有 query authority guard；recommendation catch 沒有 stale guard，effect cleanup 只清 timer，未使已發出的 request 失效。

Pipeline：input → autocomplete → suggestion selection → Google Details → primary card → category/raw-pool/nearby search → ranking → results。圖片與收藏資料原本已是獨立流程，並非主卡必須等待的直接 async 依賴；主要阻塞點是錯誤進入城市推薦分支及混用 loading／結果 authority。

### Favorites

- records hydrate 本身未 await 所有圖片，卡片原本就各自掛載 `PlaceImage`；沒有找到逐張 sequential await photo 的路徑。
- `SavedPlaceCoverThumb` 原本只傳 photo resource / Google Place ID，忽略已保存的非 Google thumbnail URL，也不讀 `place-runtime-cache`。
- `getPlaceImage` 不讀共用 runtime metadata；沒有 saved photoName 時，即使其他頁面已取得 metadata，仍可能重新做 Place Details discovery。
- 圖片實際流程是 metadata → `/api/place-photo/sign` → 已簽名 photo proxy → browser image load。既有 signed cache 以 resource + width 為 key，256px thumbnail 不能重用已存在的 600px cover。
- `usePlaceImage` 每次掛載都先進 async 解析；失敗 Promise 沒有完整 catch 收尾，可能讓 skeleton 留住。

## B. 修改檔案

Explore：

- `src/routes/_app.map.tsx`：雙階段 loading、直接命中保留、fallback、request authority。
- `src/lib/explore-search-presentation.ts`：cards／markers／count 共用的結果與 loading projection。
- `src/components/map/MapExplorePlaceCards.tsx`：獨立背景 indicator，不把既有卡片變成 full loading。
- `src/lib/explore-recommend-mode.ts`：城市名稱完整匹配、Google POI type 優先。
- `src/lib/explore-city-popular-places.ts`：地標與城市 suggestion priority；保留城市 exact match。
- `src/lib/explore-selected-place.ts`：Place ID 先 trim 再移除 `places/`。
- `src/lib/explore-primary-place.ts`、`src/lib/explore-map-search.ts`：座標 0 不再被 truthiness 誤拒。
- `src/lib/places.functions.ts`：僅 `map.freeTextSearch` 的 Text Search 保留 Google direct hits，其他推薦流程不變。

Favorites：

- `src/components/saved/SavedPlaceCoverThumb.tsx`：重用 runtime cache／saved thumbnail。
- `src/services/placeImageService.ts`：重用與寫回現有 runtime photo metadata。
- `src/services/signed-place-photo.ts`：讀取有效 cache，thumbnail 可重用較大尺寸 URL。
- `src/hooks/use-place-image.ts`：同步 cache 初始化、獨立完成與 failure settlement。

測試與說明：兩個新 regression scripts、`package.json` 的兩個 verify commands、本報告。

## C. Explore 新 loading / state flow

1. 開始提交／選取：`primarySearchLoading`，尚無結果時不顯示 0 件。
2. Google 合法地點 Details 回來：寫入 primary、map center 與結果；停止 primary loading。marker、count、card 使用同一份 `displayResults`，不等附近推薦、照片或 favorites hydrate。
3. `backgroundRecommendationLoading` 保持局部 indicator。primary 不經 recommendation eligibility；recommendations 照既有規則篩選／排序，完成後與 primary 依 normalized Place ID 合併。
4. empty／failure enrichment 保留 primary。autocomplete 無命中或解析失敗會走 Text Search fallback；兩階段都完成且無合法結果才成為 empty。
5. 不新增模擬完成的 timeout。保留專案原有輸入 debounce 與網路 timeout。

## D. Favorites 新 image / cache flow

共用 runtime metadata／cover → saved metadata／thumbnail → 現有有效 signed cache → 必要時才 discovery／signing。Google metadata 一律沿用現有 signing/proxy authority，不把過期 saved signed URL 當永久圖片。

卡片先 render，圖片逐卡 resolve；現有固定 `h-16 w-16` 圖框與 skeleton／fade-in 保留。簽名 cache 仍檢查 expiry + 30 秒安全邊界，不新增持久化簽名 URL 或第二套 image authority。

## E. Race / stale response

- 新 input、submit、selection、GPS reset、offline、unmount 使不適用的 target request 失效。
- target resolution、weather follow-up、finally 均檢查目前 request。
- recommendation effect 的 response、catch、finally 與 cleanup 使用同一 request authority；舊錯誤不能清空新 query，也不能停止新 query 的 loading。
- autocomplete cleanup 使已出發的舊回應失效。
- 圖片沿用元件 version guard；失敗只結束該卡片，不影響其他卡片。

## F. 新增 regression coverage

`npm run verify:explore-progressive-search`：

- deferred enrichment 前 primary 可見、pending 不隱藏 primary、完成後 append／canonical dedupe、失敗保留 primary。
- primary 不受 recommendation eligibility 影響；舊 query response 不更新目前 authority。
- pending 不判定 empty；primary 與 fallback 完成後才判定 empty。
- 首爾塔／Tokyo Tower／大阪城、localized POI、normalized ID，以及東京 exact city priority。
- route source contracts 確認 request guard、failure guard、cards／markers／count wiring。

`npm run verify:favorites-photo-runtime`：

- headless Chrome 掛載真正 `SavedPlaceCoverThumb`／`PlaceImage`／hook／image service／signed cache，mock 網路與 viewport。
- records 先於圖片、A 完成不等 B、remount cache hit 不 fetch、失敗不影響另一卡、圖框高度不變。
- saved thumbnail、跨頁 runtime metadata、600px signed cover → 256px thumbnail 重用。

Explore coverage 是 production helper 的 deferred state tests + route wiring contracts，並非完整實機 route E2E；Favorites 為瀏覽器 DOM runtime coverage。未宣稱完成實機 Google API latency 量測。

## G. Verification

- 新增兩套 regression：PASS。
- 既有 Explore city logic／offline recovery、Favorites refresh race／saved scroll／offline snapshot：PASS。
- 既有 signed photo surfaces、photo security／proxy、Home photo browser runtime、photo signing stages：PASS。
- `verify-explore-map-cache`：FAIL；隔離 HEAD 同樣失敗。舊測試期待 `|detail|zh-TW`，現有 key 為 `details|ChIJx123|zh-TW|screen_v1`。未更動無關 cache authority。
- `tsc --noEmit`：327 個既有診斷；以隔離 HEAD 正規化行號比對，沒有新增診斷。
- `npm run lint`：完整 `eslint .` 約 6 分鐘仍未完成，已停止該驗證程序，不能標為通過。補跑 `eslint src scripts eslint.config.js` 完成，8230 errors／71 warnings。
- 修改檔案 lint 與隔離 HEAD 比對：沒有新增診斷；既有格式問題仍保留，避免為 loading 修正重排整個檔案。
- Production `npm run build`：PASS，包含 postbuild Capacitor bundle prepare 與 release artifact verification。build 產生的追蹤 metadata 已復原，不混入本次 diff。
- `git diff --check`：PASS。

## H. Diff scope

共 17 個檔案，包含 4 個新檔；約 733 行新增、86 行刪除（含測試與本報告）。

變更限於上述搜尋狀態／搜尋主結果邊界、圖片重用與 regression coverage。未更改 recommendation 排序演算法、收藏 schema、Google Place ID authority、導航、行程、Plus 或 credits。未建立 Archive，未 commit／push。
