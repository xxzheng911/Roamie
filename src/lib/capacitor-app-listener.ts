import { App } from "@capacitor/app";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

let registered = false;

/** 獨立 chunk：勿 import weather / platform，避免與 chunk-weather-service 循環依賴 */
export async function registerAppStateChangeListener(
  handler: (isActive: boolean) => void,
): Promise<void> {
  if (!isCapacitorNativeShell() || registered) return;
  registered = true;
  try {
    await App.addListener("appStateChange", ({ isActive }) => handler(isActive));
  } catch (e) {
    registered = false;
    throw e;
  }
}
