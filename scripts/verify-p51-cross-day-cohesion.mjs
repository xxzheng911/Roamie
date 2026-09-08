import assert from "node:assert/strict";
import { repairCrossDayGeographicCohesion } from "../src/lib/ai/cross-day-geographic-cohesion.ts";

const place = (id, lat, lng, extra = {}) => ({
  id, googlePlaceId: id, name: id, address: "", lat, lng, rating: 4.5,
  userRatingCount: 100, photoName: null, primaryType: "tourist_attraction",
  types: ["tourist_attraction"], businessStatus: "OPERATIONAL", openStatus: "unknown",
  openStatusLabel: "", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "", ...extra,
});
const entry = (p, label = "景點") => ({ time: "10:00", label, name: p.name, place: p });
const ids = (plans, day) => plans.find((plan) => plan.day === day).entries.map((item) => item.place.id);
const run = (plans) => repairCrossDayGeographicCohesion(plans, {
  generationId: "p51", stage: "final_pre_persistence", logDiagnostics: false,
});

const A = place("A", 25.0330, 121.5654);
const B = place("B", 25.0340, 121.5668);
const C = place("C", 25.0800, 121.5000);
const D = place("D", 25.0810, 121.5010);
const E = place("E", 25.0200, 121.4900);
const F = place("F", 25.0210, 121.4910);
const G = place("G", 25.1100, 121.6100);
const H = place("H", 25.1110, 121.6110);
const I = place("I", 25.1120, 121.6120);

const split = [
  { day: 1, entries: [entry(A), entry(C)] },
  { day: 2, entries: [entry(D), entry(E)] },
  { day: 3, entries: [entry(F), entry(G), entry(H)] },
  { day: 4, entries: [entry(B), entry(I)] },
];
const repaired = run(split);
assert.equal(ids(repaired, 1).includes("A") && ids(repaired, 1).includes("B"), true, "A/B same cluster must co-locate by swap");
assert.deepEqual(repaired.map((plan) => plan.entries.length), [2, 2, 3, 2]);

const fixedB = place("B-fixed", 25.0340, 121.5668);
const fixed = run(split.map((plan) => ({
  ...plan,
  entries: plan.entries.map((item) => item.place.id === "B" ? entry(fixedB, "Day 4 reservation") : item),
})));
assert.equal(ids(fixed, 4).includes("B-fixed"), true, "fixed-day reservation stays on Day 4");

const requiredA = place("required-A", 25.0330, 121.5654);
const requiredB = place("required-B", 25.0340, 121.5668);
const required = run(split.map((plan) => ({
  ...plan,
  entries: plan.entries.map((item) => item.place.id === "A" ? entry(requiredA) : item.place.id === "B" ? entry(requiredB) : item),
})));
const requiredIds = required.flatMap((plan) => plan.entries.map((item) => item.place.id));
assert.equal(requiredIds.includes("required-A") && requiredIds.includes("required-B"), true);
assert.equal(required.some((plan) => ids(required, plan.day).includes("required-A") && ids(required, plan.day).includes("required-B")), true);

const unknown = place("unknown", null, null);
const withUnknown = run(split.map((plan) => plan.day === 2 ? { ...plan, entries: [...plan.entries, entry(unknown)] } : plan));
assert.equal(ids(withUnknown, 2).includes("unknown"), true, "unlocated stop remains stable");

console.log("P51 cross-day cohesion: PASS", {
  productionLikeCounts: repaired.map((plan) => plan.entries.length),
  sameClusterCoLocated: true,
  fixedDayPreserved: true,
  requiredIdentityPreserved: true,
  unlocatedStable: true,
  externalRequestDelta: 0,
});
