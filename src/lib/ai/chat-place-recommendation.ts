import type { RoamiePayloadV2, RoamieRecommendationItem } from "@/lib/ai/types";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import {
  chatResponseModeForIntent,
  type NearbyPlaceIntent,
} from "@/lib/ai/chat-intent";
import { foodPreferenceSearchQuery } from "@/lib/ai/chat-dining-flow";
import {
  buildCampingRecommendationSummary,
  campingSearchAttempts,
  filterCampingPlaces,
} from "@/lib/ai/activity-camping";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/map-explore";
import {
  budgetPenaltyForPlace,
  buildBudgetRefinementSummary,
  lowBudgetSearchQuery,
  refinePlaceResultsForBudget,
} from "@/lib/ai/budget-refinement";
import {
  buildExclusionAcknowledgment,
  buildExclusionInsufficientSummary,
  filterPlacesByExclusion,
} from "@/lib/ai/recommendation-exclusion";
import { buildRefreshRecommendationSummary } from "@/lib/ai/chat-recommendation-refresh";
import {
  attractionTypeRankScore,
  buildAttractionRefreshSearchAttempts,
  filterPlacesForAttractionRecommendation,
  userWantsParkRecommendations,
} from "@/lib/ai/place-recommendation-rules";
import { classifyDestinationForPlaceSearch } from "@/lib/ai/landmark-place-strategy";
import {
  filterAlreadyRecommendedPlaces,
  filterExcludedPlaceIds,
  normalizePlaceName,
  type PlaceLike,
} from "@/lib/place-planning-memory";
import {
  beginPlacesFlow,
  endPlacesFlow,
  placesStatsPayload,
} from "@/lib/places-api-stats";
import {
  filterNonLodgingPlaces,
  isExplicitLodgingSearchIntent,
} from "@/lib/lodging-place-filter";
import {
  logChatPlacesRequest,
  logChatPlacesResponse,
  logChatPlacesError,
  logChatTextSearchRequest,
  logChatPlacesRawCount,
} from "@/lib/ai/chat-place-flow-log";
import {
  CHAT_NEARBY_RADIUS_STEPS_M,
  CHAT_PLACE_DETAIL_NEARBY_RADIUS_STEPS_M,
  filterPlacesByNearbyDistance,
  maxDistanceKmForIntent,
} from "@/lib/ai/chat-nearby-search";
import {
  logChatNearbyRequest,
  logChatNearbyResponse,
  logChatNearbyError,
  buildPlaceDetailNearbySearchKey,
  runPlaceDetailNearbySingleFlight,
} from "@/lib/chat-place-context";
import { filterPlacesByCafeGuard } from "@/lib/ai/chat-category-place-guard";
import {
  buildFoodSearchAttempts,
  filterPlacesForFoodIntent,
  FOOD_DISTRICT_CARD_TYPE,
  isFoodIntentText,
} from "@/lib/ai/chat-food-filter";
import type { ChatPlaceSearchContext } from "@/lib/ai/chat-place-search-context";
import {
  filterPlacesByDestinationGuard,
  placesSearchContextPayload,
} from "@/lib/ai/chat-place-search-context";
import {
  buildExplicitAvoidKeywords,
  buildExplicitPreferKeywords,
  buildPlusPreferenceRankingContext,
  plusPreferenceRankPenalty,
  type PlusPreferenceRankingContext,
} from "@/lib/plus-preference-ranking";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import { userProfileForReasonFrom } from "@/lib/build-place-recommendation-reason";
import { getPreferences } from "@/lib/preferences-storage";
import { getUserProfile } from "@/lib/profile-storage";
import { listPlaces } from "@/lib/places-storage";

export type PlaceSearchData = {
  query: string;
  lat: number;
  lng: number;
  mode: "nearby" | "text" | "multi";
  includedTypes?: string[];
  radius?: number;
  locale?: Locale;
  placesCaller?: string;
  placesScreen?: "chat" | "home" | "explore" | "ai_recommend" | "itinerary" | "plan" | "place_detail" | "unknown";
  destinationName?: string;
  searchMode?: "destination" | "nearby";
  skipLocationBias?: boolean;
  intentCategory?: string;
};

export type PlaceSearchFn = (args: { data: PlaceSearchData }) => Promise<{ places?: PlaceResult[] }>;

export type PlaceSearchExtras = {
  searchContext?: ChatPlaceSearchContext;
  intentCategory?: string;
};

const RECOMMENDATION_COUNT = 5;

