import type { PlaceHoursData } from "@/lib/filter-available-places";
import type { ExploreCategory } from "@/lib/places-search-config";
import { normalizedLocationKey } from "@/lib/location-key";
import { classifyWeatherScene } from "@/lib/weather-scene";
import type { WeatherSummary } from "@/lib/weather-types";
import type { RecommendationCategoryId, VerifiedPlaceCandidate } from "@/lib/recommendation/types";

export const AI_PLACE_CATEGORY_CACHE_TTL_MS = 30 * 60 * 1000;
export const AI_PLACE_HOURS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const AI_PRIMARY_CATEGORY_COUNT = 4;
export const AI_MIN_CANDIDATES_TARGET = 12;

export type AiPlaceApiStats = {
  nearby: number;
  text: number;
  details: number;
  photo: number;
};

type CacheEntry<T> = { data: T; expiresAt: number };

const categoryCache = new Map<string, CacheEntry<VerifiedPlaceCandidate[]>>();
const hoursByPlaceId = new Map<string, CacheEntry<PlaceHoursData>>();
const hoursInFlight = new Map<string, Promise<PlaceHoursData | null>>();

let activeStats: AiPlaceApiStats | null = null;

export function buildAiTimeOfDay(time: string): "day" | "evening" | "night" {
  const d = new Date(time);
  const hour = Number.isNaN(d.getTime()) ? new Date().getHours() : d.getHours();
  if (hour >= 22 || hour < 5) return "night";
  if (hour >= 17) return "evening";
  return "day";
}

export function buildAiWeatherKey(weather: WeatherSummary | null): string {
  if (!weather) return "unknown";
  return classifyWeatherScene({
    tempC: weather.tempC,
    precipProbability: weather.precipProbability,
    condition: weather.condition,
    isDaytime: weather.isDaytime,
  });
}

export function buildAiCategoryCacheKey(input: {
  city?: string;
  lat: number;
  lng: number;
  categoryId: RecommendationCategoryId;
  weather: WeatherSummary | null;
  time: string;
}): string {
  const city = input.city?.trim() || normalizedLocationKey(input.lat, input.lng);
  const weatherKey = buildAiWeatherKey(input.weather);
  const timeOfDay = buildAiTimeOfDay(input.time);
  return `${city}:${input.categoryId}:${weatherKey}:${timeOfDay}`;
}

export function countCategorySearchHttpCalls(
  def: ExploreCategory,
): Pick<AiPlaceApiStats, "nearby" | "text"> {
  if (def.mode === "multi" && def.nearbyGroups?.length) {
    return { nearby: def.nearbyGroups.length, text: 0 };
  }
  if (def.mode === "nearby") {
    return { nearby: 1, text: 0 };
  }
  if (def.query?.trim()) {
    return { nearby: 0, text: 1 };
  }
  return { nearby: 0, text: 0 };
}

export function estimateCategoryListApiCalls(categories: ExploreCategory[]): AiPlaceApiStats {
  const stats = emptyAiPlaceApiStats();
  for (const def of categories) {
    const calls = countCategorySearchHttpCalls(def);
    stats.nearby += calls.nearby;
    stats.text += calls.text;
  }
  return stats;
}

export function emptyAiPlaceApiStats(): AiPlaceApiStats {
  return { nearby: 0, text: 0, details: 0, photo: 0 };
}

export function beginAiPlaceApiSession(): void {
  activeStats = emptyAiPlaceApiStats();
}

export function recordAiPlaceApiCall(
  type: keyof AiPlaceApiStats,
  count = 1,
): void {
  if (!activeStats) return;
  activeStats[type] += count;
}

export function peekAiPlaceApiStats(): AiPlaceApiStats {
  return activeStats ? { ...activeStats } : emptyAiPlaceApiStats();
}

export function endAiPlaceApiSession(): AiPlaceApiStats {
  const stats = peekAiPlaceApiStats();
  const total = stats.nearby + stats.text + stats.details + stats.photo;
  console.info(
    `[AI_PLACE_SEARCH] summary nearby=${stats.nearby} text=${stats.text} details=${stats.details} photo=${stats.photo} total=${total}`,
  );
  activeStats = null;
  return stats;
}

export function logAiPlaceSearch(meta: {
  categoryId: string;
  mode: string;
  nearby: number;
  text: number;
  phase: "primary" | "fallback";
}): void {
  console.info(
    `[AI_PLACE_SEARCH] phase=${meta.phase} category=${meta.categoryId} mode=${meta.mode} nearby=${meta.nearby} text=${meta.text}`,
  );
}

export function logAiPlaceCacheHit(key: string): void {
  console.info(`[AI_PLACE_CACHE_HIT] key=${key}`);
}

export function logAiPlaceCacheMiss(key: string): void {
  console.info(`[AI_PLACE_CACHE_MISS] key=${key}`);
}

export function logAiPlaceDedupe(key: string): void {
  console.info(`[AI_PLACE_DEDUPE] key=${key}`);
}

export function logAiPlaceBatchLookup(meta: {
  name: string;
  placeId?: string | null;
  cacheHit?: boolean;
}): void {
  const placeId = meta.placeId?.trim() || "-";
  const hit = meta.cacheHit ? "true" : "false";
  console.info(
    `[AI_PLACE_BATCH_LOOKUP] name=${meta.name} placeId=${placeId} cacheHit=${hit}`,
  );
}

export function getAiCategoryCache(key: string, now = Date.now()): VerifiedPlaceCandidate[] | null {
  const entry = categoryCache.get(key);
  if (!entry || entry.expiresAt <= now) return null;
  return entry.data;
}

export function setAiCategoryCache(
  key: string,
  data: VerifiedPlaceCandidate[],
  now = Date.now(),
): void {
  categoryCache.set(key, { data, expiresAt: now + AI_PLACE_CATEGORY_CACHE_TTL_MS });
}

export function getAiHoursCacheByPlaceId(
  placeId: string,
  now = Date.now(),
): PlaceHoursData | null {
  const entry = hoursByPlaceId.get(placeId);
  if (!entry || entry.expiresAt <= now) return null;
  return entry.data;
}

export function setAiHoursCacheByPlaceId(
  placeId: string,
  data: PlaceHoursData,
  now = Date.now(),
): void {
  hoursByPlaceId.set(placeId, { data, expiresAt: now + AI_PLACE_HOURS_CACHE_TTL_MS });
}

export function runAiHoursLookupDeduped(
  key: string,
  runner: () => Promise<PlaceHoursData | null>,
): Promise<PlaceHoursData | null> {
  const inflight = hoursInFlight.get(key);
  if (inflight) {
    logAiPlaceDedupe(key);
    return inflight;
  }

  const promise = runner().finally(() => {
    hoursInFlight.delete(key);
  });
  hoursInFlight.set(key, promise);
  return promise;
}
