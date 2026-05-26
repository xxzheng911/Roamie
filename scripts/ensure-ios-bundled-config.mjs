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
      androidScheme: "https",
      iosScheme: "https",
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
  if (!html.includes('<base href="/"')) {
    console.error(
      "[ensure-ios-bundled] public/index.html 缺少 <base href=\"/\" /> — 請 npm run ios:release",
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
  if (!html.includes("APP_INIT_ERROR")) {
    console.warn(
      "[ensure-ios-bundled] public/index.html 缺少早期錯誤記錄 script — 建議 npm run ios:release",
    );
  }
  if (html.includes("self.$_TSR.h();") && !html.includes("hydrateStart")) {
    console.error(
      "[ensure-ios-bundled] $_TSR 在 inline script 呼叫 h() 會過早刪除 bootstrap — 請 npm run ios:release",
    );
    process.exit(1);
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
