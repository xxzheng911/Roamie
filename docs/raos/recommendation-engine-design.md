# Recommendation Engine — Design & Migration Plan

Version: 1.3  
Status: **R0/R1.1 ✅ confirmed — R1.2 ✅ verified; stop before R1.3**  
Related: [chapter-11-recommendation-system.md](./chapter-11-recommendation-system.md), [chapter-09-validator-engine.md](./chapter-09-validator-engine.md), [migration-roadmap.md](./migration-roadmap.md)

> PIE Gateway Phase 1（Places Detail）已正式關閉。  
> R0 已確認通過。R1 **不一次導入全部 RAOS 權重**，拆成 R1.1–R1.4；**每完成一個 R1.x 即停止待確認**。

---

## 0. Confirmed Decisions（已確認）

| # | 決策 | 狀態 |
|---|---|---|
| 1 | Recommendation Engine 採 **Adapter** 接入 | ✅ |
| 2 | 第一階段僅接 **Explore** | ✅ |
| 3 | **R0 行為必須與現況完全一致** | ✅ |
| 4 | Feature Flag：`VITE_REC_ENGINE_ENABLED`（預設 OFF） | ✅ |
| 5 | **不修改** Home、Chat、Planner 的商業邏輯 | ✅ |
| 6 | Planner 僅接收排序結果，不負責推薦 | ✅ |
| 7 | R0 通過；R1 拆成 R1.1–R1.4 小階段 | ✅ |
| 8 | Pipeline **explain** 輸出結構化 `RecommendationReason`（不組完整句子） | ✅ |
| 9 | 權重由 **Recommendation Profile** 管理（非寫死於 Engine） | ✅ |
| 10 | Memory/DNA 只提供 Weight Suggestion / Preference Signal，不直接排序 | ✅ |

非目標：

- 繼續遷移 Places Search / Nearby HTTP
- 一次刪除舊推薦路徑
- 一次套用完整 DNA/Memory/Weather/Learning 權重
- 改 Home / Chat / Planner 推薦行為

---

## 1. Goal

建立統一 **Recommendation Engine**，讓各表面共用同一套 Pipeline。  
各表面只負責：**取上下文 → Adapter → Engine → 呈現**。  
Planner **只消費排序結果**，不自行做推薦決策。

---

## 2. Recommendation Pipeline（正式）

```
normalize
    ↓
filter
    ↓
deduplicate
    ↓
score
    ↓
rank
    ↓
diversify
    ↓
explain          ← 結構化 RecommendationReason（UI/AI 呈現）
    ↓
validate
```

| Stage | 職責 | 現況 |
|---|---|---|
| **normalize** | 資料標準化 | R0 已接 |
| **filter** | 營業時間、黑名單、類別排除等 | R0 pass-through |
| **deduplicate** | 移除重複地點 | R0 pass-through |
| **score** | 依 Profile（+ Suggestions）計分 | R0 legacy / R1.1 Profile / R1.2 + signals |
| **rank** | 依分數排序 | R0 已接 |
| **diversify** | 避免同類型連續推薦 | R0 pass-through |
| **explain** | 結構化原因（非完整句子） | ✅ `RecommendationReason[]` |
| **validate** | Recommendation Validator 最後檢查 | P4.1：Flag `VITE_REC_ENGINE_VALIDATOR_ENABLED`（OFF=pass-through） |

原則：

- Engines decide；Prompt 不擁有業務邏輯。
- **權重不寫死於 Engine** → Recommendation Profile 管理。
- Explain 只輸出結構（如 `open_now` / `nearby`）；語意「營業中／距離近」由 UI/AI 決定。
- `validate` 是最後一道閘門。

---

## 3. Recommendation Profiles

Profiles：`general` | `food` | `night` | `cafe` | `nature` | `shopping`

各 Profile 自管 `ProfileWeights`（含預留槽位：memory / dna / weather / season / festival / mood / learning）。  
未來加入 DNA、Weather、Mood 時，**改 Profile 或 Weight Suggestion**，不必改 Engine 核心。

