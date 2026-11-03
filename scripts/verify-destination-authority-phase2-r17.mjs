#!/usr/bin/env node
/**
 * R17 — Destination Authority 全量回歸（A2-MP-T2，tester；使用者授權：只更新 SHA＋新增對照樹 mp1）。
 *
 * 建立方式（同 r14／r15／r16 模式）：r12–r16 保留不改。r17 在執行期讀入 r16 原文（sha1 必須 = 842fd3be…，
 * scratchpad/pre-MP2T-test-sha.txt），套用 R17_R16_PATCHES（r16 原文層；每個錨點必須「恰好出現一次」，否則 INFRA-FAIL、不執行），
 * 再以 AsyncFunction 執行。patched r16 照常讀入 r15（a307fe97）→ r14（c60827a3）→ r13（8debfb44）。
 * r17 另把 R17_R15／R14／R13_PATCHES 附加到 r16 的 R16_R15／R14／R13_PATCHES 之後（同一套恰好一次檢查）。
 * 主程序與 collect 子程序都是同一份內容（子程序路徑改為 r17）。
 *
 * 只允許的變更（逐 hunk 見 --emit-diff 產生的 scratchpad/r17.diff）：
 *  r17-V  版本識別：
 *         - work 樹的 sha 檢查改對 scratchpad/post-MP-r2-sha.txt（A2-MP-F2 之後；r16 precheck、r14 wantApp.work、r13 四處）；
 *         - F7 後變動檔白名單 r1[0-6] → r1[0-7]，並加上 verify-more-places-cross-destination-r3.mjs（精確路徑）；
 *         - 子程序路徑 r17、摘要行。AsyncFunction 執行需要：r16 的 import 陳述式／import() 改由 __r17.imp 代為 import。
 *  r17-M  新增對照樹 mp1（--mp1）＝ A2-MP-F1 後、F2 前：所有檔案同 work（ctd 未被 F2 修改），
 *         _app.chat.tsx 擷取 scratchpad/pre-A2-MP2/_app.chat.tsx（sha = post-MP-r1-sha.txt）。旗標同 work。
 *         樹判別：mp1 必須含 A2＋A2-MP-F1（ctd recommendationSessionMatchesTrustedScope），且 _app 不得含 F2 模組函式；work 必須含。
 *         judge：J.mp1 = judge("mp1")。報告新增「work 相對 mp1 新增 P1／mp1 有 work 無」一節。
 *  r17-C  F2 在 _app.chat.tsx 新增的模組層函式（activeRecommendationContextMatchesTrustedScope、isStaleActiveRecommendationContext）
 *         成為擷取碼的新閉包依賴 → 列入已審查清單（R14_CLOSURE_DEPS），注入「該樹正式實作」：以 TypeScript AST 擷取
 *         _app.chat.tsx 頂層 function 宣告本體、轉 JS，依賴只能是該樹 @/ import（recommendationSessionMatchesTrustedScope、
 *         normalizeDestinationLabel）或允許的全域；其餘 → INFRA-FAIL。Callback／send() 區塊的擷取範圍不變；不是 noop。
 *  r17-O  只記錄（不進 r13 judge）：每輪 obs.r17Arc（activeRecommendationContext 的目的地／範圍／refinement 欄位）、
 *         obs.r17StaleCalls（isStale 正式實作回傳值）；外掛情境可宣告 r17Arc（初始 Session 帶一個過期 Context，以正式
 *         createActiveRecommendationContext 建立）與 r17Probe（work 樹以正式 isStale 實作探測標籤寫法）。
 *  不變：r13 的情境／Fixture／Assertion／expect／MODES／Credits 結算條件／Provider 請求限制／P1／P2 分類、r14 的 r14-A2 斷言、
 *        r15 的 r15-E／F／N／C／X、r16 的 a2 對照。外部請求攔截同 r13（任何外部請求 → FAIL）。未知閉包依賴仍 INFRA-FAIL。
 *
 * 執行：node scripts/verify-destination-authority-phase2-r17.mjs --brief --f10 --pa2 --a2 --mp1 [--only=ID,…] [--out=<scratchpad>/x.log] [--conc=N]
 *       node scripts/verify-destination-authority-phase2-r17.mjs --emit-diff     （寫 scratchpad/r17.diff 與 r17.* 執行內容）
 *       node scripts/verify-destination-authority-phase2-r17.mjs --model-check   （F2 修改點 vs 擷取範圍／r13 模型 的相容性報告）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R16_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r16.mjs`;
const R16_SHA = "842fd3be7ec0ef24ba932ef0282b513b9106f101"; // scratchpad/pre-MP2T-test-sha.txt
const R14_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r14.mjs`;
const R13_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r13.mjs`;
const MP1_APP = `${PRE_DIR}/pre-A2-MP2/_app.chat.tsx`;
const REL_APP = "src/routes/_app.chat.tsx";
const R17_MODULE_FNS = ["activeRecommendationContextMatchesTrustedScope", "isStaleActiveRecommendationContext"];
const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");
const L = (...lines) => lines.join("\n");

// ════════════════════════ r17-V／M：前提檢查（sha 快照）════════════════════════
function r17Precheck() {
  const fail = [];
  const snap = (file) => {
    const m = new Map();
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const x = line.match(/^([0-9a-f]{40}) {2}(.+)$/);
      if (x) m.set(x[2], x[1]);
    }
    return m;
  };
  const r1 = snap(`${PRE_DIR}/post-MP-r1-sha.txt`);
  const r2 = snap(`${PRE_DIR}/post-MP-r2-sha.txt`);
  const r0 = snap(`${PRE_DIR}/post-MP-sha.txt`);
  if (r2.size !== 18 || r1.size !== 18) fail.push(`post-MP-r1／r2 快照應各 18 檔（r1=${r1.size} r2=${r2.size}）`);
  if (JSON.stringify([...r0]) !== JSON.stringify([...r1])) fail.push("post-MP-sha.txt 與 post-MP-r1-sha.txt 不同（F1 快照被覆蓋？）");
  const diffRels = [...new Set([...r1.keys(), ...r2.keys()])].filter((rel) => r1.get(rel) !== r2.get(rel));
  if (JSON.stringify(diffRels) !== JSON.stringify([REL_APP])) fail.push(`post-MP-r1 與 post-MP-r2 的差異檔應恰為 _app.chat.tsx，實際=${diffRels.join(",")}`);
  const mp1Sha = existsSync(MP1_APP) ? sha1(readFileSync(MP1_APP)) : "(missing)";
  if (mp1Sha !== r1.get(REL_APP)) fail.push(`mp1 備份 ${MP1_APP} sha=${mp1Sha} ≠ post-MP-r1 ${r1.get(REL_APP)}`);
  const workApp = readFileSync(`${WORK_ROOT}/${REL_APP}`, "utf8");
  const mp1App = existsSync(MP1_APP) ? readFileSync(MP1_APP, "utf8") : "";
  for (const n of R17_MODULE_FNS) {
    if (!new RegExp(`\\nfunction ${n}\\(`).test(workApp)) fail.push(`work _app 沒有頂層 function ${n}（不是 A2-MP-F2 版）`);
    if (mp1App.includes(n)) fail.push(`mp1 _app 已含 ${n}（備份錯誤）`);
  }
  return fail;
}
let r17Mp1AppCache = null;
const r17Mp1App = () => (r17Mp1AppCache ??= readFileSync(MP1_APP, "utf8"));
/** F2 在 pushMorePlaceRecommendations 內、credits metadata 之前插入的區塊（逐字，來源 scratchpad/A2-MP2.app.diff @@ -5161）。 */
const R17_F2_MORE_BLOCK = L(
  "      // Same rule for the Refinement Context: kept only when it describes this turn's trusted",
  "      // scope; otherwise removed (never searched with, passed on or persisted). A later",
  "      // Refinement rebuilds it from the Recommendation Session written below.",
  "      const scopedRecContext = activeRecommendationContextMatchesTrustedScope(",
  "        activeSession.activeRecommendationContext,",
  "        trustedScope,",
  "      )",
  "        ? activeSession.activeRecommendationContext",
  "        : undefined;",
  "",
);
/** r13 G2S1 anchor 視窗：work 段落刪除 F2 區塊後必須與 mp1 段落逐字相同，才回傳 F2 區塊長度；否則 0。 */
function r17F2MoreDelta(appWork) {
  const seg = (t) => {
    const a = t.indexOf("const pushMorePlaceRecommendations = useCallback(");
    const c = t.indexOf('metadata: { path: "more_places", destination },');
    return a > 0 && c > a ? t.slice(a, c) : null;
  };
  const w = seg(appWork);
  const m = seg(r17Mp1App());
  if (!w || !m) return 0;
  const n = w.split(R17_F2_MORE_BLOCK).length - 1;
  return n === 1 && w.replace(R17_F2_MORE_BLOCK, "") === m ? R17_F2_MORE_BLOCK.length : 0;
}

