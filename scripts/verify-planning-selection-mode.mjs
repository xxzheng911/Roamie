import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STYLE_RECOMMENDATION_FAMILIES,
  createPlanningSelectionSession,
  fetchPlanningSelectionRecommendations,
  isPlaceEligibleForSelectionFamily,
  preparePlanningSelectionForGenerate,
  resolvePlanningSelectionPlaces,
  togglePlanningSelectionPlace,
} from "../src/lib/planning-selection.ts";
import { classifyFamilyPlace } from "../src/lib/family-place-classification.ts";
import { matchDestinationAdministrativeScope } from "../src/lib/destination-administrative-scope.ts";
import { buildPlannerRequiredAnchors } from "../src/lib/place-planning-memory.ts";
import { isRecommendablePlace } from "../src/lib/is-recommendable-place.ts";

const basePlace = (id, name, primaryType) => ({
  id,
  name,
  primaryType,
  types: [primaryType],
  address: "台北市",
  lat: 25.04,
  lng: 121.53,
  rating: 4.6,
  userRatingCount: 100,
  photoName: null,
  businessStatus: "OPERATIONAL",
  openStatus: "unknown",
  openStatusLabel: "",
  todayHoursLabel: "",
  closingSoonNote: "",
  nextOpenHint: "",
});

assert.equal(STYLE_RECOMMENDATION_FAMILIES["美食探索"].family, "food");
assert(STYLE_RECOMMENDATION_FAMILIES["藝術展覽"].types.includes("museum"));
assert(STYLE_RECOMMENDATION_FAMILIES["親子同遊"].types.includes("zoo"));
assert(STYLE_RECOMMENDATION_FAMILIES["露營野遊"].types.includes("campground"));
assert(
  !STYLE_RECOMMENDATION_FAMILIES["露營野遊"].types.includes("park"),
  "plain park is not a camping type",
);
assert.equal(
  isPlaceEligibleForSelectionFamily(basePlace("park", "中央公園", "park"), "camping"),
  false,
);

for (const type of ["zoo", "aquarium", "amusement_park", "amusement_center", "playground", "indoor_playground"]) {
  const classification = classifyFamilyPlace(basePlace(`family-${type}`, "親子場所", type));
  assert.equal(classification.explicitFamilyIdentity, true, type);
  assert.equal(classification.eligible, true, type);
  assert.equal(isPlaceEligibleForSelectionFamily(basePlace(`family-${type}`, "親子場所", type), "family"), true, type);
}
assert.equal(classifyFamilyPlace(basePlace("plain-park", "中央公園", "park")).eligible, false);
assert.equal(classifyFamilyPlace(basePlace("plain-museum", "地方歷史博物館", "museum")).eligible, false);
assert.equal(classifyFamilyPlace(basePlace("family-park", "屏東公園共融式遊戲場", "park")).eligible, true);
assert.equal(classifyFamilyPlace(basePlace("science", "兒童科學館", "museum")).eligible, true);
assert.equal(classifyFamilyPlace(basePlace("mall", "一般購物中心", "shopping_mall")).eligible, false);

const explicitFamilyVenue = basePlace("family-gate", "親子室內遊樂場", "indoor_playground");
assert.equal(
  isRecommendablePlace(explicitFamilyVenue, "chat_destination_recommend").ok,
  false,
  "generic chat must not inherit the Selection family bypass",
);
assert.equal(
  isRecommendablePlace(explicitFamilyVenue, "chat_destination_recommend", {
    allowExplicitFamilyPlace: true,
  }).ok,
  true,
  "Selection family may bypass only the generic travel-friendly gate",
);
assert.equal(
  isRecommendablePlace(
    { ...explicitFamilyVenue, primaryType: "lodging", types: ["indoor_playground", "lodging"] },
    "chat_destination_recommend",
    { allowExplicitFamilyPlace: true },
  ).ok,
  false,
  "lodging exclusion remains authoritative",
);
assert.equal(
  isRecommendablePlace(
    { ...explicitFamilyVenue, userRatingCount: 2 },
    "chat_destination_recommend",
    { allowExplicitFamilyPlace: true },
  ).ok,
  false,
  "review quality gate remains authoritative",
);

