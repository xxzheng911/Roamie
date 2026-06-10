import type { PlaceOpenStatus } from "@/lib/filter-available-places";
import {
  isRecommendablePlace,
  placeResultToRecommendableInput,
  type RecommendablePlaceContext,
} from "@/lib/is-recommendable-place";
import { isVerifiedGooglePlaceId } from "@/lib/home-nearby-display";
import { distanceMeters } from "@/lib/map-explore";
import type { PlaceResult } from "@/lib/place-result";
import { HOME_NEARBY_MAX_DISTANCE_M } from "@/lib/search-radius";

export type HomeNearbyFilterPlace = Pick<
  PlaceResult,
  | "id"
  | "name"
  | "businessStatus"
  | "openStatus"
  | "rating"
  | "userRatingCount"
  | "photoName"
  | "primaryType"
  | "types"
  | "lat"
  | "lng"
  | "openStatusLabel"
> & {
  isSavedFavorite?: boolean;
  categoryId?: string;
};

const HOME_NEARBY_MIN_RATING = 4.0;

function isOpenNowPlace(place: HomeNearbyFilterPlace): boolean {
  return place.openStatus === "open" || place.openStatus === "closing_soon";
}

function isUnknownOpenPlace(place: HomeNearbyFilterPlace): boolean {
  return place.openStatus === "unknown" || place.openStatus == null;
}

function withinHomeNearbyDistance(
  place: HomeNearbyFilterPlace,
  origin?: { lat: number; lng: number },
  maxM = HOME_NEARBY_MAX_DISTANCE_M,
): boolean {
  if (!origin) return true;
  if (place.lat == null || place.lng == null) return false;
  return distanceMeters(origin, { lat: place.lat, lng: place.lng }) <= maxM;
}

function passesHomeNearbyTier<T extends HomeNearbyFilterPlace>(
  place: T,
  options: {
    categoryId?: string;
    context: RecommendablePlaceContext;
    homeOpenTier?: "open_confirmed" | "unknown_fallback";
    logDrop?: boolean;
  },
): boolean {
  if (options.context === "home_nearby" && !isVerifiedGooglePlaceId(place.id)) {
    return false;
  }
  const input = placeResultToRecommendableInput(place, {
    categoryId: options.categoryId,
    isSavedFavorite: false,
  });
  return isRecommendablePlace(input, options.context, {
    logDrop: options.logDrop,
    homeOpenTier: options.homeOpenTier,
  }).ok;
}

function logFilterSummary(
  _summary: {
    caller?: string;
    categoryId?: string;
    inputCount: number;
    droppedCount: number;
    outputCount: number;
    openNowCount: number;
    unknownOpenCount: number;
  },
  enabled?: boolean,
): void {
  if (!enabled) return;
  console.info("[PLACES_FILTER_SUMMARY]", _summary);
}

/**
 * 首頁附近地點：只推薦有 placeId、OPERATIONAL、營業中（openNow）的真實店家。
 * 若無營業中選項，才 fallback 到 open 狀態 unknown 且仍符合評分／類型門檻的地點。
 */
