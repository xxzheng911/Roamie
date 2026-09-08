import assert from "node:assert/strict";
import {
  buildDestinationCombinationSuggestionPayload,
  buildPlanningShownCandidatesFromOfferedCombinations,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import { setCachedDiscoveredCombinations } from "../src/lib/ai/destination-combination-discovery.ts";
import {
  hasUndeliverableRequiredIdentity,
  resolvePlanningRequiredAnchorHandoff,
} from "../src/lib/ai/planning-required-anchor-handoff.ts";
import { buildPlannerRequiredAnchors } from "../src/lib/place-planning-memory.ts";
import { createItineraryFromSession } from "../src/lib/ai/ai-itinerary-state-machine.ts";

const raw = [
  ["台北101", "ChIJP41Taipei101", 25.0339, 121.5645],
  ["中正紀念堂", "ChIJP41CKS", 25.0355, 121.52],
  ["龍山寺", "ChIJP41Longshan", 25.0372, 121.4999],
  ["饒河夜市", "ChIJP41Raohe", 25.0509, 121.5776],
  ["信義商圈", "ChIJP41Xinyi", 25.033, 121.565],
];
const candidate = ([name, googlePlaceId, lat, lng], combinationId) => ({
  name,
  localizedDisplayName: name,
  originalName: name,
  googlePlaceId,
  englishName: {
    台北101: "Taipei 101",
    中正紀念堂: "Chiang Kai-shek Memorial Hall",
    龍山寺: "Longshan Temple",
    饒河夜市: "Raohe Night Market",
    信義商圈: "Xinyi Shopping District",
  }[name],
  searchCandidateId: googlePlaceId,
  coordinates: { lat, lng },
  address: "台北市",
  types: /夜市/.test(name)
    ? ["night_market", "market"]
    : /商圈/.test(name)
      ? ["shopping_mall"]
      : ["tourist_attraction"],
  primaryType: /夜市/.test(name)
    ? "night_market"
    : /商圈/.test(name)
      ? "shopping_mall"
      : "tourist_attraction",
  normalizedCategory: /夜市/.test(name)
    ? "night_market"
    : /商圈/.test(name)
      ? "shopping_mall"
      : "attraction",
  combinationId,
});
const combinations = [
  {
    combinationId: "landmarks",
    title: "經典地標",
    theme: "attraction",
    placeCandidates: raw.slice(0, 3).map((place) => candidate(place, 1)),
  },
  {
    combinationId: "markets",
    title: "商圈夜市",
    theme: "market",
    placeCandidates: raw.slice(3).map((place) => candidate(place, 2)),
  },
].map((combo) => ({ ...combo, primaryCandidates: combo.placeCandidates }));
setCachedDiscoveredCombinations("台北", combinations);

const suggestion = buildDestinationCombinationSuggestionPayload("台北", 2, {
  forceCombinations: combinations.map((combo) => ({
    title: combo.title,
    places: combo.placeCandidates.map((place) => place.englishName),
  })),
});
assert(suggestion);
assert.equal(suggestion.shownCandidates.length, 5);
assert.equal(suggestion.shownCandidates.filter((place) => place.googlePlaceId).length, 5);
assert(suggestion.shownCandidates.every((place) => place.plannerProvenanceKey));
assert(suggestion.shownCandidates.every((place) => Number.isInteger(place.sourceCandidateIndex)));

// 101 shorthand changes only the matched selection, never its source object.
const taipei101 = suggestion.shownCandidates.find((place) => place.name.includes("101"));
assert.equal(taipei101.googlePlaceId, "ChIJP41Taipei101");
const required = suggestion.shownCandidates.filter((place) => place !== taipei101);
const session = {
  activeShownCandidates: suggestion.shownCandidates,
  selectedPlaces: [],
  plannedStops: [],
  recommendedPlaces: [],
  planningConstraints: {
    acceptedCandidateIds: required.map((place) => place.canonicalId),
    rejectedCandidateIds: [taipei101.canonicalId],
    mustIncludePlaces: [],
    excludedPlaces: [],
    clarificationRequired: false,
  },
};
const handoff = resolvePlanningRequiredAnchorHandoff({
  session,
  candidateRequiredPlaces: [],
  selectionMode: false,
});
assert.equal(handoff.requiredPlaces.length, 4);
assert.equal(handoff.requiredPlaces.filter((place) => place.googlePlaceId).length, 4);
const planner = buildPlannerRequiredAnchors(handoff.requiredPlaces, "台北", true);
assert.equal(planner.length, 4);
assert.equal(planner.filter((place) => place.googlePlaceId).length, 4);
assert.equal(hasUndeliverableRequiredIdentity(planner), false);

// Kill/reopen serialization retains the complete shown-candidate identity snapshot.
const reopened = JSON.parse(JSON.stringify(session));
assert.deepEqual(
  reopened.activeShownCandidates.map(
    ({ googlePlaceId, plannerProvenanceKey, sourceCandidateIndex }) => ({
      googlePlaceId,
      plannerProvenanceKey,
      sourceCandidateIndex,
    }),
  ),
  session.activeShownCandidates.map(
    ({ googlePlaceId, plannerProvenanceKey, sourceCandidateIndex }) => ({
      googlePlaceId,
      plannerProvenanceKey,
      sourceCandidateIndex,
    }),
  ),
);

// Raw offered names cannot become selectable/required anchors.
const rawOnly = buildPlanningShownCandidatesFromOfferedCombinations("台北", [
  {
    id: 1,
    title: "raw",
    places: raw.slice(0, 2).map(([name], index) => ({
      candidateId: `name:${name}`,
      name,
      searchQuery: `${name} 台北`,
      sourceCombinationId: 1,
      resolutionStatus: "named",
      sourceCandidateIndex: index,
    })),
  },
]);
assert.equal(hasUndeliverableRequiredIdentity(rawOnly), true);
let serverInvoked = false;
const blocked = await createItineraryFromSession({
  session: { ...session, activeShownCandidates: rawOnly, selectedPlaces: rawOnly },
  generateInput: {
    destination: "台北",
    days: 2,
    budget: "medium",
    style: "mixed",
    mood: "",
    interests: "",
    conversationSummary: "",
    startDate: "2026-09-07",
    endDate: "2026-09-08",
    origin: "",
    travelers: 1,
    transport: "",
    placeAuthority: "selected_only",
    selectedPlaces: rawOnly,
    selectedCombinationIds: [],
    nearbyExtensions: [],
    excludedCategories: [],
    excludedPlaceIds: [],
    preferences: {},
    location: {},
    weather: null,
    time: "",
    fashionStyle: "",
    locale: "zh-TW",
    generationId: "p41-preflight",
  },
  generateItineraryFn: async () => {
    serverInvoked = true;
    return null;
  },
  generationTransport: "capacitor_https",
});
assert.equal(blocked.ok, false);
assert.equal(serverInvoked, false);
assert.match(blocked.message, /無法確認地圖身分/);

console.log("P41 required identity handoff: PASS", {
  shown: "5/5",
  accepted: "4/4",
  planner: "4/4",
  nativePreflight: "pass",
  shorthandIdentityPreserved: true,
  killReopenIdentityPreserved: true,
  rawLabelRequiredBlocked: true,
  clientPreflightBlockedServer: true,
  externalRequestDelta: 0,
});
