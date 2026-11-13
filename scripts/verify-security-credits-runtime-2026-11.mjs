// verify-security-credits-runtime-2026-11.mjs — 任務單 #6（第 2 次獨立複審）：伺服器扣點狀態機（執行）
//
// 以 esbuild 打包「真實」 /api/roamie、/api/chat、endpoint-guard.server、service.server（streamRoamieAI），
// 只 mock 外部邊界：supabase-js（使用者 client）、client.server（service role client）、OpenAI（全域 fetch）、
// analytics 寫入、abuse-guard／kill-switch／telemetry。
// 網路：全域 fetch／http(s)／net／tls 一律攔截；非 mock 的請求 → FAIL。清除金鑰類環境變數。不讀 .env。
//
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=180 scripts/verify-security-credits-runtime-2026-11.mjs
//
// 覆蓋（以 RPC 呼叫次數證明）：
//   G  serverCreditsRpc／createServerCreditSettlement 狀態機（單元）
//   R  /api/roamie 串流：commit 先於 final/done；commit rpc_error 重試一次；兩次失敗 → 釋放預扣、不交付；
//      ok:false 不重試；provider 完成後斷線 → commit；完成前斷線 → rollback；cancel 標頭 204 零 RPC；
//      provider 失敗退點；Plus 不扣點；非串流 commit 失敗不交付
//   C  /api/chat 串流：同上主要情境
//   S  預扣／結算一律走 service role client 並帶 p_user_id = 已驗證使用者；使用者 client 零 credits RPC
//   D  斷線時機（任務單 #10）：預扣中（非串流）、analytics await 中、Places 準備中、enforceModelCall 中、
//      非串流 provider 中（上游 signal 被 abort）、499 之後不寫紀錄／不 commit、非串流 provider 完成後斷線 → commit
//   Q  /api/chat（任務單 #20）：全 assistant → 400 且 0 預扣／0 OpenAI；多輪正常不變；無 lastUser 但已送出內容 →
//      commit、不寫紀錄（以停用 refine 的路由副本模擬）；送出部分內容後 provider 出錯 → rollback

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Network guard (before anything else)
// ---------------------------------------------------------------------------
for (const k of Object.keys(process.env)) {
  if (/SUPABASE|OPENAI|GOOGLE_|SERVICE_ROLE|REVENUECAT|STRIPE|UNSPLASH|SECRET/i.test(k)) delete process.env[k];
}
const NET_BLOCKED = [];
globalThis.__m = {};
const M = globalThis.__m;
// Network traps are installed after esbuild finished building (no application code runs
// during the build) and before any bundled application module is imported.
function installSocketTraps() {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    if (typeof M.fetchHandler === "function") {
      const r = await M.fetchHandler(url, init ?? {}, input);
      if (r !== undefined) return r;
    }
    NET_BLOCKED.push(String(url).slice(0, 120));
    throw new TypeError("NETWORK_BLOCKED " + url);
  };
  const require = createRequire(import.meta.url);
  const trap = (kind) => () => {
    NET_BLOCKED.push(kind);
    throw new Error("NETWORK_BLOCKED " + kind);
  };
  for (const m of ["http", "https"]) {
    const mod = require(m);
    mod.request = trap(m + ".request");
    mod.get = trap(m + ".get");
  }
  const net = require("net");
  net.connect = trap("net.connect");
  net.createConnection = trap("net.createConnection");
  require("tls").connect = trap("tls.connect");
}
process.env.SUPABASE_URL = "https://offline-mock.supabase.invalid";
process.env.SUPABASE_PUBLISHABLE_KEY = "mock-publishable";

// --root=<dir> runs the same checks against another checkout (e.g. a HEAD snapshot) to show
// which checks fail before the fix.
const rootArg = process.argv.find((a) => a.startsWith("--root="))?.slice(7);
const root = rootArg ? path.resolve(rootArg) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
let passCount = 0;
// Synchronous write: output survives a watchdog SIGKILL.
const out = (s) => fs.writeSync(1, s + "\n");
async function check(name, fn) {
  try {
    await fn();
    passCount += 1;
    out("PASS " + name);
  } catch (e) {
    failures.push(name);
    out("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 16).join("\n     "));
  }
}
const quiet = { info: console.info, error: console.error, warn: console.warn, log: console.log };
const silenceConsole = () => {
  console.info = () => {};
  console.error = () => {};
  console.warn = () => {};
};

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-sec-credits-"));
// Bare packages stay external (resolved from the repo's node_modules); mocked ones are intercepted first.
fs.symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"), "dir");
let seq = 0;
async function buildBundle(entry, mocks) {
  const outFile = path.join(tmp, `c${(seq += 1)}.mjs`);
  out("  build " + entry);
  await build({
    entryPoints: [path.join(root, entry)],
    absWorkingDir: root,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
    outfile: outFile,
    logLevel: "silent",
    plugins: [
      {
        name: "credits-mocks",
        setup(b) {
          // Exact-match filter: esbuild only calls back into JS for mocked specifiers.
          const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
          const filter = new RegExp("^(" + Object.keys(mocks).map(esc).join("|") + ")$");
          b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "mock" }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "ts", resolveDir: root }));
        },
      },
    ],
  });
  return outFile;
}

const MOCKS = {
  "@tanstack/react-router": `export const createFileRoute = () => (opts) => opts;`,
  "@/lib/analytics/record.server": `export const recordAnalyticsEventServer = async (e) => {
    globalThis.__m.analytics.push(e.eventName);
    if (globalThis.__m.analyticsGate && e.eventName === "itinerary_generation_started") {
      globalThis.__m.trace.push("analytics-started-gate");
      await globalThis.__m.analyticsGate.promise;
    }
    if (globalThis.__m.analyticsThrow) throw new Error("analytics fixture down");
  };`,
  "@/lib/abuse-guard-telemetry.server": `
    export const aiObservation = () => ({});
    export const observeCredit = () => {};
    export const observeCreditReserveAttempt = () => {};
    export const observeProviderAttempt = () => () => {};
    export const observeGuardRejection = () => {};`,
  // assertAiUse is the pre-provider await of enforceModelCall (service.server); prepGate holds it.
  "@/lib/abuse-guard.server": `export const authorizeAiUse = async () => null;
    export const assertAiUse = async () => {
      if (globalThis.__m.prepGate) { globalThis.__m.trace.push("prep-gate"); await globalThis.__m.prepGate.promise; }
    };`,
  // enforceFrom = n: the n-th call onward returns true (route's own check is call #1, the
  // service's enforceModelCall is call #2), so only the pre-provider guard path is enabled.
  "@/lib/abuse-guard-enforcement.server": `export const isAbuseGuardEnforcementOn = () => {
    const m = globalThis.__m; m.enfCalls = (m.enfCalls ?? 0) + 1;
    return m.enforceFrom ? m.enfCalls >= m.enforceFrom : false;
  };`,
  "@/lib/kill-switch.server": `export const isKillSwitchOn = () => false;`,
  "@/lib/worker-request-scope": `export const getWorkerScope = () => undefined; export const bindVerifiedUserId = () => {};`,
  "@/lib/env.server": `export const getOpenAIKey = () => "sk-offline-fixture";`,
  "@/lib/enrich-roamie-places.server": `
    export const enrichRoamieResponse = async (p) => {
      globalThis.__m.trace.push("enrich-start");
      if (globalThis.__m.enrichGate) await globalThis.__m.enrichGate.promise;
      return p;
    };`,
  "@/lib/recommendation/merge-verified.server": `export const mergeAiWithVerifiedCandidates = (p) => p;`,
  "@/lib/recommendation/pipeline.server": `export const preparePlacesFirstContext = async (ctx) => {
    globalThis.__m.trace.push("places-prep-start");
    if (globalThis.__m.placesGate) await globalThis.__m.placesGate.promise;
    return { ctx, candidates: [] };
  };`,
  // Prompt text is irrelevant to billing; the real module pulls in most of src/lib/ai.
  "./prompts": `export const buildSystemPrompt = () => "system"; export const buildUserMessage = () => "user";`,
  // Requests here carry no conversationStage; the real module pulls in the whole chat engine.
  "@/lib/ai/conversation-stage": `export const stageAllowsPlacesFirst = () => Boolean(globalThis.__m.placesFirst); export const mergeBoundsForStage = () => ({});`,
  "@/lib/access/context": `export const applyTierToAiContext = (ctx) => ctx;`,
  // Per-minute limits are not under test; many requests share one verified user here.
  "@/lib/rate-limit.server": `
    export const AI_RATE_LIMITS = { chatPerMinute: 1e9 };
    export const SECURITY_RATE_LIMITS = { chatPerMinute: 1e9 };
    export const checkRateLimit = () => ({ allowed: true, retryAfterSec: 0 });`,
  "@supabase/supabase-js": `
    export const createClient = (...a) => globalThis.__m.userClientFactory(...a);
    export class SupabaseClient {}`,
  "@/integrations/supabase/client.server": `
    export const supabaseAdmin = {
      rpc: (...a) => globalThis.__m.adminRpc(...a),
      from: () => { throw new Error("service role from() not expected in credits path"); },
    };`,
};

