import type { RoamieItineraryItem } from "@/lib/ai/types";

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
): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  const dayList = [...(groups.get(date) ?? [])];
  const target = indexInDay + direction;
  if (target < 0 || target >= dayList.length) return items;
  const [removed] = dayList.splice(indexInDay, 1);
  dayList.splice(target, 0, removed!);
  groups.set(date, dayList);
  return flattenStopGroups(groups);
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

export function sortStopsInDayByTime(items: RoamieItineraryItem[], date: string): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  const dayList = [...(groups.get(date) ?? [])];
  const parse = (t: string) => {
    const m = t.trim().match(/(\d{1,2}):(\d{2})/);
    if (!m) return 9999;
    return Number.parseInt(m[1], 10) * 60 + Number.parseInt(m[2], 10);
  };
  dayList.sort((a, b) => parse(a.time ?? "") - parse(b.time ?? ""));
  groups.set(date, dayList);
  return flattenStopGroups(groups);
}

export function legKeyForItem(item: RoamieItineraryItem): string {
  return item.placeName || item.title;
}
