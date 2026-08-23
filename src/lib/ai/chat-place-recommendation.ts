import type { RoamiePayloadV2, RoamieRecommendationItem } from "@/lib/ai/types";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { notePlacesSearchRateLimit } from "@/lib/places-classic-landmark-cache";
import { isPlacesRateLimited } from "@/lib/places-api-guard";
import {
  buildStructuredShortcutContext,
  chatResponseModeForIntent,
  resolveChatShortcutContext,
  type ChatShortcutScene,
  type NearbyPlaceIntent,
} from "@/lib/ai/chat-intent";
import {
  excludedTypesForShortcutScene,
  filterPlacesForShortcutScene,
  RELAX_WALK_INCLUDED_TYPES,
} from "@/lib/ai/shortcut-category-fidelity";
import {
  nearbySearchAttemptsForShortcutScene,
  shortcutSceneRankScore,
  SHORTCUT_CANDIDATE_POOL_TARGET,
  buildShortcutRankBreakdown,
  coffeeCandidateExcludeReason,
  pickShortcutTopPlaces,
} from "@/lib/ai/nearby-shortcut-ranking";
import { logShortcutRuntime } from "@/lib/ai/shortcut-runtime-diag";
import { matchesContinueRecommendationGrammar } from "@/lib/ai/continue-recommendation-intent";
import { buildPlacesSearchKey, readPlacesSearchCacheStatus } from "@/lib/places-search-dedupe";
import { resolveCanonicalPlaceIdentity } from "@/lib/place-canonical-identity";
import {
  logShortcutRecommendationSummary,
  type ShortcutRecommendationDiagnostics,
} from "@/lib/ai/shortcut-recommendation-telemetry";
import { foodPreferenceSearchQuery } from "@/lib/ai/chat-dining-flow";
import {
  buildCampingRecommendationSummary,
  campingSearchAttempts,
  filterCampingPlaces,
} from "@/lib/ai/activity-camping";
import { mapPlaceResultsToChatItems } from "@/lib/chat-session";
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
  resolvePresentableMoodTag,
  shouldDisplayMoodPresentation,
} from "@/lib/ai/mood-presentation";
import {
  attractionTypeRankScore,
  buildAttractionRefreshSearchAttempts,
  filterPlacesForAttractionRecommendation,
  userWantsParkRecommendations,
} from "@/lib/ai/place-recommendation-rules";
import { classifyDestinationForPlaceSearch } from "@/lib/ai/landmark-place-strategy";
import { isLikelyPlaceName, logNonPlaceCandidateRejected } from "@/lib/ai/place-name-likelihood";
import { filterExcludedRetailPlaces } from "@/lib/ai/ai-day-plan-slot-rules";
import {
  filterAlreadyRecommendedPlaces,
  filterExactPreviouslyRecommendedPlaces,
  filterExactExcludedPlaceIdentities,
  exactCanonicalIdentityMatch,
  filterExcludedPlaceIds,
  normalizePlaceName,
  type PlaceLike,
} from "@/lib/place-planning-memory";
import { beginPlacesFlow, endPlacesFlow, placesStatsPayload } from "@/lib/places-api-stats";
import { filterNonLodgingPlaces, isExplicitLodgingSearchIntent } from "@/lib/lodging-place-filter";
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
import {
  buildMealRecommendationDescription,
  filterPlacesForMealIntent,
  resolveExplicitMealIntent,
  sanitizeMealSummaryText,
} from "@/lib/ai/meal-intent-parser";
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
import {
  filterPlacesForTripAddPlaceRecommendation,
  isTripAddPlaceHardReject,
} from "@/lib/trip/trip-add-place-tourism-filter";
import { userProfileForReasonFrom } from "@/lib/build-place-recommendation-reason";
import { getPreferences } from "@/lib/preferences-storage";
import { getUserProfile } from "@/lib/profile-storage";
import { listPlaces } from "@/lib/places-storage";
import {
  homeLateNightOpenExpansionAttempts,
  homeLateNightSearchAttempts,
} from "@/lib/home-nearby-search";
import {
  HOME_NEARBY_MIN_DISPLAY,
  selectHomeNearbyPicks,
} from "@/lib/home-nearby-places-filter";
import { homeNearbySearchRadiusMeters, searchRadiusMeters } from "@/lib/search-radius";
import type { HomeShortcutSearchProfile } from "@/lib/ai/home-shortcut-handoff";
import {
  filterHomeSeaCandidates,
  HOME_SEA_LOCATION_BIAS_RADIUS_M,
  HOME_SEA_SEARCH_ATTEMPTS,
  rankHomeSeaCandidates,
} from "@/lib/home-sea-ranking";

export type PlaceSearchData = {
  query: string;
  lat: number;
  lng: number;
  mode: "nearby" | "text" | "multi";
  includedTypes?: string[];
  radius?: number;
  locale?: Locale;
  placesCaller?: string;
  placesScreen?:
    | "chat"
    | "home"
    | "explore"
    | "ai_recommend"
    | "itinerary"
    | "plan"
    | "place_detail"
    | "unknown";
  destinationName?: string;
  searchMode?: "destination" | "nearby";
  skipLocationBias?: boolean;
  intentCategory?: string;
  cacheDestination?: string;
  cacheCity?: string;
  cacheCountry?: string;
};

export type PlaceSearchFn = (args: {
  data: PlaceSearchData;
}) => Promise<{ places?: PlaceResult[]; error?: string | null }>;

export type PlaceSearchExtras = {
  searchContext?: ChatPlaceSearchContext;
  intentCategory?: string;
  /**
   * When true (or intentCategory=shopping), do not strip shopping_mall /
   * department_store via itinerary retail exclusion — that filter is for
   * day-plan scenic slots, not Shopping Intent discovery.
   */
  skipExcludedRetailFilter?: boolean;
};

const RECOMMENDATION_COUNT = 5;