out("bundling /api/roamie, /api/chat, endpoint-guard …");
let guardFile, roamieFile, chatFile, chatNoRefineFile;
try {
  guardFile = await buildBundle("src/lib/ai/endpoint-guard.server.ts", MOCKS);
  roamieFile = await buildBundle("src/routes/api/roamie.ts", MOCKS);
  chatFile = await buildBundle("src/routes/api/chat.ts", MOCKS);
  // Q3/Q4b: a second, separately evaluated copy of the same route (see loadChatWithoutRefine).
  chatNoRefineFile = await buildBundle("src/routes/api/chat.ts", MOCKS);
} catch (e) {
  out("INFRA-FAIL bundle: " + (e?.errors ?? []).map((x) => x.text + " @ " + (x.location?.file ?? "")).join("\n  ") + "\n" + String(e?.message ?? e).slice(0, 2000));
  process.exit(1);
}
out("bundles built");
installSocketTraps();
silenceConsole();
const roamie = await import(pathToFileURL(roamieFile).href);
const chat = await import(pathToFileURL(chatFile).href);
const guard = await import(pathToFileURL(guardFile).href);
out("bundles loaded");
const ROAMIE_POST = roamie.Route.server.handlers.POST;
const CHAT_POST = chat.Route.server.handlers.POST;
/**
 * Q3/Q4b only: the route's BodySchema now rejects a messages array without a user turn, so
 * onComplete can no longer be reached without lastUser through the real route. To still prove
 * that billing does not depend on lastUser, evaluate a second copy of the real route while
 * ZodArray#refine is a no-op (the refine is applied at module evaluation), then restore it.
 * zod is external (shared instance); only the schemas built during this import are affected.
 */
async function loadChatWithoutRefine() {
  const { ZodArray } = await import("zod");
  const own = Object.getOwnPropertyDescriptor(ZodArray.prototype, "refine");
  ZodArray.prototype.refine = function () {
    return this;
  };
  try {
    return (await import(pathToFileURL(chatNoRefineFile).href)).Route.server.handlers.POST;
  } finally {
    if (own) Object.defineProperty(ZodArray.prototype, "refine", own);
    else delete ZodArray.prototype.refine;
  }
}
const CHAT_NO_REFINE_POST = await loadChatWithoutRefine();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const VERIFIED_UID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 2000, label = "condition") {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for " + label);
    await sleep(5);
  }
}
const AI_JSON = JSON.stringify({ summary: "AI result", recommendations: [] });

