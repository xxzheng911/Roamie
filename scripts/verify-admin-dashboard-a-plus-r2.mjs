import "./verify-netguard-full.mjs";
// verify-admin-dashboard-a-plus-r2.mjs — 任務單 #ADM-T2（tester 第 2 輪）：ADM2 修正獨立複驗
//
//   (a) 第 2 頁失敗 → 顯示第 1 頁（頁碼／資料／分頁按鈕都依第 1 頁）；重試 → 請求第 2 頁 → 成功顯示第 2 頁
//   (b) 失敗後再點第 2 頁 → reloadKey 重送（不能沒反應）
//   (c) 失敗後點第 1 頁（目前顯示頁）→ 回報實際行為、不卡住
//   (d) 快速 2 → 3：最後顯示與最後請求一致（兩種回應順序 + 3 失敗／2 晚回）
//   (e) 換頁時不整頁「載入中」（R1）
//   (f) maskEmail 邊界輸入
//   (g) 目的地表 SSR：無 min-w-[、有 break-words、table 在 overflow-x-auto 內
//   M   鑑別力：拿掉 shownPage／reloadKey 後 (a)(b) 必須失敗
//
// 以 mock React hooks runtime 實際執行 admin.tsx 元件函式與 effect（沿用 a-plus 腳本寫法；非 jsdom、非瀏覽器）。
// 執行：node scripts/verify-d4-watchdog.mjs --timeout=120 scripts/verify-admin-dashboard-a-plus-r2.mjs

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
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const ADMIN_ROUTE = read("src/routes/admin.tsx");
const INSIGHT_SRC = read("src/components/admin/InsightPanels.tsx");

