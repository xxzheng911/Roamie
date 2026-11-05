// verify-oauth-callback-remount-navigation.mjs — 任務單 #TS-AUTH-NAV
// 「Apple 登出 → Google 登入後卡在『正在完成登入…』」重現與修正驗證。
//
// 不啟動專案 dev server、不連網、不讀 .env：以 esbuild 打包「真實」模組（auth.callback.tsx、OnboardingGate、
// login-navigation、auth-post-redirect、startup-boot-state、startup-navigation、post-auth-navigation、
// oauth-callback-guard、admin-route-boundary、auth-pending-action、真實 @tanstack/react-router + browser history），
// 只 mock 外部邊界（Supabase 兌換、session、i18n、iOS bridge、平台＝Capacitor iOS），
// 在本腳本自帶的 127.0.0.1 fixture server + headless Chrome 實際 render。
//
// 三種版本（同一份 fixture）：
//   old     = `git show HEAD:` 的 auth.callback / login-navigation / auth-post-redirect / auth-oauth-deep-link
//   new     = 工作區（未提交修正）
//   noguard = 工作區，但把 remount 後 skip_existing_session 的「只在 callback 才清網址」換回無條件
//             stripOAuthParamsFromUrl()，用來在新版中重現卡住並驗證 5 秒保險本身
//
// 執行：node scripts/verify-oauth-callback-remount-navigation.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const headSource = (p) => execFileSync("git", ["show", "HEAD:" + p], { cwd: root, encoding: "utf8" });
const failures = [];
let passCount = 0;
const info = (s) => console.log("INFO " + s);
async function check(name, fn) {
  try {
    await fn();
    passCount += 1;
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 30).join("\n     "));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-ts-auth-nav-"));

const CHANGED = [
  "src/routes/auth.callback.tsx",
  "src/lib/login-navigation.ts",
  "src/lib/auth-post-redirect.ts",
  "src/lib/auth-oauth-deep-link.ts",
];
const NOGUARD_FROM = 'stripOAuthParamsIfStillOnCallback("skip_existing_session");';
function variantSources(variant) {
  if (variant === "new") return {};
  if (variant === "old") return Object.fromEntries(CHANGED.map((p) => [path.join(root, p), headSource(p)]));
  if (variant === "noguard") {
    const src = read("src/routes/auth.callback.tsx");
    assert.ok(src.includes(NOGUARD_FROM), "noguard 變體找不到要替換的呼叫");
    return { [path.join(root, "src/routes/auth.callback.tsx")]: src.replace(NOGUARD_FROM, "stripOAuthParamsFromUrl();") };
  }
  throw Error("unknown variant " + variant);
}
function plugin(mocks, overrides) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keys = Object.keys(overrides);
  return {
    name: "ts-auth-nav",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (a.path in mocks ? { path: a.path, namespace: "mock" } : null));
      b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: root }));
      if (keys.length) {
        b.onLoad({ filter: new RegExp("^(" + keys.map(esc).join("|") + ")$") }, (a) => ({
          contents: overrides[a.path],
          loader: a.path.endsWith(".tsx") ? "tsx" : "ts",
          resolveDir: path.dirname(a.path),
        }));
      }
    },
  };
}
const define = { "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development"}', "process.env.NODE_ENV": '"development"' };

