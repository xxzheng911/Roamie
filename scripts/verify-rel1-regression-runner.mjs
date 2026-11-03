#!/usr/bin/env node
// REL-1 上線前回歸：依序執行 scripts/verify-*.mjs（排除需外部請求／密鑰／build 的腳本），
// 每個子程序都預載 verify-rel1-netguard.mjs（阻擋非 loopback 連線、Chrome 強制走不存在的 proxy），
// 並移除環境中看起來像密鑰的變數。記錄寫到 scratchpad。執行前後比對 git 工作區，確保沒有改到 repo。
//
// 用法：node scripts/verify-rel1-regression-runner.mjs --out=<dir> [--only=a,b] [--browser=only|skip|include]
//       [--concurrency=6] [--timeout=600000]
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
// --root=<dir>：在 HEAD 基準快照（verify-rel1-head-snapshot.mjs 產生）中執行；repo 未變動檢查仍針對主工作區。
const root = arg("root") ? resolve(arg("root")) : repoRoot;
const OUT = arg("out");
if (!OUT) throw new Error("--out=<dir> required");
mkdirSync(resolve(OUT, "logs"), { recursive: true });
let ONLY = arg("only") ? new Set(arg("only").split(",").map((s) => (s.endsWith(".mjs") ? s : `${s}.mjs`))) : null;
// --from-results=<results.json>：只重跑上一輪狀態屬於 --rerun-status（預設 FAIL,TIMEOUT）的腳本
if (arg("from-results")) {
  const want = new Set(arg("rerun-status", "FAIL,TIMEOUT").split(","));
  ONLY = new Set(
    JSON.parse(readFileSync(resolve(arg("from-results")), "utf8"))
      .filter((r) => want.has(r.status))
      .map((r) => r.file),
  );
}
// --skip-listed=<另一輪 runner 的 stdout 檔>：略過該輪已回報結果的腳本（用於接續一輪卡住的執行）
if (arg("skip-listed") && ONLY) {
  const done = new Set([...readFileSync(resolve(arg("skip-listed")), "utf8").matchAll(/(verify-[\w.-]+\.mjs)/g)].map((m) => m[1]));
  ONLY = new Set([...ONLY].filter((f) => !done.has(f)));
}
const BROWSER = arg("browser", "skip");
const CONC = Number(arg("concurrency", "6"));
const TIMEOUT = Number(arg("timeout", "600000"));
const GUARD = resolve(repoRoot, "scripts/verify-rel1-netguard.mjs");
const NETLOG = resolve(OUT, "netguard.log");

// ---------- 不執行清單（附原因） ----------
const SKIP = {
  // 需使用者執行：真實外部 API 或 staging 憑證
  "verify-trip-workspace-rls.mjs": ["USER", "讀 staging Supabase 帳密（~/.roamie-staging-test.env），對 staging DB 做 RLS 實測"],
  "verify-destination-global-e2e.mjs": ["USER", "以 GOOGLE_MAPS_API_KEY 打真實 Google Places/Geocoding"],
  "verify-destination-provider-smoke.mjs": ["USER", "以 GOOGLE_MAPS_API_KEY 打真實 Google Places"],
  "verify-itinerary-live-api.mjs": ["USER", "以 Google server key 打真實 Google API"],
  "verify-unsplash-proxy.mjs": ["USER", "會讀取 repo 根目錄 .env（UNSPLASH_ACCESS_KEY）"],
  "verify-google-client-bundle.mjs": ["OPS", "postbuild 腳本：讀 .env/.dev.vars 並掃 dist，需先 build"],
  // 需 ops build 後執行
  "verify-google-maps-client-split.mjs": ["OPS", "內部執行 npm run build 並刪除 dist/、ios/App/App/public"],
  "verify-release-artifacts.mjs": ["OPS", "需最新 dist/，postbuild 時會寫 dist/release-receipt.json"],
  "verify-release-contract.mjs": ["OPS", "需最新 dist/ 與 release receipt"],
  "verify-ios-boot-bundle.mjs": ["OPS", "需最新 dist/ 與 ios/App/App/public（cap sync 後）"],
  // 產生器：會覆寫其他 verify 腳本
  "verify-destination-authority-phase2-r6-build.mjs": ["GEN", "產生器，會覆寫 scripts/verify-destination-authority-phase2-r6.mjs"],
  "verify-destination-authority-phase2-r7-build.mjs": ["GEN", "產生器，會覆寫 r7"],
  "verify-destination-authority-phase2-r8-build.mjs": ["GEN", "產生器，會覆寫 r8"],
  "verify-destination-authority-phase2-r9-build.mjs": ["GEN", "產生器，會覆寫 r9"],
  "verify-destination-authority-phase2-r10-build.mjs": ["GEN", "產生器，會覆寫 r10"],
  "verify-destination-authority-phase2-r11-build.mjs": ["GEN", "產生器，會覆寫 r11"],
};

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const npmByFile = new Map();
for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
  for (const m of String(cmd).matchAll(/scripts\/(verify-[\w.-]+\.mjs)/g)) if (!npmByFile.has(m[1])) npmByFile.set(m[1], { name, cmd });
}

