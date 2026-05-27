import type { DeviceLocationResult } from "@/lib/device-location";
import type { LocationPermissionState } from "@/lib/location-permission-manager";

export type DeviceLocationSnapshot = {
  lat: number;
  lng: number;
  city: string;
  source: DeviceLocationResult["source"];
  permission: LocationPermissionState;
  usedFallback: boolean;
  updatedAt: number;
};

let snapshot: DeviceLocationSnapshot | null = null;
const listeners = new Set<(loc: DeviceLocationSnapshot) => void>();

const DEFAULT_FRESH_MS = 60_000;

export function getDeviceLocationSnapshot(): DeviceLocationSnapshot | null {
  return snapshot;
}

export function getFreshDeviceLocationSnapshot(
  maxAgeMs = DEFAULT_FRESH_MS,
): DeviceLocationSnapshot | null {
  if (!snapshot) return null;
  if (Date.now() - snapshot.updatedAt > maxAgeMs) return null;
  return snapshot;
}

export function deviceLocationFromSnapshot(
  snap: DeviceLocationSnapshot,
): DeviceLocationResult {
  return {
    lat: snap.lat,
    lng: snap.lng,
    city: snap.city,
    permission: snap.permission,
    usedFallback: snap.usedFallback,
    source: snap.source,
  };
}

export function subscribeDeviceLocationStore(
  listener: (loc: DeviceLocationSnapshot) => void,
): () => void {
  listeners.add(listener);
  if (snapshot) listener(snapshot);
  return () => listeners.delete(listener);
}

export function updateDeviceLocationStore(loc: DeviceLocationResult): DeviceLocationSnapshot {
  const next: DeviceLocationSnapshot = {
    lat: loc.lat,
    lng: loc.lng,
    city: loc.city,
    source: loc.source,
    permission: loc.permission,
    usedFallback: loc.usedFallback,
    updatedAt: Date.now(),
  };
  snapshot = next;
  console.info("[LOCATION_STORE] updated", {
    lat: next.lat,
    lng: next.lng,
    source: next.source,
    usedFallback: next.usedFallback,
    permission: next.permission,
  });
  for (const listener of listeners) listener(next);
  return next;
}
