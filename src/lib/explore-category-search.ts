import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { SavedPlace } from "@/lib/places-storage";
import {
  COFFEE_MIN_FILTERED_RESULTS,
  DISTRICT_MIN_FILTERED_RESULTS,
  NIGHT_MIN_FILTERED_RESULTS,
  EXPLORE_ALL_SUBCATEGORY_IDS,
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

function categorySearchFlightKey(
  locationKey: string,
  categoryId: string,
  locale: Locale,
  forHome: boolean,
): string {
  return `${locationKey}:${categoryId}:${locale}:${forHome ? "home" : "explore"}`;
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
  },
): Promise<ExplorePlaceCard[]> {
  const { userLocation, weather, locale, reasonProfile, saved, searchPlacesFn } = ctx;
  const forHome = ctx.forHome === true;
  const locationKey = normalizedLocationKey(userLocation.lat, userLocation.lng);
  const flightKey = categorySearchFlightKey(locationKey, cat.id, locale, forHome);

  if (!forHome) {
    const mapKey = buildMapPlacesCacheKey({
      lat: userLocation.lat,
      lng: userLocation.lng,
      categoryId: cat.id,
      locale,
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
  },
): Promise<ExplorePlaceCard[]> {
  const { userLocation, weather, locale, reasonProfile, saved, searchPlacesFn, forHome } = ctx;
  /** 首頁與探索地圖分類搜尋共用半徑，讓 places-search-dedupe cache key 一致 */
  const radius = homeNearbySearchRadiusMeters();
  const basePayload = {
    lat: userLocation.lat,
    lng: userLocation.lng,
    radius,
  };

  const primary = await withSearchTimeout(
    searchPlacesFn({
      data: {
        ...basePayload,
        query: cat.query,
        mode: cat.mode,
        includedTypes: cat.includedTypes,
        nearbyGroups: cat.nearbyGroups,
        locale,
      },
    }),
  );

  let apiPlaces = Array.isArray(primary.places) ? primary.places : [];

  const applyFilters = (list: PlaceResult[]) =>
    filterHomeNearbyPlaceResults(
      filterByExploreCategory(filterExplorePlaces(list, { logDrop: false }), cat),
      {
        categoryId: cat.id,
        caller: `searchExploreCategoryPlaces:${cat.id}`,
        origin: forHome ? userLocation : undefined,
        context: forHome ? "home_nearby" : "explore_map",
        logDrop: false,
      },
    );

  let filtered = applyFilters(apiPlaces);

  if (!forHome && cat.id === "coffee" && filtered.length < COFFEE_MIN_FILTERED_RESULTS) {
    for (const textQuery of getExploreTextFallbackQueries("coffee", userLocation)) {
      const fallback = await withSearchTimeout(
        searchPlacesFn({
          data: { ...basePayload, query: textQuery, mode: "text", locale },
        }),
      );
      const fallbackPlaces = Array.isArray(fallback.places) ? fallback.places : [];
      if (fallbackPlaces.length > 0) {
        apiPlaces = mergePlacesById(apiPlaces, fallbackPlaces);
        filtered = applyFilters(apiPlaces);
        if (filtered.length >= COFFEE_MIN_FILTERED_RESULTS) break;
      }
    }
  }

  if (!forHome && cat.id === "district" && filtered.length < DISTRICT_MIN_FILTERED_RESULTS) {
    for (const textQuery of getExploreTextFallbackQueries("district", userLocation)) {
      const fallback = await withSearchTimeout(
        searchPlacesFn({
          data: { ...basePayload, query: textQuery, mode: "text", locale },
        }),
      );
      const fallbackPlaces = Array.isArray(fallback.places) ? fallback.places : [];
      if (fallbackPlaces.length > 0) {
        apiPlaces = mergePlacesById(apiPlaces, fallbackPlaces);
        filtered = applyFilters(apiPlaces);
        if (filtered.length >= DISTRICT_MIN_FILTERED_RESULTS) break;
      }
    }
  }

  if (!forHome && cat.id === "night" && filtered.length < NIGHT_MIN_FILTERED_RESULTS) {
    for (const textQuery of getExploreTextFallbackQueries("night", userLocation)) {
      const fallback = await withSearchTimeout(
        searchPlacesFn({
          data: { ...basePayload, query: textQuery, mode: "text", locale },
        }),
      );
      const fallbackPlaces = Array.isArray(fallback.places) ? fallback.places : [];
      if (fallbackPlaces.length > 0) {
        apiPlaces = mergePlacesById(apiPlaces, fallbackPlaces);
        filtered = applyFilters(apiPlaces);
        if (filtered.length >= NIGHT_MIN_FILTERED_RESULTS) break;
      }
    }
  }

  if (forHome && filtered.length === 0) {
    for (const textQuery of HOME_TEXT_FALLBACK_QUERIES[cat.id] ?? []) {
      const fallback = await withSearchTimeout(
        searchPlacesFn({
          data: { ...basePayload, query: textQuery, mode: "text", locale },
        }),
      );
      const fallbackPlaces = Array.isArray(fallback.places) ? fallback.places : [];
      if (fallbackPlaces.length > 0) {
        apiPlaces = mergePlacesById(apiPlaces, fallbackPlaces);
        filtered = applyFilters(apiPlaces);
        if (filtered.length > 0) break;
      }
    }
  }

  const nearbySaved = forHome
    ? []
    : savedPlacesNear(userLocation, saved, 5000);
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
    origin: forHome ? userLocation : undefined,
    context: forHome ? "home_nearby" : "explore_map",
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

/** 探索地圖「全部」：依序查 coffee / sight / district / food，合併結果 */
export async function searchExploreAllPlaces(ctx: {
  userLocation: { lat: number; lng: number };
  weather: WeatherSummary | null;
  locale: Locale;
  reasonProfile: UserProfileForReason | null;
  saved: SavedPlace[];
  searchPlacesFn: SearchPlacesFn;
  locationKey?: string;
}): Promise<ExplorePlaceCard[]> {
  const deduped = new Map<string, ExplorePlaceCard>();

  for (const subId of EXPLORE_ALL_SUBCATEGORY_IDS) {
    const cat = getExploreCategoryById(subId);
    if (!cat) continue;
    try {
      const sorted = await searchExploreCategoryPlaces(cat, { ...ctx, forHome: false });
      let added = 0;
      for (const p of sorted) {
        if (deduped.has(p.id)) continue;
        deduped.set(p.id, { ...p, categoryId: cat.id });
        added += 1;
      }
      console.info("[MAP_ALL_SUBCATEGORY]", {
        categoryId: cat.id,
        query: cat.query,
        count: added,
        locationKey: ctx.locationKey ?? null,
      });
    } catch (e) {
      console.warn("[Roamie Map] all-tab subcategory search failed", subId, e);
    }
  }

  return sortExploreCategoryPlaces([...deduped.values()], ctx.userLocation, "all");
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
