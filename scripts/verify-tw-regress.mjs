import "./verify-netguard-full.mjs";
/**
 * T-W regression summarizer (tester). Runs ONE target verify script (same launch as verify-d4-watchdog:
 * `npx vite-node <target> --config scripts/vite.verify.config.mjs -- <args>`), waits for it (sequential, single child),
 * and prints only the conclusion: exit status, SUMMARY / PASS / FAIL / HEAD child / NETGUARD lines,
 * plus lines tagged NEW vs HEAD / REGRESSION (first 220 chars each) and tag counts.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=598 scripts/verify-tw-regress.mjs -- --target=scripts/verify-X.mjs --head-dir=<snapshot> [--pass=--only=a,b]
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const target = argv.find((a) => a.startsWith("--target="))?.slice(9);
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const passArgs = argv.filter((a) => a.startsWith("--pass=")).map((a) => a.slice(7));
const out = console.log.bind(console);
if (!target || !/^scripts\/verify-[\w.-]+\.mjs$/.test(target)) { out(`usage: --target=scripts/verify-X.mjs (got ${target})`); process.exit(2); }
const first = readFileSync(target, "utf8").split("\n")[0].trim();
out(`target=${target} firstLine=${first}`);
if (first !== 'import "./verify-netguard-full.mjs";') { out("REFUSED: first line is not netguard"); process.exit(2); }

const args = ["vite-node", target, "--config", "scripts/vite.verify.config.mjs", "--", ...(headDir ? [`--head-dir=${headDir}`] : []), ...passArgs];
const t0 = Date.now();
const r = spawnSync("npx", args, { encoding: "utf8", timeout: 585_000, killSignal: "SIGKILL", maxBuffer: 512 << 20 });
const text = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
const lines = text.split("\n");
out(`child status=${r.status} signal=${r.signal ?? ""} ms=${Date.now() - t0} lines=${lines.length}`);
const keep = lines.filter((l) => /^(SUMMARY|PASS all|FAIL|HEAD child|NOTE no HEAD|NOTE HEAD child)|NETGUARD blocked=|internal watchdog/.test(l.trim()));
out("---- conclusion lines ----");
for (const l of keep) out(`  ${l.slice(0, 400)}`);
const tagged = lines.filter((l) => /NEW vs HEAD|REGRESSION|ONLY W|W-only|new failure/i.test(l));
out(`---- tagged NEW-vs-HEAD / REGRESSION lines: ${tagged.length} ----`);
for (const l of tagged.slice(0, 60)) out(`  ${l.trim().slice(0, 220)}`);
const tagCount = {};
for (const l of lines) { const m = l.match(/=> (correct|MISS\(漏判\)|FP\(誤判\))(?: \((NEW vs HEAD|HEAD also)\))?/); if (m) { const k = `${m[1]}${m[2] ? `/${m[2]}` : ""}`; tagCount[k] = (tagCount[k] ?? 0) + 1; } }
if (Object.keys(tagCount).length) out(`---- survey tag counts: ${JSON.stringify(tagCount)}`);
const grepArg = argv.find((a) => a.startsWith("--grep="))?.slice(7);
if (grepArg) {
  const re = new RegExp(grepArg);
  const idx = lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
  const ctx = Number(argv.find((a) => a.startsWith("--ctx="))?.slice(6) ?? 0);
  out(`---- grep /${grepArg}/ ctx=${ctx}: ${idx.length} hits ----`);
  for (const i of idx.slice(0, 30)) for (let j = i; j <= Math.min(lines.length - 1, i + ctx); j += 1) out(`  ${lines[j].slice(0, 400)}`);
}
process.stdout.write("", () => process.exit(r.status ?? 1));
