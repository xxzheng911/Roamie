#!/usr/bin/env node
/**
 * R16 — Destination Authority 全量回歸（A2-MP-T1，tester；使用者授權：只做版本識別＋新增 a2 對照樹）。
 *
 * 建立方式（同 r14／r15 模式）：r12–r15 保留不改。r16 在執行期讀入 r15 原文（sha1 必須 = a307fe97…，
 * scratchpad/pre-r16-test-sha.txt），套用 R16_R15_PATCHES（r15 原文層；每個錨點必須「恰好出現一次」，否則 INFRA-FAIL、不執行），
 * 再以 AsyncFunction 執行。patched r15 照常讀入 r14（sha c60827a3…）→ r13（sha 8debfb44…）。
 * r16 另外把 R16_R14_PATCHES 附加到 r15 的 R15_R14_PATCHES 之後、R16_R13_PATCHES 附加到 R15_R13_PATCHES 之後（同一套恰好一次檢查）。
 * 主程序與 collect 子程序都是同一份內容（子程序路徑改為 r16）。
 *
 * 只允許的變更（逐 hunk 見 --emit-diff 產生的 scratchpad/r16.diff）：
 *  r16-V  版本識別：
 *         - work 樹的 sha 檢查改對 scratchpad/post-MP-sha.txt（A2-MP-F1 之後；r14 wantApp.work、r13 L2363／L2367／L2650／L2658）；
 *         - F7 後變動檔白名單 r1[0-5] → r1[0-6]，並加上 verify-more-places-cross-destination-r2.mjs（精確路徑）；
 *         - 子程序路徑 r16、標題、摘要行。
 *         - AsyncFunction 執行需要：r15 的 import 陳述式／import() 改由 __r16.imp 代為 import（數量檢查）。
 *  r16-A  新增對照樹 a2（--a2）＝ post-A2（A2-MP 修正前）：work ＋ scratchpad/pre-A2-MP/chat-turn-destination.ts overlay，
 *         _app.chat.tsx 擷取 scratchpad/pre-A2-MP/_app.chat.tsx；其餘檔案同 work。a2 的 F4〜G2S1 旗標同 work（皆為 A2 後版本）。
 *         樹判別：a2 必須含 A2（resolveTrustedRecommendationSearchScope）、必須載入 ctd overlay、不得含
 *         recommendationSessionMatchesTrustedScope；work 必須含。sha：a2 兩檔 = post-A2-sha.txt；work 18 檔 = post-MP-sha.txt；
 *         兩份快照只差這兩檔。
 *         judge：J.a2 = judge("a2")（同一套 judge，與 pa2 相同處理）。報告新增「work 相對 a2 新增 P1／a2 有 work 無」一節
 *         （原本相對 pa2 的比較保留）。
 *  不變：r13 的情境／Fixture／Assertion／expect／MODES／Credits 結算條件／Provider 請求限制／P1／P2 分類、r14 的 r14-A2 斷言、
 *        r15 的 r15-E／F／N／C／X（含 r15-F 分類規則）。外部請求攔截同 r13（任何外部請求 → FAIL）。未知閉包依賴仍 INFRA-FAIL。
 *
 * 執行：node scripts/verify-destination-authority-phase2-r16.mjs --brief --f10 --pa2 --a2 [--only=ID,…] [--out=<scratchpad>/x.log] [--conc=N]
 *       node scripts/verify-destination-authority-phase2-r16.mjs --emit-diff   （寫 scratchpad/r16.diff 與 r16.* 執行內容）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R15_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r15.mjs`;
const R15_SHA = "a307fe9718c3c27577ddc9f0975bb665e066b95a"; // scratchpad/pre-r16-test-sha.txt
const A2_DIR = `${PRE_DIR}/pre-A2-MP`;
const REL_CTD = "src/lib/ai/chat-turn-destination.ts";
const REL_APP = "src/routes/_app.chat.tsx";
const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");
const L = (...lines) => lines.join("\n");

// ════════════════════════ r16-V／A：前提檢查（sha 快照）════════════════════════
function r16Precheck() {
  const fail = [];
  const snap = (file) => {
    const m = new Map();
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const x = line.match(/^([0-9a-f]{40}) {2}(.+)$/);
      if (x) m.set(x[2], x[1]);
    }
    return m;
  };
  const postMP = snap(`${PRE_DIR}/post-MP-sha.txt`);
  const postA2 = snap(`${PRE_DIR}/post-A2-sha.txt`);
  if (postMP.size !== 18) fail.push(`post-MP-sha.txt 應有 18 檔，實際 ${postMP.size}`);
  for (const [rel, want] of postMP) {
    const f = `${WORK_ROOT}/${rel}`;
    const got = existsSync(f) ? sha1(readFileSync(f)) : "(missing)";
    if (got !== want) fail.push(`work ${rel} sha=${got} ≠ post-MP ${want}（A2-MP 交付後又被修改？）`);
  }
  const diffRels = [...new Set([...postMP.keys(), ...postA2.keys()])].filter((rel) => postMP.get(rel) !== postA2.get(rel)).sort();
  if (JSON.stringify(diffRels) !== JSON.stringify([REL_CTD, REL_APP].sort())) fail.push(`post-A2 與 post-MP 快照的差異檔應恰為 ctd＋_app，實際=${diffRels.join(",")}`);
  for (const [rel, name] of [[REL_CTD, "chat-turn-destination.ts"], [REL_APP, "_app.chat.tsx"]]) {
    const f = `${A2_DIR}/${name}`;
    const got = existsSync(f) ? sha1(readFileSync(f)) : "(missing)";
    if (got !== postA2.get(rel)) fail.push(`a2 備份 ${f} sha=${got} ≠ post-A2 ${postA2.get(rel)}`);
  }
  const ctdWork = readFileSync(`${WORK_ROOT}/${REL_CTD}`, "utf8");
  const ctdA2 = readFileSync(`${A2_DIR}/chat-turn-destination.ts`, "utf8");
  if (!/export function recommendationSessionMatchesTrustedScope\(/.test(ctdWork)) fail.push("work ctd 沒有 recommendationSessionMatchesTrustedScope（不是 A2-MP 版）");
  if (/recommendationSessionMatchesTrustedScope/.test(ctdA2)) fail.push("a2 ctd 已含 recommendationSessionMatchesTrustedScope（備份錯誤）");
  return fail;
}

/** a2 樹 overlay（子程序內呼叫）：只覆蓋 chat-turn-destination.ts。 */
const r16A2Overlay = () => ({ [REL_CTD]: readFileSync(`${A2_DIR}/chat-turn-destination.ts`, "utf8") });
let r16A2AppCache = null;
const r16A2App = () => (r16A2AppCache ??= readFileSync(`${A2_DIR}/_app.chat.tsx`, "utf8"));

