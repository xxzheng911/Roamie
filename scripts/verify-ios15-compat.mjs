import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Bundle app code first (esbuild itself may use modern built-ins), then remove the
// iOS 15.4 built-ins so only Roamie code and its bundled dependencies run without them.
const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "roamie-ios15-"));
const common = { bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], conditions: ["browser", "import"],
  alias: { "@": join(root, "src") }, target: "es2020", logLevel: "silent", define: { "import.meta.env": "{}" },
  external: ["node:*"], loader: { ".json": "json", ".jpg": "empty", ".png": "empty", ".svg": "empty", ".webp": "empty", ".css": "empty" },
  // TanStack Start virtual modules are replaced by the Vite plugin in real builds; unused here.
  plugins: [{ name: "tanstack-virtual-stub", setup(b) {
    b.onResolve({ filter: /^(#tanstack-|tanstack-start-)/ }, (args) => ({ path: args.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default {}; export const getServerFnById = () => undefined;", loader: "js" }));
  } }] };
await build({ ...common, entryPoints: [join(root, "src/lib/ios15-compat.ts")], outfile: join(out, "compat.mjs") });
await build({ ...common, entryPoints: [join(root, "scripts/ios15-compat-checks.mjs")], outfile: join(out, "checks.mjs") });

const native = { at: Array.prototype.at, stringAt: String.prototype.at, hasOwn: Object.hasOwn, structuredClone: globalThis.structuredClone };
const log = console.log;
delete Array.prototype.at; delete String.prototype.at; delete Object.hasOwn; delete globalThis.structuredClone;
delete Array.prototype.findLastIndex; delete Array.prototype.findLast;
assert.equal(typeof [].at, "undefined"); assert.equal(typeof globalThis.structuredClone, "undefined");
globalThis.fetch = async () => { throw Error("NETWORK_DISABLED"); };
const WITH_COMPAT = process.env.IOS15_COMPAT !== "0";
if (WITH_COMPAT) await import(pathToFileURL(join(out, "compat.mjs")).href);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
let results;
try { results = await (await import(pathToFileURL(join(out, "checks.mjs")).href)).run(native); }
catch (error) { results = [["checks module evaluation", `FAIL ${error?.name}: ${String(error?.message).slice(0, 90)}`]]; }
for (const [name, status] of results) log(`${status === "PASS" ? "PASS" : "FAIL"} ${name}${status === "PASS" ? "" : " — " + status}`);
const failed = results.filter(([, status]) => status !== "PASS").length;
log(`${WITH_COMPAT ? "with compat" : "WITHOUT compat"}: ${results.length - failed}/${results.length} PASS`);
process.exitCode = failed ? 1 : 0;
