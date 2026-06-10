import type { HomeNearbyPick } from "@/lib/explore-category-search";
import {
  isRecommendablePlace,
  placeResultToRecommendableInput,
} from "@/lib/is-recommendable-place";

/** 首頁只接受真實 Google place_id，排除 mock / saved 假 id */
export function isVerifiedGooglePlaceId(id: string | null | undefined): boolean {
  const value = (id ?? "").trim();
  if (!value || value === "Unknown") return false;
  if (value.startsWith("mock-") || value.startsWith("saved-")) return false;
  return true;
}

export function isHomeNearbyDisplayPlace(
  place: Pick<
    HomeNearbyPick,
    | "id"
    | "name"
    | "businessStatus"
    | "openStatus"
    | "rating"
    | "userRatingCount"
    | "primaryType"
    | "types"
  > & { categoryId?: string; isSavedFavorite?: boolean },
  options?: { logDrop?: boolean },
): boolean {
  if (!isVerifiedGooglePlaceId(place.id)) {
    if (options?.logDrop !== false) {
      console.info("[HOME_NEARBY_DISPLAY_DROP]", {
        name: place.name,
        placeId: place.id,
        dropReason: "invalid_place_id",
      });
    }
    return false;
  }

  const input = placeResultToRecommendableInput(
    {
      id: place.id,
      name: place.name,
      businessStatus: place.businessStatus,
      openStatus: place.openStatus ?? "unknown",
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      primaryType: place.primaryType,
      types: place.types,
    },
    { categoryId: place.categoryId, isSavedFavorite: false },
  );

  return isRecommendablePlace(input, "home_nearby", options).ok;
}

/** 過濾 session / cache 中不合格或 mock 的首頁卡片 */
export function sanitizeHomeNearbyPicksForDisplay(
  picks: HomeNearbyPick[],
  options?: { logDrop?: boolean },
): HomeNearbyPick[] {
  return picks.filter((p) => isHomeNearbyDisplayPlace(p, options));
}
