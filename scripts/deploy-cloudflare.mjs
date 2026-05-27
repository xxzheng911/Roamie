#!/usr/bin/env node
/**
 * Production deploy: build SPA + Worker, upload secrets, attach roamie.tw routes.
 *
 * Usage: node scripts/deploy-cloudflare.mjs
 *   or:  npm run deploy
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(label, cmd, args, env = process.env) {
  console.info(`\n[deploy] ${label}`);
  const result = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("sync .env → .dev.vars", "node", ["scripts/sync-dev-vars.mjs"]);
run("production build", "npm", ["run", "build"]);
run("upload Worker secrets", "npx", ["wrangler", "secret", "bulk", ".dev.vars"]);
run("deploy Worker (roamie + roamie.tw routes)", "npx", [
  "wrangler",
  "deploy",
  "--name",
  "roamie",
]);

console.info(`
[deploy] 完成。請驗證：
  curl -sI https://roamie.tw | head -3
  curl -sI https://roamie.tw/api/roamie | head -3

workers.dev（備援 origin）：
  https://roamie.vvbwb6bw52.workers.dev

iOS 請確認 .env 的 VITE_APP_ORIGIN=https://roamie.tw 後執行 npm run ios:release
`);
