# Planner Design Contract

Version: 1.0  
Status: **Confirmed — binding for Planner Integration P2+**  
Related:

- [planner-recommendation-integration.md](./planner-recommendation-integration.md)
- [recommendation-engine-design.md](./recommendation-engine-design.md)
- [chapter-08-planner-optimizer.md](./chapter-08-planner-optimizer.md)
- [chapter-09-validator-engine.md](./chapter-09-validator-engine.md)
- [chapter-12-place-intelligence-engine.md](./chapter-12-place-intelligence-engine.md)（PIE）

> 本文件為 **Planner 與 Recommendation Engine 的職責邊界契約**。  
> 所有 Planner Adapter、行程組裝、多日 Optimizer 必須遵守。違反視為架構回歸。

---

## 1. Target pipeline

```
Places
  ↓
PIE
  ↓
Recommendation Engine
  ↓
Recommendation Validator
  ↓
Planner（本契約範圍）
  ↓
Itinerary Validator
```

- **Recommendation Engine** = 唯一候選排序來源  
- **Planner** = 只組裝與約束，不重新推薦  
- **Recommendation Validator** = 候選層品質閘門（Engine pipeline `validate`）  
- **Itinerary Validator** = 行程層可行性閘門（組裝之後）

兩層 Validator 分層，語意不得混用。

---

## 2. Planner 職責

Planner **只負責**：

| 職責 | 說明 |
|---|---|
| **Assemble** | 行程組裝：將已排序候選放入日／槽 |
| **Time Slot** | 時段安排 |
| **Route Constraint** | 路線／移動距離與折返限制 |
| **Business Hours** | 營業時間限制（能否放進該時段） |
| **Meal Slot** | 餐食時段限制（早午晚等） |
| **Pace** | 節奏控制（每日密度、停留） |
| **Deduplicate（行程層）** | 行程內去重（同一行程不重複排入） |
| **Lock Place** | 鎖定地點必須保留／不可替換 |
| **Day Capacity** | 每日容量（半日／全日／多日上限） |

Planner 是行程最佳化與可旅行性組裝層，**不是**推薦系統。

---

## 3. Planner 不負責

Planner **不得**：

- 重新排序候選景點  
- 建立新的推薦分數  
- 依 Rating 重新排序  
- 依 Memory 重新排序  
- 依 DNA 重新排序  
- 建立自己的權重系統  
- 與 Recommendation Engine **競爭**排序權  

禁止模式（範例，非穷舉）：

- `sort(candidates, by: rating | dna | memory | plannerScore)`  
- 新建 `plannerWeights` / `scorePlaceForTheme` 作為**推薦排序**來源  
- 對整份 `PlannerCandidatePool.results` 依「我覺得更好」重排  

> P1 為行為對齊過渡期：排序仍可**委派**既有 `trip-place-scoring`，但必須經 Recommendation Engine Adapter 執行。  
> **P2 起**：Planner 模組內不得再持有獨立推薦排序邏輯；僅能依契約消費 `RecommendationResult` 順序。

---

## 4. Recommendation Engine 負責

Recommendation Engine 是**唯一**候選排序來源。

進入 Planner 之前，所有 `RecommendationResult` **必須已完成** Pipeline：

```
normalize → filter → deduplicate → score → rank → diversify → explain → validate
```

（`validate` = **Recommendation Validator**）

結果應含：

- `score`  
- `scoreBreakdown`（各因子明細；供 Explain / Debug / A/B / AI 理由）  
- `reasons`（結構化 `RecommendationReason`，非完整句子）  
- `candidate`（含可供組裝的 `raw` Place）

Planner **只能依 `RecommendationResult` 的順序消費**。

### 4.1 允許跳過候選的理由

若需要跳過某個候選，**只能**因為：

- 營業時間（Business Hours）  
- Route Constraint  
- Meal Constraint  
- Day Capacity  
- Lock Place  
- Pace  
- Duplicate（行程層）

**不得**因為「我覺得另一個比較好」而重新排序或挑選更後面的候選「插隊」到前面。

合法行為：依序掃描 pool → 因約束跳過 → 取下一個仍符合約束者。  
非法行為：對剩餘候選再做一次分數排序後再挑。

---

## 5. 資料契約

### 5.1 統一輸入

Planner 的輸入統一為：

