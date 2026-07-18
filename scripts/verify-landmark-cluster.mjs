/**
 * Acceptance: generic main/sub landmark clustering + cross-day geographic grouping.
 * Must NOT be hard-coded to 饒河夜市 — validates multiple cities/countries.
 */
import assert from "node:assert/strict";
import { normalizeCorePlaceName } from "../src/lib/place-planning-memory.ts";
import {
  clusterAndDedupeLandmarks,
  resolveParentLandmark,
  validateLandmarkClusters,
} from "../src/lib/ai/landmark-cluster.ts";
import {
  clusterPlacesByGeography,
  validateCrossDayGeographicAllocation,
} from "../src/lib/ai/geographic-clustering.ts";
import { detectSubPlaceType } from "../src/lib/ai/landmark-keywords.ts";

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failures += 1;
  }
}

let seq = 0;
function place({ name, lat, lng, id, rating = 4.3, reviews = 500, types = ["tourist_attraction"], photo = "p", status = "OPERATIONAL" }) {
  seq += 1;
  return {
    id: id ?? `ChIJ_${seq}_${name}`,
    name,
    address: "台北市松山區八德路四段",
    lat,
    lng,
    rating,
    userRatingCount: reviews,
    photoName: photo,
    primaryType: types[0] ?? null,
    types,
    businessStatus: status,
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    regularOpeningHours: { periods: [] },
  };
}

console.log("=== verify-landmark-cluster ===\n");

check("normalizeCorePlaceName collapses main + sub landmark names", () => {
  assert.equal(normalizeCorePlaceName("饒河街觀光夜市"), normalizeCorePlaceName("饒河夜市牌樓"));
  assert.equal(normalizeCorePlaceName("台北101"), normalizeCorePlaceName("台北101觀景台"));
  assert.equal(normalizeCorePlaceName("大阪城"), normalizeCorePlaceName("大阪城天守閣"));
  assert.equal(normalizeCorePlaceName("大阪城"), normalizeCorePlaceName("大阪城公園入口"));
  assert.equal(normalizeCorePlaceName("清水寺"), normalizeCorePlaceName("清水寺仁王門"));
});

check("detectSubPlaceType flags附屬地標 keywords (multi-lang)", () => {
  assert.equal(detectSubPlaceType("饒河夜市牌樓"), "gate");
  assert.equal(detectSubPlaceType("大阪城公園入口"), "entrance");
  assert.equal(detectSubPlaceType("台北101觀景台"), "observation_deck");
  assert.equal(detectSubPlaceType("Raohe Night Market Arch"), "gate");
  assert.equal(detectSubPlaceType("경복궁 정문"), "gate");
  assert.equal(detectSubPlaceType("饒河街觀光夜市"), null);
  assert.equal(detectSubPlaceType("草悟道綠園道公共藝術"), "public_art");
});

check("resolveParentLandmark builds structured descriptor", () => {
  const lm = resolveParentLandmark(place({ name: "饒河夜市牌樓", lat: 25.0508, lng: 121.5774 }));
  assert.equal(lm.isSubPlace, true);
  assert.equal(lm.subPlaceType, "gate");
  assert.equal(lm.parentLandmarkKey, "饒河夜市");
});

check("饒河夜市: keeps main market, drops the牌樓 (~1 min walk)", () => {
  const main = place({ name: "饒河街觀光夜市", lat: 25.0508, lng: 121.5774, reviews: 90000 });
  const gate = place({ name: "饒河夜市牌樓", lat: 25.0505, lng: 121.5772, reviews: 800, types: ["point_of_interest"] });
  const { places, removed } = clusterAndDedupeLandmarks([main, gate]);
  assert.equal(places.length, 1);
  assert.equal(places[0].name, "饒河街觀光夜市");
  assert.equal(removed.length, 1);
  assert.equal(removed[0].reason, "sub_place_of_same_landmark");
});

check("草悟道: merges public-art sub-place within walking precinct", () => {
  const main = place({
    name: "草悟道",
    lat: 24.1477,
    lng: 120.6636,
    reviews: 20000,
  });
  // ~900m away (~12 min walk) — same precinct via contained-name + public_art
  const art = place({
    name: "草悟道綠園道公共藝術",
    lat: 24.1555,
    lng: 120.6638,
    reviews: 80,
    types: ["point_of_interest"],
  });
  assert.equal(detectSubPlaceType(art.name), "public_art");
  const { places, removed } = clusterAndDedupeLandmarks([main, art]);
  assert.equal(places.length, 1, `expected 1 place, got ${places.map((p) => p.name).join(",")}`);
  assert.equal(places[0].name, "草悟道");
  assert.equal(removed.length, 1);
  assert.equal(removed[0].reason, "sub_place_of_same_landmark");
});

