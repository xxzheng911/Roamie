import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import {
  buildPlusPreferenceRankingContext,
  scorePlusPreferenceMatch,
} from "@/lib/plus-preference-ranking";
import type { PlaceOpenStatus } from "@/lib/filter-available-places";
import { distanceMeters } from "@/lib/map-explore";
import type { WeatherSummary } from "@/lib/weather-types";
import { weatherRankingBoost } from "@/lib/weather/weather-place-ranking";
import {
  isExploreJapanFoodContext,
  sortJapanFoodPlaces,
  type TabelogRankingCache,
} from "@/lib/tabelog-reference";

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
  photoName?: string | null;
  id?: string | null;
};

export type ExplorePlacesSortContext = {
  country?: string | null;
  cityLabel?: string | null;
  tabelogCache?: TabelogRankingCache | null;
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
  const ctx = buildPlusPreferenceRankingContext({ profile });
  return scorePlusPreferenceMatch(place, ctx);
}

function distanceFromOrigin(place: SortablePlace, origin: { lat: number; lng: number }): number {
  return place.lat != null && place.lng != null
    ? distanceMeters(origin, { lat: place.lat, lng: place.lng })
    : Number.POSITIVE_INFINITY;
}

/**
 * 探索推薦排序：營業中優先；美食重評價／評論數；夜晚重 openNow。
 */
export function sortExplorePlaces<T extends SortablePlace>(
  places: T[],
  origin: { lat: number; lng: number },
  profile?: UserProfileForReason | null,
  weather?: WeatherSummary | null,
  categoryId?: string,
  sortContext?: ExplorePlacesSortContext,
): T[] {
  if (
    categoryId === "food" &&
    isExploreJapanFoodContext({
      country: sortContext?.country,
      cityLabel: sortContext?.cityLabel,
      categoryId: "food",
    })
  ) {
    return sortJapanFoodPlaces(places, origin, sortContext?.tabelogCache ?? null);
  }

  return [...places].sort((a, b) => {
    const openA = openStatusScore(a.openStatus);
    const openB = openStatusScore(b.openStatus);
    if (openA !== openB) return openB - openA;

    const ratingA = a.rating ?? 0;
    const ratingB = b.rating ?? 0;
    const countA = a.userRatingCount ?? 0;
    const countB = b.userRatingCount ?? 0;

    if (categoryId === "food" || categoryId === "night") {
      if (ratingA !== ratingB) return ratingB - ratingA;
      if (countA !== countB) return countB - countA;
      const distFoodA = distanceFromOrigin(a, origin);
      const distFoodB = distanceFromOrigin(b, origin);
      if (distFoodA !== distFoodB) return distFoodA - distFoodB;

      const plusFoodA = interestBoost(a, profile);
      const plusFoodB = interestBoost(b, profile);
      if (plusFoodA !== plusFoodB) return plusFoodB - plusFoodA;

      const boostFoodA = weatherRankingBoost(weather, placeTextForWeather(a));
      const boostFoodB = weatherRankingBoost(weather, placeTextForWeather(b));
      if (boostFoodA !== boostFoodB) return boostFoodB - boostFoodA;
      return 0;
    }

    const distA = distanceFromOrigin(a, origin);
    const distB = distanceFromOrigin(b, origin);
    if (distA !== distB) return distA - distB;

    if (ratingA !== ratingB) return ratingB - ratingA;
    if (countA !== countB) return countB - countA;

    const plusA = interestBoost(a, profile);
    const plusB = interestBoost(b, profile);
    if (plusA !== plusB) return plusB - plusA;

    const boostA = weatherRankingBoost(weather, placeTextForWeather(a));
    const boostB = weatherRankingBoost(weather, placeTextForWeather(b));
    if (boostA !== boostB) return boostB - boostA;

    return 0;
  });
}
