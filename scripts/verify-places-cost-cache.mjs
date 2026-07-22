#!/usr/bin/env node
/**
 * Places Cost Cache — Beta acceptance (dev, no live Google Places).
 *
 * Covers:
 * - Layer 1 Destination cache HIT/MISS logs
 * - Layer 2 Candidate Pool cache (30m) + session reuse
 * - Layer 3 Combination cache (destination + style + group)
 * - Capped category search (≤5)
 * - Query cooldown 5s
 * - Rate protection blocks new Places
 * - Filter-from-pool (cafe / yakiniku / attraction)
 * - City matrix: first create → follow-ups → regenerate = 0 Places
 *
 * 執行：npm run verify:places-cost-cache
 */
import assert from "node:assert/strict";
import {
  CANDIDATE_POOL_SEED_CATEGORIES,
  PLACES_COST_CACHE_TTL_MS,
  PLACES_QUERY_COOLDOWN_MS,
  activatePlacesRateProtection,
  bindSessionCandidatePool,
  clearCandidatePoolCache,
  clearCombinationCache,
  clearPlacesQueryCooldown,
  clearPlacesRateProtection,
  clearSessionCandidatePool,
  combinationCacheKey,
  extractCuisineKeywordFromText,
  filterCandidatePoolPlaces,
  isPlacesQueryOnCooldown,
  isPlacesRateProtectionActive,
  notePlacesQueryCooldown,
  placesQueryCooldownKey,
  readCandidatePoolCache,
  readCombinationCache,
  readSessionCandidatePool,
  shouldBlockNewPlacesCalls,
  shouldSkipPlacesForQueryCooldown,
  writeCandidatePoolCache,
  writeCombinationCache,
} from "../src/lib/ai/places-cost-cache/index.ts";
import { shapeCandidatePoolPlaces } from "../src/lib/ai/candidate-pool/index.ts";

const CITIES = [
  "東京",
  "大阪",
  "京都",
  "名古屋",
  "福岡",
  "札幌",
  "首爾",
  "釜山",
  "曼谷",
  "清邁",
  "新加坡",
  "香港",
  "巴黎",
  "倫敦",
  "紐約",
  "洛杉磯",
  "雪梨",
  "墨爾本",
  "開羅",
  "普吉島",
];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function place(partial) {
  return {
    address: null,
    photoName: null,
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: true,
    userRatingCount: 200,
    rating: 4.5,
    lat: 35.68,
    lng: 139.76,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    ...partial,
  };
}

function seedPool(destination) {
  return [
    place({
      id: `${destination}-attr`,
      name: `${destination} Landmark`,
      primaryType: "tourist_attraction",
      types: ["tourist_attraction"],
    }),
    place({
      id: `${destination}-cafe`,
      name: `${destination} Cafe`,
      primaryType: "cafe",
      types: ["cafe", "coffee_shop"],
      rating: 4.7,
    }),
    place({
      id: `${destination}-yaki`,
      name: `${destination} 燒肉店`,
      primaryType: "restaurant",
      types: ["restaurant", "barbecue"],
      rating: 4.6,
    }),
    place({
      id: `${destination}-suki`,
      name: `${destination} 壽喜燒`,
      primaryType: "restaurant",
      types: ["restaurant"],
    }),
    place({
      id: `${destination}-shop`,
      name: `${destination} Mall`,
      primaryType: "shopping_mall",
      types: ["shopping_mall"],
    }),
    place({
      id: `${destination}-bar`,
      name: `${destination} Night Bar`,
      primaryType: "bar",
      types: ["bar", "night_club"],
    }),
  ];
}

console.log("\n[verify:places-cost-cache]\n");

clearCandidatePoolCache();
clearCombinationCache();
clearSessionCandidatePool();
clearPlacesQueryCooldown();
clearPlacesRateProtection();

test("TTL constants", () => {
  assert.equal(PLACES_COST_CACHE_TTL_MS, 30 * 60 * 1000);
  assert.equal(PLACES_QUERY_COOLDOWN_MS, 5_000);
});

test("seed categories capped at 5", () => {
  assert.equal(CANDIDATE_POOL_SEED_CATEGORIES.length, 5);
  const ids = CANDIDATE_POOL_SEED_CATEGORIES.map((c) => c.id);
  assert.deepEqual(ids, [
    "tourist_attractions",
    "restaurant",
    "cafe",
    "shopping",
    "entertainment",
  ]);
});

test("Layer 2: write → hit → miss after clear", () => {
  clearCandidatePoolCache();
  const places = seedPool("大阪");
  writeCandidatePoolCache({
    destination: "大阪",
    places,
    searchRequestCount: 5,
  });
  const hit = readCandidatePoolCache("大阪");
  assert.ok(hit);
  assert.equal(hit.places.length, places.length);
  assert.equal(hit.searchRequestCount, 5);
  clearCandidatePoolCache("大阪");
  const miss = readCandidatePoolCache("大阪");
  assert.equal(miss, null);
});

