import { App } from "@capacitor/app";
import { registerAppStateChangeListener } from "@/lib/capacitor-app-listener";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

let appIsActive = !isCapacitorNativeShell();
let gateRegistered = false;
const foregroundListeners = new Set<() => void>();

export function isAppActiveForLocation(): boolean {
  if (!isCapacitorNativeShell()) return true;
  if (typeof document !== "undefined" && document.hidden) return false;
  return appIsActive;
}

export function waitForAppActiveForLocation(maxWaitMs = 8_000): Promise<boolean> {
  if (isAppActiveForLocation()) return Promise.resolve(true);

  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (isAppActiveForLocation()) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= maxWaitMs) {
        console.info("[LOCATION_REQUEST_FAILED]", "reason=app_not_active_timeout");
        resolve(false);
        return;
      }
      window.setTimeout(tick, 120);
    };
    tick();
  });
}

function notifyForegroundListeners(): void {
  for (const listener of foregroundListeners) {
    try {
      listener();
    } catch (e) {
      console.warn("[Location] foreground listener failed", e);
    }
  }
}

/** App 回到前景時重試定位（例如先前因 background 跳過 GPS） */
export function onAppForegroundForLocation(listener: () => void): () => void {
  foregroundListeners.add(listener);
  return () => foregroundListeners.delete(listener);
}

async function syncInitialAppState(): Promise<void> {
  if (!isCapacitorNativeShell()) {
    appIsActive = true;
    return;
  }
  try {
    const state = await App.getState();
    appIsActive = state.isActive;
    console.info("[LOCATION_APP_STATE]", `isActive=${state.isActive}`, "source=initial");
  } catch {
    appIsActive = true;
  }
}

/** Native：等 App 進前景後再 getCurrentPosition */
export function registerLocationAppGate(): void {
  if (gateRegistered || typeof window === "undefined") return;
  gateRegistered = true;

  if (!isCapacitorNativeShell()) {
    appIsActive = true;
    return;
  }

  void syncInitialAppState();

  void registerAppStateChangeListener((isActive) => {
    appIsActive = isActive;
    console.info("[LOCATION_APP_STATE]", `isActive=${isActive}`, "source=appStateChange");
    if (isActive) notifyForegroundListeners();
  }).catch(() => {
    gateRegistered = false;
  });

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && appIsActive) {
        notifyForegroundListeners();
      }
    });
  }
}
