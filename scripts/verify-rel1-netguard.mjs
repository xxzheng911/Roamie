// REL-1 回歸：預載的網路防護（透過 NODE_OPTIONS=--import 注入子程序）。
// 只允許 loopback 與 unix socket；其他連線一律在連線前拒絕，並記錄到 REL1_NETGUARD_LOG。
// 本檔不是獨立驗證腳本，直接執行時只做自我檢查。
import net from "node:net";
import dns from "node:dns";
import { appendFileSync } from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const LOG = process.env.REL1_NETGUARD_LOG;
const record = (kind, detail) => {
  const line = `[REL1-NETGUARD] ${kind} ${detail}`;
  try {
    process.stderr.write(line + "\n");
  } catch {}
  if (LOG) {
    try {
      appendFileSync(LOG, `${process.pid}\t${kind}\t${detail}\n`);
    } catch {}
  }
};

const isLoopback = (h) => {
  if (h === undefined || h === null || h === "") return true; // net 預設 localhost
  const s = String(h).toLowerCase().replace(/^\[|\]$/g, "");
  return s === "localhost" || s === "::1" || s === "0.0.0.0" || s === "::" || /^127\./.test(s) || s.endsWith(".localhost");
};

const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function patchedConnect(...args) {
  let opts = args[0];
  if (Array.isArray(opts)) opts = opts[0];
  let host;
  let isPipe = false;
  if (opts && typeof opts === "object") {
    if (opts.path) isPipe = true;
    host = opts.host ?? opts.hostname;
  } else if (typeof opts === "number" || (typeof opts === "string" && /^\d+$/.test(opts))) {
    host = typeof args[1] === "string" ? args[1] : undefined;
  } else if (typeof opts === "string") {
    isPipe = true;
  }
  if (!isPipe && !isLoopback(host)) {
    record("BLOCK-CONNECT", String(host));
    const err = new Error(`REL1 netguard blocked outbound connection to ${host}`);
    err.code = "ECONNREFUSED";
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return origConnect.apply(this, args);
};

const blockLookup = (orig) =>
  function patchedLookup(hostname, ...rest) {
    if (!isLoopback(hostname)) {
      record("BLOCK-DNS", String(hostname));
      const cb = rest.find((x) => typeof x === "function");
      const err = Object.assign(new Error(`REL1 netguard blocked DNS lookup ${hostname}`), { code: "ENOTFOUND", hostname });
      if (cb) {
        process.nextTick(() => cb(err));
        return {};
      }
      throw err;
    }
    return orig.call(this, hostname, ...rest);
  };
dns.lookup = blockLookup(dns.lookup);
if (dns.promises?.lookup) {
  const origP = dns.promises.lookup;
  dns.promises.lookup = async (hostname, ...rest) => {
    if (!isLoopback(hostname)) {
      record("BLOCK-DNS", String(hostname));
      throw Object.assign(new Error(`REL1 netguard blocked DNS lookup ${hostname}`), { code: "ENOTFOUND", hostname });
    }
    return origP(hostname, ...rest);
  };
}

// 觀察（不阻擋）非 node 的子程序，例如 Chrome、git、curl。
for (const name of ["spawn", "spawnSync", "execFile", "execFileSync"]) {
  const orig = childProcess[name];
  childProcess[name] = function observed(cmd, ...rest) {
    const c = String(cmd);
    if (/(^|\/)(curl|wget|nc|ssh|scp|supabase|wrangler)$/.test(c)) {
      record("BLOCK-SPAWN", c);
      throw new Error(`REL1 netguard blocked spawning ${c}`);
    }
    if (!/(^|\/)node$/.test(c) && !c.endsWith("vite-node")) record("SPAWN", c);
    // Chrome 不受本程序的 net 修補影響：強制所有非 loopback 流量走不存在的 proxy（loopback 預設不經 proxy），
    // CDP Fetch 攔截在 proxy 之前，故腳本自行 fulfill 的請求不受影響。
    if (/chrome|chromium/i.test(c) && Array.isArray(rest[0])) {
      rest[0] = [...rest[0], "--proxy-server=http://127.0.0.1:9", "--disable-background-networking"];
      record("CHROME-PROXY-GUARD", c);
    }
    return orig.call(this, cmd, ...rest);
  };
}

syncBuiltinESMExports();

if (import.meta.url === `file://${process.argv[1]}`) {
  await fetch("https://example.com/").then(
    () => console.log("self-check FAIL: fetch was not blocked"),
    (e) => console.log(`self-check fetch blocked: ${e.cause?.message ?? e.message}`),
  );
  const sock = net.connect({ host: "example.com", port: 443 });
  sock.on("error", (e) => {
    console.log(`self-check ok: ${e.message}`);
  });
}
