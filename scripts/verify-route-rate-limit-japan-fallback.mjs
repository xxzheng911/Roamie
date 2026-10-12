import assert from "node:assert/strict";
import { legRouteIsCovered, legRouteRetryDeferred } from "../src/lib/saved-trip/sync-route-legs.ts";
import { fetchScopedLegDuration, clearScopedRouteCache } from "../src/lib/saved-trip/route-duration-service.ts";
import { clearRouteDurationCache } from "../src/lib/route-duration-cache.ts";
import { bindRoutesServerFns } from "../src/services/routesService.ts";

// Mock provider only: every Directions attempt is counted per mode; no live fetch.
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
let now = 1_800_000_000_000;
Date.now = () => now;
globalThis.fetch = async () => { throw new Error("unexpected live fetch"); };
const MIN = 60 * 1000;
let calls = [];
let respond = () => ({ ok: false, statusCode: 500, message: "unset" });
const unused = async () => { throw new Error("unused"); };
bindRoutesServerFns({
  computeDuration: async ({ data }) => { calls.push(data.travelMode); return respond(data.travelMode); },
  computeDistance: unused, computeTripLegs: unused, computeLegEstimates: unused, testConnection: unused,
});
const ok = (minutes) => ({ ok: true, data: { durationMinutes: minutes, distanceMeters: 900 } });
const zero = { ok: false, statusCode: 200, googleStatus: "ZERO_RESULTS", message: "ZERO_RESULTS" };
const http = (statusCode) => ({ ok: false, statusCode, googleStatus: String(statusCode), message: String(statusCode) });
let seq = 0;
const leg = (region, km = 0.8, preferredMode = "WALK", allowModeFallback = true) => ({
  scope: { tripId: `fixture-${++seq}`, dateKey: "2026-12-08", dayIndex: 0, legIndex: 0, legKey: `a→b-${seq}` },
  origin: { lat: 35.0, lng: 135.78 }, destination: { lat: 35.0 + km / 111, lng: 135.78 },
  preferredMode, allowModeFallback,
  query: { region, locationContext: region === "jp" ? "日本 京都" : "台灣 台北" },
});
const run = async (input, responder) => { calls = []; respond = responder; return fetchScopedLegDuration(input); };
const results = [];
async function check(name, fn) {
  clearRouteDurationCache(); clearScopedRouteCache();
  try { await fn(); results.push([name, "PASS"]); }
  catch (e) { results.push([name, `FAIL ${String(e.message).slice(0, 110)}`]); }
}

await check("1 HTTP 429 → rate_limited, single attempt, existing cooldown, recovers after", async () => {
  const input = leg("tw");
  const r = await run(input, () => http(429));
  assert.equal(r.ok, false); assert.equal(r.durationMinutes, 0);
  assert.equal(r.fallbackReason, "rate_limited", "429 must not be zero_results");
  assert.deepEqual(calls, ["WALK"], "no mode switching after a shared budget denial");
  assert.equal(r.retryAfter, now + 60 * MIN, "existing cooldown kept: no extra retries during a budget denial");
  calls = []; await fetchScopedLegDuration(input);
  assert.deepEqual(calls, [], "no immediate retry while cooling down");
  now = r.retryAfter + 1; respond = () => ok(9); calls = [];
  assert.equal((await fetchScopedLegDuration(input)).durationMinutes, 9, "recovers after cooldown");
});
await check("2 HTTP 200 ZERO_RESULTS → zero_results", async () => {
  const r = await run(leg("tw"), () => zero);
  assert.equal(r.fallbackReason, "zero_results"); assert.equal(r.durationMinutes, 0);
});
await check("3 HTTP 403 → not rate_limited, no invented minutes", async () => {
  const r = await run(leg("tw"), () => http(403));
  assert.notEqual(r.fallbackReason, "rate_limited"); assert.equal(r.ok, false); assert.equal(r.durationMinutes, 0);
});
await check("4 HTTP 500 → not rate_limited, no invented minutes", async () => {
  const r = await run(leg("tw"), () => http(500));
  assert.notEqual(r.fallbackReason, "rate_limited"); assert.equal(r.ok, false); assert.equal(r.durationMinutes, 0);
});
await check("5 success returns provider minutes", async () => {
  const r = await run(leg("tw"), () => ok(14));
  assert.equal(r.ok, true); assert.equal(r.durationMinutes, 14); assert.deepEqual(calls, ["WALK"]);
});
await check("6 Japan walk success, no transit call", async () => {
  const r = await run(leg("jp"), (m) => (m === "WALK" ? ok(15) : zero));
  assert.equal(r.durationMinutes, 15); assert.deepEqual(calls, ["WALK"]);
});
await check("6b Japan walk failure never falls back to Directions TRANSIT", async () => {
  const short = await run(leg("jp"), () => zero);
  assert.ok(!calls.includes("TRANSIT"), `short attempted ${calls}`); assert.equal(short.ok, false);
  const far = await run(leg("jp", 6), (m) => (m === "DRIVE" ? ok(18) : zero));
  assert.ok(!calls.includes("TRANSIT"), `far attempted ${calls}`);
  assert.equal(far.resolvedMode, "DRIVE"); assert.equal(far.durationMinutes, 18);
});
await check("7 Japan walk rate-limited → rate_limited, one call", async () => {
  const r = await run(leg("jp"), () => http(429));
  assert.equal(r.fallbackReason, "rate_limited"); assert.deepEqual(calls, ["WALK"]);
});
await check("8 Japan transit → Google Maps deeplink, zero calls", async () => {
  const r = await run(leg("jp", 3, "TRANSIT"), () => ok(99));
  assert.deepEqual(calls, []); assert.equal(r.transitUnavailableProvider, "google_maps_deeplink");
});
await check("9 non-Japan transit fallback unchanged", async () => {
  await run(leg("tw"), (m) => (m === "TRANSIT" ? ok(11) : zero));
  assert.ok(calls.includes("TRANSIT"), `tw attempted ${calls}`);
  const r = await run(leg("tw", 3, "TRANSIT"), () => ok(21));
  assert.deepEqual(calls, ["TRANSIT"]); assert.equal(r.durationMinutes, 21);
});
await check("10/11 restore: valid duration covered, missing duration not covered", async () => {
  const saved = { routeCacheFingerprint: "fp", requestedMode: "WALK", resolvedMode: "WALK", estimates: { walk: 15 }, durationMinutes: 15, routeStatus: "ok" };
  assert.equal(legRouteIsCovered(saved, "WALK", "fp"), true);
  assert.equal(legRouteIsCovered({ ...saved, durationMinutes: 0, estimates: {} }, "WALK", "fp"), false);
});
await check("12 reopen within cooldown: rate-limited leg deferred, zero calls", async () => {
  const input = leg("jp");
  const r = await run(input, () => http(429));
  const persisted = { routeCacheFingerprint: "fp", routeStatus: "failed", routeRetryAfter: r.retryAfter, estimates: {}, durationMinutes: 0 };
  assert.equal(legRouteRetryDeferred(persisted, "fp"), true);
  calls = []; for (let i = 0; i < 3; i++) await fetchScopedLegDuration(input);
  assert.deepEqual(calls, [], "consecutive opens reuse the cooldown");
});

for (const [name, status] of results) out(`${status.startsWith("PASS") ? "PASS" : "FAIL"} ${name}${status === "PASS" ? "" : " — " + status}`);
const failed = results.filter(([, s]) => s !== "PASS").length;
out(`${results.length - failed}/${results.length} PASS`);
process.exitCode = failed ? 1 : 0;
