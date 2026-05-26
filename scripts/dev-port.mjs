#!/usr/bin/env node
/**
 * 管理 Vite dev server 佔用的 8080 port。
 *   node scripts/dev-port.mjs status
 *   node scripts/dev-port.mjs stop
 */
import { execSync } from "node:child_process";

const PORT = 8080;
const action = process.argv[2] ?? "status";

function listListeners() {
  try {
    const out = execSync(`lsof -nP -iTCP:${PORT} -sTCP:LISTEN`, { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function pidFromLsof(text) {
  const line = text.split("\n").find((l) => l.includes("LISTEN"));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  return parts[1] ?? null;
}

async function isRoamieDevUp() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(`http://localhost:${PORT}/`, { signal: ctrl.signal });
    return res.ok || res.status === 404;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const listeners = listListeners();

  if (action === "status") {
    if (!listeners) {
      console.info(`[dev-port] port ${PORT} 空閒 — 可執行 npm run dev`);
      process.exit(0);
    }
    const pid = pidFromLsof(listeners);
    const up = await isRoamieDevUp();
    console.info(`[dev-port] port ${PORT} 已被佔用 (PID ${pid})`);
    console.info(listeners);
    if (up) {
      console.info(`[dev-port] http://localhost:${PORT} 可連線 — 不必再 npm run dev，直接 Xcode Run 或 npm run ios:sim`);
    } else {
      console.warn(`[dev-port] 8080 有程序但無法連線 Roamie dev — 可 npm run dev:stop 後重開`);
    }
    process.exit(up ? 0 : 1);
  }

  if (action === "stop") {
    if (!listeners) {
      console.info(`[dev-port] port ${PORT} 已是空閒`);
      process.exit(0);
    }
    const pid = pidFromLsof(listeners);
    if (!pid) {
      console.error("[dev-port] 無法解析 PID");
      process.exit(1);
    }
    try {
      process.kill(Number(pid), "SIGTERM");
      console.info(`[dev-port] 已停止 PID ${pid}`);
    } catch (e) {
      console.error("[dev-port] 停止失敗", e instanceof Error ? e.message : e);
      process.exit(1);
    }
    process.exit(0);
  }

  console.error(`[dev-port] 未知指令 "${action}" — 用 status | stop`);
  process.exit(1);
}

void main();
