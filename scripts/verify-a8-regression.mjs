/**
 * A8 regression runner: 13 existing scripts + 8 place scripts in the working tree, and the known
 * HEAD-failing scripts (plus intent-multilingual --nextstep-probe) in both the working tree and the
 * HEAD snapshot, comparing failing check names.
 *
 * Each child runs with scripts/verify-a8-netguard.mjs preloaded (outbound network blocked + counted),
 * a per-script timeout, and this runner has its own watchdog.
 * Run: npx vite-node scripts/verify-a8-regression.mjs --config scripts/vite.verify.config.mjs -- --head-dir=<snapshot>
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const out = console.log.bind(console);
const argv = process.argv.slice(2);
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice("--head-dir=".length);
const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
setTimeout(() => {
  out("FAIL watchdog: regression runner exceeded time limit");
  process.exit(3);
}, 55 * 60_000).unref();

const REPO = process.cwd();
const GUARD = resolve(REPO, "scripts/verify-a8-netguard.mjs");
const EXISTING = [
  "verify-chat-runtime-localization", "verify-mongolia-pending-question", "verify-multilingual-planning",
  "verify-destination-localization-binding", "verify-trusted-destination-name-preservation", "verify-full-itinerary-draft",
  "verify-global-planning-blockers", "verify-bare-number-contextual-reply", "verify-ai-itinerary-state-machine",
  "verify-fallback-place-card-contract", "verify-candidate-pool", "verify-combination-discovery-trace",
  "verify-shopping-followup-query-queue",
];
const PLACE = [
  "verify-place-geo-b18-sample", "verify-place-geo-b16-false-block-sample", "verify-place-geo-b14-fresh-sample",
  "verify-place-geo-b12-border-daytrip-sample", "verify-place-geo-coords-audit", "verify-place-detail-same-name-geo-guard",
  "verify-place-geo-text-search-country-filter", "verify-place-detail-venue-resolution",
];
const HEAD_KNOWN = ["verify-chat-state-machine", "verify-planning-state-machine", "verify-chat-no-combination-place-cards", "verify-budget-refinement"];

function run(cwd, name, extra = []) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vite-node", `scripts/${name}.mjs`, "--config", "scripts/vite.verify.config.mjs", ...(extra.length ? ["--", ...extra] : [])], {
      cwd,
      env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${GUARD}`.trim() },
    });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 300_000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const lines = text.split("\n");
      const fails = lines.filter((l) => /^\s*(?:FAIL\b|✗|×|not ok\b|\[FAIL\])/.test(l)).map((l) => l.trim()).filter((l) => !/^FAIL \d+ check/.test(l));
      const passes = lines.filter((l) => /^\s*(?:PASS\b|✓|ok\b|\[PASS\])/.test(l)).length;
      const net = [...text.matchAll(/@@NETGUARD blocked=(\d+)@@/g)].reduce((a, m) => a + Number(m[1]), 0);
      done({ name, cwd, code, signal, passes, fails, net, ms: Date.now() - started, tail: lines.filter(Boolean).slice(-4).join(" | ").slice(0, 400) });
    });
  });
}

async function pool(tasks, n) {
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < tasks.length) {
      const t = tasks[i++];
      results.push(await t());
    }
  }));
  return results;
}

const tasks = [];
const pick = (list) => (only ? list.filter((n) => only.split(",").includes(n)) : list);
for (const n of pick([...EXISTING, ...PLACE])) tasks.push(() => run(REPO, n).then((r) => ({ ...r, group: EXISTING.includes(n) ? "existing" : "place" })));
const headOk = headDir && existsSync(join(headDir, "src"));
for (const n of pick(HEAD_KNOWN)) {
  tasks.push(() => run(REPO, n).then((r) => ({ ...r, group: "head-known:now" })));
  if (headOk) tasks.push(() => run(headDir, n).then((r) => ({ ...r, group: "head-known:head" })));
}
if (!only || only.includes("nextstep")) {
  tasks.push(() => run(REPO, "verify-chat-intent-multilingual", ["--nextstep-probe"]).then((r) => ({ ...r, name: "intent-multilingual --nextstep-probe", group: "nextstep:now" })));
}

const results = await pool(tasks, 4);
let bad = 0;
for (const r of results.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))) {
  const ok = r.code === 0 && !r.signal && r.net === 0;
  if (r.group === "existing" || r.group === "place") if (!ok) bad++;
  out(`${ok ? "OK  " : "BAD "} [${r.group}] ${r.name} code=${r.code}${r.signal ? ` signal=${r.signal}` : ""} pass=${r.passes} fail=${r.fails.length} net=${r.net} ${Math.round(r.ms / 1000)}s`);
  if (!ok) out(`      tail: ${r.tail}`);
}
// HEAD-known comparison
for (const n of pick(HEAD_KNOWN)) {
  const now = results.find((r) => r.name === n && r.group === "head-known:now");
  const head = results.find((r) => r.name === n && r.group === "head-known:head");
  if (!now || !head) {
    out(`CMP  ${n}: missing ${now ? "head" : "now"} run`);
    bad++;
    continue;
  }
  const norm = (l) => l.replace(/\s+/g, " ");
  const added = now.fails.map(norm).filter((l) => !head.fails.map(norm).includes(l));
  const removed = head.fails.map(norm).filter((l) => !now.fails.map(norm).includes(l));
  const same = !added.length && now.net === 0;
  if (!same) bad++;
  out(`CMP  ${same ? "SAME" : "DIFF"} ${n}: now fail=${now.fails.length} head fail=${head.fails.length}${added.length ? `\n      new: ${added.join("\n           ")}` : ""}${removed.length ? `\n      fixed vs HEAD: ${removed.join("\n           ")}` : ""}`);
}
const ns = results.find((r) => r.group === "nextstep:now");
if (ns) out(`NEXTSTEP fails=${ns.fails.length}: ${ns.fails.slice(0, 50).join(" || ")}`);
out(bad ? `FAIL regression: ${bad} problem(s)` : "PASS regression runner");
process.exit(bad ? 1 : 0);
