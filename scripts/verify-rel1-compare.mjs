#!/usr/bin/env node
// REL-1 回歸：合併多輪 runner 結果，輸出每支腳本的最終狀態與 HEAD 基準對照。只讀檔。
// 用法：node scripts/verify-rel1-compare.mjs --base=<首輪 dir> [--override=<dir1,dir2,…>] [--head=<dir1,dir2>] [--format=tsv|summary]
//   --override：後面的目錄覆蓋前面（例如重跑、瀏覽器輪、單支修正後重跑）
//   --head：HEAD 基準快照的結果（多個目錄時，以「真正驗證模式」的結果優先）
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const load = (dir) => (dir && existsSync(resolve(dir, "results.json")) ? JSON.parse(readFileSync(resolve(dir, "results.json"), "utf8")) : []);
const list = (k) => (arg(k) ? arg(k).split(",").filter(Boolean) : []);
const MODE_FLAG = /--(dump|emit|self-test|t\d-only)/;

const cur = new Map(load(arg("base")).map((r) => [r.file, r]));
for (const dir of list("override")) for (const r of load(dir)) cur.set(r.file, r);
const head = new Map();
for (const dir of list("head"))
  for (const r of load(dir)) {
    const prev = head.get(r.file);
    const real = !MODE_FLAG.test(r.via ?? "");
    if (!prev || (real && (MODE_FLAG.test(prev.via ?? "") || prev.status !== "PASS"))) head.set(r.file, real ? r : { ...r, status: `${r.status}(模式旗標)` });
  }

const rows = [...cur.values()]
  .sort((a, b) => a.file.localeCompare(b.file))
  .map((r) => ({
    file: r.file,
    status: MODE_FLAG.test(r.via ?? "") ? `${r.status}(模式旗標)` : r.status,
    head: head.get(r.file)?.status ?? "-",
    nums: (r.counts ?? []).join(" "),
    via: r.via ?? "",
    reason: r.reason ?? "",
  }));
if (arg("format") === "summary") {
  const t = {};
  for (const r of rows) {
    const k = `${r.status}${r.head !== "-" ? ` | HEAD:${r.head}` : ""}`;
    t[k] = (t[k] ?? 0) + 1;
  }
  console.log(JSON.stringify(t, null, 1));
} else {
  const want = arg("status") ? new Set(arg("status").split(",")) : null;
  for (const r of rows) if (!want || want.has(r.status)) console.log([r.file, r.status, `HEAD=${r.head}`, r.nums, r.via, r.reason].join("\t"));
}
