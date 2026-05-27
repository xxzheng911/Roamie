import type { Locale } from "@/lib/i18n/types";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";
import { createRequestCache } from "@/services/requestCache";
import { unifiedResolveTripStop, unifiedSearchTripStops } from "@/lib/trip-stop-search-unified";
import { resolveTripStop, searchTripStops, type TripStopSuggestion } from "@/lib/trip-stop-search.functions";

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

export function normalizePlace(place: TripPlaceInput | PlaceLite): PlaceLite {
  const placeId = normalizeGooglePlaceId(place.googlePlaceId ?? place.placeId ?? "");
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

  console.info("[PLACES_SEARCH] query=", query.trim());
  console.info("[PLACES_SEARCH] predictions=", result.suggestions.length);
  if (result.error) console.info("[PLACES_SEARCH] error=", result.error);
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
  try {
    return await placeDetailsCache.getOrFetch(key, async () => {
      const resolved = await unifiedResolveTripStop(
        resolveFn,
        normalizedPlaceId,
        locale,
        options?.fallback,
      );
      const normalized = resolved.place ? normalizePlace(resolved.place) : null;
      if (!normalized) {
        const errorMsg = resolved.error ?? "place_not_found";
        console.error("[PLACES_DETAILS] error=", errorMsg);
        return { place: null, error: errorMsg };
      }
      // Minimal required fields for successful selection.
      if (
        !normalized.placeId ||
        !normalized.name ||
        normalized.lat == null ||
        normalized.lng == null
      ) {
        const fallback = options?.fallback;
        const fallbackPlace: PlaceLite | null = fallback
          ? {
              placeId: normalizeGooglePlaceId(fallback.placeId),
              name: fallback.label?.trim() || fallback.secondary?.trim() || "地點",
              address: fallback.secondary?.trim() || fallback.label?.trim() || "地點",
              lat: null,
              lng: null,
            }
          : null;
        console.info("[PLACES_DETAILS] normalized place=", JSON.stringify(fallbackPlace ?? normalized));
        return { place: fallbackPlace, error: resolved.error };
      }
      console.info("[PLACES_DETAILS] normalized place=", JSON.stringify(normalized));
      return { place: normalized, error: resolved.error };
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[PLACES_DETAILS] error=", msg);
    return { place: null, error: msg };
  }
}
