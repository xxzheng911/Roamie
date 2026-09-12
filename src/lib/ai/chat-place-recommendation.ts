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
import {
  canonicalizeExplicitNearbyKeyword,
  extractExplicitNearbyKeyword,
  nearbySemanticFamilyForKeyword,
  type NearbySemanticFamily,
} from "@/lib/ai/nearby-location-clarification";
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
import { isPlaceOperationalForRecommendation } from "@/lib/place-operational-eligibility";
import type { PlaceResult } from "@/lib/place-result";
import {
  enrichNearbyDistrictCandidates,
  filterPlacesByNearbyGeographicScope,
  placeDistrict,
} from "@/lib/ai/nearby-geographic-scope";
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
  preserveMealRecommendationReason,
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
import { HOME_NEARBY_MIN_DISPLAY, selectHomeNearbyPicks } from "@/lib/home-nearby-places-filter";
import {
  matchesStageTwoLateNightPlace,
  matchesStrongLateNightPlace,
} from "@/lib/home-nearby-eligibility";
import {
  isRecommendablePlace,
  placeResultToRecommendableInput,
} from "@/lib/is-recommendable-place";
import {
  HOME_NEARBY_MAX_DISTANCE_M,
  homeNearbySearchRadiusMeters,
  searchRadiusMeters,
} from "@/lib/search-radius";
import type { HomeShortcutSearchProfile } from "@/lib/ai/home-shortcut-handoff";
import {
  filterHomeSeaCandidates,
  HOME_SEA_LOCATION_BIAS_RADIUS_M,
  HOME_SEA_SEARCH_ATTEMPTS,
  rankHomeSeaCandidates,
} from "@/lib/home-sea-ranking";
import { CHAT_PLACES_SEARCH_TIMEOUT_MS, withSearchTimeout } from "@/lib/search-timeout";

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
  placesLane?: string;
  placesRound?: number;
  placesScopeSource?: "clarified_location" | "current_device_location" | "explicit_location";
  placesRecommendationRequestId?: string;
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
  placesLane?: string;
  placesRound?: number;
  placesScopeSource?: "clarified_location" | "current_device_location" | "explicit_location";
  placesRecommendationRequestId?: string;
};

const RECOMMENDATION_COUNT = 5;

/** Budgeted in actual Google calls: the Stage 1 multi lane costs two calls. */
export const LATE_NIGHT_STAGE_ONE_PROVIDER_BUDGET = 4;
export const LATE_NIGHT_STAGE_TWO_PROVIDER_BUDGET = 2;
export const LATE_NIGHT_TOTAL_PROVIDER_BUDGET = 6;
export const LATE_NIGHT_ORCHESTRATION_TIMEOUT_MS = 20_000;

export function estimatedPlacesProviderCalls(attempt: SearchAttempt): number {
  return attempt.mode === "multi" ? Math.max(1, attempt.nearbyGroups?.length ?? 0) : 1;
}

export function boundedLateNightStageTwoAttempts(
  deficit: number,
): ReturnType<typeof homeLateNightOpenExpansionAttempts> {
  if (deficit <= 0) return [];
  return homeLateNightOpenExpansionAttempts().slice(
    0,
    Math.min(LATE_NIGHT_STAGE_TWO_PROVIDER_BUDGET, deficit),
  );
}

type NearbyRejectAudit = Record<string, number>;

export function buildLateNightCandidateFunnel(
  places: PlaceResult[],
  options?: { origin?: { lat: number; lng: number }; maxDistanceM?: number },
) {
  const validIdentity = places.filter(
    (place) =>
      Boolean(place.id?.trim()) && Number.isFinite(place.lat) && Number.isFinite(place.lng),
  );
  const operational = validIdentity.filter(isPlaceOperationalForRecommendation);
  const strongSemantic = operational.filter(matchesStrongLateNightPlace);
  const unknownHours = operational.filter(
    (place) => place.openNow == null && place.openStatus === "unknown",
  );
  const open = operational.filter(
    (place) =>
      place.openNow === true || place.openStatus === "open" || place.openStatus === "closing_soon",
  );
  const semanticEligible = operational.filter(
    (place) => matchesStrongLateNightPlace(place) || matchesStageTwoLateNightPlace(place),
  );
  const qualityRejected = semanticEligible.filter(
    (place) =>
      !isRecommendablePlace(placeResultToRecommendableInput(place), "chat_nearby", {
        logDrop: false,
      }).ok,
  );
  const distanceRejected = semanticEligible.filter((place) => {
    if (!options?.origin || place.lat == null || place.lng == null) return false;
    return (
      distanceMeters(options.origin, { lat: place.lat, lng: place.lng }) >
      (options.maxDistanceM ?? HOME_NEARBY_MAX_DISTANCE_M)
    );
  });
  const identityKeys = new Set<string>();
  let duplicate = 0;
  for (const place of operational) {
    const key = resolveCanonicalPlaceIdentity(place).identityKey;
    if (identityKeys.has(key)) duplicate += 1;
    else identityKeys.add(key);
  }
  return {
    rawCount: places.length,
    validIdentityCount: validIdentity.length,
    operationalCount: operational.length,
    strongSemanticCount: strongSemantic.length,
    unknownHoursCount: unknownHours.length,
    openCount: open.length,
    qualityRejectedCount: qualityRejected.length,
    eligibleCount: semanticEligible.length - qualityRejected.length - distanceRejected.length,
    distanceRejectedCount: distanceRejected.length,
    dropReasons: {
      closed: validIdentity.length - operational.length,
      address_like_marker: qualityRejected.filter(
        (place) =>
          isRecommendablePlace(placeResultToRecommendableInput(place), "chat_nearby", {
            logDrop: false,
          }).reason === "address_like_marker",
      ).length,
      excluded_category: 0,
      weak_night_semantics: operational.length - semanticEligible.length,
      duplicate,
      invalid_identity: places.length - validIdentity.length,
    },
  };
}

export { canonicalizeExplicitNearbyKeyword, extractExplicitNearbyKeyword };

