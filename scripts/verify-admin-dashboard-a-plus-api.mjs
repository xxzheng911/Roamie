import "./verify-netguard-full.mjs";
// verify-admin-dashboard-a-plus-api.mjs — 任務單 #ADM-T1（tester 第 1 輪）：/api/admin/dashboard 方案 A+
//
// 以 esbuild 打包「真實」 src/routes/api/admin/dashboard.ts（工作區版）與 HEAD(1560489) 版，
// 只 mock：@tanstack/react-router、@/integrations/supabase/client.server（rpc + auth.getUser）、
// @/lib/rate-limit.server。admin-auth.server／admin-analytics／zod 為真實模組。
// HEAD 版：dashboard.ts 由工作區檔案反向套用 diff 取得（每段反向替換都斷言命中 1 次）；
// admin-dashboard.server.ts 依 `git show 1560489:src/lib/admin/admin-dashboard.server.ts` 轉錄。
// 網路：第一行 netguard；另外 globalThis.fetch 在 bundle 載入後換成一律拒絕的 stub。不讀 .env。
//
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=120 scripts/verify-admin-dashboard-a-plus-api.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

for (const k of Object.keys(process.env)) {
  if (/SUPABASE|OPENAI|GOOGLE_|SERVICE_ROLE|REVENUECAT|STRIPE|UNSPLASH|SECRET|ROAMIE_ADMIN/i.test(k)) {
    delete process.env[k];
  }
}
const ADMIN_ID = "5a8b8749-91cf-4c7c-8f95-0e0df67a9b86";
const OTHER_ID = "a0c018a4-9dad-46b7-8dd6-f58b2aaed001";
process.env.ROAMIE_ADMIN_USER_IDS = `${ADMIN_ID.toUpperCase()},invalid,17b3a3f1-2c93-4d2d-a139-5f31f85865fe`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = (s) => fs.writeSync(1, s + "\n");
const failures = [];
let passCount = 0;
async function check(name, fn) {
  try {
    await fn();
    passCount += 1;
    out("PASS " + name);
  } catch (e) {
    failures.push(name);
    out("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 14).join("\n     "));
  }
}

globalThis.__m = { rpcCalls: [], getUserCalls: 0, rateCalls: 0 };
const M = globalThis.__m;

// ---------------------------------------------------------------- HEAD sources
const dashboardPath = path.join(root, "src/routes/api/admin/dashboard.ts");
const serverPath = path.join(root, "src/lib/admin/admin-dashboard.server.ts");
function reverseOnce(text, from, to, label) {
  const n = text.split(from).length - 1;
  assert.equal(n, 1, `HEAD 重建：${label} 應命中 1 次，實際 ${n}`);
  return text.replace(from, to);
}
let headDashboard = fs.readFileSync(dashboardPath, "utf8");
headDashboard = reverseOnce(
  headDashboard,
  "import { loadAdminAnalytics, loadAdminDashboard } from",
  "import { loadAdminDashboard } from",
  "import",
);
headDashboard = reverseOnce(
  headDashboard,
  '  period: z.enum(["today", "7d", "30d", "all"]).default("30d"),\n  /** analytics：只重抓分析區（admin_analytics_v1），不查 phase1 */\n  scope: z.enum(["all", "analytics"]).default("all"),\n',
  "",
  "QuerySchema",
);
headDashboard = reverseOnce(
  headDashboard,
  '            period: url.searchParams.get("period") || undefined,\n            scope: url.searchParams.get("scope") || undefined,\n',
  "",
  "parse args",
);
headDashboard = reverseOnce(
  headDashboard,
  '          if (query.scope === "analytics") {\n            const analytics = await loadAdminAnalytics(query.period);\n            return json({ analytics });\n          }\n',
  "",
  "scope branch",
);
const HEAD_SERVER = `import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  normalizeAdminDashboardData,
  type AdminDashboardData,
  type AdminUserSort,
} from "./admin-analytics";

export async function loadAdminDashboard(params: {
  search?: string;
  sort: AdminUserSort;
  page: number;
  pageSize?: number;
}): Promise<AdminDashboardData> {
  const analyticsClient = supabaseAdmin as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const [{ data, error }, analyticsResult] = await Promise.all([
    supabaseAdmin.rpc("admin_dashboard_phase1", {
      p_search: params.search?.trim() || null,
      p_sort: params.sort,
      p_page: Math.max(1, Math.floor(params.page)),
      p_page_size: Math.min(50, Math.max(1, Math.floor(params.pageSize ?? 50))),
    }),
    analyticsClient.rpc("admin_analytics_v1", { p_period: "30d" }),
  ]);
  if (error) throw new Error(\`Admin analytics query failed: \${error.message}\`);
  if (analyticsResult.error) {
    console.error("[ADMIN_ANALYTICS_V1] query failed", analyticsResult.error.message);
  }
  const normalized = normalizeAdminDashboardData(
    data,
    analyticsResult.error ? null : analyticsResult.data,
  );
  if (!normalized) throw new Error("Admin analytics response was incomplete");
  return normalized;
}
`;

// ---------------------------------------------------------------- bundling
const MOCKS = {
  "@tanstack/react-router": `export const createFileRoute = () => (opts) => opts;`,
  "@/integrations/supabase/client.server": `
    export const supabaseAdmin = {
      rpc: (...a) => globalThis.__m.rpc(...a),
      auth: { getUser: (...a) => { globalThis.__m.getUserCalls += 1; return globalThis.__m.getUser(...a); } },
      from: () => { throw new Error("from() not expected in admin dashboard path"); },
    };`,
  "@/lib/rate-limit.server": `
    export const SECURITY_RATE_LIMITS = { adminPerMinute: 30 };
    export const checkRateLimit = (...a) => { globalThis.__m.rateCalls += 1; return globalThis.__m.rate(...a); };`,
};

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-admin-a-plus-api-"));
fs.symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"), "dir");
let seq = 0;
async function buildBundle(entry, overrides) {
  const outFile = path.join(tmp, `b${(seq += 1)}.mjs`);
  await build({
    entryPoints: [path.join(root, entry)],
    absWorkingDir: root,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    outfile: outFile,
    logLevel: "silent",
    plugins: [
      {
        name: "admin-mocks",
        setup(b) {
          const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
          const filter = new RegExp("^(" + Object.keys(MOCKS).map(esc).join("|") + ")$");
          b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "mock" }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            contents: MOCKS[a.path],
            loader: "ts",
            resolveDir: root,
          }));
          if (overrides) {
            b.onLoad({ filter: /\.ts$/ }, (a) => {
              const hit = overrides[path.resolve(a.path)];
              return hit === undefined
                ? undefined
                : { contents: hit, loader: "ts", resolveDir: path.dirname(a.path) };
            });
          }
        },
      },
    ],
  });
  return outFile;
}

