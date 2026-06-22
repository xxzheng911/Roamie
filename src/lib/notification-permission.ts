import { getCapacitorLocalNotifications } from "@/lib/capacitor-local-notifications";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

export function isNotificationApiAvailable(): boolean {
  if (isCapacitorNativeShell()) return true;
  return typeof window !== "undefined" && "Notification" in window;
}

async function readCapacitorNotificationPermission(): Promise<NotificationPermissionState> {
  try {
    const plugin = getCapacitorLocalNotifications();
    if (!plugin) return "unsupported";
    const result = await plugin.checkPermissions();
    if (result.display === "granted") return "granted";
    if (result.display === "denied") return "denied";
    return "default";
  } catch {
    return "unsupported";
  }
}

/** 讀取目前裝置通知權限 */
export async function readNotificationPermissionAsync(): Promise<NotificationPermissionState> {
  if (isCapacitorNativeShell()) return readCapacitorNotificationPermission();
  if (!isNotificationApiAvailable()) return "unsupported";
  const p = Notification.permission;
  if (p === "granted" || p === "denied" || p === "default") return p;
  return "default";
}

/** @deprecated 請改用 readNotificationPermissionAsync（Capacitor 需 async） */
export function readNotificationPermission(): NotificationPermissionState {
  if (!isNotificationApiAvailable()) return "unsupported";
  const p = Notification.permission;
  if (p === "granted" || p === "denied" || p === "default") return p;
  return "default";
}

export async function isNotificationGrantedAsync(): Promise<boolean> {
  return (await readNotificationPermissionAsync()) === "granted";
}

/** @deprecated 請改用 isNotificationGrantedAsync */
export function isNotificationGranted(): boolean {
  return readNotificationPermission() === "granted";
}

/** 僅在使用者主動開啟時呼叫；會觸發系統權限對話框 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (isCapacitorNativeShell()) {
    try {
      const plugin = getCapacitorLocalNotifications();
      if (!plugin) return "unsupported";
      const current = await plugin.checkPermissions();
      if (current.display === "granted") return "granted";
      if (current.display === "denied") return "denied";
      const result = await plugin.requestPermissions();
      if (result.display === "granted") return "granted";
      if (result.display === "denied") return "denied";
      return "default";
    } catch {
      return "denied";
    }
  }

  if (!isNotificationApiAvailable()) return "unsupported";
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