export function matchesExplicitNearbyKeyword(place: PlaceResult, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  const haystack =
    `${place.name ?? ""} ${place.primaryType ?? ""} ${(place.types ?? []).join(" ")}`.toLowerCase();
  const semanticTypes: Array<[RegExp, RegExp]> = [
    [/早午餐|brunch/i, /早午餐|brunch|breakfast_and_brunch/],
    [/素食|蔬食|純素|纯素|vegan|vegetarian/i, /素食|蔬食|純素|纯素|vegan|vegetarian/],
    [/咖啡|coffee|cafe/i, /咖啡|coffee|cafe/],
    [/夜市|小吃|攤販|street food/i, /夜市|小吃|攤|market|food_stall|street_food|snack/],
    [
      /酒吧|居酒屋|餐酒館|pub|bar|gastropub/i,
      /酒吧|居酒|餐酒|pub|bar|izakaya|gastropub|night_club|cocktail|wine_bar/,
    ],
    [/甜點|蛋糕|烘焙|dessert|bakery/i, /甜點|蛋糕|烘焙|dessert|bakery/],
  ];
  const authority = semanticTypes.find(([pattern]) => pattern.test(needle));
  if (authority && authority[1].test(haystack)) return true;
  const tokens = needle.split(/[\s、，,／/]+/).filter((token) => token.length >= 2);
  return tokens.length > 0 && tokens.some((token) => haystack.includes(token));
}

export function matchesExplicitNearbyKeywordWithProviderEvidence(
  place: PlaceResult,
  keyword: string,
  providerLanes: ReadonlySet<string> | undefined,
): boolean {
  if (matchesExplicitNearbyKeyword(place, keyword)) return true;
  if (!/早午餐|brunch/i.test(keyword)) return false;
  const hasStrongBrunchQueryEvidence =
    providerLanes?.has("brunch_primary") || providerLanes?.has("brunch_bilingual");
  return hasStrongBrunchQueryEvidence && matchesNearbySemanticFamily(place, "food");
}

function explicitNearbyKeywordForDiagnostics(userText: string, places: PlaceResult[]): number {
  const keyword = extractExplicitNearbyKeyword(userText);
  if (!keyword) return places.length;
  const family = nearbySemanticFamilyForKeyword(keyword);
  return places.filter(
    (place) =>
      matchesExplicitNearbyKeyword(place, keyword) && matchesNearbySemanticFamily(place, family),
  ).length;
}

export function matchesNearbySemanticFamily(
  place: PlaceResult,
  family: NearbySemanticFamily,
): boolean {
  const evidence = `${place.name ?? ""} ${place.primaryType ?? ""} ${(place.types ?? []).join(" ")}`;
  if (family === "nightlife") {
    return /酒吧|居酒|餐酒|pub|\bbar\b|cocktail|wine_bar|night_club|izakaya|gastropub/i.test(
      evidence,
    );
  }
  if (family === "cafe") return /咖啡|coffee|cafe/i.test(evidence);
  if (family === "food")
    return /餐|食|restaurant|food|meal|breakfast|vegan|vegetarian/i.test(evidence);
  return true;
}

export function resolveExplicitNearbyKeywordForTurn(
  text: string,
  previousKeyword?: string,
): string | null {
  return (
    extractExplicitNearbyKeyword(text) ??
    (matchesContinueRecommendationGrammar(text) ? previousKeyword?.trim() || null : null)
  );
}

export function buildExplicitNearbySearchAttempt(text: string): SearchAttempt | null {
  const keyword = extractExplicitNearbyKeyword(text);
  return keyword ? { query: keyword, mode: "text" } : null;
}

export type PlaceFocusNearbyDiagnostics = {
  rawCount: number;
  operationalCount: number;
  geographicCount: number;
  preDedupeCount: number;
  dedupedCount: number;
  finalCount: number;
};

function recordNearbyDrop(
  audit: NearbyRejectAudit | undefined,
  reason: string,
  before: number,
  after: number,
): void {
  const dropped = Math.max(0, before - after);
  if (audit && dropped > 0) audit[reason] = (audit[reason] ?? 0) + dropped;
}

function nearbySearchAttemptForIntent(
  intent: NearbyPlaceIntent,
  foodPreference?: string,
  context?: CanonicalTravelContext,
  userText?: string,
  opts?: { placeDetailNearby?: boolean; shortcutScene?: ChatShortcutScene | null },
): SearchAttempt {
  const explicitAttempt = buildExplicitNearbySearchAttempt(userText ?? "");
  if (explicitAttempt) return explicitAttempt;
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
    surface: "chatNearby",
    profile,
    sessionPreference: context?.sessionPreference,
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
    return [lead, "", "附近有幾間我覺得不錯的選擇：", "", list].join("\n");
  }

  if (intent === "restaurant") {
    const dest = ctx.destination?.trim();
    const lead =
      exclusionAck ??
      (dest ? `在${dest}，這幾間餐廳值得先看看：` : "依你現在的需求，附近這幾間餐廳值得先看看：");
    return [lead, "", list].join("\n");
  }

  if (intent === "camping") {
    return buildCampingRecommendationSummary(picks, ctx);
  }

  const mood = shouldDisplayMoodPresentation(undefined, ctx) ? ctx.mood : undefined;
  if (!mood) {
    return ["附近這幾個地方可以先看看：", "", list].join("\n");
  }
  if (/(下雨|雨天)/.test(mood) || ctx.setting === "室內") {
    return ["下雨天也想出門走走對吧？", "", `${weather}附近這幾個地方比較適合待在室內：`, "", list]
      .filter(Boolean)
      .join("\n");
  }

  if (/(累|疲|放鬆|放空)/.test(mood)) {
    return ["今天想放空一下對吧？", "", `${weather}附近有幾個適合慢慢走的地方：`, "", list]
      .filter(Boolean)
      .join("\n");
  }

  return [`依「${mood}」的心情，附近這幾個地方可以先看看：`, "", list].join("\n");
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

export type NearbySearchExecution = {
  lane: string;
  query: string;
  radius: number;
};

