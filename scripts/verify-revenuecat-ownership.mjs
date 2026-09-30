import assert from "node:assert/strict";
import fs from "node:fs";
import { plusPurchaseMessages } from "../src/lib/i18n/plus-purchase.ts";
import {
  resolveCanonicalPlusAccess,
  subscriptionStatusForDisplay,
} from "../src/lib/subscription/canonical-plus.ts";
import {
  evaluateRevenueCatOwnership,
  resolveRevenueCatEventOwner,
  SubscriptionOwnershipError,
} from "../src/lib/subscription/revenuecat-identity.ts";
import {
  isCanonicalRestoreConfirmed,
  syncRevenueCatEntitlementAfterRestore,
} from "../src/lib/subscription/revenuecat-sync.ts";
import {
  subscriptionSyncFailureResponse,
  syncRevenueCatSubscription,
} from "../src/lib/subscription/revenuecat-sync.server.ts";
import { handleRevenueCatWebhook } from "../src/lib/subscription/revenuecat-webhook.server.ts";
import { resolveRestoreOutcome } from "../src/services/subscription/purchase-outcome.ts";

const userA = "123e4567-e89b-42d3-a456-426614174000";
const userB = "223e4567-e89b-42d3-a456-426614174001";
const anonymous = "$RCAnonymousID:install-a";
const future = "2026-12-01T00:00:00.000Z";
const past = "2020-01-01T00:00:00.000Z";
const secret = "sk_test_revenuecat";
const env = { REVENUECAT_SECRET_API_KEY: secret };

function subscriber(original, aliases, expiresAt) {
  return {
    subscriber: {
      original_app_user_id: original,
      ...(aliases === undefined ? {} : { aliases }),
      entitlements: expiresAt
        ? { premium: { expires_date: expiresAt, product_identifier: "roamie_premium_monthly" } }
        : {},
    },
  };
}

async function syncAs(userId, payload) {
  const persisted = [];
  const seen = [];
  try {
    const result = await syncRevenueCatSubscription(userId, env, {
      fetchSubscriber: async (requested, key) => {
        seen.push({ requested, key });
        return payload;
      },
      persist: async (_env, input) => {
        persisted.push(input);
        return { processed: true, applied: true, reason: "applied" };
      },
    });
    return { result, persisted, seen };
  } catch (error) {
    return { error, persisted, seen };
  }
}

const plus = (originalAppUserId) => ({
  tier: "plus",
  isActive: true,
  expiresAt: future,
  productId: "roamie_premium_monthly",
  willRenew: true,
  source: "revenuecat",
  originalAppUserId,
});

const bought = await syncAs(userA, subscriber(userA, [anonymous, userA], future));
assert.equal(bought.result.active, true, "A buys then A syncs Plus");
assert.equal(bought.persisted[0].userId, userA);
assert.equal(bought.persisted[0].status, "active");
assert.equal(bought.seen[0].requested, userA);
assert.equal(bought.seen[0].key, secret);
assert.equal(bought.result.lifecyclePersisted, true);

const reinstall = await syncAs(userA, subscriber(userA, [anonymous, userA], future));
assert.equal(reinstall.result.active, true, "A reinstall sync stays Plus");
const otherDevice = await syncAs(userA, subscriber(userA, [userA], future));
assert.equal(otherDevice.result.active, true, "A on another device sync stays Plus");

const cross = await syncAs(userB, subscriber(userA, [anonymous, userA], future));
assert.ok(cross.error instanceof SubscriptionOwnershipError);
assert.equal(cross.error.code, "subscription_ownership_mismatch");
assert.equal(cross.persisted.length, 0, "B restore of A's receipt does not write Plus");
assert.equal(cross.error.message.includes(userA), false);
assert.equal(cross.error.message.includes(userB), false);
const mismatchResponse = subscriptionSyncFailureResponse(cross.error);
assert.equal(mismatchResponse.status, 409);
assert.deepEqual(await mismatchResponse.json(), { error: "subscription_ownership_mismatch" });

const coldStart = subscriptionStatusForDisplay(plus(userA), userB, false);
assert.equal(coldStart.isActive, false, "B cold start with A's original id does not show Plus");
assert.equal(
  resolveCanonicalPlusAccess(false, plus(userB), { userId: userB, ownershipBlocked: true }),
  false,
  "transferred CustomerInfo does not show Plus after the server rejects it",
);
assert.equal(
  resolveCanonicalPlusAccess(false, plus(userA), { userId: userA, ownershipBlocked: true }),
  false,
  "local premium loses to a server ownership rejection",
);
assert.equal(
  resolveCanonicalPlusAccess(true, plus(userB), { userId: userB, ownershipBlocked: true }),
  true,
  "an existing server entitlement is not revoked by the display gate",
);
assert.equal(
  resolveCanonicalPlusAccess(false, plus(userA), { userId: userA }),
  true,
  "same-user CustomerInfo still shows Plus before hydration",
);

