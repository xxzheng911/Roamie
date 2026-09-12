import {
  passesHomeNearbyHardExclusions,
  type HomeNearbyPickPlace,
} from "@/lib/home-nearby-eligibility";
import type { HomeNearbyPick } from "@/lib/home-nearby-search";
import { mergePlaceRuntimeCache } from "@/lib/place-runtime-cache";
import { placeOpeningStatusLabel } from "@/lib/normalized-opening-status";
import type { Locale } from "@/lib/i18n/types";

export { isVerifiedGooglePlaceId } from "@/lib/home-nearby-eligibility";

/** Home only shows an opening badge when current hours evidence is explicit. */
export function homeNearbyOpeningBadgeLabel(
  place: Pick<
    HomeNearbyPick,
    | "openNow"
    | "normalizedOpeningStatus"
    | "normalizedOpeningLabel"
    | "openStatus"
    | "openStatusLabel"
  >,
  locale: Locale,
): string {
  const reliable =
    place.openNow === true ||
    place.openNow === false ||
    place.normalizedOpeningStatus === "open" ||
    place.normalizedOpeningStatus === "closed";
  return reliable ? placeOpeningStatusLabel(place, locale) : "";
}

/** 首頁顯示：永久排除（允許 unknown open / 無評分 / 無照片） */
export function isHomeNearbyDisplayPlace(
  place: Pick<
    HomeNearbyPick,
    | "id"
    | "name"
    | "businessStatus"
    | "rating"
    | "userRatingCount"
    | "openStatus"
    | "primaryType"
    | "types"
  >,
  options?: { logDrop?: boolean },
): boolean {
  if (!passesHomeNearbyHardExclusions(place as HomeNearbyPickPlace)) {
    if (options?.logDrop !== false) {
      console.info("[HOME_NEARBY_DISPLAY_DROP]", {
        name: place.name,
        placeId: place.id,
        dropReason: "home_nearby_rules",
      });
    }
    return false;
  }
  return true;
}

/** 過濾 session / cache 中不合格或 mock 的首頁卡片 */
export function sanitizeHomeNearbyPicksForDisplay(
  picks: HomeNearbyPick[],
  options?: { logDrop?: boolean },
): HomeNearbyPick[] {
  return picks
    .map((place) => mergePlaceRuntimeCache(place.id, place))
    .filter((p) => isHomeNearbyDisplayPlace(p, options));
}
