#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { logTravelPrefCacheWriteError } from "../src/lib/travel-pref-cache-write.ts";
import { logUserMedia } from "../src/lib/user-media/user-media-log.ts";

const warnCalls = [];
const originalWarn = console.warn;
console.warn = (...args) => warnCalls.push(args);

try {
  const mediaSource = readFileSync(
    new URL("../src/lib/user-media/user-media-log.ts", import.meta.url),
    "utf8",
  );
  const prefsSource = readFileSync(
    new URL("../src/lib/travel-pref-cache-write.ts", import.meta.url),
    "utf8",
  );
  assert.match(mediaSource, /devVerboseInfo\(`\[\$\{tag\}\]`/);
  assert.doesNotMatch(mediaSource, /console\.info/);
  assert.match(prefsSource, /devVerboseInfo\("\[TRAVEL_PREF_CACHE_WRITE\]"/);

  logUserMedia("USER_MEDIA_REFRESH_FAILED", { reason: "network" });
  logTravelPrefCacheWriteError("travel-prefs", "write failed", {});
  assert.equal(warnCalls.length, 2, "operational failures must remain visible");
  assert.match(String(warnCalls[0]?.[0]), /USER_MEDIA_REFRESH_FAILED/);
  assert.match(String(warnCalls[1]?.[0]), /TRAVEL_PREF_CACHE_WRITE_ERROR/);
} finally {
  console.warn = originalWarn;
}

console.info("verify-production-lifecycle-logging: ok");
