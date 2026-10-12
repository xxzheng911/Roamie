import assert from "node:assert/strict";
import { clearCandidatePoolCache } from "../src/lib/ai/places-cost-cache/candidate-pool-cache.ts";
import {
  clearDiscoveredCombinationsCache,
  ensureDestinationCombinationsReady,
} from "../src/lib/ai/destination-combination-discovery.ts";
import {
  buildCombinationSelectionAllowlist,
  buildOfferedCombinationsForSession,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import { resolveGenerationAllowlist } from "../src/lib/ai/itinerary-place-fetch.ts";
import { resetPlanningPipelineForRegenerate } from "../src/lib/ai/ai-planning-session.ts";
import { resolveSelectedCombinationAuthority } from "../src/lib/ai/selected-combination-authority.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import * as integrity from "../src/lib/ai/combination-itinerary-integrity.ts";
import { chatRuntimeCopy } from "../src/lib/chat-runtime-copy.ts";

// Offline only: provider calls are stubbed, the real discovery → offer → select path runs.
globalThis.fetch = async () => {
  throw Error("NETWORK_DISABLED");
};
const names = [
  "Clerigos Tower", "Porto Cathedral", "Bolsa Palace", "Sao Francisco Church", "Fernandina Walls", "Dom Luis Bridge",
  "Serralves Museum", "Soares dos Reis Museum", "Porto Photography Museum", "Romantic Museum", "Tram Museum", "World of Discoveries Museum",
  "Crystal Palace Gardens", "City Park", "Virtudes Garden", "Passeio Alegre Garden", "Botanical Garden", "Covelo Park",
  "Riverside Restaurant", "Garden Restaurant", "Heritage Restaurant", "Central Bistro", "Harbor Restaurant", "Terrace Restaurant",
];
const kind = (i) => (i < 6 ? "tourist_attraction" : i < 12 ? "museum" : i < 18 ? "park" : "restaurant");
const places = names.map((name, i) => ({
  id: `ChIJRegenFixture${i}`, name, lat: 41.15 + i * 0.0003, lng: -8.61, types: [kind(i)], primaryType: kind(i),
  rating: 4.6, userRatingCount: 10000, address: "Porto Portugal", businessStatus: "OPERATIONAL",
}));
const scope = {
  label: "Porto", city: "Porto", country: "PT", countryCode: "PT", type: "city", latitude: 41.15, longitude: -8.61,
  placeId: "ChIJPortoFixtureCity", source: "trip_destination", scopeLocked: false,
};

let providerCalls = 0;
let discoveryRun = 0;
async function discover(pool = places) {
  clearDiscoveredCombinationsCache();
  clearCandidatePoolCache();
  const result = await ensureDestinationCombinationsReady({
    destination: "Porto", destinationCountry: "PT", resolvedDestination: scope, locale: "en", days: 4,
    generationRequestId: `regen-authority-${++discoveryRun}`,
    geocodeFn: async () => { throw Error("must reuse scope"); },
    searchPlaces: async () => { providerCalls++; return { places: pool, error: null }; },
  });
  assert.equal(result.ok, true, "offline discovery");
  const offered = buildOfferedCombinationsForSession("Porto");
  assert.ok(offered.length >= 2, "at least two offered combinations");
  return offered;
}

/** Same context shape the selection turn persists (allowlistContextPatch). */
function selectionContext(offered, userText) {
  const allowlist = buildCombinationSelectionAllowlist("Porto", userText);
  assert.ok(allowlist, `selection parsed: ${userText}`);
  return {
    interests: [], destination: "Porto", days: 4, startDate: "2026-11-25", endDate: "2026-11-28",
    selectedTripStyle: allowlist.allowedTitles.join("、"),
    selectedCombinationIds: allowlist.selectedCombinationIds,
    selectedCombinationPlaceNames: allowlist.allowedPlaceNames,
    excludedCombinationPlaceNames: allowlist.exclusiveExcludedPlaceNames,
    selectionSource: allowlist.selectionSource,
    offeredCombinations: offered.map((combo) => ({
      ...combo,
      places: combo.places.map((p) => ({
        ...p,
        destination: p.destination ?? "Porto",
        isRequiredBySelection: allowlist.selectedCombinationIds.includes(combo.id),
      })),
    })),
  };
}

function regenerateContext(ctx) {
  const session = { ...createEmptySession(), tripDays: 4, travelContext: ctx };
  return resetPlanningPipelineForRegenerate(session, "regenerate").travelContext;
}

const offeredNames = (offered, id) =>
  offered.find((c) => c.id === id).places.map((p) => (p.originalName ?? p.name).trim());

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`PASS ${label}`);
}

