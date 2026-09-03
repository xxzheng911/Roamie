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
  normalizeExploreCityCacheKey,
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
  exploreCategoryMinDisplay,
} from "@/lib/explore-places-eligibility";
import {
  filterAndSelectExploreMapPlaces,
  pickRelaxedExploreCategoryPlaces,
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
  inferExploreCityLabel,
  logExploreFilterResult,
  logExplorePlacesRaw,
  type ExploreRecommendMode,
} from "@/lib/explore-recommend-mode";
import { exploreMaxFallbackQueries } from "@/lib/explore-api-budget";
import {
  fetchExploreCityBootstrapPlaces,
  fetchExploreCityCategoryPlaces,
  isCitySightExploreCategory,
} from "@/lib/explore-city-popular-places";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
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
  type ExploreCategorySortOptions,
} from "@/lib/home-nearby-ranking";
import {
  loadAuthorizedTabelogRankingCache,
  resolveExploreJapanContext,
} from "@/lib/tabelog-reference";
import { distanceMeters, savedPlacesNear } from "@/lib/map-explore";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import { buildUnifiedPlaceCard, buildUnifiedPlaceCards } from "@/lib/unified-place-card";
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
  /** 統一 Place Cache scope（選填） */
  cacheCountry?: string;
  cacheCity?: string;
  cachePlaceId?: string;
  cacheDestination?: string;
  destinationName?: string;
  searchMode?: "destination" | "nearby";
  skipLocationBias?: boolean;
  intentCategory?: string;
  planningSelectionStyle?: string;
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
  cityLabel?: string;
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

function resolveExploreCityLabel(
  userLocation: { lat: number; lng: number },
  cityLabel?: string,
): string {
  const raw = cityLabel?.trim() || "";
  if (raw) return normalizeDestinationLabel(raw);
  return normalizeDestinationLabel(
    inferExploreCityLabel(userLocation.lat, userLocation.lng, raw),
  );
}

function resolveExploreFoodSortOptions(
  categoryId: string,
  userLocation: { lat: number; lng: number },
  cityLabel?: string | null,
): ExploreCategorySortOptions | undefined {
  if (categoryId !== "food") return undefined;
  const label = resolveExploreCityLabel(userLocation, cityLabel ?? undefined);
  if (!resolveExploreJapanContext({ cityLabel: label })) return undefined;
  return {
    cityLabel: label,
    tabelogCache: loadAuthorizedTabelogRankingCache(label),
  };
}

function mergeExplorePlusSortOptions(
  categoryId: string,
  userLocation: { lat: number; lng: number },
  input: {
    reasonProfile: UserProfileForReason | null;
    saved: SavedPlace[];
    weather: WeatherSummary | null;
    cityLabel?: string | null;
  },
): ExploreCategorySortOptions {
  const savedPlaces = input.saved.map((s) => ({ name: s.name, category: s.category }));
  const plus = { reasonProfile: input.reasonProfile, savedPlaces };
  return {
    ...resolveExploreFoodSortOptions(categoryId, userLocation, input.cityLabel),
    reasonProfile: input.reasonProfile,
    savedPlaces,
    weather: input.weather,
    plus,
  };
}

function homePlusSortOptions(input: {
  reasonProfile: UserProfileForReason | null;
  saved: SavedPlace[];
}) {
  const savedPlaces = input.saved.map((s) => ({ name: s.name, category: s.category }));
  return { plus: { reasonProfile: input.reasonProfile, savedPlaces } };
}

