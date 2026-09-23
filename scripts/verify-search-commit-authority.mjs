import assert from "node:assert/strict";
import { getPlacesSearchCachedOrRun } from "../src/lib/places-search-dedupe";
import { readUnifiedPlaceSearchCache } from "../src/lib/unified-place-cache";
import { normalizeGooglePlace } from "../src/lib/ai/normalize-google-place";
import { recommendationPlaceType } from "../src/lib/place-identity";
import { beginExploreRequestSession } from "../src/lib/explore-request-session";
import {
  runPlacesApiDeduped,
  resetPlacesProviderLimiterForTests,
} from "../src/lib/places-api-guard";
const result = (id) => ({ places: [{ id, name: id, lat: 35, lng: 139 }], error: null });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
let count = 0;
async function check(name, test) {
  await test();
  count++;
  console.log("PASS", name);
}
await check("non-aborted obsolete generation cannot normalize/cache/publish", async () => {
  let current = true;
  const a = deferred();
  const key = "authority-no-abort";
  const old = getPlacesSearchCachedOrRun(key, () => a.promise, { isCurrent: () => current });
  const rejected = assert.rejects(old, { name: "AbortError" });
  current = false;
  await getPlacesSearchCachedOrRun(key, async () => result("new"));
  // Reading places would be normalization/publication of an obsolete provider object.
  a.resolve({
    get places() {
      throw Error("must not normalize stale response");
    },
  });
  await rejected;
  assert.equal(readUnifiedPlaceSearchCache(key).places[0].id, "new");
});
await check("old rejection cannot poison replacement or delete its in-flight owner", async () => {
  let current = true;
  const a = deferred(),
    b = deferred();
  const key = "authority-rejection";
  const old = getPlacesSearchCachedOrRun(key, () => a.promise, { isCurrent: () => current });
  const rejected = assert.rejects(old, { name: "AbortError" });
  current = false;
  const fresh = getPlacesSearchCachedOrRun(key, () => b.promise);
  a.reject(Error("old provider failure"));
  await rejected;
  let extra = 0;
  const joined = getPlacesSearchCachedOrRun(key, async () => {
    extra++;
    return result("wrong");
  });
  b.resolve(result("new"));
  assert.equal((await fresh).places[0].id, "new");
  assert.equal((await joined).places[0].id, "new");
  assert.equal(extra, 0);
});
await check("different keys including unowned browse remain independent", async () => {
  const a = deferred(),
    b = deferred();
  let current = true;
  const browse = getPlacesSearchCachedOrRun("authority-browse", () => a.promise);
  const search = getPlacesSearchCachedOrRun("authority-search", () => b.promise, {
    isCurrent: () => current,
  });
  const rejected = assert.rejects(search, { name: "AbortError" });
  current = false;
  b.resolve(result("stale"));
  a.resolve(result("browse"));
  await rejected;
  assert.equal((await browse).places[0].id, "browse");
  assert.equal(readUnifiedPlaceSearchCache("authority-browse").places[0].id, "browse");
});
await check("both different-key current requests cache normally", async () => {
  const a = deferred(),
    b = deferred();
  const pa = getPlacesSearchCachedOrRun("authority-a", () => a.promise),
    pb = getPlacesSearchCachedOrRun("authority-b", () => b.promise);
  b.resolve(result("b"));
  a.resolve(result("a"));
  await Promise.all([pa, pb]);
  assert.equal(readUnifiedPlaceSearchCache("authority-a").places[0].id, "a");
  assert.equal(readUnifiedPlaceSearchCache("authority-b").places[0].id, "b");
});
await check("deduped caller losing its authority cannot publish shared result", async () => {
  const d = deferred();
  const a = getPlacesSearchCachedOrRun("authority-join", () => d.promise);
  let current = true;
  const b = getPlacesSearchCachedOrRun(
    "authority-join",
    () => {
      throw Error("must dedupe");
    },
    { isCurrent: () => current },
  );
  const rejected = assert.rejects(b, { name: "AbortError" });
  current = false;
  d.resolve(result("valid"));
  await rejected;
  assert.equal((await a).places[0].id, "valid");
});
await check("cached hit revoked before publication does not reach caller", async () => {
  await getPlacesSearchCachedOrRun("authority-hit", async () => result("hit"));
  let current = true;
  const p = getPlacesSearchCachedOrRun(
    "authority-hit",
    () => {
      throw Error("must use cache");
    },
    { isCurrent: () => current },
  );
  current = false;
  await assert.rejects(p, { name: "AbortError" });
});
await check("provider ignoring abort cannot publish a completed old response", async () => {
  resetPlacesProviderLimiterForTests();
  const session = beginExploreRequestSession("search", "old");
  const d = deferred(),
    started = deferred();
  const pending = runPlacesApiDeduped(
    "authority-provider",
    "searchText",
    () => {
      started.resolve();
      return d.promise;
    },
    {
      requestId: session.id,
      surface: "explore",
      priority: "foreground",
      requestType: "searchText",
      generationRequestId: session.id,
      exploreSession: session,
    },
  );
  await started.promise;
  session.controller.abort();
  d.resolve(result("old"));
  assert.equal(await pending, null);
});
for (const [primary, expected] of [
  ["bar", "酒吧"],
  ["breakfast_restaurant", "早餐店"],
  ["hotel", "飯店"],
  ["hot_pot_restaurant", "火鍋店"],
])
  await check(`explicit provider ${primary} retained`, () => {
    const p = normalizeGooglePlace({
      id: "fixture-primary",
      name: "Example",
      primaryType: primary,
      types: ["breakfast_restaurant", primary, "establishment"],
    });
    assert.equal(p.primaryType, primary);
    assert.equal(recommendationPlaceType(p)[0], expected);
  });
await check("legacy type remains candidate, not primary", () => {
  const p = normalizeGooglePlace({ id: "fixture-legacy", name: "Example", type: "hotel" });
  assert.equal(p.primaryType, null);
  assert(p.types.includes("hotel"));
  assert.equal(recommendationPlaceType(p)[0], "飯店");
});
await check("all specific/generic permutations preserve absent primary", () => {
  const permute = (xs) =>
    xs.length
      ? xs.flatMap((x, i) => permute(xs.filter((_, j) => j !== i)).map((rest) => [x, ...rest]))
      : [[]];
  for (const types of permute(["hotel", "lodging", "establishment", "point_of_interest"])) {
    const p = normalizeGooglePlace({ id: "fixture-order", name: "Example", types });
    assert.equal(p.primaryType, null);
    assert.equal(recommendationPlaceType(p)[0], "飯店");
  }
});
console.log(`PASS ${count} search commit/provenance scenarios`);
