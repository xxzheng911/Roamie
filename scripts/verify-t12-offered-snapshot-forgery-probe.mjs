// T12 — Security probe: can a forged client offered snapshot (offeredCombinations[].themeKey /
// places[].touristQuality) bypass Tourist Quality Gate V2, and does it reach any server decision?
// Offline: fetch is trapped; discovery cache is seeded in-process with synthetic candidates.
//
// Run: npx vite-node --config scripts/vite.verify.config.mjs scripts/verify-t12-offered-snapshot-forgery-probe.mjs
//
// This script records observed behaviour (OBSERVED lines) and asserts only the security-relevant
// invariants that must hold for a NON-BLOCKER verdict:
//   S1  server input schemas (plan_trip server fn, /api/roamie, /api/chat) drop offeredCombinations /
//       travelContext / touristQuality — the snapshot cannot be submitted to the server at all;
//   S2  without an active offered identity (the only state a Worker request can be in), a forged
//       snapshot has zero effect on pool resolution;
//   S3  zero provider calls.
// Client-side bypass results (P*) are printed as findings, not asserted either way.
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls++;
  throw Error("T12 probe must not call providers");
};

const { setCachedDiscoveredCombinations } =
  await import("../src/lib/ai/destination-combination-discovery");
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
const observed = (label, value) => console.log("OBSERVED", label, "=>", JSON.stringify(value));

