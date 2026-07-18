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
import { prepareDirectItinerarySession } from "@/lib/ai/itinerary-place-fetch";
import {
  buildFallbackItineraryFromPlaces,
  coalesceItineraryItems,
  hasCompleteItineraryPayload,
  hasValidItineraryStops,
  isGenerateItineraryFailure,
  ITINERARY_GENERATION_FAILED_MESSAGE,
  unwrapGeneratedTripPayload,
  validateGeneratedItinerary,
  type GenerateItineraryResult,
} from "@/lib/trip/itinerary-guards";
import { INSUFFICIENT_ITINERARY_PLACES_MESSAGE } from "@/lib/ai/generic-place-label";
import type { ItineraryInput } from "@/lib/itinerary.functions";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
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
    const partial =
      prepared.failure &&
      "partialResolvedPlaces" in prepared.failure
        ? (prepared.failure as { partialResolvedPlaces?: typeof session.selectedPlaces })
            .partialResolvedPlaces
        : undefined;
    return {
      ok: false,
      state: "FAILED",
      message: prepared.message,
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
      generateResult: GenerateItineraryResult;
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
  const builtStops = buildFallbackItineraryFromPlaces(
    selectedPlaces,
    generateInput.days,
    startDate,
    generateInput.destination,
    { selectedCombinationIds: comboIds },
  );
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
  return localPayload;
}

/** BUILDING_ITINERARY → CREATING_TRIP — selectedPlaces > 0 時必須產出行程 */
export async function createItineraryFromSession(params: {
  session: ChatPlanningSession;
  generateInput: ItineraryInput;
  generateItineraryFn: (args: { data: ItineraryInput }) => Promise<GenerateItineraryResult>;
}): Promise<DirectItineraryCreateResult> {
  const { session, generateInput, generateItineraryFn } = params;
  const selectedPlaces = generateInput.selectedPlaces ?? [];
  const selectedCombinationIds =
    session.travelContext?.selectedCombinationIds ?? [];

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

  try {
    logAiState("CREATING_TRIP");
    logAiItineraryCreate(generateInput.destination, selectedPlaces.length);
    const generateResult = await generateItineraryFn({ data: generateInput });

    if (isGenerateItineraryFailure(generateResult)) {
      const localPayload = buildLocalItineraryPayload(
        generateInput,
        selectedPlaces,
        selectedCombinationIds,
      );
      if (localPayload) {
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
      logItineraryFailureReason(`generate_api_failed:${generateResult.errorCode}`);
      logAiItineraryFailed(generateResult.errorCode);
      logAiPipeline("[ITINERARY_SAVE_FAILED_REASON]", "itinerary validation failed");
      logAiState("FAILED", generateResult.errorCode);
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

    const payload = unwrapGeneratedTripPayload(generateResult);
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
      );
      if (localPayload) {
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
      const reason =
        selectedPlaces.length < computeMinimumPlacesForTripDays(generateInput.days, comboIds.length || 1)
          ? "insufficient_real_places"
          : stops.length > 0 && stops.length < generateInput.days
            ? "empty_non_free_day"
            : !payload
              ? "stop_unwrap_failed"
              : "invalid_stops_after_unwrap";
      logItineraryFailureReason(reason);
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

    logItineraryDaysBuilt(generateInput.days, coalesceItineraryItems(payload.itinerary).length);
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
