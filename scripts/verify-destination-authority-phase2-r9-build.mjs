#!/usr/bin/env node
// Builds scripts/verify-destination-authority-phase2-r9.mjs from r8 (r8 is NOT modified).
// Every patch's `old` text must occur exactly once in the current text; otherwise abort without writing.
// r9 = Phase 2 第二組 Step 1（G2S1：more_places 可信目的地／Session Restore）獨立驗收。
//  - 樹：work（G2S1 後）、pre（G2S1 前＝L-1：chat-turn-destination.ts / _app.chat.tsx 以 scratchpad 的 *.pre-G2S1.* overlay）、base（aa2db59）。
//  - r8 全部 assertion 原樣保留（未放寬、未刪除、未改 expect）；只新增 R9 情境、r9 expect、probe 與輸出。
//  - 長片段放在 scratchpad/r9frag/*.txt（避免跳脫錯誤）；短片段直接寫在本檔。
// Run: node scripts/verify-destination-authority-phase2-r9-build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "/Users/shuo/Roamie-clean/scripts/verify-destination-authority-phase2-r8.mjs";
const OUT = "/Users/shuo/Roamie-clean/scripts/verify-destination-authority-phase2-r9.mjs";
const FRAG = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad/r9frag";
const frag = (name) => readFileSync(`${FRAG}/${name}`, "utf8").replace(/\n$/, "");
const L = (...lines) => lines.join("\n");

const patches = [];
const P = (id, old, neu) => patches.push({ id, old, neu });

