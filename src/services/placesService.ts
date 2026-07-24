import type { Locale } from "@/lib/i18n/types";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";
import { resolveCanonicalPlaceIdentity } from "@/lib/place-canonical-identity";
import { logPlacesCacheHit } from "@/lib/places-api-guard";
import {
  buildUnifiedPlaceDetailsCacheKey,
  readUnifiedPlaceDetailsCache,
} from "@/lib/unified-place-cache";
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

export type PlacesServiceInputSource = "trip_place_input" | "place_lite";

export type NormalizedPlacesServiceInput = {
  canonicalPlaceId: string | null;
  googlePlaceId: string | null;
  placeName: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  address: string | null;
  source: PlacesServiceInputSource | null;
};

export type PlacesServiceErrorCode = "missing_place_id";

export type PlaceDetailsResult = {
  place: PlaceLite | null;
  error: string | null;
  /** Additive diagnostic; existing consumers may continue reading place/error only. */
  errorCode?: PlacesServiceErrorCode;
};

type SearchPlacesFn = typeof searchTripStops;
type ResolvePlaceFn = typeof resolveTripStop;

function normalizeGooglePlaceId(raw: string): string {
  return raw.replace(/^places\//, "").trim();
}

export function isTripPlaceInput(
  place: TripPlaceInput | PlaceLite,
): place is TripPlaceInput {
  return (
    "placeName" in place &&
    "title" in place &&
    typeof place.name === "string" &&
    typeof place.placeName === "string" &&
    typeof place.title === "string" &&
    typeof place.address === "string"
  );
}

export function isPlaceLite(place: TripPlaceInput | PlaceLite): place is PlaceLite {
  return (
    "placeId" in place &&
    !("placeName" in place) &&
    typeof place.placeId === "string" &&
    typeof place.name === "string" &&
    typeof place.address === "string"
  );
}

function coordinatesOf(
  lat: number | null,
  lng: number | null,
): NormalizedPlacesServiceInput["coordinates"] {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { latitude: lat, longitude: lng };
}

export function normalizePlacesServiceInput(
  place: TripPlaceInput | PlaceLite,
): NormalizedPlacesServiceInput {
  if (isTripPlaceInput(place)) {
    const identity = resolveCanonicalPlaceIdentity({
      googlePlaceId: place.googlePlaceId,
      name: place.name,
      placeName: place.placeName,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      type: place.placeType,
    });
    return {
      canonicalPlaceId: identity.canonicalPlaceId,
      googlePlaceId: identity.googlePlaceId,
      placeName: place.placeName.trim() || place.name.trim() || null,
      coordinates: coordinatesOf(place.lat, place.lng),
      address: place.address.trim() || null,
      source: "trip_place_input",
    };
  }

  if (isPlaceLite(place)) {
    const identity = resolveCanonicalPlaceIdentity({
      placeId: place.placeId,
      name: place.name,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      type: place.placeType,
    });
    return {
      canonicalPlaceId: identity.canonicalPlaceId,
      googlePlaceId: identity.googlePlaceId,
      placeName: place.name.trim() || null,
      coordinates: coordinatesOf(place.lat, place.lng),
      address: place.address.trim() || null,
      source: "place_lite",
    };
  }

  return {
    canonicalPlaceId: null,
    googlePlaceId: null,
    placeName: null,
    coordinates: null,
    address: null,
    source: null,
  };
}

const autocompleteCache = createRequestCache({
  prefix: "places-autocomplete",
  ttlMs: 5 * 60 * 1000,
});

function searchKey(query: string, locale: Locale, center?: { lat: number; lng: number }): string {
  const q = query.trim().toLowerCase();
  const c = center ? `${center.lat.toFixed(3)},${center.lng.toFixed(3)}` : "none";
  return `${locale}:${q}:${c}`;
}

export function normalizePlace(place: TripPlaceInput | PlaceLite): PlaceLite {
  const input = normalizePlacesServiceInput(place);
  const placeId = input.googlePlaceId ?? "";
  const name = input.placeName ?? "地點";
  const address = input.address ?? "";
  return {
    placeId,
    name,
    address: address || name,
    lat: input.coordinates?.latitude ?? null,
    lng: input.coordinates?.longitude ?? null,
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

  return autocompleteCache.getOrFetch(key, () =>
    unifiedSearchTripStops(searchFn, query, locale, options?.center, options?.sessionToken),
  );
}

export async function getPlaceDetails(
  placeId: string,
  options?: {
    locale?: Locale;
    resolveFn?: ResolvePlaceFn;
    fallback?: TripStopSuggestion;
    cacheCity?: string;
    cacheCountry?: string;
  },
): Promise<PlaceDetailsResult> {
  const locale = options?.locale ?? "zh-TW";
  const normalizedPlaceId = resolveCanonicalPlaceIdentity({ placeId }).googlePlaceId;
  if (!normalizedPlaceId) {
    console.warn(
      "[PLACES_DETAILS]",
      "error=missing_place_id",
      `input=${placeId.trim() || "empty"}`,
    );
    return {
      place: null,
      error: "missing_place_id",
      errorCode: "missing_place_id",
    };
  }
  const cacheKey = buildUnifiedPlaceDetailsCacheKey(normalizedPlaceId, locale, {
    cityLabel: options?.cacheCity,
    country: options?.cacheCountry,
  });
  const resolveFn = options?.resolveFn ?? resolveTripStop;

  const cachedDetails = readUnifiedPlaceDetailsCache(cacheKey);
  if (cachedDetails?.place) {
    logPlacesCacheHit(cacheKey);
    return {
      place: normalizePlace({
        placeId: cachedDetails.place.id,
        name: cachedDetails.place.name,
        address: cachedDetails.place.address ?? "",
        lat: cachedDetails.place.lat,
        lng: cachedDetails.place.lng,
        photoName: cachedDetails.place.photoName,
        rating: cachedDetails.place.rating,
        placeType: cachedDetails.place.primaryType ?? undefined,
      }),
      error: null,
    };
  }

  try {
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
      return { place: fallbackPlace, error: resolved.error };
    }
    // Preserve the legacy PlaceLite contract: this client resolver reads shared
    // details cache entries but does not populate the screen-details cache.
    return { place: normalized, error: resolved.error };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[PLACES_DETAILS] error=", msg);
    return { place: null, error: msg };
  }
}
