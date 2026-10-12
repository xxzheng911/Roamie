import assert from "node:assert/strict";
import { parseAdministrativeAddress } from "../src/lib/ai/nearby-geographic-scope.ts";
import { clearCandidatePoolCache } from "../src/lib/ai/places-cost-cache/candidate-pool-cache.ts";
import { ensureDestinationCombinationsReady, clearDiscoveredCombinationsCache } from "../src/lib/ai/destination-combination-discovery.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveGlobalPlanningCandidate } from "../src/lib/ai/global-planning-context.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { bindSelectionOwner, rejectNumericSelection } from "../src/lib/ai/numeric-selection-authority.ts";
import { validateItineraryPlan } from "../src/lib/ai/itinerary-validator/validate.ts";
import { replanUntilItineraryValid } from "../src/lib/ai/itinerary-validator/replan.ts";
import "../src/lib/ai/destination-advice.ts";
import "../src/lib/ai/planning-conversation-constraints.ts";
import "../src/lib/ai/destination-trip-planning.ts";

/** Runs after the runner removed the iOS 15.4 built-ins; natives are the reference only. */
export async function run(native) {
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([name, "PASS"]); }
  catch (error) { results.push([name, `FAIL ${error?.name}: ${String(error?.message).slice(0, 90)}`]); }
}

// 1. Spec equivalence against the native reference.
await check("Array/String.prototype.at equivalence", () => {
  const arrays = [[1, 2, 3], [], [, 1], { length: 3, 0: "a", 2: "c" }, "héllo", { length: -5 }, { length: 2 ** 60, 0: 1 }];
  const indexes = [0, 1, -1, -3, 2, 99, -99, 1.7, -1.2, NaN, "1", "-1", "x", null, undefined, true, Infinity, -Infinity, -0];
  for (const target of arrays) for (const index of indexes) {
    const proto = typeof target === "string" ? String.prototype.at : Array.prototype.at;
    const reference = typeof target === "string" ? native.stringAt : native.at;
    assert.deepEqual(proto.call(target, index), reference.call(target, index), `${JSON.stringify(target)} @ ${String(index)}`);
  }
  for (const bad of [Symbol("s"), 1n]) assert.throws(() => [1].at(bad), TypeError);
  assert.throws(() => Array.prototype.at.call(null, 0), TypeError);
  assert.throws(() => String.prototype.at.call(undefined, 0), TypeError);
  assert.equal(Object.getOwnPropertyDescriptor(Array.prototype, "at").enumerable, false);
});
await check("Object.hasOwn equivalence", () => {
  const sym = Symbol("k");
  const proto = { inherited: 1 };
  const objects = [{ a: 1, [sym]: 2 }, Object.create(proto), Object.create(null), [1], "str", 5];
  for (const object of objects) for (const key of ["a", sym, "inherited", "0", 0, "length", "missing"])
    assert.equal(Object.hasOwn(object, key), native.hasOwn(object, key));
  assert.throws(() => Object.hasOwn(null, "a"), TypeError);
  assert.throws(() => Object.hasOwn(undefined, "a"), TypeError);
});
await check("structuredClone equivalence (data values)", () => {
  const shared = { id: "ChIJShared", lat: 35.0, tags: ["museum"] };
  const cyclic = { name: "root" }; cyclic.self = cyclic;
  const sparse = [1, , 3]; sparse.extra = "x";
  const fixtures = [
    1, -0, NaN, "京都", null, undefined, true, 10n,
    { a: undefined, b: null, nested: { arr: [1, { deep: true }] } },
    { first: shared, second: shared }, cyclic, sparse,
    new Date("2026-12-10T00:00:00+09:00"), /kyoto/giu,
    new Map([["k", shared], [shared, "v"]]), new Set([shared, 1]),
    Object.create(null), Object.assign(Object.create({ inherited: 1 }), { own: 2 }),
  ];
  for (const value of fixtures) {
    const ours = structuredClone(value);
    const reference = native.structuredClone(value);
    assert.deepEqual(ours, reference);
    if (value && typeof value === "object") assert.notEqual(ours, value, "fresh copy");
  }
  const pair = structuredClone({ first: shared, second: shared });
  assert.equal(pair.first, pair.second, "shared reference preserved");
  const loop = structuredClone(cyclic);
  assert.equal(loop.self, loop, "cycle preserved");
  assert.equal(Object.getPrototypeOf(structuredClone(Object.create(null))), Object.prototype);
  for (const bad of [() => 1, Symbol("x"), { fn() {} }, new Error("e"), new URL("https://roamie.tw")])
    assert.throws(() => structuredClone(bad), (error) => error.name === "DataCloneError", "unsupported values fail loudly");
});