P(
  "header",
  L("/**", " * R8 — L-1 微修（send() catch：turnLocation 移入內層 try）獨立複驗。"),
  L(
    "/**",
    " * R9 — Phase 2 第二組 Step 1（G2S1）獨立驗收：A. more_places 只用可信目的地；B. 已確認行政區推薦成功後重新載入沿用。",
    " * 由 scripts/verify-destination-authority-phase2-r9-build.mjs 以 r8（保留不改）逐字複製並套用 exact-once patch 產生（r9-Δ）：",
    " *  r9-Δ1 樹：work（G2S1 後）、pre（G2S1 前＝L-1：chat-turn-destination.ts / _app.chat.tsx 以 *.pre-G2S1.* overlay；",
    " *         resolve-chat-location.ts G2S1 未改 → pre 用現行檔）、base（aa2db59）。pre 走 F8 inline 分支（L-1 已含 F8）。",
    " *  r9-Δ2 more_places 鏡像：work = G2S1 L5099-5128（resolveCategoryTurnDestination）；pre = L-1 L5099-5121（isUnconfirmedSearchDestination）；",
    " *         base = r8 鏡像不變。新增 obs.moreCreditsDest（more_places Credits metadata.destination；不計入既有 credits 總數）。",
    " *  r9-Δ3 R9 情境（必驗 1-18、升級舊 Session、偽造快照）；r9-Δ4 R9 initKind；r9-Δ5 真實模組 probe；r9-Δ6 輸出；r9-Δ7 anchors。",
    " *  r8 全部 assertion 原樣保留（未放寬、未刪除、未改 expect）。",
    " *",
    " * 執行：node scripts/verify-destination-authority-phase2-r9.mjs --brief [--only=ID,…]",
    " *",
    " * ── 以下為 r8 原始說明 ──",
    " * R8 — L-1 微修（send() catch：turnLocation 移入內層 try）獨立複驗。",
  ),
);
P(
  "script",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r8.mjs`;",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r9.mjs`;",
);
P(
  "pre-files",
  L(
    "const PRE_FILES = {",
    '  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-F7.ts`,',
    '  "src/routes/_app.chat.tsx": `${PRE_DIR}/_app.chat.pre-F7.tsx`,',
    '  "src/lib/ai/resolve-chat-location.ts": `${PRE_DIR}/resolve-chat-location.pre-F7.ts`,',
    "};",
  ),
  L(
    "// r9-Δ1：pre = G2S1 前備份（= L-1 結案狀態）；resolve-chat-location.ts 在 G2S1 未修改（pre = 現行檔）",
    "const PRE_FILES = {",
    '  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-G2S1.ts`,',
    '  "src/routes/_app.chat.tsx": `${PRE_DIR}/_app.chat.pre-G2S1.tsx`,',
    "};",
    "const PRE_F7_RCL = `${PRE_DIR}/resolve-chat-location.pre-F7.ts`; // r9：只用於確認 F7 前備份仍為 F7 前內容",
  ),
);
P(
  "sha-snapshot",
  "const PRE_SHA_SNAPSHOT = `${PRE_DIR}/pre-F7-sha.txt`;",
  "const PRE_SHA_SNAPSHOT = `${PRE_DIR}/pre-G2S1-sha.txt`; // r9-Δ1：G2S1 開始前 sha1 快照",
);
P(
  "loader-rcl",
  '    baseContent.set(`${WORK_ROOT}/src/lib/ai/resolve-chat-location.ts`, readFileSyncC(PRE_FILES["src/lib/ai/resolve-chat-location.ts"], "utf8"));',
  "    // r9-Δ1：resolve-chat-location.ts 在 G2S1 未修改 → pre 使用現行檔（不 overlay）",
);
P(
  "f8-flag",
  '  const F8 = TREE === "work";',
  '  const F8 = TREE === "work" || TREE === "pre"; // r9-Δ1：pre = L-1（已含 F8）\n  const G2S1 = TREE === "work"; // r9-Δ2：只有 work 走 G2S1 more_places 鏡像',
);
P("mod-dres", '    ctd: IS_WORK ? await imp("lib/ai/chat-turn-destination.ts") : null,', '    ctd: IS_WORK ? await imp("lib/ai/chat-turn-destination.ts") : null,\n    dres: IS_WORK ? await imp("lib/ai/destination-resolution.ts") : null, // r9-Δ5');
P("obs-field", "      retryLoc: null,\n    };\n  }", "      retryLoc: null,\n      // r9-Δ2\n      moreCreditsDest: null,\n    };\n  }");
P("record-cont", frag("08-recordcont.old.txt"), frag("08-recordcont.new.txt"));
P("call-1", "      const effective = recordContinuation(obs, nextSession, destForMore);", "      const effective = recordContinuation(obs, nextSession, destForMore, trimmed); // r9-Δ2");
P("call-2", "        obs.continuationDest = recordContinuation(obs, nextSession, destForMore);", "        obs.continuationDest = recordContinuation(obs, nextSession, destForMore, trimmed); // r9-Δ2");
P("inits", "  // r5-Δ3：resolveChatLocation（src/lib/ai/resolve-chat-location.ts）mock：", frag("12a-inits.new.txt"));
P("probes", "  const copyOf = (key, vars) => M.copy.chatRuntimeCopy(key, LOCALE, vars);", frag("12b-probes.new.txt"));
P("snap-exclude", "!/^scripts\\/verify-destination-authority-phase2-r[78]/.test(f)", "!/^scripts\\/verify-destination-authority-phase2-r[789]/.test(f)");
P("anchors-r9", "ANCHORS.work = [...ANCHORS.pre.filter((a) => !F8_REPLACED.includes(a)), ...F8_WORK_ANCHORS];", frag("15-anchors.new.txt"));
P("anchor-fail-init", "const anchorFail = [];", "const anchorFail = [...G2S1_ANCHOR_FAIL]; // r9-Δ7");
P(
  "pre-f8-text",
  "    if (SRC.pre.includes(a)) anchorFail.push(`pre(F6) 已含 F8 文字：${a.split(\"\\n\")[0]}`);",
  "    if (!SRC.pre.includes(a)) anchorFail.push(`pre(L-1) 缺少 F8 文字：${a.split(\"\\n\")[0]}`); // r9-Δ1：pre = L-1 必須含 F8",
);
P(
  "rcl-pre",
  L(
    '  const rclPre = readFileSync(PRE_FILES["src/lib/ai/resolve-chat-location.ts"], "utf8");',
    '  for (const a of ["city: device.city ?? \\"\\",", "displayLabel: device.city ?? \\"\\","]) {',
    "    if (!rclWork.includes(a)) anchorFail.push(`work resolve-chat-location 缺少 F8 文字：${a}`);",
    "    if (rclPre.includes(a)) anchorFail.push(`pre resolve-chat-location 已含 F8 文字：${a}`);",
    "  }",
    '  if (!rclPre.includes("device.city ?? session.location?.city ?? \\"\\"")) anchorFail.push("pre resolve-chat-location 缺少 F7 前 city 補值文字");',
  ),
  L(
    "  const rclPre = rclWork; // r9-Δ1：G2S1 未改 resolve-chat-location → pre = 現行（L-1，含 F8）",
    '  const rclPreF7 = readFileSync(PRE_F7_RCL, "utf8");',
    '  for (const a of ["city: device.city ?? \\"\\",", "displayLabel: device.city ?? \\"\\","]) {',
    "    if (!rclWork.includes(a)) anchorFail.push(`work resolve-chat-location 缺少 F8 文字：${a}`);",
    "    if (!rclPre.includes(a)) anchorFail.push(`pre(L-1) resolve-chat-location 缺少 F8 文字：${a}`);",
    "    if (rclPreF7.includes(a)) anchorFail.push(`F7 前備份 resolve-chat-location 已含 F8 文字：${a}`);",
    "  }",
    '  if (!rclPreF7.includes("device.city ?? session.location?.city ?? \\"\\"")) anchorFail.push("F7 前備份 resolve-chat-location 缺少 F7 前 city 補值文字");',
  ),
);
P(
  "infra-pre-tree",
  '  if (tree === "pre" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "台中市" || !a1Loc || r7Trip?.lat !== 35.0116)) infra.push(`INFRA-FAIL ${k} pre overlay（F7 前＝F6）未生效（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)} a1=${JSON.stringify(a1Loc)} r7Trip=${JSON.stringify(r7Trip)}）`);',
  L(
    "  // r9-Δ1：pre = L-1（F8 版 withoutUnconfirmed：r7Trip 退回 24.18）；G2S1 判別：legitSnapCtx（快照台中西屯）work=台中西屯、pre=null",
    '  if (tree === "pre" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "台中市" || !a1Loc || r7Trip?.lat !== 24.18 || oc.r9Probes?.legitSnapCtx !== null)) infra.push(`INFRA-FAIL ${k} pre overlay（G2S1 前＝L-1）未生效（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)} a1=${JSON.stringify(a1Loc)} r7Trip=${JSON.stringify(r7Trip)} g2s1=${JSON.stringify(oc.r9Probes?.legitSnapCtx)}）`);',
    '  if (tree === "work" && oc.r9Probes?.legitSnapCtx !== "台中西屯") infra.push(`INFRA-FAIL ${k} work 不是 G2S1 版（legitSnapCtx=${JSON.stringify(oc.r9Probes?.legitSnapCtx)}）`);',
  ),
);
P(
  "collect-reload-from",
  "  const a = await collectOnce(tree, mode, { ...scenario, turns: scenario.turns.slice(0, k + 1) }, {});",
  "  // r9-Δ3：reloadFromTree（升級情境）＝第一段在指定樹（base）執行並 persist，第二段在本樹讀取\n  const a = await collectOnce(scenario.reloadFromTree ?? tree, mode, { ...scenario, turns: scenario.turns.slice(0, k + 1) }, {});",
);
P(
  "scenarios",
  "const SCENARIOS = [...T27_SCENARIOS, ...NEW_SCENARIOS, ...R3_SCENARIOS, ...R4_SCENARIOS, ...R5_SCENARIOS, ...R6_SCENARIOS, ...R7_SCENARIOS];",
  frag("20-scen.new.txt"),
);
P(
  "judge-r9",
  L(
    "        for (const c of e.searchPrefix ?? []) {",
    "          const w = W[c.turn];",
    "          if (w && w.searchDest && !c.prefixes.some((p) => w.searchDest.startsWith(p))) p1.push(`${tag} T${c.turn + 1} r5-AREA：search=${w.searchDest}（應為 ${c.prefixes.join(\"/\")} 開頭或不搜尋；path=${w.path}）`);",
    "        }",
  ),
  frag("21-judge.new.txt"),
);
P("out-r9", "out.push(`\\n情境=${scenarios.length}", frag("22-out.new.txt"));
P("out-final", "out.push(`verify-destination-authority-phase2-r8: work P1=", "out.push(`verify-destination-authority-phase2-r9: work P1=");

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
