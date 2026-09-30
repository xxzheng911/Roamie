import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv as parse } from "node:util";
import {
  LEGACY_CLIENT_MAPS_KEY_NAMES,
  LEGACY_SHARED_CLIENT_MAPS_KEY_SHA256,
  MAPS_CLIENT_AUTHORITIES,
  SERVER_GOOGLE_KEY_NAMES,
  fingerprint,
  sha256,
} from "./google-maps-client-authority.mjs";

const KEY_RE = /AIza[0-9A-Za-z_-]{35}/g;
const TEXT_EXT = new Set([".js", ".css", ".html", ".json", ".txt", ".map"]);
const PATTERN_KEYWORDS = new Set(
  "return throw case delete void typeof yield await do else in of instanceof new".split(" "),
);
const KEPT_BINDINGS = new Set(
  "if for new var let const return function class async await import export from true false null undefined typeof this try catch throw else in of void do while switch case break continue default get set static super yield delete instanceof with debugger as".split(
    " ",
  ),
);
const CLIENT_LIBRARY_RE = /importLibrary\("(places|geocoding|routes|marker|geometry)"\)/;

function filesIn(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

function textOf(path) {
  const ext = path.slice(path.lastIndexOf("."));
  if (!TEXT_EXT.has(ext)) return "";
  return readFileSync(path, "utf8");
}

function isApplicationLogicFile(path) {
  return /\.(?:js|css|html)$/.test(path) && !/(^|\/)cordova(?:_plugins)?\.js$/.test(path);
}

function isIdentChar(char) {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

/**
 * Minified names, including a lone `$`, become ID only in code and template
 * interpolations. String and template text stay intact, so a host, callback,
 * or other business literal cannot be normalized away.
 */
function normalizeMinifiedIdentifiers(text) {
  let i = 0;
  let out = "";
  const n = text.length;
  const emitIdent = () => {
    const start = i;
    i += 1;
    while (isIdentChar(text[i])) i += 1;
    const binding = text.slice(start, i);
    out += binding.length <= 4 && !KEPT_BINDINGS.has(binding) ? "ID" : binding;
    return binding;
  };
  const scanCode = (stopOnBrace) => {
    let depth = stopOnBrace ? 1 : 0;
    // Minified `a/*b` is division then multiply. A comment or regex is only
    // legal where a value, not an operator, can start.
    let slashStartsPattern = true;
    const markValue = () => {
      slashStartsPattern = false;
    };
    const markOperator = () => {
      slashStartsPattern = true;
    };
    while (i < n) {
      const char = text[i];
      const next = text[i + 1];
      if (char === "{") {
        depth += 1;
        out += char;
        i += 1;
        markOperator();
        continue;
      }
      if (char === "}") {
        if (stopOnBrace && depth === 1) return;
        depth -= 1;
        out += char;
        i += 1;
        markOperator();
        continue;
      }
      if (char === "/" && next === "/" && slashStartsPattern) {
        const end = text.indexOf("\n", i);
        const stop = end < 0 ? n : end;
        out += text.slice(i, stop);
        i = stop;
        markOperator();
        continue;
      }
      if (char === "/" && next === "*" && slashStartsPattern) {
        const end = text.indexOf("*/", i + 2);
        const stop = end < 0 ? n : end + 2;
        out += text.slice(i, stop);
        i = stop;
        markOperator();
        continue;
      }
      if (char === "/" && slashStartsPattern) {
        out += char;
        i += 1;
        while (i < n) {
          if (text[i] === "\\") {
            out += text[i] + (text[i + 1] ?? "");
            i += 2;
            continue;
          }
          if (text[i] === "[") {
            out += text[i];
            i += 1;
            while (i < n && text[i] !== "]") {
              if (text[i] === "\\") {
                out += text[i] + (text[i + 1] ?? "");
                i += 2;
                continue;
              }
              out += text[i];
              i += 1;
            }
            continue;
          }
          out += text[i];
          const closed = text[i] === "/";
          i += 1;
          if (closed) break;
        }
        markValue();
        continue;
      }
      if (char === "'" || char === '"') {
        out += char;
        i += 1;
        while (i < n) {
          if (text[i] === "\\") {
            out += text[i] + (text[i + 1] ?? "");
            i += 2;
            continue;
          }
          out += text[i];
          const closed = text[i] === char;
          i += 1;
          if (closed) break;
        }
        markValue();
        continue;
      }
      if (char === "`") {
        out += char;
        i += 1;
        while (i < n) {
          if (text[i] === "\\") {
            out += text[i] + (text[i + 1] ?? "");
            i += 2;
            continue;
          }
          if (text[i] === "`") {
            out += "`";
            i += 1;
            break;
          }
          if (text[i] === "$" && text[i + 1] === "{") {
            out += "${";
            i += 2;
            scanCode(true);
            if (text[i] === "}") {
              out += "}";
              i += 1;
            }
            continue;
          }
          out += text[i];
          i += 1;
        }
        markValue();
        continue;
      }
      if (isIdentChar(char) && !isIdentChar(text[i - 1]) && /[A-Za-z_$]/.test(char)) {
        const binding = emitIdent();
        if (PATTERN_KEYWORDS.has(binding)) markOperator();
        else markValue();
        continue;
      }
      if (char >= "0" && char <= "9") {
        out += char;
        i += 1;
        while (i < n && /[0-9A-Za-z_.]/.test(text[i])) {
          out += text[i];
          i += 1;
        }
        markValue();
        continue;
      }
      out += char;
      i += 1;
      if (char === ")" || char === "]") markValue();
      else if (!/\s/.test(char)) markOperator();
    }
  };
  scanCode(false);
  return out;
}

export function normalizeClientLogic(text) {
  const prepared = text
    .replace(KEY_RE, "MAPS_CLIENT_KEY")
    .replace(/&authReferrerPolicy=origin/g, "")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "BUILD_TIME")
    .replace(/explore-fix-\d{8}-\d{4}/g, "BUILD_DEBUG")
    .replace(/[A-Za-z0-9_-]{8}(?=\.(?:js|css))/g, "HASH")
    .replace(/VITE_FEATURE_CREDITS_ENABLED:"[01]"/g, 'VITE_FEATURE_CREDITS_ENABLED:"MODE"')
    .replace(/quiet:(?:true|false)/g, "quiet:MODE")
    .replace(
      /<script>\s*try \{ console\.error\("INDEX_HTML_LOADED"\); \} catch \(_\) \{\}\s*<\/script>/g,
      "INDEX_HTML_PROBE",
    )
    .replace(/<meta name="roamie-probe" content="INDEX_HTML_LOADED" \/>/g, "INDEX_HTML_PROBE");
  return normalizeMinifiedIdentifiers(prepared);
}

function assertSameLogic(left, right, label) {
  assert.equal(normalizeClientLogic(left), normalizeClientLogic(right), label);
}

function assertDifferentLogic(left, right, label) {
  assert.notEqual(normalizeClientLogic(left), normalizeClientLogic(right), label);
}

export function verifyParityFixtures() {
  assertDifferentLogic(
    "function run(value){return value+1}",
    "function run(value){return value-1}",
    "A function body change",
  );
  assertDifferentLogic(
    'fetch("https://maps.googleapis.com/maps/api/geocode/json")',
    'fetch("https://places.googleapis.com/v1/places")',
    "B API host change",
  );
  assertDifferentLogic(
    'const callback="/auth/callback"',
    'const callback="/user/callback"',
    "C auth callback change",
  );
  assertDifferentLogic(
    'google.maps.importLibrary("maps")',
    'google.maps.importLibrary("main")',
    "D Maps loader logic change",
  );
  const webKey = "AIza" + "w".repeat(35);
  const iosKey = "AIza" + "i".repeat(35);
  assertSameLogic(
    `src="https://maps.googleapis.com/maps/api/js?key=${webKey}&loading=async&v=weekly&authReferrerPolicy=origin";time="2026-09-30T20:00:33.772Z";tag="explore-fix-20260930-2000";file="assets/index-Abcd1234.js";quiet:true`,
    `src="https://maps.googleapis.com/maps/api/js?key=${iosKey}&loading=async&v=weekly";time="2026-10-01T04:00:33.772Z";tag="explore-fix-20261001-0400";file="assets/index-Zyxw9876.js";quiet:false`,
    "E key, referrer, and build-mode differences",
  );
  assertSameLogic(
    'VITE_FEATURE_CREDITS_ENABLED:"1"',
    'VITE_FEATURE_CREDITS_ENABLED:"0"',
    "F credits flag",
  );
  assertSameLogic(
    "function K(value){return value+1}url=`${Zr}${K}`",
    "function $(value){return value+1}url=`${Zr}${$}`",
    "G minifier identifier-only difference",
  );
  assertDifferentLogic(
    'return/日本|韓國/i.test(city)',
    'return/泰國|首爾/i.test(city)',
    "regex literal change",
  );
  assertSameLogic("total/*parts+K", "total/*parts+$", "division is not a comment");
  assertDifferentLogic("total/*parts*/+1", "total/*parts*/-1", "real comment does not hide the following expression");
}

export function clientLogicDigests(directory) {
  return filesIn(directory)
    .filter(isApplicationLogicFile)
    .map((path) => sha256(normalizeClientLogic(textOf(path))))
    .sort();
}

export function verifyClientLogicParity(webDirectory, iosDirectory) {
  const web = clientLogicDigests(webDirectory);
  const ios = clientLogicDigests(iosDirectory);
  assert.deepEqual(
    ios,
    web,
    "Web/iOS client logic diverged beyond key, referrer, and release build mode",
  );
  return web.length;
}

function knownEnv(root) {
  const env = { ...process.env };
  for (const source of [".env", ".env.local", ".env.production", ".env.production.local", ".dev.vars"]) {
    const path = resolve(root, source);
    if (!existsSync(path)) continue;
    for (const [name, value] of Object.entries(parse(readFileSync(path, "utf8")))) {
      if (value && env[name] === undefined) env[name] = value;
    }
  }
  return env;
}

export function verifyMapsClientArtifact(directory, authority, env) {
  const failures = [];
  const files = filesIn(directory);
  const text = files.map(textOf).join("\n");
  for (const name of SERVER_GOOGLE_KEY_NAMES) {
    if (text.includes(name)) failures.push("server authority name " + name);
  }
  const found = [...new Set(text.match(KEY_RE) ?? [])];
  if (found.length !== 1) failures.push("expected exactly one Maps client key, found " + found.length);
  const digests = found.map(sha256);
  if (digests.includes(LEGACY_SHARED_CLIENT_MAPS_KEY_SHA256)) {
    failures.push("legacy shared client key " + LEGACY_SHARED_CLIENT_MAPS_KEY_SHA256.slice(0, 12));
  }
  if (found.length === 1 && digests[0] !== authority.keySha256) {
    failures.push("client key fingerprint " + fingerprint(found[0]) + " != authority");
  }
  const otherName = MAPS_CLIENT_AUTHORITIES[authority.mode === "web" ? "ios" : "web"];
  const forbiddenNames = [...SERVER_GOOGLE_KEY_NAMES, ...LEGACY_CLIENT_MAPS_KEY_NAMES, otherName];
  for (const name of forbiddenNames) {
    const value = typeof env[name] === "string" ? env[name].trim() : "";
    if (!value || !text.includes(value)) continue;
    if (sha256(value) === authority.keySha256) {
      failures.push(name + " reuses the injected client key");
      continue;
    }
    failures.push(name + " fingerprint " + fingerprint(value));
  }
  if (authority.mode === "web") {
    if (!text.includes("authReferrerPolicy=origin")) failures.push("missing authReferrerPolicy=origin");
  } else if (text.includes("authReferrerPolicy")) {
    failures.push("iOS artifact contains authReferrerPolicy");
  }
  if (!text.includes("/api/google")) failures.push("authenticated Google proxy missing");
  if (!text.includes('importLibrary("maps")')) failures.push('missing importLibrary("maps")');
  const clientLibrary = text.match(CLIENT_LIBRARY_RE);
  if (clientLibrary) failures.push("client library " + clientLibrary[1]);
  return failures;
}

function fail(failures) {
  for (const failure of failures) console.error("FAIL " + failure);
  process.exit(1);
}

const repo = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const executedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!executedDirectly) {
  // Importers use the exported checks. The command below is the release gate.
} else if (args[0] === "--parity") {
  const count = verifyClientLogicParity(resolve(repo, args[1]), resolve(repo, args[2]));
  console.log("PASS client logic parity", count);
} else if (args[0] === "--self-check") {
  assert.deepEqual(verifyMapsClientArtifact("/no/such", { mode: "web", keySha256: "0".repeat(64) }, {}), [
    "expected exactly one Maps client key, found 0",
    "missing authReferrerPolicy=origin",
    "authenticated Google proxy missing",
    'missing importLibrary("maps")',
  ]);
  verifyParityFixtures();
  console.log("PASS verifier self-check");
} else {
  const artifactFlag = args.indexOf("--artifact");
  const authorityFlag = args.indexOf("--authority");
  const directory = resolve(repo, artifactFlag >= 0 ? args[artifactFlag + 1] : "dist/client");
  const authorityPath = resolve(
    repo,
    authorityFlag >= 0 ? args[authorityFlag + 1] : "dist/maps-client-authority.json",
  );
  const authority = JSON.parse(readFileSync(authorityPath, "utf8"));
  const failures = verifyMapsClientArtifact(directory, authority, knownEnv(repo));
  if (failures.length) fail(failures);
  const found = [...new Set(filesIn(directory).map(textOf).join("\n").match(KEY_RE) ?? [])];
  console.log(
    "PASS",
    authority.mode,
    directory,
    "fingerprint=" + fingerprint(found[0]),
    "files=" + filesIn(directory).length,
    "server exposure=NO",
  );
}
