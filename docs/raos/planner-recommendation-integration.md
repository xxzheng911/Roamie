# Planner ↔ Recommendation Engine Integration

Version: 1.0  
Status: **P1–P4.2 ✅；AI 接線 Priority 1 Step 1 — 自動化 ✅，實機 Case 1–5 待勾選**  
實機清單：[ai-wiring-p1-step1-acceptance.md](./ai-wiring-p1-step1-acceptance.md)  
Related: [planner-contract.md](./planner-contract.md)（**職責邊界契約 — P2+ 強制**）, [recommendation-engine-design.md](./recommendation-engine-design.md), [chapter-08-planner-optimizer.md](./chapter-08-planner-optimizer.md), [chapter-09-validator-engine.md](./chapter-09-validator-engine.md)

---

## Confirmed decisions

| # | Decision |
|---|---|
| 1 | Recommendation Engine = **sole** candidate ranking source |
| 2 | Planner must **not** re-sort the candidate pool or recompute recommendation scores |
| 3 | Planner only: time slots, route constraints, meal slots, dedupe, pace, locked places |
| 4 | Place/Recommendation validation **and** Itinerary validation stay layered |
| 5 | **P1** = behavior parity with `trip-place-scoring` (lower regression risk) |
| 6 | **P2** = gradually remove Planner-internal ranking |
| 7 | **P3** = PIE Search for planner candidates |
| 8 | **P4** = wire real Validator Engine |
| 9 | Pause R1.3 (Weather/Season/Festival weights) until Planner integration advances |
| 10 | Naming: **Recommendation Validator** (pipeline `validate` stage) for ranked candidates; Itinerary Validator remains schedule-level |
| 11 | `RecommendationResult.scoreBreakdown` = per-factor score detail for Explain / Debug / A/B / AI reasons |
| 12 | Binding contract: [planner-contract.md](./planner-contract.md) |

---

## Target flow

```
Places → PIE → Recommendation Engine → Recommendation Validator → Planner → Itinerary Validator
```

P1 scope: **Planner Adapter + Flag**; candidates may still come from existing `PlaceSearchFn` (PIE Search = P3).

---

## Phases

| Phase | Content | Flag / 狀態 |
|---|---|---|
| **P1** | Adapter + trip-place-scoring 行為對齊 | ✅ Flag 預設 OFF |
| **P2.1** | Flag ON：Engine **Profile** 為唯一排序；硬過濾僅約束；不再用 trip-place-scoring 排序 | ✅ |
| **P2.2** | `pickPlaceForSlot` 依 pool 順序 + 約束；`scorePlaceForTheme` 僅 Flag OFF legacy | ✅ |
| **P2.3** | Local life / Classic / `rankByQuality` → Flag ON 不重排；legacy 保留 | ✅ Verified |
| **P3.1** | Planner 候選 fetch 入口經 PIE Search Gateway | ✅ Flag 預設 OFF |
| **P3.2+** | PIE Search 內部 Quality / Dedup / Matching（可選強化） | Pending（Validator 後） |
| **P4.1** | Recommendation Validator 實閘（pipeline `validate`） | ✅ Flag 預設 OFF |
| **P4.2** | Itinerary Validator 實閘（結構化結果；不重組） | ✅ Flag 預設 OFF |

Flags（互獨立，皆預設 OFF）：
- `VITE_REC_ENGINE_PLANNER_ENABLED` — 排序經 Recommendation Engine
- `VITE_PIE_PLANNER_SEARCH_ENABLED` — 候選搜尋經 PIE Gateway
- `VITE_REC_ENGINE_VALIDATOR_ENABLED` — Recommendation Validator 實閘
- `VITE_ITINERARY_VALIDATOR_ENABLED` — Itinerary Validator 實閘

---

## P3.1 notes

```
Places → PIE Gateway (Search) → Recommendation Engine → Recommendation Validator → Planner → Itinerary Validator
```

- 入口：`wrapPlannerPlaceSearchViaGateway`（`fetchItineraryPlaces` / `prepareDirectItinerarySession` / `generateTripPlanFromStyle`）
- Flag OFF → 直呼注入的 `PlaceSearchFn`（legacy；保留 unified client fallback）
- Flag ON → Gateway `path=pie`；P3.1 IO 仍委派同一注入函式（行為對齊、可回退）
- **不改** Chat / Trip-add / Explore / Home 呼叫端
- **不擴充** Recommendation Feature / 權重
- 驗證：`npm run verify:pie-planner-p3`