const pingtungScope = { name: "屏東", administrativeNames: ["屏東縣", "Pingtung County"] };
assert.equal(matchDestinationAdministrativeScope({ address: "944屏東縣車城鄉後灣路2號" }, pingtungScope).match, true);
assert.equal(matchDestinationAdministrativeScope({ address: "928屏東縣東港鎮船頭路" }, pingtungScope).match, true);
assert.equal(matchDestinationAdministrativeScope({ address: "946屏東縣恆春鎮" }, pingtungScope).match, true);
assert.equal(matchDestinationAdministrativeScope({ address: "高雄市苓雅區" }, pingtungScope).match, false);
assert.equal(matchDestinationAdministrativeScope({ address: null }, pingtungScope).match, false);
assert.equal(
  isPlaceEligibleForSelectionFamily(basePlace("camp", "森林露營區", "park"), "camping"),
  false,
  "camping name without canonical camping types is not sufficient evidence",
);
assert.equal(
  isPlaceEligibleForSelectionFamily(basePlace("camp", "森林露營區", "campground"), "camping"),
  true,
);

const selection = createPlanningSelectionSession({
  styles: ["美食探索", "藝術展覽", "自然戶外"],
  destination: { name: "台北", lat: 25.04, lng: 121.53 },
});
const session = {
  phase: "collect",
  recommendedPlaces: [],
  selectedPlaces: [],
  planningSelection: selection,
  tripDays: 3,
  tripDestination: { city: "台北" },
  updatedAt: new Date().toISOString(),
};
const calls = [];
const searchPlaces = async ({ data }) => {
  calls.push(data.categoryId);
  if (data.categoryId === "food")
    return { places: [basePlace("food-1", "小吃店", "restaurant")], error: null };
  if (data.categoryId === "art")
    return { places: [basePlace("art-1", "美術館", "museum")], error: null };
  if (data.categoryId === "nature")
    return { places: [basePlace("nature-1", "森林公園", "park")], error: null };
  return { places: [], error: null };
};

const first = await fetchPlanningSelectionRecommendations({
  session,
  searchPlaces,
  locale: "zh-TW",
});
assert.deepEqual(
  new Set(calls),
  new Set(["food", "art", "nature"]),
  "styles use independent lanes",
);
assert.deepEqual(
  new Set(first.places.map((p) => p.googlePlaceId)),
  new Set(["food-1", "art-1", "nature-1"]),
);
assert.equal(first.session.planningSelection.shownPlaceIds.length, 3);
assert.equal(first.session.planningSelection.selectedPlaceIds.length, 0);

