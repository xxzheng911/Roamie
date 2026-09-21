import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { build } from "esbuild";

// Real React DOM, App, AppProviders, SubscriptionProvider, PlusPurchaseProvider,
// Welcome and usePlusUpgrade. Only router/auth/native/visual boundaries are controlled.
const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-provider-auth-"));
const model = `import {useSyncExternalStore} from 'react';
export const m=window.model={state:{path:'/welcome',status:'idle',screen:'welcome',user:null,loading:false},listeners:new Set(),errors:[],marks:[],factories:0,configures:[],dialogMounts:0,opens:0};
m.set=(patch)=>{m.state={...m.state,...patch};history.replaceState({},'',m.state.path);for(const l of m.listeners)l();};
export const useModel=()=>useSyncExternalStore(cb=>{m.listeners.add(cb);return()=>m.listeners.delete(cb)},()=>m.state);
export const navigate=async({to})=>m.set({path:to,status:'pending'});
export const pass=({children})=>children;
export const noop=()=>{};`;
const mocks = {
  "test-model": model,
  "@tanstack/react-router": `import {useModel,navigate,pass} from 'test-model';export const useNavigate=()=>navigate;export const useRouterState=({select})=>{const s=useModel();return select({location:{pathname:s.path},status:s.status})};export const createFileRoute=()=>options=>({options});export const Link=pass;`,
  "@/hooks/use-auth": `import React,{createContext,useContext} from 'react';import {useModel} from 'test-model';const C=createContext(null);export const AuthProvider=({children})=>{const s=useModel();return <C.Provider value={{user:s.user,loading:s.loading}}>{children}</C.Provider>};export const useAuth=()=>{const c=useContext(C);if(!c)throw Error('auth ordering');return c};`,
  "@/hooks/use-i18n": `import React,{createContext,useContext} from 'react';const C=createContext(null);const value={t:k=>k,tList:()=>['feature']};export const I18nProvider=({children})=><C.Provider value={value}>{children}</C.Provider>;export const useI18n=()=>{const c=useContext(C);if(!c)throw Error('i18n ordering');return c};`,
  "@/hooks/use-access": `import React,{createContext,useContext} from 'react';import {useSubscription} from '${root}/src/providers/SubscriptionProvider';const C=createContext(null);const value={isPlusUser:false,enablePlusTestMode:()=>{},disablePlusTestMode:()=>{}};export const AccessProvider=({children})=>{useSubscription();return <C.Provider value={value}>{children}</C.Provider>};export const useAccess=()=>{const c=useContext(C);if(!c)throw Error('access ordering');return c};export const useAccessOptional=()=>useContext(C);`,
  "@/services/subscription": `import {m} from 'test-model';const status={tier:'free',isActive:false,source:'local'};export const createSubscriptionAdapter=()=>{m.factories++;return {id:'local',configure:async id=>{m.configures.push(id)},logOut:async()=>{},getStatus:async()=>status,getUsage:async()=>({}),addStatusListener:async()=>()=>{}}};`,
  "@/lib/subscription/revenuecat-sync": `export const isCanonicalRestoreConfirmed=()=>false;export const syncRevenueCatEntitlementAfterRestore=async()=>({ok:true,active:false});export const syncRevenueCatEntitlementWithServer=syncRevenueCatEntitlementAfterRestore;`,
  "@/components/PlusComingSoonDialog": `import {useEffect} from 'react';import {m} from 'test-model';export function PlusComingSoonDialog(props){m.dialog=props;useEffect(()=>{m.dialogMounts++},[]);useEffect(()=>{if(props.open)m.opens++},[props.open]);return null;}`,
  "@/components/AppErrorBoundary": `import React from 'react';import {m} from 'test-model';export class AppErrorBoundary extends React.Component{state={error:null};static getDerivedStateFromError(error){return {error}}componentDidCatch(e){m.errors.push(e.message)}render(){return this.state.error?<div>ERROR</div>:this.props.children}}`,
  "@/lib/access/subscription-dev-mode": `export const canBypassSubscriptionBilling=()=>false;`,
  "@/constants/env": `export const assertClientEnv=()=>{};`,
  "@/integrations/supabase/client": `export const isSupabaseConfigured=()=>true;`,
  "@/lib/app-boot-cache": `export const hydrateAppBootCachesAsync=async()=>{};export const resetAppBootCachesForUserChange=()=>{};`,
  "@/lib/conversation-workspace/storage": `export const flushConversationWorkspacesToNative=async()=>{};`,
  "@/lib/conversation-workspace/remote-sync": `export const pushConversationWorkspacesRemote=async()=>{};`,
  "@/lib/capacitor-native-shell": `export const isCapacitorNativeShell=()=>false;`,
  "@/lib/clear-auth-state": `export const clearPersonalizedChatCaches=()=>{};`,
  "@/lib/boot-diagnostics": `export const markBootPhase=()=>{};`,
  "@/lib/app-boot-log": `export const logAppBoot=()=>{};export const logAppBootSnapshot=async()=>{};`,
  "@/lib/startup-boot-state": `export const logAppRemountSource=()=>{};export const shouldLogAppMounted=()=>false;export const logNavSkipSameRoute=()=>{};export const shouldSkipStartupNavigation=()=>false;`,
  "@/services/platform": `export const detectPlatform=()=>({});`,
  "@/lib/log-error": `export const logAppError=()=>{};`,
  "@/lib/admin/admin-route-boundary": `export const isAdminAuthBoundaryRoute=()=>false;export const isAdminRoute=()=>false;`,
  "@/hooks/use-ios-interactive-route": `export const useIosInteractiveRoute=()=>{};`,
  "@/lib/plan-tier": `import {m} from 'test-model';export const markIntroCompleted=async tier=>{m.marks.push(tier)};`,
  "@/lib/plan-tier/sync-mock-tier": `export const applyLocalMockPlanTier=()=>{};export const syncMockPlanTierToProfile=async()=>{};`,
  "@/lib/onboarding-storage": `export const loadOnboardingState=async()=>{};export const isOnboardingCompletedSync=()=>false;export const logShowOnboardingFirstLaunch=()=>{};export const logSkipOnboarding=()=>{};export const resetOnboardingState=async()=>{};`,
  "@/lib/post-auth-navigation": `export const resolveStartupPath=async()=>'/login';`,
  "@/lib/startup-navigation": `export const guardStartupTarget=p=>p;export const logStartupNavigationContext=async()=>{};`,
  "@/services/analytics": `export const trackEvent=()=>{};`,
  sonner: `import {m} from 'test-model';export const toast={success:()=>{},message:()=>{},error:text=>m.errors.push(text)};`,
};
for (const [module, name] of [
  ["@/hooks/use-avatar", "AvatarProvider"],
  ["@/hooks/use-cover", "CoverProvider"],
  ["@/hooks/use-add-to-trip", "AddToTripProvider"],
  ["@/providers/AnalyticsProvider", "AnalyticsProvider"],
  ["@/providers/PlatformProvider", "PlatformProvider"],
  ["@/components/OnboardingGate", "OnboardingGate"],
  ["@/components/MobileFrame", "MobileFrame"],
])
  mocks[module] = `export {pass as ${name}} from 'test-model';`;
