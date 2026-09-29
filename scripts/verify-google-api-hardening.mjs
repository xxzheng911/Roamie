import assert from "node:assert/strict";
import fs from "node:fs";
import {
  requireGoogleServerKey,
  resolveGoogleMapsKeyFromServerEnv,
} from "../src/lib/google-maps-key-resolve.server.ts";
import { googleRestRequest } from "../src/lib/google-rest-contract.ts";
import { fetchGoogleRestProvider } from "../src/lib/google-rest-provider.server.ts";
import { handleGoogleProxy } from "../src/lib/google-proxy.server.ts";
import {
  checkGoogleProviderRate,
  requireGoogleProviderRate,
} from "../src/lib/google-rate-limit.server.ts";
import { readGoogleRequestJson } from "../src/lib/google-request-body.server.ts";
import { createMemoryAbuseGuard } from "../src/lib/abuse-guard-memory.ts";
import { runWithGuardTestContext } from "../src/lib/worker-request-scope.ts";
const abuseGuard = createMemoryAbuseGuard();
const allowLimiter = { limit: async () => ({ success: true }) };
async function withGuardedProvider(env, input, fetcher) {
  return runWithGuardTestContext({ userId: "verified-user", ip: "203.0.113.10" }, () =>
    fetchGoogleRestProvider(
      input,
      {
        ...env,
        ABUSE_GUARD: abuseGuard.namespace,
        GOOGLE_API_RATE_LIMITER: env.GOOGLE_API_RATE_LIMITER ?? allowLimiter,
      },
      fetcher,
    ),
  );
}
const names = [
  "GOOGLE_PLACES_SERVER_API_KEY",
  "GOOGLE_ROUTES_SERVER_API_KEY",
  "GOOGLE_GEOCODING_SERVER_API_KEY",
];
const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
for (const n of names) delete process.env[n];
try {
  for (const n of [
    "GOOGLE_MAPS_API_KEY",
    "VITE_GOOGLE_MAPS_API_KEY",
    "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
  ]) {
    assert.throws(
      () => requireGoogleServerKey("places", { [n]: "AIzaFAKE-public" }),
      /unavailable/,
    );
    assert.deepEqual(resolveGoogleMapsKeyFromServerEnv({ [n]: "AIzaFAKE-public" }), {
      key: null,
      source: "none",
    });
  }
  for (const family of ["places", "routes", "geocoding"])
    assert.throws(() => requireGoogleServerKey(family, {}), /unavailable/);
  const keys = {
    GOOGLE_PLACES_SERVER_API_KEY: "AIzaFAKE-places-credential",
    GOOGLE_ROUTES_SERVER_API_KEY: "AIzaFAKE-routes-credential",
    GOOGLE_GEOCODING_SERVER_API_KEY: "AIzaFAKE-geocoding-credential",
  };
  assert.throws(
    () =>
      requireGoogleServerKey("routes", {
        GOOGLE_PLACES_SERVER_API_KEY: keys.GOOGLE_PLACES_SERVER_API_KEY,
      }),
    /unavailable/,
  );
  const requests = [
    {
      url: "https://places.googleapis.com/v1/places:searchText",
      method: "POST",
      body: { textQuery: "Tokyo", pageSize: 20 },
    },
    {
      url: "https://places.googleapis.com/v1/places:searchNearby",
      method: "POST",
      body: {
        includedTypes: ["cafe"],
        maxResultCount: 20,
        locationRestriction: { circle: { center: { latitude: 35, longitude: 139 }, radius: 1000 } },
      },
    },
    {
      url: "https://places.googleapis.com/v1/places:autocomplete",
      method: "POST",
      body: { input: "Tokyo" },
    },
    { url: "https://places.googleapis.com/v1/places/ChIJfixture?languageCode=ja", method: "GET" },
    { url: "https://maps.googleapis.com/maps/api/geocode/json?address=Tokyo", method: "GET" },
    ...["driving", "walking", "transit"].map((mode) => ({
      url: `https://maps.googleapis.com/maps/api/directions/json?origin=35,139&destination=36,140&mode=${mode}`,
      method: "GET",
    })),
    {
      url: "https://routes.googleapis.com/directions/v2:computeRoutes",
      method: "POST",
      body: {
        origin: { location: { latLng: { latitude: 35, longitude: 139 } } },
        destination: { location: { latLng: { latitude: 36, longitude: 140 } } },
        travelMode: "DRIVE",
      },
    },
  ];
  let calls = 0;
  const provider = async (url, init) => {
    calls++;
    const spec = requests.find((r) => new URL(r.url).pathname === new URL(url).pathname);
    assert.ok(spec);
    const family = googleRestRequest(spec).family;
    const key = init.headers["X-Goog-Api-Key"] ?? new URL(url).searchParams.get("key");
    assert.equal(
      key,
      keys[
        `GOOGLE_${family === "places" ? "PLACES" : family === "routes" ? "ROUTES" : "GEOCODING"}_SERVER_API_KEY`
      ],
    );
    assert.equal(init.redirect, "manual");
    return Response.json({ status: "OK", places: [], results: [], routes: [] });
  };
  for (const r of requests)
    assert.equal((await withGuardedProvider(keys, r, provider)).status, 200);
  assert.equal(calls, requests.length);
  const bad = [
    { ...requests[0], url: "https://evil.example/v1/places:searchText" },
    { ...requests[0], body: { textQuery: "x", pageSize: 100 } },
    { ...requests[0], body: { textQuery: "x", extra: "arbitrary" } },
    { ...requests[0], url: requests[0].url + "?key=AIzaFAKE" },
    {
      ...requests[1],
      body: {
        locationRestriction: {
          circle: { center: { latitude: 91, longitude: 139 }, radius: 100000 },
        },
      },
    },
    { ...requests[3], url: "https://places.googleapis.com/v1/places/../other" },
    { ...requests[4], url: "https://maps.googleapis.com/maps/api/geocode/json?latlng=999,999" },
  ];
  for (const r of bad) assert.throws(() => googleRestRequest(r));
  assert.deepEqual(
    googleRestRequest({
      ...requests[2],
      body: { input: "Tokyo", includedPrimaryTypes: ["(regions)"] },
    }).body.includedPrimaryTypes,
    ["(regions)"],
  );
  assert.throws(() => googleRestRequest({ ...requests[3], fieldMask: "*" }));
  assert.throws(() => googleRestRequest({ ...requests[3], fieldMask: "apiKey" }));
  assert.equal(
    googleRestRequest({ ...requests[3], fieldMask: "id,location,addressComponents" }).fields,
    "id,location,addressComponents",
  );
  assert.equal(
    googleRestRequest({ ...requests[3], fieldMask: "id,location" }).fields,
    "id,location",
  );
  await assert.rejects(() => checkGoogleProviderRate(undefined, "google:user:test"), /unavailable/);
  await assert.rejects(
    () =>
      checkGoogleProviderRate(
        {
          GOOGLE_API_RATE_LIMITER: {
            limit: async () => {
              throw Error("secret");
            },
          },
        },
        "test",
      ),
    /unavailable/,
  );
  assert.equal(
    await checkGoogleProviderRate(
      { GOOGLE_API_RATE_LIMITER: { limit: async () => ({ success: false }) } },
      "test",
    ),
    false,
  );
  await assert.rejects(
    () =>
      readGoogleRequestJson(
        new Request("https://app.example", { method: "POST", body: "x".repeat(8193) }),
        8192,
      ),
    RangeError,
  );
  let continued = 0;
  const next = async () => {
    continued++;
  };
  const middleware = requireGoogleProviderRate.options.server;
  await assert.rejects(() => middleware({ context: {}, next }), /Unauthorized/);
  await assert.rejects(() => middleware({ context: { userId: "verified" }, next }), /unavailable/);
  assert.equal(continued, 0);
  await middleware({
    context: {
      userId: "verified",
      cloudflareEnv: {
        GOOGLE_API_RATE_LIMITER: {
          limit: async ({ key }) => {
            assert.equal(key, "google:user:verified");
            return { success: true };
          },
        },
      },
    },
    next,
  });
  assert.equal(continued, 1);
  const before = calls;
  assert.equal((await fetchGoogleRestProvider(requests[0], {}, provider)).status, 503);
  assert.equal(calls, before);
  const secret = keys.GOOGLE_PLACES_SERVER_API_KEY;
  const messages = [];
  const originalError = console.error;
  console.error = (...a) => messages.push(a.join(" "));
  try {
    for (const fn of [
      async () => {
        throw Error(secret);
      },
      async () => Response.json({ error: { message: secret } }, { status: 403 }),
      async () => Response.json({ status: "REQUEST_DENIED", error_message: secret }),
    ]) {
      const res = await withGuardedProvider(keys, requests[0], fn);
      assert.equal(res.status, 502);
      assert.ok(!(await res.text()).includes(secret));
    }
    const res = await withGuardedProvider(keys, requests[0], async () =>
      Response.json({ name: secret }),
    );
    assert.ok(!(await res.text()).includes(secret));
    assert.ok(!messages.join().includes(secret));
  } finally {
    console.error = originalError;
  }
  const request = (body = requests[0], extra = {}, auth = true) =>
    new Request("https://app.example/api/google", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.10",
        ...(auth ? { authorization: "Bearer fixture-token" } : {}),
        ...extra,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const limitKeys = [];
  const env = {
    ...keys,
    ABUSE_GUARD: abuseGuard.namespace,
    GOOGLE_API_RATE_LIMITER: {
      limit: async ({ key }) => {
        limitKeys.push(key);
        return { success: true };
      },
    },
  };
  let upstream = 0;
  const deps = {
    authenticate: async () => "verified-user",
    provider: async () => {
      upstream++;
      return Response.json({ places: [] });
    },
  };
  assert.equal((await handleGoogleProxy(request(undefined, {}, false), env, deps)).status, 401);
  assert.equal((await handleGoogleProxy(request(), {}, deps)).status, 503);
  assert.equal(
    (await handleGoogleProxy(request(), env, { ...deps, authenticate: async () => null })).status,
    401,
  );
  assert.equal(
    (
      await handleGoogleProxy(
        request(),
        { ...env, GOOGLE_API_RATE_LIMITER: { limit: async () => ({ success: false }) } },
        deps,
      )
    ).status,
    429,
  );
  assert.equal(
    (await handleGoogleProxy(request(undefined, { origin: "https://evil.example" }), env, deps))
      .status,
    403,
  );
  assert.equal((await handleGoogleProxy(request("x".repeat(17000)), env, deps)).status, 413);
  assert.equal((await handleGoogleProxy(request(bad[0]), env, deps)).status, 400);
  assert.equal(upstream, 0);
  assert.equal(
    (await handleGoogleProxy(request(undefined, { origin: "capacitor://localhost" }), env, deps))
      .status,
    200,
  );
  assert.ok(limitKeys.includes("google:user:verified-user"));
  assert.equal(upstream, 1);
  const source = fs
    .readFileSync("src/lib/google-maps-key-resolve.server.ts", "utf8")
    .replace(/\/\*\*[\s\S]*?\*\//g, "");
  assert.ok(!source.includes("import.meta.env"));
  assert.ok(!source.includes("VITE_"));
  assert.ok(!source.includes("EXPO_PUBLIC_"));
  console.log(
    "PASS credential isolation, fail closed, API family separation, 9 operation fixtures, bounded inputs, SSRF, auth/CORS/rate limit, no secret errors/logs",
  );
} finally {
  for (const n of names) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
}
