import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { geocodeForwardUrl, placesAutocompleteUrl, placeDetailsUrl } from "@/lib/google-maps-api";
import { formatTripLocationLabel, timezoneLabelFromOffset } from "@/lib/location/format";
import {
  buildFormattedName,
  formatGeographicSuggestionLabel,
  isGeographicPlaceTypes,
  isRejectedTripLocationLabel,
  TRIP_LOCATION_PRIMARY_TYPES,
} from "@/lib/location/geographic-only";
import type { LocationSuggestion, TripLocation } from "@/lib/location/types";
import { localeToGeocodeRegion, localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import { coerceLocale } from "@/lib/i18n/resolve-locale";
import type { Locale } from "@/lib/i18n/types";
const TRIP_PLACE_DETAILS_FIELD_MASK =
  "id,displayName,formattedAddress,location,addressComponents,utcOffsetMinutes,types,primaryType";

const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types";

const AutocompleteInput = z.object({
  query: z.string().min(1).max(120),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

const ResolveInput = z.object({
  placeId: z.string().min(1).max(200),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

const GeocodeTextInput = z.object({
  query: z.string().min(1).max(120),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

type AddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

type RawPlaceDetails = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  addressComponents?: AddressComponent[];
  utcOffsetMinutes?: number;
  types?: string[];
  primaryType?: string;
};

type AutocompleteSuggestion = {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
    types?: string[];
  };
};

function parseGoogleError(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string; status?: string } };
    if (j.error?.message) return `${j.error.status ?? "ERROR"}: ${j.error.message}`;
  } catch {
    /* ignore */
  }
  return text.slice(0, 200);
}

function componentText(components: AddressComponent[] | undefined, type: string): string {
  const c = components?.find((x) => x.types?.includes(type));
  return c?.longText?.trim() || c?.shortText?.trim() || "";
}

function resolveCity(components: AddressComponent[] | undefined, displayName: string): string {
  const locality = componentText(components, "locality");
  if (locality) return locality;
  const admin2 = componentText(components, "administrative_area_level_2");
  if (admin2) return admin2;
  const admin1 = componentText(components, "administrative_area_level_1");
  if (admin1 && admin1 !== displayName) return admin1;
  return displayName;
}

function resolveRegion(components: AddressComponent[] | undefined): string | undefined {
  const admin1 = componentText(components, "administrative_area_level_1");
  if (admin1) return admin1;
  const admin2 = componentText(components, "administrative_area_level_2");
  return admin2 || undefined;
}

function rawToTripLocation(raw: RawPlaceDetails, placeId: string): TripLocation | null {
  const types = [...(raw.types ?? []), ...(raw.primaryType ? [raw.primaryType] : [])];
  if (!isGeographicPlaceTypes(types)) return null;

  const lat = raw.location?.latitude;
  const lng = raw.location?.longitude;
  if (lat == null || lng == null) return null;

  const displayName = raw.displayName?.text?.trim() || "";
  const country = componentText(raw.addressComponents, "country") || displayName;
  const city = resolveCity(raw.addressComponents, displayName);
  const region = resolveRegion(raw.addressComponents);
  const utcOffsetMinutes = raw.utcOffsetMinutes ?? null;
  const formattedName = buildFormattedName(country, city, displayName);

  if (isRejectedTripLocationLabel(formattedName)) return null;

  return {
    placeId: raw.id ?? placeId,
    country: country || city,
    city: city || country || displayName,
    region,
    lat,
    lng,
    formattedName,
    displayLabel: formattedName,
    address: raw.formattedAddress,
    timezone: timezoneLabelFromOffset(utcOffsetMinutes),
    utcOffsetMinutes,
  };
}

type LegacyGeocodeComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type LegacyGeocodeResult = {
  place_id?: string;
  formatted_address?: string;
  geometry?: { location?: { lat: number; lng: number } };
  address_components?: LegacyGeocodeComponent[];
  types?: string[];
};

function legacyComponentText(
  components: LegacyGeocodeComponent[] | undefined,
  type: string,
): string {
  const c = components?.find((x) => x.types?.includes(type));
  return c?.long_name?.trim() || c?.short_name?.trim() || "";
}

function legacyResolveCity(
  components: LegacyGeocodeComponent[] | undefined,
  fallback: string,
): string {
  const locality = legacyComponentText(components, "locality");
  if (locality) return locality;
  const admin2 = legacyComponentText(components, "administrative_area_level_2");
  if (admin2) return admin2;
  const admin1 = legacyComponentText(components, "administrative_area_level_1");
  if (admin1 && admin1 !== fallback) return admin1;
  const sub = legacyComponentText(components, "sublocality");
  if (sub) return sub;
  return fallback;
}

function legacyGeocodeToTripLocation(result: LegacyGeocodeResult): TripLocation | null {
  const types = result.types ?? [];
  if (!isGeographicPlaceTypes(types)) return null;

  const lat = result.geometry?.location?.lat;
  const lng = result.geometry?.location?.lng;
  if (lat == null || lng == null) return null;

  const country = legacyComponentText(result.address_components, "country");
  const city = legacyResolveCity(
    result.address_components,
    result.formatted_address?.split(",")[0]?.trim() || country,
  );
  const region =
    legacyComponentText(result.address_components, "administrative_area_level_1") || undefined;
  const formattedName = buildFormattedName(country, city, city || country);
  if (isRejectedTripLocationLabel(formattedName)) return null;

  const placeId = result.place_id ?? `geocode:${lat},${lng}`;

  return {
    placeId,
    country: country || city,
    city: city || country,
    region,
    lat,
    lng,
    formattedName,
    displayLabel: formattedName,
    address: result.formatted_address,
    timezone: undefined,
    utcOffsetMinutes: null,
  };
}

function pickBestGeocodeResult(results: LegacyGeocodeResult[]): LegacyGeocodeResult | null {
  for (const r of results) {
    if (isGeographicPlaceTypes(r.types)) return r;
  }
  return results[0] ?? null;
}

function legacyGeocodeToSuggestion(result: LegacyGeocodeResult): LocationSuggestion | null {
  if (!isGeographicPlaceTypes(result.types)) return null;
  const placeId = result.place_id;
  if (!placeId) return null;

  const formatted = result.formatted_address?.trim() ?? "";
  const main = formatted.split(",")[0]?.trim() || "";
  const country = legacyComponentText(result.address_components, "country");
  const city = legacyResolveCity(result.address_components, main || country);
  const label = formatGeographicSuggestionLabel(city || main, country || undefined);
  if (!label || isRejectedTripLocationLabel(label)) return null;

  return {
    placeId,
    label,
    secondary: formatted || undefined,
  };
}

/** Geocoding API：日本、韓國、大阪、首爾等國家／城市（autocomplete 無結果時） */
async function geocodeQueryToSuggestions(
  query: string,
  userLocale: Locale,
  apiKey: string,
): Promise<{ suggestions: LocationSuggestion[]; error: string | null }> {
  const language = localeToGoogleLanguageCode(userLocale);
  const region = localeToGeocodeRegion(userLocale);
  const queries = [query.trim(), query.trim().replace(/[·・,，/\s]+/g, "")].filter(Boolean);
  const uniqueQueries = [...new Set(queries)];

  const suggestions: LocationSuggestion[] = [];
  const seen = new Set<string>();

  for (const q of uniqueQueries) {
    const res = await fetch(geocodeForwardUrl(q, apiKey, { language, region }));
    if (!res.ok) continue;

    const json = (await res.json()) as {
      status?: string;
      error_message?: string;
      results?: LegacyGeocodeResult[];
    };

    if (json.status !== "OK" && json.status !== "ZERO_RESULTS") continue;

    for (const r of json.results ?? []) {
      const item = legacyGeocodeToSuggestion(r);
      if (!item || seen.has(item.label)) continue;
      seen.add(item.label);
      suggestions.push(item);
      if (suggestions.length >= 8) break;
    }
    if (suggestions.length > 0) break;
  }

  if (suggestions.length === 0) {
    return {
      suggestions: [],
      error: "暫時找不到這個地點，請換個關鍵字試試。",
    };
  }

  return { suggestions, error: null };
}

const INTERNATIONAL_DEST_HINT =
  /^(首爾|首尔|大阪|東京|东京|京都|札幌|福岡|名古屋|橫濱|神戶|沖繩|台北|高雄|台中|台南|香港|新加坡|曼谷|巴黎|倫敦|紐約|洛杉磯|雪梨|墨爾本)/i;

function prefersGeocodeFirst(query: string): boolean {
  const q = query.trim();
  return q.length <= 8 || INTERNATIONAL_DEST_HINT.test(q);
}

export const searchTripLocations = createServerFn({ method: "POST" })
  .inputValidator((input) => AutocompleteInput.parse(input))
  .handler(
    async ({ data }): Promise<{ suggestions: LocationSuggestion[]; error: string | null }> => {
      const { requireGoogleMapsServerKey } = await import("@/lib/google-maps.server");
      const apiKey = requireGoogleMapsServerKey();
      const userLocale: Locale = data.locale ? coerceLocale(data.locale) : "zh-TW";
      const trimmed = data.query.trim();

      if (prefersGeocodeFirst(trimmed)) {
        const geo = await geocodeQueryToSuggestions(trimmed, userLocale, apiKey);
        if (geo.suggestions.length > 0) return geo;
      }

      const autocompleteBody: Record<string, unknown> = {
        input: trimmed,
        languageCode: localeToGoogleLanguageCode(userLocale),
        includedPrimaryTypes: [...TRIP_LOCATION_PRIMARY_TYPES],
      };
      if (userLocale === "zh-TW" && !INTERNATIONAL_DEST_HINT.test(trimmed)) {
        autocompleteBody.locationBias = {
          circle: {
            center: { latitude: 25.033963, longitude: 121.564472 },
            radius: 80_000,
          },
        };
      }
      const res = await fetch(placesAutocompleteUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
        },
        body: JSON.stringify(autocompleteBody),
      });

      if (!res.ok) {
        const detail = parseGoogleError(await res.text());
        console.error("[Roamie Location] autocomplete failed", res.status, detail);
        return geocodeQueryToSuggestions(data.query.trim(), userLocale, apiKey);
      }

      const json = (await res.json()) as { suggestions?: AutocompleteSuggestion[] };
      const suggestions: LocationSuggestion[] = [];
      const seen = new Set<string>();

      for (const s of json.suggestions ?? []) {
        const pred = s.placePrediction;
        const placeId = pred?.placeId;
        if (!placeId) continue;

        const types = pred?.types ?? [];
        if (types.length > 0 && !isGeographicPlaceTypes(types)) continue;

        const main = pred?.structuredFormat?.mainText?.text ?? pred?.text?.text ?? "";
        const secondary = pred?.structuredFormat?.secondaryText?.text?.trim();
        const label = formatGeographicSuggestionLabel(main, secondary);
        if (!label || isRejectedTripLocationLabel(label)) continue;
        if (seen.has(label)) continue;
        seen.add(label);

        suggestions.push({
          placeId,
          label,
          ...(secondary && !label.includes(secondary) ? { secondary } : {}),
        });
      }

      if (suggestions.length === 0) {
        return geocodeQueryToSuggestions(data.query.trim(), userLocale, apiKey);
      }

      return { suggestions, error: null };
    },
  );

