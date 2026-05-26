#!/usr/bin/env node
/**
 * 確保 ios/App/App/capacitor.config.json 為 bundled 模式（無 server.url）。
 * 在 cap sync ios 之後執行。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "ios/App/App/capacitor.config.json");
const publicIndex = resolve(root, "ios/App/App/public/index.html");
const ultraMinimal =
  process.env.ROAMIE_ULTRA_MINIMAL_HTML === "1" ||
  process.env.ROAMIE_ULTRA_MINIMAL_HTML === "true";

if (!existsSync(configPath)) {
  console.error("[ensure-ios-bundled] missing", configPath);
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));

if (config.server?.url) {
  console.warn("[ensure-ios-bundled] 移除 server.url:", config.server.url);
  delete config.server.url;
  if (config.server && Object.keys(config.server).length === 0) {
    config.server = {
      hostname: "localhost",
      androidScheme: "https",
      iosScheme: "capacitor",
      appStartPath: "index.html",
    };
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, "\t")}\n`, "utf8");
}

if (existsSync(publicIndex)) {
  const html = readFileSync(publicIndex, "utf8");
  if (html.includes("npm run ios:sim") || html.includes("完整 App 需連開發伺服器")) {
    console.error(
      "[ensure-ios-bundled] ios/App/App/public/index.html 仍是開發占位頁 — 請執行 npm run build && npm run cap:sync:ios:release",
    );
    process.exit(1);
  }
  if (ultraMinimal) {
    if (!html.includes("Ultra minimal HTML test")) {
      console.error(
        "[ensure-ios-bundled] ROAMIE_ULTRA_MINIMAL_HTML=1 但 public/index.html 不是 ultra-minimal 版本",
      );
      process.exit(1);
    }
    const hasScriptProbe =
      html.includes("<script") && html.includes("INDEX_HTML_LOADED");
    const hasMetaProbe =
      html.includes('name="roamie-probe"') && html.includes("INDEX_HTML_LOADED");
    if (hasScriptProbe) {
      console.warn(
        "[ensure-ios-bundled] ultra-minimal HTML 仍含 inline script probe — 建議零 script",
      );
    }
    if (!hasMetaProbe && !hasScriptProbe) {
      console.warn(
        "[ensure-ios-bundled] ultra-minimal HTML 缺少 roamie-probe meta — 建議 npm run cap:sync:ios",
      );
    }
    console.info("[ensure-ios-bundled] OK — ultra-minimal HTML mode");
    process.exit(0);
  }
  if (!html.includes('type="module"')) {
    console.error("[ensure-ios-bundled] public/index.html 缺少 client script — 重新 cap sync");
    process.exit(1);
  }
  if (!html.includes("$_TSR")) {
    console.error(
      "[ensure-ios-bundled] public/index.html 缺少 TanStack Start SPA bootstrap — 請執行 npm run ios:release",
    );
    process.exit(1);
  }
  if (!html.includes("routes:{}")) {
    console.error(
      "[ensure-ios-bundled] public/index.html $_TSR manifest 缺少 routes:{} — 請重新 npm run ios:release",
    );
    process.exit(1);
  }
  if (!html.includes('<base href="./"')) {
    console.error(
      "[ensure-ios-bundled] public/index.html 缺少 <base href=\"./\" /> — 請 npm run ios:release",
    );
    process.exit(1);
  }
  if (!html.includes('history.replaceState(history.state,"","/"+q+h)')) {
    console.error(
      "[ensure-ios-bundled] public/index.html 冷啟動未正規化至 / — 請執行 npm run ios:release",
    );
    process.exit(1);
  }
  if (html.includes('history.replaceState(history.state,"","/loading"')) {
    console.error(
      "[ensure-ios-bundled] public/index.html 仍導向已移除的 /loading — 請執行 npm run ios:release",
    );
    process.exit(1);
  }
  if (!html.includes("ROAMIE_BOOT_START")) {
    console.warn(
      "[ensure-ios-bundled] public/index.html 缺少 ROAMIE_BOOT_START — 建議 npm run cap:sync:ios",
    );
  }
  if (!html.includes('src="./assets/capacitor-bootstrap.js"')) {
    console.error(
      "[ensure-ios-bundled] 應先載入 capacitor-bootstrap.js — 請 npm run cap:sync:ios",
    );
    process.exit(1);
  }
  if (!existsSync(resolve(root, "ios/App/App/public/assets/capacitor-bootstrap.js"))) {
    console.error("[ensure-ios-bundled] 缺少 public/assets/capacitor-bootstrap.js");
    process.exit(1);
  }
  if (!config.server?.hostname) {
    console.warn(
      "[ensure-ios-bundled] capacitor.config.json 缺少 server.hostname — 建議設為 localhost",
    );
  }
  if (config.server?.appStartPath !== "index.html") {
    console.warn(
      "[ensure-ios-bundled] server.appStartPath 應為 index.html — 請 npm run cap:sync:ios",
    );
  }
  if (!html.includes("INDEX_HTML_LOADED")) {
    console.error(
      "[ensure-ios-bundled] public/index.html 缺少 INDEX_HTML_LOADED probe — 請 npm run cap:sync:ios",
    );
    process.exit(1);
  }
  if (!html.includes("APP_INIT_ERROR")) {
    console.warn(
      "[ensure-ios-bundled] public/index.html 缺少早期錯誤記錄 script — 建議 npm run ios:release",
    );
  }
  if (!html.includes("self.$_TSR.e();")) {
    console.error(
      "[ensure-ios-bundled] public/index.html 缺少 Capacitor SPA bootstrap（$_TSR.e）— 請 npm run cap:sync:ios",
    );
    process.exit(1);
  }
  if (html.includes("self.$_TSR.h();")) {
    console.error(
      "[ensure-ios-bundled] inline script 不可呼叫 $_TSR.h()（會在 React 載入前刪除 bootstrap → 白屏）— 請 npm run cap:sync:ios",
    );
    process.exit(1);
  }
  const distIndex = resolve(root, "dist/client/index.html");
  if (existsSync(distIndex)) {
    const distHtml = readFileSync(distIndex, "utf8");
    const iosEntry = html.match(/index-([A-Za-z0-9_-]+)\.js/)?.[0];
    const distEntry = distHtml.match(/index-([A-Za-z0-9_-]+)\.js/)?.[0];
    if (iosEntry && distEntry && iosEntry !== distEntry) {
      console.error(
        `[ensure-ios-bundled] iOS bundle 過舊（ios=${iosEntry}, dist=${distEntry}）— 請執行 npm run cap:sync:ios 後再 Run Xcode`,
      );
      process.exit(1);
    }
  }
  if (!html.includes("roamie-static-boot")) {
    console.warn("[ensure-ios-bundled] 缺少靜態載入占位 — 建議 npm run ios:release");
  }
  const entryMatch = html.match(/src="\.\/assets\/(index-[^"]+\.js)"/);
  if (entryMatch) {
    const entryPath = resolve(root, "ios/App/App/public/assets", entryMatch[1]);
    if (!existsSync(entryPath)) {
      console.error(
        `[ensure-ios-bundled] index.html 指向不存在的 bundle: ${entryMatch[1]} — 請 npm run ios:release`,
      );
      process.exit(1);
    }
    const entryCode = readFileSync(entryPath, "utf8");
    if (entryCode.includes(".hydrateRoot(document,")) {
      console.error(
        "[ensure-ios-bundled] client bundle 仍使用 hydrateRoot(document) — Capacitor 會 React #418，請 npm run ios:release",
      );
      process.exit(1);
    }
    if (entryCode.includes(".createRoot(document).render(")) {
      console.error(
        "[ensure-ios-bundled] client bundle 仍使用 createRoot(document) — React 會不渲染（白屏），請 npm run ios:release",
      );
      process.exit(1);
    }
  }
}

console.info("[ensure-ios-bundled] OK — bundled config, no dev server.url");
