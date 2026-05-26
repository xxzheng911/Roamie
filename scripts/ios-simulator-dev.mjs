#!/usr/bin/env node
/**
 * iOS Simulator 開發一鍵準備：
 * 1. 確認 / 啟動 Vite dev (localhost:8080)
 * 2. cap sync ios（live reload）
 *
 * Roamie 為 TanStack Start SSR，Simulator 必須連 dev server，bundled 占位頁無法跑完整 App。
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");

function readEnv(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(envPath)) return undefined;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return undefined;
}

const devUrl = (readEnv("CAPACITOR_DEV_SERVER_URL") ?? "http://localhost:8080").replace(/\/$/, "");

async function canReachDevServer() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(devUrl, { signal: ctrl.signal });
    return res.ok || res.status === 404;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForDevServer(maxMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    if (await canReachDevServer()) return true;
    await sleep(1500);
  }
  return false;
}

function startDevServerDetached() {
  console.info("[ios:sim] 啟動 npm run dev（背景）…");
  const child = spawn("npm", ["run", "dev"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  child.unref();
}

async function main() {
  console.info(`[ios:sim] 目標 dev server：${devUrl}`);

  if (!(await canReachDevServer())) {
    let portBusy = false;
    try {
      portBusy = Boolean(
        execSync("lsof -nP -iTCP:8080 -sTCP:LISTEN 2>/dev/null", { encoding: "utf8" }).trim(),
      );
    } catch {
      portBusy = false;
    }
    if (portBusy) {
      console.warn(
        "[ios:sim] port 8080 已被佔用 — 若 npm run dev 失敗，代表 dev 已在背景跑著，不必再開一次",
      );
    } else {
      startDevServerDetached();
    }
    console.info("[ios:sim] 等待 dev server 就緒（最多 90 秒）…");
    if (!(await waitForDevServer())) {
      console.error(`[ios:sim] 無法連線 ${devUrl}`);
      console.error("請手動在終端執行 npm run dev，確認出現 Local: http://localhost:8080 後再跑 npm run ios:sim");
      process.exit(1);
    }
  } else {
    console.info("[ios:sim] dev server 已在運行");
  }

  const sync = spawnSync("node", ["scripts/cap-sync-ios.mjs", "dev"], {
    cwd: root,
    env: { ...process.env, CAPACITOR_LIVE_RELOAD: "1" },
    stdio: "inherit",
  });

  if (sync.status !== 0) process.exit(sync.status ?? 1);

  console.info("");
  console.info("✓ 準備完成。請在 Xcode：Product → Clean Build Folder，再 Run (⌘R)");
  console.info("  若仍顯示無法連線，確認 dev 終端仍在跑，且 ios/App/App/capacitor.config.json 的 server.url 為");
  console.info(`  ${devUrl}`);
}

void main();