const anonymousOnly = await syncAs(userA, subscriber(anonymous, [anonymous], future));
assert.equal(anonymousOnly.error.code, "subscription_ownership_anonymous");
assert.equal(anonymousOnly.persisted.length, 0, "anonymous RevenueCat id does not grant Plus");
assert.equal((await subscriptionSyncFailureResponse(anonymousOnly.error)).status, 409);

const aliasedCross = await syncAs(userB, subscriber(userA, [userA, userB, anonymous], future));
assert.equal(aliasedCross.error.code, "subscription_ownership_mismatch");
assert.equal(aliasedCross.persisted.length, 0, "an alias does not let B take A's Plus");
const originalWithAlias = await syncAs(userA, subscriber(userA, [userA, userB, anonymous], future));
assert.equal(originalWithAlias.result.active, true, "A remains Plus when another id is only an alias");
assert.equal(originalWithAlias.persisted[0].userId, userA);

const ambiguous = await syncAs(userB, subscriber(anonymous, [anonymous, userA, userB], future));
assert.equal(ambiguous.error.code, "subscription_ownership_ambiguous");
assert.equal(ambiguous.persisted.length, 0, "ambiguous aliases do not grant Plus");
assert.equal(
  ambiguous.persisted.some((row) => row.status === "revoked"),
  false,
);

const identifiedAlias = await syncAs(userA, subscriber(anonymous, [anonymous, userA], future));
assert.equal(identifiedAlias.result.active, true, "anonymous original with only A's alias is A's");

const renewal = await syncAs(userA, subscriber(userA, [userA], future));
assert.equal(renewal.persisted[0].status, "active", "valid renewal sync remains Plus");
const expired = await syncAs(userA, subscriber(userA, [userA], past));
assert.equal(expired.result.active, false);
assert.equal(expired.persisted[0].status, "expired", "expiration still applies to the owner");
assert.equal(expired.persisted[0].userId, userA);

assert.deepEqual(evaluateRevenueCatOwnership({ originalAppUserId: userA }, userB), {
  outcome: "mismatch",
  ownerId: userA,
});
assert.equal(
  resolveRevenueCatEventOwner({ appUserId: userB, originalAppUserId: userA }).outcome,
  "ambiguous",
);
assert.equal(
  resolveRevenueCatEventOwner({ appUserId: userA }).outcome,
  "ambiguous",
  "app_user_id alone is not ownership proof",
);

const restoreResult = {
  outcome: "success",
  status: plus(userB),
  canonicalSynced: false,
  canonicalErrorCode: "subscription_ownership_mismatch",
};
assert.equal(resolveRestoreOutcome(restoreResult), "ownershipMismatch");
assert.equal(isCanonicalRestoreConfirmed(true, { ok: false, active: null, expiresAt: null, errorCode: "subscription_ownership_mismatch" }), false);
assert.equal(
  resolveRestoreOutcome({
    outcome: "success",
    status: plus(userA),
    canonicalSynced: true,
  }),
  "restored",
);

let ownershipAttempts = 0;
const stopped = await syncRevenueCatEntitlementAfterRestore({
  sync: async () => {
    ownershipAttempts += 1;
    return {
      ok: false,
      active: null,
      expiresAt: null,
      errorCode: "subscription_ownership_mismatch",
    };
  },
  wait: async () => {},
});
assert.equal(ownershipAttempts, 1, "ownership mismatch is not retried into a success");
assert.equal(stopped.errorCode, "subscription_ownership_mismatch");

const persisted = [];
const synced = [];
const webhookEnv = {
  REVENUECAT_WEBHOOK_AUTHORIZATION: "Bearer expected",
  REVENUECAT_WEBHOOK_APP_ID: "app-test",
};
const webhookEvent = (overrides) => ({
  api_version: "1.0",
  event: {
    id: "event-owned",
    type: "RENEWAL",
    event_timestamp_ms: 2_000,
    app_id: "app-test",
    app_user_id: userA,
    original_app_user_id: userA,
    aliases: [anonymous, userA],
    entitlement_ids: ["premium"],
    product_id: "roamie_premium_monthly",
    expiration_at_ms: 8_000,
    store: "APP_STORE",
    environment: "SANDBOX",
    ...overrides,
  },
});
const postWebhook = (overrides) =>
  handleRevenueCatWebhook(
    new Request("https://roamie.tw/api/subscription/webhook", {
      method: "POST",
      headers: { authorization: "Bearer expected", "content-type": "application/json" },
      body: JSON.stringify(webhookEvent(overrides)),
    }),
    webhookEnv,
    {
      persist: async (_env, input) => {
        persisted.push(input);
        return { processed: true, applied: true, reason: "applied" };
      },
      sync: async (userId) => {
        synced.push(userId);
        return { active: true, expiresAt: null, lifecyclePersisted: true };
      },
    },
  );

