import type { TripAffiliateContext } from "@/lib/affiliate/affiliate-types";
import { computeTripNights } from "@/lib/affiliate/affiliate-display-rules";
import {
  getTripDateRange,
  type AffiliateTripDateInput,
  type TripDateRange,
} from "@/lib/affiliate/get-trip-date-range";
import { daysBetweenDates } from "@/lib/fetch-context";

export type { AffiliateTripDateInput, TripDateRange, TripDateRangeSource } from "@/lib/affiliate/get-trip-date-range";
export { getTripDateRange } from "@/lib/affiliate/get-trip-date-range";

function resolveContextDateRange(ctx: TripAffiliateContext): TripDateRange | null {
  if (ctx.startDate && ctx.endDate) {
    return {
      startDate: ctx.startDate,
      endDate: ctx.endDate,
      source: "trip.start/end",
    };
  }

  return getTripDateRange({
    tripId: ctx.tripId,
    startDate: ctx.startDate,
    endDate: ctx.endDate,
    dayCount: ctx.dayCount,
    payload: ctx.payload,
    items: ctx.items,
    itineraryDays: ctx.itineraryDays,
  });
}

/** @deprecated Prefer getTripDateRange — kept for call sites passing explicit fields */
export function resolveAffiliatePlanDates(input: AffiliateTripDateInput): {
  startDate?: string;
  endDate?: string;
} {
  const range = getTripDateRange(input);
  if (!range) return {};
  return { startDate: range.startDate, endDate: range.endDate };
}

/** Trip.com 住宿 checkIn / checkOut */
export function resolveTripStayDates(ctx: TripAffiliateContext): {
  checkIn?: string;
  checkOut?: string;
  nights: number;
  hasUserDates: boolean;
} {
  const range = resolveContextDateRange(ctx);
  if (!range) {
    return { nights: 0, hasUserDates: false };
  }

  const nights = Math.max(0, daysBetweenDates(range.startDate, range.endDate) - 1);

  return {
    checkIn: range.startDate,
    checkOut: range.endDate,
    nights,
    hasUserDates: true,
  };
}

/** Agoda 住宿 checkIn / checkOut（退房日 = 行程最後一天） */
export function resolveAgodaStayDates(ctx: TripAffiliateContext): {
  checkIn?: string;
  checkOut?: string;
} {
  const range = resolveContextDateRange(ctx);
  if (!range) return {};
  return {
    checkIn: range.startDate,
    checkOut: range.endDate,
  };
}

export function resolveTripFlightDates(ctx: TripAffiliateContext): {
  departDate?: string;
  returnDate?: string;
} {
  const range = resolveContextDateRange(ctx);
  if (!range) return {};
  return {
    departDate: range.startDate,
    returnDate: range.endDate,
  };
}
