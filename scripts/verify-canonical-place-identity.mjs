import assert from "node:assert/strict";
import {
  resolveCanonicalPlaceIdentity,
  resolveGooglePlaceId,
} from "../src/lib/place-canonical-identity.ts";
import { dedupePlaces, placeIdentityKey } from "../src/lib/place-planning-memory.ts";
import { resolveTripPlaceId } from "../src/lib/ai/ai-trip-place-allocator.ts";
import { resolvePlanningPlaceId } from "../src/lib/ai/planning-real-place.ts";

const placeResult = (id, name) => ({
  id,
  name,
  address: "Bennelong Point",
  lat: -33.85678,
  lng: 151.2153,
  rating: null,
  userRatingCount: null,
  photoName: null,
  primaryType: "tourist_attraction",
  businessStatus: null,
  openStatus: "unknown",
  openStatusLabel: "",
  todayHoursLabel: "",
  closingSoonNote: "",
  nextOpenHint: "",
});

const googleId = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const zh = resolveCanonicalPlaceIdentity({ id: googleId, name: "雪梨歌劇院" });
const en = resolveCanonicalPlaceIdentity({ googlePlaceId: googleId, name: "Sydney Opera House" });
assert.equal(zh.identityKey, en.identityKey);
assert.equal(zh.source, "google_place_id");
assert.equal(zh.isGooglePlaceId, true);
assert.equal(dedupePlaces([
  { name: "雪梨歌劇院", placeId: googleId },
  { name: "Sydney Opera House", placeId: googleId },
]).length, 1);
assert.equal(resolveTripPlaceId(placeResult(googleId, "雪梨歌劇院")), zh.identityKey);
assert.equal(resolvePlanningPlaceId(placeResult(googleId, "雪梨歌劇院")), googleId);

const resource = resolveCanonicalPlaceIdentity({ placeId: `places/${googleId}` });
assert.equal(resource.identityKey, zh.identityKey);
assert.equal(resource.googlePlaceId, googleId);

for (const input of [
  { placeId: "origin:home" },
  { googlePlaceId: "geocode:22.1,120.2" },
]) {
  const result = resolveCanonicalPlaceIdentity(input);
  assert.equal(result.googlePlaceId, null);
  assert.equal(result.isGooglePlaceId, false);
  assert.equal(result.source, "deterministic_fallback");
}
assert.equal(resolvePlanningPlaceId(placeResult("origin:home", "住處")), "");

const canonical = resolveCanonicalPlaceIdentity({ canonicalPlaceId: "roamie-place-42" });
assert.equal(canonical.source, "canonical_id");
assert.equal(canonical.isGooglePlaceId, false);

const saved = resolveCanonicalPlaceIdentity({ id: "550e8400-e29b-41d4-a716-446655440000" });
assert.equal(saved.source, "saved_id");
assert.equal(resolveGooglePlaceId({ id: saved.canonicalPlaceId }), null);

const locationA = resolveCanonicalPlaceIdentity({
  name: "海濱公園", address: "A 區", lat: 25.033, lng: 121.5654,
});
const locationB = resolveCanonicalPlaceIdentity({
  name: "海濱公園", address: "B 區", lat: 25.043, lng: 121.5754,
});
assert.notEqual(locationA.identityKey, locationB.identityKey);

const stableA = resolveCanonicalPlaceIdentity({
  name: "  海濱 公園 ", address: "A 區", lat: 25.0330001, lng: 121.5654001,
});
assert.equal(stableA.identityKey, locationA.identityKey);
assert.equal(placeIdentityKey({ name: "中文名稱", placeId: googleId }), zh.identityKey);

console.log("verify-canonical-place-identity: ok");
