import { isValidGoogleMapsApiKey } from "@/lib/google-maps-key";

const CLIENT_KEY_ENV = [
  "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
  "VITE_GOOGLE_MAPS_API_KEY",
] as const;

let clientKeyLogged = false;

/** 瀏覽器 / Capacitor：優先 EXPO_PUBLIC，其次 VITE */
export function readGoogleMapsKeyFromClientEnv(): string | null {
  if (typeof import.meta !== "undefined" && import.meta.env) {
    for (const name of CLIENT_KEY_ENV) {
      const raw = import.meta.env[name];
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (trimmed && isValidGoogleMapsApiKey(trimmed)) return trimmed;
    }
  }
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
  return "尚未設定 Google 地圖 API 金鑰。請在 .env 設定 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY（或 VITE_GOOGLE_MAPS_API_KEY），執行 npm run sync:env 後重啟。";
}
