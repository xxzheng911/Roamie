import { exploreUnifiedPlaceSearch } from "@/lib/explore-unified-place-search";
import type { ExploreSearchMode } from "@/lib/explore-search-mode";
import { logExploreSearchResponse } from "@/lib/explore-places-search-diagnostics";
import type { PlaceResult } from "@/lib/place-result";
import type { Locale } from "@/lib/i18n/types";
import type { ResolvedTripStop, TripStopSuggestion } from "@/lib/trip-stop-search.functions";

type TripSearchFn = (args: {
  data: { query: string; locale?: Locale; lat?: number; lng?: number };
}) => Promise<{ suggestions: TripStopSuggestion[]; error: string | null }>;

type TripResolveFn = (args: {
  data: { placeId: string; locale?: Locale };
}) => Promise<{ stop: ResolvedTripStop | null; error: string | null }>;

export type ExploreTextSearchRunResult = {
  apiPlaces: PlaceResult[];
  filtered: PlaceResult[];
  apiError: string | null;
  mode: ExploreSearchMode;
  modeReason: string;
};

/**
 * 探索地圖手動搜尋：與行程「自行輸入地點」相同 pipeline（Autocomplete + Details）。
 * 明確地點 = 全球（無 location bias）；泛用類別 = 附近。
 */
export async function runExploreMapTextSearchPipeline(
  _searchPlacesFn: unknown,
  searchTripStopsFn: TripSearchFn,
  resolveTripStopFn: TripResolveFn,
  params: {
    rawQuery: string;
    finalQuery: string;
    lat: number;
    lng: number;
    radius: number;
    locale: Locale;
    destination?: string | null;
  },
): Promise<ExploreTextSearchRunResult> {
  void params.finalQuery;
  void params.radius;

  const result = await exploreUnifiedPlaceSearch(searchTripStopsFn, resolveTripStopFn, {
    rawQuery: params.rawQuery,
    locale: params.locale,
    userLocation: { lat: params.lat, lng: params.lng },
    destination: params.destination,
  });

  logExploreSearchResponse({
    status: result.error ? "unified_error" : "ok",
    resultCount: result.places.length,
    firstPlaceName: result.places[0]?.name ?? null,
    error: result.error,
    transport: "trip_unified",
  });

  return {
    apiPlaces: result.places,
    filtered: result.places,
    apiError: result.error,
    mode: result.mode,
    modeReason: result.modeReason,
  };
}
