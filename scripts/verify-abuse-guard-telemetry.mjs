import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { installWorkerRequestStorage } from "../src/lib/worker-request-als.server.ts";
import { runWithWorkerRequest, runWithGuardTestContext } from "../src/lib/worker-request-scope.ts";
import { createMemoryAbuseGuard } from "../src/lib/abuse-guard-memory.ts";
import {
  GOOGLE_FAMILY_LIMITS,
  AI_FAIR_USE,
  billingFamilyFromUrl,
} from "../src/lib/abuse-guard-policy.ts";
import {
  authorizeAiUse,
  assertAiUse,
} from "../src/lib/abuse-guard.server.ts";
import { handleGoogleProxy } from "../src/lib/google-proxy.server.ts";
import { fetchGoogleRestProvider } from "../src/lib/google-rest-provider.server.ts";
import { handlePlacePhotoRequest } from "../src/routes/api/place-photo.ts";
import { signPlacePhoto } from "../src/lib/place-photo-signature.server.ts";
import { beginAiRequest } from "../src/lib/ai/endpoint-guard.server.ts";
import {
  newGuardObservation,
  aiObservation,
  observeGuardDecision,
  observeGuardRejection,
  observeProviderAttempt,
  observeCreditReserveAttempt,
  telemetryCoverageComplete,
} from "../src/lib/abuse-guard-telemetry.server.ts";

installWorkerRequestStorage();
const version = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const fakeKey = "AIza" + "x".repeat(35);
const request = () =>
  new Request("https://fixture.invalid/", { headers: { "cf-connecting-ip": "203.0.113.1" } });
let checks = 0;
function fixture(overrides = {}) {
  const events = [];
  const guard = createMemoryAbuseGuard();
  const env = {
    ABUSE_GUARD_ENFORCEMENT: "1",
    ABUSE_GUARD: guard.namespace,
    WORKER_VERSION_METADATA: { id: version },
    ABUSE_GUARD_ANALYTICS: { writeDataPoint: (point) => events.push(point) },
    GOOGLE_API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    GOOGLE_PLACES_SERVER_API_KEY: fakeKey,
    GOOGLE_ROUTES_SERVER_API_KEY: fakeKey,
    GOOGLE_GEOCODING_SERVER_API_KEY: fakeKey,
    GOOGLE_MAPS_SERVER_API_KEY: fakeKey,
    PLACE_PHOTO_SIGNING_SECRET: "fixture-signing-secret-at-least-32-bytes",
    ...overrides,
  };
  const run = (fn) =>
    runWithWorkerRequest({ env, request: request() }, () =>
      runWithGuardTestContext({ userId: "private-fixture-user", ip: "203.0.113.1" }, fn),
    );
  return { events, env, run };
}
const count = (events, metric) => events.filter((e) => e.blobs[0] === metric).length;
const metrics = (events) => events.map((e) => e.blobs[0]);
function privacy(events) {
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ["blobs", "doubles", "indexes"]);
    assert.equal(event.blobs.length, 10);
    assert(["guest", "authenticated", "legacy_capability", "unknown"].includes(event.blobs[8]));
    assert(["initial", "retry", "fallback", "unknown"].includes(event.blobs[9]));
    assert.deepEqual(event.doubles, [1]);
    assert.deepEqual(event.indexes, [version]);
    assert.equal(event.blobs[6], version);
    assert.match(event.blobs[7], /^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/);
    assert.doesNotMatch(
      JSON.stringify(event),
      /private-fixture|203\.0\.113|Bearer|secret|prompt|ledger|sk-/,
    );
  }
}
async function test(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
}

