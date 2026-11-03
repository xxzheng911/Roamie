#!/usr/bin/env node
/**
 * A2-T1 — P1 範圍確認探測（離線，現行程式）。
 * 目的：確認漏洞是否比任務單描述更廣，作為「發現新 P1 立即停止回報」的證據。
 *   [vuln-1a] isUnconfirmedSearchDestination 對快照自己的 destination 放行（自我信任）。
 *   [vuln-1a+] isUnconfirmedSearchDestination 對 Authority 完全不認識的標籤（無 areaCandidate）一律回 false，
 *              即使 session 沒有任何快照 → 偽造的任意城市名都能通過（比描述更廣）。
 *   [static] pushDestinationPlaceRecommendation 的 destination 取自 session 欄位且在 Credits 前無 Authority 檢查。
 * [vuln] 列 PASS＝漏洞已重現（不是功能通過）。外部網路全部攔截，任一次即 FAIL；只用 Mock Key。
 * 執行：node scripts/verify-destination-trust-boundary-a2-p1probe.mjs
 */
import { readFileSync } from "node:fs";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
for (const k of Object.keys(process.env)) if (/KEY|SECRET|TOKEN|PRIVATE|PASSWORD|SUPABASE|OPENAI|GOOGLE|WEATHER/i.test(k)) delete process.env[k];
Object.assign(process.env, { GOOGLE_MAPS_API_KEY: "mock-key", VITE_SUPABASE_URL: "http://mock-supabase.invalid", VITE_SUPABASE_PUBLISHABLE_KEY: "mock-key" });
let external = 0;
const extLog = [];
globalThis.fetch = async (u) => {
  external += 1;
  extLog.push(String(u?.url ?? u));
  throw new Error("[ext-trap] fetch blocked");
};
{
  const { createRequire } = await import("node:module");
  const require = createRequire(`${WORK_ROOT}/package.json`);
  for (const m of ["http", "https"]) {
    const mod = require(m);
    for (const fn of ["request", "get"]) {
      mod[fn] = () => {
        external += 1;
        extLog.push(`${m}.${fn}`);
        throw new Error("[ext-trap] http blocked");
      };
    }
  }
  const net = require("net");
  net.connect = net.createConnection = () => {
    external += 1;
    extLog.push("net");
    throw new Error("[ext-trap] net blocked");
  };
}
const orig = { ...console };
for (const k of ["info", "log", "warn", "debug", "error"]) console[k] = () => {};

const { createServer } = await import("vite");
const { ViteNodeServer } = await import("vite-node/server");
const { ViteNodeRunner } = await import("vite-node/client");
const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
const server = await createServer({
  root: WORK_ROOT,
  configFile: false,
  envDir: false,
  logLevel: "silent",
  clearScreen: false,
  plugins: [tsconfigPaths()],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await server.environments.client.pluginContainer.buildStart({});
const vn = new ViteNodeServer(server);
const runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
await runner.executeId("/@vite/env");
let ctd;
let loadErr = null;
try {
  ctd = await runner.executeFile(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`);
} catch (e) {
  loadErr = String(e?.stack ?? e);
}

const out = [];
const rows = [];
const P = (s) => out.push(s);
function expect(id, cond, detail, cat) {
  rows.push({ id, ok: !!cond, cat });
  P(`  ${cond ? "PASS" : "FAIL"} [${cat}] ${id}：${detail}`);
}

if (loadErr) {
  P(`載入 chat-turn-destination.ts 失敗：${loadErr.split("\n")[0]}`);
} else {
  const fn = ctd.isUnconfirmedSearchDestination;
  const empty = { messages: [] };
  P("══ isUnconfirmedSearchDestination（false＝放行進 Places／Credits）══");
  // 1a：known-parent tail（pending_provider）在無快照時應被擋（基準），快照自填同名即放行
  // 京都祇園＝Authority 已確認（精選），本來就放行，不列為漏洞樣本
  expect("1a-京都祇園-authorityConfirmed", fn("京都祇園", empty) === false, `Authority 已確認 → ${fn("京都祇園", empty)}（基準）`, "info");
  for (const label of ["台中西屯", "大阪難波"]) {
    const base = fn(label, empty);
    const forgedRec = fn(label, { ...empty, recommendationSession: { destination: label, pool: [], topic: "restaurant" } });
    const forgedActive = fn(label, { ...empty, activeRecommendationContext: { destinationName: label } });
    expect(`1a-${label}-baseline-blocked`, base === true, `無快照 → ${base}（預期 true＝擋下）`, "info");
    expect(`1a-${label}-forged-recommendationSession`, base === true && forgedRec === false, `偽造 recommendationSession.destination → ${forgedRec}（false＝自我信任放行）`, "vuln");
    expect(`1a-${label}-forged-activeRecommendationContext`, base === true && forgedActive === false, `偽造 activeRecommendationContext.destinationName → ${forgedActive}`, "vuln");
  }
  // 1a+：Authority 不認識、無 areaCandidate 的任意標籤 → 無任何快照也放行
  // 對照：known-parent tail（有 areaCandidate）在無快照時會被擋下
  expect("1a+-台中西屯區夜市一帶-tail-blocked", fn("台中西屯區夜市一帶", empty) === true, `known-parent tail 無快照 → ${fn("台中西屯區夜市一帶", empty)}（基準 true）`, "info");
  for (const label of ["亞特蘭提斯市", "Zzyzx Fakeville", "火星第三區"]) {
    const r = fn(label, empty);
    expect(`1a+-${label}-noSnapshot-passes`, r === false, `空 session、無快照 → ${r}（false＝未確認標籤仍被放行，非 Authority／Provider 確認）`, "vuln");
  }
}

P("\n══ [static] Credits 順序（靜態原始碼檢查，非執行期）══");
{
  const src = readFileSync(`${WORK_ROOT}/src/routes/_app.chat.tsx`, "utf8");
  const start = src.indexOf("const pushDestinationPlaceRecommendation = useCallback(");
  const end = src.indexOf("useCallback(", start + 60);
  const body = src.slice(start, end);
  const credit = body.indexOf("beginPlaceRecommendationCredits(");
  const destDecl = body.indexOf("resolveConversationDestination(placeCtx, activeSession)");
  const pre = body.slice(0, credit);
  const guards = ["isUnconfirmedSearchDestination", "confirmedContextDestination", "resolveCategoryTurnDestination", "validateCategoryTurnDestination", "resolveDestination(", "resolveTrustedRecommendationSearchScope"].filter((g) => pre.includes(g));
  expect("static-destination_places-credits-before-any-authority", start > 0 && credit > destDecl && destDecl > 0 && guards.length === 0, `destination 來自 resolveConversationDestination(session.travelContext／tripPlanningContext／tripDestination／preferredArea)；Credits 前的確認呼叫=${JSON.stringify(guards)}`, "vuln-static");
}

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();
const vuln = rows.filter((r) => r.cat.startsWith("vuln"));
P(`\n[vuln] 重現成立=${vuln.filter((r) => r.ok).length}/${vuln.length}`);
P(`external=${external}${external ? ` ${extLog.join(";")}` : ""}`);
P(`verify-destination-trust-boundary-a2-p1probe: ${loadErr || external ? "FAIL" : "DONE"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(loadErr || external ? 1 : 0);