```ts
type PlannerCandidatePool = {
  surface: "planner";
  results: RecommendationResult[]; // 已 rank + Recommendation Validator
};
```

- 消費順序 = `results[0] … results[n]`（Engine 順序）  
- 不得改寫 `score` / `scoreBreakdown` 後再據此重排  

### 5.2 禁止

Planner（含 Adapter 下游組裝）**不得**：

- 直接重新查 Places（繞過 PIE／既定候選取得路徑）以「補排序」  
- 自行重新 Ranking  
- 另建平行候選池並用私有分數合併排序  

Places 取得屬 **PIE**（P3 起 Planner 候選搜尋經 PIE Gateway）；排序屬 **Recommendation Engine**。Planner 兩者都不做。

### 5.3 Adapter 義務

未來所有 Planner Adapter **必須**遵守本 Contract：

1. 輸出（或保證輸入為）`PlannerCandidatePool`  
2. 排序只發生在 Recommendation Engine  
3. 組裝模組只讀順序 + 約束  
4. Feature Flag 回退時，行為變更必須文件化，且不得在 Planner 內新增競爭排序  

參考實作入口（P1）：`rankPlannerPlacesViaRecEngine` / `buildPlannerCandidatePool`  
（見 [planner-recommendation-integration.md](./planner-recommendation-integration.md)）

---

## 6. Validator 分層（再聲明）

| 層級 | 名稱 | 時機 | 職責 |
|---|---|---|---|
| 候選 | **Recommendation Validator** | Engine pipeline 末端 | Place／推薦品質（存在、類別、重複、低品質等） |
| 行程 | **Itinerary Validator** | Planner 組裝之後 | 順路、餐食、天數、鎖定、可旅行性 |

Planner 不得用「行程驗證失敗」當藉口回頭重做推薦排序；應在約束內從已排序 pool 再取下一候選，或觸發上游重新取候選（仍經 Engine），而非本地重排。

---

## 7. 與 PIE / Recommendation / Validator 的一致性

| 模組 | 角色（本契約下） |
|---|---|
| **PIE** | Places 取得、正規化、快取、Detail 一致性；不排序、不組行程 |
| **Recommendation Engine** | 唯一候選排序；Profiles / Signals / scoreBreakdown / reasons |
| **Recommendation Validator** | 候選閘門 |
| **Planner** | 僅 Assemble + 約束（本文件 §2） |
| **Itinerary Validator** | 行程閘門 |

本契約與 RAOS Ch.8（Planner 不產生景點）、Ch.11（統一推薦）、Ch.12（PIE gateway）對齊。

---

## 8. Migration note

| Phase | 與本契約關係 |
|---|---|
| **P1** ✅ | Adapter 接入；排序委派 trip-place-scoring；Flag 預設 OFF |
| **P2.1** ✅ | Flag ON：Engine Profile 唯一排序；硬過濾僅約束 |
| **P2.2** ✅ | slot pick 依 pool 順序 + 約束；theme 分數僅 Flag OFF |
| **P2.3** ✅ | Local life / Classic / rankByQuality：Flag ON 無推薦重排 |
| **P3.1** ✅ | 候選取得入口經 PIE Search Gateway（`VITE_PIE_PLANNER_SEARCH_ENABLED`） |
| **P3.2+** | PIE Search 內部強化（Quality / Dedup 等）— Validator 後 |
| **P4.1** ✅ | Recommendation Validator 實閘（`VITE_REC_ENGINE_VALIDATOR_ENABLED`） |
| **P4.2** ✅ | Itinerary Validator 實閘（`VITE_ITINERARY_VALIDATOR_ENABLED`） |

R1.3（Weather / Season / Festival 權重）維持暫停，直到 Planner Integration 推進經確認。

---

## 9. Acceptance（契約合規）

- [ ] Planner 無新建推薦權重／分數表  
- [ ] 無對 `PlannerCandidatePool.results` 全池重排  
- [ ] 跳過候選僅限 §4.1 列舉約束  
- [ ] 輸入為 `PlannerCandidatePool`（或 Adapter 保證等價）  
- [ ] 不直接為「重新排序」而查 Places  
- [x] Recommendation Validator 與 Itinerary Validator 分層清楚（P4.1 候選閘；P4.2 行程閘）  
