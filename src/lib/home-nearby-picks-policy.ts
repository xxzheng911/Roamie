const HOME_NEARBY_LOAD_TTL_MS = 5 * 60 * 1000;

let lastLoadKey = "";
let lastLoadAt = 0;
let loadInFlight: Promise<unknown> | null = null;
let loadInFlightKey = "";

export function homeNearbyLoadKey(
  lat: number,
  lng: number,
  mood: string | null | undefined,
): string {
  return `${lat.toFixed(3)}:${lng.toFixed(3)}:${mood ?? ""}`;
}

export function shouldSkipHomeNearbyLoad(key: string, now = Date.now()): boolean {
  return lastLoadKey === key && now - lastLoadAt < HOME_NEARBY_LOAD_TTL_MS;
}

export function markHomeNearbyLoad(key: string, now = Date.now()): void {
  lastLoadKey = key;
  lastLoadAt = now;
}

export function getHomeNearbyLoadInFlight<T>(key: string): Promise<T> | null {
  if (loadInFlight && loadInFlightKey === key) {
    return loadInFlight as Promise<T>;
  }
  return null;
}

export function registerHomeNearbyLoadInFlight<T>(key: string, promise: Promise<T>): Promise<T> {
  const existing = getHomeNearbyLoadInFlight<T>(key);
  if (existing) return existing;
  loadInFlightKey = key;
  loadInFlight = promise;
  return promise.finally(() => {
    if (loadInFlight === promise) {
      loadInFlight = null;
      loadInFlightKey = "";
    }
  });
}
