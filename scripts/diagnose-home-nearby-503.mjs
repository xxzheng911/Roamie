// Mock-only diagnostic for Home Nearby HTTP 503 (google_unavailable). No real Google calls.
import assert from "node:assert/strict";

process.env.ABUSE_GUARD_ENFORCEMENT = "1";
let upstreamCalls = 0;
let upstreamMode = "ok";
const realNow = Date.now.bind(Date);
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;
globalThis.fetch = async (url) => {
  upstreamCalls++;
  if (upstreamMode === "timeout") throw new DOMException("timed out", "TimeoutError");
  if (upstreamMode === "google503") return new Response("{}", { status: 503 });
  assert.match(String(url), /places\.googleapis\.com/);
  return Response.json({ places: [{
    id: "ChIJMockNearby1", displayName: { text: "Mock Cafe" }, location: { latitude: 25.04, longitude: 121.56 },
    types: ["cafe", "food", "point_of_interest", "establishment"], primaryType: "cafe", rating: 4.6, userRatingCount: 500,
    businessStatus: "OPERATIONAL", formattedAddress: "台北市信義區", shortFormattedAddress: "信義區",
    regularOpeningHours: { openNow: true }, currentOpeningHours: { openNow: true },
  }] });
};
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };

const { executeExploreSearch } = await import("/src/lib/places.functions.ts");
const { createUnifiedSearchPlacesFn } = await import("/src/lib/places-search-unified.ts");
const { runWithWorkerRequest, runWithVerifiedPrincipal } = await import("/src/lib/worker-request-scope.ts");
const { createMemoryAbuseGuard } = await import("/src/lib/abuse-guard-memory.ts");

let guardMode = "ok";
let guardCalls = 0;
const memory = createMemoryAbuseGuard();
const env = {
  ABUSE_GUARD: {
    idFromName: (n) => n,
    get: (n) => ({ fetch: async (request) => {
      guardCalls++;
      if (guardMode === "do_error") return new Response("down", { status: 500 }); // → guard_unavailable
      if (guardMode === "rate_limited") {
        const command = await request.clone().json();
        if (command.action === "charge") return Response.json({ ok: false, reason: "user_weight", retryAt: Date.now() + 60_000 });
      }
      return memory.namespace.get(n).fetch(request);
    } }),
  },
  GOOGLE_API_RATE_LIMITER: { limit: async () => ({ success: true }) },
  GOOGLE_PLACES_SERVER_API_KEY: "AIzaMockServerKeyForDiagnosticOnly0000000",
  ABUSE_GUARD_ANALYTICS: { writeDataPoint() {} },
};
const request = new Request("https://roamie.tw/api/google", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.7" } });
const inWorker = (fn) => runWithWorkerRequest({ env, request }, () => runWithVerifiedPrincipal("mock-user", fn));
const serverFn = async ({ data }) => executeExploreSearch(data);
const search = createUnifiedSearchPlacesFn(serverFn);

let seq = 0;
const shiftOf = (cat) => (String(cat).split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 97) * 0.00003;
const nearby = (extra = {}) => ({
  query: "", lat: 25.04 + shiftOf(extra.cat ?? 0), lng: 121.56, radius: 1500, mode: "nearby",
  includedTypes: ["cafe"], locale: "zh-TW", categoryId: "all", placesScreen: "home", ...extra.data,
});
async function run(label, data, modes) {
  upstreamMode = modes.upstream ?? "ok";
  guardMode = modes.guard ?? "ok";
  const savedKey = process.env.GOOGLE_PLACES_SERVER_API_KEY;
  if (modes.noKey) { delete env.GOOGLE_PLACES_SERVER_API_KEY; delete process.env.GOOGLE_PLACES_SERVER_API_KEY; }
  const before = { up: upstreamCalls, guard: guardCalls };
  const result = await inWorker(() => search({ data }));
  if (modes.noKey) { env.GOOGLE_PLACES_SERVER_API_KEY = "AIzaMockServerKeyForDiagnosticOnly0000000"; if (savedKey) process.env.GOOGLE_PLACES_SERVER_API_KEY = savedKey; }
  const row = { label, places: result.places.length, error: result.error ?? null,
    upstreamCalls: upstreamCalls - before.up, guardCalls: guardCalls - before.guard };
  console.log("RESULT", JSON.stringify(row));
  return row;
}

const CASE = process.env.CASE;
if (CASE === "layers_503") {
  console.log("LAYER native", (await import("/src/lib/capacitor-native-shell.ts")).isCapacitorNativeShell());
  guardMode = "do_error";
  const direct = await inWorker(() => executeExploreSearch(nearby({ cat: "z" })));
  console.log("LAYER executeExploreSearch", JSON.stringify(direct));
  const { normalizePlacesSearchResult } = await import("/src/lib/places-search-normalize.ts");
  console.log("LAYER normalize", JSON.stringify(normalizePlacesSearchResult(direct)));
  clockOffset += 60_000;
  const unified = await inWorker(() => search({ data: nearby({ cat: "y" }) }));
  console.log("LAYER unified", JSON.stringify(unified));
  process.exit(0);
}
const cases = {
  nearby_success: () => run("nearby_success", nearby({ cat: "a" }), {}),
  nearby_guard_503: () => run("nearby_guard_503", nearby({ cat: "b" }), { guard: "do_error" }),
  text_guard_503: () => run("text_guard_503", nearby({ cat: "c", data: { mode: "text", query: "台北 咖啡" } }), { guard: "do_error" }),
  provider_timeout: () => run("provider_timeout", nearby({ cat: "d" }), { upstream: "timeout" }),
  google_upstream_503: () => run("google_upstream_503", nearby({ cat: "e" }), { upstream: "google503" }),
  abuse_guard_429: () => run("abuse_guard_429", nearby({ cat: "f" }), { guard: "rate_limited" }),
  missing_provider_config: () => run("missing_provider_config", nearby({ cat: "g" }), { noKey: true }),
  cooldown_and_recovery: async () => {
    const homeKey = nearby({ cat: "h" });
    await run("restart_first_load_503", homeKey, { guard: "do_error" });
    await run("immediate_retry_same_key", homeKey, {});
    await run("immediate_other_key", nearby({ cat: "i" }), {});
    clockOffset += 31 * 1000;
    await run("after_31s_same_key", homeKey, {});
    await run("after_31s_other_key", nearby({ cat: "j" }), {});
    clockOffset += 11 * 60 * 1000;
    await run("after_11min_same_key", homeKey, {});
  },
};
await cases[CASE]();
