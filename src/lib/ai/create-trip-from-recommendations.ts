import type { ChatPlanningSession, ChatPlaceItem } from "@/lib/chat-session";
import type { ChatMsg } from "@/lib/chat-history";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  dayPlanToChatPlaces,
  logAiCreateTripFromDayPlanStart,
  type AiDayPlan,
} from "@/lib/ai/ai-day-plan-source";
import {
  logAiCreateTripSessionValidate,
  isDayPlanSessionValid,
} from "@/lib/ai/ai-planning-session";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logAiConversationState } from "@/lib/ai/ai-chat-conversation-state";
import {
  resolveTripCreateDates,
} from "@/lib/ai/resolve-trip-create-dates";

export function logAiCreateTripStart(): void {
  logAiPipeline("[AI_CREATE_TRIP_START]");
}

export function logAiCreateTripPayload(placeCount: number, destination: string, days: number): void {
  logAiPipeline(
    "[AI_CREATE_TRIP_PAYLOAD]",
    `places=${placeCount}`,
    `destination=${destination}`,
    `days=${days}`,
  );
}

export function logAiCreateTripSuccess(tripId?: string): void {
  logAiPipeline("[AI_CREATE_TRIP_SUCCESS]", tripId ? `tripId=${tripId}` : "pending");
}

export function logAiCreateTripError(reason: string): void {
  console.warn("[AI_CREATE_TRIP_ERROR]", `reason=${reason}`);
}

function resolveDayPlanForCreate(
  session: ChatPlanningSession,
  msgs: ChatMsg[],
): AiDayPlan | undefined {
  if (session.currentDayPlan?.items.length) {
    return session.currentDayPlan;
  }
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m.role !== "assistant") continue;
    const fromRoamie = (m.roamie as { dayPlan?: AiDayPlan } | undefined)?.dayPlan;
    if (fromRoamie?.items.length) return fromRoamie;
  }
  return undefined;
}

export function prepareSessionForCreateTripFromRecommendations(
  session: ChatPlanningSession,
  context: CanonicalTravelContext,
  msgs: ChatMsg[],
): {
  session: ChatPlanningSession;
  places: ChatPlaceItem[];
  destination: string;
  days: number;
  dayPlan: AiDayPlan;
} | null {
  const destination =
    context.destination?.trim() ||
    session.tripDestination?.displayLabel?.trim() ||
    session.tripDestination?.city?.trim();
  const days = context.days ?? session.tripDays;

  if (!destination || !days) {
    logAiCreateTripError("missing_destination_or_days");
    return null;
  }

  const dayPlan = resolveDayPlanForCreate(session, msgs);
  if (!dayPlan?.items.length) {
    logAiCreateTripError("no_day_plan");
    return null;
  }

  logAiCreateTripSessionValidate(session.planningSessionId);
  if (!isDayPlanSessionValid(session, dayPlan)) {
    logAiCreateTripError("stale_day_plan_session");
    return null;
  }

  const lastUserText =
    [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  const tripDates = resolveTripCreateDates({
    context: { ...(session.travelContext ?? context), ...context },
    session,
    days: days!,
    userText: lastUserText,
  });

  logAiCreateTripFromDayPlanStart();
  const label = normalizeDestinationLabel(destination);
  const places = dayPlanToChatPlaces(dayPlan);
  logAiCreateTripPayload(places.length, label, days);

  const nextSession: ChatPlanningSession = {
    ...session,
    phase: "ready",
    aiItineraryState: "CREATING_TRIP",
    selectedPlaces: places,
    recommendedPlaces: places,
    currentDayPlan: dayPlan,
    tripDays: days,
    tripStartDate: tripDates.startDate,
    tripEndDate: tripDates.endDate,
    travelContext: {
      ...(session.travelContext ?? context),
      ...context,
      destination: label,
      days,
      startDate: tripDates.startDate,
      endDate: tripDates.endDate,
      conversationState: "ready_for_itinerary",
      tripPurpose: "create_itinerary",
    },
  };

  logAiConversationState("CREATE_TRIP_FROM_RECOMMENDATIONS");

  return { session: nextSession, places, destination: label, days, dayPlan };
}
