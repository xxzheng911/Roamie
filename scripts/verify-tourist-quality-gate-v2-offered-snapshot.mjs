// Tourist Quality Gate V2 — Replan offered-pin pool built from the PRODUCTION offered snapshot.
// Offline: fetch is trapped; discovery cache is seeded in-process with synthetic candidates.
//
// Run: npx vite-node scripts/verify-tourist-quality-gate-v2-offered-snapshot.mjs --config scripts/vite.verify.config.mjs
//
// The evidence-parity script feeds offeredPinnedPool hand-built offered places that carry
// regularOpeningHours. Production offered places come from buildOfferedCombinationsForSession,
// whose element type (CanonicalTravelContext["offeredCombinations"][number]["places"]) has no
// opening-hours / reviewEvidence field. This script checks R31 ("判定與首次相同") on that real
// snapshot: a place admitted at first pass because of opening-hours counter-evidence must not
// become LOW when the cache drifts and the pool falls back to the offered pin.
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("offered snapshot verify must not call providers");
};

const { setCachedDiscoveredCombinations } =
  await import("../src/lib/ai/destination-combination-discovery");
const { buildOfferedCombinationsForSession } =
  await import("../src/lib/ai/destination-combination-suggestions");
const { validateCandidateIntent } = await import("../src/lib/ai/combination-candidate-quality");
const {
  resolveSelectedCombinationPools,
  createOfferedCombinationIdentity,
  withOfferedCombinationIdentity,
  clearCombinationPoolMemo,
  isCombinationIdDriftedFromOffered,
} = await import("../src/lib/ai/combination-itinerary-integrity");

let cases = 0;
const failures = [];
const test = async (name, fn) => {
  try {
    await fn();
    cases++;
    console.log("PASS", name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL", name, "--", (e?.message ?? String(e)).split("\n").slice(0, 4).join(" | "));
  }
};

const DESTINATION = "霧岬市";
const CENTER = { lat: 35.1, lng: 135.1 };
const HOURS = {
  openNow: true,
  periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
  weekdayDescriptions: ["Monday: 9:00 AM – 5:00 PM"],
};
const COMBO = { title: "城市景點漫遊", theme: "attraction" };

let seq = 0;
const cand = (key, name, types, extra = {}) => {
  seq++;
  const id = `ChIJ_TQG_OFFERED_${key}`;
  return {
    name,
    originalName: name,
    googlePlaceId: id,
    searchCandidateId: id,
    address: `${DESTINATION}港町${seq}-2`,
    coordinates: { lat: CENTER.lat + seq * 0.001, lng: CENTER.lng + seq * 0.001 },
    types,
    primaryType: types[0] ?? null,
    rating: 4.5,
    userRatingCount: 300,
    businessStatus: "OPERATIONAL",
    ...extra,
  };
};

// D1 + D2 shape, but with opening hours → first pass must admit it (not LOW).
const C_HOURS = cand("HOURS", "霧岬旧船改所跡", ["historical_landmark", "point_of_interest"], {
  regularOpeningHours: HOURS,
});
const C_MUSEUM = cand("MUSEUM", "霧岬港町資料館", ["museum"], { regularOpeningHours: HOURS });
const C_PARK = cand("PARK", "霧岬臨海公園", ["park", "tourist_attraction"]);

const vciInput = (c) => ({
  name: c.name,
  types: c.types,
  primaryType: c.primaryType,
  address: c.address,
  lat: c.coordinates.lat,
  lng: c.coordinates.lng,
  rating: c.rating,
  userRatingCount: c.userRatingCount,
  googlePlaceId: c.googlePlaceId,
  regularOpeningHours: c.regularOpeningHours,
  currentOpeningHours: c.currentOpeningHours,
  reviewEvidence: c.reviewEvidence,
});

await test("precondition: first-pass candidate validation admits the 跡 place with hours", () => {
  const r = validateCandidateIntent(vciInput(C_HOURS), COMBO, DESTINATION, {
    center: CENTER,
    requireTourismType: true,
  });
  assert.equal(r.ok, true, `first pass rejected: ${r.reason}`);
});

// 1) Discovery result cached; 2) production offered snapshot built from it.
setCachedDiscoveredCombinations(DESTINATION, [
  {
    combinationId: "1",
    title: COMBO.title,
    theme: COMBO.theme,
    placeCandidates: [C_HOURS, C_MUSEUM],
    primaryCandidates: [C_HOURS, C_MUSEUM],
  },
]);
const offered = buildOfferedCombinationsForSession(DESTINATION, "zh-TW");
const offeredPlace = offered[0]?.places?.find((p) => p.googlePlaceId === C_HOURS.googlePlaceId);

await test("precondition: production offered snapshot contains the place", () => {
  assert.ok(offeredPlace, `offered=${JSON.stringify(offered).slice(0, 300)}`);
});

console.log(
  "INFO offered snapshot keeps hours:",
  Boolean(offeredPlace?.regularOpeningHours || offeredPlace?.currentOpeningHours),
);

// 3) Cache drifts (re-discovery no longer holds the offered place) → offered-pin pool path.
setCachedDiscoveredCombinations(DESTINATION, [
  {
    combinationId: "1",
    title: COMBO.title,
    theme: COMBO.theme,
    placeCandidates: [C_MUSEUM, C_PARK],
    primaryCandidates: [C_MUSEUM, C_PARK],
  },
]);
clearCombinationPoolMemo();
const identity = createOfferedCombinationIdentity(DESTINATION, offered);
const drifted = withOfferedCombinationIdentity(identity, () =>
  isCombinationIdDriftedFromOffered(DESTINATION, 1),
);
const [pool] = withOfferedCombinationIdentity(identity, () =>
  resolveSelectedCombinationPools(DESTINATION, [1], { forceRefresh: true }),
);
const ids = (pool?.all ?? []).map((c) => c.googlePlaceId);
console.log("INFO drifted:", drifted, "pool ids:", JSON.stringify(ids));

await test("precondition: cache drift routes through the offered-pin pool", () => {
  assert.equal(drifted, true);
  assert.ok(ids.includes(C_MUSEUM.googlePlaceId), `museum control missing; ids=${ids}`);
});

await test("R31: replan offered-pin verdict equals first pass for a place admitted via opening hours", () => {
  assert.ok(
    ids.includes(C_HOURS.googlePlaceId),
    `place admitted at first pass (hours counter-evidence) re-judged LOW in replan; ids=${JSON.stringify(ids)}`,
  );
});

await test("zero provider calls", () => {
  assert.equal(fetchCalls, 0);
});

if (failures.length) {
  console.log(
    `FAIL tqg v2 offered snapshot: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`,
  );
  process.exitCode = 1;
} else {
  console.log(`PASS tqg v2 offered snapshot: ${cases} scenarios, provider calls ${fetchCalls}`);
}
