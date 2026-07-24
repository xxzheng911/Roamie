import { filterByExploreCategory } from "@/lib/place-category";
import type { Locale } from "@/lib/i18n/types";
import type { ExploreCategory } from "@/lib/places-search-config";
import type { PlaceResult } from "@/lib/place-result";
import type { ExploreMapSelectionMeta } from "@/lib/explore-map-hints";
import {
  EXPLORE_MAP_MAX_DISPLAY,
  EXPLORE_MAP_MIN_DISPLAY,
  EXPLORE_CITY_CATEGORY_MIN_DISPLAY,
  applyExploreTierDisplayFields,
  classifyExploreMapQualityTier,
  exploreMapQualityScore,
  filterCoffeeExplorePlaces,
  filterCityExploreCategoryPlaces,
  passesExploreHardExclusions,
  withinExploreCategoryDistance,
  type ExploreMapQualityTier,
} from "@/lib/explore-places-eligibility";

export {
  EXPLORE_MAP_MIN_DISPLAY,
  EXPLORE_MAP_MAX_DISPLAY,
  EXPLORE_CITY_CATEGORY_MIN_DISPLAY,
} from "@/lib/explore-places-eligibility";

export type ExploreMapPlaceSelection<T extends PlaceResult = PlaceResult> = {
  places: T[];
  meta: ExploreMapSelectionMeta;
};

