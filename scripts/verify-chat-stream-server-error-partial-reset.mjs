// verify-chat-stream-server-error-partial-reset.mjs — 任務單 #15（第 6 次獨立複審）：前端收到伺服器 error
// 事件（任何 code = 沒扣點）時，必須把這次串流寫進最後一則 assistant 的殘缺摘要／推薦卡還原成空佔位，且不能經由
// msgsRef → persistSession（extractLatestShownCandidatesFromMsgs / upsertDraftWorkspaceFromSession）存進 workspace。
// 客戶端逾時、網路中斷時維持原行為（殘缺內容保留，交由既有 fallback 處理）。
//
// 專案沒有 jsdom / testing-library，所以採「真實程式碼片段＋模擬 React 提交週期」：
//   - esbuild 打包「真實」 src/lib/ai/stream-client.ts（解析 SSE、呼叫 onPartial/onError）。
//   - 從 src/routes/_app.chat.tsx 逐字擷取 streamChat 的三段原始碼：旗標宣告、handlers 物件（onPartial/onError）、
//     catch 開頭的殘缺重置區塊；esbuild 去型別後組成 harness 執行（不是複製改寫的邏輯）。
//   - 模擬 React：setMsgs 只排入 updater，render() 才依序套用（StrictMode 模式下每個 updater 執行兩次），並在
//     「commit 後」才同步 msgsRef.current = msgs（對應 _app.chat.tsx 的 useEffect(() => { msgsRef.current = msgs })）。
//   - 用真實 extractLatestShownCandidatesFromMsgs 判斷 persistSession 會從 msgsRef 撈到哪些推薦卡。
// 未涵蓋：真實 React 排程、applyLocalFallback／persistSession 的完整副作用、iOS 原生串流分段方式。
//
// 網路：全域 fetch／http(s)／net／tls 一律攔截；非 mock 的請求 → FAIL。清除金鑰類環境變數。不讀 .env。
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=120 scripts/verify-chat-stream-server-error-partial-reset.mjs

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

const CHAT_SRC = fs.readFileSync(path.join(root, "src/routes/_app.chat.tsx"), "utf8");
const CLIENT_SRC = fs.readFileSync(path.join(root, "src/lib/ai/stream-client.ts"), "utf8");