// ════════════════════════ r16-A：work 相對 a2 的 P1 比較（主程序報告；只新增輸出）════════════════════════
const R16_STATE = { newVsA2: null, a2Only: null, unexplained: null };
const R16_WORK_ONLY_RE = /(循環 import|chat-intent-router 依賴鏈| r4-SRC：)/;
function r16ReportA2({ P1, out }) {
  out.push("\n══ r16：work（A2-MP 後）相對 a2（post-A2＝A2-MP 修正前）══");
  if (!P1.a2) {
    out.push("  （未跑 --a2，無法比較）");
    return;
  }
  const newVsA2 = [...P1.work].filter((x) => !P1.a2.has(x));
  const a2Only = [...P1.a2].filter((x) => !P1.work.has(x));
  // judge("work") 另含 work 專屬判定（graphP1、r4-SRC；judge(WT≠work) 不計）→ 只列為「work 專屬判定」，不算 A2-MP 新增
  const workOnly = newVsA2.filter((x) => R16_WORK_ONLY_RE.test(x));
  const rest = newVsA2.filter((x) => !R16_WORK_ONLY_RE.test(x));
  R16_STATE.newVsA2 = newVsA2.length;
  R16_STATE.a2Only = a2Only.length;
  R16_STATE.unexplained = rest.length;
  out.push(`  work P1=${P1.work.size} a2 P1=${P1.a2.size}；work 新增（vs a2）=${newVsA2.length}（其中 work 專屬判定=${workOnly.length}、A2-MP 後新出現=${rest.length}）；a2 有 work 無=${a2Only.length}`);
  out.push(`\n══ r16：work 相對 a2 新增 P1=${rest.length}（不含 work 專屬判定）══`);
  for (const x of rest) out.push(`  [A2-MP 後新出現${P1.pa2 ? (P1.pa2.has(x) ? "；pa2 也有" : "；pa2 無") : ""}] ${x}`);
  if (!rest.length) out.push("  (none)");
  if (workOnly.length) out.push(`── work 專屬判定（judge WT=work 才計；a2 不計）=${workOnly.length} ──`, ...workOnly.map((x) => `  ${x}`));
  out.push(`\n══ r16：a2 有、work 無（A2-MP 消除）=${a2Only.length} ══`, ...(a2Only.length ? a2Only.map((x) => `  ${x}`) : ["  (none)"]));
}
const r16SummaryFields = () => `r16[a2：work新增=${R16_STATE.newVsA2 ?? "-"}（A2-MP 後新出現=${R16_STATE.unexplained ?? "-"}） a2有work無=${R16_STATE.a2Only ?? "-"}]`;

