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
import { normalizeCountryReference } from "@/lib/ai/destination-country-normalize";
import {
  extractCoordinatesFromProviderResponse,
  pickProviderCoordinates,
} from "@/lib/ai/destination-provider-coords";
import {
  isValidAnchorCoordinate,
  tripLocationToProviderResult,
  type DestinationProviderResult,
} from "@/lib/ai/destination-provider-result";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  logDestinationProviderRequest,
  logDestinationProviderResponse,
  logDestinationServerRequest,
  logDestinationServerResponse,
  newDestinationProviderRequestId,
} from "@/lib/ai/destination-provider-log";

const TRIP_PLACE_DETAILS_FIELD_MASK =
  "id,displayName,formattedAddress,location,addressComponents,utcOffsetMinutes,types,primaryType";

const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types";

/** Destination Anchor Places Details — geometry + country only. */
const ANCHOR_PLACE_DETAILS_FIELD_MASK =
  "id,displayName,formattedAddress,location,addressComponents,types,primaryType";

const AutocompleteInput = z.object({
  query: z.string().min(1).max(120),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

const ResolveInput = z.object({
  placeId: z.string().min(1).max(200),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

/** Coerce region / countryCode to ISO-2 Latin only — reject 日本/蒙古 length-2 traps. */
function coerceIsoRegionCode(value: string | undefined | null): string | undefined {
  if (!value?.trim()) return undefined;
  const normalized = normalizeCountryReference(value, value);
  const code = (normalized.countryCode ?? value).trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) return code.toLowerCase();
  return undefined;
}

const GeocodeTextInput = z
  .object({
    query: z.string().min(1).max(120),
    /** Canonical destination label for diagnostics (e.g. 熊本). */
    destinationName: z.string().min(1).max(120).optional(),
    locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
    language: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
    /** Prefer destination country bias over UI locale region (e.g. jp for 熊本). */
    region: z.string().min(1).max(32).optional(),
    countryCode: z.string().min(1).max(32).optional(),
    /**
     * Destination Anchor must not inherit UI locale region (e.g. tw) when the
     * destination country is unknown — that biases overseas cities incorrectly.
     */
    disableLocaleRegionBias: z.boolean().optional(),
    /**
     * When false, skip Places Autocomplete fallback (intermediate geocode retries).
     * Default true so ZERO_RESULTS still attempt Autocomplete → Details.
     */
    placesFallback: z.boolean().optional(),
  })
  .transform((data) => ({
    ...data,
    region: coerceIsoRegionCode(data.region) ?? coerceIsoRegionCode(data.countryCode),
    countryCode: coerceIsoRegionCode(data.countryCode)?.toUpperCase(),
  }));

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

function looksLikeAdminDistrictLabel(label: string): boolean {
  const t = label.trim();
  return t.length >= 2 && /(?:區|区|鎮|镇|鄉|乡|町)$/.test(t) && !/(?:市|縣|县|都|府)$/.test(t);
}

function resolveDistrict(components: AddressComponent[] | undefined): string | undefined {
  const admin2 = componentText(components, "administrative_area_level_2");
  return (
    componentText(components, "administrative_area_level_3") ||
    componentText(components, "sublocality_level_1") ||
    componentText(components, "sublocality") ||
    (looksLikeAdminDistrictLabel(admin2) ? admin2 : undefined) ||
    undefined
  );
}

function resolveSublocality(components: AddressComponent[] | undefined): string | undefined {
  return (
    componentText(components, "sublocality_level_1") ||
    componentText(components, "sublocality") ||
    componentText(components, "neighborhood") ||
    undefined
  );
}

function rawToTripLocation(raw: RawPlaceDetails, placeId: string): TripLocation | null {
  const types = [...(raw.types ?? []), ...(raw.primaryType ? [raw.primaryType] : [])];
  if (!isGeographicPlaceTypes(types)) return null;

  const extracted = pickProviderCoordinates(raw);
  const lat = extracted?.latitude ?? raw.location?.latitude;
  const lng = extracted?.longitude ?? raw.location?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const displayName = raw.displayName?.text?.trim() || "";
  const country = componentText(raw.addressComponents, "country") || displayName;
  const city = resolveCity(raw.addressComponents, displayName);
  const region = resolveRegion(raw.addressComponents);
  const district = resolveDistrict(raw.addressComponents);
  const sublocality = resolveSublocality(raw.addressComponents);
  const utcOffsetMinutes = raw.utcOffsetMinutes ?? null;
  const formattedName = buildFormattedName(country, city, displayName);

  if (isRejectedTripLocationLabel(formattedName)) return null;

  return {
    placeId: raw.id ?? placeId,
    country: country || city,
    city: city || country || displayName,
    region,
    district,
    sublocality,
    lat: lat as number,
    lng: lng as number,
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

function legacyGeocodeToTripLocation(
  result: LegacyGeocodeResult,
  opts?: { softAcceptCoords?: boolean },
): TripLocation | null {
  const types = result.types ?? [];
  const extracted = pickProviderCoordinates(result);
  const lat = extracted?.latitude;
  const lng = extracted?.longitude;
  // Soft accept: valid WGS84 coords win over locality/admin type mismatches.
  if (!isValidAnchorCoordinate(lat, lng)) return null;
  if (!opts?.softAcceptCoords && !isGeographicPlaceTypes(types)) return null;

  const countryRaw = legacyComponentText(result.address_components, "country");
  const countryCode =
    result.address_components?.find((c) => c.types?.includes("country"))?.short_name?.toUpperCase() ??
    extracted?.countryCode;
  const normalizedCountry = normalizeCountryReference(countryRaw, countryCode);
  const country = normalizedCountry.country || countryRaw;
  const city = legacyResolveCity(
    result.address_components,
    result.formatted_address?.split(",")[0]?.trim() || country,
  );
  const region =
    legacyComponentText(result.address_components, "administrative_area_level_1") || undefined;
  const district =
    legacyComponentText(result.address_components, "administrative_area_level_3") ||
    legacyComponentText(result.address_components, "sublocality_level_1") ||
    legacyComponentText(result.address_components, "sublocality") ||
    (looksLikeAdminDistrictLabel(
      legacyComponentText(result.address_components, "administrative_area_level_2"),
    )
      ? legacyComponentText(result.address_components, "administrative_area_level_2")
      : undefined) ||
    undefined;
  const sublocality =
    legacyComponentText(result.address_components, "sublocality_level_1") ||
    legacyComponentText(result.address_components, "sublocality") ||
    legacyComponentText(result.address_components, "neighborhood") ||
    undefined;
  const formattedName = buildFormattedName(country, city, city || country);
  // Soft-accept: never drop valid city/prefecture coords for label heuristics.
  if (!opts?.softAcceptCoords && isRejectedTripLocationLabel(formattedName)) return null;

  const placeId = result.place_id ?? extracted?.placeId ?? `geocode:${lat},${lng}`;

  return {
    placeId,
    country: country || city,
    city: city || country,
    region,
    district,
    sublocality,
    lat: lat as number,
    lng: lng as number,
    formattedName,
    displayLabel: formattedName,
    address: result.formatted_address,
    timezone: undefined,
    utcOffsetMinutes: null,
  };
}

function compactGeocodeHint(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/臺/g, "台")
    .replace(/[\s,，、/／.·'’-]+/g, "")
    .replace(/(?:市|縣|县)/g, "");
}

function pickBestGeocodeResult(
  results: LegacyGeocodeResult[],
  opts?: { preferredCountryCode?: string; destinationHint?: string },
): LegacyGeocodeResult | null {
  if (!results.length) return null;

  const preferred = (opts?.preferredCountryCode ?? "").trim().toUpperCase();
  const destHint = (opts?.destinationHint ?? "").trim().toLowerCase();

  const score = (r: LegacyGeocodeResult): number => {
    const types = r.types ?? [];
    if (!isGeographicPlaceTypes(types)) return -1000;
    let s = 0;
    if (types.includes("locality")) s += 50;
    if (types.includes("administrative_area_level_1")) s += 30;
    if (types.includes("administrative_area_level_2")) s += 35;
    if (types.includes("colloquial_area") || types.includes("natural_feature")) s += 25;
    if (types.includes("political")) s += 5;
    // Prefer not POI/establishment-only.
    if (types.includes("establishment") && !types.some((t) => ALLOWED_ANCHOR_TYPES.has(t))) {
      s -= 80;
    }
    if (types.includes("point_of_interest") && !types.includes("locality")) s -= 40;
    if (types.includes("tourist_attraction")) s -= 60;
    if (types.includes("train_station") || types.includes("transit_station")) s -= 70;

    const countryShort = legacyComponentText(r.address_components, "country");
    // Google returns long_name for country in long_name; short_name is JP.
    const countryCode =
      r.address_components?.find((c) => c.types?.includes("country"))?.short_name?.toUpperCase() ??
      "";
    if (preferred && countryCode === preferred) s += 40;
    if (preferred === "JP" && /日本|Japan/i.test(countryShort)) s += 40;

    const locality = legacyComponentText(r.address_components, "locality").toLowerCase();
    const admin1 = legacyComponentText(
      r.address_components,
      "administrative_area_level_1",
    ).toLowerCase();
    const admin2 = legacyComponentText(
      r.address_components,
      "administrative_area_level_2",
    ).toLowerCase();
    const formatted = (r.formatted_address ?? "").toLowerCase();
    if (destHint) {
      if (locality.includes(destHint) || destHint.includes(locality.slice(0, 2))) s += 20;
      if (admin1.includes(destHint)) s += 10;
      if (formatted.includes(destHint)) s += 5;
      const compactDest = compactGeocodeHint(destHint);
      const compactFormatted = compactGeocodeHint(formatted);
      const compactAdmin2 = compactGeocodeHint(admin2);
      if (compactDest.length >= 2) {
        if (compactFormatted === compactDest || compactFormatted.includes(compactDest)) s += 40;
        if (
          compactAdmin2.length >= 2 &&
          compactDest.includes(compactAdmin2) &&
          compactDest !== compactAdmin2
        ) {
          s += 35;
        }
      }
      // Prefer city locality over prefecture-only when names collide (熊本).
      if (types.includes("locality") && /city|市/.test(formatted)) s += 15;
    }
    if (r.geometry?.location?.lat != null && r.geometry?.location?.lng != null) s += 5;
    return s;
  };

  let best: LegacyGeocodeResult | null = null;
  let bestScore = -Infinity;
  for (const r of results) {
    const s = score(r);
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  if (best && bestScore > -500) return best;
  // Fallback: first geographic
  for (const r of results) {
    if (isGeographicPlaceTypes(r.types)) return r;
  }
  return null;
}

const ALLOWED_ANCHOR_TYPES = new Set([
  "locality",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "colloquial_area",
  "natural_feature",
  "island",
  "archipelago",
  "political",
  "country",
  "postal_town",
  "sublocality",
  "neighborhood",
]);

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
  | "geocode_filtered_non_geographic"
  | "geocode_request_denied"
  | "geocode_over_query_limit"
  | "geocode_decode_error"
  | "places_autocomplete_empty"
  | "places_details_empty";

function mapGeocodeApiStatus(status: string | undefined): GeocodeFailureCode | null {
  switch ((status ?? "").trim().toUpperCase()) {
    case "OK":
      return null;
    case "ZERO_RESULTS":
      return "geocode_zero_results";
    case "OVER_QUERY_LIMIT":
    case "RESOURCE_EXHAUSTED":
      return "geocode_over_query_limit";
    case "REQUEST_DENIED":
      return "geocode_request_denied";
    case "INVALID_REQUEST":
      return "geocode_invalid_request";
    case "UNKNOWN_ERROR":
    case "ERROR":
      return "geocode_network_error";
    case "":
      return "geocode_empty_response";
    default:
      return "geocode_response_parse_error";
  }
}

function logProviderResponse(params: {
  requestId: string;
  provider: string;
  query: string;
  httpStatus: number;
  rawResultCount: number;
  parsedCandidateCount: number;
  responseShape: string;
  rawStatus?: string;
  errorCode?: string;
  errorMessage?: string;
  elapsedMs?: number;
  hasGeometry?: boolean;
}): void {
  logDestinationProviderResponse({
    requestId: params.requestId,
    provider: params.provider,
    query: params.query,
    httpStatus: params.httpStatus,
    apiStatus: params.rawStatus,
    rawResultCount: params.rawResultCount,
    parsedResultCount: params.parsedCandidateCount,
    hasGeometry: params.hasGeometry ?? params.parsedCandidateCount > 0,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    responseShape: params.responseShape,
    elapsedMs: params.elapsedMs,
  });
}

async function resolveViaPlacesAutocompleteDetails(params: {
  query: string;
  apiKey: string;
  language: string;
  regionCode?: string;
  requestId?: string;
}): Promise<{ location: TripLocation | null; error: GeocodeFailureCode | null }> {
  const { query, apiKey, language, regionCode } = params;
  const requestId = params.requestId ?? newDestinationProviderRequestId();

  const runAutocomplete = async (
    includedPrimaryTypes?: string[],
  ): Promise<{ suggestions: AutocompleteSuggestion[]; httpStatus: number; error: GeocodeFailureCode | null }> => {
    const autocompleteBody: Record<string, unknown> = {
      input: query,
      languageCode: language,
    };
    if (includedPrimaryTypes?.length) {
      autocompleteBody.includedPrimaryTypes = includedPrimaryTypes;
    }
    if (regionCode) autocompleteBody.includedRegionCodes = [regionCode.toUpperCase()];

    logDestinationProviderRequest({
      requestId,
      provider: "places_autocomplete",
      query,
      requestPath: "resolveViaPlacesAutocompleteDetails",
      platform: "server",
    });
    const started = Date.now();
    let autoRes: Response;
    try {
      autoRes = await fetch(placesAutocompleteUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
        },
        body: JSON.stringify(autocompleteBody),
      });
    } catch (error) {
      logProviderResponse({
        requestId,
        provider: "places_autocomplete",
        query,
        httpStatus: 0,
        rawResultCount: 0,
        parsedCandidateCount: 0,
        responseShape: "network_error",
        errorCode: "geocode_network_error",
        errorMessage: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - started,
      });
      return { suggestions: [], httpStatus: 0, error: "geocode_network_error" };
    }

    if (!autoRes.ok) {
      const code: GeocodeFailureCode =
        autoRes.status === 429 || autoRes.status === 503
          ? "geocode_over_query_limit"
          : autoRes.status === 401 || autoRes.status === 403
            ? "geocode_request_denied"
            : "geocode_network_error";
      logProviderResponse({
        requestId,
        provider: "places_autocomplete",
        query,
        httpStatus: autoRes.status,
        rawResultCount: 0,
        parsedCandidateCount: 0,
        responseShape: "http_error",
        errorCode: code,
        elapsedMs: Date.now() - started,
      });
      return { suggestions: [], httpStatus: autoRes.status, error: code };
    }

    let autoJson: { suggestions?: AutocompleteSuggestion[]; error?: { message?: string; status?: string } };
    try {
      autoJson = (await autoRes.json()) as typeof autoJson;
    } catch {
      logProviderResponse({
        requestId,
        provider: "places_autocomplete",
        query,
        httpStatus: autoRes.status,
        rawResultCount: 0,
        parsedCandidateCount: 0,
        responseShape: "decode_error",
        errorCode: "geocode_decode_error",
        elapsedMs: Date.now() - started,
      });
      return { suggestions: [], httpStatus: autoRes.status, error: "geocode_decode_error" };
    }

    const suggestions = autoJson.suggestions ?? [];
    logProviderResponse({
      requestId,
      provider: "places_autocomplete",
      query,
      httpStatus: autoRes.status,
      rawResultCount: suggestions.length,
      parsedCandidateCount: suggestions.filter((s) => s.placePrediction?.placeId).length,
      responseShape: includedPrimaryTypes?.length
        ? `places.suggestions[]+types=${includedPrimaryTypes.join("|")}`
        : "places.suggestions[]",
      rawStatus: autoJson.error?.status,
      errorCode: suggestions.length ? undefined : "places_autocomplete_empty",
      errorMessage: autoJson.error?.message,
      elapsedMs: Date.now() - started,
    });
    return { suggestions, httpStatus: autoRes.status, error: null };
  };

  // Prefer regions (cities / admin / colloquial); then unrestricted for natural features (戈壁).
  let auto = await runAutocomplete(["(regions)"]);
  if (!auto.suggestions.some((s) => s.placePrediction?.placeId)) {
    auto = await runAutocomplete(undefined);
  }
  if (auto.error && !auto.suggestions.length) {
    return { location: null, error: auto.error };
  }

  const placeId = auto.suggestions.find((s) => s.placePrediction?.placeId)?.placePrediction?.placeId;
  if (!placeId) {
    return { location: null, error: "places_autocomplete_empty" };
  }

  let detailRes: Response;
  const detailStarted = Date.now();
  logDestinationProviderRequest({
    requestId,
    provider: "places_details",
    query,
    requestPath: "resolveViaPlacesAutocompleteDetails",
    platform: "server",
  });
  try {
    detailRes = await fetch(placeDetailsUrl(placeId, language), {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": ANCHOR_PLACE_DETAILS_FIELD_MASK,
        "Accept-Language": language,
      },
    });
  } catch (error) {
    logProviderResponse({
      requestId,
      provider: "places_details",
      query,
      httpStatus: 0,
      rawResultCount: 0,
      parsedCandidateCount: 0,
      responseShape: "network_error",
      errorCode: "geocode_network_error",
      errorMessage: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - detailStarted,
    });
    return { location: null, error: "geocode_network_error" };
  }

  if (!detailRes.ok) {
    logProviderResponse({
      requestId,
      provider: "places_details",
      query,
      httpStatus: detailRes.status,
      rawResultCount: 0,
      parsedCandidateCount: 0,
      responseShape: "http_error",
      errorCode: "places_details_empty",
      elapsedMs: Date.now() - detailStarted,
    });
    return { location: null, error: "places_details_empty" };
  }

  let detailJson: RawPlaceDetails;
  try {
    detailJson = (await detailRes.json()) as RawPlaceDetails;
  } catch {
    logProviderResponse({
      requestId,
      provider: "places_details",
      query,
      httpStatus: detailRes.status,
      rawResultCount: 0,
      parsedCandidateCount: 0,
      responseShape: "decode_error",
      errorCode: "geocode_decode_error",
      elapsedMs: Date.now() - detailStarted,
    });
    return { location: null, error: "geocode_decode_error" };
  }

  const extracted = extractCoordinatesFromProviderResponse(detailJson);
  logProviderResponse({
    requestId,
    provider: "places_details",
    query,
    httpStatus: detailRes.status,
    rawResultCount: extracted.rawResultCount || (detailJson.location ? 1 : 0),
    parsedCandidateCount: extracted.candidates.length,
    responseShape: extracted.responseShape,
    hasGeometry: extracted.candidates.length > 0,
    elapsedMs: Date.now() - detailStarted,
  });

  const location = rawToTripLocation(detailJson, placeId);
  if (location && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
    return { location, error: null };
  }

  // Soft accept: even if type filter rejected, use raw geometry for Destination Anchor.
  const candidate = extracted.candidates[0];
  if (candidate && Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude)) {
    const countryRaw = candidate.country ?? "";
    const normalized = normalizeCountryReference(countryRaw, candidate.countryCode);
    return {
      location: {
        placeId: candidate.placeId ?? placeId,
        country: normalized.country || countryRaw || candidate.name || query,
        city: candidate.name || query,
        lat: candidate.latitude,
        lng: candidate.longitude,
        formattedName: candidate.formattedAddress || candidate.name || query,
        displayLabel: candidate.formattedAddress || candidate.name || query,
        address: candidate.formattedAddress,
        timezone: undefined,
        utcOffsetMinutes: null,
      },
      error: null,
    };
  }

  return { location: null, error: "places_details_empty" };
}

/**
 * Geocode a single query string.
 * Callers that need fallback queries must expand them (e.g. geocodeDestinationWithFallback).
 * Do NOT re-expand with buildDestinationGeocodeQueries here — that nested the same query set.
 *
 * Provider order for Destination Anchor:
 * 1. Google Geocoding API
 * 2. Places Autocomplete → Place Details geometry (when placesFallback !== false)
 *
 * Response always includes normalized `providerResult` so Client can log diagnostics
 * even when Server stdout is not visible in Xcode.
 */
export const geocodeTripLocationFromText = createServerFn({ method: "POST" })
  .inputValidator((input) => GeocodeTextInput.parse(input))
  .handler(
    async ({
      data,
    }): Promise<{
      location: TripLocation | null;
      error: string | null;
      providerResult: DestinationProviderResult;
    }> => {
    const { requireGoogleMapsServerKey } = await import("@/lib/google-maps.server");
    const apiKey = requireGoogleMapsServerKey();
    const userLocale: Locale = data.locale
      ? coerceLocale(data.locale)
      : data.language
        ? coerceLocale(data.language)
        : "zh-TW";
    const language = localeToGoogleLanguageCode(userLocale);
    const region =
      data.region?.trim().toLowerCase() ||
      data.countryCode?.trim().toLowerCase() ||
      (data.disableLocaleRegionBias ? undefined : localeToGeocodeRegion(userLocale));
    const query = data.query.trim();
    const destinationName = data.destinationName?.trim() || query;
    const allowPlacesFallback = data.placesFallback !== false;
    if (!query) {
      const providerResult: DestinationProviderResult = {
        ok: false,
        status: "INVALID_REQUEST",
        provider: "geocode",
        rawResultCount: 0,
        parsedResultCount: 0,
        failureReason: "geocode_invalid_request",
        query,
      };
      return { location: null, error: "geocode_invalid_request", providerResult };
    }

    const requestId = newDestinationProviderRequestId();
    const geocodeStarted = Date.now();
    logDestinationProviderRequest({
      requestId,
      destination: destinationName,
      normalizedDestination: destinationName,
      countryCode: data.countryCode,
      provider: "geocode",
      query,
      requestPath: "geocodeTripLocationFromText",
      platform: "server",
    });
    logDestinationServerRequest({
      provider: "geocode",
      endpoint: "maps/api/geocode/json",
      query,
      language,
      region,
      requestId,
      transport: "server",
    });

    const finish = (
      location: TripLocation | null,
      error: string | null,
      providerResult: DestinationProviderResult,
    ) => ({ location, error, providerResult });

    const runPlacesFallback = async (priorError: string | null) => {
      if (!allowPlacesFallback) {
        return finish(null, priorError, {
          ok: false,
          status: priorError ?? "ZERO_RESULTS",
          provider: "geocode",
          rawResultCount: 0,
          parsedResultCount: 0,
          failureReason: priorError ?? "geocode_zero_results",
          query,
        });
      }
      const placesFallback = await resolveViaPlacesAutocompleteDetails({
        query,
        apiKey,
        language,
        regionCode: region,
        requestId,
      });
      if (placesFallback.location) {
        const providerResult = tripLocationToProviderResult(placesFallback.location, {
          provider: "places_autocomplete",
          query,
          httpStatus: 200,
          apiStatus: "OK",
          sourceShape: "places_details",
        });
        return finish(placesFallback.location, null, providerResult);
      }
      const failureReason = placesFallback.error ?? priorError ?? "places_autocomplete_empty";
      return finish(null, failureReason, {
        ok: false,
        status: failureReason,
        provider: "places_autocomplete",
        rawResultCount: 0,
        parsedResultCount: 0,
        failureReason,
        query,
      });
    };

    let res: Response;
    try {
      res = await fetch(geocodeForwardUrl(query, apiKey, { language, region }));
    } catch (error) {
      logProviderResponse({
        requestId,
        provider: "geocode",
        query,
        httpStatus: 0,
        rawResultCount: 0,
        parsedCandidateCount: 0,
        responseShape: "network_error",
        errorCode: "geocode_network_error",
        errorMessage: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - geocodeStarted,
      });
      console.warn(
        "[GEOCODE_FAILURE_DETAIL]",
        `code=geocode_network_error`,
        `query=${query}`,
        `message=${error instanceof Error ? error.message : String(error)}`,
      );
      return runPlacesFallback("geocode_network_error");
    }

    if (!res.ok) {
      const code: GeocodeFailureCode =
        res.status === 429 || res.status === 503
          ? "geocode_over_query_limit"
          : res.status === 401 || res.status === 403
            ? "geocode_request_denied"
            : "geocode_network_error";
      console.warn(
        "[GEOCODE_FAILURE_DETAIL]",
        `code=${code}`,
        `httpStatus=${res.status}`,
        `query=${query}`,
      );
      logProviderResponse({
        requestId,
        provider: "geocode",
        query,
        httpStatus: res.status,
        rawResultCount: 0,
        parsedCandidateCount: 0,
        responseShape: "http_error",
        errorCode: code,
        elapsedMs: Date.now() - geocodeStarted,
      });
      // Hard stop on billing / permission / rate-limit — do not burn Autocomplete.
      if (code === "geocode_over_query_limit" || code === "geocode_request_denied") {
        return finish(null, code, {
          ok: false,
          status: code,
          provider: "geocode",
          rawResultCount: 0,
          parsedResultCount: 0,
          failureReason: code,
          httpStatus: res.status,
          query,
        });
      }
      return runPlacesFallback(code);
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
        "code=geocode_decode_error",
        `httpStatus=${res.status}`,
        `query=${query}`,
      );
      logProviderResponse({
        requestId,
        provider: "geocode",
        query,
        httpStatus: res.status,
        rawResultCount: 0,
        parsedCandidateCount: 0,
        responseShape: "decode_error",
        errorCode: "geocode_decode_error",
        elapsedMs: Date.now() - geocodeStarted,
      });
      return runPlacesFallback("geocode_decode_error");
    }

    const extracted = extractCoordinatesFromProviderResponse(json);
    const statusCode = mapGeocodeApiStatus(json.status);
    logProviderResponse({
      requestId,
      provider: "geocode",
      query,
      httpStatus: res.status,
      rawResultCount: extracted.rawResultCount,
      parsedCandidateCount: extracted.candidates.length,
      responseShape: extracted.responseShape,
      rawStatus: json.status ?? "",
      errorCode: statusCode ?? undefined,
      errorMessage: json.error_message,
      hasGeometry: extracted.candidates.length > 0,
      elapsedMs: Date.now() - geocodeStarted,
    });
    logDestinationServerResponse({
      provider: "geocode",
      httpStatus: res.status,
      googleStatus: json.status,
      resultCount: extracted.rawResultCount,
      errorMessage: json.error_message,
      requestId,
      elapsedMs: Date.now() - geocodeStarted,
    });

    const results = json.results ?? [];

    // Soft-accept: any finite WGS84 coords are valid anchors (city / prefecture / locality).
    if (extracted.candidates.length > 0) {
      const preferredCountryCode = data.countryCode?.trim().toUpperCase() || undefined;
      const destHint = query.split(/[,，]/)[0]?.trim() ?? query;
      const picked =
        results.length > 0
          ? pickBestGeocodeResult(results, {
              preferredCountryCode,
              destinationHint: destHint,
            })
          : null;
      let location = picked
        ? legacyGeocodeToTripLocation(picked, { softAcceptCoords: true })
        : null;
      if (!location) {
        const c = extracted.candidates[0]!;
        if (isValidAnchorCoordinate(c.latitude, c.longitude)) {
          const normalized = normalizeCountryReference(c.country, c.countryCode);
          location = {
            placeId: c.placeId ?? `geocode:${c.latitude},${c.longitude}`,
            country: normalized.country || c.country || c.name || destHint,
            city: c.name || destHint,
            lat: c.latitude,
            lng: c.longitude,
            formattedName: c.formattedAddress || c.name || destHint,
            displayLabel: c.formattedAddress || c.name || destHint,
            address: c.formattedAddress,
            timezone: undefined,
            utcOffsetMinutes: null,
          } satisfies TripLocation;
        }
      }

      if (location && isValidAnchorCoordinate(location.lat, location.lng)) {
        for (const c of extracted.candidates.slice(0, 5)) {
          logAiPipeline(
            "[DESTINATION_ANCHOR_CANDIDATE]",
            `name=${c.name ?? location.city}`,
            `placeId=${c.placeId ?? location.placeId}`,
            `country=${c.country ?? location.country}`,
            `latitude=${c.latitude}`,
            `longitude=${c.longitude}`,
            `types=${(c.types ?? []).join("|")}`,
            `accepted=${c.latitude === location.lat && c.longitude === location.lng}`,
            `rejectReason=${c.latitude === location.lat && c.longitude === location.lng ? "none" : "not_picked"}`,
            `provider=geocode`,
            `sourceShape=${c.sourceShape}`,
          );
        }
        const providerResult = tripLocationToProviderResult(location, {
          provider: "geocode",
          query,
          rawResultCount: extracted.rawResultCount,
          httpStatus: res.status,
          apiStatus: json.status ?? "OK",
          sourceShape: "geocode_results",
        });
        return finish(location, null, providerResult);
      }
    }

    if (statusCode) {
      console.warn(
        "[GEOCODE_FAILURE_DETAIL]",
        `code=${statusCode}`,
        `httpStatus=${res.status}`,
        `rawStatus=${json.status ?? ""}`,
        `query=${query}`,
        json.error_message ? `error_message=${json.error_message}` : "",
      );
    } else if (!results.length) {
      console.warn(
        "[GEOCODE_FAILURE_DETAIL]",
        "code=geocode_zero_results",
        `httpStatus=${res.status}`,
        `rawStatus=${json.status ?? "OK"}`,
        `query=${query}`,
      );
    } else {
      console.warn(
        "[GEOCODE_FAILURE_DETAIL]",
        "code=geocode_filtered_non_geographic",
        `httpStatus=${res.status}`,
        `rawStatus=${json.status ?? "OK"}`,
        `query=${query}`,
        `rawResultCount=${results.length}`,
      );
    }

    // Hard stop: rate limit / permission — do not continue to Autocomplete.
    if (
      statusCode === "geocode_over_query_limit" ||
      statusCode === "geocode_request_denied" ||
      statusCode === "geocode_auth_error"
    ) {
      return finish(null, statusCode, {
        ok: false,
        status: json.status ?? statusCode,
        provider: "geocode",
        rawResultCount: extracted.rawResultCount,
        parsedResultCount: 0,
        failureReason: statusCode,
        httpStatus: res.status,
        query,
        sourceShape: extracted.responseShape,
      });
    }

    // Geocode empty / filtered → Places Autocomplete + Details (when enabled).
    return runPlacesFallback(
      statusCode ??
        (results.length ? "geocode_filtered_non_geographic" : "geocode_zero_results"),
    );
  },
  );

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
