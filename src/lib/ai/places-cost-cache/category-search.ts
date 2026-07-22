/**
 * Capped category search — at most one Places Search per seed category.
 */
import type { PlaceResult } from "@/lib/place-result";
import type { CandidatePoolSearchFn } from "@/lib/ai/candidate-pool/types";
import { dedupeCandidatePlaces } from "@/lib/ai/ai-multi-day-planner";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { CANDIDATE_POOL_SEED_CATEGORIES } from "@/lib/ai/places-cost-cache/constants";
import { shouldBlockNewPlacesCalls } from "@/lib/ai/places-cost-cache/rate-protection";
import {
  notePlacesQueryCooldown,
  placesQueryCooldownKey,
  shouldSkipPlacesForQueryCooldown,
} from "@/lib/ai/places-cost-cache/query-cooldown";
import { logPlacesSearchSkipped } from "@/lib/ai/places-cost-cache/log";

export async function runCappedCategorySearch(params: {
  destination: string;
  lat: number;
  lng: number;
  search: CandidatePoolSearchFn;
  seedPlaces?: PlaceResult[];
  sessionId?: string | null;
  perCategoryKeep?: number;
}): Promise<{ places: PlaceResult[]; searchRequestCount: number }> {
  let collected = dedupeCandidatePlaces(params.seedPlaces ?? []);
  let searchRequestCount = 0;
  const keep = params.perCategoryKeep ?? 12;
  const destination = params.destination.trim();

  for (const cat of CANDIDATE_POOL_SEED_CATEGORIES) {
    if (
      shouldBlockNewPlacesCalls({
        destination,
        query: cat.id,
      })
    ) {
      break;
    }

    const query = `${destination} ${cat.querySuffix}`;
    if (
      shouldSkipPlacesForQueryCooldown({
        sessionId: params.sessionId,
        destination,
        query,
        category: cat.id,
      })
    ) {
      continue;
    }

    searchRequestCount += 1;
    const batch = await params.search({
      attempt: {
        query,
        mode: "text",
        includedTypes: [...cat.includedTypes],
      },
      kind: cat.kind,
      lat: params.lat,
      lng: params.lng,
      phase: `cost_cache.seed.${cat.id}`,
    });

    notePlacesQueryCooldown(
      placesQueryCooldownKey({
        sessionId: params.sessionId,
        destination,
        query,
        category: cat.id,
      }),
      batch,
    );

    const kept = batch.slice(0, keep);
    collected = dedupeCandidatePlaces([...collected, ...kept]);

    logAiPipeline(
      "[CANDIDATE_POOL_SEARCH_KIND]",
      `phase=cost_cache_seed`,
      `kind=${cat.kind}`,
      `category=${cat.id}`,
      `queries=1`,
      `kept=${kept.length}`,
      `collected=${collected.length}`,
    );
  }

  if (searchRequestCount === 0 && collected.length === 0) {
    logPlacesSearchSkipped({
      reason: "capped_search_empty",
      destination,
    });
  }

  return { places: collected, searchRequestCount };
}
