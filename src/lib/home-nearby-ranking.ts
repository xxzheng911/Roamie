import type { PlaceOpenStatus } from "@/lib/filter-available-places";
import { distanceMeters } from "@/lib/geo-distance";
import { classifyWeatherScene } from "@/lib/weather-scene";
import type { WeatherSummary } from "@/lib/weather-types";
import { weatherRankingBoost } from "@/lib/weather/weather-place-ranking";

export type HomeTimePeriod = "day" | "evening" | "night";

const HOME_NEARBY_MIN_RATING = 4.0;

export function homeTimePeriodFromHour(hour: number): HomeTimePeriod {
  if (hour >= 22 || hour < 5) return "night";
  if (hour >= 17) return "evening";
  return "day";
}

export function localHour(at: Date, timeZone = "Asia/Taipei"): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone }).format(at),
  );
}

/** 雨天：降雨機率、天氣狀態（Rain / Drizzle / Thunderstorm） */
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

function placeText(place: RankablePlace): string {
  const types = [...(place.types ?? []), place.primaryType ?? ""].filter(Boolean).join(" ");
  return `${place.name ?? ""} ${types}`;
}

function openStatusRank(openStatus?: PlaceOpenStatus | null): number {
  if (openStatus === "open" || openStatus === "closing_soon") return 0;
  if (openStatus === "unknown" || openStatus == null) return 1;
  return 2;
}

function ratingTier(rating: number | null | undefined): number {
  return (rating ?? 0) >= HOME_NEARBY_MIN_RATING ? 0 : 1;
}

function timePeriodBoost(place: RankablePlace, period: HomeTimePeriod): number {
  const text = placeText(place);

  switch (period) {
    case "day":
      if (/咖啡|cafe|餐廳|餐館|小吃|景點|博物|美術|百貨|商場|商圈|展覽|department|museum/i.test(text)) {
        return -2;
      }
      if (/酒吧|宵夜|居酒|深夜/i.test(text)) return 4;
      return 0;
    case "evening":
      if (/景觀|夜景|展望|觀景|view|咖啡|cafe|商圈|百貨|商場|餐廳|晚餐|餐酒/i.test(text)) {
        return -2;
      }
      return 0;
    case "night":
      if (/酒吧|居酒|宵夜|夜市|深夜|餐酒|night|pub|bar|izakaya/i.test(text)) return -3;
      if (/博物|美術|公園|步道|早午餐|早餐|brunch/i.test(text)) return 5;
      return 0;
  }
}

function rainyNightBoost(place: RankablePlace): number {
  const text = placeText(place);
  if (/咖啡|cafe|宵夜|餐酒|居酒|百貨|商場|mall|展覽|博物|美術/i.test(text)) return -2;
  return 0;
}

function weatherBoostWithRainOverride(
  place: RankablePlace,
  weather: WeatherSummary | null | undefined,
): number {
  const text = placeText(place);
  let boost = weatherRankingBoost(weather, text);

  if (!isRainyForHomeRecommendations(weather)) return boost;

  const outdoor =
    /海邊|海灘|沙灘|步道|登山|健行|露營|山區|峽谷|瀑布|camp|beach|hiking|trail|河岸|河濱/i.test(
      text,
    );
  if (outdoor && (place.rating ?? 0) >= 4.7 && (place.userRatingCount ?? 0) >= 100) {
    boost = Math.min(boost, 3);
  }

  return boost;
}

/** 首頁附近地點：依 GPS 時段、天氣調整排序（openNow → 情境 → 評分 → 距離） */
export function sortHomeNearbyPlacesWithContext<T extends RankablePlace>(
  places: T[],
  origin: { lat: number; lng: number },
  options?: {
    weather?: WeatherSummary | null;
    at?: Date;
    timeZone?: string;
  },
): T[] {
  const at = options?.at ?? new Date();
  const tz = options?.timeZone ?? "Asia/Taipei";
  const hour = localHour(at, tz);
  const period = homeTimePeriodFromHour(hour);
  const rainy = isRainyForHomeRecommendations(options?.weather ?? null);
  const rainyNight = rainy && period === "night";

  return [...places].sort((a, b) => {
    const openA = openStatusRank(a.openStatus);
    const openB = openStatusRank(b.openStatus);
    if (openA !== openB) return openA - openB;

    const contextA =
      timePeriodBoost(a, period) +
      weatherBoostWithRainOverride(a, options?.weather ?? null) +
      (rainyNight ? rainyNightBoost(a) : 0);
    const contextB =
      timePeriodBoost(b, period) +
      weatherBoostWithRainOverride(b, options?.weather ?? null) +
      (rainyNight ? rainyNightBoost(b) : 0);
    if (contextA !== contextB) return contextA - contextB;

    const ratingTierA = ratingTier(a.rating);
    const ratingTierB = ratingTier(b.rating);
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
export function sortExploreCategoryPlaces<T extends RankablePlace>(
  places: T[],
  origin: { lat: number; lng: number },
  categoryId: string,
): T[] {
  if (categoryId === "food") {
    return [...places].sort((a, b) => {
      const openA = openStatusRank(a.openStatus);
      const openB = openStatusRank(b.openStatus);
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
      const openA = openStatusRank(a.openStatus);
      const openB = openStatusRank(b.openStatus);
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
