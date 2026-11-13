#!/usr/bin/env node
/**
 * 行程點數不足（Credits Insufficient）新版驗收 r2（A2-T4，tester；離線 Mock）。
 * 舊版 scripts/verify-itinerary-insufficient-credits.mjs 已由使用者裁決 SUPERSEDED（保留原檔，不修改）。
 *
 * 以執行期驗證（不是字串比對）：
 *   A. 真實 requireItineraryCredits middleware（security-middleware.ts）：Mock supabase.rpc 驅動
 *      resolve_user_plus_entitlement → credits_reserve；點數不足 → 丟 InsufficientCreditsError，且 next()（正式行程生成）不被呼叫。
 *   B. 真實 /api/generate-itinerary POST handler → 真實 generateItinerary（createServerFn 定義、InputSchema 驗證）
 *      → 真實 requireSupabaseAuth → 真實 requireItineraryCredits：HTTP 402 `{ error: "INSUFFICIENT_CREDITS" }`。
 *   C. 真實 Client：generateItineraryViaNativeApi（fetchImpl 直接接到 B 的 POST handler）與 createItineraryFromSession
 *      → INSUFFICIENT_CREDITS_ITINERARY_MESSAGE。
 *   I. Credits 隔離：feature＝ITINERARY_GENERATION、金額＝7、idempotency key 綁 userId＋requestId、Plus 不 reserve、
 *      A 使用者不足不影響 B 使用者、不出現 PLACE_RECOMMENDATION RPC；並對照 reserve 成功 → 失敗時 credits_rollback（退還）。
 *
 * Mock（已審查）：
 *   - @supabase/supabase-js createClient → Mock client（auth.getClaims／getUser 依 Bearer token 對應使用者；rpc 逐筆記錄；
 *     from(...) 逐筆記錄並回 { data: null, error: null }）。不連網。
 *   - @tanstack/react-start：createMiddleware／createServerFn 的執行期組合（模型：先 inputValidator，再依 middleware 宣告順序
 *     深度優先執行 .server，最後 handler）；handler（正式行程規劃器）以記錄器取代：被呼叫即記錄（點數不足時必須 0 次）。
 *   - @tanstack/react-start/server getRequest → 本次 Request；@tanstack/react-router createFileRoute → 回傳 route options。
 * 其餘模組（credits／errors／constants、entitlement、abuse-guard*、rate-limit、itinerary-diagnostics、analytics record、
 *   endpoint-guard、itinerary-transport、api-url、ai-itinerary-state-machine）皆為真實原始碼。
 * 安全：清除金鑰類環境變數、只用 Mock 值；攔截 fetch／http(s)／net／tls／undici，任一次 → FAIL；configFile:false、envDir:false；不寫檔。
 * 判讀：PASS／FAIL／UNVERIFIED（UNVERIFIED 不計 FAIL，但不等於 PASS）。任一 FAIL → exit 1。
 * 執行：node scripts/verify-itinerary-insufficient-credits-r2.mjs
 */
import { readFileSync } from "node:fs";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
for (const k of Object.keys(process.env)) {
  if (/KEY|SECRET|TOKEN|PRIVATE|PASSWORD|SUPABASE|OPENAI|GOOGLE|WEATHER|CREDITS|ABUSE|REVENUECAT|UNSPLASH|VISUAL_CROSSING|STRIPE/i.test(k)) delete process.env[k];
}
Object.assign(process.env, {
  SUPABASE_URL: "http://mock-supabase.invalid",
  SUPABASE_PUBLISHABLE_KEY: "mock-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "mock-service-role-key",
  VITE_SUPABASE_URL: "http://mock-supabase.invalid",
  VITE_SUPABASE_PUBLISHABLE_KEY: "mock-publishable-key",
  OPENAI_API_KEY: "mock-key",
});
let external = 0;
const extLog = [];
const trap = (kind) => (...a) => {
  external += 1;
  extLog.push(`${kind}:${String(a[0]?.url ?? a[0]?.href ?? a[0] ?? "").slice(0, 120)}`);
  throw new Error(`[ext-trap] ${kind} blocked`);
};
globalThis.fetch = async (...a) => trap("fetch")(...a);
{
  const { createRequire } = await import("node:module");
  const require = createRequire(`${WORK_ROOT}/package.json`);
  for (const m of ["http", "https"]) {
    const mod = require(m);
    mod.request = trap(`${m}.request`);
    mod.get = trap(`${m}.get`);
  }
  const net = require("net");
  net.connect = trap("net.connect");
  net.createConnection = trap("net.createConnection");
  require("tls").connect = trap("tls.connect");
  try {
    const undici = require("undici");
    for (const fn of ["request", "fetch", "stream", "pipeline", "connect", "upgrade"]) if (typeof undici[fn] === "function") undici[fn] = trap(`undici.${fn}`);
  } catch {
    /* undici 不可載入 */
  }
}
const orig = { ...console };
for (const k of ["info", "log", "debug", "error", "warn"]) console[k] = () => {};

