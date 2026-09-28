import assert from "node:assert/strict";
import { build, stop } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const dir = mkdtempSync(join(tmpdir(), "google-transport-"));
const original = globalThis.fetch;
const originalWindow = globalThis.window;
try {
  const file = join(dir, "fixture.cjs");
  await build({
    stdin: {
      contents: `export {googleRestFetch} from './src/lib/google-rest-transport'; export {googleRestRequest} from './src/lib/google-rest-contract';export {computeRouteFromClient} from './src/lib/google-routes-client';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    loader: { ".png": "dataurl", ".jpg": "dataurl" },
    platform: "node",
    format: "cjs",
    outfile: file,
    define: {
      "import.meta.env": JSON.stringify({ SSR: false, VITE_APP_ORIGIN: "https://roamie.example" }),
    },
    plugins: [
      {
        name: "session",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/auth-session$/ }, () => ({
            path: "session",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents: "export const getClientAuthSession=async()=>globalThis.fixtureSession",
            loader: "js",
          }));
        },
      },
    ],
  });
  const { googleRestFetch, googleRestRequest, computeRouteFromClient } = createRequire(
    import.meta.url,
  )(file);
  globalThis.fixtureSession = { access_token: "verified-session-fixture" };
  let requests = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, globalThis.window ? "https://roamie.example/api/google" : "/api/google");
    assert.equal(init.headers.Authorization, "Bearer verified-session-fixture");
    assert.ok(!init.body.includes("AIza"));
    assert.ok(!init.body.includes("X-Goog-Api-Key"));
    const input = JSON.parse(init.body);
    const spec = googleRestRequest(input);
    requests.push(spec);
    return Response.json(
      spec.url.includes("/directions/json")
        ? {
            status: "OK",
            routes: [{ legs: [{ duration: { value: 600 }, distance: { value: 1000 } }] }],
          }
        : {
            routes: [{ duration: "600s", distanceMeters: 1000 }],
            places: [],
            suggestions: [],
            results: [],
          },
    );
  };
  const publicKey = "AIza" + "x".repeat(35);
  for (const request of [
    {
      url: "https://places.googleapis.com/v1/places:searchText",
      body: { textQuery: "Tokyo", pageSize: 20 },
    },
    {
      url: "https://places.googleapis.com/v1/places:searchNearby",
      body: {
        maxResultCount: 20,
        locationRestriction: { circle: { center: { latitude: 35, longitude: 139 }, radius: 1000 } },
      },
    },
    {
      url: "https://places.googleapis.com/v1/places:autocomplete",
      body: { input: "Tokyo", includedPrimaryTypes: ["(regions)"] },
    },
    {
      url: "https://places.googleapis.com/v1/places/ChIJfixture?languageCode=ja",
      fields: "id,location,addressComponents",
    },
    { url: "https://maps.googleapis.com/maps/api/geocode/json?address=Tokyo&key=" + publicKey },
    { url: "https://maps.googleapis.com/maps/api/geocode/json?latlng=35,139&key=" + publicKey },
  ]) {
    const res = await googleRestFetch(request.url, {
      method: request.body ? "POST" : "GET",
      headers: {
        "X-Goog-Api-Key": publicKey,
        ...(request.fields ? { "X-Goog-FieldMask": request.fields } : {}),
      },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    });
    assert.equal(res.status, 200);
  }
  for (const mode of ["DRIVE", "WALK", "TRANSIT"]) {
    const result = await computeRouteFromClient({ lat: 35, lng: 139 }, { lat: 36, lng: 140 }, mode);
    assert.equal(result.ok, true);
    assert.equal(result.data.durationMinutes, 10);
    assert.equal(result.data.distanceMeters, 1000);
  }
  globalThis.window = {
    Capacitor: { isNativePlatform: () => true },
    location: { origin: "null", href: "capacitor://localhost/index.html" },
  };
  for (const mode of ["DRIVE", "WALK", "TRANSIT"]) {
    const result = await computeRouteFromClient({ lat: 35, lng: 139 }, { lat: 36, lng: 140 }, mode);
    assert.equal(result.ok, true);
    assert.equal(result.data.durationMinutes, 10);
    assert.equal(result.data.distanceMeters, 1000);
    assert.ok(requests.at(-1).url.includes("/directions/json"));
  }
  assert.equal(requests.length, 12);
  assert.ok(requests.some((r) => r.fields === "id,location,addressComponents"));
  globalThis.fixtureSession = null;
  assert.equal(
    (await googleRestFetch("https://maps.googleapis.com/maps/api/geocode/json?address=Tokyo"))
      .status,
    401,
  );
  assert.equal(requests.length, 12);
  console.log(
    "PASS actual browser transport: 12 browser/native Places/geocode/DRIVE/WALK/TRANSIT operations, only authenticated Roamie requests, no Google key, field masks preserved, missing session blocks network",
  );
} finally {
  globalThis.fetch = original;
  globalThis.window = originalWindow;
  delete globalThis.fixtureSession;
  stop();
  rmSync(dir, { recursive: true, force: true });
}