---

## P4.1 notes（Recommendation Validator）— Priority 2 實機接線

- Stage：pipeline 末端 `validate` → `validateRecommendations(ranked, ctx)` / `validateRecommendationsDetailed`
- Flag：`VITE_REC_ENGINE_VALIDATOR_ENABLED`（與 Candidate Pool / Planner / PIE / Itinerary Validator 獨立）
- Flag OFF → pass-through（行為不變）
- Flag ON → 閘門（**不重排、不重算分、不組裝、不補搜**）：
  - 必須淘汰：缺 id/name、永久停業、殯葬、超市／量販／便利商店、辦公／住宅、純交通／停車、住宿（非明確住宿需求）、排除條件、duplicate placeId / canonicalLandmarkKey
  - 條件性保留：market／mall／park／night market／bar／chain／premise（依 style／intent）
  - 過濾後檢查 category／geo／temporal／flow／canonical；`availableCount < requiredCount` → `recommendationInsufficient=true`，**清空**交給 Planner 的池並回傳診斷
- 診斷 log：`[REC_VALIDATOR_INPUT|ITEM|REJECT|SUMMARY|POOL_COMPARE]`
- **不做** Itinerary Validator、PIE Search、新 Recommendation 權重、Planner 組裝改動
- 驗證：`npm run verify:rec-engine-planner-p4`

---

## P4.2 notes（Itinerary Validator）

```
Places → PIE → Recommendation Engine → Recommendation Validator → Planner → Itinerary Validator → Persistence → UI
```

- 模組：`src/lib/ai/itinerary-validator/`
- Flag：`VITE_ITINERARY_VALIDATOR_ENABLED`（本階段正式啟用；與 Rec Validator / Planner / PIE Search 獨立）
- Flag OFF → pass-through；不跑結構化閘門；既有 Planner repair 保留
- Flag ON → `validateItineraryPlan` → 最多 2 次 `replanUntilItineraryValid` → `pass=false` 阻擋交付
- **不**重排整趟、**不**搜尋新地點、**不**改 Rec Engine／Candidate Pool
- 接線入口：
  - Style／Combination：`generateTripPlanFromStyle` + `recommendDestinationPlaces` 交付閘
  - Direct／選點：`generateItinerary`（`itinerary.functions.ts`）
  - 本地 fallback／Chat 建行程：`createItineraryFromSession` / `buildLocalItineraryPayload`
- 驗證：`npm run verify:itinerary-validator-p4-2`（Case A–J）

`ItineraryValidationResult`：`pass`, `score`, `failedRules`, `warnings`, `affectedDays`, `affectedPlaceIds`, `validatorVersion`, `replanReasons`, `path`, `nearbyCoverage?`

---

## P1 contracts

```ts
type PlannerCandidatePool = {
  surface: "planner";
  results: RecommendationResult[]; // ordered; includes scoreBreakdown + reasons
};

// RecommendationResult
{
  placeId, score, reasons, scoreBreakdown, candidate, profileId?
}
```

- Flag OFF → `filterAndRankTripPlacesForPlanning`（legacy 回退）
- Flag ON（P2.1）→ Engine Profile 排序 + `applyPlannerHardConstraints`（不排序）
- First surface: `rankPlacesForTripPlanning` in `destination-trip-planning.ts`
- Home / Chat / Explore paths unchanged by this flag

### P2.1 notes

- 不新增 Planner 專屬 Weight／Score 系統  
- `trip-place-scoring` 僅保留於 Flag OFF 回退；Flag ON 不作推薦排序來源  
- `scorePlaceForTheme` 仍存在於 multi-day planner → **P2.2** 降級  

契約：[planner-contract.md](./planner-contract.md)

---

## Validation layers

| Layer | Name | When | 狀態 |
|---|---|---|---|
| Ranked candidates | **Recommendation Validator** | End of Rec Engine pipeline | P4.1 ✅（Flag OFF = pass-through） |
| Assembled trip | **Itinerary Validator** | After Planner compose | P4.2 ✅（Flag OFF = 不跑；既有 repair 路徑保留） |

---

## Non-goals (P1；歷史保留)

- No new Planner-specific ranking weights
- No R1.3 profile weight expansion
- No deletion of `trip-place-scoring`（Flag OFF legacy；Migration 完成後再移除）

P3.1 已完成 PIE Search Gateway 入口；P3.2+ 才做 PIE 內部 Quality／Dedup 強化。