function nearbySearchAttemptForIntent(
  intent: NearbyPlaceIntent,
  foodPreference?: string,
  context?: CanonicalTravelContext,
  userText?: string,
  opts?: { placeDetailNearby?: boolean },
): SearchAttempt {
  if (opts?.placeDetailNearby) {
    return placeDetailNearbySearchAttempts(intent)[0]!;
  }
  if (/(酒吧|居酒屋|\bbar\b)/i.test(userText ?? "")) {
    return {
      query: "酒吧",
      mode: "nearby",
      includedTypes: ["bar"],
    };
  }

  const moodBlob = `${context?.mood ?? ""} ${context?.setting ?? ""} ${context?.tripPurpose ?? ""}`;

  if (context?.budgetPreference === "low" || context?.tripPurpose === "refine_recommendations") {
    return lowBudgetSearchQuery(intent, moodBlob);
  }

  if (intent === "restaurant") {
    const cuisineQuery =
      foodPreference && foodPreference !== "any"
        ? foodPreferenceSearchQuery(foodPreference)
        : undefined;
    if (cuisineQuery) {
      return { query: cuisineQuery, mode: "text", includedTypes: ["restaurant", "food"] };
    }
    return {
      query: "餐廳 美食",
      mode: "nearby",
      includedTypes: ["restaurant", "food"],
    };
  }
  if (intent === "cafe") {
    return {
      query: /下雨|雨天|室內/.test(moodBlob) ? "室內 咖啡廳" : "咖啡廳",
      mode: "nearby",
      includedTypes: ["cafe", "coffee_shop", "bakery"],
    };
  }
  if (intent === "camping") {
    return {
      query: "露營區 campground glamping",
      mode: "text",
      includedTypes: ["campground", "rv_park", "lodging"],
    };
  }
  if (/(下雨|雨天|室內)/.test(moodBlob)) {
    return {
      query: "室內 景點",
      mode: "nearby",
      includedTypes: ["museum", "shopping_mall", "cafe", "book_store", "tourist_attraction"],
    };
  }
  if (/(累|疲|放鬆|放空|輕鬆|療癒)/.test(moodBlob)) {
    return {
      query: "公園 散步 咖啡 藝術中心 河岸",
      mode: "nearby",
      includedTypes: [
        "tourist_attraction",
        "park",
        "cafe",
        "coffee_shop",
        "shopping_mall",
        "museum",
        "art_gallery",
      ],
    };
  }
  return {
    query: "景點",
    mode: "nearby",
    includedTypes: ["tourist_attraction", "museum", "art_gallery", "shopping_mall"],
  };
}

function searchConfigForIntent(
  intent: NearbyPlaceIntent,
  foodPreference?: string,
  context?: CanonicalTravelContext,
  userText?: string,
): {
  query: string;
  mode: "nearby" | "text";
  includedTypes?: string[];
} {
  return nearbySearchAttemptForIntent(intent, foodPreference, context, userText);
}

function rankPlaces(
  places: PlaceResult[],
  lat: number,
  lng: number,
  context?: CanonicalTravelContext,
  plusCtx?: PlusPreferenceRankingContext | null,
): PlaceResult[] {
  const preference = context?.budgetPreference;
  return [...places].sort((a, b) => {
    const distA =
      a.lat != null && a.lng != null
        ? distanceMeters({ lat, lng }, { lat: a.lat, lng: a.lng })
        : Number.MAX_SAFE_INTEGER;
    const distB =
      b.lat != null && b.lng != null
        ? distanceMeters({ lat, lng }, { lat: b.lat, lng: b.lng })
        : Number.MAX_SAFE_INTEGER;
    const plusA = plusCtx
      ? -plusPreferenceRankPenalty(
          {
            name: a.name,
            primaryType: a.primaryType,
            types: a.types,
            rating: a.rating,
            userRatingCount: a.userRatingCount,
          },
          plusCtx,
        )
      : 0;
    const plusB = plusCtx
      ? -plusPreferenceRankPenalty(
          {
            name: b.name,
            primaryType: b.primaryType,
            types: b.types,
            rating: b.rating,
            userRatingCount: b.userRatingCount,
          },
          plusCtx,
        )
      : 0;
    const scoreA =
      (a.rating ?? 0) * Math.log10((a.userRatingCount ?? 0) + 10) -
      distA / 50_000 +
      budgetPenaltyForPlace(a, preference) * -0.5 +
      attractionTypeRankScore(a) * 2 +
      plusA / 10;
    const scoreB =
      (b.rating ?? 0) * Math.log10((b.userRatingCount ?? 0) + 10) -
      distB / 50_000 +
      budgetPenaltyForPlace(b, preference) * -0.5 +
      attractionTypeRankScore(b) * 2 +
      plusB / 10;
    return scoreB - scoreA;
  });
}

