import assert from "node:assert/strict";
import fs from "node:fs";
import {
  signPlacePhoto,
  verifyPlacePhotoSignature,
} from "../src/lib/place-photo-signature.server.ts";

const env = { PLACE_PHOTO_SIGNING_SECRET: "test-signing-secret-at-least-32-bytes" };
const photo = "places/ChIJ_test/photos/photo-token";
const token = await signPlacePhoto(env, photo, 600, 1_000);
assert.equal(
  await verifyPlacePhotoSignature(env, photo, 600, token.expires, token.signature, 1_001),
  true,
);
assert.equal(
  await verifyPlacePhotoSignature(env, `${photo}x`, 600, token.expires, token.signature, 1_001),
  false,
);
assert.equal(
  await verifyPlacePhotoSignature(env, photo, 800, token.expires, token.signature, 1_001),
  false,
);
assert.equal(
  await verifyPlacePhotoSignature(env, photo, 600, token.expires, token.signature, 2_000),
  false,
);
assert.equal(
  await verifyPlacePhotoSignature({}, photo, 600, token.expires, token.signature, 1_001),
  false,
);
await assert.rejects(() => signPlacePhoto({ PLACE_PHOTO_SIGNING_SECRET: "too-short" }, photo, 600));

const proxy = fs.readFileSync("src/routes/api/place-photo.ts", "utf8");
const signer = fs.readFileSync("src/routes/api/place-photo/sign.ts", "utf8");
const client = fs.readFileSync("src/services/signed-place-photo.ts", "utf8");
const safeImage = fs.readFileSync("src/components/media/SafeImage.tsx", "utf8");
const coverHook = fs.readFileSync("src/hooks/use-place-cover-image.ts", "utf8");
assert.match(proxy, /verifyPlacePhotoSignature/);
assert.match(proxy, /validatePhotoResource/);
assert.match(proxy, /MAX_PHOTO_BYTES/);
assert.match(proxy, /checkRateLimit/);
assert.match(proxy, /max-age=300, s-maxage=540/);
assert.match(signer, /requireAuthenticatedAiRequest/);
assert.match(client, /Authorization: `Bearer \$\{token\}`/);
assert.match(safeImage, /getSignedPlacePhotoUrl/);
assert.match(coverHook, /getSignedPlacePhotoUrl/);
assert.doesNotMatch(`${proxy}\n${signer}\n${client}`, /X-Goog-Api-Key.*VITE_/);
console.log("Place photo signed access regression: PASS");