export type GeocodeFailureCode =
  | "geocode_zero_results"
  | "geocode_rate_limited"
  | "geocode_auth_error"
  | "geocode_invalid_request"
  | "geocode_network_error"
  | "geocode_response_parse_error"
  | "geocode_empty_response"
  | "geocode_filtered_non_geographic";

function mapGeocodeApiStatus(status: string | undefined): GeocodeFailureCode | null {
  switch (status) {
    case "OK":
      return null;
    case "ZERO_RESULTS":
      return "geocode_zero_results";
    case "OVER_QUERY_LIMIT":
    case "RESOURCE_EXHAUSTED":
      return "geocode_rate_limited";
    case "REQUEST_DENIED":
      return "geocode_auth_error";
    case "INVALID_REQUEST":
      return "geocode_invalid_request";
    case undefined:
    case "":
      return "geocode_empty_response";
    default:
      return "geocode_response_parse_error";
  }
}

/**
 * Geocode a single query string.
 * Callers that need fallback queries must expand them (e.g. geocodeDestinationWithFallback).
 * Do NOT re-expand with buildDestinationGeocodeQueries here — that nested the same query set.
 */
export const geocodeTripLocationFromText = createServerFn({ method: "POST" })
  .inputValidator((input) => GeocodeTextInput.parse(input))
  .handler(async ({ data }): Promise<{ location: TripLocation | null; error: string | null }> => {
    const { requireGoogleMapsServerKey } = await import("@/lib/google-maps.server");
    const apiKey = requireGoogleMapsServerKey();
    const userLocale: Locale = data.locale ? coerceLocale(data.locale) : "zh-TW";
    const language = localeToGoogleLanguageCode(userLocale);
    const region = localeToGeocodeRegion(userLocale);
    const query = data.query.trim();
    if (!query) {
      return { location: null, error: "geocode_invalid_request" };
    }

    let res: Response;
    try {
      res = await fetch(geocodeForwardUrl(query, apiKey, { language, region }));
    } catch (error) {
      console.warn(
        "[GEOCODE_FAILURE_DETAIL]",
        `code=geocode_network_error`,
        `query=${query}`,
        `message=${error instanceof Error ? error.message : String(error)}`,
      );
      return { location: null, error: "geocode_network_error" };
    }

    if (!res.ok) {
      const code: GeocodeFailureCode =
        res.status === 429 || res.status === 503
          ? "geocode_rate_limited"
          : res.status === 401 || res.status === 403
            ? "geocode_auth_error"
            : "geocode_network_error";
      console.warn(
        "[GEOCODE_FAILURE_DETAIL]",
        `code=${code}`,
        `httpStatus=${res.status}`,
        `query=${query}`,
      );
      return { location: null, error: code };
    }

    let json: {
      status?: string;
      error_message?: string;
      results?: LegacyGeocodeResult[];
    };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      console.warn(
        "[GEOCODE_FAILURE_DETAIL]",
        "code=geocode_response_parse_error",
        `httpStatus=${res.status}`,
        `query=${query}`,
      );
      return { location: null, error: "geocode_response_parse_error" };
    }

    const statusCode = mapGeocodeApiStatus(json.status);
    if (statusCode) {
      console.warn(
        "[GEOCODE_FAILURE_DETAIL]",
        `code=${statusCode}`,
        `httpStatus=${res.status}`,
        `rawStatus=${json.status ?? ""}`,
        `query=${query}`,
        json.error_message ? `error_message=${json.error_message}` : "",
      );
      return { location: null, error: statusCode };
    }

    const results = json.results ?? [];
    if (!results.length) {
      console.warn(
        "[GEOCODE_FAILURE_DETAIL]",
        "code=geocode_zero_results",
        `httpStatus=${res.status}`,
        `rawStatus=${json.status ?? "OK"}`,
        `query=${query}`,
      );
      return { location: null, error: "geocode_zero_results" };
    }

    const picked = pickBestGeocodeResult(results);
    if (!picked) {
      return { location: null, error: "geocode_filtered_non_geographic" };
    }

    const location = legacyGeocodeToTripLocation(picked);
    if (!location) {
      console.warn(
        "[GEOCODE_FAILURE_DETAIL]",
        "code=geocode_filtered_non_geographic",
        `httpStatus=${res.status}`,
        `rawStatus=${json.status ?? "OK"}`,
        `types=${(picked.types ?? []).join("|")}`,
        `query=${query}`,
      );
      return { location: null, error: "geocode_filtered_non_geographic" };
    }

    return { location, error: null };
  });

