/**
 * Guest Google durable budget.
 * Enforcement may be unset. Anonymous billable Google calls still admit once
 * through the AbuseGuard Durable Object, and authenticated calls do not.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMemoryAbuseGuard } from "../src/lib/abuse-guard-memory.ts";
import { authorizeGuestGoogleBilling } from "../src/lib/abuse-guard.server.ts";
import { utcDay } from "../src/lib/abuse-guard-clock.ts";
import {
  GOOGLE_FAMILY_LIMITS,
  GOOGLE_GLOBAL_DAILY_UNITS_DEFAULT,
  GOOGLE_IP_DAILY_WEIGHT,
  countsTowardGlobalBudget,
} from "../src/lib/abuse-guard-policy.ts";
import { requireAuthenticatedAiRequest } from "../src/lib/ai/endpoint-guard.server.ts";
import { fetchGoogleRestProvider } from "../src/lib/google-rest-provider.server.ts";
import { handleGoogleProxy } from "../src/lib/google-proxy.server.ts";
import { handlePlacePhotoRequest } from "../src/routes/api/place-photo.ts";
import { signPlacePhoto } from "../src/lib/place-photo-signature.server.ts";
import { markPublicReadAuthorized, runWithWorkerRequest } from "../src/lib/worker-request-scope.ts";

delete process.env.ABUSE_GUARD_ENFORCEMENT;
delete process.env.DISABLE_GOOGLE_PROXY;

assert.equal(GOOGLE_IP_DAILY_WEIGHT, 12_000);
assert.equal(GOOGLE_GLOBAL_DAILY_UNITS_DEFAULT, 100_000);

const day = utcDay();
const ip = "203.0.113.80";
const placesKey = "AIza" + "x".repeat(35);
const text = {
  url: "https://places.googleapis.com/v1/places:searchText",
  method: "POST",
  body: { textQuery: "Tokyo", pageSize: 1 },
};
const families = {
  places_text: text,
  places_nearby: {
    url: "https://places.googleapis.com/v1/places:searchNearby",
    method: "POST",
    body: {
      locationRestriction: {
        circle: { center: { latitude: 35.6, longitude: 139.7 }, radius: 500 },
      },
      maxResultCount: 1,
    },
  },
  places_autocomplete: {
    url: "https://places.googleapis.com/v1/places:autocomplete",
    method: "POST",
    body: { input: "Tokyo" },
  },
  places_details: {
    url: "https://places.googleapis.com/v1/places/ChIJtestplace",
    method: "GET",
  },
  routes: {
    url: "https://routes.googleapis.com/directions/v2:computeRoutes",
    method: "POST",
    body: {
      origin: { location: { latLng: { latitude: 35, longitude: 139 } } },
      destination: { location: { latLng: { latitude: 35.1, longitude: 139.1 } } },
      travelMode: "WALK",
    },
  },
  geocoding: {
    url: "https://maps.googleapis.com/maps/api/geocode/json?address=Tokyo",
    method: "GET",
  },
  directions: {
    url: "https://maps.googleapis.com/maps/api/directions/json?origin=Tokyo&destination=Osaka",
    method: "GET",
  },
};

function keys() {
  return {
    GOOGLE_PLACES_SERVER_API_KEY: placesKey,
    GOOGLE_ROUTES_SERVER_API_KEY: placesKey,
    GOOGLE_GEOCODING_SERVER_API_KEY: placesKey,
  };
}
function limiter(log = []) {
  return {
    log,
    limit: async ({ key }) => {
      log.push(key);
      return { success: true };
    },
  };
}
function envOf(guard, extra = {}) {
  return { ABUSE_GUARD: guard.namespace, ...keys(), ...extra };
}
function weight(guard, address) {
  return guard.counter(`ip:${address}`, `ip:weight:${day}`);
}
function globalWeight(guard) {
  return guard.counter("global:google", `global:weight:${day}`);
}
async function seed(guard, name, buckets, operationId) {
  const response = await guard.namespace.get(name).fetch(
    new Request("https://abuse-guard.internal/", {
      method: "POST",
      body: JSON.stringify({ action: "charge", operationId, buckets }),
    }),
  );
  assert.equal((await response.json()).ok, true);
}
function guestRequest(body, headers = {}) {
  return new Request("https://roamie.tw/api/google", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
async function guestRead(guard, input, address = ip) {
  let upstream = 0;
  const request = new Request("https://roamie.tw/api/google", {
    headers: { "cf-connecting-ip": address },
  });
  const response = await runWithWorkerRequest({ env: envOf(guard), request }, () => {
    markPublicReadAuthorized(address);
    return fetchGoogleRestProvider(input, envOf(guard), async () => {
      upstream += 1;
      return Response.json({ places: [] });
    });
  });
  return { response, upstream };
}

const photo = "places/ChIJ_photo/photos/ref";
const signingSecret = "photo-signing-secret-at-least-32";
function photoDeps(upstream) {
  return {
    fetch: async () => {
      upstream.count += 1;
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    },
    resolveServerKey: () => ({ key: placesKey, source: "GOOGLE_PLACES_SERVER_API_KEY" }),
    recordHttpCall: () => {},
    timeoutMs: 1000,
  };
}

{
  const guard = createMemoryAbuseGuard();
  const seen = [];
  let upstream = 0;
  const response = await handleGoogleProxy(
    guestRequest(text),
    envOf(guard, { GOOGLE_API_RATE_LIMITER: limiter(seen) }),
    {
      authenticate: async () => {
        throw new Error("guest must not authenticate");
      },
      provider: (input, env) =>
        fetchGoogleRestProvider(input, env, async () => {
          upstream += 1;
          return Response.json({ places: [] });
        }),
    },
  );
  assert.equal(response.status, 200, "case 1");
  assert.equal(upstream, 1);
  assert.deepEqual(seen, [`google:ip:${ip}`, `google:guest:${ip}`]);
  assert.equal(weight(guard, ip), GOOGLE_FAMILY_LIMITS.places_text.weight);
  assert.equal(globalWeight(guard), GOOGLE_FAMILY_LIMITS.places_text.weight);
}

{
  const guard = createMemoryAbuseGuard();
  const read = await guestRead(guard, text);
  assert.equal(read.response.status, 200, "case 2");
  assert.equal(read.upstream, 1);
  assert.equal(weight(guard, ip), GOOGLE_FAMILY_LIMITS.places_text.weight);
  assert.equal(globalWeight(guard), GOOGLE_FAMILY_LIMITS.places_text.weight);
  for (const [family, input] of Object.entries(families)) {
    const isolated = createMemoryAbuseGuard();
    const result = await guestRead(isolated, input, "203.0.113.81");
    assert.equal(result.response.status, 200, family);
    assert.equal(result.upstream, 1, family);
    assert.equal(weight(isolated, "203.0.113.81"), GOOGLE_FAMILY_LIMITS[family].weight, family);
    assert.equal(
      globalWeight(isolated),
      countsTowardGlobalBudget(family) ? GOOGLE_FAMILY_LIMITS[family].weight : 0,
      family,
    );
  }
}

{
  const guard = createMemoryAbuseGuard();
  const signing = { ...envOf(guard), PLACE_PHOTO_SIGNING_SECRET: signingSecret, GOOGLE_API_RATE_LIMITER: limiter() };
  const before = weight(guard, ip);
  const token = await signPlacePhoto(signing, photo, 480, undefined, "guest");
  assert.equal(weight(guard, ip), before, "sign is not a Google upstream");
  const upstream = { count: 0 };
  const load = (query) =>
    handlePlacePhotoRequest(
      new Request(
        `https://roamie.tw/api/place-photo?photo=${encodeURIComponent(photo)}&w=480&expires=${token.expires}&signature=${encodeURIComponent(token.signature)}${query}`,
        { headers: { "cf-connecting-ip": ip } },
      ),
      photoDeps(upstream),
      signing,
    );
  assert.equal((await load("&aud=guest")).status, 200, "case 3");
  assert.equal(upstream.count, 1);
  assert.equal(weight(guard, ip), GOOGLE_FAMILY_LIMITS.place_photos.weight);
  assert.equal(globalWeight(guard), 0);
  const stripped = await load("");
  assert.equal(stripped.status, 401);
  assert.equal(upstream.count, 1);
  const userToken = await signPlacePhoto(signing, photo, 480);
  const forged = await handlePlacePhotoRequest(
    new Request(
      `https://roamie.tw/api/place-photo?photo=${encodeURIComponent(photo)}&w=480&expires=${userToken.expires}&signature=${encodeURIComponent(userToken.signature)}&aud=guest`,
      { headers: { "cf-connecting-ip": ip } },
    ),
    photoDeps(upstream),
    signing,
  );
  assert.equal(forged.status, 401);
  assert.equal(upstream.count, 1);
}

{
  const guard = createMemoryAbuseGuard();
  await seed(
    guard,
    `ip:${ip}`,
    [{ key: `ip:weight:${day}`, limit: GOOGLE_IP_DAILY_WEIGHT, delta: GOOGLE_IP_DAILY_WEIGHT, reason: "ip_weight", retryAt: Date.now() + 86_400_000 }],
    "seed-ip",
  );
  let upstream = 0;
  const response = await handleGoogleProxy(guestRequest(text), envOf(guard, { GOOGLE_API_RATE_LIMITER: limiter() }), {
    authenticate: async () => null,
    provider: (input, env) =>
      fetchGoogleRestProvider(input, env, async () => {
        upstream += 1;
        return Response.json({ places: [] });
      }),
  });
  assert.equal(response.status, 429, "case 4");
  assert.equal(upstream, 0);
  assert.equal(weight(guard, ip), GOOGLE_IP_DAILY_WEIGHT);
}

{
  const guard = createMemoryAbuseGuard();
  await seed(
    guard,
    "global:google",
    [{ key: `global:weight:${day}`, limit: GOOGLE_GLOBAL_DAILY_UNITS_DEFAULT, delta: GOOGLE_GLOBAL_DAILY_UNITS_DEFAULT, reason: "global_weight", retryAt: Date.now() + 86_400_000 }],
    "seed-global",
  );
  let upstream = 0;
  const response = await handleGoogleProxy(guestRequest(text), envOf(guard, { GOOGLE_API_RATE_LIMITER: limiter() }), {
    authenticate: async () => null,
    provider: (input, env) =>
      fetchGoogleRestProvider(input, env, async () => {
        upstream += 1;
        return Response.json({ places: [] });
      }),
  });
  assert.equal(response.status, 429, "case 5");
  assert.equal(upstream, 0);
  assert.equal(weight(guard, ip), 0);
}

{
  let upstream = 0;
  const down = {
    idFromName: (name) => name,
    get: () => ({
      fetch: async () => {
        throw new Error("durable object down");
      },
    }),
  };
  const response = await handleGoogleProxy(
    guestRequest(text),
    { ...keys(), ABUSE_GUARD: down, GOOGLE_API_RATE_LIMITER: limiter() },
    {
      authenticate: async () => null,
      provider: async () => {
        upstream += 1;
        return Response.json({ places: [] });
      },
    },
  );
  assert.equal(response.status, 503, "case 6");
  assert.equal(upstream, 0);
  assert.deepEqual(await response.json(), { error: "google_unavailable" });
}

{
  const guard = createMemoryAbuseGuard();
  let upstream = 0;
  const response = await handleGoogleProxy(guestRequest(text), envOf(guard, { GOOGLE_API_RATE_LIMITER: limiter() }), {
    authenticate: async () => null,
    provider: (input, env) =>
      fetchGoogleRestProvider(input, env, async () => {
        upstream += 1;
        return Response.json({ places: [] });
      }),
  });
  assert.equal(response.status, 200, "case 7");
  assert.equal(upstream, 1);
  assert.equal(weight(guard, ip), GOOGLE_FAMILY_LIMITS.places_text.weight);
  assert.equal(globalWeight(guard), GOOGLE_FAMILY_LIMITS.places_text.weight);
  const again = await runWithWorkerRequest(
    { env: envOf(guard), request: new Request("https://roamie.tw/", { headers: { "cf-connecting-ip": ip } }) },
    () =>
      authorizeGuestGoogleBilling({
        env: envOf(guard),
        family: "places_text",
        operationId: "same-upstream",
        request: new Request("https://roamie.tw/", { headers: { "cf-connecting-ip": ip } }),
      }),
  );
  assert.equal(again, null);
  const replay = await runWithWorkerRequest(
    { env: envOf(guard), request: new Request("https://roamie.tw/", { headers: { "cf-connecting-ip": ip } }) },
    () =>
      authorizeGuestGoogleBilling({
        env: envOf(guard),
        family: "places_text",
        operationId: "same-upstream",
        request: new Request("https://roamie.tw/", { headers: { "cf-connecting-ip": ip } }),
      }),
  );
  assert.equal(replay, null);
  assert.equal(weight(guard, ip), GOOGLE_FAMILY_LIMITS.places_text.weight * 2);
}

{
  const guard = createMemoryAbuseGuard();
  let upstream = 0;
  const authed = await handleGoogleProxy(
    guestRequest(text, { authorization: "Bearer fixture" }),
    envOf(guard, { GOOGLE_API_RATE_LIMITER: limiter(), DISABLE_GOOGLE_PROXY: "1" }),
    {
      authenticate: async () => "logged-in-user",
      provider: async () => {
        upstream += 1;
        return Response.json({ places: [] });
      },
    },
  );
  assert.equal(authed.status, 200, "case 8");
  assert.equal(upstream, 1);
  assert.equal(weight(guard, ip), 0);
  assert.equal(globalWeight(guard), 0);
  const killed = await handleGoogleProxy(guestRequest(text), envOf(guard, { GOOGLE_API_RATE_LIMITER: limiter(), DISABLE_GOOGLE_PROXY: "1" }), {
    authenticate: async () => null,
    provider: async () => {
      upstream += 1;
      return Response.json({ places: [] });
    },
  });
  assert.equal(killed.status, 503);
  assert.equal(upstream, 1);
}

{
  assert.equal(process.env.ABUSE_GUARD_ENFORCEMENT, undefined, "case 9");
  const guard = createMemoryAbuseGuard();
  const read = await guestRead(guard, families.places_nearby, "203.0.113.90");
  assert.equal(read.response.status, 200);
  assert.equal(read.upstream, 1);
  assert.equal(weight(guard, "203.0.113.90"), GOOGLE_FAMILY_LIMITS.places_nearby.weight);
}

{
  const guard = createMemoryAbuseGuard();
  let upstream = 0;
  const response = await handleGoogleProxy(
    guestRequest(text, { authorization: "Bearer expired-token" }),
    envOf(guard, { GOOGLE_API_RATE_LIMITER: limiter() }),
    {
      authenticate: async () => null,
      provider: async () => {
        upstream += 1;
        return Response.json({ places: [] });
      },
    },
  );
  assert.equal(response.status, 401, "case 10");
  assert.equal(upstream, 0);
  assert.equal(weight(guard, ip), 0);
  assert.equal(globalWeight(guard), 0);
}

{
  const guard = createMemoryAbuseGuard();
  let upstream = 0;
  const response = await handleGoogleProxy(
    guestRequest({ url: "https://evil.example/v1/places:searchText", method: "POST", body: { textQuery: "Tokyo" } }),
    envOf(guard, { GOOGLE_API_RATE_LIMITER: limiter() }),
    {
      authenticate: async () => null,
      provider: async () => {
        upstream += 1;
        return Response.json({ places: [] });
      },
    },
  );
  assert.equal(response.status, 400, "case 11");
  assert.equal(upstream, 0);
  assert.equal(weight(guard, ip), 0);
}

{
  const anonymous = await requireAuthenticatedAiRequest(
    new Request("https://roamie.tw/api/roamie", { method: "POST", body: "{}" }),
  );
  assert.equal(anonymous, null, "case 12");
  const roamie = readFileSync("src/routes/api/roamie.ts", "utf8");
  const chat = readFileSync("src/routes/api/chat.ts", "utf8");
  const itinerary = readFileSync("src/routes/api/generate-itinerary.ts", "utf8");
  for (const source of [roamie, chat, itinerary]) {
    assert.match(source, /requireAuthenticatedAiRequest/);
    assert.doesNotMatch(source, /allowGuestPublicRead|authorizeGuestGoogleBilling/);
  }
  assert.match(roamie, /if \(!auth\)/);
}

console.log("PASS guest google budget: durable admission, one charge, authenticated path unchanged");
