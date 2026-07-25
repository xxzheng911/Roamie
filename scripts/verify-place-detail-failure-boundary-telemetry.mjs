import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  classifyPlaceDetailFailure,
  inspectPlaceDetailResponseShape,
  logPlaceDetailRequestFailure,
  logPlaceDetailResultBoundary,
  maskPlaceDetailId,
  parseGooglePlaceDetailError,
  placeDetailIdKind,
  placeDetailFieldMaskHash,
} from "../src/lib/place-detail-failure-telemetry.ts";
import { fetchGooglePlaceDetailsForHandoff } from "../src/lib/place-detail-resolve.ts";

const failures = [
  [{ httpStatus: 400, googleErrorStatus: "INVALID_ARGUMENT" }, "bad_request"],
  [{ httpStatus: 403, googleErrorStatus: "PERMISSION_DENIED" }, "permission_denied"],
  [{ httpStatus: 404, googleErrorStatus: "NOT_FOUND" }, "not_found"],
  [{ httpStatus: 429, googleErrorStatus: "RESOURCE_EXHAUSTED" }, "rate_limited"],
  [{ httpStatus: 503, googleErrorStatus: "UNAVAILABLE" }, "unavailable"],
  [{ httpStatus: 200, parserResult: "failed", exceptionName: "SyntaxError" }, "parse_error"],
  [{ httpStatus: 0, exceptionName: "Error", exceptionMessage: "network down" }, "network_error"],
  [
    { httpStatus: 0, exceptionName: "TypeError", exceptionMessage: "Failed to fetch due to CORS" },
    "cors_error",
  ],
  [{ httpStatus: 0, exceptionName: "AbortError" }, "aborted"],
  [{ httpStatus: 0, exceptionName: "TimeoutError" }, "timeout"],
  [{ httpStatus: 200, parserResult: "invalid_payload" }, "invalid_payload"],
  [{ httpStatus: 200, parserResult: "empty_response" }, "empty_response"],
];

for (const [input, expected] of failures) {
  assert.equal(classifyPlaceDetailFailure(input), expected);
}

const googleError = parseGooglePlaceDetailError(
  JSON.stringify({
    error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid place ID" },
  }),
);
assert.deepEqual(googleError, {
  code: 400,
  status: "INVALID_ARGUMENT",
  message: "Invalid place ID",
});

assert.equal(placeDetailIdKind("places/ChIJ123456789"), "places_resource_name");
assert.equal(placeDetailIdKind("ChIJ123456789"), "raw_google_place_id");
assert.equal(placeDetailIdKind("place_id:ChIJ123456789"), "place_id_prefixed");
assert.equal(placeDetailIdKind("trip-example"), "synthetic");
assert.equal(maskPlaceDetailId("places/ChIJ123456789AbCd"), "ChIJ12…AbCd");
assert.match(placeDetailFieldMaskHash("id,displayName,location"), /^fnv1a:[0-9a-f]{8}$/);

const validShape = inspectPlaceDetailResponseShape({
  id: "ChIJ123456789",
  displayName: { text: "Example" },
  location: { latitude: 1, longitude: 2 },
  photos: [],
  types: [],
});
assert.deepEqual(validShape, {
  responsePlaceIdPresent: true,
  responseDisplayNamePresent: true,
  responseLocationPresent: true,
  responsePhotosArray: true,
  responseTypesArray: true,
});
assert.equal(inspectPlaceDetailResponseShape({}).responsePlaceIdPresent, false);

const clientPlace = {
  id: "ChIJ123456789",
  name: "Example",
  address: "Example address",
  lat: 1,
  lng: 2,
  rating: null,
  userRatingCount: null,
  photoName: null,
  primaryType: "tourist_attraction",
  types: ["tourist_attraction"],
  businessStatus: null,
  openStatus: "unknown",
  openStatusLabel: "",
  todayHoursLabel: "",
  closingSoonNote: "",
  nextOpenHint: "",
  website: null,
  phone: null,
};
const recovered = await fetchGooglePlaceDetailsForHandoff(
  "ChIJ123456789",
  "zh-TW",
  async () => ({ place: null, error: "place_not_found" }),
  async () => clientPlace,
);
assert.equal(recovered.place?.id, "ChIJ123456789");
assert.equal(recovered.error, null);
assert.equal(recovered.boundaryTelemetry, undefined);

