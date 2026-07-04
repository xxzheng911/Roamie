const KEY = "roamie:trip-detail-selected-day";

type PersistedTripDay = {
  tripId: string;
  dayIndex: number;
  updatedAt: number;
};

export function persistTripDetailSelectedDay(tripId: string, dayIndex: number): void {
  if (typeof sessionStorage === "undefined" || !tripId) return;
  try {
    const payload: PersistedTripDay = { tripId, dayIndex, updatedAt: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function readTripDetailSelectedDay(tripId: string): number | null {
  if (typeof sessionStorage === "undefined" || !tripId) return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedTripDay;
    if (parsed?.tripId !== tripId) return null;
    if (typeof parsed.dayIndex !== "number" || parsed.dayIndex < 0) return null;
    return parsed.dayIndex;
  } catch {
    return null;
  }
}

export function clearTripDetailSelectedDay(tripId: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PersistedTripDay;
    if (parsed?.tripId === tripId) {
      sessionStorage.removeItem(KEY);
    }
  } catch {
    /* ignore */
  }
}
