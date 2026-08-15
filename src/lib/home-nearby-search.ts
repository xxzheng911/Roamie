import type { Locale } from "@/lib/i18n/types";
import {
  homeNearbyPeriodFromHour,
  isVerifiedGooglePlaceId,
  localHourInTimeZone,
  matchesNightPreferredPlace,
  type HomeNearbyPeriod,
} from "@/lib/home-nearby-eligibility";
import {
  HOME_NEARBY_MIN_DISPLAY,
  HOME_NEARBY_TARGET_COUNT,
  HOME_NEARBY_ULTIMATE_MIN,
  selectHomeNearbyFallbackPicks,
  selectHomeNearbyPicks,
  selectHomeNearbyUltimateFallback,
} from "@/lib/home-nearby-places-filter";
import { sortHomeNearbyPlacesWithContext } from "@/lib/home-nearby-ranking";
import { mergePlaceRuntimeCache } from "@/lib/place-runtime-cache";
import { logHomeNearbyDataReady } from "@/lib/places-diagnostics";
import {
  getHomeNearbyLoadInFlight,
  homeNearbyLoadKey,
  invalidateHomeNearbyLoadKey,
  readHomeNearbyResultsCacheMeta,
  registerHomeNearbyLoadInFlight,
  writeHomeNearbyResultsCache,
} from "@/lib/home-nearby-picks-policy";
import {
  logHomeNearbyCacheHit,
  logHomeNearbyCacheMiss,
  logHomeNearbyFilterDrop,
  logHomeNearbyRequestError,
  logHomeNearbyRequestSuccess,
} from "@/lib/home-nearby-log";
import {
  HOME_NEARBY_CATEGORY_TYPES,
  HOME_POPULAR_NEARBY_TYPES,
  homeNearbyFallbackTypeForCategory,
  sanitizeNearbyGroups,
  sanitizeNearbyTypes,
} from "@/lib/places-nearby-types";
import type { PlaceResult } from "@/lib/place-result";
import { beginPlacesFlow, endPlacesFlow, placesStatsPayload } from "@/lib/places-api-stats";
import { homeNearbySearchRadiusMeters } from "@/lib/search-radius";
import { withSearchTimeout } from "@/lib/search-timeout";
import { buildUnifiedPlaceCards } from "@/lib/unified-place-card";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import type { SavedPlace } from "@/lib/places-storage";
import type { WeatherSummary } from "@/lib/weather-types";
import { prioritizeWeatherAwareHomeWaves } from "@/lib/ai/weather-place-search";
import { noteHomeNearbyPlacesSearchCall } from "@/lib/home-nearby-perf";

export type SearchPlacesInput = {
  lat: number;
  lng: number;
  radius?: number;
  query: string;
  mode: "text" | "nearby" | "multi";
  includedTypes?: string[];
  nearbyGroups?: string[][];
  locale?: Locale;
  categoryId?: string;
  placesCaller?: string;
  placesScreen?: "home" | "explore" | "chat" | "ai_recommend" | "itinerary" | "plan" | "place_detail" | "unknown";
};

export type SearchPlacesFn = (
  args: { data: SearchPlacesInput },
) => Promise<{ places: PlaceResult[]; error: string | null }>;

type ExplorePlaceCard = PlaceResult & {
  reason: string;
  isSavedFavorite?: boolean;
};

export type HomeNearbyPick = ExplorePlaceCard & {
  categoryId: string;
  displayCategory?: string;
  coverImageUrl?: string | null;
  distanceLabel?: string;
};

type HomeSearchWave = {
  id: string;
  query: string;
  mode: "text" | "nearby" | "multi";
  includedTypes?: string[];
  nearbyGroups?: string[][];
};

const HOME_GENERIC_FALLBACK_TYPES = [
  "tourist_attraction",
  "cafe",
  "restaurant",
  "park",
  "shopping_mall",
] as const;

