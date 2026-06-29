import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import { daysBetweenDates } from "@/lib/fetch-context";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { buildLegKey } from "@/lib/transit/types";
import {
  groupStopsByDate,
  flattenStopGroups,
  legKeyForItem,
} from "@/lib/trip/trip-stop-mutations";

/** 縮短行程天數時，超出地點移入此日期 key */
export const TRIP_UNASSIGNED_DATE = "未安排";

export type TripDateRangeValue = { start: string; end: string };

export type ApplyTripDateRangeResult = {
  items: RoamieItineraryItem[];
  tripStartDate: string;
  tripEndDate: string;
  dayCount: number;
  overflowCount: number;
};

function inferTripDatesFromState(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
): TripDateRangeValue {
  const fromSettings = settings.tripStartDate;
  const toSettings = settings.tripEndDate;
  if (fromSettings) {
    return { start: fromSettings, end: toSettings || fromSettings };
  }
  const isoDates = [
    ...new Set(
      items.map((i) => i.date?.trim()).filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d!)),
    ),
  ].sort();
  if (isoDates.length > 0) {
    return { start: isoDates[0]!, end: isoDates[isoDates.length - 1]! };
  }
  const today = new Date().toISOString().slice(0, 10);
  return { start: today, end: today };
}

function orderedScheduledDayKeys(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
): string[] {
  const { start, end } = inferTripDatesFromState(items, settings);
  const dayCount = daysBetweenDates(start, end);
  return listTripDates(items, start, dayCount);
}

/** 預覽縮短天數時會移到「未安排」的地點數量 */
export function countTripDateRangeOverflow(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
  newStart: string,
  newEnd: string,
): number {
  if (!newStart) return 0;
  const newDayCount = daysBetweenDates(newStart, newEnd || newStart);
  const oldDateKeys = orderedScheduledDayKeys(items, settings);
  const groups = groupStopsByDate(items);
  let overflow = 0;
  oldDateKeys.forEach((key, idx) => {
    if (idx >= newDayCount) {
      overflow += (groups.get(key) ?? []).length;
    }
  });
  return overflow;
}

/**
 * 套用新的行程日期區間：
 * - 依序重排各天地點 date
 * - 天數增加：新增空白天
 * - 天數減少：超出地點移到「未安排」（不刪除）
 */
export function applyTripDateRange(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
  newStart: string,
  newEnd: string,
): ApplyTripDateRangeResult {
  const tripStartDate = newStart;
  const tripEndDate = newEnd || newStart;
  const dayCount = daysBetweenDates(tripStartDate, tripEndDate);
  const newDateKeys = listTripDates([], tripStartDate, dayCount);

  const oldDateKeys = orderedScheduledDayKeys(items, settings);
  const groups = groupStopsByDate(items);
  const next: RoamieItineraryItem[] = [];
  let overflowCount = 0;

  oldDateKeys.forEach((oldKey, idx) => {
    const dayItems = groups.get(oldKey) ?? [];
    if (idx < newDateKeys.length) {
      const targetDate = newDateKeys[idx]!;
      for (const item of dayItems) {
        next.push({ ...item, date: targetDate });
      }
    } else {
      for (const item of dayItems) {
        next.push({ ...item, date: TRIP_UNASSIGNED_DATE });
        overflowCount += 1;
      }
    }
  });

  for (const item of groups.get(TRIP_UNASSIGNED_DATE) ?? []) {
    next.push({ ...item, date: TRIP_UNASSIGNED_DATE });
  }

  const handledKeys = new Set([...oldDateKeys, TRIP_UNASSIGNED_DATE]);
  for (const [key, dayItems] of groups) {
    if (handledKeys.has(key)) continue;
    for (const item of dayItems) {
      if (key === "未指定日期" && newDateKeys[0]) {
        next.push({ ...item, date: newDateKeys[0]! });
      } else {
        next.push({ ...item, date: TRIP_UNASSIGNED_DATE });
        overflowCount += 1;
      }
    }
  }

  return {
    items: next,
    tripStartDate,
    tripEndDate,
    dayCount,
    overflowCount,
  };
}

