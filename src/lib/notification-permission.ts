export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

export function isNotificationApiAvailable(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** 讀取目前裝置／瀏覽器通知權限（非本地偏好） */
export function readNotificationPermission(): NotificationPermissionState {
  if (!isNotificationApiAvailable()) return "unsupported";
  const p = Notification.permission;
  if (p === "granted" || p === "denied" || p === "default") return p;
  return "default";
}

export function isNotificationGranted(): boolean {
  return readNotificationPermission() === "granted";
}

/** 僅在使用者主動開啟時呼叫；會觸發系統權限對話框 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
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