const LATE_NIGHT_WAVES: HomeSearchWave[] = [
  {
    id: "night_bar",
    query: "居酒屋 酒吧 宵夜 餐酒",
    mode: "multi",
    nearbyGroups: [
      HOME_NEARBY_CATEGORY_TYPES.night_bar,
      ["restaurant", "meal_takeaway"],
    ],
  },
  {
    id: "night_food",
    query: "宵夜 拉麵 燒肉 火鍋 串燒",
    mode: "nearby",
    includedTypes: [...HOME_NEARBY_CATEGORY_TYPES.night_food],
  },
  {
    id: "night_cafe",
    query: "深夜咖啡 甜點",
    mode: "nearby",
    includedTypes: [...HOME_NEARBY_CATEGORY_TYPES.night_cafe],
  },
];

const DAY_WAVES: HomeSearchWave[] = [
  {
    id: "day_cafe",
    query: "咖啡廳 甜點 早午餐",
    mode: "nearby",
    includedTypes: [...HOME_NEARBY_CATEGORY_TYPES.day_cafe],
  },
  {
    id: "day_food",
    query: "餐廳 小吃 在地美食",
    mode: "nearby",
    includedTypes: [...HOME_NEARBY_CATEGORY_TYPES.day_food],
  },
  {
    id: "day_sight",
    query: "景點 博物館 美術館",
    mode: "nearby",
    includedTypes: [...HOME_NEARBY_CATEGORY_TYPES.day_sight],
  },
  {
    id: "day_market",
    query: "市集 百貨 商場",
    mode: "multi",
    nearbyGroups: [
      ["market", "flea_market"],
      ["shopping_mall", "department_store"],
    ],
  },
];

const HOME_INITIAL_WAVE_COUNT = 2;
const HOME_MAX_WAVE_COUNT = 4;
const HOME_GENERIC_FALLBACK_MAX_TYPES = 2;
/** 第一批卡片：有幾筆就可先上畫面，不必等全部 waves */
const HOME_FIRST_BATCH_MIN = 3;

export type HomeNearbyPartialPhase = "first_batch" | "enriched";

export type LoadHomeNearbyPicksOptions = {
  forceRefresh?: boolean;
  /** 第一批有效地點就緒時先回報，供漸進式渲染 */
  onPartialPicks?: (picks: HomeNearbyPick[], phase: HomeNearbyPartialPhase) => void;
};

function wavesForPeriod(
  period: HomeNearbyPeriod,
  weather?: WeatherSummary | null,
): HomeSearchWave[] {
  const base = period === "late_night" ? LATE_NIGHT_WAVES : DAY_WAVES;
  return prioritizeWeatherAwareHomeWaves(base, weather);
}

async function fetchHomeNearbyWaves(
  waves: HomeSearchWave[],
  ctx: {
    userLocation: { lat: number; lng: number };
    locale: Locale;
    searchPlacesFn: SearchPlacesFn;
  },
  pickOptions: Parameters<typeof selectHomeNearbyPicks>[1],
  options?: {
    onFirstBatch?: (places: PlaceResult[]) => void;
  },
): Promise<PlaceResult[]> {
  let apiPlaces: PlaceResult[] = [];
  let waveIndex = 0;
  const maxWaves = Math.min(HOME_MAX_WAVE_COUNT, waves.length);
  let firstBatchNotified = false;

  while (waveIndex < maxWaves) {
    const batchSize = waveIndex === 0 ? HOME_INITIAL_WAVE_COUNT : 2;
    const end = Math.min(waveIndex + batchSize, maxWaves);
    const activeWaves = waves.slice(waveIndex, end);
    waveIndex = end;

    // 同批並行，縮短第一批卡片等待時間
    const settled = await Promise.allSettled(
      activeWaves.map((wave) => runHomeSearchWave(wave, ctx)),
    );
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      apiPlaces = mergePlacesById(apiPlaces, result.value);
    }

    if (!firstBatchNotified && apiPlaces.length > 0) {
      const early = selectHomeNearbyPicks(apiPlaces, {
        ...pickOptions,
        minResults: HOME_FIRST_BATCH_MIN,
        maxResults: HOME_NEARBY_TARGET_COUNT,
      });
      if (early.length >= HOME_FIRST_BATCH_MIN) {
        firstBatchNotified = true;
        options?.onFirstBatch?.(apiPlaces);
      }
    }

    if (selectHomeNearbyPicks(apiPlaces, pickOptions).length >= HOME_NEARBY_TARGET_COUNT) {
      return apiPlaces;
    }

    if (
      firstBatchNotified &&
      selectHomeNearbyPicks(apiPlaces, pickOptions).length >= HOME_NEARBY_MIN_DISPLAY
    ) {
      return apiPlaces;
    }

    if (selectHomeNearbyPicks(apiPlaces, pickOptions).length >= HOME_NEARBY_MIN_DISPLAY) {
      return apiPlaces;
    }
  }

  return apiPlaces;
}

