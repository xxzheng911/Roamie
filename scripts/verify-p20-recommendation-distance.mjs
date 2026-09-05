import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildUnifiedPlaceCard } from "../src/lib/unified-place-card.ts";
import { resolveRecommendationDistanceEvidence } from "../src/lib/recommendation-distance-evidence.ts";

const taiwan = { lat: 22.6273, lng: 120.3014 };
const narita = { id: "narita-t2", name: "成田機場第二航廈", lat: 35.7732, lng: 140.3874 };

test("foreign place distance uses reliable user location, never selected place/search center", () => {
  const evidence = resolveRecommendationDistanceEvidence(narita, taiwan);
  assert.equal(evidence.distanceSource, "user_location");
  assert.equal(evidence.userLocationAvailable, true);
  assert.ok(evidence.distanceMeters > 1_000_000);
  assert.notEqual(evidence.distanceLabel, "0 m");
});

test("missing reliable user location suppresses distance and proximity authority", () => {
  const evidence = resolveRecommendationDistanceEvidence(narita, null);
  assert.equal(evidence.distanceSource, "unknown");
  assert.equal(evidence.distanceMeters, undefined);
  assert.equal(evidence.distanceLabel, undefined);
  assert.equal(evidence.proximityReasonAllowed, false);
});

test("search center distance cannot authorize user proximity wording", () => {
  const card = buildUnifiedPlaceCard({
    place: narita,
    userLocation: { lat: narita.lat, lng: narita.lng },
    distanceSource: "SEARCH_CENTER",
    locale: "zh-TW",
  });
  assert.doesNotMatch(card.reason, /距離你|離你|附近|目前位置很近/);
});

test("user-location distance may authorize proximity wording for a genuinely nearby place", () => {
  const nearby = { ...narita, lat: taiwan.lat + 0.001, lng: taiwan.lng + 0.001 };
  const card = buildUnifiedPlaceCard({
    place: nearby,
    userLocation: taiwan,
    distanceSource: "USER_LOCATION",
    locale: "zh-TW",
  });
  assert.match(card.reason, /距離你|離你|附近|目前位置很近/);
});

test("Explore adapters no longer substitute destination/search center for user location", () => {
  const search = readFileSync(new URL("../src/lib/explore-map-search.ts", import.meta.url), "utf8");
  const primary = readFileSync(new URL("../src/lib/explore-primary-place.ts", import.meta.url), "utf8");
  assert.doesNotMatch(search, /const origin = \{ lat: place\.lat, lng: place\.lng \}/);
  assert.doesNotMatch(primary, /const origin = \{ lat: place\.lat, lng: place\.lng \}/);
  assert.match(search, /userLocation: opts\.userLocation/);
  assert.match(primary, /userLocation: opts\.userLocation/);
});

test("Explore cards and Detail use the same reliable user-location authority", () => {
  const route = readFileSync(new URL("../src/routes/_app.map.tsx", import.meta.url), "utf8");
  assert.match(route, /const reliableUserLocation =/);
  assert.match(route, /userLocation=\{reliableUserLocation\}/);
  assert.match(route, /distanceMeters\(\s*reliableUserLocation!/);
  assert.doesNotMatch(route, /userLocation=\{\{ lat: recommendCenter\.lat, lng: recommendCenter\.lng \}\}/);
});

test("factual Explore cache excludes session/device distance metadata", () => {
  const cache = readFileSync(
    new URL("../src/lib/explore-map-persistent-cache.ts", import.meta.url),
    "utf8",
  );
  for (const field of ["reason", "distanceLabel", "distanceSource", "distanceFromUser"]) {
    assert.match(cache, new RegExp(`${field}: _${field}`));
  }
});

test("required distance diagnostics are present without addresses or coordinates", () => {
  const source = readFileSync(
    new URL("../src/lib/recommendation-distance-evidence.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /RECOMMENDATION_DISTANCE_EVIDENCE/);
  assert.match(source, /EXPLORE_DISTANCE_DISPLAY/);
  assert.doesNotMatch(source, /address=/);
  assert.doesNotMatch(source, /latitude=|longitude=|lat=|lng=/);
});
