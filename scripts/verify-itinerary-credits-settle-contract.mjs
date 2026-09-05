#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const chat = readFileSync(join(root, "src/routes/_app.chat.tsx"), "utf8");
const start = chat.indexOf("const handleGenerateItinerary = async (");
const end = chat.indexOf("runDirectItineraryRef.current =", start);
const handleGenerateSection =
  start >= 0 && end > start ? chat.slice(start, end) : chat;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

console.log("\n[verify:itinerary-credits-settle-contract]\n");

test("handleGenerateItinerary tracks single settle state", () => {
  assert.match(handleGenerateSection, /let itinerarySucceeded = false;/);
  assert.match(
    handleGenerateSection,
    /await settleCreditsOperation\(itinCreditsHandle, itinerarySucceeded\);/,
  );
});

test("success path marks succeeded before navigate", () => {
  assert.match(
    handleGenerateSection,
    /itinerarySucceeded = true;[\s\S]*?settleCreditsOperation\(itinCreditsHandle, true\);[\s\S]*?navigate\(tripDetailNavigateOptions\(saved\.id\)\)/,
  );
});

test("success commit clears handle before finally and failure has no direct duplicate settle", () => {
  assert.match(handleGenerateSection, /settleCreditsOperation\(itinCreditsHandle, true\);\s*itinCreditsHandle = null;/);
  assert.doesNotMatch(
    handleGenerateSection,
    /settleCreditsOperation\(itinCreditsHandle,\s*false\)/,
  );
});

test("prepare/create early return branches still exist", () => {
  assert.match(handleGenerateSection, /if \(!prepared\.ok\) \{/);
  assert.match(handleGenerateSection, /if \(!createResult\.ok\) \{/);
});

console.log("\n[verify:itinerary-credits-settle-contract] OK\n");
