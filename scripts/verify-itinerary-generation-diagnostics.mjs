#!/usr/bin/env node
// Offline: real API, credit middleware, Zod, planner and validator; external services mocked.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { symbolicateDiagnostic } from "./symbolicate-itinerary-diagnostic.mjs";
const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(tmpdir(), "roamie-generation-diagnostics-"));
fs.symlinkSync(path.join(root, "node_modules"), path.join(temporary, "node_modules"), "dir");
const mocks = {
  "@tanstack/react-router": `export const createFileRoute=()=>x=>x;`,
  "@tanstack/react-start/server": `export const getRequest=()=>globalThis.R.request;`,
  "@tanstack/react-start": `
 export function createMiddleware(){return {middleware(ms){this.ms=ms;return this},server(fn){const ms=this.ms||[];return async args=>{let i=0;const go=async a=>i<ms.length?ms[i++]({...a,next:b=>go({...a,...b,context:{...a.context,...b?.context}})}):fn(a);return go(args)}}}}
 export function createServerFn(){let ms=[],valid=x=>x;return {middleware(v){ms=v;return this},inputValidator(v){valid=v;return this},handler(fn){return async ({data})=>{const r=globalThis.R;let i=0;const go=async ({context})=>{if(i<ms.length)return ms[i++]({context,next:go});r.handlerEntered=true;return fn({data:valid(data),context})};try{return await go({context:{}})}catch(e){r.exceptions.push({name:e.name,message:e.message,stack:e.stack});r.caught.push(e);throw e}}}}}
 `,
  "@/integrations/supabase/auth-middleware": `export const requireSupabaseAuth=async({next,context})=>next({context:{...context,userId:'fixture-user',supabase:globalThis.R.supabase}});export const allowGuestPublicRead=requireSupabaseAuth;`,
  "@/lib/ai/endpoint-guard.server": `export const requireAuthenticatedAiRequest=async()=>{if(globalThis.R.config.authThrow)throw globalThis.R.primary;if(globalThis.R.config.unauthorized)return null;return {userId:'fixture-user',hasPlusAccess:!!globalThis.R.config.plus}};`,
  "@/integrations/supabase/client.server": `export const supabaseAdmin={from(...a){return globalThis.R.supabase.from(...a)}};`,
  "@/lib/env.server": `export const getOpenAIKey=()=> 'sk-offline-fixture';export const getOpenWeatherApiKey=()=> 'offline-fixture';export const resolveGoogleMapsKey=()=> 'AIza'+'x'.repeat(35);`,
  "@/lib/ai/service.server": `export async function callRoamieAI(){globalThis.R.aiFixtureCalls++;return globalThis.R.aiPayload;}`,
  "@/lib/weather/openweather.server": `export async function openWeatherGetForecast(){await fetch('https://weather.fixture.invalid/forecast');return Array.from({length:5},(_,i)=>({date:'2026-10-'+String(10+i),tempHighC:23,tempLowC:18,condition:'晴',precipProbability:0}))}`,
};

for (const [specifier, name, flag] of [
  ["@/lib/trip/itinerary-guards", "buildFallbackItineraryFromPlaces", "plannerFailure"],
  ["@/lib/ai/itinerary-validator", "validateItineraryPlan", "validatorFailure"],
  ["@/lib/transit/build-legs.server", "buildTransitLegsForItinerary", "transitFailure"],
]) {
  const actual = JSON.stringify(path.join(root, "src", specifier.slice(2)));
  mocks[specifier] =
    `export * from ${actual};import {${name} as actual} from ${actual};export function ${name}(...args){if(globalThis.R.config.${flag})throw globalThis.R.primary;return actual(...args)}`;
}