/** 探索地圖：分類 + 分層品質 + 距離，回傳 3–10 個地點 */
export function filterAndSelectExploreMapPlaces<T extends PlaceResult>(
  places: T[],
  options: {
    cat: ExploreCategory | string;
    origin: { lat: number; lng: number };
    categoryId?: string;
    minResults?: number;
    maxResults?: number;
    maxDistanceM?: number;
    locale?: Locale;
    cityMode?: boolean;
  },
): ExploreMapPlaceSelection<T> {
  const categoryId =
    options.categoryId ??
    (typeof options.cat === "string" ? options.cat : options.cat.id);
  const cityMode = options.cityMode === true;
  const minResults =
    options.minResults ??
    (cityMode ? EXPLORE_CITY_CATEGORY_MIN_DISPLAY : EXPLORE_MAP_MIN_DISPLAY);
  const maxResults = options.maxResults ?? (options.cityMode ? 20 : EXPLORE_MAP_MAX_DISPLAY);
  const maxDistanceM = options.maxDistanceM;
  const locale = options.locale ?? "zh-TW";
  const hardExcludeOpts = cityMode ? { cityMode: true } : undefined;
  const scoreOpts = cityMode ? { cityMode: true } : undefined;
  const tierOpts = cityMode ? { cityMode: true } : undefined;

  const categoryFilter = cityMode
    ? (list: T[]) => filterCityExploreCategoryPlaces(list, categoryId)
    : categoryId === "coffee"
      ? (list: T[]) => filterCoffeeExplorePlaces(list)
      : (list: T[]) => filterByExploreCategory(list, options.cat);

  const basePool = categoryFilter(places)
    .filter((place) => passesExploreHardExclusions(place, categoryId, hardExcludeOpts))
    .filter((place) =>
      withinExploreCategoryDistance(place, options.origin, categoryId, maxDistanceM),
    );

  const tierPools: Record<ExploreMapQualityTier, T[]> = { 1: [], 2: [], 3: [] };
  for (const place of basePool) {
    const tier = classifyExploreMapQualityTier(place, categoryId, tierOpts);
    if (tier == null) continue;
    tierPools[tier].push(place);
  }

  for (const tier of [1, 2, 3] as const) {
    tierPools[tier].sort(
      (a, b) =>
        exploreMapQualityScore(b, options.origin, categoryId, tier, scoreOpts) -
        exploreMapQualityScore(a, options.origin, categoryId, tier, scoreOpts),
    );
  }

  const seen = new Set<string>();
  const picked: T[] = [];
  let hasTier2 = false;
  let hasTier3 = false;
  let lowestTier: ExploreMapQualityTier | null = null;

  const tryPickFromTier = (tier: ExploreMapQualityTier) => {
    for (const place of tierPools[tier]) {
      if (picked.length >= maxResults) break;
      const id = (place.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      picked.push(
        applyExploreTierDisplayFields({ ...place, exploreQualityTier: tier }, tier, locale),
      );
      if (tier === 2) hasTier2 = true;
      if (tier === 3) hasTier3 = true;
      lowestTier =
        lowestTier == null ? tier : (Math.max(lowestTier, tier) as ExploreMapQualityTier);
    }
  };

  for (const tier of [1, 2, 3] as const) {
    tryPickFromTier(tier);
    if (picked.length >= minResults) break;
  }

  if (picked.length < minResults && basePool.length > 0) {
    const sortedFallback = [...basePool].sort(
      (a, b) =>
        exploreMapQualityScore(b, options.origin, categoryId, 3, scoreOpts) -
        exploreMapQualityScore(a, options.origin, categoryId, 3, scoreOpts),
    );
    for (const place of sortedFallback) {
      if (picked.length >= minResults) break;
      const id = (place.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      picked.push(
        applyExploreTierDisplayFields({ ...place, exploreQualityTier: 3 }, 3, locale),
      );
      hasTier3 = true;
      lowestTier = 3;
    }
  }

  return {
    places: picked,
    meta: { lowestTier, hasTier2, hasTier3 },
  };
}

/** 分類 strict 篩選為 0 時：保留距離內、通過硬排除的地點（降級品質門檻） */
export function pickRelaxedExploreCategoryPlaces<T extends PlaceResult>(
  places: T[],
  options: {
    cat: ExploreCategory | string;
    origin: { lat: number; lng: number };
    categoryId?: string;
    maxDistanceM?: number;
    maxResults?: number;
    locale?: Locale;
    cityMode?: boolean;
  },
): T[] {
  const categoryId =
    options.categoryId ??
    (typeof options.cat === "string" ? options.cat : options.cat.id);
  const locale = options.locale ?? "zh-TW";
  const maxResults = options.maxResults ?? EXPLORE_MAP_MAX_DISPLAY;
  const cityMode = options.cityMode === true;
  const hardExcludeOpts = cityMode ? { cityMode: true } : undefined;
  const scoreOpts = cityMode ? { cityMode: true } : undefined;
  const categoryFilter = cityMode
    ? (list: T[]) => filterCityExploreCategoryPlaces(list, categoryId)
    : categoryId === "coffee"
      ? (list: T[]) => filterCoffeeExplorePlaces(list)
      : (list: T[]) => filterByExploreCategory(list, options.cat);

  const pool = categoryFilter(places)
    .filter((place) => passesExploreHardExclusions(place, categoryId, hardExcludeOpts))
    .filter((place) =>
      withinExploreCategoryDistance(place, options.origin, categoryId, options.maxDistanceM),
    )
    .sort(
      (a, b) =>
        exploreMapQualityScore(b, options.origin, categoryId, 3, scoreOpts) -
        exploreMapQualityScore(a, options.origin, categoryId, 3, scoreOpts),
    );

  return pool.slice(0, maxResults).map((place) =>
    applyExploreTierDisplayFields({ ...place, exploreQualityTier: 3 }, 3, locale),
  );
}

/** @deprecated 改用 filterAndSelectExploreMapPlaces */
export function selectExploreMapFallbackPicks<T extends PlaceResult>(
  places: T[],
  options: {
    cat?: ExploreCategory | string;
    categoryId?: string;
    origin?: { lat: number; lng: number };
    minResults?: number;
    maxResults?: number;
  },
): T[] {
  if (!options.origin) return [];
  const cat = options.cat ?? options.categoryId ?? "all";
  return filterAndSelectExploreMapPlaces(places, {
    cat,
    origin: options.origin,
    categoryId: options.categoryId,
    minResults: options.minResults,
    maxResults: options.maxResults,
  }).places;
}
