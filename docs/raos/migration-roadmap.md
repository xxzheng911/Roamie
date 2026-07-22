# RAOS Migration Roadmap

Version: 1.0  
Status: Active planning

本文件定義將現有 Roamie 程式逐步對齊 RAOS 的分階段計畫。  
原則：**小步重構、逐步驗證**；每一 Phase 必須可編譯、可執行、通過該階段驗證後，再進入下一 Phase。

若某 Phase 與現況衝突，**先記錄衝突與建議，經確認後才改碼**。

---

## Phase 總覽

| Phase | Priority | 目標 | 狀態 |
|---|---|---|---|
| Phase 0 | — | `docs/raos/` + `.cursor/rules/`（文件與規則） | ✅ Done |
| Phase 1 | P0 | PIE Facade + Gateway（Place Detail 呼叫端收斂） | ✅ Phase 1 closed — Places 第一階段結束 |
| Phase 2 | P0 | 統一 Recommendation System + Planner Integration | ✅ R0–R1.2；🚧 Planner P1（R1.3 暫停） |
| Phase 3 | P0 | Repository Pattern（新功能強制；舊碼逐步遷移） | Pending |
| Phase 4 | P1 | AI 管線抽出：Conversation → Context → Decision → Planner → Validator | Pending |
| Phase 5 | P1 | Event Bus（新功能優先；舊功能逐步遷移） | Pending |
| Phase 6 | P2 | Workspace / Travel Memory / Travel DNA（相容現有資料，不覆寫） | Pending |
| Phase 7 | P3 | AI Credits + Membership Permission Gate | Pending |

---

## 共通規則

1. **不一次重構整個專案**；每 Phase 只做該階段最小可交付單元。
2. **不破壞可運作功能**；若需改生產路徑，必須有明確相容策略（facade / adapter / feature flag）。
3. **衝突先列清單**；未經確認不改業務邏輯、UI、API 契約、資料庫 schema。
4. 每 Phase 完成後回報：
   - 修改內容
   - 影響範圍
   - 驗證方式
   - 是否破壞既有功能
5. 驗證通過且確認後，才進入下一 Phase。

---

## Phase 0 — 文件與 Cursor Rules

### 交付

- `docs/raos/` Chapter 1–21 + README
- `.cursor/rules/`（`raos-core` alwaysApply；其餘按需載入）

### 驗證

- 檔案齊全；無 App 程式碼變更

### 狀態

已完成。詳見 [README.md](./README.md)。

---

## Phase 1 — PIE Facade（P0-1）

### 目標

建立 Place Intelligence Engine 的 **Facade 層**，作為 Places 相關 API 的統一入口。

### Step A（已完成）

- 新增 `src/lib/pie/` Facade + delegates + Feature Flag + places-gateway
- 內部 **委派** 現有 `placesService` / `places.functions` / `unified-place-cache` / `place-detail-resolve` / `placeImageService`
- **未修改** 既有呼叫端；Google API 行為與回傳形狀不變
- Feature Flag 預設 **OFF**（TestFlight 安全）；驗證指令：`npm run verify:pie-facade`

**回退**：保持 flag OFF，或 `localStorage.setItem("roamie:pie-facade","0")`；呼叫端仍走舊路徑。

### Step B（Place Detail 完結 — PIE Gateway Phase 1 closed）

| 批次 | 呼叫端 | 狀態 |
|---|---|---|
| #1 | `LocationSearchField` Autocomplete | ✅ Done |
| #2 | `LocationSearchField` PlaceLite details | ✅ Done |
| #3 | `TripStopSearchField` PlaceLite details | ✅ Done |
| #4 | `explore-map-search` Lite + ScreenWithKey | ✅ Done |
| #5 | `explore-primary-place` ScreenWithKey | ✅ Done |
| #6 | `_app.place` Handoff + ScreenWithKey + server fn | ✅ Done |
| #7 | `_app.chat` / `_app.map` details server fn | ✅ Done |
| #8 | `recommendation.functions` Intro details | ✅ Done |

**刻意不遷移（Phase 1 結束範圍外）**：Search / Nearby / Explore `searchPlaces`、AI itinerary place fetch、`place-detail-resolve` 內部 autocomplete 等。

PIE Metrics：`src/lib/pie/metrics.ts`  
驗證：`npm run verify:pie-step-b-place-detail-complete`

### Step A 驗收

- [x] `npm run verify:pie-facade` 通過
- [x] Facade 方法 === 舊模組同一 function reference
- [x] Place Detail 呼叫端經 gateway；Search 路徑維持舊入口

---

## Phase 2 — 統一 Recommendation System（P0-2）

### 狀態

方向已確認；**Pipeline 已更新**；實作 R0（Explore only）後停止，待確認再進 R1。

→ [recommendation-engine-design.md](./recommendation-engine-design.md)

### 正式 Pipeline

```
normalize → filter → deduplicate → score → rank → diversify → explain → validate
```

（`explain` 預留：未來每筆推薦原因，暫可不實作文案。）

### 已確認約束

- Adapter 接入；R0 僅 Explore
- R0 行為 = 現況；Flag `VITE_REC_ENGINE_ENABLED`（預設 OFF）
- 不改 Home / Chat / Planner 商業邏輯
- Planner 僅接收排序結果，不負責推薦
- R1 **拆小階段**（勿一次導入全部權重）：
  - R1.1 Hours / Distance / Rating / Reviews（Profile + `VITE_REC_ENGINE_R1_1_ENABLED`）✅
  - R1.2 Memory / DNA（Suggestion/Signal only + `VITE_REC_ENGINE_R1_2_ENABLED`）✅
  - R1.3 Weather / Season / Festival
  - R1.4 Learning / Feedback / AI Insight
