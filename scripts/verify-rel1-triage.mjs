#!/usr/bin/env node
// REL-1 回歸：讀 verify-rel1-regression-runner 的 results.json 與 logs，為每支失敗腳本抽出關鍵失敗訊息與初步分類線索。
// 只讀檔，不執行任何腳本。
// 用法：node scripts/verify-rel1-triage.mjs --out=<runner out dir> [--status=FAIL,TIMEOUT] [--lines=4] [--only=a,b] [--grep=regex]
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = arg("out");
const STATUS = new Set(arg("status", "FAIL,TIMEOUT").split(","));
const N = Number(arg("lines", "4"));
const ONLY = arg("only") ? new Set(arg("only").split(",").map((s) => (s.endsWith(".mjs") ? s : `${s}.mjs`))) : null;
const GREP = arg("grep") ? new RegExp(arg("grep")) : null;
const results = JSON.parse(readFileSync(resolve(OUT, "results.json"), "utf8"));

const SIGNAL =
  /AssertionError|Error:|Error \[|^\s*(FAIL|✗|×|NG|INFRA-FAIL|CRASH)\b|\bFAIL\b|expected:|actual:|message:|不存在|not found|Cannot find|sha/i;
const NOISE = /^\s*at |REL1-NETGUARD\] SPAWN|node:internal|^\s*'|^\s*\+|^\s*-|^\$ /;

function hints(log) {
  const h = [];
  if (/備份不存在|快照不存在|pre tree|PRE_DIR/.test(log)) h.push("缺 scratchpad 備份/快照（一次性輪次探針）");
  if (/sha[^\n]{0,40}(mismatch|不符|不一致|!==|expected)|sha16|sha256/i.test(log)) h.push("sha 釘選");
  if (/BLOCK-CONNECT|BLOCK-DNS/.test(log)) h.push("網路被 netguard 擋下");
  if (/ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package|does not provide an export named|is not exported/.test(log)) h.push("模組/匯出不存在");
  if (/ERR_UNKNOWN_FILE_EXTENSION/.test(log)) h.push("需 vite-node/TS loader");
  if (/operator: 'match'|operator: 'doesNotMatch'|The input did not match|did not match the regular expression/.test(log)) h.push("原始碼文字 regex 斷言");
  if (/process\.argv|usage|用法|missing argument|requires? (an )?arg/i.test(log)) h.push("可能需參數");
  if (/EADDRINUSE/.test(log)) h.push("port 衝突");
  return h;
}

for (const r of results) {
  if (!STATUS.has(r.status)) continue;
  if (ONLY && !ONLY.has(r.file)) continue;
  const log = existsSync(r.log ?? "") ? readFileSync(r.log, "utf8") : r.tail ?? "";
  if (GREP && !GREP.test(log)) continue;
  const lines = log
    .split("\n")
    .filter((l) => SIGNAL.test(l) && !NOISE.test(l))
    .map((l) => l.trim().slice(0, 260));
  const uniq = [...new Set(lines)].slice(0, N);
  console.log(`## ${r.file} [${r.status} code=${r.code} via=${r.via} counts=${(r.counts ?? []).join(" ")}] ${hints(log).join("；")}`);
  for (const l of uniq) console.log(`   ${l}`);
}
