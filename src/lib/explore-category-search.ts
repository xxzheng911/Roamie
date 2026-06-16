import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { SavedPlace } from "@/lib/places-storage";
import {
  getExploreCategoryById,
} from "@/lib/places-search-config";
import { shouldUseHomeNearbyFailureMocks } from "@/lib/home-nearby-fallback";
import { isVerifiedGooglePlaceId } from "@/lib/home-nearby-display";
import { normalizedLocationKey } from "@/lib/location-key";
import {
  buildMapPlacesCacheKey,
  readMapPlacesCache,
  writeMapPlacesCache,
} from "@/lib/map-places-cache";
import { logHomeNearbyDataReady, logPlacesCacheHit } from "@/lib/places-diagnostics";
import { allowDemoPlaceFallback, homeNearbySearchRadiusMeters } from "@/lib/search-radius";
import {
  getExploreTextFallbackQueries,
  type ExploreCategory,
} from "@/lib/places-search-config";
import {
  filterByExploreCategory,
  matchesCategory,
} from "@/lib/place-category";
import { filterExplorePlaces } from "@/lib/filter-explore-places";
import { filterHomeNearbyPlaceResults } from "@/lib/home-nearby-places-filter";
import {
  cityCategoryTextQueries,
  cityRecommendMaxDistanceMeters,
  cityRecommendSearchRadiusMeters,
  logExploreFilterResult,
  logExplorePlacesRaw,
  type ExploreRecommendMode,
} from "@/lib/explore-recommend-mode";
import { EXPLORE_MAX_FALLBACK_QUERIES, firstFallbackQuery } from "@/lib/explore-api-budget";
import {
  buildExploreRawPoolKey,
  mergeIntoExploreRawPool,
  readExploreRawPool,
  writeExploreRawPool,
} from "@/lib/explore-raw-places-pool";
import {
  sortExploreCategoryPlaces,
  sortHomeNearbyPlacesWithContext,
} from "@/lib/home-nearby-ranking";
import { distanceMeters, savedPlacesNear } from "@/lib/map-explore";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import { buildUnifiedPlaceCard } from "@/lib/unified-place-card";
import type { WeatherSummary } from "@/lib/weather-types";
import { getMockHomeNearbyPicks, getMockPlacesForCategory } from "@/lib/map-mock-places";
import { withSearchTimeout } from "@/lib/search-timeout";

export type ExplorePlaceCard = PlaceResult & {
  reason: string;
  isSavedFavorite?: boolean;
};

export type SearchPlacesInput = {
  lat: number;
  lng: number;
  radius?: number;
  query: string;
  mode: "text" | "nearby" | "multi";
  includedTypes?: string[];
  nearbyGroups?: string[][];
  locale?: Locale;
  /** 探索分類 id（cache / log 用） */
  categoryId?: string;
};

export type SearchPlacesFn = (
  args: { data: SearchPlacesInput },
) => Promise<{ places: PlaceResult[]; error: string | null }>;

const HOME_TEXT_FALLBACK_QUERIES: Record<string, readonly string[]> = {
  night: ["酒吧", "居酒屋", "宵夜", "夜市", "深夜咖啡"],
  food: ["餐廳", "小吃", "火鍋", "燒肉", "壽司", "在地特色"],
  district: ["商圈", "百貨", "市集", "購物街區"],
  coffee: ["咖啡廳", "景觀咖啡", "甜點", "老宅咖啡"],
};

function mergePlacesById(base: PlaceResult[], extra: PlaceResult[]): PlaceResult[] {
  const seen = new Set(base.map((p) => p.id));
  const merged = [...base];
  for (const p of extra) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      merged.push(p);
    }
  }
  return merged;
}

type ExploreFilterOptions = {
  cat: ExploreCategory;
  forHome: boolean;
  cityMode: boolean;
  filterContext: "home_nearby" | "explore_map" | "explore_map_city";
  exploreFilterContext: "explore_map" | "explore_map_city";
  userLocation: { lat: number; lng: number };
  logDrop: boolean;
};