// ───────────────────────── 前置：mock 與真實實作一致 ─────────────────────────
const STRIP_LINE = "window.history.replaceState({}, document.title, AUTH_CALLBACK_PATH);";
await check("P0 auth-oauth.ts stripOAuthParamsFromUrl 仍是 history.replaceState 寫回 /auth/callback（mock 逐字沿用）", () => {
  const src = read("src/lib/auth-oauth.ts");
  const body = src.slice(src.indexOf("export function stripOAuthParamsFromUrl"), src.indexOf("export function stripOAuthParamsFromUrl") + 200);
  assert.ok(body.includes(STRIP_LINE), body);
});
await check("P1 OnboardingGate：/auth/callback 用 <> 包、其他路徑用 <StartupOnboardingGate>（離開 callback 時子樹 remount 的前提）", () => {
  const src = read("src/components/OnboardingGate.tsx");
  assert.match(src, /if \(isCanonicalOAuthCallbackPath\(pathname\)\) return <>\{children\}<\/>;\s*return <StartupOnboardingGate>\{children\}<\/StartupOnboardingGate>;/);
});
await check("P2 @tanstack/history 會攔截外部 history.replaceState 並通知 router（被拉回的機制）", () => {
  const src = fs.readFileSync(path.join(root, "node_modules/@tanstack/history/dist/esm/index.js"), "utf8");
  assert.match(src, /win\.history\.replaceState = function\(\.\.\.args\) \{\s*const res = originalReplaceState\.apply\(win\.history, args\);\s*if \(!history\._ignoreSubscribers\) onPushPop\("REPLACE"\);/);
});

// ───────────────────────── Part B：瀏覽器真實 render ─────────────────────────
const RR = path.join(root, "node_modules/@tanstack/react-router/dist/esm/index.js");
const T = "window.__t";
const SESSION = `{access_token:'fixture-access-token-zz9',refresh_token:'fixture-refresh-token-zz9',user:{id:'00000000-0000-4000-8000-0000000000aa',email:'fixture@example.invalid',app_metadata:{provider:'google'}}}`;
const webMocks = {
  __capture: `window.__t={strips:[],exchanges:0,cbMounts:0,gateChildMounts:0,resolved:[],navs:[],console:[],authLogs:[],session:null,onb:true,mode:'success',exchangeDelay:50,homeDelay:30,clearCalls:0,completeCalls:0};
window.__t.stuck={scheduled:0,cleared:0,fired:0};const __ids=new Set();const __st=window.setTimeout.bind(window),__ct=window.clearTimeout.bind(window);
window.setTimeout=(fn,ms,...r)=>{if(ms!==5000)return __st(fn,ms,...r);window.__t.stuck.scheduled++;const id=__st(()=>{__ids.delete(id);window.__t.stuck.fired++;fn();},ms,...r);__ids.add(id);return id;};
window.clearTimeout=(id)=>{if(__ids.has(id)){__ids.delete(id);window.__t.stuck.cleared++;}return __ct(id);};
for(const k of ['info','warn','log','debug','error']){const o=console[k].bind(console);console[k]=(...a)=>{window.__t.console.push([k,a.map(x=>{try{return typeof x==='string'?x:JSON.stringify(x)}catch{return String(x)}}).join(' ')]);if(k==='error')o(...a);};}
export {};`,
  "@tanstack/react-router": `export * from ${JSON.stringify(RR)};import {useSearch as __us} from ${JSON.stringify(RR)};
export const createFileRoute=(p)=>(o)=>({path:p,options:o,useSearch:()=>__us({strict:false})});`,
  "@/hooks/use-i18n": `export const useI18n=()=>({t:(k)=>k});`,
  "@/components/MobileFrame": `export const MobileFrame=({children})=><div data-frame="">{children}</div>;`,
  "@/components/auth/AuthSignInError": `export const AuthSignInError=({message,onRetry})=><div data-error="">{message}<button onClick={onRetry}>retry</button></div>;`,
  "@/lib/complete-sign-in": `export async function completeSignInAfterAuth(){${T}.completeCalls++;}`,
  "@/lib/auth-session": `export const getClientAuthSession=async()=>${T}.session;export const readCachedAuthenticatedUserIdSync=()=>${T}.session?.user?.id??null;`,
  "@/lib/auth-oauth": `import {AUTH_CALLBACK_PATH} from '@/constants/auth-redirect';
export const readStashedOAuthRedirectTarget=()=>null;export const hasOAuthCallbackParams=()=>false;
export function stripOAuthParamsFromUrl(){${T}.strips.push(location.pathname);${STRIP_LINE}}`,
  "@/lib/auth-debug": `const L=(n)=>(...a)=>{${T}.authLogs.push([n,JSON.stringify(a)]);};
export const logAuthDebug=L('debug');export const logAuthError=L('error');export const logAuthSessionResult=L('session');
export const logAuthCallbackOpened=L('opened');export const emitOAuthFlow=L('flow');export const logGoogleOAuthMarker=L('g');`,
  "@/lib/auth-session-from-url": `export async function resolveSessionFromCallbackUrl(){${T}.exchanges++;await new Promise(r=>setTimeout(r,${T}.exchangeDelay));
if(${T}.mode==='failure')throw new Error('controlled exchange failure');const s=${SESSION};${T}.session=s;return {session:s,method:'pkce'};}`,
  "@/lib/auth-oauth-deep-link": `const K='roamie:oauth-pending-callback-path';export const clearPendingCallbackPath=()=>sessionStorage.removeItem(K);export const readPendingCallbackPath=()=>sessionStorage.getItem(K);`,
  "@/lib/clear-auth-state": `export async function clearAuthState(){${T}.clearCalls++;${T}.session=null;}
export async function resetToLoginScreen(o){await o.navigate({to:'/login',replace:true});}`,
  "@/lib/ios-snapshot-bridge": `const n=()=>{};export const bindIosInteractiveRoute=()=>n;export const ensureIosLoginLiveInteraction=n;export const notifyIosOAuthReturn=n;export const scheduleIosSnapshotRefreshBurst=n;export const requestIosSnapshotRefresh=n;`,
  "@/services/platform": `export const detectPlatform=()=>({kind:'ios',isCapacitor:true,isIOS:true,isNative:true,isAndroid:false});`,
  "@/lib/onboarding-storage": `export const isOnboardingCompletedSync=()=>${T}.onb;export const isOnboardingHydrated=()=>true;export const loadOnboardingState=async()=>${T}.onb;
export const getOnboardingStorageSource=()=>'localStorage';export const logSkipOnboarding=()=>{};export const installDevOnboardingGlobals=()=>{};`,
  "@/lib/startup-route": `export const hasLikelyPersistedSession=()=>false;export const resolveStartupPathFast=()=>${T}.onb?'/':'/welcome';`,
  "@/lib/app-boot-log": `export const ONBOARDING_ROUTE='/welcome';export const logAppBoot=()=>{};`,
  "@/lib/preferences-storage": `export const isPreferenceQuizCompleted=async()=>true;`,
  "@/lib/supabase-auth-storage": `export const warmSupabaseAuthStorage=async()=>{};`,
  "@/components/StartupGate": `export const markSessionBootstrapped=()=>{};`,
  "@/components/RoamieRoutePending": `export const RoamieRoutePending=()=><div data-boot-pending=""/>;`,
  "@/lib/boot-splash": `export const hasExternalBootSplash=()=>false;export const dismissBootSplashWhenAppReady=()=>{};`,
  "@/components/AppBootRouteSync": `import {useEffect} from 'react';export const AppBootRouteSync=({targetRoute,onApplied})=>{useEffect(()=>{${T}.routeSyncs=(${T}.routeSyncs||[]).concat(targetRoute);onApplied();},[]);return null;};`,
  "@/components/OnboardingRouteGuard": `export const OnboardingRouteGuard=()=>null;`,
  "@/lib/auth-boot-log": `export const logAuthBoot=()=>{};`,
};
const webEntry = `import '__capture';
import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {createRouter,createRootRoute,createRoute,RouterProvider,Outlet,createBrowserHistory} from '@tanstack/react-router';
import {OnboardingGate} from '@/components/OnboardingGate';
import {Route as CallbackRoute} from '@/routes/auth.callback';
import {markStartupResolved} from '@/lib/startup-boot-state';
import {stashAdminReturn} from '@/lib/admin/admin-route-boundary';
import {stashPendingAuthAction,peekPendingAuthAction} from '@/lib/auth-pending-action';
const T=window.__t;
function Probe(){useEffect(()=>{T.gateChildMounts++;},[]);return null;}
const rootRoute=createRootRoute({component:()=><OnboardingGate><Probe/><Outlet/></OnboardingGate>});
const CB=CallbackRoute.options.component;
function CallbackPage(){useEffect(()=>{T.cbMounts++;},[]);return <CB/>;}
// 正式 App 路由為 code-split，進入時有非同步載入；以 loader 延遲模擬（homeDelay=0 時同步完成）
const delay=()=>T.homeDelay?new Promise(r=>setTimeout(r,T.homeDelay)):undefined;
const page=(name)=>function P(){return <div data-page={name}>{name}</div>;};
const mk=(p,name,extra={})=>createRoute({getParentRoute:()=>rootRoute,path:p,loader:delay,component:page(name),...extra});
const routeTree=rootRoute.addChildren([
  mk('/','home'),mk('/welcome','welcome'),mk('/login','login'),mk('/admin','admin'),
  mk('/saved','saved',{validateSearch:(s)=>s}),
  createRoute({getParentRoute:()=>rootRoute,path:'/auth/callback',validateSearch:CallbackRoute.options.validateSearch,component:CallbackPage}),
]);
window.__start=(cfg)=>{
  Object.assign(T,cfg);
  if(cfg.bootCompleted)markStartupResolved('/');
  if(cfg.admin)stashAdminReturn();
  if(cfg.pendingPath)stashPendingAuthAction({action:'favorite_write',sourcePath:cfg.pendingPath});
  const router=createRouter({routeTree,history:createBrowserHistory(),scrollRestoration:false,defaultPreloadStaleTime:0,defaultPendingMinMs:0});
  T.router=router;
  router.subscribe('onBeforeNavigate',(e)=>T.navs.push(e.toLocation.pathname+(e.toLocation.searchStr||'')));
  router.subscribe('onResolved',(e)=>T.resolved.push(e.toLocation.pathname));
  createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);
  return true;
};
window.__state=()=>({path:location.pathname,search:location.search,routerPath:T.router?.state.location.pathname,
  page:document.querySelector('[data-page]')?.getAttribute('data-page')??null,
  error:document.querySelector('[data-error]')?.textContent??null,
  spinner:!!document.querySelector('[data-frame]')&&!document.querySelector('[data-error]'),
  strips:T.strips,exchanges:T.exchanges,cbMounts:T.cbMounts,gateChildMounts:T.gateChildMounts,
  resolved:T.resolved,navs:T.navs,stuck:T.stuck,clearCalls:T.clearCalls,completeCalls:T.completeCalls,
  adminKey:sessionStorage.getItem('roamie:admin:return-to'),pending:peekPendingAuthAction()?.sourcePath??null,
  console:T.console,authLogs:T.authLogs});
window.__revoke=()=>{T.session=null;return true;};
// 一次性外部拉回（模擬任何把網址寫回 /auth/callback 的 replaceState，例如殘留的 strip／deep link）
window.__pullBack=()=>{history.replaceState({},document.title,'/auth/callback');return true;};
window.__ready=true;`;

const chromeBin = [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && fs.existsSync(p));
const VARIANTS = ["old", "new", "noguard"];
const servers = [];
let chrome;
let ws;
const allConsole = [];
try {
  const ports = {};
  for (const v of VARIANTS) {
    const out = path.join(tmp, `app-${v}.js`);
    await build({
      stdin: { contents: webEntry, resolveDir: root, loader: "tsx" },
      bundle: true,
      logLevel: "error",
      outfile: out,
      format: "iife",
      jsx: "automatic",
      alias: { "@": path.join(root, "src") },
      loader: { ".png": "dataurl", ".svg": "dataurl", ".jpg": "dataurl", ".webp": "dataurl" },
      define,
      plugins: [plugin(webMocks, variantSources(v))],
    });
    const server = http.createServer((req, res) => {
      if (req.url === "/app.js") {
        res.setHeader("Content-Type", "application/javascript");
        res.end(fs.readFileSync(out));
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    servers.push(server);
    ports[v] = server.address().port;
  }
  assert.ok(chromeBin, "找不到 Chrome");
  chrome = spawn(
    chromeBin,
    ["--headless", "--disable-gpu", "--no-first-run", "--disable-background-networking", "--remote-debugging-port=0", "--user-data-dir=" + path.join(tmp, "chrome"), "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const endpoint = await new Promise((resolve, reject) => {
    let text = "";
    const t = setTimeout(() => reject(Error("Chrome timeout")), 15000);
    chrome.stderr.on("data", (b) => {
      text += b;
      const m = text.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(t);
        resolve(m[1]);
      }
    });
    chrome.on("error", reject);
  });
  ws = new WebSocket(endpoint);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const externalRequests = [];
  const exceptions = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Network.requestWillBeSent") {
      const u = m.params.request.url;
      if (!/^(data:|blob:|about:|http:\/\/127\.0\.0\.1:)/.test(u)) externalRequests.push(u);
    }
    if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails.exception?.description ?? "exception");
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  /** 開新的 browser context（sessionStorage／模組狀態隔離），載入 callback URL，呼叫 __start(cfg) */
  async function open(variant, cfg, url = "/auth/callback?code=fixture-code-abc123") {
    const { browserContextId } = await send("Target.createBrowserContext");
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const call = (m, p) => send(m, p, sessionId);
    const evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!r.exceptionDetails, "browser eval failed: " + JSON.stringify(r.exceptionDetails?.exception?.description ?? r.exceptionDetails));
      return r.result.value;
    };
    await call("Runtime.enable");
    await call("Network.enable");
    await call("Page.navigate", { url: `http://127.0.0.1:${ports[variant]}${url}` });
    for (let i = 0; i < 100 && !(await evaluate("!!window.__ready").catch(() => false)); i++) await sleep(50);
    assert.ok(await evaluate("!!window.__ready"), "fixture 未載入");
    await evaluate(`window.__start(${JSON.stringify(cfg)})`);
    const state = () => evaluate("window.__state()");
    const until = async (pred, ms) => {
      const end = Date.now() + ms;
      let s;
      while (Date.now() < end) {
        s = await state();
        if (pred(s)) return s;
        await sleep(50);
      }
      return s;
    };
    const close = async () => {
      const s = await state().catch(() => null);
      if (s) allConsole.push(...s.console.map(([k, t]) => ({ variant, k, t })), ...s.authLogs.map(([k, t]) => ({ variant, k: "authDebug:" + k, t })));
      await send("Target.disposeBrowserContext", { browserContextId });
    };
    return { evaluate, state, until, close };
  }
  const brief = (s) =>
    JSON.stringify({ path: s.path, routerPath: s.routerPath, page: s.page, spinner: s.spinner, error: s.error, strips: s.strips, exchanges: s.exchanges, cbMounts: s.cbMounts, navs: s.navs, resolved: s.resolved });
  const fallbackLogs = (s) => s.console.filter(([, t]) => t.startsWith("[AUTH_CALLBACK_STUCK_FALLBACK]"));
  const compare = {};

  // B1 主情境：boot 已完成（之前登入過、登出後 boot 狀態不重置）、onboarding 完成、Google callback 帶 code
  for (const [label, homeDelay] of [["B1", 30], ["B2", 0]]) {
    const cfg = { bootCompleted: true, onb: true, homeDelay };
    const desc = homeDelay ? "（目標路由非同步載入 30ms）" : "（目標路由同步完成）";
    await check(`${label}-old 舊版（HEAD）重現：boot 已完成 → callback?code → session 建立 → navigate('/') 後被拉回 /auth/callback 卡住${desc}`, async () => {
      const p = await open("old", cfg);
      try {
        const s = await p.until((x) => x.page === "home", 7000);
        compare[label + "-old"] = s;
        info(`${label}-old 7 秒後：` + brief(s));
        assert.equal(s.exchanges, 1, "code 只兌換一次");
        assert.equal(s.path, "/auth/callback", "舊版預期卡在 /auth/callback");
        assert.notEqual(s.page, "home");
        assert.ok(s.spinner, "畫面應停在轉圈");
        assert.ok(s.navs.some((n) => n === "/"), "舊版確實有 navigate('/')");
        assert.ok(s.cbMounts >= 2, "AuthCallback 應被 remount（mount 次數 " + s.cbMounts + "）");
        assert.ok(s.strips.length >= 2, "remount 後的 instance 也清網址");
      } finally {
        await p.close();
      }
    });
    await check(`${label}-new 新版：同情境最終停在 "/"（首頁 render），且之後不被拉回、保險不誤觸${desc}`, async () => {
      const p = await open("new", cfg);
      try {
        const s = await p.until((x) => x.page === "home", 3000);
        info(`${label}-new 到首頁：` + brief(s));
        assert.equal(s.path, "/");
        assert.equal(s.page, "home");
        assert.equal(s.exchanges, 1);
        await sleep(6000);
        const s2 = await p.state();
        assert.equal(s2.path, "/", "6 秒後仍在首頁");
        assert.equal(s2.page, "home");
        assert.equal(fallbackLogs(s2).length, 0, "成功導向時保險不應觸發");
        assert.equal(s2.navs.filter((n) => n === "/").length, 1, "只導向首頁一次：" + JSON.stringify(s2.navs));
        compare[label + "-new"] = s2;
      } finally {
        await p.close();
      }
    });
  }

  await check("B3 首次冷啟動（boot 尚未完成）直接帶 code 進 callback：old 與 new 的最終路徑", async () => {
    const cfg = { bootCompleted: false, onb: true, homeDelay: 30 };
    const po = await open("old", cfg);
    const so = await po.until((x) => x.page === "home", 4000);
    await po.close();
    const pn = await open("new", cfg);
    const sn = await pn.until((x) => x.page === "home", 4000);
    await sleep(1500);
    const sn2 = await pn.state();
    await pn.close();
    info("B3-old：" + brief(so));
    info("B3-new：" + brief(sn2));
    compare["B3-old"] = so;
    compare["B3-new"] = sn2;
    assert.equal(sn2.path, "/");
    assert.equal(sn2.page, "home");
    assert.equal(sn2.exchanges, 1);
  });

  await check("B4 onboarding 未完成：callback 成功後導向 /welcome（不是首頁），保險不誤導首頁", async () => {
    const p = await open("new", { bootCompleted: true, onb: false, homeDelay: 30 });
    try {
      const s = await p.until((x) => x.page === "welcome", 3000);
      assert.equal(s.path, "/welcome", brief(s));
      await sleep(5800);
      const s2 = await p.state();
      assert.equal(s2.path, "/welcome");
      assert.ok(!s2.navs.includes("/"), "不應導向首頁：" + JSON.stringify(s2.navs));
      assert.equal(fallbackLogs(s2).length, 0);
    } finally {
      await p.close();
    }
  });

  await check("B5 callback 兌換失敗：顯示錯誤畫面、停在 /auth/callback、6 秒內保險不觸發、重試可到 /login", async () => {
    const p = await open("new", { bootCompleted: true, onb: true, mode: "failure" });
    try {
      const s = await p.until((x) => !!x.error, 3000);
      assert.ok(s.error?.includes("controlled exchange failure"), brief(s));
      assert.equal(s.path, "/auth/callback");
      assert.equal(s.clearCalls, 1);
      await sleep(6000);
      const s2 = await p.state();
      assert.equal(s2.path, "/auth/callback");
      assert.ok(s2.error, "錯誤畫面維持");
      assert.equal(fallbackLogs(s2).length, 0, "失敗時保險不可導向");
      assert.ok(!s2.console.some(([, t]) => t.startsWith("[AUTH_CALLBACK_STUCK_FALLBACK")), "失敗路徑根本不應排保險");
      assert.deepEqual(s2.navs.filter((n) => !n.startsWith("/auth/callback")), [], "沒有離開 callback 的導向：" + JSON.stringify(s2.navs));
      assert.equal(s2.stuck.scheduled, 0, "失敗路徑不排 5 秒保險");
      await p.evaluate("document.querySelector('[data-error] button').click();true");
      const s3 = await p.until((x) => x.page === "login", 3000);
      assert.equal(s3.path, "/login");
    } finally {
      await p.close();
    }
  });

  /** 新版：先正常到目標頁，再一次性外部拉回 /auth/callback，觀察保險（不靠 noguard 變體） */
  async function pulledBack(cfg, targetPage) {
    const p = await open("new", cfg);
    const s0 = await p.until((x) => x.page === targetPage, 3000);
    assert.equal(s0.page, targetPage, "前置：應先到 " + targetPage + "：" + brief(s0));
    const tPull = Date.now();
    await p.evaluate("window.__pullBack()");
    const s1 = await p.until((x) => x.path === "/auth/callback" && x.spinner, 1500);
    assert.equal(s1.path, "/auth/callback", "前置：拉回後應停在 callback 轉圈：" + brief(s1));
    await sleep(800);
    const s1b = await p.state();
    assert.equal(s1b.path, "/auth/callback", "前置：拉回後應卡住（不自行恢復）：" + brief(s1b));
    return { p, tPull, s1: s1b };
  }

  await check("B6 保險本身（新版＋一次性外部拉回）：卡在 callback 且有 session → 5 秒內強制導向 \"/\" 一次、不重新兌換", async () => {
    const { p, tPull } = await pulledBack({ bootCompleted: true, onb: true, homeDelay: 30 }, "home");
    try {
      const s2 = await p.until((x) => x.page === "home", 7000);
      const elapsed = Date.now() - tPull;
      info(`B6 拉回後 ${elapsed}ms 恢復：` + brief(s2) + " stuckTimers=" + JSON.stringify(s2.stuck) + " log=" + JSON.stringify(fallbackLogs(s2)));
      assert.equal(s2.path, "/");
      assert.equal(s2.page, "home");
      await sleep(5500);
      const s3 = await p.state();
      assert.equal(s3.path, "/");
      assert.equal(fallbackLogs(s3).length, 1, "保險只觸發一次：" + JSON.stringify(fallbackLogs(s3)));
      assert.equal(s3.exchanges, 1, "保險不會重新兌換 code");
    } finally {
      await p.close();
    }
  });

  await check("B6b 成功路徑：5 秒保險 timer 即使在元件卸載後才觸發，也因已離開 callback 而不作用（不導向、不查 session）", async () => {
    const p = await open("new", { bootCompleted: true, onb: true, homeDelay: 30 });
    try {
      await p.until((x) => x.page === "home", 3000);
      const s = await p.state();
      await sleep(5500);
      const s2 = await p.state();
      info("B6b 成功路徑 timer 統計：到首頁時=" + JSON.stringify(s.stuck) + "；5.5 秒後=" + JSON.stringify(s2.stuck) + " cbMounts=" + s2.cbMounts);
      if (s2.stuck.fired > 0)
        info(`B6b 發現：${s2.stuck.fired} 個保險 timer 在所屬 AuthCallback 已卸載後仍觸發（runCallback 在 unmount 後才 resolve → scheduleStuckFallback 排程時 cleanup 已跑過）；因離開 callback 而未作用`);
      assert.equal(fallbackLogs(s2).length, 0, "洩漏的 timer 不可導向");
      assert.ok(!s2.console.some(([, t]) => t.startsWith("[AUTH_CALLBACK_STUCK_FALLBACK_SKIP]")), "洩漏的 timer 不應走到 session 檢查");
      assert.equal(s2.path, "/");
      assert.equal(s2.navs.filter((n) => n === "/").length, 1);
    } finally {
      await p.close();
    }
  });

  await check("B6c（INFO 性質）noguard 變體：若 skip_existing_session 仍無條件清網址，保險會被同一機制再拉回", async () => {
    const p = await open("noguard", { bootCompleted: true, onb: true, homeDelay: 30 });
    try {
      const s = await p.until(() => false, 7000);
      info("B6c noguard 7 秒：" + brief(s) + " fallback=" + fallbackLogs(s).length);
      assert.equal(s.path, "/auth/callback", "記錄：保險不是獨立於 strip guard 的安全網");
    } finally {
      await p.close();
    }
  });

  await check("B7 保險不假裝成功：卡住期間 session 被清掉 → 5 秒後不導向、記錄 no_session、維持 callback", async () => {
    const { p } = await pulledBack({ bootCompleted: true, onb: true, homeDelay: 30 }, "home");
    try {
      await p.evaluate("window.__revoke()");
      await sleep(5500);
      const s2 = await p.state();
      info("B7：" + brief(s2));
      assert.equal(s2.path, "/auth/callback");
      assert.notEqual(s2.page, "home");
      assert.equal(fallbackLogs(s2).length, 0);
      assert.ok(s2.console.some(([, t]) => t.startsWith("[AUTH_CALLBACK_STUCK_FALLBACK_SKIP]") && t.includes("no_session")), "應記錄 no_session");
    } finally {
      await p.close();
    }
  });

  await check("B8 onboarding 未完成 + 卡住：保險導向 /welcome，不是首頁", async () => {
    const { p } = await pulledBack({ bootCompleted: true, onb: false, homeDelay: 30 }, "welcome");
    try {
      const s2 = await p.until((x) => x.page === "welcome", 7000);
      info("B8 final=" + brief(s2) + " log=" + JSON.stringify(fallbackLogs(s2)));
      assert.equal(s2.path, "/welcome");
      assert.ok(!s2.navs.includes("/"), JSON.stringify(s2.navs));
    } finally {
      await p.close();
    }
  });

  await check("B9 admin return：new 導向 /admin，sessionStorage 標記只被消費一次；卡住時保險也回 /admin", async () => {
    const p = await open("new", { bootCompleted: true, onb: true, admin: true, homeDelay: 30 });
    try {
      const s = await p.until((x) => x.page === "admin", 3000);
      assert.equal(s.path, "/admin", brief(s));
      assert.equal(s.adminKey, null, "admin return 已消費");
      assert.ok(!s.navs.includes("/"), "不應先導首頁：" + JSON.stringify(s.navs));
    } finally {
      await p.close();
    }
    const { p: q } = await pulledBack({ bootCompleted: true, onb: true, admin: true, homeDelay: 30 }, "admin");
    try {
      const s = await q.until((x) => x.page === "admin" && fallbackLogs(x).length > 0, 7500);
      info("B9 拉回後：" + brief(s) + " log=" + JSON.stringify(fallbackLogs(s)));
      assert.equal(s.path, "/admin");
      assert.equal(s.adminKey, null);
    } finally {
      await q.close();
    }
  });

  await check("B10 pending action（/saved?tab=trips）：new 導向帶 search；pending 未被導向流程 claim（留給 resume pipeline）", async () => {
    const p = await open("new", { bootCompleted: true, onb: true, pendingPath: "/saved?tab=trips", homeDelay: 30 });
    try {
      const s = await p.until((x) => x.page === "saved", 3000);
      assert.equal(s.path, "/saved", brief(s));
      assert.equal(s.search, "?tab=trips");
      assert.equal(s.pending, "/saved?tab=trips");
    } finally {
      await p.close();
    }
  });

  await check("B11 pending action + 卡住 → 保險導向時應保留 search（?tab=trips）", async () => {
    const { p } = await pulledBack({ bootCompleted: true, onb: true, pendingPath: "/saved?tab=trips", homeDelay: 30 }, "saved");
    try {
      const s = await p.until((x) => x.page === "saved" && fallbackLogs(x).length > 0, 7500);
      info("B11：" + brief(s) + " search=" + s.search + " log=" + JSON.stringify(fallbackLogs(s)));
      assert.equal(s.path, "/saved");
      assert.equal(s.search, "?tab=trips", "保險導向遺失 pending action 的 search（lastPostAuthTarget 只存 pathname）");
    } finally {
      await p.close();
    }
  });

  await check("B12 瀏覽器端無外部請求、無未捕捉例外", () => {
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(exceptions, []);
  });

  // ───────── 修正前後對照表 ─────────
  console.log("\n修正前後對照（最終狀態）：");
  for (const k of Object.keys(compare)) {
    const s = compare[k];
    console.log(`  ${k.padEnd(7)} path=${s.path} page=${s.page ?? "-"} spinner=${s.spinner} cbMounts=${s.cbMounts} strips=${JSON.stringify(s.strips)} navs=${JSON.stringify(s.navs)}`);
  }
  console.log("");
} finally {
  try {
    ws?.close();
  } catch {}
  if (chrome) {
    chrome.kill();
    await new Promise((r) => (chrome.exitCode != null ? r() : chrome.once("exit", r)));
  }
  for (const s of servers) await new Promise((r) => s.close(r));
}

