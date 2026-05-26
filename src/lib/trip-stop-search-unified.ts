import { searchTripStops, resolveTripStop, type TripStopSuggestion, type ResolvedTripStop } from "@/lib/trip-stop-search.functions";
import { executeExploreSearch } from "@/lib/places.functions";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import type { Locale } from "@/lib/i18n/types";
import { tripPlaceFromPlaceResult } from "@/lib/trip/trip-place-input";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";

const DEFAULT_CENTER = { lat: 25.033, lng: 121.5654 };

export async function unifiedSearchTripStops(
  searchFn: (args: {
    data: { query: string; locale?: Locale; lat?: number; lng?: number };
  }) => Promise<{ suggestions: TripStopSuggestion[]; error: string | null }>,
  query: string,
  locale: Locale,
  center?: { lat: number; lng: number },
): Promise<{ suggestions: TripStopSuggestion[]; error: string | null }> {
  const c = center ?? DEFAULT_CENTER;
  try {
    const result = await searchFn({ data: { query, locale, lat: c.lat, lng: c.lng } });
    if (result.suggestions.length > 0) return result;
    if (result.error) console.warn("[TripStop] server search", result.error);
  } catch (e) {
    console.warn("[TripStop] server search failed", e);
  }

  const key = getGoogleMapsBrowserKey();
  if (!key) {
    return { suggestions: [], error: "無法搜尋地點，請確認已設定 VITE_GOOGLE_MAPS_API_KEY。" };
  }

  const { places, error } = await executeExploreSearch(
    { query: query.trim(), lat: c.lat, lng: c.lng, mode: "text", locale },
    { apiKey: key },
  );

  const suggestions: TripStopSuggestion[] = places.slice(0, 15).map((p) => ({
    placeId: p.id,
    label: p.name,
    secondary: p.address ?? undefined,
    types: p.types ?? undefined,
  }));

  return { suggestions, error: suggestions.length ? null : error };
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
  try {
    const result = await resolveFn({ data: { placeId, locale } });
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
        address: fallback.secondary ?? "",
        lat: null,
        lng: null,
        googlePlaceId: fallback.placeId,
      },
      error: null,
    };
  }

  const key = getGoogleMapsBrowserKey();
  if (key) {
    const { places } = await executeExploreSearch(
      { query: placeId, lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng, mode: "text", locale },
      { apiKey: key },
    );
    const hit = places.find((p) => p.id === placeId) ?? places[0];
    if (hit) return { place: tripPlaceFromPlaceResult(hit), error: null };
  }

  return { place: null, error: "無法解析地點" };
}

// Re-export for tree-shaking
export { searchTripStops, resolveTripStop };