function nearbySearchAttemptForIntent(
  intent: NearbyPlaceIntent,
  foodPreference?: string,
  context?: CanonicalTravelContext,
  userText?: string,
  opts?: { placeDetailNearby?: boolean; shortcutScene?: ChatShortcutScene | null },
): SearchAttempt {
  if (opts?.placeDetailNearby) {
    return placeDetailNearbySearchAttempts(intent)[0]!;
  }
  const shortcutScene = opts?.shortcutScene ?? resolveChatShortcutContext(userText ?? "")?.scene;
  if (shortcutScene) {
    return nearbySearchAttemptsForShortcutScene(shortcutScene)[0]!;
  }
  if (/(酒吧|居酒屋|\bbar\b)/i.test(userText ?? "")) {
    return {
      query: "酒吧",
      mode: "nearby",
      includedTypes: ["bar"],
    };
  }

  const moodBlob = `${context?.mood ?? ""} ${context?.setting ?? ""} ${context?.tripPurpose ?? ""} ${userText ?? ""}`;
  const shortcut = resolveChatShortcutContext(userText ?? "");

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
    const quietCafe = /安靜|安静|quiet|寧靜|宁静/.test(moodBlob);
    const rainyCafe = /下雨|雨天|室內|室内/.test(moodBlob);
    return {
      query: quietCafe ? "安靜 咖啡廳" : rainyCafe ? "室內 咖啡廳" : "咖啡廳 specialty coffee",
      mode: "nearby",
      includedTypes: ["cafe", "coffee_shop"],
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
      query: "室內 景點 博物館 美術館 商場",
      mode: "nearby",
      includedTypes: ["museum", "shopping_mall", "cafe", "book_store", "tourist_attraction"],
    };
  }
  if (/(深夜|夜景|晚上|夜間|late\s*night|night)/i.test(moodBlob)) {
    return {
      query: "夜景 夜間散步 晚上營業 商圈",
      mode: "nearby",
      includedTypes: ["tourist_attraction", "shopping_mall", "cafe", "park"],
    };
  }
  if (/(看海|海邊|海边|海景|beach|seaside|waterfront|harbor|ocean)/i.test(moodBlob)) {
    return {
      query: "海邊 海景 海港 waterfront seaside ocean view",
      mode: "nearby",
      includedTypes: ["beach", "marina", "tourist_attraction"],
    };
  }
  if (shortcut?.scene === "relax_walk") {
    return {
      query: "公園 散步 綠地 景觀 河岸",
      mode: "nearby",
      includedTypes: [...RELAX_WALK_INCLUDED_TYPES],
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

function nearbySearchAttemptsForIntent(
  intent: NearbyPlaceIntent,
  foodPreference?: string,
  context?: CanonicalTravelContext,
  userText?: string,
  opts?: { placeDetailNearby?: boolean; shortcutScene?: ChatShortcutScene | null },
): SearchAttempt[] {
  const shortcutScene = opts?.shortcutScene ?? resolveChatShortcutContext(userText ?? "")?.scene;
  if (shortcutScene) {
    return nearbySearchAttemptsForShortcutScene(shortcutScene);
  }
  const primary = nearbySearchAttemptForIntent(intent, foodPreference, context, userText, opts);
  if (opts?.placeDetailNearby || intent === "restaurant" || intent === "camping") {
    return [primary];
  }
  if (intent === "cafe") {
    return [
      primary,
      { query: "specialty coffee", mode: "text", includedTypes: ["cafe", "coffee_shop"] },
      { query: "咖啡廳", mode: "nearby", includedTypes: ["cafe", "coffee_shop"] },
    ];
  }
  return [
    primary,
    {
      query: "景點",
      mode: "nearby",
      includedTypes: ["tourist_attraction", "museum", "art_gallery"],
    },
    { query: "公園 散步", mode: "nearby", includedTypes: ["park", "tourist_attraction"] },
  ];
}

function logShortcutCandidateRuntime(
  scene: ChatShortcutScene,
  rawPlaces: PlaceResult[],
  ranked: PlaceResult[],
  origin: { lat: number; lng: number },
): void {
  const rankedIds = new Set(ranked.map((place) => (place.id ?? place.name ?? "").trim()));
  const rows = (scene === "quiet_cafe" ? rawPlaces : ranked).slice(0, 20).map((place, index) => {
    const excludeReason = scene === "quiet_cafe" ? coffeeCandidateExcludeReason(place) : "";
    const passed =
      scene === "quiet_cafe"
        ? !excludeReason
        : rankedIds.has((place.id ?? place.name ?? "").trim());
    return buildShortcutRankBreakdown(place, scene, {
      origin,
      distanceMetersFn: distanceMeters,
      passedCandidateFilter: passed,
      excludeReason: passed
        ? ""
        : excludeReason ||
          (scene === "quiet_cafe" ? coffeeCandidateExcludeReason(place) : "filtered"),
      rankingIndex: index,
    });
  });
  if (scene === "quiet_cafe") {
    console.info(
      "[RT_COFFEE_CANDIDATES]",
      `engine=nearby-shortcut-ranking`,
      `rawCount=${rawPlaces.length}`,
      `passedCount=${ranked.length}`,
      JSON.stringify(rows),
    );
  }
  const rankedRows = ranked.slice(0, 20).map((place, index) =>
    buildShortcutRankBreakdown(place, scene, {
      origin,
      distanceMetersFn: distanceMeters,
      passedCandidateFilter: true,
      rankingIndex: index,
    }),
  );
  console.info(
    "[RT_SHORTCUT_RANKING]",
    `scene=${scene}`,
    `engine=nearby-shortcut-ranking`,
    `count=${rankedRows.length}`,
    JSON.stringify(rankedRows),
  );
  logShortcutRuntime("[RT_SHORTCUT_RANKING_META]", {
    scene,
    engine: "nearby-shortcut-ranking",
    rawCount: rawPlaces.length,
    rankedCount: ranked.length,
    topName: ranked[0]?.name ?? "",
    topKind: rankedRows[0]?.matchedCategories ?? "",
    topScore: rankedRows[0]?.finalScore ?? "",
  });
}

function rankPlaces(
  places: PlaceResult[],
  lat: number,
  lng: number,
  context?: CanonicalTravelContext,
  plusCtx?: PlusPreferenceRankingContext | null,
  shortcutScene?: ChatShortcutScene | null,
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
    const shortcutA = shortcutSceneRankScore(shortcutScene, a);
    const shortcutB = shortcutSceneRankScore(shortcutScene, b);
    const attractionA = shortcutScene ? 0 : attractionTypeRankScore(a) * 2;
    const attractionB = shortcutScene ? 0 : attractionTypeRankScore(b) * 2;
    const scoreA =
      (a.rating ?? 0) * Math.log10((a.userRatingCount ?? 0) + 10) -
      distA / 50_000 +
      budgetPenaltyForPlace(a, preference) * -0.5 +
      attractionA +
      shortcutA +
      plusA / 10;
    const scoreB =
      (b.rating ?? 0) * Math.log10((b.userRatingCount ?? 0) + 10) -
      distB / 50_000 +
      budgetPenaltyForPlace(b, preference) * -0.5 +
      attractionB +
      shortcutB +
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
  shortcutScene?: ChatShortcutScene | null,
  searchProfile?: HomeShortcutSearchProfile | null,
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

  if (searchProfile === "home_sea") {
    return "我找到幾個適合看海走走的地方：\n\n想再看看其他選擇，也可以跟我說。";
  }

  if (intent === "cafe") {
    if (shortcutScene === "quiet_cafe") {
      return `附近有 ${picks.length} 間我覺得不錯的選擇：`;
    }
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
    const dest = ctx.destination?.trim();
    const lead =
      exclusionAck ??
      (dest ? `在${dest}，這幾間餐廳值得先看看：` : "依你現在的需求，附近這幾間餐廳值得先看看：");
    return [lead, "", list, "", "如果想換個菜系或預算，跟我說一聲就好。"].join("\n");
  }

  if (intent === "camping") {
    return buildCampingRecommendationSummary(picks, ctx);
  }

  const mood = shouldDisplayMoodPresentation(undefined, ctx) ? ctx.mood : undefined;
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

export function buildHomeSeaRecommendationDescription(place: PlaceResult): string {
  const coastalText = `${place.name ?? ""} ${place.address ?? ""} ${place.primaryType ?? ""} ${(place.types ?? []).join(" ")}`;
  if (/海灘|沙灘|海水浴場|beach/i.test(coastalText)) {
    return "適合到海邊走走、看看海景，稍微放空一下。";
  }
  if (/港灣|海港|漁港|碼頭|marina|harbou?r|pier/i.test(coastalText)) {
    return "帶有港灣或碼頭景觀，適合看海、散步。";
  }
  return "靠近海岸景觀，適合看海、散步或稍微放空一下。";
}

export type SearchAttempt = {
  id?: string;
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
  cityLabel?: string,
): SearchAttempt[] {
  return buildFoodSearchAttempts(foodPreference, userText, cityLabel);
}

async function runPlaceSearch(
  searchPlaces: PlaceSearchFn,
  lat: number,
  lng: number,
  locale: Locale,
  attempt: SearchAttempt,
  caller = "chat.runPlaceSearch",
  extras?: PlaceSearchExtras & { radius?: number },
): Promise<{ places: PlaceResult[]; error: string | null; rawCount: number; cacheStatus: string }> {
  const ctxPayload = extras?.searchContext
    ? placesSearchContextPayload(extras.searchContext, extras.intentCategory)
    : {};
  const radius = extras?.radius;
  logAiPipeline("[CHAT_PLACES_REQUEST]", {
    lat,
    lng,
    radius: radius ?? "",
    types: attempt.includedTypes?.join(",") ?? "",
    mode: attempt.mode,
    query: attempt.query || "(nearby)",
  });
  const requestData = {
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
  };
  const cacheKey = buildPlacesSearchKey(requestData);
  const result = await searchPlaces({ data: requestData });
  const cacheStatus = readPlacesSearchCacheStatus(cacheKey);
  const skipRetail =
    extras?.skipExcludedRetailFilter === true || extras?.intentCategory === "shopping";
  const rawPlaces = result.places ?? [];
  const places = skipRetail ? rawPlaces : filterExcludedRetailPlaces(rawPlaces);
  if (result.error) {
    notePlacesSearchRateLimit(result.error);
    logChatNearbyError({ message: result.error });
  }
  logAiPipeline("[CHAT_PLACES_RAW_COUNT]", {
    count: places.length,
    apiCount: rawPlaces.length,
    error: result.error ?? "",
    mode: attempt.mode,
    types: attempt.includedTypes?.join(",") ?? attempt.nearbyGroups?.length ?? "",
    skipRetail: skipRetail ? 1 : 0,
  });
  logChatPlacesRawCount(places.length);
  return { places, error: result.error ?? null, rawCount: rawPlaces.length, cacheStatus };
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
        // runPlaceSearch already applied retail filter unless shopping skip
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
  opts?: {
    minResults?: number;
    maxResults?: number;
    extras?: PlaceSearchExtras;
    onAttemptDiagnostics?: (diagnostics: {
      attemptsVisited: number;
      requestsSent: number;
      rateLimitedBeforeRequest: boolean;
      rawCount: number;
      usedQueries: string[];
    }) => void;
  },
): Promise<PlaceResult[]> {
  const minResults = opts?.minResults ?? 3;
  const maxResults = opts?.maxResults ?? 24;
  const extras = opts?.extras;
  const seen = new Set<string>();
  const merged: PlaceResult[] = [];
  let attemptsVisited = 0;
  let requestsSent = 0;
  let rateLimitedBeforeRequest = false;
  let rawCount = 0;
  const usedQueries: string[] = [];

  for (const attempt of attempts) {
    attemptsVisited += 1;
    if (isPlacesRateLimited()) {
      rateLimitedBeforeRequest = true;
      break;
    }
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
      requestsSent += 1;
      if (attempt.query.trim()) usedQueries.push(attempt.query.trim());
      const {
        places,
        error,
        rawCount: attemptRawCount,
      } = await runPlaceSearch(searchPlaces, lat, lng, locale, attempt, caller, extras);
      rawCount += attemptRawCount;
      if (notePlacesSearchRateLimit(error)) break;
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
  const skipRetail =
    extras?.skipExcludedRetailFilter === true || extras?.intentCategory === "shopping";
  const sliced = merged.slice(0, maxResults);
  opts?.onAttemptDiagnostics?.({
    attemptsVisited,
    requestsSent,
    rateLimitedBeforeRequest,
    rawCount,
    usedQueries,
  });
  return skipRetail ? sliced : filterExcludedRetailPlaces(sliced);
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
    tripAddPlace?: boolean;
    shortcutDiagnostics?: ShortcutRecommendationDiagnostics;
    shortcutScene?: ChatShortcutScene | null;
    structuredContinuation?: boolean;
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
  if (params.tripAddPlace) {
    working = working.filter((place) => !isTripAddPlaceHardReject(place));
  }
  working = working.filter((place) => {
    const name = (place.name ?? "").trim();
    if (!name) return false;
    const likelihood = isLikelyPlaceName(name);
    if (!likelihood.ok) {
      logNonPlaceCandidateRejected(
        name,
        likelihood.reason ?? "rejected_non_place",
        "chat_nearby_filter",
      );
      return false;
    }
    return true;
  });
  if (params.searchContext?.searchMode === "destination" && params.searchContext.destinationName) {
    working = filterPlacesByDestinationGuard(
      working,
      params.searchContext.destinationName,
      params.userText,
    );
  }
  if (params.shortcutDiagnostics) {
    params.shortcutDiagnostics.afterDestinationOrNearbyScopeCount = working.length;
  }
  working = filterPlacesByExclusion(working, params.excluded);
  working = params.structuredContinuation
    ? filterExactExcludedPlaceIdentities(working, params.excludePlaceIds)
    : filterExcludedPlaceIds(working, params.excludePlaceIds);
  if (params.shortcutDiagnostics) {
    params.shortcutDiagnostics.afterExclusionCount = working.length;
    params.shortcutDiagnostics.afterCanonicalIdCount = working.filter((place) =>
      Boolean((place.id ?? "").trim()),
    ).length;
  }
  const shortcutScene =
    params.shortcutScene ?? resolveChatShortcutContext(params.userText ?? "")?.scene;
  if (
    params.intent !== "restaurant" &&
    !isFoodIntentText(params.userText ?? "") &&
    !shortcutScene
  ) {
    working = filterPlacesForAttractionRecommendation(working, {
      allowParks: params.allowParks,
      blockedCoreNames: params.blockedCoreNames,
      blockedPlaceIds: params.excludePlaceIds,
      profile:
        params.searchContext?.searchMode === "nearby" ? undefined : params.destinationProfile,
      parentLandmark:
        params.searchContext?.searchMode === "nearby"
          ? undefined
          : params.destinationProfile?.parentLandmark,
    });
  }
  working = filterPlacesForShortcutScene(working, shortcutScene);
  if (params.shortcutDiagnostics) {
    params.shortcutDiagnostics.afterCategoryGuardCount = working.length;
  }
  if (params.intent === "camping") {
    working = filterCampingPlaces(working);
  }
  working = filterNonLodgingPlaces(working, { allowLodging: params.allowLodging });
  if (params.intent === "cafe" && params.strictCafeGuard && shortcutScene !== "quiet_cafe") {
    working = filterPlacesByCafeGuard(working);
  }
  if (params.intent === "restaurant" || isFoodIntentText(params.userText ?? "")) {
    const { restaurants, districts } = filterPlacesForFoodIntent(working, params.userText ?? "");
    working = [...restaurants, ...districts];
  }
  working = filterPlacesByNearbyDistance(working, params.lat, params.lng, params.maxDistanceKm);
  if (params.tripAddPlace) {
    working = filterPlacesForTripAddPlaceRecommendation(working, params.intent);
  }
  if (params.shortcutDiagnostics) {
    params.shortcutDiagnostics.afterQualityCount = working.length;
  }
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
    maxResults?: number;
    radiusSteps?: readonly number[];
    maxDistanceKm?: number;
    tripAddPlace?: boolean;
    nearbyGroups?: string[][];
    shortcutDiagnostics?: ShortcutRecommendationDiagnostics;
    shortcutScene?: ChatShortcutScene | null;
    searchProfile?: HomeShortcutSearchProfile | null;
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
    maxResults?: number;
    radiusSteps?: readonly number[];
    maxDistanceKm?: number;
    tripAddPlace?: boolean;
    nearbyGroups?: string[][];
    shortcutDiagnostics?: ShortcutRecommendationDiagnostics;
    shortcutScene?: ChatShortcutScene | null;
    searchProfile?: HomeShortcutSearchProfile | null;
  },
): Promise<PlaceResult[]> {
  const excluded = context?.excludedCategories ?? [];
  const plusCtx = await resolveChatPlusRankingContext(context, opts);
  const allowParks = userWantsParkRecommendations(opts?.userText ?? "", context);
  const isTripAddPlace = opts?.tripAddPlace ?? context?.tripPurpose === "trip_add_place";
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

  const allowLodging = intent === "camping" || isExplicitLodgingSearchIntent(opts?.userText ?? "");

  const targetCount = opts?.maxResults ?? RECOMMENDATION_COUNT;
  const homeLateNightProfile = opts?.searchProfile === "home_late_night";
  const homeSeaProfile = opts?.searchProfile === "home_sea";
  const homeSpecialProfile = homeLateNightProfile || homeSeaProfile;
  const shortcutScene = homeSpecialProfile
    ? null
    : (opts?.shortcutScene ?? resolveChatShortcutContext(opts?.userText ?? "")?.scene ?? null);
  const poolTarget = homeSpecialProfile
    ? Math.max(HOME_NEARBY_MIN_DISPLAY, targetCount)
    : shortcutScene
      ? SHORTCUT_CANDIDATE_POOL_TARGET
      : targetCount;

  const searchAttempts: SearchAttempt[] = homeSeaProfile
    ? HOME_SEA_SEARCH_ATTEMPTS
    : homeLateNightProfile
      ? homeLateNightSearchAttempts()
      : opts?.placeDetailNearby
        ? placeDetailNearbySearchAttempts(intent)
        : isTripAddPlace && opts?.nearbyGroups?.length
          ? [{ query: "", mode: "multi", nearbyGroups: opts.nearbyGroups }]
          : intent === "restaurant"
            ? restaurantSearchFallbackQueries(foodPreference, opts?.userText ?? "", opts?.cityLabel)
            : intent === "camping"
              ? campingSearchAttempts()
              : shortcutScene
                ? nearbySearchAttemptsForShortcutScene(shortcutScene)
                : isRefresh
                  ? buildAttractionRefreshSearchAttempts(opts?.cityLabel, destinationProfile)
                  : nearbySearchAttemptsForIntent(intent, foodPreference, context, opts?.userText, {
                      placeDetailNearby: opts?.placeDetailNearby,
                      shortcutScene,
                    });

  const homeLateNightContinuationText =
    matchesContinueRecommendationGrammar(opts?.userText ?? "") ||
    opts?.userText?.trim() === "不喜歡" ||
    opts?.userText?.trim() === "不喜欢";
  const homeLateNightContinuationRadiusSteps = homeLateNightContinuationText
    ? [homeNearbySearchRadiusMeters(), searchRadiusMeters("default")]
    : [homeNearbySearchRadiusMeters()];
  const radiusSteps =
    opts?.radiusSteps ??
    (homeSpecialProfile
      ? homeSeaProfile
        ? [HOME_SEA_LOCATION_BIAS_RADIUS_M]
        : homeLateNightContinuationRadiusSteps
      : opts?.placeDetailNearby
        ? CHAT_PLACE_DETAIL_NEARBY_RADIUS_STEPS_M
        : CHAT_NEARBY_RADIUS_STEPS_M);

  logAiPipeline("[CHAT_NEARBY_SEARCH]", {
    basePlace: opts?.searchContext?.destinationName ?? opts?.cityLabel ?? "",
    category: intent,
    lat,
    lng,
    placeDetailNearby: Boolean(opts?.placeDetailNearby),
    attemptCount: searchAttempts.length,
    shortcutScene: shortcutScene ?? "",
    rankingEngine: homeSeaProfile
      ? "home-sea-ranking"
      : homeLateNightProfile
        ? "home-late-night-ranking"
        : shortcutScene
          ? "nearby-shortcut-ranking"
          : "attractionTypeRankScore",
  });
  if (shortcutScene && !homeSpecialProfile) {
    logShortcutRuntime("[RT_SHORTCUT_RANK_ENGINE]", {
      scene: shortcutScene,
      intent,
      engine: "nearby-shortcut-ranking",
      poolTarget,
      attractionFilterSkipped: true,
    });
  }

  let best: PlaceResult[] = [];
  let lastError = "";
  let lastRawCount = 0;
  let lastRawPlaces: PlaceResult[] = [];
  const isShortcutContinuation = Boolean(
    (shortcutScene || homeSpecialProfile) &&
    (matchesContinueRecommendationGrammar(opts?.userText ?? "") ||
      opts?.userText?.trim() === "不喜歡" ||
      opts?.userText?.trim() === "不喜欢"),
  );
  let continuationAttemptCount = 0;
  let continuationProviderRaw = 0;
  let continuationMapped = 0;
  const continuationUniqueBefore = new Set<string>();
  const continuationUniqueAfterExclusion = new Set<string>();
  let shouldExpandHomeLateNight = false;

  for (let stepIndex = 0; stepIndex < radiusSteps.length; stepIndex++) {
    const radius = radiusSteps[stepIndex]!;
    const attemptsForStep =
      homeLateNightProfile && isShortcutContinuation && stepIndex > 0
        ? homeLateNightOpenExpansionAttempts()
        : searchAttempts;
    logChatNearbyRequest({ center: { lat, lng }, radius, category: intent });
    const maxDistanceKm = opts?.maxDistanceKm ?? maxDistanceKmForIntent(intent, stepIndex);
    const strictCafeGuard = stepIndex === 0 && !opts?.placeDetailNearby;

    const seen = new Set<string>();
    let places: PlaceResult[] = [];
    for (let attemptIndex = 0; attemptIndex < attemptsForStep.length; attemptIndex++) {
      const attempt = attemptsForStep[attemptIndex]!;
      continuationAttemptCount += 1;
      try {
        const {
          places: batch,
          error,
          rawCount: attemptRawCount,
          cacheStatus,
        } = await runPlaceSearch(
          searchPlaces,
          lat,
          lng,
          locale,
          attempt,
          isTripAddPlace
            ? "chat.fetchNearbyPlacesForIntent.trip_add_place"
            : "chat.fetchNearbyPlacesForIntent",
          {
            ...searchExtras,
            radius,
            intentCategory: intent,
          },
        );
        if (error) lastError = error;
        lastRawCount = Math.max(lastRawCount, batch.length);
        continuationProviderRaw += attemptRawCount;
        continuationMapped += batch.length;
        for (const place of batch) {
          continuationUniqueBefore.add(resolveCanonicalPlaceIdentity(place).identityKey);
        }
        if (isShortcutContinuation) {
          logShortcutRuntime("[RT_CONTINUATION_SEARCH_ATTEMPT]", {
            scene: shortcutScene ?? "",
            intent,
            attempt: `${stepIndex + 1}.${attemptIndex + 1}`,
            query: attempt.query || "(nearby)",
            types: attempt.includedTypes?.join(",") ?? "",
            radius,
            lat,
            lng,
            excludeCount: excludePlaceIds.length,
            providerRaw: attemptRawCount,
            mapped: batch.length,
            error: error ?? "",
            cacheHit: cacheStatus === "hit",
            cacheStatus,
          });
        }
        if (opts?.shortcutDiagnostics) {
          opts.shortcutDiagnostics.attemptCount += 1;
          opts.shortcutDiagnostics.requestsSent += 1;
          opts.shortcutDiagnostics.rawCount += attemptRawCount;
        }
        for (const place of batch) {
          const id = resolveCanonicalPlaceIdentity(place).identityKey;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          places.push(place);
        }
        if (!homeSpecialProfile && places.length >= poolTarget) break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastError = message;
        if (isShortcutContinuation) {
          logShortcutRuntime("[RT_CONTINUATION_SEARCH_ATTEMPT]", {
            scene: shortcutScene ?? "",
            intent,
            attempt: `${stepIndex + 1}.${attemptIndex + 1}`,
            query: attempt.query || "(nearby)",
            types: attempt.includedTypes?.join(",") ?? "",
            radius,
            lat,
            lng,
            excludeCount: excludePlaceIds.length,
            providerRaw: 0,
            mapped: 0,
            error: message,
            cacheHit: false,
            cacheStatus: "error",
          });
        }
        logChatPlacesError(error, `query=${attempt.query}`);
      }
    }
    lastRawPlaces = places;

    const afterPreviousExclusion = (
      isShortcutContinuation
        ? filterExactExcludedPlaceIdentities(
            filterPlacesByExclusion(places, excluded),
            excludePlaceIds,
          )
        : filterExcludedPlaceIds(filterPlacesByExclusion(places, excluded), excludePlaceIds)
    ) as PlaceResult[];
    for (const place of afterPreviousExclusion) {
      continuationUniqueAfterExclusion.add(resolveCanonicalPlaceIdentity(place).identityKey);
    }
    if (isShortcutContinuation) {
      logShortcutRuntime("[RT_CONTINUATION_STAGE]", {
        stage: "after_previous_exclusion",
        count: afterPreviousExclusion.length,
        previousIdCount: excludePlaceIds.length,
        currentCandidateIdsAddedToMemory: 0,
      });
      for (const place of places) {
        const identity = resolveCanonicalPlaceIdentity(place);
        if (
          afterPreviousExclusion.some(
            (item) => resolveCanonicalPlaceIdentity(item).identityKey === identity.identityKey,
          )
        )
          continue;
        logShortcutRuntime("[RT_CONTINUATION_DROP]", {
          stage: "after_previous_exclusion",
          placeName: place.name,
          placeId: place.id ?? "",
          identityKey: identity.identityKey,
          reason: "matched_previous_exact_identity",
          matchedPreviousIdentity: identity.identityKey,
        });
      }
    }

    const homeLateNightSelectionInput =
      homeLateNightProfile && isShortcutContinuation && stepIndex > 0
        ? afterPreviousExclusion.filter(
            (place) => place.openStatus === "open" || place.openStatus === "closing_soon",
          )
        : afterPreviousExclusion;
    const filtered = homeSeaProfile
      ? filterHomeSeaCandidates(afterPreviousExclusion)
      : homeLateNightProfile
        ? selectHomeNearbyPicks(homeLateNightSelectionInput, {
            origin: { lat, lng },
            maxDistanceM:
              homeLateNightProfile && isShortcutContinuation && stepIndex > 0 ? radius : undefined,
            minResults: HOME_NEARBY_MIN_DISPLAY,
            maxResults: targetCount,
            period: "late_night",
            timeZone: "Asia/Taipei",
          })
        : applyNearbyPlaceFilters(places, {
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
            tripAddPlace: isTripAddPlace,
            shortcutDiagnostics: opts?.shortcutDiagnostics,
            shortcutScene,
            structuredContinuation: isShortcutContinuation,
          });
    const ranked = homeSeaProfile
      ? rankHomeSeaCandidates(filtered, { lat, lng })
      : homeLateNightProfile
        ? filtered
        : shortcutScene
          ? rankPlaces(filtered, lat, lng, context, plusCtx, shortcutScene)
          : rankPlaces(filtered, lat, lng, context, plusCtx, null);
    if (homeLateNightProfile && isShortcutContinuation) {
      const closedNowRejectedCount = afterPreviousExclusion.filter(
        (place) =>
          place.openStatus === "closed_now" ||
          place.openStatus === "permanently_closed" ||
          place.openStatus === "temporarily_closed",
      ).length;
      shouldExpandHomeLateNight =
        stepIndex === 0 &&
        ranked.length === 0 &&
        afterPreviousExclusion.length > 0 &&
        closedNowRejectedCount === afterPreviousExclusion.length;
    }
    logAiPipeline("[CHAT_PLACES_FILTERED_COUNT]", {
      count: ranked.length,
      radius,
      stepIndex,
      rawCount: places.length,
    });

    if (ranked.length > best.length) {
      best = ranked;
    }
    if (
      homeLateNightProfile &&
      isShortcutContinuation &&
      stepIndex === 0 &&
      radiusSteps.length > 1
    ) {
      if (shouldExpandHomeLateNight) continue;
      break;
    }
    if (best.length >= poolTarget) break;
    if (opts?.placeDetailNearby && places.length === 0 && stepIndex >= 1) break;
  }

  if (context?.budgetPreference === "low" && !opts?.placeDetailNearby) {
    best = refinePlaceResultsForBudget(best, "low");
  }

  if (shortcutScene && !homeSpecialProfile) {
    logShortcutCandidateRuntime(shortcutScene, lastRawPlaces, best, { lat, lng });
    best = pickShortcutTopPlaces(best, shortcutScene, targetCount);
    if (shortcutScene === "relax_walk") {
      logShortcutRuntime("[RT_RELAX_CANDIDATES]", {
        rawCount: lastRawPlaces.length,
        afterBaseFilterCount: opts?.shortcutDiagnostics?.afterExclusionCount ?? best.length,
        afterSceneFilterCount: opts?.shortcutDiagnostics?.afterCategoryGuardCount ?? best.length,
        selectedCount: best.length,
      });
      for (const place of best) {
        const rank = buildShortcutRankBreakdown(place, shortcutScene, {
          origin: { lat, lng },
          distanceMetersFn: distanceMeters,
          passedCandidateFilter: true,
        });
        console.info(
          "[RT_RELAX_CANDIDATES]",
          JSON.stringify({
            placeName: place.name ?? "",
            placeId: place.id ?? "",
            primaryType: place.primaryType ?? "",
            types: place.types ?? [],
            rating: place.rating ?? null,
            userRatingCount: place.userRatingCount ?? null,
            shortcutScene,
            shortcutWeight: rank.shortcutWeight,
            finalScore: rank.finalScore,
          }),
        );
      }
    }
  } else if (homeSeaProfile || targetCount > RECOMMENDATION_COUNT) {
    best = best.slice(0, targetCount);
  }

  if (isShortcutContinuation) {
    if (opts?.shortcutDiagnostics) opts.shortcutDiagnostics.searchReturnedCount = best.length;
    logShortcutRuntime("[RT_CONTINUATION_STAGE]", {
      stage: "after_scene_filter",
      count: best.length,
      previousIdCount: excludePlaceIds.length,
      currentCandidateIdsAddedToMemory: 0,
    });
    logShortcutRuntime("[RT_CONTINUATION_SEARCH_SUMMARY]", {
      scene: shortcutScene ?? "",
      attemptCount: continuationAttemptCount,
      totalProviderRaw: continuationProviderRaw,
      totalMapped: continuationMapped,
      uniqueBeforeExclusion: continuationUniqueBefore.size,
      uniqueAfterExclusion: continuationUniqueAfterExclusion.size,
      failureReason: best.length
        ? ""
        : lastError
          ? `provider_error:${lastError}`
          : continuationProviderRaw === 0
            ? "provider_empty"
            : continuationUniqueAfterExclusion.size === 0
              ? "excluded_or_filtered"
              : "scene_or_quality_empty",
    });
    logShortcutRuntime("[RT_CONTINUATION_HANDOFF]", {
      scene: shortcutScene ?? "",
      searchReturnedCount: best.length,
      callerReceivedCount: best.length,
      rawStatsCount: opts?.shortcutDiagnostics?.rawCount ?? continuationProviderRaw,
      candidateArrayCount: best.length,
      fallbackReason: best.length ? "" : "search_returned_empty",
    });
  }

  logAiPipeline(
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
  shortcutScene?: ChatShortcutScene | null,
  searchProfile?: HomeShortcutSearchProfile | null,
): string {
  const picks = recommendations
    .map((item) => ({
      name: (item.placeName ?? item.name ?? "").trim(),
    }))
    .filter((p) => p.name);
  const list = picks.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  const count = picks.length;
  const exclusionAck = buildExclusionAcknowledgment(excludedCategories);

  if (searchProfile === "home_sea") {
    return "我找到幾個適合看海走走的地方：\n\n想再看看其他選擇，也可以跟我說。";
  }

  if (intent === "cafe") {
    if (shortcutScene === "quiet_cafe") {
      return `附近有 ${count} 間我覺得不錯的選擇：`;
    }
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
    const dest = ctx.destination?.trim();
    const lead =
      exclusionAck ??
      (dest ? `在${dest}，這幾間餐廳值得先看看：` : "依你現在的需求，附近這幾間餐廳值得先看看：");
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
  /** 行程加點等需保留較多候選時使用（預設 5） */
  maxResults?: number;
  shortcutScene?: ChatShortcutScene | null;
  searchProfile?: HomeShortcutSearchProfile | null;
  fetchPlaceDetails?: (
    placeId: string,
  ) => Promise<(PlaceResult & { photoNames?: string[] | null }) | null>;
}): Promise<{
  summary: string;
  payload: RoamiePayloadV2;
  recommendations: RoamieRecommendationItem[];
  shortcutDiagnostics?: ShortcutRecommendationDiagnostics;
}> {
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
    const pickCount = params.maxResults ?? RECOMMENDATION_COUNT;
    const shortcut = params.searchProfile
      ? null
      : (resolveChatShortcutContext(userText) ??
        (params.shortcutScene
          ? buildStructuredShortcutContext(
              params.shortcutScene === "quiet_cafe"
                ? "coffee"
                : params.shortcutScene === "rainy_indoor"
                  ? "rainy"
                  : "relax",
              userText,
            )
          : null));
    const shortcutAttempt = shortcut
      ? nearbySearchAttemptForIntent(intent, foodPreference, context, userText, {
          shortcutScene: shortcut.scene,
        })
      : null;
    const shortcutDiagnostics: ShortcutRecommendationDiagnostics | undefined = shortcut
      ? {
          shortcut,
          searchScope: searchContext?.searchMode ?? "nearby",
          includedTypes: shortcutAttempt?.includedTypes ?? [],
          excludedTypes: excludedTypesForShortcutScene(shortcut.scene),
          attemptCount: 0,
          requestsSent: 0,
          rawCount: 0,
          afterDestinationOrNearbyScopeCount: 0,
          afterExclusionCount: 0,
          afterCanonicalIdCount: 0,
          afterCategoryGuardCount: 0,
          afterQualityCount: 0,
          afterAlreadyRecommendedCount: 0,
          renderableCount: 0,
          finalCardCount: 0,
        }
      : undefined;
    const excluded = excludedCategories ?? context.excludedCategories ?? [];
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
        maxResults: params.maxResults,
        shortcutDiagnostics,
        shortcutScene: params.shortcutScene,
        searchProfile: params.searchProfile,
      },
    );
    const isShortcutContinuation = Boolean(
      shortcut &&
      (matchesContinueRecommendationGrammar(userText) ||
        userText.trim() === "不喜歡" ||
        userText.trim() === "不喜欢"),
    );
    if (isShortcutContinuation) {
      logShortcutRuntime("[RT_CONTINUATION_HANDOFF]", {
        scene: shortcut.scene,
        searchReturnedCount: shortcutDiagnostics?.searchReturnedCount ?? places.length,
        callerReceivedCount: places.length,
        rawStatsCount: shortcutDiagnostics?.rawCount ?? 0,
        candidateArrayCount: places.length,
        fallbackReason: places.length ? "" : "caller_received_empty",
      });
      logShortcutRuntime("[RT_CONTINUATION_STAGE]", {
        stage: "after_search",
        count: places.length,
        previousIdCount: excludePlaceIds.length,
        currentCandidateIdsAddedToMemory: 0,
      });
      const uniquePrevious = new Map<string, PlaceLike>();
      for (const previous of priorRecommended) {
        const identity = resolveCanonicalPlaceIdentity(previous);
        if (!uniquePrevious.has(identity.identityKey)) {
          uniquePrevious.set(identity.identityKey, previous);
        }
      }
      const previousItems = [...uniquePrevious.values()];
      previousItems.forEach((previous, index) => {
        const identity = resolveCanonicalPlaceIdentity(previous);
        logShortcutRuntime("[RT_CONTINUATION_EXCLUSIONS]", {
          index,
          name: previous.placeName ?? previous.name,
          placeId: previous.placeId ?? previous.id ?? "",
          googlePlaceId: previous.googlePlaceId ?? "",
          canonicalPlaceId: identity.canonicalPlaceId ?? "",
          identityKey: identity.identityKey,
        });
      });
      places.forEach((candidate, index) => {
        const identity = resolveCanonicalPlaceIdentity(candidate);
        const matched = previousItems
          .map((previous) => exactCanonicalIdentityMatch(candidate, previous))
          .find(Boolean);
        logShortcutRuntime("[RT_CONTINUATION_CANDIDATE_IDENTITY]", {
          index,
          name: candidate.name,
          placeId: candidate.id,
          googlePlaceId: identity.googlePlaceId ?? "",
          canonicalPlaceId: identity.canonicalPlaceId ?? "",
          identityKey: identity.identityKey,
          excludedAsPrevious: Boolean(matched),
          matchedPreviousIdentity: matched ?? "",
        });
      });
      const beforeExactSafety = places;
      places = filterExactPreviouslyRecommendedPlaces(places, previousItems);
      logShortcutRuntime("[RT_CONTINUATION_STAGE]", {
        stage: "after_previous_exclusion",
        count: places.length,
        previousIdCount: previousItems.length,
        currentCandidateIdsAddedToMemory: 0,
      });
      for (const candidate of beforeExactSafety) {
        if (places.includes(candidate)) continue;
        const identity = resolveCanonicalPlaceIdentity(candidate);
        const matched = previousItems
          .map((previous) => exactCanonicalIdentityMatch(candidate, previous))
          .find(Boolean);
        logShortcutRuntime("[RT_CONTINUATION_DROP]", {
          stage: "after_previous_exclusion_safety",
          placeName: candidate.name,
          placeId: candidate.id ?? "",
          identityKey: identity.identityKey,
          reason: "matched_previous_exact_identity",
          matchedPreviousIdentity: matched ?? "",
        });
      }
    } else {
      places = filterAlreadyRecommendedPlaces(places, {
        recommended: priorRecommended,
        rejectedNames: rejectedPlaceNames,
        blockedCoreNames: coreBlock,
      });
    }
    if (shortcutDiagnostics) {
      shortcutDiagnostics.afterAlreadyRecommendedCount = places.length;
    }

    let foodDistricts: PlaceResult[] = [];
    const mealIntent = resolveExplicitMealIntent(userText);
    if (intent === "restaurant" || isFoodIntentText(userText)) {
      const split = filterPlacesForFoodIntent(places, userText);
      places = split.restaurants;
      foodDistricts = split.districts;
      if (mealIntent) {
        places = filterPlacesForMealIntent(places, mealIntent);
      }
    }

    const restaurantPicks = places.slice(0, pickCount);
    const districtPick =
      foodDistricts.length > 0 && restaurantPicks.length < pickCount
        ? foodDistricts.slice(0, 1)
        : [];
    let picks = [...restaurantPicks, ...districtPick];

    if (shortcut || params.searchProfile) {
      const enrichedPicks: PlaceResult[] = [];
      for (const place of picks) {
        const identity = resolveCanonicalPlaceIdentity(place);
        const providerPlaceId = (place.id ?? "").trim().replace(/^places\//i, "");
        if (!providerPlaceId) {
          logShortcutRuntime("[RT_PLACE_ENRICHMENT]", {
            name: place.name,
            placeId: place.id ?? "",
            googlePlaceId: "",
            canonicalPlaceId: identity.canonicalPlaceId ?? "",
            source: identity.source,
            detailsRequested: false,
            detailsSuccess: false,
            ratingPresent: Boolean(place.rating != null),
            openingHoursPresent: Boolean(place.todayHoursLabel || place.openStatusLabel),
            photoRefsCount: place.photoName ? 1 : 0,
            photoResolved: Boolean(place.photoName),
            fallbackImageUsed: true,
            failureReason: "missing_google_place_id_identity_contract",
          });
          continue;
        }

        const detailsPlaceId = identity.googlePlaceId ?? providerPlaceId;
        const needsDetails = Boolean(
          params.fetchPlaceDetails &&
          (place.rating == null ||
            !place.photoName ||
            (!place.todayHoursLabel && !place.openStatusLabel)),
        );
        let enriched = place;
        let detailsSuccess = false;
        let failureReason = "";
        let photoRefsCount = place.photoName ? 1 : 0;
        if (needsDetails && params.fetchPlaceDetails) {
          try {
            const details = await params.fetchPlaceDetails(detailsPlaceId);
            if (details) {
              detailsSuccess = true;
              photoRefsCount = details.photoNames?.length ?? (details.photoName ? 1 : 0);
              enriched = {
                ...place,
                ...details,
                id: detailsPlaceId,
                name: details.name?.trim() || place.name,
                address: details.address?.trim() || place.address,
                lat: details.lat ?? place.lat,
                lng: details.lng ?? place.lng,
                rating: details.rating ?? place.rating,
                userRatingCount: details.userRatingCount ?? place.userRatingCount,
                photoName: details.photoName ?? details.photoNames?.[0] ?? place.photoName,
                types: details.types?.length ? details.types : place.types,
                primaryType: details.primaryType ?? place.primaryType,
                todayHoursLabel: details.todayHoursLabel || place.todayHoursLabel,
                openStatusLabel: details.openStatusLabel || place.openStatusLabel,
              };
            } else {
              failureReason = "details_empty";
            }
          } catch (error) {
            failureReason = error instanceof Error ? error.message : String(error);
          }
        }
        logShortcutRuntime("[RT_PLACE_ENRICHMENT]", {
          name: enriched.name,
          placeId: enriched.id,
          googlePlaceId: detailsPlaceId,
          canonicalPlaceId: identity.canonicalPlaceId ?? "",
          source: identity.source,
          detailsRequested: needsDetails,
          detailsSuccess,
          ratingPresent: Boolean(enriched.rating != null),
          openingHoursPresent: Boolean(enriched.todayHoursLabel || enriched.openStatusLabel),
          photoRefsCount,
          photoResolved: Boolean(enriched.photoName),
          fallbackImageUsed: !enriched.photoName,
          failureReason,
        });
        enrichedPicks.push(enriched);
      }
      picks = enrichedPicks;
    }

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
        return {
          summary,
          payload: {
            version: 2,
            title: "Roamie 推薦",
            summary,
            moodTag: resolvePresentableMoodTag(undefined, context),
            recommendations: [],
            itinerary: [],
            generatedAt: new Date().toISOString(),
          },
          recommendations: [],
          shortcutDiagnostics,
        };
      }
      if (shortcutDiagnostics) logShortcutRecommendationSummary(shortcutDiagnostics);
      throw new Error("places_empty");
    }

    const recommendations: RoamieRecommendationItem[] = mapPlaceResultsToChatItems(
      picks.map((p) => {
        const distM =
          p.lat != null && p.lng != null
            ? distanceMeters({ lat, lng }, { lat: p.lat, lng: p.lng })
            : undefined;
        const isDistrict = districtPick.some((d) => d.id === p.id);
        return {
          place: p,
          ctx: {
            mood: context.mood,
            preferenceEvidenceSource: context.moodEvidenceSource,
            locale,
            distanceMeters: distM,
            categoryLabel: isDistrict ? FOOD_DISTRICT_CARD_TYPE : undefined,
          },
        };
      }),
    ).map((item) => {
      const isDistrict = districtPick.some(
        (d) => d.id === item.googlePlaceId || d.id === item.placeId,
      );
      const source = picks.find((p) => p.id === item.googlePlaceId || p.id === item.placeId);
      if (params.searchProfile === "home_sea" && source) {
        const desc = buildHomeSeaRecommendationDescription(source);
        return { ...item, reason: desc, description: desc };
      }
      if (mealIntent && !isDistrict && source) {
        const desc = buildMealRecommendationDescription(source, mealIntent);
        return { ...item, reason: desc, description: desc };
      }
      return isDistrict
        ? {
            ...item,
            type: FOOD_DISTRICT_CARD_TYPE,
            description: item.description?.trim()
              ? `${FOOD_DISTRICT_CARD_TYPE} · ${item.description}`
              : FOOD_DISTRICT_CARD_TYPE,
          }
        : item;
    });
    if (shortcutDiagnostics) shortcutDiagnostics.renderableCount = recommendations.length;

    const summary = mealIntent
      ? sanitizeMealSummaryText(
          buildSummary(intent, picks, context, excluded, shortcut?.scene, params.searchProfile),
          mealIntent.slot,
        )
      : buildSummary(intent, picks, context, excluded, shortcut?.scene, params.searchProfile);
    const mode = chatResponseModeForIntent(intent);
    logAiPipeline(`[CHAT_RESPONSE] mode=${mode}`);

    const payload: RoamiePayloadV2 = {
      version: 2,
      title: "Roamie 推薦",
      summary,
      moodTag: resolvePresentableMoodTag(undefined, context),
      recommendations,
      itinerary: [],
      generatedAt: new Date().toISOString(),
    };

    return { summary, payload, recommendations, shortcutDiagnostics };
  } finally {
    endPlacesFlow(flow);
  }
}