try {
  const outfile = path.join(temporary, "fixture.mjs");
  await build({
    entryPoints: [path.join(root, "scripts/fixtures/itinerary-diagnostics/fixture.ts")],
    absWorkingDir: root,
    bundle: true,
    outfile,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: "inline",
    loader: { ".png": "dataurl" },
    packages: "external",
    define: {
      "import.meta.env": JSON.stringify({
        SSR: true,
        PROD: false,
        DEV: false,
        VITE_ITINERARY_VALIDATOR_ENABLED: "1",
        VITE_REC_ENGINE_PLANNER_ENABLED: "1",
        VITE_REC_ENGINE_VALIDATOR_ENABLED: "1",
        VITE_PIE_PLANNER_SEARCH_ENABLED: "1",
      }),
    },
    plugins: [
      {
        name: "offline-boundaries",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) =>
            mocks[a.path] ? { path: a.path, namespace: "mock" } : null,
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            contents: mocks[a.path],
            loader: "ts",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  const {
    run,
    recordAnalyticsEventServer,
    safeGenerationException,
    runWithWorkerRequest,
    startGenerationDiagnostics,
    setGenerationPhase,
    captureGenerationException,
    correlateGeneration,
  } = await import(pathToFileURL(outfile));
  let checks = 0;
  const check = (name, fn) => {
    fn();
    checks++;
    console.log("PASS " + name);
  };
  for (const flag of ["plannerFailure", "validatorFailure"]) {
    const result = await run({ [flag]: true });
    check(flag, () => {
      assert.equal(result.result.status, 500);
      assert.equal(result.ledger, "rolled_back");
      assert.equal(
        result.diagnostics.at(-1).primary.phase,
        flag === "plannerFailure" ? "planner" : "validator",
      );
      assert.equal(result.caught[0], result.primary, "original Error identity retained");
      assert.equal(result.diagnostics.at(-1).primary.exception.class, "TypeError");
      assert(result.diagnostics.at(-1).primary.exception.stack.length > 0);
      const captured = result.events.indexOf("itinerary_diagnostic_v1");
      assert(captured < result.events.indexOf("/rest/v1/rpc/credits_rollback"));
    });
  }
  const invalidInput = await run({ invalidInput: true });
  check("input validation after reserve retains phase and rolls back", () => {
    assert.equal(invalidInput.result.status, 500);
    assert.equal(invalidInput.ledger, "rolled_back");
    assert.equal(invalidInput.diagnostics.at(-1).primary.phase, "input_validation");
  });
  const transit = await run({ transitFailure: true });
  check("transit fallback remains successful; exception phase retained", () => {
    assert.equal(transit.result.status, 200);
    assert.equal(transit.ledger, "committed");
    assert.equal(transit.diagnostics.at(-1).optional[0].phase, "transit");
    assert.equal(transit.diagnostics.at(-1).primary, undefined);
  });
  for (const config of [
    { commitFailure: true, aeLimit: 250 },
    { commitFailure: true, rollbackFailure: true },
    { commitFailure: true, rollbackThrow: true },
    { commitFailure: true, rollbackReject: true },
  ]) {
    const r = await run(config);
    const last = r.diagnostics.at(-1) ?? r.analytics.at(-1).metadata.generationDiagnostic;
    check(
      "commit failure / rollback " +
        (config.rollbackFailure
          ? "RPC error"
          : config.rollbackReject
            ? "RPC throw"
            : config.rollbackThrow
              ? "fetch error"
              : "success"),
      () => {
        assert.equal(r.result.status, 500);
        assert.equal(last.primary.phase, "credits_commit");
        assert.equal(last.primary.exception.class, "CreditSettlementError");
        assert.equal(last.primary.exception.cause.code, "XX000");
        assert.equal(last.commit, "failed");
        assert.equal(
          last.rollback,
          config.rollbackFailure || config.rollbackThrow || config.rollbackReject
            ? "failed"
            : "succeeded",
        );
        if (config.rollbackFailure) assert.equal(last.cleanup.exception.code, "XX000");
        if (config.rollbackThrow || config.rollbackReject)
          assert.equal(last.cleanup.exception.message, "Too many subrequests.");
        assert.equal(r.caught[0].cause.code, "XX000", "raw RPC cause retained on thrown error");
        if (config.aeLimit) {
          assert(r.pointAttempts > 250);
          assert.equal(
            r.diagnostics.length,
            0,
            "cold fan-out exhausted AE before commit; DB is required",
          );
        }
        const stored = r.analytics.at(-1).metadata.generationDiagnostic;
        assert.deepEqual(stored.primary, last.primary);
        assert.equal(stored.rollback, last.rollback);
        assert.equal(stored.cleanup?.exception.code, last.cleanup?.exception.code);
        assert(!JSON.stringify([r.diagnostics, stored]).includes("secret-token"));
        assert(!JSON.stringify([r.diagnostics, stored]).includes("traveler@"));
        assert(!JSON.stringify([r.diagnostics, stored]).includes("private-trip"));
      },
    );
  }
  const rejected = await run({ commitRejected: true });
  check("JSON-level commit rejection is observable without changing billing behavior", () => {
    assert.equal(rejected.result.status, 200);
    assert.equal(rejected.result.body.success, true);
    assert.equal(rejected.analytics.at(-1).metadata.generationDiagnostic.commit, "rejected");
    assert.equal(
      rejected.analytics.at(-1).metadata.generationDiagnostic.rpc.commit.reason,
      "already_rolled_back",
    );
  });
  for (const config of [
    {},
    { plus: true },
    { sinkFailure: true },
    { unauthorized: true },
    { authThrow: true },
  ]) {
    const r = await run(config);

    check("normal/auth/Plus/sink independence " + JSON.stringify(config), () => {
      assert.equal(r.result.status, config.authThrow ? 500 : config.unauthorized ? 401 : 200);
      if (config.authThrow) assert.equal(r.diagnostics.at(-1).primary.phase, "auth");
      else if (!config.unauthorized) {
        assert.equal(r.result.body.success, true);
        assert.equal(r.ledger, config.plus ? "none" : "committed");
      }
      if (!config.plus && !config.unauthorized && !config.authThrow)
        assert.equal(r.analytics.at(-1).metadata.generationDiagnostic.commit, "succeeded");
      for (const point of r.points.filter((p) => p.blobs[0] === "itinerary_diagnostic_v1"))
        assert(Buffer.byteLength(point.blobs.join("")) < 16384);
    });
  }
  check("sanitization rejects payloads, credentials, email, URLs, arbitrary properties", () => {
    const e = new Error(
      "Authorization: Bearer secret-token email=traveler@example.invalid prompt=private-trip selectedPlaces=[大阪城]",
    );
    e.cause = {
      code: "PGRST301",
      message: "api_key=secret-key",
      details: "private-payload",
      hint: "email@example.invalid",
    };
    e.stack =
      "Error: private-trip\n at run (https://secret.example.invalid/assets/itinerary.functions-abc.js:10:20)\n at https://secret.example.invalid/x.js?token=secret-token:1:2";
    const safe = safeGenerationException(e);
    const value = JSON.stringify(safe);
    for (const forbidden of [
      "Bearer",
      "secret-token",
      "traveler",
      "private-trip",
      "大阪城",
      "api_key",
      "private-payload",
      "email@",
      "secret.example",
    ])
      assert(!value.includes(forbidden), forbidden);
    assert.equal(safe.cause.code, "PGRST301");
    assert.deepEqual(safe.stack, ["assets/itinerary.functions-abc.js:10:20"]);
    const malicious = new Proxy(
      {},
      {
        get() {
          throw new Error("getter");
        },
      },
    );
    assert.doesNotThrow(() => safeGenerationException(malicious));
  });
  check("credit RPC literals retained without dynamic payload", () => {
    const safe = safeGenerationException({
      code: "P0001",
      message: "credits commit would go negative",
    });
    assert.equal(safe.message, "credits commit would go negative");
    assert.equal(safe.code, "P0001");
    const unsafe = safeGenerationException(
      new Error("Cannot read properties of undefined secret-token"),
    );
    assert(!JSON.stringify(unsafe).includes("secret-token"));
  });
  check("source maps restore original source and strip TanStack split query", () => {
    fs.mkdirSync(path.join(temporary, "assets"));
    fs.writeFileSync(
      path.join(temporary, "assets/test.js.map"),
      JSON.stringify({
        version: 3,
        file: "test.js",
        sources: ["../../src/lib/itinerary.functions.ts?tss-serverfn-split"],
        names: [],
        mappings: "AAAA",
      }),
    );
    const result = symbolicateDiagnostic(
      { primary: { exception: { stack: ["assets/test.js:1:1"] } } },
      temporary,
    );
    assert.deepEqual(result.primary.exception.sourceFrames[0], {
      generated: "assets/test.js:1:1",
      mapped: true,
      source: "src/lib/itinerary.functions.ts",
      line: 1,
      column: 1,
    });
  });
  const metadataRows = [];
  globalThis.R.supabase = { from(){return {async upsert(row){metadataRows.push(row);return {error:null}}}} };
  await runWithWorkerRequest({request:new Request("https://fixture.invalid"),env:{ABUSE_GUARD_ANALYTICS:{writeDataPoint(){}}}}, async () => {
    startGenerationDiagnostics(new Request("https://fixture.invalid"), "00000000-0000-4000-8000-000000000001");
    const event={eventId:"fixture-failed",eventName:"itinerary_generation_failed"};
    await recordAnalyticsEventServer({...event,failureDiagnostics:{rules:["day_place_count"],selected_input_count:30}});
    setGenerationPhase("credits_rollback");captureGenerationException(new Error("Too many subrequests."));
    await recordAnalyticsEventServer(event);
  });
  check("terminal metadata retains existing validator rule/count telemetry",()=>{
    assert.deepEqual(metadataRows.at(-1).metadata.rules,["day_place_count"]);
    assert.equal(metadataRows.at(-1).metadata.selected_input_count,30);
    assert.equal(metadataRows.at(-1).metadata.generationDiagnostic.primary.phase,"credits_rollback");
  });
  const parallel = await Promise.all(
    [0, 1].map((i) => {
      const points = [];
      const request = new Request("https://fixture.invalid");
      return runWithWorkerRequest(
        {
          request,
          env: {
            ABUSE_GUARD_ANALYTICS: {
              writeDataPoint(p) {
                points.push(p);
              },
            },
          },
        },
        async () => {
          startGenerationDiagnostics(request, `00000000-0000-4000-8000-00000000000${i}`);
          correlateGeneration("token-should-not-be-logged");
          setGenerationPhase(i ? "planner" : "validator");
          await new Promise((resolve) => setTimeout(resolve, i ? 1 : 5));
          captureGenerationException(new Error("Too many subrequests."));
          return JSON.parse(points[0].blobs[8]);
        },
      );
    }),
  );
  check("concurrent request phase isolation and UUID-only correlation", () => {
    assert.equal(parallel[0].primary.phase, "validator");
    assert.equal(parallel[1].primary.phase, "planner");
    assert.notEqual(parallel[0].requestId, parallel[1].requestId);
    assert(!JSON.stringify(parallel).includes("token-should-not-be-logged"));
  });
  console.log(
    `Generation diagnostics: ${checks} scenarios passed (offline, no production writes).`,
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
