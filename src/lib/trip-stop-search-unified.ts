import {
  searchTripStops,
  resolveTripStop,
  type TripStopSuggestion,
  type ResolvedTripStop,
} from "@/lib/trip-stop-search.functions";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import { placesAutocompleteUrl } from "@/lib/google-maps-api";
import type { Locale } from "@/lib/i18n/types";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";

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
    if (result.error) return { suggestions: [], error: result.error };
  } catch (e) {
    console.warn("[TripStop] server search failed", e);
  }

  const key = getGoogleMapsBrowserKey();
  if (!key) {
    return {
      suggestions: [],
      error: "無法搜尋地點，請確認已設定 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY。",
    };
  }

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
      return { suggestions: [], error: text.slice(0, 180) || "autocomplete_failed" };
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
    return { suggestions, error: suggestions.length ? null : null };
  } catch (e) {
    console.warn("[TripStop] browser autocomplete failed", e);
    return { suggestions: [], error: "autocomplete_failed" };
  }
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
  try {
    const result = await resolveFn({ data: { placeId: normalizedPlaceId, locale } });
    if (result.stop) {
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

  if (fallback) {
    return {
      place: {
        name: fallback.label,
        placeName: fallback.label,
        title: fallback.label,
        address: fallback.secondary ?? fallback.label,
        lat: null,
        lng: null,
        googlePlaceId: normalizeGooglePlaceId(fallback.placeId),
      },
      error: null,
    };
  }

  const key = getGoogleMapsBrowserKey();
  void key;

  return { place: null, error: "無法解析地點" };
}

// Re-export for tree-shaking
export { searchTripStops, resolveTripStop };
