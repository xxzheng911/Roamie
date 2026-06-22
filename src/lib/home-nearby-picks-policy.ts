import { PLACES_HOME_LOAD_TTL_MS } from "@/lib/places-api-guard";
import { normalizedLocationKey } from "@/lib/location-key";

const HOME_NEARBY_LOAD_TTL_MS = PLACES_HOME_LOAD_TTL_MS;

let lastLoadKey = "";
let lastLoadAt = 0;
const inFlightHomeNearbyRequests = new Map<string, Promise<unknown>>();
const completedLoadKeys = new Map<string, { at: number; count: number }>();
const homeNearbyResultsCache = new Map<string, { picks: unknown[]; at: number }>();

/** @deprecated 首頁推薦已改為時段策略，不再依探索分類 */
export function homeNearbyCategoriesKey(categoryIds: readonly string[]): string {
  return [...categoryIds].sort().join(",");
}

/** locationKey + locale + timeBucket + homeNearby */
export function homeNearbyCacheKey(
  locationKey: string,
  locale: string,
  timeBucket: string,
): string {
  return `${locationKey}:${locale}:${timeBucket}:homeNearby`;
}

/** 首頁 nearby 批次唯一識別（含 locale / 時段） */
export function homeNearbyLoadKey(
  lat: number,
  lng: number,
  timeBucket: string,
  locale: string,
): string {
  return homeNearbyCacheKey(normalizedLocationKey(lat, lng), locale, timeBucket);
}

export function readHomeNearbyResultsCache<T = unknown>(key: string, now = Date.now()): T[] | null {
  const hit = homeNearbyResultsCache.get(key);
  if (!hit) return null;
  if (now - hit.at > HOME_NEARBY_LOAD_TTL_MS) {
    homeNearbyResultsCache.delete(key);
    return null;
  }
  if (hit.picks.length === 0) return null;
  return hit.picks as T[];
}

export function writeHomeNearbyResultsCache<T = unknown>(
  key: string,
  picks: T[],
  now = Date.now(),
): void {
  homeNearbyResultsCache.set(key, { picks: [...picks], at: now });
}

export function shouldSkipHomeNearbyLoad(key: string, now = Date.now()): boolean {
  return lastLoadKey === key && now - lastLoadAt < HOME_NEARBY_LOAD_TTL_MS;
}

/** 已有 nearby 卡片且 session key 一致，或該 loadKey 已完成（含空結果）時不再 load */
export function shouldSkipHomeNearbyLoadWithData(
  key: string,
  hasExistingPicks: boolean,
  sessionLoadKey: string | null,
  now = Date.now(),
): boolean {
  const cached = readHomeNearbyResultsCache(key, now);
  if (cached !== null && cached.length > 0) return true;

  const completed = completedLoadKeys.get(key);
  if (completed !== undefined) {
    if (completed.count > 0 && now - completed.at < HOME_NEARBY_LOAD_TTL_MS) return true;
    if (now - completed.at >= HOME_NEARBY_LOAD_TTL_MS) {
      completedLoadKeys.delete(key);
    }
  }
  if (hasExistingPicks && sessionLoadKey === key) return true;
  return false;
}

export function markHomeNearbyLoadComplete(key: string, count: number, now = Date.now()): void {
  completedLoadKeys.set(key, { at: now, count });
}

/** @deprecated 請改用 homeNearbyLoadKey；保留給舊 log */
export function homeNearbyLocationKey(lat: number, lng: number): string {
  return normalizedLocationKey(lat, lng);
}

/** @deprecated 請改用 shouldSkipHomeNearbyLoadWithData(loadKey, ...) */
export function shouldSkipHomeNearbyLocationLoad(
  _locationKey: string,
  _mood?: string | null,
): boolean {
  return false;
}

/** @deprecated 請改用 markHomeNearbyLoadComplete(loadKey) */
export function markHomeNearbyLocationStarted(_locationKey: string): void {}

/** @deprecated 請改用 markHomeNearbyLoadComplete(loadKey) */
export function markHomeNearbyLocationComplete(_locationKey: string): void {}

export function markHomeNearbyLoad(key: string, now = Date.now()): void {
  lastLoadKey = key;
  lastLoadAt = now;
}

export function getHomeNearbyLoadInFlight<T>(key: string): Promise<T> | null {
  const inflight = inFlightHomeNearbyRequests.get(key);
  return inflight ? (inflight as Promise<T>) : null;
}

export function registerHomeNearbyLoadInFlight<T>(key: string, promise: Promise<T>): Promise<T> {
  const existing = getHomeNearbyLoadInFlight<T>(key);
  if (existing) return existing;

  inFlightHomeNearbyRequests.set(key, promise);
  return promise.finally(() => {
    if (inFlightHomeNearbyRequests.get(key) === promise) {
      inFlightHomeNearbyRequests.delete(key);
    }
  });
}
