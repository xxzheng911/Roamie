import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  classifyRouteFailure,
  maskRoutePlaceId,
  sanitizeRouteTelemetryText,
} from "../src/lib/route-failure-telemetry.ts";

const cases = [
  [{ httpStatus: 200, httpOk: true, googleStatus: "ZERO_RESULTS" }, "zero_results"],
  [{ httpStatus: 200, httpOk: true, googleStatus: "NOT_FOUND" }, "not_found"],
  [{ httpStatus: 400, httpOk: false, googleStatus: "INVALID_REQUEST" }, "invalid_request"],
  [{ httpStatus: 403, httpOk: false, googleStatus: "REQUEST_DENIED" }, "request_denied"],
  [{ httpStatus: 429, httpOk: false, googleStatus: "OVER_QUERY_LIMIT" }, "over_query_limit"],
  [{ httpStatus: 500, httpOk: false, googleStatus: "UNKNOWN" }, "http_error"],
  [{ httpStatus: 200, httpOk: true, googleStatus: "OK", routesCount: 0 }, "empty_routes"],
  [{ httpStatus: 200, httpOk: true, googleStatus: "OK", routesCount: 1, legsCount: 0 }, "empty_legs"],
  [{ httpStatus: 200, httpOk: true, googleStatus: "OK", parserResult: "invalid_duration" }, "invalid_duration"],
  [{ httpStatus: 200, httpOk: true, googleStatus: "OK", parserResult: "parse_error" }, "parse_error"],
  [{ httpStatus: 0, httpOk: false, googleStatus: "exception", exceptionName: "TypeError" }, "network_error"],
  [{ httpStatus: 0, httpOk: false, googleStatus: "exception", exceptionName: "AbortError" }, "aborted"],
];

for (const [input, expected] of cases) {
  assert.equal(classifyRouteFailure(input), expected);
}

assert.equal(maskRoutePlaceId("places/ChIJ1234567890abcdef"), "ChIJ12…cdef");
assert.equal(maskRoutePlaceId(undefined), "");
const sanitized = sanitizeRouteTelemetryText(
  "https://example.test/path?key=AIza123456789012345678901234567890&mode=walk\nsecret",
);
assert.equal(sanitized.includes("AIza"), false);
assert.equal(sanitized.includes("\n"), false);
assert.equal(sanitized.includes("key=***"), true);

const fallbackSource = await readFile(
  new URL("../src/lib/saved-trip/route-duration-fallback.ts", import.meta.url),
  "utf8",
);
for (const marker of [
  "[ROUTE_REQUEST_DETAIL]",
  "[ROUTE_API_RAW_STATUS]",
  "[ROUTE_FALLBACK_RESULT]",
]) {
  assert.equal(fallbackSource.includes(marker), true, `missing ${marker}`);
}
assert.equal(fallbackSource.includes("originPlaceIdMasked="), true);
assert.equal(fallbackSource.includes("destinationPlaceIdMasked="), true);
assert.equal(fallbackSource.includes("rawFailureKinds="), true);
assert.equal(fallbackSource.includes("finalLocalReason="), true);

const persistenceSource = await readFile(
  new URL("../src/lib/saved-trip/sync-route-legs.ts", import.meta.url),
  "utf8",
);
assert.equal(persistenceSource.includes("[ROUTE_RESULT_PERSISTENCE]"), true);
for (const decision of [
  "delete_then_refresh",
  "overwrite",
  "insert_failure",
  "insert_success",
]) {
  assert.equal(persistenceSource.includes(`\"${decision}\"`), true, `missing ${decision}`);
}
for (const field of [
  "triggerSource=",
  "syncScope=",
  "modeSelectionSource=",
  "endpointIdentitySame=",
  "modeFingerprintSame=",
]) {
  assert.equal(persistenceSource.includes(field), true, `missing ${field}`);
}

for (const source of [fallbackSource, persistenceSource]) {
  assert.equal(source.includes("JSON.stringify(raw"), false);
  assert.equal(source.includes("apiKey="), false);
}

console.log("route failure boundary telemetry verification passed");
