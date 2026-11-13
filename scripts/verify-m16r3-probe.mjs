/**
 * M16 round 3 (tester) probe: one App-order turn (m16 harness) per --t=<text> at --stage=<stage> in --locale=<locale>,
 * printing the full row (discovery runs / places calls / geocode queries / pending / reply).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-m16r3-probe.mjs -- --locale=zh-TW --stage=picked --t=…
 */
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 280_000).unref();
globalThis.fetch = async (...a) => { throw new Error("NO_NETWORK " + String(a[0])); };
const storageWrites = [];
{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); }, clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep */ }
}
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);
const SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
const from = SRC.indexOf("const resolvedScope = await load(");
const to = SRC.indexOf("// ------------------------------------------------------------------ scenarios");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites", SRC.slice(from, to) +
  "\nreturn { appTurn, first, freshAll, freshAuthority, STEP1, NAME, generatedDone, failedCatch, refreshPref, setLocale: (l) => { curLocale = l; } };")(load, loadOpt, readFileSync, storageWrites);
const locale = argv.find((a) => a.startsWith("--locale="))?.slice(9) ?? "zh-TW";
const stage = argv.find((a) => a.startsWith("--stage="))?.slice(8) ?? "picked";
const texts = argv.filter((a) => a.startsWith("--t=")).map((a) => a.slice(4));
for (const t of texts) {
  H.freshAll(); await H.freshAuthority(); H.setLocale(locale);
  const fromKey = argv.find((a) => a.startsWith("--from="))?.slice(7) ?? "sydney";
  let s = (await H.first(H.STEP1[locale](H.NAME[locale][fromKey]), locale)).s;
  if (stage === "refreshPref") s = H.refreshPref(s);
  else if (stage !== "choosing") { s = (await H.appTurn(s, "1", locale)).s; if (stage === "done") s = H.generatedDone(s, fromKey); if (stage === "failedCatch") s = H.failedCatch(s, fromKey); }
  const r = await H.appTurn(s, t, locale);
  const x = r.row;
  out(`ROW ${locale}|${stage}|${t}\n   ${JSON.stringify({ cls: x.cls, branch: x.branch, dest: x.dest, trip: x.trip, tpc: x.tpc, cand: x.cand, pending: x.pending, base: x.base, offered: x.offered, start: x.start, end: x.end, days: x.days, prov: x.prov,
    sid: x.sidChanged, geo: x.geo, ageo: x.ageo, dgeo: x.dgeo, runs: x.discoveryRuns, places: x.placesCalls, guard: x.guard, weather: x.weather, stops: x.stops })}\n   reply: ${x.reply}`);
}
process.exit(0);
