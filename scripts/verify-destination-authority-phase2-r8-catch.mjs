#!/usr/bin/env node
/**
 * R8 — L-1 微修獨立複驗：send() 外層 catch 區塊「逐字執行」probe（不鏡像、不重寫）。
 *
 * 做法：從三版 _app.chat.tsx（work = L-1 後、F8 = scratchpad/_app.chat.pre-L1.tsx、F6 = scratchpad/_app.chat.pre-F7.tsx）
 *   擷取 `} catch (error) { logAppError("CHAT_STATE_MACHINE_ERROR", …` 到 send() 結尾的原始碼本體，
 *   以 typescript.transpileModule 去型別後包成 async 函式逐字執行（等同 send() 進入外層 catch 之後的行為；
 *   catch 內若再拋例外 → 函式 reject = send() promise reject）。
 *   withoutUnconfirmedSessionDestinations、chatRuntimeCopy、isChatRuntimeCopy 一律載入真實模組；
 *   applyLocalFallback / setMsgs / setText 等 React 閉包為 mock（計數）。
 *
 * 另驗：L-1 只動 _app.chat.tsx（其餘 src 與 post-F8-sha.txt 相同）、work 與 pre-L1 的差異只有 3 行搬移。
 * 安全：Mock Key、清除真實 Key 環境變數、攔截 fetch / http(s) / net / tls；任何外部請求 → FAIL。
 * 執行：node scripts/verify-destination-authority-phase2-r8-catch.mjs
 */
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const MOCK_ENV = {
  GOOGLE_MAPS_API_KEY: "mock-key",
  VITE_GOOGLE_MAPS_API_KEY: "mock-key",
  OPENWEATHER_API_KEY: "mock-key",
  OPENAI_API_KEY: "mock-key",
  VITE_SUPABASE_URL: "http://mock-supabase.invalid",
  VITE_SUPABASE_PUBLISHABLE_KEY: "mock-key",
  SUPABASE_URL: "http://mock-supabase.invalid",
  SUPABASE_PUBLISHABLE_KEY: "mock-key",
};
const SECRET_RE = /KEY|SECRET|TOKEN|PRIVATE|PASSWORD|SUPABASE|OPENAI|GOOGLE|WEATHER|APPLE|CAPACITOR|ROAMIE_ADMIN/i;
for (const k of Object.keys(process.env)) if (SECRET_RE.test(k) && !(k in MOCK_ENV)) delete process.env[k];
Object.assign(process.env, MOCK_ENV);

const { createRequire } = await import("node:module");
const require = createRequire(`${WORK_ROOT}/package.json`);
const ext = [];
const trap = (kind, d) => {
  ext.push(`${kind}:${String(d).slice(0, 120)}`);
  throw new Error(`[ext-trap] ${kind}`);
};
globalThis.fetch = async (i) => trap("fetch", typeof i === "string" ? i : i?.url);
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
http.request = http.get = (a) => trap("http", a?.href ?? a);
https.request = https.get = (a) => trap("https", a?.href ?? a);
net.connect = net.createConnection = (a) => trap("net", a?.host ?? a);
tls.connect = (a) => trap("tls", a?.host ?? a);

