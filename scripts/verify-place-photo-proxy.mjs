import assert from "node:assert/strict";
import {
  buildPlacePhotoUpstreamUrl,
  handlePlacePhotoRequest,
  validatePhotoResource,
} from "../src/routes/api/place-photo.ts";

const key = "AIza" + "x".repeat(35);
const shortResource = "places/ChIJ_short/photos/short_photo";
const longResource = `places/ChIJ_long/photos/${"A".repeat(434)}`;
const opaqueSpecialCharacters = ".~%+-=_:@!$&'(),;[]";
const opaqueResource = `places/opaque-place~id/photos/${`${opaqueSpecialCharacters}Az09`.repeat(40)}`;
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
    resolveServerKey: () => ({ key, source: "GOOGLE_MAPS_API_KEY" }),
    recordHttpCall: () => {},
    timeoutMs,
  };
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

for (const resource of [longResource, shortResource, opaqueResource]) {
  const encoded = encodeURIComponent(resource);
  const roundTrip = new URL(`https://roamie.tw/?photo=${encoded}`).searchParams.get("photo");
  assert.equal(roundTrip, resource, "encodeURIComponent and URLSearchParams must round-trip");
  assert.equal(
    validatePhotoResource(roundTrip).valid,
    true,
    "opaque URI-safe characters are valid",
  );
  const response = await handlePlacePhotoRequest(
    requestFor(resource),
    dependencies(async (url) => {
      assert.ok(url instanceof URL);
      assert.equal(url.origin, "https://places.googleapis.com");
      assert.equal(url.pathname, `/v1/${resource}/media`);
      assert.equal(url.searchParams.get("key"), key);
      assert.doesNotMatch(url.pathname, new RegExp(key));
      return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
    }),
  );
  assert.equal(response.status, 200, `${resource.length}-character resource should be accepted`);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
}

const opaqueUpstreamUrl = buildPlacePhotoUpstreamUrl(opaqueResource, 600, key);
assert.equal(opaqueUpstreamUrl.pathname, `/v1/${opaqueResource}/media`);
assert.match(opaqueUpstreamUrl.pathname, /%/);
assert.doesNotMatch(opaqueUpstreamUrl.pathname, /%25/);
assert.match(opaqueUpstreamUrl.pathname, /^\/v1\/places\//);
assert.match(opaqueUpstreamUrl.pathname, /\/photos\/.+\/media$/);
assert.equal(opaqueUpstreamUrl.searchParams.get("key"), key);

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
  assert.ok(response.headers.get("x-roamie-photo-validation"));
  assert.equal(upstreamCalls, before, "invalid resources must not reach the upstream");
}

const extraSlashDiagnostic = validatePhotoResource("places/id/photos/photo/extra");
assert.equal(extraSlashDiagnostic.reason, "segment_count");
assert.equal(extraSlashDiagnostic.firstInvalidCharacterCodePoint, 47);
assert.equal(extraSlashDiagnostic.invalidCharacterCategory, "path_separator");

const queryDiagnostic = validatePhotoResource("places/id/photos/photo?query");
assert.equal(queryDiagnostic.firstInvalidCharacterCodePoint, 63);
assert.equal(queryDiagnostic.invalidCharacterCategory, "query");

const controlDiagnostic = validatePhotoResource("places/id/photos/photo\u0001control");
assert.equal(controlDiagnostic.firstInvalidCharacterCodePoint, 1);
assert.equal(controlDiagnostic.invalidCharacterCategory, "control");

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
assert.equal(timeoutResponse.headers.get("x-roamie-photo-failure-stage"), "timeout");
assert.equal(timeoutResponse.headers.get("x-roamie-photo-error-name"), "AbortError");
assert.equal(timeoutResponse.headers.get("x-roamie-photo-key-source"), "GOOGLE_MAPS_API_KEY");
assert.equal(timeoutResponse.headers.get("x-roamie-photo-upstream-url-valid"), "true");
assert.equal(timeoutResponse.headers.get("x-roamie-photo-upstream-path-segment-count"), "6");

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
assert.equal(oversizedResponse.headers.get("x-roamie-photo-failure-stage"), "response_size");

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

const secretSentinel = "AIza-secret-must-not-leak";
const resourceSentinel = "places/private/photos/private-resource";
const keyFailure = await handlePlacePhotoRequest(requestFor(resourceSentinel), {
  ...dependencies(async () => new Response(jpeg)),
  resolveServerKey: () => ({ key: null, source: "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY" }),
});
assert.equal(keyFailure.status, 500);
assert.equal(keyFailure.headers.get("x-roamie-photo-failure-stage"), "key_resolution");
assert.equal(
  keyFailure.headers.get("x-roamie-photo-key-source"),
  "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
);
assert.equal(keyFailure.headers.get("x-roamie-photo-error-name"), "Error");
const serializedFailure = [...keyFailure.headers.entries()].flat().join(" ");
assert.doesNotMatch(serializedFailure, new RegExp(secretSentinel));
assert.doesNotMatch(serializedFailure, new RegExp(resourceSentinel));

const upstreamFailure = await handlePlacePhotoRequest(
  requestFor(shortResource),
  dependencies(async () => new Response("forbidden", { status: 403 })),
);
assert.equal(upstreamFailure.status, 502);
assert.equal(upstreamFailure.headers.get("x-roamie-photo-failure-stage"), "upstream_status");
assert.equal(upstreamFailure.headers.get("x-roamie-photo-upstream-status"), "403");

const successfulHeaders = await handlePlacePhotoRequest(
  requestFor(shortResource),
  dependencies(async () => new Response(jpeg, { headers: { "content-type": "image/jpeg" } })),
);
assert.equal(successfulHeaders.headers.get("x-roamie-photo-failure-stage"), null);
assert.equal(successfulHeaders.headers.get("x-roamie-photo-key-source"), null);

const receiverSensitiveResponse = await handlePlacePhotoRequest(requestFor(opaqueResource), {
  ...dependencies(async () => new Response(jpeg, { headers: { "content-type": "image/jpeg" } })),
  fetch: async function (url) {
    assert.equal(this, undefined, "native fetch dependency must be invoked without a receiver");
    assert.ok(url instanceof URL);
    return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
  },
});
assert.equal(receiverSensitiveResponse.status, 200);

assert.equal(longResource.split("/photos/")[1].length, 434);
console.log("verify-place-photo-proxy: ok");