function reset({ plus = false, commits = [], rollbacks = [], reserve = null } = {}) {
  M.analytics = [];
  M.trace = [];
  M.enrichGate = null;
  M.adminCalls = [];
  M.userCredits = [];
  M.inserts = [];
  M.openaiCalls = 0;
  M.commitGate = null;
  M.analyticsThrow = false;
  M.insertThrow = false;
  M.openaiSignals = [];
  M.analyticsGate = null;
  M.prepGate = null;
  M.placesGate = null;
  M.placesFirst = false;
  M.enforceFrom = 0;
  M.enfCalls = 0;
  M.openaiPlan ={ chunks: [AI_JSON.slice(0, 12), AI_JSON.slice(12)], holdAfter: null, holdBefore: null, preamble: [], status: 200 };
  M.waitUntil = [];
  M.failUpstream = null;
  const commitQueue = [...commits];
  const rollbackQueue = [...rollbacks];
  M.adminRpc = async (fn, args) => {
    M.adminCalls.push({ fn, args });
    M.trace.push("rpc:" + fn);
    if (fn === "credits_reserve")
      return reserve ?? { data: { ok: true, idempotent: false, ledger_id: "L-1", status: "reserved" }, error: null };
    if (fn === "credits_commit") {
      if (M.commitGate) await M.commitGate.promise;
      return commitQueue.length ? commitQueue.shift() : { data: { ok: true, status: "committed" }, error: null };
    }
    if (fn === "credits_rollback")
      return rollbackQueue.length ? rollbackQueue.shift() : { data: { ok: true, status: "rolled_back" }, error: null };
    return { data: null, error: { message: "unexpected admin rpc " + fn } };
  };
  M.userClientFactory = () => ({
    auth: { getUser: async () => ({ data: { user: { id: VERIFIED_UID, email: "u@example.test" } }, error: null }) },
    rpc: async (fn) => {
      if (fn === "resolve_user_plus_entitlement") return { data: { has_plus: plus }, error: null };
      M.userCredits.push(fn);
      return { data: null, error: { message: "user client must not settle credits: " + fn } };
    },
    from: (table) => ({
      insert: async (row) => {
        M.inserts.push({ table, row });
        if (M.insertThrow) throw new Error("chat_messages fixture down");
        return { error: null };
      },
    }),
  });
  M.fetchHandler = async (url, init) => {
    if (url !== "https://api.openai.com/v1/chat/completions") return undefined;
    M.openaiCalls += 1;
    M.openaiSignals.push(init.signal ?? null);
    const plan = M.openaiPlan;
    const body = init.body ? JSON.parse(init.body) : {};
    if (plan.status !== 200)
      return new Response(JSON.stringify({ error: { message: "provider down", code: "server_error" } }), {
        status: plan.status,
        headers: { "content-type": "application/json" },
      });
    if (!body.stream)
      return new Response(JSON.stringify({ choices: [{ message: { content: AI_JSON } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const onAbort = () => {
          try {
            controller.error(new DOMException("aborted", "AbortError"));
          } catch {}
        };
        init.signal?.addEventListener("abort", onAbort, { once: true });
        M.failUpstream = () => {
          try {
            controller.error(new TypeError("provider stream reset"));
          } catch {}
        };
        // A' fixtures: keep-alive comments / role-only / empty-content chunks are not content.
        for (const raw of plan.preamble ?? []) {
          controller.enqueue(enc.encode(raw));
          M.trace.push("provider-preamble");
        }
        for (const [i, c] of plan.chunks.entries()) {
          if (init.signal?.aborted) return;
          if (plan.holdBefore === i) {
            M.trace.push("provider-hold-before-" + i);
            await plan.hold.promise;
            if (init.signal?.aborted) return;
          }
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`));
          M.trace.push("provider-delta");
          if (plan.holdAfter === i) {
            await plan.hold.promise;
            if (init.signal?.aborted) return;
          }
          await sleep(1);
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        M.trace.push("provider-done");
        try {
          controller.close();
        } catch {}
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}
const calls = (fn) => M.adminCalls.filter((c) => c.fn === fn);

/** Reads SSE events incrementally into `events`; resolves when the stream ends or errors. */
function readSse(res, events) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const done = (async () => {
    try {
      while (true) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (ev) {
            events.push({ ev, data });
            M.trace.push("client:" + ev);
          }
        }
      }
    } catch (e) {
      events.push({ ev: "__read_error", data: String(e?.message ?? e) });
    }
  })();
  return { reader, done };
}

function roamieRequest({ stream = true, headers = {}, signal, body } = {}) {
  return new Request("https://roamie.tw/api/roamie", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      origin: "https://roamie.tw",
      authorization: "Bearer user-jwt",
      "x-roamie-request-id": "req-" + (seq += 1),
      ...(stream ? {} : { "X-Roamie-Stream": "false" }),
      ...headers,
    },
    body: JSON.stringify(body ?? { mode: "chat", chatInput: "推薦咖啡廳", locale: "zh-TW" }),
  });
}
function chatRequest({ signal, body } = {}) {
  return new Request("https://roamie.tw/api/chat", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      origin: "https://roamie.tw",
      authorization: "Bearer user-jwt",
      "x-roamie-request-id": "chat-" + (seq += 1),
    },
    body: JSON.stringify(body ?? { messages: [{ role: "user", content: "推薦咖啡廳" }], locale: "zh-TW" }),
  });
}
const evNames = (events) => events.map((e) => e.ev);
const assertServiceRoleBound = () => {
  assert.deepEqual(M.userCredits, [], "user JWT client must not run credits RPCs");
  for (const c of M.adminCalls) assert.equal(c.args.p_user_id, VERIFIED_UID, c.fn + " p_user_id");
};

// ===========================================================================
// G. endpoint-guard unit state machine
// ===========================================================================
await check("G1 serverCreditsRpc：client 缺失 → credits_client_missing（不丟錯、零呼叫）；client 丟錯 → error", async () => {
  assert.deepEqual(await guard.serverCreditsRpc("credits_commit", {}, null), {
    data: null,
    error: { message: "credits_client_missing" },
  });
  const r = await guard.serverCreditsRpc("credits_commit", {}, { rpc: async () => { throw new Error("socket hang up"); } });
  assert.equal(r.error.message, "socket hang up");
});

await check("G5 serverCreditsRpc 保留 PostgREST 錯誤的 code（行程診斷 cause.code 依賴它；HEAD 的 context.supabase.rpc 會保留）", async () => {
  const pgError = { message: "fixture rollback unavailable", code: "XX000", details: "d", hint: "h" };
  const r = await guard.serverCreditsRpc("credits_rollback", {}, { rpc: async () => ({ data: null, error: pgError }) });
  assert.equal(r.error?.message, "fixture rollback unavailable");
  assert.equal(r.error?.code, "XX000", "error.code dropped → itinerary diagnostics lose the SQLSTATE");
});

await check("G2 settleServerCredits：只用 creditsClient、帶 p_user_id；ok:false／rpc error／空回應皆為失敗；skipped 零呼叫", async () => {
  const userRpc = [];
  const credRpc = [];
  const mk = (result) => ({
    userId: VERIFIED_UID,
    client: { rpc: async (fn) => (userRpc.push(fn), { data: { ok: true }, error: null }) },
    creditsClient: { rpc: async (fn, args) => (credRpc.push([fn, args]), result) },
  });
  const res = { skipped: false, ledgerId: "L1", idempotencyKey: "K1" };
  assert.deepEqual(await guard.settleServerCredits(mk({ data: { ok: true }, error: null }), res, true), { ok: true });
  assert.deepEqual(
    await guard.settleServerCredits(mk({ data: { ok: false, reason: "not_found" }, error: null }), res, true),
    { ok: false, reason: "not_found" },
  );
  assert.deepEqual(
    await guard.settleServerCredits(mk({ data: null, error: { message: "x" } }), res, true),
    { ok: false, reason: "rpc_error" },
  );
  assert.equal((await guard.settleServerCredits(mk({ data: null, error: null }), res, true)).ok, false);
  assert.deepEqual(credRpc[0], ["credits_commit", { p_ledger_id: "L1", p_idempotency_key: null, p_user_id: VERIFIED_UID }]);
  const n = credRpc.length;
  assert.deepEqual(await guard.settleServerCredits(mk({ data: null, error: null }), { skipped: true }, true), { ok: true });
  assert.equal(credRpc.length, n);
  await guard.settleServerCredits(mk({ data: { ok: true }, error: null }), res, false);
  assert.equal(credRpc.at(-1)[0], "credits_rollback");
  assert.deepEqual(userRpc, [], "auth.client (user JWT) never used for settlement");
  // creditsClient missing → rpc_error without any call
  assert.deepEqual(
    await guard.settleServerCredits({ userId: VERIFIED_UID, client: mk().client }, res, true),
    { ok: false, reason: "rpc_error" },
  );
  assert.deepEqual(userRpc, []);
});

await check("G3 reserveServerCredits：service role＋p_user_id；idempotent → 409 不生成；rpc error → 503", async () => {
  const rpc = [];
  const auth = (result) => ({
    userId: VERIFIED_UID,
    hasPlusAccess: false,
    client: { rpc: async () => { throw new Error("user client used"); } },
    creditsClient: { rpc: async (fn, args) => (rpc.push([fn, args]), result) },
  });
  const req = new Request("https://roamie.tw/x", { headers: { "x-roamie-request-id": "rid-1" } });
  const ok = await guard.reserveServerCredits(auth({ data: { ok: true, ledger_id: "L9" }, error: null }), "PLACE_RECOMMENDATION", req);
  assert.equal(ok.response, null);
  assert.equal(ok.reservation.ledgerId, "L9");
  assert.equal(rpc[0][1].p_user_id, VERIFIED_UID);
  assert.equal(rpc[0][1].p_idempotency_key, `server:${VERIFIED_UID}:PLACE_RECOMMENDATION:rid-1`);
  assert.equal(rpc[0][1].p_metadata.service_managed, undefined, "caller never sends service_managed");
  const dup = await guard.reserveServerCredits(
    auth({ data: { ok: true, idempotent: true, status: "committed" }, error: null }),
    "PLACE_RECOMMENDATION",
    req,
  );
  assert.equal(dup.response.status, 409);
  assert.equal(dup.reservation, null);
  const err = await guard.reserveServerCredits(auth({ data: null, error: { message: "PGRST202" } }), "PLACE_RECOMMENDATION", req);
  assert.equal(err.response.status, 503);
});

await check("G4 createServerCreditSettlement：先 rollback 再 commit → false；先 commit 再 rollback → 不退點；斷線依 providerFinished", async () => {
  const mkAuth = (log, commitResults = []) => ({
    userId: VERIFIED_UID,
    client: {},
    creditsClient: {
      rpc: async (fn) => {
        log.push(fn);
        if (fn === "credits_commit" && commitResults.length) return commitResults.shift();
        return { data: { ok: true }, error: null };
      },
    },
  });
  const res = { skipped: false, ledgerId: "L1", idempotencyKey: "K" };
  let log = [];
  let s = guard.createServerCreditSettlement(mkAuth(log), res);
  assert.equal(await s.settle(false), true);
  assert.equal(await s.settle(true), false, "commit after release must not deliver");
  assert.deepEqual(log, ["credits_rollback"]);
  log = [];
  s = guard.createServerCreditSettlement(mkAuth(log), res);
  assert.equal(await s.settle(true), true);
  assert.equal(await s.settle(false), true);
  assert.equal(await s.settle(true), true);
  assert.deepEqual(log, ["credits_commit"], "no refund after commit; commit once");
  log = [];
  s = guard.createServerCreditSettlement(mkAuth(log, [{ data: null, error: { message: "e1" } }, { data: null, error: { message: "e2" } }]), res);
  assert.equal(await s.settle(true), false);
  assert.deepEqual(log, ["credits_commit", "credits_commit", "credits_rollback"]);
  log = [];
  s = guard.createServerCreditSettlement(mkAuth(log, [{ data: { ok: false, reason: "not_found" }, error: null }]), res);
  assert.equal(await s.settle(true), false);
  assert.deepEqual(log, ["credits_commit"], "ok:false is not retried");
  log = [];
  s = guard.createServerCreditSettlement(mkAuth(log), res);
  s.onClientAbort();
  await sleep(5);
  assert.deepEqual(log, ["credits_rollback"]);
  log = [];
  s = guard.createServerCreditSettlement(mkAuth(log), res);
  s.markProviderFinished();
  s.onClientAbort();
  await sleep(5);
  assert.deepEqual(log, ["credits_commit"]);
});

// ===========================================================================
// R. /api/roamie (real route + real endpoint-guard + real streamRoamieAI)
// ===========================================================================
await check("R1 串流正常：預扣 1、commit 1（commit 卡住時不送 final/done，commit 後才送）、0 rollback；service role＋p_user_id", async () => {
  reset();
  M.commitGate = deferred();
  const res = await ROAMIE_POST({ request: roamieRequest() });
  assert.equal(res.status, 200);
  const events = [];
  const r = readSse(res, events);
  await until(() => calls("credits_commit").length === 1, 3000, "commit call");
  await sleep(60);
  assert.equal(evNames(events).includes("final"), false, "final sent before commit resolved");
  assert.equal(evNames(events).includes("done"), false, "done sent before commit resolved");
  assert.ok(evNames(events).includes("delta"));
  M.commitGate.resolve();
  await r.done;
  assert.deepEqual(evNames(events).slice(-2), ["final", "done"]);
  assert.equal(calls("credits_reserve").length, 1);
  assert.equal(calls("credits_commit").length, 1);
  assert.equal(calls("credits_rollback").length, 0);
  assert.equal(M.openaiCalls, 1);
  assertServiceRoleBound();
  assert.equal(calls("credits_reserve")[0].args.p_idempotency_key.startsWith(`server:${VERIFIED_UID}:`), true);
  assert.equal(M.inserts.filter((i) => i.table === "chat_messages").length, 2);
});

await check("R2 commit 兩次 rpc_error → commit 2 次後 rollback 1 次；送 error(credits_settle_failed)、不送 final/done、不寫聊天紀錄", async () => {
  reset({ commits: [{ data: null, error: { message: "timeout" } }, { data: null, error: { message: "timeout" } }] });
  const res = await ROAMIE_POST({ request: roamieRequest() });
  const events = [];
  await readSse(res, events).done;
  assert.equal(calls("credits_commit").length, 2);
  assert.equal(calls("credits_rollback").length, 1);
  assert.equal(evNames(events).includes("final"), false);
  assert.equal(evNames(events).includes("done"), false);
  const err = events.find((e) => e.ev === "error");
  assert.ok(err && JSON.parse(err.data).code === "credits_settle_failed", JSON.stringify(events));
  assert.equal(M.inserts.length, 0);
  assert.equal(JSON.stringify(events.filter((e) => e.ev !== "delta")).includes("AI result"), false);
  assertServiceRoleBound();
});

await check("R3 commit 第一次 rpc_error、第二次成功 → 交付 final/done，0 rollback", async () => {
  reset({ commits: [{ data: null, error: { message: "timeout" } }] });
  const res = await ROAMIE_POST({ request: roamieRequest() });
  const events = [];
  await readSse(res, events).done;
  assert.equal(calls("credits_commit").length, 2);
  assert.equal(calls("credits_rollback").length, 0);
  assert.deepEqual(evNames(events).slice(-2), ["final", "done"]);
});

await check("R4 commit 回 ok:false（not_found）→ 不重試、不 rollback、不交付", async () => {
  reset({ commits: [{ data: { ok: false, reason: "not_found" }, error: null }] });
  const res = await ROAMIE_POST({ request: roamieRequest() });
  const events = [];
  await readSse(res, events).done;
  assert.equal(calls("credits_commit").length, 1);
  assert.equal(calls("credits_rollback").length, 0);
  assert.equal(evNames(events).includes("final"), false);
  assert.ok(events.some((e) => e.ev === "error"));
});

await check("R5 provider 完成後（enrich 中）斷線＋讀取端 cancel → 照樣 commit 1、0 rollback", async () => {
  reset();
  M.enrichGate = deferred();
  const ac = new AbortController();
  const res = await ROAMIE_POST({ request: roamieRequest({ signal: ac.signal }) });
  const events = [];
  const r = readSse(res, events);
  await until(() => M.trace.includes("enrich-start"), 3000, "enrich start");
  ac.abort();
  await r.reader.cancel().catch(() => {});
  M.enrichGate.resolve();
  await until(() => calls("credits_commit").length + calls("credits_rollback").length > 0, 3000, "settlement");
  await sleep(50);
  assert.equal(calls("credits_commit").length, 1, JSON.stringify(M.trace));
  assert.equal(calls("credits_rollback").length, 0);
  assertServiceRoleBound();
});

await check("R6（A'）provider 串流中途、第一段內容 delta 已送出後斷線＋讀取端 cancel → commit 1、0 rollback；上游 OpenAI 被中止；不寫紀錄", async () => {
  reset();
  M.openaiPlan.holdAfter = 0;
  M.openaiPlan.hold = deferred();
  const ac = new AbortController();
  const res = await ROAMIE_POST({ request: roamieRequest({ signal: ac.signal }) });
  const events = [];
  const r = readSse(res, events);
  await until(() => events.some((e) => e.ev === "delta"), 3000, "first delta");
  ac.abort();
  await r.reader.cancel().catch(() => {});
  M.openaiPlan.hold.resolve();
  await until(() => calls("credits_commit").length > 0, 3000, "commit");
  await sleep(50);
  assert.equal(calls("credits_commit").length, 1);
  assert.equal(calls("credits_rollback").length, 0);
  assert.equal(M.openaiSignals[0]?.aborted, true, "upstream OpenAI signal aborted");
  assert.equal(M.trace.includes("provider-done"), false, "upstream aborted, not streamed to the end");
  assert.equal(M.inserts.length, 0, "chat_messages must not be written for an aborted stream");
  assertServiceRoleBound();
});

await check("R6b（A' 對照組）第一段內容 delta 送出前斷線（provider 已送 keep-alive／role-only／空 content）＋讀取端 cancel → rollback 1、0 commit；上游被中止", async () => {
  reset();
  M.openaiPlan.preamble = [
    ": keep-alive\n\n",
    `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: null } }] })}\n\n`,
  ];
  M.openaiPlan.holdBefore = 0;
  M.openaiPlan.hold = deferred();
  const ac = new AbortController();
  const res = await ROAMIE_POST({ request: roamieRequest({ signal: ac.signal }) });
  const events = [];
  const r = readSse(res, events);
  await until(() => M.trace.includes("provider-hold-before-0"), 3000, "provider holding before first content");
  await sleep(30);
  assert.equal(events.some((e) => e.ev === "delta"), false, "no content delta was sent");
  ac.abort();
  await r.reader.cancel().catch(() => {});
  M.openaiPlan.hold.resolve();
  await until(() => calls("credits_rollback").length > 0, 3000, "rollback");
  await sleep(50);
  assert.equal(calls("credits_rollback").length, 1);
  assert.equal(calls("credits_commit").length, 0);
  assert.equal(M.openaiSignals[0]?.aborted, true, "upstream OpenAI signal aborted");
  assert.equal(M.inserts.length, 0);
  assertServiceRoleBound();
});

await check("R6c（A'）第一段內容送出後 provider 自己出錯（上游串流 error，非客戶端斷線）→ rollback 1、0 commit、送 error 事件", async () => {
  reset();
  M.openaiPlan.holdAfter = 0;
  M.openaiPlan.hold = deferred();
  const res = await ROAMIE_POST({ request: roamieRequest() });
  const events = [];
  const r = readSse(res, events);
  await until(() => events.some((e) => e.ev === "delta"), 3000, "first delta");
  // Provider-side failure: the upstream body errors (not a client abort).
  assert.equal(typeof M.failUpstream, "function");
  M.failUpstream();
  M.openaiPlan.hold.resolve();
  await r.done;
  assert.equal(calls("credits_rollback").length, 1, "provider error after content must refund");
  assert.equal(calls("credits_commit").length, 0);
  assert.equal(evNames(events).at(-1), "error");
  assert.equal(evNames(events).includes("final"), false);
  assert.equal(M.inserts.length, 0);
});

await check("R7 X-Roamie-Cancel → 204；credits RPC 0 次、OpenAI 0 次（串流與非串流皆同）", async () => {
  reset();
  let res = await ROAMIE_POST({ request: roamieRequest({ headers: { "x-roamie-cancel": "true" } }) });
  assert.equal(res.status, 204);
  res = await ROAMIE_POST({ request: roamieRequest({ stream: false, headers: { "x-roamie-cancel": "true" } }) });
  assert.equal(res.status, 204);
  assert.deepEqual(M.adminCalls, []);
  assert.deepEqual(M.userCredits, []);
  assert.equal(M.openaiCalls, 0);
});

await check("R8 provider 回 500 → rollback 1、0 commit（伺服器判定失敗退點不變）", async () => {
  reset();
  M.openaiPlan.status = 500;
  const res = await ROAMIE_POST({ request: roamieRequest() });
  const events = [];
  await readSse(res, events).done;
  assert.equal(calls("credits_rollback").length, 1);
  assert.equal(calls("credits_commit").length, 0);
  assert.ok(events.some((e) => e.ev === "error"));
});

await check("R9 Plus：零 credits RPC，正常交付", async () => {
  reset({ plus: true });
  const res = await ROAMIE_POST({ request: roamieRequest() });
  const events = [];
  await readSse(res, events).done;
  assert.deepEqual(M.adminCalls, []);
  assert.deepEqual(evNames(events).slice(-2), ["final", "done"]);
});

await check("R10 非串流：正常 commit 1 → 200；commit ok:false → 不交付結果、不寫紀錄", async () => {
  reset();
  let res = await ROAMIE_POST({ request: roamieRequest({ stream: false }) });
  assert.equal(res.status, 200);
  assert.equal(calls("credits_commit").length, 1);
  assertServiceRoleBound();
  reset({ commits: [{ data: { ok: false, reason: "not_found" }, error: null }] });
  res = await ROAMIE_POST({ request: roamieRequest({ stream: false }) });
  assert.notEqual(res.status, 200);
  assert.equal((await res.text()).includes("AI result"), false);
  assert.equal(M.inserts.length, 0);
  assert.equal(calls("credits_rollback").length, 0, "rollback after a rejected commit is a no-op by design");
});

await check("R11 預扣回 idempotent（同 request id 重送）→ 409，OpenAI 0 次（不免費重生成）", async () => {
  reset({ reserve: { data: { ok: true, idempotent: true, status: "committed", ledger_id: "L-old" }, error: null } });
  const res = await ROAMIE_POST({ request: roamieRequest() });
  assert.equal(res.status, 409);
  assert.equal(M.openaiCalls, 0);
});

// ===========================================================================
// C. /api/chat
// ===========================================================================
await check("C1 /api/chat 正常：commit 先於 final/done；service role＋p_user_id；寫 2 筆紀錄", async () => {
  reset();
  M.commitGate = deferred();
  const res = await CHAT_POST({ request: chatRequest() });
  assert.equal(res.status, 200);
  const events = [];
  const r = readSse(res, events);
  await until(() => calls("credits_commit").length === 1, 3000, "commit");
  await sleep(60);
  assert.equal(evNames(events).includes("final") || evNames(events).includes("done"), false);
  M.commitGate.resolve();
  await r.done;
  assert.deepEqual(evNames(events).slice(-2), ["final", "done"]);
  assert.equal(calls("credits_reserve").length, 1);
  assert.equal(calls("credits_rollback").length, 0);
  assert.equal(M.inserts.length, 2);
  assertServiceRoleBound();
});

await check("C2 /api/chat commit 兩次 rpc_error → rollback 1、error 事件、不寫紀錄", async () => {
  reset({ commits: [{ data: null, error: { message: "t" } }, { data: null, error: { message: "t" } }] });
  const res = await CHAT_POST({ request: chatRequest() });
  const events = [];
  await readSse(res, events).done;
  assert.equal(calls("credits_commit").length, 2);
  assert.equal(calls("credits_rollback").length, 1);
  assert.equal(evNames(events).includes("final"), false);
  assert.equal(M.inserts.length, 0);
});

await check("C3（A'）/api/chat provider 完成前、第一段內容已送出後斷線（不 cancel 讀取端）→ commit 1、0 rollback；之後 provider 放行也不再 commit、不交付、不寫紀錄", async () => {
  reset();
  M.openaiPlan.holdAfter = 0;
  M.openaiPlan.hold = deferred();
  const ac = new AbortController();
  const res = await CHAT_POST({ request: chatRequest({ signal: ac.signal }) });
  const events = [];
  const r = readSse(res, events);
  await until(() => events.some((e) => e.ev === "delta"), 3000, "delta");
  ac.abort();
  await until(() => calls("credits_commit").length === 1, 3000, "commit");
  M.openaiPlan.hold.resolve();
  await r.done;
  await sleep(30);
  assert.equal(calls("credits_commit").length, 1);
  assert.equal(calls("credits_rollback").length, 0);
  assert.equal(evNames(events).includes("final"), false);
  assert.equal(evNames(events).includes("done"), false);
  assert.equal(M.inserts.length, 0);
  assertServiceRoleBound();
});

await check("C3b（A' 對照組）/api/chat 第一段內容送出前斷線（只送過 keep-alive／role-only）→ rollback 1、0 commit、不交付", async () => {
  reset();
  M.openaiPlan.preamble = [
    ": keep-alive\n\n",
    `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" } }] })}\n\n`,
  ];
  M.openaiPlan.holdBefore = 0;
  M.openaiPlan.hold = deferred();
  const ac = new AbortController();
  const res = await CHAT_POST({ request: chatRequest({ signal: ac.signal }) });
  const events = [];
  const r = readSse(res, events);
  await until(() => M.trace.includes("provider-hold-before-0"), 3000, "hold before first content");
  await sleep(30);
  assert.equal(events.some((e) => e.ev === "delta"), false);
  ac.abort();
  await until(() => calls("credits_rollback").length === 1, 3000, "rollback");
  M.openaiPlan.hold.resolve();
  await r.done;
  await sleep(30);
  assert.equal(calls("credits_commit").length, 0);
  assert.equal(calls("credits_rollback").length, 1);
  assert.equal(M.openaiSignals[0]?.aborted, true, "upstream aborted");
  assert.equal(evNames(events).includes("final"), false);
  assert.equal(M.inserts.length, 0);
});

