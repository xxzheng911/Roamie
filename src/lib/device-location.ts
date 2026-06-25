import { isDefaultFallbackCenter, normalizeDeviceLocation, DEFAULT_APP_FALLBACK_CENTER } from "@/lib/geo";
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
import { getCapacitorGeolocation } from "@/lib/capacitor-geolocation";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import {
  isHomeLocationBootstrapped,
  isHomeLocationMode,
  markHomeLocationBootstrapped,
} from "@/lib/location-coordinator";
import {
  isAppActiveForLocation,
  registerLocationAppGate,
  waitForAppActiveForLocation,
} from "@/lib/location-app-gate";

export { isIosSimulatorPresetLocation } from "@/lib/device-location-resolve";

export const DEFAULT_FALLBACK_LOCATION = {
  lat: DEFAULT_APP_FALLBACK_CENTER.lat,
  lng: DEFAULT_APP_FALLBACK_CENTER.lng,
  city: "高雄市",
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
  accuracy?: number | null;
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

function coordBucketKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)}:${lng.toFixed(3)}`;
}

let lastPublishedBucket: string | null = null;
let requestInFlight: Promise<DeviceLocationResult> | null = null;
/** 本次 App session 的有效 GPS（首頁 / 天氣 / nearby 共用） */
let sessionLocation: DeviceLocationResult | null = null;

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
  return isCapacitorNativeShell();
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
    if (!normalized || isDefaultFallbackCenter(normalized.lat, normalized.lng)) return null;
    return normalized;
  } catch {
    return null;
  }
}

export function getLastKnownDeviceCoords(): { lat: number; lng: number } | null {
  return readLastGoodCoords();
}

export function getSessionDeviceLocation(): DeviceLocationResult | null {
  return sessionLocation;
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

function markPublishedCoords(lat: number, lng: number): void {
  lastPublishedBucket = coordBucketKey(lat, lng);
}

function logLocationSuccess(result: DeviceLocationResult, via: string): void {
  console.info("[LOCATION_REQUEST_SUCCESS]", {
    lat: result.lat,
    lng: result.lng,
    source: result.source,
    usedFallback: result.usedFallback,
    permission: result.permission,
    accuracy: result.accuracy ?? null,
    via,
  });
}

function parseGpsPosition(
  latitude: number,
  longitude: number,
  source: "capacitor" | "browser",
  accuracy?: number | null,
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
  markPublishedCoords(resolved.lat, resolved.lng);

  return {
    lat: resolved.lat,
    lng: resolved.lng,
    city: "",
    permission: "granted",
    usedFallback: false,
    source,
    accuracy: accuracy ?? null,
  };
}

type CapGeolocation = typeof import("@capacitor/geolocation").Geolocation;

async function readCapacitorPosition(): Promise<{
  result: DeviceLocationResult | null;
  permission: LocationPermissionState;
}> {
  if (!isNativeShell()) return { result: null, permission: "unknown" };

  registerLocationAppGate();

  if (!isAppActiveForLocation()) {
    const ready = await waitForAppActiveForLocation(8_000);
    if (!ready) {
      console.info("[LOCATION_REQUEST_FAILED]", "reason=app_inactive");
      return { result: null, permission: "unavailable" };
    }
  }

  try {
    const Geolocation = getCapacitorGeolocation();
    const permission = await ensureLocationPermission({ request: true });
    console.info("[LOCATION_PERMISSION_STATUS]", `status=${permission}`);
    if (permission !== "granted") {
      return { result: null, permission };
    }

    console.info("[LOCATION_REQUEST_START]", "platform=capacitor");

    const attempts: Parameters<CapGeolocation["getCurrentPosition"]>[0][] = [
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 120_000 },
    ];

    for (const options of attempts) {
      try {
        if (!isAppActiveForLocation()) {
          console.info("[LOCATION_REQUEST_FAILED]", "reason=app_backgrounded_mid_request");
          return { result: null, permission: "unavailable" };
        }
        const pos = await Geolocation.getCurrentPosition(options);
        const parsed = parseGpsPosition(
          pos.coords.latitude,
          pos.coords.longitude,
          "capacitor",
          pos.coords.accuracy,
        );
        if (parsed) return { result: parsed, permission: "granted" };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[LOCATION_REQUEST_FAILED]", msg);
      }
    }

    return { result: null, permission: "unavailable" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[LOCATION_REQUEST_FAILED]", "reason=capacitor_unavailable", msg);
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
          result: parseGpsPosition(
            pos.coords.latitude,
            pos.coords.longitude,
            "browser",
            pos.coords.accuracy,
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
  const lastGood = readLastGoodCoords();
  const lastSearch = readLastSearchLocation();
  const picked = pickFallbackCoordinates(lastGood, lastSearch);

  if (lastGood && picked.lat === lastGood.lat && picked.lng === lastGood.lng) {
    console.info("[LOCATION_LAST_KNOWN_USED]", {
      lat: picked.lat,
      lng: picked.lng,
      reason,
    });
  } else {
    console.info("[LOCATION_FALLBACK_USED]", {
      reason,
      permission,
      coords: picked,
      lastSearchCity: lastSearch?.city ?? null,
      usedDefaultCenter: picked.usedDefaultTaipei,
    });
  }

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

async function requestDeviceLocationInternal(): Promise<DeviceLocationResult> {
  registerLocationAppGate();

  const native = isNativeShell();

  if (native && !isAppActiveForLocation()) {
    const ready = await waitForAppActiveForLocation(8_000);
    if (!ready) {
      return fallbackResult("unavailable", "app_inactive_before_request");
    }
  }

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

/** GPS 權限已 granted 但尚未取得 fix 時，不應改用 remembered city。 */
export function shouldUseRememberedLocationFallback(loc: DeviceLocationResult): boolean {
  if (!loc.usedFallback) return false;
  return loc.permission === "denied" || loc.permission === "unavailable";
}

/** 仍在等真實 GPS 時，不應以 fallback 打 weather / nearby（Native 失敗時直接 fallback）。 */
export function shouldDeferUntilGpsFix(loc: DeviceLocationResult): boolean {
  if (isNativeShell() && loc.usedFallback) return false;
  return loc.usedFallback && !shouldUseRememberedLocationFallback(loc);
}

export type RequestDeviceLocationOptions = {
  /** 略過 session cache，強制重新 getCurrentPosition */
  force?: boolean;
};

export async function requestDeviceLocation(
  options?: RequestDeviceLocationOptions,
): Promise<DeviceLocationResult> {
  const force = options?.force === true;

  if (
    force &&
    isHomeLocationMode() &&
    isHomeLocationBootstrapped() &&
    sessionLocation &&
    !sessionLocation.usedFallback
  ) {
    console.info("[LOCATION_CACHE_HIT]", {
      lat: sessionLocation.lat,
      lng: sessionLocation.lng,
      source: sessionLocation.source,
      via: "home_force_blocked",
    });
    return sessionLocation;
  }

  if (!force && sessionLocation && !sessionLocation.usedFallback) {
    console.info("[LOCATION_CACHE_HIT]", {
      lat: sessionLocation.lat,
      lng: sessionLocation.lng,
      source: sessionLocation.source,
      via: "session",
    });
    return sessionLocation;
  }

  if (requestInFlight) {
    console.info("[LOCATION_INIT]", { reason: "join_in_flight", force });
    return requestInFlight;
  }

  console.info("[LOCATION_INIT]", { reason: "request", force });
  requestInFlight = requestDeviceLocationInternal()
    .then((result) => {
      if (!result.usedFallback) {
        sessionLocation = result;
        markHomeLocationBootstrapped();
      }
      logLocationSuccess(result, force ? "request_force" : "request");
      return result;
    })
    .finally(() => {
      requestInFlight = null;
    });

  return requestInFlight;
}
