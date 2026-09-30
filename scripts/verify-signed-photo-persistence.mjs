import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-photo-persistence-"));
const outfile = path.join(dir, "persistence.mjs");
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  location: { href: "https://roamie.test/app", origin: "https://roamie.test" },
  localStorage: globalThis.localStorage,
};
globalThis.__imageSrcs = [];
globalThis.__network = { sign: 0, photoGet: 0, sessionReads: 0, tableReads: 0 };
globalThis.Image = class FakeImage {
  decoding = "async";
  onload = null;
  onerror = null;
  set src(value) {
    globalThis.__imageSrcs.push(String(value));
    queueMicrotask(() => this.onload?.());
  }
};
globalThis.fetch = async (url, init) => {
  const href = String(url);
  const network = globalThis.__network;
  if (href.includes("/api/place-photo/sign")) {
    network.sign += 1;
    const body = JSON.parse(init.body);
    const expires = Math.floor(Date.now() / 1000) + 600;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        url: `/api/place-photo?photo=${encodeURIComponent(body.photo)}&w=${body.width}&expires=${expires}&signature=fresh-${network.sign}`,
      }),
    };
  }
  if (href.includes("/api/place-photo")) {
    network.photoGet += 1;
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
  }
  throw new Error("unexpected fetch");
};

