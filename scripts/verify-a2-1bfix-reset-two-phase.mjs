#!/usr/bin/env node
/**
 * 任務單 #T125（tester）— A2 1b 定點修正：applyConfirmedDestinationSwitch Reset 兩階段（Prepare → Validate → Commit）函式層驗收。
 *
 * 執行方式（由使用者以既有離線 Guard Runner 執行；tester 不執行）：
 *   vite-node --config <scratchpad>/planner-reset-vite.config.mjs scripts/verify-a2-1bfix-reset-two-phase.mjs
 *   （offline-guard 以 --import 預載）
 *
 * 只 import 正式 src 模組（絕對路徑，同 scripts/verify-negated-switch-s1s4.mjs:153-159）：
 *   chat-session、travel-context、trip-planning-session-reset、trip-planning-context、ai-planning-session、
 *   planner-session-guard、resolved-destination-scope、ai-pipeline-log。
 *   不 import 網路／Provider／Supabase／Credits 模組；不讀 .env；process.env 只讀 OFFLINE_GUARD_LOG 一個變數（Guard 記錄檔路徑）；
 *   fetch／worker_threads.Worker／child_process 一律包裝計數，只轉交覆寫前（Guard）的版本（任何外部請求 → FAIL）。
 *   NET：結束時 Guard 記錄（OFFLINE_GUARD_LOG）本測試期間新增行數必須 0；變數或檔案不存在 → 「Guard 記錄無法觀察」FAIL。
 *   不修改任何 source；全域狀態只用既有 export 觀察：
 *     凍結 dayPlan      → getFrozenPlanningDayPlan（ai-planning-session.ts:30）
 *     Planner Session   → getPlannerSessionItemCount（planner-session-guard.ts:179）
 *     Planner Run／Stage → 無唯讀 getter；只在每案最後以 beginPlannerRun／beginPipelineStage 探測（已完成 → 回 false，不改狀態）
 *     範圍快取          → getResolvedDestinationScope（resolved-destination-scope.ts:341）
 *   Log：攔截 console.info／console.warn 計數。[PLANNER_SESSION_RESET]（planner-session-guard.ts:171）與
 *     [TRIP_RESET_COMMIT_STEP_FAILED] 直接走 console → 永遠可觀察；[NEW_TRIP_SESSION_CREATED]／[TRIP_CONTEXT_RESET]／
 *     [TRIP_CONTEXT_AFTER_RESET]／[PLANNER_SESSION_NEW] 走 logAiPipeline（dev-verbose-log.ts，VITE_VERBOSE_LOG 關閉時不輸出）
 *     → isAiPipelineLogEnabled() 為 false 時標「無法觀察」，不當 PASS 依據（本檔不改 env）。
 *
 * 停止案例的不變條件（每個「未套用」結果都檢查，含 applied:false／throw）：
 *   base deep-equal 呼叫前快照、planningSessionId／planVersion 不變、凍結 dayPlan 與 Planner 狀態仍在、範圍快取仍在
 *   （await macrotask 後再查，抓排程的非同步清除）、Reset log 0、Commit 失敗 log 0、外部請求 0。
 * 停止原因可達性（讀碼推論，交接報告另述）：
 *   second_reset_required（路徑 B，Prepare 後檢查 tc:1587）→ 不可達／無法構成：Prepare session 的目的地＝normalize(label)，日期／月份
 *     由同一句話解析，pendingQuestion 清空、phase done→discover；只有 normalizeDestinationLabel 非冪等或跨日界才可能觸發。不硬造。
 *   second_reset_required（merge 後 tc:1611）、destination_not_applied（tc:1615）→ 以候選真實輸入嘗試；未構成者印 NOT-CONSTRUCTED，
 *     該停止原因全部候選都未構成 → UNVERIFIED（不算 PASS，也不因 fixture 未達而判 FAIL）。
 *
 * #T128b 補強：
 *   F1／F2 Commit 刪除「之前」注入失敗（不改 Source；只在 applyConfirmedDestinationSwitch 呼叫期間暫時攔截內建原型，try/finally 還原）：
 *     F1 clear_frozen_day_plan：攔截 Map.prototype.delete，僅當 key＝舊 sid 且該 Map 目前存放的值＝本測試 seed 的 dayPlan 物件
 *        （唯一對應 ai-planning-session.ts:17 frozenDayPlanBySession）時，在 ai-planning-session.ts:42 delete 執行前拋錯。
 *     F2 reset_planner_session：攔截 Set.prototype.delete，僅當 value＝舊 sid 時（planner-session-guard.ts:160
 *        activePlannerSessions.delete，resetPlannerSession 內第一個刪除）在刪除前拋錯 → 該函式內 :161-176 全部未執行。
 *     兩者都只觸發一次；以 [TRIP_RESET_COMMIT_STEP_FAILED] step＝預期步驟＋注入訊息確認注入點落在 Commit 內。
 *     斷言：applied:true、新 sid／planVersion+1、後續步驟仍執行（範圍快取清除、session/context log）、每個元件最終狀態，
 *     並以 MIXED-STATE 列出「部分清除」的混合狀態（依設計往前完成、不回滾）。
 *   OK-A-keepnew／OK-B-keepnew：預先放入新目的地（大阪）範圍快取，Commit 後（await macrotask）必須保留。
 *   D4–D6：destination_not_applied 新候選（「不要去X了，去Y」：EXPLICIT_PRIMARY_SWITCH_RE 命中但 CAPTURE 不命中 →
 *     resolveIncomingDestinationFromText 回 undefined，merge 仍可能解析出 Y）。
 *   L6：多個 Fixture 依序嘗試，只有「主路徑結果 destination 確實不同於舊目的地」者才視為適用；全部不適用 → UNVERIFIED。
 * 任一 FAIL → process.exitCode = 1。
 */
const oi = console.info, ow = console.warn;
const out = (...a) => process.stdout.write(a.join(" ") + "\n");

