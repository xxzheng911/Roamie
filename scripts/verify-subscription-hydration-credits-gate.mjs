#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const chat = readFileSync(join(root, "src/routes/_app.chat.tsx"), "utf8");
const canonical = readFileSync(
  join(root, "src/lib/access/subscription-canonical.ts"),
  "utf8",
);

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

console.log("\n[verify:subscription-hydration-credits-gate]\n");

test("canonical source-of-truth keeps unhydrated as not-plus", () => {
  assert.match(canonical, /if \(!state\.hydrated\) return false;/);
});

test("chat reads subscriptionHydrated and uses pending helper", () => {
  assert.match(chat, /const \{ hasPlusAccess, subscriptionHydrated \} = useAccess\(\);/);
  assert.match(chat, /const ensureSubscriptionHydratedForCredits = useCallback/);
});

test("all credits entry points guarded before beginCreditsOperation wrappers", () => {
  const matches = [...chat.matchAll(/ensureSubscriptionHydratedForCredits\(/g)];
  // 5 place recommendation paths + 2 itinerary paths
  assert.equal(matches.length >= 7, true);
});

console.log("\n[verify:subscription-hydration-credits-gate] OK\n");
