#!/usr/bin/env node
/**
 * Syncs server secrets from .env → .dev.vars for Cloudflare Vite local dev.
 * Wrangler/Miniflare reads .dev.vars; stale dist/server/.dev.vars can override until rebuild.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
const devVarsPath = resolve(root, ".dev.vars");
const distDevVarsPath = resolve(root, "dist/server/.dev.vars");

const SERVER_KEYS = [
  "ROAMIE_QA_AUTH_ENABLED",
  "ROAMIE_QA_AUTH_SECRET",
  "UNSPLASH_ACCESS_KEY",
  "OPENAI_API_KEY",
  "OPENWEATHER_API_KEY",
  "EXPO_PUBLIC_OPENWEATHER_API_KEY",
  "VITE_OPENWEATHER_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
  "VITE_GOOGLE_MAPS_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function parseDotEnv(content) {
  const out = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
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

function quoteForDotenv(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes("`")) return `\`${value}\``;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

if (!existsSync(envPath)) {
  console.warn("[sync-dev-vars] No .env found at", envPath);
  process.exit(0);
}

const parsed = parseDotEnv(readFileSync(envPath, "utf8"));
const lines = [];
for (const key of SERVER_KEYS) {
  const value = parsed[key];
  if (value) lines.push(`${key}=${quoteForDotenv(value)}`);
}

if (!lines.length) {
  console.warn("[sync-dev-vars] No server keys found in .env");
  process.exit(0);
}

const body = lines.join("\n") + "\n";
writeFileSync(devVarsPath, body, "utf8");
console.info("[sync-dev-vars] Wrote", devVarsPath, `(${lines.length} keys)`);

if (existsSync(resolve(root, "dist/server"))) {
  mkdirSync(dirname(distDevVarsPath), { recursive: true });
  writeFileSync(distDevVarsPath, body, "utf8");
  console.info("[sync-dev-vars] Updated", distDevVarsPath);
}

if (parsed.OPENAI_API_KEY?.startsWith("sk-") && !parsed.OPENAI_API_KEY.includes("xxxx")) {
  console.info("[sync-dev-vars] OPENAI_API_KEY ok:", parsed.OPENAI_API_KEY.slice(0, 12) + "…");
} else {
  console.warn("[sync-dev-vars] OPENAI_API_KEY missing or still looks like a placeholder");
}