let newFile, headFile, authFile;
try {
  newFile = await buildBundle("src/routes/api/admin/dashboard.ts");
  headFile = await buildBundle("src/routes/api/admin/dashboard.ts", {
    [dashboardPath]: headDashboard,
    [serverPath]: HEAD_SERVER,
  });
  authFile = await buildBundle("src/lib/admin/admin-auth.server.ts");
} catch (e) {
  out("INFRA-FAIL bundle: " + String(e?.message ?? e).slice(0, 2000));
  process.exit(1);
}
const headText = fs.readFileSync(headFile, "utf8");
const newText = fs.readFileSync(newFile, "utf8");
assert.ok(!headText.includes("loadAdminAnalytics"), "HEAD bundle must not contain loadAdminAnalytics");
assert.ok(newText.includes("loadAdminAnalytics"), "NEW bundle must contain loadAdminAnalytics");

globalThis.fetch = async (input) => {
  throw new Error("fetch not allowed in this verify: " + String(input?.url ?? input));
};
const quietError = console.error;
console.error = () => {};
const NEW_GET = (await import(pathToFileURL(newFile).href)).Route.server.handlers.GET;
const HEAD_GET = (await import(pathToFileURL(headFile).href)).Route.server.handlers.GET;
const auth = await import(pathToFileURL(authFile).href);
out("bundles loaded (NEW + HEAD + admin-auth)");

