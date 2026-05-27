#!/usr/bin/env node
/**
 * Read VITE_APP_ORIGIN from .env for iOS bundled / TestFlight builds.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function readEnvFile(name) {
  const path = resolve(root, name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function readViteAppOrigin() {
  const env = readEnvFile(".env");
  const raw = env.VITE_APP_ORIGIN?.trim();
  return raw ? raw.replace(/\/$/, "") : "";
}

export function isLocalhostOrigin(origin) {
  if (!origin) return false;
  try {
    const h = new URL(origin).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false;
  }
}

export function validateProductionAppOrigin(origin) {
  if (!origin) {
    return {
      ok: false,
      reason:
        "缺少 VITE_APP_ORIGIN。TestFlight 請在 .env 設定已部署的 HTTPS 網域（例如 https://roamie.example.com）後執行 npm run ios:release。",
    };
  }
  if (!/^https:\/\//i.test(origin)) {
    return {
      ok: false,
      reason: `VITE_APP_ORIGIN 必須為 HTTPS 網域，目前為：${origin}`,
    };
  }
  if (isLocalhostOrigin(origin)) {
    return {
      ok: false,
      reason: `VITE_APP_ORIGIN 不可為 localhost（實機無法連線），目前為：${origin}`,
    };
  }
  return { ok: true, origin };
}
