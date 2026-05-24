import { normalizeDeviceLocation, TAIPEI_CENTER } from "@/lib/geo";
import { detectPlatform } from "@/services/platform";

export const DEFAULT_FALLBACK_LOCATION = {
  lat: TAIPEI_CENTER.lat,
  lng: TAIPEI_CENTER.lng,
  city: "台北",
} as const;

export type LocationPermissionState =
  | "granted"
  | "denied"
  | "restricted"
  | "timeout"
  | "unavailable"
  | "unknown";

export type DeviceLocationResult = {
  lat: number;
  lng: number;
  city: string;
  permission: LocationPermissionState;
  usedFallback: boolean;
  source: "capacitor" | "browser" | "fallback";
};

const GEO_OPTIONS: PositionOptions = {
  timeout: 12_000,
  maximumAge: 60_000,
  enableHighAccuracy: true,
};

function permissionFromGeoError(code: number): LocationPermissionState {
  if (code === 1) return "denied";
  if (code === 2) return "unavailable";
  if (code === 3) return "timeout";
  return "unknown";
}

function readPosition(
  latitude: number,
  longitude: number,
  accuracy: number | null | undefined,
  source: "capacitor" | "browser",
): DeviceLocationResult | null {
  const normalized = normalizeDeviceLocation(latitude, longitude);
  if (!normalized) {
    console.warn("[Weather] fallback reason", "invalid coordinates from GPS");
    return null;
  }

  console.info("[Weather] current coordinates", {
    lat: normalized.lat,
    lng: normalized.lng,
    accuracy,
    source,
  });

  return {
    ...normalized,
    city: "",
    permission: "granted",
    usedFallback: false,
    source,
  };
}

async function requestCapacitorLocation(): Promise<DeviceLocationResult | null> {
  const { isCapacitor } = detectPlatform();
  if (!isCapacitor) return null;

  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const status = await Geolocation.checkPermissions();

    if (status.location === "denied") {
      console.info("[Weather] location granted", false);
      return null;
    }

    if (status.location === "prompt" || status.location === "prompt-with-rationale") {
      const req = await Geolocation.requestPermissions();
      const granted = req.location === "granted";
      console.info("[Weather] location granted", granted);
      if (!granted) return null;
    } else {
      console.info("[Weather] location granted", status.location === "granted");
    }

    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 12_000,
      maximumAge: 60_000,
    });

    return readPosition(
      pos.coords.latitude,
      pos.coords.longitude,
      pos.coords.accuracy,
      "capacitor",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Weather] fallback reason", `capacitor geolocation: ${msg}`);
    return null;
  }
}

function geolocationPosition(): Promise<DeviceLocationResult | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      console.warn("[Weather] fallback reason", "browser geolocation API unavailable");
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve(
          readPosition(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy,
            "browser",
          ),
        ),
      (err) => {
        console.warn("[Weather] fallback reason", {
          code: err.code,
          message: err.message,
          permission: permissionFromGeoError(err.code),
        });
        resolve(null);
      },
      GEO_OPTIONS,
    );
  });
}

async function probePermissionState(): Promise<LocationPermissionState | null> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return null;
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (status.state === "granted") return "granted";
    if (status.state === "denied") return "denied";
    return null;
  } catch {
    return null;
  }
}

function fallbackResult(permission: LocationPermissionState, reason: string): DeviceLocationResult {
  console.warn("[Weather] fallback reason", reason);
  return {
    ...DEFAULT_FALLBACK_LOCATION,
    permission,
    usedFallback: true,
    source: "fallback",
  };
}

/** 取得裝置座標；僅在拒絕或失敗時回傳台北 fallback。 */
export async function requestDeviceLocation(): Promise<DeviceLocationResult> {
  const probed = await probePermissionState();
  if (probed === "denied") {
    console.info("[Weather] location granted", false);
    return fallbackResult("denied", "permission denied before GPS request");
  }

  const capacitor = await requestCapacitorLocation();
  if (capacitor) return capacitor;

  const browser = await geolocationPosition();
  if (browser) {
    console.info("[Weather] location granted", true);
    return browser;
  }

  const permission: LocationPermissionState =
    probed === "denied" ? "denied" : probed ?? "unavailable";

  return fallbackResult(permission, "GPS unavailable after capacitor + browser attempts");
}

/** 監聽位置變化；回傳 cleanup。 */
export function watchDeviceLocation(
  onUpdate: (loc: DeviceLocationResult) => void,
): () => void {
  let cancelled = false;
  let clearCapWatch: (() => void) | undefined;
  const { isCapacitor } = detectPlatform();

  if (isCapacitor) {
    void (async () => {
      try {
        const { Geolocation } = await import("@capacitor/geolocation");
        const watchId = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
          (pos, err) => {
            if (cancelled || err || !pos) return;
            const parsed = readPosition(
              pos.coords.latitude,
              pos.coords.longitude,
              pos.coords.accuracy,
              "capacitor",
            );
            if (parsed) onUpdate(parsed);
          },
        );
        clearCapWatch = () => {
          void Geolocation.clearWatch({ id: watchId });
        };
      } catch {
        /* browser fallback below */
      }
    })();
  }

  let browserWatchId: number | undefined;
  if (typeof navigator !== "undefined" && navigator.geolocation) {
    browserWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (cancelled) return;
        const parsed = readPosition(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy,
          "browser",
        );
        if (parsed) onUpdate(parsed);
      },
      () => {},
      GEO_OPTIONS,
    );
  }

  return () => {
    cancelled = true;
    clearCapWatch?.();
    if (browserWatchId !== undefined && navigator.geolocation) {
      navigator.geolocation.clearWatch(browserWatchId);
    }
  };
}
