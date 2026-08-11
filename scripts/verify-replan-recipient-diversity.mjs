import assert from "node:assert/strict";
import {
  repairLongRouteLegs,
  repairNonNavigableStops,
  repairReplaceClosedPlaces,
  repairRedistributeAcrossDays,
} from "../src/lib/ai/itinerary-validator/replan.ts";
import { repairDayPlanSlots } from "../src/lib/ai/ai-day-plan-slot-rules.ts";
import {
  classifyPlanPlaceKind,
  resolveEntryLabel,
} from "../src/lib/ai/ai-day-plan-source.ts";
import {
  classifyDailyDiversityCategory,
  resolveDailyDiversityLimits,
} from "../src/lib/ai/daily-category-diversity.ts";
import { buildSelectedPlaceLock } from "../src/lib/ai/required-anchor-runtime.ts";

function place(id, name, primaryType, types = [primaryType], lat = 35, lng = 139, extra = {}) {
  return {
    id,
    name,
    address: "Fixture City",
    lat,
    lng,
    rating: 4.6,
    userRatingCount: 1000,
    primaryType,
    types,
    businessStatus: "OPERATIONAL",
    coordinateSource: "google_places",
    ...extra,
  };
}

function entry(candidate, time = "10:00") {
  return { time, label: "景點", name: candidate.name, place: candidate };
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
      if (typeof cap === "number") assert.ok(count <= cap, `day ${plan.day}: ${family}`);
    }
  }
}

const museumA = place("ChIJMuseumA", "Museum A", "museum", ["museum", "tourist_attraction"]);
const museumB = place("ChIJMuseumB", "Museum B", "art_gallery", ["art_gallery", "museum"]);
const museumC = place("ChIJMuseumC", "Museum C", "science_museum", ["science_museum", "museum"]);
assert.deepEqual(
  [museumA, museumB, museumC].map(classifyDailyDiversityCategory),
  ["museum_family", "museum_family", "museum_family"],
);

// Long-route repair skips the nearest overflowing museum day and uses the next legal day.
const longMuseum = place(
  "ChIJLongMuseum",
  "Long Museum",
  "museum",
  ["museum", "tourist_attraction"],
  35.3,
  139,
);
const nearestMuseum = place("ChIJNearMuseum", "Near Museum", "museum", ["museum"], 35.31, 139);
const legalAnchor = place("ChIJLegalAnchor", "Legal Anchor", "tourist_attraction", ["tourist_attraction"], 35.35, 139);
const longRoute = repairLongRouteLegs(
  [
    { day: 1, entries: [entry(place("ChIJOrigin", "Origin", "park", ["park"], 35, 139)), entry(longMuseum)] },
    { day: 2, entries: [entry(nearestMuseum)] },
    { day: 3, entries: [entry(legalAnchor)] },
  ],
  3,
  "mixed",
);
assert.equal(longRoute[1].entries.some((item) => item.place.id === longMuseum.id), false);
assert.equal(longRoute[2].entries.some((item) => item.place.id === longMuseum.id), true);
assertWithinCaps(longRoute);

// Non-navigable replacement rejects the museum overflow and continues to another family.
const bad = place("", "Broken Place", "museum", ["museum", "tourist_attraction"], 35, 139, {
  coordinateSource: "approx",
});
const alternate = place("ChIJAlternate", "Alternate", "tourist_attraction", ["tourist_attraction"], 35.02, 139);
const nonNavigable = repairNonNavigableStops(
  [{ day: 1, entries: [entry(museumA), entry(bad)] }],
  [museumB, alternate],
  1,
  "mixed",
);
assert.equal(nonNavigable[0].entries[1].place.id, alternate.id);
assertWithinCaps(nonNavigable);

// Closed replacement follows the same replacement-after-removal family contract.
const closed = place("ChIJClosed", "Closed Museum", "museum", ["museum", "tourist_attraction"], 35, 139, {
  businessStatus: "CLOSED_PERMANENTLY",
});
const closedResult = repairReplaceClosedPlaces(
  [{ day: 1, entries: [entry(museumA), entry(closed)] }],
  [museumB, alternate],
  1,
  "mixed",
  undefined,
);
assert.equal(closedResult[0].entries[1].place.id, alternate.id);
assertWithinCaps(closedResult);

const park = place("ChIJPark", "Park", "park", ["park"]);
const park2 = place("ChIJPark2", "Park 2", "national_park", ["national_park", "park"]);
const viewpoint = place("ChIJView", "View", "observation_deck", ["observation_deck"]);
const viewpoint2 = place("ChIJView2", "View 2", "scenic_spot", ["scenic_spot", "observation_deck"]);
const attraction = place("ChIJAttraction", "Attraction", "tourist_attraction");
const attraction2 = place("ChIJAttraction2", "Attraction 2", "tourist_attraction");
const slotResult = repairDayPlanSlots(
  [{ day: 1, entries: [entry(museumA), entry(park), entry(viewpoint)] }],
  [museumB, museumC, park2, viewpoint2, attraction, attraction2],
  "mixed",
  classifyPlanPlaceKind,
  resolveEntryLabel,
  1,
);
assertWithinCaps(slotResult);

// Redistribution scans beyond consecutive capped-family candidates.
const redistributed = repairRedistributeAcrossDays(
  [{ day: 1, entries: [entry(museumA), entry(museumB), entry(museumC)] }, { day: 2, entries: [] }, { day: 3, entries: [] }],
  [park, viewpoint, attraction, attraction2],
  3,
  "mixed",
  undefined,
  undefined,
  true,
  null,
);
assertWithinCaps(redistributed);

// Required museum identities remain present; feasible days spread them without deletion.
const requiredLock = buildSelectedPlaceLock({
  selectedPlaceNames: [museumA.name, museumB.name],
  placeIds: [museumA.id, museumB.id],
});
const requiredResult = repairRedistributeAcrossDays(
  [{ day: 1, entries: [entry(museumA), entry(museumB)] }, { day: 2, entries: [entry(attraction)] }],
  [park, viewpoint, attraction2],
  2,
  "mixed",
  undefined,
  undefined,
  true,
  requiredLock,
);
const requiredIds = new Set(requiredResult.flatMap((plan) => plan.entries.map((item) => item.place.id)));
assert.ok(requiredIds.has(museumA.id));
assert.ok(requiredIds.has(museumB.id));
assertWithinCaps(requiredResult);

// Mathematically infeasible required anchors are retained for the validator; never deleted.
const infeasibleLock = buildSelectedPlaceLock({
  selectedPlaceNames: [museumA.name, museumB.name],
  placeIds: [museumA.id, museumB.id],
});
const infeasible = repairRedistributeAcrossDays(
  [{ day: 1, entries: [entry(museumA), entry(museumB)] }],
  [],
  1,
  "mixed",
  undefined,
  undefined,
  true,
  infeasibleLock,
);
const infeasibleIds = new Set(
  infeasible.flatMap((plan) => plan.entries.map((item) => item.place.id)),
);
assert.ok(infeasibleIds.has(museumA.id));
assert.ok(infeasibleIds.has(museumB.id));
assert.equal(
  infeasible[0].entries.filter(
    (item) => classifyDailyDiversityCategory(item.place) === "museum_family",
  ).length,
  2,
  "an infeasible required conflict remains visible to the validator",
);

console.log("verify-replan-recipient-diversity: OK");