// ════════════════════════ r17-M：work 相對 mp1 的 P1 比較（主程序報告；只新增輸出）════════════════════════
const R17_STATE = { newVsMp1: null, mp1Only: null, unexplained: null, extract: {} };
const R17_WORK_ONLY_RE = /(循環 import|chat-intent-router 依賴鏈| r4-SRC：)/;
function r17NoteExtract(tree, ex) {
  R17_STATE.extract[tree] = {
    file: ex.file,
    sha: ex.sha,
    units: Object.fromEntries(Object.entries(ex.units).map(([n, u]) => [n, { start: u.start, end: u.end, closure: u.closure }])),
    moduleFns: Object.fromEntries(Object.entries(ex.moduleFns ?? {}).map(([n, f]) => [n, { start: f.start, end: f.end, sha: f.sha, imports: f.imports, closure: f.closure, free: f.free }])),
  };
}
function r17ReportMp1({ P1, out }) {
  out.push("\n══ r17-C：F2 模組層函式擷取（_app.chat.tsx 頂層 function；注入該樹正式實作）══");
  for (const [tree, ex] of Object.entries(R17_STATE.extract)) {
    const m = Object.entries(ex.moduleFns);
    out.push(`  ${tree.padEnd(5)} ${m.length ? m.map(([n, f]) => `${n} L${f.start}-${f.end} sha=${f.sha.slice(0, 12)} import=[${f.imports.join(",")}] 未知依賴=[${f.closure.join(",")}]`).join("；") : "（無；該樹 Callback 不引用）"}`);
    const refs = Object.entries(ex.units).filter(([, u]) => u.closure.some((c) => R17_MODULE_FNS.includes(c))).map(([n, u]) => `${n}→${u.closure.filter((c) => R17_MODULE_FNS.includes(c)).join("+")}`);
    if (refs.length) out.push(`        引用：${refs.join("；")}`);
  }
  out.push("\n══ r17：work（A2-MP-F2 後）相對 mp1（A2-MP-F1 後、F2 前）══");
  if (!P1.mp1) {
    out.push("  （未跑 --mp1，無法比較）");
    return;
  }
  const newVs = [...P1.work].filter((x) => !P1.mp1.has(x));
  const mp1Only = [...P1.mp1].filter((x) => !P1.work.has(x));
  const workOnly = newVs.filter((x) => R17_WORK_ONLY_RE.test(x));
  const rest = newVs.filter((x) => !R17_WORK_ONLY_RE.test(x));
  R17_STATE.newVsMp1 = newVs.length;
  R17_STATE.mp1Only = mp1Only.length;
  R17_STATE.unexplained = rest.length;
  out.push(`  work P1=${P1.work.size} mp1 P1=${P1.mp1.size}；work 新增（vs mp1）=${newVs.length}（其中 work 專屬判定=${workOnly.length}、F2 後新出現=${rest.length}）；mp1 有 work 無=${mp1Only.length}`);
  out.push(`\n══ r17：work 相對 mp1 新增 P1=${rest.length}（不含 work 專屬判定）══`);
  for (const x of rest) out.push(`  [F2 後新出現${P1.a2 ? (P1.a2.has(x) ? "；a2 也有" : "；a2 無") : ""}${P1.pa2 ? (P1.pa2.has(x) ? "；pa2 也有" : "；pa2 無") : ""}] ${x}`);
  if (!rest.length) out.push("  (none)");
  if (workOnly.length) out.push(`── work 專屬判定（judge WT=work 才計；mp1 不計）=${workOnly.length} ──`, ...workOnly.map((x) => `  ${x}`));
  out.push(`\n══ r17：mp1 有、work 無（F2 消除）=${mp1Only.length} ══`, ...(mp1Only.length ? mp1Only.map((x) => `  ${x}`) : ["  (none)"]));
}
const r17SummaryFields = () => `r17[mp1：work新增=${R17_STATE.newVsMp1 ?? "-"}（F2 後新出現=${R17_STATE.unexplained ?? "-"}） mp1有work無=${R17_STATE.mp1Only ?? "-"}]`;

