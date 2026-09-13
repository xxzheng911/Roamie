import { z } from "zod";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import {
  isCanonicalSupabaseUserId,
  persistRevenueCatLifecycle,
  readSubscriptionServerEnv,
  type RevenueCatLifecycleInput,
} from "@/lib/subscription/revenuecat-lifecycle.server";
import { syncRevenueCatSubscription } from "@/lib/subscription/revenuecat-sync.server";

const Event = z.object({
  id: z.string().min(1).max(256),
  type: z.string().min(1).max(64),
  event_timestamp_ms: z.number().int().nonnegative(),
  app_id: z.string().min(1).max(256),
  app_user_id: z.string().max(256).optional(),
  original_app_user_id: z.string().max(256).optional(),
  aliases: z.array(z.string().max(256)).max(100).optional(),
  transferred_from: z.array(z.string().max(256)).max(100).optional(),
  transferred_to: z.array(z.string().max(256)).max(100).optional(),
  entitlement_id: z.string().nullable().optional(),
  entitlement_ids: z.array(z.string()).optional(),
  product_id: z.string().nullable().optional(),
  new_product_id: z.string().nullable().optional(),
  purchased_at_ms: z.number().int().nullable().optional(),
  expiration_at_ms: z.number().int().nullable().optional(),
  grace_period_expiration_at_ms: z.number().int().nullable().optional(),
  cancel_reason: z.string().nullable().optional(),
  store: z.string().nullable().optional(),
  environment: z.string().nullable().optional(),
});
const Payload = z.object({ api_version: z.string(), event: Event });

function safeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = aa.length ^ bb.length;
  const length = Math.max(aa.length, bb.length);
  for (let i = 0; i < length; i++) diff |= (aa[i % aa.length] ?? 0) ^ (bb[i % bb.length] ?? 0);
  return diff === 0;
}

function ms(value: number | null | undefined): Date | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value) : null;
}

export function revenueCatStatusFor(
  type: string,
  cancelReason?: string | null,
  expirationAtMs?: number | null,
  eventAtMs?: number | null,
): RevenueCatLifecycleInput["status"] {
  if (type === "EXPIRATION") return "expired";
  if (
    type === "CANCELLATION" &&
    cancelReason === "CUSTOMER_SUPPORT" &&
    typeof expirationAtMs === "number" &&
    typeof eventAtMs === "number" &&
    expirationAtMs <= eventAtMs
  )
    return "revoked";
  if (type === "CANCELLATION") return "cancelled";
  if (type === "BILLING_ISSUE") return "billing_issue";
  if (type === "SUBSCRIPTION_PAUSED") return "paused";
  return "active";
}

function identityCandidates(event: z.infer<typeof Event>): string[] {
  if (
    event.type !== "TRANSFER" &&
    event.app_user_id &&
    isCanonicalSupabaseUserId(event.app_user_id)
  ) {
    return [event.app_user_id];
  }
  const source =
    event.type === "TRANSFER"
      ? (event.transferred_to ?? [])
      : [event.original_app_user_id, ...(event.aliases ?? [])];
  return [
    ...new Set(
      source.filter((value): value is string => Boolean(value && isCanonicalSupabaseUserId(value))),
    ),
  ];
}

type RevenueCatWebhookDependencies = {
  persist: typeof persistRevenueCatLifecycle;
  sync: typeof syncRevenueCatSubscription;
};

const DEFAULT_DEPENDENCIES: RevenueCatWebhookDependencies = {
  persist: persistRevenueCatLifecycle,
  sync: syncRevenueCatSubscription,
};

export async function handleRevenueCatWebhook(
  request: Request,
  env: CloudflareRuntimeEnv,
  dependencies: RevenueCatWebhookDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
  const expected = readSubscriptionServerEnv(env, "REVENUECAT_WEBHOOK_AUTHORIZATION");
  const expectedAppId = readSubscriptionServerEnv(env, "REVENUECAT_WEBHOOK_APP_ID");
  const supplied = request.headers.get("authorization")?.trim() ?? "";
  if (!expected || !expectedAppId || !supplied || !safeEqual(supplied, expected)) {
    return Response.json({ error: "webhook_unauthorized" }, { status: 401 });
  }
  let payload: z.infer<typeof Payload>;
  try {
    payload = Payload.parse(await request.json());
  } catch {
    return Response.json({ error: "webhook_payload_invalid" }, { status: 400 });
  }
  const event = payload.event;
  if (!safeEqual(event.app_id, expectedAppId)) {
    return Response.json({ error: "webhook_app_mismatch" }, { status: 422 });
  }
  const supported = new Set([
    "INITIAL_PURCHASE",
    "RENEWAL",
    "CANCELLATION",
    "UNCANCELLATION",
    "EXPIRATION",
    "BILLING_ISSUE",
    "PRODUCT_CHANGE",
    "TRANSFER",
    "SUBSCRIPTION_PAUSED",
    "SUBSCRIPTION_EXTENDED",
    "REFUND_REVERSED",
  ]);
  if (!supported.has(event.type))
    return Response.json({ received: true, ignored: "unsupported_event" });
  const entitlementIds =
    event.entitlement_ids ?? (event.entitlement_id ? [event.entitlement_id] : []);
  if (event.type !== "TRANSFER" && !entitlementIds.includes("premium")) {
    return Response.json({ received: true, ignored: "unrelated_entitlement" });
  }
  const users = identityCandidates(event);
  if (users.length !== 1) {
    return Response.json(
      { error: users.length ? "webhook_identity_ambiguous" : "webhook_identity_invalid" },
      { status: 422 },
    );
  }
  if (event.type === "TRANSFER") {
    const sourceUsers = [
      ...new Set((event.transferred_from ?? []).filter(isCanonicalSupabaseUserId)),
    ];
    for (const sourceUserId of sourceUsers) {
      await dependencies.persist(env, {
        eventId: event.id,
        userId: sourceUserId,
        eventType: event.type,
        eventAt: new Date(event.event_timestamp_ms),
        customerId: sourceUserId,
        entitlementId: "premium",
        status: "revoked",
        expirationAt: new Date(event.event_timestamp_ms),
        store: event.store,
        environment: event.environment,
      });
    }
    await dependencies.sync(users[0]!, env);
    return Response.json({
      received: true,
      processed: true,
      applied: true,
      reason: "transfer_synced",
    });
  }
  const expirationAt = ms(event.grace_period_expiration_at_ms ?? event.expiration_at_ms);
  const result = await dependencies.persist(env, {
    eventId: event.id,
    userId: users[0]!,
    eventType: event.type,
    eventAt: new Date(event.event_timestamp_ms),
    customerId: event.original_app_user_id ?? event.app_user_id ?? users[0]!,
    entitlementId: "premium",
    productId: event.new_product_id ?? event.product_id,
    status: revenueCatStatusFor(
      event.type,
      event.cancel_reason,
      event.grace_period_expiration_at_ms ?? event.expiration_at_ms,
      event.event_timestamp_ms,
    ),
    purchasedAt: ms(event.purchased_at_ms),
    expirationAt,
    cancellationAt: event.type === "CANCELLATION" ? new Date(event.event_timestamp_ms) : null,
    billingIssueAt: event.type === "BILLING_ISSUE" ? new Date(event.event_timestamp_ms) : null,
    store: event.store,
    environment: event.environment,
  });
  return Response.json({ received: true, ...result });
}
