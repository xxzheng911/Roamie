import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

// Execute the actual CLI, replacing subprocess/filesystem boundaries. Never contacts Cloudflare.
const source = fs.readFileSync(new URL("./release-worker-upload.mjs", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replaceAll("import.meta.dirname", '"/repo/scripts"');
const config = {
  name: "roamie", vars: {},
  durable_objects: { bindings: [{ name: "ABUSE_GUARD", class_name: "AbuseGuard" }, { name: "VISUAL_CROSSING_CLIMATE", class_name: "VisualCrossingClimate" }] },
  migrations: [{ tag: "v1-abuse-guard", new_sqlite_classes: ["AbuseGuard"] }, { tag: "v2-visual-crossing-climate", new_sqlite_classes: ["VisualCrossingClimate"] }],
  analytics_engine_datasets: [{ binding: "ABUSE_GUARD_ANALYTICS", dataset: "ABUSE_GUARD_ANALYTICS" }],
  ratelimits: [{ name: "GOOGLE_API_RATE_LIMITER", namespace_id: "1001", simple: { limit: 120, period: 60 } }],
  version_metadata: { binding: "WORKER_VERSION_METADATA" },
};
const bindings = [
  { name: "ABUSE_GUARD_ENFORCEMENT", type: "plain_text", text: "true" },
  { name: "GOOGLE_GLOBAL_DAILY_UNITS", type: "plain_text", text: "100000" },
  { name: "VISUAL_CROSSING_ENABLED", type: "plain_text", text: "false" },
  { name: "VISUAL_CROSSING_API_KEY", type: "secret_text" },
  { name: "EXISTING_SECRET", type: "secret_text" },
  { name: "ABUSE_GUARD", type: "durable_object_namespace", class_name: "AbuseGuard", namespace_id: "old" },
  { name: "VISUAL_CROSSING_CLIMATE", type: "durable_object_namespace", class_name: "VisualCrossingClimate", namespace_id: "new" },
  { name: "ABUSE_GUARD_ANALYTICS", type: "analytics_engine", dataset: "ABUSE_GUARD_ANALYTICS" },
  { name: "GOOGLE_API_RATE_LIMITER", type: "ratelimit", namespace_id: "1001", simple: { limit: 120, period: 60 } },
  { name: "WORKER_VERSION_METADATA", type: "version_metadata" },
];
function run(args = [], options = {}) {
  const calls = [], logs = [];
  let deployed = false;
  const process = { argv: ["node", "script", ...args], env: {}, exitCode: 0 };
  vm.runInNewContext(source, {
    process, resolve, isDeepStrictEqual, console: { info: x => logs.push(x), error: x => logs.push(x) },
    readFileSync: () => JSON.stringify(options.config ?? config),
    verifyReleaseArtifacts: () => { if (options.invalidArtifact) throw Error("bad receipt"); },
    spawnSync: (_bin, argv, opts) => {
      calls.push({ argv, opts });
      if (argv[1] === "upload" || argv[0] === "deploy") {
        if (!argv.includes("--dry-run") && !options.deployFailure) deployed = true;
        return { status: options.deployFailure ? 1 : 0, stdout: "SECRET_MUST_NOT_BE_LOGGED" };
      }
      const after = deployed && options.after;
      if (options.failedRead) return { status: 1, stderr: "SECRET_MUST_NOT_BE_LOGGED" };
      const data = argv[0] === "deployments" ? [{ created_on: "2026-10-10", versions: [{ version_id: after?.active ?? options.active ?? "active", percentage: options.percentage ?? 100 }] }]
        : argv[1] === "list" ? [{ id: options.newest ?? after?.active ?? options.active ?? "active", metadata: { created_on: "2026-10-10" } }]
        : { resources: { script_runtime: { migration_tag: after?.migrationTag ?? options.migrationTag ?? "v1-abuse-guard" }, bindings: after?.bindings ?? options.bindings ?? bindings } };
      return { status: 0, stdout: JSON.stringify(data) };
    },
  });
  return { calls, logs, code: process.exitCode };
}
for (const args of [[], ["--preserve-vars"], ["--tag", "candidate", "--message", "reviewed"]]) {
  const r = run(args); assert.equal(r.code, 0);
  const upload = r.calls.at(-1);
  assert.ok(upload.argv.includes("--keep-vars=true"));
  assert.ok(!upload.argv.includes("--var"));
  assert.equal(upload.opts.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, "false");
}
assert.equal(run(["--verify-only"]).calls.length, 0);
assert.equal(run([], { config: { ...config, exports: {}, migrations: config.migrations.map(m => ({ ...m, deleted_classes: [] })) } }).code, 0);
const readonly = run(["--preflight-only"]); assert.equal(readonly.code, 0);
assert.ok(readonly.calls.every(c => c.argv[1] !== "upload"));
const fail = (args, options) => {
  const r = run(args, options); assert.equal(r.code, 1);
  assert.ok(r.calls.every(c => c.argv[1] !== "upload" && c.argv[0] !== "deploy"));
  assert.ok(!r.logs.join().includes("SECRET_MUST_NOT_BE_LOGGED"));
};
fail(["--enforcement"]); fail(["--keep-vars=false"]); fail(["--config", "other"]);
fail([], { invalidArtifact: true }); fail([], { failedRead: true });
fail([], { newest: "unreviewed-upload" }); fail([], { percentage: 50 });
fail([], { config: { ...config, vars: { ANY: "override" } } });
fail([], { config: { ...config, unsafe: { bindings: [{ name: "SECRET" }] } } });
for (const name of ["VISUAL_CROSSING_API_KEY", "VISUAL_CROSSING_ENABLED", "VISUAL_CROSSING_CLIMATE"]) {
  fail([], { bindings: bindings.filter(b => b.name !== name) });
}
for (const name of ["VISUAL_CROSSING_ENABLED", "ABUSE_GUARD_ENFORCEMENT", "GOOGLE_GLOBAL_DAILY_UNITS"]) {
  fail([], { bindings: bindings.map(b => b.name === name ? { ...b, text: "incorrect" } : b) });
}
fail([], { config: { ...config, ratelimits: [] } });
fail([], { config: { ...config, exports: { Future: { type: "durable-object" } } } });
fail([], { config: { ...config, analytics_engine_datasets: [...config.analytics_engine_datasets, { binding: "EXISTING_SECRET", dataset: "wrong" }] } });
fail([], { config: { ...config, migrations: [...config.migrations, { tag: "v3", deleted_classes: ["AbuseGuard"] }] } });
fail([], { config: { ...config, migrations: [...config.migrations, { tag: "v3", new_sqlite_classes: ["UnboundNewClass"] }] } });
fail([], { bindings: [...bindings, { name: "UNREVIEWED_RESOURCE", type: "kv_namespace" }] });
console.log("PASS uploader: mandatory vars preservation, no overrides, read-only preflight, secret-safe errors, existing bindings, disabled feature, unapplied migrations blocked. No Cloudflare writes.");

const active = "77b8401e-9dc7-493c-bf45-ecdc0d15a193";
const first = ["--first-climate-migration", "--expected-active", active];
const unprovisioned = { active, bindings: bindings.filter(b => b.name !== "VISUAL_CROSSING_CLIMATE") };
const dry = run([...first, "--dry-run"], unprovisioned);
assert.equal(dry.code, 0, dry.logs.join());
assert.equal(dry.calls.at(-1).argv[0], "deploy");
assert.ok(dry.calls.at(-1).argv.includes("--dry-run"));
assert.ok(dry.calls.at(-1).argv.includes("--keep-vars=true"));
assert.equal(dry.calls.at(-1).opts.stdio, "pipe");
assert.equal(dry.calls.at(-1).opts.env.CLOUDFLARE_ACCOUNT_ID, "cb1835ce26e88097148685b0b1569bc3");
assert.ok(!dry.logs.join().includes("SECRET_MUST_NOT_BE_LOGGED"));
assert.equal(run([...first, "--preflight-only"], unprovisioned).code, 0);
fail(["--first-climate-migration"], unprovisioned);
fail([...first, "--verify-only"], unprovisioned);
fail(first, { ...unprovisioned, active: "changed" });
fail(first, { ...unprovisioned, migrationTag: "v0" });
fail(first, { active }); // Already provisioned.
fail(first, { ...unprovisioned, config: { ...config, migrations: config.migrations.slice(1) } });
fail(first, { ...unprovisioned, config: { ...config, account_id: "wrong-account" } });
fail(first, { ...unprovisioned, config: { ...config, durable_objects: { bindings: config.durable_objects.bindings.slice(1) } } });
fail(first, { ...unprovisioned, bindings: unprovisioned.bindings.map(b => b.name === "VISUAL_CROSSING_ENABLED" ? { name: b.name, type: "secret_text" } : b) });
fail(first, { ...unprovisioned, config: { ...config, migrations: [...config.migrations, { tag: "extra", new_sqlite_classes: ["Other"] }] } });
const failedDeploy = run(first, { ...unprovisioned, deployFailure: true });
assert.equal(failedDeploy.code, 1);
assert.equal(failedDeploy.calls.filter(c => c.argv[0] === "deploy").length, 1);
assert.ok(!failedDeploy.logs.join().includes("SECRET_MUST_NOT_BE_LOGGED"));
console.log("PASS first migration: exact additive history, active-version/account pinning, OFF plaintext gate, existing resources, dry-run deploy selection, sanitized failures, no retry. All subprocesses mocked.");

const after = { active: "new-version", migrationTag: "v2-visual-crossing-climate", bindings };
const migrated = run(first, { ...unprovisioned, after });
assert.equal(migrated.code, 0, migrated.logs.join());
assert.equal(migrated.calls.filter(c => c.argv[0] === "deploy").length, 1);
for (const changed of [
  { ...after, migrationTag: "wrong" },
  { ...after, bindings: bindings.map(b => b.name === "ABUSE_GUARD" ? { ...b, namespace_id: "replaced" } : b) },
  { ...after, bindings: bindings.filter(b => b.name !== "EXISTING_SECRET") },
  { ...after, bindings: bindings.map(b => b.name === "GOOGLE_GLOBAL_DAILY_UNITS" ? { ...b, text: "200000" } : b) },
]) {
  const r = run(first, { ...unprovisioned, after: changed });
  assert.equal(r.code, 1);
  assert.equal(r.calls.filter(c => c.argv[0] === "deploy").length, 1); // Never retry/rollback automatically.
}
console.log("PASS migration postconditions: tag, active version, unchanged namespace IDs/secrets/budgets; failures stop without retry or automatic rollback.");
