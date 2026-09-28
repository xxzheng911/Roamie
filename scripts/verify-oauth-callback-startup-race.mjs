import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
const base = "http://localhost:8793";
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "roamie-callback-race-"))}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(Error("Chrome timeout")), 15000);
    chrome.stderr.on("data", (b) => {
      text += b;
      const m = text.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    chrome.on("error", reject);
  });
  ws = new WebSocket(endpoint);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const handlers = new Map();
  const interceptionErrors = [];
  ws.addEventListener("message", async (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) {
        clearTimeout(p.timer);
        m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
      }
    } else if (m.method === "Fetch.requestPaused") {
      try {
        await handlers.get(m.sessionId)?.(m.params);
      } catch (err) {
        if (handlers.has(m.sessionId)) interceptionErrors.push(err.message);
      }
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => reject(Error("CDP timeout " + method)), 20000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const origins = ["https://roamie.tw", "https://f97ff87c-roamie.vvbwb6bw52.workers.dev"];
  for (const origin of origins)
    for (const mode of [
      "success",
      "failure",
      "consumed",
      "consumed-no-session",
      "normal",
      "protected",
    ]) {
      const { browserContextId } = await send("Target.createBrowserContext");
      const { targetId } = await send("Target.createTarget", {
        url: "about:blank",
        browserContextId,
      });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      const call = (m, p) => send(m, p, sessionId);
      const evaluate = async (expression) => {
        const r = await call("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        assert.ok(!r.exceptionDetails, "browser evaluation failed");
        return r.result.value;
      };
      let homeDocumentLoads = 0;
      handlers.set(sessionId, async (p) => {
        const u = new URL(p.request.url);
        if (u.origin !== origin) {
          await call("Fetch.failRequest", {
            requestId: p.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        if (p.resourceType === "Document" && u.pathname === "/") homeDocumentLoads++;
        const r = await fetch(base + u.pathname + u.search);
        const bytes = Buffer.from(await r.arrayBuffer());
        await call("Fetch.fulfillRequest", {
          requestId: p.requestId,
          responseCode: r.status,
          responseHeaders: [
            { name: "Content-Type", value: r.headers.get("content-type") ?? "text/html" },
          ],
          body: bytes.toString("base64"),
        });
      });
      await call("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      await call("Page.enable");
      await call("Runtime.enable");
      const injection = `(()=>{
    const mode=${JSON.stringify(mode)};
    const uid='00000000-0000-4000-8000-000000000001';
    const user={id:uid,aud:'authenticated',role:'authenticated',app_metadata:{provider:'google'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
    const session={access_token:'controlled-test-access',refresh_token:'controlled-test-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
    if(!sessionStorage.getItem('race-seeded')){
      localStorage.clear();sessionStorage.setItem('race-seeded','1');sessionStorage.setItem('race-exchanges','0');sessionStorage.setItem('race-navs','[]');
      if(mode!=='normal')localStorage.setItem('onboarding_completed','true');
      localStorage.setItem('roamie-auth-code-verifier',JSON.stringify('controlled-test-verifier'));
      if(mode==='consumed-no-session')sessionStorage.setItem('roamie:oauth-code-consumed','controlled-test-code');
      if(mode==='consumed'){localStorage.setItem('roamie-auth',JSON.stringify(session));sessionStorage.setItem('roamie:oauth-code-consumed','controlled-test-code');}
    }
    window.__raceRelease=null;
    const original=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const u=new URL(typeof input==='string'?input:input.url||String(input),location.href);
      if(u.origin===location.origin)return original(input,init);
      if(u.pathname==='/auth/v1/token'){
        sessionStorage.setItem('race-exchanges',String(Number(sessionStorage.getItem('race-exchanges'))+1));
        await new Promise(r=>window.__raceRelease=r);
        return new Response(JSON.stringify(mode==='failure'?{error:'invalid_grant',error_description:'controlled exchange failure'}:session),{status:mode==='failure'?400:200,headers:{'Content-Type':'application/json'}});
      }
      if(u.pathname==='/auth/v1/user')return Response.json(user);
      if(u.pathname.includes('/rest/v1/profiles'))return Response.json({id:uid,language:'en',auth_provider:'google',bio:'fixture',display_name:'fixture',ai_preferences:{}});
      return Response.json([]);
    };
    for(const name of ['pushState','replaceState']){const f=history[name];history[name]=function(...args){const next=new URL(args[2]||location.href,location.href).pathname;const events=JSON.parse(sessionStorage.getItem('race-navs'));events.push({from:location.pathname,to:next,persisted:!!localStorage.getItem('roamie-auth')});sessionStorage.setItem('race-navs',JSON.stringify(events));return f.apply(this,args)}}
  })()`;
      await call("Page.addScriptToEvaluateOnNewDocument", { source: injection });
      const route =
        mode === "normal"
          ? "/"
          : mode === "protected"
            ? "/saved"
            : "/auth/callback?code=controlled-test-code";
      await call("Page.navigate", { url: origin + route });
      async function until(expr, label) {
        for (let i = 0; i < 150; i++) {
          if (await evaluate(expr)) return;
          await wait(100);
        }
        assert.fail(label);
      }
      if (mode === "success" || mode === "failure") {
        await until("!!window.__raceRelease", "callback did not reach exchange");
        for (let i = 0; i < 5; i++) {
          await wait(100);
          assert.equal(
            await evaluate("location.pathname"),
            "/auth/callback",
            "startup stole delayed callback",
          );
        }
        assert.equal(await evaluate("Number(sessionStorage.getItem('race-exchanges'))"), 1);
        assert.equal(await evaluate("!!localStorage.getItem('roamie-auth-code-verifier')"), true);
        assert.equal(
          await evaluate(
            "JSON.parse(sessionStorage.getItem('race-navs')).some(x=>x.to!=='/auth/callback')",
          ),
          false,
        );
        await evaluate("window.__raceRelease();true");
        if (mode === "success") {
          await until(
            "location.pathname==='/' && !!localStorage.getItem('roamie-auth')",
            "success navigation missing",
          );
          const navs = await evaluate(
            "JSON.parse(sessionStorage.getItem('race-navs')).filter(x=>x.from==='/auth/callback'&&x.to!=='/auth/callback')",
          );
          // Full-document post-auth navigation does not call history; only count SPA departures.
          assert.equal(homeDocumentLoads, 1, "callback must navigate exactly once");
          assert.ok(navs.length <= 1);
          assert.ok(navs.every((x) => x.persisted));
          assert.equal(await evaluate("Number(sessionStorage.getItem('race-exchanges'))"), 1);
        } else {
          await until(
            "document.body.innerText.includes('controlled exchange failure')",
            "explicit error UI missing",
          );
          assert.equal(await evaluate("location.pathname"), "/auth/callback");
          await evaluate(
            "[...document.querySelectorAll('button')].find(b=>!b.disabled)?.click();true",
          );
          await until("location.pathname==='/login'", "failure retry cannot exit callback");
        }
      } else
        await until(
          mode === "consumed"
            ? "location.pathname==='/'"
            : mode === "normal"
              ? "location.pathname==='/welcome'"
              : "location.pathname==='/login'",
          mode + " navigation failed",
        );
      if (mode.startsWith("consumed"))
        assert.equal(await evaluate("Number(sessionStorage.getItem('race-exchanges'))"), 0);
      console.log("PASS", origin === origins[0] ? "production" : "candidate", mode);
      handlers.delete(sessionId);
      await send("Target.disposeBrowserContext", { browserContextId });
    }
  assert.deepEqual(interceptionErrors, [], "active test interception errors");
  console.log(
    "PASS actual production React/router callback cold boot, delayed exchange, persistence, explicit failure, consumed session, onboarding and protected routes; all external APIs mocked",
  );
} finally {
  ws?.close();
  chrome.kill();
}
