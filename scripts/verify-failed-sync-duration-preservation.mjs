import assert from "node:assert/strict";
import { fetchScopedLegDuration, clearScopedRouteCache } from "../src/lib/saved-trip/route-duration-service.ts";
import { clearRouteDurationCache } from "../src/lib/route-duration-cache.ts";
import { bindRoutesServerFns } from "../src/services/routesService.ts";
import { legRouteRetryDeferred } from "../src/lib/saved-trip/sync-route-legs.ts";
import { formatLegTravelTimeLabel, travelMinutesForMode } from "../src/lib/saved-trip/travel-time.ts";
import { buildSavedTripTransitLegs, selectDisplayTransitLeg } from "../src/lib/saved-trip/saved-trip-transit-legs.ts";

// Failed Directions sync must not hide a verified save-time Routes duration (display layer only).
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
let now = 1_800_000_000_000;
Date.now = () => now;
const MIN = 60 * 1000;
const DATE = "2026-12-08";
const A = { placeName: "清水寺", lat: 34.9948, lng: 135.7850, googlePlaceId: "ChIJ_A" };
const B = { placeName: "石塀小路", lat: 35.0001, lng: 135.7795, googlePlaceId: "ChIJ_B" };
const scopedKey = `${DATE}§清水寺→石塀小路`;
const saved = (mode, minutes, stops = [A, B]) => buildSavedTripTransitLegs(stops, [{ durationMinutes: minutes, distanceMeters: 766 }], mode);
const failedSync = (requestedMode) => ({
  legKey: scopedKey, fromName: A.placeName, toName: B.placeName, recommendedMode: "walk", headline: "", durationMinutes: 0, distanceMeters: 0,
  reason: "rate_limited", complexity: "low", estimates: {}, source: "rules", requestedMode, resolvedMode: requestedMode,
  fallbackReason: "rate_limited", durationSource: "none", routeStatus: "failed", transportMode: requestedMode, transportStatus: "failed",
  routeCacheFingerprint: "fp", routeRetryAfter: now + 60 * MIN,
});
const okSync = (mode, minutes) => ({ ...failedSync(mode), reason: "", fallbackReason: null, durationSource: "directions", routeStatus: "ok",
  transportStatus: "ok", durationMinutes: minutes, estimates: { [mode === "DRIVE" ? "drive" : "walk"]: minutes }, routeRetryAfter: undefined });
const show = (legs, prev = A, curr = B) => selectDisplayTransitLeg(legs, DATE, prev, curr);
const results = [];
const check = async (name, fn) => { try { await fn(); results.push([name, "PASS"]); } catch (e) { results.push([name, `FAIL ${String(e.message).slice(0, 110)}`]); } };
const restore = (legs) => JSON.parse(JSON.stringify(legs));

await check("T1 Routes WALK 15 + Directions WALK 429 → keep WALK 15", () => {
  const legs = restore({ ...saved("WALK", 15), [scopedKey]: failedSync("WALK") });
  assert.equal(travelMinutesForMode(show(legs), "步行"), 15);
});
await check("T2 Directions WALK 20 success wins", () => {
  const legs = restore({ ...saved("WALK", 15), [scopedKey]: okSync("WALK", 20) });
  assert.equal(travelMinutesForMode(show(legs), "步行"), 20);
});
await check("T3 Routes WALK 15 + Directions DRIVE 429 → no WALK minutes as DRIVE", () => {
  const legs = restore({ ...saved("WALK", 15), [scopedKey]: failedSync("DRIVE") });
  assert.equal(travelMinutesForMode(show(legs), "租車自駕"), null);
});
await check("T4 different endpoints → old leg unused", () => {
  const moved = { ...B, lat: 35.0101, googlePlaceId: "ChIJ_B" };
  const legs = restore({ ...saved("WALK", 15), [scopedKey]: failedSync("WALK") });
  assert.equal(travelMinutesForMode(show(legs, A, moved), "步行"), null, "same names, moved coordinates");
  const otherPlace = { ...B, googlePlaceId: "ChIJ_OTHER" };
  assert.equal(travelMinutesForMode(show(legs, A, otherPlace), "步行"), null, "same names, other place id");
});
await check("T5 transport changed → no old-mode minutes", () => {
  const legs = restore({ ...saved("DRIVE", 8), [scopedKey]: failedSync("WALK") });
  assert.equal(travelMinutesForMode(show(legs), "步行"), null);
});
await check("T6 legacy without identity → safe missing", () => {
  const legacy = { "清水寺→石塀小路": { headline: "766m", durationMinutes: 14, distanceMeters: 766 } };
  const legs = restore({ ...legacy, [scopedKey]: failedSync("WALK") });
  assert.equal(travelMinutesForMode(show(legs), "步行"), null);
});
await check("T7 429 cooldown 60 min: no new queries", async () => {
  let calls = 0; const unused = async () => { throw new Error("unused"); };
  globalThis.fetch = unused;
  bindRoutesServerFns({ computeDuration: async () => { calls++; return { ok: false, statusCode: 429, message: "rate_limited" }; },
    computeDistance: unused, computeTripLegs: unused, computeLegEstimates: unused, testConnection: unused });
  clearRouteDurationCache(); clearScopedRouteCache();
  const input = { scope: { tripId: "t7", dateKey: DATE, dayIndex: 0, legIndex: 0, legKey: scopedKey }, origin: A, destination: B, preferredMode: "WALK", query: { region: "jp" } };
  const r = await fetchScopedLegDuration(input);
  assert.equal(r.retryAfter, now + 60 * MIN);
  for (let i = 0; i < 3; i++) await fetchScopedLegDuration(input);
  assert.equal(calls, 1);
  const legs = restore({ ...saved("WALK", 15), [scopedKey]: { ...failedSync("WALK"), routeRetryAfter: r.retryAfter } });
  assert.equal(legRouteRetryDeferred(legs[scopedKey], "fp"), true, "stored cooldown intact for sync");
});
await check("T8 reopen keeps the valid time (stored failure untouched)", () => {
  const legs = restore({ ...saved("WALK", 15), [scopedKey]: failedSync("WALK") });
  for (let i = 0; i < 3; i++) assert.equal(travelMinutesForMode(show(restore(legs)), "步行"), 15);
  assert.equal(legs[scopedKey].routeStatus, "failed", "selection never rewrites persisted data");
});
await check("T9 Japan transit deeplink unchanged", () => {
  const deeplink = { ...failedSync("TRANSIT"), routeStatus: "transit_unavailable", transportStatus: "transit_unavailable", transitUnavailableProvider: "google_maps_deeplink" };
  const legs = restore({ ...saved("TRANSIT", 12), [scopedKey]: deeplink });
  const leg = show(legs);
  assert.equal(leg.transitUnavailableProvider, "google_maps_deeplink");
  for (const l of ["zh-TW", "en", "ja", "ko"]) assert.equal(formatLegTravelTimeLabel(leg, "大眾運輸", { locale: l }), undefined);
});
await check("T10 four languages show the preserved WALK 15", () => {
  const leg = show(restore({ ...saved("WALK", 15), [scopedKey]: failedSync("WALK") }));
  for (const l of ["zh-TW", "en", "ja", "ko"]) assert.match(formatLegTravelTimeLabel(leg, "步行", { locale: l }) ?? "", /15/, l);
});

for (const [name, status] of results) out(`${status === "PASS" ? "PASS" : "FAIL"} ${name}${status === "PASS" ? "" : " — " + status}`);
const failed = results.filter(([, s]) => s !== "PASS").length;
out(`${results.length - failed}/${results.length} PASS`);
process.exitCode = failed ? 1 : 0;
