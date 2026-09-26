#!/usr/bin/env node
/** Real production browser regression; run against a LOCAL Wrangler production build.
 * No auth/router mocks or repaired state. Only onboarding completion is seeded.
 * A fresh browser context tests cold boot; repeated document loads exercise the
 * ssr:false pending-snapshot race. Polling deadlines are test failure limits.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const base = new URL(process.env.REVIEW_URL || "http://localhost:8793");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname), "local test server required");
const repeats = Number(process.env.RACE_REPEATS || 20);
assert.ok(Number.isInteger(repeats) && repeats >= 10, "at least 10 race repetitions required");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-login-regression-"));
const chrome = spawn(
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${dir}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ws;
let checks = 0;
const errors = [];
const injection = `(() => {
  localStorage.setItem('onboarding_completed','true');
  window.__loginAuditErrors=[];window.__loginAuditNavigations=[];
  const record=value=>window.__loginAuditErrors.push(String(value));
  window.addEventListener('error',e=>record(e.message));
  window.addEventListener('unhandledrejection',e=>record(e.reason));
  const error=console.error;console.error=(...args)=>{record(args.map(a=>a?.message||String(a)).join(' '));error(...args)};
  for(const method of ['pushState','replaceState']){const original=history[method];history[method]=function(...args){window.__loginAuditNavigations.push(String(args[2]));return original.apply(this,args)}}
})()`;
const snapshot = `(() => {
  const r=window.__TSR_ROUTER__,s=r?.state;
  const frame=document.querySelector('.mobile-frame-inner');
  const buttons=[...document.querySelectorAll('button')];
  const signIn=buttons.find(b=>/Google/.test(b.textContent));
  return {url:location.pathname,router:s?.location.pathname,resolved:s?.resolvedLocation?.pathname,
    status:s?.status,loading:s?.isLoading,matches:s?.matches.map(m=>({id:m.routeId,status:m.status})),
    pending:r?.stores.pendingMatches.get().length,
    rootDom:!!frame,loginDom:!!signIn && signIn.getBoundingClientRect().height>0,
    errors:window.__loginAuditErrors||[],bootError:window.__ROAMIE_BOOT__?.error,
    navigationCount:window.__loginAuditNavigations?.length||0,
    h1:document.querySelector('h1')?.textContent,bodyLength:document.body?.innerText.length};
})()`;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(Error("Chrome startup timeout")), 15000);
    chrome.stderr.on("data", (b) => {
      stderr += b;
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    chrome.once("error", reject);
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  const loads = new Map();
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (m.method === "Page.loadEventFired")
      loads.set(m.sessionId, (loads.get(m.sessionId) || 0) + 1);
    if (m.method === "Runtime.exceptionThrown")
      errors.push(
        m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text,
      );
    if (!m.id) return;
    const p = pending.get(m.id);
    pending.delete(m.id);
    clearTimeout(p.timer);
    m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      const timer = setTimeout(() => {
        pending.delete(next);
        reject(Error(`CDP timeout: ${method}`));
      }, 20000);
      pending.set(next, { resolve, reject, timer });
      ws.send(JSON.stringify({ id: next, method, params, sessionId }));
    });
  async function openContext() {
    const { browserContextId } = await send("Target.createBrowserContext");
    const { targetId } = await send("Target.createTarget", {
      url: "about:blank",
      browserContextId,
    });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    const evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await call("Page.enable");
    await call("Runtime.enable");
    await call("Page.addScriptToEvaluateOnNewDocument", { source: injection });
    async function check(label, expected = "/login") {
      let s;
      for (let n = 0; n < 150; n++) {
        s = await evaluate(snapshot);
        assert.deepEqual(s.errors, [], `${label}: console/runtime error`);
        assert.ok(!s.bootError, `${label}: REACT_UNCAUGHT ${s.bootError}`);
        assert.ok(s.navigationCount <= 6, `${label}: possible redirect loop`);
        if (
          expected === "/login"
            ? s.url === expected &&
              s.router === expected &&
              s.resolved === expected &&
              s.status === "idle" &&
              !s.loading &&
              s.pending === 0 &&
              s.rootDom &&
              s.loginDom &&
              s.matches?.every((m) => m.status === "success") &&
              s.matches.some((m) => m.id === "/login")
            : s.url === expected &&
              s.router === expected &&
              s.h1 &&
              s.bodyLength > 150 &&
              !s.loading
        )
          break;
        if (n === 149) assert.fail(`${label}: ${JSON.stringify(s)}`);
        await pause(100);
      }
      await pause(150);
      s = await evaluate(snapshot);
      assert.deepEqual(s.errors, [], label);
      assert.ok(!s.bootError, label);
      if (expected === "/login") {
        assert.ok(
          s.rootDom && s.loginDom && s.status === "idle" && s.pending === 0,
          `${label}: UI did not remain mounted`,
        );
        assert.equal(s.url, expected);
        assert.equal(s.router, expected);
      }
      checks++;
      console.log("PASS", label);
    }
    async function documentLoad(route, expected = "/login") {
      const before = loads.get(sessionId) || 0;
      if (route === "reload") await call("Page.reload");
      else await call("Page.navigate", { url: new URL(route, base).href });
      for (let i = 0; (loads.get(sessionId) || 0) === before; i++) {
        assert.ok(i < 150, "document load timed out");
        await pause(100);
      }
      await check(`document ${route}`, expected);
    }
    async function spa(route, expected = "/login") {
      await evaluate(
        `window.__loginAuditNavigations=[];window.__spaDone=false;window.__TSR_ROUTER__.navigate({to:${JSON.stringify(route)}}).then(()=>window.__spaDone=true);true`,
      );
      await check(`SPA ${route}`, expected);
      assert.equal(await evaluate("window.__spaDone"), true, "navigation promise settled");
    }
    return {
      documentLoad,
      spa,
      close: () => send("Target.disposeBrowserContext", { browserContextId }),
    };
  }
  // CASE 7: separate cache/storage contexts, no preceding Login warmup.
  for (const route of ["/saved", "/map", "/profile"]) {
    const page = await openContext();
    await page.documentLoad(route);
    await page.close();
  }
  const page = await openContext();
  await page.documentLoad("/login"); // CASE 1
  for (const route of ["/saved", "/map", "/profile"]) {
    await page.documentLoad(route); // CASE 2–4
    await page.documentLoad("reload"); // CASE 9
  }
  for (const route of ["/privacy", "/terms", "/support"]) {
    await page.documentLoad(route, route);
    await page.documentLoad("/saved"); // CASE 5
  }
  for (const doc of ["privacy", "terms"])
    await page.documentLoad(`/login/legal?doc=${doc}`, `/${doc}`);
  await page.documentLoad("/login");
  for (const route of ["/saved", "/map", "/profile"]) await page.spa(route); // CASE 8
  await page.spa("/support", "/support");
  await page.spa("/saved");
  for (let round = 1; round <= repeats; round++) {
    // CASE 6 + 10
    for (const route of ["/saved", "/map", "/saved", "/map"]) await page.documentLoad(route);
    console.log(`RACE_ROUND ${round}/${repeats} PASS`);
  }
  await page.close();
  assert.deepEqual(errors, [], "uncaught browser exceptions");
  console.log(
    JSON.stringify({
      result: "PASS",
      checks,
      raceRounds: repeats,
      repeatedDocumentNavigations: repeats * 4,
      blankLogin: 0,
      uncaughtErrors: 0,
    }),
  );
} finally {
  ws?.close();
  chrome.kill();
}
