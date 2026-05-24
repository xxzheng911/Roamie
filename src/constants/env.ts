/**
 * Client-safe environment access.
 * Never put secret keys here — OpenAI / server keys stay in env.server.ts + API routes.
 */

function readVite(key: string): string | undefined {
  const v = import.meta.env[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const clientEnv = {
  /** Supabase project URL (public) */
  supabaseUrl: readVite("VITE_SUPABASE_URL"),
  /** Supabase anon/publishable key (public, RLS-protected) */
  supabasePublishableKey: readVite("VITE_SUPABASE_PUBLISHABLE_KEY"),
  /** Maps key is server-proxied; client may receive ephemeral token via API only */
  googleMapsKey: readVite("VITE_GOOGLE_MAPS_API_KEY"),
  /** Analytics (optional, public write keys only) */
  posthogKey: readVite("VITE_POSTHOG_KEY"),
  posthogHost: readVite("VITE_POSTHOG_HOST") ?? "https://app.posthog.com",
  mixpanelToken: readVite("VITE_MIXPANEL_TOKEN"),
  /** RevenueCat public SDK key (iOS/Android — safe for client) */
  revenueCatAppleKey: readVite("VITE_REVENUECAT_APPLE_KEY"),
  revenueCatGoogleKey: readVite("VITE_REVENUECAT_GOOGLE_KEY"),
  /** Deployment environment */
  mode: import.meta.env.MODE as "development" | "production" | "test",
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
} as const;

export function assertClientEnv(): void {
  if (!clientEnv.supabaseUrl || !clientEnv.supabasePublishableKey) {
    console.error(
      "[Roamie] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Check .env",
    );
  }
}
