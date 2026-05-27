import { deleteItinerary } from "@/lib/itinerary-storage";

export const TRIP_DELETE_DIALOG = {
  title: "刪除這趟行程？",
  description: "刪除後將無法復原，Roamie 不會再保留這趟旅程。",
  cancel: "取消",
  confirm: "刪除",
} as const;

/** 從 Supabase／本機儲存刪除並廣播 SAVED_TRIPS_CHANGED_EVENT */
export async function deleteTrip(tripId: string): Promise<void> {
  console.info("[DELETE_TRIP] tripId=", tripId);
  await deleteItinerary(tripId);
  console.info("[CORE_TRIP] deleted", tripId);
}