- 權重由 Recommendation Profile 管理；Explain 輸出結構化 Reason
- 每完成一個 R1.x 停止待確認

### 目標

Home / Explore / Chat / Planner 共用同一套推薦 Pipeline；頁面只做呈現。

### 已知衝突

| # | 衝突 | 現況 | 建議 |
|---|---|---|---|
| C4 | 推薦路徑多套 | `recommend-place-ranking`、`recommendation/pipeline.server`、AI chat/destination recommend、home nearby 等 | 抽出共用 Engine Pipeline；各表面 Adapter 接入，不一次刪舊路徑 |
| C5 | 權重/排除規則不一致 | RAOS 建議 DNA/Memory 權重；現況多為 rating/距離/場景規則 | R0 維持現況；R1 以可配置權重導入 |

---

## Phase 3 — Repository Pattern（P0-3）

### 目標

新功能一律經 Repository；舊程式逐步遷移。

### 已知衝突

| # | 衝突 | 現況 | 建議 |
|---|---|---|---|
| C6 | Repository 幾乎未普及 | 僅見 `home-nearby-repository.ts` 等少數 | 新資料存取強制 Repository；舊碼不強制一次改完 |
| C7 | Storage 直讀 | `places-storage`、`trip-draft-storage`、session cache 等 | 先包 Adapter Repository，不改底層儲存格式 |

---

## Phase 4 — AI Pipeline（P1）

### 目標

逐步抽出 Conversation → Context → Decision → Planner → Validator；不一次重寫。

### 已知衝突

| # | 衝突 | 現況 | 建議 |
|---|---|---|---|
| C8 | AI 多為特化 helper + prompt | `src/lib/ai/*`、plan prompts、router | 先標註邊界與 facade；新規則進 Decision/Validator，舊 prompt 逐步搬出 |
| C9 | Prompt 含業務規則 | 如規劃/分類/排除寫在 prompt | 新規則禁止只寫 prompt；舊規則逐條搬到可測引擎 |

---

## Phase 5 — Event Bus（P1）

### 目標

建立統一 Event Bus；新功能優先 publish/subscribe。

### 已知衝突

| # | 衝突 | 現況 | 建議 |
|---|---|---|---|
| C10 | 無統一 Event Bus | 直接 state/UI 更新；home-nearby 有 listener 模式但非全域 | 新增輕量 in-process Event Bus；舊路徑不強制改 |
| C11 | UI 互相刷新 | 模組可能直接觸發他頁更新 | 新功能禁止跨模組直刷 UI；舊碼標註 technical debt |

---

## Phase 6 — Workspace / Memory / DNA（P2）

### 目標

導入架構並與現有資料相容，**不直接覆寫使用者資料**。

### 已知衝突

| # | 衝突 | 現況 | 建議 |
|---|---|---|---|
| C12 | 行程草稿 vs Workspace | `trip-draft-storage` / 草稿 UI | 需產品決策：草稿過渡保留，或 Plus Workspace 並行 |
| C13 | Memory/DNA 模型落差 | session / long-term / quiz personality | 對照映射 + schema version；讀舊寫新 adapter，禁止覆寫 |

---

## Phase 7 — Credits & Permission Gate（P3）

### 目標

Monthly AI Credits + Plus Permission Gate（server/permission 強制）。

### 已知衝突

| # | 衝突 | 現況 | 建議 |
|---|---|---|---|
| C14 | Credits 未見 | 搜尋無完整 AI Credits 實作 | 新增計費層，與 plan-tier 整合；預設不影響現有 Plus/Free 行為直到開啟 |
| C15 | Plus 閘道不完整 | 有 `free`/`plus` plan-tier；Intelligence 能力未必全閘 | 先盤點 Plus-only 清單，再加 permission gate（非只藏 UI） |

---

## 下一決策點

**PIE Gateway Phase 1 已正式關閉** — Places 第一階段結束。

Recommendation R1.3 **暫停**。Planner Integration P1 ✅；P2 前 Design Contract 已落地。

→ [planner-contract.md](./planner-contract.md)（契約）  
→ [planner-recommendation-integration.md](./planner-recommendation-integration.md)（分階段）

下一決策：P4.2 ✅；確認後可進入 **P3.2+**（PIE Search 內部強化）。Legacy score 函式保留至 Migration 完成後再移除。

P3.1 交付：`wrapPlannerPlaceSearchViaGateway` + Flag `VITE_PIE_PLANNER_SEARCH_ENABLED`（預設 OFF）；驗證 `npm run verify:pie-planner-p3`。  
P4.1 交付：Recommendation Validator 實閘 + Flag `VITE_REC_ENGINE_VALIDATOR_ENABLED`（預設 OFF）；驗證 `npm run verify:rec-engine-planner-p4`。  
P4.2 交付：Itinerary Validator + Flag `VITE_ITINERARY_VALIDATOR_ENABLED`（預設 OFF）；驗證 `npm run verify:itinerary-validator-p4-2`。

→ [recommendation-engine-design.md](./recommendation-engine-design.md)
