import type { RoamieItineraryItem, RoamiePayloadV2 } from "@/lib/ai/types";

export type TripDateRangeSource = "trip.start/end" | "itineraryDays" | "startDate+days";

export type TripDateRange = {
  startDate: string;
  endDate: string;
  source: TripDateRangeSource;
};

export type AffiliateTripDateInput = {
  tripId?: string;
  /** camelCase trip fields */
  startDate?: string | null;
  endDate?: string | null;
  /** snake_case DB fields */
  start_date?: string | null;
  end_date?: string | null;
  days?: number;
  dayCount?: number;
  tripSettings?: {
    tripStartDate?: string | null;
    tripEndDate?: string | null;
  } | null;
  payload?: RoamiePayloadV2 | null;
  /** Scheduled day rows (dateKey or date) */
  itineraryDays?: Array<{ date?: string | null; dateKey?: string | null } | string>;
  items?: RoamieItineraryItem[];
};

function normalizeIsoDate(value?: string | null): string | undefined {
  const raw = value?.trim();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return raw;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pickTripStart(input: AffiliateTripDateInput): string | undefined {
  return (
    normalizeIsoDate(input.startDate) ??
    normalizeIsoDate(input.start_date) ??
    normalizeIsoDate(input.tripSettings?.tripStartDate) ??
    normalizeIsoDate(input.payload?.tripSettings?.tripStartDate)
  );
}

function pickTripEnd(input: AffiliateTripDateInput): string | undefined {
  return (
    normalizeIsoDate(input.endDate) ??
    normalizeIsoDate(input.end_date) ??
    normalizeIsoDate(input.tripSettings?.tripEndDate) ??
    normalizeIsoDate(input.payload?.tripSettings?.tripEndDate)
  );
}

function resolveDayCount(input: AffiliateTripDateInput): number {
  const scheduledDays = collectItineraryIsoDates(input);
  if (scheduledDays.length > 0) return scheduledDays.length;
  const raw =
    input.dayCount ??
    input.days ??
    input.payload?.days ??
    0;
  return Math.max(1, raw);
}

function collectItineraryIsoDates(input: AffiliateTripDateInput): string[] {
  const fromDays = (input.itineraryDays ?? [])
    .map((day) => {
      if (typeof day === "string") return day.trim();
      return day.dateKey?.trim() || day.date?.trim() || "";
    })
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

  if (fromDays.length > 0) {
    return [...new Set(fromDays)].sort();
  }

  const fromItems = [
    ...new Set(
      (input.items ?? input.payload?.itinerary ?? [])
        .map((item) => item.date?.trim())
        .filter((d): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d))),
    ),
  ].sort();

  return fromItems;
}

function logTripDateRange(
  tripId: string | undefined,
  range: TripDateRange | null,
  reason?: string,
): void {
  if (range) {
    console.info(
      `[AFFILIATE_TRIP_DATE_RANGE] tripId=${tripId ?? ""} startDate=${range.startDate} endDate=${range.endDate} source=${range.source}`,
    );
    return;
  }
  console.info(
    `[AFFILIATE_DATE_MISSING] tripId=${tripId ?? ""} reason=${reason ?? "no_trip_dates"}`,
  );
}

/** 導購共用：從 trip 真實行程日期解析 start/end（YYYY-MM-DD，本地日曆、無 UTC 偏移） */
export function getTripDateRange(input: AffiliateTripDateInput): TripDateRange | null {
  const tripId = input.tripId?.trim();
  const startFromTrip = pickTripStart(input);
  const endFromTrip = pickTripEnd(input);
  const itineraryDates = collectItineraryIsoDates(input);
  const dayCount = resolveDayCount(input);

  if (startFromTrip) {
    let endDate = endFromTrip;
    let source: TripDateRangeSource = "trip.start/end";

    if (!endDate && itineraryDates.length > 0) {
      endDate = itineraryDates[itineraryDates.length - 1];
    }
    if (!endDate) {
      endDate = addDaysIso(startFromTrip, Math.max(0, dayCount - 1));
      source = endFromTrip ? "trip.start/end" : "startDate+days";
    }
    if (endDate < startFromTrip) {
      endDate = startFromTrip;
    }

    const range: TripDateRange = {
      startDate: startFromTrip,
      endDate,
      source,
    };
    logTripDateRange(tripId, range);
    return range;
  }

  if (itineraryDates.length > 0) {
    const range: TripDateRange = {
      startDate: itineraryDates[0]!,
      endDate: itineraryDates[itineraryDates.length - 1]!,
      source: "itineraryDays",
    };
    logTripDateRange(tripId, range);
    return range;
  }

  logTripDateRange(tripId, null, "missing_start_and_itinerary_dates");
  return null;
}
