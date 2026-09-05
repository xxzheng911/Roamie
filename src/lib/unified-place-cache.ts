import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { placesRegionCodeFromCoordinates } from "@/lib/geo-region";
import { normalizedLocationKey } from "@/lib/location-key";
import type { PlaceResult } from "@/lib/place-result";
import type { PlaceDetailsScreenResult } from "@/lib/places.functions";

/** 統一 Place Cache TTL：24 小時 */
export const UNIFIED_PLACE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const UNIFIED_PLACE_INTRO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const UNIFIED_PLACE_SCREEN_CACHE_TTL_MS = 30 * 60 * 1000;

export type PlaceDetailsCapability = "search_v1" | "anchor_v1" | "screen_v1" | "intro_v1";

const STORAGE_PREFIX = "roamie:unified-place:v1:";
const MAX_PERSISTED_ENTRIES = 120;

export type UnifiedPlaceCacheScope = {
  country?: string | null;
  city?: string | null;
  cityLabel?: string | null;
  destinationName?: string | null;
  placeId?: string | null;
  category?: string | null;
  language?: string | null;
  lat?: number;
  lng?: number;
};

type CacheEnvelope<T> = {
  data: T;
  at: number;
};

const memory = new Map<string, CacheEnvelope<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

let forceRefreshNext = false;

export function setUnifiedPlaceCacheForceRefresh(value = true): void {
  forceRefreshNext = value;
}

export function consumeUnifiedPlaceCacheForceRefresh(): boolean {
  if (!forceRefreshNext) return false;
  forceRefreshNext = false;
  return true;
}

function normalizeCountry(raw?: string | null): string {
  const v = (raw ?? "").trim().toUpperCase();
  return v || "_";
}