const { readFileSync, existsSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { execFileSync } = await import("node:child_process");
const git = (args) => execFileSync("git", args, { cwd: WORK_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const ts = require("typescript");

const checks = [];
const reports = {};
const check = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });

// ── 0. 檔案層：L-1 只動 _app.chat.tsx ──
const APP = "src/routes/_app.chat.tsx";
const VERS = {
  L1: readFileSync(`${WORK_ROOT}/${APP}`, "utf8"),
  F8: readFileSync(`${PRE_DIR}/_app.chat.pre-L1.tsx`, "utf8"),
  F6: readFileSync(`${PRE_DIR}/_app.chat.pre-F7.tsx`, "utf8"),
};
{
  const snap = readFileSync(`${PRE_DIR}/post-F8-sha.txt`, "utf8").split("\n").filter(Boolean);
  const diff = [];
  for (const line of snap) {
    const m = line.match(/^([0-9a-f]{40})\s+(.+)$/);
    if (!m || !m[2].startsWith("src/")) continue;
    const f = `${WORK_ROOT}/${m[2]}`;
    const now = existsSync(f) ? createHash("sha1").update(readFileSync(f)).digest("hex") : "(missing)";
    if (now !== m[1]) diff.push(m[2]);
  }
  const snapSrc = new Set(snap.map((l) => l.slice(42)).filter((f) => f.startsWith("src/")));
  const changedNow = [...git(["diff", "--name-only", "HEAD", "--", "src"]).split("\n"), ...git(["ls-files", "--others", "--exclude-standard", "--", "src"]).split("\n")].filter(Boolean);
  const outside = changedNow.filter((f) => !snapSrc.has(f));
  check("FILE-only-app-chat", diff.length === 1 && diff[0] === APP && outside.length === 0, `與 post-F8 sha 不同的 src=${JSON.stringify(diff)}；快照外新變動=${JSON.stringify(outside)}`);
  const preL1Sha = createHash("sha1").update(VERS.F8).digest("hex");
  const want = snap.find((l) => l.endsWith(`  ${APP}`))?.slice(0, 40);
  check("FILE-preL1-backup=postF8", preL1Sha === want, `pre-L1 備份 sha=${preL1Sha} post-F8 快照=${want}`);
  // 行級差異：移除 3 行搬移後兩版必須完全相同
  const MOVED = [
    "      // Retry from the turn-start snapshot, carrying over only the position this turn already",
    "      // acquired (cleaned against turnStartSession; unconfirmed / Trip Add Place stays pre-turn).",
    "      const turnLocation = withoutUnconfirmedSessionDestinations(nextSession, turnStartSession);",
  ];
  const a = VERS.F8.split("\n");
  const b = VERS.L1.split("\n");
  const aIdx = a.indexOf(MOVED[2]);
  const bIdx = b.indexOf(`  ${MOVED[2]}`);
  const aRest = a.filter((l, i) => !(i >= aIdx - 2 && i <= aIdx));
  const bRest = b.filter((l, i) => !(i >= bIdx - 2 && i <= bIdx));
  const moveOk =
    aIdx > 0 && bIdx > 0 && MOVED.every((m, k) => a[aIdx - 2 + k] === m && b[bIdx - 2 + k] === `  ${m}`) && aRest.join("\n") === bRest.join("\n") && a[aIdx + 1] === "      try {" && b[bIdx - 3] === "      try {";
  check("FILE-diff-is-pure-move", moveOk, `F8 turnLocation L${aIdx + 1}（try 在 L${aIdx + 2}）→ L-1 turnLocation L${bIdx + 1}（try 在 L${bIdx - 2}）；其餘逐字相同=${aRest.join("\n") === bRest.join("\n")}`);
}

// ── 1. 擷取 catch 本體 ──
const START = '    } catch (error) {\n      logAppError("CHAT_STATE_MACHINE_ERROR", error);';
const END = "\n    }\n  };\n\n  const handleGenerateItinerary = async (";
const NAMES = [
  "logAppError",
  "stopDiscoveringLoadingAnimation",
  "setStreaming",
  "setGenerating",
  "msgs",
  "displayMessage",
  "withoutUnconfirmedSessionDestinations",
  "nextSession",
  "turnStartSession",
  "applyLocalFallback",
  "session",
  "trimmed",
  "setText",
  "setMsgs",
  "isChatRuntimeCopy",
  "chatRuntimeCopy",
  "locale",
];
const bodies = {};
const fns = {};
for (const [v, src] of Object.entries(VERS)) {
  const s = src.indexOf(START);
  const s2 = src.indexOf(START, s + 1);
  const e = src.indexOf(END, s);
  if (s < 0 || s2 >= 0 || e < 0) {
    check(`EXTRACT-${v}`, false, `start=${s} dupStart=${s2} end=${e}`);
    continue;
  }
  const body = src.slice(s + "    } catch (error) {".length, e);
  bodies[v] = body;
  const tsSrc = `export default async function __catch(__ctx: any, error: unknown) {\n  const { ${NAMES.join(", ")} } = __ctx;\n${body}\n}\n`;
  const js = ts.transpileModule(tsSrc, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const fnSrc = js.replace("export default async function __catch", "return async function __catch");
  try {
    fns[v] = new Function("ChatMsg", fnSrc)();
    check(`EXTRACT-${v}`, true, `catch 本體 ${body.split("\n").length} 行（L${src.slice(0, s).split("\n").length}）`);
  } catch (err) {
    check(`EXTRACT-${v}`, false, `compile: ${err?.message}`);
  }
}
// 擷取出的本體中，turnLocation 必須在（L1）／不在（F8）內層 try 內
const tryAt = (b) => b.indexOf("\n      try {\n");
const tlAt = (b) => b.indexOf("const turnLocation = withoutUnconfirmedSessionDestinations(nextSession, turnStartSession);");
check("EXTRACT-L1-turnLocation-inside-try", bodies.L1 && tlAt(bodies.L1) > tryAt(bodies.L1) && tryAt(bodies.L1) > 0 && tlAt(bodies.L1) < bodies.L1.indexOf("} catch (fallbackError) {"), `L1 try@${tryAt(bodies.L1 ?? "")} turnLocation@${tlAt(bodies.L1 ?? "")}`);
check("EXTRACT-F8-turnLocation-outside-try(基準)", bodies.F8 && tlAt(bodies.F8) > 0 && tlAt(bodies.F8) < tryAt(bodies.F8), `F8 try@${tryAt(bodies.F8 ?? "")} turnLocation@${tlAt(bodies.F8 ?? "")}`);

// ── 2. 真實模組 ──
const { createServer } = await import("vite");
const { ViteNodeServer } = await import("vite-node/server");
const { ViteNodeRunner } = await import("vite-node/client");
const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
const server = await createServer({
  root: WORK_ROOT,
  configFile: false,
  envDir: false,
  logLevel: "silent",
  clearScreen: false,
  plugins: [tsconfigPaths()],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await server.environments.client.pluginContainer.buildStart({});
const vn = new ViteNodeServer(server);
const runner = new ViteNodeRunner({
  root: server.config.root,
  base: server.config.base,
  fetchModule: (id) => vn.fetchModule(id),
  resolveId: (id, importer) => vn.resolveId(id, importer),
});
await runner.executeId("/@vite/env");
const ctdMod = await runner.executeFile(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`);
const copyMod = await runner.executeFile(`${WORK_ROOT}/src/lib/chat-runtime-copy.ts`).catch(async () => runner.executeFile(`${WORK_ROOT}/src/lib/chat-runtime-copy.tsx`));

const origWarn = console.warn;
const origInfo = console.info;
const origLog = console.log;
const origErr = console.error;

// ── 3. 情境 ──
const B0 = () => ({ recommendedPlaces: [], selectedPlaces: [], phase: "discover", discovery: {}, updatedAt: "2026-01-01T00:00:00.000Z" });
const GPS = { lat: 24.18, lng: 120.62 };
const KYOTO = { lat: 35.0116, lng: 135.7681 };
const beforeB = () => ({
  ...B0(),
  location: { ...GPS, city: "台中市" },
  nearbyLocationAuthority: { displayLabel: "台中市", ...GPS, source: "device" },
  travelContext: { interests: [], currentLocation: "台中市" },
});
const LOCALE = "zh-TW";
const RECOVERY = copyMod.chatRuntimeCopy("recovery", LOCALE);
const TEXT = "改去京都看楓葉推薦景點";

async function runCatch(ver, sc) {
  const fn = fns[ver];
  const st = { msgs: [...(sc.initialMsgs ?? [])], setText: [], fallbackCalls: [], warns: [], appErrors: 0, ctdCalls: 0, streaming: [], generating: [] };
  const ctx = {
    logAppError: () => (st.appErrors += 1),
    stopDiscoveringLoadingAnimation: () => {},
    setStreaming: (v) => st.streaming.push(v),
    setGenerating: (v) => st.generating.push(v),
    msgs: sc.msgsClosure ?? [],
    displayMessage: sc.text ?? TEXT,
    withoutUnconfirmedSessionDestinations: (...a) => {
      st.ctdCalls += 1;
      return ctdMod.withoutUnconfirmedSessionDestinations(...a);
    },
    nextSession: sc.nextSession,
    turnStartSession: sc.turnStartSession,
    applyLocalFallback: async (s, text, conv, reason, tss) => {
      st.fallbackCalls.push({ location: s.location ?? null, authority: s.nearbyLocationAuthority ?? null, preferredArea: s.preferredArea, reason, tssIsTurnStart: tss === sc.turnStartSession, sessionBaseIsSession: s.pendingClarification === sc.session.pendingClarification, convLen: conv.length });
      if (sc.fallback === "throw") throw new Error("fallback boom");
      return sc.fallback === true;
    },
    session: sc.session,
    trimmed: sc.text ?? TEXT,
    setText: (v) => st.setText.push(v),
    setMsgs: (u) => {
      st.msgs = typeof u === "function" ? u(st.msgs) : u;
    },
    isChatRuntimeCopy: copyMod.isChatRuntimeCopy,
    chatRuntimeCopy: copyMod.chatRuntimeCopy,
    locale: LOCALE,
  };
  console.warn = (...a) => st.warns.push(a.map(String).join(" ").slice(0, 160));
  console.info = console.log = console.error = () => {};
  let rejected = null;
  try {
    await fn(ctx, new Error("state machine boom"));
  } catch (e) {
    rejected = String(e?.message ?? e).slice(0, 160);
  } finally {
    console.warn = origWarn;
    console.info = origInfo;
    console.log = origLog;
    console.error = origErr;
  }
  const recoveryCount = st.msgs.filter((m) => m.role === "assistant" && m.content === RECOVERY).length;
  const last = st.msgs.at(-1);
  return {
    rejected,
    recoveryShown: last?.role === "assistant" && last.content === RECOVERY,
    recoveryCount,
    msgsLen: st.msgs.length,
    setText: st.setText,
    fallbackCalls: st.fallbackCalls,
    fallbackFailedWarn: st.warns.some((w) => w.includes("[CHAT_STATE_MACHINE_FALLBACK_FAILED]")),
    stateMachineWarn: st.warns.some((w) => w.includes("[CHAT_STATE_MACHINE_ERROR]")),
    appErrors: st.appErrors,
    ctdCalls: st.ctdCalls,
    streamingOff: st.streaming.at(-1) === false && st.generating.at(-1) === false,
  };
}

const userMsg = { role: "user", content: TEXT };
const SC = {};
// A：正常 Session — 本輪取得 GPS（before 無位置），fallback 成功
SC["A1-normal-fallbackApplied"] = () => {
  const before = B0();
  const next = { ...before, location: { ...GPS, city: "" }, nearbyLocationAuthority: { displayLabel: "", ...GPS, source: "device" }, preferredArea: "京都", travelContext: { interests: [], destination: "京都", currentLocation: "京都" } };
  return { session: before, turnStartSession: { ...before, pendingClarification: undefined }, nextSession: next, fallback: true };
};
// A2：正常 Session — 輪前 GPS 台中（F 本輪 GPS 保留），fallback 未接手 → recovery
SC["A2-prevGps-fallbackFalse"] = () => {
  const before = beforeB();
  const next = { ...before, location: { ...GPS, city: "京都" }, preferredArea: "京都", travelContext: { interests: [], destination: "京都", currentLocation: "京都" } };
  return { session: before, turnStartSession: { ...before, pendingClarification: undefined }, nextSession: next, fallback: false };
};
// C1：fallback 自身拋例外 → 內層 catch → recovery
SC["C1-fallbackThrows"] = () => {
  const before = beforeB();
  return { session: before, turnStartSession: { ...before }, nextSession: { ...before }, fallback: "throw" };
};
// C2：最後一則已是 recovery → 不重複
SC["C2-recoveryAlreadyLast"] = () => {
  const before = beforeB();
  return { session: before, turnStartSession: { ...before }, nextSession: { ...before }, fallback: false, initialMsgs: [userMsg, { role: "assistant", content: RECOVERY }] };
};
// C3：user turn 已在畫面最後 → 不重複補 user
SC["C3-userTurnAlreadyLast"] = () => {
  const before = beforeB();
  return { session: before, turnStartSession: { ...before }, nextSession: { ...before }, fallback: false, initialMsgs: [userMsg] };
};
// G：未確認京都（本輪佔位座標 0,0 + city 京都）不得污染 retry 所在地
SC["G-unconfirmedKyotoNoPollute"] = () => {
  const before = beforeB();
  const next = { ...before, location: { lat: 0, lng: 0, city: "京都" }, preferredArea: "京都", travelContext: { interests: [], destination: "京都", currentLocation: "京都" } };
  return { session: before, turnStartSession: { ...before, pendingClarification: undefined }, nextSession: next, fallback: false };
};
// H：真實位於京都（輪前 GPS 京都）不得被清掉
SC["H-realKyotoGpsKept"] = () => {
  const before = { ...B0(), location: { ...KYOTO, city: "京都" }, nearbyLocationAuthority: { displayLabel: "京都", ...KYOTO, source: "device" }, travelContext: { interests: [], currentLocation: "京都" } };
  const next = { ...before, preferredArea: "京都", travelContext: { interests: [], destination: "京都", currentLocation: "京都" } };
  return { session: before, turnStartSession: { ...before, pendingClarification: undefined }, nextSession: next, fallback: false };
};
// B：Session 欄位型別異常（nextSession / turnStartSession）
const bad = (label, mut, where = "next") => () => {
  const before = beforeB();
  const next = { ...before, location: { ...GPS, city: "台中市" } };
  const ts0 = { ...before, pendingClarification: undefined };
  return where === "next" ? { session: before, turnStartSession: ts0, nextSession: mut(next), fallback: false, label } : { session: before, turnStartSession: mut(ts0), nextSession: next, fallback: false, label };
};
SC["B1-next.preferredArea=number"] = bad("preferredArea=123", (s) => ({ ...s, preferredArea: 123 }));
SC["B2-next.tripPlanningContext.destination=number"] = bad("tpc.destination=42", (s) => ({ ...s, tripPlanningContext: { selectedPlaces: [], destination: 42 } }));
SC["B3-next.travelContext.destinationCity=number"] = bad("destinationCity=7", (s) => ({ ...s, travelContext: { interests: [], destinationCity: 7 } }));
SC["B4-turnStart.preferredArea=number"] = bad("turnStart.preferredArea=123", (s) => ({ ...s, preferredArea: 123 }), "turnStart");
SC["B5-next.location=null"] = bad("location=null", (s) => ({ ...s, location: null }));
SC["B6-next.tripDestination.city=number"] = bad("tripDestination.city=9", (s) => ({ ...s, tripDestination: { city: 9 } }));
SC["B7-next.preferredArea=number+fallbackTrue"] = () => ({ ...bad("preferredArea=123", (s) => ({ ...s, preferredArea: 123 }))(), fallback: true });

const results = {};
for (const ver of ["L1", "F8", "F6"]) {
  if (!fns[ver]) continue;
  results[ver] = {};
  for (const [id, mk] of Object.entries(SC)) {
    const sc = mk();
    // ctd 是否會在此輸入拋例外（同一輸入直接呼叫真實模組）
    let ctdThrows = null;
    try {
      ctdMod.withoutUnconfirmedSessionDestinations(sc.nextSession, sc.turnStartSession);
      ctdThrows = false;
    } catch (e) {
      ctdThrows = String(e?.message ?? e).slice(0, 100);
    }
    const r = await runCatch(ver, sc);
    r.ctdThrows = ctdThrows;
    results[ver][id] = r;
  }
}
reports.results = results;

const L = results.L1 ?? {};
const F = results.F8 ?? {};
const isLL = (l, p) => Boolean(l) && l.lat === p.lat && l.lng === p.lng;
const common = (r) => r && r.appErrors === 1 && r.stateMachineWarn && r.streamingOff;
// A
{
  const r = L["A1-normal-fallbackApplied"];
  const fc = r?.fallbackCalls[0];
  check("A1-normal-fallbackApplied", common(r) && !r.rejected && r.fallbackCalls.length === 1 && isLL(fc.location, GPS) && fc.authority?.source === "device" && fc.reason === "state_machine_error" && fc.tssIsTurnStart && fc.preferredArea === undefined && JSON.stringify(r.setText) === '[""]' && r.recoveryCount === 0 && r.msgsLen === 0, JSON.stringify(r));
  check("A1-equal-F8", JSON.stringify(r) === JSON.stringify(F["A1-normal-fallbackApplied"]), "L1 與 F8 結果逐欄相同");
}
{
  const r = L["A2-prevGps-fallbackFalse"];
  const fc = r?.fallbackCalls[0];
  check("A2/F-prevGps-kept", common(r) && !r.rejected && r.fallbackCalls.length === 1 && isLL(fc.location, GPS) && fc.location.city === "台中市" && fc.authority?.displayLabel === "台中市" && r.recoveryShown && r.recoveryCount === 1 && JSON.stringify(r.setText) === '[""]' && r.msgsLen === 2, JSON.stringify(r));
  check("A2-equal-F8", JSON.stringify(r) === JSON.stringify(F["A2-prevGps-fallbackFalse"]), "L1 與 F8 結果逐欄相同");
}
// C
{
  const r = L["C1-fallbackThrows"];
  check("C1-fallbackThrows→recovery", common(r) && !r.rejected && r.fallbackFailedWarn && r.recoveryShown && r.recoveryCount === 1 && r.fallbackCalls.length === 1, JSON.stringify(r));
  check("C1-equal-F8", JSON.stringify(r) === JSON.stringify(F["C1-fallbackThrows"]), "L1 與 F8 結果逐欄相同");
  const r2 = L["C2-recoveryAlreadyLast"];
  // 既有行為（F6 起相同）：hasUserTurn 只看最後一則是否為本輪 user；最後一則是 recovery 時會補 user 再補 recovery，
  // 去重分支（last 為 recovery）在此 updater 內不可達。本檢查只要求 L1 與 F6 基準一致，不把既有行為當 L-1 缺陷。
  const f6r2 = results.F6?.["C2-recoveryAlreadyLast"];
  check("C2-recoveryAlreadyLast(=F6 既有行為)", !r2.rejected && r2.recoveryShown && r2.recoveryCount === f6r2?.recoveryCount && r2.msgsLen === f6r2?.msgsLen, `L1=${JSON.stringify({ rec: r2.recoveryCount, len: r2.msgsLen })} F6=${JSON.stringify({ rec: f6r2?.recoveryCount, len: f6r2?.msgsLen })}`);
  check("C2-equal-F8", JSON.stringify(r2) === JSON.stringify(F["C2-recoveryAlreadyLast"]), "L1 與 F8 結果逐欄相同");
  const r3 = L["C3-userTurnAlreadyLast"];
  check("C3-noDuplicateUser", !r3.rejected && r3.recoveryCount === 1 && r3.msgsLen === 2 && r3.recoveryShown, JSON.stringify(r3));
  check("C3-equal-F8", JSON.stringify(r3) === JSON.stringify(F["C3-userTurnAlreadyLast"]), "L1 與 F8 結果逐欄相同");
}
// G / H
{
  const r = L["G-unconfirmedKyotoNoPollute"];
  const fc = r?.fallbackCalls[0];
  check("G-unconfirmedKyotoNoPollute", !r.rejected && fc && isLL(fc.location, GPS) && fc.location.city === "台中市" && !String(fc.authority?.displayLabel ?? "").includes("京都"), JSON.stringify(fc));
  check("G-equal-F8", JSON.stringify(r) === JSON.stringify(F["G-unconfirmedKyotoNoPollute"]), "L1 與 F8 結果逐欄相同");
  const h = L["H-realKyotoGpsKept"];
  const hc = h?.fallbackCalls[0];
  check("H-realKyotoGpsKept", !h.rejected && hc && isLL(hc.location, KYOTO) && hc.location.city === "京都" && hc.authority?.displayLabel === "京都", JSON.stringify(hc));
  check("H-equal-F8", JSON.stringify(h) === JSON.stringify(F["H-realKyotoGpsKept"]), "L1 與 F8 結果逐欄相同");
}
// B：例外不得逃出 catch
for (const id of Object.keys(SC).filter((k) => k.startsWith("B"))) {
  const r = L[id];
  const f = F[id];
  const throwsInput = Boolean(r.ctdThrows);
  // ctd 對此輸入會拋 → L1 必須：不 reject、不呼叫 fallback（無新增 Provider）、FALLBACK_FAILED 警告、recovery 一次、setText("")
  // ctd 不拋 → L1 必須與 F8 逐欄相同
  const ok = throwsInput
    ? common(r) && !r.rejected && r.fallbackCalls.length === 0 && r.fallbackFailedWarn && r.recoveryShown && r.recoveryCount === 1 && JSON.stringify(r.setText) === '[""]'
    : !r.rejected && JSON.stringify(r) === JSON.stringify(f);
  check(`${id}`, ok, `ctdThrows=${JSON.stringify(r.ctdThrows)} L1={rejected:${JSON.stringify(r.rejected)},recovery:${r.recoveryCount},fallbackCalls:${r.fallbackCalls.length},warnFailed:${r.fallbackFailedWarn},setText:${JSON.stringify(r.setText)}} F8={rejected:${JSON.stringify(f?.rejected)},recovery:${f?.recoveryCount},fallbackCalls:${f?.fallbackCalls.length},setText:${JSON.stringify(f?.setText)}}`);
}
// 至少一個異常輸入確實讓 ctd 拋例外，且 F8 在該輸入 reject（證明本 probe 能重現 L-1 修正的缺陷）
{
  const thrown = Object.keys(SC).filter((k) => k.startsWith("B") && L[k].ctdThrows);
  const f8Rejects = thrown.filter((k) => F[k]?.rejected && F[k].recoveryCount === 0);
  check("B-reproduces-F8-defect", thrown.length > 0 && f8Rejects.length === thrown.length, `ctd 會拋的輸入=${JSON.stringify(thrown)}；F8 在其上 reject 且無 recovery=${JSON.stringify(f8Rejects)}`);
}
// Provider：L1 的 applyLocalFallback 呼叫數 ≤ F8（每個情境）
{
  const more = Object.keys(SC).filter((k) => (L[k]?.fallbackCalls.length ?? 0) > (F[k]?.fallbackCalls.length ?? 0));
  const tot = (R) => Object.values(R).reduce((n, r) => n + r.fallbackCalls.length, 0);
  check("K-noExtraFallbackCalls", more.length === 0, `L1 總 applyLocalFallback=${tot(L)} F8=${tot(F)}；L1 較多的情境=${JSON.stringify(more)}`);
}
check("EXTERNAL=0", ext.length === 0, JSON.stringify(ext));

await server.close().catch(() => {});
const lines = [];
lines.push("══ R8 catch 逐字執行 probe（L1 = 現行、F8 = pre-L1、F6 = pre-F7）══");
for (const c of checks) lines.push(`  ${c.ok ? "PASS" : "FAIL"} ${c.id} :: ${c.detail}`);
lines.push("\n══ 版本對照（rejected / recovery / fallbackCalls / ctdThrows）══");
for (const id of Object.keys(SC)) {
  const cell = (v) => {
    const r = results[v]?.[id];
    return r ? `rej=${r.rejected ? "Y" : "n"} rec=${r.recoveryCount} fb=${r.fallbackCalls.length}` : "-";
  };
  lines.push(`  ${id.padEnd(46)} L1[${cell("L1")}] F8[${cell("F8")}] F6[${cell("F6")}] ctdThrows=${JSON.stringify(results.L1?.[id]?.ctdThrows)}`);
}
const fail = checks.filter((c) => !c.ok).length;
lines.push(`\nverify-destination-authority-phase2-r8-catch: checks=${checks.length} FAIL=${fail} external=${ext.length} → ${fail === 0 ? "PASS" : "FAIL"}`);
process.stdout.write(lines.join("\n") + "\n", () => process.exit(fail === 0 ? 0 : 1));
