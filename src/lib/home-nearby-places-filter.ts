import { distanceMeters } from "@/lib/map-explore";
import type { PlaceResult } from "@/lib/place-result";
import { HOME_NEARBY_MAX_DISTANCE_M } from "@/lib/search-radius";
import {
  homeNearbyPeriodFromHour,
  homeNearbyHardExclusionReason,
  localHourInTimeZone,
  passesHomeNearbyHardExclusions,
  passesHomeNearbyLastResort,
  passesHomeNearbyLevel1,
  passesHomeNearbyLevel2,
  passesHomeNearbyLevel3,
  passesHomeNearbyLevel4,
  type HomeNearbyPeriod,
} from "@/lib/home-nearby-eligibility";

export type HomeNearbyFilterPlace = Pick<
  PlaceResult,
  | "id"
  | "name"
  | "businessStatus"
  | "openStatus"
  | "rating"
  | "userRatingCount"
  | "photoName"
  | "primaryType"
  | "types"
  | "lat"
  | "lng"
  | "openStatusLabel"
> & {
  isSavedFavorite?: boolean;
  categoryId?: string;
};

export const HOME_NEARBY_TARGET_COUNT = 6;
export const HOME_NEARBY_MIN_DISPLAY = 4;
export const HOME_NEARBY_FALLBACK_MIN = 3;
export const HOME_NEARBY_FALLBACK_MAX = 8;
export const HOME_NEARBY_ULTIMATE_MIN = 3;

/** 最寬鬆 fallback：真實 Google place、非永久排除、距離內即可 */
export function selectHomeNearbyUltimateFallback<T extends HomeNearbyFilterPlace>(
  places: T[],
  options?: {
    origin?: { lat: number; lng: number };
    maxDistanceM?: number;
    minResults?: number;
    maxResults?: number;
    onDrop?: (place: T, reason: string) => void;
  },
): T[] {
  const minResults = options?.minResults ?? HOME_NEARBY_ULTIMATE_MIN;
  const maxResults = options?.maxResults ?? HOME_NEARBY_FALLBACK_MAX;
  const pool = dedupeWithinDistance(places, options?.origin, options?.maxDistanceM);
  const out: T[] = [];
  const seen = new Set<string>();

  for (const place of pool) {
    if (out.length >= maxResults) break;
    const id = (place.id ?? "").trim();
    if (!id || seen.has(id)) continue;

    const name = (place.name ?? "").trim();
    if (!name || name === "Unknown") {
      options?.onDrop?.(place, "missing_name");
      continue;
    }
    if (!passesHomeNearbyHardExclusions(place)) {
      options?.onDrop?.(place, homeNearbyHardExclusionReason(place) ?? "other");
      continue;
    }
    seen.add(id);
    out.push(place);
  }

  return out.slice(0, maxResults);
}

function withinHomeNearbyDistance(
  place: HomeNearbyFilterPlace,
  origin?: { lat: number; lng: number },
  maxM = HOME_NEARBY_MAX_DISTANCE_M,
): boolean {
  if (!origin) return true;
  if (place.lat == null || place.lng == null) return false;
  return distanceMeters(origin, { lat: place.lat, lng: place.lng }) <= maxM;
}

function dedupeWithinDistance<T extends HomeNearbyFilterPlace>(
  places: T[],
  origin?: { lat: number; lng: number },
  maxDistanceM = HOME_NEARBY_MAX_DISTANCE_M,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const place of places) {
    const id = (place.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    if (!withinHomeNearbyDistance(place, origin, maxDistanceM)) continue;
    seen.add(id);
    out.push(place);
  }
  return out;
}

function pickFromPool<T extends HomeNearbyFilterPlace>(
  pool: T[],
  picked: Set<string>,
  test: (place: T) => boolean,
  limit: number,
): T[] {
  const added: T[] = [];
  for (const place of pool) {
    if (added.length >= limit) break;
    const id = (place.id ?? "").trim();
    if (!id || picked.has(id)) continue;
    if (!test(place)) continue;
    picked.add(id);
    added.push(place);
  }
  return added;
}

function selectByLevels<T extends HomeNearbyFilterPlace>(
  pool: T[],
  period: HomeNearbyPeriod,
  options: {
    minResults: number;
    maxResults: number;
    includeLastResort?: boolean;
  },
): T[] {
  const picked = new Set<string>();
  const result: T[] = [];

  const add = (batch: T[]) => {
    for (const place of batch) {
      if (result.length >= options.maxResults) break;
      result.push(place);
    }
  };

  add(pickFromPool(pool, picked, (p) => passesHomeNearbyLevel1(p, period), options.maxResults));

  if (result.length < options.minResults) {
    add(
      pickFromPool(
        pool,
        picked,
        (p) => passesHomeNearbyLevel2(p, period),
        options.maxResults - result.length,
      ),
    );
  }

  if (result.length < options.minResults) {
    add(
      pickFromPool(
        pool,
        picked,
        (p) => passesHomeNearbyLevel3(p, period),
        options.maxResults - result.length,
      ),
    );
  }

  if (result.length < options.minResults) {
    add(
      pickFromPool(
        pool,
        picked,
        (p) => passesHomeNearbyLevel4(p, period),
        options.maxResults - result.length,
      ),
    );
  }

  if (options.includeLastResort && result.length < options.minResults) {
    add(
      pickFromPool(
        pool,
        picked,
        (p) => passesHomeNearbyLastResort(p),
        options.maxResults - result.length,
      ),
    );
  }

  return result.slice(0, options.maxResults);
}