// ── Log 攔截（計數；可選擇對指定 tag 注入例外，用來測 Commit 步驟失敗）──
const tagLog = [];
let throwOnTag = null;
const capture = (kind) => (...args) => {
  const tag = typeof args[0] === "string" ? args[0] : "";
  tagLog.push({ kind, tag, text: args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ") });
  if (throwOnTag && tag === throwOnTag) throw new Error(`T125 injected console failure: ${tag}`);
};
console.info = capture("info");
console.warn = capture("warn");

// ── offline guard：計數後轉呼叫覆寫前的 fetch；guard 不存在時直接丟錯，絕不轉呼叫真實 fetch ──
const priorFetch = globalThis.fetch;
const guardActive = globalThis.__OFFLINE_GUARD__ === true;
let externalCalls = 0;
globalThis.fetch = async (...args) => {
  externalCalls += 1;
  if (guardActive && typeof priorFetch === "function") return priorFetch(...args);
  throw new Error("[a2-1bfix-reset] 禁止外部請求（offline-guard 未預載，不轉呼叫真實 fetch）");
};

// ── Guard 記錄（只讀 OFFLINE_GUARD_LOG 這一個 env；多支測試共用同一檔 → 只計本測試開始後新增的行）──
const fs = (await import("node:fs")).default;
const GUARD_LOG = process.env.OFFLINE_GUARD_LOG;
function readGuardLogLines() {
  if (!GUARD_LOG) return null;
  try { return fs.readFileSync(GUARD_LOG, "utf8").split("\n").filter((l) => l.length > 0); } catch { return null; }
}
const guardLogStart = readGuardLogLines();

// ── Worker／child_process：只包裝計數，轉交覆寫前（Guard 已替換）的版本；Guard 不存在 → 直接丟錯，不轉呼叫真實版本 ──
// 註：只攔截模組物件屬性；具名 ESM import 的綁定不經過這裡，仍由 Guard 擋並記錄（以 Guard 記錄為準）。
const wtMod = (await import("node:worker_threads")).default;
const cpMod = (await import("node:child_process")).default;
const priorWorker = wtMod.Worker;
let workerCalls = 0;
wtMod.Worker = class CountedWorker {
  constructor(...args) {
    workerCalls += 1;
    if (guardActive && typeof priorWorker === "function") return new priorWorker(...args);
    throw new Error("[a2-1bfix-reset] 禁止 Worker（offline-guard 未預載）");
  }
};
const CP_KEYS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];
const priorCp = Object.fromEntries(CP_KEYS.map((k) => [k, cpMod[k]]));
const cpCalls = [];
for (const k of CP_KEYS) {
  cpMod[k] = function (cmd, ...rest) {
    cpCalls.push(`${k} ${String(cmd).split("/").pop()}`);
    if (guardActive && typeof priorCp[k] === "function") return priorCp[k].call(this, cmd, ...rest);
    throw new Error(`[a2-1bfix-reset] 禁止 child_process.${k}（offline-guard 未預載）`);
  };
}
// 內建原型（F1／F2 注入用）：保存原始參照，finally 一律還原
const ORIG_MAP_DELETE = Map.prototype.delete;
const ORIG_MAP_GET = Map.prototype.get;
const ORIG_SET_DELETE = Set.prototype.delete;

let anyFail = false;
let pass = 0, fail = 0;
const unverified = [];
function check(id, ok, detail) {
  if (ok) pass += 1; else { fail += 1; anyFail = true; }
  out(`${ok ? "PASS" : "FAIL"} ${id}${detail ? " — " + detail : ""}`);
}
const fmt = (v) => (v === undefined ? "undefined" : JSON.stringify(v));
const macrotasks = async () => { for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 30)); };

// 深拷貝（讀值；getter 於未啟動時取值）與穩定比較（undefined 也編碼）
function snap(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(snap);
  const o = {};
  for (const k of Object.keys(v)) o[k] = snap(v[k]);
  return o;
}
const enc = (v) => JSON.stringify(v, (_k, x) => (x === undefined ? "__undefined__" : x));
const sameDeep = (a, b) => enc(snap(a)) === enc(snap(b));

