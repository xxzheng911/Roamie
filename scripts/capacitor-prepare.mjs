#!/usr/bin/env node
/**
 * Post-build step for Capacitor iOS/Android:
 * - bundled（TestFlight / Release）：從 TanStack Start manifest 產生可離線啟動的 index.html
 * - dev / remote：僅提示 WebView 將使用 server.url（由 capacitor.config 決定）
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
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
/** 與 src/lib/log-error.ts buildCapacitorEarlyErrorLogScript() 同步 */
const CAPACITOR_EARLY_ERROR_LOG = `<script>
(function(){
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
  window.addEventListener("error", function(e) {
    if (e.target && e.target.tagName === "SCRIPT") {
      roamieLog("APP_SCRIPT_LOAD_ERROR", e.message || "script failed", e.filename || "script");
      return;
    }
    roamieLog("APP_INIT_ERROR", e.error || e.message, e.filename);
  }, true);
  window.addEventListener("unhandledrejection", function(e) {
    roamieLog("APP_UNHANDLED_REJECTION", e.reason, "promise");
  });
  setTimeout(function() {
    var boot = document.getElementById("roamie-static-boot");
    var staticBootVisible = boot && !boot.hasAttribute("hidden");
    var root = document.getElementById("root");
    var rootChildren = root ? root.childElementCount : 0;
    var links = Array.prototype.slice.call(document.querySelectorAll('link[rel="stylesheet"]'));
    var hrefs = links.map(function(l) { return l.getAttribute("href"); }).join(",");
    var splash = document.querySelector(".roamie-splash");
    var path = location.pathname.replace(/\\/+$/, "") || "/";
    console.error(
      "ROAMIE_BOOT_CHECK pathname=" + path +
      " staticBoot=" + staticBootVisible +
      " splash=" + Boolean(splash) +
      " rootChildren=" + rootChildren +
      " stylesheets=" + (hrefs || "none")
    );
    if (staticBootVisible) {
      console.error("ROAMIE_BOOT_CHECK React 可能未掛載（仍顯示靜態占位）");
    } else {
      var hasUi =
        rootChildren > 0 ||
        document.querySelector("nav,main,[role=main],button,a[href],.roamie-splash") != null;
      if (!hasUi) {
        console.error(
          "ROAMIE_BOOT_CHECK 白屏 pathname=" + path + " — 請搜尋 APP_INIT_ERROR / APP_SCRIPT_LOAD_ERROR"
        );
      } else {
        console.error(
          "ROAMIE_BOOT_CHECK OK — 已離開冷啟動（pathname=" + path + "，無 splash 屬正常）"
        );
      }
    }
  }, 6000);
})();
</script>`;

/** 與 RoamieSplashScreen 共用 class；React 掛載前提供可見占位，避免 WKWebView 白屏 */
const CAPACITOR_ROOT_PLACEHOLDER = `<div class="roamie-splash" role="status" aria-live="polite" aria-busy="true">
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
  var legacy={"/loading":1,"/intro":1,"/splash":1,"/onboarding":1};
  if(p===""||p==="/"||p==="/index.html"||p.endsWith("/index.html")||legacy[p]){
    history.replaceState(history.state,"","/"+q+h);
    p="/";
  }
  function hasSession(){
    try{
      var raw=localStorage.getItem("roamie-auth");
      if(!raw)return false;
      var j=JSON.parse(raw);
      return Boolean(j&&j.access_token);
    }catch(e){return false;}
  }
  function hasCompanion(){
    try{return localStorage.getItem("roamie:companionModeCompleted")==="true";}catch(e){return false;}
  }
  if(p==="/auth/callback"||location.search.indexOf("code=")>=0)return;
  if(p==="/login"||p==="/welcome"||p==="/trip")return;
  var target="/";
  if(!hasSession())target="/login";
  else if(!hasCompanion())target="/welcome";
  if(p!==target)history.replaceState(history.state,"",target+q+h);
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
self.$_TSR.h();
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

function writeBundledIndexHtml({ clientEntry, stylesheet }) {
  const scriptFile = clientEntry.startsWith("assets/") ? clientEntry : `assets/${clientEntry}`;
  const scriptSrc = scriptFile.startsWith("/") ? scriptFile : `/${scriptFile}`;
  const cssHref = stylesheet
    ? stylesheet.startsWith("/")
      ? stylesheet
      : `/${stylesheet}`
    : null;
  const cssLink = cssHref
    ? `\n    <link rel="preload" href="${cssHref}" as="style" />\n    <link rel="stylesheet" href="${cssHref}" />`
    : "";
  const splashCriticalCss = readSplashCriticalCss();

  writeFileSync(
    indexPath,
    `<!DOCTYPE html>
<html lang="zh-Hant" class="roamie-app">
  <head>
    <base href="/" />
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    <meta name="theme-color" content="#f7f4ef" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <title>Roamie｜你的慢旅行夥伴</title>
    <meta name="roamie-build" content="${new Date().toISOString()}" />${cssLink}
    <style>html,body{background-color:#f7f4ef;color:#2a2520;margin:0;min-height:100%}</style>
    ${splashCriticalCss ? `<style>${splashCriticalCss}</style>` : ""}
  </head>
  <body class="roamie-body antialiased">
    <div id="roamie-static-boot" hidden aria-hidden="true"></div>
    <div id="root">${CAPACITOR_ROOT_PLACEHOLDER}</div>
    ${CAPACITOR_EARLY_ERROR_LOG}
    ${CAPACITOR_PATH_NORMALIZE}
    ${TSR_SPA_BOOTSTRAP}
    <script type="module" crossorigin src="${scriptSrc}"></script>
    <script>
(function(){
  setTimeout(function(){
    var boot=document.getElementById("roamie-static-boot");
    if(!boot||boot.hasAttribute("hidden"))return;
    if(!document.querySelector(".roamie-splash")){
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

writeBundledIndexHtml({ clientEntry, stylesheet });
patchClientBundleForCapacitorSpa(clientEntry);

console.info("[capacitor-prepare] Wrote production bundled index.html");
console.info(`[capacitor-prepare]   script: ./${clientEntry}`);
if (stylesheet) console.info(`[capacitor-prepare]   style:  ./${stylesheet}`);
console.info("[capacitor-prepare] WebView will load bundled assets (no server.url)");
