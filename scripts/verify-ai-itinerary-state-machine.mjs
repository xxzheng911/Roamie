import assert from "node:assert/strict";
import {
  AI_ITINERARY_FAILED_OFFER_MESSAGE,
  createItineraryFromSession,
  logAiState,
} from "../src/lib/ai/ai-itinerary-state-machine.ts";
import { ITINERARY_PARTIAL_FAILURE_MESSAGE } from "../src/lib/trip/itinerary-guards.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { buildFallbackItineraryFromPlaces } from "../src/lib/trip/itinerary-guards.ts";

assert(
  AI_ITINERARY_FAILED_OFFER_MESSAGE.includes("是否改成列出必去景點"),
  "failed offer message matches spec",
);
assert(
  ITINERARY_PARTIAL_FAILURE_MESSAGE === AI_ITINERARY_FAILED_OFFER_MESSAGE,
  "partial failure message aligned with state machine",
);

const places = [
  {
    name: "國立臺東美術館",
    placeName: "國立臺東美術館",
    googlePlaceId: "ChIJTaitungMuseumP25",
    address: "台東市浙江路350號",
    lat: 22.76,
    lng: 121.14,
  },
  {
    name: "小野柳",
    placeName: "小野柳",
    googlePlaceId: "ChIJXiaoyeliuP25",
    address: "台東市松江路一段500號",
    lat: 22.77,
    lng: 121.15,
  },
  {
    name: "初鹿牧場",
    placeName: "初鹿牧場",
    googlePlaceId: "ChIJChuluRanchP25",
    address: "卑南鄉明峰村牧場1號",
    lat: 22.78,
    lng: 121.16,
  },
  {
    name: "台東觀光夜市",
    placeName: "台東觀光夜市",
    googlePlaceId: "ChIJTaitungNightMarketP25",
    address: "台東市正氣路",
    lat: 22.75,
    lng: 121.13,
  },
  {
    name: "鯉魚山",
    placeName: "鯉魚山",
    googlePlaceId: "ChIJLiyuMountainP25",
    address: "台東市博愛路",
    lat: 22.74,
    lng: 121.12,
  },
];

const built = buildFallbackItineraryFromPlaces(places, 2, "2026-07-01", "台東", {
  pace: "slow",
});
assert(built.length >= 4, "builds a viable two-day itinerary without geocode");

const session = createEmptySession();
assert(session.aiItineraryState == null, "empty session has no ai itinerary state");

logAiState("COLLECTING");
logAiState("SUCCESS", "test");

