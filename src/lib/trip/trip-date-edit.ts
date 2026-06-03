import type { RoamieItineraryItem, RoamiePayloadV2, TripPlanSettings } from "@/lib/ai/types";
import { daysBetweenDates } from "@/lib/fetch-context";
import { addDaysISO, localTimezone } from "@/lib/picker-utils";
import { attachDayPlansToPayload } from "@/lib/trip/build-day-plans";

export function logTripDateEdited(meta: {
  tripId: string;
  field: "trip_start" | "day_one" | "day";
  oldDate?: string;
  newDate: string;
  dayNumber?: number;
}): void {
  console.info("[TRIP_DATE_EDITED]", meta);
}

export function logTripDatePickerChanged(meta: {
  selectedDateRaw: string;
  selectedDateLocal: string;
  timezone: string;
  endDateRaw?: string;
  endDateLocal?: string;
}): void {
  console.info("[TRIP_DATE_PICKER_CHANGED]", meta);
}

export function logTripDatePickerFromRange(range: { start: string; end: string }): void {
  const timezone = localTimezone();
  logTripDatePickerChanged({
    selectedDateRaw: range.start,
    selectedDateLocal: range.start,
    timezone,
    endDateRaw: range.end !== range.start ? range.end : undefined,
    endDateLocal: range.end !== range.start ? range.end : undefined,
  });
}

export function logTripDatePickerFromSingle(iso: string): void {
  const timezone = localTimezone();
  logTripDatePickerChanged({
    selectedDateRaw: iso,
    selectedDateLocal: iso,
    timezone,
  });
}

export function logTripDateSaveStart(meta: { tripId: string; startDate: string }): void {
  console.info("[TRIP_DATE_SAVE_START]", meta);
}

export function logTripDatesRecalculated(meta: {
  tripId?: string;
  startDate?: string;
  dayDates?: string[];
  oldDates?: string[];
  newDates?: string[];
}): void {
  const dayDates = meta.dayDates ?? meta.newDates ?? [];
  console.info("[TRIP_DATES_RECALCULATED]", {
    day1: dayDates[0] ?? "",
    day2: dayDates[1] ?? "",
    day3: dayDates[2] ?? "",
    dayDates,
    startDate: meta.startDate ?? dayDates[0] ?? "",
    tripId: meta.tripId,
    oldDates: meta.oldDates,
  });
}

export function logTripDateSaveSuccess(meta: { tripId: string; savedStartDate: string }): void {
  console.info("[TRIP_DATE_SAVE_SUCCESS]", meta);
}

export function logTripDateSaveFailed(meta: { error: string }): void {
  console.info("[TRIP_DATE_SAVE_FAILED]", meta);
}

export function logTripDateReloadConfirmed(meta: { tripId: string; startDate: string }): void {
  console.info("[TRIP_DATE_RELOAD_CONFIRMED]", meta);
}

export function logTripDateRendered(meta: {
  tripId: string;
  displayedSummaryDate: string;
  displayedDayDates: string[];
}): void {
  console.info("[TRIP_DATE_RENDERED]", {
    tripId: meta.tripId,
    displayedSummaryDate: meta.displayedSummaryDate,
    displayedDayDates: meta.displayedDayDates,
  });
}

export function logTripDateUiStateUpdated(meta: {
  startDate: string;
  endDate: string;
  dayDates: string[];
}): void {
  console.info("[TRIP_DATE_UI_STATE_UPDATED]", meta);
}

export function logTripDateCacheInvalidated(meta: { tripId: string }): void {
  console.info("[TRIP_DATE_CACHE_INVALIDATED]", meta);
}

