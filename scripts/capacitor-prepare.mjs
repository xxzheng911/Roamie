#!/usr/bin/env node
/**
 * Post-build step for Capacitor iOS/Android:
 * - bundled（TestFlight / Release）：從 TanStack Start manifest 產生可離線啟動的 index.html
 * - dev / remote：僅提示 WebView 將使用 server.url（由 capacitor.config 決定）
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const splashCriticalCssPath = resolve(root, "scripts/capacitor-splash-critical.css");
const clientDir = resolve(root, "dist/client");
const assetsDir = resolve(clientDir, "assets");
const indexPath = resolve(clientDir, "index.html");
const envPath = resolve(root, ".env");

function readEnv(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(envPath)) return undefined;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return undefined;
}

function envFlag(key) {
  const raw = process.env[key] ?? readEnv(key);
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Release / bundled：預設靜默 boot 診斷；失敗仍 console.error。Override: ROAMIE_VERBOSE_BOOT=1 */
const quietBoot =
  !envFlag("ROAMIE_VERBOSE_BOOT") &&
  (process.env.NODE_ENV === "production" || envFlag("ROAMIE_QUIET_BOOT"));

const CAPACITOR_BOOT_LOG_HELPER = `<script>
window.__ROAMIE_BOOT_LOG__={
  quiet:${quietBoot ? "true" : "false"},
  verbose:function(){try{return localStorage.getItem("roamie:boot-diagnostics")==="1";}catch(_){return false;}},
  log:function(msg,critical){
    var s=String(msg||"");
    if(s.indexOf("[APP_BOOT]")>=0||s.indexOf("[ONBOARDING_GUARD]")>=0||s.indexOf("REAL ENTRY")>=0){
      console.log(s);
      return;
    }
    if(critical||this.verbose()||!this.quiet)console.error(s);
  }
};
</script>`;

/** 最早執行：在 React bundle 之前；Xcode 必須看得到才算改對入口 */
const CAPACITOR_REAL_ENTRY_PROBE = `<script>
console.log("[APP_BOOT] REAL ENTRY FILE LOADED: dist/client/index.html");
console.log("[APP_BOOT] boot-trace loaded (index.html inline)");
try{
  if(window.Capacitor&&typeof window.Capacitor.getPlatform==="function"){
    console.log("[APP_BOOT] platform:",window.Capacitor.getPlatform());
  }
}catch(_){}
</script>`;

function findClientEntryFromManifest() {
  const serverAssets = resolve(root, "dist/server/assets");
  if (!existsSync(serverAssets)) return null;

  const manifestFile = readdirSync(serverAssets).find((f) =>
    f.startsWith("_tanstack-start-manifest_v-"),
  );
  if (!manifestFile) return null;

  const text = readFileSync(join(serverAssets, manifestFile), "utf8");
  const match = text.match(/clientEntry:\s*"(\/assets\/[^"]+)"/);
  return match?.[1]?.replace(/^\//, "") ?? null;
}

/** Capacitor WebView：使用 `./assets/*` 避免 `/assets/*` 在部分 scheme 下載入失敗 */
function toRelativeAssetHref(assetPath) {
  const rel = assetPath.startsWith("assets/") ? assetPath : `assets/${assetPath}`;
  return `./${rel}`;
}

