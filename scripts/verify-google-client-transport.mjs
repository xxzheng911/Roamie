import assert from "node:assert/strict";
import { build, stop } from "esbuild";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createMemoryAbuseGuard } from "../src/lib/abuse-guard-memory.ts";
import { handleGoogleProxy } from "../src/lib/google-proxy.server.ts";
import { fetchGoogleRestProvider } from "../src/lib/google-rest-provider.server.ts";
import { requireAuthenticatedAiRequest } from "../src/lib/ai/endpoint-guard.server.ts";
import { markPublicReadAuthorized, resolveTrustedUserId, runWithWorkerRequest } from "../src/lib/worker-request-scope.ts";
import { utcDay } from "../src/lib/abuse-guard-clock.ts";
import { GOOGLE_FAMILY_LIMITS, GOOGLE_IP_DAILY_WEIGHT, GOOGLE_GLOBAL_DAILY_UNITS_DEFAULT } from "../src/lib/abuse-guard-policy.ts";
const dir = mkdtempSync(join(tmpdir(), "google-transport-"));
const original = globalThis.fetch;
const originalWindow = globalThis.window;
try {
  const file = join(dir, "fixture.cjs");
  await build({
    stdin: {
      contents: `export {googleRestFetch} from './src/lib/google-rest-transport'; export {googleRestRequest} from './src/lib/google-rest-contract';export {computeRouteFromClient} from './src/lib/google-routes-client';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    loader: { ".png": "dataurl", ".jpg": "dataurl" },
    platform: "node",
    format: "cjs",
    outfile: file,
    define: {
      "import.meta.env": JSON.stringify({ SSR: false, VITE_APP_ORIGIN: "https://roamie.example" }),
    },
    plugins: [
      {
        name: "session",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/auth-session$/ }, () => ({
            path: "session",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents: "export const getClientAuthSession=async()=>globalThis.fixtureSession",
            loader: "js",
          }));
        },
      },
    ],
  });
  const { googleRestFetch, googleRestRequest, computeRouteFromClient } = createRequire(
    import.meta.url,
  )(file);
  globalThis.fixtureSession = { access_token: "verified-session-fixture" };
  let requests = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, globalThis.window ? "https://roamie.example/api/google" : "/api/google");
    assert.equal(init.headers.Authorization, "Bearer verified-session-fixture");
    assert.ok(!init.body.includes("AIza"));
    assert.ok(!init.body.includes("X-Goog-Api-Key"));
    const input = JSON.parse(init.body);
    const spec = googleRestRequest(input);
    requests.push(spec);
    return Response.json(
      spec.url.includes("/directions/json")
        ? {
            status: "OK",
            routes: [{ legs: [{ duration: { value: 600 }, distance: { value: 1000 } }] }],
          }
        : {
            routes: [{ duration: "600s", distanceMeters: 1000 }],
            places: [],
            suggestions: [],
            results: [],
          },
    );
  };
  const publicKey = "AIza" + "x".repeat(35);
  for (const request of [
    {
      url: "https://places.googleapis.com/v1/places:searchText",
      body: { textQuery: "Tokyo", pageSize: 20 },
    },
    {
      url: "https://places.googleapis.com/v1/places:searchNearby",
      body: {
        maxResultCount: 20,
        locationRestriction: { circle: { center: { latitude: 35, longitude: 139 }, radius: 1000 } },
      },
    },
    {
      url: "https://places.googleapis.com/v1/places:autocomplete",
      body: { input: "Tokyo", includedPrimaryTypes: ["(regions)"] },
    },
    {
      url: "https://places.googleapis.com/v1/places/ChIJfixture?languageCode=ja",
      fields: "id,location,addressComponents",
    },
    { url: "https://maps.googleapis.com/maps/api/geocode/json?address=Tokyo&key=" + publicKey },
    { url: "https://maps.googleapis.com/maps/api/geocode/json?latlng=35,139&key=" + publicKey },
  ]) {
    const res = await googleRestFetch(request.url, {
      method: request.body ? "POST" : "GET",
      headers: {
        "X-Goog-Api-Key": publicKey,
        ...(request.fields ? { "X-Goog-FieldMask": request.fields } : {}),
      },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    });
    assert.equal(res.status, 200);
  }
  for (const mode of ["DRIVE", "WALK", "TRANSIT"]) {
    const result = await computeRouteFromClient({ lat: 35, lng: 139 }, { lat: 36, lng: 140 }, mode);
    assert.equal(result.ok, true);
    assert.equal(result.data.durationMinutes, 10);
    assert.equal(result.data.distanceMeters, 1000);
  }
  globalThis.window = {
    Capacitor: { isNativePlatform: () => true },
    location: { origin: "null", href: "capacitor://localhost/index.html" },
  };
  for (const mode of ["DRIVE", "WALK", "TRANSIT"]) {
    const result = await computeRouteFromClient({ lat: 35, lng: 139 }, { lat: 36, lng: 140 }, mode);
    assert.equal(result.ok, true);
    assert.equal(result.data.durationMinutes, 10);
    assert.equal(result.data.distanceMeters, 1000);
    assert.ok(requests.at(-1).url.includes("/directions/json"));
  }
  assert.equal(requests.length, 12);
  assert.ok(requests.some((r) => r.fields === "id,location,addressComponents"));
  // Exercise the actual client -> proxy -> provider pipeline. Only the external
  // authenticator, Cloudflare binding, durable storage and Google network are fixtures.
  globalThis.window = undefined;
  const ip = "203.0.113.82";
  const textUrl = "https://places.googleapis.com/v1/places:searchText";
  const textInit = { method: "POST", body: JSON.stringify({ textQuery: "Tokyo", pageSize: 1 }) };
  let state;
  function reset() {
    globalThis.fixtureSession = null;
    const guard = createMemoryAbuseGuard();
    state = { guard, upstream: 0, auth: 0, limiter: [], trustedIp: ip, denied: false,
      env: { ABUSE_GUARD: guard.namespace,
        GOOGLE_PLACES_SERVER_API_KEY: publicKey,
        GOOGLE_ROUTES_SERVER_API_KEY: publicKey,
        GOOGLE_GEOCODING_SERVER_API_KEY: publicKey } };
    state.env.GOOGLE_API_RATE_LIMITER = { limit: async ({ key }) => {
      state.limiter.push(key);
      return { success: !state.denied };
    } };
  }
  const weight = () => state.guard.counter(`ip:${ip}`, `ip:weight:${utcDay()}`);
  const globalWeight = () => state.guard.counter("global:google", `global:weight:${utcDay()}`);
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/google");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), globalThis.fixtureSession
      ? `Bearer ${globalThis.fixtureSession.access_token}` : null);
    assert.ok(!init.body.includes(publicKey), "client credentials never cross the proxy wire");
    if (state.trustedIp) headers.set("cf-connecting-ip", state.trustedIp);
    headers.set("x-forwarded-for", "203.0.113.99");
    headers.set("x-user-id", "forged-user");
    const request = new Request("https://roamie.example/api/google", { ...init, headers });
    return handleGoogleProxy(request, state.env, {
      authenticate: async (req) => {
        state.auth += 1;
        return req.headers.get("authorization") === "Bearer verified-session-fixture" ? "verified-user" : null;
      },
      provider: (input, env) => fetchGoogleRestProvider(input, env, async () => {
        state.upstream += 1;
        return Response.json({ places: [], results: [] });
      }),
    });
  };
  reset();
  assert.equal((await googleRestFetch(textUrl, textInit)).status, 200);
  assert.equal(state.auth, 0, "absent Authorization is the Guest path");
  assert.equal(state.upstream, 1);
  assert.deepEqual(state.limiter, [`google:ip:${ip}`, `google:guest:${ip}`]);
  assert.equal(weight(), GOOGLE_FAMILY_LIMITS.places_text.weight);
  assert.equal(globalWeight(), GOOGLE_FAMILY_LIMITS.places_text.weight);

  for (const token of ["invalid-token", "expired-token"]) {
    reset();
    globalThis.fixtureSession = { access_token: token };
    assert.equal((await googleRestFetch(textUrl, textInit)).status, 401);
    assert.equal(state.auth, 1);
    assert.equal(state.upstream, 0);
    assert.equal(weight(), 0);
    assert.equal(globalWeight(), 0);
    assert.ok(!state.limiter.includes(`google:guest:${ip}`), "invalid Bearer never falls back to Guest");
  }
  for (const [url, init] of [
    ["https://places.googleapis.com/v1/places:unsupported", textInit],
    ["https://evil.example/v1/places:searchText", textInit],
    ["https://places.googleapis.com/v1/places/ChIJfixture", { method: "DELETE" }],
    ["https://places.googleapis.com/v1/places/ChIJfixture", { method: "PATCH", body: "{}" }],
  ]) {
    reset();
    assert.equal((await googleRestFetch(url, init)).status, 400, "non-public operations are not admitted");
    assert.equal(state.upstream, 0);
    assert.equal(weight(), 0);
    assert.equal(globalWeight(), 0);
  }
  reset();
  state.trustedIp = null;
  assert.equal((await googleRestFetch(textUrl, textInit)).status, 401, "forwarded/user headers cannot establish Guest identity");
  assert.equal(state.upstream, 0);
  reset();
  state.denied = true;
  assert.equal((await googleRestFetch(textUrl, textInit)).status, 429);
  assert.equal(state.upstream, 0);
  assert.equal(weight(), 0);
  reset();
  delete state.env.GOOGLE_API_RATE_LIMITER;
  assert.equal((await googleRestFetch(textUrl, textInit)).status, 503);
  assert.equal(state.upstream, 0);
  for (const [name, bucket, limit] of [
    [`ip:${ip}`, `ip:weight:${utcDay()}`, GOOGLE_IP_DAILY_WEIGHT],
    ["global:google", `global:weight:${utcDay()}`, GOOGLE_GLOBAL_DAILY_UNITS_DEFAULT],
  ]) {
    reset();
    const seeded = await state.guard.namespace.get(name).fetch(new Request("https://abuse-guard.internal/", {
      method: "POST", body: JSON.stringify({ action: "charge", operationId: "seed",
        buckets: [{ key: bucket, limit, delta: limit, reason: "fixture", retryAt: Date.now() + 86400000 }] }),
    }));
    assert.equal((await seeded.json()).ok, true);
    assert.equal((await googleRestFetch(textUrl, textInit)).status, 429);
    assert.equal(state.upstream, 0, "exhausted durable budgets block upstream");
  }
  reset();
  state.env.ABUSE_GUARD = { idFromName: name => name, get: () => ({ fetch: async () => { throw new Error("fixture DO outage"); } }) };
  assert.equal((await googleRestFetch(textUrl, textInit)).status, 503);
  assert.equal(state.upstream, 0, "DO failure is fail-closed");
  reset();
  const aiRequest = new Request("https://roamie.example/api/roamie", { method: "POST", headers: { "cf-connecting-ip": ip } });
  await runWithWorkerRequest({ env: state.env, request: aiRequest }, async () => {
    markPublicReadAuthorized(ip);
    assert.equal(resolveTrustedUserId(), null, "public read cannot establish account authority");
    assert.equal(await requireAuthenticatedAiRequest(aiRequest), null, "Guest public read cannot authorize AI");
  });
  const trips = readFileSync("src/lib/trips.functions.ts", "utf8");
  assert.match(trips, /requireSupabaseAuth/);
  assert.doesNotMatch(trips, /allowGuestPublicRead/);
  for (const path of ["roamie", "chat", "generate-itinerary"]) {
    const source = readFileSync(`src/routes/api/${path}.ts`, "utf8");
    assert.match(source, /requireAuthenticatedAiRequest/);
    assert.doesNotMatch(source, /allowGuestPublicRead/);
  }
  reset();
  globalThis.fixtureSession = { access_token: "verified-session-fixture" };
  assert.equal((await googleRestFetch(textUrl, textInit)).status, 200);
  assert.equal(state.auth, 1);
  assert.equal(state.upstream, 1);
  assert.equal(weight(), 8, "authenticated transport must consume IP daily budget too");
  assert.equal(globalWeight(), 8, "authenticated transport must consume global daily budget");
  console.log("PASS Google transport: 12 authenticated browser/native cases; Guest public-read, whitelist, trusted identity, limiter, durable budgets, fail-closed, invalid Bearer, AI and write boundaries");
} finally {
  globalThis.fetch = original;
  globalThis.window = originalWindow;
  delete globalThis.fixtureSession;
  stop();
  rmSync(dir, { recursive: true, force: true });
}
