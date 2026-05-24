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
  ok("dist/client/index.html (capacitor-prepare)");
} else {
  fail("index.html missing — run: node scripts/capacitor-prepare.mjs");
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

const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  const body = readFileSync(envPath, "utf8");
  if (/CAPACITOR_DEV_SERVER_URL=https?:\/\//.test(body)) {
    ok("CAPACITOR_DEV_SERVER_URL set (iOS Simulator / device dev)");
  } else if (/CAPACITOR_SERVER_URL=https?:\/\//.test(body)) {
    ok("CAPACITOR_SERVER_URL set (production / TestFlight)");
  } else {
    fail("Set CAPACITOR_DEV_SERVER_URL (dev) or CAPACITOR_SERVER_URL (prod) in .env");
  }
} else {
  fail(".env missing — copy from .env.example");
}

if (failed) {
  console.error("\nFix the items above, then see docs/TESTFLIGHT.md");
  process.exit(1);
}

console.info("\nReady for: npm run cap:sync && npm run cap:open:ios");
