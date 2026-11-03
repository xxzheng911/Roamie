#!/usr/bin/env node
// Builds scripts/verify-destination-authority-phase2-r8.mjs from r7 (r7 is NOT modified).
// Every patch's `old` text must occur exactly once in the current text; otherwise abort without writing.
// r8 只做 L-1 必要的對位：work anchor／catch 鏡像（turnLocation 移入內層 try）、自身路徑、快照外檔案排除 r8 腳本。
// r7 全部 assertion 原樣保留（未放寬、未刪除、未改 expect）；只新增 pre-L1 備份檢查。
// Run: node scripts/verify-destination-authority-phase2-r8-build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "/Users/shuo/Roamie-clean/scripts/verify-destination-authority-phase2-r7.mjs";
const OUT = "/Users/shuo/Roamie-clean/scripts/verify-destination-authority-phase2-r8.mjs";
const L = (...lines) => lines.join("\n");

const patches = [];
const P = (id, old, neu) => patches.push({ id, old, neu });

P(
  "header",
  L("/**", " * R7 — Location Authority 方案 A（F8：R-1 / J1 / nearbyLocationAuthority）獨立驗收。"),
  L(
    "/**",
    " * R8 — L-1 微修（send() catch：turnLocation 移入內層 try）獨立複驗。",
    " * 由 scripts/verify-destination-authority-phase2-r8-build.mjs 以 r7（保留不改）逐字複製並套用 exact-once patch 產生（r8-Δ）：",
    " *  r8-Δ1 work anchor：F8 的「turnLocation 在 try 之前」anchor 換成 L-1 文字（turnLocation 在 try 內、註解一併搬移）；",
    " *         另新增：pre-L1 備份（scratchpad/_app.chat.pre-L1.tsx）必須含 F8 原 anchor、work 不得再含。",
    " *  r8-Δ2 work catch 鏡像：turnLocation 計算移入內層 try；拋例外 → fallback_failed → recovery_copy（正常輸入不會拋，行為同 r7）。",
    " *  r8-Δ3 自身路徑 r8；F7 後變動檔排除 r7/r8 驗收腳本。樹與 r7 相同：work（L-1 後）、pre（F6）、base（aa2db59）。",
    " *  F8 對照：以 r7 在 F8 時的輸出（tasks/b83ep0rc4.output）逐條比對 P1。",
    " *",
    " * 執行：node scripts/verify-destination-authority-phase2-r8.mjs --brief",
    " *",
    " * ── 以下為 r7 原始說明 ──",
    " * R7 — Location Authority 方案 A（F8：R-1 / J1 / nearbyLocationAuthority）獨立驗收。",
  ),
);
P(
  "script",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r7.mjs`;",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r8.mjs`;",
);
P(
  "snap-exclude",
  "!/^scripts\\/verify-destination-authority-phase2-r7/.test(f)",
  "!/^scripts\\/verify-destination-authority-phase2-r[78]/.test(f)",
);
P(
  "mirror-catch",
  L(
    "        let retrySession = session;",
    "        if (F8) {",
    "          const turnLocation = M.ctd.withoutUnconfirmedSessionDestinations(nextSession, turnStartSession);",
    "          retrySession = { ...session, location: turnLocation.location, nearbyLocationAuthority: turnLocation.nearbyLocationAuthority };",
    "        }",
  ),
  L(
    "        let retrySession = session;",
    "        if (F8) {",
    "          // r8-Δ2：L-1 L10898-10922 turnLocation 在內層 try 內；拋例外 → 內層 catch（FALLBACK_FAILED）→ recovery 文案",
    "          try {",
    "            const turnLocation = M.ctd.withoutUnconfirmedSessionDestinations(nextSession, turnStartSession);",
    "            retrySession = { ...session, location: turnLocation.location, nearbyLocationAuthority: turnLocation.nearbyLocationAuthority };",
    "          } catch (e) {",
    "            obs.retryLoc = null;",
    "            obs.path += `|fallback_failed(turnLocation:${String(e?.message ?? e).slice(0, 40)})|recovery_copy`;",
    "            return;",
    "          }",
    "        }",
  ),
);
const F8_ANCHOR =
  '"const turnLocation = withoutUnconfirmedSessionDestinations(nextSession, turnStartSession);\\n      try {\\n        const fallbackApplied = await applyLocalFallback(\\n          {\\n            ...session,\\n            location: turnLocation.location,\\n            nearbyLocationAuthority: turnLocation.nearbyLocationAuthority,\\n          },\\n          trimmed,\\n          errorConversation,\\n          \\"state_machine_error\\",\\n          turnStartSession,",';
