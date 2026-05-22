import type { WeatherSummary } from "@/lib/weather.functions";
import { buildTemporalWeatherContext } from "@/lib/weather-context";
import type { SavedPlace } from "@/lib/places-storage";

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

/** 依時段與天氣調整探索關鍵字（維持中文，配合 locationBias 台灣附近搜尋） */
export function buildExploreQuery(
  categoryQuery: string,
  ctx: { weather?: WeatherSummary | null; hour?: number; timeIso?: string },
): string {
  const temporal = buildTemporalWeatherContext(ctx.weather, ctx.timeIso);
  const hour = temporal.hour;

  if (temporal.isRainy) {
    if (categoryQuery.includes("咖啡")) return "室內咖啡廳 書店";
    if (categoryQuery.includes("公園")) return "室內美術館 展覽";
    return "室內景點 咖啡廳";
  }

  if (temporal.isHot) {
    if (categoryQuery.includes("公園")) return "室內美術館 咖啡廳";
    return "有冷氣的咖啡廳 室內景點";
  }

  if (temporal.period === "night" || temporal.period === "evening") {
    if (categoryQuery.includes("酒吧") || categoryQuery.includes("夜景"))
      return "酒吧 夜景";
    if (categoryQuery.includes("小吃") || categoryQuery.includes("美食")) return "晚餐 夜市 餐廳";
    if (categoryQuery.includes("咖啡")) return "甜點 咖啡 宵夜";
    return "夜景 夜間景點";
  }

  if (hour >= 5 && hour < 11) {
    if (categoryQuery.includes("咖啡")) return "早餐 咖啡 烘焙";
    if (categoryQuery.includes("公園")) return "晨間公園 散步";
  }
  if (hour >= 17 && hour < 21) {
    if (categoryQuery.includes("酒吧") || categoryQuery.includes("夜景")) return "晚餐 酒吧 夜市";
    if (categoryQuery.includes("小吃") || categoryQuery.includes("美食")) return "晚餐 在地餐廳";
  }

  return categoryQuery;
}
