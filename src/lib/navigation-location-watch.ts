import type { DeviceLocationResult } from "@/lib/device-location";
import {
  canStartLocationWatch,
  isNavigationLocationMode,
} from "@/lib/location-coordinator";
import { normalizedLocationKey } from "@/lib/location-key";

type NavigationLocationListener = (loc: DeviceLocationResult) => void;

const listeners = new Set<NavigationLocationListener>();
let lastPublishedKey = "";

function notifyListeners(loc: DeviceLocationResult): void {
  const key = normalizedLocationKey(loc.lat, loc.lng);
  if (key === lastPublishedKey) {
    console.info("[LOCATION_PATCH_SKIP_SAME_KEY]", { locationKey: key, via: "navigation_once" });
    return;
  }
  lastPublishedKey = key;
  console.info("[LOCATION_PATCH_APPLIED]", {
    locationKey: key,
    lat: loc.lat,
    lng: loc.lng,
    via: "navigation_once",
  });
  for (const listener of listeners) {
    listener(loc);
  }
}

/**
 * 導航模式：單次 getCurrentPosition（不用 watchPosition，避免 TO JS 洗版）
 */
export function subscribeNavigationLocationWatch(
  onUpdate: NavigationLocationListener,
): () => void {
  if (!canStartLocationWatch("navigation_subscribe")) {
    return () => {};
  }

  listeners.add(onUpdate);
  void import("@/lib/device-location").then(({ requestDeviceLocation }) =>
    requestDeviceLocation({ force: true }).then((loc) => {
      if (!loc.usedFallback && isNavigationLocationMode()) {
        notifyListeners(loc);
      }
    }),
  );

  return () => {
    listeners.delete(onUpdate);
    if (listeners.size === 0) {
      lastPublishedKey = "";
    }
  };
}