async function resolveChatPlusRankingContext(
  context: CanonicalTravelContext | undefined,
  input?: {
    reasonProfile?: UserProfileForReason | null;
    savedPlaces?: Array<{ name: string; category?: string | null }>;
    hasPlusAccess?: boolean;
  },
): Promise<PlusPreferenceRankingContext | null> {
  let profile = input?.reasonProfile ?? null;
  let savedPlaces = input?.savedPlaces;

  if (!profile && input?.hasPlusAccess) {
    try {
      const [prefs, userProfile, saved] = await Promise.all([
        getPreferences(),
        getUserProfile().catch(() => null),
        listPlaces().catch(() => []),
      ]);
      profile = userProfileForReasonFrom(prefs, {
        travelStyle: userProfile?.travelStyle,
        personalityType: userProfile?.personalityType,
        personalitySummary: userProfile?.personalitySummary,
        aiPreferences: userProfile?.aiPreferences,
        hasPlusAccess: true,
      });
      savedPlaces = saved.map((p) => ({ name: p.name, category: p.category }));
    } catch {
      return null;
    }
  }

  if (!profile) return null;

  return buildPlusPreferenceRankingContext({
    profile,
    savedPlaces,
    explicitAvoidKeywords: buildExplicitAvoidKeywords(context?.excludedCategories),
    explicitPreferKeywords: buildExplicitPreferKeywords({
      mood: context?.mood,
      setting: context?.setting,
      interests: context?.interests,
      selectedInterests: context?.selectedInterests,
    }),
    mood: context?.mood,
    setting: context?.setting,
  });
}

function formatPlaceList(picks: PlaceResult[]): string {
  return picks
    .slice(0, RECOMMENDATION_COUNT)
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join("\n");
}

function weatherLead(ctx: CanonicalTravelContext): string {
  const condition = ctx.weather?.condition?.trim();
  if (!condition) return "";
  if (/雨|陰|多雲/.test(condition)) return `今天天氣${condition}，`;
  return "我看現在天氣不錯，";
}

