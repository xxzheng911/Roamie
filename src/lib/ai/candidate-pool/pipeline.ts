/**
 * Candidate Pool Pipeline (RAOS Priority 1)
 *
 * Places Search → Quality Gate → Category Diversity → Query Diversity →
 * Geo Clustering → Temporal Diversity → Travel Flow → Experience Optimizer →
 * Candidate Pool
 *
 * Does not open Validator / PIE Search. Does not schedule routes (Planner).
 */
import type { PlaceResult } from "@/lib/place-result";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import { normalizePlanningPlaces } from "@/lib/ai/normalize-planning-places";
import { filterExcludedRetailPlaces } from "@/lib/ai/ai-day-plan-slot-rules";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { buildCandidatePoolDemand } from "@/lib/ai/candidate-pool/demand";
import {
  annotatePlaces,
  buildPoolStats,
  clustersToMap,
} from "@/lib/ai/candidate-pool/annotate";
import { applyQualityGate } from "@/lib/ai/candidate-pool/stages/quality";
import { dedupeParentLandmarkPlaces } from "@/lib/ai/ai-parent-landmark-dedup";
import {
  underrepresentedCategories,
  logCategoryStage,
} from "@/lib/ai/candidate-pool/stages/category";
import {
  buildGeoClustersFromPlaces,
} from "@/lib/ai/candidate-pool/stages/geo";
import {
  applyTemporalDiversity,
  underrepresentedTemporalSlots,
  kindsForTemporalSlot,
} from "@/lib/ai/candidate-pool/stages/temporal";
import {
  applyTravelFlow,
  kindsForTravelIntent,
} from "@/lib/ai/candidate-pool/stages/flow";
import { applyExperienceOptimizer } from "@/lib/ai/candidate-pool/stages/experience";
import {
  expandByGeoClusters,
  expandByKinds,
  runCategoryQuerySearch,
} from "@/lib/ai/candidate-pool/stages/search";
import {
  CANDIDATE_POOL_VERSION,
  type CandidatePoolResult,
  type CandidatePoolSearchFn,
} from "@/lib/ai/candidate-pool/types";
import type { PlanPlaceKind } from "@/lib/ai/ai-day-plan-source";
import {
  bindSessionCandidatePool,
  readCandidatePoolCache,
  readSessionCandidatePool,
  runCappedCategorySearch,
  shouldBlockNewPlacesCalls,
  writeCandidatePoolCache,
} from "@/lib/ai/places-cost-cache";

type Kind = PlanPlaceKind;

export type BuildCandidatePoolParams = {
  destination: string;
  lat: number;
  lng: number;
  style: TripStyleKey;
  days: number;
  search: CandidatePoolSearchFn;
  seedPlaces?: PlaceResult[];
  userText?: string;
  /** Chat / planning session — bind pool until destination changes */
  sessionId?: string | null;
  countryCode?: string;
  /**
   * When true (default): max 5 category searches once; no Places expand;
   * reuse Layer-2 / session cache. Set false only for legacy multi-query debug.
   */
  costCacheMode?: boolean;
};