const doubleFailure = await fetchGooglePlaceDetailsForHandoff(
  "ChIJ223456789",
  "zh-TW",
  async () => ({ place: null, error: "place_not_found" }),
  async () => null,
);
assert.equal(doubleFailure.place, null);
assert.equal(doubleFailure.error, "place_not_found");
assert.equal(doubleFailure.boundaryTelemetry?.clientFallbackAttempted, true);
assert.equal(
  doubleFailure.boundaryTelemetry?.firstNullErrorBoundary,
  "capacitor_client_null_result",
);

const nullError = await fetchGooglePlaceDetailsForHandoff(
  "ChIJ323456789",
  "zh-TW",
  async () => ({ place: null, error: null }),
);
assert.equal(nullError.boundaryTelemetry?.serverErrorPresent, false);
assert.equal(nullError.boundaryTelemetry?.firstNullErrorBoundary, "server_result_null_error");

const logs = [];
const originalWarn = console.warn;
console.warn = (...parts) => logs.push(parts.join(" "));
try {
  logPlaceDetailRequestFailure({
    placeId: "ChIJ123456789AbCd",
    requestPath: "capacitor_client",
    languageCode: "zh-TW",
    fieldMask: "id,displayName,location",
    cacheStatus: "miss",
    serverAttempted: false,
    clientFallbackAttempted: true,
    httpStatus: 403,
    httpOk: false,
    googleErrorCode: 403,
    googleErrorStatus: "PERMISSION_DENIED",
    googleErrorMessage: "API key rejected: key=AIza123456789012345678901234567890",
    parserResult: "parsed",
    failureKind: "permission_denied",
    shape: inspectPlaceDetailResponseShape(null),
  });
  logPlaceDetailResultBoundary({
    placeId: "ChIJ123456789AbCd",
    telemetry: {
      cacheHit: false,
      cachePlacePresent: false,
      cacheEnvelopeValid: false,
      serverAttempted: true,
      serverPlacePresent: false,
      serverErrorPresent: false,
      serverErrorCode: "",
      clientFallbackAttempted: true,
      clientPlacePresent: false,
      clientErrorPresent: false,
      clientErrorCode: "",
      firstNullErrorBoundary: "server_result_null_error",
    },
    finalError: null,
    snapshotPresent: true,
    baseDetailPresent: true,
  });
} finally {
  console.warn = originalWarn;
}

assert.equal(logs.some((line) => line.includes("[PLACE_DETAIL_REQUEST_DETAIL]")), true);
assert.equal(logs.some((line) => line.includes("[PLACE_DETAIL_API_RAW_STATUS]")), true);
assert.equal(logs.some((line) => line.includes("requestPath=capacitor_client")), true);
assert.equal(logs.some((line) => line.includes("failureKind=permission_denied")), true);
assert.equal(logs.some((line) => line.includes("[PLACE_DETAIL_RESULT_BOUNDARY]")), true);
assert.equal(logs.some((line) => line.includes("firstNullErrorBoundary=server_result_null_error")), true);
assert.equal(logs.some((line) => line.includes("ChIJ123456789AbCd")), false);
assert.equal(logs.some((line) => line.includes("AIza")), false);
assert.equal(logs.some((line) => line.includes("places.googleapis.com")), false);
assert.equal(logs.some((line) => line.includes("id,displayName,location")), false);

const requestSource = await readFile(new URL("../src/lib/places.functions.ts", import.meta.url), "utf8");
const boundarySource = await readFile(new URL("../src/lib/place-detail-resolve.ts", import.meta.url), "utf8");
assert.equal(requestSource.includes("requestPath: \"server\""), true);
assert.equal(requestSource.includes("PLACE_DETAILS_SCREEN_FIELD_MASK"), true);
assert.equal(boundarySource.includes("server_result_null_error"), true);
assert.equal(boundarySource.includes("capacitor_client_null_result"), true);

console.log("place detail failure boundary telemetry verification passed");
