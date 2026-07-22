/**
 * Client-side Destination Provider (Capacitor / WebView).
 *
 * TestFlight & native bundles often have no reliable TanStack serverFn —
 * Places search already uses browser Google APIs; Destination Anchor must too.
 */
import {
  geocodeForwardUrl,
  placeDetailsUrl,
  placesAutocompleteUrl,
} from "@/lib/google-maps-api";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import type { Locale } from "@/lib/i18n/types";
import type { TripLocation } from "@/lib/location/types";
import { normalizeCountryReference } from "@/lib/ai/destination-country-normalize";
import {
  extractCoordinatesFromProviderResponse,
} from "@/lib/ai/destination-provider-coords";
import {
  isValidAnchorCoordinate,
  normalizeDestinationProviderResponse,
  tripLocationToProviderResult,
  type DestinationProviderResult,
  type GeocodeFnEnvelope,
} from "@/lib/ai/destination-provider-result";
import {
  logDestinationProviderNormalized,
  logDestinationServerRequest,
  logDestinationServerResponse,
  newDestinationProviderRequestId,
} from "@/lib/ai/destination-provider-log";

const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.types";

const ANCHOR_DETAILS_FIELD_MASK =
  "id,displayName,formattedAddress,location,addressComponents,types,primaryType";

function candidateToTripLocation(
  candidate: {
    latitude: number;
    longitude: number;
    formattedAddress?: string;
    placeId?: string;
    country?: string;
    countryCode?: string;
    name?: string;
    administrativeArea?: string;
    locality?: string;
  },
  fallbackName: string,
): TripLocation {
  const normalized = normalizeCountryReference(candidate.country, candidate.countryCode);
  const city =
    candidate.locality || candidate.name || fallbackName;
  return {
    placeId: candidate.placeId ?? `geocode:${candidate.latitude},${candidate.longitude}`,
    country: normalized.country || candidate.country || city,
    city,
    region: candidate.administrativeArea,
    lat: candidate.latitude,
    lng: candidate.longitude,
    formattedName: candidate.formattedAddress || city,
    displayLabel: candidate.formattedAddress || city,
    address: candidate.formattedAddress,
    timezone: undefined,
    utcOffsetMinutes: null,
  };
}

