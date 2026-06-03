import { isRoamiePayloadV2 } from "@/lib/ai/types";
import { getItinerary, updateItinerary } from "@/lib/itinerary-storage";
import { seedCoreTripPersistedFingerprint } from "@/lib/trip/core-trip-update-guard";
import { logTripDateCacheInvalidated } from "@/lib/trip/trip-date-edit";

export function logTripDeletePlaceClicked(params: {
  tripId: string;
  dayIndex: number;
  deletedPlaceName: string;
}): void {
  console.info("[TRIP_DELETE_PLACE_CLICKED]", params);
}

export function logTripDeletePlaceMutation(params: {
  tripId: string;
  dayIndex: number;
  deletedPlaceName: string;
  beforeCount: number;
  afterCount: number;
}): void {
  console.info("[TRIP_DELETE_PLACE_MUTATION]", params);
}

export function logTripDeletePlaceSaveSuccess(params: {
  tripId: string;
  deletedPlaceName: string;
}): void {
  console.info("[TRIP_DELETE_PLACE_SAVE_SUCCESS]", params);
}

export function logTripDeletePlaceReloadVerify(params: {
  tripId: string;
  deletedPlaceName: string;
  stillExists: boolean;
}): void {
  console.info("[TRIP_DELETE_PLACE_RELOAD_VERIFY]", params);
}

export function logTripDeletePlaceSaveFailed(params: { error: string }): void {
  console.info("[TRIP_DELETE_PLACE_SAVE_FAILED]", params);
}

export async function saveTripItineraryAfterDeletePlace(
  tripId: string,
  payload: import("@/lib/ai/types").RoamiePayloadV2,
  deletedPlaceName: string,
): Promise<{ updated: Awaited<ReturnType<typeof updateItinerary>>; stillExists: boolean }> {
  logTripDateCacheInvalidated({ tripId });

  const updated = await updateItinerary(tripId, payload, { reason: "trip_delete_place" });
  if (!updated?.payload || !isRoamiePayloadV2(updated.payload)) {
    logTripDeletePlaceSaveFailed({ error: "update_returned_null" });
    return { updated: null, stillExists: true };
  }

  seedCoreTripPersistedFingerprint(tripId, updated.payload, updated.mood);
  logTripDeletePlaceSaveSuccess({ tripId, deletedPlaceName });

  const reloaded = await getItinerary(tripId);
  let stillExists = true;
  if (reloaded?.payload && isRoamiePayloadV2(reloaded.payload)) {
    const names = (reloaded.payload.itinerary ?? []).map((i) => i.placeName || i.title || "");
    stillExists = names.some((n) => n === deletedPlaceName);
  }

  logTripDeletePlaceReloadVerify({ tripId, deletedPlaceName, stillExists });
  return { updated, stillExists };
}
