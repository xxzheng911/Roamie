// verify-stream-free-generation-review5.mjs — 任務單 #12 補充（第 5 次獨立複審）：串流路徑「沒被扣點卻拿到
// 完整或大部分結果」的重現（預期目前 FAIL；不改 source）。
//
// F1/F2  客戶端讀到 ~95% delta（provider 尚未完成）後主動斷線 → 伺服器退點，但已收到的 delta 用前端同一支
//        parsePartialRoamieJson 就能還原 summary 與全部推薦地點 → 等同稽核第 2 項「可以免費生成」。
//        期望（擬議政策：第一個內容 delta 送出後斷線視為已交付 → commit）：commit 1、0 rollback。
// F3     commit 連續兩次 rpc_error（已知限制，只輸出 INFO 不計 FAIL）：error 事件前，客戶端已拿到 100% delta，
//        而且可直接 JSON.parse 成完整結果。
// F4     非串流斷線：回應不早於 rollback RPC 完成。
// F5/F6  （任務單 #15 依 A' 改寫）第一段內容 delta 送出後斷線 → commit 1、0 rollback；串流結束不早於 commit
//        完成；結算 promise 交給 executionCtx.waitUntil（假 context 記錄）且 commit 完成前不 resolve；上游被中止。
// F7/F8  A' 對照組：第一段內容送出前斷線（只送過 keep-alive／role-only）→ rollback 1；同樣檢查 waitUntil。
// F10/F11（任務單 #17）a：只送純空白 delta 後斷線 → rollback；b：空白後接著實際內容才斷線 → commit。
// F7b/F8b 正常完成：waitUntil 恰 1 次；F7c/F8c waitUntil 丟例外仍交付。F9 非串流斷線 rollback 交給 waitUntil。
//
// 網路：全域 fetch／http(s)／net／tls 一律攔截；非 mock 的請求 → FAIL。清除金鑰類環境變數。不讀 .env。
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=180 scripts/verify-stream-free-generation-review5.mjs

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
console.info = () => {};
console.error = () => {};
console.warn = () => {};

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-freegen-"));
fs.symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"), "dir");
let seq = 0;
async function buildBundle(entry, mocks) {
  const outFile = path.join(tmp, `f${(seq += 1)}.mjs`);
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
        name: "fg-mocks",
        setup(b) {
          const keys = Object.keys(mocks);
          if (!keys.length) return;
          const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
          const filter = new RegExp("^(" + keys.map(esc).join("|") + ")$");
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
  "@/lib/abuse-guard.server": `export const authorizeAiUse = async () => null; export const assertAiUse = async () => {};`,
  "@/lib/abuse-guard-enforcement.server": `export const isAbuseGuardEnforcementOn = () => false;`,
  "@/lib/kill-switch.server": `export const isKillSwitchOn = () => false;`,
  "@/lib/worker-request-scope": `export const getWorkerScope = () => undefined; export const bindVerifiedUserId = () => {};`,
  "@/lib/env.server": `export const getOpenAIKey = () => "sk-offline-fixture";`,
  "@/lib/enrich-roamie-places.server": `export const enrichRoamieResponse = async (p) => p;`,
  "@/lib/recommendation/merge-verified.server": `export const mergeAiWithVerifiedCandidates = (p) => p;`,
  "@/lib/recommendation/pipeline.server": `export const preparePlacesFirstContext = async (ctx) => ({ ctx, candidates: [] });`,
  "./prompts": `export const buildSystemPrompt = () => "system"; export const buildUserMessage = () => "user";`,
  "@/lib/ai/conversation-stage": `export const stageAllowsPlacesFirst = () => false; export const mergeBoundsForStage = () => ({});`,
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

let roamieFile, chatFile, partialFile;
try {
  roamieFile = await buildBundle("src/routes/api/roamie.ts", MOCKS);
  chatFile = await buildBundle("src/routes/api/chat.ts", MOCKS);
  // The real client-side partial parser (same function _app.chat.tsx renders from).
  partialFile = await buildBundle("src/lib/ai/parse-partial.ts", {});
} catch (e) {
  out("INFRA-FAIL bundle: " + (e?.errors ?? []).map((x) => x.text).join("\n  ") + "\n" + String(e?.message ?? e).slice(0, 1500));
  process.exit(1);
}
installSocketTraps();
const roamie = await import(pathToFileURL(roamieFile).href);
const chat = await import(pathToFileURL(chatFile).href);
const { parsePartialRoamieJson } = await import(pathToFileURL(partialFile).href);
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

const REC = (name) => ({
  name,
  type: "咖啡廳",
  description: name + " 的描述",
  reason: "適合放空",
  estimatedTime: "1 小時",
  address: "台北市信義區",
});
const RECS = [REC("晨光咖啡"), REC("巷弄書房"), REC("河岸烘焙")];
const SUMMARY = "這三間咖啡廳都在步行範圍內，適合下午慢慢待。";
const AI_JSON = JSON.stringify({ summary: SUMMARY, recommendations: RECS, moodTag: "chill" });
// Provider holds right before the tail (`,"moodTag":"chill"}`) — the client already has ~95%.
const TAIL = `,"moodTag":"chill"}`;
const HEAD_PART = AI_JSON.slice(0, AI_JSON.length - TAIL.length);
const CHUNK = 24;
const CHUNKS = [];
for (let i = 0; i < HEAD_PART.length; i += CHUNK) CHUNKS.push(HEAD_PART.slice(i, i + CHUNK));
CHUNKS.push(TAIL);

function reset({ commits = [] } = {}) {
  M.analytics = [];
  M.adminCalls = [];
  M.inserts = [];
  M.rollbackGate = null;
  M.rollbackDone = false;
  M.commitGate = null;
  M.commitDone = false;
  M.providerHolding = false;
  M.upstreamAborted = false;
  M.openaiPlan = { chunks: CHUNKS, holdBeforeLast: false, holdBeforeFirst: false, preamble: [], hold: null };
  const commitQueue = [...commits];
  M.adminRpc = async (fn, args) => {
    M.adminCalls.push({ fn, args });
    if (fn === "credits_reserve") return { data: { ok: true, idempotent: false, ledger_id: "L-1", status: "reserved" }, error: null };
    if (fn === "credits_commit") {
      if (M.commitGate) await M.commitGate.promise;
      M.commitDone = true;
      return commitQueue.length ? commitQueue.shift() : { data: { ok: true }, error: null };
    }
    if (fn === "credits_rollback") {
      if (M.rollbackGate) await M.rollbackGate.promise;
      M.rollbackDone = true;
      return { data: { ok: true, status: "rolled_back" }, error: null };
    }
    return { data: null, error: { message: "unexpected admin rpc " + fn } };
  };
  M.userClientFactory = () => ({
    auth: { getUser: async () => ({ data: { user: { id: VERIFIED_UID, email: "u@example.test" } }, error: null }) },
    rpc: async (fn) => (fn === "resolve_user_plus_entitlement" ? { data: { has_plus: false }, error: null } : { data: null, error: { message: "no" } }),
    from: (table) => ({ insert: async (row) => (M.inserts.push({ table, row }), { error: null }) }),
  });
  M.fetchHandler = async (url, init) => {
    if (url !== "https://api.openai.com/v1/chat/completions") return undefined;
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const plan = M.openaiPlan;
    const body = init.body ? JSON.parse(init.body) : {};
    if (!body.stream) {
      // Non-stream: hold the provider until the client aborts (fetch rejects on abort).
      return await new Promise((_, rej) => {
        init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        init.signal?.addEventListener(
          "abort",
          () => {
            M.upstreamAborted = true;
            try {
              controller.error(new DOMException("aborted", "AbortError"));
            } catch {}
          },
          { once: true },
        );
        for (const raw of plan.preamble ?? []) controller.enqueue(enc.encode(raw));
        for (const [i, c] of plan.chunks.entries()) {
          if (init.signal?.aborted) return;
          if (plan.holdBeforeFirst && i === 0) {
            M.providerHolding = true;
            await plan.hold.promise;
            if (init.signal?.aborted) return;
          }
          if (typeof plan.holdBeforeIndex === "number" && i === plan.holdBeforeIndex) {
            M.providerHolding = true;
            await plan.hold.promise;
            if (init.signal?.aborted) return;
          }
          if (plan.holdBeforeLast && i === plan.chunks.length - 1) {
            await plan.hold.promise;
            if (init.signal?.aborted) return;
          }
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`));
          await sleep(1);
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        try {
          controller.close();
        } catch {}
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}
const calls = (fn) => M.adminCalls.filter((c) => c.fn === fn);

function readSse(res, events) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const state = { assembled: "", endedAt: 0 };
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
          if (!ev) continue;
          events.push({ ev, data });
          if (ev === "delta") state.assembled += JSON.parse(data).delta;
        }
      }
    } catch (e) {
      events.push({ ev: "__read_error", data: String(e?.message ?? e) });
    }
    state.endedAt = Date.now();
  })();
  return { done, state };
}

function roamieRequest({ signal, stream = true } = {}) {
  return new Request("https://roamie.tw/api/roamie", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      origin: "https://roamie.tw",
      authorization: "Bearer user-jwt",
      "x-roamie-request-id": "fg-" + (seq += 1),
      ...(stream ? {} : { "X-Roamie-Stream": "false" }),
    },
    body: JSON.stringify({ mode: "chat", chatInput: "推薦咖啡廳", locale: "zh-TW" }),
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
      "x-roamie-request-id": "fgchat-" + (seq += 1),
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "推薦咖啡廳" }], locale: "zh-TW" }),
  });
}

for (const [id, label, POST, mkReq] of [
  ["F1", "/api/roamie", ROAMIE_POST, roamieRequest],
  ["F2", "/api/chat", CHAT_POST, chatRequest],
]) {
  await check(`${id} ${label} 串流：收到 ~95% delta（summary＋全部推薦已可解析）後客戶端主動斷線 → 期望 commit（已交付），不得退點`, async () => {
    reset();
    M.openaiPlan.holdBeforeLast = true;
    M.openaiPlan.hold = deferred();
    const ac = new AbortController();
    const res = await POST({ request: mkReq({ signal: ac.signal }) });
    const events = [];
    const r = readSse(res, events);
    await until(() => r.state.assembled.length === HEAD_PART.length, 3000, "~95% of deltas");
    const pct = Math.round((r.state.assembled.length / AI_JSON.length) * 100);
    const partial = parsePartialRoamieJson(r.state.assembled);
    // Evidence: the client already holds the usable answer.
    assert.equal(partial.summary, SUMMARY, "partial summary");
    assert.deepEqual((partial.recommendations ?? []).map((x) => x.name), RECS.map((x) => x.name), "partial recs");
    ac.abort();
    await r.done;
    M.openaiPlan.hold.resolve();
    await sleep(40);
    const rb = calls("credits_rollback").length;
    const cm = calls("credits_commit").length;
    out(`     [evidence] delta received=${pct}% recs=${partial.recommendations.length}/3 summary=full → rollback=${rb} commit=${cm}`);
    assert.equal(rb, 0, `refunded (rollback=${rb}) although ${pct}% of the answer (full summary + all ${RECS.length} places) was delivered`);
    assert.equal(cm, 1, "commit count");
  });
}

await check("F3（已知限制，INFO）commit 連續兩次 rpc_error：error 事件前客戶端已拿到 100% delta 且可完整 JSON.parse", async () => {
  reset({ commits: [{ data: null, error: { message: "t1" } }, { data: null, error: { message: "t2" } }] });
  const res = await ROAMIE_POST({ request: roamieRequest() });
  const events = [];
  const r = readSse(res, events);
  await r.done;
  const names = events.map((e) => e.ev);
  assert.equal(names.at(-1), "error");
  assert.equal(names.includes("final"), false);
  const parsed = JSON.parse(r.state.assembled);
  out(`     [INFO] commit=${calls("credits_commit").length} rollback=${calls("credits_rollback").length}; client deltas parse to summary+${parsed.recommendations.length} recs (known limitation, not counted as gap)`);
});

await check("F4 /api/roamie 非串流：provider 中斷線 → 回應不得早於 rollback RPC 完成（目前 settleCredits(false) 第二次呼叫直接 resolve，未等待進行中的 rollback；也無 waitUntil）", async () => {
  reset();
  M.rollbackGate = deferred();
  const ac = new AbortController();
  const pending = ROAMIE_POST({ request: roamieRequest({ signal: ac.signal, stream: false }) });
  await sleep(30);
  ac.abort();
  let respondedBeforeRollback = null;
  const res = await Promise.race([
    pending.then((x) => ((respondedBeforeRollback = !M.rollbackDone), x)),
    sleep(300).then(() => null),
  ]);
  M.rollbackGate.resolve();
  const final = res ?? (await pending);
  await sleep(20);
  assert.equal(calls("credits_rollback").length, 1, "rollback count");
  assert.notEqual(final.status, 200);
  assert.equal(respondedBeforeRollback === true, false, "handler returned its response while the rollback RPC was still pending");
});

/** Fake Workers execution context: records every promise handed to waitUntil and whether it settled. */
function fakeExecutionContext({ throwOnWaitUntil = false } = {}) {
  const handed = [];
  const context = {
    cloudflareEnv: {},
    executionCtx: {
      waitUntil(p) {
        const h = { settled: false, promise: p };
        p.then(() => (h.settled = true), () => (h.settled = true));
        handed.push(h);
        if (throwOnWaitUntil) throw new Error("waitUntil after response end");
      },
      passThroughOnException() {},
    },
  };
  return { handed, context };
}

for (const [id, label, POST, mkReq] of [
  ["F5", "/api/roamie", ROAMIE_POST, roamieRequest],
  ["F6", "/api/chat", CHAT_POST, chatRequest],
]) {
  await check(`${id}（A'）${label} 串流：第一段內容送出後、provider 中斷線 → commit 1、0 rollback；串流結束不早於 commit RPC 完成；commit promise 交給 executionCtx.waitUntil 且 commit 完成前不 resolve；上游被中止`, async () => {
    reset();
    M.commitGate = deferred();
    M.openaiPlan.holdBeforeLast = true;
    M.openaiPlan.hold = deferred();
    const { handed, context } = fakeExecutionContext();
    const ac = new AbortController();
    const res = await POST({ request: mkReq({ signal: ac.signal }), context });
    const events = [];
    const r = readSse(res, events);
    await until(() => events.some((e) => e.ev === "delta"), 2000, "delta");
    assert.equal(handed.length, 0, "no settlement before the disconnect");
    ac.abort();
    const ended = await Promise.race([r.done.then(() => true), sleep(300).then(() => false)]);
    const endedBeforeCommit = ended && !M.commitDone;
    assert.ok(handed.length >= 1, "settlement promise was not handed to executionCtx.waitUntil");
    assert.equal(handed.some((h) => h.settled), false, "waitUntil promise resolved while the commit RPC was still pending");
    M.commitGate.resolve();
    M.openaiPlan.hold.resolve();
    await r.done;
    await sleep(20);
    assert.equal(calls("credits_commit").length, 1, "commit count");
    assert.equal(calls("credits_rollback").length, 0, "rollback count");
    assert.equal(endedBeforeCommit, false, "stream closed (start() finished) while the commit RPC was still pending");
    assert.equal(handed.every((h) => h.settled), true, "waitUntil promise never settled");
    assert.equal(M.upstreamAborted, true, "upstream OpenAI stream aborted");
    const names = events.map((e) => e.ev);
    assert.equal(names.includes("final") || names.includes("done"), false, "final/done after a disconnect");
    assert.equal(M.inserts.length, 0, "chat_messages written for an aborted stream");
  });
}

for (const [id, label, POST, mkReq] of [
  ["F7", "/api/roamie", ROAMIE_POST, roamieRequest],
  ["F8", "/api/chat", CHAT_POST, chatRequest],
]) {
  await check(`${id}（A' 對照組）${label} 串流：第一段內容送出前（只有 keep-alive／role-only）斷線 → rollback 1、0 commit；串流結束不早於 rollback 完成；rollback promise 交給 waitUntil`, async () => {
    reset();
    M.rollbackGate = deferred();
    M.openaiPlan.preamble = [
      ": keep-alive\n\n",
      `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" } }] })}\n\n`,
    ];
    M.openaiPlan.holdBeforeFirst = true;
    M.openaiPlan.hold = deferred();
    const { handed, context } = fakeExecutionContext();
    const ac = new AbortController();
    const res = await POST({ request: mkReq({ signal: ac.signal }), context });
    const events = [];
    const r = readSse(res, events);
    await until(() => M.providerHolding, 2000, "provider holding before first content");
    await sleep(20);
    assert.equal(events.some((e) => e.ev === "delta"), false, "no content delta sent");
    ac.abort();
    const ended = await Promise.race([r.done.then(() => true), sleep(300).then(() => false)]);
    const endedBeforeRollback = ended && !M.rollbackDone;
    assert.ok(handed.length >= 1, "rollback promise not handed to waitUntil");
    assert.equal(handed.some((h) => h.settled), false, "waitUntil promise resolved while the rollback RPC was pending");
    M.rollbackGate.resolve();
    M.openaiPlan.hold.resolve();
    await r.done;
    await sleep(20);
    assert.equal(calls("credits_rollback").length, 1, "rollback count");
    assert.equal(calls("credits_commit").length, 0, "commit count");
    assert.equal(endedBeforeRollback, false, "stream closed while the rollback RPC was still pending");
    assert.equal(handed.every((h) => h.settled), true);
    assert.equal(M.upstreamAborted, true, "upstream aborted");
  });

  await check(`${id}b ${label} 串流正常完成（有 executionCtx）→ commit promise 交給 waitUntil 恰 1 次；commit 完成後才送 final/done`, async () => {
    reset();
    M.commitGate = deferred();
    const { handed, context } = fakeExecutionContext();
    const res = await POST({ request: mkReq(), context });
    const events = [];
    const r = readSse(res, events);
    await until(() => calls("credits_commit").length === 1, 2000, "commit in flight");
    await sleep(30);
    assert.equal(handed.length, 1, "waitUntil count");
    assert.equal(handed[0].settled, false);
    assert.equal(events.some((e) => e.ev === "final" || e.ev === "done"), false, "final/done before the commit finished");
    M.commitGate.resolve();
    await r.done;
    assert.equal(handed[0].settled, true);
    assert.deepEqual(events.map((e) => e.ev).slice(-1), ["done"]);
    assert.equal(calls("credits_rollback").length, 0);
  });

  await check(`${id}c ${label} 串流：executionCtx.waitUntil 丟例外（回應已結束）→ 結算仍完成、仍交付 final/done`, async () => {
    reset();
    const { handed, context } = fakeExecutionContext({ throwOnWaitUntil: true });
    const res = await POST({ request: mkReq(), context });
    const events = [];
    await readSse(res, events).done;
    assert.equal(handed.length, 1);
    assert.equal(calls("credits_commit").length, 1);
    assert.deepEqual(events.map((e) => e.ev).slice(-1), ["done"]);
  });
}

// 任務單 #17：只有 trim 後非空的內容 delta 才算「第一段內容已送出」。
const WS_CHUNKS = [" ", "\n", "\t \r\n"];
for (const [id, label, POST, mkReq] of [
  ["F10", "/api/roamie", ROAMIE_POST, roamieRequest],
  ["F11", "/api/chat", CHAT_POST, chatRequest],
]) {
  await check(`${id}a（#17）${label} 串流：只送出純空白 delta（" "、"\\n"、"\\t \\r\\n"）後斷線 → 不算已交付：rollback 1、0 commit`, async () => {
    reset();
    M.rollbackGate = deferred();
    M.openaiPlan.chunks = [...WS_CHUNKS, ...CHUNKS];
    M.openaiPlan.holdBeforeIndex = WS_CHUNKS.length;
    M.openaiPlan.hold = deferred();
    const { handed, context } = fakeExecutionContext();
    const ac = new AbortController();
    const res = await POST({ request: mkReq({ signal: ac.signal }), context });
    const events = [];
    const r = readSse(res, events);
    await until(() => M.providerHolding, 2000, "provider holding after whitespace deltas");
    await until(() => events.filter((e) => e.ev === "delta").length === WS_CHUNKS.length, 2000, "whitespace deltas reached client");
    assert.equal(r.state.assembled, WS_CHUNKS.join(""), "client received only whitespace");
    ac.abort();
    const ended = await Promise.race([r.done.then(() => true), sleep(300).then(() => false)]);
    const endedBeforeRollback = ended && !M.rollbackDone;
    M.rollbackGate.resolve();
    M.openaiPlan.hold.resolve();
    await r.done;
    await sleep(20);
    assert.equal(calls("credits_rollback").length, 1, "rollback count (whitespace-only must refund)");
    assert.equal(calls("credits_commit").length, 0, "commit count (whitespace-only must not charge)");
    assert.equal(endedBeforeRollback, false, "stream closed while the rollback RPC was still pending");
    assert.ok(handed.length >= 1, "rollback promise not handed to waitUntil");
    assert.equal(handed.every((h) => h.settled), true);
    assert.equal(M.upstreamAborted, true, "upstream aborted");
  });

  await check(`${id}b（#17）${label} 串流：純空白 delta 之後接著送出實際內容才斷線 → 已交付：commit 1、0 rollback`, async () => {
    reset();
    M.commitGate = deferred();
    M.openaiPlan.chunks = [...WS_CHUNKS, ...CHUNKS];
    // Hold right after the first real content chunk.
    M.openaiPlan.holdBeforeIndex = WS_CHUNKS.length + 1;
    M.openaiPlan.hold = deferred();
    const { handed, context } = fakeExecutionContext();
    const ac = new AbortController();
    const res = await POST({ request: mkReq({ signal: ac.signal }), context });
    const events = [];
    const r = readSse(res, events);
    await until(() => M.providerHolding, 2000, "provider holding after first real content");
    await until(() => events.filter((e) => e.ev === "delta").length === WS_CHUNKS.length + 1, 2000, "first real delta reached client");
    assert.equal(r.state.assembled, WS_CHUNKS.join("") + CHUNKS[0]);
    assert.ok(CHUNKS[0].trim().length > 0, "fixture: first real chunk is non-blank");
    ac.abort();
    const ended = await Promise.race([r.done.then(() => true), sleep(300).then(() => false)]);
    const endedBeforeCommit = ended && !M.commitDone;
    M.commitGate.resolve();
    M.openaiPlan.hold.resolve();
    await r.done;
    await sleep(20);
    assert.equal(calls("credits_commit").length, 1, "commit count (real content was delivered)");
    assert.equal(calls("credits_rollback").length, 0, "rollback count");
    assert.equal(endedBeforeCommit, false, "stream closed while the commit RPC was still pending");
    assert.ok(handed.length >= 1, "commit promise not handed to waitUntil");
    assert.equal(handed.every((h) => h.settled), true);
    assert.equal(M.upstreamAborted, true, "upstream aborted");
  });
}

await check("F9 /api/roamie 非串流：provider 中斷線 → rollback promise 交給 waitUntil，且回應不早於 rollback 完成", async () => {
  reset();
  M.rollbackGate = deferred();
  const { handed, context } = fakeExecutionContext();
  const ac = new AbortController();
  const pending = ROAMIE_POST({ request: roamieRequest({ signal: ac.signal, stream: false }), context });
  await sleep(30);
  ac.abort();
  let respondedBeforeRollback = null;
  const res = await Promise.race([
    pending.then((x) => ((respondedBeforeRollback = !M.rollbackDone), x)),
    sleep(300).then(() => null),
  ]);
  assert.ok(handed.length >= 1, "waitUntil not used on the non-stream path");
  M.rollbackGate.resolve();
  const final = res ?? (await pending);
  await sleep(20);
  assert.equal(calls("credits_rollback").length, 1);
  assert.equal(calls("credits_commit").length, 0);
  assert.notEqual(final.status, 200);
  assert.equal(respondedBeforeRollback === true, false);
  assert.equal(handed.every((h) => h.settled), true);
});

await check("NET 全程沒有任何非 mock 的網路請求", () => {
  assert.deepEqual(NET_BLOCKED, []);
});

Object.assign(console, quiet);
fs.rmSync(tmp, { recursive: true, force: true });
out(`\n${passCount} passed, ${failures.length} failed`);
if (failures.length) out("FAILED: " + failures.join(" | "));
process.exit(failures.length ? 1 : 0);
