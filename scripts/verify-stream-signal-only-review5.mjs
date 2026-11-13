// verify-stream-signal-only-review5.mjs — 任務單 #12（第 5 次獨立複審）：只有 request.signal abort、
// 沒有 ReadableStream cancel 的斷線（workerd issue #6832 回歸情境）＋ wrangler enable_request_signal 旗標。
//
// 以 esbuild 打包「真實」 /api/roamie、/api/chat、endpoint-guard.server、service.server（streamRoamieAI），
// 只 mock 外部邊界（supabase、OpenAI 全域 fetch、analytics、abuse-guard、Places 準備）。
// 斷線方式：只呼叫 AbortController.abort()，**從不** reader.cancel()，讀取端持續讀到串流結束，
// 證明退點／停止上游／commit 判斷不依賴 stream cancel。
// 網路：全域 fetch／http(s)／net／tls 一律攔截；非 mock 的請求 → FAIL。清除金鑰類環境變數。不讀 .env。
//
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=180 scripts/verify-stream-signal-only-review5.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

for (const k of Object.keys(process.env)) {
  if (/SUPABASE|OPENAI|GOOGLE_|SERVICE_ROLE|REVENUECAT|STRIPE|UNSPLASH|SECRET/i.test(k)) delete process.env[k];
}
const NET_BLOCKED = [];
globalThis.__m = {};
const M = globalThis.__m;
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
let passCount = 0;
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
const quiet = { info: console.info, error: console.error, warn: console.warn };
const silenceConsole = () => {
  console.info = () => {};
  console.error = () => {};
  console.warn = () => {};
};

// ---------------------------------------------------------------------------
// W. wrangler.jsonc flag (static; no build)
// ---------------------------------------------------------------------------
await check("W1 wrangler.jsonc：compatibility_flags 含 enable_request_signal 與 nodejs_compat；compatibility_date 早於 2026-11-17（需手動開）", () => {
  const text = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
  const flags = /"compatibility_flags"\s*:\s*\[([^\]]*)\]/.exec(text)?.[1] ?? "";
  const list = [...flags.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(list.includes("enable_request_signal"), "enable_request_signal missing: " + list.join(","));
  assert.ok(list.includes("nodejs_compat"), "nodejs_compat missing");
  assert.ok(!list.includes("no_enable_request_signal"), "conflicting no_enable_request_signal");
  const date = /"compatibility_date"\s*:\s*"([^"]+)"/.exec(text)?.[1];
  assert.ok(date && date < "2026-11-17", "compatibility_date " + date);
});