const entry = `
import React,{useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {App} from './src/App';import {Route} from './src/routes/welcome';import {usePlusUpgrade} from './src/hooks/use-plus-upgrade';
import {savePlusPurchaseContinuation} from './src/lib/subscription/purchase-continuation';import {m,useModel} from 'test-model';
const Welcome=Route.options.component;const key='roamie:plus-purchase-continuation';
function Probe(){const {openRevenueCatPaywall}=usePlusUpgrade();m.upgrade=openRevenueCatPaywall;return <button onClick={()=>openRevenueCatPaywall()}>profile-upgrade</button>}
function Harness(){const s=useModel();return <App>{s.screen==='welcome'?<Welcome/>:<Probe/>}</App>}
const root=createRoot(document.getElementById('root'));root.render(<Harness/>);
const settle=()=>new Promise(r=>setTimeout(r,30));const check=(value,label)=>{if(!value)throw Error(label)};
const move=async patch=>{m.set(patch);await settle();check(!m.errors.length,JSON.stringify(m.errors))};
const click=async text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);check(b,'button '+text);b.click();await settle();check(!m.errors.length,JSON.stringify(m.errors))};
const tiers=async()=>{await click('plusPurchase.start');await click('plusPurchase.continue');await click('plusPurchase.continue')};
window.run=async()=>{
 await settle();check(document.body.textContent.includes('plusPurchase.start'),'Welcome rendered');await tiers();
 await click('plusPurchase.upgrade');check(m.state.path==='/login','navigate login');check(!!sessionStorage.getItem(key),'intent saved');
 // Force a render of the still-mounted Welcome while browser location already says login.
 await move({loading:true});await move({loading:false});check(document.body.textContent.includes('plusPurchase.upgrade'),'outgoing Welcome survives pending login');
 await move({screen:'login',status:'idle'});check(!m.dialog.open,'login paywall closed');
 await move({user:{id:'A'},loading:true});check(!!sessionStorage.getItem(key),'hydration preserves intent');
 await move({loading:false});check(!!sessionStorage.getItem(key),'login never consumes intent');
 await move({path:'/profile',status:'pending'});check(!!sessionStorage.getItem(key),'pending navigation never consumes intent');
 await move({screen:'profile',status:'idle'});check(m.dialog.open,'continuation opens paywall');check(!sessionStorage.getItem(key),'intent removed');check(m.opens===1,'one continuation');
 const authority=m.upgrade;m.dialog.onOpenChange(false);await settle();await move({path:'/home'});check(m.upgrade===authority,'same authority across routes');check(!m.dialog.open,'no replay');
 await move({path:'/profile'});await click('profile-upgrade');check(m.dialog.open,'Profile same paywall');
 savePlusPurchaseContinuation('open_paywall');await move({user:null,path:'/login',screen:'login'});check(!m.dialog.open,'logout closes');check(!sessionStorage.getItem(key),'logout clears A intent');
 await move({user:{id:'B'},path:'/profile',screen:'profile'});check(!m.dialog.open,'no A intent for B');
 await move({user:{id:'A'}});check(!m.dialog.open,'A return does not resurrect paywall');
 const opens=m.opens;await move({user:null,path:'/welcome',screen:'welcome'});await tiers();await click('plusPurchase.tryFree');check(m.marks.at(-1)==='free','Free completes');check(m.state.path==='/login','Free navigates');check(!sessionStorage.getItem(key),'Free creates no purchase intent');check(m.opens===opens,'Free no purchase operation');
 check(m.factories===1,'SubscriptionProvider never remounts');check(m.dialogMounts===1,'Plus provider never remounts');check(JSON.stringify(m.configures)===JSON.stringify(['A','B','A']),'configure only on identity changes');
 return {result:'PASS',errors:m.errors,subscriptionInstances:m.factories,paywallInstances:m.dialogMounts,configuredUsers:m.configures,cases:8};
};`;
await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  outfile: path.join(dir, "app.js"),
  format: "iife",
  define: {
    "import.meta.env.DEV": "false",
    "import.meta.env.VITE_DEPLOY_ENV": '"production"',
    "process.env.NODE_ENV": '"production"',
  },
  plugins: [
    {
      name: "controlled-boundaries",
      setup(b) {
        if (process.argv.includes("--baseline")) {
          b.onLoad({ filter: /[/\\]AppProviders\.tsx$/ }, () => ({
            contents: execFileSync(
              "git",
              ["show", "62fb6901c59ae16d7d01ec85a5571548fbeba4c9:src/providers/AppProviders.tsx"],
              { encoding: "utf8" },
            ),
            loader: "tsx",
            resolveDir: path.join(root, "src/providers"),
          }));
        }
        b.onResolve({ filter: /.*/ }, (args) =>
          args.path in mocks ? { path: args.path, namespace: "mock" } : null,
        );
        b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents: mocks[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/app.js" ? "application/javascript" : "text/html");
  res.end(
    req.url === "/app.js"
      ? fs.readFileSync(path.join(dir, "app.js"))
      : '<div id="root"></div><script src="/app.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const chrome = spawn(
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-port=0",
    "--user-data-dir=" + path.join(dir, "chrome"),
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    chrome.stderr.on("data", (b) => {
      output += b;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    chrome.on("error", reject);
    chrome.on("exit", (code) => reject(Error("Chrome exit " + code)));
    setTimeout(() => reject(Error("Chrome startup timeout")), 15000).unref();
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const r = JSON.parse(e.data);
    if (r.id) {
      const p = pending.get(r.id);
      pending.delete(r.id);
      r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      ws.send(JSON.stringify({ id: next, method, params, sessionId }));
    });
  const { targetInfos } = await send("Target.getTargets");
  const { sessionId } = await send("Target.attachToTarget", {
    targetId: targetInfos.find((t) => t.type === "page").targetId,
    flatten: true,
  });
  await send(
    "Page.navigate",
    { url: "http://127.0.0.1:" + server.address().port + "/welcome" },
    sessionId,
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const r = await send(
      "Runtime.evaluate",
      { expression: 'typeof window.run === "function"', returnByValue: true },
      sessionId,
    );
    if (r.result.value) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(ready, "browser harness loaded");
  const result = await send(
    "Runtime.evaluate",
    { expression: "window.run()", awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (process.argv.includes("--baseline")) {
    assert.match(
      JSON.stringify(result.exceptionDetails),
      /usePlusPurchase must be used within PlusPurchaseProvider/,
    );
    console.log(
      "Baseline reproduction: PASS (RC ProviderGate reproduces the exact native Provider error)",
    );
  } else {
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    console.log("Provider/auth continuation regression:", JSON.stringify(result.result.value));
  }
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}