function buildSummary(
  intent: NearbyPlaceIntent,
  picks: PlaceResult[],
  ctx: CanonicalTravelContext,
  excludedCategories?: string[],
): string {
  if (ctx.tripPurpose === "refresh_recommendations") {
    return buildRefreshRecommendationSummary(picks, intent);
  }
  if (ctx.budgetPreference === "low" || ctx.tripPurpose === "refine_recommendations") {
    return buildBudgetRefinementSummary(ctx, picks);
  }

  const list = formatPlaceList(picks);
  const weather = weatherLead(ctx);
  const exclusionAck = buildExclusionAcknowledgment(excludedCategories);

  if (intent === "cafe") {
    const lead = exclusionAck ?? "看起來你想找個地方放鬆一下 ☕";
    return [
      lead,
      "",
      "附近有幾間我覺得不錯的選擇：",
      "",
      list,
      "",
      "如果你偏好：",
      "- 安靜讀書",
      "- 有插座",
      "- 甜點好吃",
      "- 適合久坐",
      "",
      "我可以再幫你縮小範圍。",
    ].join("\n");
  }

  if (intent === "restaurant") {
    const lead =
      exclusionAck ?? "依你現在的需求，附近這幾間餐廳值得先看看：";
    return [
      lead,
      "",
      list,
      "",
      "如果想換個菜系或預算，跟我說一聲就好。",
    ].join("\n");
  }

  if (intent === "camping") {
    return buildCampingRecommendationSummary(picks, ctx);
  }

  const mood = ctx.mood;
  if (!mood) {
    return [
      "附近這幾個地方可以先看看：",
      "",
      list,
      "",
      "選一個最有感覺的，或跟我說想調整什麼。",
    ].join("\n");
  }
  if (/(下雨|雨天)/.test(mood) || ctx.setting === "室內") {
    return [
      "下雨天也想出門走走對吧？",
      "",
      `${weather}附近這幾個地方比較適合待在室內：`,
      "",
      list,
      "",
      "偏好咖啡廳、書店還是展覽？我可以再幫你縮小範圍。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (/(累|疲|放鬆|放空)/.test(mood)) {
    return [
      "今天想放空一下對吧？",
      "",
      `${weather}附近有幾個適合慢慢走的地方：`,
      "",
      list,
      "",
      "偏好咖啡廳、散步還是海景？跟我說一下，我可以再幫你縮小範圍。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `依「${mood}」的心情，附近這幾個地方可以先看看：`,
    "",
    list,
    "",
    "選一個最有感覺的，或跟我說想調整什麼。",
  ].join("\n");
}

export type SearchAttempt = {
  query: string;
  mode: "nearby" | "text" | "multi";
  includedTypes?: string[];
  nearbyGroups?: string[][];
};

function placeDetailNearbySearchAttempts(intent: NearbyPlaceIntent): SearchAttempt[] {
  if (intent === "cafe") {
    return [
      { query: "", mode: "nearby", includedTypes: ["cafe"] },
      { query: "", mode: "nearby", includedTypes: ["coffee_shop"] },
      { query: "", mode: "nearby", includedTypes: ["bakery"] },
    ];
  }
  if (intent === "restaurant") {
    return [
      {
        query: "",
        mode: "multi",
        nearbyGroups: [["restaurant"], ["meal_takeaway"], ["fast_food_restaurant"]],
      },
      { query: "", mode: "nearby", includedTypes: ["restaurant"] },
      { query: "", mode: "nearby", includedTypes: ["meal_takeaway"] },
    ];
  }
  return [
    { query: "", mode: "nearby", includedTypes: ["tourist_attraction"] },
    { query: "", mode: "nearby", includedTypes: ["museum"] },
    { query: "", mode: "nearby", includedTypes: ["park"] },
  ];
}

/** 餐廳搜尋 fallback：僅 food 類型，不 fallback 到景點 */
export function restaurantSearchFallbackQueries(
  foodPreference?: string,
  userText = "",
): SearchAttempt[] {
  return buildFoodSearchAttempts(foodPreference, userText);
}

async function runPlaceSearch(
  searchPlaces: PlaceSearchFn,
  lat: number,
  lng: number,
  locale: Locale,
  attempt: SearchAttempt,
  caller = "chat.runPlaceSearch",
  extras?: PlaceSearchExtras & { radius?: number },
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const ctxPayload = extras?.searchContext
    ? placesSearchContextPayload(extras.searchContext, extras.intentCategory)
    : {};
  const radius = extras?.radius;
  console.info("[CHAT_PLACES_REQUEST]", {
    lat,
    lng,
    radius: radius ?? "",
    types: attempt.includedTypes?.join(",") ?? "",
    mode: attempt.mode,
    query: attempt.query || "(nearby)",
  });
  const result = await searchPlaces({
    data: {
      query: attempt.query,
      lat,
      lng,
      mode: attempt.mode,
      includedTypes: attempt.includedTypes,
      nearbyGroups: attempt.nearbyGroups,
      radius,
      locale,
      ...placesStatsPayload({
        placesCaller: caller,
        placesScreen: "chat",
      }),
      ...ctxPayload,
      intentCategory: extras?.intentCategory ?? ctxPayload.intentCategory,
      searchMode: ctxPayload.searchMode ?? "nearby",
    },
  });
  const places = result.places ?? [];
  if (result.error) {
    logChatNearbyError({ message: result.error });
  }
  console.info("[CHAT_PLACES_RAW_COUNT]", {
    count: places.length,
    error: result.error ?? "",
    mode: attempt.mode,
    types: attempt.includedTypes?.join(",") ?? attempt.nearbyGroups?.length ?? "",
  });
  logChatPlacesRawCount(places.length);
  return { places, error: result.error ?? null };
}

/** 依序嘗試多組 query，回傳第一組有結果的 places */
export async function fetchPlacesWithSearchAttempts(
  searchPlaces: PlaceSearchFn,
  lat: number,
  lng: number,
  locale: Locale,
  attempts: SearchAttempt[],
  caller = "chat.fetchPlacesWithSearchAttempts",
  extras?: PlaceSearchExtras,
): Promise<PlaceResult[]> {
  for (const attempt of attempts) {
    if (attempt.mode === "text") {
      logChatTextSearchRequest(attempt.query);
    }
    logChatPlacesRequest({
      mode: attempt.mode,
      query: attempt.query,
      lat: lat.toFixed(4),
      lng: lng.toFixed(4),
      caller,
      searchMode: extras?.searchContext?.searchMode,
      destinationName: extras?.searchContext?.destinationName,
    });
    try {
      const { places } = await runPlaceSearch(
        searchPlaces,
        lat,
        lng,
        locale,
        attempt,
        caller,
        extras,
      );
      if (places.length > 0) {
        logChatPlacesResponse(places.length, attempt.query);
        return places;
      }
    } catch (error) {
      logChatPlacesError(error, `query=${attempt.query}`);
    }
  }
  return [];
}

/** 合併多組 query 結果，去重 placeId，供目的地推薦使用 */
export async function fetchPlacesWithSearchAttemptsMerged(
  searchPlaces: PlaceSearchFn,
  lat: number,
  lng: number,
  locale: Locale,
  attempts: SearchAttempt[],
  caller = "chat.fetchPlacesWithSearchAttemptsMerged",
  opts?: { minResults?: number; maxResults?: number; extras?: PlaceSearchExtras },
): Promise<PlaceResult[]> {
  const minResults = opts?.minResults ?? 3;
  const maxResults = opts?.maxResults ?? 24;
  const extras = opts?.extras;
  const seen = new Set<string>();
  const merged: PlaceResult[] = [];

  for (const attempt of attempts) {
    if (attempt.mode === "text") {
      logChatTextSearchRequest(attempt.query);
    }
    logChatPlacesRequest({
      mode: attempt.mode,
      query: attempt.query,
      lat: lat.toFixed(4),
      lng: lng.toFixed(4),
      caller,
      searchMode: extras?.searchContext?.searchMode,
      destinationName: extras?.searchContext?.destinationName,
    });
    try {
      const { places } = await runPlaceSearch(
        searchPlaces,
        lat,
        lng,
        locale,
        attempt,
        caller,
        extras,
      );
      for (const place of places) {
        const id = (place.id ?? place.name ?? "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(place);
      }
      if (merged.length >= maxResults) break;
      if (merged.length >= minResults && attempt === attempts[attempts.length - 1]) break;
    } catch (error) {
      logChatPlacesError(error, `query=${attempt.query}`);
    }
  }

  if (merged.length > 0) {
    logChatPlacesResponse(merged.length, "merged");
  }
  return merged.slice(0, maxResults);
}

function applyNearbyPlaceFilters(
  ranked: PlaceResult[],
  params: {
    intent: NearbyPlaceIntent;
    lat: number;
    lng: number;
    excluded: string[];
    excludePlaceIds: string[];
    allowParks: boolean;
    blockedCoreNames?: string[];
    destinationProfile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
    allowLodging: boolean;
    searchContext?: ChatPlaceSearchContext;
    userText?: string;
    maxDistanceKm: number;
    strictCafeGuard: boolean;
    placeDetailNearby?: boolean;
  },
): PlaceResult[] {
  if (params.placeDetailNearby) {
    let working = filterPlacesByExclusion(ranked, params.excluded);
    working = filterExcludedPlaceIds(working, params.excludePlaceIds);
    working = working.filter((place) => {
      const biz = (place.businessStatus ?? "").trim().toUpperCase();
      return biz !== "CLOSED_PERMANENTLY";
    });
    working = filterPlacesByNearbyDistance(working, params.lat, params.lng, params.maxDistanceKm);
    return working;
  }

  let working = ranked;
  if (params.searchContext?.searchMode === "destination" && params.searchContext.destinationName) {
    working = filterPlacesByDestinationGuard(
      working,
      params.searchContext.destinationName,
      params.userText,
    );
  }
  working = filterPlacesByExclusion(working, params.excluded);
  working = filterExcludedPlaceIds(working, params.excludePlaceIds);
  if (params.intent !== "restaurant" && !isFoodIntentText(params.userText ?? "")) {
    working = filterPlacesForAttractionRecommendation(working, {
      allowParks: params.allowParks,
      blockedCoreNames: params.blockedCoreNames,
      blockedPlaceIds: params.excludePlaceIds,
      profile: params.searchContext?.searchMode === "nearby" ? undefined : params.destinationProfile,
      parentLandmark:
        params.searchContext?.searchMode === "nearby"
          ? undefined
          : params.destinationProfile?.parentLandmark,
    });
  }
  if (params.intent === "camping") {
    working = filterCampingPlaces(working);
  }
  working = filterNonLodgingPlaces(working, { allowLodging: params.allowLodging });
  if (params.intent === "cafe" && params.strictCafeGuard) {
    working = filterPlacesByCafeGuard(working);
  }
  if (params.intent === "restaurant" || isFoodIntentText(params.userText ?? "")) {
    const { restaurants, districts } = filterPlacesForFoodIntent(working, params.userText ?? "");
    working = [...restaurants, ...districts];
  }
  working = filterPlacesByNearbyDistance(working, params.lat, params.lng, params.maxDistanceKm);
  return working;
}

export async function fetchNearbyPlacesForIntent(
  intent: NearbyPlaceIntent,
  lat: number,
  lng: number,
  locale: Locale,
  searchPlaces: PlaceSearchFn,
  foodPreference?: string,
  context?: CanonicalTravelContext,
  excludePlaceIds: string[] = [],
  opts?: {
    blockedCoreNames?: string[];
    cityLabel?: string;
    userText?: string;
    searchContext?: ChatPlaceSearchContext;
    reasonProfile?: UserProfileForReason | null;
    savedPlaces?: Array<{ name: string; category?: string | null }>;
    hasPlusAccess?: boolean;
    placeDetailNearby?: boolean;
    focusPlaceId?: string;
  },
): Promise<PlaceResult[]> {
  const run = async (): Promise<PlaceResult[]> =>
    fetchNearbyPlacesForIntentInner(
      intent,
      lat,
      lng,
      locale,
      searchPlaces,
      foodPreference,
      context,
      excludePlaceIds,
      opts,
    );

  if (opts?.placeDetailNearby) {
    const key = buildPlaceDetailNearbySearchKey(lat, lng, intent, opts.focusPlaceId);
    return runPlaceDetailNearbySingleFlight(key, run);
  }
  return run();
}

async function fetchNearbyPlacesForIntentInner(
  intent: NearbyPlaceIntent,
  lat: number,
  lng: number,
  locale: Locale,
  searchPlaces: PlaceSearchFn,
  foodPreference?: string,
  context?: CanonicalTravelContext,
  excludePlaceIds: string[] = [],
  opts?: {
    blockedCoreNames?: string[];
    cityLabel?: string;
    userText?: string;
    searchContext?: ChatPlaceSearchContext;
    reasonProfile?: UserProfileForReason | null;
    savedPlaces?: Array<{ name: string; category?: string | null }>;
    hasPlusAccess?: boolean;
    placeDetailNearby?: boolean;
    focusPlaceId?: string;
  },
): Promise<PlaceResult[]> {
  const excluded = context?.excludedCategories ?? [];
  const plusCtx = await resolveChatPlusRankingContext(context, opts);
  const allowParks = userWantsParkRecommendations(opts?.userText ?? "", context);
  const isRefresh =
    context?.tripPurpose === "refresh_recommendations" ||
    context?.tripPurpose === "refine_recommendations";
  const destinationProfile =
    opts?.placeDetailNearby || !opts?.cityLabel
      ? undefined
      : classifyDestinationForPlaceSearch(opts.cityLabel);
  const searchExtras: PlaceSearchExtras | undefined = opts?.searchContext
    ? { searchContext: opts.searchContext, intentCategory: intent }
    : undefined;

  const allowLodging =
    intent === "camping" || isExplicitLodgingSearchIntent(opts?.userText ?? "");

  const baseAttempt: SearchAttempt =
    intent === "restaurant"
      ? restaurantSearchFallbackQueries(foodPreference, opts?.userText ?? "")[0] ?? {
          query: "餐廳 美食",
          mode: "nearby",
          includedTypes: ["restaurant", "food"],
        }
      : intent === "camping"
        ? campingSearchAttempts()[0] ?? { query: "露營", mode: "text" }
        : isRefresh
          ? buildAttractionRefreshSearchAttempts(opts?.cityLabel, destinationProfile)[0] ?? {
              query: "景點",
              mode: "nearby",
            }
          : nearbySearchAttemptForIntent(
              intent,
              foodPreference,
              context,
              opts?.userText,
              { placeDetailNearby: opts?.placeDetailNearby },
            );

  const searchAttempts: SearchAttempt[] = opts?.placeDetailNearby
    ? placeDetailNearbySearchAttempts(intent)
    : intent === "restaurant"
      ? restaurantSearchFallbackQueries(foodPreference, opts?.userText ?? "")
      : [baseAttempt];

  const radiusSteps = opts?.placeDetailNearby
    ? CHAT_PLACE_DETAIL_NEARBY_RADIUS_STEPS_M
    : CHAT_NEARBY_RADIUS_STEPS_M;

  console.info("[CHAT_NEARBY_SEARCH]", {
    basePlace: opts?.searchContext?.destinationName ?? opts?.cityLabel ?? "",
    category: intent,
    lat,
    lng,
    placeDetailNearby: Boolean(opts?.placeDetailNearby),
    attemptCount: searchAttempts.length,
  });

  let best: PlaceResult[] = [];
  let lastError = "";
  let lastRawCount = 0;

  for (let stepIndex = 0; stepIndex < radiusSteps.length; stepIndex++) {
    const radius = radiusSteps[stepIndex]!;
    logChatNearbyRequest({ center: { lat, lng }, radius, category: intent });
    const maxDistanceKm = maxDistanceKmForIntent(intent, stepIndex);
    const strictCafeGuard = stepIndex === 0 && !opts?.placeDetailNearby;

    const seen = new Set<string>();
    let places: PlaceResult[] = [];
    for (const attempt of searchAttempts) {
      const { places: batch, error } = await runPlaceSearch(
        searchPlaces,
        lat,
        lng,
        locale,
        attempt,
        "chat.fetchNearbyPlacesForIntent",
        {
          ...searchExtras,
          radius,
          intentCategory: intent,
        },
      );
      if (error) lastError = error;
      lastRawCount = Math.max(lastRawCount, batch.length);
      for (const place of batch) {
        const id = (place.id ?? place.name ?? "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        places.push(place);
      }
      if (places.length >= RECOMMENDATION_COUNT) break;
    }

    let ranked = rankPlaces(places, lat, lng, context, plusCtx);
    ranked = applyNearbyPlaceFilters(ranked, {
      intent,
      lat,
      lng,
      excluded,
      excludePlaceIds,
      allowParks,
      blockedCoreNames: opts?.blockedCoreNames,
      destinationProfile,
      allowLodging,
      searchContext: opts?.searchContext,
      userText: opts?.userText,
      maxDistanceKm,
      strictCafeGuard,
      placeDetailNearby: opts?.placeDetailNearby,
    });

    console.info("[CHAT_PLACES_FILTERED_COUNT]", {
      count: ranked.length,
      radius,
      stepIndex,
      rawCount: places.length,
    });

    if (ranked.length > best.length) {
      best = ranked;
    }
    if (best.length >= RECOMMENDATION_COUNT) break;
    if (opts?.placeDetailNearby && places.length === 0 && stepIndex >= 1) break;
  }

  if (context?.budgetPreference === "low" && !opts?.placeDetailNearby) {
    best = refinePlaceResultsForBudget(best, "low");
  }

  console.info(
    `[CHAT_PLACES_SUCCESS] count=${best.length} excluded=${excluded.length} deduped=${excludePlaceIds.length}`,
  );
  logChatNearbyResponse({
    status: best.length > 0 ? "ok" : lastError ? "error" : "empty",
    count: best.length,
    firstResultName: best[0]?.name ?? "",
    error: lastError,
    rawCount: lastRawCount,
    filteredCount: best.length,
  });
  return best;
}

export function buildSummaryForRecommendations(
  intent: NearbyPlaceIntent,
  recommendations: RoamieRecommendationItem[],
  ctx: CanonicalTravelContext,
  excludedCategories?: string[],
): string {
  const picks = recommendations.map((item) => ({
    name: (item.placeName ?? item.name ?? "").trim(),
  })).filter((p) => p.name);
  const list = picks.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  const count = picks.length;
  const exclusionAck = buildExclusionAcknowledgment(excludedCategories);

  if (intent === "cafe") {
    const lead = exclusionAck ?? "看起來你想找個地方放鬆一下 ☕";
    return [
      lead,
      "",
      `附近有 ${count} 間我覺得不錯的選擇：`,
      "",
      list,
      "",
      "如果你偏好：",
      "- 安靜讀書",
      "- 有插座",
      "- 甜點好吃",
      "- 適合久坐",
      "",
      "我可以再幫你縮小範圍。",
    ].join("\n");
  }

  if (intent === "restaurant") {
    const lead = exclusionAck ?? "依你現在的需求，附近這幾間餐廳值得先看看：";
    return [lead, "", list, "", "如果想換個菜系或預算，跟我說一聲就好。"].join("\n");
  }

  return [
    `附近找到 ${count} 個值得先看看的地方：`,
    "",
    list,
    "",
    "選一個最有感覺的，或跟我說想調整什麼。",
  ].join("\n");
}

export async function buildNearbyPlaceRecommendation(params: {
  intent: NearbyPlaceIntent;
  lat: number;
  lng: number;
  locale: Locale;
  context: CanonicalTravelContext;
  searchPlaces: PlaceSearchFn;
  foodPreference?: string;
  excludedCategories?: string[];
  excludePlaceIds?: string[];
  rejectedPlaceNames?: string[];
  priorRecommended?: PlaceLike[];
  blockedCoreNames?: string[];
  userText?: string;
  cityLabel?: string;
  searchContext?: ChatPlaceSearchContext;
  reasonProfile?: UserProfileForReason | null;
  savedPlaces?: Array<{ name: string; category?: string | null }>;
  hasPlusAccess?: boolean;
  placeDetailNearby?: boolean;
  focusPlaceId?: string;
}): Promise<{ summary: string; payload: RoamiePayloadV2; recommendations: RoamieRecommendationItem[] }> {
  const flow = beginPlacesFlow("chat_once");
  try {
    const {
      intent,
      lat,
      lng,
      locale,
      context,
      searchPlaces,
      foodPreference,
      excludedCategories,
      excludePlaceIds = [],
      rejectedPlaceNames = [],
      priorRecommended = [],
      blockedCoreNames = [],
      userText = "",
      cityLabel,
      searchContext,
      reasonProfile,
      savedPlaces,
      hasPlusAccess,
    } = params;
    const excluded =
      excludedCategories ??
      context.excludedCategories ??
      [];
    const contextWithExclusion: CanonicalTravelContext = {
      ...context,
      excludedCategories: excluded,
    };
    const coreBlock = [
      ...blockedCoreNames,
      ...priorRecommended.map((p) => normalizePlaceName(p.placeName ?? p.name)).filter(Boolean),
    ];
    let places = await fetchNearbyPlacesForIntent(
      intent,
      lat,
      lng,
      locale,
      searchPlaces,
      foodPreference,
      contextWithExclusion,
      excludePlaceIds,
      {
        blockedCoreNames: coreBlock,
        cityLabel: cityLabel ?? context.destination,
        userText,
        searchContext,
        reasonProfile,
        savedPlaces,
        hasPlusAccess,
        placeDetailNearby: params.placeDetailNearby,
        focusPlaceId: params.focusPlaceId,
      },
    );
    places = filterAlreadyRecommendedPlaces(places, {
      recommended: priorRecommended,
      rejectedNames: rejectedPlaceNames,
      blockedCoreNames: coreBlock,
    });

    let foodDistricts: PlaceResult[] = [];
    if (intent === "restaurant" || isFoodIntentText(userText)) {
      const split = filterPlacesForFoodIntent(places, userText);
      places = split.restaurants;
      foodDistricts = split.districts;
    }

    const restaurantPicks = places.slice(0, RECOMMENDATION_COUNT);
    const districtPick =
      foodDistricts.length > 0 && restaurantPicks.length < RECOMMENDATION_COUNT
        ? foodDistricts.slice(0, 1)
        : [];
    const picks = [...restaurantPicks, ...districtPick];

    if (!picks.length) {
      if (excluded.length) {
        const summary = buildExclusionInsufficientSummary(
          excluded,
          intent === "cafe"
            ? "cafe"
            : intent === "restaurant"
              ? "restaurant"
              : intent === "camping"
                ? "attraction"
                : "attraction",
        );
        return { summary, payload: {
          version: 2,
          title: "Roamie 推薦",
          summary,
          moodTag: context.mood ?? "",
          recommendations: [],
          itinerary: [],
          generatedAt: new Date().toISOString(),
        }, recommendations: [] };
      }
      throw new Error("places_empty");
    }

    const recommendations: RoamieRecommendationItem[] = picks.map((p) => {
      const distM =
        p.lat != null && p.lng != null
          ? distanceMeters({ lat, lng }, { lat: p.lat, lng: p.lng })
          : undefined;
      const isDistrict = districtPick.some((d) => d.id === p.id);
      return mapPlaceResultToChatItem(p, {
        mood: context.mood,
        locale,
        distanceMeters: distM,
        categoryLabel: isDistrict ? FOOD_DISTRICT_CARD_TYPE : undefined,
      });
    }).map((item) =>
      districtPick.some((d) => d.id === item.googlePlaceId || d.id === item.placeId)
        ? {
            ...item,
            type: FOOD_DISTRICT_CARD_TYPE,
            description: item.description?.trim()
              ? `${FOOD_DISTRICT_CARD_TYPE} · ${item.description}`
              : FOOD_DISTRICT_CARD_TYPE,
          }
        : item,
    );

    const summary = buildSummary(intent, picks, context, excluded);
    const mode = chatResponseModeForIntent(intent);
    console.info(`[CHAT_RESPONSE] mode=${mode}`);

    const payload: RoamiePayloadV2 = {
      version: 2,
      title: "Roamie 推薦",
      summary,
      moodTag: context.mood ?? "",
      recommendations,
      itinerary: [],
      generatedAt: new Date().toISOString(),
    };

    return { summary, payload, recommendations };
  } finally {
    endPlacesFlow(flow);
  }
}
