#!/usr/bin/env node
/**
 * T27 — 找出 destination-resolution.ts 的 import 循環路徑（work 與 base 皆檢查；base 無此檔則略過）。
 * 與 verify-destination-resolution-phase1-r3.mjs 的 CYCLE 檢查使用相同的 import 解析規則。
 * 執行：node scripts/verify-destination-authority-phase2-cycle.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/shuo/Roamie-clean";
const target = path.join(ROOT, "src/lib/ai/destination-resolution.ts");
const resolveImport = (spec, from) => {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
    const f = base + ext;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
};
const importsOf = (f) => {
  const s = fs.readFileSync(f, "utf8");
  const specs = [
    ...s.matchAll(/(?:import|export)[^"';]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g),
  ].map((m) => m[1] ?? m[2] ?? m[3]);
  return specs.map((sp) => resolveImport(sp, f)).filter(Boolean);
};
// BFS：最短的 target → … → target 路徑
const parent = new Map();
const queue = [target];
const seen = new Set([target]);
let found = null;
while (queue.length && !found) {
  const f = queue.shift();
  for (const dep of importsOf(f)) {
    if (dep === target) {
      found = f;
      break;
    }
    if (!seen.has(dep)) {
      seen.add(dep);
      parent.set(dep, f);
      queue.push(dep);
    }
  }
}
if (!found) {
  console.log("no cycle");
  process.exit(0);
}
const chain = [target];
for (let f = found; f && f !== target; f = parent.get(f)) chain.splice(1, 0, f);
chain.push(target);
console.log("CYCLE path:");
for (const f of chain) console.log(`  → ${path.relative(ROOT, f)}`);
process.exit(1);