const offered = await discover();
const callsAfterDiscovery = providerCalls;

// 1. Regenerate keeps the selected combination and never mixes unselected places.
const first = selectionContext(offered, "1");
const secondSelection = selectionContext(offered, "2");
check("first generation uses selected combination 1", () => {
  assert.deepEqual(resolveGenerationAllowlist(first, "Porto").selectedCombinationIds, [1]);
});
const regen = regenerateContext(first);
check("regenerate drops derived place names (pipeline reset)", () => {
  assert.equal(regen.selectedCombinationPlaceNames, undefined);
  assert.deepEqual(regen.selectedCombinationIds, [1]);
});
check("regenerate keeps selected ids and places after cache loss (restore)", () => {
  clearDiscoveredCombinationsCache();
  const allowlist = resolveGenerationAllowlist(regen, "Porto");
  assert.ok(allowlist, "allowlist resolved");
  assert.deepEqual(allowlist.selectedCombinationIds, [1]);
  assert.deepEqual(allowlist.allowedPlaceNames, offeredNames(offered, 1));
  for (const other of offered.filter((c) => c.id !== 1)) {
    for (const name of offeredNames(offered, other.id)) {
      if (offeredNames(offered, 1).includes(name)) continue;
      assert.ok(!allowlist.allowedPlaceNames.includes(name), `unselected place ${name} leaked`);
    }
  }
});
check("English style title cannot re-resolve to other combinations", () => {
  const allowlist = resolveGenerationAllowlist({ ...regen, selectedTripStyle: "City Stroll、Classic Sights" }, "Porto");
  assert.deepEqual(allowlist.selectedCombinationIds, [1]);
});
check("selected place ids come only from the offered snapshot", () => {
  const authority = resolveSelectedCombinationAuthority(regen, "Porto");
  assert.equal(authority.ok, true);
  const offeredIds = offered.find((c) => c.id === 1).places.map((p) => p.googlePlaceId).filter(Boolean);
  assert.deepEqual(authority.selectedPlaceIds, offeredIds);
});

// 2. Multi-round selection: the latest selection wins.
check("multi-round reselect uses the latest selection only", () => {
  const second = regenerateContext(secondSelection);
  clearDiscoveredCombinationsCache();
  const allowlist = resolveGenerationAllowlist(second, "Porto");
  assert.deepEqual(allowlist.selectedCombinationIds, [2]);
  assert.deepEqual(allowlist.allowedPlaceNames, offeredNames(offered, 2));
});

// 3. Invalid / stale / cross-conversation selections are rejected, never guessed.
check("selection id not in offered snapshot is rejected", () => {
  const authority = resolveSelectedCombinationAuthority({ ...regen, selectedCombinationIds: [9] }, "Porto");
  assert.deepEqual(authority, { ok: false, reason: "selection_not_offered" });
});
check("missing offered snapshot is rejected", () => {
  const authority = resolveSelectedCombinationAuthority({ ...regen, offeredCombinations: undefined }, "Porto");
  assert.deepEqual(authority, { ok: false, reason: "offered_missing" });
});
check("another destination's combinations are rejected", () => {
  const authority = resolveSelectedCombinationAuthority(regen, "東京");
  assert.deepEqual(authority, { ok: false, reason: "destination_mismatch" });
});

