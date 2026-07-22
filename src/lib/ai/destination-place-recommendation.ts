import { unwrapWeatherResult } from "@/lib/ai/unwrap-weather-result";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { WeatherSummary } from "@/lib/weather-types";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamiePayloadV2, RoamieRecommendationItem } from "@/lib/ai/types";
import {
  fetchPlacesWithSearchAttemptsMerged,
  type PlaceSearchFn,
  type SearchAttempt,
} from "@/lib/ai/chat-place-recommendation";
import {
  buildDestinationTextSearchAttempts,
  EN_CITY_NAMES,
  geocodeDestinationWithFallback,
  logDestinationTextSearchResult,
  resolveDestinationApproxCenter,
} from "@/lib/ai/destination-geocode";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import type { FetchPlaceDetailsForFocusFn } from "@/lib/ai/place-detail-chat";
import {
  logChatDestinationExtracted,
  logChatDestinationResolved,
  logChatIntentDetected,
  logChatPlaceCardsRendered,
  logChatPlacesError,
  logChatPlacesResponse,
  logChatReadyToRecommend,
  logChatRenderBlocked,
  logDestinationGeocodeFallback,
  safeChatLog,
} from "@/lib/ai/chat-place-flow-log";
import {
  buildNamedFallbackRecommendations,
  getMustVisitPlacesForDestination,
  resolveMustVisitDestination,
  shouldFetchDestinationPlaces,
} from "@/lib/ai/must-visit-places";
import {
  buildWeatherAwarePlaceIntro,
  buildWeatherAwareSearchAttempts,
  resolveWeatherScene,
} from "@/lib/ai/weather-place-search";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import { shouldSkipPlanningPlacesApi } from "@/lib/ai/planning-candidate-pool";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { distanceMeters } from "@/lib/map-explore";
import { beginPlacesFlow, endPlacesFlow } from "@/lib/places-api-stats";
import {
  buildLandmarkCompanionIntro,
  buildDestinationPlaceSearchAttempts,
  classifyDestinationForPlaceSearch,
  rankLandmarkCompanionPlaces,
} from "@/lib/ai/landmark-place-strategy";
import {
  filterPlacesForAttractionRecommendation,
  userWantsParkRecommendations,
} from "@/lib/ai/place-recommendation-rules";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import {
  filterAlreadyRecommendedPlaces,
  filterExcludedPlaceIds,
} from "@/lib/place-planning-memory";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { resolveRecommendationStyleTag } from "@/lib/ai/resolve-recommendation-style-tag";
import {
  excludeUsedPlacesFromFollowUp,
  logAiFollowupNewResults,
  type TripUsedPlaces,
} from "@/lib/ai/trip-planning-follow-up";
import { tripStyleDisplayTag } from "@/lib/ai/ai-trip-style";
import {
  buildRefreshRecommendationSummary,
  buildAlternativeRecommendationSummary,
  logChatMorePlacesContext,
  logChatMorePlacesExcludeIds,
  logChatMorePlacesFetchCount,
  logChatMorePlacesIntent,
  logChatMorePlacesNewCount,
} from "@/lib/ai/chat-recommendation-refresh";
import {
  CHAT_DESTINATION_MIN_COUNT,
  CHAT_DESTINATION_TARGET_COUNT,
  filterChatDestinationPlaces,
  filterChatPlanningPlaces,
} from "@/lib/ai/chat-destination-place-filter";
import {
  filterPlacesByShoppingGuard,
  filterRecommendationsForCategoryRender,
} from "@/lib/ai/chat-category-place-guard";
import {
  patchShoppingRecommendationSession,
  type ConversationRecommendationSession,
} from "@/lib/ai/conversation-recommendation-session";
import {
  SHOPPING_FOLLOWUP_MIN_NEW,
  SHOPPING_RESULTS_PER_QUERY,
  shoppingCanonicalKey,
  shoppingBrandKey,
  buildShoppingFollowupCalls,
  buildShoppingCoverageState,
  detectShoppingSubtype,
  createShoppingFollowUpBudget,
  shoppingBudgetExhausted,
  makeShoppingFollowupRequestId,
  logShoppingSessionState,
  logShoppingFollowupRequest,
  logShoppingFollowupBudget,
  logShoppingCoverageState,
  logShoppingFollowupGroupPlan,
  logShoppingFollowupQueryAttempt,
  logShoppingFollowupGroupSwitch,
  logShoppingFollowupFilterSummary,
  logShoppingQuerySkipped,
  logShoppingFollowupEarlyStop,
  logShoppingFollowupRateLimited,
  logShoppingFollowupSearchStart,
  logShoppingQueryResult,
  logShoppingQueryDiag,
  logShoppingFollowupFinal,
  logShoppingFollowupNewCandidates,
  remainingShoppingGroups,
  SHOPPING_DISPLAY_LIMIT,
  type FollowUpSearchBudget,
  type FollowUpSearchStatus,
  type ShoppingQueryGroupId,
} from "@/lib/ai/shopping-query-queue";
import {
  preferUnderrepresentedShoppingCluster,
  resolveShoppingSearchScope,
  shoppingScopeExhausted,
  type ShoppingSearchScope,
} from "@/lib/ai/shopping-search-scope";
import { beginPlacesGenerationSession, isPlacesRateLimited } from "@/lib/places-api-guard";
import {
  bindSessionCandidatePool,
  ensureSessionDestination,
  extractCuisineKeywordFromText,
  filterCandidatePoolPlaces,
  ingestResolvedPlacesIntoCandidatePool,
  logPlacesSearchSkipped,
  readCandidatePoolCache,
  readSessionCandidatePool,
} from "@/lib/ai/places-cost-cache";
import {
  buildDestinationEnglishFallbackQueries,
  filterPlacesByDestinationGuard,
  placesSearchContextPayload,
  type ChatPlaceSearchContext,
} from "@/lib/ai/chat-place-search-context";
import {
  logAiPlaceSearchStart,
  resolveTripStyleFromContext,
  buildTripStyleSupplementAttempts,
} from "@/lib/ai/ai-trip-style";
import {
  buildComposedDayPlanSummary,
  composedPlansToAiDayPlan,
  dayPlanToRecommendations,
  ensureAllDayPlansExist,
  enforceStandardDaySlotPlans,
  flattenComposedDayPlanPlaces,
  isItineraryRenderable,
  mergeEnrichedIntoDayPlan,
  plannerTotalPlaces,
  type AiDayPlan,
  type ComposedDayPlan,
} from "@/lib/ai/ai-day-plan-source";
import { refillMissingDaySlots } from "@/lib/ai/ai-multi-day-planner";
import { resolveDayPlanPlaceCards } from "@/lib/ai/ai-day-plan-place-cards";
import { logItineraryRenderWithPartialDetails } from "@/lib/ai/planning-place-id";
import {
  buildPlanningDaySummary,
  generateTripPlanFromStyle,
  minRenderablePlaces,
  resolvePlanningTripStyle,
  shouldUseTripStylePlanning,
  type DestinationPlaceSearchFn,
} from "@/lib/ai/destination-trip-planning";
import {
  enrichContextForItineraryMode,
  logChatItineraryMode,
  logChatMode,
  logChatPlaceListMode,
  logChatPlannerFinish,
  logChatPlannerStart,
  logChatRenderItinerary,
  logChatRenderPlaceList,
  plannerDaysMatchRequested,
  resolveItineraryDays,
  shouldUseItineraryMode,
} from "@/lib/ai/chat-itinerary-mode";
import {
  logAiRenderBlocked,
  logAiRenderItineraryStart,
  logAiRenderItinerarySuccess,
} from "@/lib/ai/normalize-planning-places";
import { logAiPushPlaceCards } from "@/lib/ai/ai-chat-conversation-state";
import { alignDayPlanToSession, getFrozenPlanningDayPlan } from "@/lib/ai/ai-planning-session";
import type { DayPlanBucket } from "@/lib/ai/ai-trip-style";
import {
  ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
  logItineraryDeliveryBlocked,
} from "@/lib/ai/itinerary-validator";

export type { GeocodeDestinationFn };

export type FetchWeatherFn = (args: {
  data: { lat: number; lng: number; locale?: Locale };
}) => Promise<WeatherSummary>;

export { shouldFetchDestinationPlaces };

const RECOMMENDATION_COUNT = CHAT_DESTINATION_TARGET_COUNT;

function templateNameSearchAttempts(destination: string): SearchAttempt[] {
  return getMustVisitPlacesForDestination(destination)
    .slice(0, RECOMMENDATION_COUNT)
    .map((place) => ({
      query: `${destination} ${place.name}`,
      mode: "text" as const,
      includedTypes: ["tourist_attraction"],
    }));
}

function placesToRecommendations(
  places: PlaceResult[],
  lat: number,
  lng: number,
  context: CanonicalTravelContext,
  locale: Locale,
  categoryIntent?: string,
): RoamieRecommendationItem[] {
  const categoryLabel =
    categoryIntent === "shopping"
      ? "購物／商圈"
      : categoryIntent === "cafe"
        ? "咖啡廳"
        : categoryIntent === "restaurant"
          ? "餐廳"
          : categoryIntent === "attraction"
            ? "景點"
            : undefined;
  return places.slice(0, RECOMMENDATION_COUNT).map((place) => {
    const distM =
      place.lat != null && place.lng != null
        ? distanceMeters({ lat, lng }, { lat: place.lat, lng: place.lng })
        : undefined;
    const item = mapPlaceResultToChatItem(place, {
      mood: context.mood,
      locale,
      distanceMeters: distM,
      categoryLabel,
      categoryIntent,
    });
    return {
      ...item,
      types: place.types?.length
        ? place.types
        : place.primaryType
          ? [place.primaryType]
          : undefined,
    } as RoamieRecommendationItem & { types?: string[] };
  });
}