function uniqKinds(kinds: Kind[]): Kind[] {
  const seen = new Set<Kind>();
  const out: Kind[] = [];
  for (const k of kinds) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export async function buildCandidatePool(
  params: BuildCandidatePoolParams,
): Promise<CandidatePoolResult> {
  const demand = buildCandidatePoolDemand({
    days: params.days,
    style: params.style,
  });
  const costCacheMode = params.costCacheMode !== false;

  logAiPipeline(
    "[CANDIDATE_POOL_START]",
    `destination=${params.destination}`,
    `style=${params.style}`,
    `days=${params.days}`,
    `minTotal=${demand.minTotal}`,
    `minCanonical=${demand.minCanonical}`,
    `version=${CANDIDATE_POOL_VERSION}`,
    `costCacheMode=${costCacheMode}`,
  );

  // Layer 2 / Session reuse — 0 Places calls
  if (costCacheMode) {
    const sessionHit = readSessionCandidatePool({
      sessionId: params.sessionId,
      destination: params.destination,
    });
    if (sessionHit?.places.length) {
      const shaped = shapeCandidatePoolPlaces(sessionHit.places, {
        days: params.days,
        style: params.style,
        userText: params.userText,
      });
      return shaped;
    }
    const cached = readCandidatePoolCache(
      params.destination,
      params.countryCode,
    );
    if (cached?.places.length) {
      if (params.sessionId) {
        bindSessionCandidatePool({
          sessionId: params.sessionId,
          destination: params.destination,
          places: cached.places,
          poolResult: cached.poolResult,
        });
      }
      return (
        cached.poolResult ??
        shapeCandidatePoolPlaces(cached.places, {
          days: params.days,
          style: params.style,
          userText: params.userText,
        })
      );
    }
  }

  // 1–3. Places Search
  let searchTotal = 0;
  let places: PlaceResult[];
  if (costCacheMode) {
    // Max 5 categories × 1 search — no per-combo / expand re-search
    const searched = await runCappedCategorySearch({
      destination: params.destination,
      lat: params.lat,
      lng: params.lng,
      search: params.search,
      seedPlaces: params.seedPlaces,
      sessionId: params.sessionId,
    });
    searchTotal += searched.searchRequestCount;
    places = searched.places;
  } else {
    const searched = await runCategoryQuerySearch({
      destination: params.destination,
      lat: params.lat,
      lng: params.lng,
      style: params.style,
      days: params.days,
      search: params.search,
      seedPlaces: params.seedPlaces,
    });
    searchTotal += searched.searchRequestCount;
    places = searched.places;
  }

  // 4. Quality Gate
  const quality = applyQualityGate(places, {
    style: params.style,
    userText: params.userText,
  });
  // Parent Landmark Collapse — before category / geo / Planner
  places = dedupeParentLandmarkPlaces(quality.kept);

  const allowPlacesExpand =
    !costCacheMode && !shouldBlockNewPlacesCalls({ logSkip: false });

  // Category inventory + expand if still weak after quality
  let weakCats = underrepresentedCategories(places, demand);
  logCategoryStage(places, demand, weakCats);
  if (weakCats.length && allowPlacesExpand) {
    const expanded = await expandByKinds({
      places,
      destination: params.destination,
      lat: params.lat,
      lng: params.lng,
      days: params.days,
      kinds: weakCats,
      phase: "category_post_quality",
      search: params.search,
    });
    searchTotal += expanded.searchRequestCount;
    places = applyQualityGate(expanded.places, {
      style: params.style,
      userText: params.userText,
    }).kept;
  }

  // 5. Geo Clustering (+ optional Places expand only in legacy mode)
  let { clusters } = buildGeoClustersFromPlaces(places, params.days);
  if (
    allowPlacesExpand &&
    (clusters.length < demand.minGeoClusters || places.length < demand.minTotal)
  ) {
    const geoExpanded = await expandByGeoClusters({
      places,
      destination: params.destination,
      lat: params.lat,
      lng: params.lng,
      days: params.days,
      style: params.style,
      search: params.search,
    });
    searchTotal += geoExpanded.searchRequestCount;
    places = applyQualityGate(geoExpanded.places, {
      style: params.style,
      userText: params.userText,
    }).kept;
    clusters = buildGeoClustersFromPlaces(places, params.days).clusters;
  }

  // 6. Temporal Diversity — pure reshape; Places expand only in legacy mode
  places = applyTemporalDiversity(places, demand);
  const weakTemporal = underrepresentedTemporalSlots(places, demand);
  if (weakTemporal.length && allowPlacesExpand) {
    const kinds = uniqKinds(
      weakTemporal.flatMap((slot) => kindsForTemporalSlot(slot)),
    );
    logAiPipeline(
      "[CANDIDATE_POOL_TEMPORAL_EXPAND]",
      `weak=[${weakTemporal.join(",")}]`,
      `kinds=[${kinds.join(",")}]`,
    );
    const expanded = await expandByKinds({
      places,
      destination: params.destination,
      lat: params.lat,
      lng: params.lng,
      days: params.days,
      kinds,
      phase: "temporal_expand",
      search: params.search,
    });
    searchTotal += expanded.searchRequestCount;
    places = applyQualityGate(expanded.places, {
      style: params.style,
      userText: params.userText,
    }).kept;
  }

  // 7. Travel Flow — Travel Intent coverage
  const flow = applyTravelFlow(places, demand);
  places = flow.places;
  if (flow.weakIntents.length && allowPlacesExpand) {
    const kinds = uniqKinds(
      flow.weakIntents.flatMap((intent) => kindsForTravelIntent(intent)),
    );
    logAiPipeline(
      "[CANDIDATE_POOL_FLOW_EXPAND]",
      `weak=[${flow.weakIntents.join(",")}]`,
      `kinds=[${kinds.join(",")}]`,
    );
    const expanded = await expandByKinds({
      places,
      destination: params.destination,
      lat: params.lat,
      lng: params.lng,
      days: params.days,
      kinds,
      phase: "flow_expand",
      search: params.search,
    });
    searchTotal += expanded.searchRequestCount;
    places = applyQualityGate(expanded.places, {
      style: params.style,
      userText: params.userText,
    }).kept;
  }

  // 8. Experience Optimizer
  places = applyExperienceOptimizer(places, demand);

  // Finalize — normalize + retail safety net
  places = filterExcludedRetailPlaces(normalizePlanningPlaces(places), {
    style: params.style,
    userText: params.userText,
  });

  clusters = buildGeoClustersFromPlaces(places, params.days).clusters;
  const clusterMap = clustersToMap(clusters);
  const annotated = annotatePlaces(places, clusterMap);
  const stats = buildPoolStats(
    "finalize",
    annotated,
    quality.rejected,
    clusters.length,
  );

  logAiPipeline(
    "[CANDIDATE_POOL_FINAL]",
    `destination=${params.destination}`,
    `style=${params.style}`,
    `days=${params.days}`,
    `total=${places.length}`,
    `canonical=${stats.canonicalCount}`,
    `requiredCanonical=${demand.minCanonical}`,
    `minTotal=${demand.minTotal}`,
    `geoClusters=${clusters.length}`,
    `searchRequestCount=${searchTotal}`,
    `byCategory=${Object.entries(stats.byCategory)
      .map(([k, n]) => `${k}:${n}`)
      .join("|")}`,
    `byTemporal=${Object.entries(stats.byTemporal)
      .map(([k, n]) => `${k}:${n}`)
      .join("|")}`,
    `byIntent=${Object.entries(stats.byIntent)
      .map(([k, n]) => `${k}:${n}`)
      .join("|")}`,
    `byExperience=${Object.entries(stats.byExperience)
      .map(([k, n]) => `${k}:${n}`)
      .join("|")}`,
    stats.canonicalCount >= demand.minCanonical &&
      places.length >= demand.minTotal
      ? "ready=true"
      : "ready=false",
  );

  const result: CandidatePoolResult = {
    places,
    annotated,
    clusters,
    demand,
    stats,
    path: "candidate_pool",
    version: CANDIDATE_POOL_VERSION,
  };

  if (costCacheMode && places.length) {
    writeCandidatePoolCache({
      destination: params.destination,
      countryCode: params.countryCode,
      places,
      poolResult: result,
      searchRequestCount: searchTotal,
    });
    if (params.sessionId) {
      bindSessionCandidatePool({
        sessionId: params.sessionId,
        destination: params.destination,
        places,
        poolResult: result,
      });
    }
  }

  return result;
}

/** Pure shaping for unit tests (no Places Search). */
export function shapeCandidatePoolPlaces(
  places: PlaceResult[],
  params: { days: number; style: TripStyleKey; userText?: string },
): CandidatePoolResult {
  const demand = buildCandidatePoolDemand(params);
  const quality = applyQualityGate(places, {
    style: params.style,
    userText: params.userText,
  });
  // Parent Landmark Collapse before Planner (global, destination-agnostic).
  let next = dedupeParentLandmarkPlaces(quality.kept);
  next = applyTemporalDiversity(next, demand);
  next = applyTravelFlow(next, demand).places;
  next = applyExperienceOptimizer(next, demand);
  next = filterExcludedRetailPlaces(normalizePlanningPlaces(next), {
    style: params.style,
    userText: params.userText,
  });
  const { clusters } = buildGeoClustersFromPlaces(next, params.days);
  const annotated = annotatePlaces(next, clustersToMap(clusters));
  const stats = buildPoolStats(
    "finalize",
    annotated,
    quality.rejected,
    clusters.length,
  );
  return {
    places: next,
    annotated,
    clusters,
    demand,
    stats,
    path: "candidate_pool",
    version: CANDIDATE_POOL_VERSION,
  };
}

export function poolMeetsDiversityFloor(result: CandidatePoolResult): boolean {
  const { places, demand, stats, clusters } = result;
  if (places.length < demand.minTotal * 0.7) return false;
  if (stats.canonicalCount < Math.ceil(demand.minCanonical * 0.7)) return false;
  if (clusters.length < Math.min(2, demand.minGeoClusters)) return false;
  return true;
}