function filterPlacesForExploreCategory(
  list: PlaceResult[],
  options: ExploreFilterOptions,
): PlaceResult[] {
  if (options.forHome) {
    return filterPlacesForHomeNearbyCategory(list, options);
  }

  const cityLabel = resolveExploreCityLabel(options.userLocation, options.cityLabel);
  const maxDistanceM = options.cityMode
    ? cityRecommendMaxDistanceMeters(cityLabel)
    : exploreCategoryMaxDistanceMeters(options.cat.id);

  const cityMin = exploreCategoryMinDisplay(options.cityMode);
  const selection = filterAndSelectExploreMapPlaces(list, {
    cat: options.cat,
    origin: options.userLocation,
    categoryId: options.cat.id,
    maxDistanceM,
    locale: options.locale,
    cityMode: options.cityMode,
    minResults: cityMin,
  });

  let result = selection.places;

  if (result.length < cityMin && list.length > 0) {
    const expandedMax = options.cityMode
      ? Math.max(maxDistanceM, 25_000)
      : Math.max(maxDistanceM, 8_000);
    if (expandedMax > maxDistanceM) {
      const expanded = filterAndSelectExploreMapPlaces(list, {
        cat: options.cat,
        origin: options.userLocation,
        categoryId: options.cat.id,
        maxDistanceM: expandedMax,
        locale: options.locale,
        cityMode: options.cityMode,
        minResults: cityMin,
      });
      if (expanded.places.length > result.length) {
        result = expanded.places;
      }
    }
  }

  if (result.length < cityMin && list.length > 0) {
    const lastResort = filterAndSelectExploreMapPlaces(list, {
      cat: options.cat,
      origin: options.userLocation,
      categoryId: options.cat.id,
      maxDistanceM: options.cityMode ? Math.max(maxDistanceM, 30_000) : Math.max(maxDistanceM, 12_000),
      minResults: options.cityMode ? cityMin : 1,
      locale: options.locale,
      cityMode: options.cityMode,
    });
    if (lastResort.places.length > result.length) {
      result = lastResort.places;
    }
    if (result.length < cityMin) {
      const relaxed = pickRelaxedExploreCategoryPlaces(list, {
        cat: options.cat,
        origin: options.userLocation,
        categoryId: options.cat.id,
        maxDistanceM: options.cityMode ? Math.max(maxDistanceM, 30_000) : maxDistanceM,
        maxResults: Math.max(cityMin, 10),
        locale: options.locale,
        cityMode: options.cityMode,
      });
      if (relaxed.length > result.length) {
        result = relaxed;
      }
    }
  }

  if (!options.quiet) {
    logExploreFilterResult(
      list.length,
      result.length,
      false,
      options.cat.id,
      options.locale ?? "zh-TW",
      options.locationKey ?? normalizedLocationKey(options.userLocation.lat, options.userLocation.lng),
    );
  }
  return result;
}

function buildSearchCacheFields(
  recommendMode: ExploreRecommendMode,
  userLocation: { lat: number; lng: number },
  meta: ExploreCityMeta = {},
): Pick<SearchPlacesInput, "cacheCity" | "cachePlaceId" | "cacheDestination"> {
  if (recommendMode !== "city") return {};
  const cityMeta = resolveCategoryCityMeta(userLocation, meta);
  return {
    cacheCity: cityMeta.cityLabel,
    cachePlaceId: cityMeta.cityPlaceId ?? undefined,
    cacheDestination: cityMeta.cityLabel,
  };
}

