/**
 * Preload for scripts/verify-a8-regression.mjs children (NODE_OPTIONS=--import): blocks and counts
 * outbound fetch / http(s).request to non-local hosts and prints the count on exit.
 * Not a standalone check; it exits immediately when run directly.
 */
import http from "node:http";
import https from "node:https";

if (process.argv[1]?.endsWith("verify-a8-netguard.mjs")) process.exit(0);

let blocked = 0;
const isLocal = (u) => /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(String(u ?? ""));
const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!isLocal(url)) {
    blocked++;
    throw new Error("NETGUARD blocked " + url);
  }
  return origFetch(input, init);
};
for (const mod of [http, https]) {
  const orig = mod.request;
  mod.request = function guarded(...args) {
    const a = args[0];
    const host = typeof a === "string" || a instanceof URL ? new URL(String(a)).hostname : a?.hostname ?? a?.host;
    if (host && !isLocal(`http://${host}`)) {
      blocked++;
      throw new Error("NETGUARD blocked " + host);
    }
    return orig.apply(this, args);
  };
}
process.on("exit", () => {
  process.stderr.write(`@@NETGUARD blocked=${blocked}@@\n`);
});
