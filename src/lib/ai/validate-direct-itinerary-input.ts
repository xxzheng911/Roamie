import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { ChatPlaceItem } from "@/lib/chat-session";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export type DirectItineraryInputValidation = {
  ok: boolean;
  code?: string;
  field?: string;
  value?: unknown;
  stage: "direct_generator";
};

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/**
 * Schema gate before Direct Generator — never enter generation with empty / invalid input.
 */
export function validateDirectItineraryInput(params: {
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  tripDays?: number | null;
  selectedCombinationIds?: number[] | null;
  candidatePlaces?: ChatPlaceItem[] | null;
  destinationScope?: string | null;
  generationRequestId?: string | null;
  requireCombinations?: boolean;
}): DirectItineraryInputValidation {
  const stage = "direct_generator" as const;
  const requestId = params.generationRequestId?.trim() || "unknown";

  const fail = (code: string, field: string, value: unknown): DirectItineraryInputValidation => {
    logAiPipeline(
      "[ITINERARY_INPUT_VALIDATION_FAILED]",
      `field=${field}`,
      `value=${typeof value === "string" ? value : JSON.stringify(value)}`,
      `generationRequestId=${requestId}`,
      `code=${code}`,
    );
    return { ok: false, code, field, value, stage };
  };

  const destination = params.destination?.trim() ?? "";
  if (!destination) {
    return fail("invalid_itinerary_input", "destination", params.destination);
  }

  const tripDays = params.tripDays;
  if (typeof tripDays !== "number" || !Number.isInteger(tripDays) || tripDays < 1) {
    return fail("invalid_itinerary_input", "tripDays", tripDays);
  }

  if (params.startDate != null && params.startDate !== "" && !isIsoDate(params.startDate)) {
    return fail("invalid_itinerary_input", "startDate", params.startDate);
  }
  if (params.endDate != null && params.endDate !== "" && !isIsoDate(params.endDate)) {
    return fail("invalid_itinerary_input", "endDate", params.endDate);
  }

  if (!Array.isArray(params.candidatePlaces)) {
    return fail("invalid_itinerary_input", "candidatePlaces", params.candidatePlaces);
  }

  if (params.candidatePlaces.length === 0) {
    return fail("no_candidate_places", "candidatePlaces", []);
  }

  if (params.requireCombinations) {
    const ids = params.selectedCombinationIds ?? [];
    if (!Array.isArray(ids) || ids.length === 0) {
      return fail("invalid_itinerary_input", "selectedCombinationIds", ids);
    }
  }

  return { ok: true, stage };
}

export function logDirectItineraryGenInput(payload: {
  destination: string;
  tripDays: number;
  candidateCount: number;
  selectedCombinationIds: number[];
  ruleCount?: number;
  weatherCondition?: string | null;
}): void {
  logAiPipeline("[ITINERARY_DIRECT_GEN_INPUT]", {
    destination: payload.destination,
    tripDays: payload.tripDays,
    candidateCount: payload.candidateCount,
    selectedCombinationIds: payload.selectedCombinationIds,
    ruleCount: payload.ruleCount ?? 0,
    weatherCondition: payload.weatherCondition ?? null,
  });
}

export function logDirectItineraryGenOutput(payload: {
  dayCount: number;
  totalPlaceCount: number;
  isValid: boolean;
}): void {
  logAiPipeline("[ITINERARY_DIRECT_GEN_OUTPUT]", payload);
}

export function contextRequiresCombinationSelection(
  context: CanonicalTravelContext,
): boolean {
  return Boolean(
    context.offeredCombinations?.length ||
      context.selectedCombinationIds?.length ||
      context.tripPurpose === "combination_suggestions_offered" ||
      context.tripPurpose === "route_combination_selected" ||
      context.selectionSource,
  );
}
