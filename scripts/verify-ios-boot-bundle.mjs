#!/usr/bin/env node
/**
 * 檢查將裝進 iOS .app 的 bundled WebView 資源（Simulator / 真機共用同一套 public/）。
 * 在 Xcode Run 真機前執行，可避免 IPA 缺 lazy chunk 導致真機 Importing a module script failed。
 * 用法：node scripts/verify-ios-boot-bundle.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iosHtml = resolve(root, "ios/App/App/public/index.html");
const distHtml = resolve(root, "dist/client/index.html");
const iosAssets = resolve(root, "ios/App/App/public/assets");

function fail(msg) {
  console.error(`[verify-ios-boot] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.info(`[verify-ios-boot] OK: ${msg}`);
}

for (const p of [iosHtml, distHtml]) {
  if (!existsSync(p)) fail(`missing ${p}`);
}

const ios = readFileSync(iosHtml, "utf8");
const dist = readFileSync(distHtml, "utf8");

const bootstrapScript = ios.match(/src="\.\/assets\/(capacitor-bootstrap\.js)"/)?.[1];
if (!bootstrapScript) {
  fail('ios index.html 應先載入 src="./assets/capacitor-bootstrap.js"');
}
ok("index.html 使用 capacitor-bootstrap.js 延遲載入主 bundle");

const entry = ios.match(/app=\.\/assets\/(index-[^"]+\.js)/)?.[1];
if (!entry) fail('ios index.html 缺少 app=./assets/index-*.js 主 entry 註記');
if (!ios.includes("INDEX_HTML_LOADED")) fail("ios index.html 缺少 INDEX_HTML_LOADED");
ok(`ios entry ${entry}`);

if (ios.includes('import("/assets/index-')) fail("ios 仍使用絕對路徑 import");
if (ios.includes("self.$_TSR.h();")) fail("inline script 仍呼叫 $_TSR.h()");

const entryPath = join(iosAssets, entry);
if (!existsSync(entryPath)) fail(`entry 檔案不存在: ${entry}`);
const entryCode = readFileSync(entryPath, "utf8");
if (!entryCode.includes("MAIN_TSX_LOADED")) {
  fail("entry bundle 缺少 MAIN_TSX_LOADED marker");
}
ok(`entry size ${(statSync(entryPath).size / 1024).toFixed(0)} KB，含 MAIN_TSX_LOADED 前綴`);

const lazyChunks = new Set();
for (const m of entryCode.matchAll(/import\("\.\/([^"]+)"\)/g)) {
  lazyChunks.add(m[1]);
}
for (const m of entryCode.matchAll(/"assets\/([A-Za-z0-9_.-]+\.js)"/g)) {
  lazyChunks.add(m[1]);
}
const missingLazy = [...lazyChunks].filter((f) => !existsSync(join(iosAssets, f)));
if (missingLazy.length > 0) {
  fail(`entry 引用的 chunk 不在 ios bundle: ${missingLazy.slice(0, 8).join(", ")}`);
}
const indexLazy = [...lazyChunks].filter((f) => f.startsWith("index-"));
ok(
  `entry 引用 ${lazyChunks.size} 個 chunk（含 ${indexLazy.length} 個 index-*.js 懶加載）`,
);

const distEntry =
  dist.match(/app=\.\/assets\/(index-[^"]+\.js)/)?.[1] ??
  dist.match(/src="\.\/assets\/(index-[^"]+\.js)"/)?.[1];
if (distEntry !== entry) fail(`dist/ios entry 不一致 dist=${distEntry} ios=${entry}`);
ok("dist 與 ios entry 一致");

const checks = [
  "ROAMIE_BOOT_START",
  "ROAMIE_BOOT_CHECK",
  "APP_INIT_ERROR",
  "ROAMIE_BOOT IMPORT_START",
  "native_splash_hidden",
];
for (const c of checks) {
  if (!ios.includes(c) && c !== "native_splash_hidden") {
    console.warn(`[verify-ios-boot] WARN: index.html 缺少 ${c}`);
  }
}

console.info("[verify-ios-boot] 全部關鍵檢查通過。Xcode Run 後請在 Console 搜尋：ROAMIE_BOOT");
