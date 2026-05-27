import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import type { PlaceOpenStatus } from "@/lib/filter-available-places";
import { distanceMeters } from "@/lib/map-explore";
import type { WeatherSummary } from "@/lib/weather-types";
import { weatherRankingBoost } from "@/lib/weather/weather-place-ranking";

type SortablePlace = {
  name?: string;
  primaryType?: string | null;
  types?: string[] | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  userRatingCount?: number | null;
  openStatus?: PlaceOpenStatus;
  isSavedFavorite?: boolean;
};

function placeTextForWeather(p: SortablePlace): string {
  return [p.name, p.primaryType, ...(p.types ?? [])].filter(Boolean).join(" ");
}

function openStatusScore(status?: PlaceOpenStatus): number {
  if (status === "open") return 4;
  if (status === "closing_soon") return 3;
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
    profile.personalityType ?? "",
    profile.personalitySummary ?? "",
    ...(profile.interests ?? []),
  ]
    .join(" ")
    .toLowerCase();
  let boost = 0;
  if (/美食|吃/i.test(blob) && place.openStatus === "open") boost += 0.05;
  if (/逛|購物/i.test(blob)) boost += 0.02;
  if (place.isSavedFavorite) boost += 0.08;

  if (profile.pace === "slow") boost += 0.04;
  if (profile.pace === "active") boost += 0.02;
  if (profile.vibe === "quiet") boost += 0.03;
  if (profile.vibe === "lively") boost += 0.02;
  if (profile.budgetMode === "budget") boost += 0.02;

  return boost;
}

/**
 * 探索推薦排序：營業中優先，同狀態內依距離（近→遠）、評分、偏好微調。
 */
export function sortExplorePlaces<T extends SortablePlace>(
  places: T[],
  origin: { lat: number; lng: number },
  profile?: UserProfileForReason | null,
  weather?: WeatherSummary | null,
): T[] {
  return [...places].sort((a, b) => {
    const openA = openStatusScore(a.openStatus);
    const openB = openStatusScore(b.openStatus);
    if (openA !== openB) return openB - openA;

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

    const boostA = interestBoost(a, profile) + weatherRankingBoost(weather, placeTextForWeather(a));
    const boostB = interestBoost(b, profile) + weatherRankingBoost(weather, placeTextForWeather(b));
    if (boostA !== boostB) return boostB - boostA;

    return 0;
  });
}
