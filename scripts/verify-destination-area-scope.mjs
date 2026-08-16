#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  extractGenericDestinationAreaCandidate,
  locationValidatesDestinationArea,
  resolveDestinationAreaScope,
  resolveValidatedDestinationAreaScope,
} from "../src/lib/ai/destination-travel-profile.ts";
import { parsePlaceRecommendationIntent } from "../src/lib/ai/place-recommendation-intent/parse.ts";
import { buildChatPlaceSearchAttempts } from "../src/lib/ai/chat-place-intent.ts";
import { matchPlaceToDestinationArea } from "../src/lib/ai/chat-place-search-context.ts";
import {
  selectAreaFirstCandidates,
} from "../src/lib/ai/chat-destination-category-recommendation.ts";

const fixtures = [
  ["台南安平有什麼咖啡廳推薦", "台南", "安平"],
  ["高雄鹽埕有什麼咖啡廳推薦", "高雄", "鹽埕"],
  ["台北信義有什麼咖啡廳推薦", "台北", "信義"],
  ["東京上野有什麼咖啡廳推薦", "東京", "上野"],
  ["東京澀谷有什麼咖啡廳推薦", "東京", "澀谷"],
  ["大阪心齋橋有什麼咖啡廳推薦", "大阪", "心齋橋"],
  ["京都祇園有什麼咖啡廳推薦", "京都", "祇園"],
  ["首爾弘大有什麼咖啡廳推薦", "首爾", "弘大"],
  ["首爾明洞有什麼咖啡廳推薦", "首爾", "明洞"],
  ["曼谷暹羅有什麼咖啡廳推薦", "曼谷", "暹羅"],
];

for (const [text, parentCity, area] of fixtures) {
  const scope = resolveDestinationAreaScope(text);
  assert.ok(scope, text);
  assert.equal(scope.parentCity, parentCity);
  assert.equal(scope.area, area);
  assert.equal(scope.searchScope, "area");
  const parsed = parsePlaceRecommendationIntent(text);
  assert.equal(parsed?.destinationDisplayLabel, `${parentCity}${area}`);
  assert.equal(parsed?.resolvedSearchCity, parentCity);
  assert.equal(parsed?.destinationArea, area);
}

const genericFixtures = [
  ["高雄鼓山有什麼咖啡廳推薦", "高雄", "鼓山"],
  ["高雄前金有什麼咖啡廳推薦", "高雄", "前金"],
  ["高雄前鎮有什麼咖啡廳推薦", "高雄", "前鎮"],
  ["高雄三民有什麼咖啡廳推薦", "高雄", "三民"],
  ["台南東區有什麼咖啡廳推薦", "台南", "東區"],
  ["台北大安有什麼咖啡廳推薦", "台北", "大安"],
];
for (const [text, parentCity, area] of genericFixtures) {
  const candidate = extractGenericDestinationAreaCandidate(text);
  assert.ok(candidate, text);
  assert.equal(candidate.parentCity, parentCity);
  assert.equal(candidate.area, area);
}

const gushanCandidate = extractGenericDestinationAreaCandidate("高雄鼓山有什麼咖啡廳推薦");
assert.ok(gushanCandidate);
assert.equal(
  locationValidatesDestinationArea(gushanCandidate, {
    placeId: "mock:gushan",
    country: "台灣",
    city: "高雄市",
    region: "鼓山區",
    lat: 22.65,
    lng: 120.27,
    formattedName: "鼓山區",
    displayLabel: "高雄市鼓山區",
    address: "台灣高雄市鼓山區",
  }),
  true,
);
assert.equal(
  locationValidatesDestinationArea(gushanCandidate, {
    placeId: "mock:wrong",
    country: "台灣",
    city: "高雄市",
    region: "苓雅區",
    lat: 22.62,
    lng: 120.31,
    formattedName: "苓雅區",
    displayLabel: "高雄市苓雅區",
    address: "台灣高雄市苓雅區",
  }),
  false,
  "unvalidated fragments must not become fake areas",
);