// ---------------------------------------------------------------- fixtures
const RAW_DASHBOARD = {
  observedAt: "2026-08-16T00:00:00.000Z",
  summary: {
    totalUsers: 3, newUsersToday: 1, newUsers7d: 2, newUsers30d: 3, dau: 1, wau: 2, mau: 3,
    userChatsToday: 4, userChats7d: 8, savedTripsToday: 1, savedTrips7d: 2, savedPlaces7d: 3,
    freeUsers: 2, plusUsers: 1, committedCreditsToday: 1, committedCredits7d: 8, committedCredits30d: 10,
  },
  users: [
    {
      user_id: ADMIN_ID, display_name: null, email: "relay@example.com",
      created_at: "2026-08-01T00:00:00.000Z", last_sign_in_at: null, last_active_at: "2026-08-15T00:00:00.000Z",
      actions_7d: 3, actions_30d: 5, chat_count: 2, trip_count: 1, saved_place_count: 2, plan: "free",
    },
  ],
  usersTotal: 1,
  topUsers: [],
  rawDestinations: [
    { destination: "Tainan City", trip_count: 2, unique_users: 2, user_ids: ["u1", "u2"], last_saved_at: "2026-08-15T00:00:00.000Z" },
    { destination: "台南", trip_count: 1, unique_users: 1, user_ids: ["u2"], last_saved_at: "2026-08-16T00:00:00.000Z" },
  ],
  creditBreakdown30d: [{ feature_type: "ITINERARY_GENERATION", credits: 7 }],
};
const rawAnalytics = (period) => ({
  observedAt: "2026-08-16T00:00:00.000Z",
  period,
  trackingStartedAt: "2026-08-01T00:00:00.000Z",
  chatSessions: 11, itineraryAttempts: 20, itinerarySuccesses: 17, itineraryFailures: 3, itinerarySuccessRate: 85,
  popularRecommendationFamilies: [{ recommendation_family: "cafe", requested_count: 4 }],
  placeCardClicks: 9, uniqueClickedPlaces: 5, placeClickSurfaces: [{ surface: "chat", click_count: 9 }],
  affiliateImpressions: 10, affiliateClicks: 2, affiliateOpenSuccesses: 1, affiliateCtr: 20,
  affiliateByProvider: [{ provider: "agoda", impressions: 10, clicks: 2, opens: 1 }],
});

function reset({ user = ADMIN_ID, rateAllowed = true, phase1Error = null, analyticsError = null } = {}) {
  M.rpcCalls = [];
  M.getUserCalls = 0;
  M.rateCalls = 0;
  M.getUser = async (token) =>
    token === "good-token" && user
      ? { data: { user: { id: user } }, error: null }
      : { data: { user: null }, error: { message: "invalid" } };
  M.rate = () => ({ allowed: rateAllowed, retryAfterSec: 60 });
  M.rpc = async (name, args) => {
    M.rpcCalls.push({ name, args });
    if (name === "admin_dashboard_phase1") {
      return phase1Error ? { data: null, error: { message: phase1Error } } : { data: RAW_DASHBOARD, error: null };
    }
    if (name === "admin_analytics_v1") {
      return analyticsError
        ? { data: null, error: { message: analyticsError } }
        : { data: rawAnalytics(args.p_period), error: null };
    }
    throw new Error("unexpected rpc " + name);
  };
}
async function call(GET, query, { token = "good-token", ...opts } = {}) {
  reset(opts);
  const headers = token === null ? {} : { Authorization: `Bearer ${token}` };
  const res = await GET({ request: new Request(`http://localhost/api/admin/dashboard${query}`, { headers }) });
  const text = await res.text();
  return {
    status: res.status,
    cache: res.headers.get("cache-control"),
    nosniff: res.headers.get("x-content-type-options"),
    ctype: res.headers.get("content-type"),
    text,
    body: JSON.parse(text),
    rpc: M.rpcCalls.map((c) => ({ name: c.name, args: c.args })),
    getUserCalls: M.getUserCalls,
    rateCalls: M.rateCalls,
  };
}
const names = (r) => r.rpc.map((c) => c.name).sort();
const periodArg = (r) => r.rpc.find((c) => c.name === "admin_analytics_v1")?.args;

