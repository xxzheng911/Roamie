import type { RoutesTravelMode } from "@/lib/routes/types";
import type { LatLng } from "@/lib/google-routes-fetch";

export type RouteDurationCacheEntry = {
  ok: boolean;
  durationMinutes: number | null;
  distanceMeters: number;
  status: string;
  travelMode: RoutesTravelMode;
  errorMessage?: string;
  availableTravelModes?: string[];
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const FAILED_TTL_MS = 10 * 60 * 1000;

type Cached = { entry: RouteDurationCacheEntry; expiresAt: number };
const memory = new Map<string, Cached>();
const inflight = new Map<string, Promise<RouteDurationCacheEntry>>();
const loggedKeys = new Set<string>();

function coordPart(n: number): string {
  return n.toFixed(4);
}

export function routeDurationCacheKey(
  origin: LatLng,
  destination: LatLng,
  mode: RoutesTravelMode,
  departureTime?: string,
  placeIds?: { originPlaceId?: string; destinationPlaceId?: string; tripDate?: string },
): string {
  const dep =
    mode === "TRANSIT"
      ? departureTime
        ? departureTime.slice(0, 19)
        : (placeIds?.tripDate?.trim() ?? "")
      : "";
  const oPid = placeIds?.originPlaceId?.trim() ?? "";
  const dPid = placeIds?.destinationPlaceId?.trim() ?? "";
  return `${oPid}|${coordPart(origin.lat)},${coordPart(origin.lng)}>${dPid}|${coordPart(destination.lat)},${coordPart(destination.lng)}|${mode}|${dep}`;
}

export function getCachedRouteDuration(key: string): RouteDurationCacheEntry | null {
  const hit = memory.get(key);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.entry;
}

export function setCachedRouteDuration(key: string, entry: RouteDurationCacheEntry): void {
  const ttl = entry.ok ? CACHE_TTL_MS : FAILED_TTL_MS;
  memory.set(key, { entry, expiresAt: Date.now() + ttl });
}

export function getRouteDurationInFlight(
  key: string,
): Promise<RouteDurationCacheEntry> | undefined {
  return inflight.get(key);
}

export function registerRouteDurationInFlight(
  key: string,
  promise: Promise<RouteDurationCacheEntry>,
): Promise<RouteDurationCacheEntry> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const tracked = promise.finally(() => {
    if (inflight.get(key) === tracked) inflight.delete(key);
  });
  inflight.set(key, tracked);
  return tracked;
}

export function clearRouteDurationCache(): void {
  memory.clear();
  inflight.clear();
}

import { shouldLogDirectionsDebug } from "@/lib/directions-debug-log";

/** Log each cache key once per session (dev + Capacitor native) */
export function logRouteDurationOnce(
  tag: string,
  key: string,
  message: string,
): void {
  if (!shouldLogDirectionsDebug()) return;
  const logKey = `${tag}|${key}|${message.slice(0, 80)}`;
  if (loggedKeys.has(logKey)) return;
  loggedKeys.add(logKey);
  console.info(`[${tag}] ${message}`);
}
