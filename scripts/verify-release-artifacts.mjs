#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, lstatSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { basename, dirname, join, relative, resolve } from "node:path";

const forbiddenFiles = new Set([".env", ".env.local", ".dev.vars"]);
const secretValuePatterns = [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g];
const clientSecretNamePatterns = [
  /\bSUPABASE_SERVICE_ROLE_KEY\b/g,
  /\bOPENAI_API_KEY\s*=/g,
  /\bGOOGLE_MAPS_API_KEY\s*=/g,
  /\bREVENUECAT_SECRET_API_KEY\s*=/g,
  /\bREVENUECAT_V2_SECRET_API_KEY\s*=/g,
  /\bREVENUECAT_WEBHOOK_AUTHORIZATION\s*=/g,
  /\bREVENUECAT_WEBHOOK_APP_ID\s*=/g,
  /\bPLACE_PHOTO_SIGNING_SECRET\s*=/g,
  /\bREVENUECAT_PROJECT_ID\s*=/g,
  /\bAPPLE_PRIVATE_KEY\b/g,
  /-----BEGIN PRIVATE KEY-----/g,
  /\b(?:timeline_normalization_failures|failed_entry_time|candidate_slots_evaluated|rejected_order|rejected_used|rejected_closed|rejected_window|sanitizeNormalizationFailures|serializeNormalizationFailures)\b/g,
  /\b(?:ABUSE_GUARD_ANALYTICS|WORKER_VERSION_METADATA|writeDataPoint|provider_attempt_without_guard)\b/g,
];
export const RECEIPT = "dist/release-receipt.json";

/** SHA-256 of the Unsplash access key that shipped in public client bundles. The key itself is not stored. */
export const RETIRED_UNSPLASH_ACCESS_KEY_SHA256 = Object.freeze([
  "b154eedf0629ded229de62e02ab8b50448e110b42728f6c1afba5141fdad7ded",
]);
const RETIRED_UNSPLASH_KEY_LENGTH = 43;
const unsplashClientLeakPatterns = [
  /\bVITE_UNSPLASH_ACCESS_KEY\b/,
  /\bUNSPLASH_ACCESS_KEY\b/,
  /api\.unsplash\.com\/search\/photos/,
  /api\.unsplash\.com\b/,
  /Authorization:\s*Client-ID/,
  /\bClient-ID\b/,
];

export function isClientReleaseArtifact(path) {
  return path.includes("/dist/client/") || path.includes("/ios/App/App/public/");
}

export function textHasRetiredUnsplashAccessKey(text) {
  const fingerprints = new Set(RETIRED_UNSPLASH_ACCESS_KEY_SHA256);
  const runs = text.match(/[A-Za-z0-9_-]{43,}/g) ?? [];
  for (const run of runs) {
    const last = run.length - RETIRED_UNSPLASH_KEY_LENGTH;
    const step = run.length <= 120 ? 1 : RETIRED_UNSPLASH_KEY_LENGTH;
    for (let index = 0; index <= last; index += step) {
      const digest = createHash("sha256")
        .update(run.slice(index, index + RETIRED_UNSPLASH_KEY_LENGTH))
        .digest("hex");
      if (fingerprints.has(digest)) return true;
    }
  }
  return false;
}

export function collectUnsplashLeakFailures(path, text) {
  const failures = [];
  if (isClientReleaseArtifact(path)) {
    for (const pattern of unsplashClientLeakPatterns) {
      if (pattern.test(text)) failures.push(`${path}: matched ${pattern.source}`);
    }
  }
  if (textHasRetiredUnsplashAccessKey(text)) {
    failures.push(`${path}: unsplash access key fingerprint`);
  }
  return failures;
}

