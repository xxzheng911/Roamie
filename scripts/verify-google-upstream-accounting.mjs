import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installWorkerRequestStorage } from "../src/lib/worker-request-als.server.ts";
import { runWithWorkerRequest, runWithVerifiedPrincipal, markPublicReadAuthorized } from "../src/lib/worker-request-scope.ts";
import { createMemoryAbuseGuard } from "../src/lib/abuse-guard-memory.ts";
import { utcDay } from "../src/lib/abuse-guard-clock.ts";
import { GOOGLE_FAMILY_LIMITS, googleIpBuckets, googleUserBuckets } from "../src/lib/abuse-guard-policy.ts";
import { fetchGoogleRestProvider } from "../src/lib/google-rest-provider.server.ts";
import { handleGoogleProxy } from "../src/lib/google-proxy.server.ts";
import { handlePlacePhotoRequest } from "../src/routes/api/place-photo.ts";
import { signPlacePhoto, sealPlacePhotoPrincipal, openPlacePhotoPrincipal } from "../src/lib/place-photo-signature.server.ts";
import { getTripLegsWithDurations } from "../src/lib/google-routes.server.ts";
import { runGoogleUpstreamAttempt } from "../src/lib/google-upstream-attempt.server.ts";
import { Route as PhotoSignRoute } from "../src/routes/api/place-photo/sign.ts";
import { resolveSignedPhotoResponse } from "../src/lib/place-photo-response.ts";
import { runPlacesApiDeduped, resetPlacesProviderLimiterForTests } from "../src/lib/places-api-guard.ts";

installWorkerRequestStorage();
delete process.env.ABUSE_GUARD_ENFORCEMENT;
delete process.env.DISABLE_GOOGLE_PROXY;
const day = utcDay();
const ip = "203.0.113.89";
const serverKey = "AIza" + "x".repeat(35);
const text = { url: "https://places.googleapis.com/v1/places:searchText", method: "POST", body: { textQuery: "fixture", pageSize: 1 } };
const cases = {
  places_text: text,
  places_nearby: { url: "https://places.googleapis.com/v1/places:searchNearby", method: "POST", body: { locationRestriction: { circle: { center: { latitude: 25, longitude: 121 }, radius: 500 } }, maxResultCount: 1 } },
  places_details: { url: "https://places.googleapis.com/v1/places/ChIJfixture", method: "GET" },
  places_autocomplete: { url: "https://places.googleapis.com/v1/places:autocomplete", method: "POST", body: { input: "fixture" } },
  geocoding: { url: "https://maps.googleapis.com/maps/api/geocode/json?address=fixture", method: "GET" },
  routes: { url: "https://routes.googleapis.com/directions/v2:computeRoutes", method: "POST", body: { origin: { location: { latLng: { latitude: 25, longitude: 121 } } }, destination: { location: { latLng: { latitude: 25.1, longitude: 121.1 } } }, travelMode: "WALK" } },
  directions: { url: "https://maps.googleapis.com/maps/api/directions/json?origin=fixture&destination=other", method: "GET" },
};
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
function fixture(role = "guest", flag) {
  const guard = createMemoryAbuseGuard();
  const events = [];
  const admissions = new Set();
  const env = {
    ABUSE_GUARD: {
      idFromName: n => n,
      get: n => ({ fetch: async request => {
        const command = await request.clone().json();
        const response = await guard.namespace.get(n).fetch(request);
        const result = await response.clone().json();
        if (n === "global:google" && command.action === "charge" && result.ok && !result.replay)
          admissions.add(command.operationId);
        return response;
      } }),
    },
    GOOGLE_API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    GOOGLE_PLACES_SERVER_API_KEY: serverKey,
    GOOGLE_ROUTES_SERVER_API_KEY: serverKey,
    GOOGLE_GEOCODING_SERVER_API_KEY: serverKey,
    PLACE_PHOTO_SIGNING_SECRET: "accounting-fixture-secret-at-least-32",
    WORKER_VERSION_METADATA: { id: "11111111-1111-4111-8111-111111111111" },
    ABUSE_GUARD_ANALYTICS: { writeDataPoint: event => events.push(event) },
    ...(flag ? { ABUSE_GUARD_ENFORCEMENT: flag } : {}),
  };
  let upstream = 0;
  const userId = role === "guest" ? null : `${role}-private-user`;
  const request = (id = "client-supplied-fixed-id") => new Request("https://roamie.tw/api/google", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, "x-roamie-request-id": id,
      ...(userId ? { authorization: "Bearer fixture-token" } : {}) }, body: JSON.stringify(text),
  });
  const run = fn => runWithWorkerRequest({ env, request: request() }, () => userId
    ? runWithVerifiedPrincipal(userId, fn) : (markPublicReadAuthorized(ip), fn()));
  const fetcher = async () => { upstream++; return Response.json({ places: [] }); };
  const invoke = input => run(() => fetchGoogleRestProvider(input, env, fetcher));
  const count = () => upstream;
  const ipWeight = () => guard.counter(`ip:${ip}`, `ip:weight:${day}`);
  const globalWeight = () => guard.counter("global:google", `global:weight:${day}`);
  const userWeight = () => userId ? guard.counter(`user:${userId}`, `user:weight:${day}`) : 0;
  return { guard, env, events, admissions, request, run, fetcher, invoke, count, ipWeight, globalWeight, userWeight, userId };
}
function metrics(f, name) { return f.events.filter(e => e.blobs[0] === name); }
function invariant(f, n, weight) {
  assert.equal(f.count(), n);
  assert.equal(f.admissions.size, n);
  assert.equal(f.ipWeight(), weight);
  assert.equal(f.globalWeight(), weight);
  assert.equal(f.userWeight(), f.userId ? weight : 0);
  assert.equal(metrics(f, "provider_attempt").length, n);
  assert.equal(metrics(f, "provider_attempt_without_guard").length, 0);
  for (const id of f.admissions) {
    assert.match(id, /^google-attempt:/);
    assert(!id.includes("client-supplied"));
  }
}
async function seed(f, name, buckets) {
  const response = await f.guard.namespace.get(name).fetch(new Request("https://fixture.invalid/", {
    method: "POST", body: JSON.stringify({ action: "charge", operationId: `seed:${name}`, buckets }),
  }));
  assert.equal((await response.json()).ok, true);
}

