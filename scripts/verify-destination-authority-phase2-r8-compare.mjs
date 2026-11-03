#!/usr/bin/env node
/**
 * R8 — 全量輸出比對：r8（L-1 後）vs r7 在 F8 時的輸出（同一套 assertion；r8 只改 anchor／catch 鏡像）。
 * 比較：P1（work）集合、新增 P1（vs pre=F6）、新增 P1（vs aa2db59）、情境×mode P1 數、Provider 總數、throw vs 正常 Provider、外部請求。
 * 只讀兩份既有輸出檔，不執行任何測試、不連網。
 * 執行：node scripts/verify-destination-authority-phase2-r8-compare.mjs
 */
import { readFileSync } from "node:fs";

const TASKS = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/tasks";
const F8_OUT = `${TASKS}/b83ep0rc4.output`;
const L1_OUT = `${TASKS}/bb8c5mx58.output`;

const norm = (l) => l.replace(/rec_[a-z0-9]+_[a-z0-9]+/g, "rec_X").replace(/\s+$/, "");
const section = (txt, head) => {
  const lines = txt.split("\n");
  const i = lines.findIndex((l) => l.startsWith(`══ ${head}`));
  if (i < 0) return null;
  const out = [];
  for (let j = i + 1; j < lines.length; j += 1) {
    if (lines[j].startsWith("══ ")) break;
    if (lines[j].trim()) out.push(norm(lines[j]));
  }
  return { header: lines[i], lines: out };
};
const A = readFileSync(F8_OUT, "utf8");
const B = readFileSync(L1_OUT, "utf8");
const results = [];
const cmp = (label, head, mode = "set") => {
  const a = section(A, head);
  const b = section(B, head);
  if (!a || !b) {
    results.push({ label, ok: false, detail: `section 缺少（F8=${Boolean(a)} L1=${Boolean(b)}）` });
    return;
  }
  const sa = new Set(a.lines);
  const sb = new Set(b.lines);
  const added = [...sb].filter((l) => !sa.has(l));
  const removed = [...sa].filter((l) => !sb.has(l));
  const ok = mode === "noAdd" ? added.length === 0 : added.length === 0 && removed.length === 0;
  results.push({ label, ok, detail: `F8=${a.lines.length} 行 L1=${b.lines.length} 行 新增=${added.length} 消失=${removed.length}`, added, removed, headers: [a.header, b.header] });
};
cmp("P1（work）", "P1（work = F5 後）");
cmp("新增 P1（work vs pre=F6）", "work 新增 P1（pre 沒有）");
cmp("F6→work 消除的 P1", "F5 消除的 P1（pre 有、work 沒有）");
cmp("work 相對 aa2db59 新增 P1", "r7：work 相對 aa2db59 新增 P1");
cmp("情境×mode P1 數", "情境 × mode P1 數");
cmp("每 mode PASS/FAIL（work）", "每 mode PASS/FAIL（work");
cmp("P1 計數", "P1 計數");
cmp("Provider 總數（各樹）", "r6：各樹 Provider 總數");
cmp("Provider 總數（work/base 每 mode）", "Provider 呼叫總數（work / base）");
cmp("Provider work/pre", "Provider 呼叫 work(F5 後) / pre(F5 前)");
cmp("throw vs 正常 Provider／device", "r7：throw（catch retry）vs 正常路徑 Provider");
cmp("R7 逐輪 location／authority", "r7：R7 情境逐輪 location");
cmp("retry 到達紀錄", "r6：retry（applyLocalFallback destination-category-retry）到達紀錄");
cmp("GPS A/B/C probe", "r6：真實模組 GPS A/B/C probe");
cmp("外部請求攔截", "外部請求攔截");
const finalLine = (t) => t.split("\n").find((l) => /^verify-destination-authority-phase2-r[78]: /.test(l)) ?? "(none)";
const out = [];
for (const r of results) {
  out.push(`${r.ok ? "SAME" : "DIFF"} ${r.label} :: ${r.detail}`);
  if (r.headers && r.headers[0] !== r.headers[1]) out.push(`   header F8: ${r.headers[0]}\n   header L1: ${r.headers[1]}`);
  for (const l of (r.added ?? []).slice(0, 20)) out.push(`   + ${l.slice(0, 300)}`);
  for (const l of (r.removed ?? []).slice(0, 20)) out.push(`   - ${l.slice(0, 300)}`);
}
out.push(`F8 final: ${finalLine(A)}`);
out.push(`L1 final: ${finalLine(B)}`);
const diff = results.filter((r) => !r.ok).length;
out.push(`verify-destination-authority-phase2-r8-compare: sections=${results.length} DIFF=${diff} → ${diff === 0 ? "SAME" : "DIFF"}`);
console.log(out.join("\n"));
process.exit(diff === 0 ? 0 : 1);
