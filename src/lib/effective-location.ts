import { KAOHSIUNG_COORDS } from "@/lib/api/constants";
import { distanceMeters } from "@/lib/geo-distance";
import { logPlacesSkipSmallLocationChange } from "@/lib/places-api-guard";
import {
  DEFAULT_FALLBACK_LOCATION,
  getLastKnownDeviceCoords,
  getSessionDeviceLocation,
  requestDeviceLocation,
  shouldDeferUntilGpsFix,
  shouldUseRememberedLocationFallback,
  type DeviceLocationResult,
  type LocationPermissionState,
} from "@/lib/device-location";
import { pickFallbackCoordinates } from "@/lib/device-location-resolve";
import { readLastSearchLocation } from "@/lib/last-search-location";
import {
  writeHomeSessionUserLocation,
  type HomeSessionUserLocation,
} from "@/lib/home-session-cache";

export type EffectiveLocationSource = "gps" | "remembered" | "last_search" | "default";

export type EffectiveLocationSnapshot = {
  lat: number;
  lng: number;
  city: string;
  locationKey: string;
  source: EffectiveLocationSource;
  permission: LocationPermissionState;
  isFallback: boolean;
  isReadyForPlaces: boolean;
  status: "pending_gps" | "ready";
  accuracy: number | null;
};

const MAX_POOR_ACCURACY_M = 200;
/** GPS 位移小於此距離不更新 locationKey、不觸發 Places */
const PLACES_LOCATION_MIN_MOVE_M = 500;

let snapshot: EffectiveLocationSnapshot | null = null;
let bootstrapPromise: Promise<EffectiveLocationSnapshot> | null = null;
const listeners = new Set<() => void>();

export { normalizedLocationKey } from "@/lib/location-key";

const loggedLocationSkipKeys = new Set<string>();

export function getEffectiveLocationSnapshot(): EffectiveLocationSnapshot | null {
  return snapshot;
}

export function subscribeEffectiveLocation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function logSkipSameBucket(locationKey: string): void {
  if (snapshot?.locationKey !== locationKey) return;
  if (loggedLocationSkipKeys.has(locationKey)) return;
  loggedLocationSkipKeys.add(locationKey);
  console.info("[LOCATION_PATCH_SKIP_SAME_KEY]", { locationKey });
}

function logEffectiveReady(next: EffectiveLocationSnapshot): void {
  console.info("[LOCATION_PATCH_APPLIED]", {
    locationKey: next.locationKey,
    lat: next.lat,
    lng: next.lng,
    source: next.source,
    isFallback: next.isFallback,
    isReadyForPlaces: next.isReadyForPlaces,
    accuracy: next.accuracy,
    via: "effective_location",
  });
}

function classifySource(loc: DeviceLocationResult): EffectiveLocationSource {
  if (!loc.usedFallback && loc.source !== "fallback") return "gps";
  const lastSearch = readLastSearchLocation();
  if (lastSearch && normalizedLocationKey(lastSearch.lat, lastSearch.lng) === normalizedLocationKey(loc.lat, loc.lng)) {
    return "last_search";
  }
  const lastGood = getLastKnownDeviceCoords();
  if (lastGood && normalizedLocationKey(lastGood.lat, lastGood.lng) === normalizedLocationKey(loc.lat, loc.lng)) {
    return "remembered";
  }
  return "default";
}

function resolvePlacesFallback(permission: LocationPermissionState): DeviceLocationResult {
  const lastGood = getLastKnownDeviceCoords();
  const lastSearch = readLastSearchLocation();
  const picked = pickFallbackCoordinates(lastGood, lastSearch);
  const city =
    lastSearch?.city?.trim() ||
    (picked.usedDefaultTaipei ? DEFAULT_FALLBACK_LOCATION.city : "");
  return {
    lat: picked.lat,
    lng: picked.lng,
    city,
    permission,
    usedFallback: true,
    source: "fallback",
    accuracy: null,
  };
}

function resolveWeatherStyleFallback(loc: DeviceLocationResult): DeviceLocationResult {
  const mapCenter = readLastSearchLocation();
  if (mapCenter) {
    return {
      ...loc,
      lat: mapCenter.lat,
      lng: mapCenter.lng,
      city: mapCenter.city ?? loc.city,
      usedFallback: true,
      source: "fallback",
    };
  }
  if (loc.city?.trim()) return loc;
  return {
    ...loc,
    lat: KAOHSIUNG_COORDS.lat,
    lng: KAOHSIUNG_COORDS.lng,
    city: "高雄市",
    usedFallback: true,
    source: "fallback",
  };
}

