import assert from "node:assert/strict";
import { clearCandidatePoolCache } from "../src/lib/ai/places-cost-cache/candidate-pool-cache.ts";
import {
  clearDiscoveredCombinationsCache,
  ensureDestinationCombinationsReady,
} from "../src/lib/ai/destination-combination-discovery.ts";
import { buildOfferedCombinationsForSession } from "../src/lib/ai/destination-combination-suggestions.ts";
import * as integrity from "../src/lib/ai/combination-itinerary-integrity.ts";

const { resolveSelectedCombinationPools } = integrity;
/**
 * Start a generation the way mergeSessionPlacesWithFetch does in the code under test:
 * old contract = one global pin; new contract = generation-owned identity + scoped reads.
 */
function startGeneration(destination, offers) {
  if (integrity.createOfferedCombinationIdentity) {
    const identity = integrity.createOfferedCombinationIdentity(destination, offers);
    return (read) => integrity.withOfferedCombinationIdentity(identity, read);
  }
  integrity.setOfferedCombinationIdentity(destination, offers);
  return (read) => read();
}

// Mirrors mergeSessionPlacesWithFetch: pin offers → await provider work → read pools
// (validateSelectedCombinationIntegrity). Two generations interleave in one JS runtime.
globalThis.fetch = async () => {
  throw Error("NETWORK_DISABLED");
};
const kind = (i) => (i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park");
const names = [
  "Clerigos Tower", "Porto Cathedral", "Bolsa Palace", "Sao Francisco Church", "Fernandina Walls", "Dom Luis Bridge",
  "Serralves Museum", "Soares dos Reis Museum", "Porto Photography Museum", "Romantic Museum", "Tram Museum", "World of Discoveries Museum",
  "Crystal Palace Gardens", "City Park", "Virtudes Garden", "Passeio Alegre Garden", "Botanical Garden", "Covelo Park",
];
const base = names.map((name, i) => ({
  id: `ChIJConc${i}`, name, lat: 41.15 + i * 0.0003, lng: -8.61, types: [kind(i)], primaryType: kind(i),
  rating: 4.6, userRatingCount: 10000, address: "Porto Portugal", businessStatus: "OPERATIONAL",
}));
const scope = {
  label: "Porto", city: "Porto", country: "PT", countryCode: "PT", type: "city", latitude: 41.15, longitude: -8.61,
  placeId: "ChIJPortoFixtureCity", source: "trip_destination", scopeLocked: false,
};
let providerCalls = 0;
let run = 0;
async function discover(pool) {
  clearDiscoveredCombinationsCache();
  clearCandidatePoolCache();
  const result = await ensureDestinationCombinationsReady({
    destination: "Porto", destinationCountry: "PT", resolvedDestination: scope, locale: "en", days: 4,
    generationRequestId: `concurrency-${++run}`,
    searchPlaces: async () => { providerCalls++; return { places: pool, error: null }; },
  });
  assert.equal(result.ok, true);
  return buildOfferedCombinationsForSession("Porto");
}
const namesOf = (offered, id) => offered.find((c) => c.id === id).places.map((p) => p.originalName ?? p.name);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Session A: offers from the first discovery; user selected id 1.
const offersA = await discover(base);
// Session B (same destination, another conversation): rediscovery re-classifies places.
const offersB = await discover(
  [...base.slice(12), ...base.slice(6, 12), ...base.slice(0, 6)].map((p, i) => ({ ...p, types: [kind(i)], primaryType: kind(i) })),
);
assert.notDeepEqual(namesOf(offersB, 1), namesOf(offersA, 1), "precondition: id 1 differs between sessions");
const callsBefore = providerCalls;

let failures = 0;
function expect(label, fn) {
  try {
    fn();
    console.log(`PASS ${label}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${label}: ${error.message.split("\n")[0]}`);
  }
}

// Scenario 1: same destination, interleaved A pin → B pin → A read.
async function generationA() {
  const read = startGeneration("Porto", offersA);
  await tick(); // provider searches
  await tick();
  return read(() => resolveSelectedCombinationPools("Porto", [1])[0].all.map((c) => c.name));
}
async function generationB() {
  await tick();
  const read = startGeneration("Porto", offersB);
  await tick();
  return read(() => resolveSelectedCombinationPools("Porto", [1])[0].all.map((c) => c.name));
}
const [poolA, poolB] = await Promise.all([generationA(), generationB()]);
expect("S1 session A pool uses only session A offers for id 1", () => {
  const foreign = poolA.filter((name) => !namesOf(offersA, 1).includes(name));
  assert.deepEqual(foreign, [], `foreign places: ${foreign.join(", ")}`);
});
expect("S1 session B pool uses session B offers for id 1", () => {
  for (const name of namesOf(offersB, 1)) assert.ok(poolB.includes(name), name);
});

// Scenario 2: different destinations, A=Porto then B=Lisbon overwrites the single slot.
const lisbonOffers = [{ id: 1, title: "Old Lisbon", places: [
  { name: "Belem Tower", googlePlaceId: "ChIJLisbon1", destination: "Lisbon" },
  { name: "Jeronimos Monastery", googlePlaceId: "ChIJLisbon2", destination: "Lisbon" },
] }];
async function portoGeneration() {
  const read = startGeneration("Porto", offersA);
  await tick();
  await tick();
  return read(() => resolveSelectedCombinationPools("Porto", [1])[0].all.map((c) => c.name));
}
async function lisbonGeneration() {
  await tick();
  startGeneration("Lisbon", lisbonOffers);
}
const [portoPool] = await Promise.all([portoGeneration(), lisbonGeneration()]);
expect("S2 no Lisbon places enter the Porto pool (no cross-destination mixing)", () => {
  assert.ok(!portoPool.some((name) => ["Belem Tower", "Jeronimos Monastery"].includes(name)));
});
expect("S2 Porto pool keeps session A selected-only identity after Lisbon pin", () => {
  const foreign = portoPool.filter((name) => !namesOf(offersA, 1).includes(name));
  assert.deepEqual(foreign, [], `unselected/drifted places: ${foreign.join(", ")}`);
});

// Scenario 3: single generation, memo isolation, invalid snapshot.
expect("S3 single generation keeps selected-only identity after cache rebuild", () => {
  const read = startGeneration("Porto", offersA);
  const pool = read(() => resolveSelectedCombinationPools("Porto", [1], { forceRefresh: true })[0]);
  assert.deepEqual(pool.all.map((c) => c.name).filter((n) => !namesOf(offersA, 1).includes(n)), []);
  for (const place of offersA.find((c) => c.id === 1).places) {
    assert.ok(pool.all.some((c) => c.googlePlaceId === place.googlePlaceId), place.googlePlaceId);
  }
});
expect("S3 pool memo from one generation is not reused by another", () => {
  const readA = startGeneration("Porto", offersA);
  const readB = startGeneration("Porto", offersB);
  const a = readA(() => resolveSelectedCombinationPools("Porto", [1])[0].all.map((c) => c.name));
  const b = readB(() => resolveSelectedCombinationPools("Porto", [1])[0].all.map((c) => c.name));
  assert.deepEqual(a.filter((n) => !namesOf(offersA, 1).includes(n)), [], "A");
  for (const name of namesOf(offersB, 1)) assert.ok(b.includes(name), `B ${name}`);
});
expect("S3 empty offered snapshot pins nothing and does not throw", () => {
  const read = startGeneration("Porto", []);
  assert.ok(read(() => resolveSelectedCombinationPools("Porto", [1], { forceRefresh: true })[0].all.length > 0));
});

expect("no provider calls during interleaved generations", () => {
  assert.equal(providerCalls, callsBefore);
});
console.log(failures ? `FAIL offered identity concurrency (${failures} failing)` : "PASS offered identity concurrency");
process.exitCode = failures ? 1 : 0;