const selected = togglePlanningSelectionPlace(first.session, first.places[0]);
assert.equal(selected.selectedPlaces.length, 1);
assert.equal(selected.planningSelection.selectedPlaceIds.length, 1);
assert.equal(selected.planningSelection.selectedPlaces.length, 1);
assert.equal(resolvePlanningSelectionPlaces(selected).length, 1);
assert.equal(
  resolvePlanningSelectionPlaces({ ...selected, selectedPlaces: [] }).length,
  1,
  "nested Selection payload survives a stale top-level render snapshot",
);
const generatePrepared = preparePlanningSelectionForGenerate({ ...selected, selectedPlaces: [] });
assert.equal(generatePrepared.requiredPlaces[0].googlePlaceId, "food-1");
assert.equal(generatePrepared.session.phase, "ready");
assert.equal(generatePrepared.session.plannedStops.length, 1);
const oneAnchor = buildPlannerRequiredAnchors(
  [
    {
      ...generatePrepared.requiredPlaces[0],
      // Simulate legacy/native hydrated card metadata that must not cross the
      // strict itinerary input boundary.
      types: null,
      sourceCombinationIds: null,
      matchedCombinationIds: [1, null, 2],
    },
  ],
  "台北",
  true,
);
assert.equal(oneAnchor.length, 1, "one selected place reaches planner anchors");
assert.equal(oneAnchor[0].googlePlaceId, "food-1");
assert.equal(oneAnchor[0].isRequiredBySelection, true);
assert.equal(oneAnchor[0].types, undefined, "nullable card metadata is schema-safe");
assert.deepEqual(oneAnchor[0].matchedCombinationIds, [1, 2]);
const multiSelected = togglePlanningSelectionPlace(selected, first.places[1]);
assert.equal(resolvePlanningSelectionPlaces(multiSelected).length, 2, "multiple selections persist");
const fourAnchors = buildPlannerRequiredAnchors(
  [first.places[0], first.places[1], first.places[2], basePlace("city-1", "城市地標", "tourist_attraction")],
  "台北",
  true,
);
assert.equal(fourAnchors.length, 4, "four selected places remain four required anchors");
assert.equal(new Set(fourAnchors.map((place) => place.googlePlaceId)).size, 4);
const oneRemaining = togglePlanningSelectionPlace(multiSelected, first.places[0]);
assert.equal(resolvePlanningSelectionPlaces(oneRemaining).length, 1, "cancelling one selection keeps the other");
const unselected = togglePlanningSelectionPlace(selected, first.places[0]);
assert.equal(unselected.selectedPlaces.length, 0);
assert.equal(
  unselected.planningSelection.shownPlaceIds.length,
  3,
  "shown and selected identity remain separate",
);

const second = await fetchPlanningSelectionRecommendations({
  session: selected,
  searchPlaces,
  locale: "zh-TW",
});
assert.equal(second.places.length, 0, "continuation excludes shown and selected places");
assert.equal(selected.selectedPlaces.length, 1, "selection survives continuation");

const cafeCamping = createPlanningSelectionSession({
  styles: ["文青咖啡", "露營野遊"],
  destination: { name: "台北", lat: 25.04, lng: 121.53 },
});
const cafeCampingResult = await fetchPlanningSelectionRecommendations({
  session: { ...session, planningSelection: cafeCamping },
  locale: "zh-TW",
  searchPlaces: async ({ data }) =>
    data.categoryId === "cafe"
      ? {
          places: [
            basePlace("cafe-1", "老宅咖啡", "cafe"),
            basePlace("cafe-2", "山邊咖啡", "cafe"),
          ],
          error: null,
        }
      : { places: [basePlace("camp-1", "森林露營區", "campground")], error: null },
});
assert.deepEqual(
  cafeCampingResult.places.map((place) => place.googlePlaceId).slice(0, 2),
  ["cafe-1", "camp-1"],
  "coverage merge survives to render order",
);

const cafeOnly = await fetchPlanningSelectionRecommendations({
  session: { ...session, planningSelection: cafeCamping },
  locale: "zh-TW",
  searchPlaces: async ({ data }) =>
    data.categoryId === "cafe"
      ? { places: [basePlace("cafe-only", "文青咖啡", "cafe")], error: null }
      : { places: [basePlace("ordinary-park", "中央公園", "park")], error: null },
});
assert.deepEqual(
  cafeOnly.places.map((place) => place.googlePlaceId),
  ["cafe-only"],
  "empty camping lane does not fail cafe lane",
);

