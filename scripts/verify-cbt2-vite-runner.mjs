#!/usr/bin/env node
/**
 * CB-T2 — 以 vite-node API 執行使用者指定的 vite-node 類回歸腳本（每支一個子行程、依序執行）。
 * 等同 `vite-node --config scripts/vite.verify.config.mjs <script>`（tsconfigPaths plugin、watch:null），差異只在更嚴格的離線保護：
 *  - configFile:false / envDir:false（不載入 .env）；子行程 env 刪除 KEY/SECRET/TOKEN… 並注入 mock key。
 *  - 攔截 fetch / XMLHttpRequest / http(s) / net / tls；任何外部請求計數，>0 即 FAIL。
 * 不修改任何檔案。執行：node scripts/verify-cbt2-vite-runner.mjs
 */
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const SELF = `${WORK_ROOT}/scripts/verify-cbt2-vite-runner.mjs`;
const TARGETS = [
  "scripts/verify-continue-recommendation-intent.mjs",
  "scripts/verify-continuation-dedupe-visibility.mjs",
  "scripts/verify-credits.mjs",
  "scripts/verify-credits-greeting-lifecycle.mjs",
  "scripts/verify-destination-resolution-phase1.mjs",
  "scripts/verify-destination-resolution-phase1-r2.mjs",
  "scripts/verify-destination-resolution-phase1-r3.mjs",
  "scripts/verify-destination-resolution-phase2-step0.mjs",
  "scripts/verify-destination-resolution-phase2-step0-r2.mjs",
];
const childTarget = process.env.CBT2_RUNNER_TARGET;

if (childTarget) {
  for (const k of Object.keys(process.env)) if (/KEY|SECRET|TOKEN|PRIVATE|PASSWORD|SUPABASE|OPENAI|GOOGLE|WEATHER/i.test(k)) delete process.env[k];
  Object.assign(process.env, { GOOGLE_MAPS_API_KEY: "mock-key", VITE_SUPABASE_URL: "http://mock-supabase.invalid", VITE_SUPABASE_PUBLISHABLE_KEY: "mock-key" });
  let external = 0;
  const ext = [];
  const trap = (kind, d) => {
    external += 1;
    ext.push(`${kind}:${String(d).slice(0, 100)}`);
    throw new Error(`[cbt2-ext-trap] ${kind} blocked`);
  };
  const { createRequire } = await import("node:module");
  const require = createRequire(`${WORK_ROOT}/package.json`);
  const realFetchTrap = async (u) => trap("fetch", u?.url ?? u);
  globalThis.fetch = realFetchTrap;
  globalThis.XMLHttpRequest = class {
    open(m, u) {
      trap("xhr", u);
    }
    send() {}
    setRequestHeader() {}
  };
  for (const m of ["http", "https"]) {
    const mod = require(m);
    mod.request = (a) => trap(m, a?.href ?? a?.hostname ?? a);
    mod.get = (a) => trap(m, a?.href ?? a?.hostname ?? a);
  }
  const net = require("net");
  net.connect = net.createConnection = (a) => trap("net", a?.host ?? a);
  require("tls").connect = (a) => trap("tls", a?.host ?? a);

  const { createServer } = await import("vite");
  const { ViteNodeServer } = await import("vite-node/server");
  const { ViteNodeRunner } = await import("vite-node/client");
  const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
  const server = await createServer({
    root: WORK_ROOT,
    configFile: false,
    envDir: false,
    logLevel: "warn",
    clearScreen: false,
    plugins: [tsconfigPaths()],
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.environments.client.pluginContainer.buildStart({});
  const vn = new ViteNodeServer(server);
  const runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
  await runner.executeId("/@vite/env");
  let thrown = null;
  const realExit = process.exit.bind(process);
  const finish = (code) => {
    process.stdout.write(`\n@@CBT2@@ target=${childTarget} exitCode=${code ?? 0} thrown=${thrown ? JSON.stringify(String(thrown)).slice(0, 300) : "none"} external=${external}${external ? ` ${ext.join(";")}` : ""}\n`);
    realExit(external ? 1 : (code ?? 0));
  };
  process.exit = (code) => finish(code ?? process.exitCode ?? 0);
  try {
    await runner.executeFile(`${WORK_ROOT}/${childTarget}`);
  } catch (e) {
    thrown = e?.stack ?? e;
    process.exitCode = 1;
  }
  await new Promise((r) => setTimeout(r, 50));
  await server.close();
  finish(process.exitCode ?? 0);
} else {
  const { spawnSync } = await import("node:child_process");
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const list = only ? TARGETS.filter((t) => t.includes(only)) : TARGETS;
  const summary = [];
  for (const t of list) {
    const r = spawnSync(process.execPath, [SELF], { cwd: WORK_ROOT, env: { ...process.env, CBT2_RUNNER_TARGET: t }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 1200000 });
    const outText = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const lines = Number(process.argv.find((a) => a.startsWith("--lines="))?.slice(8) ?? 14);
    const tail = (r.stdout ?? "").trim().split("\n").slice(-lines).join("\n");
    process.stdout.write(`\n════ ${t}（status=${r.status} signal=${r.signal ?? "-"}）════\n${tail}\n`);
    const tag = outText.match(/@@CBT2@@ .*/)?.[0] ?? "(no tag)";
    summary.push(`${r.status === 0 ? "PASS" : "FAIL"} ${t} :: ${tag}`);
  }
  process.stdout.write(`\n════ 摘要 ════\n${summary.join("\n")}\n`);
  process.exit(summary.every((s) => s.startsWith("PASS")) ? 0 : 1);
}