export function filterHomeNearbyPlaceResults<T extends HomeNearbyFilterPlace>(
  places: T[],
  options?: {
    categoryId?: string;
    minResults?: number;
    caller?: string;
    origin?: { lat: number; lng: number };
    maxDistanceM?: number;
    context?: RecommendablePlaceContext;
    logDrop?: boolean;
    logSummary?: boolean;
  },
): T[] {
  const categoryId = options?.categoryId;
  const context = options?.context ?? "home_nearby";
  const logDrop = options?.logDrop ?? true;
  const inputCount = places.length;
  const maxDistanceM = options?.maxDistanceM ?? HOME_NEARBY_MAX_DISTANCE_M;

  if (inputCount === 0) {
    logFilterSummary(
      {
        caller: options?.caller,
        categoryId,
        inputCount: 0,
        droppedCount: 0,
        outputCount: 0,
        openNowCount: 0,
        unknownOpenCount: 0,
      },
      options?.logSummary,
    );
    return [];
  }

  const tierOpts = { categoryId, context, logDrop };

  if (context !== "home_nearby") {
    const candidates: T[] = [];
    for (const place of places) {
      if (!passesHomeNearbyTier(place, tierOpts)) continue;
      if (!withinHomeNearbyDistance(place, options?.origin, maxDistanceM)) continue;
      candidates.push(place);
    }
    const openNow = candidates.filter(isOpenNowPlace);
    const unknownOpen = candidates.filter(isUnknownOpenPlace);
    const chosen = openNow.length > 0 ? openNow : unknownOpen;
    logFilterSummary(
      {
        caller: options?.caller,
        categoryId,
        inputCount,
        droppedCount: inputCount - chosen.length,
        outputCount: chosen.length,
        openNowCount: openNow.length,
        unknownOpenCount: unknownOpen.length,
      },
      options?.logSummary,
    );
    return chosen;
  }

  const openConfirmed: T[] = [];
  for (const place of places) {
    if (
      !passesHomeNearbyTier(place, { ...tierOpts, homeOpenTier: "open_confirmed" }) ||
      !isOpenNowPlace(place)
    ) {
      continue;
    }
    if (!withinHomeNearbyDistance(place, options?.origin, maxDistanceM)) continue;
    openConfirmed.push(place);
  }

  if (openConfirmed.length > 0) {
    logFilterSummary(
      {
        caller: options?.caller,
        categoryId,
        inputCount,
        droppedCount: inputCount - openConfirmed.length,
        outputCount: openConfirmed.length,
        openNowCount: openConfirmed.length,
        unknownOpenCount: 0,
      },
      options?.logSummary,
    );
    return openConfirmed;
  }

  const unknownFallback: T[] = [];
  for (const place of places) {
    if (
      !passesHomeNearbyTier(place, { ...tierOpts, homeOpenTier: "unknown_fallback" }) ||
      !isUnknownOpenPlace(place)
    ) {
      continue;
    }
    if (!withinHomeNearbyDistance(place, options?.origin, maxDistanceM)) continue;
    unknownFallback.push(place);
  }

  logFilterSummary(
    {
      caller: options?.caller,
      categoryId,
      inputCount,
      droppedCount: inputCount - unknownFallback.length,
      outputCount: unknownFallback.length,
      openNowCount: 0,
      unknownOpenCount: unknownFallback.length,
    },
    options?.logSummary,
  );

  return unknownFallback;
}

function openStatusSortRank(openStatus?: PlaceOpenStatus): number {
  if (openStatus === "open" || openStatus === "closing_soon") return 0;
  if (openStatus === "unknown") return 1;
  return 2;
}

function ratingSortRank(rating: number | null | undefined): number {
  return (rating ?? 0) >= HOME_NEARBY_MIN_RATING ? 0 : 1;
}

/** 首頁附近地點排序：營業中 → 高評分 → 評論數 → 距離 */
export function sortHomeNearbyPlaces<T extends HomeNearbyFilterPlace>(
  places: T[],
  origin: { lat: number; lng: number },
): T[] {
  return [...places].sort((a, b) => {
    const openA = openStatusSortRank(a.openStatus);
    const openB = openStatusSortRank(b.openStatus);
    if (openA !== openB) return openA - openB;

    const ratingTierA = ratingSortRank(a.rating);
    const ratingTierB = ratingSortRank(b.rating);
    if (ratingTierA !== ratingTierB) return ratingTierA - ratingTierB;

    const ratingA = a.rating ?? 0;
    const ratingB = b.rating ?? 0;
    if (ratingA !== ratingB) return ratingB - ratingA;

    const countA = a.userRatingCount ?? 0;
    const countB = b.userRatingCount ?? 0;
    if (countA !== countB) return countB - countA;

    const distA =
      a.lat != null && a.lng != null
        ? distanceMeters(origin, { lat: a.lat, lng: a.lng })
        : Number.POSITIVE_INFINITY;
    const distB =
      b.lat != null && b.lng != null
        ? distanceMeters(origin, { lat: b.lat, lng: b.lng })
        : Number.POSITIVE_INFINITY;
    if (distA !== distB) return distA - distB;

    const photoA = a.photoName ? 1 : 0;
    const photoB = b.photoName ? 1 : 0;
    if (photoA !== photoB) return photoB - photoA;

    return 0;
  });
}
