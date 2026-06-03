import { distanceMeters } from "@/lib/map-explore";

/** 移動少於此距離不觸發 nearby / location publish */
export const HOME_LOCATION_MIN_REFETCH_DISTANCE_M = 100;

/** 兩次 nearby API 搜尋最短間隔（≥10s，避免 [NEARBY_FETCH_START] 連刷） */
export const HOME_NEARBY_MIN_FETCH_INTERVAL_MS = 45_000;

/** GPS watch 觸發天氣重抓最短間隔（與 store 45s 分開，避免 watch 回調風暴） */
export const HOME_LOCATION_MIN_PUBLISH_INTERVAL_MS = 45_000;

export function coordsMovedMeters(
  prev: { lat: number; lng: number } | null,
  next: { lat: number; lng: number },
): number {
  if (!prev) return Number.POSITIVE_INFINITY;
  return distanceMeters(prev, next);
}

export function logLocationUpdateSkipped(payload: {
  reason: string;
  distanceMoved: number;
  lastFetchAgo: number | null;
}): void {
  console.info("[LOCATION_UPDATE_SKIPPED]", payload);
}

export function logNearbyFetchSkipped(payload: { reason: string; cacheKey?: string }): void {
  console.info("[NEARBY_FETCH_SKIPPED]", payload);
}

export function shouldSkipLocationPublish(params: {
  prev: { lat: number; lng: number } | null;
  next: { lat: number; lng: number };
  lastPublishAt: number;
  now?: number;
}): { skip: boolean; reason?: string; distanceMoved: number; lastFetchAgo: number | null } {
  const now = params.now ?? Date.now();
  const distanceMoved = coordsMovedMeters(params.prev, params.next);
  const lastFetchAgo = params.lastPublishAt > 0 ? now - params.lastPublishAt : null;

  if (params.prev && distanceMoved < HOME_LOCATION_MIN_REFETCH_DISTANCE_M) {
    return {
      skip: true,
      reason: "distance_under_threshold",
      distanceMoved,
      lastFetchAgo,
    };
  }
  if (lastFetchAgo != null && lastFetchAgo < HOME_LOCATION_MIN_PUBLISH_INTERVAL_MS) {
    return {
      skip: true,
      reason: "publish_interval",
      distanceMoved,
      lastFetchAgo,
    };
  }
  return { skip: false, distanceMoved, lastFetchAgo };
}

export function shouldSkipNearbyRefetch(params: {
  prevCoords: { lat: number; lng: number } | null;
  nextCoords: { lat: number; lng: number };
  lastFetchAt: number;
  cacheKey: string;
  lastCacheKey: string | null;
  now?: number;
}): { skip: boolean; reason?: string; distanceMoved: number; lastFetchAgo: number | null } {
  const now = params.now ?? Date.now();
  const distanceMoved = coordsMovedMeters(params.prevCoords, params.nextCoords);
  const lastFetchAgo = params.lastFetchAt > 0 ? now - params.lastFetchAt : null;
  const sameGrid = params.lastCacheKey === params.cacheKey;

  if (sameGrid && lastFetchAgo != null && lastFetchAgo < HOME_NEARBY_MIN_FETCH_INTERVAL_MS) {
    return {
      skip: true,
      reason: "interval_same_cache_key",
      distanceMoved,
      lastFetchAgo,
    };
  }
  if (
    params.prevCoords &&
    distanceMoved < HOME_LOCATION_MIN_REFETCH_DISTANCE_M &&
    lastFetchAgo != null &&
    lastFetchAgo < HOME_NEARBY_MIN_FETCH_INTERVAL_MS
  ) {
    return {
      skip: true,
      reason: "distance_and_interval",
      distanceMoved,
      lastFetchAgo,
    };
  }
  return { skip: false, distanceMoved, lastFetchAgo };
}
