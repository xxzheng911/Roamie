/**
 * Explore Adapter（R0 / R1.1 / R1.2）
 *
 * Flag 矩陣：
 * - REC_ENGINE OFF                         → legacy sortExplorePlaces
 * - ENGINE ON + R1.1/R1.2 OFF              → Pipeline + legacy score（R0）
 * - ENGINE ON + R1.1 ON + R1.2 OFF         → Profile 權重（四因子）
 * - ENGINE ON + R1.2 ON                    → Profile + Memory/DNA signals
 *
 * Memory/DNA 不直接排序；只提供 Weight Suggestion / Preference Signal。
 */

import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import type { PlaceOpenStatus } from "@/lib/filter-available-places";
import { isRecEngineEnabled } from "@/lib/recommendation/engine/feature-flag";
import { isRecEngineR11Enabled } from "@/lib/recommendation/engine/feature-flag-r1-1";
import { isRecEngineR12Enabled } from "@/lib/recommendation/engine/feature-flag-r1-2";
import {
  nowMs,
  recordRecEngineMetric,
  type RecEnginePath,
} from "@/lib/recommendation/engine/metrics";
import { runRecommendationPipeline } from "@/lib/recommendation/engine/pipeline";
import { scoreCandidatesWithProfile } from "@/lib/recommendation/engine/score-with-profile";
import { buildDnaPersonalization } from "@/lib/recommendation/engine/signals/from-dna";
import { buildMemoryPersonalization } from "@/lib/recommendation/engine/signals/from-memory";
import type { PersonalizationBundle } from "@/lib/recommendation/engine/signals/types";
import { buildPersonalizationContextV1 } from "@/lib/personalization/resolve-effective-preference";
import type { NormalizeInput } from "@/lib/recommendation/engine/stages/normalize";
import {
  attachScoreBreakdown,
  type RecommendationCandidate,
  type RecommendationContext,
  type ScoredCandidate,
} from "@/lib/recommendation/engine/types";
import {
  sortExplorePlaces,
  type ExplorePlacesSortContext,
} from "@/lib/sort-explore-places";
import type { WeatherSummary } from "@/lib/weather-types";

type SortablePlace = {
  name?: string;
  primaryType?: string | null;
  types?: string[] | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  userRatingCount?: number | null;
  openStatus?: PlaceOpenStatus;
  isSavedFavorite?: boolean;
  photoName?: string | null;
  id?: string | null;
  placeId?: string | null;
};

export type ExploreSortArgs<T extends SortablePlace> = {
  places: T[];
  origin: { lat: number; lng: number };
  profile?: UserProfileForReason | null;
  weather?: WeatherSummary | null;
  categoryId?: string;
  sortContext?: ExplorePlacesSortContext;
};

function asNormalizeInput(place: SortablePlace): NormalizeInput {
  return place as NormalizeInput;
}

function scoreViaLegacySortExplore<T extends SortablePlace>(
  args: ExploreSortArgs<T>,
): (
  candidates: readonly RecommendationCandidate[],
  _ctx: RecommendationContext,
) => ScoredCandidate[] {
  return (candidates) => {
    const rawPlaces = candidates.map((c) => c.raw as T);
    const sorted = sortExplorePlaces(
      rawPlaces,
      args.origin,
      args.profile,
      args.weather,
      args.categoryId,
      args.sortContext,
    );

    const byRef = new Map<T, RecommendationCandidate>();
    for (const c of candidates) {
      byRef.set(c.raw as T, c);
    }

    const n = sorted.length;
    return sorted.map((place, index) => {
      const candidate = byRef.get(place) ?? {
        placeId: String(place.id ?? place.placeId ?? place.name ?? index),
        name: place.name ?? "",
        lat: place.lat,
        lng: place.lng,
        rating: place.rating,
        userRatingCount: place.userRatingCount,
        primaryType: place.primaryType,
        types: place.types,
        openStatus: place.openStatus ?? null,
        source: "explore" as const,
        raw: place,
      };
      return {
        candidate,
        score: n - index,
        reasons: [],
        ...attachScoreBreakdown({ order: n - index }),
      };
    });
  };
}

function buildPersonalizationBundle(
  profile?: UserProfileForReason | null,
): PersonalizationBundle {
  const memory = buildMemoryPersonalization(profile);
  const dna = buildDnaPersonalization(profile);
  return {
    weightSuggestions: [...memory.suggestions, ...dna.suggestions],
    preferenceSignals: [...memory.signals, ...dna.signals],
    effectivePreferenceContext: buildPersonalizationContextV1({ surface: "explore", profile }),
  };
}

function resolveEnginePath(): RecEnginePath {
  if (isRecEngineR12Enabled()) return "engine_r1_2";
  if (isRecEngineR11Enabled()) return "engine_r1_1";
  return "engine";
}

/**
 * Explore 排序入口：呼叫端應使用此函式，勿在 UI 重寫排序。
 */
export function sortExplorePlacesViaRecEngine<T extends SortablePlace>(
  places: T[],
  origin: { lat: number; lng: number },
  profile?: UserProfileForReason | null,
  weather?: WeatherSummary | null,
  categoryId?: string,
  sortContext?: ExplorePlacesSortContext,
): T[] {
  const started = nowMs();
  const args: ExploreSortArgs<T> = {
    places,
    origin,
    profile,
    weather,
    categoryId,
    sortContext,
  };

  if (!isRecEngineEnabled()) {
    const result = sortExplorePlaces(
      places,
      origin,
      profile,
      weather,
      categoryId,
      sortContext,
    );
    recordRecEngineMetric({
      surface: "explore",
      path: "legacy",
      candidateCount: places.length,
      resultCount: result.length,
      excludedCount: 0,
      latencyMs: nowMs() - started,
    });
    return result;
  }

  const useProfileScore = isRecEngineR11Enabled() || isRecEngineR12Enabled();
  const usePersonalization = isRecEngineR12Enabled();
  const path = resolveEnginePath();

  const personalization = usePersonalization
    ? buildPersonalizationBundle(profile)
    : null;

  const ctx: RecommendationContext = {
    surface: "explore",
    location: { lat: origin.lat, lng: origin.lng },
    weather: weather ?? undefined,
    categoryHint: categoryId,
    surfaceOptions: {
      profile,
      sortContext,
    },
    personalization,
  };

  const results = runRecommendationPipeline({
    ctx,
    inputs: places.map(asNormalizeInput),
    source: "explore",
    scoreFn: useProfileScore
      ? (candidates, scoreCtx) =>
          scoreCandidatesWithProfile(candidates, scoreCtx, { personalization })
      : scoreViaLegacySortExplore(args),
  });

  const ordered = results.map((r) => r.candidate.raw as T);

  recordRecEngineMetric({
    surface: "explore",
    path,
    candidateCount: places.length,
    resultCount: ordered.length,
    excludedCount: Math.max(0, places.length - ordered.length),
    latencyMs: nowMs() - started,
  });

  return ordered;
}