export { inferTripDatesFromState as inferTripDatesForRange };

export function addDaysIso(iso: string, daysToAdd: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + daysToAdd);
  return d.toISOString().slice(0, 10);
}

/** 依 tripSettings 產生連續行程日 ISO 列表（Day 1 = start，Day 2 = start+1 …） */
export function scheduledDateKeysFromSettings(
  settings: TripPlanSettings | undefined,
): string[] {
  const start = settings?.tripStartDate?.trim();
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  const end = settings?.tripEndDate?.trim() || start;
  const dayCount = Math.max(1, daysBetweenDates(start, end));
  return Array.from({ length: dayCount }, (_, i) => addDaysIso(start, i));
}

/**
 * Normalize range-picker output: when only the start shifts, preserve day count
 * and recompute the end (e.g. 6/20–6/22 → start 7/01 ⇒ 7/01–7/03).
 */
export function resolveTripDateRangeChange(
  oldRange: TripDateRangeValue,
  newStart: string,
  newEnd: string,
): TripDateRangeValue {
  const oldDayCount = daysBetweenDates(oldRange.start, oldRange.end);
  const effectiveEnd = newEnd || newStart;

  if (newStart !== oldRange.start && effectiveEnd === oldRange.end) {
    return { start: newStart, end: addDaysIso(newStart, oldDayCount - 1) };
  }

  if (newStart !== oldRange.start && newStart === effectiveEnd && oldDayCount > 1) {
    return { start: newStart, end: addDaysIso(newStart, oldDayCount - 1) };
  }

  if (effectiveEnd < newStart) {
    return { start: newStart, end: addDaysIso(newStart, oldDayCount - 1) };
  }

  return { start: newStart, end: effectiveEnd };
}

/** Recompute tripEndDate after removing one scheduled day. */
export function syncSettingsAfterRemoveDay(
  settings: TripPlanSettings,
  scheduledDayCount: number,
): Pick<TripPlanSettings, "tripEndDate"> {
  const start = settings.tripStartDate?.trim();
  if (!start) return { tripEndDate: settings.tripEndDate };
  const newDayCount = Math.max(1, scheduledDayCount - 1);
  return { tripEndDate: addDaysIso(start, newDayCount - 1) };
}

function collectLegKeys(items: RoamieItineraryItem[]): Set<string> {
  const keys = new Set<string>();
  for (const [, dayItems] of groupStopsByDate(items)) {
    for (let i = 1; i < dayItems.length; i++) {
      const prev = dayItems[i - 1]!;
      const curr = dayItems[i]!;
      keys.add(buildLegKey(prev.placeName || prev.title, curr.placeName || curr.title));
    }
  }
  return keys;
}

