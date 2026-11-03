// verify-chat-generation-lock-router.mjs — 任務單 #L1-T2：「行程已完成」提示的「查看」按鈕由「已卸載的聊聊實例」呼叫 navigate 能否實際導向（真實 router）
//
// _app.chat.tsx 的「查看」onClick 呼叫的是聊聊頁 render 時取得的 useNavigate()（第 1236 行 `const navigate = useNavigate();`），
// 按下時該聊聊實例早已卸載。本腳本以真實 @tanstack/react-router（node_modules 版本）＋真實 tripDetailNavigateOptions，
// 在 headless Chrome（React development build＋StrictMode）驗證：
//   R1 /chat 掛載時取得 navigate；導向 / 後 /chat 元件已卸載（DOM 不存在、unmount 計數）
//   R2 用已卸載實例的 navigate 呼叫 navigate(tripDetailNavigateOptions("trip-x")) → location＝/saved/trip-x，且行程頁實際 render 出 tripId
//   R3 使用者已在其他非 _app 層級較淺的路由（/standalone，matches 數比 /chat 少）時同樣可導向（舊版 useNavigate 以 matchIndex 取 from 會出錯的情境）
//   R4 sha 前提：_app.chat.tsx 的 navigate 仍是 useNavigate()（未帶 from）、「查看」onClick 仍以 tripDetailNavigateOptions(saved.id) 導向
//      （#L1-T3：改為 notifyChatGenerationDone(() => { void navigate(tripDetailNavigateOptions(saved.id)); })，模組以 onClick: onView 掛上）
//      （#L1-T4：呼叫點 2 處——保存後 entry_blocked 且不在原對話、一般完成且不在原對話；兩處 onView 相同）
//   R0 無外部請求、無瀏覽器例外
// 執行：node scripts/verify-chat-generation-lock-router.mjs（不連網、不讀 .env）

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const failures = [];
let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 12).join("\n     "));
  }
}

