/**
 * Full network guard for verify scripts. Import it FIRST in a verify script:
 *   import "./verify-netguard-full.mjs";
 * On import it blocks (throws + counts) every outbound connection to a non-local host through:
 *   globalThis.fetch, http.request, http.get, https.request, https.get,
 *   net.connect, net.createConnection, net.Socket.prototype.connect, tls.connect.
 * Only localhost / 127.0.0.1 / ::1 (and IPC socket paths) are allowed.
 * The socket layer (net.Socket.prototype.connect / tls.connect / net.connect) is what Node's built-in
 * fetch (undici) and http(s) agents use, so a script that replaces globalThis.fetch and later restores a
 * saved native fetch is still guarded.
 * Child processes: NODE_OPTIONS gets `--import=<this file>` so node children (npx vite-node …) load the
 * same guard. Native children (git, esbuild, workerd) are NOT covered.
 * On exit: prints `NETGUARD blocked=<n>` to stderr; n>0 makes the exit code non-zero.
 * Running this file directly exits immediately.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const SELF_PATH = fileURLToPath(import.meta.url);
const directRun = (() => {
  try { return Boolean(process.argv[1]) && resolve(process.argv[1]) === SELF_PATH; } catch { return false; }
})();
if (directRun) process.exit(0);

const KEY = Symbol.for("roamie.verify.netguard-full");
if (!globalThis[KEY]) {
  const state = { blocked: 0, targets: [], nativeFetch: globalThis.fetch, originals: {} };
  globalThis[KEY] = state;

  const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
  const normHost = (h) => {
    if (h === undefined || h === null || h === "") return "localhost"; // Node default
    let s = String(h).trim().toLowerCase();
    if (s.startsWith("[")) s = s.slice(1, s.indexOf("]") > 0 ? s.indexOf("]") : undefined);
    else if (/^[^:]+:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":")); // host:port
    return s;
  };
  const isLocalHost = (h) => LOCAL.has(normHost(h));
  const block = (kind, target) => {
    state.blocked++;
    if (state.targets.length < 20) state.targets.push(`${kind} ${String(target).slice(0, 160)}`);
    const e = new Error(`NETGUARD blocked ${kind} ${target}`);
    e.code = "NETGUARD_BLOCKED";
    throw e;
  };

  // ---- fetch
  const origFetch = globalThis.fetch;
  if (typeof origFetch === "function") {
    globalThis.fetch = function guardedFetch(input, init) {
      let url;
      try { url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input?.url ?? String(input)); } catch { url = null; }
      if (!url || !isLocalHost(url.hostname)) {
        try { block("fetch", url ? url.href : String(input?.url ?? input)); } catch (e) { return Promise.reject(e); }
      }
      return origFetch.call(this, input, init);
    };
  }

  // ---- http / https request + get
  const httpTarget = (args) => {
    const [a, b] = args;
    let host;
    let socketPath;
    if (typeof a === "string" || a instanceof URL) {
      try { host = new URL(String(a)).hostname; } catch { host = String(a); }
      if (b && typeof b === "object" && typeof b !== "function") {
        if (b.hostname || b.host) host = b.hostname ?? b.host;
        socketPath = b.socketPath;
      }
    } else if (a && typeof a === "object") {
      host = a.hostname ?? a.host;
      socketPath = a.socketPath;
    }
    return { host, socketPath };
  };
  for (const [name, mod] of [["http", http], ["https", https]]) {
    for (const fn of ["request", "get"]) {
      const orig = mod[fn];
      state.originals[`${name}.${fn}`] = orig;
      mod[fn] = function guardedHttp(...args) {
        const { host, socketPath } = httpTarget(args);
        if (!socketPath && !isLocalHost(host)) block(`${name}.${fn}`, host);
        return orig.apply(this, args);
      };
    }
  }

  // ---- net / tls
  const netTarget = (args) => {
    let a = args[0];
    if (Array.isArray(a)) a = a[0]; // internal normalized args
    if (a && typeof a === "object") return { host: a.host, path: a.path, socket: a.socket };
    if (typeof a === "number" || (typeof a === "string" && /^\d+$/.test(a))) return { host: typeof args[1] === "string" ? args[1] : undefined };
    if (typeof a === "string") return { path: a };
    return { host: undefined };
  };
  const guardNet = (kind, orig) => function guardedNet(...args) {
    const t = netTarget(args);
    if (!t.path && !(t.socket && t.host === undefined) && !isLocalHost(t.host)) block(kind, t.host);
    return orig.apply(this, args);
  };
  state.originals["net.connect"] = net.connect;
  state.originals["net.createConnection"] = net.createConnection;
  state.originals["net.Socket.prototype.connect"] = net.Socket.prototype.connect;
  state.originals["tls.connect"] = tls.connect;
  net.connect = guardNet("net.connect", net.connect);
  net.createConnection = guardNet("net.createConnection", net.createConnection);
  net.Socket.prototype.connect = guardNet("net.Socket.prototype.connect", net.Socket.prototype.connect);
  tls.connect = function guardedTls(...args) {
    let host;
    let socket;
    const a = args[0];
    if (a && typeof a === "object") { host = a.host; socket = a.socket; }
    else if (typeof a === "number" || typeof a === "string") {
      host = typeof args[1] === "string" ? args[1] : undefined;
      const opt = args.find((x, i) => i > 0 && x && typeof x === "object");
      if (host === undefined && opt) { host = opt.host; socket = opt.socket; }
    }
    if (!(socket && host === undefined) && !isLocalHost(host)) block("tls.connect", host);
    return state.originals["tls.connect"].apply(this, args);
  };

  // ---- node children inherit the guard
  const flag = `--import=${pathToFileURL(SELF_PATH).href}`;
  const cur = process.env.NODE_OPTIONS ?? "";
  if (!cur.includes(flag)) process.env.NODE_OPTIONS = `${cur} ${flag}`.trim();

  process.on("exit", (code) => {
    for (const t of state.targets) process.stderr.write(`NETGUARD target ${t}\n`);
    process.stderr.write(`NETGUARD blocked=${state.blocked}\n`);
    if (state.blocked > 0 && !code) process.exitCode = 97;
  });
}

export const netguardState = () => globalThis[KEY];
