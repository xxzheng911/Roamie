import type { SavedPlace } from "@/lib/places-storage";
import type { CoreTrip } from "@/lib/trip/core-trip";

const PLACES_KEY = "roamie:saved-places-snapshot";
const TRIPS_KEY = "roamie:saved-trips-snapshot";

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

export function readSavedPlacesSnapshot(): SavedPlace[] {
  const list = readJson<SavedPlace[]>(PLACES_KEY);
  return Array.isArray(list) ? list : [];
}

export function writeSavedPlacesSnapshot(places: SavedPlace[]): void {
  writeJson(PLACES_KEY, places);
}

export function readSavedTripsSnapshot(): CoreTrip[] {
  const list = readJson<CoreTrip[]>(TRIPS_KEY);
  return Array.isArray(list) ? list : [];
}

export function writeSavedTripsSnapshot(trips: CoreTrip[]): void {
  writeJson(TRIPS_KEY, trips);
}
