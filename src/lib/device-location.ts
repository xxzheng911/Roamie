import { isDefaultTaipeiCenter, normalizeDeviceLocation, TAIPEI_CENTER } from "@/lib/geo";
import {
  isIosSimulatorPresetLocation,
  pickFallbackCoordinates,
  resolveGpsCoordinates,
  shouldRememberCoords,
} from "@/lib/device-location-resolve";
import { readLastSearchLocation } from "@/lib/last-search-location";
import {
  ensureLocationPermission,
  type LocationPermissionState,
} from "@/lib/location-permission-manager";
import { detectPlatform } from "@/services/platform";

export { isIosSimulatorPresetLocation } from "@/lib/device-location-resolve";

export const DEFAULT_FALLBACK_LOCATION = {
  lat: TAIPEI_CENTER.lat,
  lng: TAIPEI_CENTER.lng,
  city: "台北",
} as const;

const LAST_GOOD_COORDS_KEY = "roamie:last-device-coords";

export type { LocationPermissionState } from "@/lib/location-permission-manager";

export type DeviceLocationResult = {
  lat: number;
  lng: number;
  city: string;
  permission: LocationPermissionState;
  /** true = 未取得 GPS，使用上次有效座標或台北預設 */
  usedFallback: boolean;
  source: "capacitor" | "browser" | "fallback";
};

const GEO_OPTIONS: PositionOptions = {
  timeout: 25_000,
  maximumAge: 60_000,
  enableHighAccuracy: true,
};

const GEO_OPTIONS_LOW: PositionOptions = {
  timeout: 30_000,
  maximumAge: 300_000,
  enableHighAccuracy: false,
};

function isDevBuild(): boolean {
  return import.meta.env.DEV && !import.meta.env.PROD;
}

function readDevOverrideCoords(): { lat: number; lng: number } | null {
  if (!isDevBuild()) return null;
  const latRaw = import.meta.env.VITE_CAPACITOR_DEV_LOCATION_LAT as string | undefined;
  const lngRaw = import.meta.env.VITE_CAPACITOR_DEV_LOCATION_LNG as string | undefined;
  if (!latRaw || !lngRaw) return null;
  return normalizeDeviceLocation(Number(latRaw), Number(lngRaw));
}

function allowSimulatorGpsInDev(): boolean {
  return isDevBuild() && import.meta.env.VITE_LOCATION_USE_SIMULATOR_GPS === "1";
}

function isNativeShell(): boolean {
  const info = detectPlatform();
  if (info.isCapacitor) return true;
  if (typeof window === "undefined") return false;
  const cap = (
    window as Window & {
      Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean };
    }
  ).Capacitor;
  const platform = cap?.getPlatform?.();
  return platform === "ios" || platform === "android";
}

function permissionFromGeoError(code: number): LocationPermissionState {
  if (code === 1) return "denied";
  if (code === 2) return "unavailable";
  if (code === 3) return "timeout";
  return "unknown";
}

function readLastGoodCoords(): { lat: number; lng: number } | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LAST_GOOD_COORDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lat?: number; lng?: number };
    if (typeof parsed.lat !== "number" || typeof parsed.lng !== "number") return null;
    const normalized = normalizeDeviceLocation(parsed.lat, parsed.lng);
    if (!normalized || isDefaultTaipeiCenter(normalized.lat, normalized.lng)) return null;
    return normalized;
  } catch {
    return null;
  }
}

function rememberGoodCoords(lat: number, lng: number): void {
  if (typeof sessionStorage === "undefined") return;
  if (!shouldRememberCoords(lat, lng)) return;
  const normalized = normalizeDeviceLocation(lat, lng);
  if (!normalized) return;
  try {
    sessionStorage.setItem(LAST_GOOD_COORDS_KEY, JSON.stringify(normalized));
  } catch {
    /* ignore */
  }
}

function readPosition(
  latitude: number,
  longitude: number,
  accuracy: number | null | undefined,
  source: "capacitor" | "browser",
): DeviceLocationResult | null {
  const resolved = resolveGpsCoordinates({
    lat: latitude,
    lng: longitude,
    isDevBuild: isDevBuild(),
    isNativeShell: isNativeShell(),
    allowSimulatorGps: allowSimulatorGpsInDev(),
    devOverride: readDevOverrideCoords(),
    lastGood: readLastGoodCoords(),
  });

  if (!resolved) {
    console.warn("[Location] invalid coordinates from GPS");
    return null;
  }

  if (resolved.kind === "dev-simulator-substitute") {
    console.warn("[Location] iOS Simulator US preset → Taiwan dev coords (dev build only)", {
      reason: resolved.substituteReason,
      using: { lat: resolved.lat, lng: resolved.lng },
    });
  }

  rememberGoodCoords(resolved.lat, resolved.lng);

  console.info("[Location] GPS fix", {
    lat: resolved.lat,
    lng: resolved.lng,
    accuracy,
    source,
    kind: resolved.kind,
    build: import.meta.env.PROD ? "production" : "development",
    simulatorPreset: resolved.simulatorPreset,
  });

  return {
    lat: resolved.lat,
    lng: resolved.lng,
    city: "",
    permission: "granted",
    usedFallback: false,
    source,
  };
}

