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
  getCachedLocationPermission,
  type LocationPermissionState,
} from "@/lib/location-permission-manager";
import { tryGateLocationPublish } from "@/lib/location-publish-gate";
import {
  deviceLocationFromSnapshot,
  getDeviceLocationSnapshot,
  getFreshDeviceLocationSnapshot,
  updateDeviceLocationStore,
} from "@/lib/location-store";
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
    console.info("[LOCATION] permission=", permission);
    if (permissionBlocksGps(permission)) {
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
    if (isNativeShell()) {
      console.info("[WEB_GEOLOCATION] disabled", { method: "getCurrentPosition" });
      resolve({ result: null, permission: null });
      return;
    }
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

/** 首屏立即使用的座標（不等 GPS），避免附近推薦一直 loading */
export function readBootstrapDeviceLocation(): DeviceLocationResult {
  const permission = getCachedLocationPermission() ?? "unknown";
  const picked = pickFallbackCoordinates(readLastGoodCoords(), readLastSearchLocation());
  const lastSearch = readLastSearchLocation();
  return {
    lat: picked.lat,
    lng: picked.lng,
    city:
      lastSearch?.city?.trim() ||
      (picked.usedDefaultTaipei ? DEFAULT_FALLBACK_LOCATION.city : ""),
    permission,
    usedFallback: true,
    source: "fallback",
  };
}

function permissionBlocksGps(permission: LocationPermissionState): boolean {
  return permission === "denied" || permission === "restricted";
}

function publishDeviceLocation(
  loc: DeviceLocationResult,
  accuracy?: number | null,
): DeviceLocationResult {
  const { accept } = tryGateLocationPublish(loc, accuracy);
  if (!accept) {
    const snap = getDeviceLocationSnapshot();
    if (snap) return deviceLocationFromSnapshot(snap);
    return loc;
  }
  const snap = updateDeviceLocationStore(loc);
  return deviceLocationFromSnapshot(snap);
}

/** 僅地圖／即時追蹤使用 watchPosition；首頁用 getCurrentPosition */
export type LocationWatchScope = "map";

type LocationWatchListener = (loc: DeviceLocationResult) => void;
const watchListeners = new Set<LocationWatchListener>();
const activeWatchScopes = new Set<LocationWatchScope>();

let appWatchActive = true;
let watchRunning = false;
let logicalWatchId = 0;
let activeCapacitorWatchId: string | null = null;
let activeBrowserWatchId: number | null = null;
let capacitorWatchCancelled = false;

function hasActiveWatchConsumers(): boolean {
  return watchListeners.size > 0 && activeWatchScopes.size > 0;
}

function shouldRunHardwareWatch(): boolean {
  return appWatchActive && hasActiveWatchConsumers();
}

function logWatchCallbackIgnored(reason: string): void {
  if (!appWatchActive || !watchRunning) return;
  console.info("[LOCATION_WATCH_CALLBACK_IGNORED]", { reason });
}

export function isLocationWatchAppActive(): boolean {
  return appWatchActive;
}

function dispatchWatchUpdate(parsed: DeviceLocationResult, accuracy?: number | null): void {
  if (!appWatchActive) {
    logWatchCallbackIgnored("app_inactive");
    return;
  }
  const published = publishDeviceLocation(parsed, accuracy);
  for (const listener of watchListeners) {
    listener(published);
  }
}

function stopHardwareLocationWatch(reason: string): void {
  if (!watchRunning && !activeCapacitorWatchId && activeBrowserWatchId == null) return;

  capacitorWatchCancelled = true;
  const capId = activeCapacitorWatchId;
  activeCapacitorWatchId = null;

  if (capId && isNativeShell()) {
    void (async () => {
      try {
        const { Geolocation } = await import("@capacitor/geolocation");
        await Geolocation.clearWatch({ id: capId });
      } catch (e) {
        console.warn("[LOCATION_WATCH] clearWatch failed", e);
      }
    })();
  }

  if (activeBrowserWatchId != null && typeof navigator !== "undefined" && navigator.geolocation) {
    navigator.geolocation.clearWatch(activeBrowserWatchId);
    activeBrowserWatchId = null;
  }

  watchRunning = false;
  console.info("[LOCATION_WATCH_STOPPED]", { watchId: logicalWatchId, reason });
}

function startHardwareLocationWatch(): void {
  if (!shouldRunHardwareWatch()) return;

  if (watchRunning) {
    console.info("[LOCATION_WATCH_ALREADY_ACTIVE]", { watchId: logicalWatchId });
    return;
  }

  logicalWatchId += 1;
  watchRunning = true;
  capacitorWatchCancelled = false;
  console.info("[LOCATION_WATCH_STARTED]", { watchId: logicalWatchId });

  if (isNativeShell()) {
    void (async () => {
      try {
        const permission = await ensureLocationPermission({ request: false });
        if (permissionBlocksGps(permission) || !shouldRunHardwareWatch()) {
          watchRunning = false;
          return;
        }

        const { Geolocation } = await import("@capacitor/geolocation");
        const capWatchId = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 25_000, maximumAge: 30_000 },
          (pos, err) => {
            if (capacitorWatchCancelled || !watchRunning || !shouldRunHardwareWatch()) return;
            if (!appWatchActive) {
              logWatchCallbackIgnored("app_inactive");
              return;
            }
            if (err || !pos) return;
            const parsed = readPosition(
              pos.coords.latitude,
              pos.coords.longitude,
              pos.coords.accuracy,
              "capacitor",
            );
            if (parsed) dispatchWatchUpdate(parsed, pos.coords.accuracy);
          },
        );

        if (capacitorWatchCancelled || !shouldRunHardwareWatch()) {
          await Geolocation.clearWatch({ id: capWatchId });
          watchRunning = false;
          return;
        }

        activeCapacitorWatchId = capWatchId;
      } catch (e) {
        watchRunning = false;
        console.warn("[Location] capacitor watchPosition unavailable", e);
      }
    })();
    return;
  }

  if (typeof navigator !== "undefined" && navigator.geolocation) {
    activeBrowserWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!watchRunning || !shouldRunHardwareWatch()) return;
        if (!appWatchActive) {
          logWatchCallbackIgnored("app_inactive");
          return;
        }
        const parsed = readPosition(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy,
          "browser",
        );
        if (parsed) dispatchWatchUpdate(parsed, pos.coords.accuracy);
      },
      () => {},
      GEO_OPTIONS,
    );
  }
}