// ---------------------------------------------------------------- A: auth / headers vs HEAD
for (const [label, q, opts, status] of [
  ["未帶 token", "", { token: null }, 401],
  ["空 Bearer", "", { token: "" }, 401],
  ["token 無效", "", { token: "bad" }, 401],
  ["非管理員", "", { user: OTHER_ID }, 403],
  ["非管理員 + scope=analytics", "?scope=analytics&period=7d", { user: OTHER_ID }, 403],
  ["未帶 token + scope=analytics", "?scope=analytics", { token: null }, 401],
]) {
  await check(`A ${label} → ${status}，與 HEAD 同狀態／同 body／同標頭，0 RPC`, async () => {
    const n = await call(NEW_GET, q, opts);
    const h = await call(HEAD_GET, q, opts);
    assert.equal(n.status, status);
    assert.equal(h.status, status);
    assert.equal(n.text, h.text);
    assert.equal(n.cache, "private, no-store");
    assert.equal(h.cache, "private, no-store");
    assert.equal(n.nosniff, "nosniff");
    assert.equal(n.rpc.length, 0, "auth 失敗時不得呼叫 RPC");
  });
}
await check("A 429 rate limited（scope=all 與 scope=analytics）與 HEAD 相同，0 RPC", async () => {
  for (const q of ["", "?scope=analytics&period=today"]) {
    const n = await call(NEW_GET, q, { rateAllowed: false });
    const h = await call(HEAD_GET, "", { rateAllowed: false });
    assert.equal(n.status, 429);
    assert.equal(n.text, h.text);
    assert.equal(n.cache, "private, no-store");
    assert.equal(n.rpc.length, 0);
  }
});

// ---------------------------------------------------------------- B: scope=all parity
for (const q of ["", "?sort=newest&page=2&search=%20relay%20", "?sort=active_7d&page=3", "?period=30d", "?scope=all", "?period="]) {
  await check(`B scope=all 預設路徑 '${q || "(無參數)"}' 與 HEAD 完全相同（RPC 參數、body、標頭）`, async () => {
    const n = await call(NEW_GET, q);
    const h = await call(HEAD_GET, q);
    assert.equal(n.status, 200);
    assert.equal(h.status, 200);
    assert.deepEqual(n.rpc, h.rpc);
    assert.deepEqual(periodArg(n), { p_period: "30d" });
    assert.equal(n.text, h.text, "回應 body 必須和 HEAD 逐字相同");
    assert.equal(n.cache, "private, no-store");
    assert.equal(n.ctype, h.ctype);
    assert.equal(n.rpc.length, 2);
  });
}
await check("B phase1 失敗 → 500，與 HEAD 相同", async () => {
  const n = await call(NEW_GET, "", { phase1Error: "boom" });
  const h = await call(HEAD_GET, "", { phase1Error: "boom" });
  assert.equal(n.status, 500);
  assert.equal(n.text, h.text);
  assert.equal(n.cache, "private, no-store");
});
await check("B analytics RPC 失敗（scope=all）→ 200 且 analytics=null，與 HEAD 相同", async () => {
  const n = await call(NEW_GET, "", { analyticsError: "down" });
  const h = await call(HEAD_GET, "", { analyticsError: "down" });
  assert.equal(n.status, 200);
  assert.equal(n.text, h.text);
  assert.equal(n.body.dashboard.analytics, null);
});
await check("B email 由 API 原樣回傳（遮蔽只在前端）", async () => {
  const n = await call(NEW_GET, "");
  assert.equal(n.body.dashboard.users[0].email, "relay@example.com");
});

