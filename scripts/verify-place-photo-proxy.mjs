import assert from "node:assert/strict";
import { handlePlacePhotoRequest } from "../src/routes/api/place-photo.ts";

const key = "AIza" + "x".repeat(35);
const shortResource = "places/ChIJ_short/photos/short_photo";
const longResource = `places/ChIJ_long/photos/${"A".repeat(434)}`;
let upstreamCalls = 0;

function requestFor(photo, suffix = "") {
  return new Request(
    `https://roamie.tw/api/place-photo?photo=${encodeURIComponent(photo)}&w=600${suffix}`,
    { headers: { "cf-connecting-ip": `198.51.100.${upstreamCalls + 1}` } },
  );
}

function dependencies(fetchImpl, timeoutMs = 8_000) {
  return {
    fetch: async (...args) => {
      upstreamCalls += 1;
      return fetchImpl(...args);
    },
    requireServerKey: () => key,
    recordHttpCall: () => {},
    timeoutMs,
  };
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

for (const resource of [longResource, shortResource]) {
  const response = await handlePlacePhotoRequest(
    requestFor(resource),
    dependencies(async (url) => {
      assert.match(String(url), /^https:\/\/places\.googleapis\.com\/v1\/places\//);
      return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
    }),
  );
  assert.equal(response.status, 200, `${resource.length}-character resource should be accepted`);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
}

const invalidResources = [
  "places/id/photos/photo/extra",
  "places/id/photos/photo?redirect=1",
  "places/id/photos/photo#fragment",
  "places/id/photos/photo with space",
  " places/id/photos/photo",
  "places/id/photos/photo\u0001control",
  "other/id/photos/photo",
  "places//photos/photo",
  "places/id/photos/",
];

for (const resource of invalidResources) {
  const before = upstreamCalls;
  const response = await handlePlacePhotoRequest(
    requestFor(resource),
    dependencies(async () => new Response(jpeg)),
  );
  assert.equal(response.status, 400, `${JSON.stringify(resource)} should be rejected`);
  assert.equal(upstreamCalls, before, "invalid resources must not reach the upstream");
}

const pngResponse = await handlePlacePhotoRequest(
  requestFor(shortResource),
  dependencies(async () => new Response(png, { headers: { "content-type": "image/png" } })),
);
assert.equal(pngResponse.status, 200);
assert.equal(pngResponse.headers.get("content-type"), "image/png");

const timeoutResponse = await handlePlacePhotoRequest(
  requestFor(shortResource),
  dependencies(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    5,
  ),
);
assert.equal(timeoutResponse.status, 500, "upstream timeout must remain enforced");

const oversizedResponse = await handlePlacePhotoRequest(
  requestFor(shortResource),
  dependencies(
    async () =>
      new Response(jpeg, {
        headers: { "content-type": "image/jpeg", "content-length": String(8 * 1024 * 1024 + 1) },
      }),
  ),
);
assert.equal(oversizedResponse.status, 502, "responses above 8 MB must remain rejected");

const oversizedBodyResponse = await handlePlacePhotoRequest(
  requestFor(shortResource),
  dependencies(
    async () =>
      new Response(new Uint8Array(8 * 1024 * 1024 + 1), {
        headers: { "content-type": "image/jpeg" },
      }),
  ),
);
assert.equal(oversizedBodyResponse.status, 502, "undeclared bodies above 8 MB must be rejected");

assert.equal(longResource.split("/photos/")[1].length, 434);
console.log("verify-place-photo-proxy: ok");
