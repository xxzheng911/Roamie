#!/usr/bin/env node
// Builds scripts/verify-destination-authority-phase2-r10.mjs from r9 (r9 is NOT modified).
// Every patch's `old` text must occur exactly once in the current text; otherwise abort without writing.
// r10 = Phase 2 第二組 Step 1 第 2 輪（F10：more_places 續推／快照只當候選／in-flight＋暫時失敗冷卻）獨立驗收。
//  - 樹：work（F10 後＝現行）、pre（維持 pre-G2S1 overlay＝第一組 L-1 結案）、base（aa2db59）、f9（--f9；F10 前＝*.pre-F10.* overlay，走 G2S1 鏡像）。
//  - r9 全部 assertion 原樣保留（未放寬、未刪除、未改 expect）；只新增 R10 情境／r10 expect／輸出，
//    並把 F10 刻意改變的 tree 判別與 anchor（snapshotAreaScope 移除、more_places 改 resolveMorePlacesTurnDestination）
//    改成「work 必須是 F10 版、f9 備份必須是 G2S1 版」的等價（更嚴）檢查。
//  - 新增程式碼以函式本體（Function.prototype.toString）嵌入，避免跳脫錯誤；這些函式在 build 時不執行。
// Run: node scripts/verify-destination-authority-phase2-r10-build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "/Users/shuo/Roamie-clean/scripts/verify-destination-authority-phase2-r9.mjs";
const OUT = "/Users/shuo/Roamie-clean/scripts/verify-destination-authority-phase2-r10.mjs";
const L = (...lines) => lines.join("\n");
const body = (fn) => {
  const s = fn.toString();
  return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}")).replace(/^\n/, "").replace(/\n\s*$/, "");
};

const patches = [];
const P = (id, old, neu) => patches.push({ id, old, neu });

