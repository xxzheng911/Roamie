import "./verify-netguard-full.mjs";
// verify-admin-dashboard-a-plus.mjs — 任務單 #ADM-T1（tester 第 1 輪）：後台 /admin 方案 A+ 前端
//
// 取代 scripts/verify-admin-dashboard-phase1.mjs 第 129-148 行只讀 admin.tsx 字串的斷言
// （拆元件後改讀 src/routes/admin.tsx + src/components/admin/*），並補：
//   P  舊腳本非 UI 斷言（migration 口徑、normalize、目的地合併）— 不改舊腳本，於此重跑
//   T  文案／安全字串（拆檔後的新位置、R9 Credits 說明、動態分析標題）
//   F  admin-format：maskEmail、formatNumber／formatPercent（zh-TW）、formatDate（今年不顯示年份）、未知代號 →「其他」
//   R  react-dom/server SSR：EmailCell 預設遮蔽（完整 email 不在 HTML 任何位置）、KPI 4 組、成功率文案、空狀態
//   L  375px 靜態分析（未實機）：grid 子項 min-w-0、truncate 鏈、寬表格在 overflow-x-auto 內、md:hidden 成對、固定寬度
//   H  admin.tsx 狀態轉換：以 mock React hooks runtime 實際執行元件函式與 effect（非 jsdom、非瀏覽器），
//      mock fetch 計數：scope=analytics&period=、analyticsSeq 競態、R1 不整頁載入、R2 429／重試、401／403
//
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=120 scripts/verify-admin-dashboard-a-plus.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const info = (s) => out("INFO " + s);

// ======================================================================== T: static text
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const ADMIN_ROUTE = read("src/routes/admin.tsx");
const COMPONENT_DIR = "src/components/admin";
const componentFiles = fs
  .readdirSync(path.join(root, COMPONENT_DIR))
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .sort();
const COMP = Object.fromEntries(componentFiles.map((f) => [f, read(`${COMPONENT_DIR}/${f}`)]));
const UI = [ADMIN_ROUTE, ...Object.values(COMP)].join("\n");
info("component files: " + componentFiles.join(", "));

await check("T 安全：admin UI 不含 SUPABASE_SERVICE_ROLE_KEY／ROAMIE_ADMIN_USER_IDS，且不 import 任何 *.server 模組", () => {
  assert.doesNotMatch(UI, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(UI, /ROAMIE_ADMIN_USER_IDS/);
  assert.doesNotMatch(UI, /from\s+["'][^"']*\.server["']/);
  assert.doesNotMatch(UI, /import\(\s*["'][^"']*\.server["']\s*\)/);
});
await check("T admin.tsx 保留：Roamie 營運後台／管理後台／近 7 日最活躍／AdminDashboardData／body.dashboard", () => {
  assert.match(ADMIN_ROUTE, /Roamie 營運後台/);
  assert.match(ADMIN_ROUTE, /管理後台/);
  assert.match(ADMIN_ROUTE, /近 7 日最活躍/);
  assert.match(ADMIN_ROUTE, /AdminDashboardData/);
  assert.match(ADMIN_ROUTE, /body\.dashboard/);
});
await check("T admin.tsx 保留 verify-admin-route-boundary 的 5 條字串斷言", () => {
  assert.match(ADMIN_ROUTE, /載入中…/);
  assert.match(ADMIN_ROUTE, /請先登入 Roamie 後再開啟管理後台。/);
  assert.match(ADMIN_ROUTE, /此帳號沒有管理員權限/);
  assert.match(ADMIN_ROUTE, /管理後台暫時無法載入/);
  assert.match(ADMIN_ROUTE, /Authorization: `Bearer \$\{session\.access_token\}`/);
});
await check("T 拆檔後文案位置：KpiSection／UsersSection／admin-format／AnalyticsPanel", () => {
  assert.match(COMP["KpiSection.tsx"], /總使用者/);
  assert.match(COMP["KpiSection.tsx"], /日活躍使用者/);
  assert.match(COMP["UsersSection.tsx"], /活躍使用者/);
  assert.match(COMP["UsersSection.tsx"], /顯示名稱 \/ Email/);
  assert.match(COMP["admin-format.ts"], /未命名使用者/);
  assert.match(COMP["AnalyticsPanel.tsx"], /行程生成成功率/);
  assert.match(COMP["AnalyticsPanel.tsx"], /聯盟導購點擊漏斗/);
  assert.match(COMP["AnalyticsPanel.tsx"], /暫時無法取得/);
  assert.doesNotMatch(UI, /尚未提供 · 尚無可靠資料來源/);
});
await check("T 動態分析標題：`分析指標 · {periodTitle(period)}`，四個期間標題齊全", () => {
  assert.match(COMP["AnalyticsPanel.tsx"], /分析指標 · \{periodTitle\(period\)\}/);
  for (const t of ["今天", "近 7 日", "近 30 日", "全部期間"]) assert.match(COMP["admin-format.ts"], new RegExp(`title: "${t}"`));
});
await check("T R9 Credits 說明：新文案含 Production + committed，舊文案「僅包含 Free / 有 Credits 紀錄的使用量」已移除", () => {
  assert.match(COMP["CreditsPanel.tsx"], /僅統計 Production 環境已完成扣點（committed）的 Credits 紀錄；沒有扣點紀錄的使用不計入。/);
  assert.doesNotMatch(UI, /僅包含 Free \/ 有 Credits 紀錄的使用量/);
});
await check("T 日期格式：Intl.DateTimeFormat(\"zh-TW\" 在 admin-format；全 UI 無 \"en\" 格式", () => {
  assert.match(COMP["admin-format.ts"], /Intl\.DateTimeFormat\("zh-TW"/);
  assert.doesNotMatch(UI, /Intl\.DateTimeFormat\("en"/);
  assert.doesNotMatch(UI, /toLocaleString\(\)/, "數字不得使用未指定 locale 的 toLocaleString()");
});
await check("T 版面字串：外層 px-4（含 header）、KPI 手機 grid-cols-2", () => {
  assert.match(ADMIN_ROUTE, /className="mx-auto max-w-\[1500px\] space-y-8 px-4 py-6 lg:px-8"/);
  assert.match(ADMIN_ROUTE, /flex max-w-\[1500px\] flex-wrap items-center justify-between gap-2 px-4 py-4 lg:px-8/);
  assert.match(COMP["KpiSection.tsx"], /grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5/);
  assert.doesNotMatch(ADMIN_ROUTE, /px-5/);
});

// ======================================================================== P: phase1 non-UI parity
const migration = read("supabase/migrations/20260816090000_admin_dashboard_phase1.sql");
await check("P migration 口徑斷言（同舊腳本 23-39 行）", () => {
  assert.match(migration, /FROM public\.chat_messages\s+WHERE role = 'user'/);
  assert.match(migration, /COUNT\(DISTINCT user_id\).*24 hours/s);
  assert.match(migration, /COUNT\(DISTINCT user_id\).*7 days/s);
  assert.match(migration, /COUNT\(DISTINCT user_id\).*30 days/s);
  assert.match(migration, /SELECT user_id, created_at, 'trip'::text[\s\S]+FROM public\.saved_trips/);
  assert.match(migration, /SELECT user_id, created_at, 'saved_place'::text[\s\S]+FROM public\.saved_places/);
  assert.match(migration, /COUNT\(DISTINCT id\).*public\.saved_trips/s);
  assert.match(migration, /p\.plan_tier = 'plus'.*subscription_status IN \('active', 'trialing'\)/s);
  assert.match(migration, /status = 'committed'/);
  assert.match(migration, /environment = 'production'/);
  assert.match(migration, /LIMIT \(SELECT page_size FROM params\)/);
  assert.match(migration, /LEAST\(50,/);
  assert.match(migration, /REVOKE ALL.*authenticated/);
  assert.match(migration, /GRANT EXECUTE.*service_role/);
});

// ======================================================================== bundling
const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-admin-a-plus-ui-"));
fs.symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"), "dir");
let seq = 0;
async function bundleStdin(contents, mocks = {}, overrides = null) {
  const outFile = path.join(tmp, `u${(seq += 1)}.mjs`);
  const keys = Object.keys(mocks);
  await build({
    stdin: { contents, resolveDir: root, sourcefile: `entry-${seq}.ts`, loader: "ts" },
    absWorkingDir: root,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    jsx: "automatic",
    outfile: outFile,
    logLevel: "silent",
    plugins: keys.length
      ? [
          {
            name: "ui-mocks",
            setup(b) {
              const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
              const filter = new RegExp("^(" + keys.map(esc).join("|") + ")$");
              b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "mock" }));
              b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "js", resolveDir: root }));
              if (overrides) {
                b.onLoad({ filter: /\.tsx?$/ }, (a) => {
                  const hit = overrides[path.resolve(a.path)];
                  return hit === undefined ? undefined : { contents: hit, loader: "tsx", resolveDir: path.dirname(a.path) };
                });
              }
            },
          },
        ]
      : [],
  });
  return outFile;
}

