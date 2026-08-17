import { parseMonthNumber } from "@/lib/ai/season-response-guardrail";
import { parseTravelDateRangeFromText } from "@/lib/ai/parse-travel-date-range";

export type SuggestedTripDates = {
  startDate: string;
  endDate: string;
  days: number;
  source: "user_date" | "ai_suggested" | "month_default";
};

function addDaysIso(iso: string, offset: number): string {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const base = new Date(year, month - 1, day + offset);
  const y = base.getFullYear();
  const mo = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function isIsoDate(value?: string | null): value is string {
  return Boolean(value?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()));
}

function inclusiveDaysBetween(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T12:00:00`);
  const end = new Date(`${endIso}T12:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 1;
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1;
  return Math.max(1, diff);
}

function yearForMonth(monthNum: number, refDate = new Date()): number {
  const year = refDate.getFullYear();
  // If the month already passed this year, prefer next year.
  if (monthNum < refDate.getMonth() + 1) return year + 1;
  return year;
}

/** AI “中旬” default → day 15 of the month. */
export function midMonthIsoDate(monthNum: number, refDate = new Date()): string {
  const year = yearForMonth(monthNum, refDate);
  const day = 15;
  return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Priority: User Date > AI Suggested Date > Month Default.
 */
export function resolveSuggestedTripDates(params: {
  days: number;
  userText?: string;
  startDate?: string | null;
  endDate?: string | null;
  suggestedStartDate?: string | null;
  travelMonth?: string | null;
  refDate?: Date;
}): SuggestedTripDates | null {
  const safeDays = Math.max(1, params.days || 1);
  const refDate = params.refDate ?? new Date();
  const text = params.userText?.trim() ?? "";

  const fromText = text ? parseTravelDateRangeFromText(text, refDate) : {};
  if (isIsoDate(fromText.startDate)) {
    const start = fromText.startDate;
    const end = isIsoDate(fromText.endDate)
      ? fromText.endDate
      : addDaysIso(start, (fromText.days ?? safeDays) - 1);
    const days = isIsoDate(fromText.endDate)
      ? inclusiveDaysBetween(start, end)
      : (fromText.days ?? safeDays);
    return {
      startDate: start,
      endDate: end,
      days,
      source: "user_date",
    };
  }

  if (isIsoDate(params.startDate)) {
    const start = params.startDate;
    const end = isIsoDate(params.endDate)
      ? params.endDate
      : addDaysIso(start, safeDays - 1);
    const days = isIsoDate(params.endDate) ? inclusiveDaysBetween(start, end) : safeDays;
    return {
      startDate: start,
      endDate: end,
      days,
      source: "user_date",
    };
  }

  if (isIsoDate(params.suggestedStartDate)) {
    const start = params.suggestedStartDate;
    return {
      startDate: start,
      endDate: addDaysIso(start, safeDays - 1),
      days: safeDays,
      source: "ai_suggested",
    };
  }

  const monthNum = parseMonthNumber(params.travelMonth);
  if (monthNum) {
    const start = midMonthIsoDate(monthNum, refDate);
    return {
      startDate: start,
      endDate: addDaysIso(start, safeDays - 1),
      days: safeDays,
      source: "month_default",
    };
  }

  return null;
}