// ════════════════════════ R17_R13_PATCHES（r13 原文層；套在 R16_R13_PATCHES 之後）════════════════════════
const R17_R13_PATCHES = [
  // r17-M：mp1 樹（子程序）— 旗標同 work；不 overlay 任何檔案（ctd 與 work 相同）
  ...[
    ["F4", 'TREE === "work" || TREE === "pre" || TREE === "pre5" || TREE === "f9" || TREE === "f10" || TREE === "pa2"'],
    ["F5", 'TREE === "work" || TREE === "pre" || TREE === "f9" || TREE === "f10" || TREE === "pa2"'],
    ["F6", 'TREE === "work" || TREE === "pre" || TREE === "f9" || TREE === "f10" || TREE === "pa2"'],
    ["F8", 'TREE === "work" || TREE === "pre" || TREE === "f9" || TREE === "f10" || TREE === "pa2"'],
    ["F10", 'TREE === "work" || TREE === "f10" || TREE === "pa2"'],
    ["G2S1", 'TREE === "work" || TREE === "f9" || TREE === "f10" || TREE === "pa2"'],
  ].map(([name, rhs]) => ({ id: `r17-M flag ${name}`, kind: "exact", old: `  const ${name} = ${rhs} || TREE === "a2"; /* r16-A */`, neu: `  const ${name} = ${rhs} || TREE === "a2" || TREE === "mp1"; /* r16-A */ /* r17-M */` })),
  // r17-M：主程序 — --mp1 旗標、TREES、overlayHitsAll、judge、外部請求
  { id: "r17-M flag", kind: "exact", old: 'const WITH_A2 = process.argv.includes("--a2");', neu: 'const WITH_MP1 = process.argv.includes("--mp1"); /* r17-M：mp1 = A2-MP-F1 後、F2 前 */ const WITH_A2 = process.argv.includes("--a2");' },
  { id: "r17-M TREES", kind: "exact", old: '...(WITH_A2 ? ["a2"] : [])]; /* r16-A */', neu: '...(WITH_A2 ? ["a2"] : []), ...(WITH_MP1 ? ["mp1"] : [])]; /* r16-A */ /* r17-M */' },
  { id: "r17-M overlayHitsAll", kind: "exact", old: "pa2: new Set(), a2: new Set() }; /* r16-A */", neu: "pa2: new Set(), a2: new Set(), mp1: new Set() }; /* r16-A */ /* r17-M */" },
  { id: "r17-M J", kind: "exact", old: '...(WITH_A2 ? { a2: judge("a2") } : {}) }; /* r16-A：同一套 judge */', neu: '...(WITH_A2 ? { a2: judge("a2") } : {}), ...(WITH_MP1 ? { mp1: judge("mp1") } : {}) }; /* r16-A：同一套 judge */ /* r17-M：同一套 judge */' },
  { id: "r17-M extHits", kind: "exact", old: "  if (J.a2) J.a2.p1.push(h); // r16-A\n", neu: "  if (J.a2) J.a2.p1.push(h); // r16-A\n  if (J.mp1) J.mp1.p1.push(h); // r17-M\n" },
  // r17-V：r13 G2S1 source anchor 的 3000 字元視窗（moreAt→credits metadata）。F2 在兩者之間插入 scopedRecContext 區塊；
  //        只在「work 該段刪除 F2 區塊（逐字）後與 mp1 該段完全相同」時加上該區塊長度，否則加 0（＝原條件）。
  {
    id: "r17-V G2S1 anchor window（F2 區塊逐字扣除）",
    kind: "exact",
    old: "creditsAt - moreAt < 3000)) G2S1_ANCHOR_FAIL.push(",
    neu: "creditsAt - moreAt < 3000 + __r14.r15.r16.r17.f2MoreDelta(appWork))) /* r17-V */ G2S1_ANCHOR_FAIL.push(",
  },
  // r17-O：每輪只記錄 activeRecommendationContext（r13 judge 不讀）
  {
    id: "r17-O turn arc",
    kind: "exact",
    old: "      obs.r15Credits = creditsBegin.slice(c0).map((c) => ({ destination: c.destination ?? null, path: c.path ?? null }));\n",
    neu: L(
      "      obs.r15Credits = creditsBegin.slice(c0).map((c) => ({ destination: c.destination ?? null, path: c.path ?? null }));",
      "      // r17-O：本輪結束時 activeRecommendationContext（目的地／範圍／refinement 欄位；只記錄）",
      "      obs.r17Arc = persisted.activeRecommendationContext ? (({ destinationName, destinationDisplayName, parentCity, area, searchScope, intent, exhausted, budget, cuisine, mealSlot }) => ({ destinationName: destinationName ?? null, destinationDisplayName: destinationDisplayName ?? null, parentCity: parentCity ?? null, area: area ?? null, searchScope: searchScope ?? null, intent: intent ?? null, exhausted: Boolean(exhausted), budget: budget?.level ?? null, cuisine: cuisine ?? null, mealSlot: mealSlot ?? null }))(persisted.activeRecommendationContext) : null;",
      "      obs.r17Pending = persisted.pendingClarification ? { kind: persisted.pendingClarification.kind ?? null, raw: persisted.pendingClarification.rawGeographicLabel ?? null, parent: persisted.pendingClarification.confirmedParentCity ?? null } : null;",
      "",
    ),
  },
  // r17-O：外掛情境的初始過期 Context（只在 r17Arc 情境；r13／r2 情境沒有此欄位 → 不執行）
  {
    id: "r17-O init arc",
    kind: "exact",
    old: "  if (!process.env.VERIFY_P2_INIT && !SCENARIO.initKind && SCENARIO.r15Init) persisted = __r14.r15.buildInit(SCENARIO.r15Init, { createRecommendationSession: M.crs.createRecommendationSession, base: baseSession() });\n",
    neu: L(
      "  if (!process.env.VERIFY_P2_INIT && !SCENARIO.initKind && SCENARIO.r15Init) persisted = __r14.r15.buildInit(SCENARIO.r15Init, { createRecommendationSession: M.crs.createRecommendationSession, base: baseSession() });",
      "  // r17-O：外掛情境的「過期 activeRecommendationContext」（該樹正式 createActiveRecommendationContext 建立；只在 r17Arc 情境）",
      "  if (!process.env.VERIFY_P2_INIT && !SCENARIO.initKind && SCENARIO.r15Init && SCENARIO.r17Arc) persisted = { ...persisted, activeRecommendationContext: M.refine.createActiveRecommendationContext({ destinationName: SCENARIO.r17Arc.destination, destinationDisplayName: SCENARIO.r17Arc.destination, intent: SCENARIO.r17Arc.intent ?? \"restaurant\", parentCity: SCENARIO.r17Arc.parentCity, area: SCENARIO.r17Arc.area, searchScope: SCENARIO.r17Arc.searchScope ?? \"city\", placeIds: [], canonicalKeys: [], usedQueries: [] }) };",
      "",
    ),
  },
  // r17-O：isStale 正式實作的標籤寫法探針（work 樹；其餘樹沒有該函式 → 標 N/A）
  {
    id: "r17-O probe",
    kind: "exact",
    old: "    if (SCENARIO.r15Probe) result.r15Probe = await __r14.r15.unitProbe(",
    neu: L(
      "    if (SCENARIO.r17Probe) result.r17Probe = __r14.r15.r16.r17.probe({ TREE, has: Boolean(R14X.moduleFns?.isStaleActiveRecommendationContext), isStale: R14_closure.isStaleActiveRecommendationContext, matches: R14_closure.activeRecommendationContextMatchesTrustedScope }); // r17-O",
      "    if (SCENARIO.r15Probe) result.r15Probe = await __r14.r15.unitProbe(",
    ),
  },
];