const validatorFailureLogs = [];
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
const captureValidatorFailure = (...args) =>
  validatorFailureLogs.push(
    args
      .map((arg) => (arg && typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
      .join(" "),
  );
console.log = captureValidatorFailure;
console.info = captureValidatorFailure;
console.warn = captureValidatorFailure;
console.error = captureValidatorFailure;
let validatorFailure;
try {
  validatorFailure = await createItineraryFromSession({
    session: {
      ...createEmptySession(),
      selectedPlaces: places,
      travelContext: { interests: [], selectedCombinationIds: [1, 3] },
    },
    generateInput: {
      destination: "台東",
      days: 2,
      selectedPlaces: places,
      placeAuthority: "selected_only",
    },
    generateItineraryFn: async () => ({
      success: false,
      errorCode: "itinerary_validator_failed",
      message: "daily_category_diversity",
      failureReason: "validator_failed",
      failedRules: ["daily_category_diversity", "missing_days"],
      diagnostics: {
        inputDayCount: 2,
        outputDayCount: 1,
        requiredAnchorCount: 5,
        requiredAnchorSatisfiedCount: 4,
        missingRequiredAnchorCount: 1,
        excludedCount: 1,
        excludedViolationCount: 0,
        duplicateCount: 0,
        invalidPlaceCount: 0,
        invalidDayCount: 1,
        routeViolationCount: 0,
        capacityViolationCount: 0,
      },
    }),
  });
} finally {
  Object.assign(console, originalConsole);
}
assert.equal(validatorFailure.ok, false);
const validatorChain = validatorFailureLogs.find((line) =>
  line.includes("[ITINERARY_FAILURE_CHAIN]"),
);
assert.ok(validatorChain, "validator failure chain logged");
assert.match(validatorChain, /"primary":"itinerary_validator_failed"/);
assert.match(validatorChain, /"validator":"validator_failed"/);
assert.match(validatorChain, /"payloadPresent":false/);
assert.doesNotMatch(validatorChain, /payload_incomplete/);
const validatorResultDiagnostic = validatorFailureLogs.find((line) =>
  line.includes("[ITINERARY_VALIDATOR_RESULT]"),
);
assert.ok(validatorResultDiagnostic, "validator failure emits privacy-safe client diagnostic");
assert.match(validatorResultDiagnostic, /"failedRules":\["daily_category_diversity","missing_days"\]/);
assert.match(validatorResultDiagnostic, /"missingRequiredAnchorCount":1/);
assert.doesNotMatch(validatorResultDiagnostic, /國立臺東美術館|台東市浙江路|ChIJ/);

const envelopedValidatorFailureLogs = [];
const captureEnvelopedValidatorFailure = (...args) =>
  envelopedValidatorFailureLogs.push(args.join(" "));
console.log = captureEnvelopedValidatorFailure;
console.info = captureEnvelopedValidatorFailure;
console.warn = captureEnvelopedValidatorFailure;
console.error = captureEnvelopedValidatorFailure;
let envelopedValidatorFailure;
try {
  envelopedValidatorFailure = await createItineraryFromSession({
    session: {
      ...createEmptySession(),
      selectedPlaces: places,
      travelContext: { interests: [], selectedCombinationIds: [1, 2, 3] },
    },
    generateInput: {
      destination: "台東",
      days: 2,
      selectedPlaces: places,
      placeAuthority: "selected_only",
    },
    generateItineraryFn: async () => ({
      data: {
        success: false,
        errorCode: "itinerary_validator_failed",
        message: "validator failed",
        failureReason: "validator_failed",
        failedRules: ["daily_category_diversity"],
      },
    }),
  });
} finally {
  Object.assign(console, originalConsole);
}
assert.equal(envelopedValidatorFailure.ok, false);
assert.ok(
  envelopedValidatorFailureLogs.some(
    (line) =>
      line.includes("[ITINERARY_FAILURE_CHAIN]") &&
      line.includes("itinerary_validator_failed") &&
      line.includes("daily_category_diversity") &&
      !line.includes("payload_incomplete"),
  ),
  "enveloped validator failure preserves taxonomy",
);
assert.ok(
  !envelopedValidatorFailureLogs.some((line) => line.includes("[STOP_UNWRAP_INTERNAL]")),
  "enveloped validator failure does not enter payload unwrap failure path",
);

const transportValidatorFailureLogs = [];
const captureTransportValidatorFailure = (...args) =>
  transportValidatorFailureLogs.push(args.join(" "));
console.log = captureTransportValidatorFailure;
console.info = captureTransportValidatorFailure;
console.warn = captureTransportValidatorFailure;
console.error = captureTransportValidatorFailure;
let transportValidatorFailure;
try {
  transportValidatorFailure = await createItineraryFromSession({
    session: {
      ...createEmptySession(),
      selectedPlaces: places,
      travelContext: { interests: [], selectedCombinationIds: [1, 2, 3] },
    },
    generateInput: {
      destination: "台東",
      days: 2,
      selectedPlaces: places,
      placeAuthority: "selected_only",
    },
    generateItineraryFn: async () => ({
      result: {
        result: {
          success: false,
          errorCode: "itinerary_validator_failed",
          message: "validator failed",
          failureReason: "validator_failed",
          failedRules: ["daily_category_diversity"],
          diagnostics: { affectedDays: [1], dayCount: 2, stopCount: 5 },
        },
        context: {},
      },
    }),
  });
} finally {
  Object.assign(console, originalConsole);
}
assert.equal(transportValidatorFailure.ok, false);
assert.ok(
  transportValidatorFailureLogs.some(
    (line) =>
      line.includes("[GENERATE_ITINERARY_RAW_SHAPE]") &&
      line.includes("successPath=result.result.success") &&
      line.includes("errorCodePath=result.result.errorCode") &&
      line.includes("normalizedKind=failure"),
  ),
  "transport result shape is safely reported",
);
assert.ok(
  transportValidatorFailureLogs.some(
    (line) =>
      line.includes("[ITINERARY_FAILURE_CHAIN]") &&
      line.includes('"dayCount":2') &&
      line.includes('"stopCount":5') &&
      line.includes("daily_category_diversity") &&
      !line.includes("payload_incomplete"),
  ),
  "transport validator failure preserves diagnostics and taxonomy",
);
assert.ok(
  !transportValidatorFailureLogs.some((line) => line.includes("[STOP_UNWRAP_INTERNAL]")),
  "transport validator failure never enters payload unwrap",
);

const missingPayloadLogs = [];
const captureMissingPayload = (...args) =>
  missingPayloadLogs.push(
    args
      .map((arg) => (arg && typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
      .join(" "),
  );
console.log = captureMissingPayload;
console.info = captureMissingPayload;
console.warn = captureMissingPayload;
console.error = captureMissingPayload;
let missingPayload;
try {
  missingPayload = await createItineraryFromSession({
    session: {
      ...createEmptySession(),
      selectedPlaces: places,
      travelContext: { interests: [], selectedCombinationIds: [1, 3] },
      planningConstraints: {
        acceptedCandidateIds: places.map((place) => place.googlePlaceId),
        rejectedCandidateIds: [],
        mustIncludePlaces: [],
        excludedPlaces: [],
        clarificationRequired: false,
      },
    },
    generateInput: {
      destination: "台東",
      days: 6,
      selectedPlaces: places,
      generationId: "p25-missing-payload-test",
    },
    generateItineraryFn: async () => ({
      success: true,
      trip: {
        id: "missing-payload",
        title: "missing",
        destination: "台東",
        days: 6,
        itinerary: [],
        payload: null,
      },
    }),
  });
} finally {
  Object.assign(console, originalConsole);
}
assert.equal(missingPayload.ok, false);
assert.ok(
  missingPayloadLogs.some(
    (line) => line.includes("[ITINERARY_FAILURE_REASON]") && line.includes("payload_incomplete"),
  ),
  "genuinely missing success payload remains payload_incomplete",
);
assert.ok(
  missingPayloadLogs.some(
    (line) =>
      line.includes("[ITINERARY_RESPONSE_SHAPE]") &&
      line.includes('"generationId":"p25-missing-payload-test"') &&
      line.includes('"successDiscriminant":"true"') &&
      line.includes('"tripPresent":true') &&
      line.includes('"payloadPresent":false'),
  ),
  "safe production response shape evidence is emitted",
);
assert.ok(
  missingPayloadLogs.some(
    (line) =>
      line.includes("[ITINERARY_PAYLOAD_VALIDATION]") &&
      line.includes('"stage":"trip_payload_unwrap"') &&
      line.includes('"valid":false') &&
      line.includes('"missingFieldCodes":["trip.payload"]') &&
      line.includes('"requiredAnchorCount":5'),
  ),
  "payload validation emits concrete missing field codes",
);

console.log("verify-ai-itinerary-state-machine: ok");