for (const flag of [undefined, "true"]) for (const role of ["guest", "free", "plus"]) {
  const label = `${role}/${flag ?? "unset"}`;
  for (const sameId of [false, true]) await test(`${label}: three ${sameId ? "replayed" : "distinct"} endpoint requests`, async () => {
    const f = fixture(role, flag);
    for (let i = 0; i < 3; i++) {
      const result = await handleGoogleProxy(f.request(sameId ? "same-id" : `request-${i}`), f.env, {
        authenticate: async () => f.userId,
        provider: (input, env) => fetchGoogleRestProvider(input, env, f.fetcher),
      });
      assert.equal(result.status, 200);
    }
    invariant(f, 3, 24);
  });
  await test(`${label}: failure then retry retains both charges`, async () => {
    const f = fixture(role, flag);
    const fail = await f.run(() => fetchGoogleRestProvider({ ...text, attemptKind: "initial" }, f.env, async () => {
      await f.fetcher(); throw new TypeError("mock upstream network failure");
    }));
    assert.equal(fail.status, 502);
    assert.equal((await f.invoke({ ...text, attemptKind: "retry" })).status, 200);
    invariant(f, 2, 16);
    assert.equal(metrics(f, "provider_failure").length, 1);
    assert.equal(metrics(f, "provider_success").length, 1);
    assert.equal(metrics(f, "provider_attempt").filter(e => e.blobs[9] === "retry").length, 1);
  });
  await test(`${label}: fallback and concurrent fan-out own separate attempts`, async () => {
    const f = fixture(role, flag);
    await f.run(async () => {
      await fetchGoogleRestProvider(text, f.env, f.fetcher);
      await fetchGoogleRestProvider({ ...text, body: { textQuery: "fallback" }, attemptKind: "fallback" }, f.env, f.fetcher);
      await Promise.all(Array.from({ length: 7 }, () => fetchGoogleRestProvider(text, f.env, f.fetcher)));
    });
    invariant(f, 9, 72);
    assert.equal(metrics(f, "provider_attempt").filter(e => e.blobs[9] === "fallback").length, 1);
  });
  await test(`${label}: all seven REST families use IP/global and authenticated user budgets`, async () => {
    const f = fixture(role, flag);
    for (const spec of Object.values(cases)) assert.equal((await f.invoke(spec)).status, 200);
    invariant(f, 7, Object.keys(cases).reduce((sum, family) => sum + GOOGLE_FAMILY_LIMITS[family].weight, 0));
  });
  await test(`${label}: IP daily and global daily rejection stop dispatch`, async () => {
    const f = fixture(role, flag);
    await seed(f, `ip:${ip}`, googleIpBuckets("places_text").map(b => ({ ...b, delta: b.limit })));
    const denied = await f.invoke(text);
    assert.equal(denied.status, 429); assert(Number(denied.headers.get("Retry-After")) > 0);
    assert.equal(f.count(), 0); assert.equal(f.globalWeight(), 0); assert.equal(f.userWeight(), 0);
    for (const family of ["places_text", "places_autocomplete"]) {
      const g = fixture(role, flag); g.env.GOOGLE_GLOBAL_DAILY_UNITS = "0";
      assert.equal((await g.invoke(cases[family])).status, 429);
      invariant(g, 0, 0);
    }
  });
  if (role !== "guest") await test(`${label}: user family and weighted daily ceilings`, async () => {
    for (const reason of ["family", "user_weight"]) {
      const f = fixture(role, flag);
      await seed(f, `user:${f.userId}`, googleUserBuckets("places_text").filter(b => b.reason === reason).map(b => ({ ...b, delta: b.limit })));
      assert.equal((await f.invoke(text)).status, 429);
      assert.equal(f.count(), 0); assert.equal(f.ipWeight(), 0); assert.equal(f.globalWeight(), 0);
    }
  });
  await test(`${label}: missing/failed/malformed/replayed/timed-out DO is fail closed`, async () => {
    const originalTimer = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => originalTimer(fn, ms === 2000 ? 5 : ms, ...args);
    try {
      for (const failure of [undefined,
        async () => { throw new Error("DO unavailable"); },
        async () => Response.json({ ok: true }),
        async () => Response.json({ ok: true, reason: "allowed", replay: true, retryAt: 0 }),
        async () => Response.json({ ok: true, reason: "wrong", replay: false, retryAt: 0 }),
        async () => new Promise(() => {}),
        async () => new Response("invalid-json"),
        async () => new Response("unavailable", { status: 503 }),
      ]) {
        const f = fixture(role, flag);
        f.env.ABUSE_GUARD = failure ? { idFromName: n => n, get: () => ({ fetch: failure }) } : undefined;
        assert.equal((await f.invoke(text)).status, 503);
        assert.equal(f.count(), 0); assert.equal(metrics(f, "provider_attempt").length, 0);
      }
    } finally { globalThis.setTimeout = originalTimer; }
  });
}