/** r17-O 探針（子程序內呼叫）：以正式 isStale 實作判定「同一地點的不同寫法」是否被誤判為過期（只記錄）。 */
function r17Probe({ TREE, has, isStale, matches }) {
  if (!has) return { tree: TREE, na: true };
  const pairs = [
    ["京都", "京都", false],
    ["京都", "金澤", true],
    ["京都", "京都市", false],
    ["京都", "Kyoto", false],
    ["京都", " 京都 ", false],
    ["金澤", "金沢", false],
    ["金澤", "金沢市", false],
    ["台中西屯", "台中 西屯", false],
    ["台中西屯", "台中市西屯區", false],
    ["台中西屯", "臺中西屯", false],
    ["台中西屯", "台中・西屯", false],
    ["台中西屯", "台中北屯", true],
    ["香港跑馬地", "香港 跑馬地", false],
    ["里斯本", "Lisbon", false],
    ["里斯本", "Lisboa", false],
  ];
  const rows = pairs.map(([arc, rec, want]) => {
    let got;
    try {
      got = isStale({ activeRecommendationContext: { destinationName: arc, intent: "restaurant", searchScope: "city" }, recommendationSession: { destination: rec, searchScope: "city" } });
    } catch (e) {
      got = `THROW:${String(e?.message ?? e).slice(0, 80)}`;
    }
    return { arc, rec, want, got };
  });
  const tc = [["京都", "金澤", true], ["京都", "京都市", false]].map(([arc, dest, want]) => ({ arc, travelContext: dest, want, got: isStale({ activeRecommendationContext: { destinationName: arc, intent: "restaurant" }, travelContext: { destination: dest, interests: [] } }) }));
  const scope = [
    ["台中西屯", { status: "trusted", destination: "台中市西屯區", area: { parentCity: "台中市", area: "西屯區" } }],
    ["台中西屯", { status: "trusted", destination: "台中西屯", area: { parentCity: "台中", area: "西屯" } }],
  ].map(([arc, ts]) => {
    let got;
    try {
      got = matches({ destinationName: arc, parentCity: "台中", area: "西屯", searchScope: "area", intent: "restaurant" }, ts);
    } catch (e) {
      got = `THROW:${String(e?.message ?? e).slice(0, 80)}`;
    }
    return { arc, trusted: ts.destination, got };
  });
  return { tree: TREE, rows, tc, scope };
}