`categoryHint` → Profile（例：`food`→food、`cafe`→cafe、未知→general）。

### Explain — RecommendationReason

```ts
{ code: "open_now" | "closing_soon" | "nearby" | "high_rating" | "many_reviews" | "memory_match" | "dna_match" | …,
  strength: number,  // 0–1
  factor?: WeightFactorKey }
```

語意對照（非輸出字串）：營業中 / 即將打烊 / 距離近 / 評分高 / 評論數多 / Memory 相符 / DNA 相符。

---

## 4. Target Architecture

```
Explore
  → Adapter
  → (optional) Memory/DNA → WeightSuggestion + PreferenceSignal
  → Profile weights ⊕ suggestions → Engine score → rank → explain → validate
```

| Flag | 預設 | 作用 |
|---|---|---|
| `VITE_REC_ENGINE_ENABLED` | OFF | Adapter；OFF = `sortExplorePlaces` |
| `VITE_REC_ENGINE_R1_1_ENABLED` | OFF | Profile 四因子計分 |
| `VITE_REC_ENGINE_R1_2_ENABLED` | OFF | Memory/DNA Suggestion + Signal |

---

## 5. Scoring — R1 小階段

### R1.1 — 基礎因子（✅）

Hours / Distance / Rating / Reviews — 權重在 Profile 內。

### R1.2 — Personalization（✅）

| 規則 | 說明 |
|---|---|
| Memory / DNA **不直接控制排序** | 禁止 `sortByDna()` 之類捷徑 |
| 只提供 **Weight Suggestion** 或 **Preference Signal** | delta 權重 / type·label 親和度 |
| **最終排序由 Engine 統一計算** | `score = Σ (factor × effectiveWeight)` |

輕量輸入：現有 `UserProfileForReason`（interests / personalityType）。完整 Memory/DNA 模組就緒後可替換 signal 來源，無需改 Pipeline。

### R1.3 — Context（Pending）

Weather / Season / Festival — 同樣以 Suggestion/Signal + Profile 槽位接入。

### R1.4 — Learning loop（Pending）

Learning / Feedback / AI Insight。

每完成一個 R1.x：**停止**待確認。

---

## 6. Migration Plan

| Phase | 內容 | 狀態 |
|---|---|---|
| **R0** | Engine + Pipeline + Explore Adapter；行為 = 現況 | ✅ Confirmed |
| **R1.1** | Profile 四因子 + Flag | ✅ Confirmed |
| **R1.2** | Memory / DNA signals + Flag | ✅ Confirmed |
| **R1.3** | Weather / Season / Festival | **Paused**（優先 Planner Integration） |
| **Planner P1** | Adapter + trip-place-scoring 行為對齊 | ✅ Confirmed |
| **Planner Contract** | [planner-contract.md](./planner-contract.md) 職責邊界 | ✅ Documented |
| **Planner P2** | 移除 Planner 內排序；嚴格依 Contract | Pending |
| **R1.4** | Learning / Feedback / AI Insight | Pending |
| **R2+** | filter / dedupe / diversify；Chat / Home / Planner adapters | Pending |

---

## 7. Module layout

```
src/lib/recommendation/engine/
  profiles.ts                  # Recommendation Profiles + weights
  reasons.ts                   # RecommendationReason codes
  score-with-profile.ts
  feature-flag.ts / -r1-1 / -r1-2
  signals/
    types.ts                   # WeightSuggestion, PreferenceSignal
    from-memory.ts
    from-dna.ts
    merge.ts
  stages/explain.ts            # structured reasons
  adapters/explore.ts
  index.ts
```

---

## 8. Metrics

- `path`: `legacy` | `engine` | `engine_r1_1` | `engine_r1_2`
- `surface`、`candidateCount`、`resultCount`、`latencyMs`

---

## 9. Relationship to PIE Phase 1

PIE Gateway Phase 1 **closed**。Recommendation 不繼續搬 Search/Nearby。

---

## 10. Verification

```bash
npm run verify:rec-engine-r0
npm run verify:rec-engine-r1-1
npm run verify:rec-engine-r1-2
```
