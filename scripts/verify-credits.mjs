#!/usr/bin/env node
/**
 * AI Credits Runtime — unit/contract guards
 *
 * - Flag OFF = no gate / no ledger (passthrough)
 * - Flag ON = Check → Reserve → Commit / Rollback
 * - PLACE_RECOMMENDATION = 1 per batch (not per place)
 * - ITINERARY_GENERATION = 7
 * - Greeting stages: 15–20 / 8–14 / 1–7 / 0
 *
 * 執行：npm run verify:credits
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCreditsGreetingContent,
  CREDITS_COSTS,
  FREE_MONTHLY_CREDITS,
  isCreditsFeatureEnabled,
  resolveCreditsFeatureFlag,
  resolveCreditsGreetingStage,
  setCreditsFeatureEnabledOverride,
} from "../src/lib/credits/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

console.log("\n[verify:credits]\n");

test("official costs only PLACE_RECOMMENDATION=1 and ITINERARY_GENERATION=7", () => {
  assert.equal(CREDITS_COSTS.PLACE_RECOMMENDATION, 1);
  assert.equal(CREDITS_COSTS.ITINERARY_GENERATION, 7);
  assert.equal(FREE_MONTHLY_CREDITS, 20);
  assert.deepEqual(Object.keys(CREDITS_COSTS).sort(), [
    "ITINERARY_GENERATION",
    "PLACE_RECOMMENDATION",
  ]);
});

test("feature flag override works; default path does not force ON", () => {
  setCreditsFeatureEnabledOverride(false);
  assert.equal(isCreditsFeatureEnabled(), false);
  setCreditsFeatureEnabledOverride(true);
  assert.equal(isCreditsFeatureEnabled(), true);
  setCreditsFeatureEnabledOverride(null);
  // After clearing override, env/localStorage/default apply — just ensure resolve returns shape
  const resolved = resolveCreditsFeatureFlag();
  assert.equal(typeof resolved.enabled, "boolean");
  assert.ok(["env", "localStorage", "default", "testOverride"].includes(resolved.source));
});

test("greeting stages match product bands", () => {
  assert.equal(resolveCreditsGreetingStage(20), 1);
  assert.equal(resolveCreditsGreetingStage(15), 1);
  assert.equal(resolveCreditsGreetingStage(14), 2);
  assert.equal(resolveCreditsGreetingStage(8), 2);
  assert.equal(resolveCreditsGreetingStage(7), 3);
  assert.equal(resolveCreditsGreetingStage(1), 3);
  assert.equal(resolveCreditsGreetingStage(0), 4);
  assert.equal(resolveCreditsGreetingStage(10, { isPlus: true }), 1);
  assert.equal(resolveCreditsGreetingStage(0, { creditsEnabled: false }), 1);
});

test("greeting copy builds stage reminders", () => {
  const copy = {
    stage1: "BASE",
    stage2: "SOFT",
    stage3: "HARD",
    stage4: "EMPTY",
  };
  assert.equal(
    buildCreditsGreetingContent(copy, 20, { isPlus: false, creditsEnabled: true }).content,
    "BASE",
  );
  // Stages are full greetings — no stage1 prepend (avoids duplicate openers).
  assert.equal(
    buildCreditsGreetingContent(copy, 10, { isPlus: false, creditsEnabled: true }).content,
    "SOFT",
  );
  assert.equal(
    buildCreditsGreetingContent(copy, 5, { isPlus: false, creditsEnabled: true }).content,
    "HARD",
  );
  assert.equal(
    buildCreditsGreetingContent(copy, 0, { isPlus: false, creditsEnabled: true }).content,
    "EMPTY",
  );
});

test("migration defines credit_accounts + ledger + RPCs", () => {
  const sql = read("supabase/migrations/20260723120000_ai_credits.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.credit_accounts/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.credit_ledger/);
  assert.match(sql, /credits_reserve/);
  assert.match(sql, /credits_commit/);
  assert.match(sql, /credits_rollback/);
  assert.match(sql, /PLACE_RECOMMENDATION/);
  assert.match(sql, /ITINERARY_GENERATION/);
  assert.match(sql, /credits_debug_set/);
});

test("override / stale rollback / environment migration", () => {
  const sql = read("supabase/migrations/20260723130000_credits_debug_override_stale_env.sql");
  assert.match(sql, /credit_debug_overrides/);
  assert.match(sql, /credits_release_stale_reservations/);
  assert.match(sql, /interval '5 minutes'/);
  assert.match(sql, /environment text/);
  assert.match(sql, /'debug'/);
  assert.match(sql, /'production'/);
  assert.match(sql, /credits_debug_clear_override/);
  assert.match(sql, /NEVER mutate formal|do not change its balances/i);
});

test("chat wires batch billing helpers (not per-card)", () => {
  const chat = read("src/routes/_app.chat.tsx");
  assert.match(chat, /beginPlaceRecommendationCredits/);
  assert.match(chat, /beginItineraryGenerationCredits/);
  assert.match(chat, /settleCreditsOperation/);
  assert.match(chat, /INSUFFICIENT_CREDITS_ITINERARY_MESSAGE/);
  // Ensure we do not introduce per-place charge loops in credits module
  const ops = read("src/lib/credits/operations.ts");
  assert.match(ops, /billing_unit: "recommendation_batch"/);
  assert.match(ops, /PLACE_RECOMMENDATION/);
  assert.doesNotMatch(ops, /per_place|per_card|amount:\s*recs\.length/);
});

test("home route must not surface credits UI", () => {
  const home = read("src/routes/_app.index.tsx");
  assert.doesNotMatch(home, /available_credits|Credits remaining|剩餘.*Credits/i);
});

test("developer debug panel: override + subscription Auto/Force", () => {
  const dev = read("src/routes/_app.developer.tsx");
  assert.match(dev, /Credits Debug Override/);
  assert.match(dev, /Subscription Debug/);
  assert.match(dev, /debugSubscriptionAuto/);
  assert.match(dev, /debugSetCredits/);
  assert.match(dev, /debugClearCreditsOverride/);
  assert.match(dev, /debugForceFree/);
  assert.match(dev, /debugForcePlus/);
  assert.match(dev, />\s*Auto\s*</);
  const debugTs = read("src/lib/credits/debug.ts");
  assert.match(debugTs, /credit_debug_overrides/);
  assert.match(debugTs, /Never mutates formal/);
});

console.log("\n[verify:credits] OK\n");
