#!/usr/bin/env node
/**
 * Build-time Supabase env validation + optional DNS check.
 * Usage: node scripts/supabase-env-check.mjs [--dns] [--bundle-dir dist/client/assets]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lookup } from "node:dns/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
const checkDns = process.argv.includes("--dns");
const bundleDirArg = process.argv.find((a) => a.startsWith("--bundle-dir="));
const bundleDir = bundleDirArg
  ? resolve(root, bundleDirArg.split("=")[1])
  : resolve(root, "dist/client/assets");

function readEnvFile() {
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function pickEnv(parsed) {
  const urlRaw = (process.env.VITE_SUPABASE_URL ?? parsed.VITE_SUPABASE_URL ?? "").trim();
  const keyRaw = (process.env.VITE_SUPABASE_ANON_KEY ?? parsed.VITE_SUPABASE_ANON_KEY ?? "").trim();
  if (!keyRaw && (parsed.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    console.error(
      "[SUPABASE_ENV_CHECK] Found VITE_SUPABASE_PUBLISHABLE_KEY — rename/copy to VITE_SUPABASE_ANON_KEY in .env",
    );
  }
  const url = urlRaw.replace(/\/(rest|auth)\/v1\/?$/i, "").replace(/\/$/, "");
  let urlHost = null;
  let urlIssue = null;
  if (!url || url === "undefined") urlIssue = "missing_url";
  else {
    try {
      const u = new URL(url);
      urlHost = u.hostname;
      if (u.protocol !== "https:") urlIssue = `non_https`;
      else if (urlHost === "localhost" || urlHost === "127.0.0.1") urlIssue = "localhost";
      else if (urlHost === "placeholder.supabase.co") urlIssue = "placeholder";
      else if (!/\.supabase\.co$/i.test(urlHost)) urlIssue = `unexpected_host`;
    } catch {
      urlIssue = "invalid_url";
    }
  }
  let keyIssue = null;
  if (!keyRaw || keyRaw === "undefined") keyIssue = "missing_anon_key";
  else if (keyRaw.length < 20) keyIssue = "anon_key_too_short";

  return {
    hasUrl: Boolean(url && !urlIssue?.startsWith("missing")),
    urlHost,
    hasAnonKey: Boolean(keyRaw && !keyIssue),
    anonKeyPrefix: keyRaw ? keyRaw.slice(0, 8) : null,
    urlIssue,
    keyIssue,
    url,
    keyLen: keyRaw.length,
  };
}

function scanBundleForHost(host) {
  if (!host || !existsSync(bundleDir)) {
    return { scanned: false, found: false, files: [] };
  }
  const hits = [];
  for (const name of readdirSync(bundleDir)) {
    if (!/\.(js|mjs|css)$/i.test(name)) continue;
    const text = readFileSync(join(bundleDir, name), "utf8");
    if (text.includes(host)) hits.push(name);
  }
  return { scanned: true, found: hits.length > 0, files: hits.slice(0, 8) };
}

const parsed = readEnvFile();
const snapshot = pickEnv(parsed);
console.info(`[SUPABASE_ENV_CHECK] ${JSON.stringify({
  hasUrl: snapshot.hasUrl,
  urlHost: snapshot.urlHost,
  hasAnonKey: snapshot.hasAnonKey,
  anonKeyPrefix: snapshot.anonKeyPrefix,
  urlIssue: snapshot.urlIssue,
  keyIssue: snapshot.keyIssue,
})}`);

if (snapshot.urlIssue || snapshot.keyIssue) {
  console.error(
    "[SUPABASE_ENV_CHECK] FAILED — fix .env (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)",
  );
  process.exit(1);
}

if (checkDns && snapshot.urlHost) {
  try {
    await lookup(snapshot.urlHost);
    console.info(`[SUPABASE_ENV_CHECK] dns_ok host=${snapshot.urlHost}`);
  } catch (e) {
    console.error(
      `[SUPABASE_ENV_CHECK] dns_failed host=${snapshot.urlHost} — Dashboard Project URL may differ from .env`,
    );
    process.exit(1);
  }
}

const bundle = scanBundleForHost(snapshot.urlHost);
if (bundle.scanned) {
  console.info(
    `[SUPABASE_ENV_CHECK] bundle_host=${bundle.found ? "present" : "MISSING"} files=${bundle.files.join(",") || "(none)"}`,
  );
  if (!bundle.found) {
    console.error(
      "[SUPABASE_ENV_CHECK] bundled JS does not contain urlHost — run ROAMIE_CAPACITOR_BUILD=1 npm run build before cap sync",
    );
    process.exit(1);
  }
}