async function runSingleTextFallback(
  basePayload: { lat: number; lng: number; radius: number },
  textQuery: string,
  cat: ExploreCategory,
  locale: Locale,
  searchPlacesFn: SearchPlacesFn,
  screen: PlacesScreen,
  cacheFields: Pick<SearchPlacesInput, "cacheCity" | "cachePlaceId" | "cacheDestination"> = {},
): Promise<PlaceResult[]> {
  const fallback = await withSearchTimeout(
    searchPlacesFn({
      data: {
        ...basePayload,
        ...cacheFields,
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
  const cityLabel = resolveExploreCityLabel(ctx.userLocation);
  const filterContext = cityMode ? "explore_map_city" : ctx.forHome ? "home_nearby" : "explore_map";
  const exploreFilterContext = cityMode ? "explore_map_city" : "explore_map";
  const maxSavedDistance = cityMode
    ? cityRecommendMaxDistanceMeters(cityLabel)
    : exploreCategoryMaxDistanceMeters(cat.id);
  const filterOpts: ExploreFilterOptions = {
    cat,
    forHome: ctx.forHome,
    cityMode,
    filterContext,
    exploreFilterContext,
    userLocation: ctx.userLocation,
    locationKey: normalizedLocationKey(ctx.userLocation.lat, ctx.userLocation.lng),
    cityLabel,
    logDrop: false,
    locale: ctx.locale,
    quiet: true,
  };

  const filtered = filterPlacesForExploreCategory(rawPlaces, filterOpts);
  const nearbySaved = ctx.forHome
    ? []
    : savedPlacesNear(ctx.userLocation, ctx.saved, maxSavedDistance);
  const apiNames = new Set(rawPlaces.map((p) => p.name));
  const savedItems = nearbySaved
    .filter((s) => !apiNames.has(s.name))
    .filter((s) =>
      matchesCategory(
        { primaryType: s.category, name: s.name, types: s.category ? [s.category] : null },
        cat,
      ),
    )
    .map((s) => ({
      place: savedToPlaceResult(s),
      categoryId: cat.id,
      isSavedFavorite: true as const,
    }));
  const enriched: ExplorePlaceCard[] = buildExploreBatchCards(
    [
      ...savedItems,
      ...filtered.map((p) => ({ place: p, categoryId: cat.id })),
    ],
    {
      userLocation: ctx.userLocation,
      weather: ctx.weather,
      reasonProfile: ctx.reasonProfile,
      locale: ctx.locale,
    },
  );

  return ctx.forHome
    ? sortHomeNearbyPlacesWithContext(enriched, ctx.userLocation, {
        weather: ctx.weather,
        ...homePlusSortOptions({ reasonProfile: ctx.reasonProfile, saved: ctx.saved }),
      })
    : sortExploreCategoryPlaces(
        enriched,
        ctx.userLocation,
        cat.id,
        mergeExplorePlusSortOptions(cat.id, ctx.userLocation, {
          reasonProfile: ctx.reasonProfile,
          saved: ctx.saved,
          weather: ctx.weather,
          cityLabel,
        }),
      );
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

function buildExploreBatchCards(
  items: Array<{ place: PlaceResult; categoryId: string; isSavedFavorite?: boolean }>,
  ctx: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    reasonProfile: UserProfileForReason | null;
    locale: Locale;
  },
): ExplorePlaceCard[] {
  return buildUnifiedPlaceCards(
    items.map((item) => ({
      place: item.place,
      categoryId: item.categoryId,
      isSavedFavorite: item.isSavedFavorite,
      userLocation: ctx.userLocation,
      weather: ctx.weather,
      userProfile: ctx.reasonProfile,
      locale: ctx.locale,
    })),
  );
}

const categorySearchInFlight = new Map<string, Promise<ExplorePlaceCard[]>>();
const rawPoolInFlight = new Map<string, Promise<PlaceResult[]>>();

type ExploreCityMeta = {
  cityPlaceId?: string | null;
  cityLabel?: string;
};

function resolveCategoryCityMeta(
  userLocation: { lat: number; lng: number },
  meta: ExploreCityMeta = {},
): ExploreCityMeta {
  return {
    cityPlaceId: meta.cityPlaceId,
    cityLabel: resolveExploreCityLabel(userLocation, meta.cityLabel),
  };
}

function buildCategoryMapCacheKey(
  categoryId: string,
  userLocation: { lat: number; lng: number },
  locale: Locale,
  recommendMode: ExploreRecommendMode,
  meta: ExploreCityMeta = {},
): string {
  const cityMeta = resolveCategoryCityMeta(userLocation, meta);
  return buildMapPlacesCacheKey({
    lat: userLocation.lat,
    lng: userLocation.lng,
    categoryId,
    locale,
    mode: recommendMode === "city" ? "city" : "nearby",
    cityPlaceId: cityMeta.cityPlaceId,
    cityLabel: cityMeta.cityLabel,
  });
}

function buildCategoryRawPoolKey(
  categoryId: string,
  userLocation: { lat: number; lng: number },
  locale: Locale,
  recommendMode: ExploreRecommendMode,
  meta: ExploreCityMeta = {},
): string {
  const cityMeta = resolveCategoryCityMeta(userLocation, meta);
  return buildExploreRawPoolKey(
    userLocation.lat,
    userLocation.lng,
    recommendMode,
    locale,
    categoryId,
    cityMeta.cityPlaceId,
    cityMeta.cityLabel,
  );
}

/** 單次 multi-nearby 填滿 raw pool，首頁與探索分類切換共用 */
export async function ensureExploreRawPool(
  userLocation: { lat: number; lng: number },
  recommendMode: ExploreRecommendMode,
  searchPlacesFn: SearchPlacesFn,
  locale: Locale,
  radius?: number,
  placesScreen: PlacesScreen = "explore",
  cityMeta: ExploreCityMeta = {},
): Promise<PlaceResult[]> {
  const key = buildCategoryRawPoolKey("all", userLocation, locale, recommendMode, cityMeta);
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
    if (recommendMode === "city") {
      const cityLabel = resolveCategoryCityMeta(userLocation, cityMeta).cityLabel ?? "";
      const bootstrap = await fetchExploreCityBootstrapPlaces({
        cityLabel,
        cityCenter: userLocation,
        locale,
        searchPlacesFn,
      });
      if (bootstrap.length) writeExploreRawPool(key, bootstrap);
      return bootstrap;
    }
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
  cityScopeKey?: string,
): string {
  const loc = mode === "city" && cityScopeKey ? cityScopeKey : locationKey;
  if (mode === "city") {
    return `${loc}:${categoryId}:${locale}:${forHome ? "home" : "explore"}:city`;
  }
  return `${loc}:${categoryId}:${locale}:${forHome ? "home" : "explore"}:${mode}:${timeBucket}`;
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
    cityPlaceId?: string | null;
  },
): Promise<ExplorePlaceCard[]> {
  const { userLocation, locale, recommendMode } = ctx;
  const timeBucket = exploreTimeBucket();
  const cityMeta = { cityPlaceId: ctx.cityPlaceId, cityLabel: ctx.cityLabel };
  const allKey = buildCategoryMapCacheKey("all", userLocation, locale, recommendMode, cityMeta);

  const cachedAll = readMapPlacesCache(allKey);
  if (cachedAll?.places.length) {
    return cachedAll.places as ExplorePlaceCard[];
  }

  const cityLabel = resolveExploreCityLabel(userLocation, ctx.cityLabel);
  const cardsByCategory: Partial<Record<string, ExplorePlaceCard[]>> = {};
  const missingSubIds: string[] = [];

  for (const subId of EXPLORE_ALL_SUBCATEGORY_IDS) {
    const subKey = buildCategoryMapCacheKey(subId, userLocation, locale, recommendMode, cityMeta);
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
        cityLabel,
        cityPlaceId: ctx.cityPlaceId,
      });
    }),
  );

  let merged = mergeExploreAllCategoryResults(cardsByCategory, {
    origin: userLocation,
    timeBucket,
    cityMode: recommendMode === "city",
  });

  if (recommendMode === "city" && cityLabel && merged.length < 8) {
    const bootstrap = await fetchExploreCityBootstrapPlaces({
      cityLabel,
      cityCenter: userLocation,
      locale: ctx.locale,
      searchPlacesFn: ctx.searchPlacesFn,
    });
    if (bootstrap.length > 0) {
      for (const place of bootstrap) {
        for (const subId of EXPLORE_ALL_SUBCATEGORY_IDS) {
          const subCat = getExploreCategoryById(subId);
          if (!subCat || !matchesCategory(place, subCat)) continue;
          const card = buildUnifiedPlaceCard({
            place,
            categoryId: subId,
            userLocation,
            weather: ctx.weather,
            userProfile: ctx.reasonProfile,
            locale: ctx.locale,
          });
          const existing = cardsByCategory[subId] ?? [];
          if (existing.some((c) => c.id === card.id)) continue;
          cardsByCategory[subId] = [...existing, card];
        }
      }
      merged = mergeExploreAllCategoryResults(cardsByCategory, {
        origin: userLocation,
        timeBucket,
        cityMode: true,
      });
    }
  }

  if (merged.length > 0) {
    writeMapPlacesCache(allKey, merged, null);
  }
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
  const savedItems = nearbySaved
    .filter((s) => !apiNames.has(s.name))
    .filter((s) =>
      matchesCategory(
        { primaryType: s.category, name: s.name, types: s.category ? [s.category] : null },
        cat,
      ),
    )
    .map((s) => ({
      place: savedToPlaceResult(s),
      categoryId: cat.id,
      isSavedFavorite: true as const,
    }));

  const exploreCards: ExplorePlaceCard[] = buildExploreBatchCards(
    [
      ...savedItems,
      ...exploreFiltered.map((p) => ({ place: p, categoryId: cat.id })),
    ],
    {
      userLocation: ctx.userLocation,
      weather: ctx.weather,
      reasonProfile: ctx.reasonProfile,
      locale: ctx.locale,
    },
  );

  const sorted = sortExploreCategoryPlaces(
    exploreCards,
    ctx.userLocation,
    cat.id,
    mergeExplorePlusSortOptions(cat.id, ctx.userLocation, {
      reasonProfile: ctx.reasonProfile,
      saved: ctx.saved,
      weather: ctx.weather,
      cityLabel: ctx.cityLabel,
    }),
  );
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
    cityPlaceId?: string | null;
  },
): Promise<ExplorePlaceCard[]> {
  const { userLocation, weather, locale, reasonProfile, saved, searchPlacesFn } = ctx;
  const forHome = ctx.forHome === true;
  const recommendMode = forHome ? "nearby" : (ctx.recommendMode ?? "nearby");
  const locationKey = normalizedLocationKey(userLocation.lat, userLocation.lng);
  const timeBucket = exploreTimeBucket();
  const cityMeta = { cityPlaceId: ctx.cityPlaceId, cityLabel: ctx.cityLabel };
  const cityScopeKey =
    recommendMode === "city"
      ? normalizeExploreCityCacheKey(
          ctx.cityPlaceId,
          ctx.cityLabel,
          userLocation.lat,
          userLocation.lng,
        )
      : undefined;
  const flightKey = categorySearchFlightKey(
    locationKey,
    cat.id,
    locale,
    forHome,
    recommendMode,
    timeBucket,
    cityScopeKey,
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
      cityPlaceId: ctx.cityPlaceId,
    }).finally(() => {
      categorySearchInFlight.delete(flightKey);
    });
    categorySearchInFlight.set(flightKey, promise);
    return promise;
  }

  if (!forHome) {
    const requestKey = buildExploreRequestKey(cat.id, locationKey, locale, timeBucket);
    const mapKey = buildCategoryMapCacheKey(cat.id, userLocation, locale, recommendMode, cityMeta);
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
      cityPlaceId: ctx.cityPlaceId,
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
    cityPlaceId?: string | null;
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
  const cityLabel = resolveExploreCityLabel(userLocation, ctx.cityLabel);
  const cacheFields = buildSearchCacheFields(ctx.recommendMode, userLocation, {
    cityPlaceId: ctx.cityPlaceId,
    cityLabel,
  });
  const categoryMinDisplay = exploreCategoryMinDisplay(cityMode);
  const maxSavedDistance = cityMode
    ? cityRecommendMaxDistanceMeters(cityLabel)
    : exploreCategoryMaxDistanceMeters(cat.id);
  const radius = cityMode
    ? cityRecommendSearchRadiusMeters()
    : exploreCategorySearchRadiusMeters(cat.id);
  const basePayload = {
    lat: userLocation.lat,
    lng: userLocation.lng,
    radius,
  };

  const rawPoolKey = buildCategoryRawPoolKey(
    cat.id,
    userLocation,
    locale,
    ctx.recommendMode,
    { cityPlaceId: ctx.cityPlaceId, cityLabel },
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
    cityLabel,
    logDrop: cityMode,
    quiet,
    locale,
  };

  const needsPrimarySearch =
    !requestThrottled &&
    (!apiPlaces.length ||
      (!forHome && countExploreFilteredPlaces(apiPlaces, filterOpts) < categoryMinDisplay));

  if (needsPrimarySearch) {
    if (exploreRequestKey) markExploreRequestStarted(exploreRequestKey);
    if (cityMode) {
      if (isCitySightExploreCategory(cat.id)) {
        const [bootstrap, categoryPlaces] = await Promise.all([
          fetchExploreCityBootstrapPlaces({
            cityLabel,
            cityCenter: userLocation,
            locale,
            searchPlacesFn,
          }),
          fetchExploreCityCategoryPlaces({
            categoryId: "sight",
            cityLabel,
            cityCenter: userLocation,
            locale,
            searchPlacesFn,
          }),
        ]);
        const fetched = mergePlacesById(bootstrap, categoryPlaces);
        if (fetched.length > 0) {
          apiPlaces = mergePlacesById(apiPlaces, fetched);
          writeExploreRawPool(rawPoolKey, apiPlaces);
        }
        if (countExploreFilteredPlaces(apiPlaces, filterOpts) < categoryMinDisplay) {
          const categoryQueries = cityCategoryTextQueries(cat.id, cityLabel, weather).slice(0, 6);
          for (const textQuery of categoryQueries) {
            if (countExploreFilteredPlaces(apiPlaces, filterOpts) >= categoryMinDisplay) {
              break;
            }
            const fallbackPlaces = await runSingleTextFallback(
              basePayload,
              textQuery,
              cat,
              locale,
              searchPlacesFn,
              placesScreen,
              cacheFields,
            );
            if (fallbackPlaces.length > 0) {
              apiPlaces = mergePlacesById(apiPlaces, fallbackPlaces);
              writeExploreRawPool(rawPoolKey, apiPlaces);
            }
          }
        }
      } else {
        const categoryPlaces = await fetchExploreCityCategoryPlaces({
          categoryId: cat.id,
          cityLabel,
          cityCenter: userLocation,
          locale,
          searchPlacesFn,
        });
        if (categoryPlaces.length > 0) {
          apiPlaces = mergePlacesById(apiPlaces, categoryPlaces);
          writeExploreRawPool(rawPoolKey, apiPlaces);
        }
      }
    } else {
      const primary = await withSearchTimeout(
        searchPlacesFn({
          data: {
            ...basePayload,
            ...cacheFields,
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
  }

  logExplorePlacesRaw(apiPlaces.length, quiet, cat.id, locale, locationKey);

  let filtered = forHome
    ? filterPlacesForHomeNearbyCategory(apiPlaces, filterOpts)
    : filterPlacesForExploreCategory(apiPlaces, filterOpts);

  let fallbackQueriesUsed = 0;
  const maxFallbackQueries = exploreMaxFallbackQueries(cityMode);

  const tryFallback = async (textQuery: string | null) => {
    if (!textQuery?.trim() || fallbackQueriesUsed >= maxFallbackQueries) return;
    fallbackQueriesUsed += 1;
    const fallbackPlaces = await runSingleTextFallback(
      basePayload,
      textQuery.trim(),
      cat,
      locale,
      searchPlacesFn,
      placesScreen,
      cacheFields,
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
      if (fallbackQueriesUsed >= maxFallbackQueries) break;
      if (!forHome && filtered.length >= categoryMinDisplay) break;
      await tryFallback(q);
    }
  };

  if (forHome && apiPlaces.length === 0 && !usedRawPool) {
    await runTextFallbackQueries(HOME_TEXT_FALLBACK_QUERIES[cat.id] ?? []);
  } else if (!forHome && !requestThrottled && filtered.length < categoryMinDisplay) {
    const cityQueries = cityMode
      ? cityCategoryTextQueries(cat.id, cityLabel, weather)
      : exploreCategoryTextQueries(cat.id, userLocation, cityLabel, weather);
    const queries =
      cat.id === "coffee" && !cityMode
        ? [...COFFEE_NEARBY_TEXT_QUERIES, ...cityQueries]
        : cityQueries;
    await runTextFallbackQueries(queries);
  }

  if (!forHome && cityMode && cityLabel && filtered.length < categoryMinDisplay) {
    if (isCitySightExploreCategory(cat.id)) {
      const [popular, sightCategory] = await Promise.all([
        fetchExploreCityBootstrapPlaces({
          cityLabel,
          cityCenter: userLocation,
          locale,
          searchPlacesFn,
        }),
        fetchExploreCityCategoryPlaces({
          categoryId: "sight",
          cityLabel,
          cityCenter: userLocation,
          locale,
          searchPlacesFn,
        }),
      ]);
      const extra = mergePlacesById(popular, sightCategory);
      if (extra.length > 0) {
        apiPlaces = mergePlacesById(apiPlaces, extra);
        mergeIntoExploreRawPool(rawPoolKey, extra);
        filtered = filterPlacesForExploreCategory(apiPlaces, filterOpts);
      }
    } else {
      const categoryPlaces = await fetchExploreCityCategoryPlaces({
        categoryId: cat.id,
        cityLabel,
        cityCenter: userLocation,
        locale,
        searchPlacesFn,
      });
      if (categoryPlaces.length > 0) {
        apiPlaces = mergePlacesById(apiPlaces, categoryPlaces);
        mergeIntoExploreRawPool(rawPoolKey, categoryPlaces);
        filtered = filterPlacesForExploreCategory(apiPlaces, filterOpts);
      }
    }
    if (filtered.length === 0 && apiPlaces.length > 0) {
      filtered = pickRelaxedExploreCategoryPlaces(apiPlaces, {
        cat,
        origin: userLocation,
        categoryId: cat.id,
        maxDistanceM: cityRecommendMaxDistanceMeters(cityLabel),
        locale,
        cityMode: true,
      });
    }
  }

  const nearbySaved = forHome ? [] : savedPlacesNear(userLocation, saved, maxSavedDistance);
  const apiNames = new Set(apiPlaces.map((p) => p.name));
  const savedItems = nearbySaved
    .filter((s) => !apiNames.has(s.name))
    .filter((s) =>
      matchesCategory(
        { primaryType: s.category, name: s.name, types: s.category ? [s.category] : null },
        cat,
      ),
    )
    .map((s) => ({
      place: savedToPlaceResult(s),
      categoryId: cat.id,
      isSavedFavorite: true as const,
    }));

  const enriched: ExplorePlaceCard[] = buildExploreBatchCards(
    [
      ...savedItems,
      ...filtered.map((p) => ({ place: p, categoryId: cat.id })),
    ],
    {
      userLocation,
      weather,
      reasonProfile,
      locale,
    },
  );

  if (enriched.length === 0 && allowDemoPlaceFallback() && !forHome) {
    const mocks = buildExploreBatchCards(
      getMockPlacesForCategory(userLocation, cat).map((p) => ({
        place: p,
        categoryId: cat.id,
      })),
      { userLocation, weather, reasonProfile, locale },
    );
    return forHome
      ? sortHomeNearbyPlacesWithContext(mocks, userLocation, {
          weather,
          ...homePlusSortOptions({ reasonProfile, saved }),
        })
      : sortExploreCategoryPlaces(
          mocks,
          userLocation,
          cat.id,
          mergeExplorePlusSortOptions(cat.id, userLocation, {
            reasonProfile,
            saved,
            weather,
            cityLabel,
          }),
        );
  }

  if (enriched.length === 0 && !quiet) {
    console.info("[explore] no places for category", cat.id);
  }

  const filteredEnriched =
    forHome || cityMode
      ? filterHomeNearbyPlaceResults(enriched, {
          origin: forHome || cityMode ? userLocation : undefined,
          maxDistanceM: cityMode ? cityRecommendMaxDistanceMeters(cityLabel) : undefined,
          context: filterContext,
        })
      : enriched;

  if (forHome) {
    warmMapCategoryCache(cat, { userLocation, weather, locale, reasonProfile, saved }, apiPlaces);
    return sortHomeNearbyPlacesWithContext(filteredEnriched, userLocation, {
      weather,
      ...homePlusSortOptions({ reasonProfile, saved }),
    });
  }

  const mapKey = buildCategoryMapCacheKey(
    cat.id,
    userLocation,
    locale,
    ctx.recommendMode,
    { cityPlaceId: ctx.cityPlaceId, cityLabel },
  );
  const sorted = sortExploreCategoryPlaces(
    filteredEnriched,
    userLocation,
    cat.id,
    mergeExplorePlusSortOptions(cat.id, userLocation, {
      reasonProfile,
      saved,
      weather,
      cityLabel,
    }),
  );
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
  cityPlaceId?: string | null;
}): Promise<ExplorePlaceCard[]> {
  const allCat = getExploreCategoryById("all");
  if (!allCat) return [];
  return searchExploreCategoryPlaces(allCat, { ...ctx, forHome: false });
}