function mergePlacesById(base: PlaceResult[], extra: PlaceResult[]): PlaceResult[] {
  const seen = new Set(base.map((p) => p.id));
  const merged = [...base];
  for (const place of extra) {
    if (!seen.has(place.id)) {
      seen.add(place.id);
      merged.push(place);
    }
  }
  return merged;
}

function buildHomeSearchPayload(
  wave: HomeSearchWave,
  ctx: { userLocation: { lat: number; lng: number }; locale: Locale },
  overrides?: Partial<SearchPlacesInput>,
): SearchPlacesInput {
  const mode = overrides?.mode ?? wave.mode;
  const includedTypes =
    overrides?.includedTypes ??
    (mode === "nearby" ? sanitizeNearbyTypes(wave.includedTypes) : undefined);
  const nearbyGroups =
    overrides?.nearbyGroups ??
    (mode === "multi" ? sanitizeNearbyGroups(wave.nearbyGroups) : undefined);

  return {
    lat: ctx.userLocation.lat,
    lng: ctx.userLocation.lng,
    radius: homeNearbySearchRadiusMeters(),
    query: overrides?.query ?? wave.query,
    mode,
    includedTypes,
    nearbyGroups,
    locale: ctx.locale,
    categoryId: wave.id,
    ...placesStatsPayload({
      placesCaller: "loadHomeNearbyPicks",
      placesScreen: "home",
      categoryId: wave.id,
    }),
    ...overrides,
  };
}

async function searchHomePlaces(
  ctx: {
    userLocation: { lat: number; lng: number };
    locale: Locale;
    searchPlacesFn: SearchPlacesFn;
  },
  payload: SearchPlacesInput,
): Promise<{ places: PlaceResult[]; error: string | null }> {
  noteHomeNearbyPlacesSearchCall();
  const result = await withSearchTimeout(ctx.searchPlacesFn({ data: payload }));
  return {
    places: Array.isArray(result.places) ? result.places : [],
    error: result.error ?? null,
  };
}

function isPlacesApiClientError(error: string | null): boolean {
  return Boolean(error?.includes("400") || error?.includes("INVALID_ARGUMENT"));
}

async function runHomeSearchWave(
  wave: HomeSearchWave,
  ctx: {
    userLocation: { lat: number; lng: number };
    locale: Locale;
    searchPlacesFn: SearchPlacesFn;
  },
): Promise<PlaceResult[]> {
  const primary = await searchHomePlaces(ctx, buildHomeSearchPayload(wave, ctx));
  if (primary.places.length > 0) return primary.places;

  const fallbackType = homeNearbyFallbackTypeForCategory(wave.id);
  if (fallbackType && (primary.error || primary.places.length === 0)) {
    const typeFallback = await searchHomePlaces(
      ctx,
      buildHomeSearchPayload(wave, ctx, {
        mode: "nearby",
        includedTypes: [fallbackType],
        nearbyGroups: undefined,
      }),
    );
    if (typeFallback.places.length > 0) return typeFallback.places;
  }

  if (wave.query.trim() && (primary.error || isPlacesApiClientError(primary.error))) {
    const textFallback = await searchHomePlaces(
      ctx,
      buildHomeSearchPayload(wave, ctx, {
        mode: "text",
        includedTypes: undefined,
        nearbyGroups: undefined,
      }),
    );
    if (textFallback.places.length > 0) return textFallback.places;
  }

  return primary.places;
}