assert.equal((await postWebhook()).status, 200, "valid renewal remains Plus");
assert.equal(persisted.at(-1).userId, userA);
assert.equal(persisted.at(-1).status, "active");
const replayCount = persisted.length;
assert.equal((await postWebhook()).status, 200, "webhook replay still reaches idempotent persist");
assert.equal(persisted.length, replayCount + 1);
assert.equal(persisted.at(-1).eventId, persisted.at(-2).eventId);

assert.equal((await postWebhook({ id: "event-expire", type: "EXPIRATION" })).status, 200);
assert.equal(persisted.at(-1).status, "expired");
assert.equal(persisted.at(-1).userId, userA);
assert.equal(
  (await postWebhook({ id: "event-cancel", type: "CANCELLATION", cancel_reason: "UNSUBSCRIBE" }))
    .status,
  200,
);
assert.equal(persisted.at(-1).status, "cancelled");
assert.equal(
  (
    await postWebhook({
      id: "event-refund",
      type: "CANCELLATION",
      cancel_reason: "CUSTOMER_SUPPORT",
      expiration_at_ms: 2_000,
    })
  ).status,
  200,
);
assert.equal(persisted.at(-1).status, "revoked");

const beforeTransfer = persisted.length;
const transfer = await postWebhook({
  id: "event-transfer",
  type: "TRANSFER",
  app_user_id: userB,
  original_app_user_id: userA,
  aliases: [userA, userB],
  transferred_from: [userA],
  transferred_to: [userB],
  entitlement_ids: null,
});
assert.equal(transfer.status, 200);
assert.deepEqual(await transfer.json(), {
  received: true,
  processed: false,
  applied: false,
  ignored: "transfer_ownership_rejected",
});
assert.equal(persisted.length, beforeTransfer, "TRANSFER does not revoke A or grant B");
assert.equal(synced.length, 0, "TRANSFER does not sync the destination");

const crossRenewal = await postWebhook({
  id: "event-cross-renewal",
  app_user_id: userB,
  original_app_user_id: userA,
  aliases: [userA, userB],
});
assert.equal(crossRenewal.status, 422);
assert.deepEqual(await crossRenewal.json(), { error: "webhook_identity_ambiguous" });
assert.equal(persisted.length, beforeTransfer);
const expireWithAlias = await postWebhook({
  id: "event-expire-aliased",
  type: "EXPIRATION",
  aliases: [anonymous, userA, userB],
});
assert.equal(expireWithAlias.status, 200);
assert.equal(persisted.at(-1).userId, userA);
assert.equal(persisted.at(-1).status, "expired", "original owner still expires when an alias exists");

const anonymousEvent = await postWebhook({
  id: "event-anonymous",
  app_user_id: anonymous,
  original_app_user_id: anonymous,
  aliases: [anonymous],
});
assert.equal(anonymousEvent.status, 422);
assert.deepEqual(await anonymousEvent.json(), { error: "webhook_identity_invalid" });

const malformed = await handleRevenueCatWebhook(
  new Request("https://roamie.tw/api/subscription/webhook", {
    method: "POST",
    headers: { authorization: "Bearer expected", "content-type": "application/json" },
    body: JSON.stringify({ api_version: "1.0", event: { type: "TEST" } }),
  }),
  webhookEnv,
);
assert.equal(malformed.status, 400);
assert.deepEqual(await malformed.json(), { error: "webhook_payload_invalid" });

const route = fs.readFileSync("src/routes/api/subscription/sync.ts", "utf8");
const server = fs.readFileSync("src/lib/subscription/revenuecat-sync.server.ts", "utf8");
const client = fs.readFileSync("src/lib/subscription/revenuecat-sync.ts", "utf8");
const webhook = fs.readFileSync("src/lib/subscription/revenuecat-webhook.server.ts", "utf8");
assert.match(route, /requireAuthenticatedAiRequest/);
assert.match(route, /auth\.userId/);
assert.doesNotMatch(route, /request\.json/);
assert.match(server, /api\.revenuecat\.com\/v1\/subscribers/);
assert.match(server, /REVENUECAT_SECRET_API_KEY/);
assert.doesNotMatch(server, /REVENUECAT_V2_SECRET_API_KEY/);
assert.doesNotMatch(`${route}\n${client}`, /REVENUECAT_SECRET_API_KEY/);
assert.match(webhook, /transfer_ownership_rejected/);
assert.doesNotMatch(webhook, /transfer_synced/);
assert.match(client, /Authorization: `Bearer \$\{token\}`/);

for (const [locale, messages] of Object.entries(plusPurchaseMessages)) {
  for (const key of ["ownershipMismatch", "ownershipUnconfirmed"]) {
    const text = messages[key];
    assert.equal(typeof text, "string", locale);
    assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-/i, `${locale} must not show a user id`);
    assert.doesNotMatch(text, /Apple ID|original app user id|\$RCAnonymousID/i);
  }
}
assert.equal(
  plusPurchaseMessages["zh-TW"].ownershipMismatch,
  "這筆訂閱已綁定其他 Roamie 帳號。請登入原本購買此訂閱的帳號後再試一次。",
);

console.log("RevenueCat subscription ownership regression: PASS");