await check("W2 service.server：串流與非串流 OpenAI fetch 都明確帶 signal（旗標不會自動傳給子請求）", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/ai/service.server.ts"), "utf8");
  const fetches = [...src.matchAll(/await fetch\("https:\/\/api\.openai\.com\/v1\/chat\/completions",\s*\{([\s\S]*?)\n\s{4,8}\}\);/g)];
  assert.equal(fetches.length, 2, "expected 2 OpenAI fetch sites, got " + fetches.length);
  for (const f of fetches) assert.match(f[1], /\bsignal:\s*(options\?\.signal|upstreamAbort\.signal)/);
});

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------
const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-sig-only-"));
fs.symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"), "dir");
let seq = 0;
async function buildBundle(entry, mocks) {
  const outFile = path.join(tmp, `s${(seq += 1)}.mjs`);
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
        name: "sig-mocks",
        setup(b) {
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
  "@/lib/analytics/record.server": `export const recordAnalyticsEventServer = async (e) => { globalThis.__m.analytics.push(e.eventName); };`,
  "@/lib/abuse-guard-telemetry.server": `
    export const aiObservation = () => ({});
    export const observeCredit = () => {};
    export const observeCreditReserveAttempt = () => {};
    export const observeProviderAttempt = () => () => {};
    export const observeGuardRejection = () => {};`,
  "@/lib/abuse-guard.server": `export const authorizeAiUse = async () => null;
    export const assertAiUse = async () => {
      if (globalThis.__m.prepGate) { globalThis.__m.trace.push("prep-gate"); await globalThis.__m.prepGate.promise; }
    };`,
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
  "./prompts": `export const buildSystemPrompt = () => "system"; export const buildUserMessage = () => "user";`,
  "@/lib/ai/conversation-stage": `export const stageAllowsPlacesFirst = () => Boolean(globalThis.__m.placesFirst); export const mergeBoundsForStage = () => ({});`,
  "@/lib/access/context": `export const applyTierToAiContext = (ctx) => ctx;`,
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

let roamieFile, chatFile;
try {
  roamieFile = await buildBundle("src/routes/api/roamie.ts", MOCKS);
  chatFile = await buildBundle("src/routes/api/chat.ts", MOCKS);
} catch (e) {
  out("INFRA-FAIL bundle: " + (e?.errors ?? []).map((x) => x.text).join("\n  ") + "\n" + String(e?.message ?? e).slice(0, 1500));
  process.exit(1);
}
installSocketTraps();
silenceConsole();
const roamie = await import(pathToFileURL(roamieFile).href);
const chat = await import(pathToFileURL(chatFile).href);
const ROAMIE_POST = roamie.Route.server.handlers.POST;
const CHAT_POST = chat.Route.server.handlers.POST;

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

function reset() {
  M.analytics = [];
  M.trace = [];
  M.enrichGate = null;
  M.adminCalls = [];
  M.userCredits = [];
  M.inserts = [];
  M.openaiCalls = 0;
  M.openaiPreAborted = 0;
  M.commitGate = null;
  M.openaiSignals = [];
  M.prepGate = null;
  M.placesGate = null;
  M.placesFirst = false;
  M.enforceFrom = 0;
  M.enfCalls = 0;
  M.openaiPlan = { chunks: [AI_JSON.slice(0, 12), AI_JSON.slice(12)], holdAfter: null, holdBefore: null, preamble: [] };
  M.adminRpc = async (fn, args) => {
    M.adminCalls.push({ fn, args });
    M.trace.push("rpc:" + fn);
    if (fn === "credits_reserve") return { data: { ok: true, idempotent: false, ledger_id: "L-1", status: "reserved" }, error: null };
    if (fn === "credits_commit") {
      if (M.commitGate) await M.commitGate.promise;
      return { data: { ok: true, status: "committed" }, error: null };
    }
    if (fn === "credits_rollback") return { data: { ok: true, status: "rolled_back" }, error: null };
    return { data: null, error: { message: "unexpected admin rpc " + fn } };
  };
  M.userClientFactory = () => ({
    auth: { getUser: async () => ({ data: { user: { id: VERIFIED_UID, email: "u@example.test" } }, error: null }) },
    rpc: async (fn) => {
      if (fn === "resolve_user_plus_entitlement") return { data: { has_plus: false }, error: null };
      M.userCredits.push(fn);
      return { data: null, error: { message: "user client must not settle credits: " + fn } };
    },
    from: (table) => ({
      insert: async (row) => {
        M.inserts.push({ table, row });
        return { error: null };
      },
    }),
  });
  M.fetchHandler = async (url, init) => {
    if (url !== "https://api.openai.com/v1/chat/completions") return undefined;
    M.openaiCalls += 1;
    M.openaiSignals.push(init.signal ?? null);
    // Real fetch rejects synchronously for a pre-aborted signal: nothing is sent upstream.
    if (init.signal?.aborted) {
      M.openaiPreAborted += 1;
      throw new DOMException("aborted", "AbortError");
    }
    const plan = M.openaiPlan;
    const body = init.body ? JSON.parse(init.body) : {};
    if (!body.stream)
      return new Response(JSON.stringify({ choices: [{ message: { content: AI_JSON } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        init.signal?.addEventListener(
          "abort",
          () => {
            M.trace.push("provider-aborted");
            try {
              controller.error(new DOMException("aborted", "AbortError"));
            } catch {}
          },
          { once: true },
        );
        // A' fixtures: keep-alive comments / role-only / empty-content chunks are not content.
        for (const raw of plan.preamble ?? []) controller.enqueue(enc.encode(raw));
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

/** Reads every SSE event until the server closes the stream. Never cancels the body. */
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
          if (ev) events.push({ ev, data });
        }
      }
    } catch (e) {
      events.push({ ev: "__read_error", data: String(e?.message ?? e) });
    }
  })();
  return { done };
}
const withTimeout = (p, ms, label) =>
  Promise.race([p, sleep(ms).then(() => { throw new Error("timeout: " + label); })]);

function roamieRequest({ signal, body } = {}) {
  return new Request("https://roamie.tw/api/roamie", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      origin: "https://roamie.tw",
      authorization: "Bearer user-jwt",
      "x-roamie-request-id": "sig-" + (seq += 1),
    },
    body: JSON.stringify(body ?? { mode: "chat", chatInput: "推薦咖啡廳", locale: "zh-TW" }),
  });
}
function chatRequest({ signal } = {}) {
  return new Request("https://roamie.tw/api/chat", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      origin: "https://roamie.tw",
      authorization: "Bearer user-jwt",
      "x-roamie-request-id": "sigchat-" + (seq += 1),
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "推薦咖啡廳" }], locale: "zh-TW" }),
  });
}
const evNames = (events) => events.map((e) => e.ev);
const assertServiceRoleBound = () => {
  assert.deepEqual(M.userCredits, [], "user JWT client must not run credits RPCs");
  for (const c of M.adminCalls) assert.equal(c.args.p_user_id, VERIFIED_UID, c.fn + " p_user_id");
};

