/**
 * Layer 3 — Combination Cache (30 min).
 * Same destination + travel style + group → reuse without Places.
 */
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { PLACES_COST_CACHE_TTL_MS } from "@/lib/ai/places-cost-cache/constants";
import {
  logCombinationCacheHit,
  logCombinationCacheMiss,
} from "@/lib/ai/places-cost-cache/log";

export type CombinationCacheEntry<T> = {
  combinations: T[];
  createdAt: number;
  destination: string;
  travelStyle: string;
  group: string;
};

const combinationCache = new Map<string, CombinationCacheEntry<unknown>>();

export function combinationCacheKey(params: {
  destination: string;
  travelStyle?: string;
  group?: string;
}): string {
  const dest = normalizeDestinationLabel(params.destination);
  const style = (params.travelStyle ?? "any").trim().toLowerCase() || "any";
  const group = (params.group ?? "all").trim().toLowerCase() || "all";
  return `${dest}|${style}|${group}`;
}

function isFresh(at: number, now = Date.now()): boolean {
  return now - at <= PLACES_COST_CACHE_TTL_MS;
}

export function readCombinationCache<T>(params: {
  destination: string;
  travelStyle?: string;
  group?: string;
  /** When false, skip HIT/MISS logs (used by discovery fallback peek). */
  log?: boolean;
}): T[] | null {
  const key = combinationCacheKey(params);
  const shouldLog = params.log !== false;
  const entry = combinationCache.get(key) as CombinationCacheEntry<T> | undefined;
  if (!entry || !isFresh(entry.createdAt)) {
    if (entry) combinationCache.delete(key);
    // Fallback: destination-only "all" bucket
    if ((params.group ?? "all") !== "all" || (params.travelStyle ?? "any") !== "any") {
      const destOnly = readCombinationCache<T>({
        destination: params.destination,
        travelStyle: "any",
        group: "all",
        log: false,
      });
      if (destOnly?.length) {
        if (shouldLog) {
          logCombinationCacheHit({
            destination: normalizeDestinationLabel(params.destination),
            travelStyle: params.travelStyle ?? "any",
            group: params.group ?? "all",
            key,
            count: destOnly.length,
            source: "destination_bucket",
          });
        }
        return destOnly;
      }
    }
    if (shouldLog) {
      logCombinationCacheMiss({
        destination: normalizeDestinationLabel(params.destination),
        travelStyle: params.travelStyle ?? "any",
        group: params.group ?? "all",
        key,
      });
    }
    return null;
  }
  if (!entry.combinations.length) {
    if (shouldLog) {
      logCombinationCacheMiss({
        destination: entry.destination,
        travelStyle: entry.travelStyle,
        group: entry.group,
        key,
        reason: "empty",
      });
    }
    return null;
  }
  if (shouldLog) {
    logCombinationCacheHit({
      destination: entry.destination,
      travelStyle: entry.travelStyle,
      group: entry.group,
      key,
      count: entry.combinations.length,
      ageMs: Date.now() - entry.createdAt,
    });
  }
  return entry.combinations;
}

export function writeCombinationCache<T>(params: {
  destination: string;
  travelStyle?: string;
  group?: string;
  combinations: T[];
}): void {
  if (!params.combinations.length) return;
  const dest = normalizeDestinationLabel(params.destination);
  const travelStyle = (params.travelStyle ?? "any").trim().toLowerCase() || "any";
  const group = (params.group ?? "all").trim().toLowerCase() || "all";
  const entry: CombinationCacheEntry<T> = {
    combinations: params.combinations,
    createdAt: Date.now(),
    destination: dest,
    travelStyle,
    group,
  };
  combinationCache.set(combinationCacheKey({ destination: dest, travelStyle, group }), entry);
  // Also store destination-wide bucket for style-agnostic reuse
  if (travelStyle !== "any" || group !== "all") {
    combinationCache.set(
      combinationCacheKey({ destination: dest, travelStyle: "any", group: "all" }),
      { ...entry, travelStyle: "any", group: "all" },
    );
  }
}

export function clearCombinationCache(destination?: string): void {
  if (!destination) {
    combinationCache.clear();
    return;
  }
  const label = normalizeDestinationLabel(destination);
  for (const key of [...combinationCache.keys()]) {
    if (key === label || key.startsWith(`${label}|`)) {
      combinationCache.delete(key);
    }
  }
}
