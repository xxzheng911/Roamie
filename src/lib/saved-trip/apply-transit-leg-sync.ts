import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import { recalculateDayArrivalTimesInItems } from "@/lib/saved-trip/recalculate-arrival-times";
import { resolveLegTransportLabel } from "@/lib/saved-trip/transport-options";
import { travelMinutesForArrival } from "@/lib/saved-trip/travel-time";
import { buildDayLegKey, resolveTransitLeg } from "@/lib/transit/types";
import type { TransitLegAdvice } from "@/lib/transit/types";
import {
  groupStopsByDate,
  legKeyForItem,
  orderedTripDateKeys,
  replaceDayItemsInItinerary,
} from "@/lib/trip/trip-stop-mutations";

function legHasArrivalDuration(
  leg: TransitLegAdvice | undefined,
  settings: TripPlanSettings,
  curr: RoamieItineraryItem,
  dateKey: string,
): boolean {
  const transport = resolveLegTransportLabel(settings, legKeyForItem(curr), dateKey);
  return travelMinutesForArrival(leg, transport).minutes != null;
}

export function dayHasAnyUsableLegDuration(
  items: RoamieItineraryItem[],
  dateKey: string,
  settings: TripPlanSettings,
  transitLegs: Record<string, TransitLegAdvice>,
): boolean {
  const dayItems = groupStopsByDate(items).get(dateKey) ?? [];
  for (let i = 1; i < dayItems.length; i++) {
    const prev = dayItems[i - 1]!;
    const curr = dayItems[i]!;
    const legKey = buildDayLegKey(dateKey, prev.placeName || prev.title, curr.placeName || curr.title);
    const leg =
      transitLegs[legKey] ??
      resolveTransitLeg(transitLegs, dateKey, prev.placeName || prev.title, curr.placeName || curr.title);
    if (legHasArrivalDuration(leg, settings, curr, dateKey)) {
      return true;
    }
  }
  return false;
}

function preserveDayArrivalTimes(
  itemsBefore: RoamieItineraryItem[],
  itemsAfter: RoamieItineraryItem[],
  dateKey: string,
): RoamieItineraryItem[] {
  const beforeDay = groupStopsByDate(itemsBefore).get(dateKey) ?? [];
  const afterDay = groupStopsByDate(itemsAfter).get(dateKey) ?? [];
  if (beforeDay.length !== afterDay.length) return itemsAfter;
  const preserved = afterDay.map((item, idx) => {
    const prevTime = beforeDay[idx]?.time?.trim();
    return prevTime ? { ...item, time: beforeDay[idx]!.time } : item;
  });
  return replaceDayItemsInItinerary(itemsAfter, dateKey, preserved);
}

export type ApplyTransitLegSyncInput = {
  itemsBefore: RoamieItineraryItem[];
  itemsWithCoords: RoamieItineraryItem[];
  settings: TripPlanSettings;
  transitLegs: Record<string, TransitLegAdvice>;
  onlyDateKey?: string;
};

/** API 回傳後合併路段：有可用 duration 才重算抵達時間，否則保留原時間 */
export function applyTransitLegSyncToItems({
  itemsBefore,
  itemsWithCoords,
  settings,
  transitLegs,
  onlyDateKey,
}: ApplyTransitLegSyncInput): { items: RoamieItineraryItem[]; settings: TripPlanSettings } {
  const mergedSettings: TripPlanSettings = { ...settings, transitLegs };

  const applyDay = (dateKey: string, items: RoamieItineraryItem[]): RoamieItineraryItem[] => {
    if (dayHasAnyUsableLegDuration(items, dateKey, mergedSettings, transitLegs)) {
      return recalculateDayArrivalTimesInItems(items, dateKey, mergedSettings, 0);
    }
    return preserveDayArrivalTimes(itemsBefore, items, dateKey);
  };

  if (onlyDateKey) {
    return {
      items: applyDay(onlyDateKey, itemsWithCoords),
      settings: mergedSettings,
    };
  }

  let items = itemsWithCoords;
  for (const dateKey of orderedTripDateKeys(items, mergedSettings)) {
    items = applyDay(dateKey, items);
  }
  return { items, settings: mergedSettings };
}
