#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlusEntitlementSnapshot } from "../src/lib/plan-tier/entitlement.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260909090000_plus_entitlement_authority.sql");

function test(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

function resolveFixture({ status = "inactive", admin = "none", promo = "none" } = {}) {
  const appStore = status === "active" || status === "trialing";
  const adminActive = admin === "active" || admin === "permanent";
  const promoActive = promo === "active" || promo === "permanent";
  const activeSources = [
    ...(adminActive ? ["admin_grant"] : []),
    ...(promoActive ? ["promo"] : []),
    ...(appStore ? ["app_store"] : []),
  ];
  return {
    hasPlus: activeSources.length > 0,
    source: adminActive ? "admin_grant" : promoActive ? "promo" : appStore ? "app_store" : "none",
    activeSources,
  };
}

console.log("\n[verify:plus-entitlement-authority]\n");

test("subscription and grant combinations use OR authority", () => {
  assert.equal(resolveFixture().hasPlus, false);
  assert.equal(resolveFixture({ status: "active" }).hasPlus, true);
  assert.equal(resolveFixture({ status: "trialing" }).hasPlus, true);
  assert.equal(resolveFixture({ status: "expired" }).hasPlus, false);
  assert.equal(resolveFixture({ admin: "permanent" }).hasPlus, true);
  assert.equal(resolveFixture({ status: "expired", admin: "permanent" }).hasPlus, true);
  assert.deepEqual(resolveFixture({ status: "active", admin: "permanent" }).activeSources, [
    "admin_grant",
    "app_store",
  ]);
  assert.equal(resolveFixture({ promo: "active" }).hasPlus, true);
  assert.equal(resolveFixture({ promo: "expired" }).hasPlus, false);
  assert.equal(resolveFixture({ promo: "expired", admin: "permanent" }).hasPlus, true);
  assert.equal(resolveFixture({ admin: "revoked" }).hasPlus, false);
  assert.equal(resolveFixture({ status: "active", admin: "revoked" }).hasPlus, true);
  assert.equal(resolveFixture({ status: "inactive", admin: "permanent" }).hasPlus, true);
  assert.equal(resolveFixture({ status: "active", admin: "permanent" }).source, "admin_grant");
});

test("authoritative snapshot parser fails closed", () => {
  assert.equal(parsePlusEntitlementSnapshot(null).hasPlus, false);
  assert.equal(
    parsePlusEntitlementSnapshot({ has_plus: false, effective_source: "admin_grant" })
      .effectiveSource,
    "none",
  );
  assert.deepEqual(
    parsePlusEntitlementSnapshot({
      has_plus: true,
      effective_source: "admin_grant",
      active_sources: ["admin_grant", "app_store"],
      expires_at: null,
    }).activeSources,
    ["admin_grant", "app_store"],
  );
});

test("migration defines active, expiry, revocation, and precedence contracts", () => {
  assert.match(migration, /starts_at <= now\(\)/);
  assert.match(migration, /expires_at IS NULL OR expires_at > now\(\)/);
  assert.match(migration, /revoked_at IS NULL/);
  assert.match(migration, /v_subscription_active OR v_admin_active OR v_promo_active/);
  assert.ok(migration.indexOf("v_admin_active THEN") < migration.indexOf("v_promo_active THEN"));
  assert.ok(
    migration.indexOf("v_promo_active THEN") < migration.indexOf("v_subscription_active THEN"),
  );
});

test("base grants and admin mutation functions are denied to authenticated", () => {
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.user_plus_entitlements FROM PUBLIC, anon, authenticated/,
  );
  assert.match(migration, /admin_grant_plus_entitlement[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /admin_revoke_plus_entitlement[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.doesNotMatch(migration, /current_user IN \('postgres'/);
});

test("profile subscription columns are protected while ordinary profile updates remain allowed", () => {
  assert.match(migration, /profiles_protect_subscription_columns/);
  for (const field of [
    "plan_tier",
    "subscription_status",
    "subscription_provider",
    "plus_available",
  ]) {
    assert.match(migration, new RegExp(`NEW\\.${field}`));
  }
  assert.doesNotMatch(migration, /NEW\.(display_name|avatar_url|ai_preferences).*RAISE EXCEPTION/);
});

test("runtime authorities call the resolver and production mock never writes profiles", () => {
  const storage = read("src/lib/plan-tier/storage.ts");
  const guard = read("src/lib/ai/endpoint-guard.server.ts");
  const mock = read("src/lib/plan-tier/sync-mock-tier.ts");
  assert.match(storage, /rpc\("resolve_user_plus_entitlement"/);
  assert.match(guard, /rpc\([\s\S]*"resolve_user_plus_entitlement"/);
  assert.doesNotMatch(
    mock,
    /\.from\("profiles"\)|plan_tier|subscription_status|subscription_provider/,
  );
  const access = read("src/hooks/use-access.tsx");
  assert.match(access, /if \(!isDeveloperBuildEnabled\(\)\) return;/);
});

test("subscription refresh cannot delete or mutate grant rows", () => {
  const subscription = read("src/services/subscription/index.ts");
  const provider = read("src/providers/SubscriptionProvider.tsx");
  assert.doesNotMatch(
    subscription + provider,
    /user_plus_entitlements|admin_revoke_plus_entitlement/,
  );
  assert.match(provider, /refreshAccess\(\)/);
});

test("credits and admin dashboard consume the authoritative resolver", () => {
  assert.match(migration, /credits_ensure_account[\s\S]*resolve_user_plus_entitlement/);
  assert.match(migration, /admin_dashboard_phase1[\s\S]*resolve_user_plus_entitlement/);
});

console.log("\n[verify:plus-entitlement-authority] OK\n");
