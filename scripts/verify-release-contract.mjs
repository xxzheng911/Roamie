#!/usr/bin/env node
// Mutates only disposable copies of a real canonical build. No Wrangler/network calls.
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { openSync, closeSync, statSync } from "node:fs";
import vm from "node:vm";
import { loadPublicClientEnv } from "./public-client-env.mjs";
import { RECEIPT, hashArtifacts, verifyReleaseArtifacts } from "./verify-release-artifacts.mjs";

const repo = resolve(import.meta.dirname, "..");
const isolated = process.argv[2] === "--build-paths" ? buildPaths() : null;
const source = isolated ?? (process.argv[2] ? resolve(process.argv[2]) : repo);
verifyReleaseArtifacts(source);
const root = mkdtempSync(join(tmpdir(), "roamie-release-contract-regression-"));
cpSync(resolve(source, "dist"), resolve(root, "dist"), { recursive: true });
mkdirSync(resolve(root, "scripts"));
for (const name of ["verify-release-artifacts.mjs", "release-worker-upload.mjs"])
  cpSync(resolve(repo, "scripts", name), resolve(root, "scripts", name));
symlinkSync(resolve(repo, "node_modules"), resolve(root, "node_modules"), "dir");
const receiptPath = resolve(root, RECEIPT),
  baseline = readFileSync(receiptPath);
const receipt = JSON.parse(baseline),
  entry = receipt.clientEntry;
