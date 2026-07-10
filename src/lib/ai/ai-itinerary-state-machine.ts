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
  hasValidItineraryStops,
  isGenerateItineraryFailure,
  ITINERARY_GENERATION_FAILED_MESSAGE,
  unwrapGeneratedTripPayload,
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
    if (!canBuildItineraryFromPlaceCount(sessionPlaces.length)) {
      logAiItineraryFailed(prepared.apiEmpty ? "places_api_empty" : "insufficient_places");
      logAiPipeline(
        "[ITINERARY_SAVE_FAILED_REASON]",
        prepared.apiEmpty ? "api_empty" : "no places",
      );
    }
    logAiState("FAILED", prepared.apiEmpty ? "places_api_empty" : "insufficient_places");
    return {
      ok: false,
      state: "FAILED",
      message: prepared.message,
      session: {
        ...session,
        aiItineraryState: "FAILED",
        pendingQuestion: prepared.apiEmpty
          ? {
              type: "activity_choice",
              options: ["must_visit_places", "daily_recommendations"],
              baseDestination: label,
            }
          : undefined,
      },
      offerMustVisit: prepared.apiEmpty === true,
    };
  }

  const placeCount = prepared.session.selectedPlaces.length;
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
): RoamiePayloadV2 | null {
  const startDate =
    generateInput.startDate?.trim() || new Date().toISOString().slice(0, 10);
  const builtStops = buildFallbackItineraryFromPlaces(
    selectedPlaces,
    generateInput.days,
    startDate,
    generateInput.destination,
  );
  logItineraryObjectBuilt(builtStops.length, generateInput.days);
  logItineraryDaysBuilt(generateInput.days, builtStops.length);
  logAiItineraryBuild(builtStops.length, generateInput.days);
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
  const valid = hasValidItineraryStops(localPayload, 1);
  logItineraryValidationResult(valid, valid ? undefined : "local_payload_invalid");
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
      const localPayload = buildLocalItineraryPayload(generateInput, selectedPlaces);
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
    if (!payload || !hasValidItineraryStops(payload, 1)) {
      const localPayload = buildLocalItineraryPayload(generateInput, selectedPlaces);
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
      logItineraryFailureReason("invalid_stops_after_unwrap");
      logAiItineraryFailed("invalid_stops");
      logAiPipeline("[ITINERARY_SAVE_FAILED_REASON]", "itinerary validation failed");
      logAiState("FAILED", "invalid_stops");
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

    logItineraryDaysBuilt(generateInput.days, coalesceStops(payload).length);
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
    const localPayload = buildLocalItineraryPayload(generateInput, selectedPlaces);
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