async function runHomePopularFallback(
  ctx: {
    userLocation: { lat: number; lng: number };
    locale: Locale;
    searchPlacesFn: SearchPlacesFn;
  },
): Promise<PlaceResult[]> {
  const types = sanitizeNearbyTypes([...HOME_POPULAR_NEARBY_TYPES]);
  if (types.length === 0) return [];

  const nearby = await searchHomePlaces(ctx, {
    lat: ctx.userLocation.lat,
    lng: ctx.userLocation.lng,
    radius: homeNearbySearchRadiusMeters(),
    query: "附近 熱門 餐廳 咖啡",
    mode: "nearby",
    includedTypes: types,
    locale: ctx.locale,
    categoryId: "home_popular",
    ...placesStatsPayload({
      placesCaller: "loadHomeNearbyPicks",
      placesScreen: "home",
      categoryId: "home_popular",
    }),
  });
  if (nearby.places.length > 0) return nearby.places;

  const text = await searchHomePlaces(ctx, {
    lat: ctx.userLocation.lat,
    lng: ctx.userLocation.lng,
    radius: homeNearbySearchRadiusMeters(),
    query: "附近 熱門 餐廳 咖啡",
    mode: "text",
    locale: ctx.locale,
    categoryId: "home_popular",
    ...placesStatsPayload({
      placesCaller: "loadHomeNearbyPicks",
      placesScreen: "home",
      categoryId: "home_popular",
    }),
  });
  return text.places;
}

async function runHomeGenericTypeFallback(
  ctx: {
    userLocation: { lat: number; lng: number };
    locale: Locale;
    searchPlacesFn: SearchPlacesFn;
  },
): Promise<PlaceResult[]> {
  const types = sanitizeNearbyTypes([...HOME_GENERIC_FALLBACK_TYPES]);
  let merged: PlaceResult[] = [];
  const typesToTry = types.slice(0, HOME_GENERIC_FALLBACK_MAX_TYPES);

  for (const type of typesToTry) {
    if (merged.length >= 24) break;
    try {
      const batch = await searchHomePlaces(ctx, {
        lat: ctx.userLocation.lat,
        lng: ctx.userLocation.lng,
        radius: homeNearbySearchRadiusMeters(),
        query: `附近 ${type}`,
        mode: "nearby",
        includedTypes: [type],
        locale: ctx.locale,
        categoryId: `home_generic_${type}`,
        ...placesStatsPayload({
          placesCaller: "loadHomeNearbyPicks",
          placesScreen: "home",
          categoryId: `home_generic_${type}`,
        }),
      });
      merged = mergePlacesById(merged, batch.places);
    } catch {
      /* single type failure */
    }
  }

  return merged;
}

function placeTypesLabel(place: PlaceResult): string {
  const types = new Set<string>();
  const primary = (place.primaryType ?? "").trim();
  if (primary) types.add(primary);
  for (const t of place.types ?? []) {
    const n = (t ?? "").trim();
    if (n) types.add(n);
  }
  return [...types].join("|") || "none";
}

function inferHomePickCategoryId(
  place: PlaceResult,
  period: HomeNearbyPeriod,
): string {
  if (period === "late_night") {
    if (matchesNightPreferredPlace(place)) return "night";
    return "food";
  }
  const types = new Set(
    [place.primaryType, ...(place.types ?? [])]
      .filter(Boolean)
      .map((t) => String(t).toLowerCase()),
  );
  if ([...types].some((t) => ["cafe", "coffee_shop", "bakery", "dessert_shop"].includes(t))) {
    return "coffee";
  }
  if ([...types].some((t) => ["restaurant", "meal_takeaway", "food_store"].includes(t))) {
    return "food";
  }
  if ([...types].some((t) => ["tourist_attraction", "museum", "art_gallery"].includes(t))) {
    return "sight";
  }
  if ([...types].some((t) => ["market", "shopping_mall", "department_store"].includes(t))) {
    return "district";
  }
  return "food";
}

