import assert from "node:assert/strict";
import {
  describeGenerateItineraryRawShape,
  isGenerateItineraryFailure,
  missingGenerateItineraryResultFields,
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

const tanStackTransportEnvelope = {
  result: {
    result: validatorFailure,
    error: undefined,
    context: {},
  },
};
const normalizedTransportFailure = normalizeGenerateItineraryResult(tanStackTransportEnvelope);
assert.ok(isGenerateItineraryFailure(normalizedTransportFailure));
assert.deepEqual(normalizedTransportFailure.failedRules, ["daily_category_diversity"]);
assert.deepEqual(normalizedTransportFailure.diagnostics?.affectedDays, [2]);
const transportFailureShape = describeGenerateItineraryRawShape(
  tanStackTransportEnvelope,
  normalizedTransportFailure,
);
assert.equal(transportFailureShape.successPath, "result.result.success");
assert.equal(transportFailureShape.errorCodePath, "result.result.errorCode");
assert.equal(transportFailureShape.normalizedKind, "failure");
assert.deepEqual(transportFailureShape.tripKeys, []);

const normalizedTransportSuccess = normalizeGenerateItineraryResult({
  result: { result: success, error: undefined, context: {} },
});
assert.equal(normalizedTransportSuccess?.success, true);
assert.equal(unwrapGeneratedTripPayload(normalizedTransportSuccess)?.title, payload.title);
const transportSuccessShape = describeGenerateItineraryRawShape(
  { result: { result: success, error: undefined, context: {} } },
  normalizedTransportSuccess,
);
assert.equal(transportSuccessShape.payloadPath, "result.result.trip.payload");
assert.equal(transportSuccessShape.tripItineraryIsArray, true);
assert.equal(transportSuccessShape.payloadItineraryIsArray, true);

const nativeNestedEnvelope = {
  result: { result: { result: success, context: {} }, context: {} },
};
const normalizedNativeSuccess = normalizeGenerateItineraryResult(nativeNestedEnvelope);
assert.equal(normalizedNativeSuccess?.success, true);
const nativeShape = describeGenerateItineraryRawShape(
  nativeNestedEnvelope,
  normalizedNativeSuccess,
);
assert.equal(nativeShape.transportEnvelopeDepth, 3);
assert.equal(nativeShape.successDiscriminant, "true");
assert.equal(nativeShape.tripPresent, true);
assert.equal(nativeShape.payloadPresent, true);

assert.equal(
  normalizeGenerateItineraryResult({
    data: { foo: { result: validatorFailure } },
  }),
  null,
  "normalization must only follow fixed whitelisted paths",
);

assert.equal(normalizeGenerateItineraryResult(success)?.success, true);
assert.equal(
  unwrapGeneratedTripPayload(normalizeGenerateItineraryResult({ data: success }))?.title,
  payload.title,
);
assert.equal(normalizeGenerateItineraryResult({ success: true }), null);
assert.equal(normalizeGenerateItineraryResult({ status: "error" }), null);
assert.deepEqual(missingGenerateItineraryResultFields({ success: true }), ["trip"]);
assert.deepEqual(
  missingGenerateItineraryResultFields({ result: { result: { success: true, trip: {} } } }),
  ["result.result.trip.payload"],
);
assert.deepEqual(
  missingGenerateItineraryResultFields({ result: { result: { result: { success: true } } } }),
  ["result.result.result.trip"],
);
assert.deepEqual(
  missingGenerateItineraryResultFields({ data: { success: false, errorCode: "failed" } }),
  ["data.message"],
);

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
