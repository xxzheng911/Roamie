import { normalizedLocationKey } from "@/lib/location-key";

const HOME_NEARBY_LOAD_TTL_MS = 5 * 60 * 1000;

let lastLoadKey = "";
let lastLoadAt = 0;
let loadInFlight: Promise<unknown> | null = null;
let loadInFlightKey = "";
const completedLoadKeys = new Map<string, number>();

export function homeNearbyCategoriesKey(categoryIds: readonly string[]): string {
  return [...categoryIds].sort().join(",");
}

/** locationKey + mood + categoriesKey — 首頁 nearby 批次唯一識別 */
export function homeNearbyLoadKey(
  lat: number,
  lng: number,
  mood: string | null | undefined,
  categoriesKey: string,
): string {
  return `${normalizedLocationKey(lat, lng)}:${mood ?? ""}:${categoriesKey}`;
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
  const completedAt = completedLoadKeys.get(key);
  if (completedAt !== undefined) {
    if (now - completedAt < HOME_NEARBY_LOAD_TTL_MS) return true;
    completedLoadKeys.delete(key);
  }
  if (hasExistingPicks && sessionLoadKey === key) return true;
  return shouldSkipHomeNearbyLoad(key, now);
}

export function markHomeNearbyLoadComplete(key: string, now = Date.now()): void {
  completedLoadKeys.set(key, now);
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
  if (loadInFlight && loadInFlightKey === key) {
    return loadInFlight as Promise<T>;
  }
  return null;
}

export function registerHomeNearbyLoadInFlight<T>(key: string, promise: Promise<T>): Promise<T> {
  const existing = getHomeNearbyLoadInFlight<T>(key);
  if (existing) return existing;
  loadInFlightKey = key;
  loadInFlight = promise;
  return promise.finally(() => {
    if (loadInFlight === promise) {
      loadInFlight = null;
      loadInFlightKey = "";
    }
  });
}