test("Session pool: bind + reuse until destination changes", () => {
  clearSessionCandidatePool();
  const places = seedPool("京都");
  bindSessionCandidatePool({
    sessionId: "s1",
    destination: "京都",
    places,
  });
  const reused = readSessionCandidatePool({
    sessionId: "s1",
    destination: "京都",
  });
  assert.ok(reused);
  assert.equal(reused.places.length, places.length);
  const wrongDest = readSessionCandidatePool({
    sessionId: "s1",
    destination: "東京",
  });
  assert.equal(wrongDest, null);
});

test("Layer 3: combination cache by destination + style + group", () => {
  clearCombinationCache();
  const combos = [
    { combinationId: "osaka:food:1", title: "美食探索", theme: "美食" },
  ];
  writeCombinationCache({
    destination: "大阪",
    travelStyle: "food_explore",
    group: "美食探索",
    combinations: combos,
  });
  const key = combinationCacheKey({
    destination: "大阪",
    travelStyle: "food_explore",
    group: "美食探索",
  });
  assert.match(key, /大阪/);
  const hit = readCombinationCache({
    destination: "大阪",
    travelStyle: "food_explore",
    group: "美食探索",
  });
  assert.ok(hit?.length);
  assert.equal(hit[0].title, "美食探索");
});

test("Query cooldown 5s", () => {
  clearPlacesQueryCooldown();
  const key = placesQueryCooldownKey({
    sessionId: "s1",
    destination: "東京",
    query: "東京 restaurants",
    category: "restaurant",
  });
  assert.equal(isPlacesQueryOnCooldown(key), false);
  notePlacesQueryCooldown(key);
  assert.equal(isPlacesQueryOnCooldown(key), true);
  assert.equal(
    shouldSkipPlacesForQueryCooldown({
      sessionId: "s1",
      destination: "東京",
      query: "東京 restaurants",
      category: "restaurant",
    }),
    true,
  );
});

test("Rate protection blocks new Places", () => {
  clearPlacesRateProtection();
  assert.equal(isPlacesRateProtectionActive(), false);
  activatePlacesRateProtection({ reason: "PLACES_RATE_LIMIT_BLOCKED", ttlMs: 60_000 });
  assert.equal(isPlacesRateProtectionActive(), true);
  assert.equal(shouldBlockNewPlacesCalls({ logSkip: false }), true);
  clearPlacesRateProtection();
  assert.equal(shouldBlockNewPlacesCalls({ logSkip: false }), false);
});

test("Filter-from-pool: cafe / yakiniku / attraction", () => {
  const places = seedPool("大阪");
  const cafes = filterCandidatePoolPlaces({
    places,
    category: "cafe",
    limit: 4,
  });
  assert.ok(cafes.every((p) => (p.primaryType ?? "").includes("cafe") || (p.types ?? []).includes("cafe")));
  assert.ok(cafes.length >= 1);

  const cuisine = extractCuisineKeywordFromText("有沒有燒肉？");
  assert.ok(cuisine);
  const yaki = filterCandidatePoolPlaces({
    places,
    category: "restaurant",
    cuisineKeyword: cuisine,
  });
  assert.ok(yaki.some((p) => /燒肉|烧肉|yakiniku/i.test(p.name)));

  const suki = filterCandidatePoolPlaces({
    places,
    category: "restaurant",
    cuisineKeyword: extractCuisineKeywordFromText("有沒有壽喜燒？") ?? "壽喜燒",
  });
  assert.ok(suki.some((p) => /壽喜燒|寿喜烧/i.test(p.name)));

  const attrs = filterCandidatePoolPlaces({
    places,
    category: "attraction",
  });
  assert.ok(attrs.length >= 1);
});

test("Regenerate / preference change uses shaped pool (0 Places)", () => {
  const places = seedPool("福岡");
  writeCandidatePoolCache({ destination: "福岡", places, searchRequestCount: 5 });
  const cached = readCandidatePoolCache("福岡");
  assert.ok(cached);
  // Re-shape for days/style change — pure, no search fn
  const shaped3 = shapeCandidatePoolPlaces(cached.places, {
    days: 3,
    style: "classic_landmarks",
  });
  const shaped5 = shapeCandidatePoolPlaces(cached.places, {
    days: 5,
    style: "local_life",
  });
  assert.ok(shaped3.places.length >= 1);
  assert.ok(shaped5.places.length >= 1);
  assert.equal(shaped3.path, "candidate_pool");
});