// ════════════════════════ R16_R13_PATCHES（r13 原文層；套在 R14_PATCHES＋R15_R13_PATCHES 之後）════════════════════════
const R16_R13_PATCHES = [
  // r16-V：work 的 sha 檢查改對 post-MP
  {
    id: "r16-V cri post-MP",
    kind: "exact",
    old: "const postCbSha = readFileSync(`${PRE_DIR}/post-A2-sha.txt`, \"utf8\")",
    neu: "const postCbSha = readFileSync(`${PRE_DIR}/post-MP-sha.txt`, \"utf8\") /* r16-V：post-MP */",
  },
  {
    id: "r16-V A1/A2 sources post-MP",
    kind: "exact",
    old: "const postA2Lines = readFileSync(`${PRE_DIR}/post-A2-sha.txt`, \"utf8\")",
    neu: "const postA2Lines = readFileSync(`${PRE_DIR}/post-MP-sha.txt`, \"utf8\") /* r16-V：post-MP */",
  },
  {
    id: "r16-V cri anchor post-MP",
    kind: "exact",
    old: "if (snapSha(`${PRE_DIR}/post-A2-sha.txt`, relCri) !== shaOf(`${WORK_ROOT}/${relCri}`)) G2S1_ANCHOR_FAIL.push(\"work cri 與 post-A2 sha 不符\");",
    neu: "if (snapSha(`${PRE_DIR}/post-MP-sha.txt`, relCri) !== shaOf(`${WORK_ROOT}/${relCri}`)) G2S1_ANCHOR_FAIL.push(\"work cri 與 post-MP sha 不符\"); /* r16-V */",
  },
  {
    id: "r16-V F9 files post-MP",
    kind: "exact",
    old: "const postCB = snapSha(`${PRE_DIR}/post-A2-sha.txt`, rel);",
    neu: "const postCB = snapSha(`${PRE_DIR}/post-MP-sha.txt`, rel); /* r16-V：post-MP（訊息字樣「post-A2」沿用） */",
  },
  // r16-A：a2 樹（子程序）— 旗標同 work、ctd overlay、樹判別 probe
  ...[
    ["F4", 'TREE === "work" || TREE === "pre" || TREE === "pre5" || TREE === "f9" || TREE === "f10" || TREE === "pa2"'],
    ["F5", 'TREE === "work" || TREE === "pre" || TREE === "f9" || TREE === "f10" || TREE === "pa2"'],
    ["F6", 'TREE === "work" || TREE === "pre" || TREE === "f9" || TREE === "f10" || TREE === "pa2"'],
    ["F8", 'TREE === "work" || TREE === "pre" || TREE === "f9" || TREE === "f10" || TREE === "pa2"'],
    ["F10", 'TREE === "work" || TREE === "f10" || TREE === "pa2"'],
    ["G2S1", 'TREE === "work" || TREE === "f9" || TREE === "f10" || TREE === "pa2"'],
  ].map(([name, rhs]) => ({ id: `r16-A flag ${name}`, kind: "exact", old: `  const ${name} = ${rhs};`, neu: `  const ${name} = ${rhs} || TREE === "a2"; /* r16-A */` })),
  {
    id: "r16-A a2 overlay",
    kind: "exact",
    old: '  } else if (TREE === "pa2") {\n',
    neu: L(
      '  } else if (TREE === "a2") {',
      "    // r16-A：a2 = 工作區 + A2-MP 修正前（post-A2）的 chat-turn-destination.ts（scratchpad/pre-A2-MP/）",
      "    for (const [rel, content] of Object.entries(__r14.r15.r16.a2Overlay())) baseContent.set(`${WORK_ROOT}/${rel}`, content);",
      '  } else if (TREE === "pa2") {',
      "",
    ),
  },
  {
    id: "r16-A mp probe",
    kind: "exact",
    old: '  overlayCheck.a2 = M.ctd ? typeof M.ctd.resolveTrustedRecommendationSearchScope === "function" : null; // r14-Δ2',
    neu: L(
      '  overlayCheck.a2 = M.ctd ? typeof M.ctd.resolveTrustedRecommendationSearchScope === "function" : null; // r14-Δ2',
      '  overlayCheck.mp = M.ctd ? typeof M.ctd.recommendationSessionMatchesTrustedScope === "function" : null; // r16-A：A2-MP 判別',
    ),
  },
  // r16-A：主程序 — --a2 旗標、TREES、overlayHitsAll、judge、外部請求
  {
    id: "r16-A flag",
    kind: "exact",
    old: 'const WITH_PA2 = process.argv.includes("--pa2");',
    neu: 'const WITH_A2 = process.argv.includes("--a2"); /* r16-A：a2 = post-A2（A2-MP 修正前） */ const WITH_PA2 = process.argv.includes("--pa2");',
  },
  { id: "r16-A TREES", kind: "exact", old: '...(WITH_PA2 ? ["pa2"] : [])]; // r14-Δ2', neu: '...(WITH_PA2 ? ["pa2"] : []), ...(WITH_A2 ? ["a2"] : [])]; /* r16-A */ // r14-Δ2' },
  { id: "r16-A overlayHitsAll", kind: "exact", old: "f10: new Set(), pa2: new Set() };", neu: "f10: new Set(), pa2: new Set(), a2: new Set() }; /* r16-A */" },
  { id: "r16-A J", kind: "exact", old: '...(WITH_PA2 ? { pa2: judge("pa2") } : {}) };', neu: '...(WITH_PA2 ? { pa2: judge("pa2") } : {}), ...(WITH_A2 ? { a2: judge("a2") } : {}) }; /* r16-A：同一套 judge */' },
  { id: "r16-A extHits", kind: "exact", old: "  if (J.pa2) J.pa2.p1.push(h); // r14-Δ8\n", neu: "  if (J.pa2) J.pa2.p1.push(h); // r14-Δ8\n  if (J.a2) J.a2.p1.push(h); // r16-A\n" },
];

