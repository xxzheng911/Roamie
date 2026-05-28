import { isValidGoogleMapsApiKey } from "@/lib/google-maps-key";
import { resolveServerEnv } from "@/lib/load-env.server";
import { googleMapsKeyMissingMessage } from "@/lib/google-maps-key-resolve";

/** Server-side Places / Geocoding（勿設 iOS App 限制；可用 IP 或無限制 + 配額監控） */
const SERVER_ONLY_KEY_ENV = [
  "GOOGLE_PLACES_SERVER_API_KEY",
  "GOOGLE_MAPS_SERVER_API_KEY",
] as const;

/** 與 Maps JS 共用時：若僅設 iOS 限制，server REST 會 403 API_KEY_IOS_APP_BLOCKED */
const SHARED_KEY_ENV = [
  "GOOGLE_MAPS_API_KEY",
  "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
  "VITE_GOOGLE_MAPS_API_KEY",
] as const;

let serverKeyLogged = false;

export function readGoogleMapsKeyFromServerEnv(): string | null {
  for (const name of SERVER_ONLY_KEY_ENV) {
    const resolved = resolveServerEnv(name);
    const trimmed = resolved?.value?.trim();
    if (trimmed && isValidGoogleMapsApiKey(trimmed)) return trimmed;
  }
  return null;
}

/** Maps JS / 舊相容：允許共用 VITE/EXPO 金鑰（勿用於 Places REST） */
export function readGoogleMapsSharedKeyFromServerEnv(): string | null {
  const serverOnly = readGoogleMapsKeyFromServerEnv();
  if (serverOnly) return serverOnly;
  for (const name of SHARED_KEY_ENV) {
    const resolved = resolveServerEnv(name);
    const trimmed = resolved?.value?.trim();
    if (trimmed && isValidGoogleMapsApiKey(trimmed)) return trimmed;
  }
  return null;
}

export function requireGoogleMapsServerKey(): string {
  const key = readGoogleMapsKeyFromServerEnv();
  if (!key) {
    const msg =
      "缺少 GOOGLE_PLACES_SERVER_API_KEY（Worker 請用 server 金鑰，勿用僅 iOS 限制的 VITE_GOOGLE_MAPS_API_KEY）。執行 npm run sync:env 後 wrangler secret bulk .dev.vars";
    console.error("[Roamie Maps]", msg);
    throw new Error(msg);
  }
  if (!isValidGoogleMapsApiKey(key)) {
    throw new Error(
      "Google Maps API 金鑰格式不正確。請使用 Maps API 金鑰（通常以 AIza 開頭），勿使用 OAuth 用戶端密鑰。",
    );
  }
  if (!serverKeyLogged) {
    serverKeyLogged = true;
    const source =
      SERVER_ONLY_KEY_ENV.find((name) => {
        const v = resolveServerEnv(name)?.value?.trim();
        return v && isValidGoogleMapsApiKey(v);
      }) ?? "server-only";
    console.info("[GOOGLE_KEY] server places key loaded=true source=", source);
  }
  return key;
}
