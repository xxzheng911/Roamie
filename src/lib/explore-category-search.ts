import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { SavedPlace } from "@/lib/places-storage";
import {
  getExploreCategoryById,
  EXPLORE_ALL_SUBCATEGORY_IDS,
} from "@/lib/places-search-config";
import { normalizedLocationKey } from "@/lib/location-key";
import {
  buildExploreRequestKey,
  getExploreRequestInFlight,
  markExploreRequestStarted,
  registerExploreRequestInFlight,
  shouldLogExploreEvent,
  shouldThrottleExploreRequest,
} from "@/lib/explore-request-guard";
import {
  buildMapPlacesCacheKey,
  readMapPlacesCache,
  writeMapPlacesCache,
} from "@/lib/map-places-cache";
import { allowDemoPlaceFallback } from "@/lib/search-radius";
import {
  exploreCategoryMaxDistanceMeters,
  exploreCategorySearchRadiusMeters,
} from "@/lib/explore-search-radius";
import {
  getExploreTextFallbackQueries,
  type ExploreCategory,
} from "@/lib/places-search-config";
import {
  filterByExploreCategory,
  matchesCategory,
} from "@/lib/place-category";
import {
  EXPLORE_MAP_MIN_DISPLAY,
  filterAndSelectExploreMapPlaces,
} from "@/lib/explore-map-places-filter";
import {
  filterHomeNearbyPlaceResults,
  selectHomeNearbyPicks,
} from "@/lib/home-nearby-places-filter";
import {
  cityCategoryTextQueries,
  cityRecommendMaxDistanceMeters,
  cityRecommendSearchRadiusMeters,
  exploreCategoryTextQueries,
  logExploreFilterResult,
  logExplorePlacesRaw,
  type ExploreRecommendMode,
} from "@/lib/explore-recommend-mode";
import { EXPLORE_MAX_FALLBACK_QUERIES } from "@/lib/explore-api-budget";
import { mergeExploreAllCategoryResults } from "@/lib/explore-all-places-merge";
import { exploreTimeBucket } from "@/lib/explore-time-bucket";
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
import { placesStatsPayload, type PlacesScreen } from "@/lib/places-api-stats";

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
  placesCaller?: string;
  placesScreen?: PlacesScreen;
};

export type SearchPlacesFn = (
  args: { data: SearchPlacesInput },
) => Promise<{ places: PlaceResult[]; error: string | null }>;

const HOME_TEXT_FALLBACK_QUERIES: Record<string, readonly string[]> = {
  night: ["酒吧", "居酒屋", "宵夜", "夜市", "深夜咖啡"],
  food: ["餐廳", "小吃", "火鍋", "燒肉", "壽司", "在地特色"],
  district: ["商圈", "百貨", "市集", "購物街區"],
  coffee: ["咖啡廳", "景觀咖啡", "老宅咖啡", "甜點"],
};

const COFFEE_NEARBY_TEXT_QUERIES = [
  "咖啡廳",
  "景觀咖啡",
  "老宅咖啡",
  "甜點",
  "高雄 咖啡廳",
] as const;

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
  locationKey?: string;
  logDrop: boolean;
  quiet?: boolean;
  locale?: Locale;
};

function countExploreFilteredPlaces(
  list: PlaceResult[],
  options: ExploreFilterOptions,
): number {
  return filterPlacesForExploreCategory(list, { ...options, quiet: true }).length;
}

function filterPlacesForHomeNearbyCategory(
  list: PlaceResult[],
  options: ExploreFilterOptions,
): PlaceResult[] {
  const { cat, userLocation } = options;
  return selectHomeNearbyPicks(filterByExploreCategory(list, cat), {
    origin: userLocation,
    minResults: 1,
  });
}

function filterPlacesForExploreCategory(
  list: PlaceResult[],
  options: ExploreFilterOptions,
): PlaceResult[] {
  if (options.forHome) {
    return filterPlacesForHomeNearbyCategory(list, options);
  }

  const maxDistanceM = options.cityMode
    ? cityRecommendMaxDistanceMeters()
    : exploreCategoryMaxDistanceMeters(options.cat.id);

  const selection = filterAndSelectExploreMapPlaces(list, {
    cat: options.cat,
    origin: options.userLocation,
    categoryId: options.cat.id,
    maxDistanceM,
    locale: options.locale,
  });

  if (
    selection.places.length === 0 &&
    list.length > 0 &&
    options.cat.id === "coffee" &&
    maxDistanceM < 8_000
  ) {
    const expanded = filterAndSelectExploreMapPlaces(list, {
      cat: options.cat,
      origin: options.userLocation,
      categoryId: options.cat.id,
      maxDistanceM: 8_000,
      locale: options.locale,
    });
    if (expanded.places.length > 0) {
      if (!options.quiet) {
        logExploreFilterResult(
          list.length,
          expanded.places.length,
          false,
          options.cat.id,
          options.locale ?? "zh-TW",
          options.locationKey ?? normalizedLocationKey(options.userLocation.lat, options.userLocation.lng),
        );
      }
      return expanded.places;
    }
  }

  if (!options.quiet) {
    logExploreFilterResult(
      list.length,
      selection.places.length,
      false,
      options.cat.id,
      options.locale ?? "zh-TW",
      options.locationKey ?? normalizedLocationKey(options.userLocation.lat, options.userLocation.lng),
    );
  }
  return selection.places;
}

