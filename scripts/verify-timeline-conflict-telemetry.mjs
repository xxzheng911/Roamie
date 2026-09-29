/**
 * timeline_conflict diagnostics record same-day duplicate clocks only.
 * They must not change validator pass/fail or persist place identity.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildItineraryValidatorFailureTelemetry,
  collectTimelineConflictDiagnostics,
  sanitizeItineraryFailureTelemetry,
} from "../src/lib/analytics/itinerary-failure-telemetry.ts";
import {
  setItineraryValidatorEnabledOverride,
  validateItineraryPlan,
} from "../src/lib/ai/itinerary-validator/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

function place(index) {
  return {
    id: `timeline-diag-${index}`,
    name: `ClockFixture${index}`,
    address: "diagnostic fixture",
    photoName: "photos/telemetry",
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: true,
    userRatingCount: 40,
    rating: 4.4,
    lat: 35.1 + index * 0.01,
    lng: 129.05 + index * 0.01,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
  };
}

function entry(time, index) {
  return { time, label: "景點", name: place(index).name, place: place(index) };
}

function plansFrom(days) {
  return days.map((times, dayOffset) => ({
    day: dayOffset + 1,
    entries: times.map((time, index) => entry(time, dayOffset * 10 + index)),
  }));
}

function dayTimes(plans) {
  return plans.map((plan) => ({
    day: plan.day,
    times: plan.entries.map((item) => item.time),
  }));
}

function observe(plans, requestedDays) {
  const plansBefore = JSON.stringify(plans);
  const validation = validateItineraryPlan({
    plans,
    requestedDays,
    creationPath: "selected_places",
    placeAuthority: "selected_only",
  });
  const validationBefore = JSON.stringify(validation);
  const blockBefore = validation.pass;
  const telemetry = buildItineraryValidatorFailureTelemetry({
    failedRules: validation.failedRules,
    timelineDayTimes: dayTimes(plans),
  });
  const stored = sanitizeItineraryFailureTelemetry(telemetry);
  assert.equal(JSON.stringify(plans), plansBefore);
  assert.equal(JSON.stringify(validation), validationBefore);
  assert.equal(validation.pass, blockBefore);
  return { validation, telemetry, stored };
}

setItineraryValidatorEnabledOverride(true);

const caseA = observe(
  plansFrom([
    ["09:30", "11:00", "13:00", "15:30", "19:00"],
    ["09:30", "11:00", "14:00", "18:00"],
  ]),
  2,
);
assert.equal(
  caseA.validation.failedRules.some((rule) => rule.code === "timeline_conflict"),
  false,
);
assert.equal(caseA.telemetry.timeline_conflicts, undefined);
assert.equal(caseA.stored.timeline_conflicts, undefined);

const caseB = observe(plansFrom([["09:30", "11:00", "19:00", "19:00", "20:30"]]), 1);
assert.equal(
  caseB.validation.failedRules.some((rule) => rule.code === "timeline_conflict"),
  true,
);
assert.deepEqual(caseB.telemetry.timeline_conflicts, [{ day: 1, time: "19:00", count: 2 }]);
assert.deepEqual(caseB.stored.timeline_conflicts, [{ day: 1, time: "19:00", count: 2 }]);

const caseC = observe(plansFrom([["19:00"], ["19:00"]]), 2);
assert.equal(
  caseC.validation.failedRules.some((rule) => rule.code === "timeline_conflict"),
  false,
);
assert.deepEqual(
  collectTimelineConflictDiagnostics([
    { day: 1, times: ["19:00"] },
    { day: 2, times: ["19:00"] },
  ]),
  [],
);
assert.equal(caseC.telemetry.timeline_conflicts, undefined);

const normalized = buildItineraryValidatorFailureTelemetry({
  failedRules: [{ code: "timeline_conflict" }],
  timelineDayTimes: [{ day: 1, times: ["9:00", "09:00", "", "not-a-time", "24:00", "19:00"] }],
});
assert.deepEqual(normalized.timeline_conflicts, [{ day: 1, time: "09:00", count: 2 }]);

const capped = collectTimelineConflictDiagnostics([
  {
    day: 1,
    times: ["09:00", "09:00", "10:00", "10:00", "11:00", "11:00", "12:00", "12:00", "13:00", "13:00"],
  },
]);
assert.equal(capped.length, 4);
assert.equal(capped.some((item) => item.time === "13:00"), false);

const withoutRule = buildItineraryValidatorFailureTelemetry({
  failedRules: [{ code: "place_duplicate" }],
  timelineDayTimes: [{ day: 1, times: ["19:00", "19:00"] }],
});
assert.equal(withoutRule.timeline_conflicts, undefined);

const poisoned = sanitizeItineraryFailureTelemetry({
  rules: ["timeline_conflict"],
  timeline_conflict_stage: "nightlife_adjustment",
  destination: "釜山",
  prompt: "幫我生成",
  timeline_conflicts: [
    {
      day: 1,
      time: "19:00",
      count: 2,
      name: "ClockFixtureSecret",
      placeId: "ChIJtimelineSecret",
      googlePlaceId: "places/secret",
      lat: 35.158,
      lng: 129.16,
      category: "bar",
      address: "diagnostic fixture",
    },
  ],
});
assert.deepEqual(poisoned.timeline_conflicts, [{ day: 1, time: "19:00", count: 2 }]);
assert.equal(poisoned.timeline_conflict_stage, undefined);
const poisonedJson = JSON.stringify(poisoned);
for (const secret of [
  "ClockFixtureSecret",
  "ChIJtimelineSecret",
  "places/secret",
  "35.158",
  "129.16",
  "釜山",
  "幫我生成",
  "bar",
  "diagnostic fixture",
  "nightlife_adjustment",
]) {
  assert.equal(poisonedJson.includes(secret), false, secret);
}
assert.deepEqual(Object.keys(poisoned.timeline_conflicts[0]).sort(), ["count", "day", "time"]);

const dropped = sanitizeItineraryFailureTelemetry({
  rules: ["place_duplicate"],
  timeline_conflicts: [{ day: 1, time: "19:00", count: 2 }],
});
assert.equal(dropped.timeline_conflicts, undefined);

const telemetrySource = read("src/lib/analytics/itinerary-failure-telemetry.ts");
const functionsSource = read("src/lib/itinerary.functions.ts");
const validatorSource = read("src/lib/ai/itinerary-validator/validate.ts");
assert.match(functionsSource, /timelineDayTimes: finalValidatedPlans\.map/);
assert.match(functionsSource, /times: plan\.entries\.map\(\(entry\) => entry\.time\)/);
assert.doesNotMatch(telemetrySource, /timeline_conflict_stage/);
assert.doesNotMatch(functionsSource, /timeline_conflict_stage/);
assert.equal(validatorSource.includes("time_conflict:day"), true);
assert.doesNotMatch(telemetrySource, /googlePlaceId|placeName|userId|conversation|timeline_conflict_stage/);

console.info("verify-timeline-conflict-telemetry: ok");
setItineraryValidatorEnabledOverride(null);
