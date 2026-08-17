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
import { matchPlaceToDestinationArea, filterPlacesByDestinationGuard, buildDestinationGuardProfile } from "../src/lib/ai/chat-place-search-context.ts";
import {
  selectAreaFirstCandidates,
} from "../src/lib/ai/chat-destination-category-recommendation.ts";
import { resolveDestinationForCategorySearch } from "../src/lib/ai/chat-category-destination.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import {
  continueRecommendation,
  createRecommendationSession,
  DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE,
} from "../src/lib/ai/conversation-recommendation-session.ts";

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

const geographicLabelFixtures = [
  ["埔里有什麼咖啡廳推薦嗎", "埔里"],
  ["埔里有什麼咖啡廳", "埔里"],
  ["埔里推薦咖啡廳", "埔里"],
  ["想找埔里的咖啡廳", "埔里"],
  ["澀谷有什麼咖啡廳", "澀谷"],
  ["澀谷有推薦餐廳嗎", "澀谷"],
  ["羅東有什麼咖啡廳", "羅東"],
  ["上野有什麼景點", "上野"],
];
for (const [text, label] of geographicLabelFixtures) {
  const provisional = extractProvisionalDestinationAreaCandidate(text);
  assert.ok(provisional, text);
  assert.equal(provisional.rawLabel, label, text);
  assert.equal(provisional.validationStatus, "pending_provider");
  assert.equal(provisional.parentCity, undefined);
}

assert.equal(
  extractProvisionalDestinationAreaCandidate("有什麼咖啡廳推薦"),
  null,
  "category-only asks must not invent a geographic candidate",
);
assert.equal(
  extractProvisionalDestinationAreaCandidate("安靜一點的咖啡廳"),
  null,
  "refinement language must not be sent to the geocoder",
);
assert.equal(
  extractProvisionalDestinationAreaCandidate("完全不是地點的文字"),
  null,
  "non-place leftover text must not become a geographic candidate",
);

let puliGeocodeQuery = "";
const validatedPuli = await resolveValidatedDestinationAreaScope({
  input: "埔里有什麼咖啡廳推薦嗎",
  locale: "zh-TW",
  geocodeFn: async ({ data }) => {
    puliGeocodeQuery = data.query;
    return {
      location: {
        placeId: "mock:puli",
        country: "台灣",
        city: "埔里鎮",
        region: "南投縣",
        district: "埔里鎮",
        lat: 23.97,
        lng: 120.97,
        formattedName: "台灣・埔里鎮",
        displayLabel: "南投縣埔里鎮",
        address: "台灣南投縣埔里鎮",
      },
      error: null,
    };
  },
});
assert.equal(puliGeocodeQuery, "埔里", "埔里 must be geocoded without a parent-city whitelist");
assert.deepEqual(validatedPuli, {
  displayLabel: "南投埔里",
  parentCity: "南投",
  area: "埔里",
  searchScope: "area",
});

const puliLocalityOnly = await resolveValidatedDestinationAreaScope({
  input: "埔里有什麼咖啡廳",
  locale: "zh-TW",
  geocodeFn: async () => ({
    location: {
      placeId: "mock:puli-locality",
      country: "台灣",
      city: "埔里鎮",
      region: "南投縣",
      lat: 23.97,
      lng: 120.97,
      formattedName: "埔里鎮",
      displayLabel: "埔里鎮",
      address: "台灣南投縣埔里鎮",
    },
    error: null,
  }),
});
assert.deepEqual(
  puliLocalityOnly,
  {
    displayLabel: "南投埔里",
    parentCity: "南投",
    area: "埔里",
    searchScope: "area",
  },
  "township locality evidence must count as the geographic entity",
);

let shibuyaQuery = "";
const validatedShibuya = await resolveValidatedDestinationAreaScope({
  input: "澀谷有什麼咖啡廳",
  locale: "zh-TW",
  geocodeFn: async ({ data }) => {
    shibuyaQuery = data.query;
    return {
      location: {
        placeId: "mock:shibuya",
        country: "日本",
        city: "東京",
        region: "東京都",
        district: "澀谷區",
        sublocality: "澀谷區",
        lat: 35.66,
        lng: 139.7,
        formattedName: "日本・澀谷區",
        displayLabel: "東京都澀谷區",
        address: "日本東京都澀谷區",
      },
      error: null,
    };
  },
});
assert.equal(shibuyaQuery, "澀谷");
assert.deepEqual(validatedShibuya, {
  displayLabel: "東京澀谷",
  parentCity: "東京",
  area: "澀谷",
  searchScope: "area",
});