const hsinchuCamping = createPlanningSelectionSession({
  styles: ["露營野遊"],
  destination: { name: "新竹", lat: 24.8138, lng: 120.9675 },
});
const hsinchuScoped = await fetchPlanningSelectionRecommendations({
  session: { ...session, planningSelection: hsinchuCamping },
  locale: "zh-TW",
  searchPlaces: async () => ({
    places: [
      { ...basePlace("hsinchu-camp", "尖石露營區", "campground"), address: "新竹縣尖石鄉" },
      { ...basePlace("miaoli-camp", "南庄露營區", "campground"), address: "苗栗縣南庄鄉" },
      { ...basePlace("unknown-camp", "山區露營區", "campground"), address: null },
    ],
    error: null,
  }),
});
assert.deepEqual(
  hsinchuScoped.places.map((place) => place.googlePlaceId),
  ["hsinchu-camp"],
  "camping keeps canonical destination administrative scope and rejects cross-scope/unknown",
);
assert.equal(
  cafeOnly.session.planningSelection.lanes.find((lane) => lane.family === "camping")?.exhausted,
  false,
  "a lane is not exhausted until every fallback query has been attempted",
);
const cafeCampingExhausted = await fetchPlanningSelectionRecommendations({
  session: cafeOnly.session,
  locale: "zh-TW",
  searchPlaces: async ({ data }) =>
    data.categoryId === "cafe"
      ? { places: [basePlace("cafe-only", "文青咖啡", "cafe")], error: null }
      : { places: [basePlace("ordinary-park", "中央公園", "park")], error: null },
});
assert.equal(
  cafeCampingExhausted.session.planningSelection.lanes.find(
    (lane) => lane.family === "camping",
  )?.exhausted,
  true,
  "camping exhausts only after all six fallback queries yield no legitimate candidate",
);

const campingFood = createPlanningSelectionSession({
  styles: ["露營野遊", "美食探索"],
  destination: { name: "台北", lat: 25.04, lng: 121.53 },
});
let campingSequence = 0;
let foodSequence = 0;
const multiTurnSearch = async ({ data }) => {
  if (data.categoryId === "camping") {
    campingSequence += 1;
    return {
      places: [basePlace(`camp-multi-${campingSequence}`, `山林露營區 ${campingSequence}`, "campground")],
      error: null,
    };
  }
  foodSequence += 1;
  return {
    places: [
      basePlace(`food-multi-${foodSequence}-a`, `餐廳 ${foodSequence}A`, "restaurant"),
      basePlace(`food-multi-${foodSequence}-b`, `餐廳 ${foodSequence}B`, "restaurant"),
    ],
    error: null,
  };
};
const multiFirst = await fetchPlanningSelectionRecommendations({
  session: {
    ...session,
    planningSelection: { ...campingFood, shownFamilyCounts: { food: 4, camping: 0 } },
  },
  searchPlaces: multiTurnSearch,
  locale: "zh-TW",
  limit: 4,
});
const multiSecond = await fetchPlanningSelectionRecommendations({
  session: multiFirst.session,
  searchPlaces: multiTurnSearch,
  locale: "zh-TW",
  limit: 4,
});
assert(
  (multiSecond.session.planningSelection.shownFamilyCounts.food ?? 0) -
      (multiSecond.session.planningSelection.shownFamilyCounts.camping ?? 0) <
    4,
  "deficit-aware continuation reduces the underrepresented camping family gap",
);
assert.equal(
  new Set([...multiFirst.places, ...multiSecond.places].map((place) => place.googlePlaceId)).size,
  multiFirst.places.length + multiSecond.places.length,
  "continuation remains deduplicated",
);