// ════════════════════════ R16_R14_PATCHES（r14 原文層；套在 R15_R14_PATCHES 之後）════════════════════════
const R16_R14_PATCHES = [
  {
    id: "r16-V wantApp post-MP + a2",
    kind: "exact",
    old: '  const wantApp = { work: shaLine(`${PRE_DIR}/post-A2-sha.txt`, "src/routes/_app.chat.tsx"),',
    neu: '  const wantApp = { work: shaLine(`${PRE_DIR}/post-MP-sha.txt`, "src/routes/_app.chat.tsx"), a2: shaLine(`${PRE_DIR}/post-A2-sha.txt`, "src/routes/_app.chat.tsx"), // r16-V：work=post-MP；r16-A：a2=post-A2\n   ',
  },
  {
    id: "r16-A app source a2",
    kind: "exact",
    old: "  pa2: () => ({ file: R14_APP_PRE_A2, text: r14AppPreA2() }),\n",
    neu: "  pa2: () => ({ file: R14_APP_PRE_A2, text: r14AppPreA2() }),\n  a2: () => ({ file: `${PRE_DIR}/pre-A2-MP/_app.chat.tsx`, text: __r15.r16.a2App() }), // r16-A：post-A2（A2-MP 修正前）\n",
  },
  { id: "r16-A fingerprint work has", kind: "exact", old: '      if (tree === "work" && !has) fail.push(', neu: '      if ((tree === "work" || tree === "a2") && !has) fail.push( /* r16-A：a2 同為 A2 後 */' },
  { id: "r16-A fingerprint others", kind: "exact", old: '      if (tree !== "work" && has) fail.push(', neu: '      if (tree !== "work" && tree !== "a2" && has) fail.push( /* r16-A */' },
  { id: "r16-A safeStop work", kind: "exact", old: '    if (tree === "work" && !safeStop) fail.push(', neu: '    if ((tree === "work" || tree === "a2") && !safeStop) fail.push( /* r16-A */' },
  { id: "r16-A safeStop others", kind: "exact", old: '    if (tree !== "work" && safeStop) fail.push(', neu: '    if (tree !== "work" && tree !== "a2" && safeStop) fail.push( /* r16-A */' },
  {
    id: "r16-A infraTree",
    kind: "exact",
    old: '  if (tree === "work" && oc.a2 !== true) infra.push(',
    neu: L(
      "  // r16-A：a2 = post-A2（含 A2、無 A2-MP；必須載入 ctd overlay）；work 必須含 A2-MP",
      '  if (tree === "a2" && (oc.a2 !== true || oc.mp !== false || !has("src/lib/ai/chat-turn-destination.ts"))) infra.push(`INFRA-FAIL ${k} a2 不是 post-A2 版（a2=${oc.a2} mp=${oc.mp} hits=${hits.join(",")}）`);',
      '  if (tree === "work" && oc.mp !== true) infra.push(`INFRA-FAIL ${k} work 不是 A2-MP 版（mp=${oc.mp}）`);',
      '  if (tree !== "work" && tree !== "a2" && oc.mp !== false && oc.mp !== null) infra.push(`INFRA-FAIL ${k} ${tree} 含 A2-MP（mp=${oc.mp}）`);',
      '  if (tree === "work" && oc.a2 !== true) infra.push(',
    ),
  },
  { id: "r16-A P1 table a2", kind: "exact", old: '  for (const t of ["work", "pa2", "f10", "pre", "base"]) {', neu: '  for (const t of ["work", "a2", "pa2", "f10", "pre", "base"]) { // r16-A：+a2' },
];

