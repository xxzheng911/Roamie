import type { RoamieItineraryItem } from "@/lib/ai/types";

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
  const base = startDate.trim() || localIsoToday();
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    out.push(addCalendarDaysIso(base, i));
  }
  return out;
}

function localIsoToday(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/** Date-only add — avoid UTC toISOString shift on YYYY-MM-DD strings. */
function addCalendarDaysIso(iso: string, offset: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
