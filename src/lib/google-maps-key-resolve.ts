import { isValidGoogleMapsApiKey } from "@/lib/google-maps-key";

let clientKeyLogged = false;

/**
 * The release build injects exactly one authority into this slot.
 * Web and iOS keys are never both visible, and legacy names are not a fallback.
 */
export function readGoogleMapsKeyFromClientEnv(): string | null {
  const raw = import.meta.env.VITE_GOOGLE_MAPS_CLIENT_API_KEY;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed && isValidGoogleMapsApiKey(trimmed)) return trimmed;
  return null;
}

/** 僅在成功載入時 log 一次，不印出完整 key */
export function logGoogleMapsKeyLoadedOnce(): void {
  if (clientKeyLogged) return;
  if (!readGoogleMapsKeyFromClientEnv()) return;
  clientKeyLogged = true;
  console.info("✅ Google Maps key loaded");
}

export function googleMapsKeyMissingMessage(): string {
  return "尚未注入這次 build 的 Google 地圖 client key。Web 使用 VITE_GOOGLE_MAPS_WEB_API_KEY，iOS 使用 VITE_GOOGLE_MAPS_IOS_API_KEY。";
}