function applyExploreCategoryFilters(
  list: PlaceResult[],
  options: ExploreFilterOptions,
  relax = false,
): PlaceResult[] {
  const { cat, forHome, cityMode, filterContext, exploreFilterContext, userLocation, logDrop } =
    options;
  const rawCount = list.length;
  const context = relax ? (cityMode ? "explore_map_city" : "explore_map") : exploreFilterContext;
  const filtered = filterHomeNearbyPlaceResults(
    filterByExploreCategory(
      filterExplorePlaces(list, { logDrop: relax ? false : logDrop, context }),
      cat,
    ),
    {
      categoryId: cat.id,
      caller: relax
        ? `searchExploreCategoryPlaces:${cat.id}:relaxed`
        : `searchExploreCategoryPlaces:${cat.id}`,
      origin: forHome || cityMode ? userLocation : undefined,
      maxDistanceM: cityMode ? cityRecommendMaxDistanceMeters() : undefined,
      context: relax ? (cityMode ? "explore_map_city" : "explore_map") : filterContext,
      logDrop: false,
    },
  );
  if (!relax) logExploreFilterResult(rawCount, filtered.length);
  return filtered;
}

function filterPlacesForExploreCategory(
  list: PlaceResult[],
  options: ExploreFilterOptions,
): PlaceResult[] {
  const strict = applyExploreCategoryFilters(list, options, false);
  if (strict.length > 0 || list.length === 0) return strict;
  console.info(`[EXPLORE_FILTER_RELAX] category=${options.cat.id} rawCount=${list.length}`);
  return applyExploreCategoryFilters(list, options, true);
}

async function runSingleTextFallback(
  basePayload: { lat: number; lng: number; radius: number },
  textQuery: string,
  cat: ExploreCategory,
  locale: Locale,
  searchPlacesFn: SearchPlacesFn,
): Promise<PlaceResult[]> {
  const fallback = await withSearchTimeout(
    searchPlacesFn({
      data: {
        ...basePayload,
        query: textQuery,
        mode: "text",
        locale,
        categoryId: cat.id,
      },
    }),
  );
  return Array.isArray(fallback.places) ? fallback.places : [];
}

/** 從 raw pool 本地篩選（切換分類時不重新打 API） */
export function buildExploreCardsFromRawPlaces(
  rawPlaces: PlaceResult[],
  cat: ExploreCategory,
  ctx: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    locale: Locale;
    reasonProfile: UserProfileForReason | null;
    saved: SavedPlace[];
    forHome: boolean;
    recommendMode: ExploreRecommendMode;
  },
): ExplorePlaceCard[] {
  const cityMode = !ctx.forHome && ctx.recommendMode === "city";
  const filterContext = cityMode ? "explore_map_city" : ctx.forHome ? "home_nearby" : "explore_map";
  const exploreFilterContext = cityMode ? "explore_map_city" : "explore_map";
  const maxSavedDistance = cityMode ? cityRecommendMaxDistanceMeters() : 5000;
  const filterOpts: ExploreFilterOptions = {
    cat,
    forHome: ctx.forHome,
    cityMode,
    filterContext,
    exploreFilterContext,
    userLocation: ctx.userLocation,
    logDrop: false,
  };

  const filtered = filterPlacesForExploreCategory(rawPlaces, filterOpts);
  const nearbySaved = ctx.forHome
    ? []
    : savedPlacesNear(ctx.userLocation, ctx.saved, maxSavedDistance);
  const apiNames = new Set(rawPlaces.map((p) => p.name));
  const savedCards: ExplorePlaceCard[] = nearbySaved
    .filter((s) => !apiNames.has(s.name))
    .filter((s) =>
      matchesCategory(
        { primaryType: s.category, name: s.name, types: s.category ? [s.category] : null },
        cat,
      ),
    )
    .map((s) =>
      buildUnifiedPlaceCard({
        place: savedToPlaceResult(s),
        categoryId: cat.id,
        isSavedFavorite: true,
        userLocation: ctx.userLocation,
        weather: ctx.weather,
        userProfile: ctx.reasonProfile,
        locale: ctx.locale,
      }),
    );

  const enriched: ExplorePlaceCard[] = [
    ...savedCards,
    ...filtered.map((p) =>
      buildUnifiedPlaceCard({
        place: p,
        categoryId: cat.id,
        userLocation: ctx.userLocation,
        weather: ctx.weather,
        userProfile: ctx.reasonProfile,
        locale: ctx.locale,
      }),
    ),
  ];

  return ctx.forHome
    ? sortHomeNearbyPlacesWithContext(enriched, ctx.userLocation, { weather: ctx.weather })
    : sortExploreCategoryPlaces(enriched, ctx.userLocation, cat.id);
}

