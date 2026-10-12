import assert from "node:assert/strict";
import { resolveDirectionsRegion } from "../src/lib/directions-endpoint.ts";
import { fetchScopedLegDuration, clearScopedRouteCache } from "../src/lib/saved-trip/route-duration-service.ts";
import { clearRouteDurationCache } from "../src/lib/route-duration-cache.ts";
import { bindRoutesServerFns } from "../src/services/routesService.ts";

// Japan authority comes from the trip's Google country component (localized longText),
// resolved through the existing country normalizer — never the App locale.
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push([name, "PASS"]); } catch (e) { results.push([name, `FAIL ${String(e.message).slice(0, 110)}`]); }
};

await check("Japan country names in all UI languages → jp", () => {
  for (const v of ["日本", "Japan", "일본", "JP", "京都, 日本", "Kyoto, Japan", "교토, 일본"]) assert.equal(resolveDirectionsRegion(v), "jp", v);
});
await check("non-Japan resolution unchanged", () => {
  // Snapshot of the pre-fix behavior for non-Japan inputs (including the known tw default).
  const before = { "台灣": "tw", "Taiwan": "tw", "韓國": "kr", "Seoul": "kr", "香港": "hk", "Singapore": "sg", "대한민국": "tw", "United States": "tw", "France": "tw", "": "tw" };
  for (const [v, expected] of Object.entries(before)) assert.equal(resolveDirectionsRegion(v), expected, v);
});
await check("App locale is not an input", () => {
  assert.equal(resolveDirectionsRegion("ja"), resolveDirectionsRegion("ko"));
  assert.notEqual(resolveDirectionsRegion("ja"), "jp");
});

// Integration: a Korean-language Japan trip gets the Japan route rules with zero extra calls.
let calls = [];
const unused = async () => { throw new Error("unused"); };
globalThis.fetch = async () => { throw new Error("unexpected live fetch"); };
bindRoutesServerFns({
  computeDuration: async ({ data }) => { calls.push(data.travelMode); return { ok: false, statusCode: 200, googleStatus: "ZERO_RESULTS", message: "ZERO_RESULTS" }; },
  computeDistance: unused, computeTripLegs: unused, computeLegEstimates: unused, testConnection: unused,
});
const leg = (mode, n) => ({
  scope: { tripId: `ko-jp-${n}`, dateKey: "2026-12-08", dayIndex: 0, legIndex: 0, legKey: `a→b-${n}` },
  origin: { lat: 35.0, lng: 135.78 }, destination: { lat: 35.007, lng: 135.78 }, preferredMode: mode, allowModeFallback: true,
  query: { region: resolveDirectionsRegion("일본"), locationContext: "교토, 일본" },
});
await check("ko Japan trip: transit is a Google Maps deeplink (0 calls)", async () => {
  clearRouteDurationCache(); clearScopedRouteCache(); calls = [];
  const r = await fetchScopedLegDuration(leg("TRANSIT", 1));
  assert.deepEqual(calls, []); assert.equal(r.transitUnavailableProvider, "google_maps_deeplink");
});
await check("ko Japan trip: walk fallback never calls TRANSIT", async () => {
  clearRouteDurationCache(); clearScopedRouteCache(); calls = [];
  await fetchScopedLegDuration(leg("WALK", 2));
  assert.ok(!calls.includes("TRANSIT"), `attempted ${calls}`);
});

for (const [name, status] of results) out(`${status === "PASS" ? "PASS" : "FAIL"} ${name}${status === "PASS" ? "" : " — " + status}`);
const failed = results.filter(([, s]) => s !== "PASS").length;
out(`${results.length - failed}/${results.length} PASS`);
process.exitCode = failed ? 1 : 0;
