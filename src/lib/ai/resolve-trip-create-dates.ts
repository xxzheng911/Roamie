import { parseTravelDateRangeFromText } from "@/lib/ai/parse-travel-date-range";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

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

function addDaysIso(iso: string, offset: number): string {
  const base = Date.parse(`${iso}T12:00:00`);
  if (Number.isNaN(base)) return iso;
  const next = new Date(base + offset * 24 * 60 * 60 * 1000);
  return next.toISOString().slice(0, 10);
}

function isIsoDate(value?: string): value is string {
  return Boolean(value?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()));
}

export function resolveTripCreateDates(params: {
  context: CanonicalTravelContext;
  session: ChatPlanningSession;
  days: number;
  userText?: string;
}): TripCreateDates {
  const { context, session, days } = params;
  const safeDays = Math.max(1, days);
  const text = params.userText?.trim() ?? "";

  const parsedRange = text ? parseTravelDateRangeFromText(text) : {};
  const startDate =
    (isIsoDate(context.startDate) ? context.startDate : undefined) ??
    (isIsoDate(session.tripStartDate) ? session.tripStartDate : undefined) ??
    (isIsoDate(parsedRange.startDate) ? parsedRange.startDate : undefined);
  let endDate =
    (isIsoDate(context.endDate) ? context.endDate : undefined) ??
    (isIsoDate(session.tripEndDate) ? session.tripEndDate : undefined) ??
    (isIsoDate(parsedRange.endDate) ? parsedRange.endDate : undefined);

  let source = "none";
  if (parsedRange.startDate || parsedRange.endDate) source = "user_text_range";
  else if (context.startDate || context.endDate) source = "travel_context";
  else if (session.tripStartDate || session.tripEndDate) source = "session";

  if (startDate && !endDate) {
    endDate = addDaysIso(startDate, safeDays - 1);
    source = `${source}+computed_end`;
  }

  const hasExplicitDates = Boolean(startDate && endDate);
  const dayDates: (string | undefined)[] = hasExplicitDates
    ? listTripDates([], startDate!, safeDays)
    : Array.from({ length: safeDays }, () => undefined);

  const result: TripCreateDates = {
    startDate: hasExplicitDates ? startDate : undefined,
    endDate: hasExplicitDates ? endDate : undefined,
    days: safeDays,
    dayDates,
    hasExplicitDates,
    source,
  };
  logAiDateParseResult(result);
  return result;
}
