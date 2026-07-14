import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { WeatherSummary } from "@/lib/weather-types";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { PlaceSearchFn, SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import {
  buildDestinationTextSearchAttempts,
} from "@/lib/ai/destination-geocode";
import { buildDestinationPlaceSearchAttempts } from "@/lib/ai/landmark-place-strategy";
import type { ChatPlaceSearchContext } from "@/lib/ai/chat-place-search-context";
import {
  CHAT_DAY_PLAN_MIN_PER_DAY,
  computeDayPlanTargetCount,
  hasConfirmedTripDays,
  resolveTripStyleFromContext,
  buildTripStyleSearchAttempts,
  buildTripStyleSupplementAttempts,
  buildDayPlanSummaryFromBuckets,
  logAiStyleDayPlanResult,
  logAiStylePlanApplySession,
  logAiStylePlanGenerateStart,
  logAiStylePlanRenderReady,
  logAiStylePlacesResult,
  logAiStyleSearchAttempts,
  type DayPlanBucket,
  type TripStyleKey,
} from "@/lib/ai/ai-trip-style";
import {
  buildTripPlaceScoringContext,
  filterAndRankTripPlacesForPlanning,
} from "@/lib/ai/trip-place-scoring";
import { classifyWeatherScene } from "@/lib/weather-scene";
import { userProfileForReasonFrom } from "@/lib/build-place-recommendation-reason";
import { getPreferences } from "@/lib/preferences-storage";
import { getUserProfile } from "@/lib/profile-storage";
import {
  buildAttractionSupplementAttempts,
  buildBalancedSlowDayPlans,
  buildCategorySearchAttempts,
  buildComposedDayPlanSummary,
  buildComposedDayPlans,
  buildOpenHoursFallbackAttempts,
  CHAT_DAY_PLAN_SLOW_MIN_PER_DAY,
  composedDayPlansToBuckets,
  countScenicPlaces,
  ensureRenderableComposedPlans,
  flattenComposedDayPlanPlaces,
  kindsForStyle,
  logAiDayPlanFinalValidate,
  logAiDayPlanRebuild,
  logAiGenerateAttractions,
  logAiGenerateCafes,
  logAiGenerateRestaurants,
  logAiPlaceSearchFallback,
  logAiPlaceSearchRetry,
  minItemsPerDayForStyle,
  minItemsPerDayForTrip,
  validateComposedDayPlans,
  validateGeneratedDays,
  isItineraryRenderable,
  preferBetterComposedPlans,
  shouldFreezePlannerResult,
  logAiRenderBlockedIncompleteDay,
  computeDayPlanPlaceNeed,
  classifyPlanPlaceKind,
  composedPlansToAiDayPlan,
  dayPlanToRecommendations,
  ensureAllDayPlansExist,
  enforceStandardDaySlotPlans,
  expectedItineraryItemCount,
  plannerTotalPlaces,
  rebuildIncompleteDays,
  resolveEntryLabel,
  type AiDayPlan,
  type ComposedDayPlan,
  type PlanPlaceKind,
} from "@/lib/ai/ai-day-plan-source";
import {
  CLASSIC_LANDMARK_MIN_ATTRACTIONS_PER_DAY,
  validateClassicLandmarkItinerary,
} from "@/lib/ai/ai-classic-landmark-rules";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import {
  normalizePlanningPlaces,
  logAiResolvedPlacesCount,
  logPlannerCleared,
  logPlannerFrozen,
  logPlannerOverwriteBlocked,
  logPlannerResult,
  logPlannerStart,
} from "@/lib/ai/normalize-planning-places";
import {
  beginPlannerSession,
  beginPipelineStage,
  beginPlannerRun,
  buildCandidatePoolFingerprint,
  buildPlannerRunKey,
  finishPipelineStage,
  finishPlannerRun,
  finishPlannerSession,
} from "@/lib/ai/planner-session-guard";
import {
  computeSlotDeficitFromPools,
  filterRealPlanningPlacesWithDiagnostics,
  hasSlotDeficit,
  logCategoryPoolCounts,
  logItineraryPipelineSummary,
  logItinerarySlotDeficit,
  logPlaceNormalizeDropSummary,
  type SlotDeficitCounts,
} from "@/lib/ai/itinerary-postprocess-diagnostics";
import { buildLocalLifeCandidatePools } from "@/lib/ai/ai-local-life-rules";
import { filterExcludedRetailPlaces, repairDayPlanSlots, validateItinerary } from "@/lib/ai/ai-day-plan-slot-rules";
import {
  buildLocalLifeIncompleteDaySearchAttempts,
  normalizeAreaKey,
} from "@/lib/ai/ai-local-life-rules";
import { CHAT_PLANNING_RECOMMENDATION_TARGET_COUNT } from "@/lib/ai/chat-destination-place-filter";
import type { classifyDestinationForPlaceSearch } from "@/lib/ai/landmark-place-strategy";
import { ensureClassicLandmarkPlacePool } from "@/lib/ai/ai-classic-landmark-pool";
import { buildWeatherAwareSearchAttempts } from "@/lib/ai/weather-place-search";
import { alignDayPlanToSession, freezePlanningDayPlan, getFrozenPlanningDayPlan } from "@/lib/ai/ai-planning-session";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { getMustVisitPlacesForDestination } from "@/lib/ai/must-visit-places";
import {
  buildLocalClassicLandmarkPool,
  buildSyntheticClassicLandmarkPlace,
  mergeClassicLandmarkCaches,
} from "@/lib/places-classic-landmark-cache";
import {
  ensureRenderableStyleDayPlans,
  logAiCandidatePoolReused,
  logAiPlacesRateLimitFallback,
  mergePlanningCandidatePool,
  persistPlanningCandidatePool,
  shouldSkipPlanningPlacesApi,
} from "@/lib/ai/planning-candidate-pool";
import { countRealPlanningPool, filterRealPlanningPlaces } from "@/lib/ai/planning-real-place";
import type { FetchPlaceDetailsForFocusFn } from "@/lib/ai/place-detail-chat";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import {
  buildValidPlacePoolForItinerary,
  canRenderItinerary,
  logItineraryRenderStart,
  minGeocodedPoolTarget,
  minGeocodedPlacesForItinerary,
} from "@/lib/ai/planning-place-geocode";
import {
  buildItinerarySlotPools,
  canEvenlyMeetMinPerDay,
  countDiningPoolPlaces,
  countScenicPoolPlaces,
  dedupeCandidatePlaces,
  ensureEveryDayPopulated,
  evaluatePlannerPoolGate,
  isPlannerPoolCompositionSufficient,
  isPlannerPoolReady,
  isPlannerPoolSufficient,
  minCandidatePoolSize,
  minDiningPoolSize,
  minScenicPoolSize,
  redistributePlacesEvenly,
  refillMissingDaySlots,
  resolveAdaptiveMinPerDay,
} from "@/lib/ai/ai-multi-day-planner";
import { expandPlacePoolUntilSufficient } from "@/lib/ai/place-pool-expansion";
import { resolveTripPlaceId } from "@/lib/ai/ai-trip-place-allocator";

export type DestinationPlaceSearchFn = (params: {
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
}) => Promise<PlaceResult[]>;

export function shouldUseTripStylePlanning(
  context: CanonicalTravelContext,
  session?: ChatPlanningSession,
): boolean {
  return Boolean(
    hasConfirmedTripDays(context, session) &&
      context.days != null &&
      context.days > 0,
  );
}

export function resolvePlanningTripStyle(
  context: CanonicalTravelContext,
  session?: ChatPlanningSession,
): TripStyleKey {
  return resolveTripStyleFromContext(context, session) ?? "mixed";
}

export function dedupePlaces(places: PlaceResult[]): PlaceResult[] {
  return dedupeCandidatePlaces(places);
}

export function destinationPlanningSearchOpts(
  days: number,
  style: TripStyleKey,
) {
  return {
    planningMode: true as const,
    planningTargetCount: Math.max(
      computeDayPlanPlaceNeed(days, style),
      minCandidatePoolSize(days),
      days * 5,
      CHAT_PLANNING_RECOMMENDATION_TARGET_COUNT,
    ),
  };
}

export function minRenderablePlaces(
  days: number,
  _style?: TripStyleKey,
): number {
  return minCandidatePoolSize(days);
}

export const MAX_POOL_EXPAND_REPLAN_ROUNDS = 6;

export function buildPlanningDaySummary(
  destination: string,
  days: number,
  style: TripStyleKey,
  buckets: DayPlanBucket[],
  composedPlans?: ComposedDayPlan[],
  opts?: { slowTravel?: boolean; expansionExhausted?: boolean },
): string {
  const destLabel = normalizeDestinationLabel(destination);
  if (composedPlans?.length) {
    if (isItineraryRenderable(composedPlans, days, style)) {
      return buildComposedDayPlanSummary(destination, days, style, composedPlans, opts);
    }
    const validation = validateGeneratedDays(composedPlans, days, style);
    logAiRenderBlockedIncompleteDay(
      days,
      validation.reasons,
      Object.fromEntries(composedPlans.map((p) => [p.day, p.entries.length])),
    );
    return `${destLabel} ${days} 天推薦：\n\n（行程生成中）`;
  }
  if (!buckets.some((bucket) => bucket.names.length > 0)) {
    return `${normalizeDestinationLabel(destination)} ${days} 天推薦：\n\n我暫時沒連上即時地點資料，你可以稍後再試。`;
  }
  return buildDayPlanSummaryFromBuckets(destination, days, style, buckets);
}

export async function resolvePlanningReasonProfile(): Promise<
  ReturnType<typeof userProfileForReasonFrom> | null
> {
  try {
    const [prefs, userProfile] = await Promise.all([
      getPreferences(),
      getUserProfile().catch(() => null),
    ]);
    return userProfileForReasonFrom(prefs, {
      travelStyle: userProfile?.travelStyle,
      personalityType: userProfile?.personalityType,
    });
  } catch {
    return null;
  }
}

export function rankPlacesForTripPlanning(params: {
  places: PlaceResult[];
  style: TripStyleKey;
  days: number;
  context: CanonicalTravelContext;
  weather: WeatherSummary | null;
  lat: number;
  lng: number;
  profile: Awaited<ReturnType<typeof resolvePlanningReasonProfile>>;
  label: string;
  skipNormalizeLog?: boolean;
  planningSessionId?: string;
}): {
  ranked: PlaceResult[];
  buckets: DayPlanBucket[];
  composedPlans: ComposedDayPlan[];
} {
  const retailFiltered = filterExcludedRetailPlaces(params.places, { style: params.style });
  const normalized = normalizePlanningPlaces(filterRealPlanningPlaces(retailFiltered), {
    logSummary: !params.skipNormalizeLog,
  });
  logAiResolvedPlacesCount(normalized.length);

  // 空 pool：直接略過，避免 PLANNER_START placesCount=0 污染 / 被覆寫採用
  if (normalized.length === 0) {
    logPlannerOverwriteBlocked("rank_empty_pool", 0, 0);
    return {
      ranked: [],
      buckets: composedDayPlansToBuckets(ensureAllDayPlansExist([], params.days)),
      composedPlans: ensureAllDayPlansExist([], params.days),
    };
  }

  if (!isPlannerPoolReady(normalized, params.days)) {
    const gate = evaluatePlannerPoolGate(normalized, params.days);
    if (gate.decision === "block") {
      logAiPipeline(
        "[AI_PLANNER_DEFERRED]",
        `pool=${normalized.length}`,
        `dining=${countDiningPoolPlaces(normalized)}`,
        `scenic=${countScenicPoolPlaces(normalized)}`,
        `target=${minCandidatePoolSize(params.days)}`,
        `diningTarget=${minDiningPoolSize(params.days)}`,
        `scenicTarget=${minScenicPoolSize(params.days)}`,
        "action=await_pool_expansion",
      );
      logPlannerResult(params.days, 0, false);
      return {
        ranked: normalized,
        buckets: composedDayPlansToBuckets(ensureAllDayPlansExist([], params.days)),
        composedPlans: ensureAllDayPlansExist([], params.days),
      };
    }
    logAiPipeline(
      "[AI_PLANNER_DEFERRED]",
      `pool=${normalized.length}`,
      `decision=${gate.decision}`,
      "action=continue_with_refill",
    );
  }

  logPlannerStart(params.days, normalized.length);

  const weatherScene = classifyWeatherScene({
    tempC: params.weather?.tempC,
    feelsLikeC: params.weather?.feelsLikeC,
    precipProbability: params.weather?.precipProbability,
    condition: params.weather?.condition,
    isDaytime: params.weather?.isDaytime,
    cloudCoverPercent: params.weather?.cloudCoverPercent,
  });
  const scoringInput = buildTripPlaceScoringContext({
    style: params.style,
    days: params.days,
    profile: params.profile,
    context: params.context,
    weatherScene,
    centerLat: params.lat,
    centerLng: params.lng,
  });
  const ranked = filterAndRankTripPlacesForPlanning(normalized, scoringInput);
  logAiResolvedPlacesCount(ranked.length);
  let composedPlans: ComposedDayPlan[];
  try {
    composedPlans = buildComposedDayPlans({
      places: ranked,
      days: params.days,
      style: params.style,
      destination: params.label,
      plannedDate: params.context.startDate,
      lat: params.lat,
      lng: params.lng,
    });
  } catch (error) {
    logAiPipeline(
      "[AI_BUILD_DAY_PLAN_ERROR]",
      error instanceof Error ? error.message : String(error),
      `style=${params.style}`,
    );
    composedPlans = buildBalancedSlowDayPlans({
      places: ranked,
      days: params.days,
      style: params.style,
      plannedDate: params.context.startDate,
    });
  }
  const buckets = composedDayPlansToBuckets(composedPlans);
  const totalPlaces = composedPlans.reduce((n, p) => n + p.entries.length, 0);
  logPlannerResult(
    composedPlans.length,
    totalPlaces,
    isItineraryRenderable(composedPlans, params.days, params.style),
  );
  return {
    ranked: flattenComposedDayPlanPlaces(composedPlans),
    buckets,
    composedPlans,
  };
}

export async function searchAttractionSupplementBatch(params: {
  label: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  weather: WeatherSummary | null;
  context: CanonicalTravelContext;
  caller: string;
  excludePlaceIds: string[];
  userText?: string;
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchContext: ChatPlaceSearchContext;
  existingPlaces: PlaceResult[];
  reason: string;
  searchDestinationPlaces: DestinationPlaceSearchFn;
}): Promise<PlaceResult[]> {
  const attempts = buildAttractionSupplementAttempts(params.label);
  let collected = [...params.existingPlaces];
  for (const attempt of attempts.slice(0, 15)) {
    if (shouldSkipPlanningPlacesApi()) break;
    logAiPlaceSearchRetry(params.reason, attempt.query);
    const batch = await params.searchDestinationPlaces({
      label: params.label,
      lat: params.lat,
      lng: params.lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      weather: params.weather,
      context: params.context,
      attempts: [attempt],
      caller: `${params.caller}.supplement`,
      excludePlaceIds: [
        ...params.excludePlaceIds,
        ...(collected.map((place) => place.id).filter(Boolean) as string[]),
      ],
      userText: params.userText,
      profile: params.profile,
      searchContext: params.searchContext,
      planningMode: true,
    });
    collected = dedupePlaces([...collected, ...batch]);
  }
  return filterExcludedRetailPlaces(collected, { userText: params.userText });
}

export async function searchLocalLifeIncompleteDayBatch(params: {
  label: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  weather: WeatherSummary | null;
  context: CanonicalTravelContext;
  caller: string;
  excludePlaceIds: string[];
  userText?: string;
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchContext: ChatPlaceSearchContext;
  existingPlaces: PlaceResult[];
  incompleteDays: number[];
  composedPlans: ComposedDayPlan[];
  searchDestinationPlaces: DestinationPlaceSearchFn;
}): Promise<PlaceResult[]> {
  if (shouldSkipPlanningPlacesApi()) {
    return filterExcludedRetailPlaces(params.existingPlaces, { style: "local_life", userText: params.userText });
  }

  let collected = [...params.existingPlaces];
  const usedAreaKeys = new Set<string>();
  for (const plan of params.composedPlans) {
    if (params.incompleteDays.includes(plan.day)) continue;
    for (const entry of plan.entries) {
      const area = normalizeAreaKey(entry.place, params.label);
      if (area) usedAreaKeys.add(area);
    }
  }

  for (const day of params.incompleteDays) {
    if (shouldSkipPlanningPlacesApi()) break;
    const attempts = buildLocalLifeIncompleteDaySearchAttempts(
      params.label,
      day - 1,
      [...usedAreaKeys],
    );
    for (const attempt of attempts.slice(0, 8)) {
      if (shouldSkipPlanningPlacesApi()) break;
      logAiPlaceSearchRetry(`incomplete_day_${day}`, attempt.query);
      const batch = await params.searchDestinationPlaces({
        label: params.label,
        lat: params.lat,
        lng: params.lng,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        weather: params.weather,
        context: params.context,
        attempts: [attempt],
        caller: `${params.caller}.localLifeDay${day}`,
        excludePlaceIds: [
          ...params.excludePlaceIds,
          ...(collected.map((place) => place.id).filter(Boolean) as string[]),
        ],
        userText: params.userText,
        profile: params.profile,
        searchContext: params.searchContext,
        planningMode: true,
      });
      collected = dedupePlaces([...collected, ...batch]);
    }
  }

  return filterExcludedRetailPlaces(collected, { style: "local_life", userText: params.userText });
}

function slotDeficitSearchKinds(deficit: SlotDeficitCounts): PlanPlaceKind[] {
  const kinds: PlanPlaceKind[] = [];
  if (deficit.breakfastNeeded > 0 || deficit.lunchNeeded > 0 || deficit.dinnerNeeded > 0) {
    kinds.push("restaurant");
  }
  if (deficit.attractionNeeded > 0) {
    kinds.push("attraction", "nature", "culture");
  }
  if (deficit.cafeNeeded > 0) kinds.push("cafe");
  if (deficit.eveningNeeded > 0) kinds.push("shopping");
  return [...new Set(kinds)];
}

export async function searchSlotDeficitBatch(params: {
  label: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  weather: WeatherSummary | null;
  context: CanonicalTravelContext;
  caller: string;
  excludePlaceIds: string[];
  userText?: string;
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchContext: ChatPlaceSearchContext;
  existingPlaces: PlaceResult[];
  deficit: SlotDeficitCounts;
  retryIndex: number;
  searchDestinationPlaces: DestinationPlaceSearchFn;
}): Promise<PlaceResult[]> {
  if (shouldSkipPlanningPlacesApi() || !hasSlotDeficit(params.deficit)) {
    return params.existingPlaces;
  }

  let collected = [...params.existingPlaces];
  const kinds = slotDeficitSearchKinds(params.deficit);

  console.warn(
    "[ITINERARY_SLOT_REFILL]",
    `retry=${params.retryIndex}`,
    `kinds=${kinds.join(",")}`,
    `before=${collected.length}`,
  );

  for (const kind of kinds) {
    if (shouldSkipPlanningPlacesApi()) break;
    logAiPlaceSearchFallback(`slot_deficit_${kind}`);
    const attempts = buildCategorySearchAttempts(params.label, kind);
    const batch = await params.searchDestinationPlaces({
      label: params.label,
      lat: params.lat,
      lng: params.lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      weather: params.weather,
      context: params.context,
      attempts,
      caller: `${params.caller}.slotDeficit.r${params.retryIndex}.${kind}`,
      excludePlaceIds: [
        ...params.excludePlaceIds,
        ...(collected.map((place) => place.id).filter(Boolean) as string[]),
      ],
      userText: params.userText,
      profile: params.profile,
      searchContext: params.searchContext,
      planningMode: true,
    });
    collected = dedupePlaces([...collected, ...batch]);
  }

  console.warn(
    "[ITINERARY_SLOT_REFILL]",
    `retry=${params.retryIndex}`,
    `after=${collected.length}`,
    `added=${collected.length - params.existingPlaces.length}`,
  );

  return filterExcludedRetailPlaces(collected, { userText: params.userText });
}

export async function searchOpenHoursFallbackBatch(params: {
  label: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  weather: WeatherSummary | null;
  context: CanonicalTravelContext;
  caller: string;
  excludePlaceIds: string[];
  userText?: string;
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchContext: ChatPlaceSearchContext;
  existingPlaces: PlaceResult[];
  meals: Array<"早餐" | "午餐" | "晚餐" | "咖啡">;
  searchDestinationPlaces: DestinationPlaceSearchFn;
}): Promise<PlaceResult[]> {
  let collected = [...params.existingPlaces];
  for (const meal of params.meals) {
    if (shouldSkipPlanningPlacesApi()) break;
    const attempts = buildOpenHoursFallbackAttempts(params.label, meal);
    for (const attempt of attempts) {
      if (shouldSkipPlanningPlacesApi()) break;
      logAiPlaceSearchRetry(`open_hours_${meal}`, attempt.query);
      const batch = await params.searchDestinationPlaces({
        label: params.label,
        lat: params.lat,
        lng: params.lng,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        weather: params.weather,
        context: params.context,
        attempts: [attempt],
        caller: `${params.caller}.openHours.${meal}`,
        excludePlaceIds: [
          ...params.excludePlaceIds,
          ...(collected.map((place) => place.id).filter(Boolean) as string[]),
        ],
        userText: params.userText,
        profile: params.profile,
        searchContext: params.searchContext,
        planningMode: true,
      });
      collected = dedupePlaces([...collected, ...batch]);
    }
  }
  return filterExcludedRetailPlaces(collected, { userText: params.userText });
}

export async function fetchPlacesUntilTarget(params: {
  label: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  weather: WeatherSummary | null;
  context: CanonicalTravelContext;
  style: TripStyleKey;
  days: number;
  caller: string;
  excludePlaceIds?: string[];
  userText?: string;
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchContext: ChatPlaceSearchContext;
  geocodeSucceeded: boolean;
  searchProfile: ReturnType<typeof classifyDestinationForPlaceSearch>;
  weatherSearchLabel: string;
  templateNameSearchAttempts: (destination: string) => SearchAttempt[];
  searchDestinationPlaces: DestinationPlaceSearchFn;
}): Promise<PlaceResult[]> {
  const {
    label,
    lat,
    lng,
    locale,
    searchPlaces,
    weather,
    context,
    style,
    days,
    caller,
    excludePlaceIds = [],
    userText,
    profile,
    searchContext,
    geocodeSucceeded,
    searchProfile,
    weatherSearchLabel,
    templateNameSearchAttempts,
    searchDestinationPlaces,
  } = params;

  const targetCount = computeDayPlanTargetCount(days);
  const minRequired = days * CHAT_DAY_PLAN_MIN_PER_DAY;
  const planningOpts = destinationPlanningSearchOpts(days, style);
  let collected: PlaceResult[] = [];

  for (let pass = 0; pass < 5 && collected.length < targetCount; pass += 1) {
    if (shouldSkipPlanningPlacesApi()) break;
    const styleAttempts =
      pass === 0
        ? [
            ...buildTripStyleSearchAttempts(label, style),
            ...buildDestinationPlaceSearchAttempts({
              profile: searchProfile,
              weatherAwareAttempts: geocodeSucceeded
                ? buildWeatherAwareSearchAttempts(weatherSearchLabel, weather, context)
                : [],
              templateAttempts: geocodeSucceeded ? templateNameSearchAttempts(label) : [],
              textOnlyFallback: buildDestinationTextSearchAttempts(label),
            }).filter(
              (attempt: SearchAttempt) =>
                !buildTripStyleSearchAttempts(label, style).some(
                  (base) => base.query === attempt.query,
                ),
            ),
          ]
        : buildTripStyleSupplementAttempts(label, style, pass);

    const batch = await searchDestinationPlaces({
      label,
      lat,
      lng,
      locale,
      searchPlaces,
      weather,
      context,
      attempts: styleAttempts,
      caller: `${caller}.pass${pass}`,
      excludePlaceIds: [
        ...excludePlaceIds,
        ...collectedTripPlaceIds(collected),
      ],
      userText,
      profile,
      searchContext,
      ...planningOpts,
    });
    collected = dedupePlaces([...collected, ...batch]);
    if (collected.length >= minRequired) break;
  }

  return filterExcludedRetailPlaces(normalizePlanningPlaces(collected), { style, userText });
}

function collectedTripPlaceIds(places: PlaceResult[]): string[] {
  return places.map((place) => resolveTripPlaceId(place)).filter(Boolean);
}

/** Step3：候選不足時擴大搜尋半徑 / 分類 / 變體，直到 Place Pool 達最低需求 */
export async function expandPlanningCandidatePool(params: {
  label: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  weather: WeatherSummary | null;
  context: CanonicalTravelContext;
  style: TripStyleKey;
  days: number;
  caller: string;
  excludePlaceIds?: string[];
  userText?: string;
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchContext?: ChatPlaceSearchContext;
  geocodeSucceeded: boolean;
  searchProfile: ReturnType<typeof classifyDestinationForPlaceSearch>;
  weatherSearchLabel: string;
  templateNameSearchAttempts: (destination: string) => SearchAttempt[];
  searchDestinationPlaces: DestinationPlaceSearchFn;
  existingPlaces: PlaceResult[];
}): Promise<PlaceResult[]> {
  const planningOpts = destinationPlanningSearchOpts(params.days, params.style);

  return expandPlacePoolUntilSufficient({
    label: params.label,
    lat: params.lat,
    lng: params.lng,
    days: params.days,
    style: params.style,
    existingPlaces: params.existingPlaces,
    caller: params.caller,
    excludePlaceIds: params.excludePlaceIds,
    searchBatch: async ({ attempts, caller, radiusM, excludePlaceIds }) =>
      params.searchDestinationPlaces({
        label: params.label,
        lat: params.lat,
        lng: params.lng,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        weather: params.weather,
        context: params.context,
        attempts,
        caller,
        excludePlaceIds,
        userText: params.userText,
        profile: params.profile,
        searchContext: params.searchContext,
        radius: radiusM,
        ...planningOpts,
      }),
  });
}

/** 候選池未達標且餐飲/景點組成不足時：多輪 API 擴充 + 本地補滿 */
export async function ensureMinPlanningCandidatePool(params: {
  label: string;
  lat: number;
  lng: number;
  days: number;
  style: TripStyleKey;
  places: PlaceResult[];
  expand?: () => Promise<PlaceResult[]>;
}): Promise<PlaceResult[]> {
  const target = minCandidatePoolSize(params.days);
  let pool = dedupePlaces(params.places);

  const realPool = () =>
    filterRealPlanningPlaces(
      filterExcludedRetailPlaces(normalizePlanningPlaces(pool), {
        style: params.style,
      }),
    );
  const needsMore = () =>
    realPool().length < target || !isPlannerPoolReady(realPool(), params.days);

  for (let round = 0; needsMore() && round < MAX_POOL_EXPAND_REPLAN_ROUNDS; round += 1) {
    const before = realPool().length;

    if (params.expand && !shouldSkipPlanningPlacesApi()) {
      const expanded = await params.expand();
      if (expanded.length > pool.length) {
        pool = dedupePlaces(expanded);
        logAiStylePlacesResult(pool.length, `pool_expand_round_${round + 1}`);
      }
    }

    if (needsMore()) {
      pool = mergePlanningCandidatePool({
        label: params.label,
        style: params.style,
        places: pool,
        lat: params.lat,
        lng: params.lng,
        days: params.days,
      });
      logAiStylePlacesResult(pool.length, `pool_local_topup_r${round + 1}`);
      persistPlanningCandidatePool(params.label, params.style, pool);
    }

    if (realPool().length <= before && round > 0) break;
  }

  return realPool();
}

export async function fetchClassicLandmarkPlacesForTrip(params: {
  label: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  weather: WeatherSummary | null;
  context: CanonicalTravelContext;
  days: number;
  caller: string;
  excludePlaceIds?: string[];
  userText?: string;
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchContext?: ChatPlaceSearchContext;
  searchDestinationPlaces: DestinationPlaceSearchFn;
}): Promise<PlaceResult[]> {
  const {
    label,
    lat,
    lng,
    locale,
    searchPlaces,
    weather,
    context,
    days,
    caller,
    excludePlaceIds = [],
    userText,
    profile,
    searchContext,
    searchDestinationPlaces,
  } = params;

  const planningOpts = destinationPlanningSearchOpts(days, "classic_landmarks");

  const searchBatch = async (
    attempts: { query: string; mode: "text"; includedTypes?: string[] }[],
  ): Promise<PlaceResult[]> =>
    searchDestinationPlaces({
      label,
      lat,
      lng,
      locale,
      searchPlaces,
      weather,
      context,
      attempts,
      caller: `${caller}.classic`,
      excludePlaceIds,
      userText,
      profile,
      searchContext,
      ...planningOpts,
      classicLandmarkMode: true,
    });

  return ensureClassicLandmarkPlacePool({
    destination: label,
    days,
    lat,
    lng,
    locale,
    searchPlaces,
    searchBatch,
  });
}

export async function fetchComposedCategoryPlaces(params: {
  label: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  weather: WeatherSummary | null;
  context: CanonicalTravelContext;
  style: TripStyleKey;
  days: number;
  caller: string;
  excludePlaceIds?: string[];
  userText?: string;
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchContext?: ChatPlaceSearchContext;
  geocodeSucceeded: boolean;
  searchProfile: ReturnType<typeof classifyDestinationForPlaceSearch>;
  weatherSearchLabel: string;
  templateNameSearchAttempts: (destination: string) => SearchAttempt[];
  searchDestinationPlaces: DestinationPlaceSearchFn;
}): Promise<PlaceResult[]> {
  const {
    label,
    lat,
    lng,
    locale,
    searchPlaces,
    weather,
    context,
    style,
    days,
    caller,
    excludePlaceIds = [],
    userText,
    profile,
    searchContext,
    geocodeSucceeded,
    searchProfile,
    weatherSearchLabel,
    templateNameSearchAttempts,
    searchDestinationPlaces,
  } = params;

  let collected: PlaceResult[];

  if (style === "classic_landmarks") {
    collected = await fetchClassicLandmarkPlacesForTrip({
      label,
      lat,
      lng,
      locale,
      searchPlaces,
      weather,
      context,
      days,
      caller,
      excludePlaceIds,
      userText,
      profile,
      searchContext,
      searchDestinationPlaces,
    });
  } else {
    const perKindTarget = Math.max(6, Math.ceil((days * 7) / Math.max(1, kindsForStyle(style).length)));
    collected = [];

    const cachedPool = mergeClassicLandmarkCaches(label, style);
    if (cachedPool?.length) {
      logAiCandidatePoolReused(cachedPool.length, "prefetch_cache");
      collected = dedupePlaces([...cachedPool]);
    }

    for (const kind of kindsForStyle(style)) {
      if (shouldSkipPlanningPlacesApi()) break;
      const attempts = buildCategorySearchAttempts(label, kind);
      const batch = await searchDestinationPlaces({
        label,
        lat,
        lng,
        locale,
        searchPlaces,
        weather,
        context,
        attempts,
        caller: `${caller}.${kind}`,
        excludePlaceIds: [
          ...excludePlaceIds,
          ...(collected.map((place) => place.id).filter(Boolean) as string[]),
        ],
        userText,
        profile,
        searchContext,
        ...destinationPlanningSearchOpts(days, style),
      });
      collected = dedupePlaces([...collected, ...batch.slice(0, perKindTarget)]);

      if (kind === "attraction") logAiGenerateAttractions(batch.length);
      if (kind === "restaurant") logAiGenerateRestaurants(batch.length);
      if (kind === "cafe") logAiGenerateCafes(batch.length);
    }
  }

  if (collected.length < days * CHAT_DAY_PLAN_MIN_PER_DAY && !shouldSkipPlanningPlacesApi()) {
    const supplement = await fetchPlacesUntilTarget({
      label,
      lat,
      lng,
      locale,
      searchPlaces,
      weather,
      context,
      style,
      days,
      caller,
      excludePlaceIds,
      userText,
      profile,
      searchContext,
      geocodeSucceeded,
      searchProfile,
      weatherSearchLabel,
      templateNameSearchAttempts,
      searchDestinationPlaces,
    });
    collected = dedupePlaces([...collected, ...supplement]);
  }

  if (collected.length < minCandidatePoolSize(days) && !shouldSkipPlanningPlacesApi()) {
    collected = await expandPlanningCandidatePool({
      label,
      lat,
      lng,
      locale,
      searchPlaces,
      weather,
      context,
      style,
      days,
      caller,
      excludePlaceIds,
      userText,
      profile,
      searchContext,
      geocodeSucceeded,
      searchProfile,
      weatherSearchLabel,
      templateNameSearchAttempts,
      searchDestinationPlaces,
      existingPlaces: collected,
    });
  }

  return filterExcludedRetailPlaces(normalizePlanningPlaces(collected), { style, userText });
}

export async function resolveTripPlanningDayPlans(params: {
  filteredPlaces: PlaceResult[];
  style: TripStyleKey;
  days: number;
  context: CanonicalTravelContext;
  weather: WeatherSummary | null;
  lat: number;
  lng: number;
  profile: Awaited<ReturnType<typeof resolvePlanningReasonProfile>>;
  label: string;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  searchContext: ChatPlaceSearchContext;
  userText?: string;
  searchProfile: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchDestinationPlaces: DestinationPlaceSearchFn;
  planningSessionId?: string;
}): Promise<
  ReturnType<typeof rankPlacesForTripPlanning> & { places: PlaceResult[]; slowTravel?: boolean }
> {
  let places = filterRealPlanningPlaces(
    filterExcludedRetailPlaces(normalizePlanningPlaces(params.filteredPlaces), {
      style: params.style,
      userText: params.userText,
    }),
  );
  let slowTravel = false;

  if (!isPlannerPoolReady(places, params.days)) {
    const gate = evaluatePlannerPoolGate(places, params.days);
    if (gate.decision === "block") {
      logAiPipeline(
        "[AI_PLANNER_POOL_GATE]",
        `pool=${places.length}`,
        `dining=${countDiningPoolPlaces(places)}`,
        `scenic=${countScenicPoolPlaces(places)}`,
        `target=${minCandidatePoolSize(params.days)}`,
        `diningTarget=${minDiningPoolSize(params.days)}`,
        `scenicTarget=${minScenicPoolSize(params.days)}`,
        "action=defer_until_expansion",
      );
      return {
        ranked: places,
        buckets: composedDayPlansToBuckets(ensureAllDayPlansExist([], params.days)),
        composedPlans: ensureAllDayPlansExist([], params.days),
        places,
        slowTravel,
      };
    }
  }

  if (countScenicPlaces(places) === 0 && !shouldSkipPlanningPlacesApi()) {
    logAiPlaceSearchFallback("natural");
    places = await searchAttractionSupplementBatch({
      label: params.label,
      lat: params.lat,
      lng: params.lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      weather: params.weather,
      context: params.context,
      caller: "chat.dayPlanScenicRetry",
      excludePlaceIds: [],
      userText: params.userText,
      profile: params.searchProfile,
      searchContext: params.searchContext,
      existingPlaces: places,
      reason: "attractions_empty",
      searchDestinationPlaces: params.searchDestinationPlaces,
    });
  }

  let result = rankPlacesForTripPlanning({ ...params, places, planningSessionId: params.planningSessionId });
  let validation = validateComposedDayPlans(
    result.composedPlans,
    params.days,
    minItemsPerDayForTrip(params.days),
  );
  let itineraryValidation = validateItinerary(
    result.composedPlans,
    classifyPlanPlaceKind,
    params.style,
    params.context.startDate,
    params.days,
  );
  if (!validation.ok || !itineraryValidation.ok) {
    const refilled = refillMissingDaySlots({
      plans: result.composedPlans,
      pool: places,
      days: params.days,
      style: params.style,
      plannedDate: params.context.startDate,
    });
    result = {
      ...result,
      composedPlans: enforceStandardDaySlotPlans(
        ensureAllDayPlansExist(refilled, params.days),
        params.days,
      ),
      ranked: flattenComposedDayPlanPlaces(refilled),
      buckets: composedDayPlansToBuckets(refilled),
    };
    validation = validateComposedDayPlans(
      result.composedPlans,
      params.days,
      minItemsPerDayForTrip(params.days),
    );
    itineraryValidation = validateItinerary(
      result.composedPlans,
      classifyPlanPlaceKind,
      params.style,
      params.context.startDate,
      params.days,
    );
  }
  let classicValidation =
    params.style === "classic_landmarks"
      ? validateClassicLandmarkItinerary(result.composedPlans, classifyPlanPlaceKind)
      : { ok: true, reasons: [] as string[], failedDays: [] as number[] };

  for (let retry = 0; (!validation.ok || !classicValidation.ok || !itineraryValidation.ok) && retry < 5; retry += 1) {
    console.info(
      "[AI_DAY_PLAN_RETRY]",
      `pass=${retry + 1}`,
      `missing=${validation.missingDays.join(",") || "none"}`,
      `sparse=${validation.sparseDays.join(",") || "none"}`,
    );

    if (countScenicPlaces(places) === 0 && !shouldSkipPlanningPlacesApi()) {
      places = await searchAttractionSupplementBatch({
        label: params.label,
        lat: params.lat,
        lng: params.lng,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        weather: params.weather,
        context: params.context,
        caller: `chat.dayPlanRetry.scenic.${retry}`,
        excludePlaceIds: [],
        userText: params.userText,
        profile: params.searchProfile,
        searchContext: params.searchContext,
        existingPlaces: places,
        reason: "attractions_empty",
        searchDestinationPlaces: params.searchDestinationPlaces,
      });
    }

    if (!itineraryValidation.ok && !shouldSkipPlanningPlacesApi()) {
      const needsMeals: Array<"早餐" | "午餐" | "晚餐" | "咖啡"> = ["午餐", "晚餐", "咖啡"];
      if (params.style === "mixed") needsMeals.unshift("早餐");
      places = await searchOpenHoursFallbackBatch({
        label: params.label,
        lat: params.lat,
        lng: params.lng,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        weather: params.weather,
        context: params.context,
        caller: `chat.dayPlanRetry.openHours.${retry}`,
        excludePlaceIds: [],
        userText: params.userText,
        profile: params.searchProfile,
        searchContext: params.searchContext,
        existingPlaces: places,
        meals: needsMeals,
        searchDestinationPlaces: params.searchDestinationPlaces,
      });
    }

    if (!shouldSkipPlanningPlacesApi()) {
      const needKinds: PlanPlaceKind[] = [
        "attraction",
        "nature",
        "culture",
        "restaurant",
        "cafe",
        "shopping",
      ];
      for (const kind of needKinds) {
        if (shouldSkipPlanningPlacesApi()) break;
        logAiPlaceSearchFallback(kind);
        const attempts = buildCategorySearchAttempts(params.label, kind);
        const batch = await params.searchDestinationPlaces({
          label: params.label,
          lat: params.lat,
          lng: params.lng,
          locale: params.locale,
          searchPlaces: params.searchPlaces,
          weather: params.weather,
          context: params.context,
          attempts,
          caller: `chat.dayPlanRetry.${kind}`,
          excludePlaceIds: places.map((place) => place.id).filter(Boolean) as string[],
          userText: params.userText,
          profile: params.searchProfile,
          searchContext: params.searchContext,
          planningMode: true,
        });
        places = dedupePlaces([...places, ...batch]);
      }
    }
    result = rankPlacesForTripPlanning({ ...params, places, skipNormalizeLog: true });
    validation = validateComposedDayPlans(
      result.composedPlans,
      params.days,
      minItemsPerDayForStyle(params.style),
    );
    itineraryValidation = validateItinerary(
      result.composedPlans,
      classifyPlanPlaceKind,
      params.style,
      params.context.startDate,
      params.days,
    );
    classicValidation =
      params.style === "classic_landmarks"
        ? validateClassicLandmarkItinerary(result.composedPlans, classifyPlanPlaceKind)
        : { ok: true, reasons: [], failedDays: [] };
  }

  if (!validation.ok || !classicValidation.ok || !itineraryValidation.ok) {
    logAiDayPlanRebuild();
    if (params.style === "classic_landmarks") {
      places = await fetchClassicLandmarkPlacesForTrip({
        label: params.label,
        lat: params.lat,
        lng: params.lng,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        weather: params.weather,
        context: params.context,
        days: params.days,
        caller: "chat.dayPlanClassicRebuild",
        userText: params.userText,
        profile: params.searchProfile,
        searchContext: params.searchContext,
        searchDestinationPlaces: params.searchDestinationPlaces,
      });
      result = rankPlacesForTripPlanning({ ...params, places, skipNormalizeLog: true });
      validation = validateComposedDayPlans(
        result.composedPlans,
        params.days,
        minItemsPerDayForStyle(params.style),
      );
      classicValidation = validateClassicLandmarkItinerary(
        result.composedPlans,
        classifyPlanPlaceKind,
      );
      if (validation.ok && classicValidation.ok) {
        return { ...result, places, slowTravel };
      }
    }

    const fallbackPlans =
      params.style === "slow_nature"
        ? buildBalancedSlowDayPlans({
            places,
            days: params.days,
            style: params.style,
            plannedDate: params.context.startDate,
          })
        : buildComposedDayPlans({
            places,
            days: params.days,
            style: params.style,
            destination: params.label,
            plannedDate: params.context.startDate,
          });
    const slowValidation = validateComposedDayPlans(
      fallbackPlans,
      params.days,
      minItemsPerDayForStyle(params.style),
    );
    logAiDayPlanFinalValidate(
      params.days,
      slowValidation.ok,
      minItemsPerDayForStyle(params.style),
      slowValidation.sparseDays,
    );

    if (fallbackPlans.some((plan) => plan.entries.length > 0)) {
      slowTravel = params.style === "slow_nature";
      return {
        ranked: flattenComposedDayPlanPlaces(fallbackPlans),
        buckets: composedDayPlansToBuckets(fallbackPlans),
        composedPlans: fallbackPlans,
        places,
        slowTravel,
      };
    }
  }

  logAiDayPlanFinalValidate(
    params.days,
    validation.ok && classicValidation.ok,
    minItemsPerDayForStyle(params.style),
    validation.sparseDays,
  );

  return { ...result, places, slowTravel };
}

export type TripStylePlanGenerateResult = {
  places: PlaceResult[];
  rankedPlaces: PlaceResult[];
  dayBuckets: DayPlanBucket[];
  composedPlans: ComposedDayPlan[];
  dayPlan?: AiDayPlan;
  recommendations: RoamieRecommendationItem[];
  slowTravel?: boolean;
  poolExpansionExhausted?: boolean;
};

async function resolveStylePlanningPlaceFallback(params: {
  label: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  weather: WeatherSummary | null;
  context: CanonicalTravelContext;
  style: TripStyleKey;
  days: number;
  caller: string;
  geocodeSucceeded: boolean;
  searchProfile: ReturnType<typeof classifyDestinationForPlaceSearch>;
  weatherSearchLabel: string;
  templateNameSearchAttempts: (destination: string) => SearchAttempt[];
  searchDestinationPlaces: DestinationPlaceSearchFn;
  searchContext?: ChatPlaceSearchContext;
  userText?: string;
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  excludePlaceIds?: string[];
}): Promise<{ places: PlaceResult[]; source: string }> {
  const {
    label,
    lat,
    lng,
    style,
    days,
    searchProfile,
    weatherSearchLabel,
    geocodeSucceeded,
    templateNameSearchAttempts,
    searchDestinationPlaces,
  } = params;

  const cached = mergeClassicLandmarkCaches(label, style);
  if (cached?.length) {
    logAiCandidatePoolReused(cached.length, "cached_candidate_pool");
    logAiStylePlacesResult(cached.length, "cached_candidate_pool");
    return { places: normalizePlanningPlaces(cached), source: "cached_candidate_pool" };
  }

  if (shouldSkipPlanningPlacesApi()) {
    logAiPlacesRateLimitFallback("style_planning_skip_api");
    const localPool = mergePlanningCandidatePool({
      label,
      style,
      places: [],
      lat,
      lng,
      days,
    });
    if (localPool.length) {
      logAiStylePlacesResult(localPool.length, "rate_limit_local_pool");
      return { places: normalizePlanningPlaces(localPool), source: "rate_limit_local_pool" };
    }
  }

  if (style === "classic_landmarks") {
    const localPool = buildLocalClassicLandmarkPool({
      destination: label,
      days,
      lat,
      lng,
      minCount: minRenderablePlaces(days, style),
    });
    if (localPool.length) {
      logAiStylePlacesResult(localPool.length, "destination_landmark_fallback");
      return { places: normalizePlanningPlaces(localPool), source: "destination_landmark_fallback" };
    }
  }

  if (shouldSkipPlanningPlacesApi()) {
    logAiPlacesRateLimitFallback("landmark_fallback_skip_api");
    return { places: [], source: "rate_limited" };
  }

  const landmarkAttempts = buildDestinationPlaceSearchAttempts({
    profile: searchProfile,
    weatherAwareAttempts: geocodeSucceeded
      ? buildWeatherAwareSearchAttempts(weatherSearchLabel, params.weather, params.context)
      : [],
    templateAttempts: geocodeSucceeded ? templateNameSearchAttempts(label) : [],
    textOnlyFallback: buildDestinationTextSearchAttempts(label),
  });
  const landmarkBatch = await searchDestinationPlaces({
    label: params.label,
    lat: params.lat,
    lng: params.lng,
    locale: params.locale,
    searchPlaces: params.searchPlaces,
    weather: params.weather,
    context: params.context,
    attempts: landmarkAttempts.slice(0, 12),
    caller: `${params.caller}.landmark_fallback`,
    excludePlaceIds: params.excludePlaceIds,
    userText: params.userText,
    profile: params.profile,
    searchContext: params.searchContext,
    ...destinationPlanningSearchOpts(days, style),
  });
  if (landmarkBatch.length) {
    logAiStylePlacesResult(landmarkBatch.length, "destination_landmark_fallback");
    return { places: normalizePlanningPlaces(landmarkBatch), source: "destination_landmark_fallback" };
  }

  let styleBatch: PlaceResult[] = [];
  if (!shouldSkipPlanningPlacesApi()) {
    for (const kind of kindsForStyle(style)) {
      if (shouldSkipPlanningPlacesApi()) break;
      const attempts = buildCategorySearchAttempts(label, kind);
      const batch = await searchDestinationPlaces({
        label: params.label,
        lat: params.lat,
        lng: params.lng,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        weather: params.weather,
        context: params.context,
        attempts,
        caller: `${params.caller}.city_style_fallback.${kind}`,
        excludePlaceIds: params.excludePlaceIds,
        userText: params.userText,
        profile: params.profile,
        searchContext: params.searchContext,
        ...destinationPlanningSearchOpts(days, style),
      });
      styleBatch = dedupePlaces([...styleBatch, ...batch]);
    }
  }
  if (styleBatch.length) {
    logAiStylePlacesResult(styleBatch.length, "city_style_fallback");
    return { places: normalizePlanningPlaces(styleBatch), source: "city_style_fallback" };
  }

  const named = getMustVisitPlacesForDestination(label).map((place, index) =>
    buildSyntheticClassicLandmarkPlace({
      name: place.name,
      destination: label,
      lat,
      lng,
      index,
    }),
  );
  if (named.length) {
    logAiStylePlacesResult(named.length, "named_fallback_recommendations");
    return { places: normalizePlanningPlaces(named), source: "named_fallback_recommendations" };
  }

  return { places: [], source: "none" };
}

export async function generateTripPlanFromStyle(params: {
  label: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  weather: WeatherSummary | null;
  context: CanonicalTravelContext;
  style: TripStyleKey;
  days: number;
  caller: string;
  excludePlaceIds?: string[];
  userText?: string;
  profile?: ReturnType<typeof classifyDestinationForPlaceSearch>;
  searchContext: ChatPlaceSearchContext;
  geocodeSucceeded: boolean;
  searchProfile: ReturnType<typeof classifyDestinationForPlaceSearch>;
  weatherSearchLabel: string;
  templateNameSearchAttempts: (destination: string) => SearchAttempt[];
  searchDestinationPlaces: DestinationPlaceSearchFn;
  planningSessionId: string;
  planVersion?: number;
  geocodeFn: GeocodeDestinationFn;
  fetchPlaceDetailsFn?: FetchPlaceDetailsForFocusFn;
}): Promise<TripStylePlanGenerateResult> {
  const {
    label,
    style,
    days,
    planningSessionId,
    templateNameSearchAttempts,
    searchDestinationPlaces,
    geocodeSucceeded,
    caller,
  } = params;

  logAiStylePlanGenerateStart(label, style, days, planningSessionId);
  if (!beginPlannerSession(planningSessionId)) {
    const frozen = getFrozenPlanningDayPlan(planningSessionId);
    if (frozen?.items.length) {
      logAiPipeline("[AI_PLANNER_SESSION_REUSE]", `sessionId=${planningSessionId}`, `items=${frozen.items.length}`);
      return {
        places: [],
        rankedPlaces: [],
        dayBuckets: [],
        composedPlans: ensureAllDayPlansExist([], days),
        dayPlan: alignDayPlanToSession(frozen, planningSessionId),
        recommendations: dayPlanToRecommendations(frozen),
        slowTravel: false,
        poolExpansionExhausted: false,
      };
    }
    logAiPipeline("[AI_PLANNER_SESSION_SKIP]", `sessionId=${planningSessionId}`);
  }
  if (params.planVersion != null) {
    logAiPipeline("[AI_STYLE_PLAN_GENERATE_START]", `planVersion=${params.planVersion}`);
  }
  const styleAttempts = buildTripStyleSearchAttempts(label, style);
  logAiStyleSearchAttempts(label, style, styleAttempts.length);

  let places = await fetchComposedCategoryPlaces({
    ...params,
    caller: geocodeSucceeded ? `${caller}.stylePlan` : `${caller}.stylePlan.textOnly`,
    templateNameSearchAttempts,
    searchDestinationPlaces,
  });
  let searchCount = places.length;
  logAiStylePlacesResult(places.length, "primary_search");

  if (places.length < minRenderablePlaces(days, style) && !shouldSkipPlanningPlacesApi()) {
    const fallback = await resolveStylePlanningPlaceFallback({
      ...params,
      caller: `${caller}.styleFallback`,
      templateNameSearchAttempts,
      searchDestinationPlaces,
    });
    if (fallback.places.length) {
      places = dedupePlaces([...places, ...fallback.places]);
    }
  }

  const shouldLogNormalize = beginPipelineStage(planningSessionId, "normalize_planning");
  places = filterExcludedRetailPlaces(
    normalizePlanningPlaces(places, {
      logSummary: shouldLogNormalize,
    }),
    {
      style: params.style,
      userText: params.userText,
    },
  );
  if (shouldLogNormalize) {
    finishPipelineStage(planningSessionId, "normalize_planning");
  }
  logAiStylePlacesResult(places.length, "normalized");
  persistPlanningCandidatePool(label, style, places);

  const minRequired = minGeocodedPoolTarget(days);
  if (places.length < minRequired) {
    places = mergePlanningCandidatePool({
      label,
      style,
      places,
      lat: params.lat,
      lng: params.lng,
      days,
    });
    logAiStylePlacesResult(places.length, "pool_prefilled");
  }

  if (places.length < minCandidatePoolSize(days) && !shouldSkipPlanningPlacesApi()) {
    places = await expandPlanningCandidatePool({
      label,
      lat: params.lat,
      lng: params.lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      weather: params.weather,
      context: params.context,
      style,
      days,
      excludePlaceIds: params.excludePlaceIds,
      userText: params.userText,
      profile: params.profile,
      searchContext: params.searchContext,
      geocodeSucceeded,
      searchProfile: params.searchProfile,
      weatherSearchLabel: params.weatherSearchLabel,
      templateNameSearchAttempts,
      searchDestinationPlaces,
      existingPlaces: places,
      caller: `${caller}.poolExpand`,
    });
    logAiStylePlacesResult(places.length, "pool_expanded");
  }

  const geocodePool = await buildValidPlacePoolForItinerary({
    pool: places,
    minRequired,
    city: label,
    locale: params.locale,
    geocodeFn: params.geocodeFn,
    fetchPlaceDetails: params.fetchPlaceDetailsFn,
    fetchMoreCandidates: shouldSkipPlanningPlacesApi()
      ? undefined
      : async (excludeIds) => {
          const batch = await fetchPlacesUntilTarget({
            ...params,
            caller: `${caller}.geocodeTopUp`,
            excludePlaceIds: [
              ...(params.excludePlaceIds ?? []),
              ...excludeIds.filter(Boolean),
            ],
            templateNameSearchAttempts,
            searchDestinationPlaces,
          });
          return filterExcludedRetailPlaces(normalizePlanningPlaces(batch), {
            style: params.style,
            userText: params.userText,
          });
        },
  });

  if (geocodePool.validPlaces.length < minRequired) {
    const toppedUp = mergePlanningCandidatePool({
      label,
      style,
      places: dedupePlaces([...geocodePool.validPlaces, ...places]),
      lat: params.lat,
      lng: params.lng,
      days,
    });
    places =
      toppedUp.length >= minGeocodedPlacesForItinerary(days)
        ? toppedUp
        : geocodePool.validPlaces.length > 0
          ? dedupePlaces([...geocodePool.validPlaces, ...toppedUp])
          : toppedUp;
  } else {
    places = geocodePool.validPlaces;
  }

  const realFilter = filterRealPlanningPlacesWithDiagnostics(places, { stage: "pre_planner_real" });
  places = realFilter.places;
  logPlaceNormalizeDropSummary({
    input: searchCount,
    output: realFilter.places.length,
    realFilterCounters: realFilter.counters,
    unsupportedPayload: Math.max(0, searchCount - places.length - (realFilter.counters.droppedMissingPlaceId ?? 0)),
  });
  logAiStylePlacesResult(places.length, "real_places_only");
  persistPlanningCandidatePool(label, style, places);

  if (!isPlannerPoolReady(places, days) && !shouldSkipPlanningPlacesApi()) {
    places = await expandPlanningCandidatePool({
      label,
      lat: params.lat,
      lng: params.lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      weather: params.weather,
      context: params.context,
      style,
      days,
      excludePlaceIds: params.excludePlaceIds,
      userText: params.userText,
      profile: params.profile,
      searchContext: params.searchContext,
      geocodeSucceeded,
      searchProfile: params.searchProfile,
      weatherSearchLabel: params.weatherSearchLabel,
      templateNameSearchAttempts,
      searchDestinationPlaces,
      existingPlaces: places,
      caller: `${caller}.postGeocodeExpand`,
    });
    logAiStylePlacesResult(places.length, "post_geocode_expanded");
    persistPlanningCandidatePool(label, style, places);
  }

  const reasonProfile = await resolvePlanningReasonProfile();
  let planningResult: Awaited<ReturnType<typeof resolveTripPlanningDayPlans>>;
  let composedPlans: ComposedDayPlan[];
  let renderValidation: ReturnType<typeof validateGeneratedDays>;

  const expandPool = (existing: PlaceResult[], expandCaller: string) =>
    expandPlanningCandidatePool({
      label,
      lat: params.lat,
      lng: params.lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      weather: params.weather,
      context: params.context,
      style,
      days,
      excludePlaceIds: params.excludePlaceIds,
      userText: params.userText,
      profile: params.profile,
      searchContext: params.searchContext,
      geocodeSucceeded,
      searchProfile: params.searchProfile,
      weatherSearchLabel: params.weatherSearchLabel,
      templateNameSearchAttempts,
      searchDestinationPlaces,
      existingPlaces: existing,
      caller: expandCaller,
    });

  for (let prePlanRound = 0; prePlanRound < MAX_POOL_EXPAND_REPLAN_ROUNDS; prePlanRound += 1) {
    const poolBefore = countRealPlanningPool(places);
    if (isPlannerPoolReady(places, days)) break;

    places = await ensureMinPlanningCandidatePool({
      label,
      lat: params.lat,
      lng: params.lng,
      days,
      style,
      places,
      expand: () => expandPool(places, `${caller}.prePlanExpand.r${prePlanRound}`),
    });
    logAiStylePlacesResult(places.length, `pre_plan_expand_r${prePlanRound + 1}`);

    const poolAfter = countRealPlanningPool(places);
    if (poolAfter <= poolBefore && prePlanRound > 0) break;
  }

  const poolReady = isPlannerPoolReady(places, days);
  if (!poolReady) {
    logAiPipeline(
      "[AI_POOL_INSUFFICIENT]",
      `pool=${places.length}`,
      `dining=${countDiningPoolPlaces(places)}`,
      `scenic=${countScenicPoolPlaces(places)}`,
      `target=${minCandidatePoolSize(days)}`,
      `diningTarget=${minDiningPoolSize(days)}`,
      `scenicTarget=${minScenicPoolSize(days)}`,
      "action=expand_and_plan",
    );
  }

  logItineraryRenderStart();
  const mainPlannerRunKey = buildPlannerRunKey({
    sessionId: planningSessionId,
    style,
    days,
    poolFingerprint: buildCandidatePoolFingerprint(places),
  });
  const shouldRunMainPlanner = beginPlannerRun(mainPlannerRunKey);
  if (shouldRunMainPlanner) {
    planningResult = await resolveTripPlanningDayPlans({
    filteredPlaces: places,
    style: params.style,
    days,
    context: params.context,
    weather: params.weather,
    lat: params.lat,
    lng: params.lng,
    profile: reasonProfile,
    label,
    locale: params.locale,
    searchPlaces: params.searchPlaces,
    searchContext: params.searchContext,
    userText: params.userText,
    searchProfile: params.searchProfile,
    searchDestinationPlaces,
    planningSessionId,
  });
  } else {
    logAiPipeline(
      "[AI_PLANNER_SESSION_REUSE]",
      `runKey=${mainPlannerRunKey}`,
      "reason=duplicate_main_planner",
    );
    planningResult = {
      ranked: places,
      buckets: composedDayPlansToBuckets(ensureAllDayPlansExist([], days)),
      composedPlans: ensureAllDayPlansExist([], days),
      places,
      slowTravel: false,
    };
  }
  composedPlans = planningResult.composedPlans;
  let bestFrozenPlans = ensureAllDayPlansExist(composedPlans, days);
  let bestFrozenPlaces = planningResult.places.length ? planningResult.places : places;
  renderValidation = validateGeneratedDays(composedPlans, days, style);

  const lockIfFrozen = (reason: string): boolean => {
    if (!shouldFreezePlannerResult(bestFrozenPlans, days, style)) return false;
    logPlannerFrozen(planningSessionId, plannerTotalPlaces(bestFrozenPlans));
    logAiPipeline("[AI_PLANNER_SKIP_OVERWRITE]", `reason=${reason}`, `sessionId=${planningSessionId}`);
    composedPlans = bestFrozenPlans;
    planningResult = {
      ...planningResult,
      places: bestFrozenPlaces,
      composedPlans: bestFrozenPlans,
      ranked: flattenComposedDayPlanPlaces(bestFrozenPlans),
      buckets: composedDayPlansToBuckets(bestFrozenPlans),
    };
    return true;
  };

  const keepBetter = (next: ComposedDayPlan[], nextPlaces?: PlaceResult[]) => {
    const kept = preferBetterComposedPlans(next, bestFrozenPlans, days, style);
    const keptTotal = plannerTotalPlaces(kept);
    const nextTotal = plannerTotalPlaces(next);
    if (nextTotal <= 0 && keptTotal > 0) {
      logPlannerOverwriteBlocked("empty_postprocess", keptTotal, nextTotal);
    }
    bestFrozenPlans = kept;
    if (nextPlaces?.length) bestFrozenPlaces = nextPlaces;
    composedPlans = bestFrozenPlans;
  };

  if (
    !lockIfFrozen("after_primary_plan") &&
    !renderValidation.ok &&
    bestFrozenPlaces.length > 0
  ) {
    const trimmed = enforceStandardDaySlotPlans(composedPlans, days);
    const repaired = repairDayPlanSlots(
      trimmed,
      places,
      style,
      classifyPlanPlaceKind,
      resolveEntryLabel,
      days,
      params.context.startDate,
    );
    const slotRebuilt = renderValidation.incompleteDays.length
      ? rebuildIncompleteDays(repaired, renderValidation.incompleteDays, places, style, label, days)
      : repaired;
    keepBetter(
      enforceStandardDaySlotPlans(slotRebuilt, days),
      places,
    );
    renderValidation = validateGeneratedDays(composedPlans, days, style);
    planningResult = {
      ...planningResult,
      composedPlans,
      ranked: flattenComposedDayPlanPlaces(composedPlans),
      buckets: composedDayPlansToBuckets(composedPlans),
    };
  }

  if (
    !lockIfFrozen("before_local_life_retry") &&
    poolReady &&
    !renderValidation.ok &&
    style === "local_life" &&
    !shouldSkipPlanningPlacesApi()
  ) {
    places = await searchLocalLifeIncompleteDayBatch({
      label,
      lat: params.lat,
      lng: params.lng,
      locale: params.locale,
      searchPlaces: params.searchPlaces,
      weather: params.weather,
      context: params.context,
      caller: `${caller}.incompleteDaySearch`,
      excludePlaceIds: params.excludePlaceIds ?? [],
      userText: params.userText,
      profile: params.searchProfile,
      searchContext: params.searchContext,
      existingPlaces: planningResult.places,
      incompleteDays: renderValidation.incompleteDays,
      composedPlans,
      searchDestinationPlaces,
    });
    if (places.length > 0) {
      persistPlanningCandidatePool(label, style, places);
      planningResult = await resolveTripPlanningDayPlans({
        filteredPlaces: places,
        style,
        days,
        context: params.context,
        weather: params.weather,
        lat: params.lat,
        lng: params.lng,
        profile: reasonProfile,
        label,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        searchContext: params.searchContext,
        userText: params.userText,
        searchProfile: params.searchProfile,
        searchDestinationPlaces,
      });
      keepBetter(planningResult.composedPlans, places);
      renderValidation = validateGeneratedDays(composedPlans, days, style);
      planningResult = {
        ...planningResult,
        places: bestFrozenPlaces,
        composedPlans,
        ranked: flattenComposedDayPlanPlaces(composedPlans),
        buckets: composedDayPlansToBuckets(composedPlans),
      };
    } else {
      logPlannerOverwriteBlocked(
        "local_life_retry_empty",
        plannerTotalPlaces(bestFrozenPlans),
        0,
      );
    }
  }

  if (!lockIfFrozen("before_ensure_renderable")) {
    const ensured = ensureRenderableStyleDayPlans({
      composedPlans,
      places: planningResult.places,
      style,
      label,
      days,
      lat: params.lat,
      lng: params.lng,
      plannedDate: params.context.startDate,
    });
    keepBetter(ensured.composedPlans, ensured.candidatePool);
    renderValidation = validateGeneratedDays(composedPlans, days, style);
    planningResult = {
      ...planningResult,
      places: bestFrozenPlaces,
      composedPlans,
      ranked: flattenComposedDayPlanPlaces(composedPlans),
      buckets: composedDayPlansToBuckets(composedPlans),
    };

    if (
      !lockIfFrozen("before_ensure_renderable_compose") &&
      !isItineraryRenderable(composedPlans, days, style) &&
      ensured.candidatePool.length > 0
    ) {
      const repaired = ensureRenderableComposedPlans({
        composedPlans,
        places: ensured.candidatePool,
        days,
        style: params.style,
        destination: label,
        plannedDate: params.context.startDate,
      });
      keepBetter(repaired, ensured.candidatePool);
      renderValidation = validateGeneratedDays(composedPlans, days, style);
      planningResult = {
        ...planningResult,
        composedPlans,
        ranked: flattenComposedDayPlanPlaces(composedPlans),
        buckets: composedDayPlansToBuckets(composedPlans),
      };
    }
  }

  const renderable = isItineraryRenderable(composedPlans, days, style);
  const totalPlaces = plannerTotalPlaces(composedPlans);
  let poolExpansionExhausted = false;

  // 候選池不足或行程不可 render：持續擴充 + 重跑 Planner（內部 retry，不對使用者顯示地點不足）
  if (!lockIfFrozen("before_pool_replan") && !renderable) {
    for (let round = 0; round < MAX_POOL_EXPAND_REPLAN_ROUNDS; round += 1) {
      if (isItineraryRenderable(composedPlans, days, style)) break;
      if (lockIfFrozen(`pool_replan_round_${round}`)) break;

      const poolBefore = filterRealPlanningPlaces(bestFrozenPlaces).length;
      logAiPipeline(
        "[AI_POOL_REPLAN]",
        `round=${round + 1}`,
        `pool=${poolBefore}`,
        `ready=${isPlannerPoolReady(bestFrozenPlaces, days)}`,
        `target=${minCandidatePoolSize(days)}`,
        `renderable=${isItineraryRenderable(composedPlans, days, style)}`,
      );

      bestFrozenPlaces = await ensureMinPlanningCandidatePool({
        label,
        lat: params.lat,
        lng: params.lng,
        days,
        style,
        places: bestFrozenPlaces,
        expand: shouldSkipPlanningPlacesApi()
          ? undefined
          : () => expandPool(bestFrozenPlaces, `${caller}.replanExpand.r${round}`),
      });

      const poolAfter = filterRealPlanningPlaces(bestFrozenPlaces).length;
      if (poolAfter <= poolBefore && round > 0) {
        poolExpansionExhausted = true;
        break;
      }

      if (!isPlannerPoolReady(bestFrozenPlaces, days)) {
        continue;
      }

      const refilledPlans = refillMissingDaySlots({
        plans: composedPlans,
        pool: bestFrozenPlaces,
        days,
        style,
        plannedDate: params.context.startDate,
      });
      keepBetter(
        enforceStandardDaySlotPlans(ensureAllDayPlansExist(refilledPlans, days), days),
        bestFrozenPlaces,
      );
      renderValidation = validateGeneratedDays(composedPlans, days, style);
      planningResult = {
        ...planningResult,
        places: bestFrozenPlaces,
        composedPlans,
        ranked: flattenComposedDayPlanPlaces(composedPlans),
        buckets: composedDayPlansToBuckets(composedPlans),
      };

      if (isItineraryRenderable(composedPlans, days, style)) break;
    }
    if (!isItineraryRenderable(composedPlans, days, style)) {
      poolExpansionExhausted = true;
    }
  }

  composedPlans = preferBetterComposedPlans(composedPlans, bestFrozenPlans, days, style);
  planningResult = {
    ...planningResult,
    places: bestFrozenPlaces.length ? bestFrozenPlaces : planningResult.places,
    composedPlans,
    ranked: flattenComposedDayPlanPlaces(composedPlans),
    buckets: composedDayPlansToBuckets(composedPlans),
  };

  let finalRenderable = isItineraryRenderable(composedPlans, days, style);
  const poolCountsForDeficit = buildItinerarySlotPools(
    bestFrozenPlaces.length ? bestFrozenPlaces : places,
  );

  if (!finalRenderable && poolCountsForDeficit.total > 0) {
    composedPlans = refillMissingDaySlots({
      plans: composedPlans,
      pool: bestFrozenPlaces.length ? bestFrozenPlaces : places,
      days,
      style,
      plannedDate: params.context.startDate,
    });
    composedPlans = enforceStandardDaySlotPlans(ensureAllDayPlansExist(composedPlans, days), days);
    planningResult = {
      ...planningResult,
      composedPlans,
      ranked: flattenComposedDayPlanPlaces(composedPlans),
      buckets: composedDayPlansToBuckets(composedPlans),
    };
    finalRenderable = isItineraryRenderable(composedPlans, days, style);
  }

  if (!finalRenderable && !shouldSkipPlanningPlacesApi()) {
    const deficit = computeSlotDeficitFromPools(days, poolCountsForDeficit);
    logItinerarySlotDeficit(deficit);

    if (
      hasSlotDeficit(deficit) &&
      beginPipelineStage(planningSessionId, "slot_deficit_refill", { retry: true, reason: "validation_failed" })
    ) {
      const refilled = await searchSlotDeficitBatch({
        label,
        lat: params.lat,
        lng: params.lng,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        weather: params.weather,
        context: params.context,
        caller: `${caller}.slotDeficit`,
        excludePlaceIds: params.excludePlaceIds ?? [],
        userText: params.userText,
        profile: params.profile,
        searchContext: params.searchContext,
        existingPlaces: bestFrozenPlaces.length ? bestFrozenPlaces : places,
        deficit,
        retryIndex: 1,
        searchDestinationPlaces,
      });

      if (refilled.length > (bestFrozenPlaces.length ? bestFrozenPlaces : places).length) {
        bestFrozenPlaces = refilled;
        places = refilled;
        persistPlanningCandidatePool(label, style, refilled);

        const refilledPlans = refillMissingDaySlots({
          plans: composedPlans,
          pool: refilled,
          days,
          style,
          plannedDate: params.context.startDate,
        });
        keepBetter(
          enforceStandardDaySlotPlans(ensureAllDayPlansExist(refilledPlans, days), days),
          refilled,
        );
        composedPlans = bestFrozenPlans;
        planningResult = {
          ...planningResult,
          places: bestFrozenPlaces,
          composedPlans,
          ranked: flattenComposedDayPlanPlaces(composedPlans),
          buckets: composedDayPlansToBuckets(composedPlans),
        };
        finalRenderable = isItineraryRenderable(composedPlans, days, style);
      }
      finishPipelineStage(planningSessionId, "slot_deficit_refill");
    }
  }

  const finalTotalPlaces = plannerTotalPlaces(composedPlans);

  let dayPlan: AiDayPlan | undefined;
  let recommendations: RoamieRecommendationItem[] = [];

  const renderableAfterForce = finalRenderable;
  const totalAfterForce = finalTotalPlaces;
  if (renderableAfterForce && totalAfterForce > 0) {
    dayPlan = alignDayPlanToSession(
      composedPlansToAiDayPlan({
        composedPlans,
        destination: label,
        days,
        planningSessionId,
      }),
      planningSessionId,
    );
    freezePlanningDayPlan(planningSessionId, dayPlan);
    recommendations = dayPlanToRecommendations(dayPlan);
    logAiStyleDayPlanResult(days, dayPlan.items.length);
    logAiStylePlanApplySession(planningSessionId);
    logAiStylePlanRenderReady(recommendations.length, dayPlan.items.length);
    logPlannerResult(
      composedPlans.length,
      finalTotalPlaces,
      true,
    );
    logPlannerFrozen(planningSessionId, finalTotalPlaces);
  } else {
    logPlannerResult(
      composedPlans.length,
      totalAfterForce,
      false,
    );
  }

  const poolCounts = buildItinerarySlotPools(
    bestFrozenPlaces.length ? bestFrozenPlaces : places,
  );
  logCategoryPoolCounts("pre_render", {
    breakfast: poolCounts.breakfast,
    attraction: poolCounts.attraction,
    lunch: poolCounts.lunch,
    cafe: poolCounts.cafe,
    dinner: poolCounts.dinner,
    evening: poolCounts.evening,
    total: poolCounts.total,
  });

  logItineraryPipelineSummary({
    searchCount,
    normalizedCount: realFilter.places.length + (realFilter.counters.droppedMissingPlaceId ?? 0),
    detailsEnrichedCount: geocodePool.validPlaces.length,
    postprocessCount: realFilter.places.length,
    poolCounts: {
      breakfast: poolCounts.breakfast,
      attraction: poolCounts.attraction,
      lunch: poolCounts.lunch,
      cafe: poolCounts.cafe,
      dinner: poolCounts.dinner,
      evening: poolCounts.evening,
      total: poolCounts.total,
    },
    plannerItemCount: finalTotalPlaces,
    validationOk: finalRenderable,
    renderedCardsCount: recommendations.length,
  });

  finishPlannerSession(planningSessionId, finalTotalPlaces);
  finishPlannerRun(mainPlannerRunKey, finalTotalPlaces);

  return {
    places: planningResult.places,
    rankedPlaces: planningResult.ranked,
    dayBuckets: planningResult.buckets,
    composedPlans,
    dayPlan,
    recommendations,
    slowTravel: planningResult.slowTravel,
    poolExpansionExhausted,
  };
}
