import type { WeatherSummary } from "@/lib/weather-types";
import { buildTemporalWeatherContext } from "@/lib/weather-context";
import type { SavedPlace } from "@/lib/places-storage";
import { approximateTimezoneFromCoordinates, isTaiwanCoordinates } from "@/lib/geo-region";
import type { Locale } from "@/lib/i18n/types";

export { isTaiwanCoordinates };

const EARTH_RADIUS_M = 6371000;

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
}

export function savedPlacesNear(
  center: { lat: number; lng: number },
  saved: SavedPlace[],
  maxMeters = 5000,
): SavedPlace[] {
  return saved
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({ place: p, d: distanceMeters(center, { lat: p.lat!, lng: p.lng! }) }))
    .filter((x) => x.d <= maxMeters)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.place);
}

export type ExploreQueryOptions = {
  weather?: WeatherSummary | null;
  hour?: number;
  timeIso?: string;
  /** 使用者目前座標（當地時區） */
  userLocation?: { lat: number; lng: number };
  /** App 語言（決定 text 搜尋關鍵字與 AI 文案，不依所在地） */
  userLocale?: Locale;
};

/** 依時段、天氣與所在地調整 text 搜尋關鍵字（locationBias 以 userLocation 為準） */
export function buildExploreQuery(
  categoryQuery: string,
  ctx: ExploreQueryOptions,
): string {
  const locale = ctx.userLocale ?? "zh-TW";
  const timeZone = ctx.userLocation
    ? approximateTimezoneFromCoordinates(ctx.userLocation.lat, ctx.userLocation.lng)
    : undefined;
  const temporal = buildTemporalWeatherContext(ctx.weather, ctx.timeIso, timeZone);
  const hour = temporal.hour;
  const q = categoryQuery.toLowerCase();
  const isCoffee = /咖啡|cafe|coffee|カフェ|카페/.test(categoryQuery);
  const isPark = /公園|park|公園/.test(categoryQuery);
  const isFood = /美食|餐|food|restaurant|小吃|グルメ|맛집/.test(categoryQuery);
  const isNight = /夜|night|bar|夜景/.test(categoryQuery);

  if (locale === "ja") {
    if (temporal.isRainy) {
      if (isCoffee) return "屋内 カフェ 書店";
      if (isPark) return "美術館 屋内";
      return "屋内 スポット カフェ";
    }
    if (temporal.period === "night" || temporal.period === "evening") {
      if (isNight) return "バー 夜景";
      if (isFood) return "ディナー レストラン";
      return "夜景 ナイトスポット";
    }
    return categoryQuery;
  }

  if (locale === "ko") {
    if (temporal.isRainy) {
      if (isCoffee) return "실내 카페 서점";
      if (isPark) return "박물관 실내";
      return "실내 명소 카페";
    }
    if (temporal.period === "night" || temporal.period === "evening") {
      if (isNight) return "바 야경";
      if (isFood) return "저녁 맛집";
      return "야경 명소";
    }
    return categoryQuery;
  }

  if (locale !== "zh-TW") {
    if (temporal.isRainy) {
      if (isCoffee) return "indoor cafe bookstore";
      if (isPark) return "museum gallery indoor";
      return "indoor attractions cafe";
    }
    if (temporal.isHot) {
      if (isPark) return "museum air conditioned cafe";
      return "cafe indoor attractions";
    }
    if (temporal.period === "night" || temporal.period === "evening") {
      if (isNight) return "bar nightlife scenic view";
      if (isFood) return "dinner restaurant night market";
      if (isCoffee) return "dessert cafe late night";
      return "night view scenic spot";
    }
    if (hour >= 5 && hour < 11 && isCoffee) return "breakfast cafe bakery";
    if (hour >= 17 && hour < 21 && isFood) return "dinner local restaurant";
    return categoryQuery;
  }

  if (temporal.isRainy) {
    if (isCoffee) return "室內咖啡廳 書店";
    if (isPark) return "室內美術館 展覽";
    return "室內景點 咖啡廳";
  }

  if (temporal.isHot) {
    if (isPark) return "室內美術館 咖啡廳";
    return "有冷氣的咖啡廳 室內景點";
  }

  if (temporal.period === "night" || temporal.period === "evening") {
    if (isNight || q.includes("酒吧") || q.includes("夜景")) return "酒吧 夜景";
    if (isFood) return "晚餐 夜市 餐廳";
    if (isCoffee) return "甜點 咖啡 宵夜";
    return "夜景 夜間景點";
  }

  if (hour >= 5 && hour < 11) {
    if (isCoffee) return "早餐 咖啡 烘焙";
    if (isPark) return "晨間公園 散步";
  }
  if (hour >= 17 && hour < 21) {
    if (isNight) return "晚餐 酒吧 夜市";
    if (isFood) return "晚餐 在地餐廳";
  }

  return categoryQuery;
}

export function formatDistanceLabel(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
