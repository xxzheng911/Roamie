import { attachOAuthDeepLinkListener } from "@/lib/auth-oauth-deep-link";
import { waitForCapacitorBridge } from "@/lib/capacitor-bridge-ready";
import { normalizeCapacitorEntryPath } from "@/lib/capacitor-entry-path";
import { hideNativeSplashScreen } from "@/lib/native-splash";
import { isAppReady } from "@/lib/startup-route";
import { logAppError } from "@/lib/log-error";

export type PlatformKind = "web" | "ios" | "android";

export type PlatformInfo = {
  kind: PlatformKind;
  isNative: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isCapacitor: boolean;
};

export function detectPlatform(): PlatformInfo {
  if (typeof window === "undefined") {
    return { kind: "web", isNative: false, isIOS: false, isAndroid: false, isCapacitor: false };
  }

  const cap = (
    window as Window & {
      Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean };
    }
  ).Capacitor;
  const platform = cap?.getPlatform?.() ?? "web";
  const isCapacitor = Boolean(
    cap?.isNativePlatform?.() ?? (platform === "ios" || platform === "android"),
  );

  return {
    kind: platform === "ios" ? "ios" : platform === "android" ? "android" : "web",
    isNative: isCapacitor,
    isIOS: platform === "ios",
    isAndroid: platform === "android",
    isCapacitor,
  };
}

let bootstrapStarted = false;
let bootstrapDone = false;

function hasWebBootUi(): boolean {
  if (typeof document === "undefined") return false;
  const root = document.getElementById("root");
  if (root && root.childElementCount > 0) return true;
  return document.getElementById("roamie-boot-splash") != null;
}

/** 等 React 首屏或 HTML boot splash 出現後再關原生 splash，避免 bundle 載入期間露出白屏 */
async function hideNativeSplashAfterFirstPaint(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (isAppReady() && hasWebBootUi()) break;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
  try {
    await hideNativeSplashScreen();
  } catch (e) {
    logAppError("[platform] hideNativeSplashScreen failed", e);
  }
}

/** Apply native shell polish when running inside Capacitor (after bridge + first paint). */
export async function bootstrapNativeShell(): Promise<void> {
  if (typeof window === "undefined") return;
  const info = detectPlatform();
  if (!info.isCapacitor) return;
  if (bootstrapDone) return;
  if (bootstrapStarted) return;
  bootstrapStarted = true;

  try {
    normalizeCapacitorEntryPath();
    attachOAuthDeepLinkListener();

    document.documentElement.classList.add("native-shell");
    if (info.isIOS) document.documentElement.classList.add("platform-ios");
    if (info.isAndroid) document.documentElement.classList.add("platform-android");

    // 首屏 HTML 占位或 React splash 出現後即關閉原生 splash（不等 StatusBar / idle）
    await hideNativeSplashAfterFirstPaint();

    const bridgeReady = await waitForCapacitorBridge();
    if (!bridgeReady) {
      bootstrapDone = true;
      return;
    }

    const polishNativeChrome = async () => {
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setStyle({ style: Style.Dark });
        if (info.isAndroid) {
          await StatusBar.setBackgroundColor({ color: "#f7f4ef" });
        }
      } catch (e) {
        logAppError("[platform] StatusBar failed", e);
      }

      try {
        const { Keyboard } = await import("@capacitor/keyboard");
        await Keyboard.setAccessoryBarVisible({ isVisible: false });
      } catch (e) {
        logAppError("[platform] Keyboard.setAccessoryBarVisible failed", e);
      }
    };

    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => void polishNativeChrome(), { timeout: 2500 });
    } else {
      window.setTimeout(() => void polishNativeChrome(), 80);
    }

    bootstrapDone = true;
  } catch (e) {
    bootstrapStarted = false;
    logAppError("[platform] bootstrapNativeShell failed", e);
  }
}