for (const [label, POST, mkReq] of [
  ["/api/roamie", ROAMIE_POST, roamieRequest],
  ["/api/chat", CHAT_POST, chatRequest],
]) {
  await check(`S1（A'）${label} 串流：第一段內容 delta 送出後 provider 串流中途「只有 signal abort、不 cancel」→ commit 1、0 rollback、上游 signal 被 abort、不送 final/done、不寫紀錄、串流仍會結束`, async () => {
    reset();
    M.openaiPlan.holdAfter = 0;
    M.openaiPlan.hold = deferred();
    const ac = new AbortController();
    const res = await POST({ request: mkReq({ signal: ac.signal }) });
    assert.equal(res.status, 200);
    const events = [];
    const r = readSse(res, events);
    await until(() => events.some((e) => e.ev === "delta"), 2000, "first delta");
    ac.abort();
    await withTimeout(r.done, 3000, "stream must end without a body cancel");
    // Settlement done before the stream ended (no post-close fire-and-forget).
    assert.equal(calls("credits_commit").length, 1, "commit must have run before the stream ended");
    await sleep(30);
    M.openaiPlan.hold.resolve();
    await sleep(30);
    assert.equal(calls("credits_commit").length, 1, "commit count");
    assert.equal(calls("credits_rollback").length, 0, "rollback count");
    assert.equal(M.openaiSignals[0]?.aborted, true, "upstream OpenAI signal aborted");
    assert.ok(M.trace.includes("provider-aborted"), "provider stream aborted");
    assert.equal(evNames(events).includes("final"), false, "final delivered");
    assert.equal(evNames(events).includes("done"), false, "done delivered");
    assert.equal(M.inserts.length, 0, "chat_messages written");
    assertServiceRoleBound();
  });

  await check(`S1b（A' 對照組）${label} 串流：第一段內容送出前（provider 只送 keep-alive／role-only／空 content）「只有 signal abort」→ rollback 1、0 commit、上游 abort、串流結束前退點已完成`, async () => {
    reset();
    M.openaiPlan.preamble = [
      ": keep-alive\n\n",
      `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n\n`,
    ];
    M.openaiPlan.holdBefore = 0;
    M.openaiPlan.hold = deferred();
    const ac = new AbortController();
    const res = await POST({ request: mkReq({ signal: ac.signal }) });
    const events = [];
    const r = readSse(res, events);
    await until(() => M.trace.includes("provider-hold-before-0"), 2000, "provider hold before first content");
    await sleep(30);
    assert.equal(events.some((e) => e.ev === "delta"), false, "no content delta sent yet");
    ac.abort();
    await withTimeout(r.done, 3000, "stream end");
    assert.equal(calls("credits_rollback").length, 1, "rollback must have run before the stream ended");
    M.openaiPlan.hold.resolve();
    await sleep(30);
    assert.equal(calls("credits_rollback").length, 1, "rollback count");
    assert.equal(calls("credits_commit").length, 0, "commit count");
    assert.equal(M.openaiSignals[0]?.aborted, true, "upstream OpenAI signal aborted");
    assert.equal(evNames(events).includes("final") || evNames(events).includes("done"), false);
    assert.equal(M.inserts.length, 0);
    assertServiceRoleBound();
  });

  await check(`S2 ${label} 串流：provider 完成後（enrich 中）「只有 signal abort」→ commit 1、0 rollback、寫 2 筆紀錄`, async () => {
    reset();
    M.enrichGate = deferred();
    const ac = new AbortController();
    const res = await POST({ request: mkReq({ signal: ac.signal }) });
    const events = [];
    const r = readSse(res, events);
    await until(() => M.trace.includes("enrich-start"), 2000, "enrich start");
    ac.abort();
    await sleep(20);
    M.enrichGate.resolve();
    await withTimeout(r.done, 3000, "stream end");
    await sleep(30);
    assert.equal(calls("credits_commit").length, 1, "commit count");
    assert.equal(calls("credits_rollback").length, 0, "rollback count");
    assert.equal(M.inserts.filter((i) => i.table === "chat_messages").length, 2, "chat_messages");
    assertServiceRoleBound();
  });

  await check(`S3 ${label} 串流：commit 進行中「只有 signal abort」→ commit 仍只 1 次、0 rollback`, async () => {
    reset();
    M.commitGate = deferred();
    const ac = new AbortController();
    const res = await POST({ request: mkReq({ signal: ac.signal }) });
    const events = [];
    const r = readSse(res, events);
    await until(() => calls("credits_commit").length === 1, 2000, "commit in flight");
    ac.abort();
    await sleep(20);
    M.commitGate.resolve();
    await withTimeout(r.done, 3000, "stream end");
    await sleep(30);
    assert.equal(calls("credits_commit").length, 1, "commit count");
    assert.equal(calls("credits_rollback").length, 0, "rollback count");
  });

  await check(`S4 ${label} 串流：provider 前的準備 await（enforceModelCall）期間「只有 signal abort」→ rollback 1、上游不發出、0 commit、不交付`, async () => {
    reset();
    M.enforceFrom = 2;
    M.prepGate = deferred();
    const ac = new AbortController();
    const res = await POST({ request: mkReq({ signal: ac.signal }) });
    const events = [];
    const r = readSse(res, events);
    await until(() => M.trace.includes("prep-gate"), 2000, "prep gate");
    ac.abort();
    await sleep(20);
    M.prepGate.resolve();
    await withTimeout(r.done, 3000, "stream end");
    await sleep(30);
    assert.equal(calls("credits_rollback").length, 1, "rollback count");
    assert.equal(calls("credits_commit").length, 0, "commit count");
    assert.equal(M.openaiCalls - M.openaiPreAborted, 0, "a live OpenAI request was sent");
    assert.equal(evNames(events).includes("final") || evNames(events).includes("done"), false);
    assert.equal(M.inserts.length, 0);
  });
}

