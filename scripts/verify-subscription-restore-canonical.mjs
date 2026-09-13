import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isCanonicalRestoreConfirmed,
  syncRevenueCatEntitlementAfterRestore,
} from "../src/lib/subscription/revenuecat-sync.ts";
import { statusFromRevenueCatCustomerInfo } from "../src/services/subscription/revenuecat-customer-info.ts";

const activeSync = { ok: true, active: true, expiresAt: "2026-10-01T00:00:00.000Z" };
assert.equal(isCanonicalRestoreConfirmed(true, activeSync), true);
assert.equal(isCanonicalRestoreConfirmed(false, activeSync), false);
assert.equal(
  isCanonicalRestoreConfirmed(true, { ok: true, active: false, expiresAt: null }),
  false,
);

const bridgeInfo = (productId, expirationMillis) => ({
  entitlements: { active: { premium: { isActive: true, willRenew: true } } },
  activeSubscriptions: [],
  allPurchasedProductIdentifiers: [productId],
  allExpirationDatesMillis: { [productId]: expirationMillis },
  subscriptionsByProductIdentifier: {},
});
for (const productId of ["roamie_premium_monthly", "roamie_premium_yearly"]) {
  const expiration = Date.now() + 86_400_000;
  const status = statusFromRevenueCatCustomerInfo(bridgeInfo(productId, expiration));
  assert.equal(status.isActive, true);
  assert.equal(status.productId, productId);
  assert.equal(status.expiresAt, new Date(expiration).toISOString());
}
assert.equal(
  statusFromRevenueCatCustomerInfo(bridgeInfo("roamie_premium_monthly", Date.now() - 1)).productId,
  null,
  "expired top-level purchase is not selected as active metadata",
);

let attempts = 0;
const eventual = await syncRevenueCatEntitlementAfterRestore({
  sync: async () => {
    attempts += 1;
    return {
      ok: true,
      active: attempts === 3,
      expiresAt: null,
      lifecyclePersisted: attempts === 3,
    };
  },
  wait: async () => {},
});
assert.equal(eventual.active, true);
assert.equal(attempts, 3);
assert.equal(
  isCanonicalRestoreConfirmed(true, { ok: false, active: null, expiresAt: null }),
  false,
);

const [provider, access, adapter, dialog] = await Promise.all([
  readFile("src/providers/SubscriptionProvider.tsx", "utf8"),
  readFile("src/hooks/use-access.tsx", "utf8"),
  readFile("src/services/subscription/index.ts", "utf8"),
  readFile("src/components/RoamiePlusIntroDialog.tsx", "utf8"),
]);

assert.match(adapter, /Purchases\.restorePurchases\(\)/);
assert.match(adapter, /Purchases\.syncPurchases\(\)/);
assert.match(adapter, /Purchases\.getAppUserID\(\)/);
assert.match(adapter, /currentIdentityMatchesSupabase/);
assert.match(provider, /isCanonicalRestoreConfirmed/);
assert.match(provider, /setCanonicalRevision\(\(revision\) => revision \+ 1\)/);
assert.match(access, /canonicalRevision/);
assert.match(access, /\[userId, revenueCatLoading, canonicalRevision, hydrateFromSupabase\]/);
assert.match(dialog, /訂閱已找到，但同步失敗/);
assert.match(dialog, /找不到可恢復的 Plus 訂閱/);

console.log("subscription restore canonical regression: PASS");
