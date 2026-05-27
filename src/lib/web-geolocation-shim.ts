import { detectPlatform } from "@/services/platform";

let installed = false;

function isNativeShell(): boolean {
  const info = detectPlatform();
  if (info.isCapacitor) return true;
  if (typeof window === "undefined") return false;
  const cap = (
    window as Window & {
      Capacitor?: { getPlatform?: () => string };
    }
  ).Capacitor;
  const platform = cap?.getPlatform?.();
  return platform === "ios" || platform === "android";
}

/**
 * Capacitor iOS WebView shows a second "localhost" geolocation prompt when
 * navigator.geolocation is used. Native apps should only use @capacitor/geolocation.
 */
export function installWebGeolocationShim(): void {
  if (installed || !isNativeShell()) return;
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  installed = true;

  const disabledError: GeolocationPositionError = {
    code: 1,
    message: "Web geolocation disabled in native shell; use Capacitor Geolocation.",
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };

  const logDisabled = (method: string) => {
    console.info("[WEB_GEOLOCATION] disabled", { method });
  };

  navigator.geolocation.getCurrentPosition = (_success, error) => {
    logDisabled("getCurrentPosition");
    error?.(disabledError);
  };

  navigator.geolocation.watchPosition = (_success, error) => {
    logDisabled("watchPosition");
    error?.(disabledError);
    return -1;
  };

  navigator.geolocation.clearWatch = () => {
    logDisabled("clearWatch");
  };

  console.info("[WEB_GEOLOCATION] disabled");
}
