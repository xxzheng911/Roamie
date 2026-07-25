import assert from "node:assert/strict";
import { refillMissingDaySlots } from "../src/lib/ai/ai-multi-day-planner.ts";
import {
  repairDailyDiversityByMove,
} from "../src/lib/ai/itinerary-day-coverage.ts";
import {
  summarizeDailyCategoryDiversity,
} from "../src/lib/ai/daily-category-diversity.ts";
import {
  evaluateDiversityDegradationEvidence,
  logDiversityDegradationDecision,
} from "../src/lib/ai/itinerary-validator/diversity-degradation.ts";
import { buildSelectedPlaceLock } from "../src/lib/ai/required-anchor-runtime.ts";
import { replanUntilItineraryValid } from "../src/lib/ai/itinerary-validator/replan.ts";

function place(index, primaryType = "tourist_attraction") {
  return {
    id: `ChIJ_telemetry_${index}`,
    name: `Telemetry Place ${index}`,
    localizedDisplayName: `Telemetry Place ${index}`,
    address: "Generic destination",
    lat: 25 + index * 0.001,
    lng: 121,
    rating: 4.6,
    userRatingCount: 1000,
    photoName: null,
    primaryType,
    types: [primaryType, "tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    coordinateSource: "google_places",
  };
}

function entry(candidate, time = "10:00") {
  return { time, label: "景點", name: candidate.name, place: candidate };
}

const logs = [];
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
const capture = (...args) => logs.push(args.join(" "));
console.log = capture;
console.info = capture;
console.warn = capture;
console.error = capture;

try {
  const parkA = place(1, "park");
  const parkB = place(2, "park");
  const museum = place(3, "museum");
  const attraction = place(4);

  summarizeDailyCategoryDiversity(4, [parkA, parkB, museum], {
    repairRound: 2,
    validatorRound: 2,
  });

  repairDailyDiversityByMove({
    plans: [
      { day: 1, entries: [entry(parkA), entry(parkB), entry(attraction)] },
      { day: 2, entries: [entry(museum)] },
      { day: 3, entries: [entry(place(5))] },
    ],
    tripDays: 3,
    telemetryRepairRound: 1,
  });

  refillMissingDaySlots({
    plans: [{ day: 1, entries: [entry(attraction, "09:00")] }],
    pool: [
      attraction,
      place(6, "museum"),
      place(7, "park"),
      place(8, "cafe"),
      place(9, "restaurant"),
      place(10, "market"),
      place(11, "viewpoint"),
    ],
    days: 1,
    style: "classic_landmarks",
    plannedDate: "2026-08-01",
  });

  const validation = {
    pass: false,
    score: 90,
    failedRules: [
      {
        code: "daily_category_diversity",
        message: "park_family:2>1",
        day: 1,
        placeIds: [parkA.id, parkB.id],
        severity: "fail",
      },
    ],
    warnings: [],
    affectedDays: [1],
    affectedPlaceIds: [parkA.id, parkB.id],
    validatorVersion: "telemetry-test",
    replanReasons: ["replan_daily_category_diversity"],
    path: "validator",
  };
  const evidence = evaluateDiversityDegradationEvidence({
    plans: [
      { day: 1, entries: [entry(parkA), entry(parkB)] },
      { day: 2, entries: [entry(museum)] },
    ],
    validation,
    pool: [parkA, parkB, { ...place(12), rating: 1, userRatingCount: 0 }],
    days: 2,
    repairStalled: true,
    cycleDetected: false,
    lock: buildSelectedPlaceLock({ placeIds: [parkA.id, parkB.id] }),
  });
  logDiversityDegradationDecision(evidence);

  replanUntilItineraryValid(
    {
      plans: [
        { day: 1, entries: [entry(attraction)] },
        { day: 2, entries: [entry(museum)] },
      ],
      pool: [attraction, museum, place(13, "viewpoint")],
      days: 2,
      style: "classic_landmarks",
      plannedDate: "2026-08-01",
      validatorInput: {
        requestedDays: 2,
        style: "classic_landmarks",
        plannedDate: "2026-08-01",
      },
    },
    {
      pass: true,
      score: 100,
      failedRules: [],
      warnings: [],
      affectedDays: [],
      affectedPlaceIds: [],
      validatorVersion: "telemetry-test",
      replanReasons: [],
      path: "validator",
    },
  );
} finally {
  Object.assign(console, originalConsole);
}

assert.ok(
  logs.some(
    (line) =>
      line.includes("[DAILY_CATEGORY_VIOLATION]") &&
      line.includes("day=4") &&
      line.includes("family=park_family") &&
      line.includes("overflow=2>1") &&
      line.includes("Telemetry Place 1") &&
      line.includes("repairRound=2"),
  ),
  "hard diversity violation includes places, family, overflow, and rounds",
);
assert.ok(logs.some((line) => line.includes("[DAILY_CATEGORY_SUMMARY]")));
assert.ok(
  logs.some(
    (line) =>
      line.includes("[REPAIR_DIVERSITY_MOVE]") &&
      line.includes("fromDay=1") &&
      line.includes("resolvedOverflow=true"),
  ),
);
assert.ok(
  logs.some(
    (line) =>
      line.includes("[DAY_SLOT_REFILL_APPLY]") &&
      line.includes("beforeSummary=") &&
      line.includes("afterSummary="),
  ),
);
assert.ok(
  logs.some(
    (line) =>
      line.includes("[REPLACEMENT_REJECT]") &&
      line.includes("reason="),
  ),
);
assert.ok(
  logs.some(
    (line) =>
      line.includes("[DIVERSITY_DEGRADATION_DECISION]") &&
      line.includes("failedRuleCount=1") &&
      line.includes("allowed="),
  ),
);
assert.ok(
  logs.some(
    (line) =>
      line.includes("[CANDIDATE_POOL_SUMMARY]") &&
      line.includes("verified=") &&
      line.includes("unused=") &&
      line.includes("replaceable="),
  ),
);

console.log("verify-diversity-violation-telemetry: ok");
