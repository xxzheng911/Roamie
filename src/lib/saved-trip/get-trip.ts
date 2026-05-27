import { getItinerary, listItineraries, type StoredItinerary } from "@/lib/itinerary-storage";
import { normalizeStoredTrip } from "@/lib/saved-trip/normalize";
import type { SavedTripView } from "@/lib/saved-trip/types";

/** tripId → 同一筆行程（列表／詳情／首頁共用） */
export async function getTripById(tripId: string): Promise<SavedTripView | null> {
  return getTripViewById(tripId);
}

export async function getTripViewById(tripId: string): Promise<SavedTripView | null> {
  const row = await getItinerary(tripId);
  if (!row) return null;
  return normalizeStoredTrip(row);
}

export async function getLatestTripView(): Promise<SavedTripView | null> {
  const rows = await listItineraries();
  const latest = rows[0];
  if (!latest) return null;
  return normalizeStoredTrip(latest);
}

export function tripViewFromStored(stored: StoredItinerary): SavedTripView {
  return normalizeStoredTrip(stored);
}
