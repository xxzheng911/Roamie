import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";

const KEY = "roamie:trip-detail-view-state";

export type TripDetailViewState = {
  tripId: string;
  scrollTop: number;
  activeDayIndex: number;
  addMenuDayIndex: number | null;
  items: RoamieItineraryItem[];
  settings: TripPlanSettings;
  tripTitle: string;
};

export function saveTripDetailViewState(state: TripDetailViewState): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("[Roamie] saveTripDetailViewState failed", e);
  }
}

/** 讀取但不移除（返回前還原用） */
export function readTripDetailViewState(tripId: string): TripDetailViewState | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TripDetailViewState;
    if (parsed?.tripId !== tripId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearTripDetailViewState(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function consumeTripDetailViewState(tripId: string): TripDetailViewState | null {
  const state = readTripDetailViewState(tripId);
  if (state) clearTripDetailViewState();
  return state;
}

export function readTripDetailScrollTop(tripId: string): number | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TripDetailViewState;
    if (parsed?.tripId !== tripId) return null;
    return parsed.scrollTop ?? 0;
  } catch {
    return null;
  }
}
