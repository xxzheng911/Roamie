/**
 * M5 (tester) — regression batch: runs each verify script through verify-d4-watchdog and prints
 * exit code, duration, the script's own summary line(s) and its FAIL lines. Exit 1 if any fails.
 * Run: node scripts/verify-m5-regression-batch.mjs [--timeout=300] [--head-dir=<snap>] [scripts/verify-X.mjs ...]
 *   --head-dir is passed to the scripts that accept it (l-combination-destination-switch, l8-museum-route-chain, m5-*,
 *   chat-combination-partial-modify, chat-combination-hold-corpus, combination-date-correction).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const argv = process.argv.slice(2);
const timeout = Number(argv.find((a) => a.startsWith("--timeout="))?.slice(10) ?? 300);
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const targets = argv.filter((a) => a.startsWith("scripts/"));
const WATCHDOG = join(process.cwd(), "scripts/verify-d4-watchdog.mjs");
// M9: also the scripts that require --head-dir (without it they fail "HEAD snapshot probe ran" / hit their own watchdog).
const HEAD_AWARE = /verify-(l-combination-destination-switch|l8-museum-route-chain|m5-|m7-combination-review|chat-combination-partial-modify|chat-combination-hold-(corpus|a11|a12-probe|a13)|chat-l10n-destination-sweep|four-locale-e2e|d4-kept-name-downstream|d4-zh-latin-name-sample|d4-locale-switch-race|combination-date-correction)/;
let bad = 0;
for (const target of targets) {
  const t0 = Date.now();
  const args = [WATCHDOG, `--timeout=${timeout}`, target, ...(headDir && HEAD_AWARE.test(target) ? ["--", `--head-dir=${headDir}`] : [])];
  const r = spawnSync("node", args, { cwd: process.cwd(), encoding: "utf8", timeout: (timeout + 60) * 1000, maxBuffer: 128 << 20 });
  const text = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const code = Number(text.match(/WATCHDOG: .* exited code=(\d+)/)?.[1] ?? (/exceeded/.test(text) ? 124 : r.status ?? 1));
  const lines = text.split("\n");
  const fails = lines.filter((l) => /^\s*(FAIL|✗|not ok|AssertionError|Error:)/.test(l));
  const summary = lines.filter((l) => /\b(passed|failed|PASS all|checks?|ok \d+|tests?)\b/i.test(l) && l.length < 300).slice(-2).join(" ‖ ");
  if (code !== 0) bad++;
  console.log(`\n=== ${code === 0 ? "OK  " : "FAIL"} ${target} exit=${code} ${((Date.now() - t0) / 1000).toFixed(0)}s\n  ${summary}`);
  for (const l of fails.slice(0, 40)) console.log(`    ${l.slice(0, 300)}`);
  if (fails.length > 40) console.log(`    … ${fails.length - 40} more`);
}
console.log(bad ? `\nFAIL ${bad}/${targets.length} script(s)` : `\nPASS ${targets.length}/${targets.length} script(s)`);
process.exit(bad ? 1 : 0);
