import {
  applyAvailabilityFields,
  derivePlaceAvailability,
  type PlaceHoursData,
} from "@/lib/filter-available-places";
import { placesAutocompleteUrl, placeDetailsUrl, PLACE_DETAILS_SCREEN_FIELD_MASK } from "@/lib/google-maps-api";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import type { Locale } from "@/lib/i18n/types";
import { PLACES_REGION } from "@/lib/places-search-config";
import type { PlaceResult } from "@/lib/place-result";
import {
  logExploreSearchRequest,
  logExploreSearchResponse,
  logExploreSearchResponseBody,
} from "@/lib/explore-places-search-diagnostics";

const AUTOCOMPLETE_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types";

function normalizeGooglePlaceId(raw: string): string {
  return raw.replace(/^places\//, "").trim();
}

function parseGoogleError(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string; status?: string } };
    if (j.error?.message) return `${j.error.status ?? "ERROR"}: ${j.error.message}`;
  } catch {
    /* ignore */
  }
  return text.slice(0, 300);
}

async function fetchAutocompleteSuggestions(
  apiKey: string,
  query: string,
  lat: number,
  lng: number,
  locale: Locale,
): Promise<Array<{ placeId: string; label: string; secondary?: string; types?: string[] }>> {
  const body: Record<string, unknown> = {
    input: query.trim(),
    languageCode: localeToGoogleLanguageCode(locale),
    regionCode: PLACES_REGION,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 50_000,
      },
    },
  };

  const res = await fetch(placesAutocompleteUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": AUTOCOMPLETE_MASK,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.info("[EXPLORE_SEARCH_AUTOCOMPLETE_FAIL]", {
      status: res.status,
      error: parseGoogleError(text),
    });
    logExploreSearchResponseBody(text);
    return [];
  }

  let json: {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        place?: string;
        text?: { text?: string };
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
        types?: string[];
      };
    }>;
  };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    logExploreSearchResponseBody(text);
    return [];
  }

  const out: Array<{ placeId: string; label: string; secondary?: string; types?: string[] }> =
    [];
  const seen = new Set<string>();
  for (const s of json.suggestions ?? []) {
    const pred = s.placePrediction;
    const placeId = normalizeGooglePlaceId(
      pred?.placeId ?? (pred?.place ? pred.place.replace(/^places\//, "") : ""),
    );
    if (!placeId || seen.has(placeId)) continue;
    seen.add(placeId);
    const label =
      pred?.structuredFormat?.mainText?.text?.trim() || pred?.text?.text?.trim() || "";
    if (!label) continue;
    out.push({
      placeId,
      label,
      secondary: pred?.structuredFormat?.secondaryText?.text?.trim(),
      types: pred?.types,
    });
    if (out.length >= 12) break;
  }
  return out;
}

async function resolvePlaceDetails(
  apiKey: string,
  placeId: string,
  locale: Locale,
): Promise<PlaceResult | null> {
  const normalized = normalizeGooglePlaceId(placeId);
  const res = await fetch(placeDetailsUrl(normalized), {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACE_DETAILS_SCREEN_FIELD_MASK,
      "Accept-Language": localeToGoogleLanguageCode(locale),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.info("[EXPLORE_SEARCH_DETAILS_FAIL]", {
      placeId: normalized,
      status: res.status,
      error: parseGoogleError(text),
    });
    return null;
  }

  let raw: PlaceHoursData & {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    primaryType?: string;
    types?: string[];
    rating?: number;
    userRatingCount?: number;
    photos?: Array<{ name: string }>;
  };
  try {
    raw = JSON.parse(text) as typeof raw;
  } catch {
    return null;
  }

  const name = raw.displayName?.text?.trim() || "地點";
  const lat = raw.location?.latitude ?? null;
  const lng = raw.location?.longitude ?? null;
  if (lat == null || lng == null) return null;

  const availability = derivePlaceAvailability(
    {
      businessStatus: raw.businessStatus,
      currentOpeningHours: raw.currentOpeningHours ?? null,
      regularOpeningHours: raw.regularOpeningHours ?? null,
      utcOffsetMinutes: raw.utcOffsetMinutes,
    },
    { context: "lenient" },
  );
  const fields = applyAvailabilityFields({}, availability);

  return {
    id: normalizeGooglePlaceId(raw.id ?? normalized),
    name,
    address: raw.formattedAddress ?? null,
    lat,
    lng,
    rating: raw.rating ?? null,
    userRatingCount: raw.userRatingCount ?? null,
    photoName: raw.photos?.[0]?.name ?? null,
    primaryType: raw.primaryType ?? null,
    types: raw.types ?? null,
    businessStatus: raw.businessStatus ?? null,
    openStatus: availability.openStatus,
    openStatusLabel: fields.openStatusLabel,
    todayHoursLabel: fields.todayHoursLabel,
    closesAtLabel: fields.closesAtLabel,
    closingSoonNote: fields.closingSoonNote,
    nextOpenHint: fields.nextOpenHint,
  };
}

/**
 * Text Search 無結果時，改走 Places Autocomplete + Details（與行程手動搜尋相同路徑）。
 */
export async function exploreMapTextSearchViaAutocomplete(
  apiKey: string,
  params: {
    rawQuery: string;
    finalQuery: string;
    lat: number;
    lng: number;
    radius: number;
    locale: Locale;
  },
): Promise<{ places: PlaceResult[]; error: string | null }> {
  logExploreSearchRequest({
    query: params.finalQuery,
    rawQuery: params.rawQuery,
    finalQuery: params.finalQuery,
    lat: params.lat,
    lng: params.lng,
    radius: params.radius,
    endpoint: placesAutocompleteUrl(),
    transport: "autocomplete_fallback",
    mode: "text",
    exploreMapTextSearch: true,
    locationBias: true,
  });

  const suggestions = await fetchAutocompleteSuggestions(
    apiKey,
    params.finalQuery,
    params.lat,
    params.lng,
    params.locale,
  );

  if (suggestions.length === 0) {
    logExploreSearchResponse({
      status: "autocomplete_empty",
      resultCount: 0,
      firstPlaceName: null,
      transport: "autocomplete_fallback",
    });
    return { places: [], error: null };
  }

  const places: PlaceResult[] = [];
  for (const s of suggestions.slice(0, 10)) {
    const place = await resolvePlaceDetails(apiKey, s.placeId, params.locale);
    if (place) places.push(place);
  }

  logExploreSearchResponse({
    status: places.length > 0 ? "ok" : "details_empty",
    resultCount: places.length,
    firstPlaceName: places[0]?.name ?? null,
    transport: "autocomplete_fallback",
  });
  if (places.length === 0) {
    logExploreSearchResponseBody({ suggestionsCount: suggestions.length });
  }

  return { places, error: null };
}
