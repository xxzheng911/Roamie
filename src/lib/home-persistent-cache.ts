import { distanceMeters } from "@/lib/geo-distance";
import type { WeatherSummary } from "@/lib/weather-types";

export const HOME_LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;
export const HOME_WEATHER_CACHE_TTL_MS = 60 * 60 * 1000;
export const HOME_PLACES_CACHE_TTL_MS = 30 * 60 * 1000;
export const HOME_PLACES_CACHE_MAX_DISTANCE_M = 500;

const HOME_LOCATION_KEY = "roamie:home-location-cache";
const HOME_WEATHER_KEY = "roamie:home-weather-cache";

export type PersistedHomeLocation = {
  lat: number;
  lng: number;
  city: string;
  source: "capacitor" | "browser" | "fallback";
  usedFallback: boolean;
  fetchedAt: number;
};

export type PersistedHomeWeather = {
  weather: WeatherSummary;
  lat: number;
  lng: number;
  fetchedAt: number;
};

function readJson<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

/**
 * 讀取本機最近位置。
 * allowStale：過期仍回傳（供 Places 先用，背景再刷 GPS），避免首屏空等高精度定位。
 */
export function readPersistedHomeLocation(
  now = Date.now(),
  options?: { allowStale?: boolean },
): PersistedHomeLocation | null {
  const row = readJson<PersistedHomeLocation>(HOME_LOCATION_KEY);
  if (!row) {
    console.info("[CACHE_LOCATION_MISS]");
    return null;
  }
  if (
    typeof row.lat !== "number" ||
    typeof row.lng !== "number" ||
    typeof row.fetchedAt !== "number"
  ) {
    console.info("[CACHE_LOCATION_MISS]");
    return null;
  }
  const ageMs = now - row.fetchedAt;
  if (ageMs > HOME_LOCATION_CACHE_TTL_MS) {
    if (!options?.allowStale) {
      console.info("[CACHE_LOCATION_MISS]");
      return null;
    }
    console.info("[CACHE_LOCATION_STALE_HIT]", {
      lat: row.lat,
      lng: row.lng,
      ageMs,
    });
    return row;
  }
  console.info("[CACHE_LOCATION_HIT]", {
    lat: row.lat,
    lng: row.lng,
    ageMs,
  });
  return row;
}

export function writePersistedHomeLocation(input: {
  lat: number;
  lng: number;
  city?: string;
  source?: "capacitor" | "browser" | "fallback";
  usedFallback?: boolean;
}): void {
  writeJson(HOME_LOCATION_KEY, {
    lat: input.lat,
    lng: input.lng,
    city: input.city?.trim() ?? "",
    source: input.source ?? "capacitor",
    usedFallback: input.usedFallback ?? false,
    fetchedAt: Date.now(),
  } satisfies PersistedHomeLocation);
}

export function readPersistedHomeWeather(now = Date.now()): PersistedHomeWeather | null {
  const row = readJson<PersistedHomeWeather>(HOME_WEATHER_KEY);
  if (!row?.weather || typeof row.fetchedAt !== "number") {
    console.info("[CACHE_WEATHER_MISS]");
    return null;
  }
  if (now - row.fetchedAt > HOME_WEATHER_CACHE_TTL_MS) {
    console.info("[CACHE_WEATHER_MISS]");
    return null;
  }
  console.info("[CACHE_WEATHER_HIT]", {
    city: row.weather.city,
    ageMs: now - row.fetchedAt,
  });
  return row;
}

export function writePersistedHomeWeather(
  weather: WeatherSummary,
  coords: { lat: number; lng: number },
): void {
  writeJson(HOME_WEATHER_KEY, {
    weather,
    lat: coords.lat,
    lng: coords.lng,
    fetchedAt: Date.now(),
  } satisfies PersistedHomeWeather);
}

export function isHomePlacesCacheValidForCoords(
  cachedLat: number | null | undefined,
  cachedLng: number | null | undefined,
  currentLat: number,
  currentLng: number,
  ageMs: number | null,
): boolean {
  if (ageMs == null) return false;
  if (ageMs > HOME_PLACES_CACHE_TTL_MS) return false;
  if (cachedLat == null || cachedLng == null) return true;
  const dist = distanceMeters({ lat: cachedLat, lng: cachedLng }, { lat: currentLat, lng: currentLng });
  return dist < HOME_PLACES_CACHE_MAX_DISTANCE_M;
}

export function logHomeRenderFromCache(source: "weather" | "places" | "both"): void {
  console.info("[HOME_RENDER_FROM_CACHE]", { source });
}

export function logHomeRefreshBackground(target: "weather" | "places" | "location" | "all"): void {
  console.info("[HOME_REFRESH_BACKGROUND]", { target });
}
