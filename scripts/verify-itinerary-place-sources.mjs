import assert from "node:assert/strict";

function computeItineraryFetchTarget(days) {
  return Math.min(Math.max(days, 3), 8);
}

function canBuildItineraryFromPlaceCount(count) {
  return count >= 1;
}

function dayIndexForPlace(placeIndex, placeCount, dayCount) {
  if (placeCount <= 0 || dayCount <= 0) return 0;
  if (placeCount >= dayCount) return Math.min(placeIndex, dayCount - 1);
  return Math.min(Math.floor((placeIndex * dayCount) / placeCount), dayCount - 1);
}

assert.equal(computeItineraryFetchTarget(10), 8);
assert.equal(canBuildItineraryFromPlaceCount(6), true);
assert.equal(canBuildItineraryFromPlaceCount(0), false);

const daySlots = Array.from({ length: 6 }, (_, i) => dayIndexForPlace(i, 6, 10));
assert.equal(new Set(daySlots).size, 6, "6 places should spread across 6 distinct days");

console.log("verify-itinerary-place-sources: ok");
