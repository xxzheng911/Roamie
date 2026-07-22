# Candidate Pool Legacy Helper Inventory (P0 Phase 1)

**Scope:** inventory only — do **not** delete or migrate in this sprint.  
**File:** `src/lib/ai/planning-candidate-pool.ts`  
**RAOS package:** `src/lib/ai/candidate-pool/*` (flag `VITE_CANDIDATE_POOL_ENABLED=1`)

---

## Export usage matrix

| Export | Runtime callers | Status | Safe to remove? |
|---|---|---|---|
| `shouldSkipPlanningPlacesApi` | `destination-trip-planning.ts`, `destination-combination-discovery.ts`, `destination-place-recommendation.ts`, `place-pool-expansion.ts`, `candidate-pool/stages/search.ts` | **Active** — rate-protection gate shared by RAOS + legacy paths | **No** |
| `waitIfPlacesRateLimited` | `destination-combination-discovery.ts` | **Active** — cooldown wait before combination Places calls | **No** |
| `mergePlanningCandidatePool` | `destination-trip-planning.ts` (multiple), internal `ensureRenderableStyleDayPlans` | **Active** — classic landmark / local-life / named fallback merge when pool thin or rate-limited | **No** (still on Planner path even with RAOS Candidate Pool ON) |
| `persistPlanningCandidatePool` | `destination-trip-planning.ts`, internal `ensureRenderableStyleDayPlans` | **Active** — writes classic landmark session/daily caches | **No** |
| `rebuildDayPlansFromCandidatePool` | Internal only (`ensureRenderableStyleDayPlans`) | **Active (indirect)** | **No** while `ensureRenderableStyleDayPlans` is used |
| `ensureRenderableStyleDayPlans` | `destination-trip-planning.ts` | **Active** — day rebuild / renderability repair after compose | **No** |
| `logAiCandidatePoolReused` | `destination-trip-planning.ts` + internal merge | **Active** — diagnostic logs | **No** (or fold into RAOS pool log later) |
| `logAiDayPlanRebuildFromCache` | Internal rebuild loop only | **Active (indirect)** | **No** while rebuild exists |
| `MAX_DAY_PLAN_CACHE_REBUILDS` | Internal rebuild loop | **Active (indirect)** | **No** |
| `logAiPlacesRateLimitFallback` | Re-export from `places-classic-landmark-cache` | **Re-export** — confirm external imports if any | Treat as **keep** until re-export removed intentionally |

---

## Classification

### Still required at Runtime (keep)
- Rate skip / cooldown helpers (`shouldSkipPlanningPlacesApi`, `waitIfPlacesRateLimited`)
- Style-plan pool merge + persist + ensure-renderable (`merge*`, `persist*`, `ensureRenderableStyleDayPlans`, rebuild)

### Overlap with RAOS Candidate Pool (do not delete yet)
When `VITE_CANDIDATE_POOL_ENABLED=1`, `destination-trip-planning.ts` calls `buildCandidatePool()` **and** still uses legacy merge/persist/ensure helpers for:
- rate-limited fallbacks
- classic landmark cache top-up
- day-plan rebuild from cached pool

These are **parallel**, not dead code.

### No Runtime usage found outside this file
- None of the listed exports are unused at Runtime.
- Internal-only helpers are still reachable via `ensureRenderableStyleDayPlans`.

### Safe to remove in a future sprint (after migration)
Only after:
1. Rate protection is imported directly from `places-cost-cache/rate-protection` + `places-api-guard` at all call sites
2. Classic landmark merge/persist moves into RAOS `candidate-pool` or `places-cost-cache`
3. Day rebuild path uses RAOS pool exclusively and `ensureRenderableStyleDayPlans` has zero callers
4. Verify scripts + style-plan device QA pass with legacy file deleted

**This sprint: zero deletions.**

---

## Recommended next cleanup order (future, not now)

1. Re-home `shouldSkipPlanningPlacesApi` / `waitIfPlacesRateLimited` to `places-cost-cache` (thin wrappers)
2. Point RAOS `candidate-pool/stages/search.ts` at the new home
3. Collapse `mergePlanningCandidatePool` into RAOS pool annotate/top-up stage
4. Delete `planning-candidate-pool.ts` once callers are gone
