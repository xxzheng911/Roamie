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
  const process = { argv: ["node", "script", ...args], env: {}, exitCode: 0 };
  vm.runInNewContext(source, {
    process, resolve, isDeepStrictEqual, console: { info: x => logs.push(x), error: x => logs.push(x) },
    readFileSync: () => JSON.stringify(options.config ?? config),
    verifyReleaseArtifacts: () => { if (options.invalidArtifact) throw Error("bad receipt"); },
    spawnSync: (_bin, argv, opts) => {
      calls.push({ argv, opts });
      if (argv[1] === "upload") return { status: 0 };
      if (options.failedRead) return { status: 1, stderr: "SECRET_MUST_NOT_BE_LOGGED" };
      const data = argv[0] === "deployments" ? [{ created_on: "2026-10-10", versions: [{ version_id: "active", percentage: options.percentage ?? 100 }] }]
        : argv[1] === "list" ? [{ id: options.newest ?? "active", metadata: { created_on: "2026-10-10" } }]
        : { resources: { bindings: options.bindings ?? bindings } };
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
  assert.ok(r.calls.every(c => c.argv[1] !== "upload"));
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