await check("C4 /api/chat provider 完成後斷線 → commit 1、0 rollback", async () => {
  reset();
  M.enrichGate = deferred();
  const ac = new AbortController();
  const res = await CHAT_POST({ request: chatRequest({ signal: ac.signal }) });
  const events = [];
  const r = readSse(res, events);
  await until(() => M.trace.includes("enrich-start"), 3000, "enrich");
  ac.abort();
  await r.reader.cancel().catch(() => {});
  M.enrichGate.resolve();
  await until(() => calls("credits_commit").length > 0, 3000, "commit");
  await sleep(50);
  assert.equal(calls("credits_commit").length, 1);
  assert.equal(calls("credits_rollback").length, 0);
});

// ===========================================================================
// T. 任務單 #8（第 3 次獨立複審）補齊的情境
// ===========================================================================
await check("C5（A'）/api/chat provider 完成前、第一段內容已送出後斷線（provider 卡住、不再放行）→ 上游 fetch 的 signal 被 abort、commit 1、0 rollback、不交付", async () => {
  reset();
  M.openaiPlan.holdAfter = 0;
  M.openaiPlan.hold = deferred();
  const ac = new AbortController();
  const res = await CHAT_POST({ request: chatRequest({ signal: ac.signal }) });
  const events = [];
  const r = readSse(res, events);
  try {
    await until(() => events.some((e) => e.ev === "delta"), 3000, "delta");
    assert.equal(M.openaiSignals.length, 1, "exactly one upstream call");
    assert.ok(M.openaiSignals[0], "upstream fetch must carry an AbortSignal");
    assert.equal(M.openaiSignals[0].aborted, false, "not aborted before the disconnect");
    ac.abort();
    // The provider is never released: only an upstream abort can end this stream.
    await until(() => M.openaiSignals[0].aborted === true, 1500, "upstream abort (signal not forwarded to OpenAI)");
    await until(() => calls("credits_commit").length === 1, 1500, "commit");
    await Promise.race([r.done, sleep(1500).then(() => { throw new Error("stream did not end after upstream abort"); })]);
    assert.equal(calls("credits_commit").length, 1);
    assert.equal(calls("credits_rollback").length, 0);
    assert.equal(M.trace.includes("provider-done"), false, "provider must not run to completion");
    assert.equal(evNames(events).includes("final"), false);
    assert.equal(evNames(events).includes("done"), false);
    assert.equal(M.inserts.length, 0);
    assertServiceRoleBound();
  } finally {
    M.openaiPlan.hold.resolve();
    await r.reader.cancel().catch(() => {});
  }
});

