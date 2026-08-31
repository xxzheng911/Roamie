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
import { mergeAiWithVerifiedCandidates, validateAiPersonalityClaims } from "../src/lib/recommendation/merge-verified.server.ts";
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

test("5 cafes in one batch use distinct evidence types", () => {
  const assigned = assignDiversePlaceReasons(toItems(CAFE_BATCH, CAFE_DISTANCES));
  assert.equal(assigned.length, 5);
  assert.deepEqual(
    assigned.map((row) => row.placeId),
    CAFE_BATCH.map((p) => p.id),
    "recommendation order must not change",
  );
  const codes = assigned.map((row) => row.evidenceCode);
  assert.deepEqual(codes, [
    "high_rating",
    "high_review_count",
    "open_now",
    "late_hours",
    "grounded_neutral",
  ]);
  assert.equal(new Set(codes).size, 5);
  for (const row of assigned) {
    assert.ok(row.reason.trim().length > 0);
    for (const banned of FORBIDDEN_REASON_INFERENCES) {
      assert.equal(
        row.reason.includes(banned),
        false,
        `${row.placeId} reason leaked forbidden inference “${banned}”: ${row.reason}`,
      );
    }
  }
});

test("5 attractions in one batch use distinct evidence types", () => {
  const assigned = assignDiversePlaceReasons(toItems(ATTRACTION_BATCH, ATTRACTION_DISTANCES));
  assert.equal(assigned.length, 5);
  assert.deepEqual(
    assigned.map((row) => row.placeId),
    ATTRACTION_BATCH.map((p) => p.id),
  );
  const codes = assigned.map((row) => row.evidenceCode);
  assert.deepEqual(codes, [
    "high_rating",
    "high_review_count",
    "open_now",
    "late_hours",
    "grounded_neutral",
  ]);
  assert.equal(new Set(codes).size, 5);
});

test("rating evidence remains selectable when review count is below threshold", () => {
  const places = [1, 2, 3, 4, 5].map((n) =>
    stubPlace({
      id: `rating-clash-${n}`,
      name: `高分咖啡 ${n}`,
      rating: 4.8,
      userRatingCount: 40,
      openStatus: "open",
      openNow: true,
    }),
  );
  const assigned = assignDiversePlaceReasons(places.map((place) => ({ place })));
  const codes = assigned.map((row) => row.evidenceCode);
  assert.equal(codes[0], "high_rating");
  assert.ok(codes.every((code) => code !== "grounded_neutral"));
  assert.ok(assigned.every((row) => row.availableCodes.includes("high_rating")));
  assert.ok(assigned.some((row) => /^Google 評分/.test(row.reason)));
  assert.deepEqual(
    assigned.map((row) => row.placeId),
    places.map((p) => p.id),
  );
});

test("rating and review count together form grounded popularity evidence", () => {
  const [assigned] = assignDiversePlaceReasons([
    {
      place: stubPlace({
        id: "popular-cafe",
        name: "人氣咖啡",
        primaryType: "cafe",
        types: ["cafe", "coffee_shop"],
        rating: 4.7,
        userRatingCount: 1000,
      }),
    },
  ]);
  assert.equal(assigned.evidenceCode, "popularity");
  assert.match(assigned.reason, /咖啡.*評價與討論度|評價與討論度.*咖啡/);
  assert.equal(assigned.reason.includes("4.7"), false);
  assert.equal(assigned.reason.includes("1000"), false);
});

test("rating-only and review-count-only become conservative verified reasons", () => {
  const assigned = assignDiversePlaceReasons([
    { place: stubPlace({ id: "rating-only", rating: 4.8, userRatingCount: 10 }) },
    { place: stubPlace({ id: "reviews-only", rating: 3.8, userRatingCount: 1000 }) },
  ]);
  assert.deepEqual(
    assigned.map((row) => row.evidenceCode),
    ["high_rating", "high_review_count"],
  );
  assert.match(assigned[0].reason, /Google 評分 4\.8.*評分表現不錯/);
  assert.match(assigned[1].reason, /1000 則 Google 評論.*使用者回饋較多/);
});

