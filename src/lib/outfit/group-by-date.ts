import type { RoamieItineraryItem } from "@/lib/ai/types";
import { addDaysISO, parseISODate, todayISO, toISODate } from "@/lib/picker-utils";

export function groupItineraryByDate(items: RoamieItineraryItem[]): Map<string, RoamieItineraryItem[]> {
  const groups = new Map<string, RoamieItineraryItem[]>();
  for (const item of items) {
    const key = item.date?.trim() || "未指定日期";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

export function listTripDates(
  items: RoamieItineraryItem[],
  startDate: string,
  days: number,
): string[] {
  const fromItems = [...new Set(items.map((i) => i.date?.trim()).filter(Boolean))] as string[];
  if (fromItems.length >= days) {
    return fromItems.sort().slice(0, days);
  }
  const base = startDate || todayISO();
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    out.push(addDaysISO(base, i));
  }
  return out;
}