/** 從 client entry 收集 Vite 實際引用的 chunk（含 index-*.js 懶加載，勿誤刪） */
function collectReferencedAssetFiles(entryRelPath) {
  const keep = new Set();
  const entryName = entryRelPath.replace(/^assets\//, "");
  keep.add(entryName);

  const entryPath = join(assetsDir, entryName);
  if (existsSync(entryPath)) {
    const code = readFileSync(entryPath, "utf8");
    for (const m of code.matchAll(/import\("\.\/([^"]+)"\)/g)) {
      keep.add(m[1]);
    }
    for (const m of code.matchAll(/"assets\/([A-Za-z0-9_.-]+\.js)"/g)) {
      keep.add(m[1]);
    }
  }

  const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  for (const m of indexHtml.matchAll(/(?:\.\/|\/)(assets\/[A-Za-z0-9_.-]+)/g)) {
    keep.add(m[1].replace(/^assets\//, ""));
  }

  return keep;
}

/**
 * 僅移除「舊的主 entry」index-*.js（體積大、且未被 entry 引用）。
 * 不可刪除 Vite code-split 的 index-*.js 小 chunk（@capacitor/* 等），否則 iOS 會
 * TypeError: Importing a module script failed。
 */
function pruneOrphanClientAssets(entryRelPath) {
  if (!existsSync(assetsDir)) return;
  const keep = collectReferencedAssetFiles(entryRelPath);
  const entryName = entryRelPath.replace(/^assets\//, "");

  let removed = 0;
  for (const f of readdirSync(assetsDir)) {
    if (!f.endsWith(".js")) continue;
    if (!f.startsWith("index-") || f === entryName || keep.has(f)) continue;
    const size = statSync(join(assetsDir, f)).size;
    // 主 bundle ~400KB；小於此的 index-*.js 為 lazy chunk，一律保留
    if (size < 200_000) continue;
    rmSync(join(assetsDir, f), { force: true });
    removed += 1;
  }
  if (removed > 0) {
    console.info(`[capacitor-prepare] Pruned ${removed} stale main index-*.js from dist/client/assets`);
  }
}

function findMainStylesheet() {
  if (!existsSync(assetsDir)) return null;
  const cssFiles = readdirSync(assetsDir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => ({
      name: f,
      size: statSync(join(assetsDir, f)).size,
    }))
    .sort((a, b) => b.size - a.size);
  if (cssFiles.length === 0) return null;
  return `assets/${cssFiles[0].name}`;
}

/**
 * TanStack Start client expects window.$_TSR from SSR. Capacitor bundled HTML has no SSR shell.
 * manifest MUST include `routes: {}` — HeadContent does manifest?.routes[routeId]; empty {} crashes.
 * Keep in sync with src/lib/ssr-manifest.ts buildCapacitorTsrBootstrapScript().
 */
/** 必須在 <head> 最前面 — Release 用 meta probe，避免洗版 */
const CAPACITOR_INDEX_HTML_PROBE = quietBoot
  ? `<meta name="roamie-probe" content="INDEX_HTML_LOADED" />`
  : `<script>
try { console.error("INDEX_HTML_LOADED"); } catch (_) {}
</script>`;

/** body 內 #root 後立即執行 — 早於 module 下載 */
const CAPACITOR_BODY_ROOT_SHELL = `<script>
(function(){
  var root=document.getElementById("root");
  if(!root||root.childElementCount>0)return;
  root.setAttribute("data-roamie-boot-shell","1");
  root.innerHTML='<div class="roamie-splash" role="status" aria-live="polite" aria-busy="true"><div class="roamie-splash__gradient" aria-hidden="true"></div><div class="roamie-splash__viewport"><div class="roamie-splash__content roamie-splash__content--fade-in"><h1 class="roamie-splash__brand">Roamie</h1><p class="roamie-splash__tagline">Less planning, more wandering.</p><div class="roamie-splash__loader" aria-label="載入中"><span class="roamie-splash__loader-dot"></span><span class="roamie-splash__loader-dot"></span><span class="roamie-splash__loader-dot"></span></div></div></div></div>';
  window.__ROAMIE_BOOT__={phase:"html-shell",t0:Date.now()};
})();
</script>`;

/** 與 src/lib/log-error.ts buildCapacitorEarlyErrorLogScript() 同步 */
const CAPACITOR_EARLY_ERROR_LOG = `<script>
(function(){
  function isMapsSdkNoise(text) {
    if (!text) return false;
    return /sdkError\\.sessionStatus/i.test(text)
      || /Evaluating ['"]?[^'"]*sdkError/i.test(text)
      || /Google Maps JavaScript API error/i.test(text)
      || /InvalidKeyMapError/i.test(text)
      || /RefererNotAllowedMapError/i.test(text);
  }
  function isAmbiguousWebKitUndefined(e, reason) {
    if ((e.message || "") !== "undefined") return false;
    if (e.error != null && reason && reason.message && reason.message !== "undefined") return false;
    var f = e.filename || "";
    if (f.indexOf("maps.googleapis.com") >= 0) return true;
    if (!document.querySelector('script[data-roamie-maps="1"]')) return false;
    return f.indexOf("/assets/index-") >= 0
      || f.indexOf("capacitor://localhost/assets/index-") >= 0;
  }
  function roamieLog(tag, reason, source) {
    var msg = "(unknown)";
    var stack = "";
    if (reason instanceof Error) {
      msg = reason.message || String(reason);
      stack = reason.stack || "";
    } else if (reason && typeof reason === "object" && reason.message) {
      msg = String(reason.message);
      stack = reason.stack ? String(reason.stack) : "";
    } else if (reason != null) {
      msg = String(reason);
    }
    try {
      console.error(tag + " " + msg + (stack ? " stack=" + stack : "") + (source ? " source=" + source : ""));
    } catch (_) {}
  }
  function roamieBootLog(msg, critical) {
    if (window.__ROAMIE_BOOT_LOG__) window.__ROAMIE_BOOT_LOG__.log(msg, critical);
  }
  window.addEventListener("error", function(e) {
    if (e.target && e.target.tagName === "SCRIPT") {
      roamieLog("APP_SCRIPT_LOAD_ERROR", e.message || "script failed", e.filename || "script");
      return;
    }
    var reason = e.error;
    if (reason == null) {
      var msg = (e.message || "").trim();
      reason = msg
        ? new Error(msg)
        : new Error(
            "runtime@" + (e.filename || "unknown") + ":" + (e.lineno || 0) + ":" + (e.colno || 0),
          );
    }
    var line = (e.message || "") + " " + (reason && reason.message ? reason.message : "");
    if (isMapsSdkNoise(line) || isAmbiguousWebKitUndefined(e, reason)) {
      try {
        window.__roamieMapsAuthFailure = { message: "Google 地圖無法載入（Maps JS 授權）" };
        console.info("[MAP_FALLBACK] reason=maps_js_sdk_error (early)");
      } catch (_) {}
      return;
    }
    roamieLog("APP_INIT_ERROR", reason, e.filename || "");
  }, true);
  window.addEventListener("unhandledrejection", function(e) {
    var reason = e.reason;
    if (reason == null) reason = new Error("unhandled rejection (reason was undefined)");
    var rejLine = reason instanceof Error ? reason.message : String(reason);
    if (isMapsSdkNoise(rejLine)) return;
    roamieLog("APP_UNHANDLED_REJECTION", reason, "promise");
  });
  try {
    roamieBootLog(
      "ROAMIE_BOOT_START href=" + location.href +
      " tsr=" + Boolean(window.$_TSR) +
      " build=" + (document.querySelector('meta[name="roamie-build"]')?.content || "?"),
      false
    );
  } catch (_) {}
  window.__ROAMIE_BOOT__ = { phase: "html", t0: Date.now() };
  [1000, 3000, 6000, 12000].forEach(function(ms) {
    setTimeout(function() {
      var b = window.__ROAMIE_BOOT__ || {};
      try {
        var rootN = document.getElementById("root")?.childElementCount || 0;
        var line =
          "ROAMIE_BOOT_TICK @" + ms + "ms phase=" + (b.phase || "?") +
          " rootChildren=" + rootN +
          (b.error ? " err=" + b.error : "");
        if (ms >= 12000 && rootN === 0) roamieBootLog(line, true);
        else if (window.__ROAMIE_BOOT_LOG__ && window.__ROAMIE_BOOT_LOG__.verbose()) console.log(line);
      } catch (_) {}
    }, ms);
  });
  setTimeout(function() {
    var boot = document.getElementById("roamie-static-boot");
    var staticBootVisible = boot && !boot.hasAttribute("hidden");
    var root = document.getElementById("root");
    var rootChildren = root ? root.childElementCount : 0;
    var links = Array.prototype.slice.call(document.querySelectorAll('link[rel="stylesheet"]'));
    var hrefs = links.map(function(l) { return l.getAttribute("href"); }).join(",");
    var bootSplash = document.getElementById("roamie-boot-splash");
    var splash = bootSplash || document.querySelector(".roamie-splash");
    var path = location.pathname.replace(/\\/+$/, "") || "/";
    roamieBootLog(
      "ROAMIE_BOOT_CHECK pathname=" + path +
      " staticBoot=" + staticBootVisible +
      " bootSplash=" + Boolean(bootSplash) +
      " splash=" + Boolean(splash) +
      " rootChildren=" + rootChildren +
      " stylesheets=" + (hrefs || "none"),
      false
    );
    if (staticBootVisible) {
      roamieBootLog("ROAMIE_BOOT_CHECK React 可能未掛載（仍顯示靜態占位）", true);
    } else {
      var hasUi =
        rootChildren > 0 ||
        bootSplash != null ||
        document.querySelector("nav,main,[role=main],button,a[href],.roamie-splash") != null;
      if (!hasUi) {
        roamieBootLog(
          "ROAMIE_BOOT_CHECK 白屏 pathname=" + path + " — 請搜尋 APP_INIT_ERROR / APP_SCRIPT_LOAD_ERROR",
          true
        );
      } else if (bootSplash && rootChildren === 0) {
        roamieBootLog(
          "ROAMIE_BOOT_CHECK 等待 JS（仍顯示啟動畫面 pathname=" + path + "）",
          true
        );
      } else {
        roamieBootLog(
          "ROAMIE_BOOT_CHECK OK — 已離開冷啟動（pathname=" + path + "）",
          false
        );
      }
    }
  }, 6000);
})();
</script>`;

/**
 * 必須在 #root 外：createRoot 會清空 #root，router 初始化完成前會白屏。
 * 與 RoamieSplashScreen 共用 class；React 首屏後由 removeStaticBootPlaceholder() 移除。
 */
const CAPACITOR_BOOT_SPLASH = `<div id="roamie-boot-splash" class="roamie-splash" role="status" aria-live="polite" aria-busy="true">
      <div class="roamie-splash__gradient" aria-hidden="true"></div>
      <div class="roamie-splash__viewport">
        <div class="roamie-splash__content roamie-splash__content--fade-in">
          <div class="roamie-splash__wordmark">
            <h1 class="roamie-splash__brand">Roamie</h1>
            <p class="roamie-splash__tagline">Less planning, more wandering.</p>
          </div>
          <div class="roamie-splash__loader" aria-label="載入中">
            <span class="roamie-splash__loader-dot"></span>
            <span class="roamie-splash__loader-dot"></span>
            <span class="roamie-splash__loader-dot"></span>
          </div>
        </div>
      </div>
    </div>`;

function readSplashCriticalCss() {
  if (!existsSync(splashCriticalCssPath)) return "";
  return readFileSync(splashCriticalCssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").trim();
}

const CAPACITOR_PATH_NORMALIZE = `<script>
(function(){
  var p=location.pathname.replace(/\\/+$/, "") || "/";
  var q=location.search||"";
  var h=location.hash||"";
  var legacy={"/loading":1,"/intro":1,"/splash":1};
  if(p==="/onboarding"){
    console.log("[ONBOARDING_GUARD] boot redirect to onboarding (inline /onboarding)");
    history.replaceState(history.state,"","/welcome"+q+h);
    return;
  }
  if(p===""||p==="/"||p==="/index.html"||p.endsWith("/index.html")||legacy[p]){
    history.replaceState(history.state,"","/"+q+h);
    p="/";
  }
  function hasOnboardingCompleted(){
    try{
      if(localStorage.getItem("onboarding_completed")==="true")return true;
      return false;
    }catch(e){return false;}
  }
  function hasSession(){
    try{
      var raw=localStorage.getItem("roamie-auth");
      if(!raw)return false;
      var j=JSON.parse(raw);
      return Boolean(j&&j.access_token);
    }catch(e){return false;}
  }
  if(location.search.indexOf("code=")>=0&&p!=="/auth/callback"){
    history.replaceState(history.state,"","/auth/callback"+q+h);
    return;
  }
  if(p==="/auth/callback"||location.search.indexOf("code=")>=0)return;
  if(p.startsWith("/auth/"))return;
  if(p==="/welcome"||p==="/login"||p==="/trip"||p.indexOf("/login/")===0)return;
  if(!hasOnboardingCompleted()){
    if(p!=="/welcome"){
      console.log("[ONBOARDING_GUARD] boot redirect to onboarding (inline)");
      history.replaceState(history.state,"","/welcome"+q+h);
    }
    return;
  }
  var target="/";
  if(!hasSession())target="/login";
  if(p!==target){
    if(target==="/"){
      console.log("[ONBOARDING_GUARD] blocked home redirect (inline -> login)");
    }
    history.replaceState(history.state,"",target+q+h);
  }
})();
</script>`;

const TSR_SPA_BOOTSTRAP = `<script>
self.$_TSR={
  h(){this.hydrated=!0;this.c()},
  e(){this.streamEnded=!0;this.c()},
  c(){
    if(this.hydrated&&this.streamEnded){
      try{delete self.$_TSR}catch(_){}
      try{self.$R&&delete self.$R.tsr}catch(_){}
    }
  },
  p(fn){this.initialized?fn():this.buffer.push(fn)},
  buffer:[],
  router:{manifest:{routes:{}},matches:[],dehydratedData:void 0,lastMatchId:""}
};
self.$_TSR.e();
</script>`;

/** 露出 HTML boot splash；勿等 React（否則長時間只顯示原生 splash / 白底） */
/** Do not call SplashScreen from index.html — bridge is not ready and triggers native JS Eval on iOS 26. */
const CAPACITOR_HIDE_NATIVE_SPLASH = `<script>
(function(){
  try{
    if(window.__ROAMIE_BOOT_LOG__)window.__ROAMIE_BOOT_LOG__.log("ROAMIE_INDEX_HTML_LOADED",false);
  }catch(_){}
})();
</script>`;

/** Capacitor 無 SSR HTML；hydrateRoot(document) 會觸發 React #418 */
function patchClientBundleForCapacitorSpa(entryRelPath) {
  const entryPath = resolve(clientDir, entryRelPath);
  let code = readFileSync(entryPath, "utf8");
  const hydrateDoc = ".hydrateRoot(document,";
  const createRootDoc = ".createRoot(document).render(";
  const mount = `.createRoot(document.getElementById("root") ?? document.body).render(`;

  let changed = false;

  if (code.includes(hydrateDoc)) {
    code = code.replaceAll(hydrateDoc, mount);
    changed = true;
  }

  if (code.includes(createRootDoc)) {
    code = code.replaceAll(createRootDoc, mount);
    changed = true;
  }

  if (!changed) {
    console.info("[capacitor-prepare] client bundle already uses createRoot with safe container");
    return;
  }

  writeFileSync(entryPath, code, "utf8");
  console.info("[capacitor-prepare] Patched router mount container for Capacitor SPA");
}

/** bundle 第一行 marker — Release 走 __ROAMIE_BOOT_LOG__，Debug 仍可 verbose */
const CAPACITOR_BUNDLE_SHELL_PREFIX = `(function(){try{console.log("[APP_BOOT] REAL ENTRY FILE LOADED: client-bundle");console.log("[APP_BOOT] boot-trace loaded");if(window.__ROAMIE_BOOT_LOG__)window.__ROAMIE_BOOT_LOG__.log("MAIN_TSX_LOADED",true);}catch(_){}})();
(function(){
  var root=document.getElementById("root");
  if(!root||root.childElementCount>0)return;
  if(root.getAttribute("data-roamie-boot-shell"))return;
  root.setAttribute("data-roamie-boot-shell","1");
  root.innerHTML='<div class="roamie-splash" role="status" aria-busy="true"><div class="roamie-splash__viewport"><h1 class="roamie-splash__brand">Roamie</h1></div></div>';
})();
`;

/** 極小 bootstrap：HTML shell 已顯示 UI；idle 後再載入主 bundle（勿單獨 import vendor chunk） */
function writeCapacitorBootstrapLoader(clientEntryRel) {
  const minimal =
    process.env.ROAMIE_MINIMAL_BOOT === "1" ||
    process.env.ROAMIE_MINIMAL_BOOT === "true";
  const entryFile = clientEntryRel.replace(/^assets\//, "");
  const bootstrapPath = join(assetsDir, "capacitor-bootstrap.js");
  const loader = minimal
    ? `(function(){if(window.__ROAMIE_BOOT_LOG__)window.__ROAMIE_BOOT_LOG__.log("CAPACITOR_BOOTSTRAP_LOADED",false);})();
(function(){
  try{if(window.__ROAMIE_BOOT_LOG__)window.__ROAMIE_BOOT_LOG__.log("ROAMIE_MINIMAL_BOOT enabled",false);}catch(_){}
  var root=document.getElementById("root");
  if(!root)return;
  root.innerHTML='<div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#fdf5ea;color:#2a2520;font:16px system-ui,sans-serif;padding:24px;box-sizing:border-box"><div style="text-align:center"><div style="font:600 28px ui-serif,Georgia,serif;letter-spacing:-0.02em">Roamie</div><div style="margin-top:10px;color:#6b635c">Minimal boot test (no Router / Providers)</div></div></div>';
  var b=window.__ROAMIE_BOOT__||{t0:Date.now()};b.phase="minimal-static";window.__ROAMIE_BOOT__=b;
})();\n`
    : `(function(){if(window.__ROAMIE_BOOT_LOG__)window.__ROAMIE_BOOT_LOG__.log("CAPACITOR_BOOTSTRAP_LOADED",false);})();
(function(){
  var root=document.getElementById("root");
  if(!root||root.childElementCount>0)return;
  if(root.getAttribute("data-roamie-boot-shell"))return;
  root.setAttribute("data-roamie-boot-shell","1");
  root.innerHTML='<div class="roamie-splash" role="status" aria-live="polite" aria-busy="true"><div class="roamie-splash__gradient" aria-hidden="true"></div><div class="roamie-splash__viewport"><div class="roamie-splash__content"><h1 class="roamie-splash__brand">Roamie</h1><p class="roamie-splash__tagline">Less planning, more wandering.</p><div class="roamie-splash__loader" aria-label="載入中"><span class="roamie-splash__loader-dot"></span><span class="roamie-splash__loader-dot"></span><span class="roamie-splash__loader-dot"></span></div></div></div></div>';
  var b=window.__ROAMIE_BOOT__||{t0:Date.now()};b.phase="bootstrap-shell";window.__ROAMIE_BOOT__=b;
})();
function loadMainBundle(){
  import("./${entryFile}").then(function(){
    try{if(window.__ROAMIE_BOOT_LOG__)window.__ROAMIE_BOOT_LOG__.log("CAPACITOR_APP_BUNDLE_LOADED",false);}catch(_){}
    var b=window.__ROAMIE_BOOT__||{};b.import="ok";b.phase="app-bundle";window.__ROAMIE_BOOT__=b;
  }).catch(function(e){
    try{if(window.__ROAMIE_BOOT_LOG__)window.__ROAMIE_BOOT_LOG__.log("CAPACITOR_APP_BUNDLE_FAILED "+String(e&&e.message||e),true);}catch(_){}
    var b=window.__ROAMIE_BOOT__||{};b.import="failed";b.error=String(e&&e.message||e);window.__ROAMIE_BOOT__=b;
  });
}
function scheduleMain(){
  if(typeof requestIdleCallback==="function"){requestIdleCallback(loadMainBundle,{timeout:1500});}
  else{setTimeout(loadMainBundle,120);}
}
function startBootstrap(){
  scheduleMain();
}
if(typeof requestAnimationFrame==="function"){
  requestAnimationFrame(function(){requestAnimationFrame(startBootstrap);});
}else{
  setTimeout(startBootstrap,0);
}
`;
  writeFileSync(bootstrapPath, loader, "utf8");
  console.info(
    "[capacitor-prepare] Wrote assets/capacitor-bootstrap.js →" +
      (minimal ? " minimal-static (no import)" : ` ${entryFile}`),
  );
  return "assets/capacitor-bootstrap.js";
}

function patchBundleBootTrace(entryRelPath) {
  const entryPath = resolve(clientDir, entryRelPath);
  let code = readFileSync(entryPath, "utf8");
  if (code.includes("MAIN_TSX_LOADED") && code.includes("data-roamie-boot-shell")) {
    console.info("[capacitor-prepare] bundle boot trace already present");
    return;
  }
  code = `${CAPACITOR_BUNDLE_SHELL_PREFIX}${code}`;
  writeFileSync(entryPath, code, "utf8");
  console.info("[capacitor-prepare] Prepended MAIN_TSX_LOADED + dom shell to client bundle");
}

/** router bootstrap 使用 use(promise)；在 Suspense 完成前避免清空 #root 後白屏 */
function patchClientRouterSuspense(entryRelPath) {
  const entryPath = resolve(clientDir, entryRelPath);
  let code = readFileSync(entryPath, "utf8");
  const re =
    /\.render\((\w+)\.jsx\((\w+)\.StrictMode,\{children:\1\.jsx\((\w+),\{\}\)\}\)\)/;
  if (!re.test(code)) {
    console.info("[capacitor-prepare] router Suspense patch skipped (pattern not found)");
    return;
  }
  code = code.replace(
    re,
    `.render($1.jsx($2.StrictMode,{children:$1.jsx($2.Suspense,{fallback:$1.jsx("div",{className:"roamie-splash",role:"status","aria-busy":"true",children:$1.jsx("div",{className:"roamie-splash__viewport",children:$1.jsx("p",{className:"roamie-splash__brand",children:"Roamie"})})}),children:$1.jsx($3,{})})}))`,
  );
  writeFileSync(entryPath, code, "utf8");
  console.info("[capacitor-prepare] Patched router bootstrap Suspense fallback");
}

/** 主 bundle 結尾 reuse 已存在的 _capRoot（capacitor-mount.js 先 mount） */
function patchClientBundleCreateRootReuse(entryRelPath) {
  const entryPath = resolve(clientDir, entryRelPath);
  let code = readFileSync(entryPath, "utf8");
  const re = /(\w+)\.createRoot\(document\.getElementById\("root"\)\s*\?\?\s*document\.body\)\.render\(/;
  if (!re.test(code)) {
    console.warn("[capacitor-prepare] createRoot reuse patch skipped (pattern not found)");
    return;
  }
  if (code.includes("_capRoot")) {
    console.info("[capacitor-prepare] createRoot reuse patch already present");
    return;
  }
  code = code.replace(
    re,
    '(function(){var _el=document.getElementById("root")??document.body;if(_el._capRoot)return _el._capRoot;var _r=$1.createRoot(_el);_el._capRoot=_r;return _r;})().render(',
  );
  writeFileSync(entryPath, code, "utf8");
  console.info("[capacitor-prepare] Patched createRoot to reuse capacitor-mount root");
}

function writeBundledIndexHtml({ clientEntry, bootstrapEntry, stylesheet }) {
  const appOrigin = readEnv("VITE_APP_ORIGIN")?.replace(/\/$/, "");
  if (!appOrigin) {
    console.warn(
      "[capacitor-prepare] VITE_APP_ORIGIN 未設定 — TestFlight 將無法使用 AI /api；請在 .env 設定 HTTPS 正式網域後重新 build",
    );
  } else if (/localhost|127\.0\.0\.1/i.test(appOrigin)) {
    console.warn(
      `[capacitor-prepare] VITE_APP_ORIGIN=${appOrigin} 為 localhost，實機/TestFlight 無法連線`,
    );
  }
  const apiOriginMeta = appOrigin
    ? `\n    <meta name="roamie-api-origin" content="${appOrigin.replace(/"/g, "&quot;")}" />`
    : "";
  const ultraMinimal =
    process.env.ROAMIE_ULTRA_MINIMAL_HTML === "1" ||
    process.env.ROAMIE_ULTRA_MINIMAL_HTML === "true";
  const scriptRel = toRelativeAssetHref(clientEntry);
  const bootstrapRel = bootstrapEntry ? toRelativeAssetHref(bootstrapEntry) : scriptRel;
  const cssRel = stylesheet ? toRelativeAssetHref(stylesheet) : null;
  const cssLink = cssRel
    ? `\n    <link rel="preload" href="${cssRel}" as="style" />\n    <link rel="stylesheet" href="${cssRel}" />`
    : "";
  const splashCriticalCss = readSplashCriticalCss();
  /** 先載入極小 bootstrap（dynamic import 主 bundle），避免單一 400KB module 阻塞 createRoot */
  const mainBundleScript = `<script>
(function(){
  if (window.__ROAMIE_BOOT_LOG__) {
    window.__ROAMIE_BOOT_LOG__.log("INDEX_HTML_BEFORE_MODULE bootstrap=${bootstrapRel} app=${scriptRel}", false);
  }
})();
</script>
<script type="module" src="${bootstrapRel}"></script>
<script>
(function(){
  if (window.__ROAMIE_BOOT_LOG__) window.__ROAMIE_BOOT_LOG__.log("INDEX_HTML_AFTER_MODULE_TAG", false);
})();
</script>`;

  if (ultraMinimal) {
    writeFileSync(
      indexPath,
      `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    <meta name="roamie-probe" content="INDEX_HTML_LOADED" />
    <title>Roamie Boot Test</title>
    <style>
      html,body{margin:0;min-height:100%;background:#fdf5ea;color:#2a2520}
      #root{min-height:100dvh;display:flex;align-items:center;justify-content:center;font:16px system-ui,sans-serif;padding:24px;box-sizing:border-box;text-align:center}
      .t{font:600 28px ui-serif,Georgia,serif;letter-spacing:-0.02em}
      .s{margin-top:10px;color:#6b635c}
    </style>
  </head>
  <body>
    <div id="root">
      <div>
        <div class="t">Roamie</div>
        <div class="s">Ultra minimal HTML test (no scripts)</div>
      </div>
    </div>
  </body>
</html>
`,
      "utf8",
    );
    console.info("[capacitor-prepare] ROAMIE_ULTRA_MINIMAL_HTML enabled (no scripts)");
    return;
  }

  writeFileSync(
    indexPath,
    `<!DOCTYPE html>
<html lang="zh-Hant" class="roamie-app">
  <head>
    ${CAPACITOR_REAL_ENTRY_PROBE}
    ${CAPACITOR_BOOT_LOG_HELPER}
    ${CAPACITOR_INDEX_HTML_PROBE}
    <base href="./" />
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    <meta name="theme-color" content="#f7f4ef" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <title>Roamie｜你的慢旅行夥伴</title>
    <meta name="roamie-build" content="${new Date().toISOString()}" />${apiOriginMeta}${cssLink}
    <style>html,body{background-color:#f7f4ef;color:#2a2520;margin:0;min-height:100%}</style>
    ${splashCriticalCss ? `<style>${splashCriticalCss}</style>` : ""}
  </head>
  <body class="roamie-body antialiased">
    <div id="roamie-static-boot" hidden aria-hidden="true"></div>
    ${CAPACITOR_BOOT_SPLASH}
    <div id="root"></div>
    ${CAPACITOR_BODY_ROOT_SHELL}
    ${CAPACITOR_HIDE_NATIVE_SPLASH}
    ${CAPACITOR_EARLY_ERROR_LOG}
    ${CAPACITOR_PATH_NORMALIZE}
    ${TSR_SPA_BOOTSTRAP}
    ${mainBundleScript}
    <script>
(function(){
  setTimeout(function(){
    var boot=document.getElementById("roamie-static-boot");
    if(!boot||boot.hasAttribute("hidden"))return;
    if(!document.getElementById("roamie-boot-splash")&&!document.querySelector(".roamie-splash")){
      boot.removeAttribute("hidden");
      boot.setAttribute("style","min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#f7f4ef;font:15px system-ui,sans-serif;color:#6b635c");
      boot.textContent="Roamie 啟動較久，請稍候…";
    }
  },8000);
})();
</script>
  </body>
</html>
`,
    "utf8",
  );
}

function writeDevPlaceholderIndexHtml() {
  const splashCriticalCss = readSplashCriticalCss();
  writeFileSync(
    indexPath,
    `<!DOCTYPE html>
<html lang="zh-Hant" class="roamie-app">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#f7f4ef" />
    <title>Roamie</title>
    <style>html,body{margin:0;min-height:100%;background:#f7f4ef;color:#2a2520}</style>
    ${splashCriticalCss ? `<style>${splashCriticalCss}</style>` : ""}
  </head>
  <body class="roamie-body">
    <div class="roamie-splash" role="status" aria-live="polite">
      <div class="roamie-splash__gradient" aria-hidden="true"></div>
      <div class="roamie-splash__viewport">
        <div class="roamie-splash__content">
          <div class="roamie-splash__wordmark">
            <h1 class="roamie-splash__brand">Roamie</h1>
            <p class="roamie-splash__tagline">連線開發伺服器中…</p>
          </div>
          <div class="roamie-splash__loader" aria-label="載入中">
            <span class="roamie-splash__loader-dot"></span>
            <span class="roamie-splash__loader-dot"></span>
            <span class="roamie-splash__loader-dot"></span>
          </div>
          <p style="margin:1.25rem 0 0;font:14px/1.5 system-ui,sans-serif;color:#6b635c;max-width:18rem">
            請先執行 <strong>npm run ios:sim</strong>（或 <code>npm run dev</code>）再從 Xcode Run。
          </p>
        </div>
      </div>
    </div>
  </body>
</html>
`,
    "utf8",
  );
}

if (!existsSync(clientDir)) {
  console.error("[capacitor-prepare] dist/client not found — run: npm run build");
  process.exit(1);
}

const liveReload = envFlag("CAPACITOR_LIVE_RELOAD");
const useRemoteServer = envFlag("CAPACITOR_USE_REMOTE_SERVER");
const devUrl = liveReload ? readEnv("CAPACITOR_DEV_SERVER_URL") : undefined;
const prodUrl = useRemoteServer
  ? (readEnv("CAPACITOR_SERVER_URL") ?? readEnv("VITE_APP_ORIGIN"))
  : undefined;
const liveUrl = devUrl ?? prodUrl;

if (liveUrl) {
  writeDevPlaceholderIndexHtml();
  console.info(`[capacitor-prepare] dev/remote mode — placeholder index.html`);
  console.info(`[capacitor-prepare] WebView server.url = ${liveUrl}`);
  process.exit(0);
}

const clientEntry = findClientEntryFromManifest();
if (!clientEntry) {
  console.error(
    "[capacitor-prepare] 找不到 TanStack Start clientEntry — 請先執行 npm run build",
  );
  process.exit(1);
}

const entryPath = resolve(clientDir, clientEntry);
if (!existsSync(entryPath)) {
  console.error(`[capacitor-prepare] client bundle 不存在: ${entryPath}`);
  process.exit(1);
}

const stylesheet = findMainStylesheet();

const supabaseUrl = readEnv("VITE_SUPABASE_URL");
const supabaseKey = readEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "[capacitor-prepare] WARNING: VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY missing — " +
      "TestFlight build will start in guest-safe mode until .env is present at build time.",
  );
}

const googleMapsKey =
  readEnv("EXPO_PUBLIC_GOOGLE_MAPS_API_KEY") ?? readEnv("VITE_GOOGLE_MAPS_API_KEY");
if (!googleMapsKey?.trim()) {
  console.warn(
    "[capacitor-prepare] WARNING: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY missing — " +
      "explore map will use demo places only on device.",
  );
} else {
  console.info("[capacitor-prepare] GOOGLE_MAPS key present at build time");
}

const bootstrapEntry = writeCapacitorBootstrapLoader(clientEntry);

const staleMount = join(assetsDir, "capacitor-mount.js");
if (existsSync(staleMount)) {
  rmSync(staleMount, { force: true });
  console.info("[capacitor-prepare] Removed stale assets/capacitor-mount.js");
}

writeBundledIndexHtml({
  clientEntry,
  bootstrapEntry,
  stylesheet,
});
pruneOrphanClientAssets(clientEntry);
patchBundleBootTrace(clientEntry);
patchClientBundleForCapacitorSpa(clientEntry);
patchClientRouterSuspense(clientEntry);
patchClientBundleCreateRootReuse(clientEntry);

console.info("[capacitor-prepare] Wrote production bundled index.html");
console.info(`[capacitor-prepare]   script: ./${clientEntry}`);
if (stylesheet) console.info(`[capacitor-prepare]   style:  ./${stylesheet}`);
console.info("[capacitor-prepare] WebView will load bundled assets (no server.url)");
