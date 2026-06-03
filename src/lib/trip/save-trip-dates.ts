import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";
import { getItinerary, updateItinerary, type StoredItinerary } from "@/lib/itinerary-storage";
import { seedCoreTripPersistedFingerprint } from "@/lib/trip/core-trip-update-guard";
import {
  applyTripDatesToPayload,
  logTripDateCacheInvalidated,
  logTripDateReloadConfirmed,
  logTripDateSaveFailed,
  logTripDateSaveStart,
  logTripDateSaveSuccess,
} from "@/lib/trip/trip-date-edit";

/** 將行程日期／每日 ISO 寫入 saved_trips（或 guest localStorage） */
export async function saveTripDatesToStorage(
  tripId: string,
  payload: RoamiePayloadV2,
): Promise<StoredItinerary | null> {
  const startDate = payload.tripSettings?.tripStartDate?.trim() ?? "";
  logTripDateSaveStart({ tripId, startDate });

  try {
    const settings = payload.tripSettings ?? {};
    const toSave = applyTripDatesToPayload(
      payload,
      settings,
      payload.itinerary ?? [],
    );
    logTripDateCacheInvalidated({ tripId });
    const updated = await updateItinerary(tripId, toSave, { reason: "trip_date_change" });

    if (!updated) {
      logTripDateSaveFailed({ error: "update_returned_null" });
      return null;
    }

    if (isRoamiePayloadV2(updated.payload)) {
      seedCoreTripPersistedFingerprint(tripId, updated.payload, updated.mood);
      const savedStart = updated.payload.tripSettings?.tripStartDate ?? startDate;
      logTripDateSaveSuccess({ tripId, savedStartDate: savedStart });
      logTripDateReloadConfirmed({ tripId, startDate: savedStart });

      const reloaded = await getItinerary(tripId);
      if (reloaded && isRoamiePayloadV2(reloaded.payload)) {
        const reloadStart = reloaded.payload.tripSettings?.tripStartDate ?? "";
        if (reloadStart && reloadStart !== savedStart) {
          console.warn("[TRIP_DATE_RELOAD_CONFIRMED] mismatch", {
            tripId,
            savedStart,
            reloadStart,
          });
        }
      }
    }

    return updated;
  } catch (e) {
    const error = e instanceof Error ? e.message : "trip_date_save_failed";
    logTripDateSaveFailed({ error });
    throw e;
  }
}
