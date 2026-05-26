#!/usr/bin/env node
/**
 * Run `cap sync ios` with Capacitor env flags applied to every step
 * (npm `VAR=1 cmd1 && cmd2` only exports VAR to cmd1).
 *
 * Usage:
 *   node scripts/cap-sync-ios.mjs dev      # live reload → CAPACITOR_DEV_SERVER_URL
 *   node scripts/cap-sync-ios.mjs remote   # TestFlight → CAPACITOR_SERVER_URL
 *   node scripts/cap-sync-ios.mjs bundled  # local placeholder only (default cap sync)
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "bundled";

if (mode === "dev") {
  process.env.CAPACITOR_LIVE_RELOAD = "1";
  console.info(
    "[cap-sync-ios:dev] 需要本機 dev server — 請在另一終端先執行 npm run dev，再於 Xcode Run",
  );
} else if (mode === "remote") {
  process.env.CAPACITOR_USE_REMOTE_SERVER = "1";
} else if (mode !== "bundled") {
  console.error(`[cap-sync-ios] Unknown mode "${mode}" — use dev | remote | bundled`);
  process.exit(1);
}

function run(label, cmd, args) {
  console.info(`[cap-sync-ios:${mode}] ${label}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("prepare", "node", ["scripts/capacitor-prepare.mjs"]);
run("ios permissions", "node", ["scripts/sync-ios-permission-strings.mjs"]);
run("cap sync ios", "npx", ["cap", "sync", "ios"]);

if (mode === "bundled") {
  run("ensure bundled config", "node", ["scripts/ensure-ios-bundled-config.mjs"]);
}

if (mode === "dev") {
  const check = spawnSync("node", ["scripts/check-cap-dev-server.mjs"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (check.status !== 0) {
    console.warn(
      "[cap-sync-ios:dev] dev server 尚未就緒 — Xcode 會顯示「無法連線伺服器」直到 npm run dev 啟動",
    );
  }
}