export function explicitNearbyCapacitySearchAttempts(
  keyword: string,
  continuationRound = 0,
): SearchAttempt[] | null {
  if (!/早午餐|brunch/i.test(keyword)) return null;
  const initial: SearchAttempt[] = [
    { id: "brunch_primary", query: keyword, mode: "text", includedTypes: ["restaurant", "cafe"] },
    {
      id: "brunch_bilingual",
      query: "brunch",
      mode: "text",
      includedTypes: ["restaurant", "cafe"],
    },
    {
      id: "brunch_breakfast",
      query: "早餐 早午餐",
      mode: "text",
      includedTypes: ["restaurant", "cafe", "bakery"],
    },
  ];
  const continuation: SearchAttempt[] = [
    {
      id: "brunch_cafe",
      query: "cafe brunch",
      mode: "text",
      includedTypes: ["cafe", "restaurant"],
    },
    {
      id: "brunch_weekend",
      query: "週末早午餐",
      mode: "text",
      includedTypes: ["restaurant", "cafe"],
    },
    {
      id: "brunch_breakfast_cafe",
      query: "早餐 咖啡 早午餐",
      mode: "text",
      includedTypes: ["cafe", "bakery", "restaurant"],
    },
  ];
  return continuationRound > 0 ? continuation : initial;
}

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
  extras?: PlaceSearchExtras & { radius?: number; timeoutMs?: number },
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
    placesLane: extras?.placesLane ?? attempt.id ?? `${attempt.mode}_search`,
    placesRound: extras?.placesRound ?? 0,
    placesScopeSource: extras?.placesScopeSource,
    placesRecommendationRequestId: extras?.placesRecommendationRequestId,
  };
  const cacheKey = buildPlacesSearchKey(requestData);
  const searchPromise = searchPlaces({ data: requestData });
  const result =
    extras?.timeoutMs == null
      ? await searchPromise
      : await withSearchTimeout(searchPromise, extras.timeoutMs, "places_search_attempt_timeout");
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
    rejectAudit?: NearbyRejectAudit;
  },
): PlaceResult[] {
  if (params.placeDetailNearby) {
    let working = filterPlacesByExclusion(ranked, params.excluded);
    working = filterExcludedPlaceIds(working, params.excludePlaceIds);
    working = working.filter(isPlaceOperationalForRecommendation);
    working = filterPlacesByNearbyDistance(working, params.lat, params.lng, params.maxDistanceKm);
    return working;
  }

  let working = ranked;
  const missingIdentity = working.filter((place) => !(place.id ?? "").trim()).length;
  const missingCoordinates = working.filter(
    (place) => place.lat == null || place.lng == null,
  ).length;
  if (params.rejectAudit && missingIdentity) {
    params.rejectAudit.missing_google_place_id = missingIdentity;
  }
  if (params.rejectAudit && missingCoordinates) {
    params.rejectAudit.missing_coordinates = missingCoordinates;
  }
  if (params.tripAddPlace) {
    const before = working.length;
    working = working.filter((place) => !isTripAddPlaceHardReject(place));
    recordNearbyDrop(params.rejectAudit, "hard_exclusion", before, working.length);
  }
  let before = working.length;
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
  recordNearbyDrop(params.rejectAudit, "invalid_place_name", before, working.length);
  if (params.searchContext?.searchMode === "destination" && params.searchContext.destinationName) {
    before = working.length;
    working = filterPlacesByDestinationGuard(
      working,
      params.searchContext.destinationName,
      params.userText,
    );
    recordNearbyDrop(params.rejectAudit, "scope", before, working.length);
  }
  if (params.shortcutDiagnostics) {
    params.shortcutDiagnostics.afterDestinationOrNearbyScopeCount = working.length;
  }
  before = working.length;
  working = filterPlacesByExclusion(working, params.excluded);
  recordNearbyDrop(params.rejectAudit, "exclusion", before, working.length);
  before = working.length;
  working = params.structuredContinuation
    ? filterExactExcludedPlaceIdentities(working, params.excludePlaceIds)
    : filterExcludedPlaceIds(working, params.excludePlaceIds);
  recordNearbyDrop(params.rejectAudit, "previous_or_duplicate", before, working.length);
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
    before = working.length;
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
    recordNearbyDrop(params.rejectAudit, "category_mapping", before, working.length);
  }
  before = working.length;
  working = filterPlacesForShortcutScene(working, shortcutScene);
  recordNearbyDrop(params.rejectAudit, "shortcut_scene", before, working.length);
  if (params.shortcutDiagnostics) {
    params.shortcutDiagnostics.afterCategoryGuardCount = working.length;
  }
  if (params.intent === "camping") {
    working = filterCampingPlaces(working);
  }
  before = working.length;
  working = filterNonLodgingPlaces(working, { allowLodging: params.allowLodging });
  recordNearbyDrop(params.rejectAudit, "lodging", before, working.length);
  if (params.intent === "cafe" && params.strictCafeGuard && shortcutScene !== "quiet_cafe") {
    before = working.length;
    working = filterPlacesByCafeGuard(working);
    recordNearbyDrop(params.rejectAudit, "category_mapping", before, working.length);
  }
  if (params.intent === "restaurant" || isFoodIntentText(params.userText ?? "")) {
    before = working.length;
    const { restaurants, districts } = filterPlacesForFoodIntent(working, params.userText ?? "");
    working = [...restaurants, ...districts];
    recordNearbyDrop(params.rejectAudit, "category_mapping", before, working.length);
  }
  before = working.length;
  working = filterPlacesByNearbyDistance(working, params.lat, params.lng, params.maxDistanceKm);
  recordNearbyDrop(params.rejectAudit, "scope_or_radius", before, working.length);
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
    searchCenterAuthority?: {
      lat: number;
      lng: number;
      displayLabel: string;
      source: "clarification_geocode";
      originalQuery: string;
      selectedAuthority: "nearby";
    };
    geographicScope?: import("@/lib/ai/nearby-geographic-scope").NearbyGeographicScopeAuthority;
    placeFocusDiagnostics?: PlaceFocusNearbyDiagnostics;
    fetchPlaceDetails?: (placeId: string) => Promise<PlaceResult | null>;
    continuationRound?: number;
    onSearchExecution?: (execution: NearbySearchExecution) => void;
    diagnosticRequestId?: string;
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
    searchCenterAuthority?: {
      lat: number;
      lng: number;
      displayLabel: string;
      source: "clarification_geocode";
      originalQuery: string;
      selectedAuthority: "nearby";
    };
    geographicScope?: import("@/lib/ai/nearby-geographic-scope").NearbyGeographicScopeAuthority;
    placeFocusDiagnostics?: PlaceFocusNearbyDiagnostics;
    diagnosticRequestId?: string;
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
  const shortcutScene = opts?.placeDetailNearby
    ? null
    : homeSpecialProfile
      ? null
      : (opts?.shortcutScene ?? resolveChatShortcutContext(opts?.userText ?? "")?.scene ?? null);
  const poolTarget = homeSpecialProfile
    ? Math.max(HOME_NEARBY_MIN_DISPLAY, targetCount)
    : shortcutScene
      ? SHORTCUT_CANDIDATE_POOL_TARGET
      : targetCount;

  const explicitCapacityAttempts = explicitNearbyCapacitySearchAttempts(
    extractExplicitNearbyKeyword(opts?.userText ?? "") ?? "",
    opts?.continuationRound ?? 0,
  );
  const searchAttempts: SearchAttempt[] = homeSeaProfile
    ? HOME_SEA_SEARCH_ATTEMPTS
    : homeLateNightProfile
      ? homeLateNightSearchAttempts()
      : opts?.placeDetailNearby
        ? placeDetailNearbySearchAttempts(intent)
        : isTripAddPlace && opts?.nearbyGroups?.length
          ? [{ query: "", mode: "multi", nearbyGroups: opts.nearbyGroups }]
          : explicitCapacityAttempts
            ? explicitCapacityAttempts
            : intent === "restaurant"
              ? restaurantSearchFallbackQueries(
                  foodPreference,
                  opts?.userText ?? "",
                  opts?.cityLabel,
                )
              : intent === "camping"
                ? campingSearchAttempts()
                : shortcutScene
                  ? nearbySearchAttemptsForShortcutScene(shortcutScene)
                  : isRefresh
                    ? buildAttractionRefreshSearchAttempts(opts?.cityLabel, destinationProfile)
                    : nearbySearchAttemptsForIntent(
                        intent,
                        foodPreference,
                        context,
                        opts?.userText,
                        {
                          placeDetailNearby: opts?.placeDetailNearby,
                          shortcutScene,
                        },
                      );

  const homeLateNightContinuationRadiusSteps = [
    homeNearbySearchRadiusMeters(),
    searchRadiusMeters("default"),
  ];
  const radiusSteps =
    opts?.radiusSteps ??
    (homeSpecialProfile
      ? homeSeaProfile
        ? [HOME_SEA_LOCATION_BIAS_RADIUS_M]
        : homeLateNightContinuationRadiusSteps
      : opts?.placeDetailNearby
        ? CHAT_PLACE_DETAIL_NEARBY_RADIUS_STEPS_M
        : CHAT_NEARBY_RADIUS_STEPS_M);

  if (opts?.searchCenterAuthority) {
    const expected = opts.searchCenterAuthority;
    logAiPipeline("[NEARBY_SEARCH_CENTER_AUTHORITY]", {
      position: "fetch_nearby_places_for_intent",
      source: expected.source,
      lat,
      lng,
      displayLabel: expected.displayLabel,
      selectedAuthority: expected.selectedAuthority,
      pendingResume: true,
      originalQuery: expected.originalQuery,
    });
    if (Math.abs(lat - expected.lat) > 0.000001 || Math.abs(lng - expected.lng) > 0.000001) {
      logAiPipeline("[NEARBY_SEARCH_CENTER_MISMATCH]", {
        expectedLat: expected.lat,
        expectedLng: expected.lng,
        actualLat: lat,
        actualLng: lng,
        expectedSource: expected.source,
        actualSource: "fetch_nearby_places_for_intent",
      });
      return [];
    }
  }

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
  const providerLanesByIdentity = new Map<string, Set<string>>();
  let shouldExpandHomeLateNight = false;
  const accumulatedLateNightCandidates: PlaceResult[] = [];
  const accumulatedLateNightIds = new Set<string>();
  const nearbyRejectAudit: NearbyRejectAudit = {};
  const lateNightStartedAt = Date.now();
  let lateNightEstimatedProviderCalls = 0;
  const attemptedSearchKeys = new Set<string>();
  let lateNightFinalizeReason = "search_exhausted";

  for (let stepIndex = 0; stepIndex < radiusSteps.length; stepIndex++) {
    const radius = radiusSteps[stepIndex]!;
    const attemptsForStep =
      homeLateNightProfile && stepIndex > 0
        ? boundedLateNightStageTwoAttempts(Math.max(0, poolTarget - best.length))
        : searchAttempts;
    const stageProviderBudget =
      stepIndex === 0 ? LATE_NIGHT_STAGE_ONE_PROVIDER_BUDGET : LATE_NIGHT_STAGE_TWO_PROVIDER_BUDGET;
    let stageEstimatedProviderCalls = 0;
    let stageProviderRawCount = 0;
    let stageMappedCount = 0;
    if (homeLateNightProfile) {
      logAiPipeline("[LATE_NIGHT_SEARCH_BUDGET]", {
        stage: stepIndex === 0 ? 1 : 2,
        laneCount: attemptsForStep.length,
        stageProviderBudget,
        totalProviderBudget: LATE_NIGHT_TOTAL_PROVIDER_BUDGET,
        providerCallsUsed: lateNightEstimatedProviderCalls,
        candidateDeficit: Math.max(0, poolTarget - best.length),
      });
    }
    logChatNearbyRequest({ center: { lat, lng }, radius, category: intent });
    const maxDistanceKm = opts?.maxDistanceKm ?? maxDistanceKmForIntent(intent, stepIndex);
    const strictCafeGuard = stepIndex === 0 && !opts?.placeDetailNearby;

    const seen = new Set<string>();
    let places: PlaceResult[] = [];
    for (let attemptIndex = 0; attemptIndex < attemptsForStep.length; attemptIndex++) {
      const attempt = attemptsForStep[attemptIndex]!;
      const searchKey = JSON.stringify({
        query: attempt.query,
        mode: attempt.mode,
        includedTypes: attempt.includedTypes ?? [],
        nearbyGroups: attempt.nearbyGroups ?? [],
        radius,
      });
      if (attemptedSearchKeys.has(searchKey)) continue;
      attemptedSearchKeys.add(searchKey);
      const estimatedProviderCalls = estimatedPlacesProviderCalls(attempt);
      if (
        homeLateNightProfile &&
        (stageEstimatedProviderCalls + estimatedProviderCalls > stageProviderBudget ||
          lateNightEstimatedProviderCalls + estimatedProviderCalls >
            LATE_NIGHT_TOTAL_PROVIDER_BUDGET)
      ) {
        lateNightFinalizeReason = "provider_budget_exhausted";
        continue;
      }
      const remainingMs = LATE_NIGHT_ORCHESTRATION_TIMEOUT_MS - (Date.now() - lateNightStartedAt);
      if (homeLateNightProfile && remainingMs <= 0) {
        lateNightFinalizeReason = "orchestration_timeout";
        break;
      }
      if (homeLateNightProfile) {
        stageEstimatedProviderCalls += estimatedProviderCalls;
        lateNightEstimatedProviderCalls += estimatedProviderCalls;
      }
      continuationAttemptCount += 1;
      try {
        const effectiveAttempt =
          opts?.geographicScope?.entityType === "district" &&
          attempt.mode === "text" &&
          attempt.query.trim()
            ? {
                ...attempt,
                query: `${opts.geographicScope.displayLabel} ${attempt.query}`.trim(),
              }
            : attempt;
        const scopeSource = opts?.searchCenterAuthority
          ? opts.searchCenterAuthority.source === "clarification_geocode"
            ? "clarified_location"
            : opts.searchCenterAuthority.source
          : opts?.searchContext?.searchMode === "destination"
            ? "explicit"
            : "device";
        logAiPipeline("[PLACES_SEARCH_AUTHORITY]", {
          rawKeyword: extractExplicitNearbyKeyword(opts?.userText ?? "") ?? attempt.query,
          canonicalKeyword: canonicalizeExplicitNearbyKeyword(
            extractExplicitNearbyKeyword(opts?.userText ?? "") ?? attempt.query,
          ),
          scopeSource,
          centerLat: lat,
          centerLng: lng,
          district:
            opts?.geographicScope?.entityType === "district"
              ? opts.geographicScope.displayLabel
              : "",
          radius,
          requestType: attempt.mode,
          query: effectiveAttempt.query || "(nearby)",
          stage: homeLateNightProfile ? (stepIndex === 0 ? 1 : 2) : 0,
        });
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
          effectiveAttempt,
          isTripAddPlace
            ? "chat.fetchNearbyPlacesForIntent.trip_add_place"
            : opts?.placeDetailNearby
              ? "chat.fetchNearbyPlacesForIntent.place_focus"
              : "chat.fetchNearbyPlacesForIntent",
          {
            ...searchExtras,
            radius,
            intentCategory: intent,
            placesLane: attempt.id ?? `${attempt.mode}_${attemptIndex + 1}`,
            placesRound: opts?.continuationRound ?? 0,
            placesScopeSource: opts?.searchCenterAuthority
              ? "clarified_location"
              : opts?.searchContext?.searchMode === "destination"
                ? "explicit_location"
                : "current_device_location",
            placesRecommendationRequestId: opts?.diagnosticRequestId,
            timeoutMs: homeLateNightProfile
              ? Math.max(1, Math.min(CHAT_PLACES_SEARCH_TIMEOUT_MS, remainingMs))
              : undefined,
          },
        );
        if (error) lastError = error;
        lastRawCount = Math.max(lastRawCount, batch.length);
        continuationProviderRaw += attemptRawCount;
        continuationMapped += batch.length;
        stageProviderRawCount += attemptRawCount;
        stageMappedCount += batch.length;
        const laneSemanticEligible = explicitNearbyKeywordForDiagnostics(
          opts?.userText ?? "",
          batch,
        );
        opts?.onSearchExecution?.({
          lane: attempt.id ?? `${attempt.mode}_${attemptIndex + 1}`,
          query: effectiveAttempt.query,
          radius,
        });
        logAiPipeline("[NEARBY_SEARCH_LANE]", {
          round: opts?.continuationRound ?? 0,
          lane: attempt.id ?? `${attempt.mode}_${attemptIndex + 1}`,
          query: effectiveAttempt.query || "(nearby)",
          radius,
          alreadyExecuted: false,
          providerRaw: attemptRawCount,
          semanticEligible: laneSemanticEligible,
          districtEligible:
            opts?.geographicScope?.entityType === "district"
              ? batch.filter(
                  (place) => placeDistrict(place) === opts.geographicScope?.requestedDistrict,
                ).length
              : laneSemanticEligible,
          newAfterExposure: batch.filter(
            (place) => !excludePlaceIds.includes(resolveCanonicalPlaceIdentity(place).identityKey),
          ).length,
        });
        for (const place of batch) {
          const identityKey = resolveCanonicalPlaceIdentity(place).identityKey;
          continuationUniqueBefore.add(identityKey);
          const lanes = providerLanesByIdentity.get(identityKey) ?? new Set<string>();
          lanes.add(attempt.id ?? `${attempt.mode}_${attemptIndex + 1}`);
          providerLanesByIdentity.set(identityKey, lanes);
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
        // Raw provider count is not admission capacity. Explicit keyword lanes must
        // finish their bounded semantic set before deciding that the batch is full.
        if (!homeSpecialProfile && !explicitCapacityAttempts && places.length >= poolTarget) break;
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
    const explicitNearbyKeyword = extractExplicitNearbyKeyword(opts?.userText ?? "");
    const semanticFamily = explicitNearbyKeyword
      ? nearbySemanticFamilyForKeyword(explicitNearbyKeyword)
      : null;
    const districtBefore = places.filter((place) => Boolean(placeDistrict(place))).length;
    const districtEnrichment = await enrichNearbyDistrictCandidates({
      places,
      scope: opts?.geographicScope,
      targetCount: poolTarget,
      fetchPlaceDetails: opts?.fetchPlaceDetails,
      isPromising: (place) =>
        isPlaceOperationalForRecommendation(place) &&
        (!explicitNearbyKeyword ||
          (matchesExplicitNearbyKeyword(place, explicitNearbyKeyword) &&
            matchesNearbySemanticFamily(place, semanticFamily ?? "food"))),
    });
    places = districtEnrichment.places;
    // Geographic authority is hard eligibility, so this runs before scoring and selection.
    const scopeEligiblePlaces = filterPlacesByNearbyGeographicScope(places, opts?.geographicScope);
    if (opts?.placeFocusDiagnostics) {
      const operational = scopeEligiblePlaces.filter(isPlaceOperationalForRecommendation);
      const geographic = filterPlacesByNearbyDistance(operational, lat, lng, maxDistanceKm);
      const preDedupe = filterPlacesByExclusion(geographic, excluded);
      const deduped = filterExcludedPlaceIds(preDedupe, excludePlaceIds);
      opts.placeFocusDiagnostics.rawCount = Math.max(
        opts.placeFocusDiagnostics.rawCount,
        places.length,
      );
      opts.placeFocusDiagnostics.operationalCount = Math.max(
        opts.placeFocusDiagnostics.operationalCount,
        operational.length,
      );
      opts.placeFocusDiagnostics.geographicCount = Math.max(
        opts.placeFocusDiagnostics.geographicCount,
        geographic.length,
      );
      opts.placeFocusDiagnostics.preDedupeCount = Math.max(
        opts.placeFocusDiagnostics.preDedupeCount,
        preDedupe.length,
      );
      opts.placeFocusDiagnostics.dedupedCount = Math.max(
        opts.placeFocusDiagnostics.dedupedCount,
        deduped.length,
      );
    }
    lastRawPlaces = scopeEligiblePlaces;
    logAiPipeline("[NEARBY_RAW_COUNT]", {
      count: places.length,
      providerRawCount: continuationProviderRaw,
      radius,
      stepIndex,
    });

    let afterPreviousExclusion = (
      isShortcutContinuation
        ? filterExactExcludedPlaceIdentities(
            filterPlacesByExclusion(scopeEligiblePlaces, excluded),
            excludePlaceIds,
          )
        : filterExcludedPlaceIds(
            filterPlacesByExclusion(scopeEligiblePlaces, excluded),
            excludePlaceIds,
          )
    ) as PlaceResult[];
    const beforeKeywordAdmission = afterPreviousExclusion;
    if (explicitNearbyKeyword) {
      afterPreviousExclusion = afterPreviousExclusion.filter((place, candidateIndex) => {
        const identityKey = resolveCanonicalPlaceIdentity(place).identityKey;
        const providerLanes = providerLanesByIdentity.get(identityKey);
        const keywordMatch = matchesExplicitNearbyKeywordWithProviderEvidence(
          place,
          explicitNearbyKeyword,
          providerLanes,
        );
        const familyMatch = matchesNearbySemanticFamily(place, semanticFamily ?? "food");
        const accepted = keywordMatch && familyMatch;
        logAiPipeline("[CANDIDATE_KEYWORD_MATCH]", {
          candidate: candidateIndex,
          requiredFamily: semanticFamily ?? "food",
          candidateFamilies: familyMatch ? (semanticFamily ?? "food") : "other",
          accepted,
          reason: accepted
            ? providerLanes?.has("brunch_primary") || providerLanes?.has("brunch_bilingual")
              ? "provider_query_and_family_match"
              : "keyword_family_match"
            : familyMatch
              ? "keyword_mismatch"
              : "family_mismatch",
        });
        console.info("[NEARBY_KEYWORD_MATCH]", {
          rawKeyword: explicitNearbyKeyword,
          candidate: candidateIndex,
          evidence: accepted
            ? "keyword_and_family"
            : keywordMatch
              ? "keyword_only"
              : familyMatch
                ? "family_only"
                : "none",
          accepted,
          providerQueryMatchEvidence: providerLanes ? [...providerLanes] : [],
        });
        return accepted;
      });
      logAiPipeline("[NEARBY_CATEGORY_AUTHORITY]", {
        rawKeyword: explicitNearbyKeyword,
        semanticFamily: semanticFamily ?? "food",
        providerPrimaryType: intent,
        providerQuery: explicitNearbyKeyword,
        finalFamily: semanticFamily ?? "food",
      });
    }
    console.info("[NEARBY_CANDIDATE_FUNNEL]", {
      recommendationRequestId: opts?.diagnosticRequestId ?? "",
      providerRawCount: continuationProviderRaw,
      mappedCount: continuationMapped,
      dedupedCount: places.length,
      keywordMatchedCount: explicitNearbyKeyword
        ? places.filter((place) => {
            const identityKey = resolveCanonicalPlaceIdentity(place).identityKey;
            return (
              matchesExplicitNearbyKeywordWithProviderEvidence(
                place,
                explicitNearbyKeyword,
                providerLanesByIdentity.get(identityKey),
              ) && matchesNearbySemanticFamily(place, semanticFamily ?? "food")
            );
          }).length
        : places.length,
      keywordRejectedCount: Math.max(
        0,
        beforeKeywordAdmission.length - afterPreviousExclusion.length,
      ),
      operationalEligibleCount: places.filter(isPlaceOperationalForRecommendation).length,
      operationalRejectedCount: places.filter(
        (place) => !isPlaceOperationalForRecommendation(place),
      ).length,
      districtKnownCount: places.filter((place) => Boolean(placeDistrict(place))).length,
      districtUnknownCount: places.filter((place) => !placeDistrict(place)).length,
      districtMatchedCount: scopeEligiblePlaces.length,
      districtRejectedCount: Math.max(0, places.length - scopeEligiblePlaces.length),
      districtEnrichmentRequested: districtEnrichment.requestedCount,
      districtEnrichedCount: districtEnrichment.resolvedCount,
      districtStillUnknownCount: districtEnrichment.unresolvedCount,
      districtKnownBeforeEnrichment: districtBefore,
      exposureRejectedCount: Math.max(
        0,
        scopeEligiblePlaces.length - beforeKeywordAdmission.length,
      ),
      finalEligibleCount: afterPreviousExclusion.length,
      eligibilityCount: afterPreviousExclusion.length,
      exposureRemainingCount: afterPreviousExclusion.length,
      renderableCount: 0,
      finalizeReason: "candidate_filtering",
    });
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
      for (const place of scopeEligiblePlaces) {
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

    const homeLateNightSelectionInput = homeLateNightProfile
      ? (() => {
          for (const place of afterPreviousExclusion) {
            // Unknown opening evidence is not closed. Semantic and quality
            // admission below remain authoritative for final display.
            const identity = resolveCanonicalPlaceIdentity(place).identityKey;
            if (!identity || accumulatedLateNightIds.has(identity)) continue;
            accumulatedLateNightIds.add(identity);
            accumulatedLateNightCandidates.push(place);
          }
          return accumulatedLateNightCandidates;
        })()
      : afterPreviousExclusion;
    const filtered = homeSeaProfile
      ? filterHomeSeaCandidates(afterPreviousExclusion)
      : homeLateNightProfile
        ? selectHomeNearbyPicks(homeLateNightSelectionInput, {
            origin: { lat, lng },
            maxDistanceM: homeLateNightProfile && stepIndex > 0 ? radius : undefined,
            minResults: HOME_NEARBY_MIN_DISPLAY,
            maxResults: targetCount,
            period: "late_night",
            timeZone: "Asia/Taipei",
          })
        : applyNearbyPlaceFilters(scopeEligiblePlaces, {
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
            rejectAudit: nearbyRejectAudit,
          });
    const ranked = homeSeaProfile
      ? rankHomeSeaCandidates(filtered, { lat, lng })
      : homeLateNightProfile
        ? filtered
        : shortcutScene
          ? rankPlaces(filtered, lat, lng, context, plusCtx, shortcutScene)
          : rankPlaces(filtered, lat, lng, context, plusCtx, null);
    console.info("[NEARBY_CANDIDATE_FUNNEL]", {
      recommendationRequestId: opts?.diagnosticRequestId ?? "",
      providerRawCount: continuationProviderRaw,
      mappedCount: continuationMapped,
      dedupedCount: places.length,
      keywordMatchedCount: explicitNearbyKeyword
        ? places.filter((place) => {
            const identityKey = resolveCanonicalPlaceIdentity(place).identityKey;
            return (
              matchesExplicitNearbyKeywordWithProviderEvidence(
                place,
                explicitNearbyKeyword,
                providerLanesByIdentity.get(identityKey),
              ) && matchesNearbySemanticFamily(place, semanticFamily ?? "food")
            );
          }).length
        : places.length,
      keywordRejectedCount: Math.max(
        0,
        beforeKeywordAdmission.length - afterPreviousExclusion.length,
      ),
      operationalEligibleCount: places.filter(isPlaceOperationalForRecommendation).length,
      operationalRejectedCount: places.filter(
        (place) => !isPlaceOperationalForRecommendation(place),
      ).length,
      districtKnownCount: places.filter((place) => Boolean(placeDistrict(place))).length,
      districtUnknownCount: places.filter((place) => !placeDistrict(place)).length,
      districtEnrichedCount: districtEnrichment.resolvedCount,
      districtMatchedCount: scopeEligiblePlaces.length,
      districtRejectedCount: Math.max(0, places.length - scopeEligiblePlaces.length),
      exposureRejectedCount: Math.max(
        0,
        scopeEligiblePlaces.length - beforeKeywordAdmission.length,
      ),
      finalEligibleCount: filtered.length,
      eligibilityCount: filtered.length,
      exposureRemainingCount: afterPreviousExclusion.length,
      renderableCount: ranked.length,
      finalizeReason: ranked.length >= poolTarget ? "target_reached" : "bounded_search_continues",
    });
    if (homeLateNightProfile) {
      const funnel = buildLateNightCandidateFunnel(scopeEligiblePlaces, {
        origin: { lat, lng },
        maxDistanceM: stepIndex > 0 ? radius : HOME_NEARBY_MAX_DISTANCE_M,
      });
      logAiPipeline("[LATE_NIGHT_CANDIDATE_FUNNEL]", {
        stage: stepIndex === 0 ? 1 : 2,
        providerRawCount: stageProviderRawCount,
        mappedCount: stageMappedCount,
        providerMappingRejectedCount: Math.max(0, stageProviderRawCount - stageMappedCount),
        ...funnel,
        // The selector is the final display authority (rating signal, hard
        // exclusions, distance and semantic levels), so this diagnostic must
        // report its result rather than a looser semantic-only estimate.
        eligibleCount: ranked.length,
      });
      logAiPipeline("[LATE_NIGHT_FALLBACK_STAGE]", {
        stage: stepIndex === 0 ? 1 : 2,
        candidateCount: ranked.length,
      });
    }
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
    logAiPipeline("[NEARBY_ELIGIBLE_COUNT]", {
      count: ranked.length,
      radius,
      stepIndex,
    });

    if (ranked.length > best.length) {
      best = ranked;
    }
    if (homeLateNightProfile && stepIndex === 0 && radiusSteps.length > 1) {
      if (ranked.length < HOME_NEARBY_MIN_DISPLAY || shouldExpandHomeLateNight) continue;
      lateNightFinalizeReason = "stage_one_sufficient";
      break;
    }
    if (best.length >= poolTarget) {
      lateNightFinalizeReason = "target_reached";
      break;
    }
    if (opts?.placeDetailNearby && places.length === 0 && stepIndex >= 1) break;
  }

  if (homeLateNightProfile) {
    logAiPipeline("[PLACES_RESULT_ACCUMULATOR]", {
      stage: "final",
      requestCount: lateNightEstimatedProviderCalls,
      rawCount: continuationProviderRaw,
      eligibleCount: best.length,
      finalRenderableCount: best.length,
      elapsedMs: Date.now() - lateNightStartedAt,
      timeoutMs: LATE_NIGHT_ORCHESTRATION_TIMEOUT_MS,
      finalizeReason: lateNightFinalizeReason,
    });
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
  if (opts?.placeFocusDiagnostics) opts.placeFocusDiagnostics.finalCount = best.length;
  logAiPipeline("[NEARBY_REJECT_REASONS]", nearbyRejectAudit);
  console.info("[RECOMMENDATION_BATCH_FINALIZE]", {
    recommendationRequestId: opts?.diagnosticRequestId ?? "",
    targetCount: poolTarget,
    rawCount: continuationProviderRaw,
    mappedCount: continuationMapped,
    keywordEligible: continuationUniqueAfterExclusion.size,
    districtEligible: best.length,
    operationalEligible: best.filter(isPlaceOperationalForRecommendation).length,
    exposureEligible: best.length,
    finalCount: best.length,
    finalizeReason:
      best.length >= poolTarget
        ? "target_reached"
        : lastError
          ? "provider_error"
          : "bounded_search_exhausted",
  });
  if (best.length === 0 && continuationProviderRaw === 0 && lastError) {
    throw new Error(`places_search_failed:${lastError}`);
  }
  logAiPipeline("[NEARBY_SEARCH_CAPACITY]", {
    target: poolTarget,
    availableNew: best.length,
    remainingLanes:
      explicitCapacityAttempts && (opts?.continuationRound ?? 0) === 0 && best.length < poolTarget
        ? 3
        : 0,
    finalizeReason:
      best.length >= poolTarget
        ? "target_reached"
        : explicitCapacityAttempts && (opts?.continuationRound ?? 0) === 0
          ? "bounded_initial_lanes_underfilled"
          : "bounded_compatible_lanes_exhausted",
  });
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
    return [lead, "", `附近有 ${count} 間我覺得不錯的選擇：`, "", list].join("\n");
  }

  if (intent === "restaurant") {
    const dest = ctx.destination?.trim();
    const lead =
      exclusionAck ??
      (dest ? `在${dest}，這幾間餐廳值得先看看：` : "依你現在的需求，附近這幾間餐廳值得先看看：");
    return [lead, "", list].join("\n");
  }

  return [`附近找到 ${count} 個值得先看看的地方：`, "", list].join("\n");
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
  searchCenterAuthority?: {
    lat: number;
    lng: number;
    displayLabel: string;
    source: "clarification_geocode";
    originalQuery: string;
    selectedAuthority: "nearby";
  };
  geographicScope?: import("@/lib/ai/nearby-geographic-scope").NearbyGeographicScopeAuthority;
  placeFocusDiagnostics?: PlaceFocusNearbyDiagnostics;
  fetchPlaceDetails?: (
    placeId: string,
  ) => Promise<(PlaceResult & { photoNames?: string[] | null }) | null>;
  continuationRound?: number;
  onSearchExecution?: (execution: NearbySearchExecution) => void;
  diagnosticRequestId?: string;
}): Promise<{
  summary: string;
  payload: RoamiePayloadV2;
  recommendations: RoamieRecommendationItem[];
  /** Full ordered eligible pool for Generic Nearby continuation; first-turn cards stay unchanged. */
  continuationRecommendations: RoamieRecommendationItem[];
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
    const shortcut =
      params.placeDetailNearby || params.searchProfile
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
        shortcutScene: params.placeDetailNearby ? null : params.shortcutScene,
        searchProfile: params.searchProfile,
        searchCenterAuthority: params.searchCenterAuthority,
        geographicScope: params.geographicScope,
        fetchPlaceDetails: params.fetchPlaceDetails,
        continuationRound: params.continuationRound,
        onSearchExecution: params.onSearchExecution,
        diagnosticRequestId: params.diagnosticRequestId,
        placeFocusDiagnostics: params.placeFocusDiagnostics,
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
      // `fetchNearbyPlacesForIntent` is the canonical Nearby admission authority.
      // Do not run the destination-meal opening-hours gate a second time here:
      // provider candidates may legitimately have unknown summary hours and have
      // already passed Nearby keyword/district/business-status eligibility.
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

    console.info("[NEARBY_FINAL_SELECTION]", {
      recommendationRequestId: params.diagnosticRequestId ?? "",
      targetCount: pickCount,
      inputRenderableCount: places.length + foodDistricts.length,
      selectedCount: picks.length,
      selectedPlaceIds: picks.map((place) => place.id).filter(Boolean),
      selectionReason: picks.length >= pickCount ? "target_reached" : "eligible_pool_exhausted",
    });

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
          continuationRecommendations: [],
          shortcutDiagnostics,
        };
      }
      if (shortcutDiagnostics) logShortcutRecommendationSummary(shortcutDiagnostics);
      throw new Error("places_empty");
    }

    const mapPlacesToRecommendations = (sourcePlaces: PlaceResult[]): RoamieRecommendationItem[] =>
      mapPlaceResultsToChatItems(
        sourcePlaces.map((p) => {
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
              distanceSource: params.searchCenterAuthority
                ? "CLARIFICATION_GEOCODE"
                : searchContext?.searchMode === "destination"
                  ? "DESTINATION_CENTER"
                  : "USER_LOCATION",
              categoryIntent:
                intent === "cafe" ? "cafe" : intent === "restaurant" ? "restaurant" : "attraction",
              categoryLabel: isDistrict ? FOOD_DISTRICT_CARD_TYPE : undefined,
            },
          };
        }),
      ).map((item) => {
        const isDistrict = districtPick.some(
          (d) => d.id === item.googlePlaceId || d.id === item.placeId,
        );
        const source = sourcePlaces.find(
          (p) => p.id === item.googlePlaceId || p.id === item.placeId,
        );
        if (params.searchProfile === "home_sea" && source) {
          const desc = buildHomeSeaRecommendationDescription(source);
          return { ...item, reason: desc, description: desc };
        }
        if (mealIntent && !isDistrict && source) {
          const desc = buildMealRecommendationDescription(source, mealIntent);
          return {
            ...item,
            reason: preserveMealRecommendationReason(item.reason, source, mealIntent),
            description: desc,
          };
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
    const recommendations = mapPlacesToRecommendations(picks);
    // Generic Nearby used to discard every eligible candidate beyond `picks` here.
    // Preserve the existing order as a sidecar for the caller's continuation session;
    // shortcut/profile flows keep their established continuation contract.
    const continuationRecommendations =
      !shortcut && !params.searchProfile
        ? mapPlacesToRecommendations([...places, ...foodDistricts])
        : recommendations;
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

    return {
      summary,
      payload,
      recommendations,
      continuationRecommendations,
      shortcutDiagnostics,
    };
  } finally {
    endPlacesFlow(flow);
  }
}
