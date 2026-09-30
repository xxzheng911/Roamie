/**
 * Validator-failure telemetry is counts and allowlisted rule codes only.
 * It must not change itinerary, validator, or selected_only results.
 */
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ITINERARY_FAILURE_RULE_CODES,
  buildItineraryValidatorFailureTelemetry,
  sanitizeItineraryFailureTelemetry,
} from "../src/lib/analytics/itinerary-failure-telemetry.ts";
import {
  ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
  setItineraryValidatorEnabledOverride,
  shouldBlockItineraryDelivery,
  validateItineraryPlan,
} from "../src/lib/ai/itinerary-validator/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

function place(index) {
  return {
    id: `telemetry-stop-${index}`,
    name: `Label${index}Q`,
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
    lat: 35.1 + index * 0.02,
    lng: 129.05 + index * 0.02,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
  };
}

function entry(time, p) {
  return { time, label: "景點", name: p.name, place: p };
}

const slots = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];
function dayEntries(start, count) {
  return Array.from({ length: count }, (_, offset) => {
    const placeIndex = start + offset;
    return entry(slots[offset] ?? "20:30", place(placeIndex));
  });
}

setItineraryValidatorEnabledOverride(true);
const plans = [
  { day: 1, entries: dayEntries(0, 12) },
  { day: 2, entries: dayEntries(12, 10) },
];
const plansBefore = JSON.stringify(plans);
const validation = validateItineraryPlan({
  plans,
  requestedDays: 2,
  creationPath: "selected_places",
  placeAuthority: "selected_only",
  lockedPlaceIds: plans.flatMap((plan) => plan.entries.map((item) => item.place.id)),
  lockedPlaceNames: plans.flatMap((plan) => plan.entries.map((item) => item.name)),
});
assert.equal(JSON.stringify(plans), plansBefore, "telemetry observation must not mutate plans");
assert.equal(validation.pass, false);
assert.equal(shouldBlockItineraryDelivery(validation), true);
assert.ok(
  validation.failedRules.some((rule) => rule.code === "timeline_conflict"),
  `expected timeline_conflict, got ${validation.failedRules.map((rule) => rule.code).join(",")}`,
);

const coverageRules = [
  ...validation.failedRules,
  {
    code: "persistence_mismatch",
    message: "required_anchor_coverage_mismatch",
    severity: "fail",
    placeIds: ["ChIJsecretPlace"],
  },
  {
    code: "timeline_conflict",
    message: "time_conflict:海雲台@35.158,129.160 user said 釜山",
  },
];
const telemetry = buildItineraryValidatorFailureTelemetry({
  failedRules: coverageRules,
  selectedInputCount: 22,
  normalizedCount: null,
  usableCandidateCount: 20,
  deliveredPlaceCount: 22,
  perDayPlaceCounts: [12, 10],
  requiredCapacity: 4,
  geographicRejectionCount: 0,
  dedupeRejectionCount: null,
  eligibilityRejectionCount: 1,
});
assert.ok(telemetry.rules.includes("timeline_conflict"));
assert.equal(telemetry.timeline_conflicts, undefined);
assert.ok(telemetry.rules.includes("persistence_mismatch"));
assert.ok(telemetry.rules.includes("required_anchor_coverage_mismatch"));
assert.ok(telemetry.rules.length <= 8);
assert.equal(telemetry.normalized_count, undefined);
assert.equal(telemetry.dedupe_rejection_count, undefined);
for (const rule of telemetry.rules) {
  assert.ok(ITINERARY_FAILURE_RULE_CODES.includes(rule), rule);
}
const serialized = JSON.stringify(telemetry);
assert.equal(serialized.includes("海雲台"), false);
assert.equal(serialized.includes("ChIJ"), false);
assert.equal(serialized.includes("釜山"), false);
assert.equal(serialized.includes("35.158"), false);
assert.equal(serialized.includes("129.160"), false);
assert.equal(serialized.includes("placeIds"), false);

const manyCodes = ITINERARY_FAILURE_RULE_CODES.map((code) => ({ code }));
const capped = buildItineraryValidatorFailureTelemetry({ failedRules: manyCodes });
assert.equal(capped.rules.length, 8);