function savedToPlaceResult(s: SavedPlace): PlaceResult {
  return {
    id: `saved-${s.id}`,
    name: s.name,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    rating: null,
    userRatingCount: null,
    photoName: null,
    primaryType: s.category,
    types: s.category ? [s.category] : null,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

const categorySearchInFlight = new Map<string, Promise<ExplorePlaceCard[]>>();
const rawPoolInFlight = new Map<string, Promise<PlaceResult[]>>();

/** 單次 multi-nearby 填滿 raw pool，首頁與探索分類切換共用 */
export async function ensureExploreRawPool(
  userLocation: { lat: number; lng: number },
  recommendMode: ExploreRecommendMode,
  searchPlacesFn: SearchPlacesFn,
  locale: Locale,
  radius?: number,
): Promise<PlaceResult[]> {
  const key = buildExploreRawPoolKey(userLocation.lat, userLocation.lng, recommendMode);
  const existing = readExploreRawPool(key);
  if (existing?.length) return existing;

  const inflight = rawPoolInFlight.get(key);
  if (inflight) return inflight;

  const allCat = getExploreCategoryById("all");
  if (!allCat) return [];

  const promise = (async () => {
    const basePayload = {
      lat: userLocation.lat,
      lng: userLocation.lng,
      radius: radius ?? homeNearbySearchRadiusMeters(),
    };
    const primary = await withSearchTimeout(
      searchPlacesFn({
        data: {
          ...basePayload,
          query: allCat.query,
          mode: allCat.mode,
          nearbyGroups: allCat.nearbyGroups,
          locale,
          categoryId: "all",
        },
      }),
    );
    const places = Array.isArray(primary.places) ? primary.places : [];
    if (places.length) writeExploreRawPool(key, places);
    return places;
  })().finally(() => {
    rawPoolInFlight.delete(key);
  });

  rawPoolInFlight.set(key, promise);
  return promise;
}

function categorySearchFlightKey(
  locationKey: string,
  categoryId: string,
  locale: Locale,
  forHome: boolean,
  mode: ExploreRecommendMode = "nearby",
): string {
  return `${locationKey}:${categoryId}:${locale}:${forHome ? "home" : "explore"}:${mode}`;
}

function warmMapCategoryCache(
  cat: ExploreCategory,
  ctx: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    locale: Locale;
    reasonProfile: UserProfileForReason | null;
    saved: SavedPlace[];
  },
  apiPlaces: PlaceResult[],
): void {
  const mapKey = buildMapPlacesCacheKey({
    lat: ctx.userLocation.lat,
    lng: ctx.userLocation.lng,
    categoryId: cat.id,
    locale: ctx.locale,
  });
  if (readMapPlacesCache(mapKey)) return;

  const exploreFiltered = filterHomeNearbyPlaceResults(
    filterByExploreCategory(filterExplorePlaces(apiPlaces, { logDrop: false }), cat),
    {
      categoryId: cat.id,
      caller: `warmMapCategoryCache:${cat.id}`,
      context: "explore_map",
      logDrop: false,
    },
  );

  const nearbySaved = savedPlacesNear(ctx.userLocation, ctx.saved, 5000);
  const apiNames = new Set(apiPlaces.map((p) => p.name));
  const savedCards: ExplorePlaceCard[] = nearbySaved
    .filter((s) => !apiNames.has(s.name))
    .filter((s) =>
      matchesCategory(
        { primaryType: s.category, name: s.name, types: s.category ? [s.category] : null },
        cat,
      ),
    )
    .map((s) =>
      buildUnifiedPlaceCard({
        place: savedToPlaceResult(s),
        categoryId: cat.id,
        isSavedFavorite: true,
        userLocation: ctx.userLocation,
        weather: ctx.weather,
        userProfile: ctx.reasonProfile,
        locale: ctx.locale,
      }),
    );

  const exploreCards: ExplorePlaceCard[] = [
    ...savedCards,
    ...exploreFiltered.map((p) =>
      buildUnifiedPlaceCard({
        place: p,
        categoryId: cat.id,
        userLocation: ctx.userLocation,
        weather: ctx.weather,
        userProfile: ctx.reasonProfile,
        locale: ctx.locale,
      }),
    ),
  ];

  const sorted = sortExploreCategoryPlaces(exploreCards, ctx.userLocation, cat.id);
  writeMapPlacesCache(mapKey, sorted, null);
}

/** 與探索地圖單一分類搜尋相同的篩選、補齊、排序邏輯 */
export async function searchExploreCategoryPlaces(
  cat: ExploreCategory,
  ctx: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    locale: Locale;
    reasonProfile: UserProfileForReason | null;
    saved: SavedPlace[];
    searchPlacesFn: SearchPlacesFn;
    forHome?: boolean;
    recommendMode?: ExploreRecommendMode;
    cityLabel?: string;
  },
): Promise<ExplorePlaceCard[]> {
  const { userLocation, weather, locale, reasonProfile, saved, searchPlacesFn } = ctx;
  const forHome = ctx.forHome === true;
  const recommendMode = forHome ? "nearby" : (ctx.recommendMode ?? "nearby");
  const locationKey = normalizedLocationKey(userLocation.lat, userLocation.lng);
  const flightKey = categorySearchFlightKey(locationKey, cat.id, locale, forHome, recommendMode);

  if (!forHome) {
    const mapKey = buildMapPlacesCacheKey({
      lat: userLocation.lat,
      lng: userLocation.lng,
      categoryId: cat.id,
      locale,
      mode: recommendMode,
    });
    const mapCached = readMapPlacesCache(mapKey);
    if (mapCached?.places.length) {
      logPlacesCacheHit(mapKey, mapCached.places.length, "map_category");
      return mapCached.places as ExplorePlaceCard[];
    }
  }

  const inflight = categorySearchInFlight.get(flightKey);
  if (inflight) return inflight;

  const promise = searchExploreCategoryPlacesInner(cat, {
    ...ctx,
    forHome,
    recommendMode,
    cityLabel: ctx.cityLabel,
  }).finally(() => {
    categorySearchInFlight.delete(flightKey);
  });
  categorySearchInFlight.set(flightKey, promise);
  return promise;
}

