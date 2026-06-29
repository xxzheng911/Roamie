import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { ExploreRecommendMode } from "@/lib/explore-recommend-mode";
import {
  buildExploreMapCacheScopeFromParts,
  buildExploreMapCacheScopeKey,
  exploreMapCacheTtlMs,
  readExploreMapPersistedCache,
  writeExploreMapPersistedCache,
} from "@/lib/explore-map-persistent-cache";

type RawPoolEntry = {
  places: PlaceResult[];
  at: number;
};

const pool = new Map<string, RawPoolEntry>();

export function buildExploreRawPoolKey(
  lat: number,
  lng: number,
  mode: ExploreRecommendMode,
  locale: Locale = "zh-TW",
  categoryId = "all",
  cityPlaceId?: string | null,
  cityLabel?: string | null,
): string {
  return `raw:${buildExploreMapCacheScopeKey(
    buildExploreMapCacheScopeFromParts({
      lat,
      lng,
      categoryId,
      locale,
      mode: mode === "city" ? "city" : "nearby",
      cityPlaceId,
      cityLabel,
    }),
  )}`;
}

function rawPoolMode(key: string): "city" | "nearby" {
  return key.includes(":city:") ? "city" : "nearby";
}

function rawPoolScopeKey(key: string): string {
  return key.startsWith("raw:") ? key.slice(4) : key;
}

export function writeExploreRawPool(key: string, places: PlaceResult[]): void {
  if (!places.length) return;
  pool.set(key, { places: [...places], at: Date.now() });
  writeExploreMapPersistedCache(rawPoolScopeKey(key), places, null);
}

export function readExploreRawPool(
  key: string,
  options?: { ignoreCache?: boolean },
): PlaceResult[] | null {
  if (options?.ignoreCache) {
    pool.delete(key);
    return null;
  }

  const hit = pool.get(key);
  if (hit && Date.now() - hit.at <= exploreMapCacheTtlMs(rawPoolMode(key))) {
    return hit.places;
  }
  if (hit) pool.delete(key);

  const persisted = readExploreMapPersistedCache<PlaceResult>(
    rawPoolScopeKey(key),
    rawPoolMode(key),
  );
  if (!persisted) return null;

  pool.set(key, { places: persisted.places, at: persisted.at });
  return persisted.places;
}

export function mergeIntoExploreRawPool(key: string, extra: PlaceResult[]): PlaceResult[] {
  const existing = readExploreRawPool(key) ?? [];
  const seen = new Set(existing.map((p) => p.id));
  const merged = [...existing];
  for (const p of extra) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      merged.push(p);
    }
  }
  writeExploreRawPool(key, merged);
  return merged;
}
