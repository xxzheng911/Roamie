import { REVENUECAT_ENTITLEMENT_ID } from "@/constants/subscription";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import {
  persistRevenueCatLifecycle,
  readSubscriptionServerEnv,
} from "@/lib/subscription/revenuecat-lifecycle.server";

type RevenueCatSubscriber = {
  subscriber?: {
    entitlements?: Record<string, { expires_date?: string | null; product_identifier?: string }>;
    original_app_user_id?: string;
  };
};

export async function syncRevenueCatSubscription(
  userId: string,
  env: CloudflareRuntimeEnv,
): Promise<{ active: boolean; expiresAt: string | null }> {
  const revenueCatKey = readSubscriptionServerEnv(env, "REVENUECAT_SECRET_API_KEY");
  if (!revenueCatKey) throw new Error("subscription_sync_configuration_missing");

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

  await persistRevenueCatLifecycle(env, {
    eventId: `sync:${crypto.randomUUID()}`,
    userId,
    eventType: "FOREGROUND_SYNC",
    eventAt: new Date(),
    customerId: payload.subscriber?.original_app_user_id ?? userId,
    entitlementId: REVENUECAT_ENTITLEMENT_ID,
    productId: entitlement?.product_identifier ?? null,
    status: active ? "active" : expiresAt ? "expired" : "inactive",
    expirationAt: expiresAt ? new Date(expiresAt) : null,
    store: "APP_STORE",
  });
  return { active, expiresAt };
}
