import type { TripAffiliateContext } from "@/lib/affiliate/affiliate-types";
import { computeTripNights } from "@/lib/affiliate/affiliate-display-rules";
import { daysBetweenDates } from "@/lib/fetch-context";

function normalizeIsoDate(value?: string | null): string | undefined {
  const raw = value?.trim();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  return raw;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 規劃頁／設定／行程項目日期（不含「今天」fallback） */
export function resolveAffiliatePlanDates(input: {
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  dayCount: number;
  itemDates?: Array<string | null | undefined>;
  viewStartDate?: string | null;
  viewEndDate?: string | null;
}): { startDate?: string; endDate?: string } {
  const fromSettings = normalizeIsoDate(input.tripStartDate);
  if (fromSettings) {
    return {
      startDate: fromSettings,
      endDate: normalizeIsoDate(input.tripEndDate) ?? fromSettings,
    };
  }

  const viewStart = normalizeIsoDate(input.viewStartDate);
  if (viewStart) {
    return {
      startDate: viewStart,
      endDate: normalizeIsoDate(input.viewEndDate) ?? viewStart,
    };
  }

  const isoDates = [
    ...new Set(
      (input.itemDates ?? [])
        .map((d) => d?.trim())
        .filter((d): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d))),
    ),
  ].sort();

  if (isoDates.length > 0) {
    return { startDate: isoDates[0], endDate: isoDates[isoDates.length - 1] };
  }

  return {};
}

/** 住宿 checkIn / checkOut：優先使用者設定，不可用今天替代 */
export function resolveTripStayDates(ctx: TripAffiliateContext): {
  checkIn?: string;
  checkOut?: string;
  nights: number;
  hasUserDates: boolean;
} {
  const startDate = normalizeIsoDate(ctx.startDate);
  let endDate = normalizeIsoDate(ctx.endDate);

  if (startDate && !endDate && ctx.dayCount >= 1) {
    endDate = addDaysIso(startDate, Math.max(0, ctx.dayCount - 1));
  }

  if (!startDate) {
    return { nights: 0, hasUserDates: false };
  }

  const nights = endDate
    ? Math.max(0, daysBetweenDates(startDate, endDate) - 1)
    : computeTripNights(ctx.dayCount, startDate, endDate);

  return {
    checkIn: startDate,
    checkOut: endDate ?? startDate,
    nights,
    hasUserDates: true,
  };
}

export function resolveTripFlightDates(ctx: TripAffiliateContext): {
  startDate?: string;
  endDate?: string;
} {
  const stay = resolveTripStayDates(ctx);
  if (!stay.hasUserDates) return {};
  return { startDate: stay.checkIn, endDate: stay.checkOut };
}
