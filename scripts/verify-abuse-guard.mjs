import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyGuardCommand } from "../src/lib/abuse-guard-logic.ts";
import { createMemoryAbuseGuard } from "../src/lib/abuse-guard-memory.ts";
import {
  authorizeAiUse,
  authorizeGoogleBilling,
  googleOperationId,
} from "../src/lib/abuse-guard.server.ts";
import { setAbuseGuardClockForTests, utcDay, windowStart } from "../src/lib/abuse-guard-clock.ts";
import { beginAiRequest } from "../src/lib/ai/endpoint-guard.server.ts";
import { fetchGoogleRestProvider } from "../src/lib/google-rest-provider.server.ts";
import { handleGoogleProxy } from "../src/lib/google-proxy.server.ts";
import { isKillSwitchOn, unsplashProxyDisabledResponse } from "../src/lib/kill-switch.server.ts";
import { handlePlacePhotoRequest } from "../src/routes/api/place-photo.ts";
import { signPlacePhoto } from "../src/lib/place-photo-signature.server.ts";
import {
  resolveTrustedIp,
  resolveTrustedUserId,
  runWithGuardTestContext,
  runWithWorkerRequest,
  setGuardProductionForTests,
} from "../src/lib/worker-request-scope.ts";

const text = {
  url: "https://places.googleapis.com/v1/places:searchText",
  method: "POST",
  body: { textQuery: "Tokyo", pageSize: 1 },
};
const autocomplete = {
  url: "https://places.googleapis.com/v1/places:autocomplete",
  method: "POST",
  body: { input: "Tokyo" },
};
const day = () => utcDay();
const allowLimiter = { limit: async () => ({ success: true }) };
const placesKey = "AIza" + "x".repeat(35);

function fresh() {
  return createMemoryAbuseGuard();
}
function envOf(guard, extra = {}) {
  return { ABUSE_GUARD: guard.namespace, GOOGLE_API_RATE_LIMITER: allowLimiter, ...extra };
}
function asUser(guard, userId, ip, fn, extra = {}) {
  return runWithWorkerRequest(
    {
      env: envOf(guard, extra),
      request: new Request("https://roamie.tw/", { headers: { "cf-connecting-ip": ip } }),
      allowLocalIp: false,
    },
    () => runWithGuardTestContext({ userId, ip }, fn),
  );
}
async function seed(guard, name, buckets, operationId = `seed-${name}-${buckets[0].key}`) {
  const response = await guard.namespace.get(name).fetch(
    new Request("https://abuse-guard.internal/", {
      method: "POST",
      body: JSON.stringify({ action: "charge", operationId, buckets }),
    }),
  );
  assert.equal((await response.json()).ok, true, operationId);
}
function retryAt() {
  return Date.now() + 86_400_000;
}
function authClient(calls) {
  return {
    rpc: async (name) => {
      calls.push(name);
      return { data: { ok: true, ledger_id: "ledger-1" }, error: null };
    },
  };
}

