import assert from "node:assert/strict";
import { isDevVerboseLog } from "../src/lib/dev-verbose-log.ts";
import { buildSavedTripTransitLegs, selectDisplayTransitLeg } from "../src/lib/saved-trip/saved-trip-transit-legs.ts";

// ROUTE_DISPLAY_SELECTION: enumerated reasons only, debug-gated, once per leg+outcome.
const logs = [];
console.info = (...a) => { if (a[0] === "[ROUTE_DISPLAY_SELECTION]") logs.push(a[1]); };
const DATE = "2026-12-08";
const A = { placeName: "清水寺", lat: 34.9948, lng: 135.785, googlePlaceId: "ChIJ_A" };
const B = { placeName: "石塀小路", lat: 35.0001, lng: 135.7795, googlePlaceId: "ChIJ_B" };
const failed = (mode) => ({ routeStatus: "failed", requestedMode: mode, transportMode: mode, fallbackReason: "rate_limited", estimates: {}, durationMinutes: 0 });
const key = `${DATE}§清水寺→石塀小路`;
const saved = buildSavedTripTransitLegs([A, B], [{ durationMinutes: 15, distanceMeters: 766 }], "WALK");
const cases = [
  [{ [key]: failed("WALK") }, "no_saved_leg"],
  [{ ...saved, [key]: failed("DRIVE") }, "mode_mismatch"],
  [{ ...saved, [key]: failed("WALK") }, "saved_reused"],
  [{ "清水寺→石塀小路": { headline: "766m", durationMinutes: 14 }, [key]: failed("WALK") }, "no_saved_endpoints"],
];
for (const [legs, reason] of cases) {
  for (let i = 0; i < 2; i++) selectDisplayTransitLeg(legs, DATE, A, B);
  if (isDevVerboseLog()) assert.equal(logs.at(-1)?.reason, reason);
}
if (isDevVerboseLog()) {
  assert.equal(logs.length, cases.length, "deduped: one record per leg+outcome");
  const text = JSON.stringify(logs);
  assert.ok(!/清水寺|石塀|ChIJ|34\.99|135\.7/.test(text), "no names, place ids or coordinates");
  assert.equal(logs[2].selected, "saved"); assert.equal(logs[0].selected, "scoped_failed");
  assert.equal(logs[0].scopedReason, "rate_limited");
} else {
  assert.equal(logs.length, 0, "release builds emit nothing");
}
console.log(`PASS ROUTE_DISPLAY_SELECTION (${isDevVerboseLog() ? "debug: 4 reasons, deduped, no PII" : "release: silent"})`);