async function searchExploreCategoryPlacesInner(
  cat: ExploreCategory,
  ctx: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    locale: Locale;
    reasonProfile: UserProfileForReason | null;
    saved: SavedPlace[];
    searchPlacesFn: SearchPlacesFn;
    forHome: boolean;
    recommendMode: ExploreRecommendMode;
    cityLabel?: string;
  },
): Promise<ExplorePlaceCard[]> {
  const { userLocation, weather, locale, reasonProfile, saved, searchPlacesFn, forHome } = ctx;
  const cityMode = !forHome && ctx.recommendMode === "city";
  const filterContext = cityMode ? "explore_map_city" : forHome ? "home_nearby" : "explore_map";
  const exploreFilterContext = cityMode ? "explore_map_city" : "explore_map";
  const radius = cityMode ? cityRecommendSearchRadiusMeters() : homeNearbySearchRadiusMeters();
  const maxSavedDistance = cityMode ? cityRecommendMaxDistanceMeters() : 5000;
  const basePayload = {
    lat: userLocation.lat,
    lng: userLocation.lng,
    radius,
  };

  const rawPoolKey = buildExploreRawPoolKey(userLocation.lat, userLocation.lng, ctx.recommendMode);
  let apiPlaces = readExploreRawPool(rawPoolKey) ?? [];
  let usedRawPool = apiPlaces.length > 0;

  if (!apiPlaces.length) {
    const primary = await withSearchTimeout(
      searchPlacesFn({
        data: {
          ...basePayload,
          query: cat.query,
          mode: cat.mode,
          includedTypes:
            cityMode && cat.id === "sight"
              ? [...(cat.includedTypes ?? []), "park", "point_of_interest"]
              : cat.includedTypes,
          nearbyGroups: cat.nearbyGroups,
          locale,
          categoryId: cat.id,
        },
      }),
    );
    apiPlaces = Array.isArray(primary.places) ? primary.places : [];
    if (apiPlaces.length) writeExploreRawPool(rawPoolKey, apiPlaces);
  }

  logExplorePlacesRaw(apiPlaces.length);

  const filterOpts: ExploreFilterOptions = {
    cat,
    forHome,
    cityMode,
    filterContext,
    exploreFilterContext,
    userLocation,
    logDrop: cityMode,
  };

  let filtered = filterPlacesForExploreCategory(apiPlaces, filterOpts);

  let fallbackQueriesUsed = 0;

  const tryFallback = async (textQuery: string | null) => {
    if (!textQuery || fallbackQueriesUsed >= EXPLORE_MAX_FALLBACK_QUERIES) return;
    fallbackQueriesUsed += 1;
    const fallbackPlaces = await runSingleTextFallback(
      basePayload,
      textQuery,
      cat,
      locale,
      searchPlacesFn,
    );
    if (fallbackPlaces.length > 0) {
      apiPlaces = mergePlacesById(apiPlaces, fallbackPlaces);
      mergeIntoExploreRawPool(rawPoolKey, fallbackPlaces);
      logExplorePlacesRaw(apiPlaces.length);
      filtered = filterPlacesForExploreCategory(apiPlaces, filterOpts);
    }
  };

  // 僅在 primary API 無 raw 結果時才 fallback；raw pool 有資料時不再加打 query
  if (apiPlaces.length === 0 && !usedRawPool) {
    const cityLabel = ctx.cityLabel?.trim() || "";
    if (cityMode) {
      await tryFallback(firstFallbackQuery(cityCategoryTextQueries(cat.id, cityLabel)));
    } else if (!forHome && cat.id === "coffee") {
      await tryFallback(firstFallbackQuery(getExploreTextFallbackQueries("coffee", userLocation)));
    } else if (!forHome && cat.id === "district") {
      await tryFallback(firstFallbackQuery(getExploreTextFallbackQueries("district", userLocation)));
    } else if (!forHome && cat.id === "night") {
      await tryFallback(firstFallbackQuery(getExploreTextFallbackQueries("night", userLocation)));
    } else if (forHome) {
      await tryFallback(firstFallbackQuery(HOME_TEXT_FALLBACK_QUERIES[cat.id] ?? []));
    }
  }

  const nearbySaved = forHome ? [] : savedPlacesNear(userLocation, saved, maxSavedDistance);
  const apiNames = new Set(apiPlaces.map((p) => p.name));
  const savedCards: ExplorePlaceCard[] = nearbySaved
    .filter((s) => !apiNames.has(s.name))
    .filter((s) =>
      matchesCategory(
        { primaryType: s.category, name: s.name, types: s.category ? [s.category] : null },
        cat,
      ),
    )
    .map((s) => {
      const base = savedToPlaceResult(s);
      return buildUnifiedPlaceCard({
        place: base,
        categoryId: cat.id,
        isSavedFavorite: true,
        userLocation,
        weather,
        userProfile: reasonProfile,
        locale,
      });
    });

  const enriched: ExplorePlaceCard[] = [
    ...savedCards,
    ...filtered.map((p) =>
      buildUnifiedPlaceCard({
        place: p,
        categoryId: cat.id,
        userLocation,
        weather,
        userProfile: reasonProfile,
        locale,
      }),
    ),
  ];

  if (enriched.length === 0 && allowDemoPlaceFallback() && !forHome) {
    const mocks = getMockPlacesForCategory(userLocation, cat).map((p) =>
      buildUnifiedPlaceCard({
        place: p,
        categoryId: cat.id,
        userLocation,
        weather,
        userProfile: reasonProfile,
        locale,
      }),
    );
    return forHome
      ? sortHomeNearbyPlacesWithContext(mocks, userLocation, { weather })
      : sortExploreCategoryPlaces(mocks, userLocation, cat.id);
  }

  if (enriched.length === 0) {
    console.info("[explore] no places for category", cat.id);
  }

  const filteredEnriched = filterHomeNearbyPlaceResults(enriched, {
    categoryId: cat.id,
    caller: `searchExploreCategoryPlaces:${cat.id}:final`,
    origin: forHome || cityMode ? userLocation : undefined,
    maxDistanceM: cityMode ? cityRecommendMaxDistanceMeters() : undefined,
    context: filterContext,
    logDrop: false,
  });

  if (forHome) {
    warmMapCategoryCache(cat, { userLocation, weather, locale, reasonProfile, saved }, apiPlaces);
    return sortHomeNearbyPlacesWithContext(filteredEnriched, userLocation, { weather });
  }

  const mapKey = buildMapPlacesCacheKey({
    lat: userLocation.lat,
    lng: userLocation.lng,
    categoryId: cat.id,
    locale,
    mode: cityMode ? "city" : "nearby",
  });
  const sorted = sortExploreCategoryPlaces(filteredEnriched, userLocation, cat.id);
  writeMapPlacesCache(mapKey, sorted, null);
  return sorted;
}

