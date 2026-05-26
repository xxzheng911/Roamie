import { runWhenCapacitorBridgeReady } from "@/lib/capacitor-bridge-ready";
import { logAppError } from "@/lib/log-error";

let hidePromise: Promise<void> | null = null;

function isCapacitorRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as Window & {
      Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean };
    }
  ).Capacitor;
  const platform = cap?.getPlatform?.() ?? "web";
  return Boolean(cap?.isNativePlatform?.() ?? (platform === "ios" || platform === "android"));
}

/** Hide Capacitor / native splash as soon as the in-app splash mounts. */
export async function hideNativeSplashScreen(): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    if (hidePromise) {
      await hidePromise;
      return;
    }

    hidePromise = (async () => {
      if (!isCapacitorRuntime()) return;

      await runWhenCapacitorBridgeReady("SplashScreen.hide", async () => {
        const { SplashScreen } = await import("@capacitor/splash-screen");
        await SplashScreen.hide({ fadeOutDuration: 0 });
      });
    })();

    await hidePromise;
  } catch (e) {
    hidePromise = null;
    logAppError("[native-splash] hideNativeSplashScreen failed", e);
  }
}
