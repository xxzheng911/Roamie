import type {
  PlaceRecommendationContext,
  UserProfileForReason,
} from "@/lib/build-place-recommendation-reason";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";
import type { ExplorePlaceCard } from "@/lib/explore-category-search";
import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters, formatDistanceLabel } from "@/lib/map-explore";
import type { Locale } from "@/lib/i18n/types";
import type { WeatherSummary } from "@/lib/weather-types";
import { resolvePlaceCoverImageSync } from "@/services/placeImageService";
import { buildDiversePlaceRecommendationReasons } from "@/lib/place-reason-diversity";
import { isPlaceOperationalForRecommendation } from "@/lib/place-operational-eligibility";

export type UnifiedPlaceCard = ExplorePlaceCard & {
  categoryId?: string;
  /** 與地點身分一致的分類標籤（非探索 chip） */
  displayCategory: string;
  /** Google 照片 URL；無則由 PlaceImage 元件 async 解析 Unsplash fallback */
  coverImageUrl: string | null;
  distanceLabel?: string;
};

export type BuildUnifiedPlaceCardInput = {
  place: PlaceResult;
  reason?: string;
  categoryId?: string;
  isSavedFavorite?: boolean;
  userLocation?: { lat: number; lng: number } | null;
  distanceSource?: PlaceRecommendationContext["distanceSource"];
  weather?: WeatherSummary | null;
  userProfile?: UserProfileForReason | null;
  locale?: Locale;
  photoWidth?: number;
};

function categoryIntentFromCardCategory(categoryId?: string): string | undefined {
  if (categoryId === "coffee") return "cafe";
  if (categoryId === "food") return "restaurant";
  if (categoryId === "sight" || categoryId === "park" || categoryId === "walking") {
    return "attraction";
  }
  if (categoryId === "district") return "shopping";
  if (categoryId === "indoor" || categoryId === "rainy") return "indoor";
  if (categoryId === "night") return "bar";
  return undefined;
}

/** 同一地點的封面圖：僅 Google 照片（同步）；Unsplash fallback 由 PlaceImage 元件處理 */
export function resolvePlaceCoverImage(
  place: PlaceResult,
  options?: { categoryId?: string; photoWidth?: number },
): string | null {
  return resolvePlaceCoverImageSync(place, options);
}

export function resolvePlaceDisplayCategory(place: PlaceResult): string {
  const identity = resolvePlaceIdentity(place);
  return identityDisplayLabel(identity, place);
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
    categoryIntent: categoryIntentFromCardCategory(categoryId),
    distanceMeters: distM,
    distanceSource: distM != null ? (input.distanceSource ?? "USER_LOCATION") : undefined,
    isSavedFavorite,
  };

  const reason =
    input.reason?.trim() ||
    buildDiversePlaceRecommendationReasons(
      [{ place, context }],
      { userProfile: userProfile ?? null, weather, locale },
    )[0];

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

function unifiedCardDistanceMeters(input: BuildUnifiedPlaceCardInput): number | undefined {
  const { place, userLocation } = input;
  if (!userLocation || place.lat == null || place.lng == null) return undefined;
  return distanceMeters(userLocation, { lat: place.lat, lng: place.lng });
}

/**
 * Home / Explore batch enrichment. Applies reason diversity across the
 * given list, then reuses the per-place card builder. Order is preserved.
 */
export function buildUnifiedPlaceCards(inputs: BuildUnifiedPlaceCardInput[]): UnifiedPlaceCard[] {
  const eligibleInputs = inputs.filter((input) =>
    isPlaceOperationalForRecommendation(input.place),
  );
  if (eligibleInputs.length === 0) return [];
  const reasons = buildDiversePlaceRecommendationReasons(
    eligibleInputs.map((input) => ({
      place: input.place,
      context: {
        categoryLabel: resolvePlaceDisplayCategory(input.place),
        categoryIntent: categoryIntentFromCardCategory(input.categoryId),
        distanceMeters: unifiedCardDistanceMeters(input),
        distanceSource:
          unifiedCardDistanceMeters(input) != null
            ? (input.distanceSource ?? "USER_LOCATION")
            : undefined,
        isSavedFavorite: input.isSavedFavorite,
      },
    })),
    {
      userProfile: eligibleInputs[0]?.userProfile,
      weather: eligibleInputs[0]?.weather,
      locale: eligibleInputs[0]?.locale,
    },
  );
  return eligibleInputs.map((input, index) =>
    buildUnifiedPlaceCard({
      ...input,
      reason: input.reason?.trim() || reasons[index],
    }),
  );
}
