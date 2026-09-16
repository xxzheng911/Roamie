import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import { openExternalUrl } from "@/lib/open-external-url";

type MobilePlatform = "ios" | "android" | "other";

function detectMobilePlatform(): MobilePlatform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  ) {
    return "ios";
  }
  if (/Android/i.test(ua)) return "android";
  return "other";
}

function navigateTo(url: string): boolean {
  try {
    window.location.href = url;
    return true;
  } catch (e) {
    console.info("[Roamie] openSubscriptionManagement navigate failed", url, e);
    return false;
  }
}

/** 開啟系統「管理訂閱」頁（iOS App Store / Android Play） */
export async function openSubscriptionManagement(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const platform = detectMobilePlatform();
  const url =
    platform === "ios"
      ? "https://apps.apple.com/account/subscriptions"
      : platform === "android"
        ? "https://play.google.com/store/account/subscriptions"
        : "https://apps.apple.com/account/subscriptions";

  if (isCapacitorNativeShell()) {
    const opened = await openExternalUrl(url);
    if (opened) return true;
  }
  return navigateTo(url);
}