const validatedShibuyaJa = await resolveValidatedDestinationAreaScope({
  input: "澀谷有什麼咖啡廳",
  locale: "zh-TW",
  geocodeFn: async () => ({
    location: {
      placeId: "mock:shibuya-ja-provider",
      country: "日本",
      city: "東京",
      region: "東京都",
      district: "渋谷区",
      sublocality: "渋谷区",
      lat: 35.66,
      lng: 139.7,
      formattedName: "渋谷区",
      displayLabel: "東京都渋谷区",
      address: "日本東京都渋谷区",
    },
    error: null,
  }),
});
assert.deepEqual(
  validatedShibuyaJa,
  {
    displayLabel: "東京澀谷",
    parentCity: "東京",
    area: "澀谷",
    searchScope: "area",
  },
  "Japanese 渋谷区 must uniquely confirm Traditional 澀谷 without a Tokyo special case",
);

assert.equal(
  await resolveValidatedDestinationAreaScope({
    input: "XX有什麼咖啡廳",
    locale: "zh-TW",
    geocodeFn: async () => ({
      location: {
        placeId: "mock:ambiguous-xx",
        country: "台灣",
        city: "",
        region: "XX",
        district: "XX",
        lat: 25,
        lng: 121,
        formattedName: "XX",
        displayLabel: "XX",
      },
      error: null,
    }),
  }),
  null,
  "ambiguous geographic labels must not guess a parent region",
);