const bin = (b) => resolve(root, "node_modules/.bin", b);
function invocation(file, src) {
  // --invoke=node：強制以 node 直接執行（檔頭指定 node、內部自行建立 vite-node 的腳本）
  // --script-args=a,b：附加在腳本後的參數（例如只跑某一節的 --t8-only；結果須標示為部分驗證）
  const extra = arg("script-args") ? arg("script-args").split(",") : [];
  if (arg("invoke") === "node") return { cmd: process.execPath, args: [`scripts/${file}`, ...extra], via: `node(指定)${extra.length ? ` ${extra.join(" ")}` : ""}` };
  const npm = npmByFile.get(file);
  if (npm) {
    // 取 npm 指令中負責此腳本的片段
    const seg = String(npm.cmd)
      .split(/&&|;/)
      .map((s) => s.trim())
      .find((s) => s.includes(`scripts/${file}`));
    const t = seg.split(/\s+/);
    if (t[0] === "vite-node") return { cmd: bin("vite-node"), args: t.slice(1), via: `npm:${npm.name}` };
    if (t[0] === "node") return { cmd: process.execPath, args: t.slice(1), via: `npm:${npm.name}` };
    if (t[0] === "tsx") return { cmd: bin("tsx"), args: t.slice(1), via: `npm:${npm.name}` };
  }
  const header = src.split("\n").slice(0, 60).join("\n");
  const wantsViteNode =
    /vite-node/.test(header) ||
    /^\s*import[^;]*from\s+["'](\.\.\/src\/|@\/)/m.test(src) ||
    /await import\(\s*["'](\.\.\/src\/|@\/)[^"']*\.tsx?["']\s*\)/.test(src);
  if (wantsViteNode)
    return { cmd: bin("vite-node"), args: ["--config", "scripts/vite.verify.config.mjs", `scripts/${file}`], via: "vite-node(推定)" };
  return { cmd: process.execPath, args: [`scripts/${file}`], via: "node" };
}

// 從檔頭註解抽出作者寫的執行方式（例如「執行：node --experimental-strip-types scripts/x.mjs」）。
function headerInvocations(file, src) {
  const out = [];
  for (const raw of src.split("\n").slice(0, 120)) {
    if (!raw.includes(`scripts/${file}`)) continue;
    const m = raw.match(/((?:npx\s+)?(?:vite-node|node|tsx)\b[^\n（(]*?scripts\/[\w.-]+\.mjs[^\n（(]*)/);
    if (!m) continue;
    let t = m[1].trim().split(/\s+/).filter((x) => x !== "npx");
    if (t.some((x) => /[<>]|^\.\.\.$/.test(x))) continue;
    // 只接受「完整驗證」的執行方式；--dump-baseline／--emit-diff／--self-test／--t6-only 等模式旗標不是驗證，略過。
    const script = t.findIndex((x) => x.includes(`scripts/${file}`));
    const flags = t.filter((x, i) => x.startsWith("--") && !(i > 0 && t[i - 1] === "--config"));
    if (flags.some((x) => !/^--(config|experimental-strip-types|no-warnings)$/.test(x)) || script < 0) continue;
    t = t.filter((x) => !/^[`'"]$/.test(x)).map((x) => x.replace(/[`'"，。；;]+$/g, ""));
    let [c, ...rest] = t;
    // vite-node 會把腳本路徑之後的參數當成腳本參數；檔頭常寫「vite-node scripts/x.mjs --config …」，
    // 這樣會改用預設 vite.config.ts（含 TanStack Start）而不結束。把 --config 移到腳本之前。
    if (c === "vite-node") {
      const ci = rest.indexOf("--config");
      const si = rest.findIndex((x) => x.startsWith("scripts/"));
      if (ci > si && si >= 0 && rest[ci + 1]) {
        const cfg = rest.splice(ci, 2);
        rest.splice(si, 0, ...cfg);
      }
      if (!rest.includes("--config")) rest = ["--config", "scripts/vite.verify.config.mjs", ...rest];
    }
    const cmd = c === "vite-node" ? bin("vite-node") : c === "tsx" ? bin("tsx") : process.execPath;
    out.push({ cmd, args: rest, via: `header:${c} ${rest.filter((x) => x.startsWith("-")).join(" ")}`.trim() });
  }
  return out;
}

function childEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|SERVICE_ROLE|STAGING|SUPABASE|OPENAI|GOOGLE|UNSPLASH|REVENUECAT|APPLE|CLOUDFLARE|WRANGLER|AWS_|GH_|GITHUB/i.test(k)) continue;
    env[k] = v;
  }
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import=${GUARD}`.trim();
  env.REL1_NETGUARD_LOG = NETLOG;
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  return env;
}

function snapshotRepo() {
  const status = execFileSync("git", ["status", "--porcelain=v1", "-uall", "-z"], { cwd: repoRoot, maxBuffer: 1 << 28 }).toString();
  const h = createHash("sha256").update(status);
  const perFile = new Map();
  for (const entry of status.split("\0").filter(Boolean)) {
    const p = resolve(repoRoot, entry.slice(3));
    try {
      if (existsSync(p)) {
        const body = readFileSync(p);
        h.update(entry).update(body);
        perFile.set(entry.slice(3), createHash("sha256").update(body).digest("hex"));
      }
    } catch {}
  }
  return { digest: h.digest("hex"), status, perFile };
}

const files = readdirSync(resolve(root, "scripts"))
  .filter((f) => /^verify-.*\.mjs$/.test(f) && !f.startsWith("verify-rel1-"))
  .filter((f) => !ONLY || ONLY.has(f))
  .sort();

const isBrowser = (src) => /Google Chrome|remote-debugging|playwright|puppeteer/.test(src);

const queue = [];
const results = [];
for (const f of files) {
  const src = readFileSync(resolve(root, "scripts", f), "utf8");
  if (SKIP[f]) {
    results.push({ file: f, status: `SKIP-${SKIP[f][0]}`, reason: SKIP[f][1] });
    continue;
  }
  const browser = isBrowser(src);
  if ((BROWSER === "skip" && browser) || (BROWSER === "only" && !browser)) continue;
  queue.push({ file: f, browser, inv: invocation(f, src), headerInvs: headerInvocations(f, src) });
}

function runOne(job, inv) {
  return new Promise((done) => {
    const started = Date.now();
    const logPath = resolve(OUT, "logs", `${job.file}.log`);
    writeFileSync(logPath, `$ ${inv.cmd} ${inv.args.join(" ")}  (${inv.via})\n`);
    const child = spawn(inv.cmd, inv.args, { cwd: root, env: childEnv(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const onData = (d) => {
      appendFileSync(logPath, d);
      tail = (tail + d.toString()).slice(-6000);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, job.browser ? Math.max(TIMEOUT, 1_800_000) : TIMEOUT);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      try {
        process.kill(-child.pid, "SIGKILL"); // 清掉殘留的孫程序（vite server、Chrome）
      } catch {}
      done({ code, signal, timedOut, ms: Date.now() - started, tail, logPath });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ code: -1, signal: null, timedOut: false, ms: Date.now() - started, tail: String(e), logPath });
    });
  });
}

const needsViteNodeRetry = (tail) =>
  /ERR_UNKNOWN_FILE_EXTENSION|Cannot find package '@\/|Cannot find module '@\/|ERR_MODULE_NOT_FOUND[\s\S]*\.ts|Unknown file extension "\.tsx?"/.test(tail);

async function exec(job) {
  let r = await runOne(job, job.inv);
  let via = job.inv.via;
  if (r.code !== 0 && !r.timedOut && job.inv.via === "node" && needsViteNodeRetry(r.tail)) {
    const inv = { cmd: bin("vite-node"), args: ["--config", "scripts/vite.verify.config.mjs", `scripts/${job.file}`], via: "vite-node(重試)" };
    r = await runOne(job, inv);
    via = inv.via;
  }
  // 失敗且未經 npm 指定時，改用檔頭寫的執行方式重試（避免把「執行方式不對」誤判為失敗）
  if (r.code !== 0 && !r.timedOut && !job.inv.via.startsWith("npm:")) {
    const tried = new Set([`${job.inv.cmd} ${job.inv.args.join(" ")}`]);
    for (const inv of job.headerInvs ?? []) {
      const key = `${inv.cmd} ${inv.args.join(" ")}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const r2 = await runOne(job, inv);
      const loaderProblem = /Cannot find module|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|Unknown file extension|SyntaxError/.test(r.tail);
      if (r2.code === 0 || loaderProblem) {
        r = r2;
        via = inv.via;
      }
      if (r2.code === 0) break;
    }
  }
  const netBlocked = existsSync(NETLOG)
    ? readFileSync(NETLOG, "utf8")
        .split("\n")
        .filter((l) => /BLOCK/.test(l))
    : [];
  const counts = [...r.tail.matchAll(/(\d+)\s*\/\s*(\d+)/g)].map((m) => `${m[1]}/${m[2]}`).slice(-3);
  const pf = r.tail.match(/(?:passed|PASS(?:ED)?)[^\n\d]{0,12}(\d+)[^\n]{0,40}?(?:failed|FAIL(?:ED)?)[^\n\d]{0,12}(\d+)/i);
  const status = r.timedOut ? "TIMEOUT" : r.code === 0 ? "PASS" : "FAIL";
  const res = {
    file: job.file,
    status,
    code: r.code,
    signal: r.signal,
    via,
    ms: r.ms,
    counts,
    passFail: pf ? `${pf[1]}/${pf[2]}` : null,
    tail: r.tail.split("\n").filter(Boolean).slice(-15).join("\n"),
    log: r.logPath,
    netBlockedSoFar: netBlocked.length,
  };
  results.push(res);
  console.log(`${status.padEnd(7)} ${String(Math.round(r.ms / 1000)).padStart(4)}s ${job.file} ${via} ${counts.join(" ")}`);
}

