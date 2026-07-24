import assert from "node:assert/strict";
import {
  isGenerateItineraryFailure,
  normalizeGenerateItineraryResult,
  unwrapGeneratedTripPayload,
} from "../src/lib/trip/itinerary-guards.ts";

const payload = {
  version: 2,
  title: "台北 2 天",
  summary: "test",
  moodTag: "",
  recommendations: [],
  itinerary: [],
};
const success = {
  success: true,
  trip: {
    id: "trip-1",
    title: payload.title,
    destination: "台北",
    days: 2,
    itinerary: [],
    payload,
  },
};
const validatorFailure = {
  success: false,
  errorCode: "itinerary_validator_failed",
  message: "validator failed",
  failureReason: "validator_failed",
  failedRules: ["daily_category_diversity"],
  diagnostics: { affectedDays: [2], dayCount: 6, stopCount: 23 },
};

const directFailure = normalizeGenerateItineraryResult(validatorFailure);
assert.ok(isGenerateItineraryFailure(directFailure));
assert.deepEqual(directFailure.failedRules, ["daily_category_diversity"]);
assert.deepEqual(directFailure.diagnostics?.affectedDays, [2]);

for (const key of ["data", "result", "payload", "response"]) {
  const normalized = normalizeGenerateItineraryResult({ [key]: validatorFailure });
  assert.ok(isGenerateItineraryFailure(normalized), `${key} failure envelope`);
  assert.deepEqual(normalized.failedRules, ["daily_category_diversity"]);
}

assert.equal(normalizeGenerateItineraryResult(success)?.success, true);
assert.equal(
  unwrapGeneratedTripPayload(normalizeGenerateItineraryResult({ data: success }))?.title,
  payload.title,
);
assert.equal(normalizeGenerateItineraryResult({ success: true }), null);
assert.equal(normalizeGenerateItineraryResult({ status: "error" }), null);

const otherFailure = normalizeGenerateItineraryResult({
  result: {
    success: false,
    errorCode: "combination_uncovered",
    message: "not enough combinations",
  },
});
assert.ok(isGenerateItineraryFailure(otherFailure));
assert.equal(otherFailure.errorCode, "combination_uncovered");

const outerSuccessWithUnrelatedNestedFailure = {
  ...success,
  trip: {
    ...success.trip,
    metadata: { success: false, errorCode: "unrelated" },
  },
};
assert.equal(
  normalizeGenerateItineraryResult(outerSuccessWithUnrelatedNestedFailure)?.success,
  true,
);
assert.equal(
  normalizeGenerateItineraryResult({
    wrapper: { data: validatorFailure },
  }),
  null,
  "normalization must not recurse beyond one known envelope layer",
);

console.log("verify-generate-itinerary-result-normalization: ok");