// 2. Real app paths that call these built-ins on the client.
await check("Nearby administrative parsing (.at)", () => {
  const parsed = parseAdministrativeAddress("〒605-0862 京都府京都市東山区清水1丁目294");
  assert.ok(parsed && typeof parsed === "object");
});
await check("Chat bundle modules evaluate (destination advice / constraints / trip planning)", () => {});
await check("Kyoto ja discovery → offers → restore → choice (structuredClone/.at)", async () => {
  const names = ["清水寺", "伏見稲荷大社", "金閣寺", "銀閣寺", "二条城", "八坂神社", "京都国立博物館", "京都市京セラ美術館", "京都鉄道博物館", "京都国際マンガミュージアム", "細見美術館", "京都文化博物館", "円山公園", "京都御苑", "京都府立植物園", "嵐山公園", "梅小路公園", "岡崎公園", "錦市場", "先斗町", "祇園", "三年坂", "花見小路", "哲学の道"];
  const type = (i) => (i < 6 || i >= 18 ? "tourist_attraction" : i < 12 ? "museum" : "park");
  const pool = names.map((name, i) => ({ id: `ChIJCompatFixture${i}`, name, lat: 35 + i * 0.0003, lng: 135.76, types: [type(i)], primaryType: type(i), rating: 4.6, userRatingCount: 10000, address: "京都府京都市", businessStatus: "OPERATIONAL" }));
  const scope = { label: "京都", city: "京都", country: "JP", countryCode: "JP", type: "city", latitude: 35.01, longitude: 135.76, placeId: "ChIJCompatCity", source: "trip_destination", scopeLocked: false };
  const L = "ja";
  const turn = (text, session) => { const m = mergeTravelContext(session, text); const r = processAdviceTurn(text, m.session, m.context, undefined, L); return { ...r, session: { ...r.session, pendingQuestion: r.route?.pendingQuestion } }; };
  clearDiscoveredCombinationsCache(); clearCandidatePoolCache();
  let calls = 0;
  let s = { ...createEmptySession(), workspaceId: "ios15-compat", travelContext: { interests: [] } };
  s = turn("12月に日本へ旅行に行きたいです。", s).session;
  s = mergeTravelContext(s, "京都に行きたいです。").session;
  s = await resolveGlobalPlanningCandidate(s, L, async () => ({ rawResultCount: 1, location: { placeId: scope.placeId, country: "JP", city: "京都", region: "京都府", lat: scope.latitude, lng: scope.longitude, formattedName: "京都", displayLabel: "京都" } }));
  const r2 = processAdviceTurn("京都に行きたいです。", s, s.travelContext, undefined, L); s = { ...r2.session, pendingQuestion: r2.route?.pendingQuestion };
  const res = await ensureDestinationCombinationsReady({ destination: "京都", destinationCountry: "JP", resolvedDestination: scope, locale: L, days: 4, generationRequestId: "ios15-compat", searchPlaces: async () => { calls++; return { places: pool, error: null }; } });
  assert.equal(res.ok, true, `discovery ok (${res.reason ?? res.detail ?? ""})`);
  const callsBefore = calls;
  s = turn("4日間です。", s).session;
  const offers = s.travelContext.offeredCombinations;
  assert.equal(s.pendingQuestion?.type, "combination_choice");
  assert.ok(offers?.length >= 2, "offers persisted");
  const restored = JSON.parse(JSON.stringify(bindSelectionOwner(s)));
  assert.equal(rejectNumericSelection(restored, "1"), false);
  const chosen = turn("1", restored);
  assert.equal(chosen.advice.triggerItineraryGeneration, true);
  assert.deepEqual(chosen.advice.contextPatch.selectedCombinationIds, [offers[0].id]);
  assert.equal(calls, callsBefore, "no extra provider calls");
});
await check("Itinerary replan diversity repair (findLastIndex removed)", async () => {
  const place = (id, family) => ({ id, googlePlaceId: id, name: id, address: "fixture", lat: 25, lng: 121, rating: 4.5, userRatingCount: 100, primaryType: family, types: [family], businessStatus: "OPERATIONAL", openStatus: "unknown" });
  const day = ["a", "b", "c", "d"].map((id) => place(`museum-${id}`, "museum"));
  const input = { plans: [{ day: 1, entries: day.map((p, i) => ({ time: `${9 + i * 2}:00`, label: "景點", name: p.name, place: p })) }], requestedDays: 1, generationId: "ios15", validationStage: "final", lockedPlaceIds: [] };
  const out = replanUntilItineraryValid({ generationId: "ios15", plans: input.plans, pool: [...day, place("park-x", "park")], days: 1, style: "mixed", plannedDate: "2026-12-10", validatorInput: { requestedDays: 1, lockedPlaceIds: [], generationId: "ios15", validationStage: "final" } }, validateItineraryPlan(input));
  assert.equal(out.plans.length, 1);
});

  return results;
}
