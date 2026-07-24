import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { Locale } from "@/lib/i18n/types";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ChatMsg } from "@/lib/chat-history";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  canBuildItineraryFromPlaceCount,
  preparePlacesForItineraryBuild,
  resolveItineraryPlaceSources,
} from "@/lib/place-planning-memory";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import type { PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import type { WeatherSummary } from "@/lib/weather-types";
import {
  prepareDirectItinerarySession,
  type ItineraryPlaceFailure,
} from "@/lib/ai/itinerary-place-fetch";
import {
  buildFallbackItineraryFromPlaces,
  coalesceItineraryItems,
  hasCompleteItineraryPayload,
  hasValidItineraryStops,
  isGenerateItineraryFailure,
  ITINERARY_GENERATION_FAILED_MESSAGE,
  normalizeGenerateItineraryResult,
  unwrapGeneratedTripPayload,
  validateGeneratedItinerary,
  type GenerateItineraryResult,
} from "@/lib/trip/itinerary-guards";
import { INSUFFICIENT_ITINERARY_PLACES_MESSAGE } from "@/lib/ai/generic-place-label";
import {
  isItineraryValidatorEnabled,
  validateItineraryPlan,
  shouldBlockItineraryDelivery,
  logItineraryDeliveryBlocked,
  logItineraryDeliveryAllowed,
  dayCountsOfPlans,
  compareItineraryPersistenceDayCounts,
  ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
} from "@/lib/ai/itinerary-validator";
import {
  applyComposedPlansToItineraryItems,
  composedPlansFromItineraryItems,
} from "@/lib/ai/itinerary-validator/from-payload";
import { replanUntilItineraryValid } from "@/lib/ai/itinerary-validator/replan";
import { logItineraryFailureChain } from "@/lib/ai/itinerary-day-coverage";
import type { ItineraryInput } from "@/lib/itinerary.functions";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import type { PlaceResult } from "@/lib/place-result";
import {
  resolvePlannerStyleKey,
  type ComposedDayPlan,
} from "@/lib/ai/ai-day-plan-source";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import {
  logItineraryBuildSource,
  logItineraryDaysBuilt,
  logItineraryFailureReason,
  logItineraryObjectBuilt,
  logItinerarySaveFailed,
  logItineraryUsedRecommendedPlaces,
  logItineraryValidationResult,
  sanitizeDestinationForGeocode,
} from "@/lib/ai/itinerary-entity-extraction";
import { groupStopsByTripDays } from "@/lib/ai/combination-itinerary-integrity";
import { computeMinimumPlacesForTripDays } from "@/lib/ai/real-place-supplement";
import {
  contextRequiresCombinationSelection,
  logDirectItineraryGenInput,
  logDirectItineraryGenOutput,
  validateDirectItineraryInput,
} from "@/lib/ai/validate-direct-itinerary-input";
import {
  allocateNearbyExtensionDays,
  logNearbyExtensionPersistence,
  logNearbyExtensionUiCompare,
} from "@/lib/ai/nearby-extension-requirements";

export type AiItineraryState =
  | "COLLECTING"
  | "SEARCHING_PLACES"
  | "RANKING"
  | "BUILDING_ITINERARY"
  | "CREATING_TRIP"
  | "SUCCESS"
  | "FAILED";

export const AI_ITINERARY_FAILED_OFFER_MESSAGE =
  "行程建立失敗，是否改成列出必去景點？";

export const AI_ITINERARY_SUCCESS_REDIRECT_MESSAGE =
  "行程已建立，正在帶你前往";

export function logAiState(state: AiItineraryState, detail?: string): void {
  logAiPipeline("[AI_STATE]", `state=${state}`, detail ? `detail=${detail}` : "");
}

export function logAiItineraryBuild(stops: number, days: number): void {
  logAiPipeline("[AI_ITINERARY_BUILD]", `stops=${stops}`, `days=${days}`);
}

export function logAiItineraryCreate(destination: string, placeCount: number): void {
  logAiPipeline(
    "[AI_ITINERARY_CREATE]",
    `destination=${destination}`,
    `places=${placeCount}`,
  );
}

export function logAiItinerarySuccess(tripId?: string): void {
  logAiPipeline("[AI_ITINERARY_SUCCESS]", tripId ? `tripId=${tripId}` : "draft");
}

export function logAiItineraryFailed(reason: string): void {
  console.warn("[AI_ITINERARY_FAILED]", `reason=${reason}`);
}

export type DirectItineraryPrepareResult =
  | { ok: true; session: ChatPlanningSession; placeCount: number }
  | {
      ok: false;
      state: "FAILED";
      message: string;
      failureReason: string;
      diagnostics: ItineraryPlaceFailure | null;
      session: ChatPlanningSession;
      offerMustVisit?: boolean;
    };

/** COLLECTING → SEARCHING_PLACES → RANKING — 準備 selectedPlaces（不依 geocode 成功） */
export async function prepareDirectItineraryFlow(params: {
  session: ChatPlanningSession;
  context: CanonicalTravelContext;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn?: (args: {
    data: { lat: number; lng: number; locale?: Locale };
  }) => Promise<WeatherSummary>;
  excludePlaceIds?: string[];
  msgs?: ChatMsg[];
  fetchPlaceDetails?: (placeId: string) => Promise<import("@/lib/place-result").PlaceResult | null>;
}): Promise<DirectItineraryPrepareResult> {
  const { session, context, msgs } = params;
  logAiState("COLLECTING");

  const rawDestination =
    context.destination?.trim() ||
    session.tripDestination?.displayLabel?.trim() ||
    session.tripDestination?.city?.trim();
  const destination = rawDestination
    ? sanitizeDestinationForGeocode(rawDestination)
    : undefined;
  const days = context.days ?? session.tripDays;

  if (!destination || !days) {
    logAiItineraryFailed("missing_destination_or_days");
    logAiPipeline("[ITINERARY_SAVE_FAILED_REASON]", "no destination");
    logAiState("FAILED", "missing_destination_or_days");
    return {
      ok: false,
      state: "FAILED",
      message: "我還需要知道目的地和天數，才能幫你排完整行程。",
      failureReason: "missing_destination_or_days",
      diagnostics: null,
      session: {
        ...session,
        aiItineraryState: "FAILED",
        pendingQuestion: undefined,
      },
    };
  }

  const label = normalizeDestinationLabel(destination);
  const { places: rawSessionPlaces, source } = resolveItineraryPlaceSources(session, msgs);
  const sessionPlaces = preparePlacesForItineraryBuild(rawSessionPlaces, label);

  logItineraryBuildSource(source, sessionPlaces.length);
  if (
    source === "recommendedPlaces" ||
    source === "plannedStops" ||
    source === "renderedCards"
  ) {
    logItineraryUsedRecommendedPlaces(sessionPlaces.length);
  }

  const requireCombos = contextRequiresCombinationSelection(params.context);
  if (requireCombos && !(params.context.selectedCombinationIds?.length)) {
    logAiPipeline(
      "[ITINERARY_INPUT_VALIDATION_FAILED]",
      "field=selectedCombinationIds",
      "value=[]",
      `generationRequestId=${params.context.generationRequestId ?? "unknown"}`,
    );
    logAiState("FAILED", "missing_combination_selection");
    return {
      ok: false,
      state: "FAILED",
      message:
        "我還需要你確認想用哪些組合，才能幫你生成行程。回覆組合編號，或回「都不錯」全選。",
      failureReason: "missing_combination_selection",
      diagnostics: null,
      session: {
        ...session,
        aiItineraryState: "FAILED",
        chatPlanningState: "generationFailed",
        pendingQuestion: {
          type: "activity_choice",
          options: ["重新生成", "都不錯", "幫我生成"],
          baseDestination: label,
        },
      },
    };
  }

  if (canBuildItineraryFromPlaceCount(sessionPlaces.length)) {
    logAiState("SEARCHING_PLACES", `reuse_${source}`);
    logAiPipeline("[ITINERARY_BUILD_FROM_SUGGESTIONS]", `places=${sessionPlaces.length}`);
    logAiState("RANKING", `selected=${sessionPlaces.length}`);
  } else {
    logAiState("SEARCHING_PLACES", normalizeDestinationLabel(destination));
    logAiState("RANKING");
  }

  const prepared = await prepareDirectItinerarySession({ ...params, msgs });
  if (!prepared.ok) {
    const failCode =
      prepared.failure?.code ??
      (prepared.apiEmpty ? "places_api_empty" : "insufficient_places");
    if (!canBuildItineraryFromPlaceCount(sessionPlaces.length)) {
      logAiItineraryFailed(failCode);
      logAiPipeline("[ITINERARY_SAVE_FAILED_REASON]", failCode);
    }
    logAiState("FAILED", failCode);
    const partial = prepared.failure?.partialResolvedPlaces;
    return {
      ok: false,
      state: "FAILED",
      message: prepared.message,
      failureReason: failCode,
      diagnostics: prepared.failure ?? null,
      session: {
        ...session,
        aiItineraryState: "FAILED",
        chatPlanningState: "generationFailed",
        // Keep any successfully mapped places so regenerate can resume.
        selectedPlaces: partial?.length
          ? partial
          : session.selectedPlaces,
        pendingQuestion: {
          type: "activity_choice",
          options: ["重新生成", "must_visit_places", "daily_recommendations"],
          baseDestination: label,
        },
        travelContext: {
          ...(session.travelContext ?? { interests: [] }),
          ...params.context,
          lastItineraryFailure: prepared.failure
            ? {
                code: prepared.failure.code,
                stage: prepared.failure.stage,
                attemptedCandidates: prepared.failure.attemptedCandidates,
                resolvedCandidates: prepared.failure.resolvedCandidates,
                retryCount: prepared.failure.retryCount,
                searchRetryCount: prepared.failure.searchRetryCount,
                candidateRegenerationCount:
                  prepared.failure.candidateRegenerationCount,
                detailRetryCount: prepared.failure.detailRetryCount,
                fallbackCandidateCount: prepared.failure.fallbackCandidateCount,
                generationRequestId: prepared.failure.generationRequestId,
              }
            : params.context.lastItineraryFailure,
          partiallyResolvedPlaces: partial?.length
            ? partial
            : params.context.partiallyResolvedPlaces,
          generationRequestId:
            prepared.failure?.generationRequestId ??
            params.context.generationRequestId,
        },
      },
      offerMustVisit: false,
    };
  }

  const placeCount = prepared.session.selectedPlaces.length;
  const inputCheck = validateDirectItineraryInput({
    destination: label,
    startDate: params.context.startDate,
    endDate: params.context.endDate,
    tripDays: days,
    selectedCombinationIds: params.context.selectedCombinationIds,
    candidatePlaces: prepared.session.selectedPlaces,
    destinationScope: label,
    generationRequestId: params.context.generationRequestId,
    requireCombinations: requireCombos,
  });
  if (!inputCheck.ok) {
    logAiState("FAILED", inputCheck.code ?? "invalid_itinerary_input");
    return {
      ok: false,
      state: "FAILED",
      message:
        inputCheck.code === "no_candidate_places"
          ? "目前暫時找不到足夠的真實景點候選，請點「重新生成」再試一次。"
          : "行程資料還不完整，請確認目的地、天數與組合選擇後再試。",
      failureReason: inputCheck.code ?? "invalid_itinerary_input",
      diagnostics: null,
      session: {
        ...prepared.session,
        aiItineraryState: "FAILED",
        chatPlanningState: "generationFailed",
        pendingQuestion: {
          type: "activity_choice",
          options: ["重新生成", "must_visit_places", "daily_recommendations"],
          baseDestination: label,
        },
      },
    };
  }

  logDirectItineraryGenInput({
    destination: label,
    tripDays: days,
    candidateCount: placeCount,
    selectedCombinationIds: params.context.selectedCombinationIds ?? [],
    weatherCondition:
      typeof params.context.weather?.condition === "string"
        ? params.context.weather.condition
        : null,
  });
  logDirectItineraryGenOutput({
    dayCount: days,
    totalPlaceCount: placeCount,
    isValid: placeCount > 0,
  });

  logAiState("RANKING", `selected=${placeCount}`);
  return {
    ok: true,
    session: { ...prepared.session, aiItineraryState: "RANKING" },
    placeCount,
  };
}

export type DirectItineraryCreateResult =
  | {
      ok: true;
      state: "SUCCESS";
      session: ChatPlanningSession;
      payload: RoamiePayloadV2;
      generateResult: GenerateItineraryResult | null;
    }
  | {
      ok: false;
      state: "FAILED";
      message: string;
      session: ChatPlanningSession;
      offerMustVisit: boolean;
    };

/** selectedPlaces > 0 時用本地排程 fallback（API 失敗也不應顯示建立失敗） */
function buildLocalItineraryPayload(
  generateInput: ItineraryInput,
  selectedPlaces: NonNullable<ItineraryInput["selectedPlaces"]>,
  selectedCombinationIds: number[] = [],
  nearbyExtensions: string[] = [],
): RoamiePayloadV2 | null {
  const startDate =
    generateInput.startDate?.trim() || new Date().toISOString().slice(0, 10);
  const comboIds =
    selectedCombinationIds.length > 0
      ? selectedCombinationIds
      : [
          ...new Set(
            selectedPlaces
              .flatMap((p) => {
                const item = p as typeof p & {
                  matchedSelectedCombinationIds?: number[];
                  sourceCombinationId?: number;
                };
                return (
                  item.matchedSelectedCombinationIds ??
                  (item.sourceCombinationId != null ? [item.sourceCombinationId] : [])
                );
              })
              .filter((id): id is number => typeof id === "number" && id > 0),
          ),
        ].sort((a, b) => a - b);
  let builtStops = buildFallbackItineraryFromPlaces(
    selectedPlaces,
    generateInput.days,
    startDate,
    generateInput.destination,
    {
      selectedCombinationIds: comboIds,
      nearbyExtensions,
    },
  );
  if (nearbyExtensions.length) {
    const dayMap = allocateNearbyExtensionDays(generateInput.days, nearbyExtensions);
    for (const [ext, day] of dayMap) {
      const dayStops = builtStops.filter((s) => (s.dayIndex ?? 0) + 1 === day);
      logNearbyExtensionPersistence({
        extension: ext,
        savedDay: day,
        savedStopCount: dayStops.length,
      });
      logNearbyExtensionUiCompare({
        extension: ext,
        plannerStopCount: dayStops.length,
        persistedStopCount: dayStops.length,
        uiStopCount: dayStops.length,
      });
    }
  }
  logItineraryObjectBuilt(builtStops.length, generateInput.days);
  logItineraryDaysBuilt(generateInput.days, builtStops.length);
  logAiItineraryBuild(builtStops.length, generateInput.days);

  if (selectedPlaces.length < computeMinimumPlacesForTripDays(generateInput.days, comboIds.length || 1)) {
    logAiPipeline(
      "[INSUFFICIENT_REAL_PLACES_DETECTED]",
      `tripDays=${generateInput.days}`,
      `resolvedPlaces=${selectedPlaces.length}`,
      `minimumRequired=${computeMinimumPlacesForTripDays(generateInput.days, comboIds.length || 1)}`,
      "stage=local_build",
    );
    logItineraryValidationResult(false, "insufficient_real_places");
    return null;
  }

  const grouped = groupStopsByTripDays(builtStops, generateInput.days, startDate);
  const integrity = validateGeneratedItinerary({
    tripDays: generateInput.days,
    startDate,
    selectedCombinationIds: comboIds,
    days: grouped,
    resolvedPlaces: selectedPlaces,
  });
  if (!integrity.ok) {
    logAiPipeline(
      "[ITINERARY_INTEGRITY_FAILED]",
      `reasons=${integrity.reasons.join("|")}`,
    );
    logItineraryValidationResult(false, integrity.reasons.join("|"));
    // Never navigate with blank non-free days or missing combination coverage.
    if (
      integrity.reasons.some(
        (r) =>
          r.startsWith("empty_day") ||
          r.startsWith("empty_non_free_day") ||
          r.startsWith("day_count") ||
          r.startsWith("insufficient_real_places") ||
          r.startsWith("missing_combination"),
      )
    ) {
      return null;
    }
  }

  // P4.2：本地 fallback 建立路徑同樣經過 Itinerary Validator + Auto Repair
  if (isItineraryValidatorEnabled()) {
    let composed = composedPlansFromItineraryItems(
      builtStops,
      generateInput.days,
      startDate,
    );
    const styleKey = resolvePlannerStyleKey(generateInput.style);
    const validatorInputBase = {
      requestedDays: generateInput.days,
      style: styleKey,
      plannedDate: startDate,
      endDate: generateInput.endDate?.trim() || undefined,
      nearbyExtensions,
      excludedCategories: generateInput.excludedCategories,
      userText: [generateInput.interests, generateInput.conversationSummary]
        .filter(Boolean)
        .join("\n"),
      destination: generateInput.destination,
      creationPath: (comboIds.length ? "selected_places" : "direct") as
        | "selected_places"
        | "direct",
    };
    let validation = validateItineraryPlan({
      plans: composed,
      ...validatorInputBase,
    });
    if (!validation.pass) {
      const pool: PlaceResult[] = selectedPlaces.map((p) => ({
        id: (p.googlePlaceId ?? p.name).trim(),
        name: p.placeName ?? p.name,
        address: p.address ?? null,
        lat: p.lat ?? null,
        lng: p.lng ?? null,
        rating: p.rating ?? null,
        userRatingCount: p.userRatingCount ?? null,
        photoName: p.photoName ?? null,
        primaryType: p.type ?? null,
        types: p.type ? [p.type] : null,
        businessStatus: null,
        openStatus: "unknown",
        openStatusLabel: "",
        todayHoursLabel: "",
        closingSoonNote: "",
        nextOpenHint: "",
        openNow: null,
      }));
      const replanned = replanUntilItineraryValid(
        {
          plans: composed as unknown as ComposedDayPlan[],
          pool,
          days: generateInput.days,
          style: styleKey,
          plannedDate: startDate,
          nearbyExtensions,
          validatorInput: validatorInputBase,
        },
        validation,
      );
      validation = replanned.validation;
      if (replanned.plans.length) {
        builtStops = applyComposedPlansToItineraryItems(
          builtStops,
          replanned.plans,
          startDate,
        );
        composed = composedPlansFromItineraryItems(
          builtStops,
          generateInput.days,
          startDate,
        );
      }
    }
    const counts = dayCountsOfPlans(composed);
    if (shouldBlockItineraryDelivery(validation)) {
      logItineraryDeliveryBlocked("validator_failed", validation, {
        plans: composed,
        payloadPresent: false,
      });
      logItineraryValidationResult(false, "itinerary_validator_failed");
      return null;
    }
    const compare = compareItineraryPersistenceDayCounts({
      plannerDayCounts: counts,
      validatedDayCounts: counts,
      persistedDayCounts: counts,
      uiDayCounts: counts,
    });
    if (!compare.matched) {
      logItineraryDeliveryBlocked("persistence_mismatch", validation, {
        plans: composed,
        payloadPresent: false,
      });
      return null;
    }
    logItineraryDeliveryAllowed(validation, counts);
  }

  const localPayload: RoamiePayloadV2 = {
    version: 2,
    title: `${generateInput.destination} ${generateInput.days} 天`,
    summary: `依你選的 ${selectedPlaces.length} 個地點排成 ${generateInput.days} 天行程。`,
    moodTag: generateInput.mood ?? "",
    recommendations: selectedPlaces,
    itinerary: builtStops,
    destination: generateInput.destination,
    days: generateInput.days,
    generatedAt: new Date().toISOString(),
  };
  const valid = hasCompleteItineraryPayload(
    localPayload,
    generateInput.days,
    startDate,
  );
  logItineraryValidationResult(
    valid,
    valid ? undefined : "local_payload_invalid",
  );
  if (!valid) return null;
  return unwrapGeneratedTripPayload({
    success: true,
    trip: { payload: localPayload },
  });
}

/** BUILDING_ITINERARY → CREATING_TRIP — selectedPlaces > 0 時必須產出行程 */
export async function createItineraryFromSession(params: {
  session: ChatPlanningSession;
  generateInput: ItineraryInput;
  generateItineraryFn: (args: { data: ItineraryInput }) => Promise<unknown>;
}): Promise<DirectItineraryCreateResult> {
  const { session, generateInput, generateItineraryFn } = params;
  const selectedPlaces = generateInput.selectedPlaces ?? [];
  const selectedCombinationIds =
    session.travelContext?.selectedCombinationIds ?? [];
  const nearbyExtensions = session.travelContext?.nearbyExtensions ?? [];

  if (selectedPlaces.length < 1) {
    logAiItineraryFailed("no_selected_places");
    logAiPipeline("[ITINERARY_SAVE_FAILED_REASON]", "no places");
    logAiState("FAILED", "no_selected_places");
    return {
      ok: false,
      state: "FAILED",
      message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
      session: { ...session, aiItineraryState: "FAILED" },
      offerMustVisit: false,
    };
  }

  logAiState("BUILDING_ITINERARY", `places=${selectedPlaces.length}`);
  logAiPipeline(
    "[AI_RUNTIME_PATH]",
    "serverFnUsed=true",
    "localFallbackUsed=false",
    "bundledRuntime=true",
    "resultVersion=2",
  );

  try {
    logAiState("CREATING_TRIP");
    logAiItineraryCreate(generateInput.destination, selectedPlaces.length);
    const rawGenerateResult = await generateItineraryFn({ data: generateInput });
    const generateResult = normalizeGenerateItineraryResult(rawGenerateResult);

    if (isGenerateItineraryFailure(generateResult)) {
      if (generateResult.errorCode === "itinerary_validator_failed") {
        logItineraryFailureChain({
          primary: "itinerary_validator_failed",
          validator: generateResult.failureReason ?? "validator_failed",
          persistence: undefined,
          payloadPresent: false,
          dayCount: generateResult.diagnostics?.dayCount ?? 0,
          stopCount: generateResult.diagnostics?.stopCount ?? 0,
          affectedDays: generateResult.diagnostics?.affectedDays ?? [],
          failedRules: generateResult.failedRules ?? [],
        });
        logItineraryFailureReason("itinerary_validator_failed");
        logAiItineraryFailed("validator_failed");
        logAiPipeline(
          "[ITINERARY_SAVE_FAILED_REASON]",
          "itinerary_validator_failed",
        );
        logAiState("FAILED", "itinerary_validator_failed");
        return {
          ok: false,
          state: "FAILED",
          message: ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
          session: {
            ...session,
            aiItineraryState: "FAILED",
            phase: "ready",
          },
          offerMustVisit: false,
        };
      }
      const localPayload = buildLocalItineraryPayload(
        generateInput,
        selectedPlaces,
        selectedCombinationIds,
        nearbyExtensions,
      );
      if (localPayload) {
        logAiPipeline(
          "[AI_RUNTIME_PATH]",
          "serverFnUsed=true",
          "localFallbackUsed=true",
          "bundledRuntime=true",
          "resultVersion=2",
        );
        logAiItinerarySuccess();
        logAiState("SUCCESS", "local_build_after_api_fail");
        return {
          ok: true,
          state: "SUCCESS",
          session: { ...session, aiItineraryState: "SUCCESS", phase: "generating" },
          payload: localPayload,
          generateResult,
        };
      }
      const preservedFailureReason = `generate_api_failed:${generateResult.errorCode}`;
      logItineraryFailureChain({
        primary: preservedFailureReason,
        validator: undefined,
        persistence: undefined,
        payloadPresent: false,
        dayCount: 0,
        stopCount: 0,
        failedRules: [],
      });
      logItineraryFailureReason(preservedFailureReason);
      logAiItineraryFailed(preservedFailureReason);
      logAiPipeline("[ITINERARY_SAVE_FAILED_REASON]", "itinerary validation failed");
      logAiState("FAILED", preservedFailureReason);
      return {
        ok: false,
        state: "FAILED",
        message:
          generateResult.errorCode === "persistence_mismatch"
            ? ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE
            : ITINERARY_GENERATION_FAILED_MESSAGE,
        session: {
          ...session,
          aiItineraryState: "FAILED",
          phase: "ready",
        },
        offerMustVisit: false,
      };
    }

    let payload = unwrapGeneratedTripPayload(generateResult);
    const startDate =
      generateInput.startDate?.trim() || new Date().toISOString().slice(0, 10);
    if (
      !payload ||
      !hasCompleteItineraryPayload(payload, generateInput.days, startDate)
    ) {
      const localPayload = buildLocalItineraryPayload(
        generateInput,
        selectedPlaces,
        selectedCombinationIds,
        nearbyExtensions,
      );
      if (localPayload) {
        logAiPipeline(
          "[AI_RUNTIME_PATH]",
          "serverFnUsed=true",
          "localFallbackUsed=true",
          "bundledRuntime=true",
          "resultVersion=2",
        );
        logAiItinerarySuccess();
        logAiState("SUCCESS", "local_build");
        return {
          ok: true,
          state: "SUCCESS",
          session: { ...session, aiItineraryState: "SUCCESS", phase: "generating" },
          payload: localPayload,
          generateResult,
        };
      }
      const stops = payload ? coalesceItineraryItems(payload.itinerary) : [];
      const validStopRatio =
        selectedPlaces.length > 0 ? stops.length / selectedPlaces.length : 0;
      // stop_unwrap_failed is an internal schema issue — never surface to users.
      // Prefer local salvage when ≥80% stops already look usable.
      if (validStopRatio >= 0.8 && stops.length >= generateInput.days) {
        const salvage = buildLocalItineraryPayload(
          generateInput,
          selectedPlaces,
          selectedCombinationIds,
          nearbyExtensions,
        );
        if (salvage) {
          logAiPipeline(
            "[ITINERARY_AUTO_REPAIR]",
            "step=salvage_after_unwrap",
            `validStopRatio=${validStopRatio.toFixed(2)}`,
          );
          logAiItinerarySuccess();
          logAiState("SUCCESS", "salvage_after_unwrap");
          return {
            ok: true,
            state: "SUCCESS",
            session: { ...session, aiItineraryState: "SUCCESS", phase: "generating" },
            payload: salvage,
            generateResult,
          };
        }
      }
      const reason =
        selectedPlaces.length <
        computeMinimumPlacesForTripDays(
          generateInput.days,
          selectedCombinationIds.length || 1,
        )
          ? "insufficient_real_places"
          : stops.length > 0 && stops.length < generateInput.days
            ? "empty_non_free_day"
            : !payload
              ? "payload_incomplete"
              : "invalid_stops_after_unwrap";
      // Preserve root-cause chain — payload_incomplete is often terminal, not primary.
      logItineraryFailureChain({
        primary: stops.length > 0 && stops.length < generateInput.days
          ? "empty_non_free_day"
          : reason,
        validator: undefined,
        persistence: reason === "payload_incomplete" ? "payload_incomplete" : undefined,
        payloadPresent: Boolean(payload),
        dayCount: payload?.days ?? 0,
        stopCount: stops.length,
      });
      logItineraryFailureReason(reason);
      // Keep internal unwrap diagnostics off the user-facing failure path.
      if (!payload || reason === "payload_incomplete") {
        logAiPipeline(
          "[STOP_UNWRAP_INTERNAL]",
          "reason=stop_unwrap_failed",
          "userVisible=false",
        );
      }
      logAiItineraryFailed(reason);
      logAiPipeline("[ITINERARY_SAVE_FAILED_REASON]", reason);
      logAiState("FAILED", reason);
      return {
        ok: false,
        state: "FAILED",
        message:
          reason === "insufficient_real_places"
            ? INSUFFICIENT_ITINERARY_PLACES_MESSAGE
            : ITINERARY_GENERATION_FAILED_MESSAGE,
        session: {
          ...session,
          aiItineraryState: "FAILED",
          phase: "ready",
        },
        offerMustVisit: false,
      };
    }

    // P4.2：API 成功路徑最終閘門 — 再驗一次；soft 失敗走 Auto Repair，勿直接 Fail
    if (isItineraryValidatorEnabled()) {
      let items = coalesceItineraryItems(payload.itinerary);
      let composed = composedPlansFromItineraryItems(
        items,
        generateInput.days,
        startDate,
      );
      const styleKey = resolvePlannerStyleKey(generateInput.style);
      const validatorInputBase = {
        requestedDays: generateInput.days,
        style: styleKey,
        plannedDate: startDate,
        endDate: generateInput.endDate?.trim() || undefined,
        nearbyExtensions,
        excludedCategories: generateInput.excludedCategories,
        userText: [generateInput.interests, generateInput.conversationSummary]
          .filter(Boolean)
          .join("\n"),
        destination: generateInput.destination,
        creationPath: (selectedCombinationIds.length ? "selected_places" : "direct") as
          | "selected_places"
          | "direct",
      };
      let validation = validateItineraryPlan({
        plans: composed,
        ...validatorInputBase,
      });
      if (!validation.pass) {
        const pool: PlaceResult[] = selectedPlaces.map((p) => ({
          id: (p.googlePlaceId ?? p.name).trim(),
          name: p.placeName ?? p.name,
          address: p.address ?? null,
          lat: p.lat ?? null,
          lng: p.lng ?? null,
          rating: p.rating ?? null,
          userRatingCount: p.userRatingCount ?? null,
          photoName: p.photoName ?? null,
          primaryType: p.type ?? null,
          types: p.type ? [p.type] : null,
          businessStatus: null,
          openStatus: "unknown",
          openStatusLabel: "",
          todayHoursLabel: "",
          closingSoonNote: "",
          nextOpenHint: "",
          openNow: null,
        }));
        const replanned = replanUntilItineraryValid(
          {
            plans: composed as unknown as ComposedDayPlan[],
            pool,
            days: generateInput.days,
            style: styleKey,
            plannedDate: startDate,
            nearbyExtensions,
            validatorInput: validatorInputBase,
          },
          validation,
        );
        validation = replanned.validation;
        if (replanned.plans.length) {
          items = applyComposedPlansToItineraryItems(items, replanned.plans, startDate);
          payload = { ...payload, itinerary: items };
          composed = composedPlansFromItineraryItems(
            items,
            generateInput.days,
            startDate,
          );
        }
      }
      const counts = dayCountsOfPlans(composed);
      if (shouldBlockItineraryDelivery(validation)) {
        logItineraryDeliveryBlocked("validator_failed", validation, {
          plans: composed,
          payloadPresent: true,
        });
        logAiState("FAILED", "itinerary_validator_failed");
        return {
          ok: false,
          state: "FAILED",
          message: ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
          session: { ...session, aiItineraryState: "FAILED", phase: "ready" },
          offerMustVisit: false,
        };
      }
      const compare = compareItineraryPersistenceDayCounts({
        plannerDayCounts: counts,
        validatedDayCounts: counts,
        persistedDayCounts: counts,
        uiDayCounts: counts,
      });
      if (!compare.matched) {
        logItineraryDeliveryBlocked("persistence_mismatch", validation, {
          plans: composed,
          payloadPresent: true,
        });
        return {
          ok: false,
          state: "FAILED",
          message: ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
          session: { ...session, aiItineraryState: "FAILED", phase: "ready" },
          offerMustVisit: false,
        };
      }
      logItineraryDeliveryAllowed(validation, counts);
    }

    logItineraryDaysBuilt(generateInput.days, coalesceItineraryItems(payload.itinerary).length);
    logAiPipeline(
      "[ITINERARY_RESULT_TRACE]",
      "plannerSuccess=true",
      "itineraryPresent=true",
      `dayCount=${payload.days ?? generateInput.days}`,
      `stopCount=${coalesceItineraryItems(payload.itinerary).length}`,
      "validatorPass=true",
      "hardFailures=[]",
      "persistenceAttempted=false",
      "persistenceSuccess=false",
      "finalFailureReason=",
    );
    logItineraryValidationResult(true);
    logAiItinerarySuccess();
    logAiState("SUCCESS");
    return {
      ok: true,
      state: "SUCCESS",
      session: { ...session, aiItineraryState: "SUCCESS", phase: "generating" },
      payload,
      generateResult,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const localPayload = buildLocalItineraryPayload(
      generateInput,
      selectedPlaces,
      selectedCombinationIds,
      nearbyExtensions,
    );
    if (localPayload) {
      logAiItinerarySuccess();
      logAiState("SUCCESS", "local_build_after_exception");
      return {
        ok: true,
        state: "SUCCESS",
        session: { ...session, aiItineraryState: "SUCCESS", phase: "generating" },
        payload: localPayload,
        generateResult: {
          success: false,
          errorCode: "exception",
          message: reason,
        },
      };
    }
    logItinerarySaveFailed(reason);
    logItineraryFailureReason(`exception:${reason}`);
    logAiItineraryFailed(reason);
    logAiPipeline("[ITINERARY_SAVE_FAILED_REASON]", reason);
    logAiState("FAILED", reason);
    return {
      ok: false,
      state: "FAILED",
      message: ITINERARY_GENERATION_FAILED_MESSAGE,
      session: {
        ...session,
        aiItineraryState: "FAILED",
        phase: "ready",
      },
      offerMustVisit: false,
    };
  }
}

function coalesceStops(payload: RoamiePayloadV2): unknown[] {
  return Array.isArray(payload.itinerary) ? payload.itinerary : [];
}

export function sessionAfterItineraryFailure(
  session: ChatPlanningSession,
): ChatPlanningSession {
  return {
    ...session,
    aiItineraryState: "FAILED",
    phase: "ready",
    pendingQuestion: undefined,
  };
}