function buildHomeNearbyCards(
  places: PlaceResult[],
  ctx: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    locale: Locale;
    reasonProfile: UserProfileForReason | null;
    period: HomeNearbyPeriod;
  },
): HomeNearbyPick[] {
  return buildUnifiedPlaceCards(
    places.map((place) => ({
      place,
      categoryId: inferHomePickCategoryId(place, ctx.period),
      userLocation: ctx.userLocation,
      weather: ctx.weather,
      userProfile: ctx.reasonProfile,
      locale: ctx.locale,
    })),
  ).map((card) => {
    const categoryId = inferHomePickCategoryId(card, ctx.period);
    return mergePlaceRuntimeCache(card.id, {
      ...card,
      categoryId,
    }) as HomeNearbyPick;
  });
}

function finalizeHomeNearbyPicks(
  apiPlaces: PlaceResult[],
  ctx: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    locale: Locale;
    reasonProfile: UserProfileForReason | null;
    saved: SavedPlace[];
  },
  period: HomeNearbyPeriod,
  at: Date,
  timeZone: string,
  pickOptions: {
    origin: { lat: number; lng: number };
    minResults: number;
    maxResults: number;
    period: HomeNearbyPeriod;
    at: Date;
    timeZone: string;
  },
): HomeNearbyPick[] {
  let selected = selectHomeNearbyPicks(apiPlaces, pickOptions).filter((p) =>
    isVerifiedGooglePlaceId(p.id),
  );

  if (selected.length < HOME_NEARBY_ULTIMATE_MIN && apiPlaces.length > 0) {
    selected = selectHomeNearbyFallbackPicks(apiPlaces, {
      origin: ctx.userLocation,
      period,
      at,
      timeZone,
    }).filter((p) => isVerifiedGooglePlaceId(p.id));
  }

  if (selected.length < HOME_NEARBY_ULTIMATE_MIN && apiPlaces.length > 0) {
    selected = selectHomeNearbyUltimateFallback(apiPlaces, {
      origin: ctx.userLocation,
      minResults: HOME_NEARBY_ULTIMATE_MIN,
      maxResults: HOME_NEARBY_TARGET_COUNT,
      onDrop: (place, reason) => {
        logHomeNearbyFilterDrop(place.name ?? "unknown", placeTypesLabel(place), reason);
      },
    }).filter((p) => isVerifiedGooglePlaceId(p.id));
  }

  const cards = buildHomeNearbyCards(selected, {
    userLocation: ctx.userLocation,
    weather: ctx.weather,
    locale: ctx.locale,
    reasonProfile: ctx.reasonProfile,
    period,
  });

  return sortHomeNearbyPlacesWithContext(cards, ctx.userLocation, {
    weather: ctx.weather,
    at,
    timeZone,
    period,
    plus: {
      reasonProfile: ctx.reasonProfile,
      savedPlaces: ctx.saved.map((s) => ({ name: s.name, category: s.category })),
    },
  });
}

/** 首頁附近推薦：獨立搜尋／篩選／排序（與探索頁共用 repository 快取層） */
export async function loadHomeNearbyPicks(
  ctx: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    locale: Locale;
    reasonProfile: UserProfileForReason | null;
    saved: SavedPlace[];
    searchPlacesFn: SearchPlacesFn;
    locationKey?: string;
    at?: Date;
    timeZone?: string;
  },
  options?: LoadHomeNearbyPicksOptions,
): Promise<HomeNearbyPick[]> {
  const at = ctx.at ?? new Date();
  const timeZone = ctx.timeZone ?? "Asia/Taipei";
  const hour = localHourInTimeZone(at, timeZone);
  const period = homeNearbyPeriodFromHour(hour);
  const cacheKey = homeNearbyLoadKey(
    ctx.userLocation.lat,
    ctx.userLocation.lng,
    period,
    ctx.locale,
  );

  if (options?.forceRefresh) {
    invalidateHomeNearbyLoadKey(cacheKey);
  } else {
    const cachedMeta = readHomeNearbyResultsCacheMeta<HomeNearbyPick>(cacheKey);
    if (cachedMeta && cachedMeta.picks.length > 0) {
      logHomeNearbyCacheHit(cachedMeta.picks.length, cachedMeta.ageMs);
      options?.onPartialPicks?.(cachedMeta.picks, "first_batch");
      return cachedMeta.picks;
    }
  }
  logHomeNearbyCacheMiss(options?.forceRefresh ? "force_refresh" : "module_in_memory_miss");

  const inflight = getHomeNearbyLoadInFlight<HomeNearbyPick[]>(cacheKey);
  if (inflight) return inflight;

  const promise = loadHomeNearbyPicksInner(ctx, period, cacheKey, at, timeZone, options);
  return registerHomeNearbyLoadInFlight(cacheKey, promise);
}

