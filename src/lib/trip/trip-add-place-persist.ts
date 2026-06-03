import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";
import { getItinerary, updateItinerary, type StoredItinerary } from "@/lib/itinerary-storage";
import { seedCoreTripPersistedFingerprint } from "@/lib/trip/core-trip-update-guard";
import { logTripDateCacheInvalidated } from "@/lib/trip/trip-date-edit";

export function logTripAddPlaceSelected(params: {
  placeName: string;
  placeId: string;
  activeDayIndex: number;
}): void {
  console.info("[TRIP_ADD_PLACE_SELECTED]", params);
}

export function logTripAddPlaceDetailsReady(params: {
  placeName: string;
  hasPlaceId: boolean;
  hasLatLng: boolean;
  hasAddress: boolean;
}): void {
  console.info("[TRIP_ADD_PLACE_DETAILS_READY]", params);
}

export function logTripAddPlaceAppendStart(params: {
  tripId: string;
  dayIndex: number;
  beforeCount: number;
}): void {
  console.info("[TRIP_ADD_PLACE_APPEND_START]", params);
}

export function logTripAddPlaceAppendSuccess(params: {
  tripId: string;
  dayIndex: number;
  afterCount: number;
}): void {
  console.info("[TRIP_ADD_PLACE_APPEND_SUCCESS]", params);
}

export function logTripAddPlaceSaveStart(params: { tripId: string }): void {
  console.info("[TRIP_ADD_PLACE_SAVE_START]", params);
}

export function logTripAddPlaceSaveSuccess(params: {
  tripId: string;
  savedPlaceName: string;
}): void {
  console.info("[TRIP_ADD_PLACE_SAVE_SUCCESS]", params);
}

export function logTripAddPlaceRenderConfirmed(params: {
  tripId: string;
  placeName: string;
  dayIndex: number;
}): void {
  console.info("[TRIP_ADD_PLACE_RENDER_CONFIRMED]", params);
}

export function logTripAddPlaceSaveFailed(params: { error: string }): void {
  console.info("[TRIP_ADD_PLACE_SAVE_FAILED]", params);
}

/** 新增地點後立即寫入 saved_trips / guest localStorage，避免僅更新 editor 本地 state */
export async function saveTripItineraryAfterAddPlace(
  tripId: string,
  payload: RoamiePayloadV2,
  savedPlaceName: string,
): Promise<StoredItinerary | null> {
  logTripAddPlaceSaveStart({ tripId });
  logTripDateCacheInvalidated({ tripId });

  try {
    const updated = await updateItinerary(tripId, payload, { reason: "trip_add_place" });
    if (!updated) {
      logTripAddPlaceSaveFailed({ error: "update_returned_null" });
      return null;
    }

    if (isRoamiePayloadV2(updated.payload)) {
      seedCoreTripPersistedFingerprint(tripId, updated.payload, updated.mood);
      logTripAddPlaceSaveSuccess({ tripId, savedPlaceName });

      const reloaded = await getItinerary(tripId);
      if (reloaded?.payload && isRoamiePayloadV2(reloaded.payload)) {
        const names = (reloaded.payload.itinerary ?? []).map(
          (i) => i.placeName || i.title || "",
        );
        if (!names.some((n) => n === savedPlaceName)) {
          console.warn("[TRIP_ADD_PLACE_SAVE_SUCCESS] reload_missing_place", {
            tripId,
            savedPlaceName,
          });
        }
      }
    }

    return updated;
  } catch (e) {
    const error = e instanceof Error ? e.message : "trip_add_place_save_failed";
    logTripAddPlaceSaveFailed({ error });
    throw e;
  }
}