const SSR_ENTRY = `
export * from "./src/components/admin/admin-format.ts";
export { EmailCell } from "./src/components/admin/EmailCell.tsx";
export { UserLabel, PlanBadge } from "./src/components/admin/UserLabel.tsx";
export { KpiSection } from "./src/components/admin/KpiSection.tsx";
export { UsersSection, TableSkeleton, UserStat } from "./src/components/admin/UsersSection.tsx";
export { TopUsersPanel, DestinationsPanel } from "./src/components/admin/InsightPanels.tsx";
export { CreditsPanel, CREDITS_SCOPE_NOTE } from "./src/components/admin/CreditsPanel.tsx";
export { AnalyticsPanel } from "./src/components/admin/AnalyticsPanel.tsx";
export { normalizeAdminDashboardData, aggregatePopularDestinations } from "./src/lib/admin/admin-analytics.ts";
export { renderToStaticMarkup } from "react-dom/server";
export { createElement, Fragment } from "react";
`;

// Mock React: a tiny hooks runtime. Components are plain function calls; child components are NOT
// rendered (they stay as elements in the tree), effects run after each render, setState marks dirty.
const MOCK_REACT = `
const H = () => { const h = globalThis.__hooks; if (!h) throw new Error("hook called outside render"); return h; };
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
export function useState(init) {
  const h = H(); const i = h.i++;
  let s = h.slots[i];
  if (!s) {
    s = h.slots[i] = { v: typeof init === "function" ? init() : init };
    s.set = (u) => { const n = typeof u === "function" ? u(s.v) : u; if (!Object.is(n, s.v)) { s.v = n; h.dirty = true; h.sets += 1; } };
  }
  return [s.v, s.set];
}
export function useRef(init) { const h = H(); const i = h.i++; if (!h.slots[i]) h.slots[i] = { current: init }; return h.slots[i]; }
export function useMemo(f, deps) { const h = H(); const i = h.i++; const s = h.slots[i]; if (s && same(s.deps, deps)) return s.v; const v = f(); h.slots[i] = { v, deps }; return v; }
export function useCallback(fn, deps) { return useMemo(() => fn, deps); }
export function useEffect(fn, deps) {
  const h = H(); const i = h.i++;
  const s = h.slots[i] ?? (h.slots[i] = { deps: undefined, cleanup: undefined, mounted: false });
  if (s.mounted && deps && same(s.deps, deps)) return;
  h.pending.push({ s, fn, deps });
}
export const useLayoutEffect = useEffect;
export const forwardRef = (r) => r;
export const memo = (c) => c;
export default { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect, forwardRef, memo };
`;
const MOCK_JSX = `
export const Fragment = Symbol.for("harness.fragment");
export function jsx(type, props, key) { return { $el: true, type, props: props ?? {}, key }; }
export const jsxs = jsx;
export const jsxDEV = jsx;
`;
const HARNESS_MOCKS = {
  react: MOCK_REACT,
  "react/jsx-runtime": MOCK_JSX,
  "@tanstack/react-router": `
    export const createFileRoute = () => (opts) => ({ options: opts });
    export const useNavigate = () => (arg) => { globalThis.__ui.navigations.push(arg); return Promise.resolve(); };`,
  "@/lib/auth-session": `export const getClientAuthSession = async () => { globalThis.__ui.sessionCalls += 1; return globalThis.__ui.session; };`,
  "@/lib/api-url": `export const resolveApiUrl = (p) => "http://localhost" + p;`,
  "@/lib/admin/admin-route-boundary": `export const stashAdminReturn = () => { globalThis.__ui.stashed += 1; };`,
};
const HARNESS_ENTRY = `
export { Route } from "./src/routes/admin.tsx";
export { AnalyticsPanel } from "./src/components/admin/AnalyticsPanel.tsx";
export { UsersSection } from "./src/components/admin/UsersSection.tsx";
export { KpiSection } from "./src/components/admin/KpiSection.tsx";
export { CreditsPanel } from "./src/components/admin/CreditsPanel.tsx";
export { TopUsersPanel, DestinationsPanel } from "./src/components/admin/InsightPanels.tsx";
export { EmailCell } from "./src/components/admin/EmailCell.tsx";
`;

let ssr, hx;
try {
  const ssrFile = await bundleStdin(SSR_ENTRY);
  const hxFile = await bundleStdin(HARNESS_ENTRY, HARNESS_MOCKS);
  globalThis.__ui = { navigations: [], sessionCalls: 0, stashed: 0, session: { access_token: "tok" } };
  ssr = await import(pathToFileURL(ssrFile).href);
  hx = await import(pathToFileURL(hxFile).href);
} catch (e) {
  out("INFRA-FAIL bundle: " + String(e?.message ?? e).slice(0, 2000));
  process.exit(1);
}
out("bundles loaded (SSR real react + harness mock react)");

const realConsoleError = console.error;
const render = (el) => {
  console.error = () => {};
  try {
    return ssr.renderToStaticMarkup(el);
  } finally {
    console.error = realConsoleError;
  }
};
const h = ssr.createElement;

