import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveCanonicalPlusAccess } from "../src/lib/subscription/canonical-plus.ts";

const status = (tier, active = tier === "plus") => ({
  tier, isActive: active, expiresAt: null, productId: null, willRenew: active, source: "revenuecat",
});

assert.equal(resolveCanonicalPlusAccess(false, status("plus")), true, "active RevenueCat entitlement grants Plus");
assert.equal(resolveCanonicalPlusAccess(true, status("free", false)), true, "admin/promo remains authoritative");
assert.equal(resolveCanonicalPlusAccess(false, status("free", false)), false, "inactive without server grant is Free");
assert.equal(resolveCanonicalPlusAccess(false, null), false, "unknown does not claim Plus");

const provider = fs.readFileSync("src/providers/SubscriptionProvider.tsx", "utf8");
const route = fs.readFileSync("src/routes/api/subscription/sync.ts", "utf8");
const server = fs.readFileSync("src/lib/subscription/revenuecat-sync.server.ts", "utf8");
const access = fs.readFileSync("src/hooks/use-access.tsx", "utf8");
assert.match(provider, /adapter\.configure\(user\.id\)/, "Supabase UUID binds RevenueCat identity");
assert.match(provider, /adapter\.logOut\(\)/, "logout clears RevenueCat identity");
assert.match(provider, /syncRevenueCatEntitlementWithServer/, "purchase/restore synchronize trusted server mirror");
assert.match(access, /base\.subscriptionHydrated && !revenueCatLoading/, "unknown hydration is not presented as settled Free");
assert.match(route, /requireAuthenticatedAiRequest/, "sync endpoint authenticates caller and ignores client tier claims");
assert.match(server, /api\.revenuecat\.com\/v1\/subscribers/, "server verifies subscriber directly with RevenueCat");
assert.doesNotMatch(route, /isPlus/, "client spoofed isPlus is not accepted by sync endpoint");
assert.match(server, /SUPABASE_SERVICE_ROLE_KEY/, "protected subscription mirror uses server authority");

console.log("RevenueCat subscription authority regression: PASS");
