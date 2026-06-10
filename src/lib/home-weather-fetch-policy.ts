import { WEATHER_HOOK_MIN_REFETCH_MS } from "@/lib/weather/constants";

export function weatherCoordKey(lat: number, lng: number, locale?: string): string {
  return `${lat.toFixed(3)}:${lng.toFixed(3)}:${locale ?? ""}`;
}

const lastFetchAtByKey = new Map<string, number>();
const inFlightByKey = new Map<string, Promise<unknown>>();

export function shouldSkipWeatherFetch(key: string, now = Date.now()): boolean {
  const lastAt = lastFetchAtByKey.get(key);
  return lastAt !== undefined && now - lastAt < WEATHER_HOOK_MIN_REFETCH_MS;
}

export function markWeatherFetchStarted(key: string, now = Date.now()): void {
  lastFetchAtByKey.set(key, now);
}

export function getWeatherFetchInFlight<T>(key: string): Promise<T> | undefined {
  return inFlightByKey.get(key) as Promise<T> | undefined;
}

export function registerWeatherFetchInFlight<T>(key: string, promise: Promise<T>): Promise<T> {
  const existing = inFlightByKey.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  inFlightByKey.set(key, promise);
  return promise.finally(() => {
    if (inFlightByKey.get(key) === promise) {
      inFlightByKey.delete(key);
    }
  });
}