// ======================================================================== fixtures
const Y = new Date().getFullYear();
const THIS_YEAR = `${Y}-06-15T04:07:00.000Z`;
const LAST_YEAR = `${Y - 1}-06-15T04:07:00.000Z`;
const SUMMARY = {
  totalUsers: 12345, newUsersToday: 12, newUsers7d: 345, newUsers30d: 1234, dau: 1500, wau: 4321, mau: 9876,
  userChatsToday: 2222, userChats7d: 33333, savedTripsToday: 7, savedTrips7d: 1001, savedPlaces7d: 2002,
  freeUsers: 8230, plusUsers: 4115, committedCreditsToday: 1234, committedCredits7d: 56789, committedCredits30d: 1234567,
};
const mkUser = (id, over = {}) => ({
  userId: id, displayName: "測試使用者", email: "abcdef@gmail.com", createdAt: THIS_YEAR, lastSignInAt: null,
  lastActiveAt: THIS_YEAR, actions7d: 1234, actions30d: 5678, chatCount: 3, tripCount: 2, savedPlaceCount: 1,
  plan: "free", ...over,
});
const mkAnalytics = (period = "30d", over = {}) => ({
  observedAt: THIS_YEAR, period, trackingStartedAt: THIS_YEAR, chatSessions: 12345, itineraryAttempts: 25,
  itinerarySuccesses: 17, itineraryFailures: 3, itinerarySuccessRate: 85,
  popularRecommendationFamilies: [{ family: "cafe", count: 5 }],
  placeCardClicks: 1500, uniqueClickedPlaces: 321, placeClickSurfaces: [{ surface: "chat", count: 1500 }],
  affiliateImpressions: 1000, affiliateClicks: 50, affiliateOpenSuccesses: 40, affiliateCtr: 5,
  affiliateByProvider: [{ provider: "agoda", impressions: 1000, clicks: 50, opens: 40 }], ...over,
});

// ======================================================================== P (cont.): normalize
await check("P normalizeAdminDashboardData／aggregatePopularDestinations（同舊腳本 117-127 行）", () => {
  const raw = {
    observedAt: "2026-08-16T00:00:00.000Z", summary: { dau: 1 },
    users: [{ user_id: "u", display_name: null, email: "relay@example.com", created_at: "2026-08-01T00:00:00.000Z" }],
    usersTotal: 1, topUsers: [],
    rawDestinations: [
      { destination: "Tainan City", trip_count: 2, unique_users: 2, user_ids: ["u1", "u2"], last_saved_at: "2026-08-15T00:00:00.000Z" },
      { destination: "台南", trip_count: 1, unique_users: 1, user_ids: ["u2"], last_saved_at: "2026-08-16T00:00:00.000Z" },
    ],
    creditBreakdown30d: [{ feature_type: "ITINERARY_GENERATION", credits: 7 }],
  };
  const n = ssr.normalizeAdminDashboardData(raw);
  assert.ok(n);
  assert.equal(n.users[0].displayName, null);
  assert.equal(n.summary.dau, 1);
  assert.equal(n.creditBreakdown30d[0].credits, 7);
  const d = ssr.aggregatePopularDestinations(raw.rawDestinations);
  assert.equal(d.length, 1);
  assert.equal(d[0].destination, "台南");
  assert.equal(d[0].tripCount, 3);
  assert.equal(d[0].uniqueUsers, 2);
});

// ======================================================================== F: admin-format
await check("F maskEmail：abcdef@gmail.com → ab***@gmail.com；a@x.com／ab@x.com 保留 1 碼；abc@x.com 保留 2 碼", () => {
  assert.equal(ssr.maskEmail("abcdef@gmail.com"), "ab***@gmail.com");
  assert.equal(ssr.maskEmail("a@x.com"), "a***@x.com");
  assert.equal(ssr.maskEmail("ab@x.com"), "a***@x.com");
  assert.equal(ssr.maskEmail("abc@x.com"), "ab***@x.com");
});
await check("F maskEmail 空字串／無 @／@ 開頭／多個 @ 不 throw，且不回傳原字串", () => {
  for (const v of ["", "noatsign", "@x.com", "a@b@c.com", "  ", "x@"]) {
    let r;
    assert.doesNotThrow(() => { r = ssr.maskEmail(v); }, `maskEmail(${JSON.stringify(v)})`);
    assert.equal(typeof r, "string");
    if (v.length > 3) assert.notEqual(r, v);
  }
  assert.equal(ssr.maskEmail(""), "***");
  assert.equal(ssr.maskEmail("noatsign"), "no***");
  assert.equal(ssr.maskEmail("@x.com"), "***@x.com");
});
await check("F maskEmail(null／undefined／非字串) 不 throw（任務單：空值不 throw）", () => {
  for (const v of [null, undefined, 42]) {
    assert.doesNotThrow(() => ssr.maskEmail(v), `maskEmail(${String(v)}) threw`);
  }
});
await check("F formatNumber／formatPercent 為 zh-TW 千分位、1 位小數", () => {
  assert.equal(ssr.formatNumber(1234567), "1,234,567");
  assert.equal(ssr.formatNumber(0), "0");
  assert.equal(ssr.formatPercent(85), "85.0%");
  assert.equal(ssr.formatPercent(0), "0.0%");
  assert.equal(ssr.formatPercent(33.333), "33.3%");
  assert.equal(ssr.formatPercent(1234.5), "1,234.5%");
});
await check("F formatDate：今年不顯示年份、往年顯示年份、null／非法 → —", () => {
  const a = ssr.formatDate(THIS_YEAR);
  const b = ssr.formatDate(LAST_YEAR);
  assert.ok(!a.includes(String(Y)), `今年日期不應含年份：${a}`);
  assert.ok(b.includes(String(Y - 1)), `往年日期應含年份：${b}`);
  assert.equal(ssr.formatDate(null), "—");
  assert.equal(ssr.formatDate("not-a-date"), "—");
  info(`formatDate 今年=${a}；往年=${b}`);
});
await check("F 未知代號 →「其他」，並由 mergeByLabel 合併計數", () => {
  assert.equal(ssr.featureTypeLabel("MYSTERY"), "其他");
  assert.equal(ssr.surfaceLabel("nowhere"), "其他");
  assert.equal(ssr.providerLabel("acme"), "其他");
  assert.equal(ssr.recommendationFamilyLabel("weird_code"), "其他");
  assert.equal(ssr.providerLabel("tripcom"), "Trip.com");
  const merged = ssr.mergeByLabel(
    [{ k: "x", n: 2 }, { k: "cafe", n: 1 }, { k: "y", n: 2 }],
    (r) => ssr.recommendationFamilyLabel(r.k),
    (r) => r.n,
  );
  assert.deepEqual(merged, [{ label: "其他", count: 4 }, { label: "咖啡廳", count: 1 }]);
});