check("no extra provider calls after discovery", () => {
  assert.equal(providerCalls, callsAfterDiscovery);
});

// 4. Discovery cache rebuilt (regenerate / restart): same ids can hold different places.
const base18 = places.slice(0, 18);
const offeredD = await discover(base18);
const pinnedCtx = regenerateContext(selectionContext(offeredD, "1"));
const selectedNames = offeredNames(offeredD, 1);
const unselectedOnly = offeredD
  .filter((c) => c.id !== 1)
  .flatMap((c) => offeredNames(offeredD, c.id))
  .filter((name) => !selectedNames.includes(name));
// The provider returns the same places reordered and re-classified on rediscovery.
const reordered = [...base18.slice(12), ...base18.slice(6, 12), ...base18.slice(0, 6)].map((p, i) => ({
  ...p, types: [kind(i)], primaryType: kind(i),
}));
const rebuilt = await discover(reordered);
check("precondition: rebuilt cache maps id 1 to places from an unselected combination", () => {
  assert.ok(offeredNames(rebuilt, 1).some((name) => unselectedOnly.includes(name)));
});
// Generation owns its offered snapshot and activates it for synchronous pool reads
// (mergeSessionPlacesWithFetch → withOfferedCombinationIdentity).
const portoIdentity = integrity.createOfferedCombinationIdentity("Porto", pinnedCtx.offeredCombinations);
const asGeneration = (read) => integrity.withOfferedCombinationIdentity(portoIdentity, read);
check("rebuilt cache pool for id 1 holds only offered combination 1 places", () => {
  const pool = asGeneration(() => integrity.resolveSelectedCombinationPools("Porto", [1], { forceRefresh: true })[0]);
  for (const name of unselectedOnly) {
    assert.ok(!pool.all.some((c) => c.name === name), `unselected ${name} in pool 1`);
  }
  for (const name of selectedNames) assert.ok(pool.all.some((c) => c.name === name), `offered ${name} kept`);
});
check("rebuilt cache does not expand id 1 into unselected places", () => {
  const expanded = asGeneration(() => integrity.expandAllowlistNamesFromPools("Porto", [1], selectedNames));
  for (const name of unselectedOnly) assert.ok(!expanded.includes(name), `unselected ${name} expanded`);
});
check("unselected place is not counted as covering id 1", () => {
  for (const name of unselectedOnly) {
    assert.deepEqual(asGeneration(() => integrity.matchSelectedCombinationIdsForPlace(name, "Porto", [1])), [], name);
  }
});
check("offered place ids stay identical after rebuild", () => {
  const pool = asGeneration(() => integrity.resolveSelectedCombinationPools("Porto", [1])[0]);
  const offeredIds = offeredD.find((c) => c.id === 1).places.map((p) => p.googlePlaceId).filter(Boolean);
  for (const id of offeredIds) assert.ok(pool.all.some((c) => c.googlePlaceId === id), id);
});
check("another destination is not affected by the pin", () => {
  const lisbonIdentity = integrity.createOfferedCombinationIdentity("Lisbon", pinnedCtx.offeredCombinations);
  const pool = integrity.withOfferedCombinationIdentity(lisbonIdentity, () =>
    integrity.resolveSelectedCombinationPools("Porto", [1], { forceRefresh: true })[0]);
  assert.ok(pool.all.length > 0);
});

check("reselect copy exists in four locales without internal codes", () => {
  const copies = ["zh-TW", "en", "ja", "ko"].map((locale) => chatRuntimeCopy("reselectCombination", locale));
  assert.equal(new Set(copies).size, 4);
  for (const copy of copies) {
    assert.ok(copy && !copy.includes("chatRuntime."), copy);
    assert.ok(!/selection_not_offered|offered_missing|destination_mismatch|no_places|session/i.test(copy), copy);
  }
});

console.log(`PASS regenerate selected combination authority (${passed} checks)`);
