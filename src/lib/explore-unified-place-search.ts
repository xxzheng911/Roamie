import { distanceMeters } from "@/lib/map-explore";
import {
  detectExploreSearchMode,
  logExploreSearchModeDetected,
  type ExploreSearchMode,
} from "@/lib/explore-search-mode";
import type { PlaceResult } from "@/lib/place-result";
import type { Locale } from "@/lib/i18n/types";
import {
  unifiedResolveTripStop,
  unifiedSearchTripStops,
} from "@/lib/trip-stop-search-unified";
import type { ResolvedTripStop, TripStopSuggestion } from "@/lib/trip-stop-search.functions";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";

const LANDMARK_TYPES = new Set([
  "tourist_attraction",
  "landmark",
  "natural_feature",
  "point_of_interest",
  "park",
  "museum",
  "place_of_worship",
  "historical_landmark",
]);

type TripSearchFn = Parameters<typeof unifiedSearchTripStops>[0];
type TripResolveFn = Parameters<typeof unifiedResolveTripStop>[0];

function tripPlaceToPlaceResult(place: TripPlaceInput): PlaceResult | null {
  if (place.lat == null || place.lng == null) return null;
  return {
    id: place.googlePlaceId ?? place.name,
    name: place.name,
    address: place.address ?? null,
    lat: place.lat,
    lng: place.lng,
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? null,
    photoName: place.photoName ?? null,
    primaryType: place.types?.[0] ?? place.placeType ?? null,
    types: place.types ?? null,
    businessStatus: place.businessStatus ?? null,
    openStatus: "unknown",
    openStatusLabel: place.openStatusLabel ?? "",
    todayHoursLabel: place.todayHoursLabel ?? "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function scorePlaceForRanking(
  place: PlaceResult,
  queryNorm: string,
  mode: ExploreSearchMode,
  userLocation: { lat: number; lng: number },
): number {
  const name = (place.name ?? "").trim().toLowerCase();
  const types = new Set(
    [place.primaryType, ...(place.types ?? [])].filter(Boolean).map((t) => t!.toLowerCase()),
  );

  let score = 0;

  if (name === queryNorm) score += 200;
  else if (name.includes(queryNorm) || queryNorm.includes(name)) score += 120;

  if (mode === "global_place") {
    for (const t of types) {
      if (LANDMARK_TYPES.has(t)) score += 60;
    }
    if ((place.userRatingCount ?? 0) >= 500) score += 25;
    if (/雞蛋糕|先生|cake shop|bakery/i.test(name) && /富士|fuji/i.test(queryNorm)) {
      score -= 100;
    }
    const dist = place.lat != null && place.lng != null
      ? distanceMeters(userLocation, { lat: place.lat, lng: place.lng })
      : Number.POSITIVE_INFINITY;
    if (dist > 80_000 && /富士|fuji|tower|鐵塔|寺|城|attraction/i.test(queryNorm)) {
      score += 30;
    }
    score -= Math.min(dist / 50_000, 40);
  } else {
    const dist =
      place.lat != null && place.lng != null
        ? distanceMeters(userLocation, { lat: place.lat, lng: place.lng })
        : Number.POSITIVE_INFINITY;
    score -= dist / 800;
    if ((place.rating ?? 0) >= 4) score += 8;
  }

  return score;
}

export function rankExploreSearchPlaces(
  places: PlaceResult[],
  query: string,
  mode: ExploreSearchMode,
  userLocation: { lat: number; lng: number },
): PlaceResult[] {
  const queryNorm = normalizeQuery(query);
  const scored = places.map((place) => ({
    place,
    score: scorePlaceForRanking(place, queryNorm, mode, userLocation),
  }));
  scored.sort((a, b) => b.score - a.score);
  const ranked = scored.map((s) => s.place);

  console.info("[EXPLORE_SEARCH_RANKING]", {
    query,
    mode,
    candidates: places.slice(0, 8).map((p) => ({
      name: p.name,
      types: p.types?.slice(0, 3) ?? p.primaryType,
      score: scored.find((s) => s.place.id === p.id)?.score,
    })),
    selectedFirst: ranked[0]?.name ?? null,
  });

  return ranked;
}

export function logExploreGlobalSearchRequest(params: {
  query: string;
  locationBiasUsed: boolean;
  regionCode?: string | null;
}): void {
  console.info("[EXPLORE_GLOBAL_SEARCH_REQUEST]", params);
}

export function logExploreMapMovedToResult(params: {
  placeName: string;
  lat: number;
  lng: number;
}): void {
  console.info("[EXPLORE_MAP_MOVED_TO_RESULT]", params);
}

export async function exploreUnifiedPlaceSearch(
  searchTripStopsFn: TripSearchFn,
  resolveTripStopFn: TripResolveFn,
  params: {
    rawQuery: string;
    locale: Locale;
    userLocation: { lat: number; lng: number };
    destination?: string | null;
  },
): Promise<{
  places: PlaceResult[];
  error: string | null;
  mode: ExploreSearchMode;
  modeReason: string;
}> {
  const { mode, reason } = detectExploreSearchMode(params.rawQuery);
  logExploreSearchModeDetected({ query: params.rawQuery, mode, reason });

  const useLocationBias = mode === "nearby_category";
  logExploreGlobalSearchRequest({
    query: params.rawQuery,
    locationBiasUsed: useLocationBias,
    regionCode: useLocationBias ? "TW" : null,
  });

  const { suggestions, error } = await unifiedSearchTripStops(
    searchTripStopsFn,
    params.rawQuery,
    params.locale,
    useLocationBias
      ? { center: params.userLocation, destination: params.destination }
      : { destination: params.destination },
  );

  if (error && suggestions.length === 0) {
    return { places: [], error, mode, modeReason: reason };
  }

  const places: PlaceResult[] = [];
  const seen = new Set<string>();

  for (const s of suggestions.slice(0, 12)) {
    const { place, error: resolveError } = await unifiedResolveTripStop(
      resolveTripStopFn,
      s.placeId,
      params.locale,
      s,
    );
    if (!place) continue;
    const pr = tripPlaceToPlaceResult(place);
    if (!pr || seen.has(pr.id)) continue;
    seen.add(pr.id);
    places.push(pr);
    if (resolveError) {
      console.info("[EXPLORE_UNIFIED_SEARCH] resolve_warn", resolveError);
    }
  }

  const ranked = rankExploreSearchPlaces(places, params.rawQuery, mode, params.userLocation);
  return { places: ranked, error: ranked.length ? null : error, mode, modeReason: reason };
}
