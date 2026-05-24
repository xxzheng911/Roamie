#!/usr/bin/env node
/**
 * Post-build step for Capacitor:
 * - Ensures dist/client/index.html exists (TanStack Start SSR build omits it)
 * - Validates CAPACITOR_SERVER_URL for native TestFlight builds
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = resolve(root, "dist/client");
const indexPath = resolve(clientDir, "index.html");
const envPath = resolve(root, ".env");

function readEnv(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(envPath)) return undefined;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() === key) {
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      return val;
    }
  }
  return undefined;
}

if (!existsSync(clientDir)) {
  console.error("[capacitor-prepare] dist/client not found — run npm run build first");
  process.exit(1);
}

writeFileSync(
  indexPath,
  `<!DOCTYPE html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#f7f4ef" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <title>Roamie</title>
    <style>
      html, body {
        margin: 0;
        height: 100%;
        background: #f7f4ef;
        color: #2a2520;
        font-family: system-ui, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .wrap { text-align: center; padding: 2rem; max-width: 20rem; }
      p { margin: 0.5rem 0; line-height: 1.5; }
      .muted { font-size: 0.8125rem; color: #6b635c; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <p>Roamie</p>
      <p class="muted">正在連線…</p>
    </div>
  </body>
</html>
`,
  "utf8",
);

console.info("[capacitor-prepare] Wrote", indexPath);

const serverUrl = readEnv("CAPACITOR_DEV_SERVER_URL") ?? readEnv("CAPACITOR_SERVER_URL") ?? readEnv("VITE_APP_ORIGIN");
if (serverUrl) {
  console.info("[capacitor-prepare] Live server URL:", serverUrl);
} else {
  console.warn(
    "[capacitor-prepare] No CAPACITOR_DEV_SERVER_URL or CAPACITOR_SERVER_URL set. " +
      "iOS will load bundled placeholder HTML only.",
  );
}
