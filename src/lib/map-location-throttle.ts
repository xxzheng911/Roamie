import { distanceMeters } from "@/lib/map-explore";

/** 探索搜尋：位置變動超過此距離（公尺）才重新打 Places API */
export const MAP_SEARCH_LOCATION_THRESHOLD_M = 120;

export function locationMovedEnough(
  prev: { lat: number; lng: number } | null,
  next: { lat: number; lng: number },
  thresholdM = MAP_SEARCH_LOCATION_THRESHOLD_M,
): boolean {
  if (!prev) return true;
  return distanceMeters(prev, next) >= thresholdM;
}

export function weatherCacheKey(weather: {
  city?: string;
  condition?: string;
  tempC?: number | null;
} | null): string {
  if (!weather) return "none";
  return `${weather.city ?? ""}|${weather.condition ?? ""}|${weather.tempC ?? ""}`;
}
