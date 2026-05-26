#!/usr/bin/env node
/**
 * 確認 Capacitor live-reload 開發伺服器是否可連線（預設 :8080）。
 */
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

const rawUrl = readEnv("CAPACITOR_DEV_SERVER_URL") ?? "http://localhost:8080";
const url = rawUrl.replace(/\/$/, "");

async function main() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.ok || res.status === 404) {
      console.info(`[cap-dev-check] OK — ${url} 可連線`);
      process.exit(0);
    }
    console.error(`[cap-dev-check] ${url} 回應 HTTP ${res.status}`);
    process.exit(1);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[cap-dev-check] 無法連線 ${url} — ${msg}`);
    console.error("");
    console.error("Simulator 開發請先開終端執行：npm run dev");
    console.error("確認 dev 跑起來後再 Xcode Run；或改 bundled：npm run cap:sync:ios");
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

void main();