const L1_ANCHOR =
  '"try {\\n        // Retry from the turn-start snapshot, carrying over only the position this turn already\\n        // acquired (cleaned against turnStartSession; unconfirmed / Trip Add Place stays pre-turn).\\n        const turnLocation = withoutUnconfirmedSessionDestinations(nextSession, turnStartSession);\\n        const fallbackApplied = await applyLocalFallback(\\n          {\\n            ...session,\\n            location: turnLocation.location,\\n            nearbyLocationAuthority: turnLocation.nearbyLocationAuthority,\\n          },\\n          trimmed,\\n          errorConversation,\\n          \\"state_machine_error\\",\\n          turnStartSession,",';
P(
  "anchor-L1",
  L("const F8_WORK_ANCHORS = [", '  "const turnStartSession: ChatPlanningSession = {\\n      ...sessionRef.current,\\n      location: session.location,\\n      nearbyLocationAuthority: session.nearbyLocationAuthority,\\n      pendingClarification: undefined,\\n    };",', `  ${F8_ANCHOR}`, "];"),
  L(
    "// r8-Δ1：F8 catch anchor（turnLocation 在 try 之前）→ L-1 anchor（turnLocation 在 try 內）",
    `const F8_CATCH_ANCHOR_R7 = ${F8_ANCHOR.slice(0, -1)};`,
    "const F8_WORK_ANCHORS = [",
    '  "const turnStartSession: ChatPlanningSession = {\\n      ...sessionRef.current,\\n      location: session.location,\\n      nearbyLocationAuthority: session.nearbyLocationAuthority,\\n      pendingClarification: undefined,\\n    };",',
    `  ${L1_ANCHOR}`,
    "];",
  ),
);
P(
  "anchor-preL1-check",
  L("if (anchorFail.length) {", '  console.log(["INFRA-FAIL source anchors", ...anchorFail].join("\\n"));'),
  L(
    "// r8-Δ1：pre-L1 備份 = F8（含 F8 catch anchor）；work 不得再含 F8 catch anchor",
    "{",
    '  const preL1 = readFileSync("/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad/_app.chat.pre-L1.tsx", "utf8");',
    '  if (!preL1.includes(F8_CATCH_ANCHOR_R7)) anchorFail.push("pre-L1 備份缺少 F8 catch anchor（備份錯誤？）");',
    '  if (SRC.work.includes(F8_CATCH_ANCHOR_R7)) anchorFail.push("work 仍含 F8 catch anchor（turnLocation 在 try 之前）");',
    '  for (const a of F8_WORK_ANCHORS) if (a !== F8_WORK_ANCHORS[1] && !preL1.includes(a)) anchorFail.push(`pre-L1 備份缺少 F8 anchor：${a.split("\\n")[0]}`);',
    "}",
    "if (anchorFail.length) {",
    '  console.log(["INFRA-FAIL source anchors", ...anchorFail].join("\\n"));',
  ),
);
P(
  "anchor-line-report",
  'lineOf(src, "const turnLocation = withoutUnconfirmedSessionDestinations(nextSession, turnStartSession);\\n      try {").map((l) => l + 1).join(",")',
  'lineOf(src, "try {\\n        // Retry from the turn-start snapshot").join(",")',
);
P(
  "out-final",
  "out.push(`verify-destination-authority-phase2-r7: work P1=",
  "out.push(`verify-destination-authority-phase2-r8: work P1=",
);

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