await check("S5 /api/roamie 串流 Places 準備期間「只有 signal abort」→ rollback 1、上游不發出、0 commit", async () => {
  reset();
  M.placesFirst = true;
  M.placesGate = deferred();
  const ac = new AbortController();
  const res = await ROAMIE_POST({
    request: roamieRequest({
      signal: ac.signal,
      body: { mode: "recommend", locale: "zh-TW", location: { lat: 25.03, lng: 121.56 } },
    }),
  });
  const events = [];
  const r = readSse(res, events);
  await until(() => M.trace.includes("places-prep-start"), 2000, "places prep");
  ac.abort();
  await sleep(20);
  M.placesGate.resolve();
  await withTimeout(r.done, 3000, "stream end");
  await sleep(30);
  assert.equal(calls("credits_rollback").length, 1);
  assert.equal(calls("credits_commit").length, 0);
  assert.equal(M.openaiCalls - M.openaiPreAborted, 0, "a live OpenAI request was sent");
});

await check("S6（A'）/api/roamie itinerary 串流：第一段內容送出後、provider 中「只有 signal abort」→ commit 1、0 rollback、上游 abort、記 itinerary_generation_failed、不記 succeeded、不寫紀錄", async () => {
  reset();
  M.openaiPlan.holdAfter = 0;
  M.openaiPlan.hold = deferred();
  const ac = new AbortController();
  const res = await ROAMIE_POST({
    request: roamieRequest({ signal: ac.signal, body: { mode: "itinerary", locale: "zh-TW", chatInput: "排兩天" } }),
  });
  const events = [];
  const r = readSse(res, events);
  await until(() => events.some((e) => e.ev === "delta"), 2000, "first delta");
  ac.abort();
  await withTimeout(r.done, 3000, "stream end");
  M.openaiPlan.hold.resolve();
  await sleep(30);
  assert.equal(calls("credits_commit").length, 1);
  assert.equal(calls("credits_rollback").length, 0);
  assert.equal(M.openaiSignals[0]?.aborted, true, "upstream OpenAI signal aborted");
  assert.ok(M.analytics.includes("itinerary_generation_failed"), M.analytics.join(","));
  assert.equal(M.analytics.includes("itinerary_generation_succeeded"), false);
  assert.equal(evNames(events).includes("final") || evNames(events).includes("done"), false);
  assert.equal(M.inserts.length, 0);
});

