import type { Locale } from "@/lib/i18n/types";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";
import { createRequestCache } from "@/services/requestCache";
import { unifiedResolveTripStop, unifiedSearchTripStops } from "@/lib/trip-stop-search-unified";
import { resolveTripStop, searchTripStops, type TripStopSuggestion } from "@/lib/trip-stop-search.functions";
import { TRIP_PLACE_USER_MESSAGE } from "@/lib/trip-place-search-log";

export type PlaceLite = {
  placeId: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  placeType?: string;
  photoName?: string | null;
  rating?: number | null;
};

type SearchPlacesFn = typeof searchTripStops;
type ResolvePlaceFn = typeof resolveTripStop;

function normalizeGooglePlaceId(raw: string): string {
  return raw.replace(/^places\//, "").trim();
}

const autocompleteCache = createRequestCache({
  prefix: "places-autocomplete",
  ttlMs: 5 * 60 * 1000,
});

const placeDetailsCache = createRequestCache({
  prefix: "places-details",
  ttlMs: 24 * 60 * 60 * 1000,
  persist: true,
});

function searchKey(query: string, locale: Locale, center?: { lat: number; lng: number }): string {
  const q = query.trim().toLowerCase();
  const c = center ? `${center.lat.toFixed(3)},${center.lng.toFixed(3)}` : "none";
  return `${locale}:${q}:${c}`;
}

export function normalizePlace(
  place: TripPlaceInput | PlaceLite,
  routePlaceId?: string,
): PlaceLite {
  const placeId =
    normalizeGooglePlaceId(place.googlePlaceId ?? place.placeId ?? routePlaceId ?? "") ||
    (routePlaceId?.trim() ? routePlaceId.trim() : "");
  const name = (place.placeName ?? place.name ?? "").trim() || "地點";
  const address = (place.address ?? "").trim();
  return {
    placeId,
    name,
    address: address || name,
    lat: place.lat ?? null,
    lng: place.lng ?? null,
    placeType: place.placeType,
    photoName: place.photoName ?? null,
    rating: place.rating ?? null,
  };
}

export async function searchPlaces(
  query: string,
  options?: {
    locale?: Locale;
    center?: { lat: number; lng: number };
    sessionToken?: string;
    searchFn?: SearchPlacesFn;
  },
): Promise<{ suggestions: TripStopSuggestion[]; error: string | null }> {
  const locale = options?.locale ?? "zh-TW";
  const key = searchKey(query, locale, options?.center);
  const searchFn = options?.searchFn ?? searchTripStops;

  const result = await autocompleteCache.getOrFetch(key, () =>
    unifiedSearchTripStops(searchFn, query, locale, options?.center, options?.sessionToken),
  );

  console.info("[TRIP_PLACE_SEARCH] endpoint=", "placesAutocomplete");
  console.info("[TRIP_PLACE_SEARCH] query=", query.trim());
  console.info("[TRIP_PLACE_SEARCH] predictions=", result.suggestions.length);
  if (result.error) console.info("[TRIP_PLACE_SEARCH] error=", result.error);
  return result;
}

export async function getPlaceDetails(
  placeId: string,
  options?: {
    locale?: Locale;
    resolveFn?: ResolvePlaceFn;
    fallback?: TripStopSuggestion;
  },
): Promise<{ place: PlaceLite | null; error: string | null }> {
  const locale = options?.locale ?? "zh-TW";
  const normalizedPlaceId = normalizeGooglePlaceId(placeId);
  const key = `${locale}:${normalizedPlaceId}`;
  const resolveFn = options?.resolveFn ?? resolveTripStop;

  console.info("[PLACES_DETAILS] start placeId=", normalizedPlaceId);
  const cached = placeDetailsCache.getCached<{ place: PlaceLite | null; error: string | null }>(key);
  if (cached?.place && Number.isFinite(cached.place.lat ?? NaN)) {
    console.info("[PLACES_DETAILS] status=", "cache-hit");
    return cached;
  }

  try {
    const resolved = await unifiedResolveTripStop(
      resolveFn,
      normalizedPlaceId,
      locale,
      options?.fallback,
    );
    const normalized = resolved.place
      ? normalizePlace(resolved.place, normalizedPlaceId)
      : null;
    if (
      !normalized ||
      !normalized.name ||
      !Number.isFinite(normalized.lat ?? NaN) ||
      !Number.isFinite(normalized.lng ?? NaN)
    ) {
      const errorMsg = resolved.error ?? "missing_coordinates";
      console.error("[PLACES_DETAILS] error=", errorMsg);
      return { place: null, error: TRIP_PLACE_USER_MESSAGE };
    }
    console.info("[PLACES_DETAILS] status=", "ok");
    console.info("[PLACES_DETAILS] latLng=", `${normalized.lat},${normalized.lng}`);
    console.info("[PLACES_DETAILS] normalized place=", JSON.stringify(normalized));
    placeDetailsCache.setCached(key, { place: normalized, error: null });
    return { place: normalized, error: null };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[PLACES_DETAILS] error=", msg);
    return { place: null, error: msg };
  }
}
