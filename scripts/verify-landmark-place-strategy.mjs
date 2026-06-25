import {
  classifyDestinationForPlaceSearch,
  isInternalSubPlaceOfLandmark,
  isLikelyLandmarkDestination,
  buildLandmarkCompanionSearchAttempts,
  filterPlacesForLandmarkCompanionRecommendation,
} from "../src/lib/ai/landmark-place-strategy.ts";
import { filterPlacesForAttractionRecommendation } from "../src/lib/ai/place-recommendation-rules.ts";
import { normalizePlaceName } from "../src/lib/place-planning-memory.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

// Landmark classification
assert(isLikelyLandmarkDestination("阿里山"), "阿里山 is landmark");
assert(isLikelyLandmarkDestination("富士山"), "富士山 is landmark");
assert(isLikelyLandmarkDestination("台北101"), "台北101 is landmark");
assert(!isLikelyLandmarkDestination("台北"), "台北 is city");
assert(!isLikelyLandmarkDestination("東京"), "東京 is city");

const alishanProfile = classifyDestinationForPlaceSearch("阿里山", {
  city: "嘉義縣",
  region: "嘉義縣",
  lat: 23.5,
  lng: 120.8,
  placeId: "x",
  country: "台灣",
  formattedName: "阿里山",
  displayLabel: "阿里山",
});
assert(alishanProfile.kind === "landmark", "阿里山 profile is landmark");
assert(alishanProfile.nearestCity === "嘉義縣", "阿里山 nearest city from geocode");

// Internal sub-place exclusion
const alishanInternals = [
  "阿里山步道",
  "阿里山火車站",
  "阿里山遊客中心",
  "阿里山森林鐵路祝山站",
  "阿里山觀景平台",
  "阿里山國家森林遊樂區",
];
for (const name of alishanInternals) {
  assert(isInternalSubPlaceOfLandmark(name, "阿里山"), `exclude internal: ${name}`);
}

const alishanCompanions = ["奮起湖老街", "檜意森活村", "文化路夜市", "太平雲梯"];
for (const name of alishanCompanions) {
  assert(!isInternalSubPlaceOfLandmark(name, "阿里山"), `allow companion: ${name}`);
}

// Fuji
for (const name of ["富士山五合目", "富士山廣場", "富士山遊客中心", "富士山登山口"]) {
  assert(isInternalSubPlaceOfLandmark(name, "富士山"), `exclude fuji internal: ${name}`);
}
for (const name of ["河口湖", "忍野八海", "新倉山淺間公園", "富士急樂園"]) {
  assert(!isInternalSubPlaceOfLandmark(name, "富士山"), `allow fuji companion: ${name}`);
}

// Taipei 101
for (const name of ["台北101觀景台", "台北101購物中心", "101觀景台"]) {
  assert(isInternalSubPlaceOfLandmark(name, "台北101"), `exclude 101 internal: ${name}`);
}
for (const name of ["象山", "松山文創園區", "國父紀念館", "饒河夜市"]) {
  assert(!isInternalSubPlaceOfLandmark(name, "台北101"), `allow 101 companion: ${name}`);
}

// Search attempts use 周邊 not 必去 for landmark
const attempts = buildLandmarkCompanionSearchAttempts(alishanProfile);
assert(
  attempts.some((a) => /周邊|附近|nearby/i.test(a.query)),
  "landmark searches include nearby queries",
);
assert(
  !attempts.some((a) => /^阿里山 必去/.test(a.query)),
  "landmark searches avoid 阿里山 必去景點 as primary",
);
assert(
  attempts.some((a) => /嘉義/.test(a.query)),
  "landmark searches include nearest city",
);

// Filter pipeline
const filtered = filterPlacesForAttractionRecommendation(
  [
    { name: "阿里山步道", placeId: "a", types: ["tourist_attraction"] },
    { name: "阿里山車站", placeId: "b", types: ["train_station"] },
    { name: "奮起湖老街", placeId: "c", types: ["tourist_attraction"] },
    { name: "檜意森活村", placeId: "d", types: ["museum"] },
    { name: "文化路夜市", placeId: "e", types: ["tourist_attraction"] },
  ],
  { profile: alishanProfile, parentLandmark: "阿里山" },
);
assert(
  filtered.every((p) => !isInternalSubPlaceOfLandmark(p.name, "阿里山")),
  "filtered list has no alishan internals",
);
assert(filtered.some((p) => p.name.includes("奮起湖")), "奮起湖 kept");
assert(filtered.length >= 2, "multiple companions kept");

// Core dedup: 富士山 variants collapse
assert(normalizePlaceName("富士山五合目") === "富士山", "富士山五合目 core is 富士山");
assert(normalizePlaceName("阿里山步道") === "阿里山", "阿里山步道 core is 阿里山");

const deduped = filterPlacesForLandmarkCompanionRecommendation(
  [
    { name: "富士山", placeId: "1" },
    { name: "富士山五合目", placeId: "2" },
    { name: "河口湖", placeId: "3" },
  ],
  { parentLandmark: "富士山" },
);
assert(deduped.length === 1 && deduped[0]?.name === "河口湖", "only companion survives fuji filter");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll landmark place strategy checks passed");