function normalizePlaceId(raw?: string | null): string {
  return (raw ?? "").trim().replace(/^places\//, "");
}

function normalizeCategory(raw?: string | null): string {
  return (raw ?? "all").trim() || "all";
}

function normalizeLanguage(raw?: string | null): string {
  const value = (raw ?? "zh-TW").trim().replace(/_/g, "-");
  const [language, region] = value.split("-");
  return `${language.toLowerCase()}${region ? `-${region.toUpperCase()}` : ""}`;
}

/** 從座標／標籤推斷 country + city */
export function inferPlaceCacheLocation(parts: UnifiedPlaceCacheScope): {
  country: string;
  city: string;
} {
  const country =
    normalizeCountry(parts.country) !== "_"
      ? normalizeCountry(parts.country)
      : parts.lat != null && parts.lng != null
        ? normalizeCountry(placesRegionCodeFromCoordinates(parts.lat, parts.lng))
        : "_";

  const label =
    parts.city?.trim() || parts.cityLabel?.trim() || parts.destinationName?.trim() || "";
  const city = label
    ? normalizeDestinationLabel(label)
    : parts.lat != null && parts.lng != null
      ? normalizedLocationKey(parts.lat, parts.lng)
      : "nearby";

  return { country, city };
}

/**
 * 統一快取 key：country + city + placeId + category + language
 * 列表搜尋無 placeId 時以 geo key 代替。
 */
export function buildUnifiedPlaceCacheKey(parts: UnifiedPlaceCacheScope): string {
  const { country, city } = inferPlaceCacheLocation(parts);
  const language = normalizeLanguage(parts.language);
  const category = normalizeCategory(parts.category);
  const placeId = normalizePlaceId(parts.placeId);
  if (placeId) {
    return `${country}|${city}|${placeId}|${category}|${language}`;
  }
  const geo =
    parts.lat != null && parts.lng != null ? normalizedLocationKey(parts.lat, parts.lng) : "geo";
  return `${country}|${city}|${geo}|${category}|${language}`;
}

export function buildUnifiedPlaceDetailsCacheKey(
  placeId: string,
  language: string,
  _scope: Omit<UnifiedPlaceCacheScope, "placeId" | "category" | "language"> = {},
  capability: PlaceDetailsCapability = "screen_v1",
): string {
  const canonicalPlaceId = normalizePlaceId(placeId);
  return `details|${canonicalPlaceId}|${normalizeLanguage(language)}|${capability}`;
}

function logPlaceCacheAccess(
  key: string,
  result: "hit" | "miss" | "stale" | "inflight_join",
  cacheLayer: string,
): void {
  if (!key.startsWith("details|")) return;
  const [, id, locale, capability] = key.split("|");
  console.info("[PLACE_CACHE_ACCESS]", {
    canonicalPlaceId: id.slice(0, 12),
    capability,
    locale,
    cacheLayer,
    result,
  });
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

function canUseLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function readPersisted<T>(
  key: string,
  ttlMs = UNIFIED_PLACE_CACHE_TTL_MS,
): CacheEnvelope<T> | null {
  if (!canUseLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed?.at) return null;
    if (Date.now() - parsed.at > ttlMs) {
      localStorage.removeItem(storageKey(key));
      logPlaceCacheAccess(key, "stale", "persistent");
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePersisted<T>(key: string, envelope: CacheEnvelope<T>): void {
  if (!canUseLocalStorage()) return;
  try {
    prunePersistedEntries();
    localStorage.setItem(storageKey(key), JSON.stringify(envelope));
  } catch {
    /* quota */
  }
}

function prunePersistedEntries(): void {
  if (!canUseLocalStorage()) return;
  const entries: Array<{ key: string; at: number }> = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { at?: number };
      entries.push({ key, at: parsed.at ?? 0 });
    } catch {
      localStorage.removeItem(key);
    }
  }
  if (entries.length <= MAX_PERSISTED_ENTRIES) return;
  entries
    .sort((a, b) => a.at - b.at)
    .slice(0, entries.length - MAX_PERSISTED_ENTRIES)
    .forEach(({ key }) => localStorage.removeItem(key));
}

export function readUnifiedPlaceCache<T>(
  key: string,
  options?: {
    ignoreCache?: boolean;
    validate?: (data: T) => boolean;
    ttlMs?: number;
  },
): T | null {
  if (options?.ignoreCache) {
    memory.delete(key);
    return null;
  }

  const now = Date.now();
  const mem = memory.get(key) as CacheEnvelope<T> | undefined;
  const ttlMs = options?.ttlMs ?? UNIFIED_PLACE_CACHE_TTL_MS;
  if (mem && now - mem.at <= ttlMs) {
    if (!options?.validate || options.validate(mem.data)) {
      logPlaceCacheAccess(key, "hit", "memory");
      return mem.data;
    }
    memory.delete(key);
  } else if (mem) {
    memory.delete(key);
  }

  const persisted = readPersisted<T>(key, ttlMs);
  if (!persisted) {
    logPlaceCacheAccess(key, "miss", "persistent");
    return null;
  }
  if (options?.validate && !options.validate(persisted.data)) {
    invalidateUnifiedPlaceCache(key);
    return null;
  }
  memory.set(key, persisted);
  return persisted.data;
}

export function writeUnifiedPlaceCache<T>(key: string, data: T): void {
  const envelope: CacheEnvelope<T> = { data, at: Date.now() };
  memory.set(key, envelope);
  writePersisted(key, envelope);
}

export function invalidateUnifiedPlaceCache(key: string): void {
  memory.delete(key);
  if (!canUseLocalStorage()) return;
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    /* ignore */
  }
}

export async function getUnifiedPlaceCacheOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: {
    forceRefresh?: boolean;
    shouldCache?: (data: T) => boolean;
    validate?: (data: T) => boolean;
    ttlMs?: number;
  },
): Promise<T> {
  if (options?.forceRefresh) {
    invalidateUnifiedPlaceCache(key);
  }

  const cached = readUnifiedPlaceCache<T>(key, {
    ignoreCache: options?.forceRefresh,
    validate: options?.validate,
    ttlMs: options?.ttlMs,
  });
  if (cached !== null) return cached;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) {
    logPlaceCacheAccess(key, "inflight_join", "memory");
    return pending;
  }

  const promise = fetcher()
    .then((data) => {
      if (options?.shouldCache?.(data) ?? true) {
        writeUnifiedPlaceCache(key, data);
      }
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/** 詳情頁可讀取快取：已成功解析過即可（避免返回頁面重打 API） */
export function isPlaceDetailsMinimallyCacheable(
  place: PlaceResult | PlaceDetailsScreenResult | null | undefined,
): boolean {
  return !!(place?.id && place.name?.trim() && place.lat != null && place.lng != null);
}

/** 詳情頁完整資料：缺 photo / rating 時允許下次進入重抓 enrichment */
export function isPlaceDetailsCacheComplete(
  place: PlaceResult | PlaceDetailsScreenResult | null | undefined,
): boolean {
  if (!place?.id || !place.name?.trim()) return false;
  if (place.lat == null || place.lng == null) return false;
  const hasRating = place.rating != null || (place.userRatingCount ?? 0) > 0;
  const screen = place as PlaceDetailsScreenResult;
  const hasPhoto =
    !!place.photoName?.trim() || (Array.isArray(screen.photoNames) && screen.photoNames.length > 0);
  return hasRating && hasPhoto;
}

/** 搜尋列表：至少有一筆可顯示結果即視為可快取 */
export function isPlaceSearchListCacheable(places: PlaceResult[]): boolean {
  return places.some((p) => p.id && p.name?.trim() && p.lat != null && p.lng != null);
}

export type UnifiedPlaceSearchCacheEntry = {
  places: PlaceResult[];
  error: string | null;
};

export type UnifiedPlaceDetailsCacheEntry = {
  place: PlaceDetailsScreenResult | null;
  error: string | null;
};

export function readUnifiedPlaceSearchCache(
  key: string,
  options?: { ignoreCache?: boolean },
): UnifiedPlaceSearchCacheEntry | null {
  return readUnifiedPlaceCache<UnifiedPlaceSearchCacheEntry>(key, {
    ignoreCache: options?.ignoreCache,
    validate: (entry) => isPlaceSearchListCacheable(entry.places),
  });
}

export function writeUnifiedPlaceSearchCache(
  key: string,
  places: PlaceResult[],
  error: string | null,
): void {
  if (!isPlaceSearchListCacheable(places)) return;
  writeUnifiedPlaceCache(key, { places, error: places.length > 0 ? null : error });
}

export function readUnifiedPlaceDetailsCache(
  key: string,
  options?: { ignoreCache?: boolean },
): UnifiedPlaceDetailsCacheEntry | null {
  return readUnifiedPlaceCache<UnifiedPlaceDetailsCacheEntry>(key, {
    ignoreCache: options?.ignoreCache,
    ttlMs: key.endsWith("|screen_v1") ? UNIFIED_PLACE_SCREEN_CACHE_TTL_MS : undefined,
    validate: (entry) => !entry.place || isPlaceDetailsMinimallyCacheable(entry.place),
  });
}

export function writeUnifiedPlaceDetailsCache(
  key: string,
  place: PlaceDetailsScreenResult | null,
  error: string | null,
): void {
  if (!place) return;
  writeUnifiedPlaceCache(key, { place, error });
}

/** Enrichment wins, except that an empty response must not erase known factual identity fields. */
export function mergePlaceFactualFields<T extends PlaceResult>(
  existing: PlaceResult | null,
  enriched: T,
): T {
  if (!existing) return enriched;
  return {
    ...existing,
    ...enriched,
    id: enriched.id?.trim() || existing.id,
    name: enriched.name?.trim() || existing.name,
    lat: enriched.lat ?? existing.lat,
    lng: enriched.lng ?? existing.lng,
    address: enriched.address?.trim() || existing.address,
    types: enriched.types?.length ? enriched.types : existing.types,
    businessStatus: enriched.businessStatus ?? existing.businessStatus,
  } as T;
}

/** 依 placeId 索引單一地點（供 AI／聊天／行程共用詳情） */
export function cachePlaceResultById(
  place: PlaceResult,
  language: string,
  scope: Omit<UnifiedPlaceCacheScope, "placeId" | "language"> = {},
): void {
  if (!place.id) return;
  const key = buildUnifiedPlaceDetailsCacheKey(place.id, language, scope, "search_v1");
  writeUnifiedPlaceCache(key, { place: place as PlaceDetailsScreenResult, error: null });
}

export function readCachedPlaceResultById(
  placeId: string,
  language: string,
  scope: Omit<UnifiedPlaceCacheScope, "placeId" | "language"> = {},
  capability: Exclude<PlaceDetailsCapability, "intro_v1"> = "search_v1",
): PlaceResult | null {
  const candidates: PlaceDetailsCapability[] =
    capability === "screen_v1"
      ? ["screen_v1"]
      : capability === "anchor_v1"
        ? ["screen_v1", "anchor_v1"]
        : ["screen_v1", "anchor_v1", "search_v1"];
  for (const candidate of candidates) {
    const hit = readUnifiedPlaceDetailsCache(
      buildUnifiedPlaceDetailsCacheKey(placeId, language, scope, candidate),
    );
    if (hit?.place) return hit.place;
  }
  return null;
}
