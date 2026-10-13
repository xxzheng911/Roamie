import assert from "node:assert/strict";
import { installWorkerRequestStorage } from "../src/lib/worker-request-als.server.ts";
import { runWithWorkerRequest, runWithVerifiedPrincipal, markPublicReadAuthorized } from "../src/lib/worker-request-scope.ts";
import { createMemoryAbuseGuard } from "../src/lib/abuse-guard-memory.ts";
import { utcDay } from "../src/lib/abuse-guard-clock.ts";
import { fetchGoogleRestProvider } from "../src/lib/google-rest-provider.server.ts";
import { guardDenialClassification } from "../src/lib/route-request-diagnostic.server.ts";
import { fetchGoogleRoute } from "../src/lib/google-routes-fetch.ts";
import { fetchGoogleDirectionsRoute } from "../src/lib/google-directions-fetch.ts";
import { fetchScopedLegDuration, clearScopedRouteCache } from "../src/lib/saved-trip/route-duration-service.ts";
import { clearRouteDurationCache } from "../src/lib/route-duration-cache.ts";
import { bindRoutesServerFns } from "../src/services/routesService.ts";

// Offline only: real proxy, burst limiter and AbuseGuard boundaries; mocked fetch, limiter and DO.
installWorkerRequestStorage();
delete process.env.ABUSE_GUARD_ENFORCEMENT;
delete process.env.DISABLE_GOOGLE_PROXY;
const diagnostics = [];
const rawStatus = [];
for (const k of ["log", "info", "debug"]) console[k] = () => {};
console.warn = (...args) => {
  const line = args.map(String).join(" ");
  if (line.startsWith("[ROUTE_REQUEST_DIAGNOSTIC]")) diagnostics.push(line);
  if (line.startsWith("[ROUTE_API_RAW_STATUS]")) rawStatus.push(line);
};
const parseDiag = (line) => JSON.parse(line.slice(line.indexOf("{")));
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
globalThis.fetch = async () => { throw new Error("unexpected live fetch"); };

const day = utcDay();
const ip = "203.0.113.77";
const userId = "diag-private-user-0001";
const serverKey = "AIza" + "d".repeat(35);
const ROUTES = { url: "https://routes.googleapis.com/directions/v2:computeRoutes", method: "POST", fieldMask: "routes.duration,routes.distanceMeters,routes.legs.staticDuration",
  body: { origin: { location: { latLng: { latitude: 35.6812, longitude: 139.7671 } } }, destination: { location: { latLng: { latitude: 35.7101, longitude: 139.8107 } } }, travelMode: "TRANSIT" } };
const DIRECTIONS = { url: "https://maps.googleapis.com/maps/api/directions/json?origin=35.6812,139.7671&destination=35.7101,139.8107&mode=transit", method: "GET" };
const PLACES = { url: "https://places.googleapis.com/v1/places:searchText", method: "POST", body: { textQuery: "fixture", pageSize: 1 } };

let upstreamCalls = 0;
function fixture({ role = "user", limiter = () => true, guardOverride, globalUnits } = {}) {
  const guard = createMemoryAbuseGuard();
  const env = {
    ABUSE_GUARD_ENFORCEMENT: "true",
    ABUSE_GUARD: guardOverride ?? guard.namespace,
    GOOGLE_API_RATE_LIMITER: { limit: async ({ key }) => ({ success: limiter(key) }) },
    GOOGLE_PLACES_SERVER_API_KEY: serverKey,
    GOOGLE_ROUTES_SERVER_API_KEY: serverKey,
    GOOGLE_GEOCODING_SERVER_API_KEY: serverKey,
    WORKER_VERSION_METADATA: { id: "22222222-2222-4222-8222-222222222222" },
    ABUSE_GUARD_ANALYTICS: { writeDataPoint: () => {} },
    ...(globalUnits != null ? { GOOGLE_GLOBAL_DAILY_UNITS: String(globalUnits) } : {}),
  };
  const request = () => new Request("https://roamie.tw/api/google", { method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(role === "user" ? { authorization: "Bearer diag-fixture-token" } : {}) } });
  const run = (fn) => runWithWorkerRequest({ env, request: request() }, () =>
    role === "user" ? runWithVerifiedPrincipal(userId, fn) : (markPublicReadAuthorized(ip), fn()));
  const seed = async (name, key, delta, reason) => {
    const body = JSON.stringify({ action: "charge", operationId: `seed:${name}:${key}`, buckets: [{ key, limit: 1e9, delta, reason, retryAt: 0 }] });
    await guard.namespace.get(name).fetch(new Request("https://guard.local", { method: "POST", body }));
  };
  const invoke = (input, fetcher) => run(() => fetchGoogleRestProvider(input, env, async (...a) => { upstreamCalls++; return fetcher(...a); }));
  return { env, run, seed, invoke };
}
const okRoutes = () => Response.json({ routes: [{ duration: "600s", distanceMeters: 900, legs: [{ staticDuration: "600s" }] }] });
const neverCalled = () => { throw new Error("provider must not be called"); };

