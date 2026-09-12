import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveCanonicalPlusAccess } from "../src/lib/subscription/canonical-plus.ts";
import { createSubscriptionConfigurationAuthority } from "../src/services/subscription/configuration-authority.ts";
import { syncRevenueCatEntitlementInBackground } from "../src/lib/subscription/revenuecat-sync.ts";

const status = (tier, active = tier === "plus") => ({
  tier,
  isActive: active,
  expiresAt: null,
  productId: null,
  willRenew: active,
  source: "revenuecat",
});

assert.equal(
  resolveCanonicalPlusAccess(false, status("plus")),
  true,
  "active RevenueCat entitlement grants Plus",
);
assert.equal(
  resolveCanonicalPlusAccess(true, status("free", false)),
  true,
  "admin/promo remains authoritative",
);
assert.equal(
  resolveCanonicalPlusAccess(false, status("free", false)),
  false,
  "inactive without server grant is Free",
);
assert.equal(resolveCanonicalPlusAccess(false, null), false, "unknown does not claim Plus");

const provider = fs.readFileSync("src/providers/SubscriptionProvider.tsx", "utf8");
const route = fs.readFileSync("src/routes/api/subscription/sync.ts", "utf8");
const server = fs.readFileSync("src/lib/subscription/revenuecat-sync.server.ts", "utf8");
const access = fs.readFileSync("src/hooks/use-access.tsx", "utf8");
const adapter = fs.readFileSync("src/services/subscription/index.ts", "utf8");
const purchaseProvider = fs.readFileSync("src/providers/PlusPurchaseProvider.tsx", "utf8");
const continuation = fs.readFileSync("src/lib/subscription/purchase-continuation.ts", "utf8");
const apiUrl = fs.readFileSync("src/lib/api-url.ts", "utf8");
const clientSync = fs.readFileSync("src/lib/subscription/revenuecat-sync.ts", "utf8");
assert.match(provider, /adapter\.configure\(user\.id\)/, "Supabase UUID binds RevenueCat identity");
assert.match(provider, /adapter\.logOut\(\)/, "logout clears RevenueCat identity");
assert.match(
  provider,
  /syncRevenueCatEntitlementWithServer/,
  "purchase/restore synchronize trusted server mirror",
);
assert.match(apiUrl, /"\/api\/subscription\/sync"/);
assert.match(
  provider,
  /syncRevenueCatEntitlementInBackground\(\)/,
  "CustomerInfo listener contains background sync failures",
);
assert.match(clientSync, /void sync\(\)\.catch/);
assert.match(clientSync, /event: "server_sync_failed"/);
assert.match(clientSync, /if \(!token\) return false/);
assert.match(clientSync, /Authorization: `Bearer \$\{token\}`/);

const backgroundDiagnostics = [];
syncRevenueCatEntitlementInBackground({
  sync: async () => {
    throw new Error("sensitive-upstream-detail");
  },
  report: (diagnostic) => backgroundDiagnostics.push(diagnostic),
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(backgroundDiagnostics, [
  { event: "server_sync_failed", errorCode: "subscription_sync_failed" },
]);
assert.match(
  access,
  /base\.subscriptionHydrated && !revenueCatLoading/,
  "unknown hydration is not presented as settled Free",
);
assert.match(
  route,
  /requireAuthenticatedAiRequest/,
  "sync endpoint authenticates caller and ignores client tier claims",
);
assert.match(
  server,
  /api\.revenuecat\.com\/v1\/subscribers/,
  "server verifies subscriber directly with RevenueCat",
);
assert.match(server, /readEnv\(env, "REVENUECAT_SECRET_API_KEY"\)/);
assert.doesNotMatch(server, /REVENUECAT_V2_SECRET_API_KEY/);
assert.doesNotMatch(route, /isPlus/, "client spoofed isPlus is not accepted by sync endpoint");
assert.match(
  server,
  /SUPABASE_SERVICE_ROLE_KEY/,
  "protected subscription mirror uses server authority",
);
assert.match(
  adapter,
  /function purchasesModule\(\)[\s\S]*return import\("@revenuecat\/purchases-capacitor"\)/,
);
assert.match(adapter, /const \{ Purchases \} = await purchasesModule\(\)/);
assert.doesNotMatch(adapter, /async function purchasesPlugin/);
assert.doesNotMatch(
  adapter,
  /return \(await import\("@revenuecat\/purchases-capacitor"\)\)\.Purchases/,
);
assert.doesNotMatch(adapter, /await\s+Purchases\b(?!\.)/);
assert.doesNotMatch(adapter, /Promise\.resolve\(Purchases\)/);

let configureCalls = 0;
let releaseConfigure;
const configureGate = new Promise((resolve) => {
  releaseConfigure = resolve;
});
const authority = createSubscriptionConfigurationAuthority(async () => {
  configureCalls += 1;
  await configureGate;
});
const providerHydration = authority.ensureConfigured("user-a");
const earlyOfferingLoad = authority.ensureConfigured("user-a");
const simultaneousOfferingLoad = authority.ensureConfigured("user-a");
assert.equal(configureCalls, 1, "concurrent native operations share one configure attempt");
releaseConfigure();
await Promise.all([providerHydration, earlyOfferingLoad, simultaneousOfferingLoad]);
assert.equal(configureCalls, 1, "configured identity is reused");

let retryCalls = 0;
const retryAuthority = createSubscriptionConfigurationAuthority(async () => {
  retryCalls += 1;
  if (retryCalls === 1) throw new Error("configure_failed");
});
await assert.rejects(retryAuthority.ensureConfigured("user-a"), /configure_failed/);
await retryAuthority.ensureConfigured("user-a");
assert.equal(retryCalls, 2, "failed configuration can be retried");

let identityOperation = "";
const switchAuthority = createSubscriptionConfigurationAuthority(async (userId) => {
  identityOperation += `configure:${userId};`;
});
await switchAuthority.ensureConfigured("user-a");
await Promise.all([
  switchAuthority.clearConfiguredIdentity(async () => {
    identityOperation += "logout;";
  }),
  switchAuthority.ensureConfigured("user-b"),
]);
assert.equal(
  identityOperation,
  "configure:user-a;logout;configure:user-b;",
  "logout and account switch are serialized",
);

assert.match(provider, /adapter\.getPackages\(user\.id\)/);
assert.match(provider, /adapter\.getStatus\(user\.id\)/);
assert.match(provider, /adapter\.purchase\(packageId, user\.id\)/);
assert.match(provider, /adapter\.restore\(user\.id\)/);
assert.match(adapter, /ensureConfigured\(userId\)[\s\S]*Purchases\.getOfferings\(\)/);
assert.match(purchaseProvider, /if \(!user\?\.id\)[\s\S]*savePlusPurchaseContinuation/);
assert.match(purchaseProvider, /if \(!user\?\.id\)[\s\S]*navigate\(\{ to: "\/login" \}\)/);
assert.doesNotMatch(
  purchaseProvider,
  /adapter\.configure|adapter\.getPackages|syncRevenueCatEntitlementWithServer/,
);
assert.doesNotMatch(
  `${purchaseProvider}\n${continuation}\n${adapter}`,
  /appUserID:\s*["']\(guest\)["']/,
);

console.log("RevenueCat subscription authority regression: PASS");
