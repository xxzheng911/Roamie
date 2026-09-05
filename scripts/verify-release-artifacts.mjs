#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const roots = [resolve(root, "dist"), resolve(root, "ios/App/App/public")].filter(existsSync);
const forbiddenFiles = new Set([".env", ".env.local", ".dev.vars"]);
const secretValuePatterns = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
];
const clientSecretNamePatterns = [
  /\bSUPABASE_SERVICE_ROLE_KEY\b/g,
  /\bOPENAI_API_KEY\s*=/g,
  /\bGOOGLE_MAPS_API_KEY\s*=/g,
];
const failures = [];

function scanJwtRoles(path, text) {
  const jwtPattern = /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g;
  for (const token of text.match(jwtPattern) ?? []) {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      // Supabase anon JWTs are public client credentials. Privileged/unknown JWTs are not.
      if (payload.role !== "anon") failures.push(`${path}: forbidden JWT role ${payload.role ?? "unknown"}`);
    } catch {
      failures.push(`${path}: malformed or unknown JWT credential`);
    }
  }
}

function scan(path) {
  const info = statSync(path);
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) scan(join(path, name));
    return;
  }
  if (forbiddenFiles.has(basename(path))) failures.push(`${path}: forbidden secret file`);
  if (info.size > 15_000_000) return;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  const clientArtifact = path.includes("/dist/client/") || path.includes("/ios/App/App/public/");
  if (clientArtifact) scanJwtRoles(path, text);
  for (const pattern of clientArtifact
    ? [...secretValuePatterns, ...clientSecretNamePatterns]
    : secretValuePatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) failures.push(`${path}: matched ${pattern.source}`);
  }
}

for (const path of roots) scan(path);
if (failures.length) {
  console.error("[release-artifacts] Secret scan failed:\n" + failures.join("\n"));
  process.exit(1);
}
console.info(`[release-artifacts] OK (${roots.length} artifact roots scanned)`);