type CapGeolocation = typeof import("@capacitor/geolocation").Geolocation;
type CapPosition = Awaited<ReturnType<CapGeolocation["getCurrentPosition"]>>;

async function waitForCapacitorWatchFix(
  Geolocation: CapGeolocation,
  timeoutMs: number,
): Promise<CapPosition | null> {
  return new Promise((resolve) => {
    let watchId: string | undefined;
    const timer = window.setTimeout(() => {
      if (watchId) void Geolocation.clearWatch({ id: watchId });
      resolve(null);
    }, timeoutMs);

    void Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
      (pos, err) => {
        if (!pos || err) return;
        window.clearTimeout(timer);
        if (watchId) void Geolocation.clearWatch({ id: watchId });
        resolve(pos);
      },
    )
      .then((id) => {
        watchId = id;
      })
      .catch(() => {
        window.clearTimeout(timer);
        resolve(null);
      });
  });
}

async function readCapacitorPosition(): Promise<{
  result: DeviceLocationResult | null;
  permission: LocationPermissionState;
}> {
  if (!isNativeShell()) return { result: null, permission: "unknown" };

  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const permission = await ensureLocationPermission({ request: true });
    if (permission !== "granted") {
      return { result: null, permission };
    }

    const attempts: Parameters<CapGeolocation["getCurrentPosition"]>[0][] = [
      { enableHighAccuracy: true, timeout: 25_000, maximumAge: 0 },
      { enableHighAccuracy: true, timeout: 25_000, maximumAge: 60_000 },
      { enableHighAccuracy: false, timeout: 30_000, maximumAge: 120_000 },
    ];

    for (const options of attempts) {
      try {
        const pos = await Geolocation.getCurrentPosition(options);
        const parsed = readPosition(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy,
          "capacitor",
        );
        if (parsed) return { result: parsed, permission: "granted" };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[Location] capacitor getCurrentPosition failed", msg);
      }
    }

    const watched = await waitForCapacitorWatchFix(Geolocation, 15_000);
    if (watched) {
      const parsed = readPosition(
        watched.coords.latitude,
        watched.coords.longitude,
        watched.coords.accuracy,
        "capacitor",
      );
      if (parsed) return { result: parsed, permission: "granted" };
    }

    return { result: null, permission };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Location] capacitor geolocation unavailable", msg);
    return { result: null, permission: "unavailable" };
  }
}

function geolocationPosition(
  options: PositionOptions,
): Promise<{ result: DeviceLocationResult | null; permission: LocationPermissionState | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ result: null, permission: null });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          result: readPosition(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy,
            "browser",
          ),
          permission: "granted",
        }),
      (err) =>
        resolve({
          result: null,
          permission: permissionFromGeoError(err.code),
        }),
      options,
    );
  });
}

async function requestBrowserLocation(): Promise<{
  result: DeviceLocationResult | null;
  permission: LocationPermissionState | null;
}> {
  const high = await geolocationPosition(GEO_OPTIONS);
  if (high.result) return high;
  return geolocationPosition(GEO_OPTIONS_LOW);
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
  const lastSearch = readLastSearchLocation();
  const picked = pickFallbackCoordinates(readLastGoodCoords(), lastSearch);

  console.warn("[Location] GPS unavailable, using fallback", {
    reason,
    permission,
    coords: picked,
    lastSearchCity: lastSearch?.city ?? null,
    build: import.meta.env.PROD ? "production" : "development",
  });

  const fallbackCity =
    lastSearch?.city?.trim() ||
    (picked.usedDefaultTaipei ? DEFAULT_FALLBACK_LOCATION.city : "");

  return {
    lat: picked.lat,
    lng: picked.lng,
    city: fallbackCity,
    permission,
    usedFallback: true,
    source: "fallback",
  };
}

/** 取得裝置座標；正式版僅使用真實 GPS，失敗時才 fallback。 */
export async function requestDeviceLocation(): Promise<DeviceLocationResult> {
  const native = isNativeShell();

  if (native) {
    const { result: cap, permission: capPerm } = await readCapacitorPosition();
    if (cap) return cap;

    return fallbackResult(
      capPerm,
      "native GPS unavailable (Capacitor only; no browser geolocation fallback)",
    );
  }

  const { result: browser, permission: browserPerm } = await requestBrowserLocation();
  if (browser) return browser;

  const probed = await probePermissionState();
  const permission: LocationPermissionState =
    browserPerm === "denied" ? "denied" : probed ?? browserPerm ?? "unavailable";

  return fallbackResult(permission, "browser GPS unavailable");
}

/** 監聽位置變化；回傳 cleanup。 */
export function watchDeviceLocation(
  onUpdate: (loc: DeviceLocationResult) => void,
): () => void {
  let cancelled = false;
  let clearCapWatch: (() => void) | undefined;
  let browserWatchId: number | undefined;

  if (isNativeShell()) {
    void (async () => {
      try {
        const permission = await ensureLocationPermission({ request: false });
        if (permission !== "granted") return;

        const { Geolocation } = await import("@capacitor/geolocation");
        const watchId = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 25_000, maximumAge: 30_000 },
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
      } catch (e) {
        console.warn("[Location] capacitor watchPosition unavailable", e);
      }
    })();
  }

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