P(
  "header",
  L("/**", " * R9 — Phase 2 第二組 Step 1（G2S1）獨立驗收：A. more_places 只用可信目的地；B. 已確認行政區推薦成功後重新載入沿用。"),
  L(
    "/**",
    " * R10 — Phase 2 第二組 Step 1 第 2 輪（F10）獨立驗收：#1 more_places 續推；#2 舊版快照；#3 偽造快照；Session Restore 不退化。",
    " * 由 scripts/verify-destination-authority-phase2-r10-build.mjs 以 r9（保留不改）逐字複製並套用 exact-once patch 產生（r10-Δ）：",
    " *  r10-Δ1 樹：work（F10 後）、pre（維持 pre-G2S1 overlay）、base（aa2db59）、f9（--f9：F10 前＝*.pre-F10.* overlay，走 G2S1 鏡像）。",
    " *  r10-Δ2 more_places 鏡像：work = F10 L5100-5125（await resolveMorePlacesTurnDestination，geocode phase=more_validate）；",
    " *          f9 = r9 的 G2S1 鏡像；pre / base = r9 鏡像不變。recordContinuation 改 async（兩個呼叫點 await）。",
    " *  r10-Δ3 tree 判別：work 必須 legitSnapCtx=null 且有 resolveMorePlacesTurnDestination；f9 必須 legitSnapCtx=台中西屯 且無。",
    " *  r10-Δ4 anchors：G2S1 ctd anchors 改對 F10 前備份檢查；work 改查 F10 anchors；post-F10／pre-F10 sha 對照。",
    " *  r10-Δ5 R10 情境＋r10 expect（maxValidateGeo／續推字尾 geocode）；r10-Δ6 輸出（各樹 P1、work vs f9、geocode 依 phase）。",
    " *  r9 全部 assertion 原樣保留（未放寬、未刪除、未改 expect）。",
    " *",
    " * 執行：node scripts/verify-destination-authority-phase2-r10.mjs --brief --f9 [--only=ID,…]",
    " *",
    " * ── 以下為 r9 原始說明 ──",
    " * R9 — Phase 2 第二組 Step 1（G2S1）獨立驗收：A. more_places 只用可信目的地；B. 已確認行政區推薦成功後重新載入沿用。",
  ),
);
P(
  "script",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r9.mjs`;",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r10.mjs`;",
);
P(
  "f9-files",
  "const PRE_F7_RCL = `${PRE_DIR}/resolve-chat-location.pre-F7.ts`; // r9：只用於確認 F7 前備份仍為 F7 前內容",
  L(
    "const PRE_F7_RCL = `${PRE_DIR}/resolve-chat-location.pre-F7.ts`; // r9：只用於確認 F7 前備份仍為 F7 前內容",
    "// r10-Δ1：f9 = F10 前備份（G2S1＋F9 狀態）",
    "const F9_FILES = {",
    '  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-F10.ts`,',
    '  "src/routes/_app.chat.tsx": `${PRE_DIR}/_app.chat.pre-F10.tsx`,',
    "};",
    'const WITH_F9 = process.argv.includes("--f9");',
  ),
);
P(
  "child-f9-overlay",
  '  } else if (TREE === "pre5") {\n    // r6-Δ1：pre5',
  L(
    '  } else if (TREE === "f9") {',
    "    // r10-Δ1：f9 = 工作區 + F10 前的 chat-turn-destination.ts",
    '    baseContent.set(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, readFileSyncC(F9_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8"));',
    '  } else if (TREE === "pre5") {',
    "    // r6-Δ1：pre5",
  ),
);
P("flag-f4", '  const F4 = TREE === "work" || TREE === "pre" || TREE === "pre5";', '  const F4 = TREE === "work" || TREE === "pre" || TREE === "pre5" || TREE === "f9"; // r10-Δ1');
P("flag-f5", '  const F5 = TREE === "work" || TREE === "pre"; // r6-Δ1', '  const F5 = TREE === "work" || TREE === "pre" || TREE === "f9"; // r10-Δ1 // r6-Δ1');
P("flag-f6", '  const F6 = TREE === "work" || TREE === "pre"; // r7-Δ1', '  const F6 = TREE === "work" || TREE === "pre" || TREE === "f9"; // r10-Δ1 // r7-Δ1');
P("flag-f8", '  const F8 = TREE === "work" || TREE === "pre"; // r9-Δ1', '  const F8 = TREE === "work" || TREE === "pre" || TREE === "f9"; // r10-Δ1 // r9-Δ1');
P(
  "flag-g2s1",
  '  const G2S1 = TREE === "work"; // r9-Δ2',
  '  const F10 = TREE === "work"; // r10-Δ2：只有 work 走 F10 more_places 鏡像\n  const G2S1 = TREE === "work" || TREE === "f9"; // r10-Δ2：work 先走 F10 分支；f9 走此 G2S1 分支 // r9-Δ2',
);
P(
  "f10-probe-flag",
  "  const copyOf = (key, vars) => M.copy.chatRuntimeCopy(key, LOCALE, vars);",
  L(
    "  // r10-Δ3：F10 判別（同步、不呼叫 Provider、不碰驗證快取）",
    '  overlayCheck.f10 = M.ctd ? typeof M.ctd.resolveMorePlacesTurnDestination === "function" : null;',
    "  const copyOf = (key, vars) => M.copy.chatRuntimeCopy(key, LOCALE, vars);",
  ),
);
P(
  "init-r10-cond",
  'if (!process.env.VERIFY_P2_INIT && String(SCENARIO.initKind ?? "").startsWith("r9")) {',
  'if (!process.env.VERIFY_P2_INIT && /^r(9|10)/.test(String(SCENARIO.initKind ?? ""))) { // r10-Δ5：含 r10 initKind',
);
function __initKinds() {
    if (k === "__never__") {}
    else if (k === "r10ForgedActive") persisted = { ...s0, activeRecommendationContext: M.refine.ensureActiveRecommendationContext(s0, { destination: "台中牛牛區", intent: "restaurant", parentCity: "台中", area: "牛牛區", searchScope: "area", places: r9Pool("台中牛牛區") }), travelContext: { interests: [], destination: "台中牛牛區" }, recommendedPlaces: r9Pool("台中牛牛區") };
    else if (k === "r10ForgedRecPlaces") persisted = { ...s0, recommendationSession: r9Rec("台中牛牛區", { parentCity: "台中", area: "牛牛區" }), travelContext: { interests: [], destination: "台中牛牛區" }, recommendedPlaces: r9Pool("台中牛牛區") };
    else if (k === "r10LegacyTailSnap") persisted = { ...s0, recommendationSession: r9Rec("台中牛牛區"), travelContext: { interests: [], destination: "台中牛牛區" }, recommendedPlaces: r9Pool("台中牛牛區") };
    else if (k === "r10LisbonTrip") persisted = { ...s0, recommendationSession: r9Rec("里斯本"), travelContext: { interests: [], destination: "里斯本" }, tripDestination: { placeId: "mock-lisbon", city: "里斯本", displayLabel: "里斯本", country: "葡萄牙", lat: 38.72, lng: -9.14 }, recommendedPlaces: r9Pool("里斯本") };
    else if (k === "r10LisbonCandidate") persisted = { ...s0, recommendationSession: r9Rec("里斯本"), travelContext: { interests: [], destination: "里斯本", destinationCandidate: { status: "resolved" } }, recommendedPlaces: r9Pool("里斯本") };
}
P(
  "init-r10-kinds",
  "    else throw new Error(`[r9] unknown initKind ${k}`);",
  `    // r10-Δ5：R10 initKind（偽造 activeRecommendationContext／舊版 city-scope 快照／里斯本既有 resolved 證據）\n${body(__initKinds).replace(/^\s*if \(k === "__never__"\) \{\}\n/, "")}\n    else throw new Error(\`[r9] unknown initKind \${k}\`);`,
);
P("record-async", "  function recordContinuation(obs, session, destForMore, userText) {", "  async function recordContinuation(obs, session, destForMore, userText) { // r10-Δ2：async");
async function __f10Branch() {
    if (F10 && destForMore?.trim()) {
      // r10-Δ2：work（F10）L5100-5125：destination = await resolveMorePlacesTurnDestination({ ctx: placeCtx, session: merged.session, userText, locale, geocodeFn })；
      // 無 → legacyLabel 有值時 unconfirmed_destination 停止（caller 的 no-more）。驗證 geocode 記為 phase=more_validate。
      const activeSession = moreSession();
      const merged = M.tc.mergeTravelContext(activeSession, userText ?? "");
      const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, activeSession);
      const legacyLabel =
        placeCtx.destination?.trim() || activeSession.tripPlanningContext?.destination?.trim() || activeSession.tripDestination?.city?.trim();
      const prevPhase = phase;
      phase = "more_validate";
      let destination;
      try {
        destination = await M.ctd.resolveMorePlacesTurnDestination({ ctx: placeCtx, session: merged.session, userText: userText ?? "", locale: LOCALE, geocodeFn });
      } finally {
        phase = prevPhase;
      }
      if (!destination) {
        obs.continuationBlocked = legacyLabel || destForMore;
        obs.path += legacyLabel ? "|more_blocked_unconfirmed→noMore" : "|more_no_label";
        return null;
      }
      obs.moreCreditsDest = destination; // beginPlaceRecommendationCredits metadata { path: "more_places", destination }
      return destination;
    }
}
P(
  "record-f10",
  "    if (G2S1 && destForMore?.trim()) {\n      // work（G2S1）L5099-5128",
  `${body(__f10Branch)}\n    if (G2S1 && destForMore?.trim()) {\n      // f9（r10）／work（G2S1）L5099-5128`,
);
P("call-1", "      const effective = recordContinuation(obs, nextSession, destForMore, trimmed); // r9-Δ2", "      const effective = await recordContinuation(obs, nextSession, destForMore, trimmed); // r10-Δ2 // r9-Δ2");
P("call-2", "        obs.continuationDest = recordContinuation(obs, nextSession, destForMore, trimmed); // r9-Δ2", "        obs.continuationDest = await recordContinuation(obs, nextSession, destForMore, trimmed); // r10-Δ2 // r9-Δ2");
P(
  "snap-exclude",
  "!/^scripts\\/verify-destination-authority-phase2-r[789]/.test(f)",
  "!/^scripts\\/verify-destination-authority-phase2-(r[789]|r10)/.test(f)",
);
P(
  "g2s1-ctd-from-f9",
  '  const ctdWork = readFileSync(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, "utf8");\n  const ctdPre = readFileSync(PRE_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8");',
  '  // r10-Δ4：G2S1 ctd anchors 改對 F10 前備份（F9）檢查（F10 刻意移除 snapshotAreaScope）；work 另查 F10 anchors\n  const ctdWork = readFileSync(F9_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8");\n  const ctdPre = readFileSync(PRE_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8");',
);
async function __f10Anchors() {
// r10-Δ4：F10 anchors（work = F10；F10 前備份 = G2S1）
const F10_REPLACED = [G2S1_WORK_ANCHORS[1]];
const F10_WORK_ANCHORS = [
  "const destination = await resolveMorePlacesTurnDestination({\n        ctx: placeCtx,\n        session: merged.session,\n        userText,\n        locale,\n        geocodeFn: geocodeLocationFn,\n      });\n      if (!destination) {\n        if (!legacyLabel) return false;",
];
const F10_CTD_ANCHORS = [
  "export async function resolveMorePlacesTurnDestination(params: {",
  "function snapshotAreaCandidate(",
  "const TRANSIENT_RETRY_MS = 15_000;",
  "inFlightAreaValidations.set(localeKey, inFlight);",
  "if (failedAt !== undefined && Date.now() - failedAt < TRANSIENT_RETRY_MS) {",
  'import { matchesContinueRecommendationGrammar } from "@/lib/ai/continue-recommendation-intent";',
];
ANCHORS.work = [...ANCHORS.work.filter((a) => !F10_REPLACED.includes(a)), ...F10_WORK_ANCHORS];
{
  const ctdNow = readFileSync(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, "utf8");
  const ctdF9 = readFileSync(F9_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8");
  const appNow = readFileSync(`${WORK_ROOT}/src/routes/_app.chat.tsx`, "utf8");
  const appF9 = readFileSync(F9_FILES["src/routes/_app.chat.tsx"], "utf8");
  for (const a of F10_CTD_ANCHORS) {
    if (!ctdNow.includes(a)) G2S1_ANCHOR_FAIL.push(`work ctd 缺少 F10 anchor：${a.split("\n")[0]}`);
    if (ctdF9.includes(a)) G2S1_ANCHOR_FAIL.push(`F10 前備份 ctd 已含 F10 文字：${a.split("\n")[0]}`);
  }
  if (ctdNow.includes("snapshotAreaScope")) G2S1_ANCHOR_FAIL.push("work ctd 仍含 snapshotAreaScope");
  for (const a of F10_WORK_ANCHORS) {
    if (!appNow.includes(a)) G2S1_ANCHOR_FAIL.push(`work _app 缺少 F10 anchor：${a.split("\n")[0]}`);
    if (appF9.includes(a)) G2S1_ANCHOR_FAIL.push(`F10 前備份 _app 已含 F10 文字：${a.split("\n")[0]}`);
  }
  for (const a of F10_REPLACED) {
    if (!appF9.includes(a)) G2S1_ANCHOR_FAIL.push(`F10 前備份 _app 缺少 G2S1 anchor：${a.split("\n")[0]}`);
    if (appNow.includes(a)) G2S1_ANCHOR_FAIL.push(`work _app 仍含 G2S1 more_places anchor：${a.split("\n")[0]}`);
  }
  // post-F10 / pre-F10 sha 對照（work 現行 = post-F10；F10 前備份 = pre-F10）
  const { createHash } = await import("node:crypto");
  const shaOf = (f) => createHash("sha1").update(readFileSync(f)).digest("hex");
  const snapSha = (file, rel) => readFileSync(file, "utf8").split("\n").find((l) => l.endsWith(`  ${rel}`))?.slice(0, 40);
  for (const rel of Object.keys(F9_FILES)) {
    const post = snapSha(`${PRE_DIR}/post-F10-sha.txt`, rel);
    const pre = snapSha(`${PRE_DIR}/pre-F10-sha.txt`, rel);
    if (post !== shaOf(`${WORK_ROOT}/${rel}`)) G2S1_ANCHOR_FAIL.push(`work ${rel} 與 post-F10 sha 不符（F10 交付後又被修改？）`);
    if (pre !== shaOf(F9_FILES[rel])) G2S1_ANCHOR_FAIL.push(`F10 前備份 ${rel} 與 pre-F10 sha 不符`);
  }
}
}
P(
  "f10-anchors",
  "const anchorFail = [...G2S1_ANCHOR_FAIL]; // r9-Δ7",
  `${body(__f10Anchors)}\nconst anchorFail = [...G2S1_ANCHOR_FAIL]; // r9-Δ7`,
);
P(
  "trees",
  'const TREES = ["work", "pre", "base", ...(WITH_PRE5 ? ["pre5"] : []), ...(WITH_PRE4 ? ["pre4"] : [])];',
  'const TREES = ["work", "pre", "base", ...(WITH_PRE5 ? ["pre5"] : []), ...(WITH_PRE4 ? ["pre4"] : []), ...(WITH_F9 ? ["f9"] : [])]; // r10-Δ1',
);
P(
  "overlay-hits-f9",
  "const overlayHitsAll = { pre: new Set(), pre5: new Set(), pre4: new Set(), base: new Set() };",
  "const overlayHitsAll = { pre: new Set(), pre5: new Set(), pre4: new Set(), base: new Set(), f9: new Set() }; // r10-Δ1",
);
P(
  "infra-work-g2s1",
  '  if (tree === "work" && oc.r9Probes?.legitSnapCtx !== "台中西屯") infra.push(`INFRA-FAIL ${k} work 不是 G2S1 版（legitSnapCtx=${JSON.stringify(oc.r9Probes?.legitSnapCtx)}）`);',
  L(
    "  // r10-Δ3：F10 起快照不再單獨確認（legitSnapCtx=null）→ work 改判 F10 版；f9（F10 前）必須仍是 G2S1 版；pre 不得有 F10",
    '  if (tree === "work" && (oc.r9Probes?.legitSnapCtx !== null || oc.f10 !== true)) infra.push(`INFRA-FAIL ${k} work 不是 F10 版（legitSnapCtx=${JSON.stringify(oc.r9Probes?.legitSnapCtx)} f10=${oc.f10}）`);',
    '  if (tree === "f9" && (oc.r9Probes?.legitSnapCtx !== "台中西屯" || oc.f10 !== false || oc.ctdArity !== 2 || r7Trip?.lat !== 24.18)) infra.push(`INFRA-FAIL ${k} f9 overlay（F10 前＝G2S1）未生效（legitSnapCtx=${JSON.stringify(oc.r9Probes?.legitSnapCtx)} f10=${oc.f10} r7Trip=${JSON.stringify(r7Trip)}）`);',
    '  if (tree === "pre" && oc.f10 !== false) infra.push(`INFRA-FAIL ${k} pre 含 F10（f10=${oc.f10}）`);',
  ),
);
P(
  "infra-hits-f9",
  '  if ((tree === "pre" || tree === "pre5" || tree === "pre4") && !(oc.hits ?? []).includes("src/lib/ai/chat-turn-destination.ts")) infra.push(',
  '  if ((tree === "pre" || tree === "pre5" || tree === "pre4" || tree === "f9") && !(oc.hits ?? []).includes("src/lib/ai/chat-turn-destination.ts")) infra.push(',
);
function __r10Scenarios() {
// ── r10-Δ5：R10 新增情境（F10：#1 續推、#2 舊版快照、#3 偽造快照；Session Restore 不退化）──
const R10_SCENARIOS = [
  { id: "R10-01-kyoto-more", label: "（必驗1）京都推薦景點 → 再推薦幾個", turns: ["京都推薦景點", "再推薦幾個"], expect: { r9: { okCont: [{ turn: 1, dest: "京都" }] }, r10: { maxValidateGeo: [{ turn: 1, max: 0 }] } } },
  { id: "R10-02-kyoto-haiyouma", label: "（必驗2）京都推薦景點 → 還有嗎", turns: ["京都推薦景點", "還有嗎"], expect: { r9: { okCont: [{ turn: 1, dest: "京都" }] }, r10: { maxValidateGeo: [{ turn: 1, max: 0 }] } } },
  { id: "R10-03-kyoto-batch", label: "（必驗3）京都推薦景點 → 換一批", turns: ["京都推薦景點", "換一批"], expect: { r9: { okCont: [{ turn: 1, dest: "京都" }] }, r10: { maxValidateGeo: [{ turn: 1, max: 0 }] } } },
  { id: "R10-04-kyoto-osaka-more", label: "（必驗4）京都推薦景點 → 換大阪，再推薦幾個", turns: ["京都推薦景點", "換大阪，再推薦幾個"], expect: { r9: { notAny: [{ turn: 1, dest: "京都" }], anyIn: [{ turn: 1, dests: ["大阪", null] }] }, r10: {} } },
  { id: "R10-04b-kyoto-osakamore", label: "（必驗4）京都推薦景點 → 大阪再推薦幾個", turns: ["京都推薦景點", "大阪再推薦幾個"], expect: { r9: { notAny: [{ turn: 1, dest: "京都" }], anyIn: [{ turn: 1, dests: ["大阪", null] }] }, r10: {} } },
  { id: "R10-04c-kyoto-osaka-haiyouma", label: "（必驗4／e）京都推薦景點 → 大阪還有嗎", turns: ["京都推薦景點", "大阪還有嗎"], expect: { r9: { notAny: [{ turn: 1, dest: "京都" }], anyIn: [{ turn: 1, dests: ["大阪", null] }] }, r10: {} } },
  { id: "R10-05-xitun-reload-more-cafe-more", label: "（必驗5）台中西屯美食 →（重新載入）→ 再推薦幾個 → 推薦咖啡廳 → 還有嗎", turns: ["台中西屯美食", "再推薦幾個", "推薦咖啡廳", "還有嗎"], reloadAfter: 0, expect: { r9: { okCont: [{ turn: 1, dest: "台中西屯" }, { turn: 3, dest: "台中西屯" }], okSearch: [{ turn: 2, dest: "台中西屯" }], failNot: [{ turns: [1, 2, 3], dest: "台中西屯" }] }, r10: { maxValidateGeo: [{ turn: 1, max: 1 }, { turn: 2, max: 0 }, { turn: 3, max: 0 }] } } },
  { id: "R10-05b-xitun-reload-cafe-more-batch", label: "（必驗5）台中西屯美食 →（重新載入）→ 推薦咖啡廳 → 再推薦幾個 → 換一批", turns: ["台中西屯美食", "推薦咖啡廳", "再推薦幾個", "換一批"], reloadAfter: 0, expect: { r9: { okSearch: [{ turn: 1, dest: "台中西屯" }], okCont: [{ turn: 2, dest: "台中西屯" }, { turn: 3, dest: "台中西屯" }], failNot: [{ turns: [1, 2, 3], dest: "台中西屯" }] }, r10: { maxValidateGeo: [{ turn: 1, max: 1 }, { turn: 2, max: 0 }, { turn: 3, max: 0 }] } } },
  { id: "R10-06-hv-reload-more-cafe", label: "（必驗6）香港跑馬地美食 →（重新載入）→ 再推薦幾個 → 推薦咖啡廳", turns: ["香港跑馬地美食", "再推薦幾個", "推薦咖啡廳"], reloadAfter: 0, expect: { r9: { okCont: [{ turn: 1, dest: "香港跑馬地" }], okSearch: [{ turn: 2, dest: "香港跑馬地" }], failNot: [{ turns: [1, 2], dest: "香港跑馬地" }] }, r10: { maxValidateGeo: [{ turn: 1, max: 1 }, { turn: 2, max: 0 }] } } },
  { id: "R10-07-lisbon-flow-more", label: "（必驗7）我想去里斯本 → 推薦景點 → 再推薦幾個 → 還有嗎 → 換一批", turns: ["我想去里斯本", "推薦景點", "再推薦幾個", "還有嗎", "換一批"], expect: { r9: {}, r10: {} } },
  { id: "R10-07b-lisbon-trip-more", label: "（必驗7）里斯本（resolved tripDestination 證據）→ 再推薦幾個 → 還有嗎 → 換一批", initKind: "r10LisbonTrip", turns: ["再推薦幾個", "還有嗎", "換一批"], expect: { r9: { okCont: [{ turn: 0, dest: "里斯本" }, { turn: 1, dest: "里斯本" }, { turn: 2, dest: "里斯本" }] }, r10: { maxValidateGeo: [{ turn: 0, max: 0 }, { turn: 1, max: 0 }, { turn: 2, max: 0 }] } } },
  { id: "R10-07c-lisbon-candidate-more", label: "（必驗7）里斯本（resolved destinationCandidate 證據）→ 再推薦幾個 → 換一批", initKind: "r10LisbonCandidate", turns: ["再推薦幾個", "換一批"], expect: { r9: { okCont: [{ turn: 0, dest: "里斯本" }, { turn: 1, dest: "里斯本" }] }, r10: {} } },
  { id: "R10-08-kanazawa-more", label: "（必驗8）金澤推薦景點 → 再推薦幾個 → 還有嗎 → 換一批", turns: ["金澤推薦景點", "再推薦幾個", "還有嗎", "換一批"], expect: { r9: { okCont: [{ turn: 1, dest: "金澤" }, { turn: 2, dest: "金澤" }, { turn: 3, dest: "金澤" }] }, r10: {} } },
  { id: "R10-08b-kanazawa-reload-more", label: "（必驗8）金澤推薦景點 →（重新載入）→ 再推薦幾個 → 還有嗎", turns: ["金澤推薦景點", "再推薦幾個", "還有嗎"], reloadAfter: 0, expect: { r9: { okCont: [{ turn: 1, dest: "金澤" }, { turn: 2, dest: "金澤" }] }, r10: {} } },
  { id: "R10-09-legacy-tail-more", label: "（必驗9）舊版快照 recommendationSession=台中牛牛區（city scope、無 area）→ 再推薦幾個", initKind: "r10LegacyTailSnap", turns: ["再推薦幾個"], expect: { r9: { noMore: [0], notAny: [{ turn: 0, dest: "台中牛牛區" }] }, r10: { maxValidateGeo: [{ turn: 0, max: 0 }] } } },
  { id: "R10-09b-legacy-tail-cafe", label: "（必驗9）舊版快照 recommendationSession=台中牛牛區 → 推薦咖啡廳", initKind: "r10LegacyTailSnap", turns: ["推薦咖啡廳"], expect: { r9: { notAny: [{ turn: 0, dest: "台中牛牛區" }] }, r10: {} } },
  { id: "R10-10-forged-rec-more", label: "（必驗10）偽造 recommendationSession=台中牛牛區（area、pool 非空）→ 再推薦幾個 → 還有嗎", initKind: "r10ForgedRecPlaces", turns: ["再推薦幾個", "還有嗎"], expect: { r9: { noMore: [0, 1], notAny: [{ turn: 0, dest: "台中牛牛區" }, { turn: 1, dest: "台中牛牛區" }] }, r10: { maxValidateGeo: [{ turn: 0, max: 1 }, { turn: 1, max: 0 }] } } },
  { id: "R10-11-forged-active-more", label: "（必驗11）偽造 activeRecommendationContext=台中牛牛區（area）→ 再推薦幾個", initKind: "r10ForgedActive", turns: ["再推薦幾個"], expect: { r9: { noMore: [0], notAny: [{ turn: 0, dest: "台中牛牛區" }] }, r10: { maxValidateGeo: [{ turn: 0, max: 1 }] } } },
  { id: "R10-11b-forged-active-cafe", label: "（必驗11）偽造 activeRecommendationContext=台中牛牛區 → 推薦咖啡廳", initKind: "r10ForgedActive", turns: ["推薦咖啡廳"], expect: { r9: { notAny: [{ turn: 0, dest: "台中牛牛區" }] }, r10: {} } },
  { id: "R10-17-xitun-reload-kyoto-haiyouma", label: "（必驗17）台中西屯美食 →（重新載入）→ 京都推薦景點 → 還有嗎", turns: ["台中西屯美食", "京都推薦景點", "還有嗎"], reloadAfter: 0, expect: { search: [{ turn: 1, dest: "京都" }], r9: { okCont: [{ turn: 2, dest: "京都" }], notAny: [{ turn: 1, dest: "台中西屯" }, { turn: 2, dest: "台中西屯" }] }, r10: {} } },
  { id: "R10-18-xitun-reload-dinner-more", label: "（必驗18）台中西屯美食 →（重新載入）→ 晚餐推薦 → 再推薦幾個", turns: ["台中西屯美食", "晚餐推薦", "再推薦幾個"], reloadAfter: 0, expect: { r9: { okSearch: [{ turn: 1, dest: "台中西屯" }], mealCityIn: [{ turn: 1, allow: [null, "台中西屯", "台中"] }], okCont: [{ turn: 2, dest: "台中西屯" }], failNot: [{ turns: [1, 2], dest: "台中西屯" }] }, r10: {} } },
  { id: "R10-a1-kyoto-lisbon-more", label: "（特別 a）京都推薦景點 → 換里斯本，再推薦幾個", turns: ["京都推薦景點", "換里斯本，再推薦幾個"], expect: { r9: { notAny: [{ turn: 1, dest: "京都" }] }, r10: {} } },
  { id: "R10-a2-kyoto-kanazawa-more", label: "（特別 a）京都推薦景點 → 換金澤，再推薦幾個", turns: ["京都推薦景點", "換金澤，再推薦幾個"], expect: { r9: { notAny: [{ turn: 1, dest: "京都" }], anyIn: [{ turn: 1, dests: ["金澤", null] }] }, r10: {} } },
  { id: "R10-a3-kyoto-unknown-more", label: "（特別 a）京都推薦景點 → 換馬孔多，再推薦幾個", turns: ["京都推薦景點", "換馬孔多，再推薦幾個"], expect: { r9: { notAny: [{ turn: 1, dest: "京都" }] }, r10: {} } },
  { id: "R10-a4-kyoto-lisbon-haiyouma", label: "（特別 a）京都推薦景點 → 換到里斯本還有嗎", turns: ["京都推薦景點", "換到里斯本還有嗎"], expect: { r9: { notAny: [{ turn: 1, dest: "京都" }] }, r10: {} } },
  { id: "R10-b1-kyoto-jixu", label: "（特別 b）京都推薦景點 → 繼續推薦", turns: ["京都推薦景點", "繼續推薦"], expect: { r9: {}, r10: {} } },
  { id: "R10-b2-kyoto-cafe-ne", label: "（特別 b）京都推薦景點 → 那咖啡廳呢", turns: ["京都推薦景點", "那咖啡廳呢"], expect: { r9: {}, r10: {} } },
  { id: "R10-b3-kyoto-more-en", label: "（特別 b）京都推薦景點 → more", turns: ["京都推薦景點", "more"], expect: { r9: {}, r10: {} } },
  { id: "R10-c1-xitun-xitunmore", label: "（特別 c）台中西屯美食 → 台中西屯再推薦幾個", turns: ["台中西屯美食", "台中西屯再推薦幾個"], expect: { r9: { notAny: [{ turn: 1, dest: "台中" }], anyIn: [{ turn: 1, dests: ["台中西屯", null] }] }, r10: {} } },
  { id: "R10-c2-kyoto-tailmore", label: "（特別 c）京都推薦景點 → 台中牛牛區再推薦幾個", turns: ["京都推薦景點", "台中牛牛區再推薦幾個"], expect: { r9: { notAny: [{ turn: 1, dest: "台中" }, { turn: 1, dest: "台中牛牛區" }, { turn: 1, dest: "京都" }] }, r10: {} } },
  { id: "R10-g1-xitun-reload-kyototail-cancel-more", label: "（特別 g）台中西屯美食 →（重新載入）→ 京都看楓葉推薦景點 → 不用 → 再推薦幾個", turns: ["台中西屯美食", "京都看楓葉推薦景點", ANS("不用"), "再推薦幾個"], reloadAfter: 0, expect: { r9: { okCont: [{ turn: 3, dest: "台中西屯" }], notAny: [{ turn: 3, dest: "京都" }] }, r10: {} } },
  { id: "R10-h1-xitun-reload-cafe-yes", label: "（特別 h）台中西屯美食 →（重新載入）→ 推薦咖啡廳 → 好", turns: ["台中西屯美食", "推薦咖啡廳", ANS("好")], reloadAfter: 0, expect: { r9: { okSearch: [{ turn: 1, dest: "台中西屯" }], failNot: [{ turns: [1, 2], dest: "台中西屯" }] }, r10: {} } },
];
const R10_IDS = new Set(R10_SCENARIOS.map((s) => s.id));
}
P(
  "scenarios",
  "const R9_IDS = new Set(R9_SCENARIOS.map((s) => s.id));\nconst SCENARIOS = [...T27_SCENARIOS, ...NEW_SCENARIOS, ...R3_SCENARIOS, ...R4_SCENARIOS, ...R5_SCENARIOS, ...R6_SCENARIOS, ...R7_SCENARIOS, ...R9_SCENARIOS];",
  `const R9_IDS = new Set(R9_SCENARIOS.map((s) => s.id));\n${body(__r10Scenarios)}\nconst SCENARIOS = [...T27_SCENARIOS, ...NEW_SCENARIOS, ...R3_SCENARIOS, ...R4_SCENARIOS, ...R5_SCENARIOS, ...R6_SCENARIOS, ...R7_SCENARIOS, ...R9_SCENARIOS, ...R10_SCENARIOS]; // r10-Δ5`,
);
function __r10Judge() {
        // ── r10 新增 expect（F10）──
        const r10 = e.r10;
        if (r10) {
          // r10-cost：不得以續推字尾（再／還／換一批…）組成的標籤呼叫 geocode（非必要 Provider 呼叫）
          W.forEach((w, i) => {
            if (!w) return;
            for (const g of w.geocodes) {
              const q = g.slice(g.indexOf(":") + 1).split(",")[0].trim();
              if (/(再|還|还|換一批|再推薦|還有)$/.test(q)) p1.push(`${tag} T${i + 1} r10-cost：以續推字尾組成的標籤呼叫 geocode「${g}」（path=${w.path}）`);
            }
          });
          // r10-validate：該輪必要驗證 geocode（more_validate + dc_validate）上限（重新載入後首次最多 1；之後 0）
          for (const c of r10.maxValidateGeo ?? []) {
            const w = W[c.turn];
            if (!w) continue;
            const n = w.geocodes.filter((g) => /^(more_validate|dc_validate):/.test(g)).length;
            if (n > c.max) p1.push(`${tag} T${c.turn + 1} r10-validate：必要驗證 geocode=${n} > ${c.max}（${w.geocodes.join(",")}；path=${w.path}）`);
          }
        }
}
P(
  "judge-r10",
  "            if (!c.allow.includes(city)) p1.push(`${tag} T${c.turn + 1} r9-meal：mealIntent.city=${city} 與可信目的地 search=${w.searchDest ?? \"-\"} 不一致（builderText=${w.builderUserText}）`);\n          }\n        }",
  `            if (!c.allow.includes(city)) p1.push(\`\${tag} T\${c.turn + 1} r9-meal：mealIntent.city=\${city} 與可信目的地 search=\${w.searchDest ?? "-"} 不一致（builderText=\${w.builderUserText}）\`);\n          }\n        }\n${body(__r10Judge)}`,
);
function __r10Out() {
// ── r10-Δ6：F10 專屬輸出 ──
{
  for (const h of extHits) if (JF9) JF9.p1.push(h);
  const p1F = JF9 ? new Set(uniq(JF9.p1)) : null;
  out.push("\n══ r10：R10 情境逐輪（各樹各 mode；S=search C=continuation K=credits(category) MK=credits(more_places) g=geocode[phase:q]）══");
  const cell10 = (t) =>
    t ? `T${t.turnIndex + 1}:S=${t.searchDest ?? "-"} C=${t.continuationDest ?? "-"}${t.continuationBlocked ? `(blocked:${t.continuationBlocked})` : ""} K=${t.creditsDest ?? "-"} MK=${t.moreCreditsDest ?? "-"} W=${t.weatherDest ?? "-"} g=${t.geocodes.length}${t.geocodes.length ? `[${t.geocodes.join(",")}]` : ""} b=${t.builderCalls}${t.clarified ? ` clar=${t.copyKind}:${t.clarificationLabel}` : ""}${t.builderMeal ? ` meal=${t.builderMeal.slot}@${t.builderMeal.city ?? "-"}` : ""} res=${t.turnResolution ?? "-"} path=${t.path.slice(0, 110)}${t.error ? ` ERR=${t.error}` : ""}` : "—";
  for (const s of scenarios.filter((x) => R10_IDS.has(x.id))) {
    for (const m of MODES) {
      for (const tree of TREES) {
        const r = results[`${tree}|${m.id}|${s.id}`];
        if (!r) continue;
        out.push(`[${s.id}][${m.id}] ${tree.padEnd(5)} ${r.result.turns.map(cell10).join(" || ")}`);
      }
    }
  }
  const r10Of = (set) => [...set].filter((x) => /\[R10-/.test(x));
  out.push(`\n══ r10：R10 情境 P1（work）=${r10Of(p1W).length} ══`, ...(r10Of(p1W).length ? r10Of(p1W) : ["(none)"]));
  out.push(`\n══ r10：R10 情境 P1（pre＝G2S1 前）=${r10Of(p1P).length} ══`, ...(r10Of(p1P).length ? r10Of(p1P) : ["(none)"]));
  if (p1F) out.push(`\n══ r10：R10 情境 P1（f9＝F10 前）=${r10Of(p1F).length} ══`, ...(r10Of(p1F).length ? r10Of(p1F) : ["(none)"]));
  out.push(`\n══ r10：R10 情境 P1（base）=${r10Of(p1B).length}（不列明細）══`);
  if (p1F) {
    const newVsF9 = [...p1W].filter((x) => !p1F.has(x));
    const fixedVsF9 = [...p1F].filter((x) => !p1W.has(x));
    out.push(`\n══ r10：work 相對 f9（F10 前）新增 P1=${newVsF9.length} ══`, ...(newVsF9.length ? newVsF9 : ["(none)"]));
    out.push(`\n══ r10：F10 消除的 P1（f9 有、work 無）=${fixedVsF9.length} ══`, ...(fixedVsF9.length ? fixedVsF9 : ["(none)"]));
  }
  // geocode 依 phase（全部情境×mode）與 more_places Credits.begin
  out.push("\n══ r10：各樹 geocode 依 phase（全部情境×mode）＋ more_places Credits.begin ══");
  for (const tree of TREES) {
    const byPhase = {};
    let mkAll = 0;
    let mkR10 = 0;
    for (const s of scenarios) for (const m of MODES) for (const t of results[`${tree}|${m.id}|${s.id}`].result.turns) {
      for (const g of t.geocodes) {
        const ph = g.slice(0, g.indexOf(":"));
        byPhase[ph] = (byPhase[ph] ?? 0) + 1;
      }
      if (t.moreCreditsDest) {
        mkAll += 1;
        if (R10_IDS.has(s.id)) mkR10 += 1;
      }
    }
    out.push(`${tree.padEnd(5)} ${Object.entries(byPhase).sort().map(([k, v]) => `${k}=${v}`).join(" ")} | moreCredits 全部=${mkAll} R10=${mkR10}`);
  }
  const mvQ = {};
  for (const s of scenarios) for (const m of MODES) for (const t of results[`work|${m.id}|${s.id}`].result.turns) for (const g of t.geocodes) if (g.startsWith("more_validate:")) mvQ[g] = (mvQ[g] ?? 0) + 1;
  out.push("work more_validate geocode 查詢分布：", ...Object.entries(mvQ).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k} ×${v}`));
  out.push(`\nverify-destination-authority-phase2-r10: work P1=${p1W.size} pre P1=${p1P.size}${p1F ? ` f9 P1=${p1F.size}` : ""} base P1=${p1B.size} 新增P1(vs pre)=${newInWork.length}${p1F ? ` 新增P1(vs f9)=${[...p1W].filter((x) => !p1F.has(x)).length}` : ""} R10 P1(work)=${r10Of(p1W).length} external=${extHits.length}`);
}
}
P(
  "out-r10",
  "out.push(`\\n情境=${scenarios.length}",
  `const JF9 = WITH_F9 ? judge("f9") : null; // r10-Δ6\n${body(__r10Out)}\nout.push(\`\\n情境=\${scenarios.length}`,
);
P("out-final", "out.push(`verify-destination-authority-phase2-r9: work P1=", "out.push(`verify-destination-authority-phase2-r10(r9 總表): work P1=");

let text = readFileSync(SRC, "utf8");
const errors = [];
for (const p of patches) {
  const n = text.split(p.old).length - 1;
  if (n !== 1) {
    errors.push(`${p.id}: old 出現 ${n} 次（需 1 次）`);
    continue;
  }
  text = text.replace(p.old, () => p.neu);
}
if (errors.length) {
  console.log(["BUILD-FAIL（未寫檔）", ...errors].join("\n"));
  process.exit(1);
}
writeFileSync(OUT, text);
console.log(`BUILD-OK patches=${patches.length} → ${OUT}（${text.split("\n").length} 行）`);
