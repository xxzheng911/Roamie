#!/usr/bin/env node
// Builds scripts/verify-destination-authority-phase2-r11.mjs from r10 (r10 is NOT modified).
// Every patch's `old` text must occur exactly once in the current text; otherwise abort without writing.
// r11 = 續推邊界契約・方案 A（CB）獨立驗收（CB-T2）。
//  - 只改：自身路徑、樹判別（新增 f10 樹＝CB 前＝*.pre-CB.* overlay，走 F10 more_places 鏡像）、anchor／sha 對照、
//    F7 後變動檔白名單（CB 修改的 continue-recommendation-intent.ts 須等於 post-CB sha）、f10 輸出。
//  - r10／r9 全部 assertion 原樣保留（未放寬、未刪除、未改 expect）。
// Run: node scripts/verify-destination-authority-phase2-r11-build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "/Users/shuo/Roamie-clean/scripts/verify-destination-authority-phase2-r10.mjs";
const OUT = "/Users/shuo/Roamie-clean/scripts/verify-destination-authority-phase2-r11.mjs";
const L = (...lines) => lines.join("\n");

const patches = [];
const P = (id, old, neu) => patches.push({ id, old, neu });

P(
  "r11-Δ0 header",
  " * R10 — Phase 2 第二組 Step 1 第 2 輪（F10）獨立驗收：#1 more_places 續推；#2 舊版快照；#3 偽造快照；Session Restore 不退化。",
  L(
    " * R11 — 續推邊界契約・方案 A（CB）獨立驗收（CB-T2）。",
    " * 由 scripts/verify-destination-authority-phase2-r11-build.mjs 以 r10（保留不改）逐字複製並套用 exact-once patch 產生（r11-Δ）：",
    " *  r11-Δ1 自身路徑 r11；新增 f10 樹（--f10：CB 前＝chat-turn-destination.pre-CB.ts＋continue-recommendation-intent.pre-CB.ts overlay，",
    " *          走與 work 相同的 F10 more_places 鏡像）。",
    " *  r11-Δ2 樹判別：work 必須有 analyzeContinueRecommendationStructure（CB）；f10 必須無、且其餘同 r10 的 work（F10）判別。",
    " *  r11-Δ3 anchors／sha：F10 ctd anchors 改對 pre-CB 備份檢查；work 檢查 CB anchors；work = post-CB sha；pre-CB 備份 = post-F10 sha；",
    " *          另檢查 work 的 continue-recommendation-intent.ts 去掉 CB 新增區塊後與 pre-CB 備份逐字相同（舊文法凍結）。",
    " *  r11-Δ4 F7 後變動檔白名單：continue-recommendation-intent.ts（必須 = post-CB sha）、CB probe 腳本、r11 腳本。",
    " *  r11-Δ5 輸出：f10 P1、work 相對 f10 新增／消除 P1、geocode 依 phase。",
    " *  r10／r9 全部 assertion 原樣保留（未放寬、未刪除、未改 expect）。",
    " *",
    " * 執行：node scripts/verify-destination-authority-phase2-r11.mjs --brief --f10 [--only=ID,…]",
    " *",
    " * ── 以下為 r10 原始說明 ──",
    " * R10 — Phase 2 第二組 Step 1 第 2 輪（F10）獨立驗收：#1 more_places 續推；#2 舊版快照；#3 偽造快照；Session Restore 不退化。",
  ),
);
P(
  "r11-Δ1 script",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r10.mjs`;",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r11.mjs`;",
);
P(
  "r11-Δ1 f10-files",
  'const WITH_F9 = process.argv.includes("--f9");',
  L(
    'const WITH_F9 = process.argv.includes("--f9");',
    "// r11-Δ1：f10 = CB 前備份（F10 狀態）",
    "const F10_FILES = {",
    '  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-CB.ts`,',
    '  "src/lib/ai/continue-recommendation-intent.ts": `${PRE_DIR}/continue-recommendation-intent.pre-CB.ts`,',
    "};",
    'const WITH_F10 = process.argv.includes("--f10");',
  ),
);
P(
  "r11-Δ1 flags F4",
  'const F4 = TREE === "work" || TREE === "pre" || TREE === "pre5" || TREE === "f9"; // r10-Δ1',
  'const F4 = TREE === "work" || TREE === "pre" || TREE === "pre5" || TREE === "f9" || TREE === "f10"; // r11-Δ1 // r10-Δ1',
);
P(
  "r11-Δ1 flags F5",
  'const F5 = TREE === "work" || TREE === "pre" || TREE === "f9"; // r10-Δ1',
  'const F5 = TREE === "work" || TREE === "pre" || TREE === "f9" || TREE === "f10"; // r11-Δ1 // r10-Δ1',
);
P(
  "r11-Δ1 flags F6",
  'const F6 = TREE === "work" || TREE === "pre" || TREE === "f9"; // r10-Δ1',
  'const F6 = TREE === "work" || TREE === "pre" || TREE === "f9" || TREE === "f10"; // r11-Δ1 // r10-Δ1',
);
P(
  "r11-Δ1 flags F8",
  'const F8 = TREE === "work" || TREE === "pre" || TREE === "f9"; // r10-Δ1',
  'const F8 = TREE === "work" || TREE === "pre" || TREE === "f9" || TREE === "f10"; // r11-Δ1 // r10-Δ1',
);
P(
  "r11-Δ1 flags F10",
  'const F10 = TREE === "work"; // r10-Δ2',
  'const F10 = TREE === "work" || TREE === "f10"; // r11-Δ1：f10 與 work 同走 F10 鏡像（_app.chat.tsx 未改） // r10-Δ2',
);
P(
  "r11-Δ1 flags G2S1",
  'const G2S1 = TREE === "work" || TREE === "f9"; // r10-Δ2',
  'const G2S1 = TREE === "work" || TREE === "f9" || TREE === "f10"; // r11-Δ1 // r10-Δ2',
);
P(
  "r11-Δ1 overlay",
  '  } else if (TREE === "pre5") {',
  L(
    '  } else if (TREE === "f10") {',
    "    // r11-Δ1：f10 = 工作區 + CB 前的 chat-turn-destination.ts / continue-recommendation-intent.ts",
    "    for (const [rel, file] of Object.entries(F10_FILES)) baseContent.set(`${WORK_ROOT}/${rel}`, readFileSyncC(file, \"utf8\"));",
    '  } else if (TREE === "pre5") {',
  ),
);
P(
  "r11-Δ2 cb probe",
  '  overlayCheck.f10 = M.ctd ? typeof M.ctd.resolveMorePlacesTurnDestination === "function" : null;',
  L(
    '  overlayCheck.f10 = M.ctd ? typeof M.ctd.resolveMorePlacesTurnDestination === "function" : null;',
    '  overlayCheck.cb = M.crg ? typeof M.crg.analyzeContinueRecommendationStructure === "function" : null; // r11-Δ2',
  ),
);
P(
  "r11-Δ4 changed-file allowlist",
  "    for (const f of nowChanged) if (!inSnap.has(f) && !expected.has(f) && !/^scripts\\/verify-destination-authority-phase2-(r[789]|r10)/.test(f)) unexpected.push(f);",
  L(
    "    // r11-Δ4：CB 只允許 continue-recommendation-intent.ts（且必須 = post-CB sha）與 CB 驗收腳本",
    "    const postCbSha = readFileSync(`${PRE_DIR}/post-CB-sha.txt`, \"utf8\").split(\"\\n\").find((l) => l.endsWith(\"  src/lib/ai/continue-recommendation-intent.ts\"))?.slice(0, 40);",
    "    const criSha = createHash(\"sha1\").update(readFileSync(`${WORK_ROOT}/src/lib/ai/continue-recommendation-intent.ts`)).digest(\"hex\");",
    "    const CB_ALLOWED = new Set([\"scripts/verify-continuation-boundary-probe.mjs\", \"scripts/verify-continuation-boundary-cbt2.mjs\", \"scripts/verify-cbt2-vite-runner.mjs\", ...(postCbSha && postCbSha === criSha ? [\"src/lib/ai/continue-recommendation-intent.ts\"] : [])]);",
    "    for (const f of nowChanged) if (!inSnap.has(f) && !expected.has(f) && !CB_ALLOWED.has(f) && !/^scripts\\/verify-destination-authority-phase2-(r[789]|r1[01])/.test(f)) unexpected.push(f);",
  ),
);
P(
  "r11-Δ3 ctd anchors read F10 version",
  "  const ctdNow = readFileSync(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, \"utf8\");\n  const ctdF9 = readFileSync(F9_FILES[\"src/lib/ai/chat-turn-destination.ts\"], \"utf8\");",
  L(
    "  // r11-Δ3：F10 anchors 改對 pre-CB 備份（= F10 版）檢查；work 另查 CB anchors（見下）",
    "  const ctdNow = readFileSync(F10_FILES[\"src/lib/ai/chat-turn-destination.ts\"], \"utf8\");",
    "  const ctdF9 = readFileSync(F9_FILES[\"src/lib/ai/chat-turn-destination.ts\"], \"utf8\");",
    "  {",
    "    const ctdWork = readFileSync(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, \"utf8\");",
    "    const criWork = readFileSync(`${WORK_ROOT}/src/lib/ai/continue-recommendation-intent.ts`, \"utf8\");",
    "    const criPre = readFileSync(F10_FILES[\"src/lib/ai/continue-recommendation-intent.ts\"], \"utf8\");",
    "    for (const a of F10_CTD_ANCHORS.slice(0, 5)) if (!ctdWork.includes(a)) G2S1_ANCHOR_FAIL.push(`work ctd 缺少 F10 anchor：${a}`);",
    "    const CB_CTD_ANCHORS = [",
    "      'import {\\n  analyzeContinueRecommendationStructure,\\n  matchesContinueRecommendationGrammar,\\n} from \"@/lib/ai/continue-recommendation-intent\";',",
    "      \"const structure = analyzeContinueRecommendationStructure(text);\",",
    "      \"async function resolveNamedTurnDestination(\",",
    "    ];",
    "    for (const a of CB_CTD_ANCHORS) {",
    "      if (!ctdWork.includes(a)) G2S1_ANCHOR_FAIL.push(`work ctd 缺少 CB anchor：${a.split(\"\\n\")[0]}`);",
    "      if (ctdNow.includes(a)) G2S1_ANCHOR_FAIL.push(`pre-CB 備份 ctd 已含 CB 文字：${a.split(\"\\n\")[0]}`);",
    "    }",
    "    const CB_CRI_ANCHOR = \"export function analyzeContinueRecommendationStructure(\";",
    "    if (!criWork.includes(CB_CRI_ANCHOR)) G2S1_ANCHOR_FAIL.push(\"work cri 缺少 analyzeContinueRecommendationStructure\");",
    "    if (criPre.includes(CB_CRI_ANCHOR)) G2S1_ANCHOR_FAIL.push(\"pre-CB 備份 cri 已含 analyzeContinueRecommendationStructure\");",
    "    const blockStart = criWork.indexOf(\"// ─────────────── Structured continuation boundary\");",
    "    const blockEnd = criWork.indexOf(\"/**\\n * Optional category mentioned in a continue phrase\");",
    "    if (blockStart < 0 || blockEnd < blockStart || criWork.slice(0, blockStart) + criWork.slice(blockEnd) !== criPre) {",
    "      G2S1_ANCHOR_FAIL.push(\"work cri 去掉 CB 新增區塊後與 pre-CB 備份不同（舊文法未凍結？）\");",
    "    }",
    "  }",
  ),
);
P(
  "r11-Δ3 sha",
  "    if (post !== shaOf(`${WORK_ROOT}/${rel}`)) G2S1_ANCHOR_FAIL.push(`work ${rel} 與 post-F10 sha 不符（F10 交付後又被修改？）`);",
  L(
    "    // r11-Δ3：work = post-CB；F10 版（pre-CB 備份，或 CB 未改的現行檔）= post-F10",
    "    const postCB = snapSha(`${PRE_DIR}/post-CB-sha.txt`, rel);",
    "    if (postCB !== shaOf(`${WORK_ROOT}/${rel}`)) G2S1_ANCHOR_FAIL.push(`work ${rel} 與 post-CB sha 不符（CB 交付後又被修改？）`);",
    "    const f10File = F10_FILES[rel] ?? `${WORK_ROOT}/${rel}`;",
    "    if (post !== shaOf(f10File)) G2S1_ANCHOR_FAIL.push(`F10 版 ${f10File} 與 post-F10 sha 不符`);",
  ),
);
P(
  "r11-Δ3 cri sha",
  "  for (const rel of Object.keys(F9_FILES)) {\n    const post = snapSha(`${PRE_DIR}/post-F10-sha.txt`, rel);",
  L(
    "  {",
    "    // r11-Δ3：cri — work = post-CB；pre-CB 備份 = pre-CB 快照 = HEAD",
    "    const relCri = \"src/lib/ai/continue-recommendation-intent.ts\";",
    "    if (snapSha(`${PRE_DIR}/post-CB-sha.txt`, relCri) !== shaOf(`${WORK_ROOT}/${relCri}`)) G2S1_ANCHOR_FAIL.push(\"work cri 與 post-CB sha 不符\");",
    "    if (snapSha(`${PRE_DIR}/pre-CB-sha.txt`, relCri) !== shaOf(F10_FILES[relCri])) G2S1_ANCHOR_FAIL.push(\"pre-CB 備份 cri 與 pre-CB sha 不符\");",
    "    if (readFileSync(F10_FILES[relCri], \"utf8\") !== git([\"show\", `HEAD:${relCri}`])) G2S1_ANCHOR_FAIL.push(\"pre-CB 備份 cri ≠ HEAD\");",
    "  }",
    "  for (const rel of Object.keys(F9_FILES)) {",
    "    const post = snapSha(`${PRE_DIR}/post-F10-sha.txt`, rel);",
  ),
);
P(
  "r11-Δ1 trees",
  '...(WITH_F9 ? ["f9"] : [])]; // r10-Δ1',
  '...(WITH_F9 ? ["f9"] : []), ...(WITH_F10 ? ["f10"] : [])]; // r11-Δ1 // r10-Δ1',
);
P(
  "r11-Δ1 overlayHitsAll",
  "base: new Set(), f9: new Set() }; // r10-Δ1",
  "base: new Set(), f9: new Set(), f10: new Set() }; // r11-Δ1 // r10-Δ1",
);
P(
  "r11-Δ2 infra",
  '  if (tree === "pre" && oc.f10 !== false) infra.push(`INFRA-FAIL ${k} pre 含 F10（f10=${oc.f10}）`);',
  L(
    '  if (tree === "pre" && oc.f10 !== false) infra.push(`INFRA-FAIL ${k} pre 含 F10（f10=${oc.f10}）`);',
    "  // r11-Δ2：work 必須是 CB 版；f10 必須是 F10 版（同 r10 work 判別）且不含 CB，並實際載入兩個 overlay 檔",
    '  if (tree === "work" && oc.cb !== true) infra.push(`INFRA-FAIL ${k} work 不是 CB 版（cb=${oc.cb}）`);',
    '  if (tree === "f10" && (oc.cb !== false || oc.r9Probes?.legitSnapCtx !== null || oc.f10 !== true || oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "台中市" || !a1Loc || r7Trip?.lat !== 24.18)) infra.push(`INFRA-FAIL ${k} f10 overlay（CB 前＝F10）未生效（cb=${oc.cb} legitSnapCtx=${JSON.stringify(oc.r9Probes?.legitSnapCtx)} f10=${oc.f10} r7Trip=${JSON.stringify(r7Trip)}）`);',
    '  if (tree === "f10" && !["src/lib/ai/chat-turn-destination.ts", "src/lib/ai/continue-recommendation-intent.ts"].every((f) => (oc.hits ?? []).includes(f))) infra.push(`INFRA-FAIL ${k} f10 未載入 overlay（hits=${(oc.hits ?? []).join(",")}）`);',
  ),
);
P(
  "r11-Δ5 judge f10",
  'const JF9 = WITH_F9 ? judge("f9") : null; // r10-Δ6',
  L('const JF9 = WITH_F9 ? judge("f9") : null; // r10-Δ6', 'const JF10 = WITH_F10 ? judge("f10") : null; // r11-Δ5'),
);
P(
  "r11-Δ5 f10 p1 set",
  "  const p1F = JF9 ? new Set(uniq(JF9.p1)) : null;",
  L(
    "  const p1F = JF9 ? new Set(uniq(JF9.p1)) : null;",
    "  for (const h of extHits) if (JF10) JF10.p1.push(h); // r11-Δ5",
    "  const p1C = JF10 ? new Set(uniq(JF10.p1)) : null;",
  ),
);
P(
  "r11-Δ5 f10 output",
  "  // geocode 依 phase（全部情境×mode）與 more_places Credits.begin",
  L(
    "  if (p1C) {",
    "    // r11-Δ5：work（CB 後）相對 f10（CB 前＝F10）",
    "    const newVsF10 = [...p1W].filter((x) => !p1C.has(x));",
    "    const fixedVsF10 = [...p1C].filter((x) => !p1W.has(x));",
    "    out.push(`\\n══ r11：R10 情境 P1（f10＝CB 前）=${r10Of(p1C).length} ══`, ...(r10Of(p1C).length ? r10Of(p1C) : [\"(none)\"]));",
    "    out.push(`\\n══ r11：work 相對 f10（CB 前）新增 P1=${newVsF10.length} ══`, ...(newVsF10.length ? newVsF10 : [\"(none)\"]));",
    "    out.push(`\\n══ r11：CB 消除的 P1（f10 有、work 無）=${fixedVsF10.length} ══`, ...(fixedVsF10.length ? fixedVsF10 : [\"(none)\"]));",
    "    out.push(`\\nverify-destination-authority-phase2-r11: work P1=${p1W.size} f10 P1=${p1C.size} 新增P1(vs f10)=${newVsF10.length} 消除P1(vs f10)=${fixedVsF10.length} external=${extHits.length}`);",
    "  }",
    "  // geocode 依 phase（全部情境×mode）與 more_places Credits.begin",
  ),
);

let text = readFileSync(SRC, "utf8");
const errors = [];
for (const { id, old, neu } of patches) {
  const first = text.indexOf(old);
  const count = first < 0 ? 0 : text.split(old).length - 1;
  if (count !== 1) {
    errors.push(`${id}: old occurs ${count} times`);
    continue;
  }
  text = text.slice(0, first) + neu + text.slice(first + old.length);
}
if (errors.length) {
  console.error(`r11 build aborted (nothing written):\n${errors.join("\n")}`);
  process.exit(1);
}
writeFileSync(OUT, text);
console.log(`r11 built: ${patches.length} patches → ${OUT}`);