await check("R12 非串流：commit 成功後 analytics 丟例外 → 仍回 200 並交付結果；commit 1、0 rollback", async () => {
  reset();
  M.analyticsThrow = true;
  const res = await ROAMIE_POST({ request: roamieRequest({ stream: false }) });
  const body = await res.text();
  assert.equal(res.status, 200, body.slice(0, 200));
  assert.equal(JSON.parse(body).data?.summary, "AI result");
  assert.ok(M.analytics.length >= 1, "analytics was attempted");
  assert.equal(calls("credits_commit").length, 1);
  assert.equal(calls("credits_rollback").length, 0);
  assertServiceRoleBound();
});

await check("R13 非串流：commit 成功後 chat_messages 寫入丟例外 → 仍回 200 並交付結果；0 rollback", async () => {
  reset();
  M.insertThrow = true;
  const res = await ROAMIE_POST({ request: roamieRequest({ stream: false }) });
  const body = await res.text();
  assert.equal(res.status, 200, body.slice(0, 200));
  assert.equal(JSON.parse(body).data?.summary, "AI result");
  assert.equal(M.inserts.length, 1, "first insert attempted");
  assert.equal(calls("credits_commit").length, 1);
  assert.equal(calls("credits_rollback").length, 0);
});

await check("R14 串流：commit 成功後 analytics 丟例外 → 仍送 final/done；0 rollback", async () => {
  reset();
  M.analyticsThrow = true;
  const res = await ROAMIE_POST({ request: roamieRequest() });
  const events = [];
  await readSse(res, events).done;
  assert.deepEqual(evNames(events).slice(-2), ["final", "done"]);
  assert.equal(calls("credits_commit").length, 1);
  assert.equal(calls("credits_rollback").length, 0);
});