export function verifyReleaseArtifacts(root, { requireReceipt = true } = {}) {
  const failures = [];

  function scanJwtRoles(path, text) {
    const jwtPattern = /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g;
    for (const token of text.match(jwtPattern) ?? []) {
      try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
        // Supabase anon JWTs are public client credentials. Privileged/unknown JWTs are not.
        if (payload.role !== "anon") failures.push(`${path}: forbidden JWT role`);
      } catch {
        failures.push(`${path}: malformed or unknown JWT credential`);
      }
    }
  }

  function scan(path) {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      failures.push(`${path}: symlink forbidden`);
      return;
    }
    if (info.isDirectory()) {
      for (const name of readdirSync(path)) scan(join(path, name));
      return;
    }
    if (forbiddenFiles.has(basename(path))) failures.push(`${path}: forbidden secret file`);

    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      failures.push(`${path}: unreadable artifact`);
      return;
    }
    const clientArtifact = isClientReleaseArtifact(path);
    if (clientArtifact) scanJwtRoles(path, text);
    failures.push(...collectUnsplashLeakFailures(path, text));
    for (const pattern of clientArtifact
      ? [...secretValuePatterns, ...clientSecretNamePatterns]
      : secretValuePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) failures.push(`${path}: matched ${pattern.source}`);
    }
  }

  const contract = inspectContract(root);
  for (const path of [resolve(root, "dist"), resolve(root, "ios/App/App/public")]) {
    if (existsSync(path)) scan(path);
  }
  if (failures.length) throw new Error("Secret/leakage scan failed: " + failures.join("\n"));
  const receipt = {
    schemaVersion: 1,
    buildMode: "production-bundled",
    completedStage: "npm-build-postbuild",
    requiredArtifacts: contract.requiredArtifacts,
    clientEntry: contract.clientEntry,
    hashes: hashArtifacts(root),
  };
  if (requireReceipt) {
    need(existsSync(resolve(root, RECEIPT)), "release receipt missing");
    let recorded;
    try {
      recorded = JSON.parse(readFileSync(resolve(root, RECEIPT), "utf8"));
    } catch {
      throw new Error("release receipt invalid JSON");
    }
    need(
      JSON.stringify(recorded) === JSON.stringify(receipt),
      "release receipt schema/content/hash mismatch",
    );
  }
  return receipt;
}

