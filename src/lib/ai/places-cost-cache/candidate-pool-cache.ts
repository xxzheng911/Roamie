/**
 * Layer 2 — Candidate Pool Cache (30 min).
 * Keyed by destination (+ optional country). Style/group filter from pool — no re-search.
 */
import type { PlaceResult } from "@/lib/place-result";
import type { CandidatePoolResult } from "@/lib/ai/candidate-pool/types";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { PLACES_COST_CACHE_TTL_MS } from "@/lib/ai/places-cost-cache/constants";
import {
  logCandidatePoolCacheHit,
  logCandidatePoolCacheMiss,
  logCandidatePoolCreated,
} from "@/lib/ai/places-cost-cache/log";

export type CachedCandidatePool = {
  destination: string;
  countryCode?: string;
  places: PlaceResult[];
  /** Full pipeline result when built via RAOS candidate-pool */
  poolResult?: CandidatePoolResult;
  createdAt: number;
  searchRequestCount: number;
};

const poolCache = new Map<string, CachedCandidatePool>();

export function candidatePoolCacheKey(
  destination: string,
  countryCode?: string,
): string {
  const label = normalizeDestinationLabel(destination);
  const cc = (countryCode ?? "").trim().toUpperCase();
  return cc ? `${label}|${cc}` : label;
}

function isFresh(entry: CachedCandidatePool, now = Date.now()): boolean {
  return now - entry.createdAt <= PLACES_COST_CACHE_TTL_MS;
}

export function readCandidatePoolCache(
  destination: string,
  countryCode?: string,
): CachedCandidatePool | null {
  const label = normalizeDestinationLabel(destination);
  const now = Date.now();
  for (const key of [
    candidatePoolCacheKey(label, countryCode),
    candidatePoolCacheKey(label),
  ]) {
    const entry = poolCache.get(key);
    if (!entry) continue;
    if (!isFresh(entry, now)) {
      poolCache.delete(key);
      continue;
    }
    logCandidatePoolCacheHit({
      destination: label,
      key,
      places: entry.places.length,
      ageMs: now - entry.createdAt,
    });
    return entry;
  }
  logCandidatePoolCacheMiss({ destination: label, countryCode: countryCode ?? "" });
  return null;
}

export function writeCandidatePoolCache(params: {
  destination: string;
  countryCode?: string;
  places: PlaceResult[];
  poolResult?: CandidatePoolResult;
  searchRequestCount?: number;
}): CachedCandidatePool {
  const label = normalizeDestinationLabel(params.destination);
  const entry: CachedCandidatePool = {
    destination: label,
    countryCode: params.countryCode,
    places: params.places,
    poolResult: params.poolResult,
    createdAt: Date.now(),
    searchRequestCount: params.searchRequestCount ?? 0,
  };
  const primary = candidatePoolCacheKey(label, params.countryCode);
  poolCache.set(primary, entry);
  poolCache.set(candidatePoolCacheKey(label), entry);
  logCandidatePoolCreated({
    destination: label,
    key: primary,
    places: entry.places.length,
    searchRequestCount: entry.searchRequestCount,
  });
  return entry;
}

export function clearCandidatePoolCache(destination?: string): void {
  if (!destination) {
    poolCache.clear();
    return;
  }
  const label = normalizeDestinationLabel(destination);
  for (const key of [...poolCache.keys()]) {
    if (key === label || key.startsWith(`${label}|`)) {
      poolCache.delete(key);
    }
  }
}

export function peekCandidatePoolCacheSize(): number {
  return poolCache.size;
}
