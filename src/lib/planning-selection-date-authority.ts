import type { RoamiePayloadV2 } from "@/lib/ai/types";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { daysBetweenDates } from "@/lib/fetch-context";
import { listTripDates } from "@/lib/outfit/group-by-date";

export type PlanningSelectionDateAuthority = {
  startDate: string;
  endDate: string;
  tripDays: number;
  dayDates: string[];
  source: "planning_selection";
};

function validDateOnly(value?: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
  );
}

export function resolvePlanningSelectionDateAuthority(
  session: ChatPlanningSession,
): PlanningSelectionDateAuthority | null {
  const nested = session.planningSelection?.dateAuthority;
  const startDate = nested?.startDate ?? session.tripStartDate;
  const endDate = nested?.endDate ?? session.tripEndDate;
  if (!validDateOnly(startDate) || !validDateOnly(endDate) || endDate < startDate) return null;
  const tripDays = daysBetweenDates(startDate, endDate);
  return {
    startDate,
    endDate,
    tripDays,
    dayDates: listTripDates([], startDate, tripDays),
    source: "planning_selection",
  };
}

export function applyPlanningSelectionDateAuthority(
  payload: RoamiePayloadV2,
  authority: PlanningSelectionDateAuthority,
): RoamiePayloadV2 {
  const originalDates = [...new Set(payload.itinerary.map((item) => item.date).filter(Boolean))];
  const dateIndex = new Map(originalDates.map((date, index) => [date, index]));
  return {
    ...payload,
    days: authority.tripDays,
    itinerary: payload.itinerary.map((item) => {
      const index =
        item.dayIndex != null && item.dayIndex >= 0
          ? item.dayIndex
          : (dateIndex.get(item.date) ?? 0);
      return {
        ...item,
        date: authority.dayDates[Math.min(index, authority.dayDates.length - 1)],
        dayIndex: Math.min(index, authority.dayDates.length - 1),
      };
    }),
    tripSettings: {
      ...payload.tripSettings,
      tripStartDate: authority.startDate,
      tripEndDate: authority.endDate,
    },
  };
}

export function logPlanningSelectionDateAuthority(
  stage: string,
  authority: PlanningSelectionDateAuthority | null,
  sessionId?: string,
): void {
  console.info("[PLANNING_SELECTION_DATE_AUTHORITY]", {
    stage,
    sessionId: sessionId ?? "",
    startDate: authority?.startDate ?? null,
    endDate: authority?.endDate ?? null,
    tripDays: authority?.tripDays ?? null,
    dayDates: authority?.dayDates ?? [],
    source: authority?.source ?? "unavailable",
  });
}

export function logPlanningSelectionDateMismatch(
  stage: string,
  authority: PlanningSelectionDateAuthority,
  payload: RoamiePayloadV2,
  sessionId?: string,
): void {
  const actualDayDates = [...new Set(payload.itinerary.map((item) => item.date).filter(Boolean))];
  const actualStartDate = payload.tripSettings?.tripStartDate ?? actualDayDates[0] ?? null;
  const actualEndDate =
    payload.tripSettings?.tripEndDate ?? actualDayDates[actualDayDates.length - 1] ?? null;
  if (
    actualStartDate === authority.startDate &&
    actualEndDate === authority.endDate &&
    actualDayDates.join("|") === authority.dayDates.join("|")
  )
    return;
  console.warn("[PLANNING_SELECTION_DATE_MISMATCH]", {
    firstMismatchStage: stage,
    sessionId: sessionId ?? "",
    expectedStartDate: authority.startDate,
    expectedEndDate: authority.endDate,
    actualStartDate,
    actualEndDate,
    expectedDayDates: authority.dayDates,
    actualDayDates,
  });
}