const validatedGushan = await resolveValidatedDestinationAreaScope({
  input: "高雄鼓山有什麼咖啡廳推薦",
  locale: "zh-TW",
  geocodeFn: async ({ data }) => {
    assert.equal(data.query, "高雄鼓山");
    assert.equal(data.placesFallback, false);
    return {
    location: {
      placeId: "mock:gushan-provider",
      country: "台灣",
      city: "高雄市",
      region: "鼓山區",
      lat: 22.65,
      lng: 120.27,
      formattedName: "高雄市鼓山區",
      displayLabel: "高雄市鼓山區",
      address: "台灣高雄市鼓山區",
      timezone: undefined,
      utcOffsetMinutes: null,
    },
    error: null,
    };
  },
});
assert.deepEqual(validatedGushan, {
  displayLabel: "高雄鼓山",
  parentCity: "高雄",
  area: "鼓山",
  searchScope: "area",
});
assert.deepEqual(resolveDestinationAreaScope("高雄鼓山"), validatedGushan);

const attempts = buildChatPlaceSearchAttempts(
  "cafe",
  "台南安平",
  "台南安平有什麼咖啡廳推薦",
);
assert.ok(attempts.primary.length > 0);
assert.ok(attempts.primary.every((attempt) => attempt.query.includes("台南安平")));
assert.ok(attempts.fallback.some((attempt) => attempt.query.includes("台南")));
const firstCityFallback = attempts.fallback.findIndex(
  (attempt) => attempt.query.includes("台南") && !attempt.query.includes("安平"),
);
assert.ok(firstCityFallback >= 0, "parent city fallback must exist after area attempts");

const anpingScope = resolveDestinationAreaScope("台南安平");
assert.ok(anpingScope);
const place = (id, address) => ({ id, name: `Cafe ${id}`, address });
assert.deepEqual(
  matchPlaceToDestinationArea(place("traditional", "台南市安平區安北路 1 號"), anpingScope),
  { areaMatched: true, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(place("variant", "臺南市安平區安北路 2 號"), anpingScope),
  { areaMatched: true, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(
    place("english", "Anping District, Tainan City, Taiwan"),
    anpingScope,
  ),
  { areaMatched: true, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(place("city", "台南市中西區正興街 3 號"), anpingScope),
  { areaMatched: false, parentCityMatched: true },
);

const scoped = (id, sourceScope, areaMatched) => ({
  place: place(id, areaMatched ? "台南市安平區" : "台南市中西區"),
  sourceScope,
  sourceAttempt: `${sourceScope} query`,
  areaMatched,
  parentCityMatched: true,
});
const twoAreaFiveCity = selectAreaFirstCandidates(
  [scoped("area-1", "area_primary", true), scoped("area-2", "area_relaxed", true)],
  Array.from({ length: 5 }, (_, index) => scoped(`city-${index}`, "city_primary", false)),
  3,
);
assert.deepEqual(
  twoAreaFiveCity.map((candidate) => candidate.place.id),
  ["area-1", "area-2", "city-0"],
);
assert.deepEqual(
  selectAreaFirstCandidates(
    [
      scoped("area-1", "area_primary", true),
      scoped("area-2", "area_primary", true),
      scoped("area-3", "area_relaxed", true),
    ],
    [scoped("city-1", "city_primary", false)],
    3,
  ).map((candidate) => candidate.sourceScope),
  ["area_primary", "area_primary", "area_relaxed"],
);
assert.deepEqual(
  selectAreaFirstCandidates(
    [],
    [
      scoped("city-1", "city_primary", false),
      scoped("city-2", "city_primary", false),
      scoped("city-3", "city_relaxed", false),
    ],
    3,
  ).map((candidate) => candidate.place.id),
  ["city-1", "city-2", "city-3"],
);
assert.equal(twoAreaFiveCity[0].place.id, "area-1", "canonical Google identity changed");

const canonicalPlace = { id: "ChIJcanonical", googlePlaceId: "ChIJcanonical" };
assert.deepEqual(canonicalPlace, { id: "ChIJcanonical", googlePlaceId: "ChIJcanonical" });

console.info("verify-destination-area-scope: ok");
