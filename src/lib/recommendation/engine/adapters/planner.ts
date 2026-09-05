/**
 * Planner Adapter（Integration P1 → P2.1）
 *
 * Flag OFF → 直呼 `filterAndRankTripPlacesForPlanning`（legacy 回退）
 * Flag ON  → Engine Pipeline + Recommendation Profile 計分（P2.1）
 *            trip-place-scoring 不再作為推薦排序來源
 *
 * 硬過濾（永久歇業／零售／殯葬／placeId 去重）= 組裝前約束，不做排序。
 * Planner 不得對回傳結果重新排序。
 *
 * Contract: docs/raos/planner-contract.md
 * AI 接線 Priority 1 Step 1：僅開 Planner Flag 時由此約束保障候選池品質。
 */

import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import { filterExcludedRetailPlaces } from "@/lib/ai/ai-day-plan-slot-rules";
import { dedupeByCanonicalLandmark } from "@/lib/ai/canonical-landmark";
import { isBurialOrFuneralPlace } from "@/lib/burial-place-filter";
import type { PlaceResult } from "@/lib/place-result";
import {
  filterAndRankTripPlacesForPlanning,
  scoreTripPlaceWithBreakdown,
  type TripPlaceScoringInput,
} from "@/lib/ai/trip-place-scoring";
import { requiredCanonicalCandidatesForTrip } from "@/lib/ai/canonical-landmark";
import { isRecEnginePlannerEnabled } from "@/lib/recommendation/engine/feature-flag-planner";
import {
  nowMs,
  recordRecEngineMetric,
} from "@/lib/recommendation/engine/metrics";
import { runRecommendationPipeline } from "@/lib/recommendation/engine/pipeline";
import { scoreCandidatesWithProfile } from "@/lib/recommendation/engine/score-with-profile";
import type { NormalizeInput } from "@/lib/recommendation/engine/stages/normalize";
import { isPlaceOperationalForRecommendation } from "@/lib/place-operational-eligibility";
import { isRecEngineValidatorEnabled } from "@/lib/recommendation/engine/feature-flag-validator";
import {
  getLastRecommendationValidationSummary,
  resetRecommendationValidationStats,
} from "@/lib/recommendation/engine/stages/validate";
import {
  attachScoreBreakdown,
  type PlannerCandidatePool,
  type RecommendationCandidate,
  type RecommendationContext,
  type ScoredCandidate,
} from "@/lib/recommendation/engine/types";

function placeToNormalizeInput(place: PlaceResult): NormalizeInput {
  return {
    placeId: place.id,
    id: place.id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    primaryType: place.primaryType,
    types: place.types,
    openStatus: place.openStatus,
    openNow: place.openNow,
    raw: place,
  };
}

/**
 * P2.1 / AI 接線 Step 1：僅硬約束過濾（不去排序、不依 rating 重排池）。
 * trip-place-scoring 的「preferred rating pool」不再使用。
 */
export function applyPlannerHardConstraints(
  places: PlaceResult[],
  style: TripStyleKey,
): PlaceResult[] {
  const retailFiltered = filterExcludedRetailPlaces(places, { style });
  const constrained = retailFiltered.filter(
    (place) =>
      Boolean(place.name?.trim()) &&
      isPlaceOperationalForRecommendation(place) &&
      !isBurialOrFuneralPlace(place),
  );
  // placeId 去重 + canonical landmark 去重（約束，非推薦重排／不加權重）
  const seen = new Set<string>();
  const deduped: PlaceResult[] = [];
  for (const place of constrained) {
    const id = (place.id ?? "").trim();
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    deduped.push(place);
  }
  return dedupeByCanonicalLandmark(deduped).places;
}

/** Trip style → Recommendation Profile hint（Engine 既有 Profiles，非 Planner 新權重） */
export function mapTripStyleToProfileHint(style: TripStyleKey | string): string {
  switch (style) {
    case "slow_nature":
      return "nature";
    case "local_life":
      return "shopping";
    case "classic_landmarks":
    case "mixed":
    default:
      return "general";
  }
}

/**
 * @deprecated P1 委派路徑；P2.1 Flag ON 不再使用。保留供測試對照。
 */
function scoreViaTripPlaceScoring(
  scoringInput: TripPlaceScoringInput,
): (
  candidates: readonly RecommendationCandidate[],
  _ctx: RecommendationContext,
) => ScoredCandidate[] {
  return (candidates) => {
    const rawPlaces = candidates.map((c) => c.raw as PlaceResult);
    const ranked = filterAndRankTripPlacesForPlanning(rawPlaces, scoringInput);

    const byId = new Map<string, RecommendationCandidate>();
    for (const c of candidates) {
      byId.set(c.placeId, c);
      if (c.raw && typeof c.raw === "object" && "id" in c.raw) {
        byId.set(String((c.raw as PlaceResult).id), c);
      }
    }

    return ranked.map((place) => {
      const candidate =
        byId.get(place.id) ??
        ({
          placeId: place.id,
          name: place.name,
          lat: place.lat,
          lng: place.lng,
          rating: place.rating,
          userRatingCount: place.userRatingCount,
          primaryType: place.primaryType,
          types: place.types,
          openStatus: place.openStatus,
          openNow: place.openNow,
          source: "planner" as const,
          raw: place,
        } satisfies RecommendationCandidate);

      const { score, scoreBreakdown } = scoreTripPlaceWithBreakdown(
        place,
        scoringInput,
      );

      return {
        candidate: { ...candidate, raw: place },
        score,
        reasons: [],
        ...attachScoreBreakdown({ ...scoreBreakdown }),
      };
    });
  };
}

