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

async function tryCapacitorBrowser(url: string): Promise<boolean> {
  if (!window.Capacitor?.isNativePlatform?.()) return false;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
    return true;
  } catch (e) {
    console.info("[Roamie] Capacitor Browser.open failed", url, e);
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

  if (await tryCapacitorBrowser(url)) return true;
  return navigateTo(url);
}