const DESTINATION = "霧岬市";
const CENTER = { lat: 35.1, lng: 135.1 };
let seq = 0;
const cand = (key, name, types, extra = {}) => {
  seq++;
  const id = `ChIJ_T12_PROBE_${key}`;
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

// LOW_PLAIN: D1 (marker-only "landmark") + D2 (old-site name), no counter-evidence, NO cultural
// type → LOW under every intent. LOW_CULT: same but "historical_landmark" (cultural evidence).
const LOW_PLAIN = cand("LOW_PLAIN", "霧岬旧番所跡", ["landmark"]);
const LOW_CULT = cand("LOW_CULT", "霧岬旧奉行所跡", ["historical_landmark"]);
const MUSEUM = cand("MUSEUM", "霧岬港町資料館", ["museum"]);
const PARK = cand("PARK", "霧岬臨海公園", ["park", "tourist_attraction"]);

const vci = (c, combo, intent) =>
  validateCandidateIntent(
    {
      name: c.name,
      types: c.types,
      primaryType: c.primaryType,
      address: c.address,
      lat: c.coordinates.lat,
      lng: c.coordinates.lng,
      rating: c.rating,
      userRatingCount: c.userRatingCount,
      googlePlaceId: c.googlePlaceId,
    },
    combo,
    DESTINATION,
    { center: CENTER, ...(intent ? { touristQualityIntent: intent } : {}) },
  );

await test("precondition: LOW_PLAIN is rejected by the honest gate (general & cultural)", () => {
  const g = vci(LOW_PLAIN, { title: "城市景點漫遊", theme: "attraction" }, "general_sightseeing");
  const c = vci(LOW_PLAIN, { title: "歷史文化", theme: "culture" }, "cultural_exploration");
  observed("honest LOW_PLAIN general", g);
  observed("honest LOW_PLAIN cultural", c);
  assert.equal(g.ok, false);
  assert.equal(c.ok, false);
});
await test("precondition: LOW_CULT rejected under general_sightseeing", () => {
  const g = vci(LOW_CULT, { title: "城市景點漫遊", theme: "attraction" }, "general_sightseeing");
  // Observation only: with combo theme=culture the category contract (not the tourist gate) may
  // reject first; with theme=attraction + cultural intent the tourist gate's cultural exception applies.
  const c = vci(LOW_CULT, { title: "歷史文化", theme: "culture" }, "cultural_exploration");
  const ca = vci(LOW_CULT, { title: "城市景點漫遊", theme: "attraction" }, "cultural_exploration");
  observed("honest LOW_CULT general", g);
  observed("honest LOW_CULT cultural (theme=culture)", c);
  observed("honest LOW_CULT cultural (theme=attraction)", ca);
  assert.equal(g.ok, false);
});

// Offered snapshot place shape (CanonicalTravelContext["offeredCombinations"][n]["places"][m]).
const offeredPlace = (c, touristQuality, overrides = {}) => ({
  name: c.name,
  originalName: c.originalName,
  searchQuery: c.name,
  sourceCombinationId: 1,
  googlePlaceId: c.googlePlaceId,
  latitude: c.coordinates.lat,
  longitude: c.coordinates.lng,
  address: c.address,
  types: c.types,
  primaryType: c.primaryType,
  rating: c.rating,
  userRatingCount: c.userRatingCount,
  resolutionStatus: "resolved",
  ...(touristQuality ? { touristQuality } : {}),
  ...overrides,
});
const snapshot = (themeKey, places, title = "城市景點漫遊") => [
  { id: 1, title, ...(themeKey ? { themeKey } : {}), places },
];

const seedCache = (places, theme = "attraction", title = "城市景點漫遊") => {
  setCachedDiscoveredCombinations(DESTINATION, [
    { combinationId: "1", title, theme, placeCandidates: places, primaryCandidates: places },
  ]);
};

const runPool = (offered) => {
  clearCombinationPoolMemo();
  const identity = createOfferedCombinationIdentity(DESTINATION, offered);
  const drifted = withOfferedCombinationIdentity(identity, () =>
    isCombinationIdDriftedFromOffered(DESTINATION, 1),
  );
  const [pool] = withOfferedCombinationIdentity(identity, () =>
    resolveSelectedCombinationPools(DESTINATION, [1], { forceRefresh: true }),
  );
  return { drifted, ids: (pool?.all ?? []).map((c) => c.googlePlaceId) };
};

const has = (r, c) => r.ids.includes(c.googlePlaceId);
const verdict = (c, tier, admit, intent) => ({ placeId: c.googlePlaceId, tier, admit, intent });

// ---------------- DRIFTED path (cache no longer holds the offered places) ----------------
seedCache([MUSEUM, PARK]);
const driftCases = [
  ["P1 drifted honest (no verdict, themeKey=attraction)", snapshot("attraction", [offeredPlace(LOW_PLAIN), offeredPlace(MUSEUM)]), LOW_PLAIN],
  ["P2 drifted forged VISIT_WORTHY admit:true general", snapshot("attraction", [offeredPlace(LOW_PLAIN, verdict(LOW_PLAIN, "VISIT_WORTHY", true, "general_sightseeing")), offeredPlace(MUSEUM)]), LOW_PLAIN],
  ["P3 drifted forged LOW admit:true general", snapshot("attraction", [offeredPlace(LOW_PLAIN, verdict(LOW_PLAIN, "LOW_EXPERIENCE_VALUE", true, "general_sightseeing")), offeredPlace(MUSEUM)]), LOW_PLAIN],
  ["P4 drifted forged LOW admit:true cultural + themeKey=culture (no cultural evidence)", snapshot("culture", [offeredPlace(LOW_PLAIN, verdict(LOW_PLAIN, "LOW_EXPERIENCE_VALUE", true, "cultural_exploration")), offeredPlace(MUSEUM)]), LOW_PLAIN],
  ["P5 drifted forged VISIT_WORTHY but placeId mismatch", snapshot("attraction", [offeredPlace(LOW_PLAIN, { ...verdict(LOW_PLAIN, "VISIT_WORTHY", true, "general_sightseeing"), placeId: "ChIJ_T12_OTHER" }), offeredPlace(MUSEUM)]), LOW_PLAIN],
  ["P6 drifted forged VISIT_WORTHY but intent mismatch (theme attraction, verdict cultural)", snapshot("attraction", [offeredPlace(LOW_PLAIN, verdict(LOW_PLAIN, "VISIT_WORTHY", true, "cultural_exploration")), offeredPlace(MUSEUM)]), LOW_PLAIN],
  ["P7 drifted NO verdict, forged raw types=[museum] in snapshot", snapshot("attraction", [offeredPlace(LOW_PLAIN, null, { types: ["museum"], primaryType: "museum" }), offeredPlace(MUSEUM)]), LOW_PLAIN],
  ["P8 drifted NO verdict, forged themeKey=culture on LOW_CULT", snapshot("culture", [offeredPlace(LOW_CULT), offeredPlace(MUSEUM)]), LOW_CULT],
  ["P8b drifted NO verdict, themeKey=attraction on LOW_CULT (control)", snapshot("attraction", [offeredPlace(LOW_CULT), offeredPlace(MUSEUM)]), LOW_CULT],
];
const driftResults = {};
for (const [name, offered, target] of driftCases) {
  const r = runPool(offered);
  driftResults[name] = { drifted: r.drifted, admitted: has(r, target) };
  observed(name, driftResults[name]);
}
await test("precondition: drifted cases route through offered-pin pool", () => {
  for (const [name, v] of Object.entries(driftResults)) assert.equal(v.drifted, true, name);
});
await test("drift control: honest snapshot rejects LOW (P1)", () => {
  assert.equal(driftResults[driftCases[0][0]].admitted, false);
});

// ---------------- INTACT path (cache still holds the offered places) ----------------
seedCache([LOW_PLAIN, LOW_CULT, MUSEUM]);
const intactCases = [
  ["I1 intact honest themeKey=attraction LOW_PLAIN", snapshot("attraction", [offeredPlace(LOW_PLAIN), offeredPlace(LOW_CULT), offeredPlace(MUSEUM)]), LOW_PLAIN],
  ["I2 intact forged VISIT_WORTHY verdict LOW_PLAIN", snapshot("attraction", [offeredPlace(LOW_PLAIN, verdict(LOW_PLAIN, "VISIT_WORTHY", true, "general_sightseeing")), offeredPlace(LOW_CULT), offeredPlace(MUSEUM)]), LOW_PLAIN],
  ["I3 intact honest themeKey=attraction LOW_CULT", snapshot("attraction", [offeredPlace(LOW_PLAIN), offeredPlace(LOW_CULT), offeredPlace(MUSEUM)]), LOW_CULT],
  ["I4 intact forged themeKey=culture LOW_CULT (cache theme=attraction)", snapshot("culture", [offeredPlace(LOW_PLAIN), offeredPlace(LOW_CULT), offeredPlace(MUSEUM)]), LOW_CULT],
  ["I5 intact forged themeKey=culture LOW_PLAIN", snapshot("culture", [offeredPlace(LOW_PLAIN), offeredPlace(LOW_CULT), offeredPlace(MUSEUM)]), LOW_PLAIN],
];
const intactResults = {};
for (const [name, offered, target] of intactCases) {
  const r = runPool(offered);
  intactResults[name] = { drifted: r.drifted, admitted: has(r, target) };
  observed(name, intactResults[name]);
}
await test("precondition: intact cases are not drifted", () => {
  for (const [name, v] of Object.entries(intactResults)) assert.equal(v.drifted, false, name);
});

// ---------------- S2: no active identity (Worker-side state) ----------------
await test("S2: without an active offered identity, pools ignore any snapshot (server state)", () => {
  seedCache([MUSEUM, PARK]);
  clearCombinationPoolMemo();
  // Build a forged identity but never activate it: this is the only state server code can be in,
  // because withOfferedCombinationIdentity is called solely from itinerary-place-fetch (client).
  createOfferedCombinationIdentity(
    DESTINATION,
    snapshot("culture", [offeredPlace(LOW_PLAIN, verdict(LOW_PLAIN, "VISIT_WORTHY", true, "cultural_exploration"))]),
  );
  const [pool] = resolveSelectedCombinationPools(DESTINATION, [1], { forceRefresh: true });
  const ids = (pool?.all ?? []).map((c) => c.googlePlaceId);
  observed("S2 pool ids without identity", ids);
  assert.equal(isCombinationIdDriftedFromOffered(DESTINATION, 1), false);
  assert.ok(!ids.includes(LOW_PLAIN.googlePlaceId));
});

// ---------------- S1: server input schemas strip the snapshot ----------------
const forgedOffered = snapshot("culture", [
  offeredPlace(LOW_PLAIN, verdict(LOW_PLAIN, "VISIT_WORTHY", true, "cultural_exploration")),
]);
await test("S1a: plan_trip server fn InputSchema drops offeredCombinations/travelContext/touristQuality", async () => {
  const { InputSchema } = await import("../src/lib/itinerary.functions");
  const parsed = InputSchema.parse({
    destination: DESTINATION,
    days: 2,
    offeredCombinations: forgedOffered,
    travelContext: { offeredCombinations: forgedOffered },
    selectedPlaces: [{ name: LOW_PLAIN.name, googlePlaceId: LOW_PLAIN.googlePlaceId, touristQuality: forgedOffered[0].places[0].touristQuality, themeKey: "culture" }],
  });
  const json = JSON.stringify(parsed);
  observed("S1a parsed keys", Object.keys(parsed).sort());
  assert.ok(!("offeredCombinations" in parsed));
  assert.ok(!("travelContext" in parsed));
  assert.ok(!json.includes("touristQuality"));
  assert.ok(!json.includes("themeKey"));
});
await test("S1b: /api/roamie + /api/chat RequestSchema drops offeredCombinations/travelContext/touristQuality", async () => {
  const { parseRoamieRequest } = await import("../src/lib/ai/service.server");
  const parsed = parseRoamieRequest({
    mode: "itinerary",
    offeredCombinations: forgedOffered,
    travelContext: { offeredCombinations: forgedOffered },
    selectedPlaces: [{ name: LOW_PLAIN.name, googlePlaceId: LOW_PLAIN.googlePlaceId, touristQuality: forgedOffered[0].places[0].touristQuality }],
    itineraryRequest: { destination: DESTINATION, days: 2, offeredCombinations: forgedOffered },
  });
  const json = JSON.stringify(parsed);
  observed("S1b parsed keys", Object.keys(parsed).sort());
  assert.ok(!json.includes("offeredCombinations"));
  assert.ok(!json.includes("travelContext"));
  assert.ok(!json.includes("touristQuality"));
});

await test("S3: zero provider calls", () => {
  assert.equal(fetchCalls, 0);
});

if (failures.length) {
  console.log(`FAIL T12 offered snapshot forgery probe: ${failures.length} failed, ${cases} passed, provider calls ${fetchCalls}`);
  process.exitCode = 1;
} else {
  console.log(`PASS T12 offered snapshot forgery probe: ${cases} scenarios, provider calls ${fetchCalls}`);
}