// ════ Mock supabase（逐筆記錄）════
// Bearer token「tok-<X>」對應使用者「user-<X>」。真實 rate limiter（itinerary:<userId>:minute＝3 次／分）在同一程序內生效，
// 所以每個 POST 情境使用不同的使用者（不是繞過：限流本身不是本驗收對象，且仍以真實模組執行）。
const TOKENS = new Proxy({}, { get: (_t, k) => (typeof k === "string" && /^tok-[\w-]+$/.test(k) ? `user-${k.slice(4)}` : undefined) });
const tokenOf = (userId) => `tok-${String(userId).replace(/^user-/, "")}`;
let rpcLog = [];
let dbLog = [];
let scenario = null;
const recorderChain = (table, who) => {
  const ops = [];
  const p = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === "then") return (resolve) => {
          dbLog.push({ table, who, ops });
          resolve({ data: null, error: null });
        };
        return (...args) => {
          ops.push({ op: String(k), args });
          return p;
        };
      },
    },
  );
  return p;
};
globalThis.__R2_CLIENT = (url, key, opts) => {
  const authHeader = opts?.global?.headers?.Authorization ?? null;
  const token = authHeader?.replace(/^Bearer /, "") ?? null;
  const who = key === "mock-service-role-key" ? "service_role" : (TOKENS[token] ?? "anon");
  return {
    auth: {
      getClaims: async (t) => (TOKENS[t] ? { data: { claims: { sub: TOKENS[t] } }, error: null } : { data: null, error: { message: "invalid token" } }),
      getUser: async () => (TOKENS[token] ? { data: { user: { id: TOKENS[token], email: null } }, error: null } : { data: { user: null }, error: { message: "no user" } }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: async (name, args) => {
      rpcLog.push({ name, args: args ?? null, who });
      const handler = scenario?.rpc?.[name];
      if (handler) return handler(args, who);
      return { data: null, error: { message: `[r2] 未設定的 RPC ${name}` } };
    },
    from: (table) => recorderChain(table, who),
  };
};
let currentRequest = null;
globalThis.__R2_REQUEST = () => currentRequest;
let handlerCalls = [];
globalThis.__R2_HANDLER = async (data, context) => {
  handlerCalls.push({ destination: data?.destination ?? null, userId: context?.userId ?? null, reservation: context?.itineraryCreditReservation ?? null });
  if (scenario?.planner) return scenario.planner(data, context);
  throw new Error("[r2] 正式行程規劃器不應被呼叫");
};

const STUBS = {
  "@supabase/supabase-js": `
    export function createClient(url, key, opts) { return globalThis.__R2_CLIENT(url, key, opts); }
    export class SupabaseClient {}
  `,
  "@tanstack/react-start": `
    export function createMiddleware() {
      const m = { inner: [], serverFn: null };
      const b = { __m: m, middleware(list) { m.inner = list; return b; }, server(fn) { m.serverFn = fn; return b; }, client() { return b; }, inputValidator() { return b; }, validator() { return b; } };
      return b;
    }
    export function createServerFn() {
      const s = { mws: [], validator: null };
      const b = {
        middleware(list) { s.mws = list; return b; },
        inputValidator(fn) { s.validator = fn; return b; },
        validator(fn) { s.validator = fn; return b; },
        handler(fn) {
          const chain = [];
          const visit = (mb) => { for (const x of mb.__m.inner ?? []) visit(x); if (!chain.includes(mb.__m)) chain.push(mb.__m); };
          const call = async (args) => {
            chain.length = 0;
            for (const mb of s.mws) visit(mb);
            const data = s.validator ? s.validator(args?.data) : args?.data;
            const run = async (i, context) => {
              if (i === chain.length) return globalThis.__R2_HANDLER(data, context, fn);
              const m = chain[i];
              if (!m.serverFn) return run(i + 1, context);
              return m.serverFn({ data, context, next: (o) => run(i + 1, { ...context, ...(o?.context ?? {}) }) });
            };
            return run(0, {});
          };
          return call;
        },
      };
      return b;
    }
    export function useServerFn(fn) { return fn; }
    export function createServerOnlyFn(fn) { return fn; }
    export function createClientOnlyFn(fn) { return fn; }
    export function createIsomorphicFn() { const b = { server(fn) { b.s = fn; return b; }, client() { return b; } }; const f = (...a) => b.s?.(...a); Object.assign(f, b); return f; }
  `,
  "@tanstack/react-start/server": `
    export function getRequest() { return globalThis.__R2_REQUEST(); }
    export function getWebRequest() { return globalThis.__R2_REQUEST(); }
    export function getRequestHeader(name) { return globalThis.__R2_REQUEST()?.headers.get(name) ?? undefined; }
    export function setResponseStatus() {}
    export function setResponseHeader() {}
  `,
  "@tanstack/react-router": `
    export const createFileRoute = (path) => (opts) => ({ path, ...opts });
    export const createRootRoute = (opts) => opts;
    export const redirect = (o) => o;
    export const notFound = () => ({ notFound: true });
  `,
};
const STUB_PATH = (id) => `${WORK_ROOT}/.r2-virtual/${id.replace(/[^\w.-]/g, "_")}.mjs`;
const STUB_BY_PATH = Object.fromEntries(Object.keys(STUBS).map((k) => [STUB_PATH(k), k]));
const stubPlugin = {
  name: "r2-stubs",
  enforce: "pre",
  resolveId(id) {
    return Object.hasOwn(STUBS, id) ? STUB_PATH(id) : null;
  },
  load(id) {
    const k = STUB_BY_PATH[id.split("?")[0]];
    return k ? STUBS[k] : null;
  },
};
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
  plugins: [stubPlugin, tsconfigPaths()],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await server.environments.client.pluginContainer.buildStart({});
const vn = new ViteNodeServer(server);
const runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
await runner.executeId("/@vite/env");
const imp = (p) => runner.executeFile(`${WORK_ROOT}/src/${p}`);

const rows = [];
const out = [];
const P = (s) => out.push(s);
const J = (v) => JSON.stringify(v);
function check(id, status, detail) {
  rows.push({ id, status });
  P(`  ${status.padEnd(10)} ${id}：${detail}`);
}
const expect = (id, cond, detail) => check(id, cond ? "PASS" : "FAIL", detail);
const unverified = (id, detail) => check(id, "UNVERIFIED", detail);
const finish = async (code) => {
  for (const k of Object.keys(orig)) console[k] = orig[k];
  await server.close().catch(() => {});
  process.stdout.write(`${out.join("\n")}\n`);
  process.exit(code);
};
process.on("unhandledRejection", (e) => {
  P(`CRASH unhandledRejection：${String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ")}`);
  finish(1);
});

let M;
try {
  M = {
    errors: await imp("lib/credits/errors.ts"),
    constants: await imp("lib/credits/constants.ts"),
    credits: await imp("lib/credits/index.ts"),
    sec: await imp("integrations/supabase/security-middleware.ts"),
    itin: await imp("lib/itinerary.functions.ts"),
    route: await imp("routes/api/generate-itinerary.ts"),
    transport: await imp("lib/ai/itinerary-transport.ts"),
    sm: await imp("lib/ai/ai-itinerary-state-machine.ts"),
  };
} catch (e) {
  P(`INFRA-FAIL 模組載入：${String(e?.stack ?? e).split("\n").slice(0, 6).join(" | ")}`);
  await finish(1);
}

const FREE = { has_plus: false };
const PLUS = { has_plus: true, effective_source: "subscription", active_sources: ["subscription"] };
const rpcFor = ({ plus = false, reserve }) => ({
  resolve_user_plus_entitlement: async () => ({ data: plus ? PLUS : FREE, error: null }),
  credits_reserve: async (args, who) => reserve(args, who),
  credits_rollback: async () => ({ data: { ok: true, status: "rolled_back" }, error: null }),
  credits_commit: async () => ({ data: { ok: true, status: "committed" }, error: null }),
});
const INSUFFICIENT = async () => ({ data: { ok: false, reason: "insufficient", usable_credits: 3 }, error: null });
let ledgerSeq = 0;
const RESERVED = async () => ({ data: { ok: true, ledger_id: `r2-ledger-${++ledgerSeq}`, status: "reserved" }, error: null });
const RESERVE_ERROR = async () => ({ data: null, error: { message: "db down" } });
const IDEMPOTENT = async () => ({ data: { ok: true, idempotent: true, ledger_id: "r2-ledger-old" }, error: null });
const names = () => rpcLog.map((x) => x.name);
const reset = (sc) => {
  scenario = sc;
  rpcLog = [];
  dbLog = [];
  handlerCalls = [];
};
const req = (token, requestId, body) =>
  new Request("https://roamie-mock.invalid/api/generate-itinerary", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(requestId ? { "x-roamie-request-id": requestId } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const PLACES = [
  ["清水寺", "ChIJr2KyoA8JAWARjKKoXsYbBGE", 34.9949, 135.785],
  ["伏見稻荷大社", "ChIJIW0uPRUPAWAR6eI6dRzKGns", 34.9671, 135.7727],
  ["金閣寺", "ChIJvUbrwCCoAWARX2QiHCsn5A4", 35.0394, 135.7292],
  ["嵐山竹林小徑", "ChIJrYtcv-urAWAR3XzWvXv8n_s", 35.0168, 135.6713],
];
const INPUT = {
  destination: "京都",
  days: 2,
  generationId: "gen-r2-1",
  selectedPlaces: PLACES.map(([name, id, lat, lng]) => ({ name, googlePlaceId: id, lat, lng, address: `日本京都府 ${name}` })),
};

// ════ 0. 前提 ════
P("══ 0. 前提（真實模組）══");
expect("0-cost-7", M.constants.CREDITS_COSTS.ITINERARY_GENERATION === 7, `CREDITS_COSTS.ITINERARY_GENERATION=${M.constants.CREDITS_COSTS.ITINERARY_GENERATION}`);
expect("0-error-contract", M.errors.isInsufficientCreditsError(new M.errors.InsufficientCreditsError()) && M.errors.isInsufficientCreditsError({ errorCode: "INSUFFICIENT_CREDITS" }) && !M.errors.isInsufficientCreditsError(new Error("generation_unavailable")), "InsufficientCreditsError／errorCode 判定；一般錯誤不誤判");
const mw = M.sec.requireItineraryCredits?.__m;
expect("0-middleware-extracted", Boolean(mw?.serverFn) && mw.inner.length === 1, `requireItineraryCredits 真實 .server 已取得（內層 middleware=${mw?.inner.length}）`);

// ════ A. middleware（真實 requireItineraryCredits.server）════
P("\n══ A. requireItineraryCredits（security-middleware.ts L26-127，真實 .server；Mock supabase.rpc）══");
async function runMw(sc, { userId = "user-A", requestId = "req-A", nextImpl } = {}) {
  reset(sc);
  currentRequest = req(null, requestId, null);
  const client = globalThis.__R2_CLIENT("http://mock-supabase.invalid", "mock-publishable-key", { global: { headers: { Authorization: `Bearer ${tokenOf(userId)}` } } });
  let nextCalls = 0;
  let nextCtx = null;
  let err = null;
  let res;
  try {
    res = await mw.serverFn({
      data: INPUT,
      context: { supabase: client, userId },
      next: async (o) => {
        nextCalls += 1;
        nextCtx = o?.context ?? null;
        return nextImpl ? nextImpl(o) : { result: "planner-ran" };
      },
    });
  } catch (e) {
    err = e;
  }
  return { err, res, nextCalls, nextCtx, rpc: [...rpcLog] };
}
{
  const r = await runMw({ rpc: rpcFor({ reserve: INSUFFICIENT }) }, { requestId: "req-A1" });
  const reserve = r.rpc.find((x) => x.name === "credits_reserve");
  expect("A1-throws-insufficient", r.err && M.errors.isInsufficientCreditsError(r.err), `丟出 ${r.err?.name}:${r.err?.message}`);
  expect("A1-no-generation", r.nextCalls === 0, `next()（正式行程生成）呼叫次數=${r.nextCalls}`);
  expect("A1-rpc-sequence", J(r.rpc.map((x) => x.name)) === J(["resolve_user_plus_entitlement", "credits_reserve"]), `RPC=${J(r.rpc.map((x) => x.name))}（不得 commit／rollback）`);
  expect("A1-no-deduct-7", !r.rpc.some((x) => x.name === "credits_commit") && reserve?.args?.p_amount === 7 && reserve?.args?.p_feature_type === "ITINERARY_GENERATION", `reserve 嘗試 p_amount=${reserve?.args?.p_amount} feature=${reserve?.args?.p_feature_type}、回 ok:false 後無 commit（未扣 7 點）`);
  expect("A1-idempotency-scoped", reserve?.args?.p_idempotency_key === "server:user-A:ITINERARY_GENERATION:req-A1" && reserve?.args?.p_request_id === "req-A1", `idempotency=${reserve?.args?.p_idempotency_key}`);
  unverified("A1-db-reserve-semantics", "credits_reserve 在 DB 端「點數不足時不建立 ledger、不扣點」由 SQL function 保證；本腳本只驗 RPC 呼叫端（Mock）");
}
{
  const r = await runMw({ rpc: rpcFor({ reserve: RESERVE_ERROR }) }, { requestId: "req-A2" });
  expect("A2-reserve-error-not-402", r.err && !M.errors.isInsufficientCreditsError(r.err) && r.err.message === "Credit reservation unavailable" && r.nextCalls === 0, `reserve 錯誤 → ${r.err?.message}（不是點數不足）、next=${r.nextCalls}`);
}
{
  const r = await runMw({ rpc: rpcFor({ reserve: IDEMPOTENT }) }, { requestId: "req-A3" });
  expect("A3-idempotent-replay", r.err && /Conflict/.test(r.err.message) && r.nextCalls === 0 && !r.rpc.some((x) => x.name === "credits_commit"), `重送同一 requestId → ${r.err?.message}、next=${r.nextCalls}、不重複扣點`);
}
{
  const r = await runMw({ rpc: rpcFor({ reserve: RESERVED }) }, { requestId: "req-A4", nextImpl: async () => { throw new Error("planner failed"); } });
  const rb = r.rpc.filter((x) => x.name === "credits_rollback");
  expect("A4-control-reserved-then-rollback", r.nextCalls === 1 && r.err?.message === "planner failed" && rb.length === 1 && rb[0].args?.p_ledger_id === r.nextCtx?.itineraryCreditReservation?.ledgerId, `reserve 成功 → next=${r.nextCalls}；規劃失敗 → credits_rollback ${rb.length} 次（ledger=${rb[0]?.args?.p_ledger_id}）＝退還`);
}
{
  const r = await runMw({ rpc: rpcFor({ plus: true, reserve: INSUFFICIENT }) }, { userId: "user-P", requestId: "req-A5" });
  expect("A5-plus-bypass", r.nextCalls === 1 && !r.rpc.some((x) => x.name === "credits_reserve") && r.nextCtx?.itineraryCreditReservation?.plusBypass === true, `Plus：RPC=${J(r.rpc.map((x) => x.name))}、next=${r.nextCalls}（不 reserve）`);
}

// ════ B. API route（真實 POST → 真實 generateItinerary → 真實 middleware）════
P("\n══ B. /api/generate-itinerary（generate-itinerary.ts L39-280 真實 handler；generateItinerary＝真實 createServerFn 定義＋InputSchema）══");
const POST = M.route.Route?.server?.handlers?.POST;
expect("B0-route-extracted", typeof POST === "function", "取得 Route.server.handlers.POST");
async function runPost(sc, { token, requestId = "req-B", body = INPUT } = {}) {
  reset(sc);
  const request = req(token, requestId, body);
  currentRequest = request;
  const res = await POST({ request });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const analytics = dbLog.filter((d) => d.table === "analytics_events").map((d) => d.ops.find((o) => o.op === "upsert")?.args?.[0]).filter(Boolean);
  return { status: res.status, contentType: res.headers.get("content-type"), json, rpc: [...rpcLog], handler: [...handlerCalls], analytics };
}
{
  const r = await runPost({ rpc: rpcFor({ reserve: INSUFFICIENT }) }, { token: "tok-B1", requestId: "req-B1" });
  expect("B1-http-402", r.status === 402 && /application\/json/.test(r.contentType ?? "") && r.json?.error === "INSUFFICIENT_CREDITS" && r.json?.requestId === "req-B1", `status=${r.status} body=${J(r.json)}`);
  expect("B1-no-generation", r.handler.length === 0, `正式行程規劃器（createServerFn handler）呼叫次數=${r.handler.length}`);
  expect("B1-no-deduct", !r.rpc.some((x) => x.name === "credits_commit" || x.name === "credits_rollback") && r.rpc.filter((x) => x.name === "credits_reserve").length === 1, `RPC=${J(r.rpc.map((x) => `${x.name}@${x.who}`))}`);
  const failed = r.analytics.find((a) => a.event_name === "itinerary_generation_failed");
  expect("B1-analytics", Boolean(failed) && failed.failure_code === "INSUFFICIENT_CREDITS" && !r.analytics.some((a) => a.event_name === "itinerary_generation_succeeded"), `analytics=${J(r.analytics.map((a) => `${a.event_name}:${a.failure_code ?? "-"}`))}`);
}
{
  const r = await runPost({ rpc: rpcFor({ reserve: RESERVED }), planner: async () => { throw new Error("planner failed"); } }, { token: "tok-B2", requestId: "req-B2" });
  expect("B2-control-planner-error-500-rollback", r.status === 500 && r.json?.error === "generation_unavailable" && r.handler.length === 1 && r.rpc.filter((x) => x.name === "credits_rollback").length === 1, `status=${r.status} handler=${r.handler.length} RPC=${J(r.rpc.map((x) => x.name))}`);
}
{
  const r = await runPost({ rpc: rpcFor({ reserve: RESERVE_ERROR }) }, { token: "tok-B3", requestId: "req-B3" });
  expect("B3-control-reserve-error-500", r.status === 500 && r.json?.error === "generation_unavailable" && r.handler.length === 0, `reserve 錯誤 → status=${r.status}（不是 402）handler=${r.handler.length}`);
}
{
  const r = await runPost({ rpc: rpcFor({ reserve: INSUFFICIENT }) }, { token: null, requestId: "req-B4" });
  expect("B4-control-unauthorized-401", r.status === 401 && r.rpc.length === 0 && r.handler.length === 0, `未登入 → status=${r.status} RPC=${r.rpc.length}`);
}
unverified("B-tanstack-order", "Harness 以「inputValidator → middleware（宣告順序，深度優先）→ handler」組合 createServerFn；TanStack Start 實際執行順序與錯誤序列化未在此執行");

// ════ C. Client（真實 transport／state machine）════
P("\n══ C. Client：generateItineraryViaNativeApi → POST（真實）；createItineraryFromSession（真實）══");
const fetchImpl = async (url, init) => {
  const request = new Request(url, init);
  currentRequest = request;
  return POST({ request });
};
{
  reset({ rpc: rpcFor({ reserve: INSUFFICIENT }) });
  const r = await M.transport.generateItineraryViaNativeApi({ ...INPUT, generationId: "gen-r2-C1" }, { token: "tok-C1", fetchImpl, origin: "https://roamie-mock.invalid" });
  expect("C1-native-transport-insufficient", r?.success === false && r?.errorCode === "INSUFFICIENT_CREDITS" && M.errors.isInsufficientCreditsError(r) && handlerCalls.length === 0, `transport 結果=${J(r)} handler=${handlerCalls.length}`);
}
const session = { phase: "ready", recommendedPlaces: [], selectedPlaces: [], discovery: {}, updatedAt: "2026-01-01T00:00:00.000Z", travelContext: { interests: [], destination: "京都" } };
{
  reset({ rpc: rpcFor({ reserve: INSUFFICIENT }) });
  let r;
  let err = null;
  try {
    r = await M.sm.createItineraryFromSession({
      session,
      generateInput: { ...INPUT, generationId: "gen-r2-C2" },
      generateItineraryFn: (args) => M.transport.generateItineraryViaNativeApi(args.data, { token: "tok-C2", fetchImpl, origin: "https://roamie-mock.invalid" }),
      generationTransport: "capacitor_https",
    });
  } catch (e) {
    err = e;
  }
  expect("C2-state-machine-native", !err && r?.ok === false && r?.state === "FAILED" && r?.message === M.credits.INSUFFICIENT_CREDITS_ITINERARY_MESSAGE && handlerCalls.length === 0 && !rpcLog.some((x) => x.name === "credits_commit"), `ok=${r?.ok} state=${r?.state} message=${J(r?.message)} handler=${handlerCalls.length} RPC=${J(names())}${err ? ` err=${err.message}` : ""}`);
}
{
  reset({ rpc: rpcFor({ reserve: INSUFFICIENT }) });
  let r;
  let err = null;
  try {
    r = await M.sm.createItineraryFromSession({
      session,
      generateInput: { ...INPUT, generationId: "gen-r2-C3" },
      generateItineraryFn: (args) => {
        currentRequest = req("tok-C3", "req-C3", null);
        return M.itin.generateItinerary(args);
      },
    });
  } catch (e) {
    err = e;
  }
  expect("C3-state-machine-serverfn", !err && r?.ok === false && r?.message === M.credits.INSUFFICIENT_CREDITS_ITINERARY_MESSAGE && handlerCalls.length === 0, `ok=${r?.ok} message=${J(r?.message)} handler=${handlerCalls.length}${err ? ` err=${err.message}` : ""}`);
  unverified("C3-wire-serialization", "useServerFn 跨網路時 InsufficientCreditsError 的序列化（message／code 保留）未執行；C3 直接傳遞 Error 物件");
}

// ════ I. Credits 隔離 ════
P("\n══ I. Credits 隔離 ══");
{
  const sc = {
    rpc: {
      // 任務單 #6：credits_* 改由 service role 呼叫並以 p_user_id 綁定已驗證使用者（who＝service_role）。
      ...rpcFor({ reserve: async (args) => (args?.p_user_id === "user-IA" ? INSUFFICIENT() : RESERVED()) }),
    },
    planner: async () => ({ success: false, errorCode: "planner_mock_failure", message: "mock" }),
  };
  reset(sc);
  currentRequest = req("tok-IA", "req-I1", INPUT);
  const ra = await POST({ request: currentRequest });
  const rpcA = [...rpcLog];
  const handlerA = handlerCalls.length;
  scenario = sc;
  rpcLog = [];
  handlerCalls = [];
  currentRequest = req("tok-IB", "req-I1", INPUT);
  const rb = await POST({ request: currentRequest });
  const rpcB = [...rpcLog];
  const keyA = rpcA.find((x) => x.name === "credits_reserve")?.args?.p_idempotency_key;
  const keyB = rpcB.find((x) => x.name === "credits_reserve")?.args?.p_idempotency_key;
  // 屬於使用者 U 的 RPC：credits_* 由 service role 帶 p_user_id＝U；其餘（entitlement）以 U 的 JWT 呼叫。
  const ownedBy = (u) => (x) =>
    /^credits_/.test(x.name) ? x.who === "service_role" && x.args?.p_user_id === u : x.who === u;
  expect("I1-user-isolation", ra.status === 402 && handlerA === 0 && rb.status === 200 && handlerCalls.length === 1 && keyA !== keyB && keyA === "server:user-IA:ITINERARY_GENERATION:req-I1" && keyB === "server:user-IB:ITINERARY_GENERATION:req-I1" && rpcA.every(ownedBy("user-IA")) && rpcB.every(ownedBy("user-IB")) && [...rpcA, ...rpcB].some((x) => x.name === "credits_reserve"), `A=${ra.status}（handler=${handlerA}，key=${keyA}）；B 同 requestId=${rb.status}（handler=${handlerCalls.length}，key=${keyB}）；RPC=${J([...rpcA, ...rpcB].map((x) => `${x.name}@${x.who}:${x.args?.p_user_id ?? "-"}`))}`);
  const all = [...rpcA, ...rpcB];
  expect("I2-feature-isolation", all.filter((x) => x.name === "credits_reserve").every((x) => x.args?.p_feature_type === "ITINERARY_GENERATION" && x.args?.p_amount === 7 && x.args?.p_metadata?.authority === "server_function") && !J(all).includes("PLACE_RECOMMENDATION"), `reserve=${J(all.filter((x) => x.name === "credits_reserve").map((x) => `${x.args?.p_feature_type}:${x.args?.p_amount}`))}；無 PLACE_RECOMMENDATION`);
  expect("I3-no-settlement-for-insufficient-user", !rpcA.some((x) => x.name === "credits_commit" || x.name === "credits_rollback") && rpcB.every(ownedBy("user-IB")), `A（不足）結算 RPC=${J(rpcA.filter((x) => /commit|rollback/.test(x.name)).map((x) => x.name))}；B 的 RPC 全部屬於 user-IB（credits_* 為 service_role＋p_user_id＝user-IB）`);
  unverified("I3-handler-finish-settlement", "reserve 成功後的 commit／rollback 在正式 handler 的 finish()（itinerary.functions.ts L582-601）；本腳本以記錄器取代 handler（正式規劃器），該段未執行。規劃例外 → middleware rollback 已由 A4／B2 驗證");
}
{
  const chat = readFileSync(`${WORK_ROOT}/src/routes/_app.chat.tsx`, "utf8");
  const sm = readFileSync(`${WORK_ROOT}/src/lib/ai/ai-itinerary-state-machine.ts`, "utf8");
  expect("I4-static-single-billing-boundary", !/beginItineraryGenerationCredits/.test(chat) && !/beginItineraryGenerationCredits/.test(sm), "[靜態] Client（_app.chat.tsx／ai-itinerary-state-machine.ts）不呼叫 beginItineraryGenerationCredits；行程只在 Server middleware 計費");
}

P("\n══ 外部請求 ══");
expect("X-no-external", external === 0, `external=${external}${extLog.length ? ` ${J(extLog.slice(0, 5))}` : ""}`);
const c = (s) => rows.filter((r) => r.status === s).length;
P(`\nverify-itinerary-insufficient-credits-r2: PASS=${c("PASS")} FAIL=${c("FAIL")} UNVERIFIED=${c("UNVERIFIED")} external=${external} → ${c("FAIL") ? "FAIL" : "PASS"}`);
await finish(c("FAIL") ? 1 : 0);
