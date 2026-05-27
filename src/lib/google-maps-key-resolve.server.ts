import { isValidGoogleMapsApiKey } from "@/lib/google-maps-key";
import { resolveServerEnv } from "@/lib/load-env.server";
import { googleMapsKeyMissingMessage } from "@/lib/google-maps-key-resolve";

const SERVER_KEY_ENV = [
  "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "VITE_GOOGLE_MAPS_API_KEY",
] as const;

let serverKeyLogged = false;

export function readGoogleMapsKeyFromServerEnv(): string | null {
  for (const name of SERVER_KEY_ENV) {
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
    console.info("✅ Google Maps key loaded");
  }
  return key;
}
