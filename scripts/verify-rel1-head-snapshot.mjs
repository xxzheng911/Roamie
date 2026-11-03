#!/usr/bin/env node
// REL-1 回歸：把 HEAD commit 的檔案樹「唯讀地」展開到 scratchpad（git ls-tree + git cat-file，不動主工作區、不 checkout），
// 並把目前工作區的 scripts/verify-*.mjs 覆蓋進去，用來判斷「同一支驗證腳本在 HEAD 原始碼上是否也失敗」。
// node_modules 以 symlink 指回主工作區。
// 用法：node scripts/verify-rel1-head-snapshot.mjs --dest=<scratchpad 內的新資料夾>
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readdirSync, copyFileSync, symlinkSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dest = process.argv.find((a) => a.startsWith("--dest="))?.slice(7);
if (!dest) throw new Error("--dest=<dir> required");
const D = resolve(dest);
const rel = relative(root, D);
if (!rel.startsWith("..") && !isAbsolute(rel)) throw new Error("dest must be outside the repository");
if (existsSync(D) && readdirSync(D).length) throw new Error(`dest not empty: ${D}`);
mkdirSync(D, { recursive: true });

const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim();
const list = execFileSync("git", ["ls-tree", "-r", "-z", "HEAD"], { cwd: root, maxBuffer: 1 << 28 })
  .toString()
  .split("\0")
  .filter(Boolean)
  .map((l) => {
    const [meta, path] = l.split("\t");
    const [mode, type, sha] = meta.split(" ");
    return { mode, type, sha, path };
  })
  .filter((e) => e.type === "blob" && e.mode !== "120000" && !e.path.startsWith("docs/audits/"));

// 以 cat-file --batch 一次讀出所有 blob
const input = list.map((e) => e.sha).join("\n") + "\n";
const r = spawnSync("git", ["cat-file", "--batch"], { cwd: root, input, maxBuffer: 4 * 1024 * 1024 * 1024 });
if (r.status !== 0) throw new Error(`git cat-file failed: ${r.stderr}`);
const buf = r.stdout;
let off = 0;
for (const e of list) {
  const nl = buf.indexOf(0x0a, off);
  const header = buf.subarray(off, nl).toString();
  const size = Number(header.split(" ")[2]);
  const body = buf.subarray(nl + 1, nl + 1 + size);
  off = nl + 1 + size + 1;
  const p = resolve(D, e.path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body, { mode: e.mode === "100755" ? 0o755 : 0o644 });
}
let copied = 0;
for (const f of readdirSync(resolve(root, "scripts"))) {
  if (/^verify-.*\.mjs$/.test(f)) {
    copyFileSync(resolve(root, "scripts", f), resolve(D, "scripts", f));
    copied++;
  }
}
symlinkSync(resolve(root, "node_modules"), resolve(D, "node_modules"), "dir");
console.log(`HEAD=${head} files=${list.length} verifyScriptsOverlaid=${copied} dest=${D}`);