// ───────── Log 不含 token／code／URL ─────────
const NEW_TAGS = ["[AUTH_CALLBACK_STRIP_SKIP]", "[POST_LOGIN_NAV_SKIP]", "[AUTH_CALLBACK_STUCK_FALLBACK]", "[AUTH_CALLBACK_STUCK_FALLBACK_SKIP]", "[OAUTH_DEEP_LINK_SKIP]"];
const SECRET = /fixture-code-abc123|fixture-access-token|fixture-refresh-token|code=|https?:\/\/|roamie:\/\//;
await check("L1 新增的 log tag 都沒有 token、code 或 URL（瀏覽器實際輸出）", () => {
  const hits = allConsole.filter((c) => NEW_TAGS.some((t) => c.t.startsWith(t)));
  info("新 tag 實際輸出樣本：" + JSON.stringify([...new Set(hits.map((h) => h.t))].slice(0, 12)));
  assert.ok(hits.length > 0, "應至少觀察到新 tag 輸出");
  const bad = hits.filter((c) => SECRET.test(c.t));
  assert.deepEqual(bad, []);
});
await check("L2 新增 log 原始碼的 payload 只有 source／reason／step／elapsedMs／targetRoute", () => {
  for (const p of CHANGED) {
    const added = execFileSync("git", ["diff", "-U0", "HEAD", "--", p], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter((l) => l.startsWith("+") && /console\.(info|warn|log)/.test(l));
    for (const l of added) {
      // 去掉字串常值（tag 與 reason 文字）後，只檢查實際放進 payload 的變數／屬性名稱
      const vars = l.replace(/"[^"]*"/g, '""');
      assert.ok(!/url|code|token|href|search|email|userId|session/i.test(vars), p + " :: " + l);
    }
  }
});
{
  const pre = allConsole.filter((c) => !NEW_TAGS.some((t) => c.t.startsWith(t)) && SECRET.test(c.t));
  info(`既有（非本次新增）log 含 code/token/URL 的筆數：${pre.length}` + (pre.length ? "；樣本：" + JSON.stringify(pre.slice(0, 3).map((x) => x.k + " " + x.t.slice(0, 160))) : ""));
}

// ───────────────────────── Part N：Node 單元（真實模組） ─────────────────────────
class MemStorage {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
globalThis.window = globalThis;
globalThis.__t = { session: null, onb: true, console: [], authLogs: [] };
globalThis.location = { pathname: "/auth/callback", search: "", hash: "", origin: "http://127.0.0.1", href: "http://127.0.0.1/auth/callback" };
globalThis.sessionStorage = new MemStorage();
globalThis.document = { title: "t" };

const deepLinkMocks = {
  "@capacitor/app": `export const App={getLaunchUrl:async()=>({url:globalThis.__dl.launch}),addListener:async(n,cb)=>{globalThis.__dl.listeners[n]=cb;return {remove(){}};}};`,
  "@/services/platform": `export const detectPlatform=()=>({kind:'ios',isCapacitor:true,isIOS:true,isNative:true,isAndroid:false});`,
  "@/components/StartupGate": `export const markSessionBootstrapped=()=>{};`,
  "@/lib/auth-redirect": `export const oauthDeepLinkToAppPath=(u)=>{if(!u||!u.startsWith('roamie://auth/callback'))return null;return '/auth/callback'+u.slice('roamie://auth/callback'.length);};
export const buildInAppOAuthCallbackHref=(p)=>'http://127.0.0.1'+p;`,
  "@/lib/auth-oauth": `export const AUTH_CALLBACK_PATH='/auth/callback';export const finalizeOAuthBrowserReturn=async()=>{};`,
  "@/lib/auth-debug": `export const logAuthDebug=()=>{};export const logAuthError=()=>{};export const emitOAuthFlow=()=>{};`,
  "@/lib/capacitor-bridge-ready": `export const waitForCapacitorBridge=async()=>{};`,
  "@/lib/oauth-app-navigate": `export const navigateOAuthAppPath=async(p)=>{globalThis.__dl.navs.push(p);return 'router';};`,
  "@/lib/oauth-callback-guard": `export const shouldSkipOAuthCallbackNavigation=async()=>false;`,
  "@/lib/ios-snapshot-bridge": `export const notifyIosOAuthReturn=()=>{};`,
};
async function nodeBundle(name, entry, mocks, variant) {
  const out = path.join(tmp, `${name}-${variant}.mjs`);
  await build({
    stdin: { contents: entry, resolveDir: root, loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "error",
    outfile: out,
    jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    define,
    plugins: [plugin(mocks, variantSources(variant))],
  });
  return out;
}
let seqImport = 0;
const dl = {};
for (const v of ["old", "new"]) dl[v] = await nodeBundle("deeplink", "export * from '@/lib/auth-oauth-deep-link';", deepLinkMocks, v);
const origInfo = console.info;
async function deepLinkRun(variant, steps) {
  globalThis.__dl = { launch: null, listeners: {}, navs: [], logs: [] };
  sessionStorage.clear();
  console.info = (...a) => {
    if (typeof a[0] === "string" && a[0].startsWith("[OAUTH_DEEP_LINK")) globalThis.__dl.logs.push(JSON.stringify(a));
    else origInfo(...a);
  };
  try {
    const mod = await import(pathToFileURL(dl[variant]).href + "?n=" + ++seqImport);
    await steps(mod, globalThis.__dl);
    return globalThis.__dl;
  } finally {
    console.info = origInfo;
  }
}
const URL_A = "roamie://auth/callback?code=old-google-code-111";
const URL_B = "roamie://auth/callback?code=new-google-code-222";
const tick = () => sleep(15);
const dlScenario = async (mod, d) => {
  d.launch = URL_A;
  mod.attachOAuthDeepLinkListener(); // 冷啟動：getLaunchUrl = A
  await tick();
  d.mark1 = d.navs.length;
  d.listeners.appStateChange({ isActive: true }); // 回前景：getLaunchUrl 重放 A
  await tick();
  d.mark2 = d.navs.length;
  d.listeners.appUrlOpen({ url: URL_B }); // 登出後新的 Google 登入
  await tick();
  d.mark3 = d.navs.length;
  d.listeners.appStateChange({ isActive: true }); // 回前景：仍回傳舊的 A
  await tick();
  d.mark4 = d.navs.length;
  d.launch = URL_B; // 若 iOS 把 launch URL 更新為 B
  d.listeners.appStateChange({ isActive: true });
  await tick();
  d.mark5 = d.navs.length;
  d.launch = "roamie://auth/callback?code=never-seen-333"; // getLaunchUrl 給一個從未處理過的 URL
  d.listeners.appStateChange({ isActive: true });
  await tick();
  d.mark6 = d.navs.length;
};
await check("N1 getLaunchUrl 去重：重放舊 URL 不再導回 callback；新的 appUrlOpen／新的 launch URL 不被擋（new）", async () => {
  const d = await deepLinkRun("new", dlScenario);
  info("N1 new navs=" + JSON.stringify(d.navs) + " logs=" + JSON.stringify(d.logs));
  assert.equal(d.mark1, 1, "冷啟動 A 導向一次");
  assert.equal(d.mark2, 1, "回前景重放 A 被擋");
  assert.equal(d.mark3, 2, "新的 URL B（appUrlOpen）必須放行");
  assert.equal(d.mark4, 2, "再重放 A 被擋");
  assert.equal(d.mark5, 2, "launch=B（已處理過）被擋");
  assert.equal(d.mark6, 3, "從未處理過的 launch URL 必須放行");
  assert.deepEqual(d.navs, ["/auth/callback?code=old-google-code-111", "/auth/callback?code=new-google-code-222", "/auth/callback?code=never-seen-333"]);
  assert.ok(d.logs.length >= 3 && d.logs.every((l) => !/code|roamie:|http/.test(l.replace('"[OAUTH_DEEP_LINK_SKIP]"', ""))), "skip log 不含 URL/code：" + JSON.stringify(d.logs));
});
await check("N2 對照：舊版（HEAD）回前景會重放舊 callback URL", async () => {
  const d = await deepLinkRun("old", dlScenario);
  info("N2 old navs=" + JSON.stringify(d.navs));
  assert.ok(d.mark2 > d.mark1, "舊版預期重放 A");
});
await check("N3 非 getLaunchUrl 來源（appUrlOpen／native-asweb）重送同一 URL 不被去重擋下（交給既有 consumed/session 守門）", async () => {
  const d = await deepLinkRun("new", async (mod, dd) => {
    mod.attachOAuthDeepLinkListener();
    await tick();
    dd.listeners.appUrlOpen({ url: URL_A });
    await tick();
    dd.listeners.appUrlOpen({ url: URL_A });
    await tick();
    globalThis.__roamieHandleOAuthReturn(URL_A);
    await tick();
  });
  assert.equal(d.navs.length, 3, JSON.stringify(d.navs));
});
await check("N4 冷啟動 appUrlOpen 先到、getLaunchUrl 後到同一 URL：只導向一次（new）", async () => {
  const d = await deepLinkRun("new", async (mod, dd) => {
    mod.handleOAuthReturnUrl(URL_A, "appUrlOpen"); // listener 尚未 attach，進 early queue
    dd.launch = URL_A;
    mod.attachOAuthDeepLinkListener(); // drain early queue，再 getLaunchUrl
    await tick();
  });
  assert.equal(d.navs.length, 1, JSON.stringify(d.navs));
});

// forceNavigateAfterLoginFallback 單元（真實 login-navigation／auth-post-redirect／startup-*／admin／pending）
const navMocks = {
  "@/services/platform": deepLinkMocks["@/services/platform"],
  "@/components/StartupGate": `export const markSessionBootstrapped=()=>{};`,
  "@/lib/ios-snapshot-bridge": `export const scheduleIosSnapshotRefreshBurst=()=>{};`,
  "@/lib/app-boot-log": webMocks["@/lib/app-boot-log"],
  "@/lib/onboarding-storage": webMocks["@/lib/onboarding-storage"],
  "@/lib/auth-session": webMocks["@/lib/auth-session"],
  "@/lib/startup-route": webMocks["@/lib/startup-route"],
  "@/lib/preferences-storage": webMocks["@/lib/preferences-storage"],
  "@/lib/supabase-auth-storage": webMocks["@/lib/supabase-auth-storage"],
};
const navEntry = `export * from '@/lib/login-navigation';export * from '@/lib/auth-post-redirect';
export {stashAdminReturn} from '@/lib/admin/admin-route-boundary';export {stashPendingAuthAction,peekPendingAuthAction} from '@/lib/auth-pending-action';`;
const navBundle = await nodeBundle("nav", navEntry, navMocks, "new");
async function navRun(fn) {
  sessionStorage.clear();
  location.pathname = "/auth/callback";
  globalThis.__t = { session: { user: { id: "u" } }, onb: true, console: [], authLogs: [] };
  const mod = await import(pathToFileURL(navBundle).href + "?n=" + ++seqImport);
  const calls = [];
  const navigate = (o) => {
    calls.push(o);
  };
  const quiet = console.info;
  console.info = () => {};
  const qlog = console.log;
  console.log = () => {};
  try {
    await fn(mod, navigate, calls);
  } finally {
    console.info = quiet;
    console.log = qlog;
  }
  return calls;
}
await check("N5 保險（未有前次目標）：onboarding 完成 → '/'；未完成 → '/welcome'", async () => {
  const c1 = await navRun(async (m, nav) => {
    assert.equal(m.forceNavigateAfterLoginFallback(nav, "auth-callback"), "/");
  });
  assert.equal(c1[0]?.to, "/");
  const c2 = await navRun(async (m, nav) => {
    globalThis.__t.onb = false;
    const t = m.forceNavigateAfterLoginFallback(nav, "auth-callback");
    assert.equal(t, "/welcome");
  });
  assert.equal(c2[0]?.to, "/welcome", JSON.stringify(c2));
});
await check("N6 保險沿用前次目標 /admin，不再消費 admin return（第二次 navigateOnce 仍被 committed 擋下）", async () => {
  const calls = await navRun(async (m, nav) => {
    m.stashAdminReturn();
    await m.navigateOnceAfterLogin(nav, "auth-callback");
    assert.equal(sessionStorage.getItem("roamie:admin:return-to"), null);
    m.stashAdminReturn(); // 若保險誤消費會把這筆吃掉
    m.forceNavigateAfterLoginFallback(nav, "auth-callback");
    assert.equal(sessionStorage.getItem("roamie:admin:return-to"), "/admin", "保險不可再消費 admin return");
    await m.navigateOnceAfterLogin(nav, "auth-callback");
  });
  assert.deepEqual(calls.map((c) => c.to), ["/admin", "/admin"]);
});
await check("N7 保險沿用 pending action 目標時應保留 search（/saved?tab=trips）", async () => {
  const calls = await navRun(async (m, nav) => {
    m.stashPendingAuthAction({ action: "favorite_write", sourcePath: "/saved?tab=trips" });
    await m.navigateOnceAfterLogin(nav, "auth-callback");
    m.forceNavigateAfterLoginFallback(nav, "auth-callback");
    assert.equal(m.peekPendingAuthAction()?.sourcePath, "/saved?tab=trips", "pending 不被導向流程 claim");
  });
  info("N7 navigate 呼叫：" + JSON.stringify(calls));
  assert.deepEqual(calls[0], { to: "/saved", search: { tab: "trips" }, replace: true });
  assert.deepEqual(calls[1]?.search, { tab: "trips" }, "保險導向遺失 search");
});
await check("N8 forceNavigateAfterLoginFallback 只在 auth.callback.tsx 使用（Apple 原生／login-session-restore 路徑未接保險）", () => {
  const hits = execFileSync("git", ["grep", "-l", "forceNavigateAfterLoginFallback", "--", "src"], { cwd: root, encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(hits, ["src/lib/login-navigation.ts", "src/routes/auth.callback.tsx"]);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n結果：${passCount} PASS / ${failures.length} FAIL`);
if (failures.length) {
  console.log("失敗項目：\n  - " + failures.join("\n  - "));
  process.exitCode = 1;
}