// ════════════════════════ R17_R14_PATCHES（r14 原文層；套在 R16_R14_PATCHES 之後）════════════════════════
const R17_R14_PATCHES = [
  // r17-M：mp1 的 _app 擷取來源與 sha
  {
    id: "r17-M wantApp mp1",
    kind: "exact",
    old: "a2: shaLine(`${PRE_DIR}/post-A2-sha.txt`, \"src/routes/_app.chat.tsx\"), // r16-V",
    neu: "mp1: shaLine(`${PRE_DIR}/post-MP-r1-sha.txt`, \"src/routes/_app.chat.tsx\"), /* r17-M：mp1=post-MP-r1 */ a2: shaLine(`${PRE_DIR}/post-A2-sha.txt`, \"src/routes/_app.chat.tsx\"), // r16-V",
  },
  {
    id: "r17-M app source mp1",
    kind: "exact",
    old: "  a2: () => ({ file: `${PRE_DIR}/pre-A2-MP/_app.chat.tsx`, text: __r15.r16.a2App() }), // r16-A：post-A2（A2-MP 修正前）\n",
    neu: "  a2: () => ({ file: `${PRE_DIR}/pre-A2-MP/_app.chat.tsx`, text: __r15.r16.a2App() }), // r16-A：post-A2（A2-MP 修正前）\n  mp1: () => ({ file: `${PRE_DIR}/pre-A2-MP2/_app.chat.tsx`, text: __r15.r16.r17.mp1App() }), // r17-M：A2-MP-F1 後、F2 前\n",
  },
  { id: "r17-M fingerprint work has", kind: "exact", old: '      if ((tree === "work" || tree === "a2") && !has) fail.push( /* r16-A：a2 同為 A2 後 */', neu: '      if ((tree === "work" || tree === "a2" || tree === "mp1") && !has) fail.push( /* r16-A：a2 同為 A2 後 */ /* r17-M */' },
  { id: "r17-M fingerprint others", kind: "exact", old: '      if (tree !== "work" && tree !== "a2" && has) fail.push( /* r16-A */', neu: '      if (tree !== "work" && tree !== "a2" && tree !== "mp1" && has) fail.push( /* r16-A */ /* r17-M */' },
  { id: "r17-M safeStop work", kind: "exact", old: '    if ((tree === "work" || tree === "a2") && !safeStop) fail.push( /* r16-A */', neu: '    if ((tree === "work" || tree === "a2" || tree === "mp1") && !safeStop) fail.push( /* r16-A */ /* r17-M */' },
  { id: "r17-M safeStop others", kind: "exact", old: '    if (tree !== "work" && tree !== "a2" && safeStop) fail.push( /* r16-A */', neu: '    if (tree !== "work" && tree !== "a2" && tree !== "mp1" && safeStop) fail.push( /* r16-A */ /* r17-M */' },
  {
    id: "r17-M infraTree",
    kind: "exact",
    old: '  if (tree !== "work" && tree !== "a2" && oc.mp !== false && oc.mp !== null) infra.push(',
    neu: L(
      '  if (tree === "mp1" && (oc.a2 !== true || oc.mp !== true)) infra.push(`INFRA-FAIL ${k} mp1 不是 A2-MP-F1 版（a2=${oc.a2} mp=${oc.mp}）`); // r17-M',
      '  if (tree !== "work" && tree !== "a2" && tree !== "mp1" && oc.mp !== false && oc.mp !== null) infra.push( /* r17-M：+mp1 */',
    ),
  },
  { id: "r17-M P1 table mp1", kind: "exact", old: '  for (const t of ["work", "a2", "pa2", "f10", "pre", "base"]) { // r16-A：+a2', neu: '  for (const t of ["work", "mp1", "a2", "pa2", "f10", "pre", "base"]) { // r16-A：+a2 // r17-M：+mp1' },
  // r17-C：已審查閉包依賴（F2 新增的模組層函式）
  {
    id: "r17-C closure deps",
    kind: "exact",
    old: '  requestAnimationFrame: "記錄器（UI；計數，不執行 callback）",\n};\n',
    neu: L(
      '  requestAnimationFrame: "記錄器（UI；計數，不執行 callback）",',
      "  // r17-C：A2-MP-F2 新增的 _app.chat.tsx 模組層函式（已審查）→ 該樹正式實作（AST 擷取頂層 function 宣告、轉 JS；依賴只能是該樹 @/ import）",
      '  activeRecommendationContextMatchesTrustedScope: "正式實作（_app.chat.tsx 頂層 function；依賴 recommendationSessionMatchesTrustedScope＝該樹 chat-turn-destination.ts）",',
      '  isStaleActiveRecommendationContext: "正式實作（_app.chat.tsx 頂層 function；依賴 normalizeDestinationLabel＝該樹 trip-planning-context.ts）",',
      "};",
      "",
    ),
  },
  // r17-C：擷取（只擷取已審查名稱的頂層 function 宣告；Callback／區塊擷取不變）
  {
    id: "r17-C extract module fns",
    kind: "exact",
    old: "  return { label, file, sha: sha1(srcText), imports, units };\n",
    neu: L(
      "  // r17-C：已審查的 _app.chat.tsx 模組層函式（只擷取頂層 function 宣告本體；Callback／send() 區塊擷取範圍不變）",
      `  const R17_MODULE_FNS = ${JSON.stringify(R17_MODULE_FNS)};`,
      "  const moduleFns = {};",
      "  for (const st of sf.statements) {",
      "    if (!ts.isFunctionDeclaration(st) || !st.name || !R17_MODULE_FNS.includes(st.name.text)) continue;",
      "    if (moduleFns[st.name.text]) throw new Error(`[r14-extract] ${label} 模組函式 ${st.name.text} 出現兩次`);",
      "    const text = st.getText(sf);",
      "    const js = toJs(`(${text})`);",
      "    const free = r14FreeIdentifiers(ts, js);",
      "    moduleFns[st.name.text] = {",
      "      js,",
      "      start: lineOf(st.getStart(sf)),",
      "      end: lineOf(st.getEnd()),",
      "      sha: sha1(text),",
      "      free,",
      "      imports: free.filter((x) => importNames.has(x)),",
      "      closure: free.filter((x) => !importNames.has(x) && !R14_ALLOWED_GLOBALS.has(x) && !R17_MODULE_FNS.includes(x)),",
      "    };",
      "  }",
      "  return { label, file, sha: sha1(srcText), imports, units, moduleFns };",
      "",
    ),
  },
  {
    id: "r17-C prepare checks",
    kind: "exact",
    old: "    // 版本指紋（反向）：work 的 5 個 Callback 都有 A2 可信判定、alt 分支有 SAFE_STOP；A2 前的樹都沒有\n",
    neu: L(
      "    // r17-C：模組層函式的依賴只能是該樹 @/ import／允許的全域；Callback 引用的模組層函式必須在該樹 _app 有頂層宣告（否則 INFRA-FAIL）",
      "    {",
      `      const R17_MODULE_FNS = ${JSON.stringify(R17_MODULE_FNS)};`,
      "      for (const [n, f] of Object.entries(ex.moduleFns ?? {})) {",
      "        for (const c of f.closure) fail.push(`${tree} 模組函式 ${n} 未知依賴：${c}（未審查 → FAIL）`);",
      "        for (const i of f.imports) {",
      "          const spec = ex.imports.find((x) => x[0] === i)[1];",
      "          if (!spec.startsWith(\"@/\")) fail.push(`${tree} 模組函式 ${n} 非 @/ import：${i} <- ${spec}（未審查 → FAIL）`);",
      "        }",
      "      }",
      "      for (const [name, u] of Object.entries(ex.units)) for (const c of u.closure) if (R17_MODULE_FNS.includes(c) && !ex.moduleFns?.[c]) fail.push(`${tree} ${name} 引用 ${c}，但該樹 _app.chat.tsx 沒有頂層宣告`);",
      "      // r17-M：A2-MP-F2 指紋（work 必須有；mp1／a2／其餘樹不得有）",
      "      const f2 =",
      "        Boolean(ex.moduleFns?.isStaleActiveRecommendationContext && ex.moduleFns?.activeRecommendationContextMatchesTrustedScope) &&",
      "        /\\bisStaleActiveRecommendationContext\\b/.test(ex.units.refetchBranch.js) &&",
      "        /\\bisStaleActiveRecommendationContext\\b/.test(ex.units.pushRecommendationRefinement.js) &&",
      "        /\\bactiveRecommendationContextMatchesTrustedScope\\b/.test(ex.units.pushMorePlaceRecommendations.js);",
      '      if (tree === "work" && !f2) fail.push("work 不是 A2-MP-F2 版（缺少 F2 模組函式或 Callback／refetch 分支未引用）");',
      '      if (tree !== "work" && Object.keys(ex.moduleFns ?? {}).length) fail.push(`${tree} 含 A2-MP-F2 模組函式（備份錯誤？）`);',
      "      __r15.r16.r17.noteExtract(tree, ex);",
      "    }",
      "    // 版本指紋（反向）：work 的 5 個 Callback 都有 A2 可信判定、alt 分支有 SAFE_STOP；A2 前的樹都沒有",
      "",
    ),
  },
  {
    id: "r17-C payload",
    kind: "exact",
    old: "      units: Object.fromEntries(Object.entries(ex.units).map(([n, u]) => [n, { kind: u.kind, js: u.js, closure: u.closure, imports: u.imports, start: u.start, end: u.end, sha: u.sha }])),\n",
    neu: L(
      "      units: Object.fromEntries(Object.entries(ex.units).map(([n, u]) => [n, { kind: u.kind, js: u.js, closure: u.closure, imports: u.imports, start: u.start, end: u.end, sha: u.sha }])),",
      "      moduleFns: Object.fromEntries(Object.entries(ex.moduleFns ?? {}).map(([n, f]) => [n, { js: f.js, imports: f.imports, closure: f.closure, start: f.start, end: f.end, sha: f.sha }])), // r17-C",
      "",
    ),
  },
  {
    id: "r17-C child imports",
    kind: "exact",
    old: "    const needed = new Set(Object.values(R14X.units).flatMap((u) => u.imports));",
    neu: "    const needed = new Set([...Object.values(R14X.units), ...Object.values(R14X.moduleFns ?? {})].flatMap((u) => u.imports)); // r17-C：＋模組層函式的 import（同一份該樹 import 表）",
  },
  {
    id: "r17-C child closure",
    kind: "exact",
    old: "  const R14_closure = {\n    locale: LOCALE,\n",
    neu: L(
      "  // r17-C：模組層函式＝該樹正式實作（第一次呼叫時以同一個 R14_scope 編譯；該樹沒有宣告 → 呼叫即丟錯＝INFRA-FAIL；不是 noop）",
      "  const R17_moduleCache = {};",
      "  const R17_moduleFn = (n) => {",
      "    if (R17_moduleCache[n]) return R17_moduleCache[n];",
      "    const f = R14X.moduleFns?.[n];",
      "    if (!f) throw new Error(`[r14] ${TREE} 沒有模組函式 ${n} 的正式實作（未知依賴 → FAIL）`);",
      "    if (f.closure.length) throw new Error(`[r14] 模組函式 ${n} 未知依賴：${f.closure.join(\",\")}`);",
      "    return (R17_moduleCache[n] = R14_compile(f.js, R14_scope(R14_closure)));",
      "  };",
      "  const R17_rec = (n, r) => {",
      "    if (R14_CUR.obs) (R14_CUR.obs[n] ??= []).push(r);",
      "    return r;",
      "  };",
      "  const R14_closure = {",
      '    activeRecommendationContextMatchesTrustedScope: (...a) => R17_rec("r17MatchCalls", R17_moduleFn("activeRecommendationContextMatchesTrustedScope")(...a)),',
      '    isStaleActiveRecommendationContext: (...a) => R17_rec("r17StaleCalls", R17_moduleFn("isStaleActiveRecommendationContext")(...a)),',
      "    locale: LOCALE,",
      "",
    ),
  },
];

// ════════════════════════ R17_R15_PATCHES（r15 原文層；套在 R16_R15_PATCHES 之後）════════════════════════
const R17_R15_PATCHES = [];