async function geocodeOnceClient(params: {
  query: string;
  apiKey: string;
  language: string;
  region?: string;
  destinationName: string;
}): Promise<GeocodeFnEnvelope> {
  const requestId = newDestinationProviderRequestId();
  const started = Date.now();
  const endpoint = geocodeForwardUrl(params.query, params.apiKey, {
    language: params.language,
    region: params.region,
  });
  logDestinationServerRequest({
    provider: "geocode",
    endpoint: "maps/api/geocode/json",
    query: params.query,
    language: params.language,
    region: params.region,
    requestId,
    transport: "client",
  });

  let res: Response;
  try {
    res = await fetch(endpoint);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logDestinationServerResponse({
      provider: "geocode",
      httpStatus: 0,
      googleStatus: "NETWORK_ERROR",
      resultCount: 0,
      errorMessage: message,
      requestId,
      elapsedMs: Date.now() - started,
    });
    return {
      location: null,
      error: "geocode_network_error",
      providerResult: {
        ok: false,
        status: "NETWORK_ERROR",
        provider: "geocode",
        rawResultCount: 0,
        parsedResultCount: 0,
        failureReason: "geocode_network_error",
        query: params.query,
        sourceShape: "network_error",
      },
    };
  }

  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }

  const extracted = extractCoordinatesFromProviderResponse(json);
  const apiStatus =
    typeof (json as { status?: string })?.status === "string"
      ? (json as { status: string }).status
      : undefined;
  const errorMessage =
    typeof (json as { error_message?: string })?.error_message === "string"
      ? (json as { error_message: string }).error_message
      : undefined;

  logDestinationServerResponse({
    provider: "geocode",
    httpStatus: res.status,
    googleStatus: apiStatus,
    resultCount: extracted.rawResultCount,
    errorMessage,
    requestId,
    elapsedMs: Date.now() - started,
  });

  const normalized = normalizeDestinationProviderResponse(json, {
    provider: "geocode",
    query: params.query,
    httpStatus: res.status,
    apiStatus,
  });

  logDestinationProviderNormalized({
    provider: "geocode",
    coordinateField: normalized.sourceShape,
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    placeId: normalized.placeId,
    source: "client_geocode",
    query: params.query,
    accepted: normalized.ok,
  });

  if (normalized.ok && isValidAnchorCoordinate(normalized.latitude, normalized.longitude)) {
    const first = extracted.candidates[0];
    const location = first
      ? candidateToTripLocation(first, params.destinationName)
      : {
          placeId: normalized.placeId ?? `geocode:${normalized.latitude},${normalized.longitude}`,
          country: normalized.country || params.destinationName,
          city: normalized.locality || params.destinationName,
          region: normalized.administrativeArea,
          lat: normalized.latitude!,
          lng: normalized.longitude!,
          formattedName: normalized.formattedAddress || params.destinationName,
          displayLabel: normalized.formattedAddress || params.destinationName,
          address: normalized.formattedAddress,
          timezone: undefined,
          utcOffsetMinutes: null,
        } satisfies TripLocation;
    return {
      location,
      error: null,
      providerResult: tripLocationToProviderResult(location, {
        provider: "geocode",
        query: params.query,
        httpStatus: res.status,
        apiStatus: apiStatus ?? "OK",
        sourceShape: normalized.sourceShape,
        rawResultCount: extracted.rawResultCount,
      }),
    };
  }

  return {
    location: null,
    error: normalized.failureReason ?? "geocode_zero_results",
    providerResult: {
      ...normalized,
      ok: false,
      provider: "geocode",
      query: params.query,
      httpStatus: res.status,
    },
  };
}

