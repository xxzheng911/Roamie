import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { sanitizeHomeNearbyPicksForDisplay } from "@/lib/home-nearby-display";
import {
  HOME_PLACES_CACHE_MAX_DISTANCE_M,
  HOME_PLACES_CACHE_TTL_MS,
  isHomePlacesCacheValidForCoords,
  logHomeRenderFromCache,
  readPersistedHomeWeather,
  writePersistedHomeWeather,
} from "@/lib/home-persistent-cache";
import { PLACES_HOME_DISPLAY_TTL_MS } from "@/lib/places-api-guard";
import type { WeatherSummary } from "@/lib/weather-types";

const HOME_PICKS_PERSIST_KEY = "roamie:home-nearby-picks-persisted";

type PersistedHomePicks = {
  picks: HomeNearbyPick[];
  loadKey: string | null;
  locationHash: string | null;
  lat: number | null;
  lng: number | null;
  updatedAt: number;
};

function locationHashFromLoadKey(loadKey: string | null): string | null {
  if (!loadKey) return null;
  const [locationKey] = loadKey.split(":");
  return locationKey ?? null;
}

function readPersistedHomePicks(): PersistedHomePicks | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(HOME_PICKS_PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedHomePicks;
    if (!parsed || !Array.isArray(parsed.picks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedHomePicks(
  picks: HomeNearbyPick[],
  loadKey: string | null,
  coords?: { lat: number; lng: number } | null,
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedHomePicks = {
      picks: sanitizeHomeNearbyPicksForDisplay(picks, { logDrop: false }),
      loadKey,
      locationHash: locationHashFromLoadKey(loadKey),
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      updatedAt: Date.now(),
    };
    localStorage.setItem(HOME_PICKS_PERSIST_KEY, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

const persistedWeatherBoot = readPersistedHomeWeather();
const persistedBoot = readPersistedHomePicks();

export type HomeSessionUserLocation = {
  lat: number;
  lng: number;
  city: string;
  source: "capacitor" | "browser" | "fallback";
};

type HomeSessionSnapshot = {
  weather: WeatherSummary | null;
  userLocation: HomeSessionUserLocation | null;
  nearbyPicks: HomeNearbyPick[];
  nearbyLoadKey: string | null;
};

const snapshot: HomeSessionSnapshot = {
  weather: persistedWeatherBoot?.weather ?? null,
  userLocation: null,
  nearbyPicks: persistedBoot?.picks ?? [],
  nearbyLoadKey: persistedBoot?.loadKey ?? null,
};

if (persistedWeatherBoot?.weather?.available) {
  logHomeRenderFromCache("weather");
}
if ((persistedBoot?.picks.length ?? 0) > 0) {
  logHomeRenderFromCache("places");
}

export function readHomeSessionWeather(): WeatherSummary | null {
  return snapshot.weather;
}

export function writeHomeSessionWeather(
  weather: WeatherSummary | null,
  coords?: { lat: number; lng: number } | null,
): void {
  snapshot.weather = weather;
  if (weather && coords) {
    writePersistedHomeWeather(weather, coords);
  }
}

export function readHomeSessionUserLocation(): HomeSessionUserLocation | null {
  return snapshot.userLocation;
}

export function writeHomeSessionUserLocation(loc: HomeSessionUserLocation | null): void {
  snapshot.userLocation = loc;
}

export function readHomeSessionNearbyPicks(): HomeNearbyPick[] {
  return sanitizeHomeNearbyPicksForDisplay(snapshot.nearbyPicks, { logDrop: false });
}

export function writeHomeSessionNearbyPicks(
  picks: HomeNearbyPick[],
  loadKey: string | null,
  coords?: { lat: number; lng: number } | null,
): void {
  const sanitized = sanitizeHomeNearbyPicksForDisplay(picks, { logDrop: false });
  snapshot.nearbyPicks = sanitized;
  snapshot.nearbyLoadKey = loadKey;
  if (sanitized.length > 0) {
    writePersistedHomePicks(sanitized, loadKey, coords);
  }
}

export function readHomeSessionNearbyLoadKey(): string | null {
  return snapshot.nearbyLoadKey;
}

export type HomeSessionNearbyMeta = {
  picks: HomeNearbyPick[];
  loadKey: string | null;
  locationHash: string | null;
  lat: number | null;
  lng: number | null;
  ageMs: number | null;
  displayFresh: boolean;
  apiFresh: boolean;
};

function evaluatePlacesCacheFreshness(
  picks: HomeNearbyPick[],
  updatedAt: number | null,
  lat: number | null,
  lng: number | null,
  currentLat?: number | null,
  currentLng?: number | null,
  now = Date.now(),
): { displayFresh: boolean; ageMs: number | null } {
  const ageMs = updatedAt != null ? now - updatedAt : null;
  if (picks.length === 0 || ageMs == null) {
    return { displayFresh: false, ageMs };
  }
  if (ageMs > HOME_PLACES_CACHE_TTL_MS) {
    return { displayFresh: false, ageMs };
  }
  if (currentLat != null && currentLng != null && lat != null && lng != null) {
    const valid = isHomePlacesCacheValidForCoords(lat, lng, currentLat, currentLng, ageMs);
    return { displayFresh: valid, ageMs };
  }
  const displayFresh = ageMs < PLACES_HOME_DISPLAY_TTL_MS && picks.length > 0;
  return { displayFresh, ageMs };
}

/** 讀取 persisted / session 附近地點 */
export function readHomeSessionNearbyMeta(
  now = Date.now(),
  currentCoords?: { lat: number; lng: number } | null,
): HomeSessionNearbyMeta {
  const persisted = readPersistedHomePicks();
  const picks = sanitizeHomeNearbyPicksForDisplay(snapshot.nearbyPicks, { logDrop: false });
  const loadKey = snapshot.nearbyLoadKey;
  const locationHash = persisted?.locationHash ?? locationHashFromLoadKey(loadKey);
  const lat = persisted?.lat ?? null;
  const lng = persisted?.lng ?? null;
  const updatedAt = persisted?.updatedAt ?? null;
  const { displayFresh, ageMs } = evaluatePlacesCacheFreshness(
    picks,
    updatedAt,
    lat,
    lng,
    currentCoords?.lat,
    currentCoords?.lng,
    now,
  );
  const apiFresh = displayFresh && loadKey != null && loadKey === persisted?.loadKey;
  return { picks, loadKey, locationHash, lat, lng, ageMs, displayFresh, apiFresh };
}

export function isHomeNearbyPlacesCacheHit(
  currentCoords: { lat: number; lng: number } | null | undefined,
  now = Date.now(),
): boolean {
  const meta = readHomeSessionNearbyMeta(now, currentCoords ?? null);
  if (meta.picks.length > 0 && meta.displayFresh) {
    console.info("[CACHE_PLACE_HIT]", { count: meta.picks.length, ageMs: meta.ageMs });
    return true;
  }
  console.info("[CACHE_PLACE_MISS]");
  return false;
}
