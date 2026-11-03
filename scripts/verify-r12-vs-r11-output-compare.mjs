#!/usr/bin/env node
/**
 * CC-T2 — 比較 r12（post-CC）與 r11（post-CB＝pre-CC）兩份全量輸出。唯讀，不寫任何檔案。
 * 去掉進度行後，以「所屬 ══ 段落 + 行內容」為鍵做多重集合差異，依段落列出 r12 新增／消失的行。
 * 執行：node scripts/verify-r12-vs-r11-output-compare.mjs
 */
import { readFileSync } from "node:fs";

const TASKS = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/tasks";
const NOW = `${TASKS}/bgk2p0588.output`; // r12 --brief --f10（work = post-CC）
const PREV = `${TASKS}/bz2oeobwl.output`; // r11 --brief --f10（work = post-CB = pre-CC）
const MAX = Number(process.argv.find((a) => a.startsWith("--max="))?.slice(6) ?? 30);

// --normalize：把每次執行都不同的隨機 sessionId（rec_xxxx_yyyy）與 ISO 時間戳換成固定字樣，並把總結行的 r11／r12 名稱視為相同
const NORMALIZE = process.argv.includes("--normalize");
const norm = (l) =>
  NORMALIZE
    ? l
        .replace(/rec_[a-z0-9]+_[a-z0-9]+/g, "rec_<id>")
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<ts>")
        .replace(/^verify-destination-authority-phase2-r1[12]:/, "verify-destination-authority-phase2-r1x:")
    : l;
function load(file) {
  const bySection = new Map();
  let section = "(head)";
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = norm(raw);
    if (line.startsWith("[p2r5]")) continue;
    if (line.startsWith("══")) section = line.slice(0, 80);
    const m = bySection.get(section) ?? new Map();
    m.set(line, (m.get(line) ?? 0) + 1);
    bySection.set(section, m);
  }
  return bySection;
}
const a = load(NOW);
const b = load(PREV);
const sections = [...new Set([...a.keys(), ...b.keys()])];
let totalAdd = 0;
let totalDel = 0;
for (const s of sections) {
  const ma = a.get(s) ?? new Map();
  const mb = b.get(s) ?? new Map();
  const add = [];
  const del = [];
  for (const [l, n] of ma) for (let i = 0; i < n - (mb.get(l) ?? 0); i += 1) add.push(l);
  for (const [l, n] of mb) for (let i = 0; i < n - (ma.get(l) ?? 0); i += 1) del.push(l);
  if (!add.length && !del.length) continue;
  totalAdd += add.length;
  totalDel += del.length;
  console.log(`\n## ${s}  (+${add.length} / -${del.length})`);
  for (const l of add.slice(0, MAX)) console.log(`  + ${l.slice(0, 400)}`);
  for (const l of del.slice(0, MAX)) console.log(`  - ${l.slice(0, 400)}`);
}
console.log(`\nverify-r12-vs-r11-output-compare: +${totalAdd} -${totalDel}`);