// ════════════════════════ R17_R16_PATCHES（r16 原文層）════════════════════════
const R17_R16_INFRA = [
  {
    id: "r17-V static imports → __r17.imp（AsyncFunction 執行需要）",
    old: L('import { readFileSync, writeFileSync, existsSync } from "node:fs";', 'import { createHash } from "node:crypto";', 'import { execFileSync } from "node:child_process";'),
    neu: L(
      'const { readFileSync, writeFileSync, existsSync } = await __r17.imp("node:fs"); // r17：同 r16 的 import（AsyncFunction 內不能用 import 陳述式）',
      'const { createHash } = await __r17.imp("node:crypto");',
      'const { execFileSync } = await __r17.imp("node:child_process");',
    ),
  },
  { id: "r17-V __r16.imp", old: "const makeR16 = (extra) => ({\n  imp: (s) => import(s),\n", neu: "const makeR16 = (extra) => ({\n  imp: __r17.imp, // r17\n" },
  { id: "r17 __r16.r17", old: "  capture: null,\n  ...extra,\n", neu: "  capture: null,\n  r17: __r17, // r17\n  ...extra,\n" },
  { id: "r17 patch hooks r13/r14", old: "// ════════════════════════ R16_R15_PATCHES（r15 原文層）════════════════════════\n", neu: "for (const p of __r17.r13Patches) R16_R13_PATCHES.push(p); // r17：R17_R13_PATCHES 套在 R16_R13_PATCHES 之後\nfor (const p of __r17.r14Patches) R16_R14_PATCHES.push(p); // r17：R17_R14_PATCHES 套在 R16_R14_PATCHES 之後\n// ════════════════════════ R16_R15_PATCHES（r15 原文層）════════════════════════\n" },
  { id: "r17 patch hooks r15", old: "function r16Apply(src, patches, what) {\n", neu: "for (const p of __r17.r15Patches) R16_R15_PATCHES.push(p); // r17：R17_R15_PATCHES 套在 R16_R15_PATCHES 之後\nfunction r16Apply(src, patches, what) {\n" },
  { id: "r17 r16 emit-diff off", old: 'if (process.argv.includes("--emit-diff")) {\n  // 基準＝', neu: 'if (__r17.r16EmitDiff === true) { // r17：r16 自身的 --emit-diff 不執行（改由 r17 產生 scratchpad/r17.diff）\n  // 基準＝' },
  { id: "r17 emit precheck", old: "const pre = r16Precheck();\n", neu: "const pre = __r17.emitMode ? [] : r16Precheck(); // r17：--emit-diff 只擷取執行內容（不跑 sha 前提）\n" },
  { id: "r17 emit capture r15", old: "const AsyncFunction = (async () => {}).constructor;\nconst makeR16 = ", neu: "if (__r17.onR16Body) __r17.onR16Body(r16Body); // r17：--emit-diff 擷取實際執行的 r15\nconst AsyncFunction = (async () => {}).constructor;\nconst makeR16 = " },
  { id: "r17 run extra", old: ")(makeR16({}));", neu: ")(makeR16(__r17.r16Extra ?? {})); // r17" },
];
const R17_R16_PATCHES = [
  ...R17_R16_INFRA,
  // r17-V：work 的 sha 檢查改對 post-MP-r2（r16 precheck＋r16 傳下去的 r13／r14 patch）
  { id: "r17-V r16 precheck post-MP-r2", old: "  const postMP = snap(`${PRE_DIR}/post-MP-sha.txt`);", neu: "  const postMP = snap(`${PRE_DIR}/post-MP-r2-sha.txt`); // r17-V：post-MP-r2（A2-MP-F2 後）" },
  { id: "r17-V r13 cri post-MP-r2", old: 'neu: "const postCbSha = readFileSync(`${PRE_DIR}/post-MP-sha.txt`', neu: 'neu: "const postCbSha = readFileSync(`${PRE_DIR}/post-MP-r2-sha.txt`' },
  { id: "r17-V r13 A1/A2 sources post-MP-r2", old: 'neu: "const postA2Lines = readFileSync(`${PRE_DIR}/post-MP-sha.txt`', neu: 'neu: "const postA2Lines = readFileSync(`${PRE_DIR}/post-MP-r2-sha.txt`' },
  { id: "r17-V r13 cri anchor post-MP-r2", old: 'neu: "if (snapSha(`${PRE_DIR}/post-MP-sha.txt`, relCri)', neu: 'neu: "if (snapSha(`${PRE_DIR}/post-MP-r2-sha.txt`, relCri)' },
  { id: "r17-V r13 F9 files post-MP-r2", old: 'neu: "const postCB = snapSha(`${PRE_DIR}/post-MP-sha.txt`, rel);', neu: 'neu: "const postCB = snapSha(`${PRE_DIR}/post-MP-r2-sha.txt`, rel);' },
  { id: "r17-V r14 wantApp post-MP-r2", old: "neu: '  const wantApp = { work: shaLine(`${PRE_DIR}/post-MP-sha.txt`", neu: "neu: '  const wantApp = { work: shaLine(`${PRE_DIR}/post-MP-r2-sha.txt`" },
  // r17-V：白名單、子程序、摘要
  {
    id: "r17-V whitelist",
    old: String.raw`'r1[0-6])/.test(f) && f !== \\"scripts/verify-more-places-cross-destination-r2.mjs\\" /* r16-V：r1[0-6]＋more-places-r2 */ && f !== `,
    neu: String.raw`'r1[0-7])/.test(f) && f !== \\"scripts/verify-more-places-cross-destination-r2.mjs\\" && f !== \\"scripts/verify-more-places-cross-destination-r3.mjs\\" /* r16-V：r1[0-6]＋more-places-r2；r17-V：r1[0-7]＋more-places-r3 */ && f !== `,
  },
  { id: "r17-V child script", old: "phase2-r16.mjs`; // r16：子程序執行 r16", neu: "phase2-r17.mjs`; // r17：子程序執行 r17（＝r16＋R17 patch）；原 r16：子程序執行 r16" },
  { id: "r17-V summary", old: 'verify-destination-authority-phase2-r16: work P1=${sz("work")} a2 P1=', neu: 'verify-destination-authority-phase2-r17: work P1=${sz("work")} mp1 P1=${sz("mp1")} a2 P1=' },
  { id: "r17-V summary fields", old: "${__r15.r16.summaryFields()} → ", neu: "${__r15.r16.summaryFields()} ${__r15.r16.r17.summaryFields()} → " },
  {
    id: "r17-M report",
    old: "__r16.reportA2({ P1, out }); // r16-A：work 相對 a2（只新增輸出）\\n",
    neu: "__r16.reportA2({ P1, out }); // r16-A：work 相對 a2（只新增輸出）\\n  __r16.r17.reportMp1({ P1, out }); // r17-M：work 相對 mp1、r17-C 擷取表（只新增輸出）\\n",
  },
];

function r17Apply(src, patches, what) {
  let text = src;
  const count = (hay, needle) => {
    let n = 0;
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) n += 1;
    return n;
  };
  for (const p of patches) {
    const n = count(text, p.old);
    if (n !== 1) throw new Error(`${what} patch ${p.id}：錨點出現 ${n} 次（必須 1 次）`);
    text = text.replace(p.old, () => p.neu);
  }
  return text;
}

