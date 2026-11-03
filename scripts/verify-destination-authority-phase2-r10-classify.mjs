#!/usr/bin/env node
// R10 輔助（唯讀）：讀取 r10 全量輸出，將指定區段的 P1 依「情境 × 斷言類型」彙總計數，方便分類。不寫任何檔案。
// 用法：node scripts/verify-destination-authority-phase2-r10-classify.mjs "<區段標題片段>" [...]
import { readFileSync } from "node:fs";
const FILE = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/tasks/bh4a2ysij.output";
const lines = readFileSync(FILE, "utf8").split("\n");
const sectionOf = (h) => {
  const start = lines.findIndex((l) => l.startsWith("══") && l.includes(h));
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && l.startsWith("══"));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).filter((l) => l.trim());
};
// --minus A B：A 區段中不在 B 區段的行（例：work P1 − work 新增 = 既有）
if (process.argv[2] === "--minus") {
  const b = new Set(sectionOf(process.argv[4]));
  const rest = sectionOf(process.argv[3]).filter((l) => !b.has(l));
  const groups = new Map();
  for (const l of rest) {
    const sid = (l.match(/^\[([^\]]+)\]/) ?? [, "(other)"])[1];
    let kind = (l.match(/ T\d+ (\S+?)：/) ?? [])[1] ?? (l.match(/ T\d+ ([^（]+?)(?:（|$)/) ?? [])[1] ?? (l.match(/(情境總 \S+)/) ?? [])[1] ?? l.slice(0, 60);
    kind = kind.replace(/work=\d+ > base=\d+/, "work>base").replace(/「[^」]*」/g, "「…」").slice(0, 60);
    const grp = sid.replace(/-.*$/, "");
    const key = `${grp} | ${kind}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  console.log(`差集 ${rest.length} 行`);
  for (const [k, n] of [...groups.entries()].sort()) console.log(`${String(n).padStart(4)}  ${k}`);
  process.exit(0);
}
const heads = process.argv.slice(2);
for (const h of heads) {
  const start = lines.findIndex((l) => l.startsWith("══") && l.includes(h));
  if (start < 0) {
    console.log(`(找不到區段 ${h})`);
    continue;
  }
  let end = lines.findIndex((l, i) => i > start && l.startsWith("══"));
  if (end < 0) end = lines.length;
  const groups = new Map();
  for (const l of lines.slice(start + 1, end)) {
    if (!l.trim()) continue;
    const sid = (l.match(/^\[([^\]]+)\]/) ?? [, "(other)"])[1];
    const mode = (l.match(/^\[[^\]]+\]\[([^\]]+)\]/) ?? [, "-"])[1];
    let kind = (l.match(/ T\d+ (\S+?)：/) ?? [])[1] ?? (l.match(/ T\d+ ([^（]+?)(?:（|$)/) ?? [])[1] ?? (l.match(/(情境總 \S+)/) ?? [])[1] ?? l.slice(0, 60);
    kind = kind.replace(/work=\d+ > base=\d+/, "work>base").replace(/「[^」]*」/g, "「…」").slice(0, 70);
    const turn = (l.match(/ (T\d+) /) ?? [, ""])[1];
    const key = `${sid} | ${turn} ${kind}`;
    const g = groups.get(key) ?? { n: 0, modes: new Set() };
    g.n += 1;
    g.modes.add(mode);
    groups.set(key, g);
  }
  console.log(`\n### ${lines[start]}（${end - start - 1} 行）`);
  for (const [k, g] of [...groups.entries()].sort()) console.log(`${String(g.n).padStart(3)}  ${k}  [${[...g.modes].join(",")}]`);
}
