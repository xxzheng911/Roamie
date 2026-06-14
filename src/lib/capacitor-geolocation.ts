import { Geolocation } from "@capacitor/geolocation";
import type { GeolocationPlugin } from "@capacitor/geolocation";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

/** Roamie patch: clears orphaned native watchPosition callbacks after HMR / reload */
export type RoamieGeolocationPlugin = GeolocationPlugin & {
  purgeAllWatches(): Promise<{ cleared: number }>;
};

/** 取得 Capacitor Geolocation plugin（同步；勿 dynamic import 共用 chunk，避免 export 錯位） */
export function getCapacitorGeolocation(): RoamieGeolocationPlugin {
  if (!isCapacitorNativeShell()) {
    throw new Error("Capacitor Geolocation unavailable on web shell");
  }
  return Geolocation as RoamieGeolocationPlugin;
}
