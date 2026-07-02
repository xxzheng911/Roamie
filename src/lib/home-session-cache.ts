import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { sanitizeHomeNearbyPicksForDisplay } from "@/lib/home-nearby-display";
import { PLACES_HOME_DISPLAY_TTL_MS } from "@/lib/places-api-guard";
import type { WeatherSummary } from "@/lib/weather-types";

const HOME_PICKS_PERSIST_KEY = "roamie:home-nearby-picks-persisted";

type PersistedHomePicks = {
  picks: HomeNearbyPick[];
  loadKey: string | null;
  locationHash: string | null;
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

function writePersistedHomePicks(picks: HomeNearbyPick[], loadKey: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedHomePicks = {
      picks: sanitizeHomeNearbyPicksForDisplay(picks, { logDrop: false }),
      loadKey,
      locationHash: locationHashFromLoadKey(loadKey),
      updatedAt: Date.now(),
    };
    localStorage.setItem(HOME_PICKS_PERSIST_KEY, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

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
  weather: null,
  userLocation: null,
  nearbyPicks: persistedBoot?.picks ?? [],
  nearbyLoadKey: persistedBoot?.loadKey ?? null,
};

export function readHomeSessionWeather(): WeatherSummary | null {
  return snapshot.weather;
}

export function writeHomeSessionWeather(weather: WeatherSummary | null): void {
  snapshot.weather = weather;
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
): void {
  const sanitized = sanitizeHomeNearbyPicksForDisplay(picks, { logDrop: false });
  snapshot.nearbyPicks = sanitized;
  snapshot.nearbyLoadKey = loadKey;
  if (sanitized.length > 0) {
    writePersistedHomePicks(sanitized, loadKey);
  }
}

export function readHomeSessionNearbyLoadKey(): string | null {
  return snapshot.nearbyLoadKey;
}

export type HomeSessionNearbyMeta = {
  picks: HomeNearbyPick[];
  loadKey: string | null;
  locationHash: string | null;
  ageMs: number | null;
  displayFresh: boolean;
  apiFresh: boolean;
};

/** 讀取 persisted / session 附近地點 */
export function readHomeSessionNearbyMeta(now = Date.now()): HomeSessionNearbyMeta {
  const persisted = readPersistedHomePicks();
  const picks = sanitizeHomeNearbyPicksForDisplay(snapshot.nearbyPicks, { logDrop: false });
  const loadKey = snapshot.nearbyLoadKey;
  const locationHash = persisted?.locationHash ?? locationHashFromLoadKey(loadKey);
  const updatedAt = persisted?.updatedAt ?? null;
  const ageMs = updatedAt != null ? now - updatedAt : null;
  const displayFresh = ageMs != null && ageMs < PLACES_HOME_DISPLAY_TTL_MS && picks.length > 0;
  const apiFresh =
    displayFresh && loadKey != null && loadKey === persisted?.loadKey;
  return { picks, loadKey, locationHash, ageMs, displayFresh, apiFresh };
}
