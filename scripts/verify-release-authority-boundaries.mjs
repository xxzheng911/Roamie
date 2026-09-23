/** Release audit: controlled completion order and adapter provenance, no provider requests. */
import assert from "node:assert/strict";
import { getPlacesSearchCachedOrRun } from "../src/lib/places-search-dedupe";
import {
  readUnifiedPlaceSearchCache,
  buildUnifiedPlaceCacheKey,
} from "../src/lib/unified-place-cache";
import { normalizeGooglePlace } from "../src/lib/ai/normalize-google-place";
import { recommendationPlaceType } from "../src/lib/place-identity";

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("Release authority audit must not fetch");
};
const storage = new Map();
const originalStorage = globalThis.localStorage;
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  key: (index) => [...storage.keys()][index] ?? null,
  get length() {
    return storage.size;
  },
};
let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log("PASS", name);
  } catch (error) {
    failures++;
    console.error("FAIL", name, error.message);
  }
}
await check("cancelled search cannot overwrite replacement cache", async () => {
  const controller = new AbortController();
  let completeOld;
  const key = "release-audit-cancelled-search";
  const old = getPlacesSearchCachedOrRun(
    key,
    () =>
      new Promise((resolve) => {
        completeOld = resolve;
      }),
    { signal: controller.signal },
  );
  let ui = null;
  let downstream = 0;
  const stalePublication = old.then((result) => {
    ui = result.places[0]?.id;
    downstream++;
  });
  const rejected = assert.rejects(stalePublication, { name: "AbortError" });
  controller.abort();
  const result = (id) => ({ places: [{ id, name: id, lat: 37, lng: 127 }], error: null });
  const fresh = await getPlacesSearchCachedOrRun(key, async () => result("new-result"), {
    signal: new AbortController().signal,
  });
  ui = fresh.places[0]?.id;
  completeOld(result("old-result"));
  await rejected;
  let refetches = 0;
  const cached = await getPlacesSearchCachedOrRun(key, async () => {
    refetches++;
    return result("unexpected");
  });
  console.log(
    "CACHE_COMPLETION_TRACE",
    JSON.stringify({
      UI: ui,
      memory: cached.places[0]?.id,
      persistent: JSON.parse(storage.get(`roamie:unified-place:v1:${key}`)).data.places[0]?.id,
      downstream,
      refetches,
    }),
  );
  assert.equal(cached.places[0]?.id, "new-result");
  assert.equal(ui, "new-result");
  assert.equal(downstream, 0);
  assert.equal(
    JSON.parse(storage.get(`roamie:unified-place:v1:${key}`)).data.places[0]?.id,
    "new-result",
  );
  assert.equal(
    readUnifiedPlaceSearchCache(
      buildUnifiedPlaceCacheKey({
        placeId: "old-result",
        category: "detail",
        language: "zh-TW",
        lat: 37,
        lng: 127,
      }),
    ),
    null,
  );
  assert(![...storage.values()].some((value) => value.includes("old-result")));
});
await check("normalizer must not invent primary authority from types array order", () => {
  const types = ["breakfast_restaurant", "bar", "restaurant"];
  const outcomes = [
    types,
    ["bar", "restaurant", "breakfast_restaurant"],
    ["restaurant", "breakfast_restaurant", "bar"],
  ].map((types) => {
    const normalized = normalizeGooglePlace(
      {
        id: "fixture-adapter-authority",
        displayName: { text: "Example Sky Bar" },
        location: { latitude: 35, longitude: 139 },
        types,
      },
      { locale: "zh-TW" },
    );
    return {
      types,
      normalizedPrimary: normalized.primaryType,
      label: recommendationPlaceType(normalized)[0],
    };
  });
  assert(outcomes.every((o) => o.normalizedPrimary == null));
  console.log("ADAPTER_AUTHORITY_TRACE", JSON.stringify({ providerPrimary: null, outcomes }));
  assert.deepEqual(
    outcomes.map((o) => o.label),
    ["酒吧", "酒吧", "酒吧"],
  );
});
globalThis.fetch = originalFetch;
globalThis.localStorage = originalStorage;
console.log(`Release authority boundaries: ${2 - failures}/2 PASS`);
process.exitCode = failures ? 1 : 0;
