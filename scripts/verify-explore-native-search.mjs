import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "roamie-native-search-"));
const file = join(dir, "fixture.cjs");
const entry = `export {createUnifiedSearchPlacesFn} from './src/lib/places-search-unified';
export {beginExploreRequestSession,markExplorePrimaryResult} from './src/lib/explore-request-session';
export {resetPlacesProviderLimiterForTests,notePlacesWindowCallForTests} from './src/lib/places-api-guard';
export {clearPlacesRateProtection,clearPlacesQueryCooldown} from './src/lib/ai/places-cost-cache';
export {runExploreMapPlaceSearch} from './src/lib/explore-map-search';`;
await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: file,
  loader: { ".png": "dataurl", ".jpg": "dataurl" },
  define: {
    "import.meta.env": JSON.stringify({ VITE_GOOGLE_MAPS_API_KEY: "AIza" + "a".repeat(35) }),
  },
  plugins: [
    {
      name: "fixture-auth",
      setup(b) {
        b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /^@tanstack\/react-start$/ }, () => ({
          path: "framework",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /^@\/integrations\/supabase\/auth-middleware$/ }, () => ({
          path: "middleware",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
          contents:
            a.path === "framework"
              ? 'export const createServerFn=()=>({middleware(){return this},inputValidator(){return this},handler(){return async()=>{throw Error("Unexpected server function")}}});'
              : a.path === "middleware"
                ? "export const requireSupabaseAuth={};"
                : "export const isSupabaseConfigured=false;export const supabase={auth:{getSession:async()=>({data:{session:null}})}};",
          loader: "js",
        }));
      },
    },
  ],
});
const require = createRequire(import.meta.url);
const api = require(file);
const previousWindow = globalThis.window,
  previousFetch = globalThis.fetch;
globalThis.window = {
  Capacitor: { isNativePlatform: () => true },
  location: { origin: "null", href: "capacitor://localhost/index.html" },
  dispatchEvent: () => {},
};
const raw = {
  id: "ChIJ_NativeTower",
  displayName: { text: "N Seoul Tower" },
  location: { latitude: 37.55, longitude: 126.98 },
  types: ["tourist_attraction"],
  primaryType: "tourist_attraction",
};
let calls = 0;
const search = api.createUnifiedSearchPlacesFn(async () => {
  throw Error("native must not call server transport");
});
const data = (s, query) => ({
  data: {
    lat: 25,
    lng: 121,
    radius: 5000,
    query,
    mode: "text",
    locale: "zh-TW",
    categoryId: "search",
    placesScreen: "explore",
    placesCaller: "map.freeTextSearch",
    placesExploreSessionId: s.id,
    skipLocationBias: true,
    searchMode: "destination",
  },
});
try {
  api.resetPlacesProviderLimiterForTests();
  api.clearPlacesRateProtection();
  api.clearPlacesQueryCooldown();
  for (let i = 0; i < 25; i++) api.notePlacesWindowCallForTests();
  let s = api.beginExploreRequestSession("search", "首爾塔");
  globalThis.fetch = async (url) => {
    assert.match(String(url), /places:searchText/);
    calls++;
    return Response.json({ places: [raw] });
  };
  const [a, b] = await Promise.all([search(data(s, "首爾塔")), search(data(s, "首爾塔"))]);
  assert.equal(a.places[0]?.id, raw.id);
  assert.equal(b.places[0]?.id, raw.id);
  assert.equal(calls, 1);
  assert.equal(s.dedupedRequests, 1);
  assert.equal(s.blockedRequests, 0);
  api.markExplorePrimaryResult(s);
  assert.equal(s.totalRequestsBeforePrimary, 1);
  // A hot local window must not be converted into provider cooldown by the adapter.
  api.resetPlacesProviderLimiterForTests();
  api.clearPlacesRateProtection();
  api.clearPlacesQueryCooldown();
  s = api.beginExploreRequestSession("search", "cancel same key");
  let started;
  const startedPromise = new Promise((r) => (started = r));
  globalThis.fetch = (url, init) =>
    new Promise((_, reject) => {
      calls++;
      started();
      init.signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  const stale = search(data(s, "cancel same key"));
  const staleRejected = assert.rejects(stale, { name: "AbortError" });
  await startedPromise;
  const next = api.beginExploreRequestSession("search", "cancel same key");
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ places: [raw] });
  };
  const fresh = await search(data(next, "cancel same key"));
  await staleRejected;
  assert.equal(fresh.places[0]?.id, raw.id);
  assert.equal(next.foregroundRequests, 1);
  assert.equal(next.blockedRequests, 0);
  // Native autocomplete no longer performs Details for every suggestion.
  api.resetPlacesProviderLimiterForTests();
  api.clearPlacesQueryCooldown();
  s = api.beginExploreRequestSession("search", "tower suggestions");
  let autocompleteCalls = 0;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /places:autocomplete/);
    autocompleteCalls++;
    return Response.json({
      suggestions: Array.from({ length: 10 }, (_, i) => ({
        placePrediction: {
          placeId: "ChIJ_Suggestion" + i,
          text: { text: "Tower " + i },
          types: ["point_of_interest"],
        },
      })),
    });
  };
  const suggestions = await api.runExploreMapPlaceSearch("tower suggestions", {
    locale: "zh-TW",
    center: { lat: 25, lng: 121 },
    requestSession: s,
    searchFn: async () => {
      throw Error("unexpected server");
    },
  });
  assert.equal(suggestions.suggestions.length, 10);
  assert.equal(autocompleteCalls, 1);
  assert.equal(s.foregroundRequests, 1);
  console.log(
    "PASS native adapter: hot-window foreground grant, in-flight dedupe, stale same-key replacement, 10 autocomplete suggestions / 1 request / 0 Details",
  );
} finally {
  globalThis.fetch = previousFetch;
  globalThis.window = previousWindow;
  rmSync(dir, { recursive: true, force: true });
}