function buildSummaryText(
  destination: string,
  intro: string,
  recommendations: RoamieRecommendationItem[],
  context: CanonicalTravelContext,
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>,
  dayBuckets?: DayPlanBucket[],
  composedPlans?: ComposedDayPlan[],
  opts?: { slowTravel?: boolean },
): string {
  const label = normalizeDestinationLabel(destination);
  const days = context.days;
  if (
    (context.tripPurpose === "refresh_recommendations" ||
      context.tripPurpose === "more_place_recommendations") &&
    recommendations.length > 0
  ) {
    return buildRefreshRecommendationSummary(recommendations, "attraction");
  }
  if (days && days >= 1 && composedPlans?.length && isItineraryRenderable(composedPlans, days, context.planningTripStyle ?? "mixed")) {
    return buildPlanningDaySummary(
      label,
      days,
      context.planningTripStyle ?? "mixed",
      dayBuckets ?? [],
      composedPlans,
      opts,
    );
  }
  if (!recommendations.length) {
    const hint =
      profile?.kind === "landmark"
        ? `我暫時沒連上${label}周邊的即時地點資料，你可以換個說法（例如「${label}周邊景點」）再試一次。`
        : `我暫時沒連上${label}的即時地點資料，你可以換個說法（例如「${label}必去景點」）再試一次。`;
    return [intro, "", hint].join("\n");
  }
  const lines = recommendations.map(
    (rec, index) => `${index + 1}. ${rec.name}${rec.reason ? ` — ${rec.reason}` : ""}`,
  );
  return [intro, "", ...lines, "", "想加進行程的話，跟我說你最想先排哪幾個。"].join("\n");
}

/**
 * Shopping follow-up search — category path only.
 * Must NOT use attraction filters or itinerary retail exclusion.
 */