function toSnapshot(
  loc: DeviceLocationResult,
  options: { readyForPlaces: boolean; status: EffectiveLocationSnapshot["status"] },
): EffectiveLocationSnapshot {
  return {
    lat: loc.lat,
    lng: loc.lng,
    city: loc.city,
    locationKey: normalizedLocationKey(loc.lat, loc.lng),
    source: classifySource(loc),
    permission: loc.permission,
    isFallback: loc.usedFallback,
    isReadyForPlaces: options.readyForPlaces,
    status: options.status,
    accuracy: loc.accuracy ?? null,
  };
}

function syncHomeSession(next: EffectiveLocationSnapshot): void {
  if (!next.isReadyForPlaces) return;
  const sessionLoc: HomeSessionUserLocation = {
    lat: next.lat,
    lng: next.lng,
    city: next.city || "",
    source: next.source === "gps" ? "capacitor" : "fallback",
  };
  writeHomeSessionUserLocation(sessionLoc);
}

function shouldRejectPoorAccuracy(next: EffectiveLocationSnapshot): boolean {
  if (next.accuracy == null) return false;
  if (next.accuracy <= MAX_POOR_ACCURACY_M) return false;
  return snapshot?.isReadyForPlaces === true;
}

function movedEnoughForPlacesUpdate(
  prev: EffectiveLocationSnapshot | null,
  lat: number,
  lng: number,
): boolean {
  if (!prev?.isReadyForPlaces) return true;
  return distanceMeters({ lat: prev.lat, lng: prev.lng }, { lat, lng }) >= PLACES_LOCATION_MIN_MOVE_M;
}

function publish(next: EffectiveLocationSnapshot, reason: string): boolean {
  if (
    snapshot?.locationKey === next.locationKey &&
    snapshot.isReadyForPlaces === next.isReadyForPlaces
  ) {
    logSkipSameBucket(next.locationKey);
    return false;
  }
  if (!movedEnoughForPlacesUpdate(snapshot, next.lat, next.lng)) {
    if (snapshot) {
      const dist = Math.round(
        distanceMeters({ lat: snapshot.lat, lng: snapshot.lng }, { lat: next.lat, lng: next.lng }),
      );
      logPlacesSkipSmallLocationChange(dist);
    }
    logSkipSameBucket(snapshot?.locationKey ?? next.locationKey);
    return false;
  }
  if (shouldRejectPoorAccuracy(next)) {
    logSkipSameBucket(next.locationKey);
    return false;
  }

  snapshot = next;
  syncHomeSession(next);

  if (next.isReadyForPlaces && next.status === "ready") {
    logEffectiveReady(next);
  } else if (reason === "pending_gps") {
    console.info("[LOCATION_EFFECTIVE_PENDING]", {
      locationKey: next.locationKey,
      lat: next.lat,
      lng: next.lng,
    });
  }

  notify();
  return true;
}

async function bootstrapEffectiveLocation(): Promise<EffectiveLocationSnapshot> {
  console.info("[LOCATION_INIT]", { via: "effective_location_bootstrap" });

  const cachedSession = getSessionDeviceLocation();
  const loc = cachedSession ?? (await requestDeviceLocation());

  let finalLoc = loc;
  if (shouldDeferUntilGpsFix(loc)) {
    publish(
      toSnapshot(loc, { readyForPlaces: false, status: "pending_gps" }),
      "pending_gps",
    );
    finalLoc = resolvePlacesFallback(loc.permission);
  } else if (!loc.usedFallback && loc.source !== "fallback") {
    finalLoc = loc;
  } else if (shouldUseRememberedLocationFallback(loc)) {
    finalLoc = resolveWeatherStyleFallback(loc);
  } else if (loc.usedFallback) {
    finalLoc = resolvePlacesFallback(loc.permission);
  }

  const ready = toSnapshot(finalLoc, { readyForPlaces: true, status: "ready" });
  publish(ready, "bootstrap_ready");
  return snapshot ?? ready;
}

/** App 啟動後解析有效定位；Places / 地圖共用。 */
export function ensureEffectiveLocationBootstrap(): Promise<EffectiveLocationSnapshot> {
  if (snapshot?.isReadyForPlaces) {
    console.info("[LOCATION_CACHE_HIT]", {
      locationKey: snapshot.locationKey,
      lat: snapshot.lat,
      lng: snapshot.lng,
      source: snapshot.source,
      via: "effective_location_snapshot",
    });
    return Promise.resolve(snapshot);
  }
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapEffectiveLocation().finally(() => {
      bootstrapPromise = null;
    });
  }
  return bootstrapPromise;
}