// ════════════════════════ --model-check：F2 修改點 vs 擷取範圍／r13 模型 ════════════════════════
async function r17ModelCheck() {
  const ts = (await import("typescript")).default;
  const out = [];
  const read = (f) => readFileSync(f, "utf8");
  const ranges = (label, text) => {
    const sf = ts.createSourceFile(label, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
    const r = [];
    const CBS = ["pushDestinationCategoryPlaceRecommendation", "pushMorePlaceRecommendations", "pushRecommendationRefinement", "pushAlternativeDestinationPlaceRecommendation", "pushDestinationPlaceRecommendation", "pushNearbyPlaceRecommendation"];
    const other = [];
    const visit = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer) && n.initializer.expression.getText(sf) === "useCallback") {
        (CBS.includes(n.name.text) ? r : other).push({ name: n.name.text, start: lineOf(n.getStart(sf)), end: lineOf(n.getEnd()), formal: CBS.includes(n.name.text) });
      }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "send" && n.initializer && ts.isArrowFunction(n.initializer)) other.push({ name: "send", start: lineOf(n.getStart(sf)), end: lineOf(n.getEnd()), formal: false });
      if (ts.isIfStatement(n) && n.expression.getText(sf) === "shouldAcceptAlternativeRecommendations(msgs, trimmed)") r.push({ name: "send().altBranch", start: lineOf(n.getStart(sf)), end: lineOf(n.getEnd()), formal: true });
      if (ts.isBlock(n)) {
        const st = n.statements;
        for (let i = 0; i < st.length - 1; i += 1) {
          const a = st[i];
          const b = st[i + 1];
          if (ts.isVariableStatement(a) && a.declarationList.declarations[0]?.name.getText(sf) === "structuredShortcutNegativeFeedback" && ts.isIfStatement(b) && b.expression.getText(sf).includes("shouldRefetchPlaces(trimmed, nextSession, merged.context, msgs)")) r.push({ name: "send().refetchBranch", start: lineOf(a.getStart(sf)), end: lineOf(b.getEnd()), formal: true });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    const top = sf.statements.filter((s) => ts.isFunctionDeclaration(s) && s.name).map((s) => ({ name: `模組層 function ${s.name.text}`, start: lineOf(s.getStart(sf)), end: lineOf(s.getEnd()), formal: R17_MODULE_FNS.includes(s.name.text) ? "r17-C 注入正式實作" : false }));
    return [...r, ...other, ...top];
  };
  const work = read(`${WORK_ROOT}/${REL_APP}`);
  const mp1 = read(MP1_APP);
  const rw = ranges("work", work);
  out.push("══ r17 --model-check：F2（A2-MP2.app.diff）修改點 → 是否在 r14 擷取的正式原始碼內 ══");
  out.push(`work _app sha=${sha1(work)}；mp1 _app sha=${sha1(mp1)}`);
  out.push("擷取單位（work 行號）：", ...rw.filter((x) => x.formal === true).map((x) => `  [正式擷取] ${x.name} L${x.start}-${x.end}`));
  // F2 修改點：work 中引用 F2 新符號或 scopedRecContext 的行
  const lines = work.split("\n");
  const pts = [];
  lines.forEach((l, i) => {
    if (/isStaleActiveRecommendationContext\(|activeRecommendationContextMatchesTrustedScope\(|activeRecommendationContext: scopedRecContext/.test(l)) pts.push(i + 1);
  });
  const innermost = (ln) => rw.filter((x) => x.start <= ln && ln <= x.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  out.push("F2 修改點（work 行）→ 所在單位：");
  for (const ln of pts) {
    const u = innermost(ln);
    const kind = !u ? "（不在任何單位）" : u.formal === true ? "正式擷取（r14）" : u.formal ? u.formal : "未擷取 → r13／r14 模型";
    out.push(`  L${ln} ${lines[ln - 1].trim().slice(0, 100)}  ⇒ ${u?.name ?? "-"} ${kind}`);
  }
  // r14 模型中對應的 destForMore／fallback dest：是否仍是 F2 前的寫法
  const r14 = read(R14_FILE);
  const r13 = read(R13_FILE);
  const modelRefine = r14.includes('"        const destForMore =",\n    "          nextSession.activeRecommendationContext?.destinationName ||",');
  const modelFb = r14.includes('"      const dest =",\n    "        scopedSession.activeRecommendationContext?.destinationName ||",');
  out.push("r14 模型（R14_PATCHES 內，r13 send() 模型／applyLocalFallback 模型）：");
  out.push(`  「r14-Δ5 refinement more」destForMore 以 activeRecommendationContext 優先、無 isStale 跳過：${modelRefine ? "是（＝F2 前寫法；與 work L10194-10201 不符）" : "否"}`);
  out.push(`  「r14-Δ5 fallback continue」dest 以 activeRecommendationContext 優先、無 isStale 跳過：${modelFb ? "是（＝F2 前寫法；與 work L6803-6809 不符）" : "否"}`);
  out.push(`  r13 send() 模型 refinement 區塊 path 標記：${r13.includes("obs.path += `refinement:${arbitration.route}`;") ? "refinement:<route>" : "?"}；fallback continue 標記：${r14.includes('obs.path += \\"|fb_continue(real)\\";') || r14.includes("fb_continue(real)") ? "|fb_continue(real)" : "?"}`);
  out.push("結論：F2 的 send() destForMore L9716 在 refetchBranch（正式擷取）；pushRecommendationRefinement、pushMorePlaceRecommendations 為正式擷取；");
  out.push("      F2 的 L10193（refinement 區塊 MORE_RECOMMENDATIONS）與 L6804（applyLocalFallback continue）只存在於 r13／r14 模型，模型仍是 F2 前寫法 → 經過這兩條路徑的輪次不得判 PASS（more-places-r3 以 path 標記為 MODEL-PATH）。");
  console.log(out.join("\n"));
}

// ════════════════════════ 執行 ════════════════════════
if (process.argv.includes("--model-check")) {
  await r17ModelCheck();
  process.exit(0);
}
const r16Text = readFileSync(R16_FILE, "utf8");
if (sha1(r16Text) !== R16_SHA) {
  console.log(`INFRA-FAIL r16 sha=${sha1(r16Text)} ≠ ${R16_SHA}（r16 被修改？r17 不執行）`);
  process.exit(1);
}
const pre = r17Precheck();
if (pre.length) {
  console.log(["INFRA-FAIL r17 前提（sha 快照）", ...pre].join("\n"));
  process.exit(1);
}
const shebang = r16Text.match(/^#!.*\n/);
if (!shebang) {
  console.log("INFRA-FAIL r16 缺少 shebang");
  process.exit(1);
}
const r16Src = r16Text.slice(shebang[0].length);
let r17Body;
try {
  r17Body = r17Apply(r16Src, R17_R16_PATCHES, "r16");
} catch (e) {
  console.log(`INFRA-FAIL r17 patch：${e?.message ?? e}`);
  process.exit(1);
}
if (/^\s*import\s/m.test(r17Body) || /^\s*imp: \(s\) => import\(s\)/m.test(r17Body)) {
  console.log("INFRA-FAIL r17：patched r16 仍有 import 陳述式／import()");
  process.exit(1);
}
const AsyncFunction = (async () => {}).constructor;
const makeR17 = (extra) => ({
  imp: (s) => import(s),
  r13Patches: R17_R13_PATCHES,
  r14Patches: R17_R14_PATCHES,
  r15Patches: R17_R15_PATCHES,
  mp1App: r17Mp1App,
  noteExtract: r17NoteExtract,
  reportMp1: r17ReportMp1,
  summaryFields: r17SummaryFields,
  probe: r17Probe,
  f2MoreDelta: r17F2MoreDelta,
  emitMode: false,
  r16Extra: null,
  onR16Body: null,
  ...extra,
});

if (process.argv.includes("--emit-diff")) {
  const CAP = Symbol("r17-capture");
  const runCapture = async (body, extra) => {
    let got = null;
    let r16Body = null;
    const r17 = makeR17({
      ...extra,
      emitMode: true,
      onR16Body: (b) => {
        r16Body = b;
      },
      r16Extra: {
        capture: (x) => {
          got = { r15Exec: x.r15Exec.text, patchedR14: x.patchedR14.full };
          throw CAP;
        },
      },
    });
    try {
      await new AsyncFunction("__r17", `"use strict";\n${body}`)(r17);
    } catch (e) {
      if (e !== CAP) throw e;
    }
    if (!got || !r16Body) throw new Error("emit capture 未取得執行內容");
    return { ...got, r16Body };
  };
  // 基準＝r16 原文＋只含執行所需的 R17_R16_INFRA（import 轉換、capture、空的 patch 掛載點；不改變 r15／r14／r13 執行內容）
  const baseBody = r17Apply(r16Src, R17_R16_INFRA, "r16(基準)");
  const base = await runCapture(baseBody, { r13Patches: [], r14Patches: [], r15Patches: [] });
  const mine = await runCapture(r17Body, {});
  const files = {
    r16: R16_FILE,
    r17r16: `${PRE_DIR}/r17.patched-r16.mjs`,
    baseR15: `${PRE_DIR}/r17base.r16-patched-r15.mjs`,
    r17R15: `${PRE_DIR}/r17.patched-r15.mjs`,
    baseR14: `${PRE_DIR}/r17base.r16-patched-r14.mjs`,
    r17R14: `${PRE_DIR}/r17.patched-r14.mjs`,
    baseExec: `${PRE_DIR}/r17base.r16-exec.mjs`,
    r17Exec: `${PRE_DIR}/r17.r17-exec.mjs`,
  };
  writeFileSync(files.r17r16, `${shebang[0]}${r17Body}`);
  writeFileSync(files.baseR15, `${base.r16Body}`);
  writeFileSync(files.r17R15, `${mine.r16Body}`);
  writeFileSync(files.baseR14, base.patchedR14);
  writeFileSync(files.r17R14, mine.patchedR14);
  writeFileSync(files.baseExec, base.r15Exec);
  writeFileSync(files.r17Exec, mine.r15Exec);
  // 基準一致性：r17 基準的 r14／r13 執行內容必須與 r16 --emit-diff 產物（scratchpad/r16.patched-r14.mjs、r16.r16-exec.mjs）相同
  const same = (a, b) => (existsSync(b) ? (readFileSync(b, "utf8") === a ? "相同" : "不同") : "（缺檔）");
  const diffText = (a, b, la, lb) => {
    try {
      return execFileSync("diff", ["-u", "--label", la, "--label", lb, a, b], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      return String(e.stdout ?? "");
    }
  };
  const KEYS = ["p1.push", "notes.push", "costNotes", "diffExpected", "expect:", "MODES", "ux.push"];
  const stats = (d) => {
    const del = d.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    const add = d.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const hit = del.filter((l) => KEYS.some((k) => l.includes(k)));
    const by = {};
    for (const l of hit) for (const k of KEYS) if (l.includes(k)) by[k] = (by[k] ?? 0) + 1;
    return { deleted: del.length, added: add.length, hit, by, hunks: d.split("\n").filter((l) => l.startsWith("@@")).length };
  };
  const d0 = diffText(files.r16, files.r17r16, "scripts/verify-destination-authority-phase2-r16.mjs（sha 842fd3be）", "r17 實際執行的 r16（r16＋R17_R16_PATCHES）");
  const d1 = diffText(files.baseR15, files.r17R15, "r16 實際執行的 r15（r15＋R16_R15_PATCHES）", "r17 實際執行的 r15（再加 R17_R15_PATCHES；r16 patch 字串經 r17-V 改寫）");
  const d2 = diffText(files.baseR14, files.r17R14, "r16 實際執行的 r14（r14＋R15＋R16_R14_PATCHES）", "r17 實際執行的 r14（再加 R17_R14_PATCHES）");
  const d3 = diffText(files.baseExec, files.r17Exec, "r16 實際執行內容（r13＋R14＋R15＋R16_R13_PATCHES）", "r17 實際執行內容（再加 R17_R13_PATCHES）");
  const s = [d0, d1, d2, d3].map(stats);
  const ids = (a) => a.map((p) => p.id).join("｜");
  const head = [
    "# r17.diff（A2-MP-T2）",
    `# r16 sha1=${R16_SHA}（已驗證）；r15／r14／r13 由 r16／r15／r14 驗證 sha`,
    `# 基準一致性：r17 基準 r14 vs scratchpad/r16.patched-r14.mjs＝${same(base.patchedR14, `${PRE_DIR}/r16.patched-r14.mjs`)}；r17 基準執行內容 vs scratchpad/r16.r16-exec.mjs＝${same(base.r15Exec, `${PRE_DIR}/r16.r16-exec.mjs`)}；r17 基準 r15 vs scratchpad/r16.patched-r15.mjs＝${same(`${shebang[0]}${base.r16Body}`, `${PRE_DIR}/r16.patched-r15.mjs`)}／（無 shebang）${same(base.r16Body, `${PRE_DIR}/r16.patched-r15.mjs`)}`,
    `# 第 0 部分：r16 原文 → r17 實際執行的 r16（R17_R16_PATCHES ${R17_R16_PATCHES.length} 個）：${ids(R17_R16_PATCHES)}`,
    `#   hunk=${s[0].hunks} 刪除行=${s[0].deleted} 新增行=${s[0].added}；刪除行含 ${KEYS.join("／")} = ${s[0].hit.length} ${JSON.stringify(s[0].by)}`,
    `# 第 1 部分：r16 執行的 r15 → r17 執行的 r15（R17_R15_PATCHES ${R17_R15_PATCHES.length} 個；其餘差異＝r16 patch 字串經 r17-V 改寫）`,
    `#   hunk=${s[1].hunks} 刪除行=${s[1].deleted} 新增行=${s[1].added}；刪除行含 = ${s[1].hit.length} ${JSON.stringify(s[1].by)}`,
    `# 第 2 部分：r16 執行的 r14 → r17 執行的 r14（R17_R14_PATCHES ${R17_R14_PATCHES.length} 個）：${ids(R17_R14_PATCHES)}`,
    `#   hunk=${s[2].hunks} 刪除行=${s[2].deleted} 新增行=${s[2].added}；刪除行含 = ${s[2].hit.length} ${JSON.stringify(s[2].by)}`,
    `# 第 3 部分：r16 執行內容 → r17 執行內容（R17_R13_PATCHES ${R17_R13_PATCHES.length} 個）：${ids(R17_R13_PATCHES)}`,
    `#   hunk=${s[3].hunks} 刪除行=${s[3].deleted} 新增行=${s[3].added}；刪除行含 = ${s[3].hit.length} ${JSON.stringify(s[3].by)}`,
    ...s.flatMap((x, i) => x.hit.map((l) => `#   [第${i}部分 刪除行命中] ${l}`)),
    "",
  ];
  writeFileSync(`${PRE_DIR}/r17.diff`, `${head.join("\n")}\n######## 第 0 部分 ########\n${d0}\n######## 第 1 部分 ########\n${d1}\n######## 第 2 部分 ########\n${d2}\n######## 第 3 部分 ########\n${d3}`);
  console.log(`wrote ${PRE_DIR}/r17.diff`);
  console.log(head.join("\n"));
  process.exit(0);
}

await new AsyncFunction("__r17", `"use strict";\n${r17Body}`)(makeR17({}));
