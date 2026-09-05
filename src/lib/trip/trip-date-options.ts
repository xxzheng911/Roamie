import type { Itinerary } from "@/lib/itinerary.functions";
import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { listTripDateKeys } from "@/lib/trip/trip-stop-mutations";
import { daysBetweenDates } from "@/lib/fetch-context";

/**
 * Dates offered by add-to-trip. The trip range/day structure is authoritative;
 * itinerary places are only a backward-compatible fallback for incomplete data.
 */
export function resolveTripDateOptions(payload: RoamiePayloadV2 | Itinerary): string[] {
  if (isRoamiePayloadV2(payload)) {
    const items = payload.itinerary ?? [];
    const start = payload.tripSettings?.tripStartDate?.trim() ?? "";
    const end = payload.tripSettings?.tripEndDate?.trim() ?? "";

    if (start) {
      const dayCount = end
        ? Math.max(1, daysBetweenDates(start, end))
        : Math.max(1, payload.days ?? 0);
      return listTripDates([], start, dayCount);
    }

    return listTripDateKeys(items);
  }

  const structuredDates = (payload.daily_plan ?? [])
    .map((day) => day.date?.trim())
    .filter((date): date is string => Boolean(date));
  if (structuredDates.length > 0) return [...new Set(structuredDates)];

  return [new Date().toISOString().slice(0, 10)];
}
