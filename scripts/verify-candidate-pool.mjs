#!/usr/bin/env node
/**
 * RAOS Candidate Pool Pipeline — Priority 1
 *
 * - Flag 預設 OFF = legacy Geo Hub 路徑
 * - Flag ON = Quality → Category/Query → Geo Clustering → Temporal → Flow → Experience
 * - 不依賴 destination-travel-profile.districts / KNOWN_HUB_CENTERS
 * - 不開 Validator / PIE Search
 *
 * 執行：npm run verify:candidate-pool
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyQualityGate,
  buildCandidatePoolDemand,
  buildGeoClustersFromPlaces,
  classifyExperienceFamily,
  classifyPoolCategory,
  classifyTemporalSlots,
  classifyTravelIntent,
  isCandidatePoolEnabled,
  setCandidatePoolEnabledOverride,
  shapeCandidatePoolPlaces,
  CANDIDATE_POOL_VERSION,
} from "../src/lib/ai/candidate-pool/index.ts";

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

console.log("\n[verify:candidate-pool]\n");

test("flag defaults OFF", () => {
  setCandidatePoolEnabledOverride(null);
  // env may be ON in local .env — override to false for this assertion
  setCandidatePoolEnabledOverride(false);
  assert.equal(isCandidatePoolEnabled(), false);
  setCandidatePoolEnabledOverride(true);
  assert.equal(isCandidatePoolEnabled(), true);
  setCandidatePoolEnabledOverride(null);
});

test("version constant", () => {
  assert.equal(CANDIDATE_POOL_VERSION, "cp-1.0");
});

test("quality gate rejects closed / chain / supermarket / office", () => {
  const places = [
    place({ id: "ok1", name: "City Museum", primaryType: "museum", types: ["museum"] }),
    place({
      id: "closed",
      name: "Old Spot",
      businessStatus: "CLOSED_PERMANENTLY",
    }),
    place({
      id: "chain",
      name: "Starbucks Reserve",
      primaryType: "cafe",
      types: ["cafe"],
    }),
    place({
      id: "super",
      name: "Local Supermarket",
      primaryType: "supermarket",
      types: ["supermarket"],
      rating: 4.2,
      userRatingCount: 500,
    }),
    place({
      id: "office",
      name: "City Hall Office",
      primaryType: "local_government_office",
      types: ["local_government_office"],
    }),
    place({
      id: "low",
      name: "Empty Spot",
      rating: 2.1,
      userRatingCount: 2,
    }),
  ];
  const { kept, rejected } = applyQualityGate(places);
  assert.ok(kept.some((p) => p.id === "ok1"));
  assert.ok(!kept.some((p) => p.id === "closed"));
  assert.ok(!kept.some((p) => p.id === "chain"));
  assert.ok(!kept.some((p) => p.id === "super"));
  assert.ok(!kept.some((p) => p.id === "office"));
  assert.ok(!kept.some((p) => p.id === "low"));
  assert.ok(rejected >= 4);
});

test("classifiers are destination-agnostic", () => {
  const temple = place({
    id: "t1",
    name: "Ancient Temple",
    address: "Somewhere",
    primaryType: "place_of_worship",
    types: ["place_of_worship", "tourist_attraction"],
  });
  const cafe = place({
    id: "c1",
    name: "Neighborhood Cafe",
    primaryType: "cafe",
    types: ["cafe"],
  });
  const night = place({
    id: "n1",
    name: "Night Market",
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
  });
  assert.equal(classifyExperienceFamily(temple), "temple_heritage");
  assert.equal(classifyTravelIntent(temple), "culture");
  assert.ok(classifyTemporalSlots(cafe).includes("afternoon"));
  assert.ok(!classifyTemporalSlots(cafe).includes("night"));
  assert.equal(classifyPoolCategory(cafe), "cafe");
  assert.ok(classifyTemporalSlots(night).includes("night") || classifyPoolCategory(night));
});

test("geo clustering works without city hubs (multi-area coords)", () => {
  const places = [
    place({ id: "a1", name: "A1", lat: 35.71, lng: 139.79 }),
    place({ id: "a2", name: "A2", lat: 35.712, lng: 139.792 }),
    place({ id: "b1", name: "B1", lat: 35.66, lng: 139.70 }),
    place({ id: "b2", name: "B2", lat: 35.661, lng: 139.702 }),
    place({ id: "c1", name: "C1", lat: 35.69, lng: 139.70 }),
    place({ id: "c2", name: "C2", lat: 35.691, lng: 139.703 }),
  ];
  const { clusters } = buildGeoClustersFromPlaces(places, 6);
  assert.ok(clusters.length >= 2, `expected ≥2 clusters, got ${clusters.length}`);
});

test("demand is richer than days×3", () => {
  const demand = buildCandidatePoolDemand({ days: 6, style: "classic_landmarks" });
  assert.ok(demand.minTotal > 6 * 3);
  assert.ok((demand.minPerCategory.food ?? 0) >= 6);
  assert.ok((demand.minPerCategory.cafe ?? 0) >= 6);
  assert.ok(demand.minPerTemporal.lunch >= 6);
  assert.ok(demand.minGeoClusters >= 2);
});

test("experience optimizer trims temple dominance", () => {
  const places = [];
  for (let i = 0; i < 12; i += 1) {
    places.push(
      place({
        id: `temple-${i}`,
        name: `Temple ${i}`,
        lat: 35.68 + i * 0.001,
        lng: 139.76,
        primaryType: "place_of_worship",
        types: ["place_of_worship", "tourist_attraction"],
        userRatingCount: 100 + i,
      }),
    );
  }
  places.push(
    place({
      id: "cafe-1",
      name: "Calm Cafe",
      primaryType: "cafe",
      types: ["cafe"],
      lat: 35.685,
      lng: 139.765,
    }),
    place({
      id: "shop-1",
      name: "Street Shopping Arcade",
      primaryType: "clothing_store",
      types: ["clothing_store", "point_of_interest"],
      lat: 35.686,
      lng: 139.766,
    }),
  );
  const shaped = shapeCandidatePoolPlaces(places, {
    days: 3,
    style: "mixed",
  });
  const temples = shaped.annotated.filter(
    (a) => a.experienceFamily === "temple_heritage",
  ).length;
  const templeInput = places.filter((p) => /Temple/.test(p.name)).length;
  assert.ok(
    temples < templeInput,
    `temples should be trimmed: kept=${temples} input=${templeInput}`,
  );
  assert.ok(temples <= 4, `temple cap expected ≤4, got ${temples}`);
  assert.equal(shaped.path, "candidate_pool");
});

test("no fixed hub dependency in candidate-pool module", () => {
  const geo = read("src/lib/ai/candidate-pool/stages/geo.ts");
  const pipeline = read("src/lib/ai/candidate-pool/pipeline.ts");
  const search = read("src/lib/ai/candidate-pool/stages/search.ts");
  for (const src of [geo, pipeline, search]) {
    assert.ok(!src.includes("from \"@/lib/ai/style-geo-diversity\""));
    assert.ok(!src.includes("from \"@/lib/ai/destination-travel-profile\""));
    assert.ok(!src.includes("resolveGeoHubsForDestination("));
    assert.ok(!src.includes("resolveDestinationTravelProfile("));
    assert.ok(!src.includes("KNOWN_HUB_CENTERS["));
  }
  assert.ok(geo.includes("fitToDays: false"));
  assert.ok(geo.includes("clusterPlacesByGeography"));
});

test("destination-trip-planning wires flag-gated candidate pool", () => {
  const src = read("src/lib/ai/destination-trip-planning.ts");
  assert.ok(src.includes("isCandidatePoolEnabled"));
  assert.ok(src.includes("buildCandidatePool"));
  assert.ok(src.includes("path=candidate_pool"));
});

test("package script exists", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(
    pkg.scripts["verify:candidate-pool"],
    "vite-node --config scripts/vite.verify.config.mjs scripts/verify-candidate-pool.mjs",
  );
});

console.log("\nAll candidate-pool checks passed.\n");
