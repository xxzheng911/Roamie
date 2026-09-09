import { createClient } from "@supabase/supabase-js";
import { REVENUECAT_ENTITLEMENT_ID } from "@/constants/subscription";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

type RevenueCatSubscriber = {
  subscriber?: { entitlements?: Record<string, { expires_date?: string | null }> };
};

function readEnv(env: CloudflareRuntimeEnv, name: string): string | undefined {
  const runtime = env[name];
  if (typeof runtime === "string" && runtime.trim()) return runtime.trim();
  const fallback = process.env[name];
  return typeof fallback === "string" && fallback.trim() ? fallback.trim() : undefined;
}

export async function syncRevenueCatSubscription(
  userId: string,
  env: CloudflareRuntimeEnv,
): Promise<{ active: boolean; expiresAt: string | null }> {
  const revenueCatKey = readEnv(env, "REVENUECAT_SECRET_API_KEY");
  const supabaseUrl = readEnv(env, "SUPABASE_URL")
    ?.replace(/\/(rest|auth)\/v1\/?$/i, "")
    .replace(/\/$/, "");
  const serviceKey = readEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!revenueCatKey || !supabaseUrl || !serviceKey)
    throw new Error("subscription_sync_configuration_missing");

  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
    {
      headers: { Authorization: `Bearer ${revenueCatKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`revenuecat_verification_failed_${response.status}`);
  const payload = (await response.json()) as RevenueCatSubscriber;
  const entitlement = payload.subscriber?.entitlements?.[REVENUECAT_ENTITLEMENT_ID];
  const expiresAt = entitlement?.expires_date ?? null;
  const active = Boolean(entitlement && (!expiresAt || Date.parse(expiresAt) > Date.now()));

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin
    .from("profiles")
    .update({
      plan_tier: active ? "plus" : "free",
      subscription_status: active ? "active" : expiresAt ? "expired" : "inactive",
      subscription_provider: active || entitlement ? "revenuecat" : "none",
      plus_available: active,
    })
    .eq("id", userId);
  if (error) throw new Error("subscription_profile_sync_failed");
  return { active, expiresAt };
}