const manifest = receipt.requiredArtifacts.find((p) => p.includes("_tanstack-start-manifest_v-"));
let passed = 0;
function pass(name) {
  console.info("PASS " + name);
  passed++;
}
function rewriteHashes() {
  const r = JSON.parse(baseline);
  r.hashes = hashArtifacts(root);
  writeFileSync(receiptPath, JSON.stringify(r, null, 2));
}
function corruption(name, file, change, expected, rehash = true) {
  const p = resolve(root, file),
    before = existsSync(p) ? readFileSync(p) : null;
  try {
    if (change === null) rmSync(p);
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, change(before?.toString() ?? ""));
    }
    if (rehash) rewriteHashes();
    assert.throws(() => verifyReleaseArtifacts(root), expected, name);
    pass(name);
  } finally {
    if (before === null) rmSync(p, { force: true });
    else writeFileSync(p, before);
    writeFileSync(receiptPath, baseline);
  }
}
try {
  verifyReleaseArtifacts(root);
  pass("A canonical npm-build artifact");
  const diagnosticMarkers=["timeline_normalization_failures","failed_entry_time","candidate_slots_evaluated","rejected_order","rejected_used","rejected_closed","rejected_window","sanitizeNormalizationFailures","serializeNormalizationFailures"];
  for (const marker of diagnosticMarkers) {
    corruption("server diagnostic client boundary: " + marker,"dist/client/assets/leak.js",()=>`console.log("${marker}")`,/Secret\/leakage/);
  }

  corruption("B missing index", "dist/client/index.html", null, /missing artifact/);
  corruption(
    "C missing bootstrap",
    "dist/client/assets/capacitor-bootstrap.js",
    null,
    /missing artifact/,
  );
  corruption(
    "D bootstrap wrong entry",
    "dist/client/assets/capacitor-bootstrap.js",
    (s) => s.replace(basenameEntry(entry), "wrong-entry.js"),
    /bootstrap does not import/,
  );
  corruption(
    "E manifest points to missing entry",
    manifest,
    (s) => s.replace(/clientEntry:\s*"[^"]+"/, 'clientEntry:"/assets/missing.js"'),
    /missing artifact/,
  );
  corruption(
    "F real hydrateRoot(document), despite createRoot comment",
    entry,
    (s) =>
      s + '\nReact.hydrateRoot(document, null); // createRoot(document.getElementById("root"))',
    /untransformed/,
  );
  corruption(
    "G missing root error handler",
    entry,
    (s) => s.replaceAll("onUncaughtError", "unusedHandler"),
    /root error handler/,
  );
  corruption(
    "G missing real render fallback despite marker elsewhere",
    entry,
    (s) => s.replace(/fallback:/g, "unusedFallback:"),
    /Suspense splash fallback/,
  );
  corruption(
    "G missing boot patch",
    entry,
    (s) => s.replaceAll("MAIN_TSX_LOADED", "REMOVED"),
    /client boot patch/,
  );
  for (const mode of [
    "npm run ios:sim",
    "Ultra minimal HTML test",
    "連線開發伺服器中",
    "ROAMIE_MINIMAL_BOOT enabled",
  ]) {
    corruption(
      "H reject diagnostic " + mode,
      "dist/client/index.html",
      (s) => s + "<!--" + mode + "-->",
      /diagnostic\/placeholder/,
    );
  }
  corruption(
    "H live reload script rejected",
    "dist/client/index.html",
    (s) => s + '<script type="module" src="http://localhost:5173/@vite/client"></script>',
    /remote\/live-reload/,
  );
  corruption("I receipt missing", RECEIPT, null, /receipt missing/, false);
  corruption(
    "J stale artifact hash",
    entry,
    (s) => s + "\n// after receipt\n",
    /receipt.*mismatch/,
    false,
  );
  corruption(
    "K edited receipt cannot bless mismatched artifact",
    RECEIPT,
    (s) => {
      const r = JSON.parse(s);
      r.hashes[entry] = "0".repeat(64);
      return JSON.stringify(r);
    },
    /receipt.*mismatch/,
    false,
  );
  corruption(
    "L secret scan independent of receipt",
    "dist/client/assets/leak.js",
    () => 'const secret="sk-' + "x".repeat(30) + '";',
    /Secret\/leakage/,
  );
  corruption(
    "M server-only client leakage independent of receipt",
    "dist/client/assets/leak.js",
    () => 'const binding="ABUSE_GUARD_ANALYTICS";',
    /Secret\/leakage/,
  );
  corruption(
    "M privileged JWT rejected",
    "dist/client/assets/leak.js",
    () =>
      'const jwt="' +
      [
        Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
        Buffer.from(JSON.stringify({ role: "service_role", padding: "x".repeat(30) })).toString(
          "base64url",
        ),
        "x".repeat(32),
      ].join(".") +
      '";',
    /forbidden JWT/,
  );
  corruption(
    "missing referenced lazy chunk",
    "dist/client/assets/capacitor-bootstrap.js",
    (s) => s + '\nimport("./missing-lazy.js");',
    /referenced asset/,
  );
  corruption(
    "missing Worker dependency even with refreshed hashes",
    "dist/server/index.js",
    (s) => s + '\nimport "./assets/absent-worker-module.js";',
    /referenced asset/,
  );
  corruption("missing Worker entry", "dist/server/index.js", null, /missing artifact/);
  corruption(
    "wrong upload asset source",
    "dist/server/wrangler.json",
    (s) => {
      const c = JSON.parse(s);
      c.assets.directory = "../../other";
      return JSON.stringify(c);
    },
    /assets must target/,
  );
  corruption("missing manifest", manifest, null, /one client manifest/);
  corruption(
    "receipt extra absolute path rejected",
    RECEIPT,
    (s) => {
      const r = JSON.parse(s);
      r.localPath = "/private/tmp/private";
      return JSON.stringify(r);
    },
    /receipt.*mismatch/,
    false,
  );
  const gate = spawnSync(
    process.execPath,
    [resolve(root, "scripts/release-worker-upload.mjs"), "--verify-only"],
    { encoding: "utf8" },
  );
  assert.equal(gate.status, 0);
  pass("upload gate valid artifact, no Wrangler invocation");
  rmSync(receiptPath);
  const badGate = spawnSync(
    process.execPath,
    [resolve(root, "scripts/release-worker-upload.mjs"), "--verify-only"],
    { encoding: "utf8" },
  );
  assert.equal(badGate.status, 1);
  assert.match(badGate.stderr, /receipt missing/);
  pass("upload gate rejects missing postbuild receipt");
  writeFileSync(receiptPath, baseline);
  cpSync(resolve(root, "dist/client"), resolve(root, "ios/App/App/public"), { recursive: true });
  verifyReleaseArtifacts(root);
  pass("copied iOS public bundle remains compatible");
  const lifecycle = JSON.parse(readFileSync(resolve(repo, "package.json"), "utf8")).scripts;
  assert.match(lifecycle.build, /sync-app-bundle-meta.*production-build/);
  assert.match(lifecycle.postbuild, /capacitor-prepare.*verify-release-artifacts/);
  const calls = [];
  const ios = readFileSync(resolve(repo, "scripts/ios-release-build.mjs"), "utf8")
    .replace(/^import .*;$/gm, "")
    .replace(
      'const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");',
      'const root = "/isolated";',
    );
  vm.runInNewContext(ios, {
    process: {
      env: {},
      exit() {
        throw Error("unexpected iOS exit");
      },
    },
    console: { info() {} },
    spawnSync(cmd, args, options) {
      calls.push({ cmd, args, options });
      return { status: 0 };
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls.map((x) => [x.cmd, ...x.args]))), [
    ["npm", "run", "build"],
    ["node", "scripts/cap-sync-ios.mjs", "bundled"],
    ["node", "scripts/ensure-ios-bundled-config.mjs"],
    ["node", "scripts/verify-ios-prereqs.mjs"],
  ]);
  assert.equal(calls[0].options.env.VITE_FEATURE_CREDITS_ENABLED, "0");
  pass("iOS release orchestration still npm build then bundled cap sync; native commands mocked");
  const hashes = hashArtifacts(root);
  assert.deepEqual(Object.keys(hashes), Object.keys(hashes).sort());
  assert.ok(!(RECEIPT in hashes));
  pass("deterministic hashes exclude receipt");
  const empty = mkdtempSync(join(tmpdir(), "roamie-missing-artifacts-"));
  try {
    assert.throws(() => verifyReleaseArtifacts(empty), /missing artifact directory/);
    pass("absent roots fail closed");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  console.info(`Release contract: ${passed} checks PASS`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
function basenameEntry(p) {
  return p.slice(p.lastIndexOf("/") + 1);
}

function buildPaths() {
  const isolated = mkdtempSync(join(tmpdir(), "roamie-build-paths-"));
  // Copy tracked source, including current edits, without git state or local secret files.
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repo })
    .toString()
    .split("\0")
    .filter(Boolean);
  for (const file of new Set([
    ...tracked,
    "scripts/release-worker-upload.mjs",
    "scripts/verify-release-contract.mjs",
  ])) {
    const from = resolve(repo, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(resolve(isolated, file)), { recursive: true });
    cpSync(from, resolve(isolated, file));
  }
  symlinkSync(resolve(repo, "node_modules"), resolve(isolated, "node_modules"), "dir");
  const env = {
    ...process.env,
    ...loadPublicClientEnv(repo),
    CAPACITOR_LIVE_RELOAD: "0",
    CAPACITOR_USE_REMOTE_SERVER: "0",
    ROAMIE_MINIMAL_BOOT: "0",
    ROAMIE_ULTRA_MINIMAL_HTML: "0",
    ROAMIE_QUIET_BOOT: "1",
    WRANGLER_SEND_METRICS: "false",
  };
  for (const [name, args, expected] of [
    ["intermediate", ["node", "scripts/production-build.mjs"], 0],
    ["intermediate-verifier-rejected", ["node", "scripts/verify-release-artifacts.mjs"], 1],
    [
      "intermediate-upload-gate-rejected",
      ["node", "scripts/release-worker-upload.mjs", "--verify-only"],
      1,
    ],
    ["canonical", ["npm", "run", "build"], 0],
    ["canonical-upload-gate", ["node", "scripts/release-worker-upload.mjs", "--verify-only"], 0],
    ["repeat-prepare", ["node", "scripts/capacitor-prepare.mjs"], 0],
    ["repeat-verifier", ["node", "scripts/verify-release-artifacts.mjs"], 0],
  ]) {
    const log = join(isolated, name + ".log"),
      fd = openSync(log, "w");
    const result = spawnSync(args[0], args.slice(1), {
      cwd: isolated,
      env,
      stdio: ["ignore", fd, fd],
    });
    closeSync(fd);
    assert.equal(result.status, expected, name + " failed; local log: " + log);
    console.info("PASS build path: " + name);
  }
  console.info("Isolated artifact retained for review: " + isolated);
  return isolated;
}
