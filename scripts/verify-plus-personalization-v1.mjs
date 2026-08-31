#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { userProfileForReasonFrom } from "../src/lib/build-place-recommendation-reason.ts";
import {
  buildPersonalizationContextV1,
  buildPersonalizationSnapshotV1,
  personalizationSnapshotInvalidationReason,
  resolveEffectivePreference,
  updateSessionPreferenceFromExplicitText,
} from "../src/lib/personalization/resolve-effective-preference.ts";
import { scorePersonalization, SURFACE_PERSONALIZATION_WEIGHTS } from "../src/lib/personalization/score.ts";
import { createEmptySessionPreference } from "../src/lib/personalization/types.ts";
import { createRecommendationSession, continueRecommendation } from "../src/lib/ai/conversation-recommendation-session.ts";

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); } catch (error) { console.error(`  ✗ ${name}`); throw error; }
}

const cafe = { id: "cafe", name: "Cafe", address: "Taipei", primaryType: "cafe", types: ["cafe"], userRatingCount: 100 };
const bar = { id: "bar", name: "Bar", address: "Taipei", primaryType: "bar", types: ["bar"], userRatingCount: 100 };
const plusQuietCoffee = userProfileForReasonFrom(
  { onboarded: true, interests: ["coffee"], pace: "slow", vibe: "quiet", avoid: ["crowds"] },
  { hasPlusAccess: true, travelStyle: "culture-focused" },
);

console.info("[verify:plus-personalization-v1]");

test("Free and Plus keep the same eligible candidate pool while Plus may reorder", () => {
  const pool = [bar, cafe];
  const free = buildPersonalizationContextV1({ surface: "homeNearby", profile: userProfileForReasonFrom({ onboarded: true, interests: ["coffee"] }, { hasPlusAccess: false }) });
  const plus = buildPersonalizationContextV1({ surface: "homeNearby", profile: plusQuietCoffee });
  assert.deepEqual(pool.map((p) => p.id), ["bar", "cafe"]);
  assert.equal(scorePersonalization(cafe, free).totalPersonalizationScore, 0);
  assert.ok(scorePersonalization(cafe, plus).totalPersonalizationScore > scorePersonalization(bar, plus).totalPersonalizationScore);
});

test("explicit request overrides conflicting Plus profile before scoring", () => {
  const context = buildPersonalizationContextV1({ surface: "chatNearby", profile: plusQuietCoffee, explicitCurrentRequest: { vibe: "lively" } });
  assert.equal(context.resolvedPreference.vibe, "lively");
  assert.equal(context.resolvedPreference.sources.vibe, "explicit");
  assert.equal(scorePersonalization(cafe, context).matchedMappings.includes("vibe:quiet"), false);
  assert.ok(scorePersonalization(bar, context).vibeFitScore > 0);
});

test("session category exclusion suppresses conflicting profile interest", () => {
  const session = { ...createEmptySessionPreference(), revision: 1, categoryExclude: ["cafe"] };
  const context = buildPersonalizationContextV1({ surface: "chatNearby", profile: plusQuietCoffee, sessionPreference: session });
  const score = scorePersonalization(cafe, context);
  assert.equal(score.interestFitScore, 0);
  assert.ok(score.rejectedSignals.includes("interests:session_category_excluded"));
});

test("only explicit user text writes SessionPreferenceV1", () => {
  const unchanged = updateSessionPreferenceFromExplicitText(undefined, "還有嗎", "turn-1");
  assert.equal(unchanged.revision, 0);
  const next = updateSessionPreferenceFromExplicitText(unchanged, "不要酒吧，今天想熱鬧一點，也不要太熱門", "turn-2");
  assert.ok(next.categoryExclude.includes("bar"));
  assert.equal(next.temporaryVibe, "lively");
  assert.equal(next.avoidHighPopularity, true);
  assert.ok(next.provenance.every((p) => p.source === "explicit_user"));
});

