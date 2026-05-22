import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import type { PlaceOpenStatus } from "@/lib/filter-available-places";
import { distanceMeters } from "@/lib/map-explore";

type SortablePlace = {
  lat: number | null;
  lng: number | null;
  rating: number | null;
  userRatingCount?: number | null;
  openStatus?: PlaceOpenStatus;
  isSavedFavorite?: boolean;
};

function openStatusScore(status?: PlaceOpenStatus): number {
  if (status === "open") return 2;
  if (status === "unknown") return 1;
  return 0;
}

function interestBoost(
  place: SortablePlace,
  profile: UserProfileForReason | null | undefined,
): number {
  if (!profile?.onboarded) return 0;
  const blob = [
    profile.travelStyle ?? "",
    ...(profile.interests ?? []),
    profile.personalitySummary ?? "",
  ]
    .join(" ")
    .toLowerCase();
  let boost = 0;
  if (/美食|吃/i.test(blob) && place.openStatus === "open") boost += 0.05;
  if (/逛|購物/i.test(blob)) boost += 0.02;
  if (place.isSavedFavorite) boost += 0.08;
  return boost;
}

/**
 * 探索推薦排序：距離（近→遠）為第一順位，其次評分、營業狀態、偏好微調。
 */
export function sortExplorePlaces<T extends SortablePlace>(
  places: T[],
  origin: { lat: number; lng: number },
  profile?: UserProfileForReason | null,
): T[] {
  return [...places].sort((a, b) => {
    const distA =
      a.lat != null && a.lng != null
        ? distanceMeters(origin, { lat: a.lat, lng: a.lng })
        : Number.POSITIVE_INFINITY;
    const distB =
      b.lat != null && b.lng != null
        ? distanceMeters(origin, { lat: b.lat, lng: b.lng })
        : Number.POSITIVE_INFINITY;
    if (distA !== distB) return distA - distB;

    const ratingA = a.rating ?? 0;
    const ratingB = b.rating ?? 0;
    if (ratingA !== ratingB) return ratingB - ratingA;

    const countA = a.userRatingCount ?? 0;
    const countB = b.userRatingCount ?? 0;
    if (countA !== countB) return countB - countA;

    const openA = openStatusScore(a.openStatus);
    const openB = openStatusScore(b.openStatus);
    if (openA !== openB) return openB - openA;

    const boostA = interestBoost(a, profile);
    const boostB = interestBoost(b, profile);
    if (boostA !== boostB) return boostB - boostA;

    return 0;
  });
}
