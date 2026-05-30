import type { SearchPlacesFn } from "@/lib/explore-category-search";
import type { PlaceResult } from "@/lib/place-result";
import { filterVerifiedPlaceResults } from "@/lib/place-verification";
import {
  dedupePlaceResults,
  type DedupeResultMeta,
} from "@/lib/recommendation-dedupe";
import {
  type MoodPipelineMeta,
  type MoodRecommendationIntent,
  type RankedMoodPlace,
  moodIntentToNearbyTypes,
  rankAndValidatePlacesForMood,
  resolveMoodRecommendationIntent,
  resolveMoodSearchQueries,
} from "@/lib/recommendation/mood-place-pipeline";
import type { WeatherSummary } from "@/lib/weather-types";
import { withSearchTimeout } from "@/lib/search-timeout";

export type MoodPlacesSearchResult = {
  places: PlaceResult[];
  ranked: RankedMoodPlace[];
  queriesTried: string[];
  fallbackReason: string | null;
  dedupeMeta: DedupeResultMeta;
  intent: MoodRecommendationIntent;
  pipelineMeta: MoodPipelineMeta | null;
};

const MOOD_SEARCH_OPTS = {
  availabilityContext: "lenient" as const,
};

async function runMoodSearchQuery(
  searchFn: SearchPlacesFn,
  data: Parameters<SearchPlacesFn>[0]["data"],
  timeoutMs: number,
): Promise<{ places: PlaceResult[]; error: string | null }> {
  return withSearchTimeout(searchFn({ data: { ...data, ...MOOD_SEARCH_OPTS } }), timeoutMs);
}

function mergeAndValidateMoodPlaces(
  merged: PlaceResult[],
  intent: MoodRecommendationIntent,
  maxCount: number,
  minCount: number,
): { places: PlaceResult[]; ranked: RankedMoodPlace[]; pipelineMeta: MoodPipelineMeta | null } {
  const { places: deduped } = dedupePlaceResults(merged, { maxCount: maxCount + 6 });
  return rankAndValidatePlacesForMood(deduped, intent, {
    maxCount,
    minCount,
  });
}

/** 依心情 intent → Google Places 搜尋 → 驗證排序 */
export async function searchPlacesWithMoodFallback(
  searchFn: SearchPlacesFn,
  opts: {
    mood: string;
    lat: number;
    lng: number;
    minCount?: number;
    maxCount?: number;
    timeoutMs?: number;
    userText?: string;
    weather?: WeatherSummary | null;
  },
): Promise<MoodPlacesSearchResult> {
  const minCount = opts.minCount ?? 3;
  const maxCount = opts.maxCount ?? 4;
  const timeoutMs = opts.timeoutMs ?? 18_000;
  const intent = resolveMoodRecommendationIntent(opts.mood, {
    userText: opts.userText,
    weather: opts.weather,
  });
  const queries = intent.searchQueries;
  const queriesTried: string[] = [];
  const merged: PlaceResult[] = [];
  let lastError: string | null = null;

  for (const query of queries) {
    if (merged.length >= maxCount + 4) break;
    queriesTried.push(query);
    try {
      const result = await runMoodSearchQuery(
        searchFn,
        { query, lat: opts.lat, lng: opts.lng, mode: "text" },
        timeoutMs,
      );
      if (result.error) lastError = result.error;
      const verified = filterVerifiedPlaceResults(result.places ?? []);
      merged.push(...verified);
      const { places: deduped } = dedupePlaceResults(merged, { maxCount: maxCount + 6 });
      merged.length = 0;
      merged.push(...deduped);

      const { places: validated } = mergeAndValidateMoodPlaces(
        deduped,
        intent,
        maxCount + 2,
        minCount,
      );
      if (validated.length >= minCount) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.warn("[MOOD_PLACES_SEARCH] query failed", query, lastError);
    }
  }

  let { places, ranked, meta: pipelineMeta } = mergeAndValidateMoodPlaces(
    merged,
    intent,
    maxCount,
    minCount,
  );

  if (places.length < minCount) {
    const nearbyTypes = moodIntentToNearbyTypes(intent);
    const nearbyLabel = `nearby:${nearbyTypes.join(",")}`;
    if (!queriesTried.includes(nearbyLabel)) {
      queriesTried.push(nearbyLabel);
      try {
        const nearbyResult = await runMoodSearchQuery(
          searchFn,
          {
            lat: opts.lat,
            lng: opts.lng,
            mode: "nearby",
            includedTypes: nearbyTypes,
            query: "",
          },
          timeoutMs,
        );
        if (nearbyResult.error) lastError = nearbyResult.error;
        const verified = filterVerifiedPlaceResults(nearbyResult.places ?? []);
        if (verified.length > 0) {
          merged.push(...verified);
          const { places: deduped, meta: dedupeMeta } = dedupePlaceResults(merged, {
            maxCount: maxCount + 4,
          });
          const validated = mergeAndValidateMoodPlaces(deduped, intent, maxCount, minCount);
          places = validated.places;
          ranked = validated.ranked;
          pipelineMeta = validated.pipelineMeta;
          console.info("[MOOD_PLACES_SEARCH] nearby_fallback", {
            types: nearbyTypes,
            count: places.length,
            dedupe: dedupeMeta,
          });
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.warn("[MOOD_PLACES_SEARCH] nearby fallback failed", lastError);
      }
    }
  }

  const { meta: dedupeMeta } = dedupePlaceResults(
    ranked.map((r) => r.place),
    { maxCount: maxCount + 4 },
  );

  const fallbackReason =
    places.length < minCount
      ? lastError ??
        (queriesTried.some((q) => q.startsWith("nearby:"))
          ? "nearby_fallback_still_empty"
          : queriesTried.length > 1
            ? "widened_mood_queries"
            : "mood_query_empty")
      : queriesTried.some((q) => q.startsWith("nearby:"))
        ? "nearby_type_fallback"
        : queriesTried.length > 1
          ? "widened_mood_queries"
          : pipelineMeta && pipelineMeta.validation_rejected > 0
            ? "mood_validation_filtered"
            : null;

  console.info("[MOOD_PLACES_SEARCH]", {
    mood: intent.mood,
    detectedIntent: intent.detectedIntent,
    tags: intent.selectedTags,
    queriesTried,
    count: places.length,
    dedupe: dedupeMeta,
    pipeline: pipelineMeta,
    fallbackReason,
  });

  return {
    places,
    ranked,
    queriesTried,
    fallbackReason,
    dedupeMeta,
    intent,
    pipelineMeta,
  };
}

export {
  resolveMoodRecommendationIntent,
  resolveMoodSearchQueries,
  peekLastMoodPipelineMeta,
} from "@/lib/recommendation/mood-place-pipeline";

/** @deprecated use resolveMoodSearchQueries */
export function resolveMoodQueries(mood: string): string[] {
  return resolveMoodSearchQueries(mood);
}
