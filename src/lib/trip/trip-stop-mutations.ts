import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import { scheduledDateKeysFromSettings, TRIP_UNASSIGNED_DATE } from "@/lib/saved-trip/apply-trip-date-range";

export function groupStopsByDate(items: RoamieItineraryItem[]): Map<string, RoamieItineraryItem[]> {
  const groups = new Map<string, RoamieItineraryItem[]>();
  for (const item of items) {
    const key = item.date?.trim() || "未指定日期";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

/** 依行程日期順序列出各天（與編輯器 day tab 一致） */
export function orderedTripDateKeys(
  items: RoamieItineraryItem[],
  settings?: TripPlanSettings,
  fallbackStart?: string,
): string[] {
  const groups = groupStopsByDate(items);
  const fromSettings = scheduledDateKeysFromSettings(settings);
  if (fromSettings.length > 0) {
    const keys = [...fromSettings];
    if ((groups.get(TRIP_UNASSIGNED_DATE)?.length ?? 0) > 0) {
      keys.push(TRIP_UNASSIGNED_DATE);
    }
    return keys;
  }
  const keys = listTripDateKeys(items, fallbackStart).filter((k) => k !== TRIP_UNASSIGNED_DATE);
  if ((groups.get(TRIP_UNASSIGNED_DATE)?.length ?? 0) > 0) {
    keys.push(TRIP_UNASSIGNED_DATE);
  }
  return keys;
}

export function flattenStopGroups(groups: Map<string, RoamieItineraryItem[]>): RoamieItineraryItem[] {
  const keys = [...groups.keys()].sort();
  const out: RoamieItineraryItem[] = [];
  for (const key of keys) {
    out.push(...(groups.get(key) ?? []));
  }
  return out;
}

export function listTripDateKeys(items: RoamieItineraryItem[], fallbackStart?: string): string[] {
  const keys = [...new Set(items.map((i) => i.date?.trim() || "未指定日期"))];
  if (keys.length > 0) return keys.sort();
  if (fallbackStart) return [fallbackStart];
  return [new Date().toISOString().slice(0, 10)];
}

export function insertStopOnDate(
  items: RoamieItineraryItem[],
  stop: RoamieItineraryItem,
  opts: { date: string; position: "start" | "end"; afterPlaceName?: string },
): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  const dateKey = opts.date.trim() || "未指定日期";
  const dayList = [...(groups.get(dateKey) ?? [])];
  const next = { ...stop, date: dateKey };

  if (opts.afterPlaceName) {
    const idx = dayList.findIndex(
      (i) => i.placeName === opts.afterPlaceName || i.title === opts.afterPlaceName,
    );
    if (idx >= 0) {
      dayList.splice(idx + 1, 0, next);
    } else {
      dayList.push(next);
    }
  } else if (opts.position === "start") {
    dayList.unshift(next);
  } else {
    dayList.push(next);
  }

  groups.set(dateKey, dayList);
  return flattenStopGroups(groups);
}

export function removeStopAt(items: RoamieItineraryItem[], date: string, indexInDay: number): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  const dayList = [...(groups.get(date) ?? [])];
  dayList.splice(indexInDay, 1);
  if (dayList.length === 0) groups.delete(date);
  else groups.set(date, dayList);
  return flattenStopGroups(groups);
}

export function moveStopInDay(
  items: RoamieItineraryItem[],
  date: string,
  indexInDay: number,
  direction: -1 | 1,
  dayIndex = 0,
): RoamieItineraryItem[] {
  const target = indexInDay + direction;
  return reorderStopInDay(items, date, indexInDay, target, dayIndex);
}

export function updateStop(
  items: RoamieItineraryItem[],
  date: string,
  indexInDay: number,
  patch: Partial<RoamieItineraryItem>,
): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  const dayList = [...(groups.get(date) ?? [])];
  if (!dayList[indexInDay]) return items;
  dayList[indexInDay] = { ...dayList[indexInDay]!, ...patch };
  groups.set(date, dayList);
  return flattenStopGroups(groups);
}

export function addEmptyDay(items: RoamieItineraryItem[], isoDate: string): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  if (!groups.has(isoDate)) groups.set(isoDate, []);
  return flattenStopGroups(groups);
}

