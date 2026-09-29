import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { admitAuthenticatedServerFunction, authorizeAiUse, authorizeGoogleBilling } from "../src/lib/abuse-guard.server.ts";
import { isAbuseGuardEnforcementOn } from "../src/lib/abuse-guard-enforcement.server.ts";
import { beginAiRequest } from "../src/lib/ai/endpoint-guard.server.ts";
import { fetchGoogleRestProvider } from "../src/lib/google-rest-provider.server.ts";
import { handleGoogleProxy } from "../src/lib/google-proxy.server.ts";
import { signPlacePhoto } from "../src/lib/place-photo-signature.server.ts";
import { handlePlacePhotoRequest } from "../src/routes/api/place-photo.ts";
import { runWithGuardTestContext, runWithWorkerRequest } from "../src/lib/worker-request-scope.ts";

delete process.env.ABUSE_GUARD_ENFORCEMENT;

const placesKey = "AIza" + "x".repeat(35);
const text = {
  url: "https://places.googleapis.com/v1/places:searchText",
  method: "POST",
  body: { textQuery: "Tokyo", pageSize: 1 },
};
const allowLimiter = { limit: async () => ({ success: true }) };

function throwingGuard() {
  let calls = 0;
  return {
    calls: () => calls,
    namespace: {
      idFromName() {
        calls += 1;
        return "id";
      },
      get() {
        calls += 1;
        return {
          fetch: async () => {
            calls += 1;
            throw new Error("durable object must not be called");
          },
        };
      },
    },
  };
}

assert.equal(isAbuseGuardEnforcementOn(undefined), false);
assert.equal(isAbuseGuardEnforcementOn({}), false);
for (const value of ["0", "false", "FALSE", "yes", "", "1 "]) {
  assert.equal(isAbuseGuardEnforcementOn({ ABUSE_GUARD_ENFORCEMENT: value }), false, String(value));
}
for (const value of ["1", "true", true, 1]) {
  assert.equal(isAbuseGuardEnforcementOn({ ABUSE_GUARD_ENFORCEMENT: value }), true, String(value));
}

{
  const guard = throwingGuard();
  const watched = [];
  const env = {
    ABUSE_GUARD: guard.namespace,
    DISABLE_GOOGLE_PROXY: "1",
    GOOGLE_API_RATE_LIMITER: {
      limit: async ({ key }) => {
        watched.push(key);
        return { success: true };
      },
    },
    GOOGLE_PLACES_SERVER_API_KEY: placesKey,
  };
  const response = await handleGoogleProxy(
    new Request("https://roamie.tw/api/google", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer fixture",
        "cf-connecting-ip": "203.0.113.10",
        "x-abuse-guard-enforcement": "1",
      },
      body: JSON.stringify(text),
    }),
    env,
    {
      authenticate: async () => "legacy-user",
      provider: async () => Response.json({ places: [] }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(guard.calls(), 0);
  assert.deepEqual(watched, ["google:ip:203.0.113.10", "google:user:legacy-user"]);
  const missingLimiter = await handleGoogleProxy(
    new Request("https://roamie.tw/api/google", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer fixture" },
      body: JSON.stringify(text),
    }),
    { ABUSE_GUARD: guard.namespace },
    { authenticate: async () => "legacy-user", provider: async () => Response.json({ places: [] }) },
  );
  assert.equal(missingLimiter.status, 503);
  assert.deepEqual(await missingLimiter.json(), { error: "google_rate_limit_unavailable" });
  assert.equal(guard.calls(), 0);
}