function syncHardwareLocationWatch(): void {
  if (shouldRunHardwareWatch()) {
    startHardwareLocationWatch();
  } else {
    stopHardwareLocationWatch(
      !appWatchActive ? "app_inactive" : "no_active_consumers",
    );
  }
}

/** App 前景／背景（由 location-watch-lifecycle 呼叫） */
export function setLocationWatchAppActive(active: boolean, reason: string): void {
  if (appWatchActive === active) return;
  appWatchActive = active;
  if (!active) {
    stopHardwareLocationWatch(reason);
  } else if (hasActiveWatchConsumers()) {
    syncHardwareLocationWatch();
  }
}

let inflightLocationRequest: Promise<DeviceLocationResult> | null = null;

async function fetchDeviceLocation(): Promise<DeviceLocationResult> {
  console.info("[LOCATION_GET_CURRENT_POSITION_START]", { native: isNativeShell() });
  console.info("[LOCATION] request start", { native: isNativeShell() });
  const native = isNativeShell();

  if (native) {
    const { result: cap, permission: capPerm } = await readCapacitorPosition();
    console.info("[LOCATION] capacitor result", {
      permission: capPerm,
      ok: Boolean(cap),
      usedFallback: cap?.usedFallback ?? true,
    });
    if (cap) {
      console.info("[LOCATION_GET_CURRENT_POSITION_SUCCESS]", {
        lat: cap.lat,
        lng: cap.lng,
        source: cap.source,
        usedFallback: cap.usedFallback,
      });
      return publishDeviceLocation(cap);
    }

    const fallback = publishDeviceLocation(
      fallbackResult(
        capPerm,
        "native GPS unavailable (Capacitor only; no browser geolocation fallback)",
      ),
    );
    console.info("[LOCATION_GET_CURRENT_POSITION_SUCCESS]", {
      lat: fallback.lat,
      lng: fallback.lng,
      source: fallback.source,
      usedFallback: fallback.usedFallback,
    });
    return fallback;
  }

  const { result: browser, permission: browserPerm } = await requestBrowserLocation();
  if (browser) {
    console.info("[LOCATION_GET_CURRENT_POSITION_SUCCESS]", {
      lat: browser.lat,
      lng: browser.lng,
      source: browser.source,
      usedFallback: browser.usedFallback,
    });
    return publishDeviceLocation(browser);
  }

  const probed = await probePermissionState();
  const permission: LocationPermissionState =
    browserPerm === "denied" ? "denied" : probed ?? browserPerm ?? "unavailable";

  const fallback = publishDeviceLocation(fallbackResult(permission, "browser GPS unavailable"));
  console.info("[LOCATION_GET_CURRENT_POSITION_SUCCESS]", {
    lat: fallback.lat,
    lng: fallback.lng,
    source: fallback.source,
    usedFallback: fallback.usedFallback,
  });
  return fallback;
}

export type RequestDeviceLocationOptions = {
  /** 略過 60s 內快取，強制重新 getCurrentPosition（手動重新定位） */
  force?: boolean;
};

/** 取得裝置座標；正式版僅使用真實 GPS，失敗時才 fallback。 */
export async function requestDeviceLocation(
  options?: RequestDeviceLocationOptions,
): Promise<DeviceLocationResult> {
  if (!options?.force) {
    const cached = getFreshDeviceLocationSnapshot();
    if (cached && !cached.usedFallback) {
      console.info("[LOCATION_STORE] reuse", { lat: cached.lat, lng: cached.lng });
      return deviceLocationFromSnapshot(cached);
    }
  }

  if (inflightLocationRequest) return inflightLocationRequest;

  inflightLocationRequest = fetchDeviceLocation().finally(() => {
    inflightLocationRequest = null;
  });
  return inflightLocationRequest;
}

/** 監聽位置變化（全域單一 watch，僅 map）；首頁請用 requestDeviceLocation。 */
export function watchDeviceLocation(
  onUpdate: (loc: DeviceLocationResult) => void,
  options?: { scope?: LocationWatchScope | "home" },
): () => void {
  const scope = options?.scope;
  if (scope === "home") {
    console.info("[LOCATION_WATCH_IGNORED_HOME]", {
      reason: "home_uses_get_current_position_only",
    });
    const snap = getDeviceLocationSnapshot();
    if (snap) onUpdate(deviceLocationFromSnapshot(snap));
    return () => {};
  }

  if (!scope) {
    console.warn("[LOCATION_WATCH] missing scope; pass map for live tracking");
  } else if (scope === "map") {
    activeWatchScopes.add(scope);
  }

  watchListeners.add(onUpdate);
  syncHardwareLocationWatch();

  const snap = getDeviceLocationSnapshot();
  if (snap) onUpdate(deviceLocationFromSnapshot(snap));

  return () => {
    watchListeners.delete(onUpdate);
    if (scope === "map") activeWatchScopes.delete(scope);
    syncHardwareLocationWatch();
  };
}
