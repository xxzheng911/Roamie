import {
  searchTripStops,
  resolveTripStop,
  type TripStopSuggestion,
  type ResolvedTripStop,
} from "@/lib/trip-stop-search.functions";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import {
  geocodeForwardUrl,
  placeDetailsUrl,
  PLACE_DETAILS_FIELD_MASK,
  placesAutocompleteUrl,
} from "@/lib/google-maps-api";
import type { Locale } from "@/lib/i18n/types";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";
import { resolvePlaceIdentity, identityDisplayLabel } from "@/lib/place-identity";
import { buildPlaceMapsUrl } from "@/lib/maps-navigation";
import { TRIP_PLACE_USER_MESSAGE } from "@/lib/trip-place-search-log";
import {
  curatedTripLocationToPlaceInput,
  resolveCuratedTripLocation,
  searchCuratedTripLocations,
} from "@/lib/trip-location-curated";
import { isGooglePlacesPermissionError } from "@/lib/places-api-errors";

function normalizeGooglePlaceId(raw: string): string {
  return raw.replace(/^places\//, "").trim();
}

export async function unifiedSearchTripStops(
  searchFn: (args: {
    data: { query: string; locale?: Locale; lat?: number; lng?: number; sessionToken?: string };
  }) => Promise<{ suggestions: TripStopSuggestion[]; error: string | null }>,
  query: string,
  locale: Locale,
  center?: { lat: number; lng: number },
  sessionToken?: string,
): Promise<{ suggestions: TripStopSuggestion[]; error: string | null }> {
  let permissionDenied = false;
  try {
    const result = await searchFn({
      data: {
        query,
        locale,
        ...(center ? { lat: center.lat, lng: center.lng } : {}),
        ...(sessionToken ? { sessionToken } : {}),
      },
    });
    if (result.suggestions.length > 0) return result;
    if (result.error) {
      if (isGooglePlacesPermissionError(result.error)) permissionDenied = true;
      else return { suggestions: [], error: result.error };
    }
  } catch (e) {
    console.warn("[TripStop] server search failed", e);
  }

  const curated = searchCuratedTripLocations(query.trim());
  if (curated.length > 0) {
    return {
      suggestions: curated.map((c) => ({
        placeId: c.placeId,
        label: c.label,
        secondary: c.secondary,
      })),
      error: null,
    };
  }

  if (permissionDenied) {
    return { suggestions: [], error: TRIP_PLACE_USER_MESSAGE };
  }

  const key = getGoogleMapsBrowserKey();
  if (!key) {
    return {
      suggestions: [],
      error: TRIP_PLACE_USER_MESSAGE,
    };
  }

  console.info("[TRIP_PLACE_SEARCH] endpoint=", "placesAutocomplete");

  const body: Record<string, unknown> = {
    input: query.trim(),
    languageCode: localeToGoogleLanguageCode(locale),
  };
  if (sessionToken) body.sessionToken = sessionToken;

  try {
    const res = await fetch(placesAutocompleteUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      const err = text.slice(0, 180) || "autocomplete_failed";
      console.info("[TRIP_PLACE_SEARCH] status=", res.status);
      console.info("[TRIP_PLACE_SEARCH] error=", err);
      return geocodeStopSuggestions(query, locale, key);
    }
    const json = (await res.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          place?: string;
          text?: { text?: string };
          structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
          types?: string[];
        };
      }>;
    };
    const suggestions: TripStopSuggestion[] = [];
    for (const s of json.suggestions ?? []) {
      const pred = s.placePrediction;
      const placeId = normalizeGooglePlaceId(
        pred?.placeId ?? (pred?.place ? pred.place.replace(/^places\//, "") : ""),
      );
      if (!placeId) continue;
      const label =
        pred?.structuredFormat?.mainText?.text?.trim() || pred?.text?.text?.trim() || "";
      if (!label) continue;
      suggestions.push({
        placeId,
        label,
        secondary: pred?.structuredFormat?.secondaryText?.text?.trim(),
        types: pred?.types,
      });
    }
    if (suggestions.length > 0) {
      return { suggestions, error: null };
    }
    return geocodeStopSuggestions(query, locale, key);
  } catch (e) {
    console.warn("[TripStop] browser autocomplete failed", e);
    const key = getGoogleMapsBrowserKey();
    if (key) return geocodeStopSuggestions(query, locale, key);
    return { suggestions: [], error: TRIP_PLACE_USER_MESSAGE };
  }
}

async function geocodeStopSuggestions(
  query: string,
  locale: Locale,
  apiKey: string,
): Promise<{ suggestions: TripStopSuggestion[]; error: string | null }> {
  console.info("[TRIP_PLACE_SEARCH] endpoint=", "geocoding");
  const url = geocodeForwardUrl(query, apiKey, {
    language: localeToGoogleLanguageCode(locale),
  });
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.info("[TRIP_PLACE_SEARCH] error=", `geocode_http_${res.status}`);
      return { suggestions: [], error: TRIP_PLACE_USER_MESSAGE };
    }
    const json = (await res.json()) as {
      status?: string;
      results?: Array<{
        place_id?: string;
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    if (json.status !== "OK") {
      console.info("[TRIP_PLACE_SEARCH] error=", json.status ?? "geocode_failed");
      return { suggestions: [], error: TRIP_PLACE_USER_MESSAGE };
    }
    const suggestions: TripStopSuggestion[] = [];
    for (const r of json.results ?? []) {
      const placeId = r.place_id?.trim();
      if (!placeId) continue;
      const label = r.formatted_address?.split(",")[0]?.trim() || query.trim();
      suggestions.push({
        placeId,
        label,
        secondary: r.formatted_address,
      });
      if (suggestions.length >= 8) break;
    }
    if (suggestions.length > 0) {
      console.info("[TRIP_PLACE_FALLBACK] geocodingUsed=true");
      console.info("[TRIP_PLACE_SEARCH] predictions=", suggestions.length);
    }
    return {
      suggestions,
      error: suggestions.length ? null : TRIP_PLACE_USER_MESSAGE,
    };
  } catch (e) {
    console.info("[TRIP_PLACE_SEARCH] error=", e instanceof Error ? e.message : String(e));
    return { suggestions: [], error: TRIP_PLACE_USER_MESSAGE };
  }
}

async function clientResolveTripStopDetails(
  placeId: string,
  locale: Locale,
): Promise<TripPlaceInput | null> {
  const key = getGoogleMapsBrowserKey();
  if (!key) return null;

  const normalizedPlaceId = normalizeGooglePlaceId(placeId);
  const res = await fetch(placeDetailsUrl(normalizedPlaceId), {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK,
      "Accept-Language": localeToGoogleLanguageCode(locale),
    },
  });
  if (!res.ok) {
    console.warn("[TripStop] client details failed", res.status);
    return null;
  }

  const raw = (await res.json()) as {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    primaryType?: string;
    types?: string[];
    rating?: number;
    photos?: Array<{ name?: string }>;
  };

  const lat = raw.location?.latitude ?? null;
  const lng = raw.location?.longitude ?? null;
  if (lat == null || lng == null) return null;

  const name = raw.displayName?.text?.trim() || "地點";
  const effectivePlaceId = normalizeGooglePlaceId(raw.id ?? normalizedPlaceId);
  const placeType = identityDisplayLabel(
    resolvePlaceIdentity({
      primaryType: raw.primaryType ?? null,
      types: raw.types ?? null,
    }),
  );

  return {
    name,
    placeName: name,
    title: name,
    address: raw.formattedAddress ?? name,
    lat,
    lng,
    googlePlaceId: effectivePlaceId,
    placeType,
    googleMapsUrl: buildPlaceMapsUrl(lat, lng, name),
    photoName: raw.photos?.[0]?.name ?? null,
    rating: raw.rating ?? null,
  };
}