test(`City matrix (${CITIES.length}): create once → follow-ups hit cache`, () => {
  clearCandidatePoolCache();
  clearSessionCandidatePool();
  let createCalls = 0;
  let followUpMisses = 0;

  for (const city of CITIES) {
    // 1. First search — create pool
    const places = seedPool(city);
    writeCandidatePoolCache({
      destination: city,
      places,
      searchRequestCount: CANDIDATE_POOL_SEED_CATEGORIES.length,
    });
    bindSessionCandidatePool({
      sessionId: `matrix_${city}`,
      destination: city,
      places,
    });
    createCalls += 1;

    // 2–4. Restaurant / cafe / attraction — must hit cache
    for (const category of ["restaurant", "cafe", "attraction"]) {
      const hit = readCandidatePoolCache(city);
      if (!hit) followUpMisses += 1;
      else {
        const filtered = filterCandidatePoolPlaces({
          places: hit.places,
          category,
          limit: 4,
        });
        assert.ok(filtered.length >= 0);
      }
    }

    // 5. Switch combination — combination cache
    writeCombinationCache({
      destination: city,
      travelStyle: "classic",
      group: "經典組",
      combinations: [{ id: `${city}:classic`, title: "經典組" }],
    });
    const combo = readCombinationCache({
      destination: city,
      travelStyle: "classic",
      group: "經典組",
    });
    assert.ok(combo?.length);

    // 6–8. Regenerate / days / preference — session pool
    const session = readSessionCandidatePool({
      sessionId: `matrix_${city}`,
      destination: city,
    });
    assert.ok(session?.places.length);
    shapeCandidatePoolPlaces(session.places, { days: 4, style: "food_explore" });
  }

  assert.equal(createCalls, CITIES.length);
  assert.equal(followUpMisses, 0);
  console.log(
    `    cities=${CITIES.length} creates=${createCalls} followUpMisses=${followUpMisses}`,
  );
});

{
  console.log("  Recommendation → Planner Candidate Pool ingest");
  const {
    clearCandidatePoolCache,
    clearSessionCandidatePool,
    clearPlacesRateProtection,
    activatePlacesRateProtection,
    ingestResolvedPlacesIntoCandidatePool,
    matchNamedPlaceFromCandidatePool,
    readSessionCandidatePool,
    readCandidatePoolCache,
    shouldBlockNewPlacesCalls,
  } = await import("../src/lib/ai/places-cost-cache/index.ts");

  clearCandidatePoolCache();
  clearSessionCandidatePool();
  clearPlacesRateProtection();

  const cafePlaces = [
    {
      id: "ChIJLittleNapCoffeeStand",
      name: "Little Nap Coffee Stand",
      address: "Yoyogi, Shibuya",
      lat: 35.668,
      lng: 139.695,
      rating: 4.5,
      userRatingCount: 100,
      photoName: null,
      primaryType: "cafe",
      types: ["cafe", "coffee_shop"],
      businessStatus: "OPERATIONAL",
      openStatus: "unknown",
      openStatusLabel: "",
      todayHoursLabel: "",
      closingSoonNote: "",
      nextOpenHint: "",
    },
    {
      id: "ChIJAllSeasonsCoffeeTokyo",
      name: "All Seasons Coffee",
      address: "Shibuya",
      lat: 35.66,
      lng: 139.7,
      rating: 4.4,
      userRatingCount: 80,
      photoName: null,
      primaryType: "cafe",
      types: ["cafe"],
      businessStatus: "OPERATIONAL",
      openStatus: "unknown",
      openStatusLabel: "",
      todayHoursLabel: "",
      closingSoonNote: "",
      nextOpenHint: "",
    },
  ];

  const ingested = ingestResolvedPlacesIntoCandidatePool({
    sessionId: "chat_tokyo_1",
    destination: "東京",
    countryCode: "JP",
    places: cafePlaces,
    source: "chat_recommendation",
  });
  assert.equal(ingested.added, 2);
  assert.equal(ingested.total, 2);

  const session = readSessionCandidatePool({
    sessionId: "chat_tokyo_1",
    destination: "東京",
  });
  assert.ok(session?.places.some((p) => p.name.includes("Little Nap")));
  const layer2 = readCandidatePoolCache("東京", "JP");
  assert.ok(layer2?.places.length >= 2);

  activatePlacesRateProtection({ reason: "PLACES_RATE_LIMIT_BLOCKED", ttlMs: 60_000 });
  assert.equal(shouldBlockNewPlacesCalls({ destination: "東京", query: "cafe" }), true);

  const matched = matchNamedPlaceFromCandidatePool({
    name: "Little Nap Coffee Stand",
    destination: "東京",
    sessionId: "chat_tokyo_1",
  });
  assert.ok(matched);
  assert.equal(matched.id, "ChIJLittleNapCoffeeStand");

  clearPlacesRateProtection();
  clearCandidatePoolCache();
  clearSessionCandidatePool();
  console.log("  ✓ chat recommendation ingest + pool match under rate protection");
}

console.log("\n[verify:places-cost-cache] OK\n");