// ════════════════════════ R16_R15_PATCHES（r15 原文層）════════════════════════
const R16_R15_INFRA = [
  {
    id: "r16-V static imports → __r16.imp（AsyncFunction 執行需要）",
    kind: "exact",
    old: L('import { readFileSync, writeFileSync, existsSync } from "node:fs";', 'import { createHash } from "node:crypto";', 'import { execFileSync } from "node:child_process";'),
    neu: L(
      'const { readFileSync, writeFileSync, existsSync } = await __r16.imp("node:fs"); // r16：同 r15 的 import（AsyncFunction 內不能用 import 陳述式）',
      'const { createHash } = await __r16.imp("node:crypto");',
      'const { execFileSync } = await __r16.imp("node:child_process");',
    ),
  },
  { id: "r16-V import node:url", kind: "exact", old: '  const { pathToFileURL } = await import("node:url");', neu: '  const { pathToFileURL } = await __r16.imp("node:url"); // r16' },
  { id: "r16-V import node:path", kind: "exact", old: '  const { resolve: r15Resolve } = await import("node:path");', neu: '  const { resolve: r15Resolve } = await __r16.imp("node:path"); // r16' },
  { id: "r16-V import extra", kind: "exact", old: "  R15_X.mod = await import(pathToFileURL(p).href);", neu: "  R15_X.mod = await __r16.imp(pathToFileURL(p).href); // r16" },
  { id: "r16-V __r15.imp", kind: "exact", old: "const __r15 = {\n  imp: (s) => import(s),\n", neu: "const __r15 = {\n  imp: __r16.imp, // r16\n  r16: __r16, // r16\n" },
  {
    id: "r16 emit capture",
    kind: "exact",
    old: "async function r15EmitDiff({ r13File, r14Only, r15Exec, r14BasePatchCount }) {\n",
    neu: "async function r15EmitDiff({ r13File, r14Only, r15Exec, r14BasePatchCount }) {\n  if (__r16.capture) return __r16.capture({ r15Exec, patchedR14: R15_PATCHED_R14 }); // r16：--emit-diff 只擷取執行內容（不寫 r15.diff）\n",
  },
];
const R16_R15_PATCHES = [
  ...R16_R15_INFRA,
  {
    id: "r16-V header",
    kind: "exact",
    old: " * R15 — Destination Authority 全量回歸（A2-T5，",
    neu: L(
      " * R16 — r15 的執行期 patch 版（A2-MP-T1）：說明見 scripts/verify-destination-authority-phase2-r16.mjs 檔頭（r16-V／A）。",
      " * 執行：node scripts/verify-destination-authority-phase2-r16.mjs --brief --f10 --pa2 --a2",
      " *",
      " * ── 以下為 r15 原始說明 ──",
      " * R15 — Destination Authority 全量回歸（A2-T5，",
    ),
  },
  {
    id: "r16-V child script",
    kind: "exact",
    old: 'neu: "phase2-r15.mjs`; // r15：子程序執行 r15（＝r14＋R15 patch；原 r14-Δ0）",',
    neu: 'neu: "phase2-r16.mjs`; // r16：子程序執行 r16（＝r15＋R16 patch；原 r15／r14-Δ0）",',
  },
  {
    id: "r16-V whitelist",
    kind: "exact",
    old: "neu: 'r1[0-5])/.test(f) && f !== ",
    neu: String.raw`neu: 'r1[0-6])/.test(f) && f !== \\"scripts/verify-more-places-cross-destination-r2.mjs\\" /* r16-V：r1[0-6]＋more-places-r2 */ && f !== `,
  },
  {
    id: "r16-V summary",
    kind: "exact",
    old: '`verify-destination-authority-phase2-r15: work P1=${sz("work")} pa2 P1=',
    neu: '`verify-destination-authority-phase2-r16: work P1=${sz("work")} a2 P1=${sz("a2")} pa2 P1=',
  },
  {
    id: "r16-V summary fields",
    kind: "exact",
    old: "${__r15.summaryFields()} → ${P1.work.size || __r15.failed()",
    neu: "${__r15.summaryFields()} ${__r15.r16.summaryFields()} → ${P1.work.size || __r15.failed()",
  },
  {
    id: "r16 patch hooks",
    kind: "exact",
    old: "function r15Apply(src, patches, what) {\n",
    neu: L(
      "for (const p of __r16.r14Patches) R15_R14_PATCHES.push(p); // r16：R16_R14_PATCHES 套在 R15_R14_PATCHES 之後",
      "for (const p of __r16.r13Patches) R15_R13_PATCHES.push(p); // r16：R16_R13_PATCHES 套在 R15_R13_PATCHES 之後（經 r15 r13 patches 一併推入 R14_PATCHES）",
      "function r15Apply(src, patches, what) {",
      "",
    ),
  },
  {
    id: "r16-A report",
    kind: "exact",
    old: "  // ── CC-2：驗證流程 vs Provider 請求 ──\n",
    neu: "  __r16.reportA2({ P1, out }); // r16-A：work 相對 a2（只新增輸出）\n  // ── CC-2：驗證流程 vs Provider 請求 ──\n",
  },
];