await check("R4 前提：聊聊頁 navigate＝useNavigate()（不帶 from）；「查看」onClick 以 tripDetailNavigateOptions(saved.id) 導向", () => {
  const s = read("src/routes/_app.chat.tsx");
  assert.equal(s.split("  const navigate = useNavigate();\n").length, 2, "聊聊頁 navigate 來源改變，請更新本測試");
  // #L1-T3：提示改由 notifyChatGenerationDone(onView) 顯示（文案在顯示當下取目前語系）；onView 仍是聊聊實例的 navigate。
  // #L1-T4（第 3 輪）：呼叫點 1 → 2：
  //   (a) 保存成功後 ownership／Session 快照失效（entry_blocked）且不在原對話 → 完成提示（不導向、不發失敗提示）
  //   (b) 保存成功、快照仍有效但不在原對話（別頁或新對話）→ 完成提示（取代自動導向）
  //   兩處的「查看」onView 都必須是同一個聊聊實例 navigate(tripDetailNavigateOptions(saved.id))。
  const calls = s.split("notifyChatGenerationDone(").length - 1;
  assert.equal(calls, 2, "聊聊頁 notifyChatGenerationDone 呼叫次數改變（預期 2），請更新本測試");
  const onView = /notifyChatGenerationDone\(\(\) => \{\n\s+void navigate\(tripDetailNavigateOptions\(saved\.id\)\);\n\s+\}\);/g;
  assert.equal((s.match(onView) ?? []).length, 2, "兩處「查看」onView 內容不全是 navigate(tripDetailNavigateOptions(saved.id))，請更新本測試");
  const blocked =
    /logTripLifecycle\("aborted", \{ failureCode: "entry_blocked" \}\);\n\s+\/\/ L1: 行程已保存成功[^\n]*\n\s+if \(!isOriginalConversation\(generationOriginSessionId\)\) \{\n\s+notifyChatGenerationDone\(\(\) => \{\n\s+void navigate\(tripDetailNavigateOptions\(saved\.id\)\);\n\s+\}\);\n\s+\}\n\s+return;\n/;
  assert.ok(blocked.test(s), "(a) entry_blocked 分支的語意改變（應：不在原對話才發完成提示，之後 return、不導向）");
  const detached =
    /if \(isOriginalConversation\(generationOriginSessionId\)\) \{\n\s+logTripLifecycle\("navigation_started"\);\n\s+const navigation = navigate\(tripDetailNavigateOptions\(saved\.id\)\);[\s\S]{0,200}?\} else \{\n\s+\/\/ L1: 使用者已不在原對話[^\n]*\n\s+console\.info\("\[CHAT_GENERATION_DONE_DETACHED\]"[^\n]*\n\s+notifyChatGenerationDone\(\(\) => \{/;
  assert.ok(detached.test(s), "(b) 一般完成分支的語意改變（應：原對話直接導向，否則發完成提示）");
  // (a) 必須在 itinerarySucceeded = true 之後（否則 finally 會再發失敗提示）
  const iSucceeded = s.indexOf("      itinerarySucceeded = true;\n");
  const iBlocked = s.search(blocked);
  assert.ok(iSucceeded > 0 && iSucceeded < iBlocked, "(a) 不在 itinerarySucceeded = true 之後");
  // 模組端：action.onClick 必須直接是呼叫端傳入的 onView（點「查看」＝呼叫上面的 navigate；行為見 verify-chat-generation-lock-module.mjs U12）
  const m = read("src/lib/ai/chat-generation-lock.ts");
  assert.ok(/export function notifyChatGenerationDone\(onView: \(\) => void\): void \{[\s\S]*?label: currentCopy\("chatGenerationDoneView"\),\n\s+onClick: onView,/.test(m), "notifyChatGenerationDone 的 action 改變，請更新本測試");
  assert.match(read("src/lib/trip/trip-detail-nav.ts"), /TRIP_DETAIL_ROUTE = "\/saved\/\$tripId"/);
});

const entry = String.raw`import React,{StrictMode,useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {createRouter,createRootRoute,createRoute,createMemoryHistory,RouterProvider,Outlet,useNavigate} from '@tanstack/react-router';
import {tripDetailNavigateOptions} from '@/lib/trip/trip-detail-nav';
window.__errors=[];window.addEventListener('error',e=>window.__errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
window.__chatMounts=0;window.__chatUnmounts=0;
const rootRoute=createRootRoute({component:()=> <div id="app"><Outlet/></div>});
const appRoute=createRoute({getParentRoute:()=>rootRoute,id:'_app',component:()=> <div id="app-layout"><Outlet/></div>});
function Chat(){const navigate=useNavigate();useEffect(()=>{window.__chatMounts++;window.__chatNavigate=navigate;return ()=>{window.__chatUnmounts++;};},[navigate]);return <div id="chat">chat</div>;}
const chatRoute=createRoute({getParentRoute:()=>appRoute,path:'/chat',component:Chat});
const homeRoute=createRoute({getParentRoute:()=>appRoute,path:'/',component:()=> <div id="home">home</div>});
const savedRoute=createRoute({getParentRoute:()=>appRoute,path:'/saved/$tripId',component:function Saved(){const {tripId}=savedRoute.useParams();return <div id="saved">{tripId}</div>;}});
const standaloneRoute=createRoute({getParentRoute:()=>rootRoute,path:'/standalone',component:()=> <div id="standalone">standalone</div>});
const router=createRouter({routeTree:rootRoute.addChildren([appRoute.addChildren([chatRoute,homeRoute,savedRoute]),standaloneRoute]),history:createMemoryHistory({initialEntries:['/chat']})});
window.__router=router;
window.state=()=>({path:router.state.location.pathname,matches:router.state.matches.length,chat:!!document.getElementById('chat'),saved:(document.getElementById('saved')||{}).textContent||null,home:!!document.getElementById('home'),standalone:!!document.getElementById('standalone'),mounts:window.__chatMounts,unmounts:window.__chatUnmounts,errors:window.__errors.slice()});
window.go=async(to)=>{await router.navigate({to});return true;};
window.viewTrip=async(id)=>{await window.__chatNavigate(tripDetailNavigateOptions(id));return true;};
createRoot(document.getElementById('root')).render(<StrictMode><RouterProvider router={router}/></StrictMode>);
window.__ready=true;`;

const chromeBin = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
].find((p) => p && fs.existsSync(p));

if (!chromeBin) {
  failures.push("無可用 Chrome");
  console.log("FAIL 無可用 Chrome");
} else {
  const { build } = await import("esbuild");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-lock-router-"));
  await build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    logLevel: "error",
    outfile: path.join(dir, "app.js"),
    format: "iife",
    jsx: "automatic",
    jsxDev: true,
    platform: "browser",
    alias: { "@": path.join(root, "src") },
    define: { "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development","SSR":false}', "process.env.NODE_ENV": '"development"' },
  });
  const server = http.createServer((req, res) => {
    if ((req.url || "").startsWith("/app.js")) {
      res.setHeader("Content-Type", "application/javascript");
      res.end(fs.readFileSync(path.join(dir, "app.js")));
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const chrome = spawn(chromeBin, ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let ws;
  const external = [];
  const exceptions = [];
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let out = "";
      chrome.stderr.on("data", (b) => {
        out += b;
        const m = out.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) resolve(m[1]);
      });
      setTimeout(() => reject(Error("Chrome startup timeout")), 15000).unref();
    });
    ws = new WebSocket(endpoint);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
      const r = JSON.parse(e.data);
      if (r.method === "Runtime.exceptionThrown") exceptions.push(r.params.exceptionDetails.exception?.description ?? r.params.exceptionDetails.text);
      if (r.method === "Network.requestWillBeSent" && !/^(data:|blob:|about:|http:\/\/127\.0\.0\.1:)/.test(r.params.request.url)) external.push(r.params.request.url);
      if (r.id && pending.has(r.id)) {
        const p = pending.get(r.id);
        pending.delete(r.id);
        r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result);
      }
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params, sessionId }));
      });
    const { targetInfos } = await send("Target.getTargets");
    const { sessionId } = await send("Target.attachToTarget", { targetId: targetInfos.find((t) => t.type === "page").targetId, flatten: true });
    const call = (m, p = {}) => send(m, p, sessionId);
    const evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const waitFor = async (expr, ms = 5000) => {
      const t = Date.now();
      while (Date.now() - t < ms) {
        if (await evaluate(expr).catch(() => false)) return true;
        await new Promise((r) => setTimeout(r, 30));
      }
      return false;
    };
    await call("Runtime.enable");
    await call("Network.enable");
    const fresh = async () => {
      await call("Page.navigate", { url: `http://127.0.0.1:${port}/?n=${Math.random()}` });
      assert.ok(await waitFor("!!window.__ready && !!document.getElementById('chat')"), "fixture 未載入");
    };

    // 情境 1：聊聊 → 首頁（卸載）→ 用舊 navigate 查看
    await fresh();
    const s0 = await evaluate("window.state()");
    await evaluate("window.go('/')");
    await waitFor("!!document.getElementById('home')");
    const s1 = await evaluate("window.state()");
    await check("R1 /chat 掛載時取得 navigate；導向 / 後聊聊元件已卸載", () => {
      assert.equal(s0.chat, true);
      assert.equal(s1.path, "/");
      assert.equal(s1.chat, false, "聊聊仍在 DOM");
      assert.equal(s1.mounts, s1.unmounts, `mount ${s1.mounts}／unmount ${s1.unmounts}（未完全卸載）`);
    });
    await evaluate("window.viewTrip('trip-x')");
    await waitFor("!!document.getElementById('saved')");
    const s2 = await evaluate("window.state()");
    await check("R2 已卸載聊聊實例的 navigate(tripDetailNavigateOptions('trip-x')) → /saved/trip-x 並 render 行程頁", () => {
      assert.equal(s2.path, "/saved/trip-x");
      assert.equal(s2.saved, "trip-x", "行程頁未 render：" + JSON.stringify(s2));
      assert.equal(s2.chat, false, "不應重新掛載聊聊");
      assert.deepEqual(s2.errors, []);
    });

    // 情境 2：使用者在層級較淺的路由（matches 較少）
    await fresh();
    await evaluate("window.go('/standalone')");
    await waitFor("!!document.getElementById('standalone')");
    const s3 = await evaluate("window.state()");
    await evaluate("window.viewTrip('trip-y')");
    await waitFor("!!document.getElementById('saved')");
    const s4 = await evaluate("window.state()");
    await check("R3 使用者在層級較淺的路由（matches " + s3.matches + " 個，少於 /chat）時「查看」仍導向 /saved/trip-y", () => {
      assert.equal(s3.chat, false);
      assert.equal(s4.path, "/saved/trip-y");
      assert.equal(s4.saved, "trip-y");
      assert.deepEqual(s4.errors, []);
    });

    await check("R0 無外部請求、無瀏覽器例外", () => {
      assert.deepEqual(external, []);
      assert.deepEqual(exceptions, []);
    });
  } finally {
    try {
      ws?.close();
    } catch {}
    chrome.kill();
    server.close();
  }
}

console.log(`\n${passed} PASS / ${failures.length} FAIL`);
process.exit(failures.length ? 1 : 0);
