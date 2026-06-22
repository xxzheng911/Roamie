import { LocalNotifications } from "@capacitor/local-notifications";
import type { LocalNotificationsPlugin } from "@capacitor/local-notifications";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

/**
 * Capacitor plugin 實例不可從 async 函式 return（Promise 會呼叫 plugin.then() 導致 iOS 崩潰）。
 * 使用同步 getter + 靜態 import，與 geolocation 相同模式。
 */
export function getCapacitorLocalNotifications(): LocalNotificationsPlugin | null {
  if (!isCapacitorNativeShell()) return null;
  return LocalNotifications;
}