const logs = [];
const originalInfo = console.info;
console.info = (...parts) => {
  logs.push(parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
};

try {
  setAbuseGuardClockForTests(() => Date.parse("2026-09-29T12:00:00.000Z"));
  const nowDay = day();

  {
    const guard = fresh();
    await seed(guard, "user:photos-user", [
      { key: `user:family:place_photos:${nowDay}`, limit: 800, delta: 800, reason: "family", retryAt: retryAt() },
    ]);
    const photo = await asUser(guard, "photos-user", "203.0.113.10", () =>
      authorizeGoogleBilling({
        family: "place_photos",
        operationId: "photo-1",
        chargeUser: true,
        chargeIp: false,
        userId: "photos-user",
      }),
    );
    assert.equal(photo.status, 429);
    const textAllowed = await asUser(guard, "photos-user", "203.0.113.10", () =>
      authorizeGoogleBilling({
        family: "places_text",
        operationId: "text-after-photos",
        chargeUser: true,
        chargeIp: true,
        userId: "photos-user",
        ip: "203.0.113.10",
      }),
    );
    assert.equal(textAllowed, null);
    assert.equal(guard.counter("user:photos-user", `user:family:places_text:${nowDay}`), 1);
    assert.equal(guard.counter("user:photos-user", `user:family:place_photos:${nowDay}`), 800);
  }

  {
    const guard = fresh();
    await seed(guard, "user:weight-user", [
      { key: `user:weight:${nowDay}`, limit: 4000, delta: 3996, reason: "user_weight", retryAt: retryAt() },
    ]);
    const denied = await asUser(guard, "weight-user", "203.0.113.11", () =>
      authorizeGoogleBilling({
        family: "places_text",
        operationId: "weight-text",
        chargeUser: true,
        chargeIp: true,
        userId: "weight-user",
        ip: "203.0.113.11",
      }),
    );
    assert.equal(denied.status, 429);
    assert.equal(guard.counter("user:weight-user", `user:family:places_text:${nowDay}`), 0);
    const autocompleteAllowed = await asUser(guard, "weight-user", "203.0.113.11", () =>
      authorizeGoogleBilling({
        family: "places_autocomplete",
        operationId: "weight-auto",
        chargeUser: true,
        chargeIp: true,
        userId: "weight-user",
        ip: "203.0.113.11",
      }),
    );
    assert.equal(autocompleteAllowed, null);
  }

  {
    const guard = fresh();
    await seed(guard, "ip:203.0.113.12", [
      { key: `ip:weight:${nowDay}`, limit: 12000, delta: 11996, reason: "ip_weight", retryAt: retryAt() },
    ]);
    const denied = await asUser(guard, "ip-user", "203.0.113.12", () =>
      authorizeGoogleBilling({
        family: "places_text",
        operationId: "ip-text",
        chargeUser: true,
        chargeIp: true,
        userId: "ip-user",
        ip: "203.0.113.12",
      }),
    );
    assert.equal(denied.status, 429);
    assert.equal(guard.counter("user:ip-user", `user:family:places_text:${nowDay}`), 0);
  }

  {
    const guard = fresh();
    const before = logs.length;
    const first = await asUser(guard, "global-user", "203.0.113.13", () =>
      authorizeGoogleBilling({
        family: "places_text",
        operationId: "global-1",
        chargeUser: true,
        chargeIp: true,
        userId: "global-user",
        ip: "203.0.113.13",
      }),
      { GOOGLE_GLOBAL_DAILY_UNITS: "8" },
    );
    assert.equal(first, null);
    const second = await asUser(guard, "global-user", "203.0.113.13", () =>
      authorizeGoogleBilling({
        family: "places_text",
        operationId: "global-2",
        chargeUser: true,
        chargeIp: true,
        userId: "global-user",
        ip: "203.0.113.13",
      }),
      { GOOGLE_GLOBAL_DAILY_UNITS: "8" },
    );
    assert.equal(second.status, 429);
    const body = await second.json();
    assert.deepEqual(body, { error: "rate_limited" });
    assert.equal(second.headers.get("Retry-After") > "0", true);
    assert.equal(JSON.stringify(body).includes("100000"), false);
    assert.equal(JSON.stringify(body).includes("global"), false);
    assert.equal(guard.counter("global:google", `global:weight:${nowDay}`), 8);
    const auto = await asUser(guard, "global-user", "203.0.113.13", () =>
      authorizeGoogleBilling({
        family: "places_autocomplete",
        operationId: "global-auto",
        chargeUser: true,
        chargeIp: true,
        userId: "global-user",
        ip: "203.0.113.13",
      }),
      { GOOGLE_GLOBAL_DAILY_UNITS: "8" },
    );
    assert.equal(auto, null);
    assert.equal(guard.counter("global:google", `global:weight:${nowDay}`), 8);
    const photo = await asUser(guard, "global-user", "203.0.113.13", () =>
      authorizeGoogleBilling({
        family: "place_photos",
        operationId: "global-photo",
        chargeUser: true,
        chargeIp: false,
        userId: "global-user",
      }),
      { GOOGLE_GLOBAL_DAILY_UNITS: "8" },
    );
    assert.equal(photo, null);
    assert.equal(guard.counter("global:google", `global:weight:${nowDay}`), 8);
    assert.equal(logs.slice(before).some((line) => line.includes("global_emergency")), true);
    assert.equal(logs.slice(before).some((line) => line.includes("203.0.113.13")), false);
  }

  {
    const guard = fresh();
    await seed(guard, "user:utc-user", [
      { key: `user:family:geocoding:${nowDay}`, limit: 80, delta: 80, reason: "family", retryAt: retryAt() },
    ]);
    const denied = await asUser(guard, "utc-user", "203.0.113.14", () =>
      authorizeGoogleBilling({
        family: "geocoding",
        operationId: "utc-full",
        chargeUser: true,
        chargeIp: true,
        userId: "utc-user",
        ip: "203.0.113.14",
      }),
    );
    assert.equal(denied.status, 429);
    setAbuseGuardClockForTests(() => Date.parse("2026-09-30T00:00:01.000Z"));
    const reset = await asUser(guard, "utc-user", "203.0.113.14", () =>
      authorizeGoogleBilling({
        family: "geocoding",
        operationId: "utc-next",
        chargeUser: true,
        chargeIp: true,
        userId: "utc-user",
        ip: "203.0.113.14",
      }),
    );
    assert.equal(reset, null);
    assert.equal(guard.counter("user:utc-user", `user:family:geocoding:${utcDay()}`), 1);
    setAbuseGuardClockForTests(() => Date.parse("2026-09-29T12:00:00.000Z"));
  }

  {
    const guard = fresh();
    const stub = guard.namespace.get("user:race");
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        stub
          .fetch(
            new Request("https://abuse-guard.internal/", {
              method: "POST",
              body: JSON.stringify({
                action: "charge",
                operationId: `race-${index}`,
                buckets: [{ key: "race", limit: 10, delta: 1, reason: "family", retryAt: retryAt() }],
              }),
            }),
          )
          .then((response) => response.json()),
      ),
    );
    assert.equal(results.filter((result) => result.ok).length, 10);
    assert.equal(guard.counter("user:race", "race"), 10);
  }

  {
    const guard = fresh();
    const once = (operationId) =>
      asUser(guard, "idem-user", "203.0.113.15", () =>
        authorizeGoogleBilling({
          family: "directions",
          operationId,
          chargeUser: true,
          chargeIp: true,
          userId: "idem-user",
          ip: "203.0.113.15",
        }),
      );
    assert.equal(await once("same-direction"), null);
    assert.equal(await once("same-direction"), null);
    assert.equal(guard.counter("user:idem-user", `user:family:directions:${nowDay}`), 1);
    assert.equal(guard.counter("ip:203.0.113.15", `ip:weight:${nowDay}`), 4);
  }

  {
    let fetches = 0;
    const fetcher = async () => {
      fetches += 1;
      return Response.json({ places: [] });
    };
    const missing = await fetchGoogleRestProvider(text, { GOOGLE_PLACES_SERVER_API_KEY: placesKey, GOOGLE_API_RATE_LIMITER: allowLimiter }, fetcher);
    assert.equal(missing.status, 503);
    assert.deepEqual(await missing.json(), { error: "google_unavailable" });
    assert.equal(fetches, 0);
    const exploding = {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => { throw new Error("durable object down"); } }),
    };
    const broken = await runWithGuardTestContext({ userId: "explode", ip: "203.0.113.16" }, () =>
      fetchGoogleRestProvider(text, {
        GOOGLE_PLACES_SERVER_API_KEY: placesKey,
        GOOGLE_API_RATE_LIMITER: allowLimiter,
        ABUSE_GUARD: exploding,
      }, fetcher),
    );
    assert.equal(broken.status, 503);
    assert.equal(fetches, 0);
    setGuardProductionForTests(true);
    try {
      assert.throws(() => runWithGuardTestContext({ userId: "x", ip: "203.0.113.1" }, () => null), /test_context_forbidden/);
      const closed = await runWithWorkerRequest(
        {
          env: { GOOGLE_PLACES_SERVER_API_KEY: placesKey, GOOGLE_API_RATE_LIMITER: allowLimiter, ABUSE_GUARD: fresh().namespace },
          request: new Request("https://roamie.tw/api/google", {
            headers: { "x-user-id": "spoof", "x-forwarded-for": "198.51.100.9", "x-roamie-guard-test": "1" },
          }),
          allowLocalIp: true,
        },
        () => {
          assert.equal(resolveTrustedUserId(), null);
          assert.equal(resolveTrustedIp(), null);
          return fetchGoogleRestProvider(text, undefined, fetcher);
        },
      );
      assert.equal(closed.status, 503);
      assert.equal(fetches, 0);
    } finally {
      setGuardProductionForTests(null);
    }
    const guard = fresh();
    const opened = await asUser(guard, "local-user", "203.0.113.17", () =>
      fetchGoogleRestProvider(text, envOf(guard, { GOOGLE_PLACES_SERVER_API_KEY: placesKey }), fetcher),
    );
    assert.equal(opened.status, 200);
    assert.equal(fetches, 1);
  }

  {
    const guard = fresh();
    let upstream = 0;
    const response = await asUser(guard, "ssr-user", "203.0.113.18", () =>
      fetchGoogleRestProvider(text, envOf(guard, { GOOGLE_PLACES_SERVER_API_KEY: placesKey }), async () => {
        upstream += 1;
        return Response.json({ places: [] });
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(upstream, 1);
    assert.equal(guard.counter("user:ssr-user", `user:family:places_text:${nowDay}`), 1);
    const proxy = await handleGoogleProxy(
      new Request("https://roamie.tw/api/google", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer fixture",
          "cf-connecting-ip": "203.0.113.19",
        },
        body: JSON.stringify(text),
      }),
      envOf(guard, { GOOGLE_PLACES_SERVER_API_KEY: placesKey }),
      {
        authenticate: async () => "proxy-user",
        provider: async (input, env) => fetchGoogleRestProvider(input, env, async () => {
          upstream += 1;
          return Response.json({ places: [] });
        }),
      },
    );
    assert.equal(proxy.status, 200);
    assert.equal(guard.counter("user:proxy-user", `user:family:places_text:${nowDay}`), 1);
  }

  {
    const guard = fresh();
    await seed(guard, "ip:203.0.113.21", [
      { key: `ip:weight:${nowDay}`, limit: 12000, delta: 12000, reason: "ip_weight", retryAt: retryAt() },
    ]);
    const signing = { ...envOf(guard), PLACE_PHOTO_SIGNING_SECRET: "photo-signing-secret-at-least-32" };
    const photo = "places/ChIJ_photo/photos/ref";
    const token = await signPlacePhoto(signing, photo, 480);
    let upstream = 0;
    const response = await handlePlacePhotoRequest(
      new Request(
        `https://roamie.tw/api/place-photo?photo=${encodeURIComponent(photo)}&w=480&expires=${token.expires}&signature=${encodeURIComponent(token.signature)}`,
        { headers: { "cf-connecting-ip": "203.0.113.21" } },
      ),
      {
        fetch: async () => {
          upstream += 1;
          return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
        },
        resolveServerKey: () => ({ key: placesKey, source: "GOOGLE_PLACES_SERVER_API_KEY" }),
        recordHttpCall: () => {},
        timeoutMs: 1000,
      },
      signing,
    );
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: "rate_limited" });
    assert.equal(upstream, 0);
  }

  {
    const guard = fresh();
    const plusCalls = [];
    const plus = await asUser(guard, "plus-user", "203.0.113.22", () =>
      beginAiRequest(
        { userId: "plus-user", email: null, hasPlusAccess: true, client: authClient(plusCalls) },
        "ITINERARY_GENERATION",
        "itinerary",
        new Request("https://roamie.tw/api/generate-itinerary", { headers: { "x-roamie-request-id": "plus-1" } }),
      ),
    );
    assert.equal(plus.response, null);
    assert.equal(plus.reservation.skipped, true);
    assert.equal(plusCalls.includes("credits_reserve"), false);

    const freeCalls = [];
    const free = await asUser(guard, "free-user", "203.0.113.23", () =>
      beginAiRequest(
        { userId: "free-user", email: null, hasPlusAccess: false, client: authClient(freeCalls) },
        "ITINERARY_GENERATION",
        "itinerary",
        new Request("https://roamie.tw/api/generate-itinerary", { headers: { "x-roamie-request-id": "free-1" } }),
      ),
    );
    assert.equal(free.response, null);
    assert.equal(freeCalls.includes("credits_reserve"), true);

    const second = await asUser(guard, "free-user", "203.0.113.23", () =>
      authorizeAiUse("itinerary", new Request("https://roamie.tw/", { headers: { "x-roamie-request-id": "free-2" } })),
    );
    assert.equal(second, null);
    const third = await asUser(guard, "free-user", "203.0.113.23", () =>
      authorizeAiUse("itinerary", new Request("https://roamie.tw/", { headers: { "x-roamie-request-id": "free-3" } })),
    );
    assert.equal(third.status, 429);
    await seed(guard, "user:free-user", [
      { key: `ai:itinerary:day:${nowDay}`, limit: 15, delta: 13, reason: "ai_window", retryAt: retryAt() },
    ]);
    setAbuseGuardClockForTests(() => Date.parse("2026-09-29T13:00:00.000Z"));
    const deniedCalls = [];
    const denied = await asUser(guard, "free-user", "203.0.113.23", () =>
      beginAiRequest(
        { userId: "free-user", email: null, hasPlusAccess: false, client: authClient(deniedCalls) },
        "ITINERARY_GENERATION",
        "itinerary",
        new Request("https://roamie.tw/api/generate-itinerary", { headers: { "x-roamie-request-id": "free-16" } }),
      ),
    );
    assert.equal(denied.response.status, 429);
    assert.deepEqual(await denied.response.json(), { error: "rate_limited" });
    assert.equal(deniedCalls.includes("credits_reserve"), false);
  }

  {
    setAbuseGuardClockForTests(() => Date.parse("2026-09-29T12:00:00.000Z"));
    const guard = fresh();
    for (const [surface, limit, header] of [
      ["chat", 8, "chat"],
      ["recommendations", 6, "rec"],
    ]) {
      for (let index = 0; index < limit; index += 1) {
        const allowed = await asUser(guard, "window-user", "203.0.113.24", () =>
          authorizeAiUse(surface, new Request("https://roamie.tw/", { headers: { "x-roamie-request-id": `${header}-${index}` } })),
        );
        assert.equal(allowed, null, surface);
      }
      const blocked = await asUser(guard, "window-user", "203.0.113.24", () =>
        authorizeAiUse(surface, new Request("https://roamie.tw/", { headers: { "x-roamie-request-id": `${header}-over` } })),
      );
      assert.equal(blocked.status, 429);
    }
    const hour = windowStart(Date.parse("2026-09-29T12:00:00.000Z"), 3_600_000);
    await seed(guard, "user:hour-user", [
      { key: `ai:chat:hour:${hour}`, limit: 60, delta: 60, reason: "ai_window", retryAt: hour + 3_600_000 },
    ]);
    const hourly = await asUser(guard, "hour-user", "203.0.113.25", () =>
      authorizeAiUse("chat", new Request("https://roamie.tw/", { headers: { "x-roamie-request-id": "hour-1" } })),
    );
    assert.equal(hourly.status, 429);
    await seed(guard, "user:day-user", [
      { key: `ai:chat:day:${nowDay}`, limit: 400, delta: 400, reason: "ai_window", retryAt: retryAt() },
    ]);
    const daily = await asUser(guard, "day-user", "203.0.113.26", () =>
      authorizeAiUse("chat", new Request("https://roamie.tw/", { headers: { "x-roamie-request-id": "day-1" } })),
    );
    assert.equal(daily.status, 429);
  }

  {
    const guard = fresh();
    const same = new Request("https://roamie.tw/", { headers: { "x-roamie-request-id": "payload-1" } });
    const first = await asUser(guard, "mat-user", "203.0.113.41", () => authorizeAiUse("chat", same, "hello"));
    const retry = await asUser(guard, "mat-user", "203.0.113.41", () => authorizeAiUse("chat", same, "hello"));
    const changed = await asUser(guard, "mat-user", "203.0.113.41", () => authorizeAiUse("chat", same, "different prompt"));
    assert.equal(first, null);
    assert.equal(retry, null);
    assert.equal(changed, null);
    const minute = windowStart(Date.parse("2026-09-29T12:00:00.000Z"), 60_000);
    assert.equal(guard.counter("user:mat-user", `ai:chat:min:${minute}`), 2);
    await asUser(guard, "pin-user", "203.0.113.43", async () => {
      const request = new Request("https://roamie.tw/", { headers: { "x-roamie-request-id": "pin-1" } });
      assert.equal(await authorizeAiUse("chat", request, "hello"), null);
      assert.equal(await authorizeAiUse("chat", request, "hello-again"), null);
    });
    assert.equal(guard.counter("user:pin-user", `ai:chat:min:${minute}`), 1);
  }

  {
    const request = new Request("https://roamie.tw/", { headers: { "x-roamie-request-id": "google-payload" } });
    const left = { url: text.url, method: "POST", body: { textQuery: "Kyoto" } };
    const right = { url: text.url, method: "POST", body: { textQuery: "Osaka" } };
    assert.equal(await googleOperationId(left, request), await googleOperationId(left, request));
    assert.notEqual(await googleOperationId(left, request), await googleOperationId(right, request));
  }

  {
    const guard = fresh();
    const signing = { ...envOf(guard), PLACE_PHOTO_SIGNING_SECRET: "photo-signing-secret-at-least-32" };
    const photo = "places/ChIJ_photo/photos/ref";
    const token = await signPlacePhoto(signing, photo, 480);
    let upstream = 0;
    const load = () =>
      handlePlacePhotoRequest(
        new Request(
          `https://roamie.tw/api/place-photo?photo=${encodeURIComponent(photo)}&w=480&expires=${token.expires}&signature=${encodeURIComponent(token.signature)}`,
          { headers: { "cf-connecting-ip": "203.0.113.42", "x-roamie-request-id": "replay-photo" } },
        ),
        {
          fetch: async () => {
            upstream += 1;
            return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
          },
          resolveServerKey: () => ({ key: placesKey, source: "GOOGLE_PLACES_SERVER_API_KEY" }),
          recordHttpCall: () => {},
          timeoutMs: 1000,
        },
        signing,
      );
    assert.equal((await load()).status, 200);
    assert.equal((await load()).status, 200);
    assert.equal(upstream, 2);
    assert.equal(guard.counter("ip:203.0.113.42", `ip:weight:${nowDay}`), 2);
    const tampered = await handlePlacePhotoRequest(
      new Request(
        `https://roamie.tw/api/place-photo?photo=${encodeURIComponent("places/ChIJ_other/photos/ref")}&w=480&expires=${token.expires}&signature=${encodeURIComponent(token.signature)}`,
        { headers: { "cf-connecting-ip": "203.0.113.42", "x-roamie-request-id": "replay-photo" } },
      ),
      { fetch: async () => { upstream += 1; return new Response(new Uint8Array([0xff, 0xd8])); }, resolveServerKey: () => ({ key: placesKey, source: "GOOGLE_PLACES_SERVER_API_KEY" }), recordHttpCall: () => {}, timeoutMs: 1000 },
      signing,
    );
    assert.equal(tampered.status, 401);
    assert.equal(upstream, 2);
    assert.equal(guard.counter("ip:203.0.113.42", `ip:weight:${nowDay}`), 2);
  }

  assert.equal(utcDay(Date.parse("2026-09-29T23:30:00-10:00")), "2026-09-30");
  assert.equal(utcDay(Date.parse("2026-09-30T00:30:00+09:00")), "2026-09-29");

  for (const [name, value, enabled] of [
    ["DISABLE_GOOGLE_PROXY", "1", true],
    ["DISABLE_GOOGLE_PROXY", "true", true],
    ["DISABLE_GOOGLE_PROXY", "0", false],
    ["DISABLE_GOOGLE_PROXY", "false", false],
    ["DISABLE_AI", undefined, false],
    ["DISABLE_SUBSCRIPTION_SYNC", "1", true],
    ["DISABLE_UNSPLASH_PROXY", "true", true],
  ]) {
    assert.equal(isKillSwitchOn(value === undefined ? {} : { [name]: value }, name), enabled);
  }
  const killed = await asUser(fresh(), "kill-user", "203.0.113.27", () =>
    authorizeGoogleBilling({
      env: { DISABLE_GOOGLE_PROXY: "1", ABUSE_GUARD: fresh().namespace },
      family: "places_text",
      operationId: "killed",
      chargeUser: true,
      chargeIp: true,
      userId: "kill-user",
      ip: "203.0.113.27",
    }),
  );
  assert.equal(killed.status, 503);
  assert.deepEqual(await killed.json(), { error: "google_unavailable" });
  assert.equal(unsplashProxyDisabledResponse({ DISABLE_UNSPLASH_PROXY: "false" }), null);
  assert.equal((await unsplashProxyDisabledResponse({ DISABLE_UNSPLASH_PROXY: "1" })).status, 503);

  const store = {
    counters: new Map(),
    operations: new Map(),
    get(key) { return this.counters.get(key) ?? 0; },
    set(key, value) { if (value <= 0) this.counters.delete(key); else this.counters.set(key, value); },
    getOperation(id) { return this.operations.get(id); },
    putOperation(id, value) { this.operations.set(id, value); },
  };
  const command = { action: "charge", operationId: "logic-1", buckets: [{ key: "n", limit: 1, delta: 1, reason: "family", retryAt: retryAt() }] };
  assert.equal(applyGuardCommand(store, command).ok, true);
  assert.equal(applyGuardCommand(store, command).replay, true);
  assert.equal(store.get("n"), 1);
  const denied = applyGuardCommand(store, {
    action: "charge",
    operationId: "logic-deny",
    buckets: [{ key: "n", limit: 1, delta: 1, reason: "family", retryAt: retryAt() }],
  });
  assert.equal(denied.ok, false);
  assert.equal(store.getOperation("logic-deny"), undefined);
  assert.equal(store.get("n"), 1);

  const read = (path) => readFileSync(path, "utf8");
  assert.match(read("src/lib/google-rest-transport.ts"), /fetchGoogleRestProvider/);
  assert.match(read("src/lib/google-rest-provider.server.ts"), /authorizeGoogleSpec/);
  assert.match(read("src/routes/api/place-photo.ts"), /authorizePlacePhotoFetch/);
  assert.match(read("src/routes/api/google.ts"), /handleGoogleProxy/);
  assert.match(read("src/lib/transit/transit-ai.server.ts"), /assertAiUse\("transit"\)/);
  assert.match(read("src/lib/outfit/outfit-ai.server.ts"), /assertAiUse\("outfit"\)/);
  assert.match(read("src/lib/outfit/generate-trip-outfit.server.ts"), /assertAiUse\("outfit"\)/);
  assert.ok(read("src/lib/transit/transit-ai.server.ts").indexOf("assertAiUse") < read("src/lib/transit/transit-ai.server.ts").indexOf("api.openai.com"));
  assert.match(read("wrangler.jsonc"), /ABUSE_GUARD/);
  assert.match(read("wrangler.jsonc"), /v1-abuse-guard/);
  assert.match(read("wrangler.jsonc"), /GOOGLE_API_RATE_LIMITER/);
  assert.doesNotMatch(read("src/services/unsplashService.ts"), /DISABLE_UNSPLASH_PROXY|kill-switch/);
  assert.doesNotMatch(read("src/routes/api/subscription/webhook.ts"), /DISABLE_SUBSCRIPTION_SYNC|isKillSwitchOn/);
  assert.match(read("src/routes/api/subscription/sync.ts"), /DISABLE_SUBSCRIPTION_SYNC/);
  const credits = read("src/integrations/supabase/security-middleware.ts");
  assert.ok(credits.indexOf("authorizeAiUse") < credits.indexOf("credits_reserve"));
  assert.doesNotMatch(read("scripts/public-client-env.mjs"), /DISABLE_|ABUSE_GUARD|GOOGLE_GLOBAL_DAILY_UNITS/);
  console.log("PASS abuse guard: families, weights, IP, global, UTC, concurrency, idempotency, fail closed, AI fair-use, kill switches");
} finally {
  console.info = originalInfo;
  setAbuseGuardClockForTests(null);
  setGuardProductionForTests(null);
}
