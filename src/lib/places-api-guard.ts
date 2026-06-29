import { devVerboseInfo } from "@/lib/dev-verbose-log";

/** Places API 快取 TTL 與節流常數（全 app 共用） */
export const PLACES_SEARCH_CACHE_TTL_MS = 20 * 60 * 1000;
export const PLACES_NEARBY_CACHE_TTL_MS = 30 * 60 * 1000;
export const PLACES_FAILED_CACHE_TTL_MS = 10 * 60 * 1000;
export const PLACES_RAW_POOL_TTL_MS = 30 * 60 * 1000;
export const PLACES_HOME_LOAD_TTL_MS = 30 * 60 * 1000;
export const PLACES_MIN_LOCATION_MOVE_M = 500;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_CALLS = 20;
const MAX_RETRIES = 1;

const pending = new Map<string, Promise<unknown>>();
const recentCallAt: number[] = [];
const retryCount = new Map<string, number>();

const loggedKeys = new Set<string>();

function logOnce(key: string, line: string): void {
  if (loggedKeys.has(key)) return;
  loggedKeys.add(key);
  devVerboseInfo(line);
}

export function logPlacesApiCall(type: string, key: string): void {
  devVerboseInfo(`[PLACES_API_CALL] type=${type} key=${key}`);
}

export function logPlacesCacheHit(key: string): void {
  logOnce(`hit:${key}`, `[PLACES_CACHE_HIT] key=${key}`);
}

export function logPlacesCacheMiss(key: string): void {
  logOnce(`miss:${key}`, `[PLACES_CACHE_MISS] key=${key}`);
}

export function logPlacesDedupePending(key: string): void {
  logOnce(`pending:${key}`, `[PLACES_DEDUPE_PENDING] key=${key}`);
}

export function logPlacesRateLimitBlocked(key: string): void {
  devVerboseInfo(`[PLACES_RATE_LIMIT_BLOCKED] key=${key}`);
}

export function logPlacesSkipSmallLocationChange(distanceM: number): void {
  logOnce(`loc:${distanceM}`, `[PLACES_SKIP_SMALL_LOCATION_CHANGE] distance=${distanceM}`);
}

function pruneRateWindow(now: number): void {
  while (recentCallAt.length > 0 && recentCallAt[0]! < now - RATE_WINDOW_MS) {
    recentCallAt.shift();
  }
}

export function isPlacesRateLimited(now = Date.now()): boolean {
  pruneRateWindow(now);
  return recentCallAt.length >= RATE_MAX_CALLS;
}

function recordPlacesApiCall(now = Date.now()): void {
  pruneRateWindow(now);
  recentCallAt.push(now);
}

export function canRetryPlacesRequest(key: string): boolean {
  const n = retryCount.get(key) ?? 0;
  return n < MAX_RETRIES;
}

export function markPlacesRequestRetried(key: string): void {
  retryCount.set(key, (retryCount.get(key) ?? 0) + 1);
}

/** 同一 requestKey 共用 in-flight Promise；超過速率上限則回傳 null */
export async function runPlacesApiDeduped<T>(
  key: string,
  type: string,
  runner: () => Promise<T>,
): Promise<T | null> {
  const inflight = pending.get(key);
  if (inflight) {
    logPlacesDedupePending(key);
    return inflight as Promise<T>;
  }

  if (isPlacesRateLimited()) {
    logPlacesRateLimitBlocked(key);
    return null;
  }

  logPlacesApiCall(type, key);
  recordPlacesApiCall();

  const promise = runner().finally(() => {
    pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
}

export function buildPlacesHttpKey(
  type: string,
  parts: Record<string, string | number | undefined>,
): string {
  return `${type}:${Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("&")}`;
}