async function single(input, f, fetcher) {
  const before = diagnostics.length;
  const res = await f.invoke(input, fetcher);
  assert.equal(diagnostics.length - before, 1, "exactly one diagnostic per failed request");
  return { res, body: await res.clone().json(), diag: parseDiag(diagnostics.at(-1)) };
}
function expectDiag(diag, family, httpStatus, failureSource, failureStage, normalizedReason, providerAttempted) {
  assert.deepEqual(
    { routeFamily: diag.routeFamily, httpStatus: diag.httpStatus, failureSource: diag.failureSource, failureStage: diag.failureStage, normalizedReason: diag.normalizedReason, providerAttempted: diag.providerAttempted },
    { routeFamily: family, httpStatus, failureSource, failureStage, normalizedReason, providerAttempted },
  );
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push([name, "PASS"]); }
  catch (e) { results.push([name, `FAIL ${String(e?.message ?? e).slice(0, 160)}`]); }
}

await check("R1 per-user daily Routes limit → roamie_guard/daily_budget, no provider call", async () => {
  const f = fixture(); const calls = upstreamCalls;
  await f.seed(`user:${userId}`, `user:family:routes:${day}`, 150, "family");
  const { res, body, diag } = await single(ROUTES, f, neverCalled);
  assert.equal(res.status, 429); assert.deepEqual(body, { error: "rate_limited", reason: "user_rate_limited" }, "public contract unchanged");
  expectDiag(diag, "routes", 429, "roamie_guard", "daily_budget", "family_daily_limit", false);
  assert.equal(upstreamCalls, calls);
});
await check("R2 per-user daily Directions limit → roamie_guard/daily_budget", async () => {
  const f = fixture(); const calls = upstreamCalls;
  await f.seed(`user:${userId}`, `user:family:directions:${day}`, 80, "family");
  const { res, diag } = await single(DIRECTIONS, f, neverCalled);
  assert.equal(res.status, 429);
  expectDiag(diag, "directions", 429, "roamie_guard", "daily_budget", "family_daily_limit", false);
  assert.equal(upstreamCalls, calls);
});
await check("R3 IP weighted budget → roamie_guard/weighted_budget ip_weight", async () => {
  const f = fixture(); const calls = upstreamCalls;
  await f.seed(`ip:${ip}`, `ip:weight:${day}`, 12_000, "ip_weight");
  const { res, body, diag } = await single(ROUTES, f, neverCalled);
  assert.equal(res.status, 429); assert.equal(body.reason, "ip_rate_limited");
  expectDiag(diag, "routes", 429, "roamie_guard", "weighted_budget", "ip_weight", false);
  assert.equal(upstreamCalls, calls);
});
await check("R4 global weighted budget → roamie_guard/weighted_budget global_weight", async () => {
  const f = fixture({ globalUnits: 10 }); const calls = upstreamCalls;
  await f.seed("global:google", `global:weight:${day}`, 10, "global_weight");
  const { res, body, diag } = await single(DIRECTIONS, f, neverCalled);
  assert.equal(res.status, 429); assert.equal(body.reason, "global_budget_limited");
  expectDiag(diag, "directions", 429, "roamie_guard", "weighted_budget", "global_weight", false);
  assert.equal(upstreamCalls, calls);
});
await check("R5 Worker minute limiter (user, ip, guest) → worker_rate_limiter/minute_limiter", async () => {
  const calls = upstreamCalls;
  for (const [role, deny, reason] of [["user", "google:user:", "user_rate_limited"], ["user", "google:ip:", "ip_rate_limited"], ["guest", "google:guest:", "guest_rate_limited"]]) {
    const f = fixture({ role, limiter: (key) => !key.startsWith(deny) });
    const { res, body, diag } = await single(ROUTES, f, neverCalled);
    assert.equal(res.status, 429); assert.deepEqual(body, { error: "rate_limited", reason });
    assert.equal(res.headers.get("Retry-After"), "60");
    expectDiag(diag, "routes", 429, "worker_rate_limiter", "minute_limiter", "burst_limited", false);
  }
  assert.equal(upstreamCalls, calls);
});
await check("R6 Google upstream 429 → google_upstream/provider_request, body unchanged", async () => {
  const f = fixture(); const calls = upstreamCalls;
  const { res, body, diag } = await single(ROUTES, f, () => new Response("{}", { status: 429 }));
  assert.equal(res.status, 429);
  assert.deepEqual(body, { error: { status: "RESOURCE_EXHAUSTED", message: "google_upstream_unavailable" } });
  expectDiag(diag, "routes", 429, "google_upstream", "provider_request", "upstream_http_429", true);
  assert.equal(upstreamCalls, calls + 1);
});
await check("R7 Google upstream 403 / 503 / body OVER_QUERY_LIMIT → google_upstream", async () => {
  const calls = upstreamCalls;
  for (const status of [403, 503]) {
    const { res, diag } = await single(ROUTES, fixture(), () => new Response("{}", { status }));
    assert.equal(res.status, 502);
    expectDiag(diag, "routes", 502, "google_upstream", "provider_request", `upstream_http_${status}`, true);
  }
  const { res, diag } = await single(DIRECTIONS, fixture(), () => Response.json({ status: "OVER_QUERY_LIMIT", error_message: "secret text" }));
  assert.equal(res.status, 502);
  expectDiag(diag, "directions", 502, "google_upstream", "provider_request", "body_status_OVER_QUERY_LIMIT", true);
  const odd = await single(DIRECTIONS, fixture(), () => Response.json({ status: "SOMETHING <script>" }));
  assert.equal(odd.diag.normalizedReason, "body_error", "non-allowlisted upstream status is not echoed");
  assert.equal(upstreamCalls, calls + 4);
});
await check("R8 upstream success → 200, no diagnostic (routes, directions)", async () => {
  const before = diagnostics.length; const calls = upstreamCalls;
  const a = await fixture().invoke(ROUTES, okRoutes);
  const b = await fixture().invoke(DIRECTIONS, () => Response.json({ status: "ZERO_RESULTS", routes: [] }));
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(diagnostics.length, before, "no success logging");
  assert.equal(upstreamCalls, calls + 2);
});
await check("R9 unclassifiable guard reply is never labelled a budget; null reason → unknown", async () => {
  // invoke() rejects any reason outside the charged buckets, so it surfaces as guard_unavailable (503), not a fake budget 429.
  const opaque = { idFromName: (n) => n, get: () => ({ fetch: async () => Response.json({ ok: false, replay: false, reason: "mystery_bucket", retryAt: 0 }) }) };
  const calls = upstreamCalls;
  const { res, diag } = await single(ROUTES, fixture({ guardOverride: opaque }), neverCalled);
  assert.equal(res.status, 503);
  expectDiag(diag, "routes", 503, "roamie_guard", "unknown", "guard_unavailable", false);
  assert.deepEqual(guardDenialClassification(null), { failureSource: "unknown", failureStage: "unknown", normalizedReason: "unknown" });
  assert.deepEqual(guardDenialClassification("ai_window"), { failureSource: "unknown", failureStage: "unknown", normalizedReason: "unknown" });
  assert.equal(upstreamCalls, calls);
});
await check("R10 client: no HTTP backfill into upstreamGoogleStatus; httpStatus kept", async () => {
  const env = { ABUSE_GUARD_ENFORCEMENT: "true", ABUSE_GUARD: createMemoryAbuseGuard().namespace,
    GOOGLE_API_RATE_LIMITER: { limit: async () => ({ success: false }) }, GOOGLE_ROUTES_SERVER_API_KEY: serverKey };
  const viaProxy = (fn) => runWithWorkerRequest({ env, request: new Request("https://roamie.tw/api/google", { headers: { "cf-connecting-ip": ip } }) },
    () => runWithVerifiedPrincipal(userId, fn));
  const o = { lat: 35.6812, lng: 139.7671 }, d = { lat: 35.7101, lng: 139.8107 };
  const r = await viaProxy(() => fetchGoogleRoute(serverKey, o, d, "WALK"));
  assert.equal(r.ok, false); assert.equal(r.failureTelemetry.httpStatus, 429);
  assert.equal(r.failureTelemetry.upstreamGoogleStatus, null);
  const dir = await viaProxy(() => fetchGoogleDirectionsRoute(serverKey, { coords: o }, { coords: d }, "transit"));
  assert.equal(dir.ok, false); assert.equal(dir.failureTelemetry.httpStatus, 429);
  assert.equal(dir.googleStatus, "429", "existing result field untouched");
  assert.equal(dir.failureTelemetry.upstreamGoogleStatus, null, "429 is not a Google status");
  env.GOOGLE_API_RATE_LIMITER = { limit: async () => ({ success: true }) };
  const saved = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ status: "ZERO_RESULTS", routes: [] });
  try {
    const zero = await viaProxy(() => fetchGoogleDirectionsRoute(serverKey, { coords: o }, { coords: d }, "transit"));
    assert.equal(zero.failureTelemetry.upstreamGoogleStatus, "ZERO_RESULTS", "verifiable 2xx Google body status kept");
  } finally { globalThis.fetch = saved; }
});
await check("R11 providerAttempted=false whenever the provider is not called", async () => {
  const notAttempted = diagnostics.map((l) => parseDiag(l)).filter((d) => d.failureSource !== "google_upstream" && d.failureStage !== "provider_request");
  assert.ok(notAttempted.length >= 8);
  assert.ok(notAttempted.every((d) => d.providerAttempted === false));
  const before = diagnostics.length;
  const res = await fixture({ guardOverride: { idFromName: (n) => n, get: () => ({ fetch: async () => { throw new Error("down"); } }) } }).invoke(ROUTES, neverCalled);
  assert.equal(res.status, 503);
  const d = parseDiag(diagnostics.at(-1));
  assert.equal(diagnostics.length, before + 1);
  assert.deepEqual([d.failureSource, d.normalizedReason, d.providerAttempted], ["roamie_guard", "guard_unavailable", false]);
});
await check("R12 providerAttempted=true only after a real fetch (incl. thrown fetch)", async () => {
  const calls = upstreamCalls;
  const { res, diag } = await single(DIRECTIONS, fixture(), () => { throw new TypeError("network down"); });
  assert.equal(res.status, 502);
  expectDiag(diag, "directions", 502, "unknown", "provider_request", "provider_exception", true);
  assert.equal(upstreamCalls, calls + 1);
  const attempted = diagnostics.map((l) => parseDiag(l)).filter((d) => d.providerAttempted);
  assert.ok(attempted.every((d) => d.failureStage === "provider_request"));
});
await check("R13 diagnostics carry only safe fields; no key/token/user/IP/coords/places", async () => {
  assert.ok(diagnostics.length >= 15);
  const allowed = ["timestamp", "requestId", "routeFamily", "httpStatus", "failureSource", "failureStage", "normalizedReason", "providerAttempted"];
  for (const line of diagnostics) {
    const d = parseDiag(line);
    assert.deepEqual(Object.keys(d).sort(), [...allowed].sort());
    assert.match(d.requestId, /^[0-9a-f-]{36}$/);
    for (const banned of [serverKey, "AIza", "Bearer", "diag-fixture-token", userId, ip, "35.68", "139.7", "fixture", "secret text", "12000", "user:", "ip:", "global:"])
      assert.equal(line.includes(banned), false, `leaked ${banned}`);
  }
  const before = diagnostics.length;
  await fixture().invoke(PLACES, () => new Response("{}", { status: 429 }));
  assert.equal(diagnostics.length, before, "non-route families are not logged");
});
await check("R14 Google provider calls do not increase (exact count per case)", async () => {
  assert.equal(upstreamCalls, 1 + 4 + 2 + 1 + 1, "only R6, R7, R8, R12 and the R13 places call reached the provider");
});
await check("R15 transit 429 stays a non-throwing rate_limited result; raw log shows upstreamGoogleStatus=unknown", async () => {
  clearRouteDurationCache(); clearScopedRouteCache();
  const unused = async () => { throw new Error("unused"); };
  bindRoutesServerFns({
    computeDuration: async () => ({ ok: false, statusCode: 429, googleStatus: "429", message: "429",
      failureTelemetry: { endpoint: "directions_api", httpStatus: 429, httpOk: false, googleStatus: "429", upstreamGoogleStatus: null, googleErrorMessage: "", routesCount: 0, legsCount: 0, parserResult: "parsed", failureKind: "http_error", exceptionName: "", exceptionMessage: "" } }),
    computeDistance: unused, computeTripLegs: unused, computeLegEstimates: unused, testConnection: unused,
  });
  const r = await fetchScopedLegDuration({
    scope: { tripId: "diag-trip", dateKey: "2026-12-08", dayIndex: 0, legIndex: 0, legKey: "a→b-diag" },
    origin: { lat: 35.0, lng: 135.78 }, destination: { lat: 35.01, lng: 135.78 }, preferredMode: "WALK", allowModeFallback: true,
    query: { region: "tw", locationContext: "台灣 台北" },
  });
  assert.equal(r.ok, false); assert.equal(r.fallbackReason, "rate_limited");
  const line = rawStatus.at(-1) ?? "";
  assert.match(line, /httpStatus=429/); assert.match(line, /upstreamGoogleStatus=unknown/);
  assert.equal(/\bgoogleStatus=429/.test(line), false, "no HTTP code presented as a Google status");
});

for (const [name, status] of results) out(status.padEnd(4).slice(0, 4) === "PASS" ? "PASS" : "FAIL", name, status === "PASS" ? "" : status);
const failed = results.filter(([, s]) => s !== "PASS").length;
out(`${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
