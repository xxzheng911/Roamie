/**
 * Directions location formatting + stop identity (no live API).
 */
import assert from "node:assert/strict";
import { formatDirectionsLocation } from "../src/lib/directions-endpoint.ts";
import {
  checkStopNavigationIdentity,
  isApproximateCoordinateSource,
  resolveRouteRegionProfile,
} from "../src/lib/saved-trip/stop-navigation.ts";

console.log("=== directions place_id preference ===\n");

const withPlaceId = formatDirectionsLocation({
  placeId: "ChIJu9e0tGPtaDURswodnJ4lsOU",
  coords: { lat: 33.5, lng: 126.5 },
});
assert.equal(withPlaceId, "place_id:ChIJu9e0tGPtaDURswodnJ4lsOU");

const coordsOnly = formatDirectionsLocation({
  coords: { lat: 33.5059, lng: 126.5329 },
});
assert.equal(coordsOnly, "33.5059,126.5329");

assert.equal(isApproximateCoordinateSource("approx_center"), true);
assert.equal(isApproximateCoordinateSource("google_places"), false);

const approxNoId = checkStopNavigationIdentity({
  placeName: "某處海岸",
  lat: 33.29,
  lng: 126.36,
  coordinateSource: "approx_center",
});
assert.equal(approxNoId.useForDirections, false);

const withId = checkStopNavigationIdentity({
  placeName: "挾才海水浴場",
  googlePlaceId: "ChIJu9e0tGPtaDURswodnJ4lsOU",
  lat: 33.39,
  lng: 126.24,
  coordinateSource: "approx_center",
});
assert.equal(withId.useForDirections, true);
assert.equal(withId.placeId, "ChIJu9e0tGPtaDURswodnJ4lsOU");

assert.equal(
  resolveRouteRegionProfile("濟州島, 韓國", 9_000, "kr"),
  "island_rural",
);

console.log("verify-directions-place-id: ok");
