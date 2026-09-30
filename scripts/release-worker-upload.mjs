#!/usr/bin/env node
// The only repository entrypoint for uploading local production Worker artifacts.
// Historical versions deploy/rollback consumes remote versions, not local build output.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { verifyReleaseArtifacts } from "./verify-release-artifacts.mjs";

const root = resolve(import.meta.dirname, "..");
try {
  const args = process.argv.slice(2),
    options = [];
  let verifyOnly = false,
    enforcement = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--verify-only") verifyOnly = true;
    else if (arg === "--enforcement") enforcement = true;
    else if (arg === "--dry-run") options.push(arg);
    else if (["--tag", "--message"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("Missing option value");
      options.push(arg, value);
    } else throw new Error("Unsupported upload option (artifact/config overrides forbidden)");
  }
  verifyReleaseArtifacts(root);
  if (verifyOnly) console.info("[worker-release] PASS: upload gate; no Wrangler invocation");
  else {
    const result = spawnSync(
      resolve(root, "node_modules/.bin/wrangler"),
      [
        "versions",
        "upload",
        "--config",
        resolve(root, "dist/server/wrangler.json"),
        "--keep-vars=false",
        ...(enforcement ? ["--var", "ABUSE_GUARD_ENFORCEMENT:1"] : []),
        ...options,
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" },
      },
    );
    if (result.error) throw new Error("Wrangler could not start");
    process.exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error("[worker-release] FAIL: " + error.message);
  process.exitCode = 1;
}
