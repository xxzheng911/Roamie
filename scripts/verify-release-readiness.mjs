import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildUnifiedPlaceDetailsCacheKey,
  getUnifiedPlaceCacheOrFetch,
  invalidateUnifiedPlaceCache,
  readCachedPlaceResultById,
  cachePlaceResultById,
} from "../src/lib/unified-place-cache.ts";
import {
  readOwnedPersonalizedCache,
  wrapPersonalizedCache,
} from "../src/lib/personalized-cache-envelope.ts";

test("detail identity ignores city and normalizes locale while separating capability", () => {
  const a = buildUnifiedPlaceDetailsCacheKey(
    "places/ChIJ123",
    "zh_tw",
    { city: "Taipei" },
    "screen_v1",
  );
  const b = buildUnifiedPlaceDetailsCacheKey("ChIJ123", "zh-TW", { city: "Tokyo" }, "screen_v1");
  assert.equal(a, b);
  assert.notEqual(a, buildUnifiedPlaceDetailsCacheKey("ChIJ123", "zh-TW", {}, "intro_v1"));
});

test("same-place concurrent requests join one inflight fetch", async () => {
  const key = buildUnifiedPlaceDetailsCacheKey("ChIJ-concurrent", "en", {}, "intro_v1");
  invalidateUnifiedPlaceCache(key);
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    await Promise.resolve();
    return { ok: true };
  };
  const [a, b] = await Promise.all([
    getUnifiedPlaceCacheOrFetch(key, fetcher),
    getUnifiedPlaceCacheOrFetch(key, fetcher),
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
});

test("screen capability satisfies search, but search does not satisfy screen", () => {
  cachePlaceResultById(
    {
      id: "ChIJ-search",
      name: "Search",
      lat: 1,
      lng: 2,
      rating: null,
      userRatingCount: null,
      photoName: null,
      primaryType: null,
      types: null,
      businessStatus: null,
      openStatus: "unknown",
    },
    "en",
  );
  assert.equal(readCachedPlaceResultById("ChIJ-search", "en", {}, "screen_v1"), null);
});

test("personalized envelope rejects account switch and legacy naked payload", () => {
  const raw = JSON.stringify(wrapPersonalizedCache("user-a", [{ reason: "private" }]));
  assert.deepEqual(readOwnedPersonalizedCache(raw, "user-a"), [{ reason: "private" }]);
  assert.equal(readOwnedPersonalizedCache(raw, "user-b"), null);
  assert.equal(readOwnedPersonalizedCache(JSON.stringify([{ reason: "legacy" }]), "user-a"), null);
});

test("all AI HTTP routes require auth and server credit reservation", () => {
  for (const file of ["roamie.ts", "chat.ts", "generate-itinerary.ts"]) {
    const source = readFileSync(new URL(`../src/routes/api/${file}`, import.meta.url), "utf8");
    assert.match(source, /requireAuthenticatedAiRequest\(request\)/);
    assert.match(source, /reserveServerCredits\(/);
    assert.match(source, /status:\s*401/);
  }
});
