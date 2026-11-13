/**
 * Self-test for scripts/verify-netguard-full.mjs.
 * Every "remote" target is 192.0.2.1 (RFC 5737 TEST-NET-1, never routed, no DNS), so even a broken guard
 * cannot reach a real service.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=60 scripts/verify-netguard-full-selftest.mjs
 */
import "./verify-netguard-full.mjs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const state = globalThis[Symbol.for("roamie.verify.netguard-full")];
const GUARD = resolve(fileURLToPath(import.meta.url), "..", "verify-netguard-full.mjs");
const R = "192.0.2.1";
let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`PASS ${name}`); } else { fails.push(name); console.log(`FAIL ${name} ${extra}`); } };
const isBlockErr = (e) => { for (let x = e, i = 0; x && i < 5; x = x.cause, i++) if (x.code === "NETGUARD_BLOCKED") return true; return false; };

console.log(`node ${process.version}; guard installed=${Boolean(state)}; NODE_OPTIONS has guard=${(process.env.NODE_OPTIONS ?? "").includes("verify-netguard-full.mjs")}`);

async function expectBlocked(name, fn) {
  const before = state.blocked;
  let err = null;
  try { const r = fn(); if (r && typeof r.then === "function") await r; } catch (e) { err = e; }
  ok(`${name} blocked`, err && isBlockErr(err) && state.blocked === before + 1, `err=${err?.message} delta=${state.blocked - before}`);
}

// ---- the 8 exits (+ split request/get)
await expectBlocked("1 fetch", () => fetch(`https://${R}/x`));
await expectBlocked("2a http.request", () => http.request({ host: R, port: 80, path: "/" }));
await expectBlocked("2b http.get", () => http.get(`http://${R}/`));
await expectBlocked("3a https.request", () => https.request(`https://${R}/`));
await expectBlocked("3b https.get", () => https.get({ hostname: R, port: 443 }));
await expectBlocked("4 net.connect", () => net.connect(443, R));
await expectBlocked("5 net.createConnection", () => net.createConnection({ host: R, port: 443 }));
await expectBlocked("6 net.Socket.prototype.connect", () => new net.Socket().connect({ host: R, port: 443 }));
await expectBlocked("7 tls.connect", () => tls.connect({ host: R, port: 443, servername: "example.invalid" }));
await expectBlocked("8 http.ClientRequest via agent (socket layer)", () => new http.ClientRequest({ host: R, port: 80 }));
await expectBlocked("9 hostname with port / uppercase", () => net.connect({ host: `${R}`, port: 8080 }));

// ---- script replaces fetch and restores (worst case: restores the native fetch)
{
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("script mock"); };
  globalThis.fetch = saved;
  await expectBlocked("10 fetch after replace + restore", () => globalThis.fetch(`https://${R}/`));
  globalThis.fetch = state.nativeFetch;
  await expectBlocked("11 native fetch (undici socket layer)", () => globalThis.fetch(`https://${R}/`));
  globalThis.fetch = saved;
}

// ---- localhost allowed
{
  const server = http.createServer((req, res) => res.end("ok"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const before = state.blocked;
  const body1 = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  const body2 = await (await fetch(`http://localhost:${port}/`).catch(() => ({ text: async () => "localhost-unresolved" }))).text();
  const body3 = await new Promise((r, j) => http.get({ host: "127.0.0.1", port }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => r(d)); }).on("error", j));
  const sockOk = await new Promise((r) => { const s = net.connect(port, "127.0.0.1", () => { s.end(); r(true); }); s.on("error", () => r(false)); });
  const v6 = await new Promise((r) => { try { const s = net.connect(1, "::1"); s.on("error", () => r("error-not-blocked")); s.on("connect", () => { s.end(); r("connected"); }); } catch (e) { r(isBlockErr(e) ? "BLOCKED" : "threw " + e.message); } });
  ok("12 localhost / 127.0.0.1 / ::1 allowed", body1 === "ok" && (body2 === "ok" || body2 === "localhost-unresolved") && body3 === "ok" && sockOk && v6 !== "BLOCKED" && state.blocked === before,
    `b1=${body1} b2=${body2} b3=${body3} sock=${sockOk} v6=${v6} delta=${state.blocked - before}`);
  server.close();
}

// ---- child processes (NODE_OPTIONS inherited) and exit codes
{
  const c1 = spawnSync(process.execPath, ["-e", `try { require("net").connect(443, "${R}"); } catch (e) { console.log("child caught " + e.code); }`], { encoding: "utf8", timeout: 20_000 });
  ok("13 node child inherits guard, blocked>0 → exit≠0", c1.status !== 0 && /NETGUARD blocked=1/.test(c1.stderr) && /child caught NETGUARD_BLOCKED/.test(c1.stdout), `status=${c1.status} out=${c1.stdout} err=${c1.stderr}`);
  const c2 = spawnSync(process.execPath, ["-e", `try { require("https").get("https://${R}/"); } catch {} process.exit(0);`], { encoding: "utf8", timeout: 20_000 });
  ok("14 explicit process.exit(0) after a block still exits ≠0", c2.status !== 0 && /NETGUARD blocked=1/.test(c2.stderr), `status=${c2.status} err=${c2.stderr}`);
  const c3 = spawnSync(process.execPath, ["-e", "1"], { encoding: "utf8", timeout: 20_000 });
  ok("15 child with no request → exit 0, blocked=0", c3.status === 0 && /NETGUARD blocked=0/.test(c3.stderr), `status=${c3.status} err=${c3.stderr}`);
  const c4 = spawnSync(process.execPath, ["-e", `require("child_process").spawnSync(process.execPath, ["-e", 'try{require("tls").connect({host:"${R}",port:443})}catch{}'], {stdio:"inherit"})`], { encoding: "utf8", timeout: 20_000 });
  ok("16 grandchild also guarded", /NETGUARD blocked=1/.test(c4.stderr), `status=${c4.status} err=${c4.stderr}`);
  const env = { ...process.env, NODE_OPTIONS: "" };
  const t0 = Date.now();
  const c5 = spawnSync(process.execPath, [GUARD], { encoding: "utf8", timeout: 20_000, env });
  ok("17 direct run exits immediately with 0", c5.status === 0 && !/NETGUARD/.test(c5.stderr) && Date.now() - t0 < 10_000, `status=${c5.status} err=${c5.stderr}`);
  const c6 = spawnSync(process.execPath, ["--input-type=module", "-e", `import "${GUARD}"; import "${GUARD}"; try { await fetch("https://${R}/"); } catch {}`], { encoding: "utf8", timeout: 20_000, env });
  ok("18 double install counts once (ESM import, no NODE_OPTIONS)", c6.status !== 0 && (c6.stderr.match(/NETGUARD blocked=/g) ?? []).length === 1 && /NETGUARD blocked=1/.test(c6.stderr), `status=${c6.status} err=${c6.stderr}`);
}

console.log(`SELFTEST pass=${pass} fail=${fails.length}${fails.length ? " → " + fails.join(", ") : ""}`);
// The blocks above were intentional; reset so this process's exit code reflects the self-test result only.
state.blocked = 0;
state.targets.length = 0;
process.exitCode = fails.length ? 1 : 0;