/** P2.1：Engine Profile 計分（唯一排序來源） */
function scoreViaRecommendationProfiles(
  scoringInput: TripPlaceScoringInput,
): (
  candidates: readonly RecommendationCandidate[],
  ctx: RecommendationContext,
) => ScoredCandidate[] {
  return (candidates, ctx) =>
    scoreCandidatesWithProfile(candidates, {
      ...ctx,
      surface: "planner",
      categoryHint: mapTripStyleToProfileHint(scoringInput.style),
      location:
        scoringInput.centerLat != null && scoringInput.centerLng != null
          ? { lat: scoringInput.centerLat, lng: scoringInput.centerLng }
          : ctx.location,
    });
}

function buildPlannerRecommendationContext(
  scoringInput: TripPlaceScoringInput,
): RecommendationContext {
  const pace =
    scoringInput.pace ??
    (scoringInput.style === "slow_nature" ? "slow" : "medium");
  const requiredCount = requiredCanonicalCandidatesForTrip(
    scoringInput.days,
    pace === "slow" || pace === "medium" || pace === "active" ? pace : "medium",
  );
  const excludedCategories = scoringInput.context?.excludedCategories ?? [];
  const rejectedNames = scoringInput.context?.excludedCombinationPlaceNames ?? [];
  const interestText = [
    ...(scoringInput.context?.interests ?? []),
    ...(scoringInput.context?.selectedInterests ?? []),
    scoringInput.context?.selectedTripStyle ?? "",
    scoringInput.context?.travelStyle ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    surface: "planner",
    location:
      scoringInput.centerLat != null && scoringInput.centerLng != null
        ? { lat: scoringInput.centerLat, lng: scoringInput.centerLng }
        : undefined,
    categoryHint: mapTripStyleToProfileHint(scoringInput.style),
    exclusions: {
      placeIds: [],
      names: [],
      rejectedNames,
    },
    surfaceOptions: {
      scoringInput,
      rankingSource: "recommendation_profile",
      style: scoringInput.style,
      requiredCount,
      excludedCategories,
      userText: interestText,
    },
  };
}

function runPlannerEnginePipeline(
  places: PlaceResult[],
  scoringInput: TripPlaceScoringInput,
): import("@/lib/recommendation/engine/types").RecommendationResult[] {
  resetRecommendationValidationStats();
  const constrained = applyPlannerHardConstraints(places, scoringInput.style);
  const ctx = buildPlannerRecommendationContext(scoringInput);

  return runRecommendationPipeline({
    ctx,
    inputs: constrained.map(placeToNormalizeInput),
    source: "planner",
    scoreFn: scoreViaRecommendationProfiles(scoringInput),
  });
}

/**
 * 排序入口（供 destination-trip-planning 使用）。
 * Flag ON（P2.1）：順序 = Recommendation Engine Profile 分數。
 * Flag OFF：legacy trip-place-scoring。
 */
export function rankPlannerPlacesViaRecEngine(
  places: PlaceResult[],
  scoringInput: TripPlaceScoringInput,
): PlaceResult[] {
  const started = nowMs();

  if (!isRecEnginePlannerEnabled()) {
    const result = filterAndRankTripPlacesForPlanning(places, scoringInput);
    recordRecEngineMetric({
      surface: "planner",
      path: "legacy",
      candidateCount: places.length,
      resultCount: result.length,
      excludedCount: Math.max(0, places.length - result.length),
      latencyMs: nowMs() - started,
    });
    return result;
  }

  const results = runPlannerEnginePipeline(places, scoringInput);
  const validation = getLastRecommendationValidationSummary();
  // Validator Flag ON + insufficient → empty pool（不得交給 Planner 組裝）
  const ordered =
    isRecEngineValidatorEnabled() && validation.recommendationInsufficient
      ? []
      : results.map((r) => r.candidate.raw as PlaceResult);

  recordRecEngineMetric({
    surface: "planner",
    path: "engine_planner_p2",
    candidateCount: places.length,
    resultCount: ordered.length,
    excludedCount: Math.max(0, places.length - ordered.length),
    latencyMs: nowMs() - started,
  });

  return ordered;
}

/**
 * 完整 pool（含 scoreBreakdown / reasons）。
 */
export function buildPlannerCandidatePool(
  places: PlaceResult[],
  scoringInput: TripPlaceScoringInput,
): PlannerCandidatePool {
  if (!isRecEnginePlannerEnabled()) {
    const ranked = filterAndRankTripPlacesForPlanning(places, scoringInput);
    return {
      surface: "planner",
      results: ranked.map((place) => {
        const { score, scoreBreakdown } = scoreTripPlaceWithBreakdown(
          place,
          scoringInput,
        );
        const sb = { ...scoreBreakdown };
        return {
          placeId: place.id,
          score,
          reasons: [],
          scoreBreakdown: sb,
          breakdown: sb,
          candidate: {
            placeId: place.id,
            name: place.name,
            lat: place.lat,
            lng: place.lng,
            rating: place.rating,
            userRatingCount: place.userRatingCount,
            primaryType: place.primaryType,
            types: place.types,
            openStatus: place.openStatus,
            openNow: place.openNow,
            source: "planner",
            raw: place,
          },
        };
      }),
    };
  }

  return {
    surface: "planner",
    results: runPlannerEnginePipeline(places, scoringInput),
  };
}

/** 測試／診斷：暴露 P1 委派 scoreFn（不應再被生產路徑使用） */
export const __testOnly_scoreViaTripPlaceScoring = scoreViaTripPlaceScoring;
