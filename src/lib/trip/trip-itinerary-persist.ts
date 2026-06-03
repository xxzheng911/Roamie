import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";
import { getItinerary, updateItinerary, type StoredItinerary } from "@/lib/itinerary-storage";
import { seedCoreTripPersistedFingerprint } from "@/lib/trip/core-trip-update-guard";
import { logTripDateCacheInvalidated } from "@/lib/trip/trip-date-edit";

export type TripItineraryPersistReason =
  | "trip_add_place"
  | "trip_delete_place"
  | "trip_stop_time"
  | "trip_stop_reorder"
  | "trip_stop_sort_by_time"
  | "trip_date_change";

export function logTripItineraryPersistStart(params: {
  tripId: string;
  reason: TripItineraryPersistReason;
}): void {
  console.info("[TRIP_ITINERARY_PERSIST_START]", params);
}

export function logTripItineraryPersistSuccess(params: {
  tripId: string;
  reason: TripItineraryPersistReason;
}): void {
  console.info("[TRIP_ITINERARY_PERSIST_SUCCESS]", params);
}

export function logTripItineraryPersistFailed(params: {
  tripId: string;
  reason: TripItineraryPersistReason;
  error: string;
}): void {
  console.info("[TRIP_ITINERARY_PERSIST_FAILED]", params);
}

export function logTripStopTimeSaved(params: {
  tripId: string;
  placeName: string;
  time: string;
  date: string;
}): void {
  console.info("[TRIP_STOP_TIME_SAVE_SUCCESS]", params);
}

export function logTripStopReorderSaved(params: {
  tripId: string;
  date: string;
  placeNames: string[];
}): void {
  console.info("[TRIP_STOP_REORDER_SAVE_SUCCESS]", params);
}

export function logTripItineraryReloadVerify(params: {
  tripId: string;
  reason: TripItineraryPersistReason;
  ok: boolean;
  detail?: string;
}): void {
  console.info("[TRIP_ITINERARY_RELOAD_VERIFY]", params);
}

/** 寫入 guest localStorage / Supabase saved_trips */
export async function saveTripItineraryToStorage(
  tripId: string,
  payload: RoamiePayloadV2,
  reason: TripItineraryPersistReason,
): Promise<StoredItinerary | null> {
  logTripItineraryPersistStart({ tripId, reason });
  logTripDateCacheInvalidated({ tripId });

  try {
    const updated = await updateItinerary(tripId, payload, { reason });
    if (!updated?.payload || !isRoamiePayloadV2(updated.payload)) {
      logTripItineraryPersistFailed({ tripId, reason, error: "update_returned_null" });
      return null;
    }
    seedCoreTripPersistedFingerprint(tripId, updated.payload, updated.mood);
    logTripItineraryPersistSuccess({ tripId, reason });
    return updated;
  } catch (e) {
    const error = e instanceof Error ? e.message : "trip_itinerary_persist_failed";
    logTripItineraryPersistFailed({ tripId, reason, error });
    throw e;
  }
}

export async function reloadTripItineraryPayload(
  tripId: string,
): Promise<RoamiePayloadV2 | null> {
  const reloaded = await getItinerary(tripId);
  if (!reloaded?.payload || !isRoamiePayloadV2(reloaded.payload)) return null;
  return reloaded.payload;
}

export function itineraryPlaceNames(payload: RoamiePayloadV2): string[] {
  return (payload.itinerary ?? []).map((i) => i.placeName || i.title || "").filter(Boolean);
}

export function findStopByPlaceName(
  payload: RoamiePayloadV2,
  placeName: string,
  date?: string,
): { time: string; date: string } | null {
  const row = (payload.itinerary ?? []).find(
    (i) =>
      (i.placeName || i.title || "") === placeName &&
      (date == null || (i.date?.trim() || "") === date),
  );
  if (!row) return null;
  return { time: row.time?.trim() || "", date: row.date?.trim() || "" };
}

export function dayStopNames(payload: RoamiePayloadV2, date: string): string[] {
  return (payload.itinerary ?? [])
    .filter((i) => (i.date?.trim() || "") === date)
    .map((i) => i.placeName || i.title || "")
    .filter(Boolean);
}
