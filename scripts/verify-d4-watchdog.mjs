/**
 * D4 — watchdog runner for verify scripts that do not exit on failure.
 * Spawns `npx vite-node <script> --config scripts/vite.verify.config.mjs [-- args]`, streams its
 * output, and SIGKILLs the child (whole process group) after --timeout seconds (default 180).
 *
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=180 scripts/verify-X.mjs [-- extra args]
 *  or: npx vite-node scripts/verify-d4-watchdog.mjs --config scripts/vite.verify.config.mjs -- --timeout=180 scripts/verify-X.mjs
 */
import { spawn } from "node:child_process";

const argv = process.argv.slice(2).filter((a) => a !== "--");
const timeoutSec = Number(argv.find((a) => a.startsWith("--timeout="))?.slice(10) ?? 180);
const target = argv.find((a) => a.startsWith("scripts/") && a.endsWith(".mjs") && !a.includes("verify-d4-watchdog"));
const extra = argv.filter((a) => !a.startsWith("--timeout=") && a !== target && !a.includes("verify-d4-watchdog") && a !== "--config" && a !== "scripts/vite.verify.config.mjs");
if (!target) { console.log("usage: verify-d4-watchdog.mjs --timeout=N scripts/verify-X.mjs"); process.exit(2); }

const args = ["vite-node", target, "--config", "scripts/vite.verify.config.mjs", ...(extra.length ? ["--", ...extra] : [])];
const child = spawn("npx", args, { stdio: ["ignore", "inherit", "inherit"], detached: true });
const timer = setTimeout(() => {
  console.log(`\nWATCHDOG: ${target} exceeded ${timeoutSec}s — killed`);
  try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  process.exit(124);
}, timeoutSec * 1000);
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  console.log(`\nWATCHDOG: ${target} exited code=${code} signal=${signal ?? ""}`);
  process.exit(code ?? 1);
});
