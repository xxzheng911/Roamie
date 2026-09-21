import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [adapter, provider, deletion] = await Promise.all([
  readFile("src/services/subscription/index.ts", "utf8"),
  readFile("src/providers/SubscriptionProvider.tsx", "utf8"),
  readFile("src/lib/account-deletion/account-deletion.server.ts", "utf8"),
]);

assert.match(adapter, /Purchases\.logIn\(\{ appUserID: userId \}\)/);
assert.match(
  adapter,
  /Purchases\.syncPurchases\(\)/,
  "new identity must reconcile the App Store receipt",
);
assert.match(adapter, /storePurchasesReconciledUserId === userId/);
assert.match(provider, /adapter\s*\.reconcile\?\.\(user\.id\)/);
assert.match(provider, /adapter\.getStatus\(user\.id\)/);
assert.match(provider, /syncRevenueCatEntitlementWithServer\(userId\)/);
assert.match(deletion, /deleteRevenueCatCustomerV2/);
assert.doesNotMatch(adapter, /plan_tier|subscription_status/);

console.log("subscription account recreation regression: PASS");