check("大阪城: collapses 天守閣 + 公園入口 into the castle", () => {
  const castle = place({ name: "大阪城", lat: 34.6873, lng: 135.5259, reviews: 120000 });
  const keep = place({ name: "大阪城天守閣", lat: 34.6873, lng: 135.5262, reviews: 90000 });
  const entrance = place({ name: "大阪城公園入口", lat: 34.6866, lng: 135.5266, reviews: 300, types: ["point_of_interest"] });
  const { places } = clusterAndDedupeLandmarks([keep, entrance, castle]);
  assert.equal(places.length, 1);
  assert.equal(places[0].name, "大阪城");
});

check("台北101: keeps tower, drops觀景台", () => {
  const tower = place({ name: "台北101", lat: 25.0339, lng: 121.5645, reviews: 150000 });
  const deck = place({ name: "台北101觀景台", lat: 25.0339, lng: 121.5646, reviews: 40000 });
  const { places } = clusterAndDedupeLandmarks([deck, tower]);
  assert.equal(places.length, 1);
  assert.equal(places[0].name, "台北101");
});

check("distinct night markets are NOT merged", () => {
  const raohe = place({ name: "饒河街觀光夜市", lat: 25.0508, lng: 121.5774 });
  const ningxia = place({ name: "寧夏夜市", lat: 25.0565, lng: 121.5153 });
  const { places } = clusterAndDedupeLandmarks([raohe, ningxia]);
  assert.equal(places.length, 2);
});

check("same core name but far apart are NOT merged (proximity guard)", () => {
  const a = place({ name: "中山公園", lat: 25.05, lng: 121.52 });
  const b = place({ name: "中山公園", lat: 24.14, lng: 120.68, id: "ChIJ_taichung_zs" });
  const { places } = clusterAndDedupeLandmarks([a, b]);
  assert.equal(places.length, 2);
});

check("validateLandmarkClusters flags main + sub across different days", () => {
  const main = place({ name: "饒河街觀光夜市", lat: 25.0508, lng: 121.5774, reviews: 90000 });
  const gate = place({ name: "饒河夜市牌樓", lat: 25.0505, lng: 121.5772, reviews: 800, types: ["point_of_interest"] });
  const v = validateLandmarkClusters([
    { place: main, day: 1 },
    { place: gate, day: 2 },
  ]);
  assert.equal(v.ok, false);
  assert.equal(v.removePlaceIds.length, 1);
});

check("geographic clustering groups nearby places, separates far ones", () => {
  const places = [
    place({ name: "松山文創園區", lat: 25.0439, lng: 121.5606 }),
    place({ name: "饒河街觀光夜市", lat: 25.0508, lng: 121.5774 }),
    place({ name: "大安森林公園", lat: 25.0299, lng: 121.5361 }),
    place({ name: "淡水老街", lat: 25.1687, lng: 121.4406 }),
    place({ name: "漁人碼頭", lat: 25.1826, lng: 121.4108 }),
  ];
  const { clusters } = clusterPlacesByGeography(places, 2);
  // 淡水/漁人碼頭 (far north) must not share a cluster with central Taipei spots.
  const tamsuiCluster = clusters.find((c) => c.places.some((p) => p.name === "淡水老街"));
  assert.ok(tamsuiCluster);
  assert.ok(!tamsuiCluster.places.some((p) => p.name === "松山文創園區"));
});

check("validateCrossDayGeographicAllocation detects a split cluster", () => {
  const a = place({ name: "饒河街觀光夜市", lat: 25.0508, lng: 121.5774 });
  const b = place({ name: "松山慈祐宮", lat: 25.0509, lng: 121.5772 });
  const v = validateCrossDayGeographicAllocation(
    [
      { place: a, day: 1 },
      { place: b, day: 3 },
    ],
    3,
  );
  assert.equal(v.ok, false);
  assert.ok(v.splitClusterCount >= 1);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed in verify-landmark-cluster`);
  process.exit(1);
}
console.log("\nAll verify-landmark-cluster checks passed.");
process.exit(0);
