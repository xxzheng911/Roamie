#!/usr/bin/env node
/**
 * Place Intelligence Phase 2A — Recommendation Reason Diversity
 * 執行：npx vite-node --config scripts/vite.verify.config.mjs scripts/verify-place-reason-diversity.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPlaceRecommendationReason,
  userProfileForReasonFrom,
} from "../src/lib/build-place-recommendation-reason.ts";
import {
  collectPlaceReasonEvidence,
  FORBIDDEN_REASON_INFERENCES,
  assignDiversePlaceReasons,
  buildDiversePlaceRecommendationReasons,
} from "../src/lib/place-reason-diversity.ts";
import { mapPlaceResultsToChatItems } from "../src/lib/chat-session.ts";
import { buildUnifiedPlaceCards } from "../src/lib/unified-place-card.ts";
import {
  hasCanonicalPlaceDetailReason,
  resolvePlaceDetailReason,
} from "../src/lib/place-detail-resolve.ts";
import { resolveMoodEvidenceSource } from "../src/lib/ai/travel-context.ts";
import {
  mergeAiWithVerifiedCandidates,
  validateAiPersonalityClaims,
} from "../src/lib/recommendation/merge-verified.server.ts";
import { RoamieRecommendationItemSchema } from "../src/lib/ai/types.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function stubPlace(over) {
  return {
    address: "台北市大安區",
    lat: 25.033,
    lng: 121.565,
    rating: null,
    userRatingCount: null,
    photoName: null,
    primaryType: "cafe",
    types: ["cafe"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    ...over,
  };
}

const CAFE_BATCH = [
  stubPlace({
    id: "cafe-rating",
    name: "高分咖啡",
    rating: 4.9,
    userRatingCount: 40,
  }),
  stubPlace({
    id: "cafe-reviews",
    name: "人氣咖啡",
    rating: 4.2,
    userRatingCount: 900,
    openStatus: "open",
    openNow: true,
  }),
  stubPlace({
    id: "cafe-near",
    name: "附近咖啡",
    rating: 4.0,
    userRatingCount: 20,
    openStatus: "open",
    openNow: true,
    lat: 25.0332,
    lng: 121.5652,
  }),
  stubPlace({
    id: "cafe-late",
    name: "深夜咖啡",
    rating: 4.1,
    userRatingCount: 30,
    openStatus: "open",
    openNow: true,
    todayHoursLabel: "10:00–23:00",
    openUntilTime: "23:00",
  }),
  stubPlace({
    id: "cafe-type",
    name: "普通咖啡",
    rating: 3.8,
    userRatingCount: 10,
  }),
];

const CAFE_DISTANCES = {
  "cafe-rating": 2000,
  "cafe-reviews": 1500,
  "cafe-near": 200,
  "cafe-late": 3000,
  "cafe-type": 4000,
};

const ATTRACTION_BATCH = [
  stubPlace({
    id: "attr-rating",
    name: "高分景點",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    rating: 4.8,
    userRatingCount: 50,
  }),
  stubPlace({
    id: "attr-reviews",
    name: "人氣景點",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    rating: 4.2,
    userRatingCount: 1200,
    openStatus: "open",
    openNow: true,
  }),
  stubPlace({
    id: "attr-near",
    name: "附近公園",
    primaryType: "park",
    types: ["park"],
    rating: 4.0,
    userRatingCount: 25,
    openStatus: "open",
    openNow: true,
  }),
  stubPlace({
    id: "attr-late",
    name: "夜間博物館",
    primaryType: "museum",
    types: ["museum"],
    rating: 4.1,
    userRatingCount: 40,
    openStatus: "open",
    openNow: true,
    todayHoursLabel: "10:00–22:30",
    openUntilTime: "22:30",
  }),
  stubPlace({
    id: "attr-type",
    name: "一般景點",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    rating: 3.7,
    userRatingCount: 8,
  }),
];

const ATTRACTION_DISTANCES = {
  "attr-rating": 1800,
  "attr-reviews": 1600,
  "attr-near": 250,
  "attr-late": 2800,
  "attr-type": 4200,
};

function toItems(places, distances) {
  return places.map((place) => ({
    place,
    context: { distanceMeters: distances[place.id], distanceSource: "USER_LOCATION" },
  }));
}

console.info("[verify:place-reason-diversity] Phase 2A\n");

import { resolveRecommendationReasonPlace } from "../src/lib/build-place-recommendation-reason";
import { extractPlaceReviewEvidence } from "../src/lib/place-review-evidence";

test("insufficient evidence uses grounded neutral copy without dropping places", () => {
  const places = [1, 2, 3].map((n) =>
    stubPlace({
      id: `sparse-${n}`,
      name: `資料少咖啡 ${n}`,
    }),
  );
  const assigned = assignDiversePlaceReasons(places.map((place) => ({ place })));
  assert.equal(assigned.length, 3);
  assert.ok(assigned.every((row) => row.evidenceCode === "grounded_neutral"));
  assert.ok(assigned.every((row) => !row.reason.includes("類型符合")));
  assert.deepEqual(
    assigned.map((row) => row.placeId),
    places.map((p) => p.id),
  );
});

test("straight-line distance never becomes route_fit", () => {
  const place = stubPlace({ id: "straight-line", name: "兩公里咖啡" });
  const [assigned] = assignDiversePlaceReasons([{ place, context: { distanceMeters: 2000 } }]);
  assert.notEqual(assigned.evidenceCode, "route_fit");
  assert.equal(assigned.reason.includes("順路"), false);
});

test("clarification/search/destination/area center distance cannot become user proximity", () => {
  for (const distanceSource of [
    "CLARIFICATION_GEOCODE",
    "SEARCH_CENTER",
    "DESTINATION_CENTER",
    "AREA_CENTER",
  ]) {
    const place = stubPlace({ id: `scope-${distanceSource}`, name: "範圍中心咖啡" });
    const [assigned] = assignDiversePlaceReasons([
      { place, context: { distanceMeters: 300, distanceSource } },
    ]);
    assert.notEqual(assigned.evidenceCode, "nearby");
    assert.equal(/距離你|步行就能到/.test(assigned.reason), false);
  }
});

test("navigation origin cannot masquerade as user proximity", () => {
  const place = stubPlace({ id: "walk-near", name: "步行附近咖啡" });
  const [assigned] = assignDiversePlaceReasons([
    {
      place,
      context: {
        distanceMeters: 300,
        distanceSource: "NAVIGATION_ORIGIN",
        hasWalkingRouteEvidence: true,
      },
    },
  ]);
  assert.notEqual(assigned.evidenceCode, "nearby");
  assert.equal(/距離你很近/.test(assigned.reason), false);
});

test("generic mood never becomes a card primary reason", () => {
  const place = stubPlace({ id: "mood-not-primary", name: "心情咖啡" });
  const [assigned] = assignDiversePlaceReasons([
    {
      place,
      context: { mood: "想放空", preferenceEvidenceSource: "EXPLICIT_USER" },
    },
  ]);
  assert.notEqual(assigned.evidenceCode, "preference_fit");
  assert.equal(assigned.reason.includes("呼應你"), false);
});

test("recommendation order is unchanged after diversity assignment", () => {
  const items = toItems(CAFE_BATCH, CAFE_DISTANCES);
  const reasons = buildDiversePlaceRecommendationReasons(items);
  assert.equal(reasons.length, items.length);
  const assigned = assignDiversePlaceReasons(items);
  assert.deepEqual(
    assigned.map((row) => row.placeId),
    items.map((item) => item.place.id),
  );
});

test("diversity engine failure falls back to per-place builder", () => {
  const place = stubPlace({
    id: "fallback-ok",
    name: "Fallback Cafe",
    regularOpeningHours: {
      get periods() {
        throw new Error("evidence boom");
      },
    },
  });
  const sibling = stubPlace({ id: "fallback-sib", name: "Sibling Cafe" });
  const reasons = buildDiversePlaceRecommendationReasons([{ place }, { place: sibling }]);
  assert.equal(reasons.length, 2);
  assert.ok(reasons.every((reason) => typeof reason === "string" && reason.trim()));
});

test("category-derived mood cannot become preference evidence", () => {
  const place = stubPlace({ id: "category-derived", name: "Category Cafe" });
  const evidence = collectPlaceReasonEvidence(place, {
    mood: "美食咖啡",
    preferenceEvidenceSource: "CATEGORY_DERIVED",
    categoryIntent: "cafe",
  });
  assert.equal(
    evidence.some((item) => item.code === "preference_fit_interest"),
    false,
  );

  const reason = buildPlaceRecommendationReason(place, null, null, undefined, {
    mood: "美食咖啡",
    preferenceEvidenceSource: "CATEGORY_DERIVED",
    categoryIntent: "cafe",
  });
  assert.doesNotMatch(reason, /呼應你.*美食咖啡|符合你的偏好|你應該會喜歡/);
});

test("travel context distinguishes category routing from explicit mood evidence", () => {
  assert.equal(resolveMoodEvidenceSource("台南有什麼咖啡廳推薦", "美食咖啡"), "CATEGORY_DERIVED");
  assert.equal(resolveMoodEvidenceSource("今天想喝咖啡", "美食咖啡"), "USER_MESSAGE");
  assert.equal(resolveMoodEvidenceSource("今天想放鬆", "放鬆"), "USER_MESSAGE");
  assert.equal(
    resolveMoodEvidenceSource("還有嗎", "美食咖啡", "CATEGORY_DERIVED"),
    "CATEGORY_DERIVED",
  );
});

test("explicit user and session mood may ground preference evidence", () => {
  const place = stubPlace({ id: "user-grounded", name: "Grounded Cafe" });
  for (const preferenceEvidenceSource of ["USER_MESSAGE", "SESSION_CONTEXT"]) {
    const evidence = collectPlaceReasonEvidence(place, {
      mood: "今天想放鬆",
      preferenceEvidenceSource,
      categoryIntent: "cafe",
    });
    assert.equal(
      evidence.some((item) => item.code === "preference_fit"),
      true,
    );
  }
});

test("AI-inferred mood is not personalization evidence", () => {
  const place = stubPlace({ id: "ai-inferred", name: "Inferred Cafe" });
  const evidence = collectPlaceReasonEvidence(place, {
    mood: "悠閒",
    preferenceEvidenceSource: "AI_INFERRED",
  });
  assert.equal(
    evidence.some((item) => item.code === "preference_fit"),
    false,
  );
});

test("completed Plus profile remains valid preference evidence", () => {
  const place = stubPlace({ id: "plus-grounded", name: "Plus Cafe" });
  const evidence = collectPlaceReasonEvidence(
    place,
    {},
    {
      userProfile: { profileTier: "plus", onboarded: true, interests: ["咖啡"] },
    },
  );
  assert.equal(
    evidence.some((item) => item.code === "preference_fit_interest"),
    true,
  );
});

test("formal Plus preference evidence records field-specific provenance", () => {
  const cafe = stubPlace({ id: "plus-formal", primaryType: "cafe", types: ["cafe"] });
  const profile = userProfileForReasonFrom(
    {
      onboarded: true,
      interests: ["咖啡"],
      pace: "slow",
      vibe: "quiet",
      budgetMode: "budget",
      avoid: ["crowds"],
    },
    { hasPlusAccess: true },
  );
  const evidence = collectPlaceReasonEvidence(cafe, {}, { userProfile: profile });
  assert.ok(
    evidence.some(
      (item) => item.code === "preference_fit_interest" && item.preferenceField === "interests",
    ),
  );
  assert.ok(
    evidence.some(
      (item) =>
        item.code === "preference_fit_pace" && item.mappingContract === "slow_pace_identity_v1",
    ),
  );
  assert.ok(evidence.some((item) => item.code === "preference_fit_vibe"));
  assert.equal(
    evidence.some((item) => item.preferenceField === "budgetMode"),
    false,
  );
  assert.equal(
    evidence.some((item) => item.preferenceField === "avoid"),
    false,
  );
});

test("Free profiles are rejected while partial Plus profiles use only present evidence", () => {
  const place = stubPlace({ id: "tier-defense", primaryType: "cafe", types: ["cafe"] });
  for (const userProfile of [
    { profileTier: "free", onboarded: true, interests: ["咖啡"] },
    { onboarded: true, interests: ["咖啡"] },
  ]) {
    const evidence = collectPlaceReasonEvidence(place, {}, { userProfile });
    assert.equal(
      evidence.some((item) => item.code.startsWith("preference_fit_")),
      false,
    );
  }
  const partialPlus = collectPlaceReasonEvidence(
    place,
    {},
    {
      userProfile: { profileTier: "plus", onboarded: false, interests: ["咖啡"] },
    },
  );
  assert.equal(
    partialPlus.some(
      (item) => item.code === "preference_fit_interest" && item.preferenceField === "interests",
    ),
    true,
  );
});

test("AI personality claim validator rejects unsupported facts and accepts verified claims", () => {
  const place = stubPlace({ id: "claim-validator" });
  assert.deepEqual(validateAiPersonalityClaims("這裡很安靜，適合休息。", place), {
    valid: false,
    rejectedClaim: "quiet",
  });
  assert.deepEqual(validateAiPersonalityClaims("這裡價格親民。", place), {
    valid: false,
    rejectedClaim: "price",
  });
  assert.deepEqual(
    validateAiPersonalityClaims("這裡很安靜。", {
      ...place,
      reasonClaimEvidence: ["quiet_ambience"],
    }),
    { valid: true, rejectedClaim: "" },
  );
});

test("logout and auth transitions invalidate personalized chat caches", () => {
  const source = readFileSync(new URL("../src/lib/clear-auth-state.ts", import.meta.url), "utf8");
  const provider = readFileSync(
    new URL("../src/providers/AppProviders.tsx", import.meta.url),
    "utf8",
  );
  const access = readFileSync(new URL("../src/hooks/use-access.tsx", import.meta.url), "utf8");
  assert.match(source, /roamie:chat-planning/);
  assert.match(source, /roamie:chat-ui-cache/);
  assert.match(source, /clearPersonalizedChatCaches\(\)/);
  assert.match(provider, /prev && userId && prev !== userId[\s\S]*clearPersonalizedChatCaches\(\)/);
  assert.match(access, /previous !== tier[\s\S]*clearPersonalizedChatCaches\(\)/);
});

test("Plus quiz personalization requires entitlement, completion, and place evidence", () => {
  const prefs = { onboarded: true, interests: ["咖啡"] };
  const freeProfile = userProfileForReasonFrom(prefs, { hasPlusAccess: false });
  const incompleteProfile = userProfileForReasonFrom(
    { onboarded: false, interests: ["咖啡"] },
    { hasPlusAccess: true },
  );
  const plusProfile = userProfileForReasonFrom(prefs, { hasPlusAccess: true });
  const cafe = stubPlace({ id: "plus-cafe", primaryType: "cafe", types: ["cafe"] });
  const clothing = stubPlace({
    id: "plus-clothing",
    primaryType: "clothing_store",
    types: ["clothing_store"],
  });

  assert.equal(
    collectPlaceReasonEvidence(cafe, {}, { userProfile: freeProfile }).some((item) =>
      item.code.startsWith("preference_fit_"),
    ),
    false,
  );
  assert.equal(
    collectPlaceReasonEvidence(cafe, {}, { userProfile: incompleteProfile }).some((item) =>
      item.code.startsWith("preference_fit_"),
    ),
    false,
  );
  assert.equal(
    collectPlaceReasonEvidence(clothing, {}, { userProfile: plusProfile }).some((item) =>
      item.code.startsWith("preference_fit_"),
    ),
    false,
  );
  assert.equal(
    collectPlaceReasonEvidence(cafe, {}, { userProfile: plusProfile }).some((item) =>
      item.code.startsWith("preference_fit_"),
    ),
    true,
  );
});

test("Chat initial and continuation mappings receive the shared reason profile", () => {
  const initialSource = readFileSync(
    new URL("../src/lib/ai/chat-destination-category-recommendation.ts", import.meta.url),
    "utf8",
  );
  const continuationSource = readFileSync(
    new URL("../src/lib/ai/recommendation-refinement/execute.ts", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(new URL("../src/routes/_app.chat.tsx", import.meta.url), "utf8");
  assert.match(initialSource, /userProfile\?: UserProfileForReason/);
  assert.match(continuationSource, /userProfile\?: UserProfileForReason/);
  assert.equal((routeSource.match(/userProfileForReasonFrom\(/g) ?? []).length >= 2, true);
});

test("fallback reasonSource is accepted by the formal recommendation schema", () => {
  const parsed = RoamieRecommendationItemSchema.parse({
    name: "Fallback",
    type: "地點",
    description: "",
    reason: "先依地點資料提供你參考。",
    estimatedTime: "1 小時",
    address: "",
    lat: null,
    lng: null,
    googleMapsUrl: "",
    placeName: "Fallback",
    reasonSource: "fallback",
  });
  assert.equal(parsed.reasonSource, "fallback");
});

{
  const place = resolveRecommendationReasonPlace({
    id: "ChIJ_Batch",
    name: "Cafe",
    primaryType: "cafe",
    rating: 4.8,
    userRatingCount: 5000,
  });
  const peer = { ...place, id: "ChIJ_Peer", name: "Peer" };
  place.reviewEvidence = extractPlaceReviewEvidence(place.id, [
    { text: { text: "有插座" } },
    { text: { text: "插座很多" } },
  ]);
  const expected = buildPlaceRecommendationReason(place, null, null, undefined, undefined, "zh-TW");
  for (const items of [[{ place }], [{ place }, { place: peer }], [{ place: peer }, { place }]]) {
    const result = assignDiversePlaceReasons(items, { locale: "zh-TW" });
    assert.equal(result.find((r) => r.placeId === place.id).reason, expected);
    assert.equal(result.find((r) => r.placeId === place.id).evidenceCode, "review_consensus");
    assert.deepEqual(
      result.map((r) => r.placeId),
      items.map((r) => r.place.id),
    );
  }
  assert.deepEqual(buildDiversePlaceRecommendationReasons([]), []);
  assert.ok(
    collectPlaceReasonEvidence(peer).some((e) => e.code === "high_rating"),
    "legacy evidence metadata remains available",
  );
  assert.doesNotMatch(expected, /Google 評分|5000|熱門/);
  assert.match(expected, /^這是一間咖啡廳/);
  console.log(
    "PASS canonical batch authority: stable across single/batch/order, preserves places and evidence metadata",
  );
}
