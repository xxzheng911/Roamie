import { detectPlatform } from "@/services/platform";

export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

export function isNotificationApiAvailable(): boolean {
  if (detectPlatform().isNative) return true;
  return typeof window !== "undefined" && "Notification" in window;
}

/** 讀取目前裝置通知權限 */
export function readNotificationPermission(): NotificationPermissionState {
  if (detectPlatform().isNative) {
    return "default";
  }
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  const p = Notification.permission;
  if (p === "granted" || p === "denied" || p === "default") return p;
  return "default";
}

export function isNotificationGranted(): boolean {
  if (detectPlatform().isNative) {
    return nativePermissionCache === "granted";
  }
  return readNotificationPermission() === "granted";
}

let nativePermissionCache: NotificationPermissionState = "default";

/** Capacitor：同步讀取權限（設定頁載入時呼叫） */
export async function refreshNativeNotificationPermission(): Promise<NotificationPermissionState> {
  if (!detectPlatform().isNative) return readNotificationPermission();
  const { checkNativeNotificationPermission } = await import("@/services/notificationService");
  const status = await checkNativeNotificationPermission();
  nativePermissionCache =
    status === "granted" ? "granted" : status === "denied" ? "denied" : "default";
  return nativePermissionCache;
}

/** 僅在使用者主動開啟時呼叫；會觸發系統權限對話框 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (detectPlatform().isNative) {
    const { requestNotificationPermission: requestCap } = await import(
      "@/services/notificationService"
    );
    const status = await requestCap({ showDeniedHint: true });
    nativePermissionCache =
      status === "granted" ? "granted" : status === "denied" ? "denied" : "default";
    return nativePermissionCache;
  }

  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const result = await Notification.requestPermission();
    if (result === "granted" || result === "denied" || result === "default") return result;
    return readNotificationPermission();
  } catch {
    return "denied";
  }
}
