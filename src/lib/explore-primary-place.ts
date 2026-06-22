import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { TripStopSuggestion } from "@/lib/trip-stop-search.functions";
import { fetchPlaceDetailsForScreenWithKey, type PlaceDetailsScreenResult } from "@/lib/places.functions";
import { getGoogleMapsBrowserKey, buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { buildUnifiedPlaceCard } from "@/lib/unified-place-card";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import type { WeatherSummary } from "@/lib/weather-types";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";
import {
  isPinnableSearchSelection,
  normalizeExplorePlaceId,
} from "@/lib/explore-selected-place";
import { resolveExploreMapSuggestion, type ExploreMapSearchCard } from "@/lib/explore-map-search";

export type ExplorePrimaryPlaceCard = ExploreMapSearchCard & {
  isPrimaryExplorePlace: true;
};

type ResolveFn = (args: {
  data: { placeId: string; locale?: Locale };
}) => Promise<{
  stop: { lat: number | null; lng: number | null; name?: string; address?: string } | null;
  error: string | null;
}>;

type FetchPlaceDetailsFn = (args: {
  data: { placeId: string; locale?: Locale };
}) => Promise<{ place: PlaceDetailsScreenResult | null; error: string | null }>;

import { shouldLogExploreEvent } from "@/lib/explore-request-guard";

/** Xcode / Safari Web Inspector 較容易看到 console.log */
function exploreLog(line: string): void {
  console.log(line);
}

export function logExplorePrimaryPlace(name: string, placeId: string): void {
  exploreLog(`[EXPLORE_PRIMARY_PLACE] name=${name} placeId=${placeId}`);
}

export function logExplorePrimaryPlacePinned(name: string, index = 0): void {
  exploreLog(`[EXPLORE_PRIMARY_PLACE_PINNED] name=${name} index=${index}`);
}

export function logExploreFinalRecommendations(
  names: readonly string[],
  categoryId = "all",
  locationKey = "",
): void {
  const key = `final:${locationKey}:${categoryId}:${names.length}`;
  if (!shouldLogExploreEvent(key)) return;
  const parts = names.slice(0, 10).map((name, i) => `${i + 1}=${name}`);
  exploreLog(`[EXPLORE_FINAL_RECOMMENDATIONS] ${parts.join(" ")}`);
}

export function stripPrimaryFromNearby<T extends { id: string }>(
  primary: T | null | undefined,
  nearby: T[],
): T[] {
  if (!primary) return nearby;
  const pinKey = normalizeExplorePlaceId(primary.id);
  return nearby.filter((item) => normalizeExplorePlaceId(item.id) !== pinKey);
}

/** Step 7：主目標永遠 index 0，附近推薦排後面 */
export function mergeExploreRecommendations<T extends { id: string }>(
  primary: T | null | undefined,
  nearby: T[],
): T[] {
  if (!primary) return nearby;
  const rest = stripPrimaryFromNearby(primary, nearby);
  return [primary, ...rest];
}

function mapDetailsToPrimaryCard(
  place: PlaceDetailsScreenResult | PlaceResult,
  opts: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    reasonProfile: UserProfileForReason | null;
    locale: Locale;
    displayName: string;
    placeId: string;
  },
): ExplorePrimaryPlaceCard | null {
  if (place.lat == null || place.lng == null) return null;
  const origin = { lat: place.lat, lng: place.lng };
  const card = buildUnifiedPlaceCard({
    place,
    categoryId: "all",
    userLocation: origin,
    weather: opts.weather,
    userProfile: opts.reasonProfile,
    locale: opts.locale,
  });
  const item = mapPlaceResultToChatItem(place, {
    weather: opts.weather,
    userProfile: opts.reasonProfile,
    locale: opts.locale,
  });
  return {
    ...card,
    id: opts.placeId,
    name: opts.displayName,
    googleMapsUrl: item.googleMapsUrl,
    displayCategory: identityDisplayLabel(resolvePlaceIdentity(place), place),
    coverImageUrl: place.photoName ? (buildPlacePhotoUrl(place.photoName, 600) ?? undefined) : undefined,
    isPrimaryExplorePlace: true,
    isSelectedExplorePin: true,
  };
}

/**
 * Step 3–4：以 autocomplete 的 placeId 拉 Place Details，建立主目標卡片。
 * 顯示名稱以使用者選取的 label 為準（不被園區內子 POI 名稱覆蓋）。
 */
export async function resolveExplorePrimaryPlace(
  suggestion: TripStopSuggestion,
  options: {
    locale: Locale;
    resolveFn: ResolveFn;
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    reasonProfile: UserProfileForReason | null;
    fetchPlaceDetailsFn?: FetchPlaceDetailsFn;
  },
): Promise<ExplorePrimaryPlaceCard | null> {
  const placeId = normalizeExplorePlaceId(suggestion.placeId ?? "");
  const displayName = suggestion.label?.trim() || "";
  if (!placeId || !displayName) return null;

  if (
    !isPinnableSearchSelection({
      label: displayName,
      types: suggestion.types,
      placeId,
    })
  ) {
    return null;
  }

  let details: PlaceDetailsScreenResult | PlaceResult | null = null;

  const browserKey = getGoogleMapsBrowserKey();
  if (browserKey) {
    details = await fetchPlaceDetailsForScreenWithKey(placeId, browserKey, options.locale);
  }
  if (!details && options.fetchPlaceDetailsFn) {
    const result = await options.fetchPlaceDetailsFn({
      data: { placeId, locale: options.locale },
    });
    details = result.place;
  }

  if (details?.lat != null && details.lng != null) {
    const card = mapDetailsToPrimaryCard(details, {
      ...options,
      displayName,
      placeId,
    });
    if (card) {
      return card;
    }
  }

  const { card } = await resolveExploreMapSuggestion(suggestion, options);
  if (!card?.lat || !card.lng) return null;

  return {
    ...card,
    id: placeId,
    name: displayName,
    isPrimaryExplorePlace: true,
    isSelectedExplorePin: true,
    coverImageUrl:
      card.coverImageUrl ??
      (card.photoName ? (buildPlacePhotoUrl(card.photoName, 600) ?? undefined) : undefined),
  };
}

/** Step 2：從搜尋文字挑最符合的主目標 suggestion */
export function pickPrimarySuggestion(
  query: string,
  suggestions: TripStopSuggestion[],
): TripStopSuggestion | null {
  const trimmed = query.trim();
  if (!trimmed || suggestions.length === 0) return null;
  const exact = suggestions.find((s) => s.label.trim() === trimmed);
  if (exact) return exact;
  const contains = suggestions.find((s) => s.label.includes(trimmed) || trimmed.includes(s.label.trim()));
  return contains ?? suggestions[0] ?? null;
}