test("recommendation handoff reason is canonical for Chat, Home, and Explore detail", () => {
  const reason = "營業至 21:00，時間比較彈性。";
  const handoff = {
    placeId: "ChIJcanonical",
    name: "Canonical Cafe",
    address: "台南市",
    lat: 22.99,
    lng: 120.2,
    reason,
    snapshot: { ...stubPlace({ id: "ChIJcanonical", name: "Canonical Cafe" }), reason },
  };
  assert.equal(hasCanonicalPlaceDetailReason(handoff), true);
  assert.equal(resolvePlaceDetailReason(handoff, "zh-TW", handoff.snapshot), reason);

  const routeSource = readFileSync(
    new URL("../src/routes/_app.place.tsx", import.meta.url),
    "utf8",
  );
  assert.match(routeSource, /if \(hasCanonicalReasonRef\.current\) return;/);
});

test("direct detail without recommendation context still builds a grounded fallback", () => {
  const handoff = {
    placeId: "ChIJdirect",
    name: "Direct Cafe",
    address: "台南市",
    lat: 22.99,
    lng: 120.2,
    category: "cafe",
  };
  const reason = resolvePlaceDetailReason(handoff);
  assert.equal(hasCanonicalPlaceDetailReason(handoff), false);
  assert.ok(reason.trim().length > 0);
  assert.equal(reason.includes("類型符合"), false);
  for (const unsupported of ["安靜", "插座", "招牌", "景觀很好", "人少", "適合拍照"]) {
    assert.equal(reason.includes(unsupported), false);
  }
});

test("open_now evidence conflict uses second-rank evidence for later places", () => {
  const places = [1, 2, 3, 4, 5].map((n) =>
    stubPlace({
      id: `open-clash-${n}`,
      name: `營業中咖啡 ${n}`,
      openStatus: "open",
      openNow: true,
    }),
  );
  const assigned = assignDiversePlaceReasons(places.map((place) => ({ place })));
  const codes = assigned.map((row) => row.evidenceCode);
  assert.equal(codes[0], "open_now");
  assert.ok(codes.every((code) => code === "open_now"));
  assert.ok(codes.every((code) => code !== "grounded_neutral"));
  assert.deepEqual(
    assigned.map((row) => row.placeId),
    places.map((p) => p.id),
  );
});

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

test("user GPS proximity does not promise walking without route evidence", () => {
  const place = stubPlace({ id: "gps-near", name: "GPS 附近咖啡" });
  const [assigned] = assignDiversePlaceReasons([
    { place, context: { distanceMeters: 300, distanceSource: "USER_LOCATION" } },
  ]);
  assert.equal(assigned.evidenceCode, "nearby");
  assert.match(assigned.reason, /距離你很近/);
  assert.equal(/步行就能到|步行路線/.test(assigned.reason), false);
});

