import { detectPlatform } from "@/services/platform";

/** Hide Capacitor / native splash as soon as the in-app splash mounts. */
export async function hideNativeSplashScreen(): Promise<void> {
  if (typeof window === "undefined") return;
  if (hidePromise) return hidePromise;

  hidePromise = (async () => {
    const { isCapacitor } = detectPlatform();
    if (!isCapacitor) return;

    try {
      const { SplashScreen } = await import("@capacitor/splash-screen");
      await SplashScreen.hide({ fadeOutDuration: 0 });
    } catch {
      /* plugin optional */
    }
  })();

  return hidePromise;
}
