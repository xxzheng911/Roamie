import type { Locale } from "@/lib/i18n/types";
import type { ExploreTimeBucket } from "@/lib/explore-time-bucket";

const EXPLORE_REQUEST_THROTTLE_MS = 30_000;
const EXPLORE_LOG_THROTTLE_MS = 30_000;

const lastRequestAt = new Map<string, number>();
const inFlightExploreRequests = new Map<string, Promise<unknown>>();
const lastLogAt = new Map<string, number>();

/** explore:${categoryId}:${locationKey}:${locale}:${timeBucket} */
export function buildExploreRequestKey(
  categoryId: string,
  locationKey: string,
  locale: Locale,
  timeBucket: ExploreTimeBucket,
): string {
  return `explore:${categoryId}:${locationKey}:${locale}:${timeBucket}`;
}

export function shouldThrottleExploreRequest(key: string, now = Date.now()): boolean {
  const last = lastRequestAt.get(key);
  return last !== undefined && now - last < EXPLORE_REQUEST_THROTTLE_MS;
}

export function markExploreRequestStarted(key: string, now = Date.now()): void {
  lastRequestAt.set(key, now);
}

export function getExploreRequestInFlight<T>(key: string): Promise<T> | null {
  const pending = inFlightExploreRequests.get(key);
  return pending ? (pending as Promise<T>) : null;
}

export function registerExploreRequestInFlight<T>(key: string, promise: Promise<T>): Promise<T> {
  const existing = getExploreRequestInFlight<T>(key);
  if (existing) return existing;

  inFlightExploreRequests.set(key, promise);
  return promise.finally(() => {
    if (inFlightExploreRequests.get(key) === promise) {
      inFlightExploreRequests.delete(key);
    }
  });
}

/** 同一 key 30 秒內只印一次探索 log */
export function shouldLogExploreEvent(key: string, now = Date.now()): boolean {
  const last = lastLogAt.get(key);
  if (last !== undefined && now - last < EXPLORE_LOG_THROTTLE_MS) return false;
  lastLogAt.set(key, now);
  return true;
}