function r16Apply(src, patches, what) {
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

// ════════════════════════ 執行 ════════════════════════
const r15Text = readFileSync(R15_FILE, "utf8");
if (sha1(r15Text) !== R15_SHA) {
  console.log(`INFRA-FAIL r15 sha=${sha1(r15Text)} ≠ ${R15_SHA}（r15 被修改？r16 不執行）`);
  process.exit(1);
}
const pre = r16Precheck();
if (pre.length) {
  console.log(["INFRA-FAIL r16 前提（sha 快照）", ...pre].join("\n"));
  process.exit(1);
}
const shebang = r15Text.match(/^#!.*\n/);
if (!shebang) {
  console.log("INFRA-FAIL r15 缺少 shebang");
  process.exit(1);
}
const r15Body = r15Text.slice(shebang[0].length);
let r16Body;
try {
  r16Body = r16Apply(r15Body, R16_R15_PATCHES, "r15");
} catch (e) {
  console.log(`INFRA-FAIL r16 patch：${e?.message ?? e}`);
  process.exit(1);
}
if (/^\s*import\s/m.test(r16Body) || /[^.\w]import\(/.test(r16Body.replace(/'[^'\n]*'|"[^"\n]*"/g, ""))) {
  console.log("INFRA-FAIL r16：patched r15 仍有 import 陳述式／import()");
  process.exit(1);
}
const AsyncFunction = (async () => {}).constructor;
const makeR16 = (extra) => ({
  imp: (s) => import(s),
  r14Patches: R16_R14_PATCHES,
  r13Patches: R16_R13_PATCHES,
  a2Overlay: r16A2Overlay,
  a2App: r16A2App,
  reportA2: r16ReportA2,
  summaryFields: r16SummaryFields,
  capture: null,
  ...extra,
});

if (process.argv.includes("--emit-diff")) {
  // 基準＝r15 原文＋只含執行所需的 R16_R15_INFRA（import 轉換、capture；不改變 r14／r13 執行內容、不加 r16 patch）
  const CAP = Symbol("r16-capture");
  const runCapture = async (body, hooks) => {
    let got = null;
    const r16 = makeR16({
      ...hooks,
      capture: (x) => {
        got = { r15Exec: x.r15Exec.text, patchedR14: x.patchedR14.full };
        throw CAP;
      },
    });
    try {
      await new AsyncFunction("__r16", `"use strict";\n${body}`)(r16);
    } catch (e) {
      if (e !== CAP) throw e;
    }
    if (!got) throw new Error("emit capture 未取得執行內容");
    return got;
  };
  const baseBody = r16Apply(r15Body, R16_R15_INFRA, "r15(基準)");
  const base = await runCapture(baseBody, { r14Patches: [], r13Patches: [] });
  const mine = await runCapture(r16Body, {});
  const files = {
    r15: R15_FILE,
    r16r15: `${PRE_DIR}/r16.patched-r15.mjs`,
    baseR14: `${PRE_DIR}/r16base.r15-patched-r14.mjs`,
    r16R14: `${PRE_DIR}/r16.patched-r14.mjs`,
    baseExec: `${PRE_DIR}/r16base.r15-exec.mjs`,
    r16Exec: `${PRE_DIR}/r16.r16-exec.mjs`,
  };
  writeFileSync(files.r16r15, `${shebang[0]}${r16Body}`);
  writeFileSync(files.baseR14, base.patchedR14);
  writeFileSync(files.r16R14, mine.patchedR14);
  writeFileSync(files.baseExec, base.r15Exec);
  writeFileSync(files.r16Exec, mine.r15Exec);
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
  const d0 = diffText(files.r15, files.r16r15, "scripts/verify-destination-authority-phase2-r15.mjs（sha a307fe97）", "r16 實際執行的 r15（r15＋R16_R15_PATCHES）");
  const d1 = diffText(files.baseR14, files.r16R14, "r15 實際執行的 r14（r14＋R15_R14_PATCHES）", "r16 實際執行的 r14（再加 R16_R14_PATCHES）");
  const d2 = diffText(files.baseExec, files.r16Exec, "r15 實際執行內容（r13＋R14_PATCHES＋R15_R13_PATCHES）", "r16 實際執行內容（再加 R16_R13_PATCHES）");
  const s = [d0, d1, d2].map(stats);
  const head = [
    "# r16.diff（A2-MP-T1）",
    `# r15 sha1=${R15_SHA}（已驗證）；r14／r13 由 r15／r14 驗證 sha`,
    `# 第 0 部分：r15 原文 → r16 實際執行的 r15（R16_R15_PATCHES ${R16_R15_PATCHES.length} 個）：${R16_R15_PATCHES.map((p) => p.id).join("｜")}`,
    `#   hunk=${s[0].hunks} 刪除行=${s[0].deleted} 新增行=${s[0].added}；刪除行含 ${KEYS.join("／")} = ${s[0].hit.length} ${JSON.stringify(s[0].by)}`,
    `# 第 1 部分：r15 執行的 r14 → r16 執行的 r14（R16_R14_PATCHES ${R16_R14_PATCHES.length} 個）：${R16_R14_PATCHES.map((p) => p.id).join("｜")}`,
    `#   hunk=${s[1].hunks} 刪除行=${s[1].deleted} 新增行=${s[1].added}；刪除行含 = ${s[1].hit.length} ${JSON.stringify(s[1].by)}`,
    `# 第 2 部分：r15 執行內容 → r16 執行內容（R16_R13_PATCHES ${R16_R13_PATCHES.length} 個）：${R16_R13_PATCHES.map((p) => p.id).join("｜")}`,
    `#   hunk=${s[2].hunks} 刪除行=${s[2].deleted} 新增行=${s[2].added}；刪除行含 = ${s[2].hit.length} ${JSON.stringify(s[2].by)}`,
    ...s.flatMap((x, i) => x.hit.map((l) => `#   [第${i}部分 刪除行命中] ${l}`)),
    "",
  ];
  writeFileSync(`${PRE_DIR}/r16.diff`, `${head.join("\n")}\n######## 第 0 部分 ########\n${d0}\n######## 第 1 部分 ########\n${d1}\n######## 第 2 部分 ########\n${d2}`);
  console.log(`wrote ${PRE_DIR}/r16.diff`);
  console.log(head.join("\n"));
  process.exit(0);
}

await new AsyncFunction("__r16", `"use strict";\n${r16Body}`)(makeR16({}));
