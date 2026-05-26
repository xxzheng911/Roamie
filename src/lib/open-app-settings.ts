/** Native bundle id — 正式 App 建置時由 native 專案對齊 */
const DEFAULT_ANDROID_PACKAGE = "com.roamie.app";

type MobilePlatform = "ios" | "android" | "other";

declare global {
  interface Window {
    Capacitor?: {
      getPlatform?: () => string;
      Plugins?: {
        App?: {
          openUrl?: (options: { url: string }) => Promise<void>;
        };
      };
    };
    RoamieNative?: {
      openAppSettings?: () => void | Promise<void>;
    };
  }
}

function detectMobilePlatform(): MobilePlatform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  if (/Android/i.test(ua)) return "android";
  return "other";
}

function androidPackageId(): string {
  const fromEnv = import.meta.env.VITE_ROAMIE_ANDROID_PACKAGE as string | undefined;
  return fromEnv?.trim() || DEFAULT_ANDROID_PACKAGE;
}

function navigateTo(url: string): boolean {
  try {
    window.location.href = url;
    return true;
  } catch (e) {
    console.info("[Roamie] openAppSettings navigate failed", url, e);
    return false;
  }
}

/** Capacitor 原生殼：直接開啟系統 App 設定 */
function tryCapacitorNativeSettings(): boolean {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return false;
  const platform = cap.getPlatform?.() ?? detectMobilePlatform();
  if (platform === "ios") return navigateTo("app-settings:");
  if (platform === "android") {
    const pkg = androidPackageId();
    return navigateTo(
      `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:${pkg};end`,
    );
  }
  return false;
}

/** 自訂 native bridge（預留給 iOS / Android 殼層） */
async function tryNativeBridge(): Promise<boolean> {
  const bridge = window.RoamieNative?.openAppSettings;
  if (!bridge) return false;
  try {
    await bridge();
    return true;
  } catch (e) {
    console.info("[Roamie] RoamieNative.openAppSettings failed", e);
    return false;
  }
}

/** iOS：App 設定頁（UIApplication.openSettingsURLString） */
function tryIosAppSettings(): boolean {
  return navigateTo("app-settings:");
}

/**
 * Android：系統「應用程式資訊」設定頁
 * intent action: android.settings.APPLICATION_DETAILS_SETTINGS
 */
function tryAndroidAppSettings(): boolean {
  const pkg = androidPackageId();
  const intent = `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:${pkg};end`;
  return navigateTo(intent);
}

/**
 * 開啟裝置系統設定中的 Roamie App 設定頁。
 * Web / localhost 無法跳轉時僅 console 提示，不拋錯、不顯示 UI 錯誤。
 */
export async function openAppSettings(): Promise<boolean> {
  if (typeof window === "undefined") {
    console.info("[Roamie] openAppSettings skipped (no window)");
    return false;
  }

  if (await tryNativeBridge()) return true;
  if (tryCapacitorNativeSettings()) return true;

  const platform = detectMobilePlatform();
  if (platform === "ios" && tryIosAppSettings()) return true;
  if (platform === "android" && tryAndroidAppSettings()) return true;

  console.info(
    "[Roamie] openAppSettings unavailable in this environment. On device builds, wire RoamieNative.openAppSettings or Capacitor App.openUrl.",
    { platform },
  );
  return false;
}