await check("C6 /api/chat：commit 成功後 chat_messages 寫入丟例外 → 仍送 final/done；0 rollback", async () => {
  reset();
  M.insertThrow = true;
  const res = await CHAT_POST({ request: chatRequest() });
  const events = [];
  await readSse(res, events).done;
  assert.deepEqual(evNames(events).slice(-2), ["final", "done"]);
  assert.equal(calls("credits_commit").length, 1);
  assert.equal(calls("credits_rollback").length, 0);
});

await check("R15 非串流 provider 完成前斷線 → rollback 1、之後不 commit、不交付（觀察：上游是否被中止另行輸出）", async () => {
  reset();
  const gate = deferred();
  const prev = M.fetchHandler;
  M.fetchHandler = async (url, init, input) => {
    if (url === "https://api.openai.com/v1/chat/completions") await gate.promise;
    return prev(url, init, input);
  };
  const ac = new AbortController();
  let entered = false;
  const prevGate = M.fetchHandler;
  M.fetchHandler = async (url, init, input) => {
    if (url === "https://api.openai.com/v1/chat/completions") entered = true;
    return prevGate(url, init, input);
  };
  const pending = ROAMIE_POST({ request: roamieRequest({ stream: false, signal: ac.signal }) });
  await until(() => entered, 1500, "provider call started");
  ac.abort();
  await until(() => calls("credits_rollback").length === 1, 1500, "rollback on disconnect");
  gate.resolve();
  const res = await pending;
  const body = await res.text();
  assert.notEqual(res.status, 200);
  assert.equal(body.includes("AI result"), false, "result withheld after refund");
  assert.equal(calls("credits_commit").length, 0, "no commit after refund");
  assert.equal(M.inserts.length, 0);
  out("     observe: non-stream upstream signal present=" + Boolean(M.openaiSignals[0]) + " aborted=" + Boolean(M.openaiSignals[0]?.aborted));
});

for (const [label, POST, mkReq] of [
  ["R16 /api/roamie", () => ROAMIE_POST, (signal) => roamieRequest({ signal })],
  ["C7 /api/chat", () => CHAT_POST, (signal) => chatRequest({ signal })],
]) {
  await check(label + " 串流：在預扣 RPC 進行中斷線（provider 尚未開始）→ 退點、不呼叫或中止上游、不 commit", async () => {
    reset();
    const reserveGate = deferred();
    let reserveEntered = false;
    const base = M.adminRpc;
    M.adminRpc = async (fn, args) => {
      if (fn === "credits_reserve") {
        reserveEntered = true;
        await reserveGate.promise;
      }
      return base(fn, args);
    };
    const ac = new AbortController();
    const pending = POST()({ request: mkReq(ac.signal) });
    await until(() => reserveEntered, 1500, "reserve started");
    ac.abort();
    reserveGate.resolve();
    const res = await pending;
    if (res.body) {
      const events = [];
      const r = readSse(res, events);
      await Promise.race([r.done, sleep(1500)]);
      await r.reader.cancel().catch(() => {});
    }
    await sleep(50);
    const upstreamRan = M.openaiCalls > 0 && !M.openaiSignals.some((s) => s?.aborted);
    assert.equal(calls("credits_commit").length, 0, "charged although the client left before generation started; trace=" + M.trace.join(","));
    assert.equal(calls("credits_rollback").length, 1, "reservation not released");
    assert.equal(upstreamRan, false, "upstream generation ran to completion for a disconnected client");
  });
}

// ===========================================================================
// D. 任務單 #10（第 4 次獨立複審）：斷線時機（預扣中／analytics 中／準備中／provider 中／provider 後）
// ===========================================================================
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const abortError = () => new DOMException("aborted", "AbortError");
/**
 * Real fetch semantics for the OpenAI mock: a pre-aborted signal rejects without any
 * request (counted separately), and a pending call rejects as soon as its signal aborts.
 * `gate` (optional) holds the call open until released or aborted.
 */