// Abort accidental network: every upstream in this suite must have an explicit mock.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("unexpected network blocked by telemetry verification");
};
try {
  await test("privacy allowlist, spoof rejection, immutable opaque operation", async () => {
    const f = fixture();
    await f.run(() => {
      const op = newGuardObservation("google", "places_text", {
        worker_version: "spoof",
        userId: "private-fixture",
      });
      assert.equal(Object.isFrozen(op), true);
      observeGuardDecision(op, "allow", "allowed", "spoof-version");
      observeGuardRejection(op, "private-fixture-user");
      observeGuardDecision(op, "allow", "arbitrary_reason");
      observeGuardDecision(op, "__proto__", "allowed");
      observeGuardDecision(
        newGuardObservation("google", "private-fixture-family"),
        "allow",
        "allowed",
      );
      observeGuardDecision(newGuardObservation("ai", "places_text"), "allow", "allowed");
      observeGuardDecision(
        { worker_version: version, userId: "private-fixture-user" },
        "allow",
        "allowed",
      );
      assert.equal(telemetryCoverageComplete(op), false);
    });
    assert.equal(f.events.length, 1);
    privacy(f.events);
  });

  await test("Bootstrap emits zero guard/provider/credit observations", async () => {
    for (const flag of [undefined, "false", "0", false]) {
      const f = fixture({ ABUSE_GUARD_ENFORCEMENT: flag });
      await f.run(() => {
        const op = newGuardObservation("ai", "chat");
        observeGuardDecision(op, "allow", "allowed");
        observeProviderAttempt(op)(true);
        observeCreditReserveAttempt(op, true);
      });
      assert.equal(f.events.length, 0);
    }
  });

  await test("allow once; later deny/unavailable retained; terminal once; without_guard", async () => {
    const f = fixture();
    await f.run(() => {
      const op = newGuardObservation("google", "places_text");
      observeGuardDecision(op, "allow", "allowed");
      observeGuardDecision(op, "allow", "allowed");
      observeGuardRejection(op, "family");
      observeGuardRejection(op, "guard_unavailable");
      const finish = observeProviderAttempt(op);
      finish(false);
      finish(true);
    });
    assert.equal(count(f.events, "guard_decision"), 3);
    assert.equal(count(f.events, "provider_attempt_without_guard"), 1);
    assert.equal(count(f.events, "provider_failure"), 1);
    assert.equal(count(f.events, "provider_success"), 0);
  });

  const googleInputs = [
    [
      "places_text",
      {
        url: "https://places.googleapis.com/v1/places:searchText",
        method: "POST",
        body: { textQuery: "fixture" },
      },
    ],
    [
      "places_nearby",
      {
        url: "https://places.googleapis.com/v1/places:searchNearby",
        method: "POST",
        body: {
          locationRestriction: { circle: { center: { latitude: 0, longitude: 0 }, radius: 100 } },
        },
      },
    ],
    ["places_details", { url: "https://places.googleapis.com/v1/places/fixture", method: "GET" }],
    [
      "places_autocomplete",
      {
        url: "https://places.googleapis.com/v1/places:autocomplete",
        method: "POST",
        body: { input: "fixture" },
      },
    ],
    [
      "geocoding",
      { url: "https://maps.googleapis.com/maps/api/geocode/json?address=fixture", method: "GET" },
    ],
    [
      "directions",
      {
        url: "https://maps.googleapis.com/maps/api/directions/json?origin=a&destination=b",
        method: "GET",
      },
    ],
    [
      "routes",
      {
        url: "https://routes.googleapis.com/directions/v2:computeRoutes",
        method: "POST",
        body: {
          origin: { location: { latLng: { latitude: 0, longitude: 0 } } },
          destination: { location: { latLng: { latitude: 1, longitude: 1 } } },
          travelMode: "DRIVE",
        },
      },
    ],
  ];
  await test("all Google REST families: real guard + exactly one mocked fetch", async () => {
    for (const [family, input] of googleInputs) {
      assert.equal(billingFamilyFromUrl(input.url), family);
      const f = fixture();
      let fetches = 0;
      const result = await f.run(() =>
        fetchGoogleRestProvider(input, f.env, async () => {
          fetches++;
          return Response.json({ status: "OK", places: [], routes: [], results: [] });
        }),
      );
      assert.equal(result.status, 200, family);
      assert.equal(fetches, 1);
      assert.deepEqual(metrics(f.events), [
        "guard_decision",
        "provider_attempt",
        "provider_success",
      ]);
      assert(f.events.every((e) => e.blobs[2] === family));
      privacy(f.events);
    }
  });

  await test("Google proxy/provider replay: one decision, one upstream", async () => {
    const f = fixture();
    let fetches = 0;
    const req = new Request("https://fixture.invalid/api/google", {
      method: "POST",
      headers: {
        authorization: "Bearer fixture",
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.1",
      },
      body: JSON.stringify(googleInputs[0][1]),
    });
    const result = await f.run(() =>
      handleGoogleProxy(req, f.env, {
        authenticate: async () => "private-fixture-user",
        provider: (input, env) =>
          fetchGoogleRestProvider(
            input,
            env,
            async () => {
              fetches++;
              return Response.json({ places: [] });
            },
          ),
      }),
    );
    assert.equal(result.status, 200);
    assert.equal(fetches, 1);
    assert.deepEqual(metrics(f.events), ["guard_decision", "provider_attempt", "provider_success"]);
  });

  await test("Google HTTP/application/parse/network failures retain business responses", async () => {
    for (const fetcher of [
      async () => new Response("failure", { status: 500 }),
      async () => Response.json({ status: "REQUEST_DENIED" }),
      async () => new Response("invalid-json"),
      async () => {
        throw new DOMException("fixture", "TimeoutError");
      },
    ]) {
      const f = fixture();
      let calls = 0;
      const r = await f.run(() =>
        fetchGoogleRestProvider(googleInputs[0][1], f.env, (...args) => {
          calls++;
          return fetcher(...args);
        }),
      );
      assert.equal(r.status, 502);
      assert.equal(calls, 1);
      assert.deepEqual(metrics(f.events), [
        "guard_decision",
        "provider_attempt",
        "provider_failure",
      ]);
    }
  });

  await test("photo sign decision only; origin media success/failure; no extra fetch", async () => {
    const photo = "places/fixture/photos/fixture";
    const f = fixture();
    await signPlacePhoto(f.env, photo, 600);
    assert.deepEqual(metrics(f.events), [], "signing is not upstream admission");
    for (const fails of [false, true]) {
      const g = fixture();
      const signed = await signPlacePhoto(g.env, photo, 600);
      const req = new Request(
        `https://fixture.invalid/api/place-photo?photo=${photo}&w=600&expires=${signed.expires}&signature=${signed.signature}`,
        { headers: { "cf-connecting-ip": "203.0.113.1" } },
      );
      let fetches = 0;
      const response = await g.run(() =>
        handlePlacePhotoRequest(
          req,
          {
            fetch: async () => {
              fetches++;
              return fails
                ? new Response("failure", { status: 500 })
                : new Response(new Uint8Array([255, 216, 255, 217]), {
                    headers: { "content-type": "image/jpeg" },
                  });
            },
            resolveServerKey: () => ({ key: fakeKey, source: "GOOGLE_PLACES_SERVER_API_KEY" }),
            recordHttpCall: () => {},
            timeoutMs: 1000,
          },
          g.env,
        ),
      );
      assert.equal(response.status, fails ? 502 : 200);
      assert.equal(fetches, 1);
      assert.deepEqual(metrics(g.events), [
        "guard_decision",
        "provider_attempt",
        fails ? "provider_failure" : "provider_success",
      ]);
    }
  });

  await test("AI endpoint/service replay for all five families", async () => {
    for (const family of Object.keys(AI_FAIR_USE)) {
      const f = fixture();
      await f.run(async () => {
        assert.equal(await authorizeAiUse(family, request(), "private-fixture-prompt"), null);
        await assertAiUse(family);
        observeProviderAttempt(aiObservation(family))(true);
      });
      assert.deepEqual(metrics(f.events), [
        "guard_decision",
        "provider_attempt",
        "provider_success",
      ]);
      privacy(f.events);
    }
  });

  await test("concurrent request isolation: same family cannot borrow admission", async () => {
    const f = fixture();
    await Promise.all([
      f.run(async () => {
        await authorizeAiUse("chat");
        await Promise.resolve();
        observeProviderAttempt(aiObservation("chat"))(true);
      }),
      f.run(async () => {
        await Promise.resolve();
        observeProviderAttempt(aiObservation("chat"))(false);
      }),
    ]);
    assert.equal(count(f.events, "provider_attempt_without_guard"), 1);
    assert.equal(count(f.events, "guard_decision"), 1);
  });

  await test("Plus skip, Free actual reserve, replay excluded, violation boundary", async () => {
    for (const [plus, replay] of [
      [true, false],
      [false, false],
      [false, true],
    ]) {
      const f = fixture();
      let reserves = 0;
      const result = await f.run(() =>
        beginAiRequest(
          {
            userId: "private-fixture-user",
            hasPlusAccess: plus,
            email: null,
            client: {
              rpc: async (name) => {
                assert.equal(name, "credits_reserve");
                reserves++;
                return {
                  data: { ok: true, idempotent: replay, ledger_id: "private-fixture-ledger" },
                  error: null,
                };
              },
            },
          },
          "PLACE_RECOMMENDATION",
          "chat",
          request(),
        ),
      );
      assert.equal(reserves, plus ? 0 : 1);
      assert.equal(result.response?.status ?? 200, replay ? 409 : 200);
      assert.equal(count(f.events, "plus_credit_skipped"), plus ? 1 : 0);
      assert.equal(count(f.events, "free_credit_reserve_succeeded"), !plus && !replay ? 1 : 0);
      assert.equal(count(f.events, "plus_credit_reserve_violation"), 0);
      privacy(f.events);
    }
    const f = fixture();
    await f.run(() => observeCreditReserveAttempt(aiObservation("itinerary"), true));
    assert.deepEqual(metrics(f.events), ["plus_credit_reserve_violation"]);
    privacy(f.events);
  });

  await test("missing bindings/invalid version/write throw: business unchanged, coverage incomplete", async () => {
    for (const override of [
      { ABUSE_GUARD_ANALYTICS: undefined },
      { WORKER_VERSION_METADATA: undefined },
      { WORKER_VERSION_METADATA: { id: "private-fixture-user" } },
      {
        ABUSE_GUARD_ANALYTICS: {
          writeDataPoint() {
            throw new Error("private-fixture-secret");
          },
        },
      },
    ]) {
      const f = fixture(override);
      let calls = 0;
      await f.run(async () => {
        const op = newGuardObservation("google", "places_text");
        observeGuardDecision(op, "allow", "allowed");
        const response = await fetchGoogleRestProvider(
          googleInputs[0][1],
          f.env,
          async () => {
            calls++;
            return Response.json({ places: [] });
          },
        );
        assert.equal(response.status, 200);
        assert.equal(telemetryCoverageComplete(op), false);
      });
      assert.equal(calls, 1);
      assert.equal(f.events.length, 0);
    }
    const f = fixture({ ABUSE_GUARD: undefined });
    const response = await f.run(() =>
      fetchGoogleRestProvider(googleInputs[0][1], f.env, async () => {
        throw new Error("must not fetch");
      }),
    );
    assert.equal(response.status, 503);
    assert.equal(f.events[0].blobs[3], "unavailable");
  });

  await test("schema / production boundary contracts", async () => {
    const telemetry = readFileSync("src/lib/abuse-guard-telemetry.server.ts", "utf8");
    assert.doesNotMatch(telemetry, /fetch\(|console\.|\.\.\./);
    assert.doesNotMatch(telemetry, /Math\.random|sampleRate/);
    for (const file of [
      "src/lib/ai/endpoint-guard.server.ts",
      "src/integrations/supabase/security-middleware.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /observeCreditReserveAttempt\(/);
      assert.match(source, /free_credit_reserve_succeeded/);
      assert.match(source, /plus_credit_skipped/);
    }
    const guard = readFileSync("src/lib/abuse-guard.server.ts", "utf8");
    assert.doesNotMatch(guard, /subject:|global_emergency/);
    assert.equal(Object.keys(GOOGLE_FAMILY_LIMITS).length, 8);
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/,\s*([}\]])/g, "$1"));
    assert.deepEqual(config.version_metadata, { binding: "WORKER_VERSION_METADATA" });
    assert.deepEqual(config.analytics_engine_datasets, [
      { binding: "ABUSE_GUARD_ANALYTICS", dataset: "ABUSE_GUARD_ANALYTICS" },
    ]);
    assert.deepEqual(config.durable_objects.bindings, [
      { name: "ABUSE_GUARD", class_name: "AbuseGuard" },
    ]);
    assert.deepEqual(config.ratelimits, [
      { name: "GOOGLE_API_RATE_LIMITER", namespace_id: "1001", simple: { limit: 120, period: 60 } },
    ]);
    assert.deepEqual(config.migrations, [
      { tag: "v1-abuse-guard", new_sqlite_classes: ["AbuseGuard"] },
    ]);
  });

  await test("real AI allow followed by kill switch/unavailable is never hidden", async () => {
    const f = fixture();
    await f.run(async () => {
      await assertAiUse("chat");
      f.env.DISABLE_AI = "1";
      await assert.rejects(() => assertAiUse("chat"));
      delete f.env.DISABLE_AI;
      f.env.ABUSE_GUARD = undefined;
      await assert.rejects(() => assertAiUse("chat"));
    });
    assert.deepEqual(
      f.events.map((e) => e.blobs[3]),
      ["allow", "deny", "unavailable"],
    );
  });

  await test("compile-time privacy boundary rejects payload objects and version overrides", async () => {
    const ts = await import("typescript");
    const directory = mkdtempSync(join(tmpdir(), "roamie-guard-types-"));
    try {
      const path = join(directory, "privacy.ts");
      writeFileSync(
        path,
        `
        import {newGuardObservation, observeGuardDecision, observeCredit} from ${JSON.stringify(join(process.cwd(), "src/lib/abuse-guard-telemetry.server.ts"))};
        const op = newGuardObservation("google", "places_text");
        observeGuardDecision(op, "allow", "allowed");
        // @ts-expect-error caller cannot supply identity/metadata or a version
        newGuardObservation("google", "places_text", {userId:"fixture",worker_version:"spoof"});
        // @ts-expect-error family belongs to a different provider
        newGuardObservation("google", "chat");
        // @ts-expect-error no arbitrary reason
        observeGuardDecision(op, "deny", "arbitrary");
        // @ts-expect-error no Request payload
        observeGuardDecision(new Request("https://fixture.invalid"), "allow", "allowed");
        // @ts-expect-error no auth payload
        observeCredit({userId:"fixture"}, "plus_credit_skipped");
        // @ts-expect-error credit event API rejects provider metrics
        observeCredit(op, "provider_attempt");
      `,
      );
      const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
      const program = ts.createProgram([path], parsed.options);
      const failures = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === path);
      assert.deepEqual(
        failures.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")),
        [],
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // Execute the real AI provider functions with deterministic preparation/enrichment.
  // No production endpoint, key, prompt, or provider is used.
  await test("actual AI fetch boundaries and streaming completion authority", async () => {
    const directory = mkdtempSync(join(tmpdir(), "roamie-guard-telemetry-"));
    const stubs = {
      "env.server": 'export const getOpenAIKey = () => "sk-fixture-not-a-real-key";',
      "./prompts":
        'export const buildSystemPrompt = () => "fixture"; export const buildUserMessage = () => "fixture";',
      "enrich-roamie-places.server": "export const enrichRoamieResponse = async x => x;",
      "merge-verified.server": "export const mergeAiWithVerifiedCandidates = x => x;",
      "pipeline.server":
        "export const preparePlacesFirstContext = async ctx => ({ctx,candidates:[]});",
      "fallback-summary": 'export const buildRuleBasedRecommendSummary = () => "fixture";',
      "ai-pipeline-log": "export const logAiPipeline = () => {};",
      "openweather.server": "export const openWeatherGetForecast = async () => [];",
    };
    try {
      const bundled = await build({
        stdin: {
          resolveDir: process.cwd(),
          loader: "ts",
          contents: `
          export {callRoamieAI,streamRoamieAI} from './src/lib/ai/service.server';
          export {callOutfitAI} from './src/lib/outfit/outfit-ai.server';
          export {callTripOutfitAI} from './src/lib/outfit/generate-trip-outfit.server';
          export {enrichTransitLegsWithAI} from './src/lib/transit/transit-ai.server';
          export {authorizeAiUse} from './src/lib/abuse-guard.server';
          import {installWorkerRequestStorage} from './src/lib/worker-request-als.server';
          import {runWithWorkerRequest,runWithGuardTestContext} from './src/lib/worker-request-scope';
          export const run = (env,fn) => {installWorkerRequestStorage(); return runWithWorkerRequest({env},()=>runWithGuardTestContext({userId:'fixture',ip:'203.0.113.2'},fn));};
        `,
        },
        bundle: true,
        write: false,
        format: "esm",
        platform: "node",
        packages: "external",
        plugins: [
          {
            name: "isolated-provider-dependencies",
            setup(b) {
              b.onResolve(
                {
                  filter:
                    /env\.server|^\.\/prompts$|enrich-roamie-places\.server|merge-verified\.server|pipeline\.server|fallback-summary|ai-pipeline-log|openweather\.server/,
                },
                (args) => {
                  const key = Object.keys(stubs).find((k) => args.path.endsWith(k));
                  return key ? { path: key, namespace: "fixture" } : undefined;
                },
              );
              b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
                contents: stubs[args.path],
                loader: "js",
              }));
              b.onLoad({ filter: /generate-trip-outfit\.server\.ts$/ }, (args) => ({
                contents: readFileSync(args.path, "utf8") + "\nexport {callTripOutfitAI};",
                loader: "ts",
              }));
            },
          },
        ],
      });
      // Resolve external packages from the repository, without writing a test bundle into it.
      const { createRequire } = await import("node:module");
      const require = createRequire(join(process.cwd(), "package.json"));
      const output = bundled.outputFiles[0].text.replace(
        /from "(zod|@tanstack\/react-start[^" ]*)"/g,
        (_, name) => `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`,
      );
      const path = join(directory, "providers.mjs");
      writeFileSync(path, output);
      const api = await import(pathToFileURL(path).href);
      const ctx = (mode) => ({
        mode,
        locale: "en",
        messages: [],
        preferences: {},
        time: "2026-09-30T00:00:00Z",
      });
      const legs = [
        {
          legKey: "fixture",
          fromName: "a",
          toName: "b",
          recommendedMode: "walk",
          durationMinutes: 1,
          distanceMeters: 1,
          complexity: "low",
          reason: "fixture",
        },
      ];
      const cases = [
        [
          "chat",
          () => api.callRoamieAI(ctx("chat")),
          { summary: "fixture", recommendations: [], itinerary: [] },
        ],
        [
          "recommendations",
          () => api.callRoamieAI(ctx("recommend")),
          { summary: "fixture", recommendations: [], itinerary: [] },
        ],
        [
          "itinerary",
          () => api.callRoamieAI(ctx("itinerary")),
          { summary: "fixture", recommendations: [], itinerary: [] },
        ],
        [
          "outfit",
          () => api.callOutfitAI({ destination: "fixture", days: [] }),
          { dailyOutfits: [] },
        ],
        ["outfit", () => api.callTripOutfitAI("fixture", "en"), { suggestion: "fixture" }],
        [
          "transit",
          () => api.enrichTransitLegsWithAI(legs, {}),
          { legs: [{ legKey: "fixture", headline: "fixture", reason: "fixture" }] },
        ],
      ];
      for (const [family, invoke, content] of cases) {
        for (const outcome of ["success", "http", "parse", "timeout"]) {
          const f = fixture();
          let calls = 0;
          globalThis.fetch = async (url) => {
            assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
            calls++;
            if (outcome === "timeout") throw new DOMException("fixture", "TimeoutError");
            if (outcome === "http")
              return Response.json({ error: { message: "fixture" } }, { status: 500 });
            return Response.json({
              choices: [
                {
                  message: {
                    content: outcome === "parse" ? "invalid-json" : JSON.stringify(content),
                  },
                },
              ],
            });
          };
          await api.run(f.env, async () => {
            await api.authorizeAiUse(family);
            try {
              await invoke();
            } catch (error) {
              assert.notEqual(outcome, "success");
              // Existing outfit callers can throw the async error mapper promise.
              if (error instanceof Promise) await error.catch(() => {});
            }
          });
          assert.equal(calls, 1, family + ":" + outcome);
          assert.deepEqual(
            metrics(f.events),
            [
              "guard_decision",
              "provider_attempt",
              outcome === "success" ? "provider_success" : "provider_failure",
            ],
            family + ":" + outcome,
          );
          privacy(f.events);
        }
      }
      for (const outcome of [
        "success",
        "empty",
        "parse",
        "http",
        "read",
        "cancel",
        "early_cancel",
      ]) {
        const f = fixture();
        let calls = 0;
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        globalThis.fetch = async () => {
          calls++;
          if (outcome === "http")
            return Response.json({ error: { message: "fixture" } }, { status: 500 });
          return new Response(
            new ReadableStream({
              async start(controller) {
                await gate;
                if (outcome === "read") {
                  controller.error(new Error("fixture"));
                  return;
                }
                if (outcome !== "empty") {
                  const content =
                    outcome === "parse"
                      ? "invalid-json"
                      : JSON.stringify({ summary: "fixture", recommendations: [], itinerary: [] });
                  controller.enqueue(
                    new TextEncoder().encode(
                      "data: " + JSON.stringify({ choices: [{ delta: { content } }] }) + "\n\n",
                    ),
                  );
                }
                controller.close();
              },
            }),
          );
        };
        await api.run(f.env, async () => {
          await api.authorizeAiUse("chat");
          const streamed = api.streamRoamieAI(ctx("chat"));
          if (outcome === "early_cancel") await streamed.stream.cancel();
          // Let preparation reach fetch, but keep the body pending.
          for (let i = 0; i < 50 && !calls; i++) await new Promise((r) => setTimeout(r, 0));
          assert.equal(calls, 1);
          assert.equal(count(f.events, "provider_success"), 0);
          if (outcome === "cancel") await streamed.stream.cancel();
          release();
          if (outcome !== "cancel" && outcome !== "early_cancel")
            await new Response(streamed.stream).text();
          await streamed.getAssembled();
        });
        assert.equal(count(f.events, "provider_attempt"), 1);
        assert.equal(count(f.events, "provider_success"), outcome === "success" ? 1 : 0);
        assert.equal(count(f.events, "provider_failure"), outcome === "success" ? 0 : 1);
        privacy(f.events);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
} finally {
  globalThis.fetch = originalFetch;
}
console.log(`AbuseGuard aggregate telemetry: ${checks} groups PASS`);
