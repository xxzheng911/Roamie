#!/usr/bin/env node
// The only repository entrypoint for uploading local production Worker artifacts.
// Historical versions deploy/rollback consumes remote versions, not local build output.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { verifyReleaseArtifacts } from "./verify-release-artifacts.mjs";

const root = resolve(import.meta.dirname, "..");
const configPath = resolve(root, "dist/server/wrangler.json");
const wrangler = resolve(root, "node_modules/.bin/wrangler");
const productionAccount = "cb1835ce26e88097148685b0b1569bc3";
const commandEnv = { ...process.env, CLOUDFLARE_ACCOUNT_ID: productionAccount, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" };

function readRemote(args) {
  const result = spawnSync(wrangler, [...args, "--config", configPath, "--json"], {
    cwd: root, encoding: "utf8", stdio: "pipe", env: commandEnv, timeout: 30_000,
  });
  // Never print raw CLI/API output: it may contain plaintext bindings.
  if (result.error || result.status !== 0) throw new Error("Read-only production preflight failed");
  try { return JSON.parse(result.stdout); }
  catch { throw new Error("Invalid production preflight response"); }
}

function productionPreflight(config, { firstMigration = false, expectedActive } = {}) {
  const deployments = readRemote(["deployments", "list"]);
  const latest = [...deployments].sort((a, b) => String(b.created_on).localeCompare(String(a.created_on)))[0];
  if (latest?.versions?.length !== 1 || latest.versions[0].percentage !== 100) {
    throw new Error("Preflight requires one active production version at 100%");
  }
  const activeId = latest.versions[0].version_id;
  if (expectedActive && activeId !== expectedActive) throw new Error("Active production version changed; review again");
  const versions = readRemote(["versions", "list"]);
  const newest = [...versions].sort((a, b) => String(b.metadata?.created_on).localeCompare(String(a.metadata?.created_on)))[0];
  if (newest?.id !== activeId) throw new Error("Latest uploaded version differs from active version; review inheritance before uploading");
  const live = readRemote(["versions", "view", activeId]);
  const bindings = live.resources?.bindings;
  if (!Array.isArray(bindings)) throw new Error("Production bindings unavailable");
  const byName = new Map(bindings.map(b => [b.name, b]));
  const failures = [];
  {
    const history = (config.migrations ?? []).map(m => Object.fromEntries(Object.entries(m).filter(([, v]) => v != null && (!Array.isArray(v) || v.length))));
    const expected = [
      { tag: "v1-abuse-guard", new_sqlite_classes: ["AbuseGuard"] },
      { tag: "v2-visual-crossing-climate", new_sqlite_classes: ["VisualCrossingClimate"] },
    ];
    if (!isDeepStrictEqual(history, expected)) failures.push("Release requires the exact additive climate migration history");
  }
  if (firstMigration) {
    if (live.resources?.script_runtime?.migration_tag !== "v1-abuse-guard") failures.push("Unexpected production migration tag");
    if (byName.has("VISUAL_CROSSING_CLIMATE")) failures.push("Climate binding already exists; use normal release flow");
    const climate = config.durable_objects?.bindings?.filter(b => b.name === "VISUAL_CROSSING_CLIMATE");
    if (climate?.length !== 1 || climate[0].class_name !== "VisualCrossingClimate" || climate[0].script_name || climate[0].environment) failures.push("Invalid local climate binding");
  }
  if (!firstMigration && live.resources?.script_runtime?.migration_tag !== "v2-visual-crossing-climate") failures.push("Normal upload requires existing v2 migration");
  const climateFlag = byName.get("VISUAL_CROSSING_ENABLED");
  if (climateFlag?.type !== "plain_text" || !["true", "false"].includes(climateFlag.text)) {
    failures.push("Production climate flag must be Text true or false");
  } else if (firstMigration && climateFlag.text !== "false") {
    failures.push("First climate migration requires feature OFF");
  }
  const expectedVars = { ABUSE_GUARD_ENFORCEMENT: "true", GOOGLE_GLOBAL_DAILY_UNITS: "100000" };
  for (const [name, value] of Object.entries(expectedVars)) {
    const binding = byName.get(name);
    if (binding?.type !== "plain_text" || binding.text !== value) failures.push(`Required production var does not match: ${name}`);
  }
  if (byName.get("VISUAL_CROSSING_API_KEY")?.type !== "secret_text") failures.push("Visual Crossing Worker Secret missing");
  const localNames = [
    ...(config.durable_objects?.bindings ?? []).map(b => b.name),
    ...(config.analytics_engine_datasets ?? []).map(b => b.binding),
    ...(config.ratelimits ?? []).map(b => b.name),
    config.version_metadata?.binding, config.assets?.binding,
  ].filter(Boolean);
  if (firstMigration && (new Set(localNames).size !== localNames.length || localNames.some(name => !byName.has(name) && name !== "VISUAL_CROSSING_CLIMATE"))) failures.push("Unexpected new or duplicate resource binding");
  for (const name of localNames) {
    if (["plain_text", "json", "secret_text", "secret_key"].includes(byName.get(name)?.type)) {
      failures.push(`Local resource would overwrite a preserved binding: ${name}`);
    }
  }
  // --keep-vars preserves plain_text/json; Wrangler versions upload always inherits secrets.
  // Other resources are NOT covered by --keep-vars and must match the live bindings.
  for (const b of bindings) {
    if (["plain_text", "json", "secret_text", "secret_key"].includes(b.type)) continue;
    let same = false;
    if (b.type === "durable_object_namespace") {
      const local = config.durable_objects?.bindings?.find(x => x.name === b.name);
      same = Boolean(local && local.class_name === b.class_name &&
        (local.script_name ?? config.name) === (b.script_name ?? config.name) &&
        (local.environment ?? null) === (b.environment ?? null));
    } else if (b.type === "analytics_engine") {
      same = config.analytics_engine_datasets?.some(x => x.binding === b.name && x.dataset === b.dataset);
    } else if (b.type === "ratelimit") {
      same = config.ratelimits?.some(x => x.name === b.name && String(x.namespace_id) === String(b.namespace_id) && isDeepStrictEqual(x.simple, b.simple));
    } else if (b.type === "version_metadata") same = config.version_metadata?.binding === b.name;
    else if (b.type === "assets") same = config.assets?.binding === b.name;
    if (!same) failures.push(`Binding removed, changed or unsupported: ${b.name}`);
  }
  for (const b of config.durable_objects?.bindings ?? []) {
    const remote = byName.get(b.name);
    if (firstMigration && b.name === "VISUAL_CROSSING_CLIMATE" && !remote) continue;
    if (remote?.type !== "durable_object_namespace" || !remote.namespace_id || remote.class_name !== b.class_name) {
      failures.push(`DO provisioning/migration required before versions upload: ${b.name}`);
    }
  }
  const liveClasses = new Set(bindings.filter(b => b.type === "durable_object_namespace").map(b => b.class_name));
  for (const migration of config.migrations ?? []) {
    for (const name of migration.new_sqlite_classes ?? []) {
      if (!liveClasses.has(name) && !(firstMigration && name === "VisualCrossingClimate")) failures.push(`Unprovisioned DO class in migration: ${name}`);
    }
  }
  // Do not allow lifecycle renames/deletions/transfers to sneak into a version upload.
  if (Object.keys(config.exports ?? {}).length || (config.migrations ?? []).some(m => Object.keys(m).some(k =>
    !["tag", "new_sqlite_classes"].includes(k) && m[k] != null && (!Array.isArray(m[k]) || m[k].length > 0)))) {
    failures.push("Unsupported DO lifecycle change; use a separately approved migration release");
  }
  if (failures.length) throw new Error(failures.join("; "));
  console.info(`[worker-release] PASS: production preflight, active=${activeId}, bindings=${bindings.length}; Visual Crossing=${climateFlag.text} (preserved)`);
  return { activeId, bindings };
}

try {
  const args = process.argv.slice(2),
    options = [];
  let verifyOnly = false,
    preflightOnly = false, firstMigration = false, expectedActive;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--first-climate-migration") firstMigration = true;
    else if (arg === "--expected-active") {
      expectedActive = args[++i];
      if (!/^[a-f0-9-]{36}$/.test(expectedActive ?? "")) throw new Error("Expected active version UUID required");
    }
    else if (arg === "--verify-only") verifyOnly = true;
    else if (arg === "--preflight-only") preflightOnly = true;
    else if (arg === "--enforcement") throw new Error("Production var overrides are forbidden");
    else if (arg === "--preserve-vars") { /* Compatibility alias: preservation is now mandatory. */ }
    else if (arg === "--dry-run") options.push(arg);
    else if (["--tag", "--message"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("Missing option value");
      options.push(arg, value);
    } else throw new Error("Unsupported upload option (artifact/config overrides forbidden)");
  }
  if (firstMigration && (!expectedActive || verifyOnly)) throw new Error("First migration requires --expected-active and production preflight");
  if (expectedActive && !firstMigration) throw new Error("--expected-active is only supported for first migration");
  if (firstMigration && options.includes("--tag")) throw new Error("Version tags are not supported for migration deploy");
  if (verifyOnly && preflightOnly) throw new Error("Choose artifact verification or production preflight");
  verifyReleaseArtifacts(root);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if ((config.account_id && config.account_id !== productionAccount) || config.name !== "roamie" || Object.keys(config.vars ?? {}).length > 0 || config.unsafe?.bindings?.length || config.secrets) {
    throw new Error("Production upload forbids worker overrides and local var/secret overrides");
  }
  if (verifyOnly) console.info("[worker-release] PASS: upload gate; no Wrangler invocation");
  else {
    const before = productionPreflight(config, { firstMigration, expectedActive });
    if (!preflightOnly) {
      const result = spawnSync(
        wrangler,
        [...(firstMigration ? ["deploy"] : ["versions", "upload"]), "--config", configPath, "--keep-vars=true", ...options],
        { cwd: root, stdio: "pipe", encoding: "utf8", env: commandEnv },
      );
      if (result.error) throw new Error("Wrangler could not start");
      process.exitCode = result.status ?? 1;
      if (!firstMigration) {
        // Upload output can contain plaintext binding values; never echo it.
        if (result.status !== 0) throw new Error("Worker upload failed; inspect versions before retry; raw output suppressed");
        if (!options.includes("--dry-run")) {
          const versions = readRemote(["versions", "list"]);
          const newest = [...versions].sort((a, b) => String(b.metadata?.created_on).localeCompare(String(a.metadata?.created_on)))[0];
          if (!newest?.id || newest.id === before.activeId) throw new Error("New uploaded version not found; do not switch traffic");
          const uploaded = readRemote(["versions", "view", newest.id]);
          if (uploaded.resources?.script_runtime?.migration_tag !== "v2-visual-crossing-climate") throw new Error("Uploaded migration tag changed; do not switch traffic");
          const current = new Map((uploaded.resources?.bindings ?? []).map(b => [b.name, b]));
          if (current.size !== before.bindings.length || before.bindings.some(b => !isDeepStrictEqual(current.get(b.name), b))) {
            throw new Error("Uploaded bindings/vars/secrets changed; do not switch traffic");
          }
          const active = readRemote(["deployments", "list"]);
          const latest = [...active].sort((a, b) => String(b.created_on).localeCompare(String(a.created_on)))[0];
          if (latest?.versions?.length !== 1 || latest.versions[0].version_id !== before.activeId || latest.versions[0].percentage !== 100) {
            throw new Error("Active production version changed during upload; do not switch traffic");
          }
          console.info(`[worker-release] PASS: uploaded=${newest.id}; all bindings and climate flag preserved; traffic unchanged`);
        }
      }
      if (firstMigration) {
        // Deploy output can include plaintext vars. Never echo it or automatically retry.
        if (result.status !== 0) throw new Error("Migration deploy failed; inspect live migration/version state before recovery; raw output suppressed");
        if (!options.includes("--dry-run")) {
          const after = productionPreflight(config);
          if (after.activeId === before.activeId) throw new Error("Migration deploy did not activate a new version");
          const current = new Map(after.bindings.map(b => [b.name, b]));
          if (before.bindings.some(b => !isDeepStrictEqual(current.get(b.name), b))) throw new Error("Post-deploy binding preservation check failed; manual compatible recovery required");
          const version = readRemote(["versions", "view", after.activeId]);
          if (version.resources?.script_runtime?.migration_tag !== "v2-visual-crossing-climate") throw new Error("Post-deploy migration tag mismatch");
          console.info("[worker-release] PASS: migration deployed; previous bindings preserved; feature OFF. DO storage health still requires separate verification.");
        } else console.info("[worker-release] PASS: migration dry-run only; no lifecycle changes applied");
      }
    }
  }
} catch (error) {
  console.error("[worker-release] FAIL: " + error.message);
  process.exitCode = 1;
}
