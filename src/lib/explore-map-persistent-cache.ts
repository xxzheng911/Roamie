import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { normalizedLocationKey } from "@/lib/location-key";
import { exploreTimeBucket, type ExploreTimeBucket } from "@/lib/explore-time-bucket";
import {
  buildUnifiedPlaceCacheKey,
  invalidateUnifiedPlaceCache,
  readUnifiedPlaceSearchCache,
  writeUnifiedPlaceSearchCache,
  UNIFIED_PLACE_CACHE_TTL_MS,
  setUnifiedPlaceCacheForceRefresh,
} from "@/lib/unified-place-cache";

const STORAGE_PREFIX = "roamie:explore:map:v1:";
const SEARCH_SESSION_KEY = `${STORAGE_PREFIX}last-search`;

function canUseLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

/** 城市／地標搜尋成功結果：24h；附近：30min */
export const EXPLORE_CITY_MAP_CACHE_TTL_MS = UNIFIED_PLACE_CACHE_TTL_MS;
export const EXPLORE_NEARBY_MAP_CACHE_TTL_MS = 30 * 60 * 1000;

export type ExploreMapCacheScope = {
  lat: number;
  lng: number;
  categoryId: string;
  locale: string;
  mode: "city" | "nearby";
  cityPlaceId?: string | null;
  cityLabel?: string | null;
};

export type ExploreMapPersistedEntry<T> = {
  places: T[];
  error: string | null;
  at: number;
};

export type ExploreMapSearchSession = {
  center: {
    lat: number;
    lng: number;
    label: string;
    types?: string[];
    primaryType?: string | null;
    placeId?: string;
  };
  query: string;
  categoryId: string;
  locale: string;
  savedAt: number;
};

let forceRefreshNext = false;

export function setExploreMapForceRefreshNext(value = true): void {
  forceRefreshNext = value;
  setUnifiedPlaceCacheForceRefresh(value);
}

export function consumeExploreMapForceRefresh(): boolean {
  if (!forceRefreshNext) return false;
  forceRefreshNext = false;
  return true;
}

export function normalizeExploreCityCacheKey(
  cityPlaceId?: string | null,
  cityLabel?: string | null,
  lat?: number,
  lng?: number,
): string {
  const pid = (cityPlaceId ?? "").trim();
  if (pid) return `pid:${pid}`;
  const city = normalizeDestinationLabel((cityLabel ?? "").trim());
  if (city) return `city:${city}`;
  if (lat != null && lng != null) return `geo:${normalizedLocationKey(lat, lng)}`;
  return "geo:unknown";
}

/** city / placeId / category / locale — 對齊統一 Place Cache key */
export function buildExploreMapCacheScopeKey(scope: ExploreMapCacheScope): string {
  const { categoryId, locale, mode } = scope;
  if (mode === "city") {
    return buildUnifiedPlaceCacheKey({
      cityLabel: scope.cityLabel,
      placeId: scope.cityPlaceId,
      category: categoryId,
      language: locale,
      lat: scope.lat,
      lng: scope.lng,
    });
  }
  const locationKey = normalizedLocationKey(scope.lat, scope.lng);
  const bucket = exploreTimeBucket();
  return `nearby:${buildUnifiedPlaceCacheKey({
    category: categoryId,
    language: locale,
    lat: scope.lat,
    lng: scope.lng,
  })}:${bucket}:${locationKey}`;
}

export function exploreMapCacheTtlMs(mode: "city" | "nearby"): number {
  return mode === "city" ? EXPLORE_CITY_MAP_CACHE_TTL_MS : EXPLORE_NEARBY_MAP_CACHE_TTL_MS;
}

export function readExploreMapPersistedCache<T>(
  scopeKey: string,
  mode: "city" | "nearby",
): ExploreMapPersistedEntry<T> | null {
  void mode;
  const hit = readUnifiedPlaceSearchCache(scopeKey);
  if (!hit?.places.length) return null;
  return {
    places: hit.places as T[],
    error: hit.error,
    at: Date.now(),
  };
}

export function writeExploreMapPersistedCache<T>(
  scopeKey: string,
  places: T[],
  error: string | null,
): void {
  // Persist only factual Place fields. Recommendation reason/category/profile context
  // belongs to the current user/session and is rebuilt by the Explore card adapter.
  const factualPlaces = places.map((place) => {
    const record = place as Record<string, unknown>;
    const {
      reason: _reason,
      displayCategory: _displayCategory,
      categoryId: _categoryId,
      isSavedFavorite: _isSavedFavorite,
      distanceLabel: _distanceLabel,
      distanceSource: _distanceSource,
      distanceFromUser: _distanceFromUser,
      coverImageUrl: _coverImageUrl,
      ...factual
    } = record;
    return factual as import("@/lib/place-result").PlaceResult;
  });
  writeUnifiedPlaceSearchCache(scopeKey, factualPlaces, error);
}

export function clearExploreMapPersistedCache(scopeKey: string): void {
  invalidateUnifiedPlaceCache(scopeKey);
}

export function writeExploreMapSearchSession(session: ExploreMapSearchSession): void {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function readExploreMapSearchSession(): ExploreMapSearchSession | null {
  if (!canUseLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(SEARCH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExploreMapSearchSession;
    if (!parsed?.center?.label || parsed.center.lat == null || parsed.center.lng == null) {
      return null;
    }
    if (Date.now() - (parsed.savedAt ?? 0) > EXPLORE_CITY_MAP_CACHE_TTL_MS) {
      localStorage.removeItem(SEARCH_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearExploreMapSearchSession(): void {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.removeItem(SEARCH_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** 探索 session dedupe：城市模式不含 timeBucket */
export function buildExploreMapSessionKey(parts: {
  scopeKey: string;
  categoryId: string;
  locale: string;
  mode?: "city" | "nearby";
  freeTextQuery?: string | null;
}): string {
  const mode = parts.mode === "city" ? ":city" : "";
  if (parts.freeTextQuery?.trim()) {
    return `${parts.scopeKey}:search:${parts.freeTextQuery.trim().toLowerCase()}:${parts.locale}${mode}`;
  }
  return `${parts.scopeKey}:${parts.categoryId}:${parts.locale}${mode}`;
}

export function buildExploreMapCacheScopeFromParts(parts: {
  lat: number;
  lng: number;
  categoryId: string;
  locale: string;
  mode?: "city" | "nearby";
  cityPlaceId?: string | null;
  cityLabel?: string | null;
}): ExploreMapCacheScope {
  return {
    lat: parts.lat,
    lng: parts.lng,
    categoryId: parts.categoryId,
    locale: parts.locale,
    mode: parts.mode === "city" ? "city" : "nearby",
    cityPlaceId: parts.cityPlaceId,
    cityLabel: parts.cityLabel,
  };
}

export type { ExploreTimeBucket };