await test("actual Places retry loop charges a failed upstream and the successful retry", async () => {
  const f = fixture("free");
  resetPlacesProviderLimiterForTests();
  const result = await f.run(() => runPlacesApiDeduped("cost-guard-real-retry", "text", async (_signal, index) => {
    const response = await fetchGoogleRestProvider({ ...text, attemptKind: index ? "retry" : "initial" }, f.env, async () => {
      await f.fetcher();
      if (!index) throw new TypeError("mock network error");
      return Response.json({ places: [] });
    });
    if (!response.ok) throw new Error("places_http_502");
    return response;
  }));
  assert.equal(result.status, 200);
  invariant(f, 2, 16);
  assert.equal(metrics(f, "provider_attempt").filter(e => e.blobs[9] === "retry").length, 1);
});

await test("real trip-leg provider fan-out: 30 points means 29 separately protected calls; cache replay is free", async () => {
  const f = fixture("free");
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(new URL(url).hostname, "routes.googleapis.com");
    await f.fetcher();
    return Response.json({ routes: [{ duration: "600s", distanceMeters: 1000 }] });
  };
  const points = Array.from({ length: 30 }, (_, i) => ({ lat: 23 + i * 0.001, lng: 120.123 }));
  try {
    assert.equal((await f.run(() => getTripLegsWithDurations(points, "WALK"))).data.length, 29);
    invariant(f, 29, 116);
    await f.run(() => getTripLegsWithDurations(points, "WALK"));
    invariant(f, 29, 116);
    assert.equal(metrics(f, "cache_hit").length, 29);
    assert.equal(metrics(f, "cache_miss").length, 29);
  } finally { globalThis.fetch = original; }
});

