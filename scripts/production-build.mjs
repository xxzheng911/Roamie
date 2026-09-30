#!/usr/bin/env node
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadEnv } from "vite";
import {
  loadPublicClientEnv,
  validateRequiredPublicClientEnv,
} from "./public-client-env.mjs";
import {
  applyMapsClientBuildEnv,
  mapsClientModeFromArgv,
  resolveMapsClientInjection,
  writeMapsClientAuthority,
  writeMapsScriptQuery,
} from "./google-maps-client-authority.mjs";

// Intermediate Vite step only. Release authority is npm run build including postbuild.
const root = resolve(import.meta.dirname, "..");
const mapsClientMode = mapsClientModeFromArgv(process.argv);
rmSync(resolve(root, "dist/release-receipt.json"), { force: true });
const localSecretFiles = [".env", ".dev.vars"].map((name) => ({
  source: resolve(root, name),
  hidden: resolve(root, `${name}.release-hidden`),
}));
const emittedDevVars = resolve(root, "dist/server/.dev.vars");
const loadedEnv = loadEnv("production", root, "");
const mapsClientInjection = resolveMapsClientInjection(mapsClientMode, {
  ...loadedEnv,
  ...process.env,
});
const publicClientEnv = loadPublicClientEnv(root);
const missingPublicClientEnv = validateRequiredPublicClientEnv(publicClientEnv);

if (missingPublicClientEnv.length > 0) {
  throw new Error(
    `Missing required public client environment variable: ${missingPublicClientEnv.join(", ")}`,
  );
}

if (localSecretFiles.some(({ hidden }) => existsSync(hidden))) {
  throw new Error(
    "Refusing release build: stale release-hidden secret file must be resolved first",
  );
}

const hiddenFiles = localSecretFiles.filter(({ source }) => existsSync(source));
let mapsScriptQuery;
try {
  mapsScriptQuery = writeMapsScriptQuery(root, mapsClientInjection.mode);
  for (const { source, hidden } of hiddenFiles) renameSync(source, hidden);
  if (existsSync(emittedDevVars)) rmSync(emittedDevVars);
  const vite = resolve(root, "node_modules/.bin/vite");
  const buildEnv = { ...process.env, ...publicClientEnv };
  // Unsplash credentials are runtime server secrets. Never compile either name into the client.
  delete buildEnv.VITE_UNSPLASH_ACCESS_KEY;
  delete buildEnv.UNSPLASH_ACCESS_KEY;
  applyMapsClientBuildEnv(buildEnv, mapsClientInjection);
  const result = spawnSync(vite, ["build"], { cwd: root, stdio: "inherit", env: buildEnv });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if ((result.status ?? 1) === 0) writeMapsClientAuthority(resolve(root, "dist"), mapsClientInjection);
} finally {
  if (mapsScriptQuery) writeFileSync(mapsScriptQuery.path, mapsScriptQuery.previous);
  for (const { source, hidden } of hiddenFiles) {
    if (existsSync(hidden)) renameSync(hidden, source);
  }
}