async function placesAutocompleteDetailsClient(params: {
  query: string;
  apiKey: string;
  language: string;
  region?: string;
  destinationName: string;
  allowDetails: boolean;
}): Promise<GeocodeFnEnvelope> {
  const requestId = newDestinationProviderRequestId();
  const started = Date.now();
  logDestinationServerRequest({
    provider: "places_autocomplete",
    endpoint: "places:autocomplete",
    query: params.query,
    language: params.language,
    region: params.region,
    requestId,
    transport: "client",
  });

  const body: Record<string, unknown> = {
    input: params.query,
    languageCode: params.language,
  };
  if (params.region) body.includedRegionCodes = [params.region.toUpperCase()];

  let autoRes: Response;
  try {
    autoRes = await fetch(placesAutocompleteUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": params.apiKey,
        "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logDestinationServerResponse({
      provider: "places_autocomplete",
      httpStatus: 0,
      googleStatus: "NETWORK_ERROR",
      resultCount: 0,
      errorMessage: message,
      requestId,
      elapsedMs: Date.now() - started,
    });
    return {
      location: null,
      error: "geocode_network_error",
      providerResult: {
        ok: false,
        status: "NETWORK_ERROR",
        provider: "places_autocomplete",
        rawResultCount: 0,
        parsedResultCount: 0,
        failureReason: "geocode_network_error",
        query: params.query,
      },
    };
  }

  let autoJson: {
    suggestions?: Array<{ placePrediction?: { placeId?: string } }>;
    error?: { message?: string; status?: string };
  } = {};
  try {
    autoJson = (await autoRes.json()) as typeof autoJson;
  } catch {
    autoJson = {};
  }

  const suggestions = autoJson.suggestions ?? [];
  const placeId = suggestions
    .map((s) => s.placePrediction?.placeId?.replace(/^places\//, "").trim())
    .find(Boolean);

  logDestinationServerResponse({
    provider: "places_autocomplete",
    httpStatus: autoRes.status,
    googleStatus: autoJson.error?.status ?? (placeId ? "OK" : "ZERO_RESULTS"),
    resultCount: suggestions.length,
    errorMessage: autoJson.error?.message,
    requestId,
    elapsedMs: Date.now() - started,
  });

  if (!placeId) {
    return {
      location: null,
      error: "places_autocomplete_empty",
      usedPlaceDetails: false,
      providerResult: {
        ok: false,
        status: "ZERO_RESULTS",
        provider: "places_autocomplete",
        rawResultCount: suggestions.length,
        parsedResultCount: 0,
        failureReason: "places_autocomplete_empty",
        httpStatus: autoRes.status,
        query: params.query,
      },
    };
  }

  if (!params.allowDetails) {
    return {
      location: null,
      error: "places_details_budget_exhausted",
      usedPlaceDetails: false,
      providerResult: {
        ok: false,
        status: "DETAILS_SKIPPED",
        provider: "places_autocomplete",
        rawResultCount: suggestions.length,
        parsedResultCount: 0,
        failureReason: "places_details_budget_exhausted",
        placeId,
        query: params.query,
      },
    };
  }

  const detailStarted = Date.now();
  const detailRequestId = newDestinationProviderRequestId();
  logDestinationServerRequest({
    provider: "places_details",
    endpoint: `places/${placeId}`,
    query: params.query,
    language: params.language,
    region: params.region,
    requestId: detailRequestId,
    transport: "client",
  });

  let detailRes: Response;
  try {
    detailRes = await fetch(placeDetailsUrl(placeId, params.language), {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": params.apiKey,
        "X-Goog-FieldMask": ANCHOR_DETAILS_FIELD_MASK,
        "Accept-Language": params.language,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logDestinationServerResponse({
      provider: "places_details",
      httpStatus: 0,
      googleStatus: "NETWORK_ERROR",
      resultCount: 0,
      errorMessage: message,
      requestId: detailRequestId,
      elapsedMs: Date.now() - detailStarted,
    });
    return {
      location: null,
      error: "geocode_network_error",
      usedPlaceDetails: true,
      providerResult: {
        ok: false,
        status: "NETWORK_ERROR",
        provider: "places_details",
        rawResultCount: 0,
        parsedResultCount: 0,
        failureReason: "geocode_network_error",
        placeId,
        query: params.query,
      },
    };
  }

  let detailJson: unknown = {};
  try {
    detailJson = await detailRes.json();
  } catch {
    detailJson = {};
  }

  const extracted = extractCoordinatesFromProviderResponse(detailJson);
  logDestinationServerResponse({
    provider: "places_details",
    httpStatus: detailRes.status,
    googleStatus: extracted.candidates.length ? "OK" : "ZERO_RESULTS",
    resultCount: extracted.rawResultCount || (extracted.candidates.length ? 1 : 0),
    requestId: detailRequestId,
    elapsedMs: Date.now() - detailStarted,
  });

  const normalized = normalizeDestinationProviderResponse(detailJson, {
    provider: "places_details",
    query: params.query,
    httpStatus: detailRes.status,
  });

  logDestinationProviderNormalized({
    provider: "places_details",
    coordinateField: normalized.sourceShape,
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    placeId: normalized.placeId ?? placeId,
    source: "client_places_details",
    query: params.query,
    accepted: normalized.ok,
  });

  if (normalized.ok && isValidAnchorCoordinate(normalized.latitude, normalized.longitude)) {
    const first = extracted.candidates[0];
    const location = first
      ? candidateToTripLocation({ ...first, placeId: first.placeId ?? placeId }, params.destinationName)
      : {
          placeId,
          country: normalized.country || params.destinationName,
          city: normalized.locality || params.destinationName,
          region: normalized.administrativeArea,
          lat: normalized.latitude!,
          lng: normalized.longitude!,
          formattedName: normalized.formattedAddress || params.destinationName,
          displayLabel: normalized.formattedAddress || params.destinationName,
          address: normalized.formattedAddress,
          timezone: undefined,
          utcOffsetMinutes: null,
        } satisfies TripLocation;
    return {
      location,
      error: null,
      usedPlaceDetails: true,
      providerResult: tripLocationToProviderResult(location, {
        provider: "places_autocomplete",
        query: params.query,
        httpStatus: detailRes.status,
        apiStatus: "OK",
        sourceShape: normalized.sourceShape ?? "places_details",
      }),
    };
  }

  return {
    location: null,
    error: "places_details_empty",
    usedPlaceDetails: true,
    providerResult: {
      ...normalized,
      ok: false,
      provider: "places_details",
      failureReason: "places_details_empty",
      placeId,
      query: params.query,
    },
  };
}

export type ClientGeocodeDestinationParams = {
  query: string;
  destinationName?: string;
  locale?: Locale;
  language?: Locale;
  region?: string;
  countryCode?: string;
  /** When false, geocode only (no Places Autocomplete → Details). */
  placesFallback?: boolean;
  /** Force autocomplete path without repeating geocode (Phase 2). */
  autocompleteOnly?: boolean;
  /** Remaining Place Details budget (max 1 per Destination Resolution). */
  placeDetailsBudget?: number;
};

/**
 * Resolve destination coordinates via browser Google APIs.
 * Used when Capacitor has no working serverFn, or server returned an empty envelope.
 */
export async function geocodeDestinationViaClient(
  params: ClientGeocodeDestinationParams,
): Promise<GeocodeFnEnvelope> {
  const apiKey = getGoogleMapsBrowserKey();
  if (!apiKey) {
    return {
      location: null,
      error: "geocode_api_key_missing",
      providerResult: {
        ok: false,
        status: "API_KEY_MISSING",
        provider: "geocode",
        rawResultCount: 0,
        parsedResultCount: 0,
        failureReason: "geocode_api_key_missing",
        query: params.query,
      },
    };
  }

  const locale = params.locale ?? params.language ?? "zh-TW";
  const language = localeToGoogleLanguageCode(locale);
  const region =
    params.region?.trim().toLowerCase() ||
    params.countryCode?.trim().toLowerCase() ||
    undefined;
  const destinationName = params.destinationName?.trim() || params.query;
  const allowPlaces = params.placesFallback !== false;
  const detailsBudget = params.placeDetailsBudget ?? 1;

  if (!params.autocompleteOnly) {
    const geocoded = await geocodeOnceClient({
      query: params.query,
      apiKey,
      language,
      region,
      destinationName,
    });
    if (geocoded.location && isValidAnchorCoordinate(geocoded.location.lat, geocoded.location.lng)) {
      return geocoded;
    }
    if (!allowPlaces) {
      return geocoded;
    }
  }

  if (!allowPlaces && params.autocompleteOnly) {
    return {
      location: null,
      error: "places_autocomplete_skipped",
      providerResult: {
        ok: false,
        status: "SKIPPED",
        provider: "places_autocomplete",
        rawResultCount: 0,
        parsedResultCount: 0,
        failureReason: "places_autocomplete_skipped",
        query: params.query,
      },
    };
  }

  return placesAutocompleteDetailsClient({
    query: params.query,
    apiKey,
    language,
    region,
    destinationName,
    allowDetails: detailsBudget > 0,
  });
}

export function isEmptyGeocodeEnvelope(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw !== "object" || Array.isArray(raw)) return false;
  const keys = Object.keys(raw as object);
  if (keys.length === 0) return true;
  const record = raw as Record<string, unknown>;
  const hasLocation =
    record.location != null &&
    typeof record.location === "object" &&
    !Array.isArray(record.location);
  const hasProviderResult =
    record.providerResult != null && typeof record.providerResult === "object";
  const hasError = typeof record.error === "string" && record.error.trim().length > 0;
  // Truly empty / useless envelopes from failed Capacitor serverFn RPCs.
  if (!hasLocation && !hasProviderResult && !hasError && keys.length <= 2) {
    return true;
  }
  return false;
}

export type DestinationProviderResultWithMeta = DestinationProviderResult;