const R = "/Users/shuo/Roamie-clean/src";
try {
  const { createEmptySession } = await import(R + "/lib/chat-session.ts");
  const { applyConfirmedDestinationSwitch, mergeTravelContext } = await import(R + "/lib/ai/travel-context.ts");
  const tpsr = await import(R + "/lib/ai/trip-planning-session-reset.ts");
  const { isNewTripPlanning, resolveActiveDestination, resetTripPlanningContext, prepareDestinationChangeReset, commitDestinationChangeReset } = tpsr;
  const { normalizeDestinationLabel } = await import(R + "/lib/ai/trip-planning-context.ts");
  const { freezePlanningDayPlan, getFrozenPlanningDayPlan } = await import(R + "/lib/ai/ai-planning-session.ts");
  const psg = await import(R + "/lib/ai/planner-session-guard.ts");
  const rds = await import(R + "/lib/ai/resolved-destination-scope.ts");
  const { isAiPipelineLogEnabled } = await import(R + "/lib/ai/ai-pipeline-log.ts");

  const pipelineLogOn = Boolean(isAiPipelineLogEnabled());
  out(`pipeline-log(logAiPipeline): ${pipelineLogOn ? "enabled" : "disabled → [NEW_TRIP_SESSION_CREATED]/[TRIP_CONTEXT_RESET]/[TRIP_CONTEXT_AFTER_RESET]/[PLANNER_SESSION_NEW] 無法觀察"}`);
  out(`offline-guard: ${guardActive ? "present" : "absent"}`);
  check("SELF.exports", typeof prepareDestinationChangeReset === "function" && typeof commitDestinationChangeReset === "function" && typeof applyConfirmedDestinationSwitch === "function", "prepare／commit／applyConfirmedDestinationSwitch 皆為 export");

  const PIPE_RESET_TAGS = ["[NEW_TRIP_SESSION_CREATED]", "[PLANNER_SESSION_NEW]", "[TRIP_CONTEXT_RESET]", "[TRIP_CONTEXT_AFTER_RESET]", "[AI_SESSION_CREATE]", "[AI_PLANNING_SESSION_START]"];
  const countSince = (mark, tag, filter) => tagLog.slice(mark).filter((e) => e.tag === tag && (!filter || filter(e))).length;

  // ── 全域狀態 seed／觀察 ──
  const COORDS = {
    京都: [35.0116, 135.7681], 大阪: [34.6937, 135.5023], 東京: [35.6762, 139.6503], 日本: [35.6762, 139.6503], 金沢: [36.5613, 136.6562], 金澤: [36.5613, 136.6562],
  };
  function seedScope(label, scopeId, coords) {
    const [lat, lng] = coords ?? COORDS[label] ?? [35.0, 135.0];
    rds.setResolvedDestinationScope({ displayName: label, normalizedName: label, country: "日本", countryCode: "JP", latitude: lat, longitude: lng, source: "geocode", resolvedAt: 1, scopeId });
  }
  function runKeyFor(sid) { return psg.buildPlannerRunKey({ sessionId: sid, style: "T125", days: 2, poolFingerprint: "t125fp" }); }
  function seedGlobals(sid, scopes) {
    rds.clearResolvedDestinationScope(); // 測試前置：清空範圍快取再 seed（非受測行為）
    for (const s of scopes) seedScope(s.label, s.scopeId, s.coords);
    const dayPlan = { items: [{ id: "T125-item", name: "T125" }] };
    freezePlanningDayPlan(sid, dayPlan);
    psg.beginPlannerSession(sid);
    psg.finishPlannerSession(sid, 7);
    const rk = runKeyFor(sid);
    psg.beginPlannerRun(rk);
    psg.finishPlannerRun(rk, 5);
    psg.beginPipelineStage(sid, "T125_STAGE");
    psg.finishPipelineStage(sid, "T125_STAGE");
    return dayPlan; // F1 注入以物件身分辨識 frozenDayPlanBySession
  }
  function observe(sid, scopes) {
    return {
      frozen: Boolean(getFrozenPlanningDayPlan(sid)),
      plannerCount: psg.getPlannerSessionItemCount(sid),
      scopes: Object.fromEntries(scopes.map((s) => [s.label, rds.getResolvedDestinationScope(s.label)?.scopeId ?? null])),
    };
  }
  // 會改狀態的探測，只在每案最後呼叫：已完成 → false（不改狀態）；已被 reset → true（建立新 active 項目，不影響後續案例，因每案 sid 不同）
  function probeRunStage(sid) {
    return { runCompleted: psg.beginPlannerRun(runKeyFor(sid)) === false, stageCompleted: psg.beginPipelineStage(sid, "T125_STAGE") === false };
  }

  // ── Fixture（形狀沿用 scripts/verify-negated-switch-s1s4.mjs:163-168 mk()，加 planVersion／可選欄位）──
  function mk({ sid, ver = 3, city = "京都", country = "日本", tdCity, location, extra = {} }) {
    const td = tdCity ?? city;
    return {
      ...createEmptySession(),
      planningSessionId: sid,
      planVersion: ver,
      location: location ?? { city, lat: 35.0116, lng: 135.7681 },
      preferredArea: city,
      tripDestination: { placeId: "", country, city: td, lat: 35.0116, lng: 135.7681, formattedName: td, displayLabel: td },
      tripPlanningContext: { destination: city, selectedPlaces: [], intent: "general" },
      recommendationSession: { destination: city },
      travelContext: { destination: city, destinationCity: city, currentLocation: city, destinationCountry: country, destinationType: "city", interests: [] },
      ...extra,
    };
  }
  const RESET_REASONS = new Set(["destination_changed", "country_changed", "city_changed"]);
  // 路徑標示（只做輸出與 fixture 前置檢查；複製 tc:1561-1570 的判斷式，不影響受測行為）
  function pathOf(base, label, text) {
    const pre = isNewTripPlanning(base, text.trim());
    const target = normalizeDestinationLabel(label.trim());
    return pre.isNew && RESET_REASONS.has(pre.reason) && pre.incomingDestination && normalizeDestinationLabel(pre.incomingDestination) === target ? "A" : "B";
  }

  function invariantsNotApplied(id, ctx) {
    const { base, before, sid, ver, scopes, mark, netBefore, after } = ctx;
    check(`${id}.base 未被修改（deep-equal 呼叫前快照）`, sameDeep(base, before));
    check(`${id}.planningSessionId／planVersion 不變`, base.planningSessionId === sid && base.planVersion === ver, `sid=${base.planningSessionId} ver=${base.planVersion}`);
    check(`${id}.凍結 dayPlan 仍在`, after.frozen === true);
    check(`${id}.Planner Session 狀態仍在（itemCount=7）`, after.plannerCount === 7, `itemCount=${fmt(after.plannerCount)}`);
    for (const s of scopes) {
      check(`${id}.範圍快取 ${s.label} 仍在（await macrotask 後）`, after.scopes[s.label] === s.scopeId, `scopeId=${fmt(after.scopes[s.label])}`);
    }
    check(`${id}.[PLANNER_SESSION_RESET] 0 次`, countSince(mark, "[PLANNER_SESSION_RESET]") === 0, `count=${countSince(mark, "[PLANNER_SESSION_RESET]")}`);
    check(`${id}.[TRIP_RESET_COMMIT_STEP_FAILED] 0 次`, countSince(mark, "[TRIP_RESET_COMMIT_STEP_FAILED]") === 0);
    if (pipelineLogOn) {
      for (const tag of PIPE_RESET_TAGS) check(`${id}.${tag} 0 次`, countSince(mark, tag) === 0, `count=${countSince(mark, tag)}`);
    } else {
      out(`INFO ${id}.${PIPE_RESET_TAGS.join("/")} 無法觀察（logAiPipeline 關閉）`);
    }
    check(`${id}.外部請求 0（不產生 Places／Credits）`, externalCalls === netBefore, `delta=${externalCalls - netBefore}`);
  }

  // ── 停止／未套用 案例執行器 ──
  const stopTally = {};
  async function runStopCandidate(c) {
    const { id, reason, label, text } = c;
    const sid = `plan-T125-${id}`, ver = 3;
    const base = mk({ sid, ver, ...(c.mk ?? {}) });
    const scopes = c.scopes ?? [{ label: "京都", scopeId: `T125-${id}-京都` }];
    seedGlobals(sid, scopes);
    const path = pathOf(base, label, text);
    const before = snap(base);
    const pre = observe(sid, scopes);
    check(`${id}.SELF seed 完成`, pre.frozen && pre.plannerCount === 7 && scopes.every((s) => pre.scopes[s.label] === s.scopeId), JSON.stringify(pre));
    const mark = tagLog.length, netBefore = externalCalls;
    let result, threw;
    c.arm?.();
    try { result = applyConfirmedDestinationSwitch(base, { label, requestText: text, resetAlreadyThisTurn: false, turnResetBase: { planningSessionId: sid, planVersion: ver } }); }
    catch (e) { threw = e; }
    finally { c.disarm?.(); }
    await macrotasks();
    const after = observe(sid, scopes);
    const kind = threw ? `throw:${String(threw?.message ?? threw).slice(0, 80)}` : result?.stop ? `stop:${result.stop}` : result?.applied ? "applied:true" : "applied:false";
    const constructed = !threw && result?.stop === reason;
    stopTally[reason] ??= { constructed: 0, total: 0, ids: [] };
    stopTally[reason].total += 1;
    if (constructed) { stopTally[reason].constructed += 1; stopTally[reason].ids.push(id); }
    out(`CASE ${id} expect=stop:${reason} path=${path} actual=${kind}${constructed ? "" : "  → NOT-CONSTRUCTED（候選輸入未構成此停止原因）"}`);
    if (!result?.applied) {
      invariantsNotApplied(id, { base, before, sid, ver, scopes, mark, netBefore, after });
    } else {
      out(`INFO ${id} 實際 applied:true（非停止；本案不檢查停止不變條件）`);
    }
    probeRunStage(sid);
  }

  // ── 成功案例執行器 ──
  async function runSuccess(c) {
    const { id, label, text } = c;
    const sid = `plan-T125-${id}`, ver = 3;
    const base = mk({ sid, ver, ...(c.mk ?? {}) });
    const scopes = c.scopes ?? [{ label: "京都", scopeId: `T125-${id}-京都` }];
    seedGlobals(sid, scopes);
    const path = pathOf(base, label, text);
    if (c.expectPath) check(`${id}.SELF 路徑前置＝${c.expectPath}`, path === c.expectPath, `path=${path}`);
    const before = snap(base);
    const mark = tagLog.length, netBefore = externalCalls;
    let result, threw;
    if (c.throwOnTag) throwOnTag = c.throwOnTag;
    try { result = applyConfirmedDestinationSwitch(base, { label, requestText: text, resetAlreadyThisTurn: false, turnResetBase: { planningSessionId: sid, planVersion: ver } }); }
    catch (e) { threw = e; }
    finally { throwOnTag = null; }
    await macrotasks();
    const after = observe(sid, scopes);
    const target = normalizeDestinationLabel(label);
    const kind = threw ? `throw:${String(threw?.message ?? threw).slice(0, 120)}` : result?.stop ? `stop:${result.stop}` : result?.applied ? "applied:true" : "applied:false";
    out(`CASE ${id} expect=applied:true path=${path} actual=${kind}`);
    check(`${id}.不拋出例外`, !threw, kind);
    check(`${id}.applied:true`, result?.applied === true, kind);
    const s = result?.session;
    const resets = tagLog.slice(mark).filter((e) => e.tag === "[PLANNER_SESSION_RESET]");
    check(`${id}.[PLANNER_SESSION_RESET] 恰好 1 次且為舊 sid`, resets.length === 1 && resets[0].text.includes(`sessionId=${sid}`), `count=${resets.length} ${resets.map((e) => e.text).join(" | ")}`);
    if (pipelineLogOn) {
      for (const tag of ["[NEW_TRIP_SESSION_CREATED]", "[TRIP_CONTEXT_RESET]", "[TRIP_CONTEXT_AFTER_RESET]"]) {
        check(`${id}.${tag} 恰好 1 次`, countSince(mark, tag) === 1, `count=${countSince(mark, tag)}`);
      }
    } else {
      out(`INFO ${id}.[NEW_TRIP_SESSION_CREATED]/[TRIP_CONTEXT_RESET]/[TRIP_CONTEXT_AFTER_RESET] 次數無法觀察（logAiPipeline 關閉）`);
    }
    const commitFails = tagLog.slice(mark).filter((e) => e.tag === "[TRIP_RESET_COMMIT_STEP_FAILED]");
    if (c.expectCommitFailStep) {
      check(`${id}.[TRIP_RESET_COMMIT_STEP_FAILED] step=${c.expectCommitFailStep} 有記錄`, commitFails.some((e) => e.text.includes(`step=${c.expectCommitFailStep}`)), commitFails.map((e) => e.text).join(" | ") || "none");
    } else {
      check(`${id}.[TRIP_RESET_COMMIT_STEP_FAILED] 0 次`, commitFails.length === 0, commitFails.map((e) => e.text).join(" | "));
    }
    check(`${id}.新 session 目的地＝label（${target}）`, Boolean(s) && resolveActiveDestination(s) === target, `active=${fmt(s && resolveActiveDestination(s))}`);
    check(`${id}.新 planningSessionId（≠舊）`, Boolean(s?.planningSessionId) && s.planningSessionId !== sid, `sid=${fmt(s?.planningSessionId)}`);
    check(`${id}.planVersion＝舊+1`, s?.planVersion === ver + 1, `planVersion=${fmt(s?.planVersion)}`);
    check(`${id}.base 未被修改（deep-equal）`, sameDeep(base, before));
    check(`${id}.舊 sid 凍結 dayPlan 已清`, after.frozen === false);
    check(`${id}.舊 sid Planner Session 已清`, after.plannerCount === undefined, `itemCount=${fmt(after.plannerCount)}`);
    check(`${id}.舊目的地範圍快取 京都 已清`, after.scopes["京都"] === null, `scopeId=${fmt(after.scopes["京都"])}`);
    for (const k of c.expectKept ?? []) {
      // #T128b：非 collision 時新目的地範圍快取不在清除清單，Commit（含排程的非同步清除，已 await macrotask）後必須保留
      const want = scopes.find((s) => s.label === k)?.scopeId;
      check(`${id}.新目的地範圍快取 ${k} 保留（await macrotask 後）`, Boolean(want) && after.scopes[k] === want, `scopeId=${fmt(after.scopes[k])} want=${fmt(want)}`);
    }
    check(`${id}.外部請求 0`, externalCalls === netBefore, `delta=${externalCalls - netBefore}`);
    const probes = probeRunStage(sid);
    check(`${id}.舊 sid Planner Run／Pipeline Stage 已清（探測）`, !probes.runCompleted && !probes.stageCompleted, JSON.stringify(probes));
    return { base, result, sid, ver, label, text, s, after };
  }

  // ══════════ 一、Prepare 純度（直接呼叫既有 export）＋ WeakSet 只 commit 一次 ══════════
  {
    const id = "P1-prepare-pure";
    const sid = `plan-T125-${id}`, ver = 3;
    const base = mk({ sid, ver });
    const scopes = [{ label: "京都", scopeId: `T125-${id}-京都` }, { label: "大阪", scopeId: `T125-${id}-大阪` }];
    seedGlobals(sid, scopes);
    const before = snap(base);
    const mark = tagLog.length, netBefore = externalCalls;
    const prepared = prepareDestinationChangeReset(base, { reason: "city_changed", incomingDestination: "大阪", userText: "改去大阪" });
    await macrotasks();
    const after = observe(sid, scopes);
    out(`CASE ${id} prepared.newSessionId=${fmt(prepared?.newSessionId)} collision=${fmt(prepared?.hydrationDependsOnClearedScope)}`);
    invariantsNotApplied(id, { base, before, sid, ver, scopes, mark, netBefore, after });
    check(`${id}.prepared.session 目的地＝大阪、sid＝newSessionId`, resolveActiveDestination(prepared.session) === "大阪" && prepared.session.planningSessionId === prepared.newSessionId);
    check(`${id}.prepared.base === base（同一參照）`, prepared.base === base);

    const id2 = "P2-commit-once";
    const mark2 = tagLog.length;
    let firstThrew, secondThrew;
    try { commitDestinationChangeReset(prepared); } catch (e) { firstThrew = e; }
    try { commitDestinationChangeReset(prepared); } catch (e) { secondThrew = e; }
    check(`${id2}.第一次 commit 不拋出`, !firstThrew, String(firstThrew?.message ?? ""));
    check(`${id2}.第二次 commit 拋出（WeakSet 已 commit）`, Boolean(secondThrew) && /already committed/.test(String(secondThrew?.message)), String(secondThrew?.message ?? "no throw"));
    check(`${id2}.[PLANNER_SESSION_RESET] 合計 1 次`, countSince(mark2, "[PLANNER_SESSION_RESET]") === 1, `count=${countSince(mark2, "[PLANNER_SESSION_RESET]")}`);
    probeRunStage(sid);
  }

  // ══════════ 二、停止路徑 ══════════
  out("INFO STOP second_reset_required（路徑 B，Prepare 後檢查 tc:1587）：不可達／無法構成（讀碼：Prepare session 目的地＝normalize(label)、日期月份同句解析、pending 清空；僅 normalizeDestinationLabel 非冪等或跨日界可觸發）→ 未建案例，不硬造");
  unverified.push("second_reset_required@Prepare(路徑B tc:1587)：不可達／無法構成");

  // merge 後 second_reset_required 候選
  await runStopCandidate({ id: "S1-merge-startdate-pathA", reason: "second_reset_required", label: "大阪", text: "改去大阪，2027/5/1出發",
    scopes: [{ label: "京都", scopeId: "T125-S1-京都" }, { label: "大阪", scopeId: "T125-S1-大阪" }] });
  await runStopCandidate({ id: "S2-merge-startdate-pathB", reason: "second_reset_required", label: "大阪", text: "2027/5/1出發",
    scopes: [{ label: "京都", scopeId: "T125-S2-京都" }, { label: "大阪", scopeId: "T125-S2-大阪" }] });
  {
    // merge 拋例外（路徑 A；tc merge catch 回原 base → isNewTripPlanning(base) 為 new）：以 base.location.city getter 在呼叫期間丟錯注入
    let armed = false;
    const location = { lat: 35.0116, lng: 135.7681 };
    Object.defineProperty(location, "city", { enumerable: true, get() { if (armed) throw new Error("T125 injected merge failure (location.city)"); return "京都"; } });
    await runStopCandidate({ id: "S3-merge-throws-pathA", reason: "second_reset_required", label: "大阪", text: "改去大阪", mk: { location },
      scopes: [{ label: "京都", scopeId: "T125-S3-京都" }, { label: "大阪", scopeId: "T125-S3-大阪" }],
      arm: () => { armed = true; }, disarm: () => { armed = false; } });
  }
  await runStopCandidate({ id: "S4-merge-area-scope", reason: "second_reset_required", label: "東京", text: "東京新宿天氣怎麼樣",
    scopes: [{ label: "京都", scopeId: "T125-S4-京都" }, { label: "東京", scopeId: "T125-S4-東京" }] });

  // destination_not_applied 候選
  await runStopCandidate({ id: "D1-japanese-dates-other-city", reason: "destination_not_applied", label: "東京", text: "11/25-11/30に大阪へ行きます",
    scopes: [{ label: "京都", scopeId: "T125-D1-京都" }, { label: "東京", scopeId: "T125-D1-東京" }, { label: "大阪", scopeId: "T125-D1-大阪" }] });
  await runStopCandidate({ id: "D2-equivalent-spelling", reason: "destination_not_applied", label: "金沢", text: "金沢",
    scopes: [{ label: "京都", scopeId: "T125-D2-京都" }, { label: "金沢", scopeId: "T125-D2-金沢" }] });
  await runStopCandidate({ id: "D3-equivalent-spelling-switch", reason: "destination_not_applied", label: "金沢", text: "換金澤",
    scopes: [{ label: "京都", scopeId: "T125-D3-京都" }, { label: "金沢", scopeId: "T125-D3-金沢" }] });
  // #T128b 新候選：「不要去X了，去Y」— combination-selection-reply.ts:20 EXPLICIT_PRIMARY_SWITCH_RE 命中、:23 CAPTURE 不命中
  //   → trip-planning-session-reset.ts:237-242 resolveIncomingDestinationFromText 回 undefined（tc:1540-1541 noOtherDestination 放行），
  //   但 merge 的 parseDestinationFromText（trip-planning-context.ts:801-802 否定句只解析餘句）可能把目的地設成 Y ≠ label → tc:1615。
  //   也可能先在 tc:1587／1611 停為 second_reset_required 或 applied:false；結果照實記錄。
  await runStopCandidate({ id: "D4-negated-old-go-other", reason: "destination_not_applied", label: "大阪", text: "不要去京都了，去東京",
    scopes: [{ label: "京都", scopeId: "T128-D4-京都" }, { label: "大阪", scopeId: "T128-D4-大阪" }, { label: "東京", scopeId: "T128-D4-東京" }] });
  await runStopCandidate({ id: "D5-negated-old-go-other-play", reason: "destination_not_applied", label: "大阪", text: "不要去京都了，去札幌玩",
    scopes: [{ label: "京都", scopeId: "T128-D5-京都" }, { label: "大阪", scopeId: "T128-D5-大阪" }, { label: "札幌", scopeId: "T128-D5-札幌" }] });
  await runStopCandidate({ id: "D6-negated-old-go-other-days", reason: "destination_not_applied", label: "大阪", text: "不要去京都，去福岡三天",
    scopes: [{ label: "京都", scopeId: "T128-D6-京都" }, { label: "大阪", scopeId: "T128-D6-大阪" }, { label: "福岡", scopeId: "T128-D6-福岡" }] });

  for (const [reason, t] of Object.entries(stopTally)) {
    out(`STOP-TALLY ${reason}(merge 後／套用後) constructed=${t.constructed}/${t.total}${t.ids.length ? ` [${t.ids.join(",")}]` : ""}`);
    if (t.constructed === 0) unverified.push(`${reason}：候選輸入皆未構成（函式層 UNVERIFIED）`);
  }

  // 前段 guard 停止／未套用（不變條件同樣成立）
  {
    const id = "G1-stale-turn-base";
    const sid = `plan-T125-${id}`, ver = 3;
    const base = mk({ sid, ver });
    const scopes = [{ label: "京都", scopeId: `T125-${id}-京都` }];
    seedGlobals(sid, scopes);
    const before = snap(base);
    const mark = tagLog.length, netBefore = externalCalls;
    const r = applyConfirmedDestinationSwitch(base, { label: "大阪", requestText: "改去大阪", resetAlreadyThisTurn: false, turnResetBase: { planningSessionId: sid, planVersion: ver + 1 } });
    await macrotasks();
    check(`${id}.stop:stale_turn_base`, r?.stop === "stale_turn_base", fmt(r));
    invariantsNotApplied(id, { base, before, sid, ver, scopes, mark, netBefore, after: observe(sid, scopes) });
    probeRunStage(sid);
  }

  // ══════════ 三、成功案例 ══════════
  const okA = await runSuccess({ id: "OK-A-merge-reset", label: "大阪", text: "改去大阪", expectPath: "A" });
  {
    // 同一 User Turn：已 reset 過 → applied:false，不得再 reset
    const mark = tagLog.length;
    const r2 = applyConfirmedDestinationSwitch(okA.base, { label: "大阪", requestText: "改去大阪", resetAlreadyThisTurn: true });
    check("OK-A.同輪第二次呼叫（resetAlreadyThisTurn）→ applied:false", r2?.applied === false && !r2?.stop, fmt(r2));
    check("OK-A.同輪第二次呼叫 [PLANNER_SESSION_RESET] 0 次", countSince(mark, "[PLANNER_SESSION_RESET]") === 0);
    // 以舊 base 再呼叫且帶 turnResetBase＝新 session → stale_turn_base，不得 reset
    const mark2 = tagLog.length;
    const r3 = applyConfirmedDestinationSwitch(okA.base, { label: "大阪", requestText: "改去大阪", resetAlreadyThisTurn: false, turnResetBase: { planningSessionId: okA.s?.planningSessionId, planVersion: okA.s?.planVersion } });
    check("OK-A.以舊 base＋新 turnResetBase → stop:stale_turn_base", r3?.stop === "stale_turn_base", fmt(r3));
    check("OK-A.stale 呼叫 [PLANNER_SESSION_RESET] 0 次", countSince(mark2, "[PLANNER_SESSION_RESET]") === 0);
  }
  await runSuccess({ id: "OK-B-compensating-reset", label: "大阪", text: "好，就那裡", expectPath: "B" });
  {
    // collision：新 label＝舊 tripDestination.city；舊 大阪 範圍快取（刻意錯誤座標）必須在 Commit 清除，且結果不得沿用
    const STALE = [34.1111, 135.1111];
    const res = await runSuccess({ id: "OK-C-collision", label: "大阪", text: "改去大阪", expectPath: "A", mk: { tdCity: "大阪" },
      scopes: [{ label: "京都", scopeId: "T125-OKC-京都" }, { label: "大阪", scopeId: "T125-OKC-STALE-大阪", coords: STALE }] });
    const s = res.s;
    check("OK-C.舊 大阪 範圍快取已清（collision label 在清除清單）", res.after.scopes["大阪"] === null, `scopeId=${fmt(res.after.scopes["大阪"])}`);
    check("OK-C.結果未沿用 stale scopeId", s?.travelContext?.destinationScopeId !== "T125-OKC-STALE-大阪", `destinationScopeId=${fmt(s?.travelContext?.destinationScopeId)}`);
    const c = s?.travelContext?.destinationCoordinates;
    check("OK-C.結果未沿用 stale 座標（travelContext）", !(c && c.lat === STALE[0] && c.lng === STALE[1]), `coords=${fmt(c)}`);
    check("OK-C.結果未沿用 stale 座標（tripDestination）", !(s?.tripDestination?.lat === STALE[0] && s?.tripDestination?.lng === STALE[1]), `td=${fmt(s?.tripDestination && { lat: s.tripDestination.lat, lng: s.tripDestination.lng })}`);
    out(`INFO OK-C 結果 travelContext.destination=${fmt(s?.travelContext?.destination)} tripDestination.city=${fmt(s?.tripDestination?.city)}`);
  }
  // Commit 步驟失敗：往前完成、不回滾、applied:true、warn [TRIP_RESET_COMMIT_STEP_FAILED]
  await runSuccess({ id: "OK-D-commit-step-fails", label: "大阪", text: "改去大阪", expectPath: "A",
    throwOnTag: "[PLANNER_SESSION_RESET]", expectCommitFailStep: "reset_planner_session" });
  out("INFO OK-D 注入點＝[PLANNER_SESSION_RESET] console.info（planner-session-guard.ts:171），位於 resetPlannerSession 全部刪除之後；只證明 log 失敗時往前完成，不代表刪除前失敗（見 F1／F2）");

  // #T128b：成功案例（非 collision）預先放入新目的地範圍快取，Commit 後必須保留（既有 OK-A／OK-B 不變，另建變體）
  await runSuccess({ id: "OK-A-keepnew", label: "大阪", text: "改去大阪", expectPath: "A",
    scopes: [{ label: "京都", scopeId: "T128-OKA-京都" }, { label: "大阪", scopeId: "T128-OKA-KEEP-大阪" }], expectKept: ["大阪"] });
  await runSuccess({ id: "OK-B-keepnew", label: "大阪", text: "好，就那裡", expectPath: "B",
    scopes: [{ label: "京都", scopeId: "T128-OKB-京都" }, { label: "大阪", scopeId: "T128-OKB-KEEP-大阪" }], expectKept: ["大阪"] });

  // ══════════ 三之二、Commit 刪除「之前」注入失敗（#T128b F1／F2）══════════
  async function runCommitFailure(c) {
    const { id, inject, expectStep } = c;
    const label = "大阪", text = "改去大阪";
    const sid = `plan-T128-${id}`, ver = 3;
    const base = mk({ sid, ver });
    const scopes = [{ label: "京都", scopeId: `T128-${id}-京都` }, { label: "大阪", scopeId: `T128-${id}-KEEP-大阪` }];
    const dayPlanRef = seedGlobals(sid, scopes);
    const path = pathOf(base, label, text);
    check(`${id}.SELF 路徑前置＝A`, path === "A", `path=${path}`);
    const pre = observe(sid, scopes);
    check(`${id}.SELF seed 完成`, pre.frozen && pre.plannerCount === 7 && scopes.every((s) => pre.scopes[s.label] === s.scopeId), JSON.stringify(pre));
    const before = snap(base);
    const mark = tagLog.length, netBefore = externalCalls;
    const injectedMsg = `T128 injected before delete (${inject})`;
    const hits = [];
    let armed = false;
    if (inject === "frozen") {
      // ai-planning-session.ts:42 frozenDayPlanBySession.delete(id) 之前：只認「key＝舊 sid 且此 Map 存的是本測試 dayPlan 物件」
      Map.prototype.delete = function (key) {
        if (armed && hits.length === 0 && key === sid && ORIG_MAP_GET.call(this, key) === dayPlanRef) {
          hits.push("Map.delete(frozenDayPlanBySession, oldSid)");
          throw new Error(injectedMsg);
        }
        return ORIG_MAP_DELETE.call(this, key);
      };
    } else if (inject === "planner") {
      // planner-session-guard.ts:160 activePlannerSessions.delete(sessionId) 之前（resetPlannerSession 內第一個刪除）
      Set.prototype.delete = function (value) {
        if (armed && hits.length === 0 && value === sid) {
          hits.push("Set.delete(activePlannerSessions, oldSid)");
          throw new Error(injectedMsg);
        }
        return ORIG_SET_DELETE.call(this, value);
      };
    }
    let result, threw;
    try {
      armed = true;
      result = applyConfirmedDestinationSwitch(base, { label, requestText: text, resetAlreadyThisTurn: false, turnResetBase: { planningSessionId: sid, planVersion: ver } });
    } catch (e) { threw = e; }
    finally {
      armed = false;
      Map.prototype.delete = ORIG_MAP_DELETE;
      Set.prototype.delete = ORIG_SET_DELETE;
    }
    await macrotasks();
    const after = observe(sid, scopes);
    const probes = probeRunStage(sid); // 會改狀態：只在本案最後呼叫
    const s = result?.session;
    const kind = threw ? `throw:${String(threw?.message ?? threw).slice(0, 120)}` : result?.stop ? `stop:${result.stop}` : result?.applied ? "applied:true" : "applied:false";
    out(`CASE ${id} inject=${inject}（${hits[0] ?? "未命中"}） expect=applied:true＋[TRIP_RESET_COMMIT_STEP_FAILED] step=${expectStep} actual=${kind}`);
    check(`${id}.SELF 內建原型已還原`, Map.prototype.delete === ORIG_MAP_DELETE && Set.prototype.delete === ORIG_SET_DELETE);
    check(`${id}.注入點命中恰好 1 次（刪除前拋錯）`, hits.length === 1, `hits=${JSON.stringify(hits)}`);
    check(`${id}.不拋出例外`, !threw, kind);
    check(`${id}.applied:true（往前完成）`, result?.applied === true, kind);
    const commitFails = tagLog.slice(mark).filter((e) => e.tag === "[TRIP_RESET_COMMIT_STEP_FAILED]");
    check(`${id}.[TRIP_RESET_COMMIT_STEP_FAILED] 恰好 1 次、step=${expectStep}、含注入訊息（注入點在 Commit 內）`,
      commitFails.length === 1 && commitFails[0].text.includes(`step=${expectStep}`) && commitFails[0].text.includes(injectedMsg) && commitFails[0].text.includes(`oldSessionId=${sid}`),
      commitFails.map((e) => e.text).join(" | ") || "none");
    check(`${id}.新 planningSessionId（≠舊）`, Boolean(s?.planningSessionId) && s.planningSessionId !== sid, `sid=${fmt(s?.planningSessionId)}`);
    check(`${id}.Commit 失敗 log 的 newSessionId＝回傳 session sid`, Boolean(s?.planningSessionId) && commitFails.some((e) => e.text.includes(`newSessionId=${s.planningSessionId}`)));
    check(`${id}.planVersion＝舊+1`, s?.planVersion === ver + 1, `planVersion=${fmt(s?.planVersion)}`);
    check(`${id}.新 session 目的地＝大阪`, Boolean(s) && resolveActiveDestination(s) === "大阪", `active=${fmt(s && resolveActiveDestination(s))}`);
    check(`${id}.base 未被修改（deep-equal）`, sameDeep(base, before));
    check(`${id}.外部請求 0`, externalCalls === netBefore, `delta=${externalCalls - netBefore}`);
    // 後續步驟仍執行
    check(`${id}.後續步驟仍執行：舊目的地範圍快取 京都 已清`, after.scopes["京都"] === null, `scopeId=${fmt(after.scopes["京都"])}`);
    check(`${id}.新目的地範圍快取 大阪 保留`, after.scopes["大阪"] === `T128-${id}-KEEP-大阪`, `scopeId=${fmt(after.scopes["大阪"])}`);
    if (pipelineLogOn) {
      for (const tag of ["[NEW_TRIP_SESSION_CREATED]", "[TRIP_CONTEXT_RESET]", "[TRIP_CONTEXT_AFTER_RESET]"]) {
        check(`${id}.後續步驟仍執行：${tag} 恰好 1 次`, countSince(mark, tag) === 1, `count=${countSince(mark, tag)}`);
      }
    } else {
      out(`INFO ${id}.[NEW_TRIP_SESSION_CREATED]/[TRIP_CONTEXT_RESET]/[TRIP_CONTEXT_AFTER_RESET] 無法觀察（logAiPipeline 關閉）`);
    }
    const resets = countSince(mark, "[PLANNER_SESSION_RESET]");
    const plannerCleared = after.plannerCount === undefined && !probes.runCompleted && !probes.stageCompleted;
    const plannerIntact = after.plannerCount === 7 && probes.runCompleted && probes.stageCompleted;
    if (inject === "frozen") {
      check(`${id}.注入於刪除前：舊 sid 凍結 dayPlan 仍在（未被刪除）`, after.frozen === true);
      check(`${id}.後續步驟仍執行：舊 sid Planner Session／Run／Stage 已清`, plannerCleared, `itemCount=${fmt(after.plannerCount)} probes=${JSON.stringify(probes)}`);
      check(`${id}.後續步驟仍執行：[PLANNER_SESSION_RESET] 恰好 1 次`, resets === 1, `count=${resets}`);
    } else {
      check(`${id}.前一步驟已執行：舊 sid 凍結 dayPlan 已清`, after.frozen === false);
      check(`${id}.注入於刪除前：resetPlannerSession 未刪任何項目（itemCount=7、Run／Stage 仍完成）`, plannerIntact, `itemCount=${fmt(after.plannerCount)} probes=${JSON.stringify(probes)}`);
      check(`${id}.resetPlannerSession 中斷：[PLANNER_SESSION_RESET] 0 次`, resets === 0, `count=${resets}`);
    }
    const parts = {
      frozenDayPlan: after.frozen ? "殘留" : "已清",
      plannerSession: after.plannerCount === undefined ? "已清" : `殘留(itemCount=${after.plannerCount})`,
      plannerRun: probes.runCompleted ? "殘留" : "已清",
      pipelineStage: probes.stageCompleted ? "殘留" : "已清",
      scope京都: after.scopes["京都"] === null ? "已清" : "殘留",
    };
    const vals = Object.values(parts);
    const partial = vals.some((v) => v.startsWith("殘留")) && vals.some((v) => v === "已清");
    out(`MIXED-STATE ${id} 部分清除=${partial ? "是" : "否"} ${Object.entries(parts).map(([k, v]) => `${k}=${v}`).join(" ")} 新sid=${fmt(s?.planningSessionId)} planVersion=${fmt(s?.planVersion)}（依設計往前完成、不回滾；殘留項以舊 sid 為 key，新 sid 不會讀到）`);
  }
  await runCommitFailure({ id: "F1-fail-before-frozen-delete", inject: "frozen", expectStep: "clear_frozen_day_plan" });
  await runCommitFailure({ id: "F2-fail-before-planner-delete", inject: "planner", expectStep: "reset_planner_session" });

  // ══════════ 四、legacy 不退步 ══════════
  {
    const id = "L1-mergeTravelContext-main";
    const sid = `plan-T125-${id}`, ver = 3;
    const base = mk({ sid, ver });
    const scopes = [{ label: "京都", scopeId: `T125-${id}-京都` }];
    seedGlobals(sid, scopes);
    const mark = tagLog.length;
    let m, threw;
    try { m = mergeTravelContext(base, "改去大阪"); } catch (e) { threw = e; }
    await macrotasks();
    const after = observe(sid, scopes);
    check(`${id}.不拋出`, !threw, String(threw?.message ?? ""));
    check(`${id}.[PLANNER_SESSION_RESET] 恰好 1 次`, countSince(mark, "[PLANNER_SESSION_RESET]", (e) => e.text.includes(`sessionId=${sid}`)) === 1 && countSince(mark, "[PLANNER_SESSION_RESET]") === 1, `count=${countSince(mark, "[PLANNER_SESSION_RESET]")}`);
    check(`${id}.新 sid、planVersion+1`, m?.session?.planningSessionId && m.session.planningSessionId !== sid && m.session.planVersion === ver + 1, `sid=${fmt(m?.session?.planningSessionId)} ver=${fmt(m?.session?.planVersion)}`);
    check(`${id}.目的地＝大阪`, resolveActiveDestination(m?.session ?? {}) === "大阪", `active=${fmt(m?.session && resolveActiveDestination(m.session))}`);
    check(`${id}.舊 京都 範圍快取已清`, after.scopes["京都"] === null);
    check(`${id}.[TRIP_RESET_COMMIT_STEP_FAILED] 0 次`, countSince(mark, "[TRIP_RESET_COMMIT_STEP_FAILED]") === 0);
    probeRunStage(sid);
  }
  const LEGACY = [
    { id: "L2-destination_changed", reason: "destination_changed", opts: { incomingDestination: "大阪", userText: "改去大阪" }, dest: "大阪", scopeCleared: true },
    { id: "L3-travel_date_changed", reason: "travel_date_changed", opts: { incomingDestination: "京都", userText: "2027/5/1-2027/5/3" }, dest: "京都", scopeCleared: false },
    { id: "L4-phase_done_new_trip", reason: "phase_done_new_trip", opts: { incomingDestination: "大阪", userText: "下一趟去大阪" }, dest: "大阪", scopeCleared: true },
  ];
  for (const L of LEGACY) {
    const sid = `plan-T125-${L.id}`, ver = 3;
    const base = mk({ sid, ver });
    const scopes = [{ label: "京都", scopeId: `T125-${L.id}-京都` }];
    seedGlobals(sid, scopes);
    const before = snap(base);
    const mark = tagLog.length;
    let s, threw;
    try { s = resetTripPlanningContext(base, { reason: L.reason, ...L.opts }); } catch (e) { threw = e; }
    await macrotasks();
    const after = observe(sid, scopes);
    check(`${L.id}.不拋出`, !threw, String(threw?.message ?? ""));
    check(`${L.id}.新 sid、planVersion+1`, s?.planningSessionId && s.planningSessionId !== sid && s.planVersion === ver + 1, `sid=${fmt(s?.planningSessionId)} ver=${fmt(s?.planVersion)}`);
    check(`${L.id}.目的地＝${L.dest}`, resolveActiveDestination(s ?? {}) === L.dest, `active=${fmt(s && resolveActiveDestination(s))}`);
    check(`${L.id}.[PLANNER_SESSION_RESET] 恰好 1 次`, countSince(mark, "[PLANNER_SESSION_RESET]") === 1, `count=${countSince(mark, "[PLANNER_SESSION_RESET]")}`);
    check(`${L.id}.舊 sid 凍結 dayPlan／Planner 已清`, after.frozen === false && after.plannerCount === undefined);
    check(`${L.id}.京都 範圍快取 ${L.scopeCleared ? "已清" : "保留（日期變更不得清鎖定）"}`, L.scopeCleared ? after.scopes["京都"] === null : after.scopes["京都"] === `T125-${L.id}-京都`, `scopeId=${fmt(after.scopes["京都"])}`);
    check(`${L.id}.base 未被修改`, sameDeep(base, before));
    check(`${L.id}.[TRIP_RESET_COMMIT_STEP_FAILED] 0 次`, countSince(mark, "[TRIP_RESET_COMMIT_STEP_FAILED]") === 0);
    if (pipelineLogOn) check(`${L.id}.[TRIP_CONTEXT_RESET] 恰好 1 次`, countSince(mark, "[TRIP_CONTEXT_RESET]") === 1, `count=${countSince(mark, "[TRIP_CONTEXT_RESET]")}`);
    probeRunStage(sid);
  }
  {
    // legacy 預設 throw 策略不變：Commit 步驟失敗直接拋出（既有呼叫端行為）
    const id = "L5-legacy-commit-throws";
    const sid = `plan-T125-${id}`;
    const base = mk({ sid, ver: 3 });
    seedGlobals(sid, [{ label: "京都", scopeId: `T125-${id}-京都` }]);
    const mark = tagLog.length;
    let threw;
    throwOnTag = "[PLANNER_SESSION_RESET]";
    try { resetTripPlanningContext(base, { reason: "destination_changed", incomingDestination: "大阪", userText: "改去大阪" }); } catch (e) { threw = e; }
    finally { throwOnTag = null; }
    check(`${id}.預設 onStepError=throw → 拋出`, Boolean(threw) && /T125 injected/.test(String(threw?.message)), String(threw?.message ?? "no throw"));
    check(`${id}.未記錄 [TRIP_RESET_COMMIT_STEP_FAILED]（只有 wrapper 用 continue）`, countSince(mark, "[TRIP_RESET_COMMIT_STEP_FAILED]") === 0);
    probeRunStage(sid);
  }
  {
    // INFO：主路徑 stale-scope 非同步清除（sink 預設 null）仍排程。非 reset 的目的地改變 → tc:660-662／673-675 requestStaleDestinationScopeClear
    //   → 排程清除舊範圍。#T128b：run14 原 Fixture 實際 destination 仍為「日本」（不適用），改為多個 Fixture 依序嘗試；
    //   只有「結果 destination 確實不同於舊目的地」者視為適用（不計 PASS/FAIL，維持 INFO）；全部不適用 → UNVERIFIED。
    const countryOnly = (sid) => ({
      location: undefined, preferredArea: undefined, tripDestination: undefined, tripPlanningContext: undefined, recommendationSession: undefined,
      travelContext: { destination: "日本", destinationCountry: "日本", destinationType: "country", interests: [] },
      planningSessionId: sid,
    });
    const L6 = [
      { id: "L6a-orig-country-city", old: "日本", text: "我想去東京", build: (sid) => { const b = mk({ sid, ver: 3, city: "日本", country: "日本" }); b.travelContext = { ...b.travelContext, destinationType: "country", destinationCity: undefined }; return b; } },
      { id: "L6b-countryonly-wantgo", old: "日本", text: "我想去東京", build: (sid) => mk({ sid, ver: 3, city: "日本", country: "日本", extra: countryOnly(sid) }) },
      { id: "L6c-countryonly-bare", old: "日本", text: "東京", build: (sid) => mk({ sid, ver: 3, city: "日本", country: "日本", extra: countryOnly(sid) }) },
      { id: "L6d-countryonly-kyoto", old: "日本", text: "日本的京都", build: (sid) => mk({ sid, ver: 3, city: "日本", country: "日本", extra: countryOnly(sid) }) },
      { id: "L6e-city-area", old: "東京", text: "東京新宿有什麼好玩", build: (sid) => mk({ sid, ver: 3, city: "東京", country: "日本", tdCity: "東京" }) },
    ];
    const applicable = [];
    for (const L of L6) {
      const sid = `plan-T128-${L.id}`;
      const base = L.build(sid);
      seedGlobals(sid, [{ label: L.old, scopeId: `T128-${L.id}-${L.old}` }]);
      const mark = tagLog.length;
      let m, threw;
      try { m = mergeTravelContext(base, L.text); } catch (e) { threw = e; }
      const syncScope = rds.getResolvedDestinationScope(L.old)?.scopeId ?? null;
      await macrotasks();
      const asyncScope = rds.getResolvedDestinationScope(L.old)?.scopeId ?? null;
      const newDest = m?.context?.destination;
      const active = m?.session ? resolveActiveDestination(m.session) : undefined;
      const changed = Boolean(newDest) && normalizeDestinationLabel(newDest) !== normalizeDestinationLabel(L.old);
      const didReset = countSince(mark, "[PLANNER_SESSION_RESET]") > 0;
      if (changed && !didReset) applicable.push(L.id);
      out(`INFO ${L.id} text=${JSON.stringify(L.text)} ${threw ? `throw=${String(threw?.message ?? threw).slice(0, 80)} ` : ""}destination=${fmt(newDest)} destinationCity=${fmt(m?.context?.destinationCity)} active=${fmt(active)} reset=${didReset} ` +
        `${L.old}範圍 同步=${fmt(syncScope)} macrotask後=${fmt(asyncScope)} → ${changed && !didReset ? "適用（預期：同步仍在、之後被清＝原排程行為）" : didReset ? "不適用（走 reset 同步清除，非排程路徑）" : "不適用（destination 未改變）"}`);
      probeRunStage(sid);
    }
    out(`INFO L6 適用 Fixture=${applicable.length ? applicable.join(",") : "無"}`);
    if (!applicable.length) unverified.push("L6 主路徑 stale-scope 非同步清除：所有 Fixture 的 destination 都未改變或走 reset（探測不適用）");
  }
} catch (e) {
  anyFail = true;
  out(`FAIL TOP 未預期例外：${String(e?.stack ?? e).slice(0, 800)}`);
} finally {
  throwOnTag = null;
  Map.prototype.delete = ORIG_MAP_DELETE;
  Set.prototype.delete = ORIG_SET_DELETE;
  globalThis.fetch = priorFetch;
  wtMod.Worker = priorWorker;
  for (const k of CP_KEYS) cpMod[k] = priorCp[k];
  console.info = oi;
  console.warn = ow;
}

