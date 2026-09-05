import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildPlaceMapsUrl } from "../src/lib/maps-navigation.ts";
import {
  InvalidTripPlaceInputError,
  normalizeTripPlaceInput,
  tripPlaceFromPlaceResult,
  tripPlaceFromSavedPlace,
} from "../src/lib/trip/trip-place-input.ts";

const googleId = "ChIJN1t_tDeuEmsRUsoyG83frY4";

test("Map/Explore/Detail/Home PlaceResult adapter no longer sends lng as placeName", () => {
  const result = tripPlaceFromPlaceResult({
    id: googleId,
    name: "Test Place",
    address: "Test address",
    lat: 22.62,
    lng: 120.3,
    rating: null,
    userRatingCount: null,
    photoName: null,
    primaryType: "cafe",
    types: ["cafe"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  });
  assert.match(result.googleMapsUrl, /query=Test\+Place/);
  assert.equal(result.googlePlaceId, googleId);
});

test("maps URL contract is lat, lng, label and accepts no invalid trim target", () => {
  assert.match(buildPlaceMapsUrl(22.62, 120.3, "A Place", googleId), /query=A\+Place/);
});

test("string, structured and missing address normalize explicitly", () => {
  assert.equal(normalizeTripPlaceInput({ name: "A", address: " Road ", lat: 1, lng: 2 }).address, "Road");
  assert.equal(normalizeTripPlaceInput({ name: "A", address: { text: "Road" }, lat: 1, lng: 2 }).address, "Road");
  assert.equal(normalizeTripPlaceInput({ name: "A", lat: 1, lng: 2 }).address, "");
});

test("localized name and category structured values use documented text/value only", () => {
  const place = normalizeTripPlaceInput({
    name: { text: "Localized Place" },
    category: { value: "cafe" },
    lat: 1,
    lng: 2,
  });
  assert.equal(place.name, "Localized Place");
  assert.equal(place.placeType, "cafe");
});

test("types arrays and arbitrary category objects are not String-coerced", () => {
  const place = normalizeTripPlaceInput({ name: "A", category: { code: 3 }, types: ["cafe"], lat: 1, lng: 2 });
  assert.equal(place.placeType, undefined);
  assert.doesNotMatch(JSON.stringify(place), /\[object Object\]/);
});

test("Google ID wins while synthetic ID remains canonical only", () => {
  const google = normalizeTripPlaceInput({ name: "A", googlePlaceId: googleId, canonicalPlaceId: "internal:a", lat: 1, lng: 2 });
  assert.equal(google.googlePlaceId, googleId);
  const internal = normalizeTripPlaceInput({ name: "A", canonicalPlaceId: "internal:a", lat: 1, lng: 2 });
  assert.equal(internal.googlePlaceId, undefined);
  assert.equal(internal.canonicalPlaceId, "internal:a");
});

test("legacy saved place remains compatible", () => {
  const result = tripPlaceFromSavedPlace({ name: "Legacy", address: null, lat: 1, lng: 2, category: "park" });
  assert.equal(result.name, "Legacy");
  assert.equal(result.placeType, "park");
});

test("invalid input rejects before itinerary mutation", () => {
  assert.throws(
    () => normalizeTripPlaceInput({ name: { unexpected: true }, lat: 1, lng: 2 }),
    (error) => error instanceof InvalidTripPlaceInputError && error.code === "invalid_trip_place_input",
  );
  assert.throws(() => normalizeTripPlaceInput({ name: "A", lat: 1, lng: "2" }));
});

test("all product surfaces identify themselves at the shared provider boundary", () => {
  const files = [
    ["../src/routes/_app.map.tsx", ["explore", "map"]],
    ["../src/routes/_app.place.tsx", ["place_detail"]],
    ["../src/routes/_app.chat.tsx", ["chat"]],
    ["../src/routes/_app.index.tsx", ["home"]],
    ["../src/routes/_app.recommendations.tsx", ["selection"]],
    ["../src/routes/_app.saved.index.tsx", ["favorites"]],
  ];
  for (const [file, surfaces] of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const surface of surfaces) assert.match(source, new RegExp(`openAddToTrip\\([^\\n]+\\"${surface}\\"`));
  }
});

test("post-start interaction errors are classified as runtime, not startup", () => {
  for (const file of ["../src/lib/log-error.ts", "./capacitor-prepare.mjs"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /APP_RUNTIME_ERROR/);
    assert.match(source, /started \? \"APP_INIT_ERROR\" : \"APP_RUNTIME_ERROR\"/);
  }
});
