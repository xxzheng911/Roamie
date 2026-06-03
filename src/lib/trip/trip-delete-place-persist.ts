import type { RoamiePayloadV2 } from "@/lib/ai/types";
import {
  itineraryPlaceNames,
  reloadTripItineraryPayload,
  saveTripItineraryToStorage,
} from "@/lib/trip/trip-itinerary-persist";

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
  payload: RoamiePayloadV2,
  deletedPlaceName: string,
): Promise<{
  updated: Awaited<ReturnType<typeof saveTripItineraryToStorage>>;
  stillExists: boolean;
}> {
  try {
    const updated = await saveTripItineraryToStorage(tripId, payload, "trip_delete_place");
    if (!updated) {
      logTripDeletePlaceSaveFailed({ error: "update_returned_null" });
      return { updated: null, stillExists: true };
    }

    logTripDeletePlaceSaveSuccess({ tripId, deletedPlaceName });

    const reloaded = await reloadTripItineraryPayload(tripId);
    const stillExists = reloaded
      ? itineraryPlaceNames(reloaded).some((n) => n === deletedPlaceName)
      : true;

    logTripDeletePlaceReloadVerify({ tripId, deletedPlaceName, stillExists });
    return { updated, stillExists };
  } catch (e) {
    logTripDeletePlaceSaveFailed({
      error: e instanceof Error ? e.message : "delete_failed",
    });
    throw e;
  }
}