await check("S6b（A' 對照組）/api/roamie itinerary 串流：第一段內容送出前「只有 signal abort」→ rollback 1、0 commit、記 itinerary_generation_failed、不記 succeeded", async () => {
  reset();
  M.openaiPlan.preamble = [": keep-alive\n\n"];
  M.openaiPlan.holdBefore = 0;
  M.openaiPlan.hold = deferred();
  const ac = new AbortController();
  const res = await ROAMIE_POST({
    request: roamieRequest({ signal: ac.signal, body: { mode: "itinerary", locale: "zh-TW", chatInput: "排兩天" } }),
  });
  const events = [];
  const r = readSse(res, events);
  await until(() => M.trace.includes("provider-hold-before-0"), 2000, "hold before first content");
  ac.abort();
  await withTimeout(r.done, 3000, "stream end");
  M.openaiPlan.hold.resolve();
  await sleep(30);
  assert.equal(calls("credits_rollback").length, 1);
  assert.equal(calls("credits_commit").length, 0);
  assert.ok(M.analytics.includes("itinerary_generation_failed"), M.analytics.join(","));
  assert.equal(M.analytics.includes("itinerary_generation_succeeded"), false);
});

await check("NET 全程沒有任何非 mock 的網路請求", () => {
  assert.deepEqual(NET_BLOCKED, []);
});

Object.assign(console, quiet);
fs.rmSync(tmp, { recursive: true, force: true });
out(`\n${passCount} passed, ${failures.length} failed`);
if (failures.length) out("FAILED: " + failures.join(" | "));
process.exit(failures.length ? 1 : 0);
