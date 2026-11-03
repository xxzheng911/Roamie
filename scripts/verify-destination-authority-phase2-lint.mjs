#!/usr/bin/env node
/**
 * T27 — ESLint 新增問題比較（work vs base aa2db59 副本）。不修改任何檔案，不使用 --fix。
 * 以 (ruleId, message, 該行原始碼 trim) 為鍵比較多重集合，避免行號位移造成誤判。
 * 執行：node scripts/verify-destination-authority-phase2-lint.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const WORK = "/Users/shuo/Roamie-clean";
const BASE =
  "/private/tmp/claude-501/-Users-shuo-Roamie-clean/1a6c8181-0935-4512-8de7-5da23a7c630e/scratchpad/base-aa2db59";
const FILES = ["src/routes/_app.chat.tsx", "src/lib/ai/chat-category-destination.ts"];

function lint(root) {
  const r = spawnSync("npx", ["eslint", "-f", "json", ...FILES], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const json = JSON.parse(r.stdout);
  const keys = new Map();
  let total = 0;
  for (const f of json) {
    const lines = readFileSync(f.filePath, "utf8").split("\n");
    const rel = f.filePath.slice(root.length + 1);
    for (const m of f.messages) {
      total += 1;
      // prettier 的 message 會隨周邊縮排建議變動，鍵只取 rule + 該行原始碼；其他規則保留 message。
      const msg = m.ruleId === "prettier/prettier" ? "" : m.message;
      const k = `${rel}\u0001${m.ruleId}\u0001${msg}\u0001${(lines[m.line - 1] ?? "").trim()}`;
      const arr = keys.get(k) ?? [];
      arr.push(m.line);
      keys.set(k, arr);
    }
  }
  return { keys, total };
}
const w = lint(WORK);
const b = lint(BASE);
const added = [];
const removed = [];
for (const [k, lines] of w.keys) {
  const n = (b.keys.get(k) ?? []).length;
  if (lines.length > n) added.push(`${k.split("\u0001").slice(0, 2).join(" ")} @${lines.slice(n).join(",")} :: ${k.split("\u0001")[3].slice(0, 90)} :: ${k.split("\u0001")[2].slice(0, 80)}`);
}
for (const [k, lines] of b.keys) {
  const n = (w.keys.get(k) ?? []).length;
  if (lines.length > n) removed.push(`${k.split("\u0001").slice(0, 2).join(" ")} @base${lines.slice(n).join(",")} :: ${k.split("\u0001")[3].slice(0, 90)}`);
}
console.log(`work total=${w.total} base total=${b.total}`);
console.log(`ADDED (${added.length}):`);
for (const a of added) console.log(`  + ${a}`);
console.log(`REMOVED (${removed.length}):`);
for (const r of removed) console.log(`  - ${r}`);
console.log(`verify-destination-authority-phase2-lint: added=${added.length} → ${added.length ? "FAIL" : "PASS"}`);
process.exit(added.length ? 1 : 0);
