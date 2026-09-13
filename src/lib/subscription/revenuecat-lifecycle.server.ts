import { createClient } from "@supabase/supabase-js";
import { REVENUECAT_ENTITLEMENT_ID } from "@/constants/subscription";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

export type RevenueCatLifecycleInput = {
  eventId: string;
  userId: string;
  eventType: string;
  eventAt: Date;
  customerId: string;
  entitlementId?: string | null;
  productId?: string | null;
  status: "active" | "cancelled" | "billing_issue" | "paused" | "expired" | "revoked" | "inactive";
  purchasedAt?: Date | null;
  expirationAt?: Date | null;
  cancellationAt?: Date | null;
  billingIssueAt?: Date | null;
  store?: string | null;
  environment?: string | null;
};

export function readSubscriptionServerEnv(
  env: CloudflareRuntimeEnv,
  name: string,
): string | undefined {
  const runtime = env[name];
  if (typeof runtime === "string" && runtime.trim()) return runtime.trim();
  const fallback = process.env[name];
  return typeof fallback === "string" && fallback.trim() ? fallback.trim() : undefined;
}

function adminClient(env: CloudflareRuntimeEnv) {
  const url = readSubscriptionServerEnv(env, "SUPABASE_URL")
    ?.replace(/\/(rest|auth)\/v1\/?$/i, "")
    .replace(/\/$/, "");
  const key = readSubscriptionServerEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("subscription_sync_configuration_missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function isCanonicalSupabaseUserId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function persistRevenueCatLifecycle(
  env: CloudflareRuntimeEnv,
  input: RevenueCatLifecycleInput,
): Promise<{ processed: boolean; applied: boolean; reason: string }> {
  if (!isCanonicalSupabaseUserId(input.userId)) throw new Error("revenuecat_user_identity_invalid");
  if ((input.entitlementId ?? REVENUECAT_ENTITLEMENT_ID) !== REVENUECAT_ENTITLEMENT_ID) {
    return { processed: false, applied: false, reason: "unrelated_entitlement" };
  }
  const admin = adminClient(env);
  const { data, error } = await admin.rpc("apply_revenuecat_subscription_event", {
    p_event_id: input.eventId,
    p_user_id: input.userId,
    p_event_type: input.eventType,
    p_event_at: input.eventAt.toISOString(),
    p_customer_id: input.customerId,
    p_entitlement_id: input.entitlementId ?? REVENUECAT_ENTITLEMENT_ID,
    p_product_id: input.productId ?? null,
    p_status: input.status,
    p_purchased_at: input.purchasedAt?.toISOString() ?? null,
    p_expiration_at: input.expirationAt?.toISOString() ?? null,
    p_cancellation_at: input.cancellationAt?.toISOString() ?? null,
    p_billing_issue_at: input.billingIssueAt?.toISOString() ?? null,
    p_store: input.store ?? null,
    p_environment: input.environment ?? null,
  });
  if (error) throw new Error("subscription_lifecycle_persistence_failed");
  const result = data as { processed?: boolean; applied?: boolean; reason?: string } | null;
  return {
    processed: Boolean(result?.processed),
    applied: Boolean(result?.applied),
    reason: result?.reason ?? "unknown",
  };
}
