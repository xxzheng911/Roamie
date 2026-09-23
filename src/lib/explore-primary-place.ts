import { devVerboseInfo } from "@/lib/dev-verbose-log";
import type { PlacesRequestOwner } from "@/lib/places-api-guard";
import { runPlacesApiDeduped } from "@/lib/places-api-guard";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { TripStopSuggestion } from "@/lib/trip-stop-search.functions";
import type { PlaceDetailsScreenResult } from "@/lib/places.functions";
import { fetchPlaceDetailsForScreenWithKeyViaGateway } from "@/lib/pie/places-gateway";
import { getGoogleMapsBrowserKey, buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { preferJpegPngImageUrl } from "@/lib/safe-image-url";
import { buildUnifiedPlaceCard } from "@/lib/unified-place-card";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import type { WeatherSummary } from "@/lib/weather-types";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";
import { isPinnableSearchSelection, normalizeExplorePlaceId } from "@/lib/explore-selected-place";
import { resolveExploreMapSuggestion, type ExploreMapSearchCard } from "@/lib/explore-map-search";
import {
  logRecommendationDistanceEvidence,
  resolveRecommendationDistanceEvidence,
} from "@/lib/recommendation-distance-evidence";

export type ExplorePrimaryPlaceCard = ExploreMapSearchCard & {
  isPrimaryExplorePlace: true;
};

type ResolveFn = (args: { data: { placeId: string; locale?: Locale } }) => Promise<{
  stop: { lat: number | null; lng: number | null; name?: string; address?: string } | null;
  error: string | null;
}>;

type FetchPlaceDetailsFn = (args: {
  data: { placeId: string; locale?: Locale };
}) => Promise<{ place: PlaceDetailsScreenResult | null; error: string | null }>;

import { shouldLogExploreEvent } from "@/lib/explore-request-guard";

/** Optional structured Explore diagnostics. */
function exploreLog(line: string): void {
  devVerboseInfo(line);
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
    userLocation: { lat: number; lng: number } | null;
    weather: WeatherSummary | null;
    reasonProfile: UserProfileForReason | null;
    locale: Locale;
    displayName: string;
    placeId: string;
  },
): ExplorePrimaryPlaceCard | null {
  if (place.lat == null || place.lng == null) return null;
  const evidence = resolveRecommendationDistanceEvidence(place, opts.userLocation);
  logRecommendationDistanceEvidence({
    canonicalPlaceId: opts.placeId,
    evidence,
    surface: "explore_primary",
  });
  const card = buildUnifiedPlaceCard({
    place,
    categoryId: "all",
    userLocation: opts.userLocation,
    distanceSource: opts.userLocation ? "USER_LOCATION" : undefined,
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
    coverImageUrl: place.photoName
      ? (preferJpegPngImageUrl(buildPlacePhotoUrl(place.photoName, 600) ?? null) ?? undefined)
      : undefined,
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
    userLocation: { lat: number; lng: number } | null;
    weather: WeatherSummary | null;
    reasonProfile: UserProfileForReason | null;
    fetchPlaceDetailsFn?: FetchPlaceDetailsFn;
    requestOwner?: PlacesRequestOwner;
  },
): Promise<ExplorePrimaryPlaceCard | null> {
  const placeId = normalizeExplorePlaceId(suggestion.placeId ?? "");
  const displayName = suggestion.label?.trim() || "";
  if (!placeId || !displayName) return null;

  if (
    !options.requestOwner &&
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
    details = await fetchPlaceDetailsForScreenWithKeyViaGateway(
      placeId,
      browserKey,
      options.locale,
      undefined,
      { requestOwner: options.requestOwner, requestPath: "capacitor_client" },
    );
  }
  if (options.requestOwner?.exploreSession?.controller.signal.aborted) return null;
  if (!details && options.fetchPlaceDetailsFn && (!browserKey || !options.requestOwner)) {
    const fetchDetails = () =>
      options.fetchPlaceDetailsFn!({ data: { placeId, locale: options.locale } });
    const result = options.requestOwner
      ? await runPlacesApiDeduped(
          `explore-details:${placeId}:${options.locale}`,
          "details",
          fetchDetails,
          options.requestOwner,
        )
      : await fetchDetails();
    details = result?.place ?? null;
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

  if (options.requestOwner) return null; // No unowned fallback after a blocked/aborted request.
  const { card } = await resolveExploreMapSuggestion(suggestion, options);
  if (card?.lat == null || card.lng == null) return null;

  return {
    ...card,
    id: placeId,
    name: displayName,
    isPrimaryExplorePlace: true,
    isSelectedExplorePin: true,
    coverImageUrl:
      preferJpegPngImageUrl(card.coverImageUrl ?? null) ??
      (card.photoName
        ? (preferJpegPngImageUrl(buildPlacePhotoUrl(card.photoName, 600) ?? null) ?? undefined)
        : undefined),
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
  const contains = suggestions.find(
    (s) => s.label.includes(trimmed) || trimmed.includes(s.label.trim()),
  );
  return contains ?? suggestions[0] ?? null;
}
