import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { resolveSuggestedTripDates } from "@/lib/ai/resolve-suggested-trip-dates";

export type TripCreateDates = {
  startDate?: string;
  endDate?: string;
  days: number;
  dayDates: (string | undefined)[];
  hasExplicitDates: boolean;
  source: string;
};

export function logAiDateParseResult(result: TripCreateDates): void {
  logAiPipeline(
    "[AI_DATE_PARSE_RESULT]",
    `startDate=${result.startDate ?? "none"}`,
    `endDate=${result.endDate ?? "none"}`,
    `days=${result.days}`,
    `source=${result.source}`,
  );
}

export function logAiCreateTripDates(result: TripCreateDates): void {
  logAiPipeline(
    "[AI_CREATE_TRIP_DATES]",
    `startDate=${result.startDate ?? "none"}`,
    `endDate=${result.endDate ?? "none"}`,
    `days=${result.days}`,
  );
}

export function logAiCreateItineraryDay(dayIndex: number, date: string | undefined, itemCount: number): void {
  logAiPipeline(
    "[AI_CREATE_ITINERARY_DAY]",
    `dayIndex=${dayIndex}`,
    `date=${date ?? "unset"}`,
    `itemCount=${itemCount}`,
  );
}

export function logTripCardRenderDates(
  tripId: string,
  startDate: string | undefined,
  endDate: string | undefined,
  days: number,
): void {
  logAiPipeline(
    "[TRIP_CARD_RENDER_DATES]",
    `tripId=${tripId}`,
    `startDate=${startDate ?? "none"}`,
    `endDate=${endDate ?? "none"}`,
    `days=${days}`,
  );
}

/**
 * Resolve trip dates when creating an itinerary.
 * Priority: User Date > AI Suggested Date > Month Default.
 * Never silently fall back to "today" when a travel month is known.
 */
export function resolveTripCreateDates(params: {
  context: CanonicalTravelContext;
  session: ChatPlanningSession;
  days: number;
  userText?: string;
}): TripCreateDates {
  const { context, session, days } = params;
  const safeDays = Math.max(1, days);
  const text = params.userText?.trim() ?? "";

  const suggested = resolveSuggestedTripDates({
    days: safeDays,
    userText: text,
    startDate: context.startDate ?? session.tripStartDate,
    endDate: context.endDate ?? session.tripEndDate,
    suggestedStartDate:
      context.suggestedStartDate ?? session.travelContext?.suggestedStartDate,
    travelMonth: context.travelMonth ?? session.travelContext?.travelMonth,
  });

  if (suggested) {
    const dayDates = listTripDates([], suggested.startDate, suggested.days);
    const result: TripCreateDates = {
      startDate: suggested.startDate,
      endDate: suggested.endDate,
      days: suggested.days,
      dayDates,
      hasExplicitDates: true,
      source: suggested.source,
    };
    logAiDateParseResult(result);
    return result;
  }

  const result: TripCreateDates = {
    startDate: undefined,
    endDate: undefined,
    days: safeDays,
    dayDates: Array.from({ length: safeDays }, () => undefined),
    hasExplicitDates: false,
    source: "none",
  };
  logAiDateParseResult(result);
  return result;
}