check("NET.外部請求次數 = 0", externalCalls === 0, `externalCalls=${externalCalls} offline-guard=${guardActive ? "present" : "absent"}`);
check("NET.worker_threads.Worker 建立次數 = 0", workerCalls === 0, `workerCalls=${workerCalls}`);
out(`INFO NET.child_process 呼叫次數=${cpCalls.length}${cpCalls.length ? `（${[...new Set(cpCalls)].join(", ")}；含 Guard 白名單 esbuild 服務，是否違規以 Guard 記錄為準）` : ""}`);
{
  const guardLogEnd = readGuardLogLines();
  if (guardLogStart === null || guardLogEnd === null) {
    check("NET.Guard 記錄無法觀察（OFFLINE_GUARD_LOG 未設定或檔案不存在）", false,
      `env=${GUARD_LOG ? "set" : "unset"} start=${guardLogStart === null ? "unreadable" : guardLogStart.length} end=${guardLogEnd === null ? "unreadable" : guardLogEnd.length}`);
  } else {
    const added = guardLogEnd.length - guardLogStart.length;
    const kinds = guardLogEnd.slice(guardLogStart.length).map((l) => l.split(" ")[0]);
    check("NET.Guard 記錄本測試期間新增行數 = 0", added === 0, `start=${guardLogStart.length} end=${guardLogEnd.length} added=${added}${kinds.length ? ` kinds=${kinds.join(",")}` : ""}`);
  }
}
for (const u of unverified) out(`UNVERIFIED ${u}`);
out(`SUMMARY pass=${pass} fail=${fail} unverified=${unverified.length}`);
out(`RESULT ${anyFail ? "FAIL" : "PASS"}${unverified.length ? `（含 UNVERIFIED ${unverified.length} 項）` : ""}`);
if (anyFail) process.exitCode = 1;