// ---------------------------------------------------------------- C: period
for (const p of ["today", "7d", "30d", "all"]) {
  await check(`C scope=all&period=${p} → admin_analytics_v1 收到 p_period=${p}（phase1 參數與 HEAD 相同）`, async () => {
    const n = await call(NEW_GET, `?period=${p}&sort=newest`);
    const h = await call(HEAD_GET, `?period=${p}&sort=newest`);
    assert.equal(n.status, 200);
    assert.deepEqual(periodArg(n), { p_period: p });
    assert.deepEqual(
      n.rpc.find((c) => c.name === "admin_dashboard_phase1"),
      h.rpc.find((c) => c.name === "admin_dashboard_phase1"),
    );
    assert.equal(n.body.dashboard.analytics.period, p);
  });
  await check(`C scope=analytics&period=${p} → 只呼叫 admin_analytics_v1 一次（phase1=0），p_period=${p}`, async () => {
    const n = await call(NEW_GET, `?scope=analytics&period=${p}&sort=newest&page=9&search=x`);
    assert.equal(n.status, 200);
    assert.deepEqual(names(n), ["admin_analytics_v1"]);
    assert.deepEqual(periodArg(n), { p_period: p });
    assert.deepEqual(Object.keys(n.body), ["analytics"]);
    assert.equal(n.body.analytics.period, p);
    assert.equal(n.body.analytics.itinerarySuccessRate, 85);
    assert.equal(n.body.analytics.popularRecommendationFamilies[0].family, "cafe");
    assert.equal(n.cache, "private, no-store");
    assert.equal(n.nosniff, "nosniff");
    assert.equal(n.getUserCalls, 1);
    assert.equal(n.rateCalls, 1);
  });
}
await check("C scope=analytics 未帶 period → 預設 30d", async () => {
  const n = await call(NEW_GET, "?scope=analytics");
  assert.deepEqual(names(n), ["admin_analytics_v1"]);
  assert.deepEqual(periodArg(n), { p_period: "30d" });
});
await check("C scope=analytics 的 analytics 物件 = scope=all 回應中的 dashboard.analytics（同一 normalize）", async () => {
  const a = await call(NEW_GET, "?scope=analytics&period=7d");
  const d = await call(NEW_GET, "?period=7d");
  assert.deepEqual(a.body.analytics, d.body.dashboard.analytics);
});
await check("C scope=analytics RPC 失敗 → 200 {analytics:null}（不 500）", async () => {
  const n = await call(NEW_GET, "?scope=analytics&period=today", { analyticsError: "down" });
  assert.equal(n.status, 200);
  assert.deepEqual(n.body, { analytics: null });
  assert.deepEqual(names(n), ["admin_analytics_v1"]);
});
for (const q of ["?period=90d", "?period=TODAY", "?period=7D", "?period=week", "?scope=bogus", "?scope=analytics&period=1y", "?scope=ANALYTICS"]) {
  await check(`C 非法值 '${q}' → 400，0 RPC，private no-store`, async () => {
    const n = await call(NEW_GET, q);
    assert.equal(n.status, 400);
    assert.deepEqual(n.body, { error: "Invalid admin dashboard query" });
    assert.equal(n.rpc.length, 0);
    assert.equal(n.cache, "private, no-store");
  });
}

// ---------------------------------------------------------------- S: 鑑別力（HEAD 應不符合新斷言）
await check("S 鑑別力：HEAD 在 scope=analytics&period=7d 仍呼叫 phase1 且 p_period=30d（新斷言對 HEAD 會失敗）", async () => {
  const h = await call(HEAD_GET, "?scope=analytics&period=7d");
  assert.deepEqual(names(h), ["admin_analytics_v1", "admin_dashboard_phase1"]);
  assert.deepEqual(periodArg(h), { p_period: "30d" });
  assert.ok("dashboard" in h.body);
});
await check("S 鑑別力：HEAD 對 period=90d 回 200（新版改為 400）", async () => {
  const h = await call(HEAD_GET, "?period=90d");
  assert.equal(h.status, 200);
});

// ---------------------------------------------------------------- D: admin-auth（取代舊 phase1 腳本的 auth 斷言）
await check("D admin-auth：readAdminUserIds／isAdminUser／requireAdminUserId／requireAdminFromRequest", async () => {
  assert.equal(auth.readAdminUserIds().size, 2);
  assert.equal(auth.isAdminUser(ADMIN_ID), true);
  assert.equal(auth.isAdminUser(OTHER_ID), false);
  assert.doesNotThrow(() => auth.requireAdminUserId(ADMIN_ID));
  assert.throws(
    () => auth.requireAdminUserId(OTHER_ID),
    (e) => e instanceof auth.AdminAuthError && e.status === 403,
  );
  reset();
  await assert.rejects(
    () => auth.requireAdminFromRequest(new Request("http://localhost/api/admin/dashboard")),
    (e) => e instanceof auth.AdminAuthError && e.status === 401,
  );
});

console.error = quietError;
fs.rmSync(tmp, { recursive: true, force: true });
out(`\nRESULT pass=${passCount} fail=${failures.length}`);
if (failures.length) {
  out("FAILED:\n  " + failures.join("\n  "));
  process.exitCode = 1;
}
