import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import { normalizedLocationKey } from "@/lib/location-key";
import { PLACES_RAW_POOL_TTL_MS } from "@/lib/places-api-guard";
import type { ExploreRecommendMode } from "@/lib/explore-recommend-mode";

const TTL_MS = PLACES_RAW_POOL_TTL_MS;

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
): string {
  return `${normalizedLocationKey(lat, lng)}:${mode}:${locale}:${categoryId}`;
}

export function writeExploreRawPool(key: string, places: PlaceResult[]): void {
  if (!places.length) return;
  pool.set(key, { places: [...places], at: Date.now() });
}

export function readExploreRawPool(key: string): PlaceResult[] | null {
  const hit = pool.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    pool.delete(key);
    return null;
  }
  return hit.places;
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
