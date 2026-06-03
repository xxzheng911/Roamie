import type { RoamieItineraryItem, RoamiePayloadV2, TripPlanSettings } from "@/lib/ai/types";
import { isRoamiePayloadV2 } from "@/lib/ai/types";
import { getItinerary } from "@/lib/itinerary-storage";
import { normalizeStoredTrip } from "@/lib/saved-trip/normalize";
import { groupStopsByDate } from "@/lib/trip/trip-stop-mutations";
import type { PlaceIntroItineraryContext } from "@/lib/place/generate-place-intro";

function normalizePlaceKey(name: string): string {
  return name.trim().toLowerCase();
}

function monthFromIsoDate(iso?: string | null): number | null {
  if (!iso?.trim()) return null;
  const m = /^(\d{4})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? month : null;
}

export function buildPlaceIntroContextFromTrip(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings | undefined,
  placeName: string,
  destination?: string | null,
  profile?: { travelStyle?: string; pace?: string; mood?: string },
): PlaceIntroItineraryContext {
  const key = normalizePlaceKey(placeName);
  const dayGroups = groupStopsByDate(items, settings);
  let dayIndex: number | null = null;
  let dayDate: string | null = null;
  const nearbyStops: string[] = [];

  for (const group of dayGroups) {
    const idx = group.items.findIndex(
      (it) => normalizePlaceKey(it.placeName || it.title) === key,
    );
    if (idx < 0) continue;
    dayIndex = group.dayNumber;
    dayDate = group.dateKey;
    for (const it of group.items) {
      const label = (it.placeName || it.title || "").trim();
      if (!label || normalizePlaceKey(label) === key) continue;
      nearbyStops.push(label);
    }
    break;
  }

  const travelMonth =
    monthFromIsoDate(dayDate) ??
    monthFromIsoDate(settings?.tripStartDate) ??
    monthFromIsoDate(items[0]?.date);

  return {
    city: destination?.trim() || null,
    destination: destination?.trim() || null,
    travelMonth,
    dayIndex,
    dayDate,
    nearbyStops: nearbyStops.slice(0, 5),
    travelStyle: profile?.travelStyle ?? null,
    pace: profile?.pace ?? null,
    mood: profile?.mood ?? null,
  };
}

/** 行程詳情頁：從已儲存行程還原穿搭／簡介用情境 */
export async function loadPlaceIntroItineraryContext(
  tripId: string | undefined,
  placeName: string,
  profile?: { travelStyle?: string; pace?: string; mood?: string },
): Promise<PlaceIntroItineraryContext | null> {
  if (!tripId?.trim() || !placeName.trim()) return null;
  try {
    const stored = await getItinerary(tripId.trim());
    if (!stored?.payload) return null;
    const payload = stored.payload;
    const items: RoamieItineraryItem[] = isRoamiePayloadV2(payload)
      ? payload.itinerary
      : ((payload as { itinerary?: RoamieItineraryItem[] }).itinerary ?? []);
    const settings: TripPlanSettings | undefined = isRoamiePayloadV2(payload)
      ? payload.tripSettings
      : undefined;
    const view = normalizeStoredTrip(stored);
    const dest =
      view.destination !== "尚未設定" ? view.destination : stored.title || null;
    const ctx = buildPlaceIntroContextFromTrip(items, settings, placeName, dest, profile);
    const summary = isRoamiePayloadV2(payload)
      ? (payload as RoamiePayloadV2).summary
      : (payload as { summary?: string }).summary;
    return {
      ...ctx,
      tripSummary: summary?.trim() ? summary.trim().slice(0, 120) : null,
    };
  } catch {
    return null;
  }
}
