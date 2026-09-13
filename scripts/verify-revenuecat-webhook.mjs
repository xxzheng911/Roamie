import assert from "node:assert/strict";
import fs from "node:fs";
import {
  handleRevenueCatWebhook,
  revenueCatStatusFor,
} from "../src/lib/subscription/revenuecat-webhook.server.ts";

const webhook = fs.readFileSync("src/lib/subscription/revenuecat-webhook.server.ts", "utf8");
const lifecycle = fs.readFileSync("src/lib/subscription/revenuecat-lifecycle.server.ts", "utf8");
const sync = fs.readFileSync("src/lib/subscription/revenuecat-sync.server.ts", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/20260913150000_revenuecat_subscription_lifecycle.sql",
  "utf8",
);
const resolverMigration = fs.readFileSync(
  "supabase/migrations/20260913160000_revenuecat_lifecycle_resolver.sql",
  "utf8",
);

const missing = await handleRevenueCatWebhook(
  new Request("https://roamie.tw/api/subscription/webhook", { method: "POST" }),
  {
    REVENUECAT_WEBHOOK_AUTHORIZATION: "Bearer expected",
    REVENUECAT_WEBHOOK_APP_ID: "app-test",
  },
);
assert.equal(missing.status, 401);
const invalid = await handleRevenueCatWebhook(
  new Request("https://roamie.tw/api/subscription/webhook", {
    method: "POST",
    headers: { authorization: "Bearer forged" },
    body: "{}",
  }),
  { REVENUECAT_WEBHOOK_AUTHORIZATION: "Bearer expected" },
);
assert.equal(invalid.status, 401);

const userId = "123e4567-e89b-42d3-a456-426614174000";
const persisted = [];
const validEvent = (overrides = {}) => ({
  api_version: "1.0",
  event: {
    id: "event-initial",
    type: "INITIAL_PURCHASE",
    event_timestamp_ms: 2_000,
    app_id: "app-test",
    app_user_id: userId,
    entitlement_ids: ["premium"],
    product_id: "roamie_premium_monthly",
    purchased_at_ms: 1_000,
    expiration_at_ms: 5_000,
    store: "APP_STORE",
    environment: "SANDBOX",
    ...overrides,
  },
});
const invoke = async (overrides = {}) =>
  handleRevenueCatWebhook(
    new Request("https://roamie.tw/api/subscription/webhook", {
      method: "POST",
      headers: { authorization: "Bearer expected", "content-type": "application/json" },
      body: JSON.stringify(validEvent(overrides)),
    }),
    {
      REVENUECAT_WEBHOOK_AUTHORIZATION: "Bearer expected",
      REVENUECAT_WEBHOOK_APP_ID: "app-test",
    },
    {
      persist: async (_env, input) => {
        persisted.push(input);
        return { processed: true, applied: true, reason: "applied" };
      },
      sync: async () => ({ active: true, expiresAt: null }),
    },
  );

assert.equal((await invoke()).status, 200);
assert.equal(persisted.at(-1).status, "active");
assert.equal(persisted.at(-1).userId, userId);
await invoke({ id: "event-renewal", type: "RENEWAL", expiration_at_ms: 8_000 });
assert.equal(persisted.at(-1).expirationAt.toISOString(), new Date(8_000).toISOString());
await invoke({ id: "event-cancel", type: "CANCELLATION", cancel_reason: "UNSUBSCRIBE" });
assert.equal(persisted.at(-1).status, "cancelled");
await invoke({ id: "event-expire", type: "EXPIRATION" });
assert.equal(persisted.at(-1).status, "expired");
await invoke({
  id: "event-refund",
  type: "CANCELLATION",
  cancel_reason: "CUSTOMER_SUPPORT",
  expiration_at_ms: 2_000,
});
assert.equal(persisted.at(-1).status, "revoked");
await invoke({ id: "event-billing", type: "BILLING_ISSUE" });
assert.equal(persisted.at(-1).status, "billing_issue");
const invalidIdentity = await invoke({ app_user_id: "not-a-supabase-user" });
assert.equal(invalidIdentity.status, 422);

assert.equal(revenueCatStatusFor("INITIAL_PURCHASE"), "active");
assert.equal(revenueCatStatusFor("RENEWAL"), "active");
assert.equal(revenueCatStatusFor("CANCELLATION", "UNSUBSCRIBE"), "cancelled");
assert.equal(revenueCatStatusFor("CANCELLATION", "CUSTOMER_SUPPORT", 4_000, 5_000), "revoked");
assert.equal(
  revenueCatStatusFor("CANCELLATION", "CUSTOMER_SUPPORT", 6_000, 5_000),
  "cancelled",
);
assert.equal(revenueCatStatusFor("EXPIRATION"), "expired");
assert.equal(revenueCatStatusFor("BILLING_ISSUE"), "billing_issue");
assert.match(webhook, /REVENUECAT_WEBHOOK_AUTHORIZATION/);
assert.match(webhook, /transferred_to/);
assert.match(lifecycle, /isCanonicalSupabaseUserId/);
assert.match(migration, /PRIMARY KEY \(event_id, user_id\)/);
assert.match(migration, /latest_event_at <= EXCLUDED\.latest_event_at/);
assert.match(migration, /reason', 'duplicate'/);
assert.match(migration, /THEN 'applied' ELSE 'out_of_order'/);
assert.match(resolverMigration, /status IN \('active','cancelled','billing_issue','paused'\)/);
assert.match(resolverMigration, /expiration_at > now\(\)/);
assert.doesNotMatch(resolverMigration, /SELECT COALESCE\(\s*p\.plan_tier/);
assert.match(resolverMigration, /RevenueCat lifecycle backfill required/);
assert.match(migration, /Keep the protected legacy mirror current during a staged rollout/);
assert.match(sync, /persistRevenueCatLifecycle/);
assert.match(webhook, /persistRevenueCatLifecycle/);
assert.doesNotMatch(webhook, /profiles/);
console.log("RevenueCat webhook lifecycle regression: PASS");
