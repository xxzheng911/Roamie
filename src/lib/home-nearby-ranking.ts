import type { PlaceOpenStatus } from "@/lib/filter-available-places";
import { distanceMeters } from "@/lib/geo-distance";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import {
  buildPlusPreferenceRankingContext,
  scorePlusPreferenceMatch,
} from "@/lib/plus-preference-ranking";
import {
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
import { sortExplorePlaces } from "@/lib/sort-explore-places";

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
  isSavedFavorite?: boolean;
};

export type PlusRankingSortOptions = {
  reasonProfile?: UserProfileForReason | null;
  savedPlaces?: Array<{ name: string; category?: string | null }>;
  explicitAvoidKeywords?: string[];
  explicitPreferKeywords?: string[];
  mood?: string | null;
  setting?: string | null;
};

function plusPreferenceBoost(
  place: RankablePlace,
  plus?: PlusRankingSortOptions | null,
): number {
  if (!plus?.reasonProfile) return 0;
  const ctx = buildPlusPreferenceRankingContext({
    surface: "homeNearby",
    profile: plus.reasonProfile,
    savedPlaces: plus.savedPlaces,
    explicitAvoidKeywords: plus.explicitAvoidKeywords,
    explicitPreferKeywords: plus.explicitPreferKeywords,
    mood: plus.mood,
    setting: plus.setting,
  });
  return scorePlusPreferenceMatch(place, ctx);
}

function ratingTier(rating: number | null | undefined, reviews: number | null | undefined): number {
  if ((rating ?? 0) <= 0 && (reviews ?? 0) <= 0) return 3;
  if ((rating ?? 0) < 3.8) return 2;
  if ((rating ?? 0) < 4.0) return 1;
  return 0;
}

function periodBoost(place: RankablePlace, period: HomeTimePeriod): number {
  const pick = place as HomeNearbyPickPlace;
  if (period === "late_night") {
    const tier = homeLateNightRecommendationTier(place);
    if (tier === 1) return -12;
    if (tier === 2) return -8;
    if (tier === 3) return -4;
    if (matchesNightPreferredPlace(pick)) return -2;
    if (/博物|美術|公園|書店|hotel|lodging|library/i.test(place.name ?? "")) return 8;
    return 0;
  }
  if (matchesDayPreferredPlace(pick)) return -3;
  if (/酒吧|宵夜|居酒|深夜|night|pub/i.test(place.name ?? "")) return 4;
  return 0;
}

function lateNightPlaceText(place: RankablePlace): string {
  return `${place.name ?? ""} ${place.primaryType ?? ""} ${(place.types ?? []).join(" ")}`.toLowerCase();
}

/** Home 夜晚散策專用分級；Google type 優先，名稱只補 cuisine／夜景語意。 */
export function homeLateNightRecommendationTier(place: RankablePlace): 1 | 2 | 3 | 4 {
  const text = lateNightPlaceText(place);
  if (
    /餐酒|居酒|日式小酒館|深夜咖啡|酒吧|酒館|bistro|izakaya|cocktail|\bbar\b|\bpub\b|coffee_shop|night_cafe/.test(
      text,
    )
  ) {
    return 1;
  }
  if (
    /宵夜|深夜食堂|late[_\s-]*night[_\s-]*food|拉[麵面]|ramen|串[燒烧]|yakitori|燒肉|烧肉|焼肉|yakiniku|火鍋|火锅|hot[_\s-]*pot|hotpot|barbecue_restaurant/.test(
      text,
    )
  ) {
    return 2;
  }
  if (
    /夜景|河岸|河濱|港邊|港灣|碼頭|展望台|觀景台|夜市|night[_\s-]*market|night[_\s-]*view|waterfront|harbou?r|pier|observation/.test(
      text,
    )
  ) {
    return 3;
  }
  return 4;
}

function homeLateNightDiversityBucket(place: RankablePlace): string {
  const text = lateNightPlaceText(place);
  if (/深夜咖啡|coffee_shop|\bcafe\b|咖啡/.test(text)) return "late_cafe";
  if (/餐酒|居酒|酒吧|酒館|bistro|izakaya|cocktail|\bbar\b|\bpub\b/.test(text)) return "night_drinks";
  if (/拉[麵面]|ramen/.test(text)) return "ramen";
  if (/串[燒烧]|yakitori/.test(text)) return "yakitori";
  if (/燒肉|烧肉|焼肉|yakiniku|barbecue_restaurant/.test(text)) return "yakiniku";
  if (/火鍋|火锅|hot[_\s-]*pot|hotpot/.test(text)) return "hot_pot";
  if (homeLateNightRecommendationTier(place) === 3) return "night_scenic";
  return "late_food";
}

function diversifyHomeLateNightPicks<T extends RankablePlace>(places: T[]): T[] {
  const output: T[] = [];
  const deferred: T[] = [];
  const counts = new Map<string, number>();
  for (const place of places) {
    const bucket = homeLateNightDiversityBucket(place);
    const count = counts.get(bucket) ?? 0;
    if (count >= 2) {
      deferred.push(place);
      continue;
    }
    counts.set(bucket, count + 1);
    output.push(place);
  }
  return [...output, ...deferred];
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
    plus?: PlusRankingSortOptions | null;
  },
): T[] {
  const at = options?.at ?? new Date();
  const tz = options?.timeZone ?? "Asia/Taipei";
  const period =
    options?.period ?? homeNearbyPeriodFromHour(localHourInTimeZone(at, tz));

  const ranked = [...places].sort((a, b) => {
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

    const plusA = plusPreferenceBoost(a, options?.plus);
    const plusB = plusPreferenceBoost(b, options?.plus);
    if (plusA !== plusB) return plusB - plusA;

    const photoA = a.photoName ? 1 : 0;
    const photoB = b.photoName ? 1 : 0;
    if (photoA !== photoB) return photoB - photoA;

    return 0;
  });
  if (period !== "late_night") return ranked;

  const byAvailability = new Map<number, T[]>();
  for (const place of ranked) {
    const rank = openStatusSortRank(place.openStatus);
    byAvailability.set(rank, [...(byAvailability.get(rank) ?? []), place]);
  }
  return [...byAvailability.keys()]
    .sort((a, b) => a - b)
    .flatMap((rank) => diversifyHomeLateNightPicks(byAvailability.get(rank) ?? []));
}

/** 探索地圖：依分類調整排序（美食重評價、夜晚重 openNow） */
export type ExploreCategorySortOptions = {
  country?: string | null;
  cityLabel?: string | null;
  tabelogCache?: TabelogRankingCache | null;
  reasonProfile?: UserProfileForReason | null;
  savedPlaces?: Array<{ name: string; category?: string | null }>;
  weather?: WeatherSummary | null;
  plus?: PlusRankingSortOptions | null;
};

export function sortExploreCategoryPlaces<T extends RankablePlace>(
  places: T[],
  origin: { lat: number; lng: number },
  categoryId: string,
  sortOptions?: ExploreCategorySortOptions,
): T[] {
  const plus: PlusRankingSortOptions | null =
    sortOptions?.plus ??
    (sortOptions?.reasonProfile
      ? {
          reasonProfile: sortOptions.reasonProfile,
          savedPlaces: sortOptions.savedPlaces,
        }
      : null);

  return sortExplorePlaces(
    places,
    origin,
    sortOptions?.reasonProfile ?? plus?.reasonProfile,
    sortOptions?.weather,
    categoryId,
    {
      country: sortOptions?.country,
      cityLabel: sortOptions?.cityLabel,
      tabelogCache: sortOptions?.tabelogCache,
    },
  );
}
