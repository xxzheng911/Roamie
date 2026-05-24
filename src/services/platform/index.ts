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
  const isCapacitor = Boolean(cap?.isNativePlatform?.());
  const platform = cap?.getPlatform?.() ?? "web";

  return {
    kind: platform === "ios" ? "ios" : platform === "android" ? "android" : "web",
    isNative: isCapacitor,
    isIOS: platform === "ios",
    isAndroid: platform === "android",
    isCapacitor,
  };
}

/** Apply native shell polish when running inside Capacitor. */
export async function bootstrapNativeShell(): Promise<void> {
  if (typeof window === "undefined") return;
  const info = detectPlatform();
  if (!info.isCapacitor) return;

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#f7f4ef" });
  } catch {
    /* plugin optional until cap add ios */
  }

  try {
    await hideNativeSplashScreen();
  } catch {
    /* optional */
  }

  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
  } catch {
    /* plugin optional */
  }

  document.documentElement.classList.add("native-shell");
  if (info.isIOS) document.documentElement.classList.add("platform-ios");
  if (info.isAndroid) document.documentElement.classList.add("platform-android");
}