await test("trip fan-out stops dispatch at global exhaustion, including remaining legs", async () => {
  const f = fixture("plus", "true"); f.env.GOOGLE_GLOBAL_DAILY_UNITS = "8";
  const original = globalThis.fetch;
  globalThis.fetch = async () => { await f.fetcher(); return Response.json({ routes: [{ duration: "60s", distanceMeters: 100 }] }); };
  try {
    await f.run(() => getTripLegsWithDurations(Array.from({ length: 6 }, (_, i) => ({ lat: 24 + i * 0.002, lng: 120.567 })), "WALK"));
    invariant(f, 2, 8);
  } finally { globalThis.fetch = original; }
});

for (const role of ["guest", "free", "plus", "legacy"]) await test(`${role}: Photos charge only actual media attempts, including replay, and global deny blocks Google`, async () => {
  const f = fixture(role === "legacy" ? "guest" : role);
  const photo = "places/ChIJfixture/photos/fixture";
  const audience = role === "legacy" ? undefined : role === "guest" ? "guest" : "authenticated";
  const principal = f.userId ? await sealPlacePhotoPrincipal(f.env, f.userId) : undefined;
  if (principal) {
    assert(!principal.includes(f.userId));
    assert.equal(await openPlacePhotoPrincipal(f.env, principal), f.userId);
  }
  const token = await signPlacePhoto(f.env, photo, 600, undefined, audience, principal);
  invariant(f, 0, 0);
  const url = new URL("https://roamie.tw/api/place-photo");
  for (const [k, v] of Object.entries({ photo, w: "600", expires: token.expires, signature: token.signature, ...(audience ? { aud: audience } : {}), ...(principal ? { principal } : {}) })) url.searchParams.set(k, String(v));
  const deps = { fetch: async () => { await f.fetcher(); return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { "content-type": "image/jpeg" } }); }, resolveServerKey: () => ({ key: serverKey, source: "GOOGLE_PLACES_SERVER_API_KEY" }), recordHttpCall: () => {}, timeoutMs: 1000 };
  const call = u => handlePlacePhotoRequest(new Request(u, { headers: { "cf-connecting-ip": ip, "x-roamie-request-id": "same-photo-id" } }), deps, f.env);
  for (let i = 0; i < 3; i++) assert.equal((await call(url)).status, 200);
  invariant(f, 3, 3);
  const tampered = new URL(url); tampered.searchParams.set("aud", audience === "guest" ? "authenticated" : "guest");
  assert.equal((await call(tampered)).status, 401);
  if (principal) { const changed = new URL(url); changed.searchParams.set("principal", await sealPlacePhotoPrincipal(f.env, "other-user")); assert.equal((await call(changed)).status, 401); }
  f.env.GOOGLE_GLOBAL_DAILY_UNITS = "3";
  assert.equal((await call(url)).status, 429); invariant(f, 3, 3);
  f.env.ABUSE_GUARD = undefined;
  assert.equal((await call(url)).status, 503); assert.equal(f.count(), 3);
});