test("place-specific evidence always outranks nearby", () => {
  const cases = [
    ["high-rating-near", { rating: 4.8, userRatingCount: 20 }, "high_rating"],
    ["high-reviews-near", { rating: 4.0, userRatingCount: 500 }, "high_review_count"],
    [
      "late-near",
      { todayHoursLabel: "10:00–23:30", openUntilTime: "23:30" },
      "late_hours",
    ],
    [
      "quiet-near",
      { primaryType: "cafe", types: ["cafe"], reasonClaimEvidence: ["quiet_ambience"] },
      "coffee_quiet_ambience",
    ],
  ];
  for (const [id, fields, expected] of cases) {
    const place = stubPlace({ id, name: id, ...fields });
    const [assigned] = assignDiversePlaceReasons([
      { place, context: { distanceMeters: 200, distanceSource: "USER_LOCATION" } },
    ]);
    assert.equal(assigned.evidenceCode, expected, id);
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

test("verified alongRoute evidence may use route_fit", () => {
  const place = stubPlace({ id: "real-route", name: "沿線咖啡" });
  const [assigned] = assignDiversePlaceReasons([
    { place, context: { distanceMeters: 2000, alongRoute: true } },
  ]);
  assert.equal(assigned.evidenceCode, "route_fit");
  assert.match(assigned.reason, /確認的行程動線/);
});

test("category match is only a neutral last fallback", () => {
  const place = stubPlace({ id: "direct-neutral", name: "資料有限咖啡" });
  const reason = buildPlaceRecommendationReason(place, null, null, undefined, {
    categoryIntent: "cafe",
  });
  assert.doesNotMatch(reason, /^先依地點資料提供你參考/);
  const [assigned] = assignDiversePlaceReasons([{ place, context: { categoryIntent: "cafe" } }]);
  assert.equal(assigned.evidenceCode, "category_match");
  assert.equal(assigned.reason.includes("咖啡需求"), false);
  assert.match(assigned.reason, /依地點資料提供你參考/);
});

test("single recommendation card uses factual evidence priority", () => {
  const place = CAFE_BATCH[0];
  const context = { distanceMeters: 2000 };
  const batch = buildDiversePlaceRecommendationReasons([{ place, context }]);
  assert.equal(batch.length, 1);
  assert.match(batch[0], /Google 評分/);
  assert.equal(batch[0].includes("咖啡廳選擇"), false);
});

test("grounded coffee claims outrank category and generic mood", () => {
  const quiet = stubPlace({
    id: "coffee-quiet-evidence",
    name: "安靜資料咖啡",
    reasonClaimEvidence: ["quiet_ambience"],
  });
  const dwell = stubPlace({
    id: "coffee-dwell-evidence",
    name: "久坐資料咖啡",
    reasonClaimEvidence: ["seating_dwell"],
  });
  const assigned = assignDiversePlaceReasons(
    [quiet, dwell].map((place) => ({
      place,
      context: {
        categoryIntent: "cafe",
        mood: "想放鬆",
        preferenceEvidenceSource: "EXPLICIT_USER",
      },
    })),
  );
  assert.deepEqual(assigned.map((row) => row.evidenceCode), [
    "coffee_quiet_ambience",
    "coffee_seating_dwell",
  ]);
  assert.match(assigned[0].reason, /環境較安靜/);
  assert.match(assigned[1].reason, /停留久坐/);
  assert.ok(assigned.every((row) => !/呼應你|類型符合/.test(row.reason)));
});

test("generic mood never becomes a card primary reason", () => {
  const place = stubPlace({ id: "mood-not-primary", name: "心情咖啡" });
  const [assigned] = assignDiversePlaceReasons([{
    place,
    context: { mood: "想放空", preferenceEvidenceSource: "EXPLICIT_USER" },
  }]);
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

test("Home/Explore batch cards keep order and attach diverse reasons", () => {
  const cards = buildUnifiedPlaceCards(
    CAFE_BATCH.map((place) => ({
      place: {
        ...place,
        lat: 25.033,
        lng: 121.565,
      },
      userLocation: { lat: 25.033, lng: 121.565 },
    })),
  );
  assert.deepEqual(
    cards.map((card) => card.id),
    CAFE_BATCH.map((p) => p.id),
  );
  const uniqueReasons = new Set(cards.map((card) => card.reason));
  assert.ok(uniqueReasons.size >= 3, "available contextual evidence should remain diverse");
  assert.ok(cards.every((card) => card.reason.trim().length > 0));
});

test("Chat batch mapper keeps order and attaches diverse reasons", () => {
  const items = mapPlaceResultsToChatItems(
    CAFE_BATCH.map((place) => ({
      place,
      ctx: {
        locale: "zh-TW",
        distanceMeters: CAFE_DISTANCES[place.id],
        distanceSource: "USER_LOCATION",
        categoryIntent: "cafe",
      },
    })),
  );
  assert.deepEqual(
    items.map((item) => item.placeId),
    CAFE_BATCH.map((p) => p.id),
  );
  const uniqueReasons = new Set(items.map((item) => item.reason));
  assert.ok(uniqueReasons.size >= 3, "reason diversity must not invent unsupported evidence");
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
    { onboarded: true, interests: ["咖啡"], pace: "slow", vibe: "quiet", budgetMode: "budget", avoid: ["crowds"] },
    { hasPlusAccess: true },
  );
  const evidence = collectPlaceReasonEvidence(cafe, {}, { userProfile: profile });
  assert.ok(evidence.some((item) => item.code === "preference_fit_interest" && item.preferenceField === "interests"));
  assert.ok(evidence.some((item) => item.code === "preference_fit_pace" && item.mappingContract === "slow_pace_identity_v1"));
  assert.ok(evidence.some((item) => item.code === "preference_fit_vibe"));
  assert.equal(evidence.some((item) => item.preferenceField === "budgetMode"), false);
  assert.equal(evidence.some((item) => item.preferenceField === "avoid"), false);
});

test("slow pace and quiet vibe render compatibility, not unsupported place facts", () => {
  const place = stubPlace({ id: "profile-safe-copy", primaryType: "cafe", types: ["cafe"] });
  const profile = userProfileForReasonFrom(
    { onboarded: true, pace: "slow", vibe: "quiet" },
    { hasPlusAccess: true },
  );
  const assigned = assignDiversePlaceReasons([{ place }], { userProfile: profile });
  assert.match(assigned[0].reason, /這類型地點較符合你偏好的(?:慢步調安排|安靜行程方向)/);
  assert.doesNotMatch(assigned[0].reason, /這裡很安靜|適合久坐|人少|價格親民|便宜/);
});

test("Free and incomplete profiles fail selector defense-in-depth", () => {
  const place = stubPlace({ id: "tier-defense", primaryType: "cafe", types: ["cafe"] });
  for (const userProfile of [
    { profileTier: "free", onboarded: true, interests: ["咖啡"] },
    { profileTier: "plus", onboarded: false, interests: ["咖啡"] },
    { onboarded: true, interests: ["咖啡"] },
  ]) {
    const evidence = collectPlaceReasonEvidence(place, {}, { userProfile });
    assert.equal(evidence.some((item) => item.code.startsWith("preference_fit_")), false);
  }
});

test("AI personality claim validator rejects unsupported facts and accepts verified claims", () => {
  const place = stubPlace({ id: "claim-validator" });
  assert.deepEqual(validateAiPersonalityClaims("這裡很安靜，適合休息。", place), { valid: false, rejectedClaim: "quiet" });
  assert.deepEqual(validateAiPersonalityClaims("這裡價格親民。", place), { valid: false, rejectedClaim: "price" });
  assert.deepEqual(validateAiPersonalityClaims("這裡很安靜。", { ...place, reasonClaimEvidence: ["quiet_ambience"] }), { valid: true, rejectedClaim: "" });
});

test("unsupported AI factual reason falls back to V2 evidence reason", () => {
  const sourcePlace = stubPlace({ id: "ai-unsafe", name: "AI Unsafe", rating: 4.8 });
  const candidate = {
    name: sourcePlace.name, placeName: sourcePlace.name, type: "咖啡", description: "",
    reason: "", estimatedTime: "1 小時", address: sourcePlace.address, lat: sourcePlace.lat,
    lng: sourcePlace.lng, googleMapsUrl: "", reasonSource: "template", googlePlaceId: sourcePlace.id,
    rating: sourcePlace.rating, userRatingCount: sourcePlace.userRatingCount, photoName: null,
    primaryType: sourcePlace.primaryType, categoryId: "coffee", sourcePlace,
  };
  const merged = mergeAiWithVerifiedCandidates(
    { title: "", summary: "", moodTag: "", recommendations: [{ ...candidate, reason: "這裡很安靜。", reasonSource: "ai" }], itinerary: [] },
    [candidate], { minCount: 1, maxCount: 1, profileTier: "plus", profileOnboarded: true },
  );
  assert.equal(merged.recommendations[0].reasonSource, "evidence");
  assert.doesNotMatch(merged.recommendations[0].reason, /這裡很安靜/);
});

test("logout and auth transitions invalidate personalized chat caches", () => {
  const source = readFileSync(new URL("../src/lib/clear-auth-state.ts", import.meta.url), "utf8");
  const provider = readFileSync(new URL("../src/providers/AppProviders.tsx", import.meta.url), "utf8");
  const access = readFileSync(new URL("../src/hooks/use-access.tsx", import.meta.url), "utf8");
  assert.match(source, /roamie:chat-planning/);
  assert.match(source, /roamie:chat-ui-cache/);
  assert.match(source, /clearPersonalizedChatCaches\(\)/);
  assert.match(provider, /prev && userId && prev !== userId[\s\S]*clearPersonalizedChatCaches\(\)/);
  assert.match(access, /previous !== tier[\s\S]*clearPersonalizedChatCaches\(\)/);
});

test("reason telemetry exposes Plus provenance and cache/AI validation fields", () => {
  const sources = [
    readFileSync(new URL("../src/lib/place-reason-diversity.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/lib/recommendation/merge-verified.server.ts", import.meta.url), "utf8"),
  ].join("\n");
  for (const field of ["profileTier", "profileOnboarded", "preferenceEvidenceSource", "preferenceField", "personalityTypeUsed", "personalitySummaryUsed", "aiReasonValidated", "aiReasonRejectedClaim", "restoredFromCache"]) {
    assert.match(sources, new RegExp(field));
  }
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
    collectPlaceReasonEvidence(cafe, {}, { userProfile: freeProfile }).some(
      (item) => item.code.startsWith("preference_fit_"),
    ),
    false,
  );
  assert.equal(
    collectPlaceReasonEvidence(cafe, {}, { userProfile: incompleteProfile }).some(
      (item) => item.code.startsWith("preference_fit_"),
    ),
    false,
  );
  assert.equal(
    collectPlaceReasonEvidence(clothing, {}, { userProfile: plusProfile }).some(
      (item) => item.code.startsWith("preference_fit_"),
    ),
    false,
  );
  assert.equal(
    collectPlaceReasonEvidence(cafe, {}, { userProfile: plusProfile }).some(
      (item) => item.code.startsWith("preference_fit_"),
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

test("recognized park, museum, and attraction identities do not use safe fallback", () => {
  for (const primaryType of ["park", "museum", "tourist_attraction"]) {
    const reason = buildPlaceRecommendationReason(
      stubPlace({
        id: `identity-${primaryType}`,
        name: `正常 ${primaryType}`,
        primaryType,
        types: [primaryType],
      }),
      null,
    );
    assert.doesNotMatch(reason, /^先依地點資料提供你參考/);
  }
});

test("evidence-empty generic and unsupported places retain safe fallback", () => {
  for (const place of [
    stubPlace({
      id: "generic-empty",
      name: "未分類地點",
      primaryType: "point_of_interest",
      types: ["point_of_interest", "establishment"],
    }),
    stubPlace({
      id: "unsupported-empty",
      name: "一般辦公室",
      primaryType: "office",
      types: ["office"],
    }),
  ]) {
    const reason = buildPlaceRecommendationReason(place, null);
    assert.match(reason, /^先依地點資料提供你參考/);
  }
});

test("four popularity-only places all retain verified evidence", () => {
  const assigned = assignDiversePlaceReasons(
    [1, 2, 3, 4].map((n) => ({
      place: stubPlace({
        id: `popular-${n}`,
        name: `人氣地點 ${n}`,
        rating: 4.7,
        userRatingCount: 500,
      }),
    })),
  );
  assert.ok(assigned.every((row) => row.evidenceCode !== "grounded_neutral"));
  assert.ok(assigned.every((row) => row.availableCodes.includes("popularity")));
});

test("AI blank reason and supplemented candidates receive evidence fallback", () => {
  const candidates = [1, 2].map((n) => {
    const sourcePlace = stubPlace({
      id: `ai-candidate-${n}`,
      name: `AI 候選 ${n}`,
      rating: 4.8,
      userRatingCount: 40,
    });
    return {
      name: sourcePlace.name,
      placeName: sourcePlace.name,
      type: "咖啡",
      description: "",
      reason: "",
      estimatedTime: "1 小時",
      address: sourcePlace.address,
      lat: sourcePlace.lat,
      lng: sourcePlace.lng,
      googleMapsUrl: "",
      reasonSource: "template",
      googlePlaceId: sourcePlace.id,
      rating: sourcePlace.rating,
      userRatingCount: sourcePlace.userRatingCount,
      photoName: null,
      primaryType: sourcePlace.primaryType,
      categoryId: "coffee",
      sourcePlace,
    };
  });
  const merged = mergeAiWithVerifiedCandidates(
    {
      title: "",
      summary: "",
      moodTag: "",
      recommendations: [{ ...candidates[0], reason: "   ", reasonSource: "ai" }],
      itinerary: [],
    },
    candidates,
    { minCount: 2, maxCount: 2 },
  );
  assert.equal(merged.recommendations.length, 2);
  assert.ok(merged.recommendations.every((item) => item.reason.trim().length > 0));
  assert.ok(merged.recommendations.every((item) => item.reasonSource === "evidence"));
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

console.info("\n[verify:place-reason-diversity] all passed");