function pruneRecordByKeys<T>(
  record: Record<string, T> | undefined,
  validKeys: Set<string>,
): Record<string, T> | undefined {
  if (!record) return undefined;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (validKeys.has(key)) next[key] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function remapDayTransportLabels(
  labels: Record<string, string> | undefined,
  oldDateKeys: string[],
  removedIndex: number,
  newDateKeys: string[],
): Record<string, string> | undefined {
  if (!labels) return undefined;
  const next: Record<string, string> = {};
  oldDateKeys.forEach((oldKey, idx) => {
    if (idx === removedIndex) return;
    const newIdx = idx < removedIndex ? idx : idx - 1;
    const newKey = newDateKeys[newIdx];
    const label = labels[oldKey]?.trim();
    if (newKey && label) next[newKey] = label;
  });
  return Object.keys(next).length > 0 ? next : undefined;
}

export type ApplyRemoveScheduledDayResult = {
  items: RoamieItineraryItem[];
  settings: TripPlanSettings;
  removedStopCount: number;
  removedDayIndex: number;
};

/**
 * 刪除指定行程日：移除該日所有 stop、後續日期遞補重排，並清理交通 / cache 相關 settings。
 */
export function applyRemoveScheduledDay(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
  removeDateKey: string,
): ApplyRemoveScheduledDayResult {
  const oldDateKeys = orderedScheduledDayKeys(items, settings);
  const removedDayIndex = oldDateKeys.indexOf(removeDateKey);

  if (removedDayIndex < 0 || oldDateKeys.length <= 1) {
    return { items, settings, removedStopCount: 0, removedDayIndex: -1 };
  }

  const start = settings.tripStartDate?.trim() || oldDateKeys[0]!;
  const newDayCount = oldDateKeys.length - 1;
  const newDateKeys = listTripDates([], start, newDayCount);
  const groups = groupStopsByDate(items);
  const removedStopCount = (groups.get(removeDateKey) ?? []).length;
  const nextItems: RoamieItineraryItem[] = [];

  oldDateKeys.forEach((oldKey, idx) => {
    if (idx === removedDayIndex) return;
    const newIdx = idx < removedDayIndex ? idx : idx - 1;
    const targetDate = newDateKeys[newIdx]!;
    for (const item of groups.get(oldKey) ?? []) {
      nextItems.push({ ...item, date: targetDate });
    }
  });

  for (const item of groups.get(TRIP_UNASSIGNED_DATE) ?? []) {
    nextItems.push(item);
  }

  const handledKeys = new Set([...oldDateKeys, TRIP_UNASSIGNED_DATE]);
  for (const [key, dayItems] of groups) {
    if (handledKeys.has(key)) continue;
    for (const item of dayItems) {
      nextItems.push({ ...item, date: TRIP_UNASSIGNED_DATE });
    }
  }

  const validLegKeys = collectLegKeys(nextItems);
  const validDestKeys = new Set(nextItems.map((item) => legKeyForItem(item)));

  const nextSettings: TripPlanSettings = {
    ...settings,
    tripStartDate: start,
    tripEndDate: newDateKeys[newDateKeys.length - 1]!,
    dayTransportLabels: remapDayTransportLabels(
      settings.dayTransportLabels,
      oldDateKeys,
      removedDayIndex,
      newDateKeys,
    ),
    transitLegs: pruneRecordByKeys(settings.transitLegs, validLegKeys),
    legTransport: pruneRecordByKeys(settings.legTransport, validDestKeys),
    legMinutes: pruneRecordByKeys(settings.legMinutes, validDestKeys),
  };

  return {
    items: nextItems,
    settings: nextSettings,
    removedStopCount,
    removedDayIndex,
  };
}

/** Change one day's date; shifting Day 1 re-aligns all consecutive days. */
export function updateSingleDayDate(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
  oldDateKey: string,
  newIso: string,
): ApplyTripDateRangeResult {
  if (oldDateKey === newIso || !/^\d{4}-\d{2}-\d{2}$/.test(newIso)) {
    const range = inferTripDatesFromState(items, settings);
    return {
      items,
      tripStartDate: range.start,
      tripEndDate: range.end,
      dayCount: daysBetweenDates(range.start, range.end),
      overflowCount: 0,
    };
  }

  const oldDateKeys = orderedScheduledDayKeys(items, settings);
  const dayIndex = oldDateKeys.indexOf(oldDateKey);

  if (dayIndex === 0) {
    return applyTripDateRange(
      items,
      settings,
      newIso,
      addDaysIso(newIso, Math.max(0, oldDateKeys.length - 1)),
    );
  }

  if (dayIndex < 0) {
    const range = inferTripDatesFromState(items, settings);
    return {
      items,
      tripStartDate: range.start,
      tripEndDate: range.end,
      dayCount: daysBetweenDates(range.start, range.end),
      overflowCount: 0,
    };
  }

  const groups = groupStopsByDate(items);
  const dayItems = groups.get(oldDateKey) ?? [];
  groups.delete(oldDateKey);
  groups.set(
    newIso,
    dayItems.map((item) => ({ ...item, date: newIso })),
  );

  const newScheduledKeys = oldDateKeys.map((k, i) => (i === dayIndex ? newIso : k));
  const tripStartDate = settings.tripStartDate?.trim() || newScheduledKeys[0]!;
  const tripEndDate = newScheduledKeys[newScheduledKeys.length - 1]!;

  return {
    items: flattenStopGroups(groups),
    tripStartDate,
    tripEndDate,
    dayCount: newScheduledKeys.length,
    overflowCount: 0,
  };
}