const before = snapshotRepo();
writeFileSync(resolve(OUT, "repo-before.txt"), before.status.replaceAll("\0", "\n"));

const conc = BROWSER === "only" ? 1 : CONC;
const browserJobs = queue.filter((j) => j.browser);
const plainJobs = queue.filter((j) => !j.browser);
async function pool(jobs, n) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, jobs.length) }, async () => {
      while (i < jobs.length) await exec(jobs[i++]);
    }),
  );
}
await pool(plainJobs, conc);
await pool(browserJobs, 1);

const after = snapshotRepo();
writeFileSync(resolve(OUT, "repo-after.txt"), after.status.replaceAll("\0", "\n"));
results.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(resolve(OUT, "results.json"), JSON.stringify(results, null, 1));
const tally = {};
for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
console.log(`\nREPO-UNCHANGED=${before.digest === after.digest}`);
console.log(`TALLY ${JSON.stringify(tally)}`);
if (before.digest !== after.digest) {
  const b = new Set(before.status.split("\0"));
  const a = new Set(after.status.split("\0"));
  console.log("status diff added:", [...a].filter((x) => !b.has(x)));
  console.log("status diff removed:", [...b].filter((x) => !a.has(x)));
  const changed = [...after.perFile].filter(([f, d]) => before.perFile.get(f) !== d).map(([f]) => f);
  console.log("content changed during run:", changed);
}