// ======================================================================== bundling
const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-admin-a-plus-r2-"));
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
export { maskEmail } from "./src/components/admin/admin-format.ts";
export { DestinationsPanel } from "./src/components/admin/InsightPanels.tsx";
export { renderToStaticMarkup } from "react-dom/server";
export { createElement } from "react";
`;
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

// ======================================================================== fixtures
const Y = new Date().getFullYear();
const THIS_YEAR = `${Y}-06-15T04:07:00.000Z`;
const SUMMARY = {
  totalUsers: 12345, newUsersToday: 12, newUsers7d: 345, newUsers30d: 1234, dau: 1500, wau: 4321, mau: 9876,
  userChatsToday: 2222, userChats7d: 33333, savedTripsToday: 7, savedTrips7d: 1001, savedPlaces7d: 2002,
  freeUsers: 8230, plusUsers: 4115, committedCreditsToday: 1234, committedCredits7d: 56789, committedCredits30d: 1234567,
};
const mkUser = (id) => ({
  userId: id, displayName: "測試使用者", email: "abcdef@gmail.com", createdAt: THIS_YEAR, lastSignInAt: null,
  lastActiveAt: THIS_YEAR, actions7d: 1, actions30d: 2, chatCount: 3, tripCount: 2, savedPlaceCount: 1, plan: "free",
});
const mkAnalytics = (period = "30d", over = {}) => ({
  observedAt: THIS_YEAR, period, trackingStartedAt: THIS_YEAR, chatSessions: 1, itineraryAttempts: 0,
  itinerarySuccesses: 0, itineraryFailures: 0, itinerarySuccessRate: 0, popularRecommendationFamilies: [],
  placeClickSurfaces: [], placeCardClicks: 0, uniqueClickedPlaces: 0, affiliateImpressions: 0, affiliateClicks: 0,
  affiliateOpenSuccesses: 0, affiliateCtr: 0, affiliateByProvider: [], ...over,
});
// usersTotal=120 → totalPages=3
const mkDash = (marker) => ({
  observedAt: THIS_YEAR, summary: SUMMARY, users: [mkUser("u-" + marker)], usersTotal: 120, topUsers: [],
  popularDestinations: [], creditBreakdown30d: [], analytics: mkAnalytics("30d", { chatSessions: marker }),
});

// ======================================================================== harness runtime
const timers = new Map();
let timerId = 0;
globalThis.window = {
  setTimeout: (fn, ms) => { timerId += 1; timers.set(timerId, { fn, ms }); return timerId; },
  clearTimeout: (id) => { timers.delete(id); },
};
let reqs = [];
globalThis.fetch = (url, init) =>
  new Promise((resolve, reject) => {
    const u = new URL(String(url));
    reqs.push({ url: String(url), params: Object.fromEntries(u.searchParams), init, resolve, reject, done: false });
  });
const respond = (req, status, body) => {
  assert.ok(req && !req.done, "request already answered");
  req.done = true;
  req.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
};

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
const dashReqs = () => reqs.filter((r) => r.params.scope === undefined);
const usersProps = (app) => {
  const r = findAll(app.tree, (n) => n.type === hx.UsersSection);
  assert.equal(r.length, 1, `UsersSection 應出現 1 次，實際 ${r.length}`);
  return r[0].props;
};
// UsersSection 沒有 hooks → 直接以目前 props 執行，取得實際分頁列（文字、按鈕 disabled／onClick）
function pager(app) {
  const tree = hx.UsersSection(usersProps(app));
  const label = findAll(tree, (n) => n.type === "span" && n.props.className === "text-slate-500");
  assert.equal(label.length, 1, "分頁文字 span 應 1 個");
  const btn = (aria) => {
    const b = findAll(tree, (n) => n.type === "button" && n.props["aria-label"] === aria);
    assert.equal(b.length, 1, aria);
    return b[0];
  };
  return { text: textOf(label[0]), prev: btn("上一頁"), next: btn("下一頁") };
}
const shownUser = (app) => usersProps(app).users[0].userId;

async function readyPage() {
  reqs = [];
  timers.clear();
  globalThis.__ui = { navigations: [], sessionCalls: 0, stashed: 0, session: { access_token: "tok" } };
  const app = mount(Page);
  await app.settle();
  assert.equal(reqs.length, 1, "mount 應只送 1 個請求");
  respond(reqs[0], 200, { dashboard: mkDash(100) });
  await app.settle();
  assert.equal(pager(app).text, "第 1 頁，共 3 頁");
  return app;
}
// 第 1 頁 → 點「下一頁」（真的按 UsersSection 的按鈕）→ 第 2 頁 500
async function failOnPage2() {
  const app = await readyPage();
  pager(app).next.props.onClick();
  await app.settle();
  assert.equal(dashReqs().length, 2);
  assert.equal(reqs.at(-1).params.page, "2");
  assert.equal(pager(app).text, "正在載入第 2 頁…");
  respond(reqs.at(-1), 500, { error: "x" });
  await app.settle();
  return app;
}

// ======================================================================== (a)
async function caseA() {
  const app = await failOnPage2();
  const p = pager(app);
  assert.equal(usersProps(app).page, 1, "失敗後 UsersSection.page 應停在上一個成功頁碼 1");
  assert.equal(p.text, "第 1 頁，共 3 頁", `失敗後分頁文字：${p.text}`);
  assert.equal(shownUser(app), "u-100", "失敗後資料應為第 1 頁");
  assert.equal(usersProps(app).loading, false);
  assert.equal(p.prev.props.disabled, true, "依第 1 頁計算：上一頁 disabled");
  assert.equal(p.next.props.disabled, false, "依第 1 頁計算：下一頁可按");
  assert.ok(textOf(app.tree).includes("伺服器暫時無法取得資料，請稍後再試。"), "應有錯誤橫幅");
  const btns = retryButtons(app.tree);
  assert.equal(btns.length, 1, "應有 1 個重試鈕");
  btns[0].props.onClick();
  await app.settle();
  assert.equal(dashReqs().length, 3, "重試應送 1 次");
  assert.deepEqual(reqs.at(-1).params, { sort: "recently_active", page: "2", period: "30d" }, "重試應請求第 2 頁");
  assert.equal(pager(app).text, "正在載入第 2 頁…");
  respond(reqs.at(-1), 200, { dashboard: mkDash(200) });
  await app.settle();
  assert.equal(pager(app).text, "第 2 頁，共 3 頁");
  assert.equal(shownUser(app), "u-200");
  assert.equal(pager(app).prev.props.disabled, false);
  assert.equal(retryButtons(app.tree).length, 0, "成功後橫幅消失");
}
await check("(a) 第 2 頁失敗 → 顯示第 1 頁（頁碼／資料／按鈕）；重試 → 請求第 2 頁 → 成功顯示第 2 頁", caseA);

// ======================================================================== (b)
async function caseB() {
  const app = await failOnPage2();
  // 失敗後畫面在第 1 頁，使用者按「下一頁」= onPage(2)，而 admin 內部 page state 仍是 2
  pager(app).next.props.onClick();
  await app.settle();
  assert.equal(dashReqs().length, 3, "失敗後再點第 2 頁必須重新送出請求（reloadKey），不能沒有反應");
  assert.equal(reqs.at(-1).params.page, "2");
  assert.equal(pager(app).text, "正在載入第 2 頁…");
  // 第二次又失敗 → 再點仍要重送
  respond(reqs.at(-1), 500, { error: "x" });
  await app.settle();
  assert.equal(pager(app).text, "第 1 頁，共 3 頁");
  usersProps(app).onPage(2);
  await app.settle();
  assert.equal(dashReqs().length, 4, "連續失敗後再點第 2 頁仍要重送");
  respond(reqs.at(-1), 200, { dashboard: mkDash(202) });
  await app.settle();
  assert.equal(pager(app).text, "第 2 頁，共 3 頁");
  assert.equal(shownUser(app), "u-202");
}
await check("(b) 失敗後再點第 2 頁 → reloadKey 重送（連續失敗也一樣），成功顯示第 2 頁", caseB);

// ======================================================================== (c)
await check("(c) 失敗後點第 1 頁（目前顯示頁）→ 送 page=1、loading 文字第 1 頁、成功後回第 1 頁且無錯誤；不卡住", async () => {
  const app = await failOnPage2();
  // UI 上「上一頁」在第 1 頁為 disabled；改從 onPage(1) 呼叫（等同其他入口點第 1 頁）
  assert.equal(pager(app).prev.props.disabled, true);
  usersProps(app).onPage(1);
  await app.settle();
  assert.equal(dashReqs().length, 3, "應送 1 次請求");
  assert.equal(reqs.at(-1).params.page, "1");
  assert.equal(pager(app).text, "正在載入第 1 頁…");
  assert.equal(usersProps(app).loading, true);
  assert.equal(retryButtons(app.tree).length, 0, "請求中錯誤橫幅清除");
  respond(reqs.at(-1), 200, { dashboard: mkDash(101) });
  await app.settle();
  assert.equal(pager(app).text, "第 1 頁，共 3 頁");
  assert.equal(shownUser(app), "u-101");
  assert.equal(usersProps(app).loading, false);
  assert.equal(retryButtons(app.tree).length, 0);
  // 之後再按下一頁要正常前往第 2 頁（不卡住）
  pager(app).next.props.onClick();
  await app.settle();
  assert.equal(reqs.at(-1).params.page, "2");
  respond(reqs.at(-1), 200, { dashboard: mkDash(201) });
  await app.settle();
  assert.equal(pager(app).text, "第 2 頁，共 3 頁");
  info("(c) 實際行為：失敗後 page state=2、畫面=1；onPage(1) 走 setPage(1)（非 reloadKey），送 page=1，成功回第 1 頁");
});

// ======================================================================== (d)
await check("(d) 快速 2 → 3：loading 中按鈕 disabled；3 先回 2 晚回／2 先回 3 後回 → 皆顯示第 3 頁；3 失敗 2 晚回 → 停在第 1 頁", async () => {
  // order 1：3 先回、2 晚回
  let app = await readyPage();
  usersProps(app).onPage(2);
  await app.settle();
  const p = pager(app);
  assert.equal(p.next.props.disabled, true, "loading 中下一頁 disabled（UI 上無法連點）");
  assert.equal(p.prev.props.disabled, true, "loading 中上一頁 disabled");
  const r2 = reqs.at(-1);
  usersProps(app).onPage(3); // 程式入口仍可呼叫，模擬極端連點
  await app.settle();
  const r3 = reqs.at(-1);
  assert.equal(r2.params.page, "2");
  assert.equal(r3.params.page, "3");
  assert.equal(pager(app).text, "正在載入第 3 頁…");
  respond(r3, 200, { dashboard: mkDash(3) });
  await app.settle();
  respond(r2, 200, { dashboard: mkDash(2) });
  await app.settle();
  assert.equal(pager(app).text, "第 3 頁，共 3 頁", "第 2 頁晚回覆蓋了第 3 頁的頁碼");
  assert.equal(shownUser(app), "u-3", "第 2 頁晚回覆蓋了第 3 頁的資料");
  // order 2：2 先回、3 後回
  app = await readyPage();
  usersProps(app).onPage(2);
  await app.settle();
  const s2 = reqs.at(-1);
  usersProps(app).onPage(3);
  await app.settle();
  const s3 = reqs.at(-1);
  respond(s2, 200, { dashboard: mkDash(2) });
  await app.settle();
  assert.equal(pager(app).text, "正在載入第 3 頁…", "第 2 頁先回不應結束 loading");
  assert.equal(shownUser(app), "u-100", "第 2 頁先回不應套用資料");
  respond(s3, 200, { dashboard: mkDash(3) });
  await app.settle();
  assert.equal(pager(app).text, "第 3 頁，共 3 頁");
  assert.equal(shownUser(app), "u-3");
  // order 3：3 失敗、2 晚回成功 → 畫面應停在上一個成功（第 1 頁），不應被第 2 頁蓋成「第 2 頁」
  app = await readyPage();
  usersProps(app).onPage(2);
  await app.settle();
  const t2 = reqs.at(-1);
  usersProps(app).onPage(3);
  await app.settle();
  const t3 = reqs.at(-1);
  respond(t3, 500, { error: "x" });
  await app.settle();
  respond(t2, 200, { dashboard: mkDash(2) });
  await app.settle();
  assert.equal(pager(app).text, "第 1 頁，共 3 頁");
  assert.equal(shownUser(app), "u-100");
  assert.equal(retryButtons(app.tree).length, 1);
  // 同一 tick 連呼 onPage(2)、onPage(3)
  app = await readyPage();
  usersProps(app).onPage(2);
  usersProps(app).onPage(3);
  await app.settle();
  info(`(d) 同一 tick onPage(2)+onPage(3) → 送出 ${dashReqs().length - 1} 個請求，最後 page=${reqs.at(-1).params.page}`);
  assert.equal(reqs.at(-1).params.page, "3");
  respond(reqs.at(-1), 200, { dashboard: mkDash(3) });
  await app.settle();
  assert.equal(pager(app).text, "第 3 頁，共 3 頁");
});

// ======================================================================== (e)
await check("(e) R1：換頁 loading 與失敗時都不整頁「載入中」／整頁錯誤，KPI、分析區保留", async () => {
  const app = await readyPage();
  usersProps(app).onPage(2);
  await app.settle();
  let t = textOf(app.tree);
  assert.ok(!t.includes("載入中…"), "換頁時整頁變成載入中");
  assert.equal(findAll(app.tree, (n) => n.type === hx.KpiSection).length, 1);
  assert.equal(findAll(app.tree, (n) => n.type === hx.AnalyticsPanel).length, 1);
  assert.equal(usersProps(app).loading, true);
  respond(reqs.at(-1), 500, { error: "x" });
  await app.settle();
  t = textOf(app.tree);
  assert.ok(!t.includes("載入中…") && !t.includes("管理後台暫時無法載入"), "失敗後不應整頁");
  assert.equal(findAll(app.tree, (n) => n.type === hx.KpiSection).length, 1);
  retryButtons(app.tree)[0].props.onClick();
  await app.settle();
  assert.ok(!textOf(app.tree).includes("載入中…"), "重試時整頁變成載入中");
  assert.equal(findAll(app.tree, (n) => n.type === hx.KpiSection).length, 1);
});

// ======================================================================== M: 鑑別力
const ADMIN_PATH = path.join(root, "src/routes/admin.tsx");
function mutate(from, to, label) {
  const n = ADMIN_ROUTE.split(from).length - 1;
  assert.equal(n, 1, `mutation ${label}: 應命中 1 次，實際 ${n}`);
  return ADMIN_ROUTE.replace(from, to);
}
const MUTANTS = [
  ["拿掉 shownPage（一律傳 page）", "page={usersLoading ? page : shownPage}", "page={page}", caseA],
  [
    "拿掉 reloadKey 分支（onPage 一律 setPage）",
    "onPage={(value) => (value === page ? setReloadKey((key) => key + 1) : setPage(value))}",
    "onPage={(value) => setPage(value)}",
    caseB,
  ],
  ["setShownPage 移到錯誤判斷之前", "      setShownPage(page);\n", "", caseA],
];
const origHx = hx;
for (const [label, from, to, fn] of MUTANTS) {
  await check(`M 鑑別力：${label} → 對應測試必須失敗`, async () => {
    const src = label.startsWith("setShownPage")
      ? mutate(from, to, label).replace("      setUsersLoading(false);\n", "      setUsersLoading(false);\n      setShownPage(page);\n")
      : mutate(from, to, label);
    const file = await bundleStdin(HARNESS_ENTRY, HARNESS_MOCKS, { [ADMIN_PATH]: src });
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

// ======================================================================== (f) maskEmail
await check("(f) maskEmail 邊界：null／undefined／123／\"\"／noatsign／@domain.com／a@b 不 throw、回傳字串", () => {
  const results = {};
  for (const v of [null, undefined, 123, "", "noatsign", "@domain.com", "a@b"]) {
    let r;
    assert.doesNotThrow(() => { r = ssr.maskEmail(v); }, `maskEmail(${String(v)}) threw`);
    assert.equal(typeof r, "string", `maskEmail(${String(v)}) 應回傳字串`);
    results[JSON.stringify(v) ?? "undefined"] = r;
  }
  info("(f) 實際輸出：" + JSON.stringify(results));
  assert.equal(ssr.maskEmail(null), "");
  assert.equal(ssr.maskEmail(undefined), "");
  assert.equal(ssr.maskEmail(123), "");
  assert.equal(ssr.maskEmail(""), "***");
});
await check("(f) maskEmail 不得回傳完整 local part：noatsign／@domain.com／a@b", () => {
  const cases = [
    ["noatsign", "noatsign"],
    ["@domain.com", ""],
    ["a@b", "a"],
  ];
  const bad = [];
  for (const [input, local] of cases) {
    const r = ssr.maskEmail(input);
    assert.notEqual(r, input, `maskEmail(${input}) 回傳原字串`);
    const shownLocal = r.split("***")[0];
    if (local.length > 0 && shownLocal === local) bad.push(`${input} → ${r}（local part「${local}」完整外露）`);
  }
  assert.deepEqual(bad, []);
});

// ======================================================================== (g) 目的地表 SSR
await check("(g) 目的地表 SSR：無 min-w-[、目的地欄 break-words、table 包在 overflow-x-auto 內", () => {
  const realErr = console.error;
  console.error = () => {};
  let html;
  try {
    html = ssr.renderToStaticMarkup(
      ssr.createElement(ssr.DestinationsPanel, {
        rows: [
          { destination: "Some Extremely Long Destination Name, Prefecture, Country", tripCount: 12, uniqueUsers: 3, lastSavedAt: THIS_YEAR },
          { destination: "台南", tripCount: 1, uniqueUsers: 1, lastSavedAt: null },
        ],
      }),
    );
  } finally {
    console.error = realErr;
  }
  assert.ok(!html.includes("min-w-["), "目的地表仍有 min-w-[");
  const tds = [...html.matchAll(/<td class="([^"]*)">Some Extremely/g)];
  assert.equal(tds.length, 1, "找不到目的地 td");
  assert.ok(tds[0][1].split(/\s+/).includes("break-words"), `目的地 td 缺 break-words：${tds[0][1]}`);
  assert.match(html, /<div class="overflow-x-auto"><table[ >]/, "table 不在 overflow-x-auto 容器內");
  assert.equal(html.split("<table").length - 1, 1);
  const fnSrc = INSIGHT_SRC.slice(INSIGHT_SRC.indexOf("export function DestinationsPanel"));
  assert.ok(!fnSrc.includes("min-w-["), "DestinationsPanel 原始碼仍有 min-w-[");
  info("(g) 注意：table 為 auto layout，td 的 overflow-wrap:break-word 不會降低 min-content；無空白的超長單字仍靠 overflow-x-auto 橫捲（未實機）");
});

fs.rmSync(tmp, { recursive: true, force: true });
out(`\nRESULT pass=${passCount} fail=${failures.length}`);
if (failures.length) {
  out("FAILED:\n  " + failures.join("\n  "));
  process.exitCode = 1;
}