// ---------------------------------------------------------------------------
// Extract the real streamChat fragments.
// ---------------------------------------------------------------------------
function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("unbalanced braces from " + openIdx);
}
const streamChatStart = CHAT_SRC.indexOf("const streamChat = useCallback(");
const fragments = (() => {
  assert.ok(streamChatStart > 0, "streamChat not found");
  const declStart = CHAT_SRC.indexOf("let serverReportedError = false;", streamChatStart);
  const declEnd = CHAT_SRC.indexOf("\n", CHAT_SRC.indexOf("let lastStreamPartial", declStart));
  assert.ok(declStart > 0 && declEnd > declStart, "flag declarations not found");
  const decl = CHAT_SRC.slice(declStart, declEnd);
  const callIdx = CHAT_SRC.indexOf("const full = await streamRoamieAI(", declEnd);
  const handlersOpen = CHAT_SRC.indexOf("{", CHAT_SRC.indexOf("req,", callIdx));
  const handlersClose = matchBrace(CHAT_SRC, handlersOpen);
  const handlers = CHAT_SRC.slice(handlersOpen, handlersClose + 1);
  const afterHandlers = CHAT_SRC.slice(handlersClose + 1, handlersClose + 80);
  assert.match(afterHandlers, /^\s*,\s*\{ token, signal: controller\.signal \}/, "handlers object boundary");
  const catchIdx = CHAT_SRC.indexOf("} catch (e) {", handlersClose);
  const resetIdx = CHAT_SRC.indexOf("if (serverReportedError && lastStreamPartial) {", catchIdx);
  const resetOpen = CHAT_SRC.indexOf("{", resetIdx);
  const resetClose = matchBrace(CHAT_SRC, resetOpen);
  const reset = CHAT_SRC.slice(resetIdx, resetClose + 1);
  const catchHead = CHAT_SRC.slice(catchIdx + "} catch (e) {".length, resetIdx);
  return { decl, handlers, reset, catchHead, catchIdx, resetIdx };
})();

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------
const { build, transform } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-partial-reset-"));
fs.symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"), "dir");
let seq = 0;
async function buildBundle(entry, mocks) {
  const outFile = path.join(tmp, `p${(seq += 1)}.mjs`);
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
        name: "pr-mocks",
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
const CLIENT_MOCKS = {
  "@/lib/i18n/effective-app-locale": `export const effectiveAppLocale = () => "zh-TW";`,
  "@/lib/chat-runtime-copy": `export const chatRuntimeCopy = (k) => k;`,
  "@/lib/user-facing-error": `
    export const errorMessage = (e) => (e instanceof Error ? e.message : String(e));
    export const isNetworkFailureError = () => false;
    export const resolveChatConnectionFallbackMessage = () => "fallback";`,
  "@/lib/api-url": `
    export const resolveApiUrl = (p) => "https://roamie.tw" + p;
    export const apiEndpointDiagnostic = () => ({});
    export const isApiUrlError = () => false;`,
  "@/lib/access/context": `export const applyTierToAiContext = (ctx) => ctx;`,
  "@/lib/access/resolve": `export const resolveEffectivePlanTierWithProfile = async () => "free";`,
};

let clientFile, refreshFile, harnessFile;
try {
  clientFile = await buildBundle("src/lib/ai/stream-client.ts", CLIENT_MOCKS);
  refreshFile = await buildBundle("src/lib/ai/chat-recommendation-refresh.ts", {});
  const harnessTs = `
    export async function run({ streamRoamieAI, req, controller, setMsgs, setPartial, msgsRef }) {
      ${fragments.decl}
      try {
        const full = await streamRoamieAI(req, ${fragments.handlers}, { token: undefined, signal: controller.signal });
        return { outcome: "ok", full, serverReportedError };
      } catch (e) {
        ${fragments.reset}
        return { outcome: "caught", name: e?.name, message: e?.message, serverReportedError };
      }
    }`;
  const { code } = await transform(harnessTs, { loader: "ts", format: "esm", target: "node22" });
  harnessFile = path.join(tmp, "harness.mjs");
  fs.writeFileSync(harnessFile, code);
} catch (e) {
  out("INFRA-FAIL bundle: " + (e?.errors ?? []).map((x) => x.text).join("\n  ") + "\n" + String(e?.message ?? e).slice(0, 1500));
  process.exit(1);
}
installSocketTraps();
const { streamRoamieAI } = await import(pathToFileURL(clientFile).href);
const { extractLatestShownCandidatesFromMsgs } = await import(pathToFileURL(refreshFile).href);
const { run } = await import(pathToFileURL(harnessFile).href);

// ---------------------------------------------------------------------------
// Simulated React commit cycle
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PRIOR = {
  role: "assistant",
  content: "先前的推薦",
  roamie: { summary: "先前的推薦", recommendations: [{ name: "先前咖啡", type: "咖啡廳", description: "d", reason: "r" }] },
};
function makeReact({ strict = false, initial = null } = {}) {
  const st = { msgs: initial ?? [{ role: "user", content: "推薦咖啡廳" }, PRIOR, { role: "user", content: "再推薦" }], queue: [], partial: null, renders: 0 };
  const msgsRef = { current: st.msgs };
  return {
    msgsRef,
    setMsgs: (u) => st.queue.push(u),
    setPartial: (p) => (st.partial = p),
    /** Applies queued updaters (twice each in StrictMode), then runs the msgsRef sync effect. */
    render() {
      for (const u of st.queue.splice(0)) {
        if (typeof u === "function") {
          if (strict) u(st.msgs);
          st.msgs = u(st.msgs);
        } else st.msgs = u;
      }
      st.renders += 1;
      msgsRef.current = st.msgs;
    },
    get msgs() {
      return st.msgs;
    },
    get partial() {
      return st.partial;
    },
  };
}

const REC = (name) => ({ name, type: "咖啡廳", description: name + " 描述", reason: "安靜", estimatedTime: "1 小時", address: "台北市" });
const AI_JSON = JSON.stringify({ summary: "這三間很適合下午", recommendations: [REC("晨光咖啡"), REC("巷弄書房"), REC("河岸烘焙")] });
const DELTAS = [];
for (let i = 0; i < AI_JSON.length; i += 30) DELTAS.push(AI_JSON.slice(i, i + 30));
const sseDelta = (d) => `event: delta\ndata: ${JSON.stringify({ delta: d })}\n\n`;
const sseError = (code) => `event: error\ndata: ${JSON.stringify({ error: "AI 服務暫時無法使用", code })}\n\n`;

/**
 * steps: { chunk } | { render } | { networkError } | { clientAbort }.
 * The response body is driven step by step; renders happen only where listed.
 */
function plan(react, controller, steps) {
  M.cancelNotices = 0;
  M.fetchHandler = async (url, init) => {
    if (url !== "https://roamie.tw/api/roamie") return undefined;
    const headers = new Headers(init.headers ?? {});
    if (headers.get("x-roamie-cancel") === "true") {
      M.cancelNotices += 1;
      return new Response(null, { status: 204 });
    }
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const enc = new TextEncoder();
    const body = new ReadableStream({
      async start(c) {
        init.signal?.addEventListener("abort", () => {
          try {
            c.error(new DOMException("aborted", "AbortError"));
          } catch {}
        }, { once: true });
        for (const s of steps) {
          await sleep(2);
          if (init.signal?.aborted) return;
          if (s.chunk !== undefined) c.enqueue(enc.encode(s.chunk));
          else if (s.render) react.render();
          else if (s.networkError) {
            c.error(new TypeError("Load failed"));
            return;
          } else if (s.clientAbort) controller.abort();
        }
        try {
          c.close();
        } catch {}
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}

async function runTurn({ steps, strict = false, httpError = null, initial = null, renderPlaceholder = true }) {
  const react = makeReact({ strict, initial });
  const controller = new AbortController();
  // streamChat appends the empty assistant placeholder before streaming.
  react.setMsgs((prev) => [...prev, { role: "assistant", content: "" }]);
  if (renderPlaceholder) react.render();
  if (httpError) {
    M.fetchHandler = async (url) =>
      url === "https://roamie.tw/api/roamie"
        ? new Response(JSON.stringify({ error: "Too many requests", code: httpError }), { status: 429, headers: { "content-type": "application/json" } })
        : undefined;
  } else plan(react, controller, steps);
  const result = await run({
    streamRoamieAI,
    req: { mode: "chat", chatInput: "再推薦", locale: "zh-TW", planTier: "free" },
    controller,
    setMsgs: react.setMsgs,
    setPartial: react.setPartial,
    msgsRef: react.msgsRef,
  });
  // What persistSession would read synchronously right after the catch (before the next commit).
  const refAtCatch = react.msgsRef.current;
  const candidatesAtCatch = extractLatestShownCandidatesFromMsgs(refAtCatch).map((c) => c.name);
  react.render();
  return { react, result, refAtCatch, candidatesAtCatch };
}
const lastOf = (msgs) => msgs[msgs.length - 1];
const PARTIAL_NAMES = ["晨光咖啡", "巷弄書房", "河岸烘焙"];
const hasPartialCards = (names) => names.some((n) => PARTIAL_NAMES.includes(n));

// ---------------------------------------------------------------------------
// Structural checks
// ---------------------------------------------------------------------------
await check("T0 結構：重置區塊是 streamChat catch 的第一個陳述式（AbortError／一般 fallback 之前），同時重設 msgsRef 與 setMsgs", () => {
  assert.equal(fragments.catchHead.trim(), "", "code before the partial reset in catch: " + fragments.catchHead.trim().slice(0, 120));
  assert.match(fragments.reset, /msgsRef\.current\s*=\s*dropStreamPartial\(msgsRef\.current\)/);
  assert.match(fragments.reset, /setMsgs\(dropStreamPartial\)/);
  assert.match(fragments.handlers, /if \(info\?\.source === "server"\) serverReportedError = true;/);
});

await check("T0b 結構：stream-client 的 HTTP 錯誤與 SSE error（含無法解析）共 3 處 onError 標 source:\"server\"；done 後客戶端自行解析失敗（已扣點）那 1 處不標；逾時走 throw ChatStreamError", () => {
  const calls = [...CLIENT_SRC.matchAll(/handlers\.onError\?\.\(([\s\S]*?)\);/g)].map((m) => m[1]);
  const server = calls.filter((c) => /source: "server"/.test(c));
  const other = calls.filter((c) => !/source: "server"/.test(c));
  assert.equal(server.length, 3, "server-marked onError sites: " + server.length);
  assert.equal(other.length, 1, "unmarked onError sites: " + other.join(" | "));
  assert.match(other[0], /AI 回應格式錯誤/, "the only unmarked site is the post-done client parse failure");
  assert.match(CLIENT_SRC, /throw new ChatStreamError\(\s*"stream_aborted"/);
});

// ---------------------------------------------------------------------------
// Runtime scenarios
// ---------------------------------------------------------------------------
const deltaStepsWithRenders = DELTAS.flatMap((d) => [{ chunk: sseDelta(d) }, { render: true }]);

for (const code of ["credits_settle_failed", "provider_error", "overall_timeout"]) {
  for (const strict of [false, true]) {
    await check(`P1 delta（每段之間有 render）→ 伺服器 error(${code})${strict ? "［StrictMode］" : ""} → 最後一則還原為空佔位；msgsRef（catch 當下＝persistSession 讀到的）沒有殘缺卡`, async () => {
      const { react, result, refAtCatch, candidatesAtCatch } = await runTurn({
        strict,
        steps: [...deltaStepsWithRenders, { chunk: sseError(code) }],
      });
      assert.equal(result.outcome, "caught");
      assert.equal(result.serverReportedError, true);
      assert.deepEqual(lastOf(react.msgs), { role: "assistant", content: "" }, "state last message");
      assert.deepEqual(lastOf(refAtCatch), { role: "assistant", content: "" }, "msgsRef last message at catch");
      assert.equal(hasPartialCards(candidatesAtCatch), false, "persistSession would adopt partial cards: " + candidatesAtCatch.join(","));
      assert.deepEqual(candidatesAtCatch, ["先前咖啡"], "prior turn's cards must stay the authority");
      assert.equal(react.msgs.length, 4, "prior messages preserved");
      assert.deepEqual(react.partial, {}, "partial preview cleared");
    });
  }
}

await check("P2 最後一段 delta 與 error(credits_settle_failed) 在同一個網路 chunk 抵達（中間沒有 render）→ msgsRef 在 catch 當下也不得留著前一次 render 的殘缺卡", async () => {
  const head = DELTAS.slice(0, -1).flatMap((d) => [{ chunk: sseDelta(d) }, { render: true }]);
  const { react, refAtCatch, candidatesAtCatch } = await runTurn({
    steps: [...head, { chunk: sseDelta(DELTAS.at(-1)) + sseError("credits_settle_failed") }],
  });
  assert.deepEqual(lastOf(react.msgs), { role: "assistant", content: "" }, "state last message");
  const lastRef = lastOf(refAtCatch);
  assert.equal(
    hasPartialCards(candidatesAtCatch),
    false,
    `msgsRef still holds the previous render's partial (last.roamie.recommendations=${(lastRef.roamie?.recommendations ?? []).map((r) => r.name).join(",")}); ` +
      "dropStreamPartial only matches the very last partial object by identity, but msgsRef is synced by useEffect and lags behind",
  );
});

await check("P3 多段 delta＋error 全在同一個 chunk（原生層一次交付）→ state 還原為空佔位；msgsRef 未含殘缺卡", async () => {
  const { react, candidatesAtCatch } = await runTurn({
    steps: [{ chunk: DELTAS.map(sseDelta).join("") + sseError("provider_error") }],
  });
  assert.deepEqual(lastOf(react.msgs), { role: "assistant", content: "" });
  assert.equal(hasPartialCards(candidatesAtCatch), false);
});

await check("P4 HTTP 429（伺服器錯誤、沒有 delta）→ serverReportedError=true，最後一則仍是空佔位，不誤刪先前訊息", async () => {
  const { react, result, candidatesAtCatch } = await runTurn({ httpError: "rate_limited" });
  assert.equal(result.outcome, "caught");
  assert.equal(result.serverReportedError, true);
  assert.equal(react.msgs.length, 4);
  assert.deepEqual(lastOf(react.msgs), { role: "assistant", content: "" });
  assert.deepEqual(candidatesAtCatch, ["先前咖啡"]);
});

await check("P5 客戶端逾時（AbortController.abort）在 delta 之後 → AbortError、serverReportedError=false，殘缺內容維持原狀（既有行為）；送出 cancel 通知", async () => {
  const { react, result } = await runTurn({ steps: [...deltaStepsWithRenders.slice(0, 6), { clientAbort: true }] });
  assert.equal(result.outcome, "caught");
  assert.equal(result.name, "ChatStreamError");
  assert.equal(result.serverReportedError, false);
  assert.ok(lastOf(react.msgs).roamie, "partial kept on client timeout (original behavior)");
  assert.equal(M.cancelNotices, 1, "cancel notice");
});

await check("P6 網路中斷（body 讀取 TypeError）在 delta 之後 → serverReportedError=false，殘缺內容維持原狀（既有行為）", async () => {
  const { react, result } = await runTurn({ steps: [...deltaStepsWithRenders.slice(0, 6), { networkError: true }] });
  assert.equal(result.outcome, "caught");
  assert.equal(result.serverReportedError, false);
  assert.ok(lastOf(react.msgs).roamie, "partial kept on network failure (original behavior)");
});

await check("P7 正常 delta→final→done → 不觸發重置（outcome ok、最後一則仍是串流內容）", async () => {
  const finalEv = `event: final\ndata: ${AI_JSON}\n\n`;
  const { react, result } = await runTurn({ steps: [...deltaStepsWithRenders, { chunk: finalEv + "event: done\ndata: {}\n\n" }] });
  assert.equal(result.outcome, "ok");
  assert.equal(result.serverReportedError, false);
  assert.ok(lastOf(react.msgs).roamie?.recommendations?.length, "streamed content kept");
});

// 任務單 #17 補充：streamPartials Set 的邊界
await check("P2s［StrictMode］最後一段 delta＋error 同一 chunk → state 與 msgsRef 都不含殘缺卡", async () => {
  const head = DELTAS.slice(0, -1).flatMap((d) => [{ chunk: sseDelta(d) }, { render: true }]);
  const { react, refAtCatch, candidatesAtCatch } = await runTurn({
    strict: true,
    steps: [...head, { chunk: sseDelta(DELTAS.at(-1)) + sseError("credits_settle_failed") }],
  });
  assert.deepEqual(lastOf(react.msgs), { role: "assistant", content: "" });
  assert.deepEqual(lastOf(refAtCatch), { role: "assistant", content: "" });
  assert.deepEqual(candidatesAtCatch, ["先前咖啡"]);
});

await check("P8 msgsRef 尚未同步佔位（最後一則是先前回合的 assistant 推薦）＋delta＋error 同一 chunk → msgsRef 的先前推薦不得被誤刪；state 還原為空佔位", async () => {
  const initial = [{ role: "user", content: "推薦咖啡廳" }, PRIOR];
  const { react, refAtCatch, candidatesAtCatch } = await runTurn({
    initial,
    renderPlaceholder: false,
    steps: [{ chunk: DELTAS.map(sseDelta).join("") + sseError("provider_error") }],
  });
  assert.equal(lastOf(refAtCatch), PRIOR, "prior assistant message in msgsRef must be untouched (identity)");
  assert.deepEqual(candidatesAtCatch, ["先前咖啡"]);
  assert.equal(react.msgs.length, 3);
  assert.equal(react.msgs[1], PRIOR, "prior message preserved in state");
  assert.deepEqual(lastOf(react.msgs), { role: "assistant", content: "" });
});

await check("P9 先前回合的 assistant roamie 與本次 partial 內容相同（deep-equal 但不同物件）→ 只比 identity，不誤刪先前訊息", async () => {
  // Prior turn shows exactly what this stream's final partial would parse to.
  const twin = { role: "assistant", content: "這三間很適合下午", roamie: JSON.parse(AI_JSON) };
  const initial = [{ role: "user", content: "推薦咖啡廳" }, twin];
  const { react, refAtCatch } = await runTurn({
    initial,
    renderPlaceholder: false,
    steps: [{ chunk: DELTAS.map(sseDelta).join("") + sseError("provider_error") }],
  });
  assert.equal(lastOf(refAtCatch), twin, "deep-equal prior message must not be reset");
  assert.equal(react.msgs[1], twin);
  assert.deepEqual(lastOf(react.msgs), { role: "assistant", content: "" });
});

await check("NET 全程沒有任何非 mock 的網路請求", () => {
  assert.deepEqual(NET_BLOCKED, []);
});

Object.assign(console, quiet);
fs.rmSync(tmp, { recursive: true, force: true });
out(`\n${passCount} passed, ${failures.length} failed`);
if (failures.length) out("FAILED: " + failures.join(" | "));
process.exit(failures.length ? 1 : 0);
