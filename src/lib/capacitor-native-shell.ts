/** 輕量 Capacitor 偵測（勿 import services/platform，避免 lazy chunk 循環依賴 index entry） */
export function isCapacitorNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as Window & {
      Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean };
    }
  ).Capacitor;
  if (!cap) return false;
  if (cap.isNativePlatform?.()) return true;
  const platform = cap.getPlatform?.();
  return platform === "ios" || platform === "android";
}