async function geocodeByPlaceIdClient(
  placeId: string,
  apiKey: string,
): Promise<{ lat: number; lng: number; address?: string; name?: string } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?place_id=${encodeURIComponent(placeId)}&language=zh-TW&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
      address_components?: Array<{ long_name: string; types: string[] }>;
    }>;
  };
  if (json.status !== "OK") return null;
  const best = json.results?.[0];
  const lat = best?.geometry?.location?.lat;
  const lng = best?.geometry?.location?.lng;
  if (lat == null || lng == null) return null;
  const name =
    best?.address_components?.find((c) => c.types.includes("locality"))?.long_name ??
    best?.formatted_address?.split(",")[0]?.trim();
  return { lat, lng, address: best?.formatted_address, name };
}

async function geocodeAddressClient(
  query: string,
  locale: Locale,
  apiKey: string,
): Promise<{ lat: number; lng: number; address?: string; name?: string } | null> {
  const url = geocodeForwardUrl(query, apiKey, { language: localeToGoogleLanguageCode(locale) });
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };
  if (json.status !== "OK") return null;
  const best = json.results?.[0];
  const lat = best?.geometry?.location?.lat;
  const lng = best?.geometry?.location?.lng;
  if (lat == null || lng == null) return null;
  return {
    lat,
    lng,
    address: best?.formatted_address,
    name: best?.formatted_address?.split(",")[0]?.trim() || query,
  };
}

