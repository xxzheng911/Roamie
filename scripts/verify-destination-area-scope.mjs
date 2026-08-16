#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  extractGenericDestinationAreaCandidate,
  extractProvisionalDestinationAreaCandidate,
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
  ["台中西屯區有什麼咖啡廳推薦", "台中", "西屯區"],
  ["台中北屯區有什麼咖啡廳推薦", "台中", "北屯區"],
  ["台中南屯區有什麼咖啡廳推薦", "台中", "南屯區"],
  ["台北信義區有什麼咖啡廳推薦", "台北", "信義"],
  ["高雄鼓山區有什麼咖啡廳推薦", "高雄", "鼓山區"],
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

const xitunCandidate = extractGenericDestinationAreaCandidate("台中西屯區有什麼咖啡廳推薦");
assert.ok(xitunCandidate);
assert.equal(
  locationValidatesDestinationArea(xitunCandidate, {
    placeId: "mock:xitun-structured",
    country: "台灣",
    city: "台中市",
    region: "台中市",
    district: "西屯區",
    sublocality: "西屯區",
    lat: 24.18,
    lng: 120.64,
    formattedName: "Taichung",
    displayLabel: "Taichung",
    address: "Taiwan",
  }),
  true,
  "structured district evidence must validate without formatted-address substring dependence",
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

const districtOnlyFixtures = [
  ["板橋有什麼咖啡廳推薦", "新北市", "板橋區", "新北板橋"],
  ["西屯有什麼咖啡廳推薦", "台中市", "西屯區", "台中西屯"],
  ["鼓山有什麼咖啡廳推薦", "高雄市", "鼓山區", "高雄鼓山"],
  ["安平有什麼景點推薦", "台南市", "安平區", "台南安平"],
];
for (const [text, city, district, displayLabel] of districtOnlyFixtures) {
  const provisional = extractProvisionalDestinationAreaCandidate(text);
  assert.ok(provisional, text);
  assert.equal(provisional.validationStatus, "pending_provider");
  let query = "";
  const validated = await resolveValidatedDestinationAreaScope({
    input: text,
    locale: "zh-TW",
    geocodeFn: async ({ data }) => {
      query = data.query;
      return {
        location: {
          placeId: `mock:${district}`,
          country: "台灣",
          city,
          region: city,
          district,
          sublocality: district,
          lat: 25,
          lng: 121,
          formattedName: district,
          displayLabel: `${city}${district}`,
          address: `台灣${city}${district}`,
        },
        error: null,
      };
    },
  });
  assert.equal(query, provisional.rawLabel, "provider must geocode the original district label");
  assert.deepEqual(validated, {
    displayLabel,
    parentCity: displayLabel.slice(0, 2),
    area: displayLabel.slice(2),
    searchScope: "area",
  });
}

assert.equal(
  await resolveValidatedDestinationAreaScope({
    input: "板橋有什麼咖啡廳推薦",
    locale: "zh-TW",
    geocodeFn: async () => ({
      location: {
        placeId: "mock:ambiguous",
        country: "台灣",
        city: "",
        region: "板橋區",
        district: "板橋區",
        lat: 25,
        lng: 121,
        formattedName: "板橋區",
        displayLabel: "板橋區",
      },
      error: null,
    }),
  }),
  null,
  "district-only validation must not guess a parent city",
);
assert.equal(
  await resolveValidatedDestinationAreaScope({
    input: "板橋有什麼咖啡廳推薦",
    locale: "zh-TW",
    geocodeFn: async () => ({ location: null, error: "not_found" }),
  }),
  null,
  "provider failure must not create a fake area",
);
assert.equal(
  extractProvisionalDestinationAreaCandidate("新北有什麼咖啡廳推薦"),
  null,
  "city-wide destination must keep its existing path",
);
const chatSource = readFileSync(new URL("../src/routes/_app.chat.tsx", import.meta.url), "utf8");
assert.match(
  chatSource,
  /if \(provisionalArea && !validatedAreaScope\)[\s\S]*你指的是哪個城市的\$\{provisionalArea\.areaCandidate\}[\s\S]*return true;/,
  "an unresolved explicit district must be handled before stale-session fallback",
);

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

const explicitAreaOnly = selectAreaFirstCandidates(
  [
    scoped("area-1", "area_primary", true),
    scoped("wrong-area", "area_primary", false),
  ],
  [
    scoped("city-1", "city_primary", false),
    scoped("city-2", "city_relaxed", false),
  ],
  4,
  { explicitAreaConstraint: true },
);
assert.deepEqual(
  explicitAreaOnly.map((candidate) => candidate.place.id),
  ["area-1"],
  "explicit area must remain the hard final card scope even below target",
);
assert.deepEqual(
  selectAreaFirstCandidates(
    [{ ...scoped("wrong-parent", "area_primary", true), parentCityMatched: false }],
    [],
    4,
    { explicitAreaConstraint: true },
  ),
  [],
  "explicit area hard scope requires both district and parent-city evidence",
);
assert.deepEqual(
  selectAreaFirstCandidates(
    [],
    [scoped("city-1", "city_primary", false)],
    4,
    { explicitAreaConstraint: true },
  ),
  [],
  "an exhausted explicit area must not silently fall back to city-wide cards",
);

const canonicalPlace = { id: "ChIJcanonical", googlePlaceId: "ChIJcanonical" };
assert.deepEqual(canonicalPlace, { id: "ChIJcanonical", googlePlaceId: "ChIJcanonical" });

console.info("verify-destination-area-scope: ok");
