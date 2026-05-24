#!/usr/bin/env node
/**
 * Sync localized iOS permission strings (InfoPlist.strings) from scripts/ios-permission-strings.json
 *
 * Usage: node scripts/sync-ios-permission-strings.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const APP_DIR = resolve(ROOT, "ios/App/App");
const SOURCE = resolve(__dirname, "ios-permission-strings.json");

function escapeString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatInfoPlistStrings(entries) {
  const lines = [
    "/* Localized permission descriptions — Roamie */",
    "",
    "/* Location (weather + nearby recommendations) */",
    `"NSLocationWhenInUseUsageDescription" = "${escapeString(entries.NSLocationWhenInUseUsageDescription)}";`,
    `"NSLocationAlwaysAndWhenInUseUsageDescription" = "${escapeString(entries.NSLocationAlwaysAndWhenInUseUsageDescription)}";`,
    "",
    "/* Camera & photo library (avatar / cover) */",
    `"NSCameraUsageDescription" = "${escapeString(entries.NSCameraUsageDescription)}";`,
    `"NSPhotoLibraryUsageDescription" = "${escapeString(entries.NSPhotoLibraryUsageDescription)}";`,
    `"NSPhotoLibraryAddUsageDescription" = "${escapeString(entries.NSPhotoLibraryAddUsageDescription)}";`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const raw = await readFile(SOURCE, "utf8");
  const locales = JSON.parse(raw);

  for (const [locale, entries] of Object.entries(locales)) {
    const dir = resolve(APP_DIR, `${locale}.lproj`);
    await mkdir(dir, { recursive: true });
    const outPath = resolve(dir, "InfoPlist.strings");
    await writeFile(outPath, formatInfoPlistStrings(entries), "utf8");
    console.log("✓", outPath);
  }

  console.log("\nNote: iOS notification permission dialogs use system text and cannot be customized in Info.plist.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
