import { loadEnv } from "vite";

/**
 * Values intentionally compiled into the browser/native WebView bundle.
 * Keep this list explicit: a VITE_ prefix alone is not an authorization boundary.
 */
export const PUBLIC_CLIENT_ENV_KEYS = Object.freeze([
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_APP_ORIGIN",
  "VITE_APPLE_SIGN_IN_ENABLED",
  "VITE_GOOGLE_SIGN_IN_ENABLED",
  "VITE_GOOGLE_MAPS_API_KEY",
  "VITE_OPENWEATHER_API_KEY",
  "VITE_UNSPLASH_ACCESS_KEY",
  "VITE_FEATURE_CREDITS_ENABLED",
  "VITE_BILLING_ENABLED",
  "VITE_REVENUECAT_APPLE_KEY",
  "VITE_REVENUECAT_GOOGLE_KEY",
  "VITE_CANDIDATE_POOL_ENABLED",
  "VITE_REC_ENGINE_ENABLED",
  "VITE_REC_ENGINE_R1_1_ENABLED",
  "VITE_REC_ENGINE_R1_2_ENABLED",
  "VITE_REC_ENGINE_PLANNER_ENABLED",
  "VITE_REC_ENGINE_VALIDATOR_ENABLED",
  "VITE_ITINERARY_VALIDATOR_ENABLED",
  "VITE_PIE_FACADE_ENABLED",
  "VITE_PIE_PLANNER_SEARCH_ENABLED",
  "VITE_TRIP_AFFILIATE_URL",
  "VITE_TRIP_ACCOUNT_ID",
  "VITE_TRIP_WEBSITE_ID",
  "VITE_KLOOK_AID",
  "VITE_KKDAY_CID",
  "VITE_AGODA_AFFILIATE_URL",
  "VITE_AFFILIATE_BOOKING_AID",
  "VITE_AFFILIATE_SKYSCANNER_AID",
  "VITE_AFFILIATE_EXPEDIA_AID",
  "VITE_AFFILIATE_AIRBNB_AID",
  "VITE_AFFILIATE_UBER_AID",
  "VITE_ROAMIE_ANDROID_PACKAGE",
]);

export const REQUIRED_PUBLIC_CLIENT_ENV_KEYS = Object.freeze([
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_APP_ORIGIN",
]);

export const SERVER_ONLY_ENV_KEYS = Object.freeze([
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_PLACES_SERVER_API_KEY",
  "OPENWEATHER_API_KEY",
]);

export function selectPublicClientEnv(source, existing = process.env) {
  return Object.fromEntries(
    PUBLIC_CLIENT_ENV_KEYS.flatMap((key) => {
      const value = existing[key] || source[key];
      return typeof value === "string" && value.length > 0 ? [[key, value]] : [];
    }),
  );
}

export function validateRequiredPublicClientEnv(env) {
  return REQUIRED_PUBLIC_CLIENT_ENV_KEYS.filter((key) => !env[key]);
}

export function loadPublicClientEnv(root, existing = process.env) {
  // Read while local env files still exist, then retain only the explicit allowlist.
  const loaded = loadEnv("production", root, "");
  return selectPublicClientEnv(loaded, existing);
}
