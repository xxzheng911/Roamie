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

/** 依時段與天氣調整探索關鍵字 */
export function buildExploreQuery(
  categoryQuery: string,
  ctx: { weather?: WeatherSummary | null; hour?: number; timeIso?: string },
): string {
  const temporal = buildTemporalWeatherContext(ctx.weather, ctx.timeIso);
  const hour = temporal.hour;

  if (temporal.isRainy) {
    if (categoryQuery.includes("cafe") || categoryQuery.includes("coffee"))
      return "indoor cafe bookstore";
    if (categoryQuery.includes("park")) return "indoor museum gallery";
    return "indoor cozy spot nearby";
  }

  if (temporal.isHot) {
    if (categoryQuery.includes("park")) return "indoor museum cafe air conditioned";
    return "indoor cool cafe gallery nearby";
  }

  if (temporal.period === "night" || temporal.period === "evening") {
    if (categoryQuery.includes("bar") || categoryQuery.includes("night"))
      return "night view bar evening walk";
    if (categoryQuery.includes("food")) return "dinner restaurant night market";
    if (categoryQuery.includes("cafe")) return "dessert cafe evening open";
    return "night scenic walk spot open now";
  }

  if (hour >= 5 && hour < 11) {
    if (categoryQuery.includes("cafe")) return "morning cafe breakfast bakery";
    if (categoryQuery.includes("park")) return "morning walk park scenic";
  }
  if (hour >= 17 && hour < 21) {
    if (categoryQuery.includes("bar") || categoryQuery.includes("night"))
      return "evening bar night market";
    if (categoryQuery.includes("food")) return "dinner local restaurant";
  }

  return categoryQuery;
}
