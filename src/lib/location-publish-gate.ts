import type { DeviceLocationResult } from "@/lib/device-location";
import { isLocationWatchAppActive } from "@/lib/device-location";
import {
  HOME_LOCATION_MIN_REFETCH_DISTANCE_M,
  coordsMovedMeters,
  logLocationUpdateSkipped,
} from "@/lib/home-location-fetch-policy";

/** store 更新最短間隔（毫秒） */
export const LOCATION_STORE_MIN_UPDATE_INTERVAL_MS = 45_000;

type PublishGateState = {
  coords: { lat: number; lng: number } | null;
  at: number;
  accuracyM: number | null;
};

const gateState: PublishGateState = {
  coords: null,
  at: 0,
  accuracyM: null,
};

export function logLocationUpdateAccepted(payload: {
  lat: number;
  lng: number;
  accuracyM: number | null;
  distanceMoved: number;
  source: string;
}): void {
  console.info("[LOCATION_UPDATE_ACCEPTED]", payload);
}

export function shouldAcceptLocationUpdate(
  loc: Pick<DeviceLocationResult, "lat" | "lng" | "usedFallback">,
  accuracy: number | null | undefined,
): {
  accept: boolean;
  reason?: string;
  distanceMoved: number;
  lastUpdateAgo: number | null;
} {
  const now = Date.now();
  const distanceMoved = coordsMovedMeters(gateState.coords, {
    lat: loc.lat,
    lng: loc.lng,
  });
  const lastUpdateAgo = gateState.at > 0 ? now - gateState.at : null;
  const accuracyM =
    accuracy != null && Number.isFinite(accuracy) ? Math.max(0, accuracy) : null;

  if (!loc.usedFallback && gateState.coords && distanceMoved < HOME_LOCATION_MIN_REFETCH_DISTANCE_M) {
    return {
      accept: false,
      reason: "distance_under_100m",
      distanceMoved,
      lastUpdateAgo,
    };
  }

  if (
    lastUpdateAgo != null &&
    lastUpdateAgo < LOCATION_STORE_MIN_UPDATE_INTERVAL_MS
  ) {
    return {
      accept: false,
      reason: "interval_under_45s",
      distanceMoved,
      lastUpdateAgo,
    };
  }

  if (
    !loc.usedFallback &&
    accuracyM != null &&
    gateState.accuracyM != null &&
    accuracyM > gateState.accuracyM * 1.25 &&
    gateState.accuracyM < 80
  ) {
    return {
      accept: false,
      reason: "accuracy_degraded",
      distanceMoved,
      lastUpdateAgo,
    };
  }

  return { accept: true, distanceMoved, lastUpdateAgo };
}

/** 通過閘門後更新 gate 狀態（在實際寫入 store 前呼叫） */
/** @internal vitest only */
export function resetLocationPublishGateForTests(): void {
  gateState.coords = null;
  gateState.at = 0;
  gateState.accuracyM = null;
}

export function markLocationUpdateAccepted(
  loc: Pick<DeviceLocationResult, "lat" | "lng">,
  accuracy: number | null | undefined,
): void {
  gateState.coords = { lat: loc.lat, lng: loc.lng };
  gateState.at = Date.now();
  gateState.accuracyM =
    accuracy != null && Number.isFinite(accuracy) ? Math.max(0, accuracy) : gateState.accuracyM;
}

export function tryGateLocationPublish(
  loc: DeviceLocationResult,
  accuracy?: number | null,
): { accept: boolean; loc: DeviceLocationResult } {
  const decision = shouldAcceptLocationUpdate(loc, accuracy);
  if (!decision.accept) {
    if (isLocationWatchAppActive()) {
      logLocationUpdateSkipped({
        reason: decision.reason ?? "skipped",
        distanceMoved: decision.distanceMoved,
        lastFetchAgo: decision.lastUpdateAgo,
      });
    }
    return { accept: false, loc };
  }

  markLocationUpdateAccepted(loc, accuracy);
  logLocationUpdateAccepted({
    lat: loc.lat,
    lng: loc.lng,
    accuracyM:
      accuracy != null && Number.isFinite(accuracy) ? Math.max(0, accuracy) : null,
    distanceMoved: decision.distanceMoved,
    source: loc.source,
  });
  return { accept: true, loc };
}
