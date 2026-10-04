#!/usr/bin/env node
/**
 * Guest browsing authority.
 * Public reads are allowlisted. AI, credits, and user-owned writes stay authenticated.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decideAppShellAfterAuthRestore,
} from "../src/lib/auth-restore.ts";
import {
  claimPendingAuthAction,
  clearPendingAuthAction,
  isSafeAppReturnPath,
  peekPendingAuthAction,
  returnPathsMatch,
  stashPendingAuthAction,
} from "../src/lib/auth-pending-action.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

function assertUses(rel, pattern) {
  assert.match(read(rel), pattern, rel);
}

function assertOmits(rel, pattern) {
  assert.doesNotMatch(read(rel), pattern, rel);
}

console.log("[verify-guest-browsing-authority]");

assert.deepEqual(
  decideAppShellAfterAuthRestore({ onboardingCompleted: true, hasSessionUser: false }),
  { kind: "allow-guest" },
);
assert.equal(
  decideAppShellAfterAuthRestore({ onboardingCompleted: true, hasSessionUser: true }).kind,
  "allow-app",
);
assert.equal(isSafeAppReturnPath("/place?placeId=abc"), true);
assert.equal(isSafeAppReturnPath("//evil.example"), false);
assert.equal(isSafeAppReturnPath("https://evil.example"), false);
assert.equal(returnPathsMatch("/place?placeId=abc", "/place?placeId=abc"), true);
assert.equal(returnPathsMatch("/place?placeId=abc", "/place?placeId=other"), false);

const memory = new Map();
globalThis.sessionStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};
const stashed = stashPendingAuthAction({
  action: "favorite_write",
  sourcePath: "/place?placeId=abc",
  metadata: { placeId: "abc" },
});
assert.ok(stashed);
assert.equal(peekPendingAuthAction()?.id, stashed.id);
assert.equal(claimPendingAuthAction(stashed.id)?.action, "favorite_write");
assert.equal(claimPendingAuthAction(stashed.id), null);
assert.equal(peekPendingAuthAction(), null);
const cancelled = stashPendingAuthAction({ action: "ai_chat", sourcePath: "/chat" });
clearPendingAuthAction();
assert.equal(peekPendingAuthAction(), null);
assert.ok(cancelled);
const expired = stashPendingAuthAction({ action: "trip_generation", sourcePath: "/plan" });
expired.createdAt = Date.now() - 31 * 60 * 1000;
memory.set("roamie:pending-auth-action", JSON.stringify(expired));
assert.equal(peekPendingAuthAction(), null);
assert.equal(
  stashPendingAuthAction({ action: "account_action", sourcePath: "https://evil.example" }),
  null,
);

const publicReads = [
  "src/lib/places.functions.ts",
  "src/lib/location.functions.ts",
  "src/lib/place-navigation.functions.ts",
  "src/lib/trip-stop-search.functions.ts",
  "src/lib/recommendation.functions.ts",
];
for (const rel of publicReads) {
  assertUses(rel, /allowGuestPublicRead/);
  assertOmits(rel, /requireSupabaseAuth/);
}

assertUses("src/lib/weather.functions.ts", /getWeather = createServerFn[\s\S]{0,120}allowGuestPublicRead/);
assertUses("src/lib/weather.functions.ts", /weatherTestConnection = createServerFn[\s\S]{0,80}requireSupabaseAuth/);
assertUses("src/lib/routes.functions.ts", /routesComputeDuration = createServerFn[\s\S]{0,80}allowGuestPublicRead/);
assertUses("src/lib/routes.functions.ts", /routesTestConnection = createServerFn[\s\S]{0,80}requireSupabaseAuth/);
assertUses("src/lib/transit.functions.ts", /useAiReasons: authed \? data\.useAiReasons : false/);

for (const rel of [
  "src/routes/api/roamie.ts",
  "src/routes/api/chat.ts",
  "src/routes/api/generate-itinerary.ts",
]) {
  assertUses(rel, /requireAuthenticatedAiRequest/);
  assertOmits(rel, /allowGuestPublicRead/);
}

assertUses("src/lib/trips.functions.ts", /requireSupabaseAuth/);
assertOmits("src/lib/trips.functions.ts", /allowGuestPublicRead/);
assertUses("src/lib/google-rest-contract.ts", /unsupported_google_operation/);
assertUses("src/lib/google-rest-provider.server.ts", /isPublicReadAuthorized/);
assertUses("src/lib/google-proxy.server.ts", /presentedAuth && !userId/);
assertUses("src/lib/places-storage.ts", /AUTH_REQUIRED/);
assertOmits("src/lib/places-storage.ts", /guest-\$\{Date\.now/);
assertUses("src/routes/_app.tsx", /requireAppShellAccess/);
assertUses("src/routes/_app.settings.tsx", /requireAuthenticatedRoute/);
assertUses("src/routes/api/place-photo/sign.ts", /requireAuthenticatedAiRequest/);
assertOmits("src/routes/api/place-photo/sign.ts", /authorizeGuestPlacePhotoSign|authorizeGuestGoogleBilling/);
assertUses("src/routes/api/place-photo.ts", /runGoogleUpstreamAttempt/);
assertUses("src/lib/google-upstream-attempt.server.ts", /includeGlobalBudget: true/);
assertUses("src/lib/abuse-guard.server.ts", /export async function authorizeGuestGoogleBilling/);

console.log("  ✓ guest public read stays allowlisted and AI routes stay authenticated");
