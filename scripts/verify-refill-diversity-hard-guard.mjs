import assert from "node:assert/strict";
import { refillMissingDaySlots } from "../src/lib/ai/ai-multi-day-planner.ts";
import {
  classifyDailyDiversityCategory,
  resolveDailyDiversityLimits,
} from "../src/lib/ai/daily-category-diversity.ts";

function place(id, primaryType, types = [primaryType], extra = {}) {
  return {
    id,
    name: `${primaryType} ${id}`,
    address: "Fixture City",
    lat: 35 + id.length * 0.0001,
    lng: 139,
    rating: 4.5,
    userRatingCount: 500,
    photoName: null,
    primaryType,
    types,
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    ...extra,
  };
}

function entry(candidate, time = "09:00", label = "景點") {
  return { time, label, name: candidate.name, place: candidate };
}

function assertWithinCaps(plans) {
  const limits = resolveDailyDiversityLimits({ style: "mixed" });
  for (const plan of plans) {
    const counts = new Map();
    for (const item of plan.entries) {
      const family = classifyDailyDiversityCategory(item.place);
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    for (const [family, count] of counts) {
      const cap = limits[family];
      if (typeof cap === "number") {
        assert.ok(count <= cap, `day ${plan.day} ${family}: ${count}>${cap}`);
      }
    }
  }
}

const museum = place("ChIJMuseumOne", "museum");
const gallery = place("ChIJGalleryTwo", "art_gallery", ["art_gallery", "museum"]);
const scienceMuseum = place("ChIJScienceMuseumThree", "science_museum", [
  "science_museum",
  "museum",
]);
const park = place("ChIJParkFour", "park", ["park", "tourist_attraction"]);
const viewpoint = place("ChIJViewpointFive", "observation_deck", [
  "observation_deck",
  "tourist_attraction",
]);
const attraction = place("ChIJAttractionSix", "tourist_attraction");

assert.deepEqual(
  [museum, gallery, scienceMuseum].map(classifyDailyDiversityCategory),
  ["museum_family", "museum_family", "museum_family"],
);

const museumFallback = refillMissingDaySlots({
  plans: [{ day: 1, entries: [] }],
  pool: [museum, gallery, scienceMuseum, park, viewpoint, attraction],
  days: 1,
  style: "mixed",
  preservePartialDays: true,
});
assertWithinCaps(museumFallback);
assert.ok(
  museumFallback[0].entries.some(
    (item) => classifyDailyDiversityCategory(item.place) === "museum_family",
  ),
  "the first museum remains eligible",
);
assert.ok(
  museumFallback[0].entries.some(
    (item) => classifyDailyDiversityCategory(item.place) !== "museum_family",
  ),
  "refill continues to a different family after rejecting museum overflow",
);

const mixedFamilies = refillMissingDaySlots({
  plans: [{ day: 1, entries: [] }],
  pool: [museum, park, viewpoint, attraction],
  days: 1,
  style: "mixed",
  preservePartialDays: true,
});
assertWithinCaps(mixedFamilies);
assert.ok(mixedFamilies[0].entries.length >= 3, "legal mixed families still refill the day");

const restaurant = place("ChIJRestaurantMeal", "restaurant", ["restaurant", "food"]);
const mealResult = refillMissingDaySlots({
  plans: [{ day: 1, entries: [] }],
  pool: [restaurant, museum, park, viewpoint, attraction],
  days: 1,
  style: "mixed",
  preservePartialDays: true,
});
assert.ok(
  mealResult[0].entries.some((item) => item.place.id === restaurant.id),
  "restaurant remains eligible under the unlimited family contract",
);

const required = place("ChIJRequiredAnchor", "museum", ["museum"], {
  isRequiredBySelection: true,
});
const requiredResult = refillMissingDaySlots({
  plans: [{ day: 1, entries: [entry(required)] }],
  pool: [required, gallery, park, viewpoint, attraction],
  days: 1,
  style: "mixed",
  preservePartialDays: true,
});
assert.equal(
  requiredResult[0].entries.filter((item) => item.place.id === required.id).length,
  1,
  "required identity is preserved exactly once",
);
assertWithinCaps(requiredResult);

const sixDayPool = Array.from({ length: 36 }, (_, index) =>
  place(`ChIJGenericAttraction${index}`, "tourist_attraction"),
);
const sixDays = refillMissingDaySlots({
  plans: Array.from({ length: 6 }, (_, index) => ({ day: index + 1, entries: [] })),
  pool: sixDayPool,
  days: 6,
  style: "mixed",
  preservePartialDays: true,
});
assert.ok(sixDays.every((plan) => plan.entries.length >= 3), "six-day minimum coverage remains");
assertWithinCaps(sixDays);

console.log("verify-refill-diversity-hard-guard: OK");