const chatRoute = readFileSync(new URL("../src/routes/_app.chat.tsx", import.meta.url), "utf8");
const composer = readFileSync(
  new URL("../src/components/chat/ChatComposer.tsx", import.meta.url),
  "utf8",
);
assert.match(
  chatRoute,
  /selectionMode\s*\?\s*"加入這地點"/,
  "label does not duplicate the rendered Plus icon",
);
assert.match(chatRoute, /chips\.push\("生成行程", "再推薦一些"\)/);
assert.match(chatRoute, /actionChipsOnly=\{selectionMode\}/);
assert.match(
  composer,
  /!actionChipsOnly\s*&&\s*CHAT_SHORTCUT_SEND_CHIPS/,
  "general shortcuts remain scoped out of Selection Mode",
);
assert.match(composer, /actionChipsOnly\s*&&\s*"justify-center"/);
assert.match(composer, /Sparkles/);
assert.match(composer, /RotateCcw/);
assert.match(chatRoute, /PLANNING_SELECTION_GENERATE_CLICK/);
assert.match(chatRoute, /PLANNING_SELECTION_PLANNER_INPUT/);
assert.match(chatRoute, /buildPlannerRequiredAnchors/);
for (const stage of [
  "generate_click",
  "selection_resolved",
  "credits_reserved",
  "trip_context_start",
  "start_place_resolve_start",
  "start_place_resolve_done",
  "destination_resolve_start",
  "destination_resolve_done",
  "weather_start",
  "weather_done",
  "session_prepare_start",
  "session_prepare_done",
  "planner_handoff_start",
]) {
  assert.match(chatRoute, new RegExp(`logSelectionStage\\(\\s*["']${stage}["']`));
}
assert.match(chatRoute, /PLANNING_SELECTION_CREDITS_READY/);
assert.match(chatRoute, /PLANNING_SELECTION_GENERATE_SETTLED/);
assert.doesNotMatch(chatRoute, /optional_enrichment_timeout/);
assert.match(
  chatRoute,
  /finally\s*\{[\s\S]*setGenerating\(false\)[\s\S]*settleCreditsOperation\(itinCreditsHandle, itinerarySucceeded\)/,
  "pre-planner failure settles credits and loading in the existing finally",
);
assert.match(chatRoute, /weatherBlocking:\s*!isPlanningSelectionMode\(activeSession\)/);
assert.match(chatRoute, /selectionModeForPrepare\s*\?\s*\[bundle\.preferences, null\]/);
assert.match(chatRoute, /SELECTION_PLACE_RESOLUTION_MISMATCH/);
const placesFunctions = readFileSync(
  new URL("../src/lib/places.functions.ts", import.meta.url),
  "utf8",
);
assert.match(placesFunctions, /PLANNING_SELECTION_PLACES_RAW/);
assert.match(placesFunctions, /allowVerifiedCampingLodging/);

const selectionInitialCredits = chatRoute.slice(
  chatRoute.indexOf("if (isPlanningSelectionMode(syncedHandoff))"),
  chatRoute.indexOf("const req = toRoamieRequest", chatRoute.indexOf('metadata: { path: "planning_selection_initial" }')),
);
assert.match(selectionInitialCredits, /beginPlaceRecommendationCredits/);
assert.match(selectionInitialCredits, /INSUFFICIENT_CREDITS_PLACE_MESSAGE/);
assert.match(selectionInitialCredits, /settleCreditsOperation\(creditsHandle, delivered\)/);

const selectionContinuationCredits = chatRoute.slice(
  chatRoute.indexOf("if (isPlanningSelectionMode(session) && isPlanningSelectionContinuation"),
  chatRoute.indexOf("const legacyNearbyClarification", chatRoute.indexOf("if (isPlanningSelectionMode(session) && isPlanningSelectionContinuation")),
);
assert.match(selectionContinuationCredits, /ensureSubscriptionHydratedForCredits/);
assert.match(selectionContinuationCredits, /beginPlaceRecommendationCredits/);
assert.match(selectionContinuationCredits, /INSUFFICIENT_CREDITS_PLACE_MESSAGE/);
assert.match(selectionContinuationCredits, /settleCreditsOperation\(creditsHandle, delivered\)/);
assert.match(selectionContinuationCredits, /selectionRecommendationInFlightRef/);

const selectionGenerateCredits = chatRoute.slice(
  chatRoute.indexOf("const handleGenerateItinerary = async"),
  chatRoute.indexOf("runDirectItineraryRef.current", chatRoute.indexOf("const handleGenerateItinerary = async")),
);
assert.match(selectionGenerateCredits, /beginItineraryGenerationCredits/);
assert.match(selectionGenerateCredits, /INSUFFICIENT_CREDITS_ITINERARY_MESSAGE/);
assert.match(selectionGenerateCredits, /settleCreditsOperation\(itinCreditsHandle, itinerarySucceeded\)/);
assert.match(chatRoute, /selectionGenerateInFlightRef\.current/);
assert.doesNotMatch(chatRoute, /Selection Mode 額度不足|Roamie 安排點數/);

console.log("verify-planning-selection-mode: ok");
