import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateAssemblyRecipientDiversity } from "../src/lib/ai/planner-day-route-assembly.ts";
import { classifyDailyDiversityCategory } from "../src/lib/ai/daily-category-diversity.ts";

function place(id, primaryType, types = [primaryType]) {
  return {
    id,
    name: `${primaryType} ${id}`,
    address: "Fixture City",
    lat: 35,
    lng: 139,
    rating: 4.5,
    userRatingCount: 500,
    primaryType,
    types,
    businessStatus: "OPERATIONAL",
  };
}

function entry(candidate) {
  return {
    time: "10:00",
    label: "景點",
    name: candidate.name,
    place: candidate,
  };
}

const museum = place("ChIJMuseum", "museum");
const gallery = place("ChIJGallery", "art_gallery", ["art_gallery", "museum"]);
const scienceMuseum = place("ChIJScience", "science_museum", ["science_museum", "museum"]);
const park = place("ChIJPark", "park", ["park", "tourist_attraction"]);
const park2 = place("ChIJPark2", "national_park", ["national_park", "park"]);
const viewpoint = place("ChIJViewpoint", "observation_deck", [
  "observation_deck",
  "tourist_attraction",
]);
const viewpoint2 = place("ChIJViewpoint2", "scenic_spot", ["scenic_spot", "observation_deck"]);
const restaurant = place("ChIJRestaurant", "restaurant", ["restaurant", "food"]);

assert.deepEqual(
  [museum, gallery, scienceMuseum].map(classifyDailyDiversityCategory),
  ["museum_family", "museum_family", "museum_family"],
  "museum, gallery, and science museum share the capped museum family",
);

for (const [sourcePath, candidate] of [
  ["route-displaced", gallery],
  ["phase-4", scienceMuseum],
  ["phase-5b", gallery],
  ["singleton", scienceMuseum],
]) {
  const result = evaluateAssemblyRecipientDiversity([entry(museum)], candidate, "mixed");
  assert.equal(result.accepted, false, `${sourcePath} must reject museum-family overflow`);
  assert.equal(result.family, "museum_family");
  assert.equal(result.currentCount, 1);
  assert.equal(result.cap, 1);
}

const parkResult = evaluateAssemblyRecipientDiversity([entry(park)], park2, "mixed");
assert.equal(parkResult.accepted, false, "park-family donor overflow is rejected");
assert.equal(parkResult.family, "park_family");

const viewpointResult = evaluateAssemblyRecipientDiversity([entry(viewpoint)], viewpoint2, "mixed");
assert.equal(viewpointResult.accepted, false, "viewpoint-family reinsertion overflow is rejected");
assert.equal(viewpointResult.family, "viewpoint_family");

const mixedResult = evaluateAssemblyRecipientDiversity([entry(museum)], park, "mixed");
assert.equal(mixedResult.accepted, true, "a different capped family remains eligible");

const mealResult = evaluateAssemblyRecipientDiversity(
  [entry(restaurant), entry(restaurant)],
  restaurant,
  "mixed",
);
assert.equal(mealResult.accepted, true, "restaurant keeps the existing unlimited contract");

const source = fs.readFileSync(
  fileURLToPath(new URL("../src/lib/ai/planner-day-route-assembly.ts", import.meta.url)),
  "utf8",
);
for (const sourcePath of [
  "route_displaced_reinsertion",
  "phase_4_donor_move",
  "phase_5b_donor_move",
  "singleton_absorption",
]) {
  assert.match(
    source,
    new RegExp(`sourcePath: ["']${sourcePath}["']`),
    `${sourcePath} must use the shared recipient diversity decision`,
  );
}

console.log("verify-planner-assembly-recipient-diversity: OK");