function realisticOpenAiFetch({ gate = null } = {}) {
  const prev = M.fetchHandler;
  const seen = { preAborted: 0, entered: 0, signals: [] };
  M.fetchHandler = async (url, init, input) => {
    if (url !== OPENAI_URL) return prev(url, init, input);
    if (init.signal?.aborted) {
      seen.preAborted += 1;
      M.trace.push("openai-pre-aborted");
      throw abortError();
    }
    seen.entered += 1;
    seen.signals.push(init.signal ?? null);
    if (gate) {
      await new Promise((res, rej) => {
        gate.promise.then(res);
        init.signal?.addEventListener("abort", () => rej(abortError()), { once: true });
      });
    }
    return prev(url, init, input);
  };
  return seen;
}
async function drain(res, ms = 1500) {
  const events = [];
  if (res.body && (res.headers.get("content-type") ?? "").includes("event-stream")) {
    const r = readSse(res, events);
    await Promise.race([r.done, sleep(ms)]);
    await r.reader.cancel().catch(() => {});
  } else {
    events.push({ ev: "__body", data: await res.text() });
  }
  return events;
}
const assertNoChargeNoDelivery = (events, label) => {
  assert.equal(calls("credits_commit").length, 0, label + ": no commit; trace=" + M.trace.join(","));
  assert.equal(calls("credits_rollback").length, 1, label + ": exactly one rollback");
  assert.equal(M.inserts.length, 0, label + ": no chat_messages rows");
  assert.equal(evNames(events).includes("final") || evNames(events).includes("done"), false, label + ": no final/done");
  assert.equal(events.some((e) => String(e.data ?? "").includes("AI result")), false, label + ": result not delivered");
  assertServiceRoleBound();
};

await check("D1 /api/roamie 非串流：預扣 RPC 進行中斷線 → 499、rollback 1、0 commit、OpenAI 0、不寫紀錄", async () => {
  reset();
  const seen = realisticOpenAiFetch();
  const reserveGate = deferred();
  let reserveEntered = false;
  const base = M.adminRpc;
  M.adminRpc = async (fn, args) => {
    if (fn === "credits_reserve") {
      reserveEntered = true;
      await reserveGate.promise;
    }
    return base(fn, args);
  };
  const ac = new AbortController();
  const pending = ROAMIE_POST({ request: roamieRequest({ stream: false, signal: ac.signal }) });
  await until(() => reserveEntered, 1500, "reserve started");
  ac.abort();
  reserveGate.resolve();
  const res = await pending;
  assert.equal(res.status, 499);
  const events = await drain(res);
  await sleep(50);
  assert.equal(seen.entered + seen.preAborted, 0, "OpenAI must not even be attempted");
  assert.equal(M.openaiCalls, 0);
  assertNoChargeNoDelivery(events, "D1");
});

await check("D2 /api/roamie 非串流：provider 進行中斷線 → 上游 fetch signal 被 abort（不必等 provider）、rollback 1、0 commit、不交付", async () => {
  reset();
  const gate = deferred();
  const seen = realisticOpenAiFetch({ gate });
  const ac = new AbortController();
  const pending = ROAMIE_POST({ request: roamieRequest({ stream: false, signal: ac.signal }) });
  try {
    await until(() => seen.entered === 1, 1500, "provider call started");
    assert.ok(seen.signals[0], "non-stream OpenAI fetch must carry an AbortSignal");
    assert.equal(seen.signals[0].aborted, false, "not aborted before the disconnect");
    ac.abort();
    // gate is never released: only the upstream abort can end the handler.
    const res = await Promise.race([pending, sleep(1500).then(() => { throw new Error("handler did not end after disconnect (upstream not aborted)"); })]);
    assert.equal(seen.signals[0].aborted, true, "upstream OpenAI request aborted");
    assert.notEqual(res.status, 200);
    const events = await drain(res);
    await sleep(50);
    assert.equal(M.openaiCalls, 0, "provider never produced a response");
    assertNoChargeNoDelivery(events, "D2");
  } finally {
    gate.resolve();
  }
});

for (const stream of [true, false]) {
  await check(`D3 /api/roamie itinerary ${stream ? "串流" : "非串流"}：analytics(started) await 期間斷線 → 499、rollback 1、OpenAI 0、0 commit、不寫紀錄`, async () => {
    reset();
    const seen = realisticOpenAiFetch();
    M.analyticsGate = deferred();
    const ac = new AbortController();
    const pending = ROAMIE_POST({
      request: roamieRequest({
        stream,
        signal: ac.signal,
        body: { mode: "itinerary", locale: "zh-TW", itineraryRequest: { destination: "台北", days: 1 } },
      }),
    });
    await until(() => M.trace.includes("analytics-started-gate"), 1500, "analytics started");
    assert.equal(calls("credits_reserve").length, 1, "reserved before analytics");
    ac.abort();
    M.analyticsGate.resolve();
    const res = await pending;
    assert.equal(res.status, 499);
    const events = await drain(res);
    await sleep(50);
    assert.equal(seen.entered + seen.preAborted, 0, "OpenAI must not even be attempted");
    assertNoChargeNoDelivery(events, "D3");
    assert.equal(M.analytics.includes("itinerary_generation_succeeded"), false);
  });
}

for (const stream of [true, false]) {
  await check(`D4 /api/roamie ${stream ? "串流" : "非串流"}：Places 準備期間斷線 → rollback 1、上游不發出（pre-aborted）、0 commit、不交付、不寫紀錄`, async () => {
    reset();
    M.placesFirst = true;
    M.placesGate = deferred();
    const seen = realisticOpenAiFetch();
    const ac = new AbortController();
    const pending = ROAMIE_POST({
      request: roamieRequest({
        stream,
        signal: ac.signal,
        body: { mode: "chat", chatInput: "推薦咖啡廳", locale: "zh-TW", conversationStage: "recommend" },
      }),
    });
    let res;
    if (stream) {
      res = await pending;
      assert.equal(res.status, 200);
    }
    await until(() => M.trace.includes("places-prep-start"), 1500, "places prep started");
    ac.abort();
    await until(() => calls("credits_rollback").length === 1, 1500, "rollback on disconnect");
    M.placesGate.resolve();
    if (!stream) res = await pending;
    const events = await drain(res);
    await sleep(50);
    assert.equal(seen.entered, 0, "no OpenAI request may go out after the disconnect");
    assert.equal(M.openaiCalls, 0);
    assertNoChargeNoDelivery(events, "D4");
  });
}

for (const [label, POST, mkReq] of [
  ["D5 /api/chat", () => CHAT_POST, (signal) => chatRequest({ signal })],
  ["D5 /api/roamie", () => ROAMIE_POST, (signal) => roamieRequest({ signal })],
]) {
  await check(label + " 串流：provider 前的準備 await（enforceModelCall）期間斷線 → rollback 1、上游不發出、0 commit、不交付、不寫紀錄", async () => {
    reset();
    M.enforceFrom = 2;
    M.prepGate = deferred();
    const seen = realisticOpenAiFetch();
    const ac = new AbortController();
    const res = await POST()({ request: mkReq(ac.signal) });
    assert.equal(res.status, 200);
    await until(() => M.trace.includes("prep-gate"), 1500, "pre-provider await reached");
    assert.equal(calls("credits_reserve").length, 1);
    ac.abort();
    await until(() => calls("credits_rollback").length === 1, 1500, "rollback on disconnect");
    M.prepGate.resolve();
    const events = await drain(res);
    await sleep(50);
    assert.equal(seen.entered, 0, "no OpenAI request may go out after the disconnect");
    assertNoChargeNoDelivery(events, label);
  });
}