// ======================================================================== R: SSR
const FULL = "abcdef@gmail.com";
await check("R EmailCell SSR：只輸出遮蔽 email；完整 email 與 local part 不在 HTML 任何位置（含 title／aria-label／data-*）", () => {
  const html = render(h(ssr.EmailCell, { email: FULL }));
  assert.ok(html.includes("ab***@gmail.com"), html);
  assert.ok(!html.includes(FULL), "完整 email 出現在 HTML");
  assert.ok(!html.includes("abcdef"), "local part 出現在 HTML");
  assert.ok(!/\stitle="/.test(html), "不應有 title 屬性");
  assert.ok(!/\sdata-[\w-]+="/.test(html), "不應有 data-* 屬性");
  assert.match(html, /aria-label="顯示完整 Email"/);
  info("EmailCell SSR HTML: " + html.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>"));
});
await check("R EmailCell email=null → 無 Email；email='' → 無 Email", () => {
  assert.match(render(h(ssr.EmailCell, { email: null })), /無 Email/);
  assert.match(render(h(ssr.EmailCell, { email: "" })), /無 Email/);
});
await check("R UsersSection／TopUsersPanel SSR：表格與卡片各輸出遮蔽 email，完整 email 0 次", () => {
  const users = [mkUser("u1"), mkUser("u2", { email: "zz@y.com", plan: "plus" })];
  const html = render(
    h(ssr.UsersSection, {
      users, usersTotal: 1234, page: 1, totalPages: 25, loading: false, searchInput: "", onSearchInput() {},
      sort: "recently_active", sortOptions: [{ value: "recently_active", label: "最近活躍" }], onSort() {}, onPage() {},
    }),
  );
  assert.equal(html.split("ab***@gmail.com").length - 1, 2, "表格 1 次 + 卡片 1 次");
  assert.equal(html.split("z***@y.com").length - 1, 2);
  assert.ok(!html.includes(FULL) && !html.includes("abcdef") && !html.includes("zz@y.com"));
  assert.match(html, /1,234 位使用者/);
  assert.match(html, /第 1 頁，共 25 頁/);
  assert.match(html, />5,678</);
  const top = render(h(ssr.TopUsersPanel, { users }));
  assert.equal(top.split("ab***@gmail.com").length - 1, 2);
  assert.ok(!top.includes(FULL));
});
await check("R KPI：4 組（成長／活躍／內容／營收）、每組 grid-cols-2、zh-TW 數字、Plus 佔比", () => {
  const html = render(h(ssr.KpiSection, { summary: SUMMARY }));
  const titles = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ["成長", "活躍", "內容", "營收"]);
  assert.equal(html.split('class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"').length - 1, 4);
  assert.match(html, />12,345</);
  assert.match(html, />33,333</);
  assert.match(html, /佔總使用者 33\.3%/);
  const zero = render(h(ssr.KpiSection, { summary: { ...SUMMARY, totalUsers: 0, plusUsers: 0 } }));
  assert.match(zero, /佔總使用者 0\.0%/);
  assert.doesNotMatch(zero, /NaN|Infinity/);
});
const panel = (props) =>
  render(h(ssr.AnalyticsPanel, { period: "30d", onPeriod() {}, loading: false, error: null, onRetry() {}, ...props }));
await check("R 成功率「85.0%（成功 17／失敗 3）」；0 筆「—（尚無完成紀錄）」", () => {
  assert.ok(panel({ analytics: mkAnalytics() }).includes("85.0%（成功 17／失敗 3）"));
  const z = panel({ analytics: mkAnalytics("30d", { itinerarySuccesses: 0, itineraryFailures: 0, itinerarySuccessRate: 0 }) });
  assert.ok(z.includes("—（尚無完成紀錄）"));
  assert.ok(!z.includes("0.0%（成功"));
});
await check("R 分析區：四個期間標題、按鈕 aria-pressed、zh-TW 數字、今年日期無年份", () => {
  for (const [p, t] of [["today", "今天"], ["7d", "近 7 日"], ["30d", "近 30 日"], ["all", "全部期間"]]) {
    const html = panel({ period: p, analytics: mkAnalytics(p) });
    assert.ok(html.includes(`分析指標 · ${t}`), p);
    assert.equal(html.split('aria-pressed="true"').length - 1, 1);
  }
  const html = panel({ analytics: mkAnalytics() });
  assert.ok(html.includes(">12,345<"));
  assert.ok(html.includes("1,500 次（不重複地點 321 個）"));
  assert.ok(html.includes("曝光 1,000 → 點擊 50 → 成功開啟 40"));
  assert.ok(html.includes("事件自 ") && !html.includes(`${Y}/`) && !html.includes(`${Y}年`));
});
await check("R 分析區未知代號 →「其他」（合併、不露出原始代號）", () => {
  const html = panel({
    analytics: mkAnalytics("30d", {
      popularRecommendationFamilies: [{ family: "weird_one", count: 2 }, { family: "cafe", count: 1 }, { family: "weird_two", count: 1 }],
      placeClickSurfaces: [{ surface: "mystery_surface", count: 3 }],
      affiliateByProvider: [{ provider: "acme_corp", impressions: 5, clicks: 1, opens: 1 }],
    }),
  });
  assert.ok(!/weird_one|weird_two|mystery_surface|acme_corp/.test(html), "原始代號外露");
  assert.ok(html.includes("其他"));
  assert.ok(html.includes("3 次 · 75.0%"), "其他(2+1) 應合併為 3 次 75%");
});
await check("R 分析區空狀態：無曝光、三個清單「尚無資料」、analytics=null →「暫時無法取得」+ 重試、error 顯示原文、loading 不顯示內容", () => {
  const empty = panel({
    analytics: mkAnalytics("30d", { popularRecommendationFamilies: [], placeClickSurfaces: [], affiliateByProvider: [], affiliateImpressions: 0 }),
  });
  assert.ok(empty.includes("—（尚無曝光）"));
  assert.equal(empty.split("尚無資料").length - 1, 3);
  const nul = panel({ analytics: null });
  assert.ok(nul.includes("暫時無法取得") && nul.includes("重試"));
  const err = panel({ analytics: mkAnalytics(), error: "操作太頻繁，請稍候約 1 分鐘再試。" });
  assert.ok(err.includes("操作太頻繁，請稍候約 1 分鐘再試。") && err.includes("重試"));
  assert.ok(!err.includes("行程生成成功率"), "錯誤時不應顯示舊資料內容");
  const load = panel({ analytics: mkAnalytics(), loading: true });
  assert.ok(load.includes('aria-busy="true"') && !load.includes("行程生成成功率"));
});
await check("R Credits：Production/committed 說明、未知 feature →「其他」、zh-TW 數字、空 →「尚無資料」", () => {
  const html = render(
    h(ssr.CreditsPanel, {
      summary: SUMMARY,
      breakdown: [{ featureType: "ITINERARY_GENERATION", credits: 1200 }, { featureType: "SECRET_FEATURE", credits: 3 }],
    }),
  );
  assert.ok(html.includes(ssr.CREDITS_SCOPE_NOTE));
  assert.ok(html.includes("行程生成") && html.includes(">1,200<") && html.includes("其他") && !html.includes("SECRET_FEATURE"));
  assert.ok(html.includes(">1,234,567<"));
  assert.ok(render(h(ssr.CreditsPanel, { summary: SUMMARY, breakdown: [] })).includes("尚無資料"));
});
await check("R 空狀態：使用者表「找不到符合條件的使用者」、最活躍「尚無活躍使用者資料」、目的地「尚無收藏行程目的地」、loading → skeleton", () => {
  const base = {
    usersTotal: 0, page: 1, totalPages: 1, searchInput: "", onSearchInput() {}, sort: "recently_active",
    sortOptions: [], onSort() {}, onPage() {},
  };
  assert.ok(render(h(ssr.UsersSection, { ...base, users: [], loading: false })).includes("找不到符合條件的使用者"));
  const loading = render(h(ssr.UsersSection, { ...base, users: [mkUser("u1")], loading: true }));
  assert.ok(loading.includes('aria-label="載入表格中"') && !loading.includes("ab***"));
  assert.ok(render(h(ssr.TopUsersPanel, { users: [] })).includes("尚無活躍使用者資料"));
  assert.ok(render(h(ssr.DestinationsPanel, { rows: [] })).includes("尚無收藏行程目的地"));
});

// ======================================================================== H: harness
const timers = new Map();
let timerId = 0;
globalThis.window = {
  setTimeout: (fn, ms) => { timerId += 1; timers.set(timerId, { fn, ms }); return timerId; },
  clearTimeout: (id) => { timers.delete(id); },
};
const advanceTimers = () => {
  const list = [...timers.entries()];
  timers.clear();
  for (const [, t] of list) t.fn();
};
let reqs = [];
globalThis.fetch = (url, init) =>
  new Promise((resolve, reject) => {
    const u = new URL(String(url));
    reqs.push({ url: String(url), path: u.pathname, params: Object.fromEntries(u.searchParams), init, resolve, reject, done: false });
  });
const respond = (req, status, body) => {
  assert.ok(req && !req.done, "request already answered");
  req.done = true;
  req.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
};
const fail = (req) => { req.done = true; req.reject(new TypeError("Failed to fetch")); };

function mount(Comp, props = {}) {
  const st = { slots: {}, pending: [], dirty: false, i: 0, tree: null, renders: 0, sets: 0 };
  const doRender = () => {
    for (let n = 0; n < 50; n += 1) {
      globalThis.__hooks = st;
      st.i = 0;
      st.dirty = false;
      st.pending = [];
      try {
        st.tree = Comp(props);
      } finally {
        globalThis.__hooks = null;
      }
      st.renders += 1;
      for (const p of st.pending) {
        if (typeof p.s.cleanup === "function") p.s.cleanup();
        p.s.cleanup = p.fn();
        p.s.deps = p.deps;
        p.s.mounted = true;
      }
      if (!st.dirty) return;
    }
    throw new Error("render loop did not settle");
  };
  doRender();
  return {
    st,
    get tree() { return st.tree; },
    async settle() {
      for (let k = 0; k < 40; k += 1) {
        await new Promise((r) => setImmediate(r));
        if (st.dirty) doRender();
      }
    },
  };
}
const walk = (node, fn) => {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (typeof node === "object" && node.$el) { fn(node); walk(node.props.children, fn); }
};
const findAll = (tree, pred) => { const r = []; walk(tree, (n) => { if (pred(n)) r.push(n); }); return r; };
const byType = (tree, type) => findAll(tree, (n) => n.type === type);
const one = (tree, type, label) => { const r = byType(tree, type); assert.equal(r.length, 1, `${label} 應出現 1 次，實際 ${r.length}`); return r[0]; };
const textOf = (node) => {
  const r = [];
  const w = (n) => {
    if (typeof n === "string" || typeof n === "number") r.push(String(n));
    else if (Array.isArray(n)) n.forEach(w);
    else if (n && n.$el) w(n.props.children);
  };
  w(node);
  return r.join("");
};
const retryButtons = (tree) => findAll(tree, (n) => typeof n.type === "function" && /^RetryButton\d*$/.test(n.type.name));
let Page = hx.Route.options.component;
const pending = () => reqs.filter((r) => !r.done);
const dashReqs = () => reqs.filter((r) => r.params.scope === undefined);
const anaReqs = () => reqs.filter((r) => r.params.scope === "analytics");
const mkDash = (marker, period = "30d", users = [mkUser("u-" + marker)]) => ({
  observedAt: THIS_YEAR, summary: SUMMARY, users, usersTotal: 120, topUsers: [], popularDestinations: [],
  creditBreakdown30d: [], analytics: mkAnalytics(period, { chatSessions: marker }),
});
const anaMarker = (app) => one(app.tree, hx.AnalyticsPanel, "AnalyticsPanel").props.analytics?.chatSessions ?? null;
const anaProps = (app) => one(app.tree, hx.AnalyticsPanel, "AnalyticsPanel").props;
const usersProps = (app) => one(app.tree, hx.UsersSection, "UsersSection").props;

async function readyPage() {
  reqs = [];
  timers.clear();
  globalThis.__ui = { navigations: [], sessionCalls: 0, stashed: 0, session: { access_token: "tok" } };
  const app = mount(Page);
  await app.settle();
  assert.equal(reqs.length, 1, "mount 應只送 1 個請求");
  respond(reqs[0], 200, { dashboard: mkDash(100) });
  await app.settle();
  return app;
}

await check("H 初始載入：只送 1 次 dashboard（sort／page／period=30d，無 scope），Bearer token、no-store；debounce 不重送", async () => {
  reqs = [];
  timers.clear();
  const app = mount(Page);
  assert.ok(textOf(app.tree).includes("載入中…"));
  await app.settle();
  assert.equal(reqs.length, 1);
  assert.deepEqual(reqs[0].params, { sort: "recently_active", page: "1", period: "30d" });
  assert.equal(reqs[0].path, "/api/admin/dashboard");
  assert.equal(reqs[0].init.headers.Authorization, "Bearer tok");
  assert.equal(reqs[0].init.cache, "no-store");
  advanceTimers();
  await app.settle();
  assert.equal(reqs.length, 1, "debounce 以相同值 setSearch/setPage 不得重送");
  respond(reqs[0], 200, { dashboard: mkDash(100) });
  await app.settle();
  assert.equal(usersProps(app).loading, false);
  assert.equal(anaMarker(app), 100);
  assert.equal(anaProps(app).period, "30d");
  assert.equal(reqs.length, 1);
});

await check("H 時間切換：只送 scope=analytics&period=（無 sort/page/search），loading → 資料；同值點擊不送", async () => {
  const app = await readyPage();
  anaProps(app).onPeriod("7d");
  await app.settle();
  assert.equal(reqs.length, 2);
  assert.deepEqual(reqs[1].params, { scope: "analytics", period: "7d" });
  assert.equal(anaProps(app).loading, true);
  assert.equal(anaProps(app).period, "7d");
  assert.equal(usersProps(app).loading, false, "切換時間不應讓使用者表格進入 loading");
  respond(reqs[1], 200, { analytics: mkAnalytics("7d", { chatSessions: 7 }) });
  await app.settle();
  assert.equal(anaProps(app).loading, false);
  assert.equal(anaMarker(app), 7);
  anaProps(app).onPeriod("7d");
  await app.settle();
  assert.equal(reqs.length, 2, "同值點擊不應送請求");
  assert.equal(dashReqs().length, 1, "時間切換不應重抓 phase1");
});

async function raceAnalytics() {
  const app = await readyPage();
  anaProps(app).onPeriod("today");
  anaProps(app).onPeriod("all");
  await app.settle();
  const [rToday, rAll] = anaReqs();
  assert.equal(rToday.params.period, "today");
  assert.equal(rAll.params.period, "all");
  respond(rAll, 200, { analytics: mkAnalytics("all", { chatSessions: 4 }) });
  await app.settle();
  assert.equal(anaMarker(app), 4);
  assert.equal(anaProps(app).loading, false);
  respond(rToday, 200, { analytics: mkAnalytics("today", { chatSessions: 1 }) });
  await app.settle();
  assert.equal(anaMarker(app), 4, "舊回應(today)覆蓋了新回應(all)");
  assert.equal(anaProps(app).period, "all");
  anaProps(app).onPeriod("30d");
  anaProps(app).onPeriod("7d");
  await app.settle();
  const [r30, r7] = anaReqs().slice(2);
  respond(r30, 200, { analytics: mkAnalytics("30d", { chatSessions: 30 }) });
  await app.settle();
  assert.equal(anaMarker(app), 4, "舊回應(30d)不得先套用");
  assert.equal(anaProps(app).loading, true, "最新請求未回前應保持 loading");
  respond(r7, 500, { error: "x" });
  await app.settle();
  assert.equal(anaProps(app).error, "伺服器暫時無法取得資料，請稍後再試。");
  assert.equal(anaProps(app).loading, false);
}
await check("H 競態（analytics vs analytics）：today→all，回應順序 all 先、today 後 → 保留 all；30d→7d，30d 先回被忽略", raceAnalytics);

async function raceDashboard() {
  const app = await readyPage();
  usersProps(app).onPage(2);
  await app.settle();
  anaProps(app).onPeriod("today");
  await app.settle();
  let d = dashReqs().at(-1);
  let a = anaReqs().at(-1);
  assert.deepEqual(d.params, { sort: "recently_active", page: "2", period: "30d" });
  respond(a, 200, { analytics: mkAnalytics("today", { chatSessions: 11 }) });
  await app.settle();
  respond(d, 200, { dashboard: mkDash(222) });
  await app.settle();
  assert.equal(anaMarker(app), 11, "dashboard 的 30d analytics 覆蓋了 today");
  assert.equal(usersProps(app).users[0].userId, "u-222", "使用者資料仍應更新");
  // reverse order
  usersProps(app).onPage(3);
  await app.settle();
  d = dashReqs().at(-1);
  assert.equal(d.params.period, "today", "之後的 dashboard 請求應帶目前期間");
  anaProps(app).onPeriod("all");
  await app.settle();
  a = anaReqs().at(-1);
  respond(d, 200, { dashboard: mkDash(333, "today") });
  await app.settle();
  assert.equal(anaMarker(app), 11, "dashboard 先回時不得覆蓋（analyticsSeq 已變）");
  assert.equal(anaProps(app).loading, true);
  respond(a, 200, { analytics: mkAnalytics("all", { chatSessions: 44 }) });
  await app.settle();
  assert.equal(anaMarker(app), 44);
  // same period, no switch in flight → dashboard analytics applies
  usersProps(app).onSort("newest");
  await app.settle();
  d = dashReqs().at(-1);
  assert.deepEqual(d.params, { sort: "newest", page: "1", period: "all" });
  respond(d, 200, { dashboard: mkDash(555, "all") });
  await app.settle();
  assert.equal(anaMarker(app), 555, "同期間、無切換時應套用 dashboard 內的 analytics");
}
await check("H 競態（dashboard vs analytics）：換頁中切換時間，dashboard 的舊期間 analytics 不覆蓋（兩種回應順序）", raceDashboard);

async function r1NoFullPageLoading() {
  const app = await readyPage();
  for (const act of [
    () => usersProps(app).onPage(2),
    () => usersProps(app).onSort("oldest"),
    () => { usersProps(app).onSearchInput("relay"); },
  ]) {
    const before = reqs.length;
    act();
    await app.settle();
    if (reqs.length === before) { advanceTimers(); await app.settle(); }
    assert.equal(reqs.length, before + 1, "每個動作只送 1 次請求");
    assert.ok(!textOf(app.tree).includes("載入中…"), "整頁變成載入中");
    assert.equal(usersProps(app).loading, true);
    assert.equal(usersProps(app).users[0].userId, "u-100", "loading 時保留上一份資料");
    assert.equal(byType(app.tree, hx.KpiSection).length, 1);
    assert.equal(anaMarker(app), 100);
    assert.equal(anaProps(app).loading, false);
    respond(reqs.at(-1), 200, { dashboard: mkDash(100) });
    await app.settle();
    assert.equal(usersProps(app).loading, false);
  }
  const last = reqs.at(-1).params;
  assert.deepEqual(last, { sort: "oldest", page: "1", period: "30d", search: "relay" });
}
await check("H R1：搜尋／排序／換頁時不整頁「載入中」，只有 UsersSection loading，KPI 與分析保留", r1NoFullPageLoading);

await check("H R1 搜尋 debounce：連打 3 字只送 1 次（page=1）", async () => {
  const app = await readyPage();
  usersProps(app).onPage(4);
  await app.settle();
  respond(reqs.at(-1), 200, { dashboard: mkDash(100) });
  await app.settle();
  const before = reqs.length;
  usersProps(app).onSearchInput("a");
  await app.settle();
  usersProps(app).onSearchInput("ab");
  await app.settle();
  usersProps(app).onSearchInput("abc ");
  await app.settle();
  assert.equal(reqs.length, before);
  advanceTimers();
  await app.settle();
  assert.equal(reqs.length, before + 1);
  assert.deepEqual(reqs.at(-1).params, { sort: "recently_active", page: "1", period: "30d", search: "abc" });
});

await check("H R2：已有資料時 users 500 → 橫幅 + 重試（不整頁），重試重送同參數", async () => {
  const app = await readyPage();
  usersProps(app).onPage(2);
  await app.settle();
  respond(reqs.at(-1), 500, { error: "Admin analytics unavailable" });
  await app.settle();
  const t = textOf(app.tree);
  assert.ok(t.includes("伺服器暫時無法取得資料，請稍後再試。"));
  assert.ok(!t.includes("管理後台暫時無法載入"), "不應整頁錯誤");
  assert.equal(byType(app.tree, hx.UsersSection).length, 1);
  const btns = retryButtons(app.tree);
  assert.equal(btns.length, 1);
  const prev = reqs.at(-1).params;
  btns[0].props.onClick();
  await app.settle();
  assert.deepEqual(reqs.at(-1).params, prev);
  assert.equal(usersProps(app).page, 2);
  info(`users 錯誤時 UsersSection.page=${usersProps(app).page}，users 仍為上一頁資料 ${usersProps(app).users[0].userId}（頁碼與資料不一致，見報告）`);
  respond(reqs.at(-1), 200, { dashboard: mkDash(200) });
  await app.settle();
  assert.equal(retryButtons(app.tree).length, 0);
});

await check("H R2：初次 429 → 整頁友善文字 + 重試；重試成功後顯示資料", async () => {
  reqs = [];
  const app = mount(Page);
  await app.settle();
  respond(reqs[0], 429, { error: "rate_limited" });
  await app.settle();
  const t = textOf(app.tree);
  assert.ok(t.includes("管理後台暫時無法載入"));
  assert.ok(t.includes("操作太頻繁，請稍候約 1 分鐘再試。"));
  assert.ok(!t.includes("rate_limited"), "不應露出錯誤代碼");
  const btn = retryButtons(app.tree);
  assert.equal(btn.length, 1);
  btn[0].props.onClick();
  await app.settle();
  assert.equal(reqs.length, 2);
  respond(reqs[1], 200, { dashboard: mkDash(9) });
  await app.settle();
  assert.equal(anaMarker(app), 9);
});

await check("H R2：analytics 429 → 友善文字；onRetry 以目前期間重送 scope=analytics；回傳 analytics=null → 顯示暫時無法取得", async () => {
  const app = await readyPage();
  anaProps(app).onPeriod("7d");
  await app.settle();
  respond(anaReqs().at(-1), 429, { error: "rate_limited" });
  await app.settle();
  assert.equal(anaProps(app).error, "操作太頻繁，請稍候約 1 分鐘再試。");
  anaProps(app).onRetry();
  await app.settle();
  assert.deepEqual(anaReqs().at(-1).params, { scope: "analytics", period: "7d" });
  assert.equal(anaProps(app).error, null);
  respond(anaReqs().at(-1), 200, { analytics: null });
  await app.settle();
  assert.equal(anaProps(app).analytics, null);
  assert.equal(anaProps(app).error, null);
});

await check("H 400／網路錯誤／無 session／401／403 的轉換", async () => {
  // network error
  reqs = [];
  let app = mount(Page);
  await app.settle();
  fail(reqs[0]);
  await app.settle();
  assert.ok(textOf(app.tree).includes("網路連線失敗，請確認連線後重試。"));
  // 400
  reqs = [];
  app = mount(Page);
  await app.settle();
  respond(reqs[0], 400, { error: "Invalid admin dashboard query" });
  await app.settle();
  assert.ok(textOf(app.tree).includes("查詢條件無效，請調整搜尋或排序後再試。"));
  // no session → no fetch
  reqs = [];
  globalThis.__ui.session = null;
  app = mount(Page);
  await app.settle();
  assert.equal(reqs.length, 0);
  assert.ok(textOf(app.tree).includes("請先登入 Roamie"));
  globalThis.__ui.session = { access_token: "tok" };
  // analytics 401 / 403
  app = await readyPage();
  anaProps(app).onPeriod("today");
  await app.settle();
  respond(anaReqs().at(-1), 401, { error: "Authentication required" });
  await app.settle();
  assert.ok(textOf(app.tree).includes("請先登入 Roamie"));
  app = await readyPage();
  anaProps(app).onPeriod("today");
  await app.settle();
  respond(anaReqs().at(-1), 403, { error: "Admin access required" });
  await app.settle();
  assert.ok(textOf(app.tree).includes("此帳號沒有管理員權限"));
});

await check("H 卸載後回應不 setState（cleanup cancelled）：換頁 A→B，A 晚回不覆蓋 B", async () => {
  const app = await readyPage();
  usersProps(app).onPage(2);
  await app.settle();
  const rA = reqs.at(-1);
  usersProps(app).onPage(3);
  await app.settle();
  const rB = reqs.at(-1);
  respond(rB, 200, { dashboard: mkDash(3) });
  await app.settle();
  respond(rA, 200, { dashboard: mkDash(2) });
  await app.settle();
  assert.equal(usersProps(app).users[0].userId, "u-3");
  assert.equal(usersProps(app).loading, false);
});

await check("H EmailCell 點擊才顯示完整 email，再點擊隱藏（aria-label 同步）", async () => {
  const app = mount(hx.EmailCell, { email: FULL });
  const btn = () => findAll(app.tree, (n) => n.type === "button")[0];
  const spanText = () => textOf(findAll(btn(), (n) => n.type === "span")[0]);
  assert.equal(spanText(), "ab***@gmail.com");
  assert.equal(btn().props["aria-label"], "顯示完整 Email");
  assert.ok(!JSON.stringify(Object.fromEntries(Object.entries(btn().props).filter(([k]) => k !== "children"))).includes("abcdef"));
  btn().props.onClick();
  await app.settle();
  assert.equal(spanText(), FULL);
  assert.equal(btn().props["aria-label"], "隱藏完整 Email");
  btn().props.onClick();
  await app.settle();
  assert.equal(spanText(), "ab***@gmail.com");
});

// ======================================================================== M: mutation（鑑別力）
// 在 bundle 內把 admin.tsx 的防護拿掉（不改 source），同一個測試函式必須失敗。
const ADMIN_PATH = path.join(root, "src/routes/admin.tsx");
function mutate(from, to, label) {
  const n = ADMIN_ROUTE.split(from).length - 1;
  assert.equal(n, 1, `mutation ${label}: 應命中 1 次，實際 ${n}`);
  return ADMIN_ROUTE.replace(from, to);
}
const MUTANTS = [
  ["移除 analyticsSeq 檢查（loadAnalytics）", "      if (seq !== analyticsSeq.current) return;\n", "", raceAnalytics],
  [
    "移除 dashboard 回應的 period/seq 條件",
    "if (requestedPeriod === periodRef.current && analyticsSeqAtStart === analyticsSeq.current) {",
    "if (true) {",
    raceDashboard,
  ],
  ["usersLoading 時整頁載入中（HEAD 行為）", "  if (!data) {\n", "  if (!data || usersLoading) {\n", r1NoFullPageLoading],
];
const origHx = hx;
for (const [label, from, to, fn] of MUTANTS) {
  await check(`M 鑑別力：${label} → 對應測試必須失敗`, async () => {
    const file = await bundleStdin(HARNESS_ENTRY, HARNESS_MOCKS, { [ADMIN_PATH]: mutate(from, to, label) });
    hx = await import(pathToFileURL(file).href);
    Page = hx.Route.options.component;
    let threw = null;
    try {
      await fn();
    } catch (e) {
      threw = e;
    } finally {
      hx = origHx;
      Page = hx.Route.options.component;
    }
    assert.ok(threw, "mutant 仍通過 → 測試沒有鑑別力");
    info(`mutant「${label}」失敗訊息：${String(threw.message).split("\n")[0]}`);
  });
}

// ======================================================================== L: 375px static analysis (未實機)
// Full page SSR: run admin.tsx in the harness to "ready", then convert its tree to real React
// elements (component elements → SSR-bundle components of the same name).
function toReal(node) {
  if (node == null || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return node;
  if (Array.isArray(node)) return node.map(toReal);
  if (!node.$el) return node;
  const { children, ...rest } = node.props;
  const t = node.type;
  if (t === Symbol.for("harness.fragment")) return h(ssr.Fragment, { key: node.key }, toReal(children));
  if (typeof t === "string") return h(t, { ...rest, key: node.key }, toReal(children));
  if (typeof t === "function") {
    const name = t.name.replace(/\d+$/, "");
    if (ssr[name]) return h(ssr[name], { ...node.props, key: node.key });
    return toReal(t(node.props));
  }
  return h(t, { ...rest, key: node.key }, toReal(children));
}
const VOID = new Set(["input", "img", "br", "hr", "meta", "link", "source", "col", "wbr", "area"]);
function parseHtml(html) {
  const top = { tag: "#root", cls: [], children: [], parent: null, text: "" };
  let cur = top;
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) { cur.text += m[5]; continue; }
    const [, close, tag, attrs, self] = m;
    if (close) { cur = cur.parent ?? top; continue; }
    const cls = (/\sclass="([^"]*)"/.exec(attrs)?.[1] ?? "").split(/\s+/).filter(Boolean);
    const node = { tag, cls, attrs, children: [], parent: cur, text: "" };
    cur.children.push(node);
    if (!self && !VOID.has(tag)) cur = node;
  }
  return top;
}
const all = (n, acc = []) => { for (const c of n.children) { acc.push(c); all(c, acc); } return acc; };
const has = (n, t) => n.cls.includes(t);
const hiddenAt375 = (n) => { for (let a = n; a; a = a.parent) if (a.cls?.includes("hidden")) return true; return false; };
const isLayout = (n) => ["flex", "inline-flex", "grid", "inline-grid"].some((t) => has(n, t));
const isGrid = (n) => has(n, "grid") || has(n, "inline-grid");
const desc = (n) => `<${n.tag} class="${n.cls.join(" ")}">`;
const inOverflowX = (n) => { for (let a = n.parent; a; a = a.parent) if (a.cls?.some((t) => t === "overflow-x-auto" || t === "overflow-auto")) return a; return null; };
const pxOf = (n) => {
  let w = 0;
  for (const t of n.cls) {
    const m = /^p(x)?-(\d+(?:\.\d+)?)$/.exec(t);
    if (m) w += Number(m[2]) * 4 * 2;
    if (t === "border") w += 2;
  }
  return w;
};
const fixedWidth = (t) => {
  let m = /^(?:min-w|w)-\[(\d+)px\]$/.exec(t);
  if (m) return Number(m[1]);
  m = /^w-(\d+)$/.exec(t);
  return m ? Number(m[1]) * 4 : null;
};

