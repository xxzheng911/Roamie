import {
  buildPlaceRecommendationReason,
  type PlaceRecommendationContext,
  type UserProfileForReason,
} from "@/lib/build-place-recommendation-reason";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";
import type { ExplorePlaceCard } from "@/lib/explore-category-search";
import { pickPlaceSceneFallback } from "@/lib/place-scene-fallback";
import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters, formatDistanceLabel } from "@/lib/map-explore";
import type { Locale } from "@/lib/i18n/types";
import type { WeatherSummary } from "@/lib/weather-types";

export type UnifiedPlaceCard = ExplorePlaceCard & {
  categoryId?: string;
  /** 與地點身分一致的分類標籤（非探索 chip） */
  displayCategory: string;
  coverImageUrl: string;
  distanceLabel?: string;
};

export type BuildUnifiedPlaceCardInput = {
  place: PlaceResult;
  reason?: string;
  categoryId?: string;
  isSavedFavorite?: boolean;
  userLocation?: { lat: number; lng: number } | null;
  weather?: WeatherSummary | null;
  userProfile?: UserProfileForReason | null;
  locale?: Locale;
  photoWidth?: number;
};

/** 同一地點的封面圖：Google 照片優先，否則依名稱＋分類選 Roamie 情境圖 */
export function resolvePlaceCoverImage(
  place: PlaceResult,
  options?: { categoryId?: string; photoWidth?: number },
): string {
  const width = options?.photoWidth ?? 600;
  const fromGoogle = place.photoName ? buildPlacePhotoUrl(place.photoName, width) : null;
  if (fromGoogle) return fromGoogle;
  return pickPlaceSceneFallback(place.name, {
    primaryType: place.primaryType,
    types: place.types,
    categoryId: options?.categoryId,
  });
}

export function resolvePlaceDisplayCategory(place: PlaceResult): string {
  return identityDisplayLabel(resolvePlaceIdentity(place));
}

export function resolvePlaceDistanceLabel(
  place: PlaceResult,
  userLocation?: { lat: number; lng: number } | null,
): string | undefined {
  if (!userLocation || place.lat == null || place.lng == null) return undefined;
  const m = distanceMeters(userLocation, { lat: place.lat, lng: place.lng });
  return formatDistanceLabel(m);
}

/** 探索／首頁／地圖共用：單一地點 enrichment（理由、圖片、分類、距離） */
export function buildUnifiedPlaceCard(input: BuildUnifiedPlaceCardInput): UnifiedPlaceCard {
  const {
    place,
    categoryId,
    isSavedFavorite,
    userLocation,
    weather,
    userProfile,
    locale,
    photoWidth,
  } = input;

  const distM =
    userLocation && place.lat != null && place.lng != null
      ? distanceMeters(userLocation, { lat: place.lat, lng: place.lng })
      : undefined;

  const context: PlaceRecommendationContext = {
    categoryLabel: resolvePlaceDisplayCategory(place),
    distanceMeters: distM,
    isSavedFavorite,
  };

  const reason =
    input.reason?.trim() ||
    buildPlaceRecommendationReason(place, userProfile ?? null, weather, undefined, context, locale);

  const displayCategory = resolvePlaceDisplayCategory(place);
  const coverImageUrl = resolvePlaceCoverImage(place, { categoryId, photoWidth });
  const distanceLabel = resolvePlaceDistanceLabel(place, userLocation);

  return {
    ...place,
    reason,
    isSavedFavorite,
    categoryId,
    displayCategory,
    coverImageUrl,
    distanceLabel,
  };
}