/**
 * 首頁附近推薦選取：
 * Level 1 → 2 → 3 → 4（不含 0 評分 0 評論）
 */
export function selectHomeNearbyPicks<T extends HomeNearbyFilterPlace>(
  places: T[],
  options?: {
    origin?: { lat: number; lng: number };
    maxDistanceM?: number;
    minResults?: number;
    maxResults?: number;
    period?: HomeNearbyPeriod;
    at?: Date;
    timeZone?: string;
  },
): T[] {
  const minResults = options?.minResults ?? HOME_NEARBY_MIN_DISPLAY;
  const maxResults = options?.maxResults ?? HOME_NEARBY_TARGET_COUNT;
  const at = options?.at ?? new Date();
  const period =
    options?.period ?? homeNearbyPeriodFromHour(localHourInTimeZone(at, options?.timeZone));

  const pool = dedupeWithinDistance(
    places.filter(passesHomeNearbyHardExclusions),
    options?.origin,
    options?.maxDistanceM,
  );

  return selectByLevels(pool, period, {
    minResults,
    maxResults,
    includeLastResort: true,
  });
}

/** API 有回傳但 primary 選取不足時的 fallback（3–8 張，含 Level 4 + 最後手段） */
export function selectHomeNearbyFallbackPicks<T extends HomeNearbyFilterPlace>(
  places: T[],
  options?: {
    origin?: { lat: number; lng: number };
    maxDistanceM?: number;
    minResults?: number;
    maxResults?: number;
    period?: HomeNearbyPeriod;
    at?: Date;
    timeZone?: string;
  },
): T[] {
  const minResults = options?.minResults ?? HOME_NEARBY_FALLBACK_MIN;
  const maxResults = options?.maxResults ?? HOME_NEARBY_FALLBACK_MAX;
  const at = options?.at ?? new Date();
  const period =
    options?.period ?? homeNearbyPeriodFromHour(localHourInTimeZone(at, options?.timeZone));

  const pool = dedupeWithinDistance(
    places.filter(passesHomeNearbyHardExclusions),
    options?.origin,
    options?.maxDistanceM,
  );

  return selectByLevels(pool, period, {
    minResults,
    maxResults,
    includeLastResort: true,
  });
}

/** @deprecated 探索頁專用；首頁請用 selectHomeNearbyPicks */
export function filterHomeNearbyPlaceResults<T extends HomeNearbyFilterPlace>(
  places: T[],
  options?: {
    origin?: { lat: number; lng: number };
    maxDistanceM?: number;
    context?: string;
  },
): T[] {
  if (options?.context === "home_nearby") {
    return selectHomeNearbyPicks(places, {
      origin: options.origin,
      maxDistanceM: options.maxDistanceM,
    });
  }
  return dedupeWithinDistance(places, options?.origin, options?.maxDistanceM);
}

export function filterHomeNearbyPlacesLayered<T extends HomeNearbyFilterPlace>(
  places: T[],
  options?: {
    origin?: { lat: number; lng: number };
    minResults?: number;
    maxDistanceM?: number;
    at?: Date;
  },
): T[] {
  return selectHomeNearbyPicks(places, {
    origin: options?.origin,
    minResults: options?.minResults ?? HOME_NEARBY_TARGET_COUNT,
    maxDistanceM: options?.maxDistanceM,
    at: options?.at,
  });
}

export function sortHomeNearbyPlaces<T extends HomeNearbyFilterPlace>(
  places: T[],
  origin: { lat: number; lng: number },
): T[] {
  return [...places].sort((a, b) => {
    const openA = a.openStatus === "open" || a.openStatus === "closing_soon" ? 0 : 1;
    const openB = b.openStatus === "open" || b.openStatus === "closing_soon" ? 0 : 1;
    if (openA !== openB) return openA - openB;

    const ratingA = a.rating ?? 0;
    const ratingB = b.rating ?? 0;
    if (ratingA !== ratingB) return ratingB - ratingA;

    const countA = a.userRatingCount ?? 0;
    const countB = b.userRatingCount ?? 0;
    if (countA !== countB) return countB - countA;

    const distA =
      a.lat != null && a.lng != null
        ? distanceMeters(origin, { lat: a.lat, lng: a.lng })
        : Number.POSITIVE_INFINITY;
    const distB =
      b.lat != null && b.lng != null
        ? distanceMeters(origin, { lat: b.lat, lng: b.lng })
        : Number.POSITIVE_INFINITY;
    return distA - distB;
  });
}
