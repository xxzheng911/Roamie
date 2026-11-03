#!/usr/bin/env node
/**
 * SharedImageCropEditor ResizeObserver 去抖回歸（P1-T）— 真實 React render + 真實 ResizeObserver（headless Chrome）。
 * 執行：node scripts/verify-shared-image-crop-editor-resize.mjs [--baseline]
 * --baseline：以 HEAD 版元件執行，預期失敗（≤0.5px 變化仍 re-render）。
 *
 * 規格：sync 時四值（cropW/cropH/cropLeft/cropTop）與前一次相差皆 ≤0.5px → 不更新 state（不 commit）；
 * 遮罩 <8px 不更新；任一值變化 >0.5px 照常更新。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { build } from "esbuild";

const root = process.cwd();
const baseline = process.argv.includes("--baseline");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-crop-resize-"));

const mocks = {
  "@/hooks/use-i18n": `export const useI18n=()=>({t:k=>k,locale:'zh-TW'});`,
  "@/components/InlineImageCropViewport": `import React from 'react';
export const InlineImageCropViewport=React.forwardRef(function V(props,ref){
  window.__vpRenders.push(props.cropFrame?{...props.cropFrame}:null);
  React.useImperativeHandle(ref,()=>({isReady:()=>false,exportCrop:async()=>null}));
  return <div data-testid="vp" style={{width:'100%',height:'100%'}}/>;
});`,
};

const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {SharedImageCropEditor} from './src/components/media/SharedImageCropEditor';
window.__vpRenders=[];window.__commits=0;window.__roCallbacks=0;
const NativeRO=window.ResizeObserver;
window.ResizeObserver=class extends NativeRO{constructor(cb){super((entries,o)=>{window.__roCallbacks++;cb(entries,o)})}};
const css=document.createElement('style');
css.textContent='html{--mw:200px;--mh:120px} div[class*="9999px"]{width:var(--mw);height:var(--mh);display:block}';
document.head.appendChild(css);
const file=new File([new Uint8Array([1,2,3])],'a.png',{type:'image/png',lastModified:1});
const root=createRoot(document.getElementById('root'));
const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,30))));
const setSize=async(w,h)=>{document.documentElement.style.setProperty('--mw',w+'px');if(h!=null)document.documentElement.style.setProperty('--mh',h+'px');await raf();await raf();};
const snap=()=>({renders:window.__vpRenders.length,commits:window.__commits,ro:window.__roCallbacks,last:window.__vpRenders.at(-1)});
window.run=async()=>{
  root.render(<React.StrictMode><React.Profiler id="crop" onRender={()=>{window.__commits++}}>
    <SharedImageCropEditor open file={file} variant="cover" onOpenChange={()=>{}} onConfirm={()=>{}}/>
  </React.Profiler></React.StrictMode>);
  await raf();await raf();await raf();
  const out={};
  out.initial=snap();
  // 1) 次像素變化 0.3px → RO 觸發、sync 執行，但不得 commit
  await setSize(200.3);
  out.subpixel=snap();
  // 2) 再 +0.15（相對 state 累計 0.45）→ 仍不得 commit
  await setSize(200.45);
  out.subpixel2=snap();
  // 3) 相對 state 累計 0.75 >0.5 → 必須更新
  await setSize(200.75);
  out.drift=snap();
  // 4) 明顯變化 +20px → 更新
  await setSize(220.75);
  out.big=snap();
  // 5) 僅高度變化 >0.5 → 更新（四值任一）
  await setSize(220.75,121);
  out.heightOnly=snap();
  // 6) 遮罩 <8px → 不更新
  await setSize(5);
  out.tiny=snap();
  // 7) 從 tiny 回到與 state 相同尺寸 → 不更新
  await setSize(220.75);
  out.backSame=snap();
  root.unmount();
  return out;
};`;

await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  outfile: path.join(dir, "app.js"),
  format: "iife",
  logLevel: "error",
  loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
  define: {
    "import.meta.env.DEV": "false",
    "import.meta.env.VITE_VERBOSE_LOG": '"0"',
    "import.meta.env.VITE_DEBUG_DIAGNOSTICS": '"0"',
    "process.env.NODE_ENV": '"development"',
  },
  plugins: [
    {
      name: "crop-mocks",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (a.path in mocks ? { path: a.path, namespace: "mock" } : null));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: root }));
        if (baseline)
          b.onLoad({ filter: /[/\\]SharedImageCropEditor\.tsx$/ }, () => ({
            contents: execFileSync("git", ["show", "HEAD:src/components/media/SharedImageCropEditor.tsx"], { encoding: "utf8" }),
            loader: "tsx",
            resolveDir: path.join(root, "src/components/media"),
          }));
      },
    },
  ],
});

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/app.js" ? "application/javascript" : "text/html");
  res.end(req.url === "/app.js" ? fs.readFileSync(path.join(dir, "app.js")) : '<!doctype html><div id="root"></div><script src="/app.js"></script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const chrome = spawn(
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", "--window-size=800,900", "--user-data-dir=" + path.join(dir, "chrome"), "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
let out;
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
  const { sessionId } = await send("Target.attachToTarget", { targetId: targetInfos.find((t) => t.type === "page").targetId, flatten: true });
  await send("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + "/" }, sessionId);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const r = await send("Runtime.evaluate", { expression: 'typeof window.run === "function"', returnByValue: true }, sessionId);
    if (r.result.value) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(ready, "browser harness loaded");
  const result = await send("Runtime.evaluate", { expression: "window.run()", awaitPromise: true, returnByValue: true }, sessionId);
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  out = result.result.value;
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}

console.log(JSON.stringify(out, null, 1));
const { initial, subpixel, subpixel2, drift, big, heightOnly, tiny, backSame } = out;
assert.ok(initial.last && Math.abs(initial.last.cropW - 200) < 0.01, "初始 cropFrame 由遮罩量測（200px）");
assert.equal(Math.round(initial.last.cropH), 120);

assert.ok(subpixel.ro > initial.ro, "0.3px 變化必須觸發 ResizeObserver（否則測試無效）");
assert.equal(subpixel.commits, initial.commits, "≤0.5px：不得 commit（不 re-render）");
assert.equal(subpixel.renders, initial.renders, "≤0.5px：子元件不得 re-render");

assert.ok(subpixel2.ro > subpixel.ro, "第二次次像素變化必須觸發 ResizeObserver");
assert.equal(subpixel2.commits, initial.commits, "累計 0.45px 仍 ≤0.5：不得 commit");

assert.ok(drift.commits > subpixel2.commits, "相對 state 累計 >0.5px：必須更新");
assert.ok(Math.abs(drift.last.cropW - 200.75) < 0.01, "更新後 cropW 為最新量測值");

assert.ok(big.commits > drift.commits && Math.abs(big.last.cropW - 220.75) < 0.01, ">0.5px 照常更新");
assert.ok(heightOnly.commits > big.commits && Math.abs(heightOnly.last.cropH - 121) < 0.01, "單一值（高度）變化 >0.5 也更新");

assert.ok(tiny.ro > heightOnly.ro, "縮到 5px 必須觸發 ResizeObserver");
assert.equal(tiny.commits, heightOnly.commits, "遮罩 <8px：不更新");
assert.ok(Math.abs(tiny.last.cropW - 220.75) < 0.01, "遮罩 <8px：cropFrame 維持前值");

assert.ok(backSame.ro > tiny.ro);
assert.equal(backSame.commits, tiny.commits, "回到與 state 相同尺寸：不更新");

console.log(`PASS SharedImageCropEditor ResizeObserver sub-pixel dedupe${baseline ? " [baseline?! expected failure]" : ""}`);
