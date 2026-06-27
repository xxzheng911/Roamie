import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { Locale } from "@/lib/i18n/types";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { buildTripFromSelectedPlaces } from "@/lib/place-planning-memory";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import type { PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import type { WeatherSummary } from "@/lib/weather-types";
import { prepareDirectItinerarySession } from "@/lib/ai/itinerary-place-fetch";
import {
  buildFallbackItineraryFromPlaces,
  hasValidItineraryStops,
  isGenerateItineraryFailure,
  unwrapGeneratedTripPayload,
  type GenerateItineraryResult,
} from "@/lib/trip/itinerary-guards";
import { INSUFFICIENT_ITINERARY_PLACES_MESSAGE } from "@/lib/ai/generic-place-label";
import type { ItineraryInput } from "@/lib/itinerary.functions";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

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

export function logAiState(state: AiItineraryState, detail?: string): void {
  console.info("[AI_STATE]", `state=${state}`, detail ? `detail=${detail}` : "");
}

export function logAiItineraryBuild(stops: number, days: number): void {
  console.info("[AI_ITINERARY_BUILD]", `stops=${stops}`, `days=${days}`);
}

export function logAiItineraryCreate(destination: string, placeCount: number): void {
  console.info(
    "[AI_ITINERARY_CREATE]",
    `destination=${destination}`,
    `places=${placeCount}`,
  );
}

export function logAiItinerarySuccess(tripId?: string): void {
  console.info("[AI_ITINERARY_SUCCESS]", tripId ? `tripId=${tripId}` : "draft");
}

export function logAiItineraryFailed(reason: string): void {
  console.warn("[AI_ITINERARY_FAILED]", `reason=${reason}`);
}

export type DirectItineraryPrepareResult =
  | { ok: true; session: ChatPlanningSession; placeCount: number }
  | { ok: false; state: "FAILED"; message: string; session: ChatPlanningSession };

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
}): Promise<DirectItineraryPrepareResult> {
  const { session, context } = params;
  logAiState("COLLECTING");

  const destination =
    context.destination?.trim() ||
    session.tripDestination?.displayLabel?.trim() ||
    session.tripDestination?.city?.trim();
  const days = context.days ?? session.tripDays;

  if (!destination || !days) {
    logAiItineraryFailed("missing_destination_or_days");
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

  const existing = buildTripFromSelectedPlaces(session);
  const minRequired = Math.max(3, Math.min(days, 8));

  if (existing.length >= minRequired) {
    logAiState("SEARCHING_PLACES", "reuse_session_places");
    logAiState("RANKING", `selected=${existing.length}`);
    const prepared = await prepareDirectItinerarySession({
      ...params,
      session: {
        ...session,
        selectedPlaces: existing,
        plannedStops: existing,
      },
    });
    if (prepared.ok) {
      return {
        ok: true,
        session: { ...prepared.session, aiItineraryState: "RANKING" },
        placeCount: existing.length,
      };
    }
  }

  logAiState("SEARCHING_PLACES", normalizeDestinationLabel(destination));
  logAiState("RANKING");

  const prepared = await prepareDirectItinerarySession(params);
  if (!prepared.ok) {
    logAiItineraryFailed("insufficient_places");
    logAiState("FAILED", "insufficient_places");
    return {
      ok: false,
      state: "FAILED",
      message: prepared.message,
      session: {
        ...session,
        aiItineraryState: "FAILED",
        pendingQuestion: undefined,
      },
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
      logAiItineraryFailed(generateResult.errorCode);
      logAiState("FAILED", generateResult.errorCode);
      return {
        ok: false,
        state: "FAILED",
        message: AI_ITINERARY_FAILED_OFFER_MESSAGE,
        session: {
          ...session,
          aiItineraryState: "FAILED",
          phase: "ready",
          pendingQuestion: {
            type: "activity_choice",
            options: ["must_visit_places", "daily_recommendations"],
            baseDestination: generateInput.destination,
          },
        },
        offerMustVisit: true,
      };
    }

    const payload = unwrapGeneratedTripPayload(generateResult);
    if (!payload || !hasValidItineraryStops(payload, 1)) {
      const startDate =
        generateInput.startDate?.trim() || new Date().toISOString().slice(0, 10);
      const builtStops = buildFallbackItineraryFromPlaces(
        selectedPlaces,
        generateInput.days,
        startDate,
      );
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
      if (!hasValidItineraryStops(localPayload, 1)) {
        logAiItineraryFailed("invalid_stops");
        logAiState("FAILED", "invalid_stops");
        return {
          ok: false,
          state: "FAILED",
          message: AI_ITINERARY_FAILED_OFFER_MESSAGE,
          session: {
            ...session,
            aiItineraryState: "FAILED",
            phase: "ready",
            pendingQuestion: {
              type: "activity_choice",
              options: ["must_visit_places", "daily_recommendations"],
              baseDestination: generateInput.destination,
            },
          },
          offerMustVisit: true,
        };
      }
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
    logAiItineraryFailed(reason);
    logAiState("FAILED", reason);
    return {
      ok: false,
      state: "FAILED",
      message: AI_ITINERARY_FAILED_OFFER_MESSAGE,
      session: {
        ...session,
        aiItineraryState: "FAILED",
        phase: "ready",
        pendingQuestion: {
          type: "activity_choice",
          options: ["must_visit_places", "daily_recommendations"],
          baseDestination: generateInput.destination,
        },
      },
      offerMustVisit: true,
    };
  }
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
