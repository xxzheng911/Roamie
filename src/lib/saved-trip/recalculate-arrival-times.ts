import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import { resolveLegTransportLabel } from "@/lib/saved-trip/transport-options";
import {
  travelMinutesForArrival,
} from "@/lib/saved-trip/travel-time";
import { buildLegKey } from "@/lib/transit/types";
import {
  flattenStopGroups,
  groupStopsByDate,
  legKeyForItem,
} from "@/lib/trip/trip-stop-mutations";
import { logRouteOnce } from "@/lib/route-duration-log";

const DEFAULT_STAY_MINUTES = 60;
const DEFAULT_START_MINUTES = 10 * 60;

export function parseTimeMinutes(time: string | undefined): number | null {
  const m = (time ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = Number.parseInt(m[1]!, 10);
  const minutes = Number.parseInt(m[2]!, 10);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatTimeMinutes(totalMinutes: number): string {
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function stayMinutes(settings: TripPlanSettings, item: RoamieItineraryItem): number {
  const mins = settings.legMinutes?.[legKeyForItem(item)];
  return mins != null && mins > 0 ? mins : DEFAULT_STAY_MINUTES;
}

function routeTravel(
  settings: TripPlanSettings,
  prev: RoamieItineraryItem,
  curr: RoamieItineraryItem,
  dateKey: string,
): { minutes: number | null } {
  const legKey = buildLegKey(prev.placeName || prev.title, curr.placeName || curr.title);
  const leg = settings.transitLegs?.[legKey];
  const transport = resolveLegTransportLabel(settings, legKeyForItem(curr), dateKey);
  return travelMinutesForArrival(leg, transport);
}

function normalizeFirstStopTime(
  dayItems: RoamieItineraryItem[],
  settings: TripPlanSettings,
): RoamieItineraryItem[] {
  if (dayItems.length === 0) return dayItems;
  const first = dayItems[0]!;
  const parsed = parseTimeMinutes(first.time);
  const fallback = parseTimeMinutes(settings.startTime) ?? DEFAULT_START_MINUTES;
  const minutes = parsed ?? fallback;
  if (minutes === parsed) return dayItems;
  return [{ ...first, time: formatTimeMinutes(minutes) }, ...dayItems.slice(1)];
}

/**
 * 依序重算同一天內的抵達時間。
 * anchorIndex：保留 0..anchorIndex 的抵達時間不變，從 anchorIndex+1 開始推算。
 */
export function recalculateArrivalTimesForDay(
  dayItems: RoamieItineraryItem[],
  settings: TripPlanSettings,
  dateKey: string,
  anchorIndex = 0,
): RoamieItineraryItem[] {
  if (dayItems.length === 0) return dayItems;

  let result =
    anchorIndex === 0 ? normalizeFirstStopTime(dayItems, settings) : dayItems.map((item) => ({ ...item }));

  const startIndex = Math.max(0, anchorIndex);
  if (startIndex >= result.length - 1) return result;

  for (let i = startIndex + 1; i < result.length; i++) {
    const prev = result[i - 1]!;
    const curr = result[i]!;
    const prevArrival = parseTimeMinutes(prev.time);
    if (prevArrival == null) continue;

    const transport = resolveLegTransportLabel(settings, legKeyForItem(curr), dateKey);
    const { minutes: travel } = routeTravel(settings, prev, curr, dateKey);
    const stay = stayMinutes(settings, prev);

    if (travel == null) {
      // 交通時間未取得：保留原本抵達時間，不觸發後續重算
      logRouteOnce(
        `recalc|${prev.placeName}|${curr.placeName}|skip`,
        `[ITINERARY_TIME_RECALC_STEP] prevArrival=${prev.time ?? ""} durationMinutes=null kept=${curr.time ?? "unchanged"}`,
      );
      continue;
    }

    const nextArrival = prevArrival + stay + travel;
    result[i] = { ...curr, time: formatTimeMinutes(nextArrival) };
  }

  return result;
}

export function recalculateDayArrivalTimesInItems(
  items: RoamieItineraryItem[],
  dateKey: string,
  settings: TripPlanSettings,
  anchorIndex = 0,
): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  const dayItems = groups.get(dateKey) ?? [];
  if (dayItems.length === 0) return items;
  groups.set(dateKey, recalculateArrivalTimesForDay(dayItems, settings, dateKey, anchorIndex));
  return flattenStopGroups(groups);
}

/** 各天獨立重算，互不影響 */
export function recalculateAllArrivalTimes(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  for (const [dateKey, dayItems] of groups) {
    groups.set(dateKey, recalculateArrivalTimesForDay(dayItems, settings, dateKey, 0));
  }
  return flattenStopGroups(groups);
}
