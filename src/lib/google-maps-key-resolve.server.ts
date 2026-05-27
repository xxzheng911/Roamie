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
    console.error("[Roamie Maps] Missing API key.", googleMapsKeyMissingMessage());
    throw new Error(googleMapsKeyMissingMessage());
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
      }) ?? "shared";
    console.info("[GOOGLE_KEY] server loaded=true source=", source);
  }
  return key;
}
