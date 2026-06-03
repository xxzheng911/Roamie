import {
  logExploreSearchRequest,
  logExploreSearchResponse,
} from "@/lib/explore-places-search-diagnostics";
import type { PlaceResult } from "@/lib/place-result";
import type { ResolvedTripStop, TripStopSuggestion } from "@/lib/trip-stop-search.functions";
import type { Locale } from "@/lib/i18n/types";

type SearchTripStopsFn = (args: {
  data: { query: string; locale?: Locale; lat?: number; lng?: number };
}) => Promise<{ suggestions: TripStopSuggestion[]; error: string | null }>;

type ResolveTripStopFn = (args: {
  data: { placeId: string; locale?: Locale };
}) => Promise<{ stop: ResolvedTripStop | null; error: string | null }>;

function resolvedToPlaceResult(stop: ResolvedTripStop): PlaceResult | null {
  if (stop.lat == null || stop.lng == null) return null;
  return {
    id: stop.placeId,
    name: stop.name,
    address: stop.address || null,
    lat: stop.lat,
    lng: stop.lng,
    rating: stop.rating,
    userRatingCount: stop.userRatingCount ?? null,
    photoName: stop.photoName,
    primaryType: stop.types?.[0] ?? null,
    types: stop.types ?? null,
    businessStatus: stop.businessStatus ?? null,
    openStatus: "unknown",
    openStatusLabel: stop.openStatusLabel ?? "",
    todayHoursLabel: stop.todayHoursLabel ?? "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

/**
 * 實機 bundled /api/places-search 回 0 時，改走行程搜尋同款 Autocomplete + Details（serverFn）。
 */
export async function exploreMapSearchViaTripStops(
  searchTripStopsFn: SearchTripStopsFn,
  resolveTripStopFn: ResolveTripStopFn,
  params: {
    rawQuery: string;
    finalQuery: string;
    lat: number;
    lng: number;
    locale: Locale;
  },
): Promise<{ places: PlaceResult[]; error: string | null }> {
  logExploreSearchRequest({
    rawQuery: params.rawQuery,
    finalQuery: params.finalQuery,
    lat: params.lat,
    lng: params.lng,
    radius: 50_000,
    endpoint: "serverFn:searchTripStops",
    transport: "trip_stops_fallback",
    mode: "text",
    exploreMapTextSearch: true,
    locationBias: true,
  });

  const { suggestions, error } = await searchTripStopsFn({
    data: {
      query: params.finalQuery,
      locale: params.locale,
      lat: params.lat,
      lng: params.lng,
    },
  });

  if (error && suggestions.length === 0) {
    logExploreSearchResponse({
      status: "trip_autocomplete_error",
      resultCount: 0,
      firstPlaceName: null,
      error,
      transport: "trip_stops_fallback",
    });
    return { places: [], error };
  }

  if (suggestions.length === 0) {
    logExploreSearchResponse({
      status: "trip_autocomplete_empty",
      resultCount: 0,
      firstPlaceName: null,
      transport: "trip_stops_fallback",
    });
    return { places: [], error: null };
  }

  const places: PlaceResult[] = [];
  for (const s of suggestions.slice(0, 10)) {
    const { stop, error: resolveError } = await resolveTripStopFn({
      data: { placeId: s.placeId, locale: params.locale },
    });
    if (resolveError && !stop) continue;
    if (!stop) continue;
    const place = resolvedToPlaceResult(stop);
    if (place) places.push(place);
  }

  logExploreSearchResponse({
    status: places.length > 0 ? "ok" : "trip_details_empty",
    resultCount: places.length,
    firstPlaceName: places[0]?.name ?? null,
    transport: "trip_stops_fallback",
  });

  return { places, error: null };
}
