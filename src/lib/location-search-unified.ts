import { searchTripLocations, resolveTripLocation } from "@/lib/location.functions";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import type { LocationSuggestion, TripLocation } from "@/lib/location/types";
import type { Locale } from "@/lib/i18n/types";
import {
  buildFormattedName,
  formatGeographicSuggestionLabel,
  isGeographicPlaceTypes,
  isRejectedTripLocationLabel,
} from "@/lib/location/geographic-only";
import { localeToGeocodeRegion, localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import { coerceLocale } from "@/lib/i18n/resolve-locale";
import { isGooglePlacesPermissionError } from "@/lib/places-api-errors";
import {
  resolveCuratedTripLocation,
  searchCuratedTripLocations,
} from "@/lib/trip-location-curated";
import {
  logTripPlaceGeocodingFallback,
  logTripPlaceSearchResult,
  TRIP_PLACE_USER_MESSAGE,
} from "@/lib/trip-place-search-log";

const DEFAULT_CENTER = { lat: 25.033, lng: 121.5654 };
const MIN_TRIP_LOCATION_QUERY_LEN = 2;

export const PLACE_SEARCH_FALLBACK_MESSAGE = TRIP_PLACE_USER_MESSAGE;

function normalizeTripLocationQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function tripLocationQueryVariants(query: string): string[] {
  const base = normalizeTripLocationQuery(query);
  if (!base) return [];
  const variants = [base];
  const compact = base.replace(/[·・,，/\s]+/g, "");
  if (compact && compact !== base) variants.push(compact);
  if (/^[\u4e00-\u9fff]{2,}$/.test(compact) && compact.length >= 4) {
    variants.push(`${compact.slice(0, 2)} ${compact.slice(2)}`);
  }
  return [...new Set(variants)];
}

type GeocodeComponent = { long_name?: string; short_name?: string; types?: string[] };
type GeocodeResult = {
  place_id?: string;
  formatted_address?: string;
  geometry?: { location?: { lat: number; lng: number } };
  address_components?: GeocodeComponent[];
  types?: string[];
};

function componentText(components: GeocodeComponent[] | undefined, type: string): string {
  const c = components?.find((x) => x.types?.includes(type));
  return c?.long_name?.trim() || c?.short_name?.trim() || "";
}

function resolveCity(components: GeocodeComponent[] | undefined, fallback: string): string {
  const locality = componentText(components, "locality");
  if (locality) return locality;
  const admin2 = componentText(components, "administrative_area_level_2");
  if (admin2) return admin2;
  const admin1 = componentText(components, "administrative_area_level_1");
  if (admin1 && admin1 !== fallback) return admin1;
  const sub = componentText(components, "sublocality");
  if (sub) return sub;
  return fallback;
}

function geocodeUrl(args: {
  apiKey: string;
  address?: string;
  placeId?: string;
  language?: string;
  region?: string;
}) {
  const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  if (args.address) u.searchParams.set("address", args.address);
  if (args.placeId) u.searchParams.set("place_id", args.placeId);
  if (args.language) u.searchParams.set("language", args.language);
  if (args.region) u.searchParams.set("region", args.region);
  u.searchParams.set("key", args.apiKey);
  return u.toString();
}

async function clientGeocodeSuggestions(query: string, locale: Locale, apiKey: string) {
  const normalized = normalizeTripLocationQuery(query);
  if (normalized.length < MIN_TRIP_LOCATION_QUERY_LEN) {
    return { suggestions: [] as LocationSuggestion[], error: null };
  }

  const userLocale: Locale = coerceLocale(locale);
  const language = localeToGoogleLanguageCode(userLocale);
  const region = localeToGeocodeRegion(userLocale);
  const suggestions: LocationSuggestion[] = [];
  const seen = new Set<string>();

  for (const variant of tripLocationQueryVariants(normalized)) {
    const res = await fetch(geocodeUrl({ apiKey, address: variant, language, region }));
    if (!res.ok) continue;
    const json = (await res.json()) as {
      status?: string;
      error_message?: string;
      results?: GeocodeResult[];
    };
    logTripPlaceSearchResult({
      status: json.status ?? "unknown",
      predictions: json.results?.length ?? 0,
      error: json.error_message ?? null,
      rawResponse: { status: json.status, error_message: json.error_message },
    });
    if (json.status === "REQUEST_DENIED" || isGooglePlacesPermissionError(json.error_message)) {
      return { suggestions: [], error: null };
    }
    if (json.status !== "OK" && json.status !== "ZERO_RESULTS") continue;

    for (const r of (json.results ?? []).slice(0, 8)) {
      const placeId = r.place_id;
      if (!placeId) continue;
      if (!isGeographicPlaceTypes(r.types)) continue;
      const formatted = r.formatted_address?.trim() ?? "";
      const main = formatted.split(",")[0]?.trim() || variant;
      const country = componentText(r.address_components, "country");
      const city = resolveCity(r.address_components, main);
      const label = formatGeographicSuggestionLabel(city || main, country || undefined);
      if (!label || isRejectedTripLocationLabel(label)) continue;
      if (seen.has(label)) continue;
      seen.add(label);
      suggestions.push({ placeId, label, secondary: formatted || undefined });
      if (suggestions.length >= 8) break;
    }
    if (suggestions.length > 0) break;
  }

  if (suggestions.length === 0) {
    return { suggestions: [], error: PLACE_SEARCH_FALLBACK_MESSAGE };
  }
  return { suggestions, error: null };
}

async function clientResolveTripLocation(placeId: string, locale: Locale, apiKey: string) {
  const userLocale: Locale = coerceLocale(locale);
  const language = localeToGoogleLanguageCode(userLocale);
  const region = localeToGeocodeRegion(userLocale);
  const res = await fetch(geocodeUrl({ apiKey, placeId, language, region }));
  if (!res.ok) return { location: null as TripLocation | null, error: "無法解析地點" };
  const json = (await res.json()) as {
    status?: string;
    error_message?: string;
    results?: GeocodeResult[];
  };
  if (json.status !== "OK") {
    return {
      location: null as TripLocation | null,
      error: json.error_message ?? json.status ?? "無法解析地點",
    };
  }
  const best = (json.results ?? [])[0];
  if (!best) return { location: null as TripLocation | null, error: "無法解析地點" };
  if (!isGeographicPlaceTypes(best.types)) {
    return {
      location: null as TripLocation | null,
      error: "請選擇國家、城市或地區（非店家或景點）",
    };
  }
  const lat = best.geometry?.location?.lat;
  const lng = best.geometry?.location?.lng;
  if (lat == null || lng == null)
    return { location: null as TripLocation | null, error: "無法解析地點座標" };
  const formatted = best.formatted_address?.trim() ?? "";
  const main = formatted.split(",")[0]?.trim() || "";
  const country = componentText(best.address_components, "country") || main;
  const city = resolveCity(best.address_components, main || country);
  const regionText =
    componentText(best.address_components, "administrative_area_level_1") ||
    componentText(best.address_components, "administrative_area_level_2") ||
    undefined;
  const formattedName = buildFormattedName(country, city || country, city || country);
  if (!formattedName || isRejectedTripLocationLabel(formattedName)) {
    return {
      location: null as TripLocation | null,
      error: "請輸入國家、城市或地區（非店家或景點）",
    };
  }
  return {
    location: {
      placeId,
      country: country || city,
      city: city || country,
      region: regionText,
      lat,
      lng,
      formattedName,
      displayLabel: formattedName,
      address: formatted || undefined,
      timezone: undefined,
      utcOffsetMinutes: null,
    },
    error: null,
  };
}

/** TestFlight bundled 模式：server fn 失敗時改走瀏覽器 Geocoding API（可查國家/城市） */
export async function unifiedSearchTripLocations(
  searchFn: (args: { data: { query: string; locale?: Locale } }) => Promise<{
    suggestions: LocationSuggestion[];
    error: string | null;
  }>,
  query: string,
  locale: Locale,
): Promise<{ suggestions: LocationSuggestion[]; error: string | null }> {
  const normalized = normalizeTripLocationQuery(query);
  if (normalized.length < MIN_TRIP_LOCATION_QUERY_LEN) {
    return { suggestions: [], error: null };
  }

  let permissionDenied = false;

  try {
    const result = await searchFn({ data: { query: normalized, locale } });
    logTripPlaceSearchResult({
      status: result.error ? "server_error" : "ok",
      predictions: result.suggestions.length,
      error: result.error,
    });
    if (result.suggestions.length > 0) {
      logTripPlaceSearchResult({
        status: "ok",
        predictions: result.suggestions.length,
        endpoint: "placesAutocomplete",
      });
      return { suggestions: result.suggestions, error: null };
    }
    if (result.error) console.warn("[Location] server autocomplete", result.error);
    if (isGooglePlacesPermissionError(result.error)) {
      permissionDenied = true;
    }
  } catch (e) {
    console.warn("[Location] server autocomplete failed", e);
  }

  const curated = searchCuratedTripLocations(normalized);
  if (curated.length > 0) {
    return { suggestions: curated, error: null };
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

  console.info("[TRIP_PLACE_SEARCH] endpoint=", "geocoding");
  const client = await clientGeocodeSuggestions(normalized, locale, key);
  if (client.suggestions.length > 0) {
    logTripPlaceGeocodingFallback(true);
    return { suggestions: client.suggestions, error: null };
  }
  return {
    suggestions: [],
    error: client.error ?? PLACE_SEARCH_FALLBACK_MESSAGE,
  };
}

export async function unifiedResolveTripLocation(
  resolveFn: (args: { data: { placeId: string } }) => Promise<{
    location: TripLocation | null;
    error: string | null;
  }>,
  placeId: string,
  locale: Locale,
  fallback?: { name: string; address?: string; lat?: number | null; lng?: number | null },
): Promise<{ location: TripLocation | null; error: string | null }> {
  const curated = resolveCuratedTripLocation(placeId);
  if (curated) {
    return { location: curated, error: null };
  }

  try {
    const result = await resolveFn({ data: { placeId } });
    if (result.location) return result;
  } catch (e) {
    console.warn("[Location] server resolve failed", e);
  }

  const key = getGoogleMapsBrowserKey();
  if (key) {
    const resolved = await clientResolveTripLocation(placeId, locale, key);
    if (resolved.location) return { location: resolved.location, error: null };
  }

  if (key && fallback?.name) {
    const geo = await clientGeocodeSuggestions(fallback.name, locale, key);
    const hit = geo.suggestions[0];
    if (hit) {
      const resolved = await clientResolveTripLocation(hit.placeId, locale, key);
      if (resolved.location) {
        logTripPlaceGeocodingFallback(true);
        return resolved;
      }
    }
    const addr = [fallback.name, fallback.address].filter(Boolean).join(" ");
    const geoUrl = geocodeUrl({ apiKey: key, address: addr, language: localeToGoogleLanguageCode(locale) });
    try {
      const res = await fetch(geoUrl);
      const json = (await res.json()) as { status?: string; results?: GeocodeResult[] };
      if (json.status === "OK" && json.results?.[0]) {
        const loc = legacyGeocodeToTripLocationFromResult(json.results[0], hit?.placeId ?? placeId);
        if (loc) {
          logTripPlaceGeocodingFallback(true);
          return { location: loc, error: null };
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (fallback?.name && fallback.lat != null && fallback.lng != null) {
    return {
      location: {
        placeId,
        country: fallback.name,
        city: fallback.name,
        lat: fallback.lat,
        lng: fallback.lng,
        formattedName: fallback.name,
        displayLabel: fallback.name,
        address: fallback.address,
      },
      error: null,
    };
  }

  return { location: null, error: TRIP_PLACE_USER_MESSAGE };
}

function legacyGeocodeToTripLocationFromResult(
  result: GeocodeResult,
  placeId: string,
): TripLocation | null {
  const lat = result.geometry?.location?.lat;
  const lng = result.geometry?.location?.lng;
  if (lat == null || lng == null) return null;
  const formatted = result.formatted_address?.trim() ?? "";
  const main = formatted.split(",")[0]?.trim() || "";
  const country = componentText(result.address_components, "country");
  const city = resolveCity(result.address_components, main || country);
  const formattedName = buildFormattedName(country, city, city || main);
  return {
    placeId: result.place_id ?? placeId,
    country: country || city,
    city: city || country,
    lat,
    lng,
    formattedName,
    displayLabel: formattedName,
    address: formatted || undefined,
  };
}
