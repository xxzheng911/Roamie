import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

// Real adapter and real workerd fetch. All outbound traffic terminates at a mock.
const key = "AIza" + "x".repeat(35);
const entry = `import {fetchGoogleRestProvider} from './src/lib/google-rest-provider.server';
export default {async fetch(request) {
 const {input,exception}=await request.json();
 return fetchGoogleRestProvider(input,{GOOGLE_PLACES_SERVER_API_KEY:${JSON.stringify(key)}},
 exception ? async()=>{throw new TypeError('synthetic network failure')} : fetch);
}};`;
const result = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
let status = 200,
  calls = 0,
  payload = {},
  lastRequest;
const worker = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    compatibilityDate: "2025-09-24",
    compatibilityFlags: ["nodejs_compat"],
    script: result.outputFiles[0].text,
    outboundService: async (request) => {
      calls++;
      lastRequest = {
        method: request.method,
        path: new URL(request.url).pathname,
        hasKey: request.headers.get("X-Goog-Api-Key") === key,
        hasAuthorization: request.headers.has("Authorization"),
      };
      return new Response(JSON.stringify(payload), {
        status,
        headers: {
          "Content-Type": "application/json",
          ...(status >= 300 && status < 400
            ? { Location: "https://redirect-target.invalid/private" }
            : {}),
        },
      });
    },
  }),
);
const fixtures = [
  {
    url: "https://places.googleapis.com/v1/places:searchText",
    method: "POST",
    fieldMask: "places.id",
    body: { textQuery: "Tokyo Station Japan", pageSize: 1 },
  },
  {
    url: "https://places.googleapis.com/v1/places:searchNearby",
    method: "POST",
    fieldMask: "places.id",
    body: {
      locationRestriction: { circle: { center: { latitude: 0, longitude: 0 }, radius: 100 } },
      maxResultCount: 1,
    },
  },
  {
    url: "https://places.googleapis.com/v1/places:autocomplete",
    method: "POST",
    fieldMask: "suggestions.placePrediction.placeId",
    body: { input: "Tokyo" },
  },
  { url: "https://places.googleapis.com/v1/places/synthetic", method: "GET", fieldMask: "id" },
];
async function invoke(input, exception = false) {
  calls = 0;
  const r = await worker.dispatchFetch("https://test", {
    method: "POST",
    body: JSON.stringify({ input, exception }),
  });
  return { response: r, json: await r.json() };
}
try {
  for (const input of fixtures) {
    status = 200;
    payload = input.url.includes("autocomplete")
      ? { suggestions: [{ placePrediction: { placeId: "synthetic" } }] }
      : input.method === "GET"
        ? { id: "synthetic" }
        : { places: [{ id: "synthetic" }] };
    const r = await invoke(input);
    assert.equal(r.response.status, 200);
    assert.deepEqual(r.json, payload);
    assert.equal(calls, 1);
    assert.equal(lastRequest.hasKey, true);
    assert.equal(lastRequest.hasAuthorization, false);
    assert.equal(lastRequest.method, input.method);
  }
  console.log("PASS workerd 200: four Places operations, outbound reached, JSON parsed");
  for (const upstream of [301, 302, 307, 308, 400, 401, 403, 429, 500, 503]) {
    status = upstream;
    payload = { error: { message: "private-provider-body " + key, status: "PRIVATE_DIAGNOSTIC" } };
    const r = await invoke(fixtures[0]);
    assert.equal(calls, 1, "must not follow redirect");
    assert.equal(r.response.headers.has("Location"), false);
    const expected = upstream === 400 ? 400 : upstream === 429 ? 429 : 502;
    assert.equal(r.response.status, expected);
    assert.deepEqual(r.json, {
      error: {
        status:
          expected === 400
            ? "INVALID_ARGUMENT"
            : expected === 429
              ? "RESOURCE_EXHAUSTED"
              : "UPSTREAM_UNAVAILABLE",
        message: "google_upstream_unavailable",
      },
    });
  }
  console.log(
    "PASS workerd 301/302/307/308: one outbound, no follow, no Location or raw error body; 4xx/5xx sanitized",
  );
  const r = await invoke(fixtures[0], true);
  assert.equal(calls, 0);
  assert.equal(r.response.status, 502);
  assert.deepEqual(r.json, { error: "google_upstream_unavailable" });
  console.log("PASS workerd fetch exception: existing sanitized 502 contract");
  status = 200;
  payload = { places: [{ id: "synthetic", testSecret: key }] };
  const redacted = await invoke(fixtures[0]);
  assert.equal(JSON.stringify(redacted.json).includes(key), false);
  console.log("PASS success credential redaction; no real credentials or external requests");
} finally {
  await worker.dispose();
}
