#!/usr/bin/env node
/**
 * router-core 1.171.2: preserve the settled loadPromise for older pending React
 * snapshots. executeBeforeLoad replaces it on the next load and resolves its
 * predecessor; no auth, redirect, SSR or timeout behavior is changed.
 * See docs/router-pending-lifecycle-fix.md for provenance and removal criteria.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../node_modules/@tanstack/router-core");
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
if (version !== "1.171.2") throw new Error(`Re-audit router lifecycle patch for ${version}`);
const files = [
  {
    path: "src/load-matches.ts",
    original: "0a6fe0643c8289001f27f8c7067ee2a757f4fb8e00191e39f4170a0c2ad9ec36",
    patched: "27065c71d969b5e1aebc0877f7cab0a6ae58657bcd297899e97d9eea29c4ba20",
    needle: "match._nonReactive.loadPromise = undefined",
  },
  {
    path: "dist/esm/load-matches.js",
    original: "70beb12e2653e58d7b09146716783dadf5d8e1dd1413a4e0ea071beb41b96bc4",
    patched: "30453e06e7d50a9d2fac2d5169a5422048f9f6d4222b3dc7fc4b0562709a4ffc",
    needle: "match._nonReactive.loadPromise = void 0;",
  },
  {
    path: "dist/cjs/load-matches.cjs",
    original: "94966280e354b971e20ee937f1b97c85a1db6db7d1a4274933ac24fa1784f285",
    patched: "7a8fa9449259489749bed88005eeae3d2f7ffa4436adc94cfaddea906f073ade",
    needle: "match._nonReactive.loadPromise = void 0;",
  },
];
const digest = (value) => createHash("sha256").update(value).digest("hex");
// Preflight every source/runtime entry before any write. Unexpected package
// contents fail installation rather than silently omitting a release fix.
const updates = files.map((file) => {
  const path = resolve(root, file.path);
  const source = readFileSync(path, "utf8");
  const hash = digest(source);
  if (hash === file.patched) return null;
  if (hash !== file.original) throw new Error(`Unexpected router source: ${file.path}`);
  if (source.split(file.needle).length !== 3) throw new Error(`Patch count: ${file.path}`);
  const patched = source.replaceAll(
    file.needle,
    "// Roamie: retain the settled thenable for pending render snapshots.",
  );
  if (digest(patched) !== file.patched) throw new Error(`Patch checksum: ${file.path}`);
  return { path, patched };
});
for (const update of updates) if (update) writeFileSync(update.path, update.patched);
console.log("[router-pending-lifecycle] verified 1.171.2 (source, ESM, CJS)");
