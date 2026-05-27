import { detectPlatform } from "@/services/platform";

export type LocationPermissionState =
  | "granted"
  | "denied"
  | "restricted"
  | "timeout"
  | "unavailable"
  | "unknown";

type CapGeolocation = typeof import("@capacitor/geolocation").Geolocation;

type CapPermissionStatus = Awaited<ReturnType<CapGeolocation["checkPermissions"]>>;

let memoryCache: LocationPermissionState | null = null;
let inflight: Promise<LocationPermissionState> | null = null;
let sessionRequestLogged = false;

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

function mapCapPermission(status: CapPermissionStatus): LocationPermissionState {
  if (status.location === "granted" || status.coarseLocation === "granted") {
    return "granted";
  }
  if (status.location === "denied" || status.coarseLocation === "denied") {
    return "denied";
  }
  if (status.location === "restricted" || status.coarseLocation === "restricted") {
    return "restricted";
  }
  return "unknown";
}

async function probeBrowserPermission(): Promise<LocationPermissionState | null> {
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

async function resolveCapacitorPermission(shouldRequest: boolean): Promise<LocationPermissionState> {
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const checked = await Geolocation.checkPermissions();
    let state = mapCapPermission(checked);

    if (state === "granted" || state === "denied" || state === "restricted") {
      return state;
    }

    if (!shouldRequest || sessionRequestLogged) {
      return state;
    }

    sessionRequestLogged = true;
    console.info("[LOCATION_PERMISSION] native requested");

    const requested = await Geolocation.requestPermissions();
    state = mapCapPermission(requested);
    if (state === "granted") {
      console.info("[LOCATION_PERMISSION] native granted");
    }
    return state;
  } catch (e) {
    console.warn("[Location] capacitor permission check failed", e);
    return "unavailable";
  }
}

async function resolvePermission(shouldRequest: boolean): Promise<LocationPermissionState> {
  if (!isNativeShell()) {
    const probed = await probeBrowserPermission();
    if (probed === "granted" || probed === "denied") {
      return probed;
    }
    if (shouldRequest && !sessionRequestLogged) {
      sessionRequestLogged = true;
      console.info("[Location Permission Requested]");
    }
    return probed ?? "unknown";
  }

  return resolveCapacitorPermission(shouldRequest);
}

/** 讀取快取（不觸發系統對話框） */
export function getCachedLocationPermission(): LocationPermissionState | null {
  return memoryCache;
}

/**
 * 統一定位權限入口。
 * - `request: true`（預設）：僅在尚未 granted/denied 時彈窗一次
 * - `request: false`：只 check，絕不 request（給 watch / 次要頁面）
 */
export async function ensureLocationPermission(options?: {
  request?: boolean;
}): Promise<LocationPermissionState> {
  const shouldRequest = options?.request !== false;

  if (memoryCache === "granted" || memoryCache === "denied" || memoryCache === "restricted") {
    return memoryCache;
  }

  if (inflight) return inflight;

  inflight = resolvePermission(shouldRequest)
    .then((state) => {
      memoryCache = state;
      return state;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** App 啟動後預先 check（不彈窗） */
export function prefetchLocationPermissionStatus(): void {
  if (!isNativeShell()) return;
  void ensureLocationPermission({ request: false });
}

/**
 * 使用者從「設定」開啟定位後回到 App 時，清除快取以便重新 check / request。
 */
export function invalidateLocationPermissionCache(options?: { allowRequestAgain?: boolean }): void {
  const prev = memoryCache;
  memoryCache = null;
  if (options?.allowRequestAgain && (prev === "denied" || prev === "restricted")) {
    sessionRequestLogged = false;
  }
  console.info("[LOCATION] permission cache cleared", { previous: prev ?? "none" });
}

export function installLocationPermissionResumeListener(): void {
  if (typeof document === "undefined") return;
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    invalidateLocationPermissionCache({ allowRequestAgain: true });
  };
  document.addEventListener("visibilitychange", onVisible);
}