export type HomeNearbyPick = ExplorePlaceCard & {
  categoryId: string;
  displayCategory?: string;
  coverImageUrl?: string;
  distanceLabel?: string;
};

const PICKS_PER_CATEGORY = 2;

/** 探索地圖「全部」：僅單次查詢（不再依序查 4 子分類） */
export async function searchExploreAllPlaces(ctx: {
  userLocation: { lat: number; lng: number };
  weather: WeatherSummary | null;
  locale: Locale;
  reasonProfile: UserProfileForReason | null;
  saved: SavedPlace[];
  searchPlacesFn: SearchPlacesFn;
  locationKey?: string;
  recommendMode?: ExploreRecommendMode;
  cityLabel?: string;
}): Promise<ExplorePlaceCard[]> {
  const allCat = getExploreCategoryById("all");
  if (!allCat) return [];
  return searchExploreCategoryPlaces(allCat, { ...ctx, forHome: false });
}

/** 各探索分類依序取 1～2 筆；任一分類有結果即納入，全部 0 筆才空狀態 */
export async function loadHomeNearbyPicks(ctx: {
  userLocation: { lat: number; lng: number };
  weather: WeatherSummary | null;
  locale: Locale;
  reasonProfile: UserProfileForReason | null;
  saved: SavedPlace[];
  searchPlacesFn: SearchPlacesFn;
  categories: ExploreCategory[];
  locationKey?: string;
}): Promise<HomeNearbyPick[]> {
  await ensureExploreRawPool(
    ctx.userLocation,
    "nearby",
    ctx.searchPlacesFn,
    ctx.locale,
  );

  const deduped = new Map<string, HomeNearbyPick>();

  for (const cat of ctx.categories) {
    try {
      const sorted = await searchExploreCategoryPlaces(cat, { ...ctx, forHome: true });
      const picks = sorted
        .filter((p) => isVerifiedGooglePlaceId(p.id))
        .slice(0, PICKS_PER_CATEGORY)
        .map((p) => ({ ...p, categoryId: cat.id }));

      console.info("[HOME_NEARBY_CATEGORY]", {
        categoryId: cat.id,
        query: cat.query,
        count: picks.length,
        locationKey: ctx.locationKey ?? null,
      });

      for (const p of picks) {
        const prev = deduped.get(p.id);
        if (!prev) {
          deduped.set(p.id, p);
          continue;
        }
        if (prev.categoryId === "all" && p.categoryId !== "all") {
          deduped.set(p.id, p);
        }
      }
    } catch (e) {
      console.warn("[Roamie Home] category search failed", cat.id, e);
      if (allowDemoPlaceFallback() && shouldUseHomeNearbyFailureMocks()) {
        for (const p of getMockPlacesForCategory(ctx.userLocation, cat)
          .slice(0, PICKS_PER_CATEGORY)
          .map((mock) => ({ ...mock, categoryId: cat.id }))) {
          if (!deduped.has(p.id)) deduped.set(p.id, p);
        }
      }
    }
  }

  const sorted = sortHomeNearbyPlacesWithContext(
    filterHomeNearbyPlaceResults(
      [...deduped.values()],
      {
        caller: "loadHomeNearbyPicks:final",
        origin: ctx.userLocation,
        context: "home_nearby",
        logDrop: false,
      },
    ),
    ctx.userLocation,
    { weather: ctx.weather },
  );
  if (sorted.length > 0) {
    logHomeNearbyDataReady({
      count: sorted.length,
      lat: ctx.userLocation.lat,
      lng: ctx.userLocation.lng,
      locationKey: ctx.locationKey,
      sample: sorted.slice(0, 3).map((p) => p.name),
      categories: ctx.categories.map((c) => c.id),
      fromMock: false,
    });
    return sorted;
  }

  if (allowDemoPlaceFallback() && shouldUseHomeNearbyFailureMocks()) {
    console.info("[Roamie Home] nearby picks using failure fallback mocks (dev only)");
    const mocks = getMockHomeNearbyPicks(ctx.userLocation, ctx.categories, PICKS_PER_CATEGORY);
    logHomeNearbyDataReady({
      count: mocks.length,
      lat: ctx.userLocation.lat,
      lng: ctx.userLocation.lng,
      locationKey: ctx.locationKey,
      sample: mocks.slice(0, 3).map((p) => p.name),
      categories: ctx.categories.map((c) => c.id),
      fromMock: true,
      error: "api_empty_using_mocks",
    });
    return mocks;
  }
  console.info("[Roamie Home] nearby picks empty (no mock in production)");
  logHomeNearbyDataReady({
    count: 0,
    lat: ctx.userLocation.lat,
    lng: ctx.userLocation.lng,
    locationKey: ctx.locationKey,
    sample: [],
    categories: ctx.categories.map((c) => c.id),
    fromMock: false,
    error: "no_results",
  });
  return [];
}