await test("authenticated photo signer to client URL parser to media preserves encrypted cost principal", async () => {
  const f = fixture("plus");
  const original = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = "https://accounting-fixture.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "fixture-publishable";
  globalThis.fetch = async input => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.hostname, "accounting-fixture.supabase.co");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: f.userId, aud: "authenticated", email: "fixture@example.invalid" });
    assert.equal(url.pathname, "/rest/v1/rpc/resolve_user_plus_entitlement");
    return Response.json({ has_plus: true });
  };
  try {
    const signed = await f.run(() => PhotoSignRoute.options.server.handlers.POST({
      request: new Request("https://roamie.tw/api/place-photo/sign", {
        method: "POST", headers: { authorization: "Bearer fixture-token", "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify({ photo: "places/ChIJfixture/photos/fixture", width: 600 }),
      }), context: { cloudflareEnv: f.env },
    }));
    assert.equal(signed.status, 200);
    invariant(f, 0, 0);
    const parsed = resolveSignedPhotoResponse(await signed.json(), "https://roamie.tw/api/place-photo/sign", "capacitor://localhost/");
    assert(parsed && !parsed.includes(f.userId));
    assert.equal(new URL(parsed).searchParams.get("aud"), "authenticated");
    const media = await handlePlacePhotoRequest(new Request(parsed, { headers: { "cf-connecting-ip": ip } }), {
      fetch: async () => { await f.fetcher(); return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { "content-type": "image/jpeg" } }); },
      resolveServerKey: () => ({ key: serverKey, source: "GOOGLE_PLACES_SERVER_API_KEY" }), recordHttpCall: () => {}, timeoutMs: 1000,
    }, f.env);
    assert.equal(media.status, 200);
    invariant(f, 1, 1);
  } finally {
    globalThis.fetch = original;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});

await test("Free/Plus representative normal session remains admitted without AI credits or entitlement authority", async () => {
  for (const role of ["free", "plus"]) {
    const f = fixture(role, "true");
    // Five recommendation searches, ten details, 35 photos and 34 route attempts.
    for (const [family, n] of [["places_text", 5], ["places_details", 10], ["place_photos", 35], ["routes", 34]])
      for (let i = 0; i < n; i++) {
        const result = await f.run(() => runGoogleUpstreamAttempt({ family, env: f.env, kind: "initial" }, f.fetcher));
        assert("response" in result); assert.equal(result.response.status, 200);
      }
    invariant(f, 84, 261);
    const serialized = JSON.stringify(f.events);
    for (const sensitive of [serverKey, f.userId, "fixture-token", ip, "client-supplied"]) assert(!serialized.includes(sensitive));
    assert(f.events.every(e => e.blobs[8] === "authenticated"));
  }
});

await test("no principal, invalid Bearer, unsupported operation and rate rejection cannot dispatch", async () => {
  const f = fixture("free");
  const invalid = await handleGoogleProxy(f.request(), f.env, { authenticate: async () => null, provider: (input, env) => fetchGoogleRestProvider(input, env, f.fetcher) });
  assert.equal(invalid.status, 401);
  assert.equal((await fetchGoogleRestProvider(text, f.env, f.fetcher)).status, 503);
  assert.equal((await f.invoke({ url: "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", method: "POST", body: {} })).status, 400);
  f.env.GOOGLE_API_RATE_LIMITER.limit = async () => ({ success: false });
  assert.equal((await handleGoogleProxy(f.request(), f.env, { authenticate: async () => f.userId, provider: (input, env) => fetchGoogleRestProvider(input, env, f.fetcher) })).status, 429);
  invariant(f, 0, 0);
});

await test("boundary wiring: REST and Photos use attempt authority, proxy/sign never pre-charge", async () => {
  for (const path of ["src/lib/google-rest-provider.server.ts", "src/routes/api/place-photo.ts"])
    assert.match(readFileSync(path, "utf8"), /runGoogleUpstreamAttempt/);
  for (const path of ["src/lib/google-proxy.server.ts", "src/routes/api/place-photo/sign.ts"])
    assert.doesNotMatch(readFileSync(path, "utf8"), /authorizeGoogleSpec|authorizeGuestGoogleSpec|authorizePlacePhotoSign|googleOperationId/);
});
console.log(`Google upstream accounting: ${passed} cases PASS; network mocked, no live Google calls`);
