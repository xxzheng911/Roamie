import { setLocationWatchAppActive } from "@/lib/device-location";
import { detectPlatform } from "@/services/platform";

let bootstrapped = false;

/** 註冊 App 前景／背景與頁面可見性，控制 GPS watch 啟停 */
export function bootstrapLocationWatchLifecycle(): void {
  if (typeof window === "undefined" || bootstrapped) return;
  bootstrapped = true;

  const apply = (active: boolean, reason: string) => {
    setLocationWatchAppActive(active, reason);
  };

  apply(document.visibilityState === "visible", "bootstrap_visible");

  document.addEventListener("visibilitychange", () => {
    apply(
      document.visibilityState === "visible",
      document.visibilityState === "visible" ? "visibility_visible" : "visibility_hidden",
    );
  });

  window.addEventListener("pagehide", () => {
    apply(false, "pagehide");
  });

  const { isCapacitor } = detectPlatform();
  if (isCapacitor) {
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        void App.addListener("appStateChange", ({ isActive }) => {
          apply(isActive, isActive ? "capacitor_foreground" : "capacitor_background");
        });
      } catch (e) {
        console.warn("[LOCATION_WATCH] App lifecycle listener unavailable", e);
      }
    })();
  }
}
