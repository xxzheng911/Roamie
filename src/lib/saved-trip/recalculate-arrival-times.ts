import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import { resolveLegTransportLabel } from "@/lib/saved-trip/transport-options";
import {
  isTransitRequested,
  travelMinutesForArrival,
} from "@/lib/saved-trip/travel-time";
import { buildDayLegKey, resolveTransitLeg } from "@/lib/transit/types";
import {
  flattenStopGroups,
  groupStopsByDate,
  legKeyForItem,
  replaceDayItemsInItinerary,
} from "@/lib/trip/trip-stop-mutations";

const DEFAULT_STAY_MINUTES = 60;
const DEFAULT_START_MINUTES = 10 * 60;
/** 交通時間尚未回傳時的暫估分鐘數（非大眾運輸；或大眾運輸整日重算時的暫估鏈） */
const PROVISIONAL_LEG_TRAVEL_MINUTES = 10;

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

export function resolveDayStartTime(settings: TripPlanSettings): string {
  return settings.startTime?.trim() || formatTimeMinutes(DEFAULT_START_MINUTES);
}

function routeTravel(
  settings: TripPlanSettings,
  prev: RoamieItineraryItem,
  curr: RoamieItineraryItem,
  dateKey: string,
): { minutes: number | null } {
  const legKey = buildDayLegKey(dateKey, prev.placeName || prev.title, curr.placeName || curr.title);
  const leg =
    settings.transitLegs?.[legKey] ??
    resolveTransitLeg(settings.transitLegs, dateKey, prev.placeName || prev.title, curr.placeName || curr.title);
  const transport = resolveLegTransportLabel(settings, legKeyForItem(curr), dateKey);
  return travelMinutesForArrival(leg, transport);
}

function existingArrivalTime(item: RoamieItineraryItem): string {
  const t = item.time?.trim();
  if (t && parseTimeMinutes(t) != null) return formatTimeMinutes(parseTimeMinutes(t)!);
  return t || "";
}

type NextStopArrivalOpts = {
  /** 大眾運輸整日重算：尚無 transit duration 時以暫估分鐘接鏈（API 回傳後再更新） */
  transitProvisionalWhenMissing?: boolean;
};

function nextStopArrivalTime(
  prev: RoamieItineraryItem,
  curr: RoamieItineraryItem,
  prevArrival: number | null,
  settings: TripPlanSettings,
  dateKey: string,
  opts?: NextStopArrivalOpts,
): string {
  const transport = resolveLegTransportLabel(settings, legKeyForItem(curr), dateKey);
  const { minutes: travelRaw } = routeTravel(settings, prev, curr, dateKey);

  if (isTransitRequested(transport)) {
    if (prevArrival == null) return existingArrivalTime(curr);
    const stay = stayMinutes(settings, prev);
    if (travelRaw != null) {
      return formatTimeMinutes(prevArrival + stay + travelRaw);
    }
    if (opts?.transitProvisionalWhenMissing) {
      return formatTimeMinutes(prevArrival + stay + PROVISIONAL_LEG_TRAVEL_MINUTES);
    }
    return existingArrivalTime(curr);
  }

  if (prevArrival == null) return existingArrivalTime(curr);

  const stay = stayMinutes(settings, prev);
  const travel = travelRaw ?? PROVISIONAL_LEG_TRAVEL_MINUTES;
  return formatTimeMinutes(prevArrival + stay + travel);
}

/**
 * 依畫面順序重算單日抵達時間。
 * 第 1 站 = dayStartTime；之後 = 前站抵達 + 停留 + 前段交通（依目前 from→to）。
 */
export function recalculateArrivalTimes(
  dayItems: RoamieItineraryItem[],
  dayStartTime: string,
  settings: TripPlanSettings,
  dateKey: string,
  opts?: NextStopArrivalOpts,
): RoamieItineraryItem[] {
  if (dayItems.length === 0) return dayItems;

  const startMins = parseTimeMinutes(dayStartTime) ?? DEFAULT_START_MINUTES;
  const result = dayItems.map((item) => ({ ...item }));
  result[0] = { ...result[0]!, time: formatTimeMinutes(startMins) };

  const legOpts: NextStopArrivalOpts = {
    transitProvisionalWhenMissing: opts?.transitProvisionalWhenMissing ?? true,
  };

  for (let i = 1; i < result.length; i++) {
    const prev = result[i - 1]!;
    const curr = result[i]!;
    const prevArrival = parseTimeMinutes(prev.time);
    result[i] = {
      ...curr,
      time: nextStopArrivalTime(prev, curr, prevArrival, settings, dateKey, legOpts),
    };
  }

  return result;
}

export function recalculateArrivalTimesForDay(
  dayItems: RoamieItineraryItem[],
  settings: TripPlanSettings,
  dateKey: string,
  anchorIndex = 0,
): RoamieItineraryItem[] {
  if (dayItems.length === 0) return dayItems;

  if (anchorIndex === 0) {
    return recalculateArrivalTimes(
      dayItems,
      resolveDayStartTime(settings),
      settings,
      dateKey,
      { transitProvisionalWhenMissing: true },
    );
  }

  let result = dayItems.map((item) => ({ ...item }));
  const startIndex = Math.max(0, anchorIndex);
  if (startIndex >= result.length - 1) return result;

  const legOpts: NextStopArrivalOpts = { transitProvisionalWhenMissing: false };

  for (let i = startIndex + 1; i < result.length; i++) {
    const prev = result[i - 1]!;
    const curr = result[i]!;
    const prevArrival = parseTimeMinutes(prev.time);
    result[i] = {
      ...curr,
      time: nextStopArrivalTime(prev, curr, prevArrival, settings, dateKey, legOpts),
    };
  }

  return result;
}

export function recalculateDayArrivalTimesInItems(
  items: RoamieItineraryItem[],
  dateKey: string,
  settings: TripPlanSettings,
  anchorIndex = 0,
  dayItemsInOrder?: RoamieItineraryItem[],
): RoamieItineraryItem[] {
  const dayItems =
    dayItemsInOrder ?? groupStopsByDate(items).get(dateKey) ?? [];
  if (dayItems.length === 0) return items;
  const recalculated = recalculateArrivalTimesForDay(
    dayItems,
    settings,
    dateKey,
    anchorIndex,
  );
  return replaceDayItemsInItinerary(items, dateKey, recalculated);
}

/** 各天獨立重算，互不影響 */
export function recalculateAllArrivalTimes(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
): RoamieItineraryItem[] {
  const groups = groupStopsByDate(items);
  const dayStart = resolveDayStartTime(settings);
  for (const [dateKey, dayItems] of groups) {
    groups.set(
      dateKey,
      recalculateArrivalTimes(dayItems, dayStart, settings, dateKey, {
        transitProvisionalWhenMissing: true,
      }),
    );
  }
  return flattenStopGroups(groups);
}
