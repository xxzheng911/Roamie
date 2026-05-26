#!/usr/bin/env node
/**
 * TestFlight / App Store 用 iOS production bundled 建置：
 * - 不使用 localhost / CAPACITOR_DEV_SERVER_URL
 * - npm run build → 產生 dist/client SPA 入口
 * - cap sync ios → 複製到 ios/App/App/public
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const env = { ...process.env, ROAMIE_QUIET_BOOT: "1" };
delete env.CAPACITOR_LIVE_RELOAD;
delete env.CAPACITOR_DEV_SERVER_URL;
delete env.CAPACITOR_USE_REMOTE_SERVER;
delete env.CAPACITOR_SERVER_URL;

function run(label, cmd, args) {
  console.info(`\n[ios:release] ${label}`);
  const result = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.info("[ios:release] Production bundled build (no dev server)\n");

run("production web build", "npm", ["run", "build"]);
run("cap sync ios (bundled)", "node", [
  "scripts/cap-sync-ios.mjs",
  "bundled",
]);
run("verify bundled config", "node", ["scripts/ensure-ios-bundled-config.mjs"]);
run("verify ios prereqs", "node", ["scripts/verify-ios-prereqs.mjs"]);

console.info(`
[ios:release] 完成。下一步（真機 / TestFlight 相同 bundled 流程）：
  1. 在 iPhone 上長按刪除舊版 Roamie（清 KeyValueStore + WK 快取）
  2. 開啟 Xcode：npm run cap:open:ios
  3. Product → Clean Build Folder
  4. 選你的真機（如 iPhone Shuo）→ Run；或 Archive → TestFlight

真機 Console 請搜尋：[Roamie] RUNTIME=device、BRIDGE startURL=capacitor://localhost/index.html
若仍白屏：搜尋 WebView failed、DEVICE_BLANK、APP_SCRIPT_LOAD_ERROR

注意：API / AI / server functions 仍需網路（Supabase、部署的 Worker）。
UI 可離線啟動，不需 npm run dev（真機無法用 Mac 的 localhost 除非 live reload + 同 Wi‑Fi）。
`);
