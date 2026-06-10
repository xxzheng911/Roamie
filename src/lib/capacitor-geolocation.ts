import { Geolocation } from "@capacitor/geolocation";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

/** 取得 Capacitor Geolocation plugin（同步；勿 dynamic import 共用 chunk，避免 export 錯位） */
export function getCapacitorGeolocation(): typeof Geolocation {
  if (!isCapacitorNativeShell()) {
    throw new Error("Capacitor Geolocation unavailable on web shell");
  }
  return Geolocation;
}