export function logTripDateHydrateSource(meta: {
  source: string;
  startDate: string;
  dayDates: string[];
}): void {
  console.info("[TRIP_DATE_HYDRATE_SOURCE]", meta);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoTripDate(value: string | undefined): boolean {
  return Boolean(value?.trim() && ISO_DATE_RE.test(value.trim()));
}

/** 含起迄日的連續本地日曆日（start～end 各算一天） */
export function datesFromInclusiveRange(start: string, end: string): string[] {
  const s = start.trim();
  const e = (end.trim() || s).trim();
  if (!isIsoTripDate(s)) return [];
  const span = daysBetweenDates(s, e);
  return Array.from({ length: span }, (_, i) => addDaysISO(s, i));
}

/** 依第 1 天日期，後續天數連續遞延（本地日曆日） */
export function recalcSequentialDayDates(anchorDate: string, dayCount: number): string[] {
  if (!isIsoTripDate(anchorDate)) return [anchorDate];
  const count = Math.max(1, dayCount);
  return Array.from({ length: count }, (_, i) => addDaysISO(anchorDate, i));
}

export function resolveTripDayDatesFromSettings(
  settings: TripPlanSettings,
  fallbackDayCount = 1,
): string[] {
  const explicit = (settings.tripDayDates ?? []).filter(isIsoTripDate);
  if (explicit.length > 0) return explicit;

  const start = settings.tripStartDate?.trim() ?? "";
  const end = settings.tripEndDate?.trim() || start;
  if (isIsoTripDate(start)) {
    return datesFromInclusiveRange(start, end);
  }

  return recalcSequentialDayDates(start || "", fallbackDayCount);
}

export function remapItemsToDateMap(
  items: RoamieItineraryItem[],
  oldDates: string[],
  newDates: string[],
): RoamieItineraryItem[] {
  const map = new Map<string, string>();
  for (let i = 0; i < Math.min(oldDates.length, newDates.length); i++) {
    map.set(oldDates[i]!, newDates[i]!);
  }
  const fallbackDate = newDates[newDates.length - 1] ?? newDates[0];

  return items.map((item) => {
    const d = item.date?.trim();
    if (!d) return item;
    if (map.has(d)) return { ...item, date: map.get(d) };
    if (oldDates.includes(d) && fallbackDate) {
      return { ...item, date: fallbackDate };
    }
    return item;
  });
}

export function mergeTripDateSettings(
  settings: TripPlanSettings,
  dayDates: string[],
): TripPlanSettings {
  const dates = dayDates.filter(isIsoTripDate);
  return {
    ...settings,
    tripStartDate: dates[0],
    tripEndDate: dates[dates.length - 1],
    tripDayDates: dates,
  };
}

/** 寫入 payload 的單一日期來源：tripSettings + dayPlans + days */
export function applyTripDatesToPayload(
  payload: RoamiePayloadV2,
  settings: TripPlanSettings,
  items: RoamieItineraryItem[],
): RoamiePayloadV2 {
  const dayDates = resolveTripDayDatesFromSettings(settings, items.length || 1);
  const mergedSettings = mergeTripDateSettings(settings, dayDates);
  const base: RoamiePayloadV2 = {
    ...payload,
    itinerary: items,
    tripSettings: mergedSettings,
    days: dayDates.length,
  };
  return attachDayPlansToPayload(base);
}

export type TripDateUiState = {
  settings: TripPlanSettings;
  items: RoamieItineraryItem[];
  dayDates: string[];
  startDate: string;
  endDate: string;
};

export function extractTripDateUiState(
  payload: RoamiePayloadV2,
  baseSettings?: TripPlanSettings,
): TripDateUiState {
  const settings: TripPlanSettings = {
    ...baseSettings,
    ...payload.tripSettings,
  };
  const dayDates = resolveTripDayDatesFromSettings(
    settings,
    payload.days ?? payload.itinerary?.length ?? 1,
  );
  const mergedSettings = mergeTripDateSettings(settings, dayDates);
  const items = [...(payload.itinerary ?? [])];
  return {
    settings: mergedSettings,
    items,
    dayDates,
    startDate: mergedSettings.tripStartDate ?? "",
    endDate: mergedSettings.tripEndDate ?? "",
  };
}

export function applyTripDayOneDateChange(
  tripId: string,
  settings: TripPlanSettings,
  items: RoamieItineraryItem[],
  dayGroups: { dateKey: string }[],
  newDayOne: string,
): { settings: TripPlanSettings; items: RoamieItineraryItem[] } {
  const oldDates =
    settings.tripDayDates?.length > 0
      ? settings.tripDayDates
      : dayGroups.map((d) => d.dateKey);
  const newDates = recalcSequentialDayDates(newDayOne, oldDates.length || dayGroups.length);
  logTripDateEdited({
    tripId,
    field: "day_one",
    oldDate: oldDates[0],
    newDate: newDayOne,
    dayNumber: 1,
  });
  logTripDatesRecalculated({
    tripId,
    oldDates,
    newDates,
    startDate: newDates[0],
    dayDates: newDates,
  });
  const merged = mergeTripDateSettings(settings, newDates);
  return {
    settings: merged,
    items: remapItemsToDateMap(items, oldDates, newDates),
  };
}

export function applyTripDateRangeChange(
  tripId: string,
  settings: TripPlanSettings,
  items: RoamieItineraryItem[],
  range: { start: string; end: string },
): { settings: TripPlanSettings; items: RoamieItineraryItem[] } {
  const end = (range.end?.trim() || range.start).trim();
  const newDates = datesFromInclusiveRange(range.start, end);
  const oldDates =
    settings.tripDayDates?.length > 0
      ? settings.tripDayDates
      : items
          .map((i) => i.date?.trim())
          .filter(isIsoTripDate)
          .filter((d, i, arr) => arr.indexOf(d) === i)
          .sort();

  logTripDateEdited({ tripId, field: "trip_start", oldDate: oldDates[0], newDate: range.start });
  logTripDatesRecalculated({
    tripId,
    oldDates,
    newDates,
    startDate: range.start,
    dayDates: newDates,
  });

  const merged = mergeTripDateSettings(settings, newDates);
  return {
    settings: merged,
    items: remapItemsToDateMap(items, oldDates, newDates),
  };
}
