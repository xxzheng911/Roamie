import { isValidGoogleMapsApiKey } from "@/lib/google-maps-key";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

export type GoogleMapsServerKeySource = "GOOGLE_PLACES_SERVER_API_KEY" | "none";
export type GoogleApiFamily = "places" | "routes" | "geocoding";
export const GOOGLE_SERVER_CREDENTIALS = {
  places: "GOOGLE_PLACES_SERVER_API_KEY",
  routes: "GOOGLE_ROUTES_SERVER_API_KEY",
  geocoding: "GOOGLE_GEOCODING_SERVER_API_KEY",
} as const;

/** Server runtime only. Neither public env, legacy shared keys nor import.meta.env are authority. */
export function requireGoogleServerKey(
  family: GoogleApiFamily,
  runtimeEnv?: CloudflareRuntimeEnv,
): string {
  const name = GOOGLE_SERVER_CREDENTIALS[family];
  const raw = runtimeEnv?.[name] ?? process.env[name];
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!isValidGoogleMapsApiKey(key)) throw new Error(`google_${family}_credential_unavailable`);
  return key;
}

/** Compatibility name for Places callers only; other APIs select their own family. */
export function requireGoogleMapsServerKey(runtimeEnv?: CloudflareRuntimeEnv): string {
  return requireGoogleServerKey("places", runtimeEnv);
}
export function resolveGoogleMapsKeyFromServerEnv(runtimeEnv?: CloudflareRuntimeEnv) {
  try {
    return {
      key: requireGoogleServerKey("places", runtimeEnv),
      source: GOOGLE_SERVER_CREDENTIALS.places,
    };
  } catch {
    return { key: null, source: "none" as const };
  }
}
export function readGoogleMapsKeyFromServerEnv(runtimeEnv?: CloudflareRuntimeEnv): string | null {
  return resolveGoogleMapsKeyFromServerEnv(runtimeEnv).key;
}
