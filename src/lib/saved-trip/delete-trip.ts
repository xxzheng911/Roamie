import { deleteItinerary } from "@/lib/itinerary-storage";

/** 從 Supabase／本機儲存刪除並廣播 SAVED_TRIPS_CHANGED_EVENT */
export async function deleteTrip(tripId: string): Promise<void> {
  console.info("[DELETE_TRIP] tripId=", tripId);
  await deleteItinerary(tripId);
  console.info("[CORE_TRIP] deleted", tripId);
}