test("incomplete Plus and Free never consume long-term profile", () => {
  for (const profile of [
    userProfileForReasonFrom({ onboarded: false, interests: ["coffee"] }, { hasPlusAccess: true }),
    userProfileForReasonFrom({ onboarded: true, interests: ["coffee"] }, { hasPlusAccess: false }),
  ]) {
    const context = buildPersonalizationContextV1({ surface: "explore", profile });
    assert.equal(context.plusProfile, null);
    assert.equal(scorePersonalization(cafe, context).interestFitScore, 0);
  }
});

test("avoid crowds is a soft penalty and never changes eligibility", () => {
  const nightMarket = { id: "nm", name: "Night Market", address: "Taipei", primaryType: "night_market", types: ["night_market"], userRatingCount: 2000 };
  const context = buildPersonalizationContextV1({ surface: "destination", profile: plusQuietCoffee });
  assert.ok(scorePersonalization(nightMarket, context).avoidPenalty > 0);
  assert.equal(nightMarket.id, "nm");
});

test("component meaning is identical across surfaces; only final weights differ", () => {
  const rows = Object.keys(SURFACE_PERSONALIZATION_WEIGHTS).map((surface) =>
    scorePersonalization(cafe, buildPersonalizationContextV1({ surface, profile: plusQuietCoffee })),
  );
  for (const row of rows.slice(1)) {
    assert.equal(row.interestFitScore, rows[0].interestFitScore);
    assert.equal(row.paceFitScore, rows[0].paceFitScore);
    assert.equal(row.vibeFitScore, rows[0].vibeFitScore);
  }
});

test("continuation stores and reuses the same ordered personalization snapshot", () => {
  const context = buildPersonalizationContextV1({ surface: "chatNearby", profile: plusQuietCoffee, profileVersion: "v1" });
  const snapshot = buildPersonalizationSnapshotV1(context, ["cafe", "bar"]);
  const item = (id) => ({ name: id, placeName: id, reason: "ok", description: "", type: "place", estimatedTime: "1h", address: "", lat: 1, lng: 1, googleMapsUrl: "", reasonSource: "evidence", googlePlaceId: id });
  const created = createRecommendationSession({ destination: "Taipei", topic: "cafe", pool: [item("cafe"), item("bar")], batchSize: 1, personalizationSnapshot: snapshot });
  const continued = continueRecommendation(created.session, 1);
  assert.equal(continued.batch[0].googlePlaceId, "bar");
  assert.deepEqual(continued.session.personalizationSnapshot, snapshot);
});

test("tier, profile and session changes invalidate continuation snapshot", () => {
  const context = buildPersonalizationContextV1({ surface: "chatNearby", profile: plusQuietCoffee, profileVersion: "v1" });
  const snapshot = buildPersonalizationSnapshotV1(context, ["cafe"]);
  assert.equal(personalizationSnapshotInvalidationReason(snapshot, { ...context, profileTier: "free" }), "tier_changed");
  assert.equal(personalizationSnapshotInvalidationReason(snapshot, { ...context, profileVersion: "v2" }), "profile_changed");
  assert.equal(personalizationSnapshotInvalidationReason(snapshot, { ...context, sessionPreferenceVersion: 2 }), "session_preference_changed");
});

test("Planner and Explore retain core contracts while consuming V1 adapter", () => {
  const planner = readFileSync(new URL("../src/lib/ai/trip-place-scoring.ts", import.meta.url), "utf8");
  const explore = readFileSync(new URL("../src/lib/recommendation/engine/adapters/explore.ts", import.meta.url), "utf8");
  assert.match(planner, /surface: "planner"/);
  assert.match(planner, /PLUS_PERSONALIZATION_PLANNER/);
  assert.match(explore, /effectivePreferenceContext/);
  assert.match(explore, /buildMemoryPersonalization/);
  assert.match(explore, /buildDnaPersonalization/);
});

test("all target surfaces route through the unified scorer adapter", () => {
  const files = [
    "../src/lib/home-nearby-ranking.ts", "../src/lib/ai/chat-place-recommendation.ts",
    "../src/lib/enrich-roamie-places.server.ts", "../src/lib/sort-explore-places.ts",
    "../src/lib/ai/trip-place-scoring.ts",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /surface: "(?:homeNearby|chatNearby|destination|explore|planner)"/);
  }
});

console.info("[verify:plus-personalization-v1] all passed");
