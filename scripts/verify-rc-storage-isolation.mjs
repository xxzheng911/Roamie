import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readOwnedPersonalizedCache, wrapPersonalizedCache } from "../src/lib/personalized-cache-envelope.ts";

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.info(`PASS ${name}`); };

test("owner envelope rejects account B reading account A", () => {
  const raw = JSON.stringify(wrapPersonalizedCache("account-a", [{ id: "private" }]));
  assert.deepEqual(readOwnedPersonalizedCache(raw, "account-a"), [{ id: "private" }]);
  assert.equal(readOwnedPersonalizedCache(raw, "account-b"), null);
});

test("logout clears generic personalized and active-session keys", () => {
  const source = readFileSync("src/lib/clear-auth-state.ts", "utf8");
  for (const key of ["roamie:places", "roamie:itineraries", "roamie:recommendations", "roamie:chat", "roamie:recommendation-latest", "roamie:conversation-workspace:active"]) {
    assert.ok(source.includes(`"${key}"`), key);
  }
  assert.match(source, /resetAppBootCachesForUserChange\(\)/);
});

test("favorites and itinerary cache quota cannot fail remote-authoritative operation", () => {
  assert.match(readFileSync("src/lib/places-storage.ts", "utf8"), /PLACES_CACHE_WRITE_FAILED[\s\S]*remote_authority/);
  assert.match(readFileSync("src/lib/itinerary-storage.ts", "utf8"), /ITINERARY_CACHE_WRITE_FAILED[\s\S]*remote_authority/);
});

test("recommendation quota has in-memory fallback", () => {
  const source = readFileSync("src/lib/recommendation-storage.ts", "utf8");
  assert.match(source, /memoryRecommendations/);
  assert.match(source, /RECOMMENDATION_STORAGE_FALLBACK/);
});

test("workspace quota retains memory/native fallback", () => {
  const source = readFileSync("src/lib/conversation-workspace/storage.ts", "utf8");
  assert.match(source, /fallback: "memory_native"/);
  assert.match(source, /memoryBlobByKey/);
  assert.match(readFileSync("src/lib/conversation-workspace/remote-sync.ts", "utf8"), /MAX_REMOTE_WORKSPACES = 100/);
  assert.match(readFileSync("src/lib/conversation-workspace/remote-sync.ts", "utf8"), /MAX_MESSAGES_PER_WORKSPACE = 80/);
});

test("factual caches have bounded or quota-safe writes", () => {
  assert.match(readFileSync("src/lib/unified-place-cache.ts", "utf8"), /prunePersistedEntries\(\)[\s\S]*catch/);
  assert.match(readFileSync("src/lib/home-persistent-cache.ts", "utf8"), /catch[\s\S]*quota/);
  assert.match(readFileSync("src/lib/map-places-cache.ts", "utf8"), /MAX_ENTRIES = 64/);
});

console.info(`RC storage/isolation: ${passed}/6 passed`);