await build({
  stdin: {
    contents: `
      import assert from "node:assert/strict";
      import fs from "node:fs";
      import * as cache from "./src/services/image-cache.ts";
      import * as signer from "./src/services/signed-place-photo.ts";
      const network = globalThis.__network;
      const imageSrcs = globalThis.__imageSrcs;
      const persisted = () => JSON.parse(globalThis.localStorage.getItem("roamie:image-cache") || "{}");
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const PHOTO_A = "places/persistence-a/photos/resource-a";
      const PHOTO_B = "places/persistence-b/photos/resource-b";
      const expiredUrl = (photo) => "/api/place-photo?photo=" + encodeURIComponent(photo) + "&w=480&expires=100&signature=stale-capability";
      const unsplash = "https://images.unsplash.com/photo-persistence?auto=format";
      function assertNoCapability(record, label) {
        const text = JSON.stringify(record);
        assert.equal(text.includes("signature="), false, label);
        assert.equal(text.includes("/api/place-photo"), false, label);
      }
      const beforeSign = network.sign;
      const beforeGet = network.photoGet;
      const fresh = await signer.getSignedPlacePhotoUrl(PHOTO_A, 480);
      assert.ok(fresh && fresh.includes("signature="), "A fresh signed URL returned");
      assert.equal(network.sign, beforeSign + 1, "A one sign");
      assert.equal(network.photoGet, beforeGet, "A signing does not GET the photo");
      imageSrcs.length = 0;
      await cache.prefetchImageUrl(fresh);
      assert.equal(imageSrcs.length, 1, "A fresh capability can be displayed");
      assert.equal(imageSrcs[0].includes("fresh-"), true, "A display uses the fresh capability");
      cache.setCachedImage(cache.cacheKey("home-place-cover", "place-a"), fresh);
      assertNoCapability(persisted(), "B fresh signed URL is not persisted");
      assert.equal(cache.getCachedImage(cache.cacheKey("home-place-cover", "place-a")), null, "B read is a miss");
      const staleKey = cache.cacheKey("home-place-cover", "place-stale");
      globalThis.localStorage.setItem("roamie:image-cache", JSON.stringify({ [staleKey]: { url: expiredUrl(PHOTO_A), at: Date.now() } }));
      assert.equal(cache.getCachedImage(staleKey), null, "C expired signed URL is a miss");
      assert.equal(JSON.stringify(persisted()).includes("stale-capability"), false, "C stale entry removed");
      assert.equal(cache.recoverPersistedSignedPhoto(staleKey), PHOTO_A, "E canonical photo resource recovered");
      imageSrcs.length = 0;
      const getsBeforeReload = imageSrcs.filter((src) => src.includes("/api/place-photo")).length;
      const signsBeforeReload = network.sign;
      globalThis.localStorage.setItem("roamie:image-cache", JSON.stringify({ [cache.cacheKey("home-place-cover", "place-reload")]: { url: expiredUrl(PHOTO_B), at: Date.now() } }));
      cache.prefetchPlaceCoverUrls([{ placeId: "place-reload", url: expiredUrl(PHOTO_B), photoName: PHOTO_B }]);
      await wait(80);
      const photoLoads = imageSrcs.filter((src) => src.includes("/api/place-photo"));
      assert.equal(photoLoads.some((src) => src.includes("stale-capability")), false, "D no GET of expired URL");
      assert.equal(network.sign, signsBeforeReload + 1, "D one re-sign");
      assert.equal(photoLoads.length, getsBeforeReload + 1, "D one GET of the new capability");
      assert.equal(photoLoads.at(-1).includes("fresh-"), true, "D prefetch uses the new signature");
      assertNoCapability(persisted(), "D re-signed URL is not persisted");
      const signsBeforeMemory = network.sign;
      const again = await signer.getSignedPlacePhotoUrl(PHOTO_B, 480);
      assert.equal(again, imageSrcs.at(-1), "F memory cache returns the fresh URL");
      assert.equal(network.sign, signsBeforeMemory, "F memory cache does not sign again");
      const nearPhoto = "places/near/photos/expiry";
      const nearExpiry = "/api/place-photo?photo=" + encodeURIComponent(nearPhoto) + "&w=480&expires=" + (Math.floor(Date.now() / 1000) + 10) + "&signature=near";
      cache.rememberPhotoUrl(nearPhoto, 480, nearExpiry);
      assert.equal(cache.getRememberedPhotoUrl(nearPhoto, 480).includes("near"), true, "F unexpired remembered URL stays available");
      cache.rememberPhotoUrl(nearPhoto, 480, expiredUrl(nearPhoto));
      assert.equal(cache.getRememberedPhotoUrl(nearPhoto, 480), null, "F expired remembered URL is not reused");
      const signsBeforeMargin = network.sign;
      const shortLivedPhoto = "places/margin/photos/short";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (!String(url).includes("/api/place-photo/sign")) return originalFetch(url, init);
        network.sign += 1;
        const body = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ url: "/api/place-photo?photo=" + encodeURIComponent(body.photo) + "&w=" + body.width + "&expires=" + (Math.floor(Date.now() / 1000) + 10) + "&signature=short-lived" }) };
      };
      const shortLived = await signer.getSignedPlacePhotoUrl(shortLivedPhoto, 320);
      assert.ok(shortLived && shortLived.includes("short-lived"));
      assert.equal(signer.readSignedPlacePhotoUrl(shortLivedPhoto, 320), null, "F under 30s remaining is not reused");
      assert.equal(network.sign, signsBeforeMargin + 1);
      globalThis.fetch = originalFetch;
      cache.setCachedImage(cache.cacheKey("unsplash", "cafe"), unsplash);
      assert.ok(cache.getCachedImage(cache.cacheKey("unsplash", "cafe")).includes("images.unsplash.com"), "G unsplash cache remains");
      assert.equal(JSON.stringify(persisted()).includes("images.unsplash.com"), true, "G unsplash is persisted");
      const signsBeforePair = network.sign;
      const getsBeforePair = network.photoGet;
      const [known, created] = await Promise.all([
        signer.getSignedPlacePhotoUrl(PHOTO_A, 480),
        signer.getSignedPlacePhotoUrl("places/persistence-c/photos/resource-c", 480),
      ]);
      assert.ok(known && known.includes("signature=") && created && created.includes("signature="), "L two resources both resolve");
      assert.equal(network.sign, signsBeforePair + 1, "L known photo hits memory; new photo signs once");
      assert.equal(network.photoGet, getsBeforePair, "L resolution does not GET upstream");
      const signsBeforeDup = network.sign;
      await Promise.all([
        signer.getSignedPlacePhotoUrl("places/persistence-d/photos/resource-d", 480),
        signer.getSignedPlacePhotoUrl("places/persistence-d/photos/resource-d", 480),
      ]);
      assert.equal(network.sign, signsBeforeDup + 1, "L concurrent duplicate collapses to one sign");
      const signsBeforeFail = network.sign;
      globalThis.fetch = async (url) => {
        if (String(url).includes("/api/place-photo/sign")) {
          network.sign += 1;
          return { ok: false, status: 503, json: async () => ({}) };
        }
        throw new Error("unexpected");
      };
      assert.equal(await signer.getSignedPlacePhotoUrl("places/persistence-e/photos/resource-e", 480), null, "M failed sign settles");
      assert.equal(network.sign - signsBeforeFail, 2, "M existing signer retries once, then stops");
      globalThis.fetch = originalFetch;
      assert.equal(network.tableReads, 0, "N no table polling");
      assert.ok(network.sessionReads <= network.sign, "N session reads stay within sign attempts");
      const surfaces = {
        home: fs.readFileSync("src/components/home/HomeNearbyPlaceCards.tsx", "utf8"),
        nearbyPrefetch: fs.readFileSync("src/lib/home-startup.ts", "utf8"),
        indexPrefetch: fs.readFileSync("src/routes/_app.index.tsx", "utf8"),
        detail: fs.readFileSync("src/components/map/PlaceDetailSheet.tsx", "utf8"),
        favorites: fs.readFileSync("src/components/saved/SavedPlaceCoverThumb.tsx", "utf8"),
        trip: fs.readFileSync("src/components/media/TripCoverImage.tsx", "utf8"),
        coverHook: fs.readFileSync("src/hooks/use-place-cover-image.ts", "utf8"),
      };
      assert.equal(surfaces.home.includes("PlaceCoverImage"), true, "H home uses PlaceCoverImage");
      assert.equal(surfaces.nearbyPrefetch.includes("prefetchPlaceCoverUrls"), true, "H nearby prefetch uses the guarded helper");
      assert.equal(surfaces.indexPrefetch.includes("prefetchPlaceCoverUrls"), true, "H home refresh prefetch uses the guarded helper");
      assert.equal(surfaces.detail.includes("SafeImage"), true, "I place detail signs through SafeImage");
      assert.equal(surfaces.detail.includes("setCachedImage"), false, "I place detail does not persist signed URLs");
      assert.equal(surfaces.favorites.includes("PlaceImage"), true, "J favorites use the signing image hook");
      assert.equal(surfaces.favorites.includes("setCachedImage"), false, "J favorites do not write the 24h cache");
      assert.equal(surfaces.trip.includes("image-cache"), false, "K trip cover does not use the 24h image cache");
      assert.equal(surfaces.coverHook.includes("setCachedImage"), false, "cover hook does not persist the signed URL");
      console.log(JSON.stringify({ result: "PASS", network, delta: { staleEviction: "0 expired GET, 1 re-sign, 1 fresh GET" } }));
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  define: {
    "import.meta.env.DEV": "false",
    "import.meta.env.VITE_VERBOSE_LOG": "\"0\"",
  },
  loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl" },
  plugins: [
    {
      name: "mock-supabase",
      setup(build) {
        build.onResolve({ filter: /supabase\/client$/ }, () => ({
          path: "supabase-mock",
          namespace: "mock",
        }));
        build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          loader: "ts",
          contents: `
            export const supabase = {
              auth: {
                getSession: async () => {
                  globalThis.__network.sessionReads += 1;
                  return { data: { session: { access_token: "fixture-token" } } };
                },
              },
              from() {
                globalThis.__network.tableReads += 1;
                throw new Error("unexpected table read");
              },
            };
          `,
        }));
      },
    },
  ],
});

await import(pathToFileURL(outfile).href);