{
  const guard = throwingGuard();
  let fetches = 0;
  const response = await fetchGoogleRestProvider(
    text,
    { ABUSE_GUARD: guard.namespace, GOOGLE_PLACES_SERVER_API_KEY: placesKey },
    async () => {
      fetches += 1;
      return Response.json({ places: [] });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(fetches, 1);
  assert.equal(guard.calls(), 0);
  let enforcedFetches = 0;
  const denied = await runWithGuardTestContext({ userId: "enforced-user", ip: "203.0.113.11" }, () =>
    fetchGoogleRestProvider(
      text,
      {
        ABUSE_GUARD_ENFORCEMENT: "1",
        GOOGLE_API_RATE_LIMITER: allowLimiter,
        GOOGLE_PLACES_SERVER_API_KEY: placesKey,
      },
      async () => {
        enforcedFetches += 1;
        return Response.json({ places: [] });
      },
    ),
  );
  assert.equal(denied.status, 503);
  assert.deepEqual(await denied.json(), { error: "google_unavailable" });
  assert.equal(enforcedFetches, 0);
}

{
  const guard = throwingGuard();
  const allowed = await runWithWorkerRequest(
    {
      env: { ABUSE_GUARD: guard.namespace },
      request: new Request("https://roamie.tw/", { headers: { "x-abuse-guard-enforcement": "1" } }),
    },
    () =>
      authorizeGoogleBilling({
        family: "places_text",
        operationId: "header-cannot-enable",
        chargeUser: true,
        chargeIp: true,
        userId: "header-user",
        ip: "203.0.113.12",
      }),
  );
  assert.equal(allowed, null);
  assert.equal(guard.calls(), 0);
  const ai = await authorizeAiUse("chat", new Request("https://roamie.tw/"));
  assert.equal(ai, null);
  assert.equal(guard.calls(), 0);
  const closed = await runWithWorkerRequest({ env: { ABUSE_GUARD_ENFORCEMENT: "1" }, request: new Request("https://roamie.tw/") }, () =>
    authorizeAiUse("chat", new Request("https://roamie.tw/")),
  );
  assert.equal(closed.status, 503);
  assert.deepEqual(await closed.json(), { error: "ai_unavailable" });
}

{
  const calls = [];
  const reservation = await beginAiRequest(
    {
      userId: "free-bootstrap",
      email: null,
      hasPlusAccess: false,
      client: { rpc: async (name) => { calls.push(name); return { data: { ok: true, ledger_id: "ledger" }, error: null }; } },
    },
    "PLACE_RECOMMENDATION",
    "chat",
    new Request("https://roamie.tw/api/chat"),
  );
  assert.equal(reservation.response, null);
  assert.equal(calls.includes("credits_reserve"), true);
  const blocked = await runWithWorkerRequest(
    { env: { ABUSE_GUARD_ENFORCEMENT: "1" }, request: new Request("https://roamie.tw/") },
    () =>
      beginAiRequest(
        {
          userId: "free-enforced",
          email: null,
          hasPlusAccess: false,
          client: { rpc: async (name) => { calls.push(name); return { data: { ok: true }, error: null }; } },
        },
        "PLACE_RECOMMENDATION",
        "chat",
        new Request("https://roamie.tw/api/chat"),
      ),
  );
  assert.equal(blocked.response.status, 503);
  assert.equal(calls.filter((name) => name === "credits_reserve").length, 1);
}

{
  const guard = throwingGuard();
  for (let index = 0; index < 60; index += 1) await admitAuthenticatedServerFunction("bootstrap-fn");
  await assert.rejects(admitAuthenticatedServerFunction("bootstrap-fn"), /Too Many Requests/);
  await runWithWorkerRequest({ env: { ABUSE_GUARD: guard.namespace }, request: new Request("https://roamie.tw/") }, () =>
    admitAuthenticatedServerFunction("bootstrap-fn-2"),
  );
  assert.equal(guard.calls(), 0);
  await assert.rejects(
    runWithWorkerRequest({ env: { ABUSE_GUARD_ENFORCEMENT: "1" }, request: new Request("https://roamie.tw/") }, () =>
      admitAuthenticatedServerFunction("enforced-fn"),
    ),
    /service_unavailable/,
  );
}

{
  const guard = throwingGuard();
  const signing = {
    ABUSE_GUARD: guard.namespace,
    DISABLE_GOOGLE_PROXY: "1",
    GOOGLE_API_RATE_LIMITER: allowLimiter,
    PLACE_PHOTO_SIGNING_SECRET: "photo-signing-secret-at-least-32",
  };
  const photo = "places/ChIJ_photo/photos/ref";
  const token = await signPlacePhoto(signing, photo, 480);
  const dependencies = {
    fetch: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
    resolveServerKey: () => ({ key: placesKey, source: "GOOGLE_PLACES_SERVER_API_KEY" }),
    recordHttpCall: () => {},
    timeoutMs: 1000,
  };
  const load = (ip) =>
    handlePlacePhotoRequest(
      new Request(
        `https://roamie.tw/api/place-photo?photo=${encodeURIComponent(photo)}&w=480&expires=${token.expires}&signature=${encodeURIComponent(token.signature)}`,
        { headers: { "cf-connecting-ip": ip } },
      ),
      dependencies,
      signing,
    );
  assert.equal((await load("203.0.113.40")).status, 200);
  assert.equal(guard.calls(), 0);
  const limitedIp = "203.0.113.41";
  for (let index = 0; index < 120; index += 1) assert.equal((await load(limitedIp)).status, 200);
  const limited = await load(limitedIp);
  assert.equal(limited.status, 429);
  assert.equal(await limited.text(), "");
  assert.equal(guard.calls(), 0);
  const enforced = await handlePlacePhotoRequest(
    new Request(
      `https://roamie.tw/api/place-photo?photo=${encodeURIComponent(photo)}&w=480&expires=${token.expires}&signature=${encodeURIComponent(token.signature)}`,
      { headers: { "cf-connecting-ip": "203.0.113.42" } },
    ),
    dependencies,
    {
      GOOGLE_API_RATE_LIMITER: allowLimiter,
      PLACE_PHOTO_SIGNING_SECRET: signing.PLACE_PHOTO_SIGNING_SECRET,
      ABUSE_GUARD_ENFORCEMENT: "1",
    },
  );
  assert.equal(enforced.status, 503);
  assert.deepEqual(await enforced.json(), { error: "google_unavailable" });
}

{
  const root = "src";
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx|mjs|js)$/.test(name)) continue;
      if (readFileSync(path, "utf8").includes("ABUSE_GUARD_ENFORCEMENT")) hits.push(path);
    }
  };
  walk(root);
  const clientHits = hits.filter((path) => !path.endsWith(".server.ts") && !path.includes("/routes/"));
  assert.deepEqual(clientHits, []);
  assert.doesNotMatch(readFileSync("scripts/public-client-env.mjs", "utf8"), /ABUSE_GUARD_ENFORCEMENT/);
  assert.doesNotMatch(readFileSync("wrangler.jsonc", "utf8"), /ABUSE_GUARD_ENFORCEMENT/);
  assert.match(readFileSync("wrangler.jsonc", "utf8"), /new_sqlite_classes/);
}

console.log("PASS abuse guard bootstrap: legacy limits, no DO, kill switches inactive, enforcement still fail closed");
