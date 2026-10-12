// Mock-only diagnostic: transit leg persistence/display under Routes 429. No real Google calls.
import assert from "node:assert/strict";

let upstreamCalls = 0;
let upstreamMode = "ok";
globalThis.fetch = async (url) => {
  upstreamCalls++;
  if (upstreamMode === "429") return new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 });
  assert.match(String(url), /routes\.googleapis\.com/);
  return Response.json({ routes: [{ duration: "600s", distanceMeters: 800 }] });
};
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.dispatchEvent ??= () => true;
globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };

const { buildSavedTripTransitLegs, selectDisplayTransitLeg } = await import("/src/lib/saved-trip/saved-trip-transit-legs.ts");
const { publishTripRouteEnrichment, getTripRouteEnrichment, mergeTripRouteEnrichment } = await import("/src/lib/saved-trip/cover-live-state.ts");
const { buildDayLegKey } = await import("/src/lib/transit/types.ts");

let failures = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS ${label}`); }
  catch (e) { failures++; console.log(`FAIL ${label}: ${String(e?.message ?? e).split("\n")[0]}`); }
}

const stops = Array.from({ length: 25 }, (_, i) => ({
  placeName: `Stop ${i}`, lat: 35.68 + i * 0.001, lng: 139.76, googlePlaceId: `ChIJStop${i}`,
}));
const okLegs = stops.slice(1).map(() => ({ durationMinutes: 10, distanceMeters: 800 }));
const scopedFailed = (from, to) => ({
  [buildDayLegKey("2026-11-25", from.placeName, to.placeName)]: {
    legKey: "x", routeStatus: "failed", transportStatus: "failed", requestedMode: "WALK", transportMode: "WALK",
    fallbackReason: "rate_limited", durationMinutes: 0,
  },
});

await check("T1 generation-time routes success → saved legs with endpoints (24 legs)", () => {
  const saved = buildSavedTripTransitLegs(stops, okLegs, "WALK");
  assert.equal(Object.keys(saved).length, 24);
  assert.ok(Object.values(saved).every((l) => l.savedRouteEndpoints && l.routeStatus === "ok"));
});
await check("T2 routes 429 at generation → client receives [] → nothing saved (no endpoints)", () => {
  // getTripLegsWithDurations (client) returns [] on any non-ok/exception path.
  const saved = buildSavedTripTransitLegs(stops, [], "WALK");
  assert.deepEqual(saved, {});
});
await check("T2b server soft legs (all 0 min) → failed legs keep endpoints but publish drops them", () => {
  const saved = buildSavedTripTransitLegs(stops, stops.slice(1).map(() => ({ durationMinutes: 0, distanceMeters: 0 })), "WALK");
  assert.ok(Object.values(saved).every((l) => l.routeStatus === "failed" && l.savedRouteEndpoints));
  publishTripRouteEnrichment("trip-soft", saved);
  assert.equal(getTripRouteEnrichment("trip-soft"), undefined, "unverified legs are never published");
});
await check("T3/T4 background enrichment success is published (in-memory only)", () => {
  publishTripRouteEnrichment("trip-ok", buildSavedTripTransitLegs(stops, okLegs, "WALK"));
  assert.equal(Object.keys(getTripRouteEnrichment("trip-ok")).length, 24);
});
await check("T5 add-only merge never overwrites existing (autosave-safe)", () => {
  const enrichment = getTripRouteEnrichment("trip-ok");
  const existingKey = Object.keys(enrichment)[0];
  const current = { [existingKey]: { ...enrichment[existingKey], durationMinutes: 99, estimates: { walk: 99 } } };
  const merged = mergeTripRouteEnrichment(current, enrichment);
  assert.equal(merged[existingKey].durationMinutes, 99);
  assert.equal(Object.keys(merged).length, 24);
  assert.equal(mergeTripRouteEnrichment(merged, enrichment), merged, "no-op returns same reference");
});
await check("T6 reopen restores only what was persisted (enrichment store is process memory)", () => {
  // Persisted payload after save = draft transitLegs built from save-time routeLegs = [].
  const persistedAtSave = buildSavedTripTransitLegs(stops, [], "WALK");
  assert.deepEqual(persistedAtSave, {});
  // Without the editor merging + autosaving in the same process, a fresh process has no enrichment.
});
await check("T7 scoped 429 reuses a valid saved WALK leg", () => {
  const legs = { ...buildSavedTripTransitLegs(stops, okLegs, "WALK"), ...scopedFailed(stops[0], stops[1]) };
  const leg = selectDisplayTransitLeg(legs, "2026-11-25", stops[0], stops[1]);
  assert.equal(leg.routeStatus, "ok");
  assert.equal(leg.estimates.walk, 10);
});
await check("T8 no saved leg → scoped failed leg shown (unavailable)", () => {
  const leg = selectDisplayTransitLeg(scopedFailed(stops[0], stops[1]), "2026-11-25", stops[0], stops[1]);
  assert.equal(leg.routeStatus, "failed");
});
await check("T9 WALK saved leg is not reused for a DRIVE request", () => {
  const scoped = scopedFailed(stops[0], stops[1]);
  Object.values(scoped)[0].requestedMode = "DRIVE";
  Object.values(scoped)[0].transportMode = "DRIVE";
  const legs = { ...buildSavedTripTransitLegs(stops, okLegs, "WALK"), ...scoped };
  assert.equal(selectDisplayTransitLeg(legs, "2026-11-25", stops[0], stops[1]).routeStatus, "failed");
});

// T10: server trip-legs loop under 429 (Worker guard + upstream mocked).
process.env.ABUSE_GUARD_ENFORCEMENT = "1";
const { getTripLegsWithDurations } = await import("/src/lib/google-routes.server.ts");
const { runWithWorkerRequest, runWithVerifiedPrincipal } = await import("/src/lib/worker-request-scope.ts");
const { createMemoryAbuseGuard } = await import("/src/lib/abuse-guard-memory.ts");
let guardCalls = 0;
let guardMode = "ok";
const memory = createMemoryAbuseGuard();
const env = {
  ABUSE_GUARD: { idFromName: (n) => n, get: (n) => ({ fetch: async (request) => {
    guardCalls++;
    const command = await request.clone().json();
    if (guardMode === "family_exhausted" && command.action === "charge") {
      return Response.json({ ok: false, reason: "family", retryAt: Date.now() + 3_600_000 });
    }
    return memory.namespace.get(n).fetch(request);
  } }) },
  GOOGLE_API_RATE_LIMITER: { limit: async () => ({ success: true }) },
  GOOGLE_ROUTES_SERVER_API_KEY: "AIzaMockRoutesKeyForDiagnosticOnly000000",
  ABUSE_GUARD_ANALYTICS: { writeDataPoint() {} },
};
const request = new Request("https://roamie.tw/api", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } });
const inWorker = (fn) => runWithWorkerRequest({ env, request }, () => runWithVerifiedPrincipal("mock-user", fn));
const places = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
await check("T10 user family cap exhausted: server loop keeps requesting every leg (no early stop)", async () => {
  guardMode = "family_exhausted";
  const before = { guard: guardCalls, up: upstreamCalls };
  const result = await inWorker(() => getTripLegsWithDurations(places, "WALK"));
  const guardDelta = guardCalls - before.guard;
  console.log("INFO T10", JSON.stringify({ ok: result.ok, legs: result.data?.length, zeroLegs: result.data?.filter((l) => !l.durationMinutes).length, guardCalls: guardDelta, upstreamCalls: upstreamCalls - before.up }));
  assert.equal(upstreamCalls - before.up, 0, "Google never called");
  assert.ok(guardDelta >= 24, "one guard round-trip per leg");
});
console.log(failures ? `DIAG done (${failures} failing)` : "DIAG done (all pass)");