async function searchShoppingCategoryAttempts(params: {
  city: string;
  lat: number;
  lng: number;
  radius: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  attempts: SearchAttempt[];
  userText?: string;
  searchContext?: ChatPlaceSearchContext;
  excludePlaceIds?: string[];
  /** Hard per-turn budget — stop before global Places cooldown sleep. */
  budget?: FollowUpSearchBudget;
  maxPerQuery?: number;
}): Promise<{
  /** Category-filtered places ready for dedupe */
  places: PlaceResult[];
  /** Pre-filter merged API hits */
  rawPlaces: PlaceResult[];
  perQuery: Array<{
    query: string;
    requestStatus: string;
    rawCount: number;
  }>;
  rateLimited: boolean;
  timedOut: boolean;
  budget: FollowUpSearchBudget | undefined;
}> {
  const perQuery: Array<{
    query: string;
    requestStatus: string;
    rawCount: number;
  }> = [];
  const seen = new Set<string>();
  const merged: PlaceResult[] = [];
  const budget = params.budget;
  const maxPerQuery = params.maxPerQuery ?? SHOPPING_RESULTS_PER_QUERY;
  let rateLimited = false;
  let timedOut = false;

  const ctxPayload = params.searchContext
    ? placesSearchContextPayload(
        {
          ...params.searchContext,
          destinationName: params.city,
          destinationCity: params.city,
          destinationLatLng: { lat: params.lat, lng: params.lng },
        },
        "shopping",
      )
    : {
        destinationName: params.city,
        searchMode: "destination" as const,
        intentCategory: "shopping",
        cacheDestination: params.city,
        cacheCity: params.city,
      };

  for (const attempt of params.attempts) {
    if (budget && shoppingBudgetExhausted(budget)) {
      logShoppingQuerySkipped({
        query: attempt.query,
        reason: "budget_exhausted",
      });
      break;
    }
    // Fail fast — never sleep through Places client cooldown in a chat turn.
    if (isPlacesRateLimited()) {
      rateLimited = true;
      logShoppingQuerySkipped({
        query: attempt.query,
        reason: "rate_limited",
      });
      break;
    }

    const radius = attempt.radius ?? params.radius;
    try {
      if (budget) {
        budget.usedNetworkCalls += 1;
        budget.usedQueries.push(attempt.query);
      }
      const result = await params.searchPlaces({
        data: {
          query: attempt.query,
          lat: params.lat,
          lng: params.lng,
          mode: attempt.mode,
          includedTypes: attempt.includedTypes,
          radius,
          locale: params.locale,
          ...ctxPayload,
          intentCategory: "shopping",
          searchMode: ctxPayload.searchMode ?? "destination",
        },
      });
      const rawAll = result.places ?? [];
      const raw = rawAll.slice(0, maxPerQuery);
      const err = result.error?.trim() ?? "";
      const status = err
        ? err
        : raw.length === 0
          ? "ZERO_RESULTS"
          : "OK";
      perQuery.push({
        query: attempt.query,
        requestStatus: status,
        rawCount: raw.length,
      });

      if (/places_rate_limited|rate.?limit|429|503/i.test(err) || isPlacesRateLimited()) {
        rateLimited = true;
        logShoppingQuerySkipped({
          query: attempt.query,
          reason: "rate_limited",
        });
        break;
      }

      for (const place of raw) {
        const id = (place.id ?? place.name ?? "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(place);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "error");
      const isTimeout = /timeout|aborted|abort/i.test(message);
      const isRate = /places_rate_limited|rate.?limit|429|503/i.test(message);
      perQuery.push({
        query: attempt.query,
        requestStatus: isTimeout ? "timeout" : message.slice(0, 80),
        rawCount: 0,
      });
      logChatPlacesError(error, `shopping_query=${attempt.query}`);
      if (isTimeout) {
        timedOut = true;
        break;
      }
      if (isRate || isPlacesRateLimited()) {
        rateLimited = true;
        logShoppingQuerySkipped({
          query: attempt.query,
          reason: "rate_limited",
        });
        break;
      }
    }
  }

  // Destination / id exclude only — shopping category gate runs in the follow-up
  // loop so SHOPPING_QUERY_DIAG can report rejectedCategory accurately.
  let places = filterPlacesByDestinationGuard(merged, params.city, params.userText);
  places = filterExcludedPlaceIds(places, params.excludePlaceIds ?? []);
  places = places.filter((place) => {
    if (!place.name?.trim() || !place.id?.trim()) return false;
    const biz = (place.businessStatus ?? "").trim().toUpperCase();
    return biz !== "CLOSED_PERMANENTLY";
  });
  return { places, rawPlaces: merged, perQuery, rateLimited, timedOut, budget };
}

async function searchDestinationPlaces(params: {
  label: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  weather: WeatherSummary | null;
  context: CanonicalTravelContext;
  attempts: SearchAttempt[];
  caller: string;
  excludePlaceIds?: string[];
  userText?: string;
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchContext?: ChatPlaceSearchContext;
  planningMode?: boolean;
  planningTargetCount?: number;
  classicLandmarkMode?: boolean;
  radius?: number;
  /** Seed shared Candidate Pool after successful Places resolution */
  sessionId?: string | null;
  countryCode?: string;
}): Promise<PlaceResult[]> {
  const {
    label,
    lat,
    lng,
    locale,
    searchPlaces,
    weather,
    context,
    attempts,
    caller,
    excludePlaceIds = [],
    userText,
    profile,
    searchContext,
    planningMode = false,
    planningTargetCount,
    classicLandmarkMode = false,
    radius,
    sessionId,
    countryCode,
  } = params;

  const searchExtras = searchContext
    ? { searchContext, intentCategory: "destination_attraction", radius }
    : radius != null
      ? { radius }
      : undefined;

  if (shouldSkipPlanningPlacesApi() && planningMode) {
    return [];
  }

  const mergeAndFilter = async (searchAttempts: SearchAttempt[]): Promise<PlaceResult[]> => {
    // planningMode：允許較高合併上限，但上游 Style 已改成「每 query 各打一次 + 低 keep」，
    // 這裡不再用單一 24 上限當「只拉高一個 query」的捷徑。
    const mergeMax = planningMode
      ? Math.max(planningTargetCount ?? 24, 32)
      : 24;
    let places = await fetchPlacesWithSearchAttemptsMerged(
      searchPlaces,
      lat,
      lng,
      locale,
      searchAttempts,
      caller,
      { minResults: CHAT_DESTINATION_MIN_COUNT, maxResults: mergeMax, extras: searchExtras },
    );
    places = filterPlacesByDestinationGuard(places, label, userText);
    places = filterExcludedPlaceIds(places, excludePlaceIds);
    const allowParks = userWantsParkRecommendations(userText ?? "", context);
    places = filterPlacesForAttractionRecommendation(places, {
      allowParks,
      profile,
      parentLandmark: profile?.parentLandmark,
      blockedPlaceIds: excludePlaceIds,
    });
    if (planningMode) {
      return filterChatPlanningPlaces(places, {
        destination: label,
        profile,
        userText,
        targetCount: planningTargetCount,
      });
    }
    return filterChatDestinationPlaces(places, {
      destination: label,
      profile,
      userText,
    });
  };

  let filtered = await mergeAndFilter(attempts);

  if (filtered.length < CHAT_DESTINATION_MIN_COUNT && !shouldSkipPlanningPlacesApi()) {
    const supplementAttempts = buildDestinationTextSearchAttempts(label).filter(
      (attempt) => !attempts.some((a) => a.query === attempt.query),
    );
    if (supplementAttempts.length) {
      const more = await mergeAndFilter(supplementAttempts);
      const seen = new Set(filtered.map((p) => p.id));
      for (const place of more) {
        if (!seen.has(place.id)) {
          seen.add(place.id);
          filtered.push(place);
        }
      }
      filtered = filtered.slice(0, CHAT_DESTINATION_TARGET_COUNT);
    }
  }

  if (filtered.length < CHAT_DESTINATION_MIN_COUNT && !shouldSkipPlanningPlacesApi()) {
    const englishFallback = buildDestinationEnglishFallbackQueries(label);
    const more = await mergeAndFilter(englishFallback);
    const seen = new Set(filtered.map((p) => p.id));
    for (const place of more) {
      if (!seen.has(place.id)) {
        seen.add(place.id);
        filtered.push(place);
      }
    }
    filtered = filtered.slice(0, CHAT_DESTINATION_TARGET_COUNT);
  }

  if (!filtered.length && weather) {
    void weather;
    void context;
  }

  logDestinationTextSearchResult(filtered.length);
  if (filtered.length) {
    ingestResolvedPlacesIntoCandidatePool({
      sessionId: sessionId ?? "chat_default",
      destination: label,
      countryCode: countryCode ?? searchContext?.destinationCountry ?? undefined,
      places: filtered,
      source: caller || "chat_recommendation",
    });
  }
  return filtered;
}

function buildAlternativeSearchAttempts(destination: string): SearchAttempt[] {
  return [
    { query: `${destination} 美食 餐廳`, mode: "text", includedTypes: ["restaurant"] },
    { query: `${destination} 咖啡廳`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${destination} 室內景點`, mode: "text", includedTypes: ["museum", "shopping_mall", "art_gallery"] },
    { query: `${destination} 餐廳`, mode: "nearby", includedTypes: ["restaurant"] },
    { query: `${destination} 咖啡`, mode: "nearby", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${destination} 博物館`, mode: "nearby", includedTypes: ["museum", "art_gallery", "shopping_mall"] },
  ];
}

function pickAlternativePlaceMix(places: PlaceResult[], max = RECOMMENDATION_COUNT): PlaceResult[] {
  const buckets: Record<"restaurant" | "cafe" | "indoor", PlaceResult[]> = {
    restaurant: [],
    cafe: [],
    indoor: [],
  };
  const seen = new Set<string>();

  for (const place of places) {
    const id = place.placeId ?? place.name;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name = (place.name ?? "").trim();
    const types = new Set(
      [...(place.types ?? []), place.primaryType ?? ""]
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    );

    if (types.has("restaurant") || /(餐|食|飯|廚|料理|小吃)/.test(name)) {
      buckets.restaurant.push(place);
    } else if (types.has("cafe") || types.has("coffee_shop") || /咖啡/.test(name)) {
      buckets.cafe.push(place);
    } else {
      buckets.indoor.push(place);
    }
  }

  const picked: PlaceResult[] = [];
  const order: Array<keyof typeof buckets> = ["restaurant", "cafe", "indoor"];
  while (picked.length < max) {
    let added = false;
    for (const key of order) {
      const next = buckets[key].shift();
      if (!next) continue;
      picked.push(next);
      added = true;
      if (picked.length >= max) break;
    }
    if (!added) break;
  }
  return picked;
}

export async function buildAlternativeDestinationRecommendations(params: {
  destination: string;
  userText: string;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn: FetchWeatherFn;
  excludePlaceIds?: string[];
  rejectedPlaceNames?: string[];
}): Promise<{
  summary: string;
  recommendations: RoamieRecommendationItem[];
  payload: RoamiePayloadV2;
  contextPatch: Partial<CanonicalTravelContext>;
}> {
  const {
    destination,
    userText,
    context,
    locale,
    searchPlaces,
    geocodeFn,
    excludePlaceIds = [],
    rejectedPlaceNames = [],
  } = params;
  const label = normalizeDestinationLabel(destination);

  logChatIntentDetected("alternative_recommendations", userText);
  logChatDestinationExtracted(label, "alternative_flow");
  logChatReadyToRecommend(label, "ready_to_recommend");

  const flow = beginPlacesFlow("chat_destination_alternative");
  try {
    const geocoded = await geocodeDestinationWithFallback({
      destination: label,
      locale,
      geocodeFn,
    });

    let lat: number;
    let lng: number;
    let textOnlyDestinationSearch = false;
    if (geocoded?.lat != null && geocoded?.lng != null) {
      lat = geocoded.lat;
      lng = geocoded.lng;
      logChatDestinationResolved(label, lat, lng, "geocode");
    } else {
      logDestinationGeocodeFallback(label, "approx_center");
      const approx = resolveDestinationApproxCenter(label);
      if (approx) {
        lat = approx.lat;
        lng = approx.lng;
        logChatDestinationResolved(label, lat, lng, "approx_center");
      } else {
        lat = 0;
        lng = 0;
        textOnlyDestinationSearch = true;
      }
    }

    const altEntity = resolveDestinationEntity(label);
    const searchContext: ChatPlaceSearchContext = {
      searchMode: "destination",
      destinationName: label,
      destinationLatLng: textOnlyDestinationSearch ? null : { lat, lng },
      textOnlyDestinationSearch,
      destinationCountry: altEntity.country,
      destinationCity: altEntity.type === "city" ? label : undefined,
    };

    const searchProfile = classifyDestinationForPlaceSearch(label, geocoded);
    const attempts = buildAlternativeSearchAttempts(label);
    let places = await searchDestinationPlaces({
      label,
      lat,
      lng,
      locale,
      searchPlaces,
      weather: null,
      context: { ...context, tripPurpose: "alternative_recommendations" },
      attempts,
      caller: "chat.destinationAlternative",
      excludePlaceIds,
      userText,
      profile: searchProfile,
      searchContext,
      sessionId: "chat_default",
      countryCode: altEntity.country ?? undefined,
    });

    places = filterAlreadyRecommendedPlaces(places, {
      rejectedNames: rejectedPlaceNames,
    });
    places = pickAlternativePlaceMix(places);

    let recommendations: RoamieRecommendationItem[];
    if (places.length > 0) {
      recommendations = placesToRecommendations(places, lat, lng, context, locale);
      logChatPlacesResponse(recommendations.length, "places_api");
    } else {
      logChatPlacesError("places_empty", "alternative_all_attempts");
      recommendations = [];
      safeChatLog(logChatRenderBlocked,"no_real_places");
    }

    const summary = buildAlternativeRecommendationSummary(recommendations);
    if (recommendations.length > 0) {
      logChatPlaceCardsRendered(recommendations.length);
    }

    return {
      summary,
      recommendations,
      payload: {
        version: 2,
        title: "美食咖啡室內推薦",
        summary,
        moodTag: resolvePayloadMoodTag(context),
        recommendations,
        itinerary: [],
        generatedAt: new Date().toISOString(),
      },
      contextPatch: {
        destination: label,
        tripPurpose: "alternative_recommendations",
        conversationState: "itinerary_draft",
        planningStage: "recommendations_generated",
        setting: "混合",
      },
    };
  } finally {
    endPlacesFlow(flow);
  }
}

export async function buildDestinationMustVisitRecommendation(params: {
  destination: string;
  userText: string;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn: FetchWeatherFn;
  fetchPlaceDetailsFn?: FetchPlaceDetailsForFocusFn;
  excludePlaceIds?: string[];
  rejectedPlaceNames?: string[];
  planningSessionId?: string;
  session?: ChatPlanningSession;
}): Promise<{
  summary: string;
  recommendations: RoamieRecommendationItem[];
  dayPlan?: AiDayPlan;
  payload: RoamiePayloadV2;
  contextPatch: Partial<CanonicalTravelContext>;
}> {
  const {
    destination,
    userText,
    context,
    locale,
    searchPlaces,
    geocodeFn,
    fetchWeatherFn,
    fetchPlaceDetailsFn,
    excludePlaceIds = [],
    rejectedPlaceNames = [],
    planningSessionId,
    session,
  } = params;
  const label = normalizeDestinationLabel(destination);
  const useItineraryMode = shouldUseItineraryMode(userText, context, session);
  const planningContext = useItineraryMode
    ? enrichContextForItineraryMode(userText, context, session)
    : context;
  const useStylePlanning = shouldUseTripStylePlanning(planningContext, session);
  const days = useItineraryMode
    ? resolveItineraryDays(userText, planningContext, session)
    : useStylePlanning
      ? planningContext.days
      : undefined;
  const style = useItineraryMode || useStylePlanning
    ? resolvePlanningTripStyle(planningContext, session)
    : undefined;

  if (useItineraryMode) {
    logChatItineraryMode(
      days ? `days=${days}` : "days_pending",
    );
    logChatMode("itinerary", "itinerary_signal");
  } else {
    logChatPlaceListMode("no_itinerary_signal");
    logChatMode("place_list", "no_itinerary_signal");
  }

  if (useStylePlanning && days) {
    logAiPlaceSearchStart(label, style!, days);
  }
  logChatIntentDetected("must_visit_places", userText);
  logChatDestinationExtracted(label, useStylePlanning ? "trip_style_planning" : "must_visit_flow");
  logChatReadyToRecommend(label, "ready_to_recommend");

  const flow = beginPlacesFlow("chat_once");
  const poolSessionId =
    planningSessionId?.trim() ||
    session?.planningSessionId?.trim() ||
    session?.conversationId?.trim() ||
    "chat_default";
  const boundSearchDestinationPlaces: DestinationPlaceSearchFn = (searchParams) =>
    searchDestinationPlaces({
      ...searchParams,
      sessionId: poolSessionId,
      countryCode: searchParams.searchContext?.destinationCountry ?? undefined,
    });

  try {
    const geocoded = await geocodeDestinationWithFallback({
      destination: label,
      locale,
      geocodeFn,
    });
    const searchProfile = classifyDestinationForPlaceSearch(label, geocoded);

    let lat: number;
    let lng: number;
    let geocodeSucceeded = false;
    let textOnlyDestinationSearch = false;

    if (geocoded?.lat != null && geocoded?.lng != null) {
      lat = geocoded.lat;
      lng = geocoded.lng;
      geocodeSucceeded = true;
      logChatDestinationResolved(label, lat, lng, "geocode");
      logChatDestinationExtracted(`${label}@${lat.toFixed(4)},${lng.toFixed(4)}`, "geocode");
    } else {
      logDestinationGeocodeFallback(label, "approx_center");
      const approx = resolveDestinationApproxCenter(label);
      if (approx) {
        lat = approx.lat;
        lng = approx.lng;
        logChatDestinationResolved(label, lat, lng, "approx_center");
        logChatDestinationExtracted(`${label}@${lat.toFixed(4)},${lng.toFixed(4)}`, "approx_center");
      } else {
        lat = 0;
        lng = 0;
        textOnlyDestinationSearch = true;
        logChatDestinationResolved(label, lat, lng, "approx_center");
        logChatDestinationExtracted(`${label}@text_only`, "text_only");
      }
    }

    const entity = resolveDestinationEntity(label);
    const searchContext: ChatPlaceSearchContext = {
      searchMode: "destination",
      destinationName: label,
      destinationLatLng: textOnlyDestinationSearch ? null : { lat, lng },
      textOnlyDestinationSearch,
      destinationCountry: entity.country,
      destinationCity: entity.type === "city" ? label : undefined,
    };

    let weather: WeatherSummary | null = null;
    if (geocodeSucceeded) {
      try {
        const raw = await fetchWeatherFn({ data: { lat, lng, locale } });
        weather = unwrapWeatherResult(raw);
      } catch (error) {
        logChatPlacesError(error, "weather");
      }
    }

    const scene = resolveWeatherScene(weather, label);
    const weatherSearchLabel =
      searchProfile.kind === "landmark"
        ? (searchProfile.nearestCity ?? label)
        : label;
    const intro =
      searchProfile.kind === "landmark"
        ? buildLandmarkCompanionIntro(searchProfile, scene, weather?.available !== false)
        : buildWeatherAwarePlaceIntro(label, scene, weather?.available !== false);

    if ((useItineraryMode || useStylePlanning) && days && style) {
      logAiRenderItineraryStart();
      logChatPlannerStart(label, days, style);

      const sessionId =
        planningSessionId ??
        (() => {
          throw new Error("[CHAT_PLACES] missing planningSessionId");
        })();

      const stylePlan = await generateTripPlanFromStyle({
        label,
        lat,
        lng,
        locale,
        searchPlaces,
        weather,
        context: planningContext,
        style,
        days,
        caller: geocodeSucceeded
          ? "chat.destinationTripPlanning"
          : "chat.destinationTripPlanning.textOnly",
        excludePlaceIds,
        userText,
        profile: searchProfile,
        searchContext,
        geocodeSucceeded,
        searchProfile,
        weatherSearchLabel,
        templateNameSearchAttempts,
        searchDestinationPlaces: boundSearchDestinationPlaces,
        planningSessionId: sessionId,
        planVersion: session?.planVersion,
        geocodeFn,
        fetchPlaceDetailsFn,
      }).catch((error) => {
        logAiPipeline(
          "[AI_TRIP_PLAN_ERROR]",
          error instanceof Error ? error.message : String(error),
          `style=${style}`,
        );
        return {
          places: [] as PlaceResult[],
          rankedPlaces: [] as PlaceResult[],
          dayBuckets: [] as DayPlanBucket[],
          composedPlans: [] as ComposedDayPlan[],
          dayPlan: undefined,
          recommendations: [] as RoamieRecommendationItem[],
          slowTravel: false,
        };
      });

      const filteredPlacesForPlan = filterAlreadyRecommendedPlaces(stylePlan.places, {
        rejectedNames: rejectedPlaceNames,
        blockedCoreNames: searchProfile.parentLandmark
          ? [searchProfile.parentLandmark]
          : undefined,
      }) as PlaceResult[];

      let recommendations = stylePlan.recommendations;
      let dayPlan = stylePlan.dayPlan;
      const dayBuckets = stylePlan.dayBuckets;
      let composedPlans = stylePlan.composedPlans;
      const slowTravel = stylePlan.slowTravel ?? false;
      const poolExpansionExhausted = stylePlan.poolExpansionExhausted ?? false;

      // 成功結果凍結後，不允許空 dayPlan / empty cards 覆蓋
      if (!dayPlan?.items.length) {
        const frozen = getFrozenPlanningDayPlan(sessionId);
        if (frozen?.items.length) {
          dayPlan = frozen;
          recommendations = dayPlanToRecommendations(frozen);
        }
      }

      if (dayPlan) {
        const enrichedCards = await resolveDayPlanPlaceCards({
          composedPlans,
          placesPool: [
            ...flattenComposedDayPlanPlaces(composedPlans),
            ...filteredPlacesForPlan,
          ],
          destination: label,
          lat,
          lng,
          locale,
          context,
          searchPlaces,
        });
        if (enrichedCards.length) {
          dayPlan = mergeEnrichedIntoDayPlan(dayPlan, enrichedCards);
        } else {
          logItineraryRenderWithPartialDetails(dayPlan.items.length);
        }
        recommendations = dayPlanToRecommendations(dayPlan);
      }

      const plannerDayCount = composedPlans.filter((plan) => plan.entries.length > 0).length;
      let itineraryRenderable = isItineraryRenderable(composedPlans, days, style);
      if (!itineraryRenderable && plannerTotalPlaces(composedPlans) > 0) {
        composedPlans = enforceStandardDaySlotPlans(
          ensureAllDayPlansExist(
            refillMissingDaySlots({
              plans: composedPlans,
              pool: filteredPlacesForPlan,
              days,
              style,
              plannedDate: planningContext.startDate,
            }),
            days,
          ),
          days,
        );
        itineraryRenderable = isItineraryRenderable(composedPlans, days, style);
        if (itineraryRenderable) {
          dayPlan = alignDayPlanToSession(
            composedPlansToAiDayPlan({
              composedPlans,
              destination: label,
              days,
              planningSessionId: sessionId,
            }),
            sessionId,
          );
          recommendations = dayPlanToRecommendations(dayPlan);
        }
      }

      // P4.2：Itinerary Validator 失敗 → 不得交付看似完成的行程；必須留下原因與使用者訊息
      if (
        stylePlan.itineraryValidation &&
        stylePlan.itineraryValidation.path === "validator" &&
        !stylePlan.itineraryValidation.pass
      ) {
        dayPlan = undefined;
        recommendations = [];
        itineraryRenderable = false;
        logItineraryDeliveryBlocked(
          "validator_failed",
          stylePlan.itineraryValidation,
        );
        const failCodes = stylePlan.itineraryValidation.failedRules
          .map((r) => r.code)
          .join(",");
        safeChatLog(
          logChatRenderBlocked,
          `itinerary_validator_failed:${failCodes || "unknown"}`,
        );
        logAiRenderBlocked(
          `itinerary_validator_failed:${failCodes || "unknown"}`,
          filteredPlacesForPlan.length,
          0,
        );
        const blockedSummary = ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE;
        return {
          summary: blockedSummary,
          recommendations: [],
          dayPlan: undefined,
          payload: buildPayload(blockedSummary, [], planningContext, session),
          contextPatch: buildContextPatch(label),
        };
      }

      logChatPlannerFinish(
        label,
        days,
        dayPlan?.items.length ?? recommendations.length,
        plannerDayCount,
      );

      const summary = buildPlanningDaySummary(
        label,
        days,
        style,
        dayBuckets ?? [],
        composedPlans,
        { slowTravel, expansionExhausted: poolExpansionExhausted },
      );

      if (itineraryRenderable && recommendations.length > 0 && dayPlan?.items.length) {
        logAiPushPlaceCards(recommendations.length);
        logChatPlaceCardsRendered(recommendations.length);
        logAiRenderItinerarySuccess(recommendations.length, dayPlan?.days, days);
        logChatRenderItinerary(days, dayPlan.items.length);
        if (!plannerDaysMatchRequested(plannerDayCount, days)) {
          safeChatLog(logChatRenderBlocked,`planner_days_mismatch:${plannerDayCount}/${days}`);
        }
      } else if (
        stylePlan.candidateInsufficient ||
        plannerTotalPlaces(composedPlans) > 0
      ) {
        // P1 Step 1: 候選不足或不可 render → 不得保留 partial 假完成行程／單點日
        dayPlan = undefined;
        recommendations = [];
        const blockReason = stylePlan.candidateInsufficient
          ? "insufficient_candidates"
          : "itinerary_plan_incomplete";
        safeChatLog(logChatRenderBlocked, blockReason);
        logAiRenderBlocked(
          blockReason,
          filteredPlacesForPlan.length,
          0,
        );
        if (stylePlan.candidateInsufficient) {
          logAiPipeline(
            "[CANDIDATE_INSUFFICIENT_BLOCK_SAVE]",
            `requiredCount=${stylePlan.candidateInsufficient.requiredCount}`,
            `availableCount=${stylePlan.candidateInsufficient.availableCount}`,
            `missingCount=${stylePlan.candidateInsufficient.missingCount}`,
            `affectedDays=[${stylePlan.candidateInsufficient.affectedDays.join(",")}]`,
            "action=clear_partial_day_plan",
            "sourceFunction=recommendDestinationPlaces",
          );
        }
      } else {
        dayPlan = undefined;
        recommendations = [];
        safeChatLog(logChatRenderBlocked,
          filteredPlacesForPlan.length > 0 ? "itinerary_plan_incomplete" : "no_valid_geocoded_places",
        );
        logAiRenderBlocked(
          filteredPlacesForPlan.length > 0 ? "itinerary_plan_incomplete" : "no_valid_geocoded_places",
          filteredPlacesForPlan.length,
          0,
        );
      }

      return {
        summary,
        recommendations,
        dayPlan,
        payload: buildPayload(summary, recommendations, planningContext, session),
        contextPatch: buildContextPatch(label),
      };
    }

    logChatPlaceListMode("must_visit_place_list");
    logChatRenderPlaceList(0, "must_visit_place_list");

    const attempts: SearchAttempt[] = buildDestinationPlaceSearchAttempts({
      profile: searchProfile,
      weatherAwareAttempts: geocodeSucceeded
        ? buildWeatherAwareSearchAttempts(weatherSearchLabel, weather, context)
        : [],
      templateAttempts: geocodeSucceeded ? templateNameSearchAttempts(label) : [],
      textOnlyFallback: buildDestinationTextSearchAttempts(label),
    });

    let places = await searchDestinationPlaces({
      label,
      lat,
      lng,
      locale,
      searchPlaces,
      weather,
      context,
      attempts,
      caller: geocodeSucceeded
        ? "chat.destinationMustVisit"
        : "chat.destinationMustVisit.textOnly",
      excludePlaceIds,
      userText,
      profile: searchProfile,
      searchContext,
      sessionId: poolSessionId,
      countryCode: entity.country ?? undefined,
    });

    places = rankLandmarkCompanionPlaces(places, searchProfile);

    const filteredPlaces = filterAlreadyRecommendedPlaces(places, {
      rejectedNames: rejectedPlaceNames,
      blockedCoreNames: searchProfile.parentLandmark
        ? [searchProfile.parentLandmark]
        : undefined,
    });

    let recommendations: RoamieRecommendationItem[];
    if (filteredPlaces.length > 0) {
      recommendations = placesToRecommendations(filteredPlaces, lat, lng, context, locale);
      logChatPlacesResponse(recommendations.length, "places_api");
    } else {
      logChatPlacesError("places_empty", "all_attempts");
      const fallback = buildNamedFallbackRecommendations(label);
      recommendations = filterAlreadyRecommendedPlaces(fallback, {
        rejectedNames: rejectedPlaceNames,
      });
      if (recommendations.length > 0) {
        logChatPlacesResponse(recommendations.length, "named_fallback");
      } else {
        safeChatLog(logChatRenderBlocked,"no_real_places");
      }
    }

    const summary = buildSummaryText(label, intro, recommendations, planningContext, searchProfile);
    if (recommendations.length > 0) {
      logChatPlaceCardsRendered(recommendations.length);
      logChatRenderPlaceList(recommendations.length, "must_visit_place_list");
    } else {
      safeChatLog(logChatRenderBlocked,"no_real_places");
    }

    return {
      summary,
      recommendations,
      payload: buildPayload(summary, recommendations, context, session),
      contextPatch: buildContextPatch(label),
    };
  } finally {
    endPlacesFlow(flow);
  }
}

function resolvePayloadMoodTag(
  context: CanonicalTravelContext,
  session?: ChatPlanningSession,
): string {
  if (session) {
    const tag = resolveRecommendationStyleTag(session, context);
    if (tag) return tag;
  }
  const style = resolveTripStyleFromContext(context);
  if (style) return tripStyleDisplayTag(style);
  return context.mood ?? "";
}

function buildPayload(
  summary: string,
  recommendations: RoamieRecommendationItem[],
  context: CanonicalTravelContext,
  session?: ChatPlanningSession,
): RoamiePayloadV2 {
  return {
    version: 2,
    title: "必去推薦",
    summary,
    moodTag: resolvePayloadMoodTag(context, session),
    recommendations,
    itinerary: [],
    generatedAt: new Date().toISOString(),
  };
}

function buildContextPatch(destination: string): Partial<CanonicalTravelContext> {
  return {
    destination,
    mustVisitGenerated: true,
    tripPurpose: "must_visit_places",
    conversationState: "itinerary_draft",
    planningStage: "recommendations_generated",
  };
}

function resolveMorePlacesCategoryPreference(
  context: CanonicalTravelContext,
  activeChatIntent?: string | null,
  activeCategoryIntent?: string | null,
): string {
  const category = activeCategoryIntent ?? activeChatIntent;
  if (category === "cafe") return "cafe";
  if (category === "restaurant") return "restaurant";
  if (category === "shopping") return "shopping";
  if (category === "night_market") return "night_market";
  if (category === "bar") return "bar";
  if (category === "indoor") return "indoor";
  if (context.setting === "室內") return "indoor";
  if (/咖啡/.test(context.mood ?? "") || context.interests?.includes("咖啡")) return "cafe";
  if (/美食|餐廳|吃/.test(context.mood ?? "") || context.interests?.includes("美食")) {
    return "restaurant";
  }
  if (/購物|商圈|逛街|百貨|outlet/i.test(context.mood ?? "") || context.interests?.includes("shopping")) {
    return "shopping";
  }
  return "attraction";
}

function buildMorePlacesPrimaryAttempts(destination: string, category: string): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  if (category === "cafe") {
    return [{ query: `${label} 咖啡廳`, mode: "text", includedTypes: ["cafe", "coffee_shop"] }];
  }
  if (category === "restaurant") {
    return [{ query: `${label} 美食`, mode: "text", includedTypes: ["restaurant"] }];
  }
  if (category === "shopping") {
    return [
      {
        query: `${label} shopping street`,
        mode: "text",
        includedTypes: ["shopping_mall", "department_store", "store"],
      },
      {
        query: `${label} 商店街`,
        mode: "text",
        includedTypes: ["shopping_mall", "department_store", "store"],
      },
      {
        query: `${label} outlet`,
        mode: "text",
        includedTypes: ["shopping_mall", "department_store"],
      },
      {
        query: `${label} 百貨`,
        mode: "text",
        includedTypes: ["department_store", "shopping_mall"],
      },
    ];
  }
  if (category === "indoor") {
    return [
      {
        query: `${label} 室內景點`,
        mode: "text",
        includedTypes: ["museum", "shopping_mall", "art_gallery"],
      },
    ];
  }
  return [{ query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction"] }];
}

function buildMorePlacesFallbackQueries(destination: string): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const en = EN_CITY_NAMES[label] ?? label;
  return [
    { query: `${label} 景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    {
      query: `${label} 室內景點`,
      mode: "text",
      includedTypes: ["museum", "shopping_mall", "art_gallery"],
    },
    { query: `${label} 美食`, mode: "text", includedTypes: ["restaurant"] },
    { query: `${label} 咖啡廳`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${en} attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${en} hidden gems`, mode: "text", includedTypes: ["tourist_attraction"] },
  ];
}

export async function buildMoreDestinationRecommendations(params: {
  destination: string;
  userText: string;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn: FetchWeatherFn;
  excludePlaceIds?: string[];
  rejectedPlaceNames?: string[];
  activeChatIntent?: string | null;
  activeCategoryIntent?: string | null;
  session?: ChatPlanningSession;
  usedPlaces?: TripUsedPlaces;
  recommendationSession?: ConversationRecommendationSession | null;
}): Promise<{
  summary: string;
  recommendations: RoamieRecommendationItem[];
  payload: RoamiePayloadV2;
  contextPatch: Partial<CanonicalTravelContext>;
  newCount: number;
  fetchCount: number;
  recommendationSessionPatch?: ConversationRecommendationSession;
}> {
  const {
    destination,
    userText,
    context,
    locale,
    searchPlaces,
    geocodeFn,
    fetchWeatherFn,
    excludePlaceIds = [],
    rejectedPlaceNames = [],
    activeChatIntent,
    activeCategoryIntent,
    session,
    usedPlaces,
    recommendationSession: incomingRecSession,
  } = params;
  const label = normalizeDestinationLabel(destination);
  const activeRecSession =
    incomingRecSession ?? session?.recommendationSession ?? null;
  const category = resolveMorePlacesCategoryPreference(
    context,
    activeChatIntent,
    activeCategoryIntent ??
      activeRecSession?.topic ??
      session?.activeCategoryIntent ??
      session?.recommendationSession?.topic,
  );
  let shoppingSessionPatch: ConversationRecommendationSession | undefined;
  const tripStyle = resolveTripStyleFromContext(context, session);
  const styleFollowUp = Boolean(
    usedPlaces && tripStyle && (session?.usedPlaceIds?.length || context.mustVisitGenerated),
  );

  logChatMorePlacesIntent(userText);
  logChatMorePlacesContext({
    destination: label,
    category,
    tripPurpose: "more_place_recommendations",
  });
  logChatMorePlacesExcludeIds(excludePlaceIds.length);

  const flow = beginPlacesFlow("chat_more_place_recommendations");
  try {
    const geocoded = await geocodeDestinationWithFallback({
      destination: label,
      locale,
      geocodeFn,
    });
    const searchProfile = classifyDestinationForPlaceSearch(label, geocoded);

    let lat: number;
    let lng: number;
    let geocodeSucceeded = false;
    let textOnlyDestinationSearch = false;

    if (geocoded?.lat != null && geocoded?.lng != null) {
      lat = geocoded.lat;
      lng = geocoded.lng;
      geocodeSucceeded = true;
      logChatDestinationResolved(label, lat, lng, "geocode");
    } else {
      logDestinationGeocodeFallback(label, "approx_center");
      const approx = resolveDestinationApproxCenter(label);
      if (approx) {
        lat = approx.lat;
        lng = approx.lng;
        logChatDestinationResolved(label, lat, lng, "approx_center");
      } else {
        lat = 0;
        lng = 0;
        textOnlyDestinationSearch = true;
        logChatDestinationResolved(label, lat, lng, "text_only");
      }
    }

    const entity = resolveDestinationEntity(label);
    const searchContext: ChatPlaceSearchContext = {
      searchMode: "destination",
      destinationName: label,
      destinationLatLng: textOnlyDestinationSearch ? null : { lat, lng },
      textOnlyDestinationSearch,
      destinationCountry: entity.country,
      destinationCity: entity.type === "city" ? label : undefined,
    };

    let weather: WeatherSummary | null = null;
    if (geocodeSucceeded) {
      try {
        const raw = await fetchWeatherFn({ data: { lat, lng, locale } });
        weather = unwrapWeatherResult(raw);
      } catch (error) {
        logChatPlacesError(error, "weather");
      }
    }

    const scene = resolveWeatherScene(weather, label);
    const intro =
      searchProfile.kind === "landmark"
        ? buildLandmarkCompanionIntro(searchProfile, scene, weather?.available !== false)
        : buildWeatherAwarePlaceIntro(label, scene, weather?.available !== false);

    const caller = geocodeSucceeded
      ? "chat.morePlaceRecommendations"
      : "chat.morePlaceRecommendations.textOnly";

    const searchParams = {
      label,
      lat,
      lng,
      locale,
      searchPlaces,
      weather,
      context: { ...context, destination: label, tripPurpose: "more_place_recommendations" as const },
      caller,
      excludePlaceIds,
      userText,
      profile: searchProfile,
      searchContext,
      sessionId:
        session?.planningSessionId?.trim() ||
        session?.conversationId?.trim() ||
        activeRecSession?.sessionId ||
        "chat_default",
      countryCode: entity.country ?? undefined,
    };

    const excludedCanonicalKeys = new Set(
      activeRecSession?.returnedCanonicalKeys ?? [],
    );
    for (const id of excludePlaceIds) {
      if (id) excludedCanonicalKeys.add(`id:${id}`);
    }

    let places: PlaceResult[] = [];
    let filtered: PlaceResult[] = [];
    let fetchCount = 0;
    let usedCostCachePool = false;

    // Layer 2 / Session: filter Candidate Pool — 0 Places calls for follow-up topics
    {
      const sessionId =
        session?.planningSessionId ??
        session?.conversationId ??
        activeRecSession?.sessionId ??
        "chat_default";
      ensureSessionDestination(sessionId, label);
      const sessionPool = readSessionCandidatePool({
        sessionId,
        destination: label,
      });
      let poolPlaces = sessionPool?.places ?? [];
      if (!poolPlaces.length) {
        const hit = readCandidatePoolCache(label, entity.country ?? undefined);
        if (hit?.places.length) {
          bindSessionCandidatePool({
            sessionId,
            destination: label,
            places: hit.places,
            poolResult: hit.poolResult,
          });
          poolPlaces = hit.places;
        }
      }
      if (poolPlaces.length) {
        const cuisine = extractCuisineKeywordFromText(userText);
        const fromPool = filterCandidatePoolPlaces({
          places: poolPlaces,
          category,
          cuisineKeyword: cuisine,
          excludePlaceIds,
          limit: RECOMMENDATION_COUNT * 3,
        });
        let next = filterAlreadyRecommendedPlaces(fromPool, {
          rejectedNames: rejectedPlaceNames,
          blockedCoreNames: [
            ...(usedPlaces?.usedPlaceNames ?? []),
            ...(searchProfile.parentLandmark ? [searchProfile.parentLandmark] : []),
          ],
        });
        if (usedPlaces) {
          next = excludeUsedPlacesFromFollowUp(next, usedPlaces);
        }
        if (next.length >= Math.min(2, RECOMMENDATION_COUNT)) {
          places = next;
          filtered = next.slice(0, RECOMMENDATION_COUNT);
          fetchCount = 0;
          usedCostCachePool = true;
          logPlacesSearchSkipped({
            reason: "candidate_pool_filter",
            destination: label,
            category: category ?? "",
            cuisine: cuisine ?? "",
            count: filtered.length,
          });
        }
      }
    }

    if (usedCostCachePool) {
      logChatMorePlacesFetchCount(fetchCount);
    } else if (category === "shopping") {
      // Coverage-aware follow-up: 1 query × distinct groups, ≤3 network calls.
      // Place-id dedupe only — do not exclude whole shopping types.
      const shownFromSession = [
        ...(activeRecSession?.pool ?? []),
        ...(activeRecSession?.shoppingCandidateReserve ?? []),
      ];
      let scope: ShoppingSearchScope = resolveShoppingSearchScope({
        destination: label,
        countryHint: entity.country,
        shownPlaces: shownFromSession,
        existingScope:
          activeRecSession?.topic === "shopping"
            ? {
                primaryDestination: activeRecSession.destination,
                activeSearchCity: activeRecSession.activeSearchCity,
                searchRegionLabel: activeRecSession.searchRegionLabel,
                searchCentroid: activeRecSession.searchCentroid,
                searchRadius: activeRecSession.searchRadius,
                geoClusterIndex: activeRecSession.geoClusterIndex,
                geoClusterLabel: activeRecSession.geoClusterLabel,
                country: entity.country,
              }
            : null,
      });

      const clusterPick = preferUnderrepresentedShoppingCluster(
        scope,
        shownFromSession,
      );
      scope = clusterPick.scope;

      const subtype = detectShoppingSubtype(userText);
      let coverage = buildShoppingCoverageState({
        destination: label,
        places: shownFromSession,
        coveredClusters: clusterPick.coveredClusterLabels,
        usedQueryGroups: activeRecSession?.shoppingCoverage?.usedQueryGroups,
        destinationCountryCode: entity.country,
        existing: activeRecSession?.shoppingCoverage,
      });
      logShoppingCoverageState(
        coverage,
        activeRecSession?.shoppingCandidateReserve?.length ?? 0,
      );

      const baseSession: ConversationRecommendationSession =
        activeRecSession && activeRecSession.topic === "shopping"
          ? {
              ...activeRecSession,
              activeSearchCity: scope.activeSearchCity,
              searchRegionLabel: scope.searchRegionLabel,
              searchCentroid: scope.searchCentroid,
              searchRadius: scope.searchRadius,
              geoClusterIndex: scope.geoClusterIndex,
              geoClusterLabel: scope.geoClusterLabel,
              shoppingCoverage: coverage,
            }
          : {
              sessionId: `rec_shop_${Date.now().toString(36)}`,
              destination: label,
              topic: "shopping",
              returnedPlaceIds: [...excludePlaceIds],
              returnedCanonicalKeys: [...excludedCanonicalKeys],
              pool: [],
              cursor: 0,
              usedQueries: [],
              nextQueryCursor: 0,
              recommendationPage: 0,
              exhausted: false,
              activeSearchCity: scope.activeSearchCity,
              searchRegionLabel: scope.searchRegionLabel,
              searchCentroid: scope.searchCentroid,
              searchRadius: scope.searchRadius,
              geoClusterIndex: scope.geoClusterIndex,
              geoClusterLabel: scope.geoClusterLabel,
              shoppingCandidateReserve: [],
              shoppingCoverage: coverage,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };

      const followupRequestId = makeShoppingFollowupRequestId(baseSession.sessionId);
      beginPlacesGenerationSession(followupRequestId);
      logShoppingSessionState(baseSession);
      logShoppingFollowupRequest({
        requestId: followupRequestId,
        shoppingSessionId: baseSession.sessionId,
        destination: label,
        seenPlaceCount: baseSession.returnedPlaceIds.length,
        remainingGroupCount: remainingShoppingGroups(baseSession),
      });

      let workingSession = baseSession;
      const budget = createShoppingFollowUpBudget();
      logShoppingFollowupBudget(budget);
      const allQueriesUsed: string[] = [];
      const groupsUsed: ShoppingQueryGroupId[] = [];
      const accepted: PlaceResult[] = [];
      const seenIds = new Set(excludePlaceIds);
      const brandSeen = new Set(workingSession.returnedBrandKeys ?? []);
      let followupStatus: FollowUpSearchStatus = "success";
      let totalRaw = 0;
      let totalDup = 0;
      let totalWrongCat = 0;
      let totalSameCanonical = 0;
      const shoppingSearchContext: ChatPlaceSearchContext = {
        ...searchContext,
        destinationName: scope.activeSearchCity,
        destinationCity: scope.activeSearchCity,
        destinationLatLng: scope.searchCentroid,
      };

      const { calls, plan } = buildShoppingFollowupCalls({
        destination: label,
        activeSearchCity: scope.activeSearchCity,
        coverage,
        subtype,
        radius: scope.searchRadius,
        skipQueries: [...(workingSession.usedQueries ?? [])],
        maxCalls: budget.maxNetworkCalls,
      });
      logShoppingFollowupGroupPlan(plan);

      logShoppingFollowupSearchStart({
        destination: label,
        activeSearchCity: scope.activeSearchCity,
        queries: calls.map((c) => c.query),
        excludedPlaceIds: excludePlaceIds,
        excludedCanonicalKeys: [...excludedCanonicalKeys],
        lat: scope.searchCentroid.lat,
        lng: scope.searchCentroid.lng,
        radius: scope.searchRadius,
      });

      for (let callIndex = 0; callIndex < calls.length; callIndex++) {
        const call = calls[callIndex]!;
        if (accepted.length >= budget.targetNewResults) {
          logShoppingFollowupEarlyStop({
            reason: "target_reached",
            newCount: accepted.length,
          });
          break;
        }
        // Enough new places (≥3) — stop; keep searching while < MIN to fill cards.
        if (accepted.length >= 3 && callIndex > 0) {
          logShoppingFollowupEarlyStop({
            reason: "enough_new_results",
            newCount: accepted.length,
          });
          break;
        }
        if (shoppingBudgetExhausted(budget) || isPlacesRateLimited()) {
          if (isPlacesRateLimited()) {
            followupStatus = "rate_limited";
            logShoppingFollowupRateLimited({
              requestId: followupRequestId,
              usedNetworkCalls: budget.usedNetworkCalls,
              partialNewCount: accepted.length,
            });
          } else {
            followupStatus = accepted.length > 0 ? "partial" : "exhausted";
          }
          break;
        }

        if (callIndex > 0) {
          const prev = calls[callIndex - 1]!;
          logShoppingFollowupGroupSwitch({
            from: prev.group.id,
            to: call.group.id,
            reason:
              accepted.length === 0
                ? "no_results"
                : "insufficient_new_results",
          });
        }

        const {
          places: roundCategoryPlaces,
          rawPlaces,
          perQuery,
          rateLimited,
          timedOut,
        } = await searchShoppingCategoryAttempts({
          city: scope.activeSearchCity,
          lat: scope.searchCentroid.lat,
          lng: scope.searchCentroid.lng,
          radius: scope.searchRadius,
          locale,
          searchPlaces,
          attempts: [call.attempt],
          userText,
          searchContext: shoppingSearchContext,
          excludePlaceIds,
          budget,
          maxPerQuery: SHOPPING_RESULTS_PER_QUERY,
        });
        places = places.concat(rawPlaces);
        fetchCount += rawPlaces.length;
        allQueriesUsed.push(call.query);
        groupsUsed.push(call.group.id);
        totalRaw += rawPlaces.length;

        let roundFiltered = filterExcludedPlaceIds(roundCategoryPlaces, excludePlaceIds);
        roundFiltered = filterAlreadyRecommendedPlaces(roundFiltered, {
          rejectedNames: rejectedPlaceNames,
          blockedCoreNames: [
            ...(usedPlaces?.usedPlaceNames ?? []),
            ...(searchProfile.parentLandmark ? [searchProfile.parentLandmark] : []),
          ],
        });
        if (usedPlaces) {
          roundFiltered = excludeUsedPlacesFromFollowUp(roundFiltered, usedPlaces);
        }

        let duplicateRejected = 0;
        let invalidRejected = 0;
        let sameCanonicalRejected = 0;
        const afterDedupe: PlaceResult[] = [];
        for (const place of roundFiltered) {
          const id = (place.id ?? "").trim();
          const key = shoppingCanonicalKey({
            name: place.name,
            googlePlaceId: place.id,
            placeId: place.id,
          });
          if (id && seenIds.has(id)) {
            duplicateRejected += 1;
            continue;
          }
          if (key && excludedCanonicalKeys.has(key)) {
            sameCanonicalRejected += 1;
            continue;
          }
          if (!id && !key) {
            invalidRejected += 1;
            continue;
          }
          afterDedupe.push(place);
        }

        // Soft brand de-priority only — never hard-exclude same type / area.
        const preferred = afterDedupe.filter((p) => {
          const brand = shoppingBrandKey({ name: p.name });
          return !brand || !brandSeen.has(brand);
        });
        const deprioritized = afterDedupe.filter((p) => {
          const brand = shoppingBrandKey({ name: p.name });
          return Boolean(brand && brandSeen.has(brand));
        });
        const rankedForAccept = [...preferred, ...deprioritized];
        const categoryAccepted = filterPlacesByShoppingGuard(rankedForAccept, userText);
        const categoryRejected = Math.max(
          0,
          afterDedupe.length - categoryAccepted.length,
        );
        totalDup += duplicateRejected;
        totalSameCanonical += sameCanonicalRejected;
        totalWrongCat += categoryRejected;

        const beforeAccept = accepted.length;
        for (const place of categoryAccepted) {
          const id = (place.id ?? "").trim();
          const key = shoppingCanonicalKey({
            name: place.name,
            googlePlaceId: place.id,
            placeId: place.id,
          });
          if (id && seenIds.has(id)) continue;
          if (key && excludedCanonicalKeys.has(key)) continue;
          if (id) seenIds.add(id);
          if (key) excludedCanonicalKeys.add(key);
          const brand = shoppingBrandKey({ name: place.name });
          if (brand) brandSeen.add(brand);
          accepted.push(place);
          if (accepted.length >= budget.targetNewResults) break;
        }
        const newAccepted = accepted.length - beforeAccept;

        logShoppingFollowupQueryAttempt({
          callIndex: callIndex + 1,
          group: call.group.id,
          query: call.query,
          rawCount: rawPlaces.length,
          acceptedCount: categoryAccepted.length,
          newCount: newAccepted,
        });
        logShoppingQueryResult({
          query: call.query,
          raw: rawPlaces.length,
          categoryAccepted: categoryAccepted.length,
          categoryRejected,
          duplicateRejected: duplicateRejected + sameCanonicalRejected,
          invalidRejected,
          newAccepted,
          networkCall: budget.usedNetworkCalls,
        });
        for (const diag of perQuery) {
          logShoppingQueryDiag({
            query: diag.query,
            city: scope.activeSearchCity,
            lat: scope.searchCentroid.lat,
            lng: scope.searchCentroid.lng,
            radius: scope.searchRadius,
            requestStatus: diag.requestStatus,
            rawCount: diag.rawCount,
            acceptedCount: categoryAccepted.length,
            rejectedCategory: categoryRejected,
            rejectedDuplicate: duplicateRejected + sameCanonicalRejected,
            rejectedInvalid: invalidRejected,
          });
        }

        coverage = buildShoppingCoverageState({
          destination: label,
          places: accepted.map((p) => ({
            name: p.name,
            googlePlaceId: p.id,
            placeId: p.id,
            types: p.types,
            primaryType: p.primaryType,
            address: p.address,
          })),
          coveredClusters: coverage.coveredClusters,
          usedQueryGroups: groupsUsed,
          destinationCountryCode: entity.country,
          existing: coverage,
        });

        workingSession = patchShoppingRecommendationSession(workingSession, {
          usedQueries: [call.query],
          nextQueryCursor: groupsUsed.length,
          recommendationPage: (workingSession.recommendationPage ?? 0) + 1,
          activeSearchCity: scope.activeSearchCity,
          searchRegionLabel: scope.searchRegionLabel,
          searchCentroid: scope.searchCentroid,
          searchRadius: scope.searchRadius,
          geoClusterIndex: scope.geoClusterIndex,
          geoClusterLabel: scope.geoClusterLabel,
          returnedBrandKeys: [...brandSeen],
          shoppingCoverage: coverage,
          exhausted: false,
        });

        if (rateLimited) {
          followupStatus = "rate_limited";
          logShoppingFollowupRateLimited({
            requestId: followupRequestId,
            usedNetworkCalls: budget.usedNetworkCalls,
            partialNewCount: accepted.length,
          });
          break;
        }
        if (timedOut) {
          followupStatus = "timeout";
          break;
        }

        // Cross-group: continue while below MIN; stop once we have a solid batch.
        if (accepted.length >= budget.targetNewResults) {
          followupStatus = "success";
          break;
        }
        if (
          accepted.length >= SHOPPING_FOLLOWUP_MIN_NEW &&
          callIndex + 1 >= calls.length
        ) {
          followupStatus = "partial";
          break;
        }
      }

      if (!calls.length && accepted.length === 0) {
        followupStatus = "exhausted";
        logShoppingQuerySkipped({
          query: "followup_plan",
          reason: "no_available_groups",
        });
      }

      logShoppingFollowupFilterSummary({
        raw: totalRaw,
        rejectedDuplicate: totalDup,
        rejectedWrongCategory: totalWrongCat,
        rejectedSameCanonical: totalSameCanonical,
        acceptedNew: accepted.length,
      });

      const trulyExhausted =
        accepted.length === 0 &&
        remainingShoppingGroups(workingSession) === 0 &&
        shoppingScopeExhausted(scope);

      if (accepted.length === 0) {
        followupStatus = trulyExhausted ? "exhausted" : "exhausted";
      } else if (accepted.length >= budget.targetNewResults) {
        followupStatus = "success";
      } else {
        followupStatus = "partial";
      }

      filtered = accepted;
      shoppingSessionPatch = patchShoppingRecommendationSession(workingSession, {
        exhausted: trulyExhausted,
        activeSearchCity: scope.activeSearchCity,
        searchRegionLabel: scope.searchRegionLabel,
        searchCentroid: scope.searchCentroid,
        searchRadius: scope.searchRadius,
        geoClusterIndex: scope.geoClusterIndex,
        geoClusterLabel: scope.geoClusterLabel,
        returnedBrandKeys: [...brandSeen],
        shoppingCoverage: coverage,
      });
      logShoppingFollowupBudget(budget);
      logShoppingFollowupFinal({
        requestId: followupRequestId,
        newCount: filtered.length,
        usedNetworkCalls: budget.usedNetworkCalls,
        activeSearchCity: scope.activeSearchCity,
        queriesUsed: allQueriesUsed,
        remainingQueries: remainingShoppingGroups(shoppingSessionPatch),
        remainingGroupCount: remainingShoppingGroups(shoppingSessionPatch),
        exhausted: trulyExhausted,
        status: followupStatus,
        reserveUsed: 0,
        groupsUsed,
      });
      logChatMorePlacesFetchCount(fetchCount);
    } else {
      const primaryAttempts = styleFollowUp && tripStyle
        ? buildTripStyleSupplementAttempts(label, tripStyle, 0)
        : buildMorePlacesPrimaryAttempts(label, category);
      places = await searchDestinationPlaces({ ...searchParams, attempts: primaryAttempts });
      places = filterExcludedPlaceIds(places, excludePlaceIds);
      filtered = filterAlreadyRecommendedPlaces(places, {
        rejectedNames: rejectedPlaceNames,
        blockedCoreNames: [
          ...(usedPlaces?.usedPlaceNames ?? []),
          ...(searchProfile.parentLandmark ? [searchProfile.parentLandmark] : []),
        ],
      });
      if (usedPlaces) {
        filtered = excludeUsedPlacesFromFollowUp(filtered, usedPlaces);
      }
      fetchCount = places.length;
      logChatMorePlacesFetchCount(places.length);

      if (filtered.length < CHAT_DESTINATION_MIN_COUNT) {
        const fallbackAttempts = styleFollowUp && tripStyle
          ? buildTripStyleSupplementAttempts(label, tripStyle, 1).filter(
              (attempt) => !primaryAttempts.some((a) => a.query === attempt.query),
            )
          : buildMorePlacesFallbackQueries(label).filter(
              (attempt) => !primaryAttempts.some((a) => a.query === attempt.query),
            );
        for (const attempt of fallbackAttempts) {
          if (filtered.length >= CHAT_DESTINATION_MIN_COUNT) break;
          const more = await searchDestinationPlaces({ ...searchParams, attempts: [attempt] });
          let moreFiltered = filterExcludedPlaceIds(more, excludePlaceIds);
          moreFiltered = filterAlreadyRecommendedPlaces(moreFiltered, {
            rejectedNames: rejectedPlaceNames,
            blockedCoreNames: [
              ...(usedPlaces?.usedPlaceNames ?? []),
              ...(searchProfile.parentLandmark ? [searchProfile.parentLandmark] : []),
            ],
          });
          if (usedPlaces) {
            moreFiltered = excludeUsedPlacesFromFollowUp(moreFiltered, usedPlaces);
          }
          const seen = new Set(filtered.map((p) => p.id));
          for (const place of moreFiltered) {
            if (!seen.has(place.id)) {
              seen.add(place.id);
              filtered.push(place);
            }
          }
          fetchCount += more.length;
        }
      }
    }

    if (category !== "shopping") {
      filtered = rankLandmarkCompanionPlaces(filtered, searchProfile).slice(
        0,
        RECOMMENDATION_COUNT,
      );
    }
    // Shopping: keep full accepted list for display+reserve; do not slice away extras.
    logChatMorePlacesNewCount(filtered.length);
    logAiFollowupNewResults(filtered.length);

    const rankingLat =
      category === "shopping" && shoppingSessionPatch?.searchCentroid
        ? shoppingSessionPatch.searchCentroid.lat
        : lat;
    const rankingLng =
      category === "shopping" && shoppingSessionPatch?.searchCentroid
        ? shoppingSessionPatch.searchCentroid.lng
        : lng;

    let recommendations: RoamieRecommendationItem[];
    if (filtered.length > 0) {
      recommendations = placesToRecommendations(
        filtered,
        rankingLat,
        rankingLng,
        context,
        locale,
        category,
      );
      if (category === "shopping") {
        recommendations = filterRecommendationsForCategoryRender(
          recommendations,
          "shopping",
          userText,
        );
        const displayRecs = recommendations.slice(0, SHOPPING_DISPLAY_LIMIT);
        const extraReserve = recommendations.slice(SHOPPING_DISPLAY_LIMIT);
        logShoppingFollowupNewCandidates({
          rawCount: places.length,
          acceptedCount: recommendations.length,
          newDisplayCount: displayRecs.length,
          newReserveCount: extraReserve.length,
        });
        logChatPlacesResponse(displayRecs.length, "places_api");
        logChatPlaceCardsRendered(displayRecs.length);

        if (shoppingSessionPatch) {
          const newIds = displayRecs
            .map((r) => r.googlePlaceId ?? "")
            .filter(Boolean);
          const newKeys = displayRecs.map(shoppingCanonicalKey).filter(Boolean);
          const newBrands = displayRecs
            .map((r) => shoppingBrandKey({ name: r.name, placeName: r.placeName }))
            .filter(Boolean);
          const priorReserve = shoppingSessionPatch.shoppingCandidateReserve ?? [];
          const reserveIds = new Set(
            priorReserve
              .map((r) => (r.googlePlaceId ?? "").trim())
              .filter(Boolean),
          );
          for (const id of newIds) reserveIds.add(id);
          const mergedReserve = [
            ...priorReserve,
            ...extraReserve.filter((r) => {
              const id = (r.googlePlaceId ?? "").trim();
              if (!id || reserveIds.has(id)) return false;
              reserveIds.add(id);
              return true;
            }),
          ];
          shoppingSessionPatch = patchShoppingRecommendationSession(shoppingSessionPatch, {
            returnedPlaceIds: [
              ...(shoppingSessionPatch.returnedPlaceIds ?? []),
              ...newIds,
            ],
            returnedCanonicalKeys: [
              ...(shoppingSessionPatch.returnedCanonicalKeys ?? []),
              ...newKeys,
            ],
            returnedBrandKeys: [
              ...(shoppingSessionPatch.returnedBrandKeys ?? []),
              ...newBrands,
            ],
            pool: [...(shoppingSessionPatch.pool ?? []), ...recommendations],
            cursor:
              (shoppingSessionPatch.cursor ?? 0) + displayRecs.length,
            shoppingCandidateReserve: mergedReserve,
            exhausted: false,
            exhaustedAt: null,
          });
        }
        recommendations = displayRecs;
      } else {
        logChatPlacesResponse(recommendations.length, "places_api");
        logChatPlaceCardsRendered(recommendations.length);
      }
    } else {
      recommendations = [];
      safeChatLog(logChatRenderBlocked, "no_new_places");
      if (category === "shopping" && shoppingSessionPatch) {
        const noGroupsLeft = remainingShoppingGroups(shoppingSessionPatch) === 0;
        const noReserve =
          (shoppingSessionPatch.shoppingCandidateReserve?.length ?? 0) === 0;
        if (noGroupsLeft && noReserve) {
          shoppingSessionPatch = patchShoppingRecommendationSession(shoppingSessionPatch, {
            exhausted: true,
            exhaustedAt: new Date().toISOString(),
          });
        }
        logShoppingFollowupNewCandidates({
          rawCount: places.length,
          acceptedCount: 0,
          newDisplayCount: 0,
          newReserveCount: 0,
        });
      }
    }

    const moreContext = {
      ...context,
      destination: label,
      tripPurpose: "more_place_recommendations" as const,
    };
    const summary =
      recommendations.length > 0
        ? category === "shopping" || category === "cafe" || category === "restaurant"
          ? buildRefreshRecommendationSummary(recommendations, category)
          : buildSummaryText(label, intro, recommendations, moreContext, searchProfile)
        : intro;

    return {
      summary,
      recommendations,
      payload: {
        version: 2,
        title: "更多推薦",
        summary,
        moodTag: resolvePayloadMoodTag(moreContext, session),
        recommendations,
        itinerary: [],
        generatedAt: new Date().toISOString(),
      },
      contextPatch: {
        destination: label,
        tripPurpose: "more_place_recommendations",
        conversationState: "itinerary_draft",
        planningStage: "recommendations_generated",
      },
      newCount: recommendations.length,
      fetchCount,
      recommendationSessionPatch: shoppingSessionPatch,
    };
  } finally {
    endPlacesFlow(flow);
  }
}

export function resolveDestinationForPlaceFetch(
  userText: string,
  context: CanonicalTravelContext,
): string | undefined {
  if (!shouldFetchDestinationPlaces(userText, context)) return undefined;
  return resolveMustVisitDestination(context, userText);
}
