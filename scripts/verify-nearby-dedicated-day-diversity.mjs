import assert from "node:assert/strict";
import {
  applyPlannerRouteAndCapacityAssembly,
  selectNearbyDedicatedDayEntries,
} from "../src/lib/ai/planner-day-route-assembly.ts";
import {
  resolveDailyDiversityLimits,
  wouldViolateDailyDiversity,
} from "../src/lib/ai/daily-category-diversity.ts";

const place = (id, name, primaryType, extension = "橫濱") => ({
  id,
  name,
  address: `${extension} address`,
  lat: extension === "橫濱" ? 35.45 : 35.53,
  lng: extension === "橫濱" ? 139.64 : 139.7,
  rating: 4.5,
  userRatingCount: 1000,
  photoName: null,
  primaryType,
  types: [primaryType, "tourist_attraction"],
  businessStatus: "OPERATIONAL",
  openStatus: "unknown",
  openStatusLabel: "",
  todayHoursLabel: "",
  closingSoonNote: "",
  nextOpenHint: "",
  destinationScope: "nearby_extension",
  extensionDestination: extension,
  sourceRegionCandidate: extension,
});

const entry = (candidate) => ({
  time: "11:00",
  label: "景點",
  name: candidate.name,
  place: candidate,
});

const park1 = place("ChIJYokohamaParkOne", "Yokohama Park One", "park");
const park2 = place("ChIJYokohamaParkTwo", "Yokohama Park Two", "park");
const viewpoint = place("ChIJYokohamaViewpoint", "Yokohama Viewpoint", "observation_deck");
const attraction = place("ChIJYokohamaAttraction", "Yokohama Attraction", "tourist_attraction");

const parkViewpoint = selectNearbyDedicatedDayEntries({
  extension: "橫濱",
  day: 6,
  collectedEntries: [entry(park1), entry(park2)],
  extensionPool: [park1, park2, viewpoint],
});
assert.deepEqual(
  parkViewpoint.entries.map((item) => item.place.id),
  [park1.id, viewpoint.id],
);
assert.equal(parkViewpoint.sufficient, true);
assert.ok(
  parkViewpoint.decisions.some(
    (decision) => decision.place.id === park2.id && decision.reason === "recipient_overflow",
  ),
);

const viewpoint2 = place("ChIJYokohamaViewpointTwo", "Yokohama Viewpoint Two", "observation_deck");
const viewpointAttraction = selectNearbyDedicatedDayEntries({
  extension: "橫濱",
  day: 6,
  collectedEntries: [],
  extensionPool: [viewpoint, viewpoint2, attraction],
});
assert.deepEqual(
  viewpointAttraction.entries.map((item) => item.place.id),
  [viewpoint.id, attraction.id],
);

const infeasible = selectNearbyDedicatedDayEntries({
  extension: "橫濱",
  day: 6,
  collectedEntries: [],
  extensionPool: [park1, park2],
});
assert.equal(infeasible.entries.length, 1);
assert.equal(infeasible.sufficient, false);
assert.equal(infeasible.decisions[1].reason, "recipient_overflow");

const kawasakiPark = place("ChIJKawasakiPark", "Kawasaki Park", "park", "川崎");
const kawasakiAttraction = place(
  "ChIJKawasakiAttraction",
  "Kawasaki Attraction",
  "tourist_attraction",
  "川崎",
);
const multiple = [
  selectNearbyDedicatedDayEntries({
    extension: "橫濱",
    day: 6,
    collectedEntries: [],
    extensionPool: [park1, viewpoint],
  }),
  selectNearbyDedicatedDayEntries({
    extension: "川崎",
    day: 5,
    collectedEntries: [],
    extensionPool: [kawasakiPark, kawasakiAttraction],
  }),
];
assert.deepEqual(
  multiple.map((result) => result.entries.length),
  [2, 2],
);
assert.ok(multiple[0].entries.every((item) => item.place.extensionDestination === "橫濱"));
assert.ok(multiple[1].entries.every((item) => item.place.extensionDestination === "川崎"));

for (const accepted of parkViewpoint.entries) {
  assert.equal(accepted.place.destinationScope, "nearby_extension");
  assert.equal(accepted.place.extensionDestination, "橫濱");
  assert.equal(accepted.place.sourceRegionCandidate, "橫濱");
  assert.ok(accepted.place.types?.length);
}

const assembled = applyPlannerRouteAndCapacityAssembly({
  plans: [
    { day: 1, entries: [entry(park1)] },
    { day: 2, entries: [entry(viewpoint)] },
    { day: 3, entries: [] },
    { day: 4, entries: [] },
    { day: 5, entries: [] },
    { day: 6, entries: [] },
  ],
  pool: [park1, park2, viewpoint],
  days: 6,
  style: "mixed",
  nearbyExtensions: ["橫濱"],
});
const dedicated = assembled.plans.find((plan) => plan.day === 6);
assert.ok(dedicated);
const limits = resolveDailyDiversityLimits({ style: "mixed" });
const acceptedPlaces = [];
for (const accepted of dedicated.entries) {
  assert.equal(wouldViolateDailyDiversity(acceptedPlaces, accepted.place, limits).ok, true);
  acceptedPlaces.push(accepted.place);
}

console.log("verify-nearby-dedicated-day-diversity: OK");
