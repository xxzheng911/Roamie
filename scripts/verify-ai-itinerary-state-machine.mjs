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
  { name: "國立臺東美術館", placeName: "國立臺東美術館", googlePlaceId: "p1", lat: 22.76, lng: 121.14 },
  { name: "小野柳", placeName: "小野柳", googlePlaceId: "p2", lat: 22.77, lng: 121.15 },
  { name: "初鹿牧場", placeName: "初鹿牧場", googlePlaceId: "p3", lat: 22.78, lng: 121.16 },
  { name: "台東觀光夜市", placeName: "台東觀光夜市", googlePlaceId: "p4", lat: 22.75, lng: 121.13 },
  { name: "鯉魚山", placeName: "鯉魚山", googlePlaceId: "p5", lat: 22.74, lng: 121.12 },
];

const built = buildFallbackItineraryFromPlaces(places, 2, "2026-07-01");
assert(built.length === 5, "builds itinerary from 5 places without geocode");

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
const captureValidatorFailure = (...args) => validatorFailureLogs.push(args.join(" "));
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
    },
    generateItineraryFn: async () => ({
      success: false,
      errorCode: "itinerary_validator_failed",
      message: "daily_category_diversity",
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
const captureMissingPayload = (...args) => missingPayloadLogs.push(args.join(" "));
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
    },
    generateInput: {
      destination: "台東",
      days: 6,
      selectedPlaces: places,
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

console.log("verify-ai-itinerary-state-machine: ok");
