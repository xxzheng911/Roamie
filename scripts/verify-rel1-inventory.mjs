#!/usr/bin/env node
// REL-1 回歸：盤點 scripts/verify-*.mjs 的靜態特徵（只讀檔，不執行任何腳本、不發網路請求）。
// 用法：node scripts/verify-rel1-inventory.mjs [--json]
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const files = readdirSync(resolve(root, "scripts"))
  .filter((f) => /^verify-.*\.mjs$/.test(f) && !f.startsWith("verify-rel1-"))
  .sort();

const npmByFile = new Map();
for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
  for (const m of String(cmd).matchAll(/scripts\/(verify-[\w.-]+\.mjs)/g)) {
    if (!npmByFile.has(m[1])) npmByFile.set(m[1], []);
    npmByFile.get(m[1]).push({ name, cmd });
  }
}

const rows = [];
for (const f of files) {
  const src = readFileSync(resolve(root, "scripts", f), "utf8");
  const hosts = new Set();
  for (const m of src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1].toLowerCase());
  const envNames = new Set();
  for (const m of src.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) envNames.add(m[1]);
  for (const m of src.matchAll(/process\.env\[\s*["']([A-Z_][A-Z0-9_]*)["']\s*\]/g)) envNames.add(m[1]);
  const secretEnv = [...envNames].filter((n) => /KEY|SECRET|TOKEN|PASSWORD|SERVICE_ROLE|STAGING|SUPABASE_URL|OPENAI|ANON/.test(n));
  const spawns = new Set();
  for (const m of src.matchAll(/(?:spawn|spawnSync|execFile|execFileSync|execSync|exec)\(\s*(["'`])([^"'`]{1,80})\1/g)) spawns.add(m[2]);
  const flags = {
    browser: /Google Chrome|remote-debugging|playwright|puppeteer|chromium/i.test(src),
    childProcess: /node:child_process|from ["']child_process["']/.test(src),
    readsDotEnv: /readFileSync\([^)]*["'`][^"'`]*\.env|parseEnv|dotenv|\.dev\.vars["']\s*\)|roamie-staging-test/.test(src) && !/forbiddenFiles/.test(src),
    staging: /staging/i.test(src),
    build: /vite build|["']build["']|run build|production-build|xcodebuild|cap sync|sync-app-bundle|ios-release-build/.test(src),
    preDir: /PRE_DIR|scratchpad/.test(src),
    writesRepo: /const OUT = "\/Users\/shuo\/Roamie-clean\//.test(src) || /resolve\(repo, "dist"\)|ios\/App\/App\/public/.test(src) || /RECEIPT = "dist\//.test(src),
    realFetch: /\bfetch\(/.test(src) && !/(globalThis\.fetch|global\.fetch)\s*=|fetchImpl|fetch:\s*async|mockFetch|fakeFetch|stubFetch/i.test(src),
    argv: /process\.argv\[2\]/.test(src),
    cdpIntercept: /Fetch\.enable|Fetch\.failRequest|setBlockedURLs|setRequestInterception/.test(src),
    usesDist: /dist\/client|dist\/server|["']dist["']/.test(src),
    devServer: /createServer\(|vite\.createServer|from ["']vite["']/.test(src),
  };
  rows.push({
    file: f,
    npm: (npmByFile.get(f) ?? []).map((x) => x.name),
    npmCmd: (npmByFile.get(f) ?? [])[0]?.cmd ?? null,
    lines: src.split("\n").length,
    hosts: [...hosts].filter((h) => !/^(localhost|127\.0\.0\.1|example\.(com|test|org)|\[::1\])$/.test(h)),
    envNames: [...envNames],
    secretEnv,
    spawns: [...spawns],
    ...flags,
  });
}

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(rows, null, 1) + "\n");
} else {
  for (const r of rows) {
    const tags = Object.entries(r)
      .filter(([k, v]) => v === true)
      .map(([k]) => k);
    console.log(
      [
        r.file,
        r.npm.length ? `npm=${r.npm.join(",")}` : "npm=-",
        tags.join(",") || "-",
        r.secretEnv.length ? `secretEnv=${r.secretEnv.join(",")}` : "",
        r.spawns.length ? `spawn=${r.spawns.join("|")}` : "",
        r.hosts.length ? `hosts=${r.hosts.slice(0, 6).join(",")}` : "",
      ]
        .filter(Boolean)
        .join("  "),
    );
  }
  console.log(`total=${rows.length}`);
}