async function loadHomeNearbyPicksInner(
  ctx: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    locale: Locale;
    reasonProfile: UserProfileForReason | null;
    saved: SavedPlace[];
    searchPlacesFn: SearchPlacesFn;
    locationKey?: string;
  },
  period: HomeNearbyPeriod,
  cacheKey: string,
  at: Date,
  timeZone: string,
  options?: LoadHomeNearbyPicksOptions,
): Promise<HomeNearbyPick[]> {
  const waves = wavesForPeriod(period, ctx.weather);
  const pickOptions = {
    origin: ctx.userLocation,
    minResults: HOME_NEARBY_MIN_DISPLAY,
    maxResults: HOME_NEARBY_TARGET_COUNT,
    period,
    at,
    timeZone,
  };

  const flow = beginPlacesFlow("home_cold");
  try {
  let partialEmitted = false;
  const emitPartialFromApiPlaces = (places: PlaceResult[]) => {
    if (partialEmitted || !options?.onPartialPicks) return;
    const early = finalizeHomeNearbyPicks(
      places,
      ctx,
      period,
      at,
      timeZone,
      {
        ...pickOptions,
        minResults: HOME_FIRST_BATCH_MIN,
      },
    );
    if (early.length < HOME_FIRST_BATCH_MIN) return;
    partialEmitted = true;
    options.onPartialPicks(early, "first_batch");
  };

  let apiPlaces = await fetchHomeNearbyWaves(waves, ctx, pickOptions, {
    onFirstBatch: emitPartialFromApiPlaces,
  });

  if (apiPlaces.length === 0) {
    try {
      apiPlaces = await runHomePopularFallback(ctx);
    } catch (e) {
      logHomeNearbyRequestError("popular_fallback_failed", e instanceof Error ? e.message : String(e));
    }
  }

  if (apiPlaces.length === 0) {
    try {
      apiPlaces = await runHomeGenericTypeFallback(ctx);
    } catch (e) {
      logHomeNearbyRequestError("generic_fallback_failed", e instanceof Error ? e.message : String(e));
    }
  }

  const rawCount = apiPlaces.length;

  const sorted = finalizeHomeNearbyPicks(apiPlaces, ctx, period, at, timeZone, pickOptions);

  writeHomeNearbyResultsCache(cacheKey, sorted);
  logHomeNearbyRequestSuccess(rawCount, sorted.length);

  if (sorted.length > 0) {
    options?.onPartialPicks?.(sorted, "enriched");
    logHomeNearbyDataReady({
      count: sorted.length,
      lat: ctx.userLocation.lat,
      lng: ctx.userLocation.lng,
      locationKey: ctx.locationKey,
      sample: sorted.slice(0, 3).map((p) => p.name),
      categories: waves.map((w) => w.id),
      fromMock: false,
      cacheKey,
    });
    return sorted;
  }

  logHomeNearbyDataReady({
    count: 0,
    lat: ctx.userLocation.lat,
    lng: ctx.userLocation.lng,
    locationKey: ctx.locationKey,
    sample: [],
    categories: waves.map((w) => w.id),
    fromMock: false,
    error: apiPlaces.length > 0 ? "filtered_empty" : "no_results",
    cacheKey,
  });
  return sorted;
  } catch (e) {
    logHomeNearbyRequestError(
      "load_failed",
      e instanceof Error ? e.message : String(e),
    );
    throw e;
  } finally {
    endPlacesFlow(flow);
  }
}

export function homeNearbyLoadPeriodKey(at = new Date(), timeZone = "Asia/Taipei"): string {
  return homeNearbyPeriodFromHour(localHourInTimeZone(at, timeZone));
}
