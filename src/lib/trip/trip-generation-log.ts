import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ItineraryInput } from "@/lib/itinerary.functions";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import { extractTripContextSlice } from "@/lib/ai/trip-context-completeness";

export function logTripGenerationStart(source: string): void {
  console.info("[TRIP_GENERATION_START]", { source, at: new Date().toISOString() });
}

export function logTripGenerationContext(
  form: PlanTripFormInput,
  extra?: Record<string, unknown>,
): void {
  console.info("[TRIP_GENERATION_CONTEXT]", {
    destination: form.destination.displayLabel || form.destination.formattedName,
    origin: form.origin?.displayLabel ?? null,
    startDate: form.startDate || null,
    endDate: form.endDate || null,
    days: form.days,
    travelers: form.travelers,
    budgetMode: form.budgetMode,
    transport: form.transport || null,
    travelStyles: form.styles,
    ...extra,
  });
}

export function logOpenAiRequest(payload: ItineraryInput): void {
  console.info("[OPENAI_REQUEST]", {
    destination: payload.destination,
    days: payload.days,
    budget: payload.budget,
    style: payload.style,
    transport: payload.transport,
    travelers: payload.travelers,
    startDate: payload.startDate,
    endDate: payload.endDate,
    selectedPlacesCount: payload.selectedPlaces?.length ?? 0,
    interestsPreview: payload.interests?.slice(0, 200),
  });
}

export function logOpenAiResponse(params: {
  title?: string;
  itemCount: number;
  dayCount?: number;
}): void {
  console.info("[OPENAI_RESPONSE]", params);
}

export function logItineraryCreated(params: {
  itemCount: number;
  title?: string;
  days?: number;
}): void {
  console.info("[ITINERARY_CREATED]", params);
}

export function logTripSaveSuccess(params: { tripId: string; title: string }): void {
  console.info("[TRIP_SAVE_SUCCESS]", params);
}

export function logTripGenerationError(step: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[TRIP_GENERATION_ERROR]", { step, message });
}

/** 聊天每則訊息後的結構化上下文 */
export function logChatContextParsed(
  session: ChatPlanningSession,
  userText?: string,
): void {
  const slice = extractTripContextSlice(session, userText);
  console.info("[CHAT_CONTEXT_PARSED]", {
    destination: slice.destination ?? null,
    travelDate: slice.travelDate ?? null,
    travelMonth: slice.travelMonth ?? null,
    days: slice.days ?? null,
    budget: session.budget ?? session.conversationContext?.budget ?? null,
    transport: session.transportation ?? session.conversationContext?.transportation ?? null,
    travelStyles: session.tripStyles ?? null,
    travelers: session.tripCompanionCount ?? null,
    fromPlanForm: Boolean(session.fromPlanForm),
    mustIncludePlaces: slice.mustIncludePlaces ?? [],
  });
}

export function logChatGenerateItineraryTriggered(params: {
  source: string;
  destination?: string | null;
  days?: number | null;
  selectedPlacesCount: number;
}): void {
  console.info("[CHAT_GENERATE_ITINERARY_TRIGGERED]", params);
}

export function logChatGenerateItinerarySuccess(params: {
  tripId: string;
  title: string;
  itemCount: number;
  usedLocalFallback: boolean;
}): void {
  console.info("[CHAT_GENERATE_ITINERARY_SUCCESS]", params);
}

export function logChatTripGenerationContext(
  session: ChatPlanningSession,
  extra?: Record<string, unknown>,
): void {
  const slice = extractTripContextSlice(session);
  console.info("[TRIP_GENERATION_CONTEXT]", {
    path: "chat",
    destination: slice.destination ?? null,
    startDate: session.tripStartDate ?? session.conversationContext?.travelDate ?? null,
    endDate: session.tripEndDate ?? session.conversationContext?.travelDateEnd ?? null,
    days: slice.days ?? session.tripDays ?? null,
    travelers: session.tripCompanionCount ?? null,
    budgetMode: session.budget ?? session.conversationContext?.budget ?? null,
    transport: session.transportation ?? null,
    travelStyles: session.tripStyles ?? null,
    ...extra,
  });
}
