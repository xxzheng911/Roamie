import assert from "node:assert/strict";
import {
  getPlaceDetails,
  isPlaceLite,
  isTripPlaceInput,
  normalizePlace,
  normalizePlacesServiceInput,
} from "../src/services/placesService.ts";

const googleId = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const tripInput = {
  name: "測試地點",
  placeName: "測試地點",
  title: "測試地點",
  address: "測試地址",
  lat: 25.03,
  lng: 121.56,
  googlePlaceId: googleId,
};
assert.equal(isTripPlaceInput(tripInput), true);
assert.equal(isPlaceLite(tripInput), false);
assert.equal(normalizePlacesServiceInput(tripInput).googlePlaceId, googleId);

const lite = {
  placeId: `places/${googleId}`,
  name: "",
  address: "",
  lat: null,
  lng: null,
};
assert.equal(isPlaceLite(lite), true);
assert.equal(isTripPlaceInput(lite), false);
assert.equal(normalizePlacesServiceInput(lite).googlePlaceId, googleId);
assert.equal(normalizePlace(lite).placeId, googleId);

for (const invalid of ["", "geocode:test", "origin:home", "saved-place-42"]) {
  let calls = 0;
  const result = await getPlaceDetails(invalid, {
    resolveFn: async () => {
      calls += 1;
      return { stop: null, error: null };
    },
  });
  assert.equal(result.place, null);
  assert.equal(result.errorCode, "missing_place_id");
  assert.equal(calls, 0);
}

let resolveCalls = 0;
const resolveFn = async ({ data }) => {
  resolveCalls += 1;
  return {
    stop: {
      placeId: data.placeId,
      label: "API 顯示名稱",
      name: "API 顯示名稱",
      address: "API 地址",
      lat: 25.03,
      lng: 121.56,
      placeType: "tourist_attraction",
      googleMapsUrl: "https://maps.google.com/",
      photoName: null,
      rating: 4.5,
    },
    error: null,
  };
};
const valid = await getPlaceDetails(`places/${googleId}`, { resolveFn });
assert.equal(valid.error, null);
assert.equal(valid.place?.placeId, googleId);
assert.equal(valid.place?.name, "API 顯示名稱");
assert.equal(resolveCalls, 1);

const cached = await getPlaceDetails(googleId, { resolveFn });
assert.equal(cached.place?.placeId, googleId);
assert.equal(resolveCalls, 2, "valid ID preserves the existing PlaceLite resolver request count");

console.log("verify-places-service-input-boundary: ok");
