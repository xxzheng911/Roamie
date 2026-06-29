import type { PlaceOpenStatus } from "@/lib/filter-available-places";
import { distanceMeters } from "@/lib/geo-distance";
import {
  isExploreJapanFoodContext,
  sortJapanFoodPlaces,
  type TabelogRankingCache,
} from "@/lib/tabelog-reference";
import {
  homeNearbyPeriodFromHour,
  localHourInTimeZone,
  matchesDayPreferredPlace,
  matchesNightPreferredPlace,
  openStatusSortRank,
  type HomeNearbyPeriod,
  type HomeNearbyPickPlace,
} from "@/lib/home-nearby-eligibility";
import { classifyWeatherScene } from "@/lib/weather-scene";
import type { WeatherSummary } from "@/lib/weather-types";
import { weatherRankingBoost } from "@/lib/weather/weather-place-ranking";

export type HomeTimePeriod = "day" | "late_night";

const HOME_NEARBY_MIN_RATING = 4.0;

/** @deprecated 使用 homeNearbyPeriodFromHour */
export function homeTimePeriodFromHour(hour: number): HomeTimePeriod {
  return homeNearbyPeriodFromHour(hour);
}

export function localHour(at: Date, timeZone = "Asia/Taipei"): number {
  return localHourInTimeZone(at, timeZone);
}

export function isRainyForHomeRecommendations(
  weather: WeatherSummary | null | undefined,
): boolean {
  if (!weather?.available) return false;
  return (
    classifyWeatherScene({
      tempC: weather.tempC,
      precipProbability: weather.precipProbability,
      condition: weather.condition,
      isDaytime: weather.isDaytime,
    }) === "rainy"
  );
}

type RankablePlace = {
  name?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  openStatus?: PlaceOpenStatus | null;
  rating?: number | null;
  userRatingCount?: number | null;
  photoName?: string | null;
  lat?: number | null;
  lng?: number | null;
  categoryId?: string | null;
};

function ratingTier(rating: number | null | undefined, reviews: number | null | undefined): number {
  if ((rating ?? 0) <= 0 && (reviews ?? 0) <= 0) return 3;
  if ((rating ?? 0) < 3.8) return 2;
  if ((rating ?? 0) < 4.0) return 1;
  return 0;
}

function periodBoost(place: RankablePlace, period: HomeTimePeriod): number {
  const pick = place as HomeNearbyPickPlace;
  if (period === "late_night") {
    if (matchesNightPreferredPlace(pick)) return -4;
    if (/博物|美術|公園|書店|hotel|lodging|library/i.test(place.name ?? "")) return 8;
    return 0;
  }
  if (matchesDayPreferredPlace(pick)) return -3;
  if (/酒吧|宵夜|居酒|深夜|night|pub/i.test(place.name ?? "")) return 4;
  return 0;
}

function weatherBoostWithRainOverride(
  place: RankablePlace,
  weather: WeatherSummary | null | undefined,
): number {
  const text = `${place.name ?? ""} ${[...(place.types ?? []), place.primaryType ?? ""].join(" ")}`;
  let boost = weatherRankingBoost(weather, text);

  if (!isRainyForHomeRecommendations(weather)) return boost;

  const outdoor =
    /海邊|海灘|沙灘|步道|登山|健行|露營|山區|camp|beach|hiking|trail|河濱/i.test(text);
  if (outdoor && (place.rating ?? 0) >= 4.7 && (place.userRatingCount ?? 0) >= 100) {
    boost = Math.min(boost, 3);
  }
  return boost;
}

/** 首頁附近地點：openNow → 時段偏好 → 評分 → 距離 */
export function sortHomeNearbyPlacesWithContext<T extends RankablePlace>(
  places: T[],
  origin: { lat: number; lng: number },
  options?: {
    weather?: WeatherSummary | null;
    at?: Date;
    timeZone?: string;
    period?: HomeTimePeriod;
  },
): T[] {
  const at = options?.at ?? new Date();
  const tz = options?.timeZone ?? "Asia/Taipei";
  const period =
    options?.period ?? homeNearbyPeriodFromHour(localHourInTimeZone(at, tz));

  return [...places].sort((a, b) => {
    const openA = openStatusSortRank(a.openStatus);
    const openB = openStatusSortRank(b.openStatus);
    if (openA !== openB) return openA - openB;

    const contextA = periodBoost(a, period) + weatherBoostWithRainOverride(a, options?.weather ?? null);
    const contextB = periodBoost(b, period) + weatherBoostWithRainOverride(b, options?.weather ?? null);
    if (contextA !== contextB) return contextA - contextB;

    const ratingTierA = ratingTier(a.rating, a.userRatingCount);
    const ratingTierB = ratingTier(b.rating, b.userRatingCount);
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

/** 探索地圖：依分類調整排序（美食重評價、夜晚重 openNow） */
export type ExploreCategorySortOptions = {
  country?: string | null;
  cityLabel?: string | null;
  tabelogCache?: TabelogRankingCache | null;
};

export function sortExploreCategoryPlaces<T extends RankablePlace>(
  places: T[],
  origin: { lat: number; lng: number },
  categoryId: string,
  sortOptions?: ExploreCategorySortOptions,
): T[] {
  if (
    categoryId === "food" &&
    isExploreJapanFoodContext({
      country: sortOptions?.country,
      cityLabel: sortOptions?.cityLabel,
      categoryId: "food",
    })
  ) {
    return sortJapanFoodPlaces(places, origin, sortOptions?.tabelogCache ?? null);
  }

  if (categoryId === "food") {
    return [...places].sort((a, b) => {
      const openA = openStatusSortRank(a.openStatus);
      const openB = openStatusSortRank(b.openStatus);
      if (openA !== openB) return openA - openB;

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
      return distA - distB;
    });
  }

  if (categoryId === "night") {
    return [...places].sort((a, b) => {
      const openA = openStatusSortRank(a.openStatus);
      const openB = openStatusSortRank(b.openStatus);
      if (openA !== openB) return openA - openB;

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
      return distA - distB;
    });
  }

  return sortHomeNearbyPlacesWithContext(places, origin);
}
