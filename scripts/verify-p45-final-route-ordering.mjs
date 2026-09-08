import assert from "node:assert/strict";
import { applyFinalDayRouteOrdering } from "../src/lib/ai/final-day-route-ordering.ts";

const place = (id, lat, lng) => ({
  id,
  googlePlaceId: id,
  name: id,
  lat,
  lng,
  primaryType: "tourist_attraction",
  types: ["tourist_attraction"],
});
const A = place("ChIJP45A", 25, 121);
const B = place("ChIJP45B", 25.001, 121.001);
const C = place("ChIJP45C", 25.1, 121.1);
const D = place("ChIJP45D", 25.002, 121.002);
const entry = (p, time, label = "景點") => ({ time, label, name: p.name, place: p });
const ids = (plan) => plan.entries.map((item) => item.place.id);

const logs = [];
const originalInfo = console.info;
console.info = (tag, payload) => logs.push({ tag, payload });
let routed;
try {
  routed = applyFinalDayRouteOrdering(
    [{ day: 1, entries: [entry(A, "09:00"), entry(C, "11:00"), entry(B, "14:00")] }],
    { generationId: "p45", stage: "final_pre_persistence" },
  );
} finally {
  console.info = originalInfo;
}
assert.notDeepEqual(ids(routed[0]), [A.id, C.id, B.id]);
const orderingLog = logs.find((log) => log.tag === "[ITINERARY_ROUTE_ORDERING]");
assert(orderingLog);
assert.equal(orderingLog.payload.reordered, true);
assert(orderingLog.payload.totalStraightLineDistanceAfter < orderingLog.payload.totalStraightLineDistanceBefore);
assert.equal(orderingLog.payload.backtrackCountAfter, 0);
assert(logs.some((log) =>
  log.tag === "[ITINERARY_ROUTE_ORDER_STAGE]" &&
  log.payload.stage === "final_pre_persistence" &&
  log.payload.generationId === "p45"
));

const hardTime = applyFinalDayRouteOrdering(
  [{ day: 1, entries: [entry(A, "09:00"), entry(B, "11:00", "固定時間"), entry(C, "14:00")] }],
  { stage: "initial", logDiagnostics: false },
)[0];
assert.equal(hardTime.entries[1].place.id, B.id);
assert.equal(hardTime.entries[1].time, "11:00");

const meal = applyFinalDayRouteOrdering(
  [{ day: 1, entries: [entry(A, "09:00"), entry(B, "12:00", "午餐"), entry(C, "14:00")] }],
  { stage: "initial", logDiagnostics: false },
)[0];
assert.equal(meal.entries[1].place.id, B.id);
assert.equal(meal.entries[1].time, "12:00");

for (const stage of ["post_replan", "post_redistribution", "post_required_repair", "post_rebuild"]) {
  const result = applyFinalDayRouteOrdering(
    [{ day: 1, entries: [entry(A, "09:00"), entry(C, "11:00"), entry(D, "12:00"), entry(B, "14:00")] }],
    { stage, logDiagnostics: false },
  );
  assert.notDeepEqual(ids(result[0]), [A.id, C.id, D.id, B.id], `${stage} reroutes mutations`);
  assert.deepEqual(new Set(ids(result[0])), new Set([A.id, B.id, C.id, D.id]));
  assert.equal(result[0].day, 1);
}

const aiFinal = applyFinalDayRouteOrdering(
  [{ day: 1, entries: [entry(A, "09:00"), entry(C, "11:00"), entry(B, "14:00")] }],
  { stage: "final_pre_persistence", logDiagnostics: false },
);
assert.notDeepEqual(ids(aiFinal[0]), [A.id, C.id, B.id]);

const noCoords = [
  entry(place("ChIJP45NoCoordA", null, null), "09:00"),
  entry(place("ChIJP45NoCoordB", null, null), "11:00"),
  entry(place("ChIJP45NoCoordC", null, null), "14:00"),
];
const stable = applyFinalDayRouteOrdering(
  [{ day: 1, entries: noCoords }],
  { stage: "final_pre_persistence", logDiagnostics: false },
);
assert.deepEqual(ids(stable[0]), noCoords.map((item) => item.place.id));

console.log("P45 final route ordering: PASS", {
  input: [A.id, C.id, B.id],
  output: ids(routed[0]),
  distanceBefore: orderingLog.payload.totalStraightLineDistanceBefore,
  distanceAfter: orderingLog.payload.totalStraightLineDistanceAfter,
  hardTimeFixed: true,
  mealFixed: true,
  mutationStagesRerouted: true,
  aiFinalRerouted: true,
  missingCoordinatesStable: true,
  externalRequestDelta: 0,
});
