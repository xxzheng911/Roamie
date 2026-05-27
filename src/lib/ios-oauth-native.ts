import { detectPlatform } from "@/services/platform";
import { notifyIosOAuthOpen } from "@/lib/ios-snapshot-bridge";

const NATIVE_STARTED = "roamie-oauth-native-started";
const NATIVE_ERROR = "roamie-oauth-native-error";
const NATIVE_CANCELLED = "roamie-oauth-native-cancelled";

function hasSnapshotBridge(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (
      window as Window & {
        webkit?: { messageHandlers?: { roamieSnapshot?: { postMessage: (b: unknown) => void } } };
      }
    ).webkit?.messageHandlers?.roamieSnapshot,
  );
}

function postToNative(body: Record<string, unknown>): boolean {
  if (typeof window === "undefined") return false;
  const handler = (
    window as Window & {
      webkit?: { messageHandlers?: { roamieSnapshot?: { postMessage: (b: unknown) => void } } };
    }
  ).webkit?.messageHandlers?.roamieSnapshot;
  if (!handler) return false;
  try {
    handler.postMessage(body);
    return true;
  } catch {
    return false;
  }
}

export function canUseIosNativeOAuth(): boolean {
  const { isCapacitor, isIOS } = detectPlatform();
  return isCapacitor && isIOS;
}

/** 透過原生 ASWebAuthenticationSession 開啟 Google OAuth（iOS 26 上 Capacitor Browser 常無法顯示） */
export function openIosNativeOAuth(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("native_oauth_start_timeout"));
    }, 15_000);

    const onStarted = () => {
      window.clearTimeout(timeout);
      cleanup();
      resolve();
    };

    const onError = (e: Event) => {
      window.clearTimeout(timeout);
      cleanup();
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      reject(new Error(detail?.message ?? "native_oauth_failed"));
    };

    const onCancelled = () => {
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error("native_oauth_cancelled"));
    };

    const cleanup = () => {
      window.removeEventListener(NATIVE_STARTED, onStarted);
      window.removeEventListener(NATIVE_ERROR, onError);
      window.removeEventListener(NATIVE_CANCELLED, onCancelled);
    };

    window.addEventListener(NATIVE_STARTED, onStarted, { once: true });
    window.addEventListener(NATIVE_ERROR, onError, { once: true });
    window.addEventListener(NATIVE_CANCELLED, onCancelled, { once: true });

    notifyIosOAuthOpen();
    if (!postToNative({ mode: "oauth-start", url })) {
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error("native_oauth_bridge_missing"));
    }
  });
}
