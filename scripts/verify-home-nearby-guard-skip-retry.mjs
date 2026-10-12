import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "roamie-home-guard-retry-"));
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
    "import.meta.env": JSON.stringify({
      SSR: false,
      VITE_APP_ORIGIN: "https://roamie.example",
      VITE_GOOGLE_MAPS_API_KEY: "AIza" + "a".repeat(35),
    }),
  },
  plugins: [
    {
      name: "fixture-auth",
      setup(b) {
        b.onResolve({ filter: /^@\/lib\/auth-session$/ }, (args) =>
          args.importer.endsWith("/google-rest-transport.ts")
            ? { path: "session", namespace: "fixture" }
            : null,
        );
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
        b.onResolve({ filter: /^@\/lib\/public-read-auth$/ }, () => ({
          path: "public-read",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
          contents:
            a.path === "session"
              ? 'export const getClientAuthSession=async()=>({access_token:"fixture-session"});'
              : a.path === "framework"
                ? 'export const createMiddleware=()=>({server:()=>({})});export const createServerFn=()=>({middleware(){return this},inputValidator(){return this},handler(){return async()=>{throw Error("Unexpected server function")}}});'
                : a.path === "public-read"
                  ? "export const allowGuestPublicRead={};"
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
  id: "ChIJ_HomeNearbyCafe",
  displayName: { text: "Fixture Cafe" },
  location: { latitude: 22.664, longitude: 120.305 },
  types: ["cafe"],
  primaryType: "cafe",
  rating: 4.6,
  userRatingCount: 500,
  businessStatus: "OPERATIONAL",
};
let calls = 0;
globalThis.fetch = async () => { calls++; return Response.json({ places: [raw] }); };
const search = api.createUnifiedSearchPlacesFn(async () => {
  throw Error("native must not call server transport");
});
// Home nearby has no Explore session: it relies on the one-attempt client fallback mark.
const home = () => ({
  data: {
    lat: 22.664, lng: 120.305, radius: 2500, query: "附近 cafe", mode: "nearby",
    includedTypes: ["cafe"], locale: "zh-TW", categoryId: "home_generic_cafe",
    placesScreen: "home", placesCaller: "loadHomeNearbyPicks",
  },
});
try {
  api.resetPlacesProviderLimiterForTests();
  api.clearPlacesRateProtection();
  api.clearPlacesQueryCooldown();
  for (let i = 0; i < 25; i++) api.notePlacesWindowCallForTests();
  const blocked = await search(home());
  console.log("hot window:", JSON.stringify({ error: blocked.error ?? null, places: blocked.places.length, calls }));
  assert.equal(blocked.places.length, 0);
  assert.equal(calls, 0, "guard skip sends no provider request");
  // Window cools (limiter state only; no budget raised).
  api.resetPlacesProviderLimiterForTests();
  api.clearPlacesRateProtection();
  api.clearPlacesQueryCooldown();
  const retried = await search(home());
  console.log("cooled window:", JSON.stringify({ error: retried.error ?? null, places: retried.places.length, calls }));
  assert.notEqual(retried.error, "places_client_fallback_already_attempted", "a guard skip is not a provider attempt");
  assert.equal(retried.places[0]?.id, raw.id, "home nearby recovers after cooldown");
  assert.equal(calls, 1, "exactly one provider request");
  const again = await search(home());
  assert.equal(again.places[0]?.id, raw.id);
  assert.equal(calls, 1, "a real attempt is not repeated");
  console.log("PASS home nearby retries after a guard skip without extra provider calls");
} finally {
  globalThis.window = previousWindow;
  globalThis.fetch = previousFetch;
  rmSync(dir, { recursive: true, force: true });
}
