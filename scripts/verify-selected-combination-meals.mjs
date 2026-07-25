import assert from "node:assert/strict";
import {
  isSelectedCombinationMealCandidate,
  supplementMealsForSelectedCombinationItinerary,
} from "../src/lib/ai/real-place-supplement.ts";
import {
  buildMixedItineraryWithDiagnostics,
  isMixedItineraryDiningCandidate,
} from "../src/lib/trip/mixed-itinerary-schedule.ts";

function rec(id, name, type, lat, lng, types = [type]) {
  return {
    name,
    type,
    primaryType: type,
    types,
    description: name,
    reason: "fixture",
    estimatedTime: "1 小時",
    address: "Fixture City",
    lat,
    lng,
    googleMapsUrl: "",
    placeName: name,
    reasonSource: "template",
    googlePlaceId: id,
  };
}

const scenic = Array.from({ length: 6 }, (_, index) =>
  rec(
    `ChIJScenicFixture${index}`,
    `Scenic ${index}`,
    "tourist_attraction",
    35 + index * 0.001,
    139,
  ),
);
const meals = Array.from({ length: 4 }, (_, index) =>
  rec(`ChIJMealFixture${index}`, `Restaurant ${index}`, "restaurant", 35 + index * 0.002, 139.001),
);
const built = buildMixedItineraryWithDiagnostics(
  [...scenic, ...meals],
  2,
  "2027-01-10",
  "Fixture City",
  { selectedCombinationIds: [1] },
);
for (const date of ["2027-01-10", "2027-01-11"]) {
  const dayMeals = built.stops.filter(
    (stop) => stop.date === date && (stop.types ?? []).includes("restaurant"),
  );
  assert.equal(dayMeals.length, 2, `${date} should contain lunch and dinner`);
  assert.deepEqual(
    dayMeals.map((stop) => stop.time),
    ["12:00", "18:30"],
  );
}
const mealIds = built.stops
  .filter((stop) => (stop.types ?? []).includes("restaurant"))
  .map((stop) => stop.googlePlaceId);
assert.equal(new Set(mealIds).size, mealIds.length, "meal place IDs must not repeat");
assert.equal(
  built.stops.some(
    (stop) => stop.placeType === "tourist_attraction" && ["12:00", "18:30"].includes(stop.time),
  ),
  false,
  "scenic places must not occupy meal times",
);

const secondaryRestaurant = rec(
  "ChIJSecondaryRestaurant",
  "Secondary Restaurant",
  "establishment",
  35,
  139,
  ["establishment", "restaurant", "food"],
);
assert.equal(isMixedItineraryDiningCandidate(secondaryRestaurant), true);
assert.equal(
  isSelectedCombinationMealCandidate({
    ...secondaryRestaurant,
    id: secondaryRestaurant.googlePlaceId,
  }),
  true,
);
assert.equal(
  isMixedItineraryDiningCandidate(
    rec("ChIJPureCafeFixture", "Pure Cafe", "cafe", 35, 139, ["cafe", "coffee_shop"]),
  ),
  false,
);
for (const type of ["supermarket", "grocery_store", "convenience_store"]) {
  assert.equal(
    isSelectedCombinationMealCandidate({
      id: `ChIJExcluded${type}`,
      lat: 35,
      lng: 139,
      primaryType: type,
      types: [type, "food"],
      businessStatus: "OPERATIONAL",
    }),
    false,
  );
}

const scarce = buildMixedItineraryWithDiagnostics(
  [...scenic, meals[0]],
  2,
  "2027-01-10",
  "Fixture City",
  { selectedCombinationIds: [1] },
);
assert.equal(
  scarce.stops.filter((stop) => (stop.types ?? []).includes("restaurant")).length,
  1,
  "one restaurant must not be repeated across four slots",
);

let searchCalls = 0;
const discovered = await supplementMealsForSelectedCombinationItinerary({
  destination: "Fixture City",
  tripDays: 1,
  existingPlaces: scenic,
  lat: 35,
  lng: 139,
  locale: "en",
  searchPlaces: async () => {
    searchCalls += 1;
    return {
      places: meals.slice(0, 2).map((place) => ({
        id: place.googlePlaceId,
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        rating: 4.5,
        userRatingCount: 100,
        photoName: null,
        primaryType: place.primaryType,
        types: place.types,
        businessStatus: "OPERATIONAL",
        openStatus: "unknown",
        openStatusLabel: "",
        todayHoursLabel: "",
        closingSoonNote: "",
        nextOpenHint: "",
      })),
    };
  },
});
assert.ok(searchCalls > 0, "meal discovery must run even when scenic candidates are sufficient");
assert.equal(discovered.length, 2);

console.log("selected-combination meal verification passed");
