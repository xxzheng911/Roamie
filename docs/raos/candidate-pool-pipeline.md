# Candidate Pool Pipeline（RAOS Priority 1）

Version: 1.1  
Status: Implemented（Flag 預設 OFF；與 Validator / PIE Search 獨立）  
Cost Cache: **Places Cost Cache**（`src/lib/ai/places-cost-cache/`）— Beta 必做

## Target flow

```
Places Search
  ↓
Quality Gate
  ↓
Category Diversity
  ↓
Query Diversity
  ↓
Geo Clustering
  ↓
Temporal Diversity
  ↓
Travel Flow
  ↓
Experience Optimizer
  ↓
Candidate Pool
  ↓
Recommendation Engine
  ↓
Planner
  ↓
Validator
  ↓
UI
```

## Places Cost Cache（API 成本優化）

```
Destination
  ↓ Geocode（Layer 1，TTL 30m）
  ↓ Places Search × ≤5 categories（一次）
  ↓ Candidate Pool（Layer 2，TTL 30m + Session）
  ↓ 經典／美食／購物／咖啡／… 全部從 Pool 篩選
  ↓ Combination Cache（Layer 3，destination+style+group）
  ↓ Validator → Planner → UI
```

原則：

- 同一目的地只建立一次 Candidate Pool
- 同一聊天 Session 共用 Pool（直到目的地改變）
- 重新生成／切換組合／改天數／改偏好 → **0** Places 呼叫
- 同 Session 同 Query 5 秒 cooldown
- `PLACES_RATE_LIMIT_BLOCKED` / quota → Rate Protection，停止新 Places、不 Retry，改讀 Cache

Logs：`[CANDIDATE_POOL_CREATED|CACHE_HIT|CACHE_MISS]`、`[DESTINATION_CACHE_HIT|MISS]`、`[COMBINATION_CACHE_HIT|MISS]`、`[PLACES_SEARCH_SKIPPED]`、`[PLACES_RATE_PROTECTION]`、`[SESSION_POOL_REUSED]`

Verify：`npm run verify:places-cost-cache`

## Principles

- 不針對單一城市寫特殊規則
- 不依賴 `destination-travel-profile.districts`
- 不依賴 `KNOWN_HUB_CENTERS`
- Geo = 座標 density clustering（`fitToDays: false`）
- 成功標準 ≠ 僅 `candidate >= days × 3`，而是 Quality + Category + Query + Geo + Temporal + Flow + Experience

## Module

`src/lib/ai/candidate-pool/` + `src/lib/ai/places-cost-cache/`

| File | Responsibility |
|---|---|
| `feature-flag.ts` | `VITE_CANDIDATE_POOL_ENABLED` / `roamie:candidate-pool` |
| `pipeline.ts` | Orchestrates stages → `CandidatePoolResult`（cost cache mode 預設 ON） |
| `stages/quality.ts` | Drop low-quality / closed / chain / retail / office / residential |
| `stages/category.ts` | Category coverage gaps |
| `stages/search.ts` | Legacy multi-query（僅 costCacheMode=false） |
| `stages/geo.ts` | Density GeoCluster（no fixed hubs） |
| `stages/temporal.ts` | Morning / Lunch / Afternoon / Dinner / Night |
| `stages/flow.ts` | Travel Intent：View / Culture / Food / Shopping / Experience / Relax / Night |
| `stages/experience.ts` | Cap repetitive experience families（e.g. temple spam） |
| `places-cost-cache/*` | Layer 1–3 cache、cooldown、rate protection、filter-from-pool |

## Flag

- Env: `VITE_CANDIDATE_POOL_ENABLED=1`
- localStorage: `roamie:candidate-pool=1`
- Default: **OFF**（legacy Geo Hub path）
- Independent of Planner / Rec Validator / Itinerary Validator / PIE Search flags

## Integration

`fetchComposedCategoryPlaces`（`destination-trip-planning.ts`）：

- Flag ON → `buildCandidatePool(...)`（cost cache：≤5 category searches；hit cache → 0 Places）
- Flag OFF → legacy hub rotation（`style-geo-diversity`）

## Verify

```bash
npm run verify:candidate-pool
npm run verify:places-cost-cache
```

## Boundary

| Layer | May | Must not |
|---|---|---|
| Candidate Pool | Shape inventory, diversify, expand search | Rank for recommendation, assign day routes |
| Recommendation Engine | Rank / explain | Rebuild pool, assign days |
| Planner | Route / meals / hours / pace / capacity | Re-recommend |
| Validator | Final gate | Build candidates |
| Places Cost Cache | Reuse pool / block Places | Invent places without prior pool |