function need(ok, message) {
  if (!ok) throw new Error(message);
}
function read(path) {
  need(existsSync(path), "missing artifact: " + basename(path));
  return readFileSync(path, "utf8");
}
function ast(code) {
  const tree = ts.createSourceFile(
    "artifact.js",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  need(tree.parseDiagnostics.length === 0, "artifact JavaScript parse failed");
  return tree;
}
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (n) => walk(n, visit));
}
function member(node, name) {
  return node && ts.isPropertyAccessExpression(node) && node.name.text === name;
}
function call(node, name) {
  return node && ts.isCallExpression(node) && member(node.expression, name);
}
function unparen(node) {
  while (node && ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}
function rootExpression(node) {
  return (
    node &&
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
    call(node.left, "getElementById") &&
    node.left.expression.expression.text === "document" &&
    node.left.arguments[0]?.text === "root" &&
    member(node.right, "body") &&
    node.right.expression.text === "document"
  );
}
function verifyMount(tree) {
  let mounts = 0;
  walk(tree, (n) => {
    if (call(n, "hydrateRoot") && n.arguments[0]?.text === "document")
      throw new Error("untransformed hydrateRoot(document)");
    if (call(n, "createRoot") && n.arguments[0]?.text === "document")
      throw new Error("untransformed createRoot(document)");
    if (!call(n, "render")) return;
    const invoke = n.expression.expression;
    if (!ts.isCallExpression(invoke)) return;
    const fn = unparen(invoke.expression);
    if (!ts.isFunctionExpression(fn)) return;
    const statements = fn.body.statements;
    const vars = statements
      .filter(ts.isVariableStatement)
      .flatMap((x) => [...x.declarationList.declarations]);
    const rootVar = vars.find((x) => rootExpression(x.initializer));
    const ret = statements.find(ts.isReturnStatement);
    if (
      !rootVar ||
      !call(ret?.expression, "createRoot") ||
      ret.expression.arguments[0]?.text !== rootVar.name.text
    )
      return;
    const options = vars.find(
      (x) => x.name.text === ret.expression.arguments[1]?.text,
    )?.initializer;
    const handler =
      options && ts.isObjectLiteralExpression(options)
        ? options.properties.find((x) => x.name?.text === "onUncaughtError")?.initializer
        : null;
    need(handler && ts.isFunctionExpression(handler), "root error handler missing");
    let reportsError = false,
      recordsError = false;
    walk(handler, (x) => {
      if (
        call(x, "error") &&
        x.expression.expression.text === "console" &&
        x.arguments.some((a) => a.getText(tree).includes("[REACT_UNCAUGHT]"))
      )
        reportsError = true;
      if (
        ts.isBinaryExpression(x) &&
        x.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        member(x.left, "error")
      )
        recordsError = true;
    });
    need(reportsError && recordsError, "root error handling contract missing");
    let suspenseFallback = false;
    for (const arg of n.arguments)
      walk(arg, (child) => {
        if (!ts.isCallExpression(child) || !member(child.arguments[0], "Suspense")) return;
        const props = child.arguments[1];
        if (!props || !ts.isObjectLiteralExpression(props)) return;
        const fallback = props.properties.find((p) => p.name?.text === "fallback")?.initializer;
        if (fallback)
          walk(fallback, (item) => {
            if (
              ts.isPropertyAssignment(item) &&
              item.name?.text === "className" &&
              item.initializer.text === "roamie-splash"
            )
              suspenseFallback = true;
          });
      });
    need(suspenseFallback, "root render Suspense splash fallback missing");
    mounts++;
  });
  need(mounts === 1, "expected one transformed root-container createRoot/render expression");
}
function files(directory) {
  need(
    existsSync(directory) && lstatSync(directory).isDirectory(),
    "missing artifact directory: " + basename(directory),
  );
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const p = join(directory, name),
        info = lstatSync(p);
      need(!info.isSymbolicLink(), "artifact symlink forbidden");
      return info.isDirectory() ? files(p) : [p];
    });
}
export function hashArtifacts(root) {
  return Object.fromEntries(
    files(resolve(root, "dist"))
      .map((p) => relative(root, p).split("\\").join("/"))
      .filter((p) => p !== RECEIPT)
      .sort()
      .map((p) => [
        p,
        createHash("sha256")
          .update(readFileSync(resolve(root, p)))
          .digest("hex"),
      ]),
  );
}
function inspectContract(root) {
  const server = resolve(root, "dist/server"),
    client = resolve(root, "dist/client");
  const serverFiles = files(server),
    clientFiles = files(client);
  const configPath = resolve(server, "wrangler.json");
  let config;
  try {
    config = JSON.parse(read(configPath));
  } catch {
    throw new Error("generated Wrangler config missing/invalid");
  }
  need(config.main === "index.js", "unexpected Worker entry");
  need(
    config.no_bundle === true && !config.build?.command,
    "upload must consume the verified bundle without rebuilding",
  );
  need(
    resolve(server, config.assets?.directory ?? "") === client,
    "Wrangler assets must target dist/client",
  );
  const worker = resolve(server, config.main);
  read(worker);
  const manifests = serverFiles.filter((p) =>
    /^_tanstack-start-manifest_v-.*\.js$/.test(basename(p)),
  );
  need(manifests.length === 1, "expected one client manifest");
  const match = read(manifests[0]).match(/clientEntry:\s*"(\/assets\/[^"?#]+\.js)"/);
  need(match, "manifest client entry missing");
  const entry = resolve(client, "." + match[1]);
  need(entry.startsWith(client + "/"), "invalid manifest entry path");
  const index = resolve(client, "index.html"),
    bootstrap = resolve(client, "assets/capacitor-bootstrap.js");
  const html = read(index),
    boot = read(bootstrap),
    code = read(entry);
  need(
    !/npm run ios:sim|Ultra minimal HTML test|ROAMIE_MINIMAL_BOOT enabled|Minimal boot test|連線開發伺服器中/.test(
      html + boot,
    ),
    "diagnostic/placeholder artifact forbidden",
  );
  need(
    /<script\b[^>]*type="module"[^>]*src="\.\/assets\/capacitor-bootstrap\.js"/.test(html),
    "HTML required bootstrap reference missing",
  );
  for (const marker of [
    'id="root"',
    'id="roamie-boot-splash"',
    "self.$_TSR={",
    "manifest:{routes:{}}",
    "self.$_TSR.e();",
    "APP_SCRIPT_LOAD_ERROR",
    "data-roamie-boot-shell",
  ]) {
    need(html.includes(marker), "HTML boot/splash contract missing: " + marker);
  }
  for (const marker of [
    "CAPACITOR_APP_BUNDLE_LOADED",
    "CAPACITOR_APP_BUNDLE_FAILED",
    "bootstrap-shell",
    "requestAnimationFrame",
  ])
    need(boot.includes(marker), "bootstrap handling missing: " + marker);
  for (const marker of ["MAIN_TSX_LOADED", "data-roamie-boot-shell", "Suspense", "roamie-splash"])
    need(code.includes(marker), "client boot patch missing: " + marker);
  const entryTree = ast(code);
  verifyMount(entryTree);
  let loadsEntry = false;
  walk(ast(boot), (n) => {
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(n.arguments[0]) &&
      resolve(dirname(bootstrap), n.arguments[0].text) === entry
    )
      loadsEntry = true;
  });
  need(loadsEntry, "bootstrap does not import manifest entry");
  function reference(from, ref, base = client) {
    if (!ref || /^(?:[a-z]+:|#|\/\/)/i.test(ref)) return;
    const clean = ref.split(/[?#]/)[0];
    if (!clean) return;
    const target = clean.startsWith("/")
      ? resolve(base, "." + clean)
      : resolve(dirname(from), clean);
    need(
      target.startsWith(base + "/") && existsSync(target) && lstatSync(target).isFile(),
      "missing/invalid referenced asset from " + basename(from),
    );
  }
  for (const m of html.matchAll(/<(script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g)) {
    if (m[1] !== "img")
      need(!/^(?:[a-z]+:|\/\/)/i.test(m[2]), "remote/live-reload startup asset forbidden");
    reference(index, m[2]);
  }
  for (const p of clientFiles) {
    if (p.endsWith(".js"))
      walk(p === entry ? entryTree : ast(read(p)), (n) => {
        const source =
          ts.isImportDeclaration(n) || ts.isExportDeclaration(n)
            ? n.moduleSpecifier
            : ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword
              ? n.arguments[0]
              : null;
        if (source && ts.isStringLiteral(source) && /^[./]/.test(source.text))
          reference(p, source.text);
        if (
          ts.isStringLiteral(n) &&
          /^(?:\.?\/)?assets\/[^?#]+\.(?:js|css|woff2?|png|svg)$/.test(n.text)
        )
          reference(index, n.text);
      });
    if (p.endsWith(".css"))
      for (const m of read(p).matchAll(/url\(["']?([^"')]+)["']?\)/g)) reference(p, m[1]);
  }
  // Worker imports must also resolve; hashing an incomplete tree alone is insufficient.
  for (const p of serverFiles.filter((p) => p.endsWith(".js"))) {
    walk(ast(read(p)), (n) => {
      const source =
        ts.isImportDeclaration(n) || ts.isExportDeclaration(n)
          ? n.moduleSpecifier
          : ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword
            ? n.arguments[0]
            : null;
      if (source && ts.isStringLiteral(source) && /^[.]/.test(source.text))
        reference(p, source.text, server);
    });
  }
  return {
    clientEntry: relative(root, entry),
    requiredArtifacts: [worker, configPath, manifests[0], index, bootstrap, entry]
      .map((p) => relative(root, p))
      .sort(),
  };
}

/** Called only after production prepare; shares the exact verifier, not a second authority. */
export function writeReleaseReceipt(root) {
  const receipt = verifyReleaseArtifacts(root, { requireReceipt: false });
  try {
    writeFileSync(resolve(root, RECEIPT), JSON.stringify(receipt, null, 2) + "\n");
    verifyReleaseArtifacts(root);
  } catch (error) {
    rmSync(resolve(root, RECEIPT), { force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 2) throw new Error("Unexpected verifier arguments");
    verifyReleaseArtifacts(resolve(import.meta.dirname, ".."));
    console.info(
      "[release-artifacts] PASS: production contract, receipt hashes, secret/leakage scan",
    );
  } catch (error) {
    console.error("[release-artifacts] FAIL: " + error.message);
    process.exitCode = 1;
  }
}
