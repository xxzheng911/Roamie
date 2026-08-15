#!/usr/bin/env node
/**
 * Place Intelligence Phase 2A — Recommendation Reason Diversity
 * 執行：npx vite-node --config scripts/vite.verify.config.mjs scripts/verify-place-reason-diversity.mjs
 */
import assert from "node:assert/strict";
import { buildPlaceRecommendationReason } from "../src/lib/build-place-recommendation-reason.ts";
import {
  FORBIDDEN_REASON_INFERENCES,
  assignDiversePlaceReasons,
  buildDiversePlaceRecommendationReasons,
} from "../src/lib/place-reason-diversity.ts";
import { mapPlaceResultsToChatItems } from "../src/lib/chat-session.ts";
import { buildUnifiedPlaceCards } from "../src/lib/unified-place-card.ts";

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
    context: { distanceMeters: distances[place.id] },
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
    "nearby",
    "late_hours",
    "route_fit",
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
  const assigned = assignDiversePlaceReasons(
    toItems(ATTRACTION_BATCH, ATTRACTION_DISTANCES),
  );
  assert.equal(assigned.length, 5);
  assert.deepEqual(
    assigned.map((row) => row.placeId),
    ATTRACTION_BATCH.map((p) => p.id),
  );
  const codes = assigned.map((row) => row.evidenceCode);
  assert.deepEqual(codes, [
    "high_rating",
    "high_review_count",
    "nearby",
    "late_hours",
    "route_fit",
  ]);
  assert.equal(new Set(codes).size, 5);
});

test("rating evidence conflict uses second-rank evidence for later places", () => {
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
  assert.notEqual(codes[1], "high_rating");
  assert.equal(new Set(codes.slice(0, 3)).size, 3);
  assert.ok(codes.filter((code) => code === "high_rating").length < 5);
  assert.deepEqual(
    assigned.map((row) => row.placeId),
    places.map((p) => p.id),
  );
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
  assert.equal(codes[1], "category_identity");
  assert.ok(codes.filter((code) => code === "open_now").length < 5);
  assert.deepEqual(
    assigned.map((row) => row.placeId),
    places.map((p) => p.id),
  );
});

test("insufficient evidence falls back to category_identity without dropping places", () => {
  const places = [1, 2, 3].map((n) =>
    stubPlace({
      id: `sparse-${n}`,
      name: `資料少咖啡 ${n}`,
    }),
  );
  const assigned = assignDiversePlaceReasons(places.map((place) => ({ place })));
  assert.equal(assigned.length, 3);
  assert.ok(assigned.every((row) => row.evidenceCode === "category_identity"));
  assert.ok(assigned.every((row) => row.reason.includes("咖啡")));
  assert.deepEqual(
    assigned.map((row) => row.placeId),
    places.map((p) => p.id),
  );
});

test("single place skips batch diversity and matches buildPlaceRecommendationReason", () => {
  const place = CAFE_BATCH[0];
  const context = { distanceMeters: 2000 };
  const batch = buildDiversePlaceRecommendationReasons([{ place, context }]);
  const single = buildPlaceRecommendationReason(
    place,
    null,
    null,
    undefined,
    context,
  );
  assert.equal(batch.length, 1);
  assert.equal(batch[0], single);
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
  assert.equal(uniqueReasons.size, cards.length);
});

test("Chat batch mapper keeps order and attaches diverse reasons", () => {
  const items = mapPlaceResultsToChatItems(
    CAFE_BATCH.map((place) => ({
      place,
      ctx: {
        locale: "zh-TW",
        distanceMeters: CAFE_DISTANCES[place.id],
        categoryIntent: "cafe",
      },
    })),
  );
  assert.deepEqual(
    items.map((item) => item.placeId),
    CAFE_BATCH.map((p) => p.id),
  );
  const uniqueReasons = new Set(items.map((item) => item.reason));
  assert.equal(uniqueReasons.size, items.length);
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
  const reasons = buildDiversePlaceRecommendationReasons([
    { place },
    { place: sibling },
  ]);
  assert.equal(reasons.length, 2);
  assert.ok(reasons.every((reason) => typeof reason === "string" && reason.trim()));
});

console.info("\n[verify:place-reason-diversity] all passed");