function analyze375(html, label) {
  const tree = parseHtml(html);
  const nodes = all(tree);
  const issues = [];
  const notes = [];
  for (const n of nodes) {
    if (hiddenAt375(n)) continue;
    // grid children need min-w-0
    if (n.parent && n.parent.cls && isGrid(n.parent) && !has(n, "min-w-0")) issues.push(`grid 子項缺 min-w-0：${desc(n)} in ${desc(n.parent)}`);
    // truncate chain: every flex/grid item ancestor needs min-w-0 or overflow-hidden
    if (has(n, "truncate")) {
      for (let c = n.parent; c && c.parent; c = c.parent) {
        if (c.parent.cls && isLayout(c.parent) && !has(c, "min-w-0") && !has(c, "overflow-hidden") && !has(c, "truncate")) {
          issues.push(`truncate 鏈斷（祖先 flex/grid 子項缺 min-w-0）：${desc(n)} ← ${desc(c)}`);
          break;
        }
        if (c.cls.some((t) => t === "overflow-x-auto" || t === "overflow-hidden")) break;
      }
    }
    // flex children without min-w-0 that hold text (informational)
    if (n.parent && n.parent.cls && isLayout(n.parent) && !isGrid(n.parent) && !has(n, "min-w-0") && !has(n, "shrink-0") && n.tag !== "svg") {
      const txt = (n.text + all(n).map((x) => x.text).join("")).trim();
      if (txt.length > 12) notes.push(`flex 子項無 min-w-0（含 ${txt.length} 字）：${desc(n)} 「${txt.slice(0, 18)}…」`);
    }
  }
  for (const n of nodes) {
    // fixed widths
    for (const t of n.cls) {
      const w = fixedWidth(t);
      if (w === null) continue;
      const box = inOverflowX(n);
      if (w > 240 && !box) issues.push(`固定寬度 ${t} 不在 overflow 容器內：${desc(n)}`);
      if (box && !hiddenAt375(n)) {
        let avail = 375;
        for (let a = box; a && a.cls; a = a.parent) avail -= pxOf(a);
        if (w > avail) notes.push(`${t} 在 375px 下可用寬約 ${avail}px → 容器內橫向捲動：${desc(n)}`);
      }
    }
    if (n.tag === "table" && !inOverflowX(n)) issues.push(`table 不在 overflow-x-auto 內：${desc(n)}`);
  }
  const desktopOnly = nodes.filter((n) => has(n, "hidden") && n.cls.includes("md:block")).length;
  const mobileOnly = nodes.filter((n) => n.cls.includes("md:hidden")).length;
  return { issues, notes, desktopOnly, mobileOnly, nodes: nodes.length, label };
}

