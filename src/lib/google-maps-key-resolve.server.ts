import { isValidGoogleMapsApiKey } from "@/lib/google-maps-key";
import { resolveServerEnv } from "@/lib/load-env.server";
import { googleMapsKeyMissingMessage } from "@/lib/google-maps-key-resolve";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

export const GOOGLE_MAPS_SERVER_KEY_ENV_NAMES = [
  "GOOGLE_PLACES_SERVER_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
  "VITE_GOOGLE_MAPS_API_KEY",
] as const;

export type GoogleMapsServerKeySource = (typeof GOOGLE_MAPS_SERVER_KEY_ENV_NAMES)[number] | "none";

export type GoogleMapsServerKeyResolution = {
  key: string | null;
  source: GoogleMapsServerKeySource;
};

let serverKeyLogged = false;

type ServerEnvResolver = typeof resolveServerEnv;

export function resolveGoogleMapsKeyFromServerEnv(
  runtimeEnv?: CloudflareRuntimeEnv,
  resolveEnv: ServerEnvResolver = resolveServerEnv,
): GoogleMapsServerKeyResolution {
  for (const name of GOOGLE_MAPS_SERVER_KEY_ENV_NAMES) {
    const runtimeValue = runtimeEnv?.[name];
    const runtimeKey = typeof runtimeValue === "string" ? runtimeValue.trim() : "";
    if (runtimeKey && isValidGoogleMapsApiKey(runtimeKey)) {
      return { key: runtimeKey, source: name };
    }
    const resolved = resolveEnv(name);
    const trimmed = resolved?.value?.trim();
    if (trimmed && isValidGoogleMapsApiKey(trimmed)) return { key: trimmed, source: name };
  }
  return { key: null, source: "none" };
}

export function readGoogleMapsKeyFromServerEnv(runtimeEnv?: CloudflareRuntimeEnv): string | null {
  return resolveGoogleMapsKeyFromServerEnv(runtimeEnv).key;
}

export function requireGoogleMapsServerKey(runtimeEnv?: CloudflareRuntimeEnv): string {
  const key = readGoogleMapsKeyFromServerEnv(runtimeEnv);
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