for (const [label, POST, mkReq] of [
  ["D6 /api/roamie 串流", () => ROAMIE_POST, (signal) => roamieRequest({ signal })],
  ["D6 /api/roamie 非串流", () => ROAMIE_POST, (signal) => roamieRequest({ stream: false, signal })],
  ["D6 /api/chat", () => CHAT_POST, (signal) => chatRequest({ signal })],
]) {
  await check(label + "：預扣中斷線 → 499 之後不寫入 chat_messages、不 commit、不 analytics（多等 200ms）", async () => {
    reset();
    realisticOpenAiFetch();
    const reserveGate = deferred();
    let reserveEntered = false;
    const base = M.adminRpc;
    M.adminRpc = async (fn, args) => {
      if (fn === "credits_reserve") {
        reserveEntered = true;
        await reserveGate.promise;
      }
      return base(fn, args);
    };
    const ac = new AbortController();
    const pending = POST()({ request: mkReq(ac.signal) });
    await until(() => reserveEntered, 1500, "reserve started");
    ac.abort();
    reserveGate.resolve();
    const res = await pending;
    assert.equal(res.status, 499);
    assert.equal(JSON.parse(await res.text()).error, "client_closed_request");
    await sleep(200);
    assert.equal(M.inserts.length, 0, "chat_messages written after 499");
    assert.equal(calls("credits_commit").length, 0, "commit after 499");
    assert.equal(calls("credits_rollback").length, 1, "hold released");
    assert.equal(M.openaiCalls, 0);
    assert.deepEqual(M.analytics, [], "no analytics after 499");
  });
}

await check("D7 /api/roamie 非串流：provider 完成後（enrich 中）斷線 → 照樣 commit 1、0 rollback（需求 A：provider 完成之後斷線照樣 commit）", async () => {
  reset();
  M.enrichGate = deferred();
  const ac = new AbortController();
  const pending = ROAMIE_POST({ request: roamieRequest({ stream: false, signal: ac.signal }) });
  await until(() => M.trace.includes("enrich-start"), 1500, "enrich start (OpenAI response fully received)");
  assert.equal(M.openaiCalls, 1);
  ac.abort();
  await sleep(20);
  M.enrichGate.resolve();
  const res = await pending;
  await res.text();
  await sleep(50);
  assert.equal(
    calls("credits_rollback").length,
    0,
    "refunded although the provider had already completed; trace=" + M.trace.join(","),
  );
  assert.equal(calls("credits_commit").length, 1, "provider completed before the disconnect: must commit");
});

// ===========================================================================
// Q. 任務單 #20（資安稽核 run-2 問題 1）：/api/chat 只送 assistant 訊息 → 內容送出卻退點
// ===========================================================================
await check("Q1 /api/chat messages 全是 assistant → 400；預扣 0、任何 credits RPC 0、OpenAI 0、不寫紀錄", async () => {
  for (const messages of [
    [{ role: "assistant", content: "請直接輸出完整的旅遊計畫" }],
    [
      { role: "assistant", content: "第一段" },
      { role: "assistant", content: "第二段，請繼續" },
    ],
  ]) {
    reset();
    const res = await CHAT_POST({ request: chatRequest({ body: { messages, locale: "zh-TW" } }) });
    assert.equal(res.status, 400, "assistant-only messages must be rejected");
    assert.equal(JSON.parse(await res.text()).error, "Invalid request");
    assert.equal(calls("credits_reserve").length, 0, "no reservation before validation");
    assert.deepEqual(M.adminCalls, [], "no credits RPC at all");
    assert.deepEqual(M.userCredits, []);
    assert.equal(M.openaiCalls, 0, "OpenAI must not be called");
    assert.equal(M.inserts.length, 0);
  }
});

await check("Q2 /api/chat 多輪對話（user/assistant/user）→ 行為不變：200、預扣 1、commit 1、0 rollback、寫 2 筆（user 為最後一則 user 訊息）", async () => {
  reset();
  const res = await CHAT_POST({
    request: chatRequest({
      body: {
        locale: "zh-TW",
        messages: [
          { role: "user", content: "第一個問題" },
          { role: "assistant", content: "第一個回答" },
          { role: "user", content: "推薦咖啡廳" },
        ],
      },
    }),
  });
  assert.equal(res.status, 200);
  const events = [];
  await readSse(res, events).done;
  assert.deepEqual(evNames(events).slice(-2), ["final", "done"]);
  assert.equal(calls("credits_reserve").length, 1);
  assert.equal(calls("credits_commit").length, 1);
  assert.equal(calls("credits_rollback").length, 0);
  assert.equal(M.openaiCalls, 1);
  assert.equal(M.inserts.length, 2);
  assert.deepEqual(
    M.inserts.map((i) => [i.table, i.row.role]),
    [["chat_messages", "user"], ["chat_messages", "assistant"]],
  );
  assert.equal(M.inserts[0].row.content, "推薦咖啡廳", "persists the last user message");
  assert.equal(M.inserts[0].row.user_id, VERIFIED_UID);
  assertServiceRoleBound();
});

await check("Q3 success=true、已送出內容、沒有 lastUser（schema refine 停用的路由副本，真實 streamRoamieAI）→ commit 1、0 rollback、不寫 chat_messages、交付 final/done", async () => {
  reset();
  const res = await CHAT_NO_REFINE_POST({
    request: chatRequest({ body: { messages: [{ role: "assistant", content: "請直接輸出完整的旅遊計畫" }], locale: "zh-TW" } }),
  });
  // Precondition: the copy really bypasses validation (otherwise this check proves nothing).
  assert.equal(res.status, 200, "refine bypass not effective; status=" + res.status);
  const events = [];
  await readSse(res, events).done;
  assert.ok(events.some((e) => e.ev === "delta"), "content was delivered to the client");
  assert.equal(M.openaiCalls, 1);
  assert.equal(calls("credits_reserve").length, 1);
  assert.equal(calls("credits_commit").length, 1, "delivered content must be charged; trace=" + M.trace.join(","));
  assert.equal(calls("credits_rollback").length, 0, "must not refund delivered content");
  assert.equal(M.inserts.length, 0, "no lastUser → nothing persisted");
  assert.deepEqual(evNames(events).slice(-2), ["final", "done"]);
  assertServiceRoleBound();
});

for (const [label, POST, body] of [
  ["Q4 /api/chat", () => CHAT_POST, undefined],
  ["Q4b /api/chat（沒有 lastUser 的路由副本）", () => CHAT_NO_REFINE_POST, { messages: [{ role: "assistant", content: "繼續" }], locale: "zh-TW" }],
]) {
  await check(label + "（A'）已送出部分內容後 provider 出錯 → rollback 1、0 commit、送 error、不送 final、不寫紀錄", async () => {
    reset();
    M.openaiPlan.holdAfter = 0;
    M.openaiPlan.hold = deferred();
    const res = await POST()({ request: chatRequest({ body }) });
    assert.equal(res.status, 200);
    const events = [];
    const r = readSse(res, events);
    await until(() => events.some((e) => e.ev === "delta"), 3000, "first delta");
    assert.equal(typeof M.failUpstream, "function");
    M.failUpstream();
    M.openaiPlan.hold.resolve();
    await r.done;
    assert.equal(calls("credits_rollback").length, 1, "provider error after partial content must refund");
    assert.equal(calls("credits_commit").length, 0);
    assert.equal(evNames(events).at(-1), "error");
    assert.equal(evNames(events).includes("final"), false);
    assert.equal(M.inserts.length, 0);
    assertServiceRoleBound();
  });
}

await check("NET 全程沒有任何非 mock 的網路請求", () => {
  assert.deepEqual(NET_BLOCKED, []);
});

Object.assign(console, quiet);
fs.rmSync(tmp, { recursive: true, force: true });
out(`\n${passCount} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) out("  FAILED: " + f);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