export const resolveTripLocation = createServerFn({ method: "POST" })
  .inputValidator((input) => ResolveInput.parse(input))
  .handler(async ({ data }): Promise<{ location: TripLocation | null; error: string | null }> => {
    const { requireGoogleMapsServerKey } = await import("@/lib/google-maps.server");
    const apiKey = requireGoogleMapsServerKey();
    const userLocale: Locale = data.locale ? coerceLocale(data.locale) : "zh-TW";
    const languageCode = localeToGoogleLanguageCode(userLocale);
    const res = await fetch(placeDetailsUrl(data.placeId, languageCode), {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": TRIP_PLACE_DETAILS_FIELD_MASK,
        "Accept-Language": languageCode,
      },
    });

    if (!res.ok) {
      const detail = parseGoogleError(await res.text());
      console.error("[Roamie Location] details failed", res.status, detail);
      return { location: null, error: detail };
    }

    const raw = (await res.json()) as RawPlaceDetails;
    const location = rawToTripLocation(raw, data.placeId);
    if (!location) {
      return { location: null, error: "請選擇國家、城市或地區（非店家或景點）" };
    }
    if (!location.formattedName) {
      const name = formatTripLocationLabel(location);
      location.formattedName = name;
      location.displayLabel = name;
    }
    return { location, error: null };
  });