const sanitized = sanitizeItineraryFailureTelemetry({
  rules: ["timeline_conflict", "not_a_rule", "海雲台", "place_duplicate"],
  selected_input_count: 22.5,
  usable_candidate_count: 20,
  per_day_place_counts: [9, 7, "bad"],
  destination: "釜山",
  googlePlaceId: "ChIJsecret",
  lat: 35.1,
  userId: "user-1",
  prompt: "幫我生成",
});
assert.deepEqual(sanitized.rules, ["timeline_conflict", "place_duplicate"]);
assert.equal(sanitized.selected_input_count, undefined);
assert.equal(sanitized.usable_candidate_count, 20);
assert.equal(sanitized.per_day_place_counts, undefined);
assert.equal(sanitized.timeline_conflicts, undefined);
assert.equal(JSON.stringify(sanitized).includes("釜山"), false);
assert.equal(JSON.stringify(sanitized).includes("ChIJ"), false);
assert.equal(JSON.stringify(sanitized).includes("user-1"), false);
const allowedKeys = new Set([
  "rules",
  "selected_input_count",
  "normalized_count",
  "usable_candidate_count",
  "delivered_place_count",
  "per_day_place_counts",
  "required_capacity",
  "geographic_rejection_count",
  "dedupe_rejection_count",
  "eligibility_rejection_count",
  "timeline_conflicts",
  "timeline_normalization",
]);
for (const key of Object.keys(sanitized)) assert.ok(allowedKeys.has(key), key);
for (const [key, value] of Object.entries(sanitized)) {
  if (key === "rules") continue;
  if (key === "timeline_conflicts") {
    assert.equal(Array.isArray(value), true);
  } else if (key === "timeline_normalization") {
    assert.equal(typeof value.status, "string");
  } else if (key === "per_day_place_counts") {
    assert.ok(value.every((item) => Number.isInteger(item)));
  } else {
    assert.equal(Number.isInteger(value), true, key);
  }
}

const sparse = validateItineraryPlan({
  plans: [
    { day: 1, entries: [entry("10:00", place(100))] },
    { day: 2, entries: [entry("10:00", place(101))] },
  ],
  requestedDays: 2,
  creationPath: "selected_places",
  placeAuthority: "selected_only",
});
assert.equal(
  sparse.failedRules.some((rule) => rule.code === "day_place_count"),
  false,
  "selected_only sparse days stay warnings",
);
assert.equal(sparse.pass, true);
assert.equal(shouldBlockItineraryDelivery(sparse), false);

const functionsSource = read("src/lib/itinerary.functions.ts");
const telemetrySource = read("src/lib/analytics/itinerary-failure-telemetry.ts");
const recordSource = read("src/lib/analytics/record.server.ts");
const clientSource = read("src/lib/ai/ai-itinerary-state-machine.ts");
assert.match(
  functionsSource,
  /try \{\s*await recordGenerationOutcome\(false, "itinerary_validator_failed", failureDiagnostics\);/,
);
assert.match(functionsSource, /errorCode: "itinerary_validator_failed"/);
assert.match(clientSource, /message: ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE/);
assert.equal(
  read("src/lib/ai/itinerary-validator/types.ts").includes(ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE),
  true,
);
// Counts are allowed in server analytics metadata, never in returned client payloads.
const sourceFile = ts.createSourceFile("itinerary.functions.ts", functionsSource, ts.ScriptTarget.Latest, true);
function checkReturnPayloads(node) {
  if (ts.isReturnStatement(node) && node.expression) {
    assert.doesNotMatch(node.expression.getText(sourceFile), /selected_input_count|normalized_count|usable_candidate_count/);
  }
  ts.forEachChild(node, checkReturnPayloads);
}
checkReturnPayloads(sourceFile);
assert.doesNotMatch(functionsSource, /message: failureDiagnostics|diagnostics: failureDiagnostics/);
assert.match(recordSource, /sanitizeItineraryFailureTelemetry/);
assert.doesNotMatch(telemetrySource, /googlePlaceId|placeName|userId|conversation/);
assert.doesNotMatch(
  read("src/lib/abuse-guard.server.ts") + read("src/lib/abuse-guard-do.ts"),
  /itinerary-failure-telemetry/,
);

console.info("verify-itinerary-failure-telemetry: ok");
setItineraryValidatorEnabledOverride(null);
