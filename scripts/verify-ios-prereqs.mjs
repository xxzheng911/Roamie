#!/usr/bin/env node
/**
 * Pre-flight checks before iOS TestFlight build.
 * Run: node scripts/verify-ios-prereqs.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failed = false;
const ultraMinimal =
  process.env.ROAMIE_ULTRA_MINIMAL_HTML === "1" ||
  process.env.ROAMIE_ULTRA_MINIMAL_HTML === "true";

function ok(msg) {
  console.info("✓", msg);
}
function fail(msg) {
  console.error("✗", msg);
  failed = true;
}

function has(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (existsSync(resolve(root, "dist/client/assets"))) {
  ok("dist/client exists (run npm run build if stale)");
} else {
  fail("dist/client missing — run: npm run build");
}

if (existsSync(resolve(root, "dist/client/index.html"))) {
  const html = readFileSync(resolve(root, "dist/client/index.html"), "utf8");
  if (html.includes("npm run ios:sim") || html.includes("完整 App 需連開發伺服器")) {
    fail("dist/client/index.html 仍是開發占位頁 — run: npm run ios:release");
  } else if (!html.includes('type="module"')) {
    if (ultraMinimal && html.includes("Ultra minimal HTML test")) {
      ok("dist/client/index.html (ultra-minimal HTML mode)");
    } else {
      fail("dist/client/index.html 缺少 production script — run: npm run build");
    }
  } else if (!html.includes("$_TSR")) {
    fail("dist/client/index.html 缺少 TanStack Start SPA bootstrap — run: npm run ios:release");
  } else {
    ok("dist/client/index.html (production bundled SPA + $_TSR bootstrap)");
  }
} else {
  fail("index.html missing — run: npm run ios:release");
}

if (existsSync(resolve(root, "ios/App/App.xcodeproj")) || existsSync(resolve(root, "ios/App/App.xcworkspace"))) {
  ok("ios/ project found");
} else {
  fail("ios/ not found — run: npm run cap:add:ios (requires CocoaPods + Xcode)");
}

if (has("xcodebuild")) {
  try {
    const v = execSync("xcodebuild -version", { encoding: "utf8" }).split("\n")[0];
    ok(`Xcode: ${v}`);
  } catch {
    fail("xcodebuild not working");
  }
} else {
  fail("Xcode not installed");
}

if (has("pod")) {
  ok("CocoaPods installed");
} else {
  fail("CocoaPods missing — install: sudo gem install cocoapods");
}

const iosConfigPath = resolve(root, "ios/App/App/capacitor.config.json");
if (existsSync(iosConfigPath)) {
  try {
    const iosConfig = JSON.parse(readFileSync(iosConfigPath, "utf8"));
    const url = iosConfig?.server?.url;
    if (url) {
      fail(
        `ios capacitor.config.json has server.url=${url} — run npm run cap:sync:ios (bundled) or cap:sync:ios:dev with CAPACITOR_LIVE_RELOAD=1`,
      );
    } else {
      ok("ios capacitor.config.json has no server.url (bundled mode)");
    }
  } catch {
    fail("Could not parse ios/App/App/capacitor.config.json");
  }
}

const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  const body = readFileSync(envPath, "utf8");
  if (/CAPACITOR_DEV_SERVER_URL=https?:\/\//.test(body)) {
    ok("CAPACITOR_DEV_SERVER_URL in .env (used only when CAPACITOR_LIVE_RELOAD=1)");
  }
  if (/CAPACITOR_SERVER_URL=https?:\/\//.test(body)) {
    ok("CAPACITOR_SERVER_URL in .env (used only when CAPACITOR_USE_REMOTE_SERVER=1)");
  }
  if (!/CAPACITOR_(DEV_SERVER_URL|SERVER_URL)=https?:\/\//.test(body)) {
    ok(".env has no Capacitor server URL (bundled mode OK)");
  }
} else {
  ok(".env optional for bundled iOS builds");
}

for (const locale of ["en", "zh-Hant", "ja", "ko"]) {
  const p = resolve(root, `ios/App/App/${locale}.lproj/InfoPlist.strings`);
  if (existsSync(p)) {
    ok(`InfoPlist.strings (${locale})`);
  } else {
    fail(`Missing ${locale}.lproj/InfoPlist.strings — run: npm run ios:permissions`);
  }
}

if (failed) {
  console.error("\nFix the items above, then see docs/TESTFLIGHT.md");
  process.exit(1);
}

console.info("\nReady for: npm run cap:sync && npm run cap:open:ios");
