import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { placesRegionCodeFromCoordinates } from "@/lib/geo-region";
import { normalizedLocationKey } from "@/lib/location-key";
import type { PlaceResult } from "@/lib/place-result";
import type { PlaceDetailsScreenResult } from "@/lib/places.functions";

/** 統一 Place Cache TTL：24 小時 */
export const UNIFIED_PLACE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
  return (raw ?? "zh-TW").trim() || "zh-TW";
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
    parts.city?.trim() ||
    parts.cityLabel?.trim() ||
    parts.destinationName?.trim() ||
    "";
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
    parts.lat != null && parts.lng != null
      ? normalizedLocationKey(parts.lat, parts.lng)
      : "geo";
  return `${country}|${city}|${geo}|${category}|${language}`;
}

export function buildUnifiedPlaceDetailsCacheKey(
  placeId: string,
  language: string,
  scope: Omit<UnifiedPlaceCacheScope, "placeId" | "category" | "language"> = {},
): string {
  return buildUnifiedPlaceCacheKey({
    ...scope,
    placeId,
    category: "detail",
    language,
  });
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

function canUseLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function readPersisted<T>(key: string): CacheEnvelope<T> | null {
  if (!canUseLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed?.at) return null;
    if (Date.now() - parsed.at > UNIFIED_PLACE_CACHE_TTL_MS) {
      localStorage.removeItem(storageKey(key));
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
  },
): T | null {
  if (options?.ignoreCache) {
    memory.delete(key);
    return null;
  }

  const now = Date.now();
  const mem = memory.get(key) as CacheEnvelope<T> | undefined;
  if (mem && now - mem.at <= UNIFIED_PLACE_CACHE_TTL_MS) {
    if (!options?.validate || options.validate(mem.data)) return mem.data;
    memory.delete(key);
  } else if (mem) {
    memory.delete(key);
  }

  const persisted = readPersisted<T>(key);
  if (!persisted) return null;
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
  },
): Promise<T> {
  if (options?.forceRefresh) {
    invalidateUnifiedPlaceCache(key);
  }

  const cached = readUnifiedPlaceCache<T>(key, {
    ignoreCache: options?.forceRefresh,
    validate: options?.validate,
  });
  if (cached !== null) return cached;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

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
    !!place.photoName?.trim() ||
    (Array.isArray(screen.photoNames) && screen.photoNames.length > 0);
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

/** 依 placeId 索引單一地點（供 AI／聊天／行程共用詳情） */
export function cachePlaceResultById(
  place: PlaceResult,
  language: string,
  scope: Omit<UnifiedPlaceCacheScope, "placeId" | "language"> = {},
): void {
  if (!place.id) return;
  const key = buildUnifiedPlaceDetailsCacheKey(place.id, language, scope);
  writeUnifiedPlaceCache(key, { place: place as PlaceDetailsScreenResult, error: null });
}

export function readCachedPlaceResultById(
  placeId: string,
  language: string,
  scope: Omit<UnifiedPlaceCacheScope, "placeId" | "language"> = {},
): PlaceResult | null {
  const key = buildUnifiedPlaceDetailsCacheKey(placeId, language, scope);
  const hit = readUnifiedPlaceDetailsCache(key);
  return hit?.place ?? null;
}