async function runSingleTextFallback(
  basePayload: { lat: number; lng: number; radius: number },
  textQuery: string,
  cat: ExploreCategory,
  locale: Locale,
  searchPlacesFn: SearchPlacesFn,
  screen: PlacesScreen,
): Promise<PlaceResult[]> {
  const fallback = await withSearchTimeout(
    searchPlacesFn({
      data: {
        ...basePayload,
        query: textQuery,
        mode: "text",
        locale,
        categoryId: cat.id,
        ...placesStatsPayload({
          placesCaller: "runSingleTextFallback",
          placesScreen: screen,
          categoryId: cat.id,
        }),
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
  const maxSavedDistance = cityMode
    ? cityRecommendMaxDistanceMeters()
    : exploreCategoryMaxDistanceMeters(cat.id);
  const filterOpts: ExploreFilterOptions = {
    cat,
    forHome: ctx.forHome,
    cityMode,
    filterContext,
    exploreFilterContext,
    userLocation: ctx.userLocation,
    locationKey: normalizedLocationKey(ctx.userLocation.lat, ctx.userLocation.lng),
    logDrop: false,
    locale: ctx.locale,
    quiet: true,
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
  placesScreen: PlacesScreen = "explore",
): Promise<PlaceResult[]> {
  const key = buildExploreRawPoolKey(userLocation.lat, userLocation.lng, recommendMode, locale, "all");
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
      radius: radius ?? exploreCategorySearchRadiusMeters("all"),
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
          ...placesStatsPayload({
            placesCaller: "ensureExploreRawPool",
            placesScreen,
            categoryId: "all",
          }),
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
  timeBucket = exploreTimeBucket(),
): string {
  return `${locationKey}:${categoryId}:${locale}:${forHome ? "home" : "explore"}:${mode}:${timeBucket}`;
}

async function searchExploreAllPlacesMerged(
  ctx: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    locale: Locale;
    reasonProfile: UserProfileForReason | null;
    saved: SavedPlace[];
    searchPlacesFn: SearchPlacesFn;
    recommendMode: ExploreRecommendMode;
    cityLabel?: string;
  },
): Promise<ExplorePlaceCard[]> {
  const { userLocation, locale, recommendMode } = ctx;
  const timeBucket = exploreTimeBucket();
  const mapMode = recommendMode === "city" ? "city" : "nearby";
  const allKey = buildMapPlacesCacheKey({
    lat: userLocation.lat,
    lng: userLocation.lng,
    categoryId: "all",
    locale,
    mode: mapMode,
    timeBucket,
  });

  const cachedAll = readMapPlacesCache(allKey);
  const hasAllSubCaches = EXPLORE_ALL_SUBCATEGORY_IDS.every((subId) => {
    const subKey = buildMapPlacesCacheKey({
      lat: userLocation.lat,
      lng: userLocation.lng,
      categoryId: subId,
      locale,
      mode: mapMode,
      timeBucket,
    });
    const sub = readMapPlacesCache(subKey);
    return (sub?.places.length ?? 0) > 0;
  });
  if (cachedAll?.places.length && hasAllSubCaches) {
    return cachedAll.places as ExplorePlaceCard[];
  }

  const cardsByCategory: Partial<Record<string, ExplorePlaceCard[]>> = {};
  const missingSubIds: string[] = [];

  for (const subId of EXPLORE_ALL_SUBCATEGORY_IDS) {
    const subKey = buildMapPlacesCacheKey({
      lat: userLocation.lat,
      lng: userLocation.lng,
      categoryId: subId,
      locale,
      mode: mapMode,
      timeBucket,
    });
    const cachedSub = readMapPlacesCache(subKey);
    if (cachedSub?.places.length) {
      cardsByCategory[subId] = cachedSub.places as ExplorePlaceCard[];
    } else {
      missingSubIds.push(subId);
    }
  }

  await Promise.all(
    missingSubIds.map(async (subId) => {
      const subCat = getExploreCategoryById(subId);
      if (!subCat) return;
      cardsByCategory[subId] = await searchExploreCategoryPlaces(subCat, {
        ...ctx,
        forHome: false,
        recommendMode,
      });
    }),
  );

  const merged = mergeExploreAllCategoryResults(cardsByCategory, {
    origin: userLocation,
    timeBucket,
  });

  writeMapPlacesCache(allKey, merged, null);
  return merged;
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
    timeBucket: exploreTimeBucket(),
  });
  if (readMapPlacesCache(mapKey)) return;

  const exploreFiltered = filterPlacesForExploreCategory(apiPlaces, {
    cat,
    forHome: false,
    cityMode: false,
    filterContext: "explore_map",
    exploreFilterContext: "explore_map",
    userLocation: ctx.userLocation,
    logDrop: false,
    locale: ctx.locale,
  });

  const nearbySaved = savedPlacesNear(
    ctx.userLocation,
    ctx.saved,
    exploreCategoryMaxDistanceMeters(cat.id),
  );
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
  const timeBucket = exploreTimeBucket();
  const flightKey = categorySearchFlightKey(
    locationKey,
    cat.id,
    locale,
    forHome,
    recommendMode,
    timeBucket,
  );

  if (!forHome && cat.id === "all") {
    const inflightAll = categorySearchInFlight.get(flightKey);
    if (inflightAll) return inflightAll;
    const promise = searchExploreAllPlacesMerged({
      userLocation,
      weather,
      locale,
      reasonProfile,
      saved,
      searchPlacesFn,
      recommendMode,
      cityLabel: ctx.cityLabel,
    }).finally(() => {
      categorySearchInFlight.delete(flightKey);
    });
    categorySearchInFlight.set(flightKey, promise);
    return promise;
  }

  if (!forHome) {
    const requestKey = buildExploreRequestKey(cat.id, locationKey, locale, timeBucket);
    const mapKey = buildMapPlacesCacheKey({
      lat: userLocation.lat,
      lng: userLocation.lng,
      categoryId: cat.id,
      locale,
      mode: recommendMode,
      timeBucket,
    });
    const mapCached = readMapPlacesCache(mapKey);
    if (mapCached?.places.length) {
      return mapCached.places as ExplorePlaceCard[];
    }

    const inflightRequest = getExploreRequestInFlight<ExplorePlaceCard[]>(requestKey);
    if (inflightRequest) return inflightRequest;
  }

  const inflight = categorySearchInFlight.get(flightKey);
  if (inflight) return inflight;

  const requestKey =
    forHome ? null : buildExploreRequestKey(cat.id, locationKey, locale, timeBucket);

  const promise = (async () => {
    return searchExploreCategoryPlacesInner(cat, {
      ...ctx,
      forHome,
      recommendMode,
      cityLabel: ctx.cityLabel,
    });
  })().finally(() => {
    categorySearchInFlight.delete(flightKey);
  });

  categorySearchInFlight.set(flightKey, promise);
  if (requestKey) {
    return registerExploreRequestInFlight(requestKey, promise);
  }
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
    quiet?: boolean;
  },
): Promise<ExplorePlaceCard[]> {
  const { userLocation, weather, locale, reasonProfile, saved, searchPlacesFn, forHome } = ctx;
  const locationKey = normalizedLocationKey(userLocation.lat, userLocation.lng);
  const exploreRequestKey = forHome
    ? null
    : buildExploreRequestKey(cat.id, locationKey, locale, exploreTimeBucket());
  const requestThrottled =
    exploreRequestKey != null && shouldThrottleExploreRequest(exploreRequestKey);
  const quiet = ctx.quiet === true || requestThrottled;
  const placesScreen: PlacesScreen = forHome ? "home" : "explore";
  const cityMode = !ctx.forHome && ctx.recommendMode === "city";
  const filterContext = cityMode ? "explore_map_city" : ctx.forHome ? "home_nearby" : "explore_map";
  const exploreFilterContext = cityMode ? "explore_map_city" : "explore_map";
  const maxSavedDistance = cityMode
    ? cityRecommendMaxDistanceMeters()
    : exploreCategoryMaxDistanceMeters(cat.id);
  const radius = cityMode
    ? cityRecommendSearchRadiusMeters()
    : exploreCategorySearchRadiusMeters(cat.id);
  const basePayload = {
    lat: userLocation.lat,
    lng: userLocation.lng,
    radius,
  };

  const rawPoolKey = buildExploreRawPoolKey(
    userLocation.lat,
    userLocation.lng,
    ctx.recommendMode,
    locale,
    cat.id,
  );
  let apiPlaces = readExploreRawPool(rawPoolKey) ?? [];
  let usedRawPool = apiPlaces.length > 0;

  const filterOpts: ExploreFilterOptions = {
    cat,
    forHome,
    cityMode,
    filterContext,
    exploreFilterContext,
    userLocation,
    locationKey,
    logDrop: cityMode,
    quiet,
    locale,
  };

  const needsPrimarySearch =
    !requestThrottled &&
    (!apiPlaces.length ||
      (!forHome && countExploreFilteredPlaces(apiPlaces, filterOpts) < EXPLORE_MAP_MIN_DISPLAY));

  if (needsPrimarySearch) {
    if (exploreRequestKey) markExploreRequestStarted(exploreRequestKey);
    const primary = await withSearchTimeout(
      searchPlacesFn({
        data: {
          ...basePayload,
          query: cat.query,
          mode: cat.mode,
          includedTypes: cat.includedTypes,
          nearbyGroups: cat.nearbyGroups,
          locale,
          categoryId: cat.id,
          ...placesStatsPayload({
            placesCaller: "searchExploreCategoryPlaces",
            placesScreen,
            categoryId: cat.id,
          }),
        },
      }),
    );
    const fresh = Array.isArray(primary.places) ? primary.places : [];
    if (fresh.length) {
      apiPlaces = mergePlacesById(apiPlaces, fresh);
      writeExploreRawPool(rawPoolKey, apiPlaces);
    }
  }

  logExplorePlacesRaw(apiPlaces.length, quiet, cat.id, locale, locationKey);

  let filtered = forHome
    ? filterPlacesForHomeNearbyCategory(apiPlaces, filterOpts)
    : filterPlacesForExploreCategory(apiPlaces, filterOpts);

  let fallbackQueriesUsed = 0;

  const tryFallback = async (textQuery: string | null) => {
    if (!textQuery?.trim() || fallbackQueriesUsed >= EXPLORE_MAX_FALLBACK_QUERIES) return;
    fallbackQueriesUsed += 1;
    const fallbackPlaces = await runSingleTextFallback(
      basePayload,
      textQuery.trim(),
      cat,
      locale,
      searchPlacesFn,
      placesScreen,
    );
    if (fallbackPlaces.length > 0) {
      apiPlaces = mergePlacesById(apiPlaces, fallbackPlaces);
      mergeIntoExploreRawPool(rawPoolKey, fallbackPlaces);
      logExplorePlacesRaw(apiPlaces.length, quiet, cat.id, locale, locationKey);
      filtered = forHome
        ? filterPlacesForHomeNearbyCategory(apiPlaces, filterOpts)
        : filterPlacesForExploreCategory(apiPlaces, filterOpts);
    }
  };

  const runTextFallbackQueries = async (queries: readonly string[]) => {
    for (const q of queries) {
      if (fallbackQueriesUsed >= EXPLORE_MAX_FALLBACK_QUERIES) break;
      if (!forHome && filtered.length >= EXPLORE_MAP_MIN_DISPLAY) break;
      await tryFallback(q);
    }
  };

  const cityLabel = ctx.cityLabel?.trim() || "";
  if (forHome && apiPlaces.length === 0 && !usedRawPool) {
    await runTextFallbackQueries(HOME_TEXT_FALLBACK_QUERIES[cat.id] ?? []);
  } else if (!forHome && !requestThrottled && filtered.length < EXPLORE_MAP_MIN_DISPLAY) {
    const cityQueries = cityMode
      ? cityCategoryTextQueries(cat.id, cityLabel)
      : exploreCategoryTextQueries(cat.id, userLocation, cityLabel);
    const queries =
      cat.id === "coffee" && !cityMode
        ? [...COFFEE_NEARBY_TEXT_QUERIES, ...cityQueries]
        : cityQueries;
    await runTextFallbackQueries(queries);
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

  if (enriched.length === 0 && !quiet) {
    console.info("[explore] no places for category", cat.id);
  }

  const filteredEnriched =
    forHome || cityMode
      ? filterHomeNearbyPlaceResults(enriched, {
          origin: forHome || cityMode ? userLocation : undefined,
          maxDistanceM: cityMode ? cityRecommendMaxDistanceMeters() : undefined,
          context: filterContext,
        })
      : enriched;

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
    timeBucket: exploreTimeBucket(),
  });
  const sorted = sortExploreCategoryPlaces(filteredEnriched, userLocation, cat.id);
  writeMapPlacesCache(mapKey, sorted, null);
  return sorted;
}

export type { HomeNearbyPick } from "@/lib/home-nearby-search";
export { homeNearbyLoadPeriodKey, loadHomeNearbyPicks } from "@/lib/home-nearby-search";

/** 探索地圖「全部」：聚合各子分類快取／搜尋結果 */
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