export function removeDay(items: RoamieItineraryItem[], date: string): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  groups.delete(date);
  return flattenStopGroups(groups);
}

export function nextDayIsoAfter(items: RoamieItineraryItem[], fallbackStart?: string): string {
  const keys = listTripDateKeys(items, fallbackStart).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const base = keys.length > 0 ? keys[keys.length - 1]! : fallbackStart ?? new Date().toISOString().slice(0, 10);
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function sortStopsInDayByTime(
  items: RoamieItineraryItem[],
  date: string,
  dayIndex = 0,
): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  const dayList = [...(groups.get(date) ?? [])];
  const parse = (t: string) => {
    const m = t.trim().match(/(\d{1,2}):(\d{2})/);
    if (!m) return 9999;
    return Number.parseInt(m[1], 10) * 60 + Number.parseInt(m[2], 10);
  };
  dayList.sort((a, b) => parse(a.time ?? "") - parse(b.time ?? ""));
  groups.set(date, normalizeDayStopOrder(dayList, dayIndex, date));
  return flattenStopGroups(groups);
}

export function legKeyForItem(item: RoamieItineraryItem): string {
  return item.placeName || item.title;
}

/** 依畫面順序寫入 dayIndex / sortIndex / order，並同步 date 避免 reorder 後分組錯亂 */
export function normalizeDayStopOrder(
  dayItems: RoamieItineraryItem[],
  dayIndex: number,
  dateKey?: string,
): RoamieItineraryItem[] {
  return dayItems.map((item, sortIndex) => ({
    ...item,
    ...(dateKey ? { date: dateKey } : {}),
    dayIndex,
    sortIndex,
    order: sortIndex,
  }));
}

export function replaceDayItemsInItinerary(
  items: RoamieItineraryItem[],
  dateKey: string,
  dayItems: RoamieItineraryItem[],
): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  groups.set(dateKey, dayItems);
  return flattenStopGroups(groups);
}

export function reorderStopInDay(
  items: RoamieItineraryItem[],
  date: string,
  fromIndex: number,
  toIndex: number,
  dayIndex = 0,
): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  const dayList = [...(groups.get(date) ?? [])];
  if (fromIndex < 0 || fromIndex >= dayList.length || toIndex < 0 || toIndex >= dayList.length) {
    return items;
  }
  if (fromIndex === toIndex) return items;
  const [removed] = dayList.splice(fromIndex, 1);
  dayList.splice(toIndex, 0, removed!);
  groups.set(date, normalizeDayStopOrder(dayList, dayIndex, date));
  return flattenStopGroups(groups);
}

export type CrossDayMovePosition =
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "afterIndex"; afterIndex: number };

/** 將地點從來源日移至目標日指定位置（非複製） */
export function moveStopAcrossDays(
  items: RoamieItineraryItem[],
  sourceDate: string,
  sourceIndexInDay: number,
  targetDate: string,
  position: CrossDayMovePosition,
  sourceDayIndex: number,
  targetDayIndex: number,
): RoamieItineraryItem[] {
  if (sourceDate === targetDate) return items;

  const groups = groupStopsByDate(items);
  const sourceList = [...(groups.get(sourceDate) ?? [])];
  if (sourceIndexInDay < 0 || sourceIndexInDay >= sourceList.length) return items;

  const [moved] = sourceList.splice(sourceIndexInDay, 1);
  if (sourceList.length === 0) groups.delete(sourceDate);
  else groups.set(sourceDate, normalizeDayStopOrder(sourceList, sourceDayIndex, sourceDate));

  const targetList = [...(groups.get(targetDate) ?? [])];
  const next: RoamieItineraryItem = { ...moved!, date: targetDate };

  if (position.kind === "start") {
    targetList.unshift(next);
  } else if (position.kind === "end") {
    targetList.push(next);
  } else {
    const insertAt = Math.min(Math.max(0, position.afterIndex + 1), targetList.length);
    targetList.splice(insertAt, 0, next);
  }
  groups.set(targetDate, normalizeDayStopOrder(targetList, targetDayIndex, targetDate));

  return flattenStopGroups(groups);
}
