/**
 * timeline_normalization records the repair's actual invocation outcome.
 * It must not retimed stops, and it must not infer status from timeline_conflict.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildItineraryValidatorFailureTelemetry,
  sanitizeItineraryFailureTelemetry,
} from "../src/lib/analytics/itinerary-failure-telemetry.ts";
import { repairCrossDayGeographicCohesion } from "../src/lib/ai/cross-day-geographic-cohesion.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const X = { lat: 35.18, lng: 129.08 };
const Y = { lat: 35.05, lng: 129.03 };

function near(origin, index) {
  return {
    lat: origin.lat + index * 0.0012,
    lng: origin.lng + index * 0.0011,
  };
}

function place(id, origin, index, extra = {}) {
  const point = near(origin, index);
  return {
    id,
    googlePlaceId: id,
    name: id,
    address: `${id} street`,
    lat: point.lat,
    lng: point.lng,
    rating: 4.6,
    userRatingCount: 90,
    photoName: null,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    ...extra,
  };
}

function stop(p, time, label = "景點") {
  return { time, label, name: p.name, place: p };
}

function fingerprint(plans) {
  return plans.map((plan) => ({
    day: plan.day,
    stops: plan.entries.map((entry) => ({
      id: entry.place.id,
      time: entry.time,
    })),
  }));
}

function run(plans, pace = "medium") {
  const silent = repairCrossDayGeographicCohesion(plans, {
    generationId: "normalization-outcome",
    stage: "final_pre_persistence",
    plannedDate: "2026-10-01",
    pace,
    logDiagnostics: false,
  });
  const outcome = { status: "not_called" };
  const observed = repairCrossDayGeographicCohesion(plans, {
    generationId: "normalization-outcome",
    stage: "final_pre_persistence",
    plannedDate: "2026-10-01",
    pace,
    logDiagnostics: false,
    normalizationOutcome: outcome,
  });
  assert.deepEqual(fingerprint(observed), fingerprint(silent));
  return { plans: observed, outcome };
}

function productionPlans() {
  const slots = ["09:30", "11:00", "13:00", "15:30", "18:00"];
  const day1 = [
    place("A", Y, 0),
    place("B", X, 0),
    place("C", X, 1),
    place("D", X, 2),
    place("E", X, 3),
  ];
  const day2 = [
    place("F", Y, 1),
    place("G", X, 4),
    place("H", Y, 2),
    place("I", Y, 3),
    place("J", Y, 4),
  ];
  return [
    { day: 1, entries: day1.map((item, index) => stop(item, slots[index])) },
    { day: 2, entries: day2.map((item, index) => stop(item, slots[index])) },
  ];
}

function cohesivePlans() {
  const slots = ["09:30", "11:00", "13:00", "15:30", "18:00"];
  return [
    {
      day: 1,
      entries: ["A", "B", "C", "D", "E"].map((id, index) =>
        stop(place(id, X, index), slots[index]),
      ),
    },
    {
      day: 2,
      entries: ["F", "G", "H", "I", "J"].map((id, index) =>
        stop(place(id, Y, index), slots[index]),
      ),
    },
  ];
}

function night(id, origin, index) {
  return place(id, origin, index, {
    primaryType: "night_market",
    types: ["night_market"],
  });
}

const unchanged = run(cohesivePlans());
assert.equal(unchanged.outcome.status, "not_called");
assert.equal(unchanged.outcome.affectedDays, undefined);
assert.deepEqual(
  fingerprint(unchanged.plans),
  fingerprint(cohesivePlans()),
);

const singleDay = run([
  {
    day: 1,
    entries: [stop(place("ONLY", X, 0), "11:00"), stop(place("ONLY2", X, 1), "11:00")],
  },
]);
assert.equal(singleDay.outcome.status, "not_called");
assert.equal(singleDay.outcome.affectedDays, undefined);

const swapped = run(productionPlans());
assert.equal(swapped.outcome.status, "safe");
assert.deepEqual(swapped.outcome.affectedDays, [1, 2]);
assert.deepEqual(
  swapped.plans[0].entries.map((entry) => entry.place.id),
  ["G", "B", "C", "D", "E"],
);
assert.deepEqual(
  swapped.plans[1].entries.map((entry) => entry.place.id),
  ["F", "A", "H", "I", "J"],
);

const moveSource = ["S1", "S2", "S3", "S4", "S5"].map((id, index) =>
  stop(place(id, Y, index), ["10:00", "12:00", "14:00", "16:00", "18:00"][index]),
);
const moved = run(
  [
    {
      day: 1,
      entries: ["T1", "T2", "T3", "T4", "T5"].map((id, index) =>
        stop(place(id, X, index), ["09:30", "11:00", "13:00", "15:30", "18:00"][index]),
      ),
    },
    { day: 2, entries: [stop(place("MOVE", X, 5), "09:30"), ...moveSource] },
  ],
  "medium",
);
assert.equal(moved.outcome.status, "safe");
assert.deepEqual(moved.outcome.affectedDays, [1, 2]);
assert.equal(
  moved.plans[0].entries.some((entry) => entry.place.id === "MOVE"),
  true,
);

const unsafePlans = [
  {
    day: 1,
    entries: ["NA", "NB", "NC", "ND", "NE"].map((id, index) =>
      stop(night(id, index === 0 ? Y : X, index), "19:00", "夜間"),
    ),
  },
  {
    day: 2,
    entries: ["NF", "NG", "NH", "NI", "NJ"].map((id, index) =>
      stop(night(id, index === 1 ? X : Y, index), "19:00", "夜間"),
    ),
  },
];
const unsafeBefore = unsafePlans.map((plan) => plan.entries.map((entry) => entry.place.id));
const unsafe = run(unsafePlans);
assert.equal(unsafe.outcome.status, "not_called");
assert.equal(unsafe.outcome.affectedDays, undefined);
assert.equal(unsafe.outcome.failures, undefined);
assert.equal(
  unsafe.plans.every((plan) => plan.entries.every((entry) => entry.time === "19:00")),
  true,
);
assert.deepEqual(
  unsafe.plans.map((plan) => plan.entries.map((entry) => entry.place.id)),
  unsafeBefore,
);

const duplicateClocks = [{ day: 1, time: "12:30", count: 2 }];
const withOutcome = buildItineraryValidatorFailureTelemetry({
  failedRules: [{ code: "timeline_conflict" }],
  timelineDayTimes: [{ day: 1, times: ["12:30", "12:30", "14:00"] }, { day: 2, times: ["09:30"] }],
  timelineNormalization: unchanged.outcome,
  requestedDayCount: 2,
  selectedInputCount: 22,
  usableCandidateCount: 22,
  deliveredPlaceCount: 10,
  perDayPlaceCounts: [5, 5],
  requiredCapacity: 4,
  geographicRejectionCount: 0,
  eligibilityRejectionCount: 0,
});
const withoutOutcome = buildItineraryValidatorFailureTelemetry({
  failedRules: [{ code: "timeline_conflict" }],
  timelineDayTimes: [{ day: 1, times: ["12:30", "12:30", "14:00"] }, { day: 2, times: ["09:30"] }],
  requestedDayCount: 2,
  selectedInputCount: 22,
  usableCandidateCount: 22,
  deliveredPlaceCount: 10,
  perDayPlaceCounts: [5, 5],
  requiredCapacity: 4,
  geographicRejectionCount: 0,
  eligibilityRejectionCount: 0,
});
assert.deepEqual(withOutcome.timeline_conflicts, duplicateClocks);
assert.deepEqual(withoutOutcome.timeline_conflicts, duplicateClocks);
assert.equal(withOutcome.timeline_normalization.status, "not_called");
assert.equal(withOutcome.timeline_normalization.affected_days, undefined);
assert.equal(withoutOutcome.timeline_normalization, undefined);

const storedSafe = sanitizeItineraryFailureTelemetry({
  ...withOutcome,
  timeline_normalization: {
    status: "safe",
    affected_days: [2, 1, 1],
    name: "ClockFixtureSecret",
    googlePlaceId: "ChIJtimelineSecret",
    placeId: "places/secret",
    lat: 35.158,
    lng: 129.16,
    address: "diagnostic fixture",
    category: "bar",
    destination: "釜山",
    prompt: "幫我生成",
    userId: "user-1",
    ip: "127.0.0.1",
  },
});
assert.deepEqual(storedSafe.timeline_conflicts, duplicateClocks);
assert.deepEqual(storedSafe.timeline_normalization, {
  status: "safe",
  affected_days: [1, 2],
});
assert.deepEqual(Object.keys(storedSafe.timeline_normalization).sort(), ["affected_days", "status"]);
const storedJson = JSON.stringify(storedSafe);
for (const secret of [
  "ClockFixtureSecret",
  "ChIJtimelineSecret",
  "places/secret",
  "35.158",
  "129.16",
  "diagnostic fixture",
  "釜山",
  "幫我生成",
  "user-1",
  "127.0.0.1",
  "bar",
]) {
  assert.equal(storedJson.includes(secret), false, secret);
}

const storedUnsafe = sanitizeItineraryFailureTelemetry({
  rules: ["timeline_conflict"],
  per_day_place_counts: [5, 5],
  timeline_conflicts: duplicateClocks,
  timeline_normalization: { status: "no_safe_slot", affected_days: [1] },
});
assert.deepEqual(storedUnsafe.timeline_conflicts, duplicateClocks);
assert.deepEqual(storedUnsafe.timeline_normalization, {
  status: "no_safe_slot",
  affected_days: [1],
});

const ignored = buildItineraryValidatorFailureTelemetry({
  failedRules: [{ code: "place_duplicate" }],
  timelineNormalization: { status: "no_safe_slot", affectedDays: [1] },
  timelineDayTimes: [{ day: 1, times: ["12:30", "12:30"] }],
});
assert.equal(ignored.timeline_normalization, undefined);
assert.equal(ignored.timeline_conflicts, undefined);

const invented = sanitizeItineraryFailureTelemetry({
  rules: ["timeline_conflict"],
  timeline_conflicts: duplicateClocks,
  timeline_normalization: { status: "business_hours", affected_days: [1] },
});
assert.deepEqual(invented.timeline_conflicts, duplicateClocks);
assert.equal(invented.timeline_normalization, undefined);

const illegalDays = sanitizeItineraryFailureTelemetry({
  rules: ["timeline_conflict"],
  per_day_place_counts: [5, 5],
  timeline_normalization: { status: "safe", affected_days: [1, 99] },
});
assert.deepEqual(illegalDays.timeline_normalization, { status: "safe" });

const strippedNotCalled = sanitizeItineraryFailureTelemetry({
  rules: ["timeline_conflict"],
  timeline_normalization: { status: "not_called", affected_days: [1], name: "hidden" },
});
assert.deepEqual(strippedNotCalled.timeline_normalization, { status: "not_called" });

const cohesionSource = read("src/lib/ai/cross-day-geographic-cohesion.ts");
const functionsSource = read("src/lib/itinerary.functions.ts");
const telemetrySource = read("src/lib/analytics/itinerary-failure-telemetry.ts");
const validatorSource = read("src/lib/ai/itinerary-validator/validate.ts");
const guardSource = read("src/lib/abuse-guard.server.ts") + read("src/lib/abuse-guard-do.ts");
assert.match(cohesionSource, /invoked\.push\(\{ day: plan\.day, safe: normalized\.safe \}\)/);
assert.match(cohesionSource, /outcome\.status = "not_called"/);
assert.match(cohesionSource, /outcome\.status = "safe"/);
assert.match(cohesionSource, /outcome\.status = "no_safe_slot"/);
assert.doesNotMatch(cohesionSource, /timeline_conflict/);
assert.match(functionsSource, /timelineNormalization: finalTimelineNormalization/);
assert.match(
  functionsSource,
  /try \{\s*failureDiagnostics = buildItineraryValidatorFailureTelemetry\(/,
);
assert.match(
  functionsSource,
  /try \{\s*await recordGenerationOutcome\(false, "itinerary_validator_failed", failureDiagnostics\);/,
);
assert.doesNotMatch(validatorSource, /timeline_normalization/);
assert.doesNotMatch(guardSource, /timeline_normalization|itinerary-failure-telemetry/);
assert.doesNotMatch(telemetrySource, /googlePlaceId|placeName|userId|conversation/);

console.info("verify-timeline-normalization-telemetry: ok");
