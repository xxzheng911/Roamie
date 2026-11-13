import "./verify-netguard-full.mjs";
/**
 * T-Z (tester): summary of the d25 x rows that tw-regress tagged REGRESSION (X|node|<pool>|ja|全部…鎌倉…).
 * Runs verify-date-dest-review-d25.mjs --only=x once (single child, same launch as verify-tw-regress) and prints only
 * the detail block of each X|node|*|ja row whose text mentions 鎌倉 (header line + following W/H lines), max 400 chars each.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=598 scripts/verify-tz-d25-kamakura-rows.mjs -- --head-dir=<snapshot>
 */
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
const target = "scripts/verify-date-dest-review-d25.mjs";
const args = ["vite-node", target, "--config", "scripts/vite.verify.config.mjs", "--", ...(headDir ? [`--head-dir=${headDir}`] : []), "--only=x"];
const r = spawnSync("npx", args, { encoding: "utf8", timeout: 585_000, killSignal: "SIGKILL", maxBuffer: 512 << 20 });
const lines = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split("\n");
out(`child status=${r.status} signal=${r.signal ?? ""} lines=${lines.length}`);
const HEAD_RE = /^\s*X\|node\|(m16|real3)\|ja\|(?=.*鎌倉)/;
let blocks = 0;
for (let i = 0; i < lines.length; i += 1) {
  if (!HEAD_RE.test(lines[i]) || /^\s*FAIL/.test(lines[i])) continue;
  blocks += 1;
  out(`---- ${lines[i].trim().slice(0, 200)}`);
  for (let j = i + 1; j < lines.length && /^\s{5,}(W|H|reply)/.test(lines[j]); j += 1) {
    if (/^\s*(W|H) pre=/.test(lines[j]) || /sel=|reply:/.test(lines[j])) out(`   ${lines[j].trim().slice(0, 400)}`);
  }
}
out(`blocks=${blocks}`);
const sum = lines.filter((l) => /^(SUMMARY|HEAD child)|NETGUARD blocked=/.test(l.trim()));
for (const l of sum) out(`  ${l.trim().slice(0, 200)}`);
process.stdout.write("", () => process.exit(0));
