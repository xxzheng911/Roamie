import { REVENUECAT_ENTITLEMENT_ID } from "@/constants/subscription";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import {
  evaluateRevenueCatOwnership,
  SubscriptionOwnershipError,
} from "@/lib/subscription/revenuecat-identity";
import {
  persistRevenueCatLifecycle,
  readSubscriptionServerEnv,
} from "@/lib/subscription/revenuecat-lifecycle.server";

export type RevenueCatSubscriberPayload = {
  subscriber?: {
    entitlements?: Record<string, { expires_date?: string | null; product_identifier?: string }>;
    original_app_user_id?: string;
    aliases?: string[] | null;
  };
};

type SyncDependencies = {
  fetchSubscriber?: (userId: string, secret: string) => Promise<RevenueCatSubscriberPayload>;
  persist?: typeof persistRevenueCatLifecycle;
};

export function subscriptionSyncHttpStatus(code: string): number {
  if (code.startsWith("subscription_ownership_")) return 409;
  if (code === "subscription_sync_configuration_missing") return 503;
  return 502;
}

export function subscriptionSyncFailureResponse(error: unknown): Response {
  const code =
    error instanceof SubscriptionOwnershipError
      ? error.code
      : error instanceof Error && error.message
        ? error.message
        : "subscription_sync_failed";
  return Response.json({ error: code }, { status: subscriptionSyncHttpStatus(code) });
}

async function fetchRevenueCatSubscriber(
  userId: string,
  secret: string,
): Promise<RevenueCatSubscriberPayload> {
  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
    {
      headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`revenuecat_verification_failed_${response.status}`);
  return (await response.json()) as RevenueCatSubscriberPayload;
}

export async function syncRevenueCatSubscription(
  userId: string,
  env: CloudflareRuntimeEnv,
  dependencies: SyncDependencies = {},
): Promise<{ active: boolean; expiresAt: string | null; lifecyclePersisted: boolean }> {
  const revenueCatKey = readSubscriptionServerEnv(env, "REVENUECAT_SECRET_API_KEY");
  if (!revenueCatKey) throw new Error("subscription_sync_configuration_missing");

  const load = dependencies.fetchSubscriber ?? fetchRevenueCatSubscriber;
  const persist = dependencies.persist ?? persistRevenueCatLifecycle;
  const payload = await load(userId, revenueCatKey);
  const subscriber = payload.subscriber;
  const ownership = evaluateRevenueCatOwnership(
    {
      originalAppUserId: subscriber?.original_app_user_id,
      aliases: subscriber?.aliases,
    },
    userId,
  );
  if (ownership.outcome !== "owned") throw new SubscriptionOwnershipError(ownership.outcome);

  const entitlement = subscriber?.entitlements?.[REVENUECAT_ENTITLEMENT_ID];
  const expiresAt = entitlement?.expires_date ?? null;
  const active = Boolean(entitlement && (!expiresAt || Date.parse(expiresAt) > Date.now()));

  const lifecycle = await persist(env, {
    eventId: `sync:${crypto.randomUUID()}`,
    userId,
    eventType: "FOREGROUND_SYNC",
    eventAt: new Date(),
    customerId: subscriber?.original_app_user_id?.trim() || userId,
    entitlementId: REVENUECAT_ENTITLEMENT_ID,
    productId: entitlement?.product_identifier ?? null,
    status: active ? "active" : expiresAt ? "expired" : "inactive",
    expirationAt: expiresAt ? new Date(expiresAt) : null,
    store: "APP_STORE",
  });
  return {
    active,
    expiresAt,
    lifecyclePersisted:
      lifecycle.processed && (lifecycle.applied || lifecycle.reason === "duplicate"),
  };
}
