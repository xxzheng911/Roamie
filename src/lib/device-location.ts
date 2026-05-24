import { normalizeDeviceLocation, TAIPEI_CENTER } from "@/lib/geo";

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
};

const GEO_OPTIONS: PositionOptions = {
  timeout: 12_000,
  maximumAge: 5 * 60 * 1000,
  enableHighAccuracy: true,
};

function permissionFromGeoError(code: number): LocationPermissionState {
  if (code === 1) return "denied";
  if (code === 2) return "unavailable";
  if (code === 3) return "timeout";
  return "unknown";
}

function readPosition(position: GeolocationPosition): DeviceLocationResult | null {
  const normalized = normalizeDeviceLocation(
    position.coords.latitude,
    position.coords.longitude,
  );
  if (!normalized) {
    console.warn("[Weather] location: invalid coordinates", {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    });
    return null;
  }
  console.info("[Weather] location: GPS ok", {
    lat: normalized.lat,
    lng: normalized.lng,
    accuracy: position.coords.accuracy,
  });
  return {
    ...normalized,
    city: DEFAULT_FALLBACK_LOCATION.city,
    permission: "granted",
    usedFallback: false,
  };
}

function geolocationPosition(): Promise<DeviceLocationResult | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      console.warn("[Weather] location: geolocation API unavailable");
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(readPosition(pos)),
      (err) => {
        console.warn("[Weather] location: GPS error", {
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
    console.info("[Weather] location: permission probe", status.state);
    if (status.state === "granted") return "granted";
    if (status.state === "denied") return "denied";
    return null;
  } catch {
    return null;
  }
}

/** 取得裝置座標；拒絕或失敗時回傳台北 fallback。 */
export async function requestDeviceLocation(): Promise<DeviceLocationResult> {
  console.info("[Weather] location: requesting");
  const probed = await probePermissionState();
  if (probed === "denied") {
    console.warn("[Weather] location: fallback (permission denied)");
    return {
      ...DEFAULT_FALLBACK_LOCATION,
      permission: "denied",
      usedFallback: true,
    };
  }

  const gps = await geolocationPosition();
  if (gps) return gps;

  const permission: LocationPermissionState =
    probed === "denied" ? "denied" : probed ?? "unavailable";

  console.warn("[Weather] location: fallback", { permission });
  return {
    ...DEFAULT_FALLBACK_LOCATION,
    permission,
    usedFallback: true,
  };
}