const LONG_NAME = "非常非常長的使用者顯示名稱用來測試截斷效果非常非常長的名字";
const LONG_EMAIL = "averyveryverylongemailaddressforlayouttesting@subdomain.example-company.com";
await check("L 375px 全頁（admin.tsx ready 狀態 SSR，未實機）：grid 子項 min-w-0、truncate 鏈、表格皆在 overflow-x-auto、md 卡片／表格成對", async () => {
  reqs = [];
  const app = mount(Page);
  await app.settle();
  const users = [mkUser("u1", { displayName: LONG_NAME, email: LONG_EMAIL }), mkUser("u2", { plan: "plus" })];
  respond(reqs[0], 200, {
    dashboard: {
      ...mkDash(1, "30d", users),
      topUsers: users,
      popularDestinations: [{ destination: "Some Extremely Long Destination Name, Prefecture, Country", tripCount: 12345, uniqueUsers: 678, lastSavedAt: LAST_YEAR }],
      creditBreakdown30d: [{ featureType: "PLACE_RECOMMENDATION", credits: 10 }, { featureType: "ZZZ", credits: 1 }],
      analytics: mkAnalytics("30d", {
        popularRecommendationFamilies: [{ family: "late_night", count: 3 }, { family: "unknown_family", count: 1 }],
        placeClickSurfaces: [{ surface: "selection", count: 2 }],
        affiliateByProvider: [{ provider: "booking", impressions: 123456, clicks: 12345, opens: 1234 }],
      }),
    },
  });
  await app.settle();
  const html = render(toReal(app.tree));
  assert.ok(html.includes("Roamie 營運後台") && html.includes("總覽") && html.includes("分析指標 · 近 30 日"));
  assert.ok(!html.includes(LONG_EMAIL) && !html.includes(FULL), "全頁 SSR 不得出現完整 email");
  const r = analyze375(html, "full page");
  info(`375 分析：節點 ${r.nodes}，hidden md:block=${r.desktopOnly}，md:hidden=${r.mobileOnly}`);
  for (const n of r.notes) info("375 " + n);
  for (const n of r.issues) info("375 ISSUE " + n);
  assert.equal(r.desktopOnly, r.mobileOnly, "md:hidden 卡片與 hidden md:block 表格數量應成對");
  assert.equal(r.desktopOnly, 2, "使用者表與最活躍使用者各 1 對");
  assert.deepEqual(r.issues, []);
  const page = parseHtml(html);
  const mainWrap = all(page).find((n) => has(n, "max-w-[1500px]") && has(n, "space-y-8"));
  assert.ok(mainWrap && has(mainWrap, "px-4") && !mainWrap.cls.some((t) => /^px-[0-35-9]/.test(t)));
});

console.error = realConsoleError;
fs.rmSync(tmp, { recursive: true, force: true });
out(`\nRESULT pass=${passCount} fail=${failures.length}`);
if (failures.length) {
  out("FAILED:\n  " + failures.join("\n  "));
  process.exitCode = 1;
}