const chatSource = readFileSync(new URL("../src/routes/_app.chat.tsx", import.meta.url), "utf8");
assert.match(
  chatSource,
  /if \(provisionalArea && !validatedAreaScope\)[\s\S]*你指的是哪個地區的\$\{provisionalArea\.areaCandidate\}[\s\S]*return true;/,
  "an unresolved explicit geographic label must be handled before stale-session fallback",
);
assert.match(
  chatSource,
  /arbitration\.route === "NEW_RECOMMENDATION"[\s\S]*pushDestinationCategoryPlaceRecommendation/,
  "NEW_RECOMMENDATION must still attempt destination category search when destination is unresolved",
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

const shibuyaScope = resolveDestinationAreaScope("東京澀谷");
assert.ok(shibuyaScope);
assert.deepEqual(
  matchPlaceToDestinationArea(place("shibuya-zh", "東京都澀谷區道玄坂 1-1"), shibuyaScope),
  { areaMatched: true, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(place("shibuya-ja", "東京都渋谷区道玄坂 1-1"), shibuyaScope),
  { areaMatched: true, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(
    place("shibuya-en", "1-1 Dogenzaka, Shibuya City, Tokyo, Japan"),
    shibuyaScope,
  ),
  { areaMatched: true, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(place("shibuya-ku", "東京都渋谷区神南 1-1"), shibuyaScope),
  { areaMatched: true, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(place("shinjuku", "東京都新宿区西新宿 1-1"), shibuyaScope),
  { areaMatched: false, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(place("minato", "東京都港区六本木 1-1"), shibuyaScope),
  { areaMatched: false, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(place("meguro", "東京都目黒区中目黒 1-1"), shibuyaScope),
  { areaMatched: false, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(place("setagaya", "東京都世田谷区三軒茶屋 1-1"), shibuyaScope),
  { areaMatched: false, parentCityMatched: true },
);

const shinjukuScope = resolveDestinationAreaScope("東京新宿");
assert.ok(shinjukuScope);
assert.deepEqual(
  matchPlaceToDestinationArea(
    place("shinjuku-en", "1-1 Nishishinjuku, Shinjuku City, Tokyo, Japan"),
    shinjukuScope,
  ),
  { areaMatched: true, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(place("shinjuku-other-ward", "東京都渋谷区道玄坂 1-1"), shinjukuScope),
  { areaMatched: false, parentCityMatched: true },
);

assert.equal(
  locationValidatesDestinationArea(
    { displayLabel: "東京澀谷", parentCity: "東京", area: "澀谷" },
    {
      placeId: "mock:shibuya-ja",
      country: "日本",
      city: "Tokyo",
      region: "Tokyo",
      district: "Shibuya City",
      sublocality: "渋谷区",
      lat: 35.66,
      lng: 139.7,
      formattedName: "Shibuya City",
      displayLabel: "Shibuya City, Tokyo",
      address: "Tokyo, Shibuya City, Japan",
    },
  ),
  true,
  "Japanese/English Shibuya evidence must validate Traditional 澀谷",
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

const sixUsableShibuya = selectAreaFirstCandidates(
  Array.from({ length: 6 }, (_, index) =>
    scoped(`shibuya-cafe-${index + 1}`, "area_primary", true),
  ),
  [scoped("shinjuku-1", "city_primary", false), scoped("minato-1", "city_primary", false)],
  24,
  { explicitAreaConstraint: true },
);
assert.equal(sixUsableShibuya.length, 6, "area pool must retain all usable area-matched candidates");
assert.deepEqual(
  sixUsableShibuya.map((candidate) => candidate.place.id),
  [
    "shibuya-cafe-1",
    "shibuya-cafe-2",
    "shibuya-cafe-3",
    "shibuya-cafe-4",
    "shibuya-cafe-5",
    "shibuya-cafe-6",
  ],
);
assert.equal(
  sixUsableShibuya.every((candidate) => candidate.areaMatched),
  true,
  "retained pool must stay inside the requested area",
);
console.log("  ✓ explicit area session pool keeps all usable candidates (no minResults truncation)");

const canonicalPlace = { id: "ChIJcanonical", googlePlaceId: "ChIJcanonical" };
assert.deepEqual(canonicalPlace, { id: "ChIJcanonical", googlePlaceId: "ChIJcanonical" });

const emptyCategorySession = {
  recommendedPlaces: [],
  selectedPlaces: [],
  phase: "discover",
  discovery: {},
  updatedAt: "",
};
const emptyCategoryCtx = { interests: [] };

const explicitCityDistrictFixtures = [
  ["台中東區有什麼咖啡廳推薦嗎", "台中", "東區"],
  ["台南東區有什麼咖啡廳推薦嗎", "台南", "東區"],
  ["嘉義東區有什麼咖啡廳推薦嗎", "嘉義", "東區"],
  ["新竹東區有什麼咖啡廳推薦嗎", "新竹", "東區"],
];
for (const [text, parentCity, area] of explicitCityDistrictFixtures) {
  const generic = extractGenericDestinationAreaCandidate(text);
  assert.ok(generic, text);
  assert.equal(generic.parentCity, parentCity, text);
  assert.equal(generic.area, area, text);
  const scope = resolveDestinationAreaScope(text);
  assert.ok(scope, `${text} must keep explicit city+district before Places`);
  assert.equal(scope.parentCity, parentCity);
  assert.equal(scope.area, area);
  assert.equal(scope.searchScope, "area");
  assert.equal(scope.displayLabel, `${parentCity}${area}`);
  const parsed = parsePlaceRecommendationIntent(text);
  assert.equal(parsed?.destinationName, `${parentCity}${area}`);
  assert.equal(parsed?.destinationDisplayLabel, `${parentCity}${area}`);
  assert.equal(parsed?.resolvedSearchCity, parentCity);
  assert.equal(parsed?.destinationArea, area);
  assert.equal(parsed?.searchScope, "area");
  assert.equal(
    resolveDestinationForCategorySearch(emptyCategoryCtx, emptyCategorySession, text),
    `${parentCity}${area}`,
  );
}
assert.notEqual(
  resolveDestinationAreaScope("台中東區")?.parentCity,
  resolveDestinationAreaScope("台南東區")?.parentCity,
  "same-named 東區 must stay bound to the parent city in the utterance",
);
assert.equal(resolveDestinationAreaScope("嘉義東區")?.parentCity, "嘉義");
assert.notEqual(resolveDestinationAreaScope("嘉義東區")?.parentCity, "台中");
assert.notEqual(resolveDestinationAreaScope("嘉義東區")?.parentCity, "台南");

assert.equal(resolveDestinationAreaScope("高雄有安靜咖啡廳嗎"), null);
assert.equal(
  extractGenericDestinationAreaCandidate("高雄有安靜咖啡廳嗎"),
  null,
  "city + 有 + modifier is not an explicit district",
);
const cityWideTaichung = parsePlaceRecommendationIntent("台中有什麼咖啡廳推薦嗎");
assert.equal(resolveDestinationAreaScope("台中有什麼咖啡廳推薦嗎"), null);
assert.equal(cityWideTaichung?.destinationName, "台中");
assert.equal(cityWideTaichung?.searchScope, "city");
assert.equal(cityWideTaichung?.destinationArea, undefined);
assert.equal(
  resolveDestinationForCategorySearch(
    emptyCategoryCtx,
    emptyCategorySession,
    "台中有什麼咖啡廳推薦嗎",
  ),
  "台中",
);

assert.ok(extractProvisionalDestinationAreaCandidate("西屯有什麼咖啡廳"));
assert.equal(resolveDestinationAreaScope("西屯有什麼咖啡廳"), null);
assert.ok(resolveDestinationAreaScope("東京新宿有什麼咖啡廳推薦"));
assert.equal(resolveDestinationAreaScope("東京新宿")?.parentCity, "東京");
assert.equal(resolveDestinationAreaScope("東京新宿")?.area, "新宿");

const taichungEastCandidate = extractGenericDestinationAreaCandidate(
  "台中東區有什麼咖啡廳推薦嗎",
);
assert.ok(taichungEastCandidate);
assert.equal(
  locationValidatesDestinationArea(taichungEastCandidate, {
    placeId: "mock:taichung-east",
    country: "台灣",
    city: "臺中市",
    region: "臺中市",
    lat: 24.137,
    lng: 120.698,
    formattedName: "臺中市東區",
    displayLabel: "臺中市東區",
    address: "台灣臺中市東區",
  }),
  true,
  "臺中市東區 provider evidence must validate 台中/東區 without a city whitelist",
);

const validatedTaichungEast = await resolveValidatedDestinationAreaScope({
  input: "台中東區有什麼咖啡廳推薦嗎",
  locale: "zh-TW",
  geocodeFn: async ({ data }) => {
    assert.equal(data.query, "台中東區");
    return {
      location: {
        placeId: "mock:taichung-east-provider",
        country: "台灣",
        city: "臺中市",
        region: "臺中市",
        district: "東區",
        lat: 24.137,
        lng: 120.698,
        formattedName: "臺中市東區",
        displayLabel: "臺中市東區",
        address: "台灣臺中市東區",
      },
      error: null,
    };
  },
});
assert.deepEqual(validatedTaichungEast, {
  displayLabel: "台中東區",
  parentCity: "台中",
  area: "東區",
  searchScope: "area",
});

const taichungEastPlaceScope = resolveDestinationAreaScope("台中東區");
assert.ok(taichungEastPlaceScope);
assert.deepEqual(
  matchPlaceToDestinationArea(
    place("east", "台中市東區復興路4段1號"),
    taichungEastPlaceScope,
  ),
  { areaMatched: true, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(
    place("west", "台中市西區民生路100號"),
    taichungEastPlaceScope,
  ),
  { areaMatched: false, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(
    place("xitun", "台中市西屯區台灣大道3段"),
    taichungEastPlaceScope,
  ),
  { areaMatched: false, parentCityMatched: true },
);

const tainanEastPlaceScope = resolveDestinationAreaScope("台南東區");
assert.ok(tainanEastPlaceScope);
assert.deepEqual(
  matchPlaceToDestinationArea(
    place("tainan-east", "台南市東區中華東路3段"),
    tainanEastPlaceScope,
  ),
  { areaMatched: true, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(
    place("taichung-east-wrong-parent", "台中市東區復興路4段1號"),
    tainanEastPlaceScope,
  ),
  { areaMatched: true, parentCityMatched: false },
);

const eastAttempts = buildChatPlaceSearchAttempts(
  "cafe",
  "台中東區",
  "台中東區有什麼咖啡廳推薦嗎",
);
assert.ok(eastAttempts.primary.every((attempt) => attempt.query.includes("台中東區")));
assert.ok(
  eastAttempts.fallback.some(
    (attempt) => attempt.query.includes("台中") && !attempt.query.includes("東區"),
  ),
);

const mergedEast = mergeTravelContext(
  {
    recommendedPlaces: [],
    selectedPlaces: [],
    phase: "discover",
    discovery: {},
    updatedAt: new Date().toISOString(),
    travelContext: { interests: [] },
  },
  "台中東區有什麼咖啡廳推薦嗎",
);
assert.equal(mergedEast.context.destination, "台中東區");
assert.notEqual(mergedEast.context.destination, "台中");

assert.match(
  chatSource,
  /persistedAreaScope[\s\S]*parentCity: persistedAreaScope\?\.parentCity/,
  "recommendation session must persist structured area even if geocode validation misses",
);

const eastPool = Array.from({ length: 6 }, (_, index) => ({
  name: `東區咖啡 ${index + 1}`,
  googlePlaceId: `ChIJtaichung_east_${index + 1}`,
  address: "台中市東區復興路4段1號",
}));
const eastSession = createRecommendationSession({
  destination: "台中東區",
  parentCity: "台中",
  area: "東區",
  searchScope: "area",
  topic: "cafe",
  pool: eastPool,
  batchSize: DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE,
});
assert.equal(eastSession.session.destination, "台中東區");
assert.equal(eastSession.session.parentCity, "台中");
assert.equal(eastSession.session.area, "東區");
assert.equal(eastSession.session.searchScope, "area");
const eastMore = continueRecommendation(eastSession.session);
assert.equal(eastMore.session.destination, "台中東區");
assert.equal(eastMore.session.parentCity, "台中");
assert.equal(eastMore.session.area, "東區");
assert.equal(eastMore.session.searchScope, "area");
assert.notEqual(eastMore.session.destination, "台中");

const curatedSource = readFileSync(
  new URL("../src/lib/ai/destination-travel-profile.ts", import.meta.url),
  "utf8",
);
assert.equal(
  /台中:[\s\S]*?districts:\s*\[[^\]]*東區/.test(curatedSource),
  false,
  "must not add 東區 to the Taichung district whitelist",
);

const banqiaoQuery = "新北板橋有什麼咖啡廳推薦嗎";
const banqiaoScope = resolveDestinationAreaScope(banqiaoQuery);
assert.deepEqual(banqiaoScope, {
  displayLabel: "新北板橋",
  parentCity: "新北",
  area: "板橋",
  searchScope: "area",
});
const banqiaoParsed = parsePlaceRecommendationIntent(banqiaoQuery);
assert.equal(banqiaoParsed?.destinationName, "新北板橋");
assert.equal(banqiaoParsed?.resolvedSearchCity, "新北");
assert.equal(banqiaoParsed?.destinationArea, "板橋");
assert.equal(banqiaoParsed?.searchScope, "area");
assert.notEqual(banqiaoParsed?.resolvedSearchCity, "新北板橋");

assert.deepEqual(
  matchPlaceToDestinationArea(place("banqiao-zh", "新北市板橋區文化路一段188號"), banqiaoScope),
  { areaMatched: true, parentCityMatched: true },
);
assert.deepEqual(
  matchPlaceToDestinationArea(
    place("banqiao-en", "188 Sec. 1, Wenhua Rd, Banqiao District, New Taipei City, Taiwan"),
    banqiaoScope,
  ),
  { areaMatched: true, parentCityMatched: true },
  "New Taipei English evidence must confirm parentCity=新北",
);

const banqiaoGuard = buildDestinationGuardProfile("新北板橋");
assert.ok(banqiaoGuard.acceptMarkers.includes("新北"));
assert.ok(banqiaoGuard.acceptMarkers.includes("板橋"));
assert.equal(
  filterPlacesByDestinationGuard(
    [place("banqiao-zh", "新北市板橋區文化路一段188號")],
    "新北板橋",
  ).length,
  1,
  "city destination guard must not require concatenated 新北板橋 inside 新北市板橋區",
);

const fengshanScope = resolveDestinationAreaScope("高雄鳳山有什麼咖啡廳推薦嗎");
assert.equal(fengshanScope?.parentCity, "高雄");
assert.equal(fengshanScope?.area, "鳳山");
assert.equal(parsePlaceRecommendationIntent("高雄鳳山有什麼咖啡廳推薦嗎")?.resolvedSearchCity, "高雄");

const categorySource = readFileSync(
  new URL("../src/lib/ai/chat-destination-category-recommendation.ts", import.meta.url),
  "utf8",
);
assert.match(
  categorySource,
  /destinationAreaScope\?\.parentCity \?\?/,
  "PLACE_RECOMMENDATION_SEARCH_START must use structured parentCity as resolvedSearchCity",
);

console.info("verify-destination-area-scope: ok");
