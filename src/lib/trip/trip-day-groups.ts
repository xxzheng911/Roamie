/**
 * Trip Workspace — 行程頁天數分組（行程分頁、總覽、地圖共用的唯一規則）。
 * 純邏輯模組：不得有 "@/..." 的值 import（型別可用 import type），只以相對路徑 .ts import 純模組，
 * 需相容 node --experimental-strip-types。
 *
 * 行為與 SavedTripItineraryEditor 原 buildDayGroups（HEAD aa2db59）完全相同。
 * 下方私有 helper 為以下模組的逐字等價實作（原模組有 "@/..." 值 import，無法在 node 直接載入）：
 *   - TRIP_UNASSIGNED_DATE／addDaysIso／scheduledDateKeysFromSettings：src/lib/saved-trip/apply-trip-date-range.ts
 *   - daysBetweenDates：src/lib/fetch-context.ts
 *   - groupStopsByDate／listTripDateKeys：src/lib/trip/trip-stop-mutations.ts
 *   - inferTripDates：SavedTripItineraryEditor.tsx
 * 修改上述任一來源的規則時，請同步此檔。
 */
import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import { computeInclusiveItineraryDays } from "../ai/itinerary-days.ts";
import { listTripDates } from "../outfit/group-by-date.ts";

/** 與 apply-trip-date-range.ts TRIP_UNASSIGNED_DATE 相同。 */
const UNASSIGNED_DATE_KEY = "未安排";
/** 與 trip-stop-mutations.ts 的空白日期鍵相同。 */
const UNSPECIFIED_DATE_KEY = "未指定日期";

export type TripDayGroup = {
  dateKey: string;
  /** 已排日 1 起算；未安排組為 0 */
  dayNumber: number;
  /** 與輸入為同一物件參照，順序＝輸入中的出現順序 */
  items: RoamieItineraryItem[];
  /** 只有未安排組才有此欄位（=true） */
  isUnassigned?: boolean;
};

function daysBetweenDates(startDate: string, endDate: string): number {
  return computeInclusiveItineraryDays(startDate, endDate) ?? 1;
}

function addDaysIso(iso: string, daysToAdd: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + daysToAdd);
  return d.toISOString().slice(0, 10);
}

function scheduledDateKeysFromSettings(settings: TripPlanSettings | undefined): string[] {
  const start = settings?.tripStartDate?.trim();
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  const end = settings?.tripEndDate?.trim() || start;
  const dayCount = Math.max(1, daysBetweenDates(start, end));
  return Array.from({ length: dayCount }, (_, i) => addDaysIso(start, i));
}

function groupStopsByDate(items: RoamieItineraryItem[]): Map<string, RoamieItineraryItem[]> {
  const groups = new Map<string, RoamieItineraryItem[]>();
  for (const item of items) {
    const key = item.date?.trim() || UNSPECIFIED_DATE_KEY;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function listTripDateKeys(items: RoamieItineraryItem[], fallbackStart?: string): string[] {
  const keys = [...new Set(items.map((i) => i.date?.trim() || UNSPECIFIED_DATE_KEY))];
  if (keys.length > 0) return keys.sort();
  if (fallbackStart) return [fallbackStart];
  return [new Date().toISOString().slice(0, 10)];
}

function inferTripDates(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
): { start: string; end: string } {
  const fromSettings = settings.tripStartDate;
  const toSettings = settings.tripEndDate;
  if (fromSettings) {
    return { start: fromSettings, end: toSettings || fromSettings };
  }
  const isoDates = [
    ...new Set(items.map((i) => i.date?.trim()).filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d))),
  ].sort() as string[];
  if (isoDates.length > 0) {
    return { start: isoDates[0]!, end: isoDates[isoDates.length - 1]! };
  }
  return { start: "", end: "" };
}

/**
 * 行程頁天數分組：已排日依顯示順序（dayNumber 1 起算），有未安排項目時最後附一組未安排。
 * 不修改輸入；group.items 為輸入項目的原物件參照。
 */
export function buildTripDayGroups(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
): TripDayGroup[] {
  const { start } = inferTripDates(items, settings);
  const settingsDateKeys = scheduledDateKeysFromSettings(settings);
  const dayCount = Math.max(
    1,
    settingsDateKeys.length ||
      daysBetweenDates(settings.tripStartDate ?? start, settings.tripEndDate ?? start),
    listTripDateKeys(items, start).filter((k) => k !== UNASSIGNED_DATE_KEY).length,
  );
  const dateKeys =
    settingsDateKeys.length > 0 ? settingsDateKeys : listTripDates(items, start, dayCount);
  const groups = groupStopsByDate(items);
  const scheduled: TripDayGroup[] = dateKeys.map((dateKey, i) => ({
    dateKey,
    dayNumber: i + 1,
    items: groups.get(dateKey) ?? [],
  }));
  const unassigned = groups.get(UNASSIGNED_DATE_KEY) ?? [];
  if (unassigned.length > 0) {
    scheduled.push({
      dateKey: UNASSIGNED_DATE_KEY,
      dayNumber: 0,
      items: unassigned,
      isUnassigned: true,
    });
  }
  return scheduled;
}