export async function unifiedResolveTripStop(
  resolveFn: (args: { data: { placeId: string; locale?: Locale } }) => Promise<{
    stop: ResolvedTripStop | null;
    error: string | null;
  }>,
  placeId: string,
  locale: Locale,
  fallback?: TripStopSuggestion,
): Promise<{ place: TripPlaceInput | null; error: string | null }> {
  const normalizedPlaceId = normalizeGooglePlaceId(placeId);
  const curatedLoc = resolveCuratedTripLocation(placeId);
  if (curatedLoc) {
    return { place: curatedTripLocationToPlaceInput(curatedLoc), error: null };
  }
  try {
    const result = await resolveFn({ data: { placeId: normalizedPlaceId, locale } });
    if (result.stop?.lat != null && result.stop?.lng != null) {
      const s = result.stop;
      return {
        place: {
          name: s.name,
          placeName: s.name,
          title: s.name,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          googlePlaceId: s.placeId,
          placeType: s.placeType,
          googleMapsUrl: s.googleMapsUrl,
          photoName: s.photoName,
          rating: s.rating,
        },
        error: null,
      };
    }
  } catch (e) {
    console.warn("[TripStop] resolve failed", e);
  }

  const clientPlace = await clientResolveTripStopDetails(normalizedPlaceId, locale);
  if (clientPlace) {
    console.info("[PLACES_DETAILS] status=", "client-ok");
    console.info(
      "[PLACES_DETAILS] latLng=",
      `${clientPlace.lat},${clientPlace.lng}`,
    );
    return { place: clientPlace, error: null };
  }

  const key = getGoogleMapsBrowserKey();
  if (key) {
    const geo =
      (await geocodeByPlaceIdClient(normalizedPlaceId, key)) ??
      (fallback
        ? await geocodeAddressClient(
            [fallback.label, fallback.secondary].filter(Boolean).join(" "),
            locale,
            key,
          )
        : null);
    if (geo) {
      console.info("[TRIP_PLACE_FALLBACK] geocodingUsed=true");
      const name = geo.name || fallback?.label || "地點";
      return {
        place: {
          name,
          placeName: name,
          title: name,
          address: geo.address || fallback?.secondary || fallback?.label || name,
          lat: geo.lat,
          lng: geo.lng,
          googlePlaceId: normalizedPlaceId,
          googleMapsUrl: buildPlaceMapsUrl(geo.lat, geo.lng, name),
        },
        error: null,
      };
    }
  }

  return { place: null, error: TRIP_PLACE_USER_MESSAGE };
}

// Re-export for tree-shaking
export { searchTripStops, resolveTripStop };
