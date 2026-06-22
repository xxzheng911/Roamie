import { isFoodPreferenceReply, parseFoodPreference, shouldFetchNearbyPlaces } from "../src/lib/ai/chat-dining-flow.ts";
import {
  applyExclusionToSession,
  expandExcludedKeywords,
  filterPlacesByExclusion,
  isExclusionLiftReply,
  isExclusionReply,
  parseExcludedCategoriesFromText,
  parseExcludedCategoryIds,
  placeMatchesExcludedCategories,
} from "../src/lib/ai/recommendation-exclusion.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

const exclusionText = "不要火鍋跟義式";

assert(isExclusionReply(exclusionText), "detect exclusion reply");
assert(!isFoodPreferenceReply(exclusionText), "exclusion is not food preference");
assert(parseFoodPreference(exclusionText) === undefined, "exclusion does not set food preference");

const ids = parseExcludedCategoryIds(exclusionText);
assert(ids.includes("hotpot"), "parses hotpot category");
assert(ids.includes("italian"), "parses italian category");

const expanded = parseExcludedCategoriesFromText(exclusionText);
assert(expanded.includes("火鍋"), "expands hotpot label");
assert(expanded.includes("pizza"), "expands italian synonym pizza");
assert(expanded.includes("pasta"), "expands italian synonym pasta");

const session = createEmptySession();
const withExclusion = applyExclusionToSession(exclusionText, session);
assert((withExclusion.excludedCategories?.length ?? 0) > 0, "session stores excluded categories");
assert(withExclusion.excludedCategories?.includes("火鍋"), "session has hotpot keyword");

const restaurantSession = {
  ...withExclusion,
  activeChatIntent: "restaurant",
  phase: "recommend",
  location: { lat: 25.03, lng: 121.56, city: "台北" },
};
assert(
  shouldFetchNearbyPlaces("restaurant", restaurantSession, exclusionText),
  "exclusion triggers restaurant fetch",
);

const places = [
  { id: "1", name: "馬爾義大利餐廳", address: "台北市", lat: 25.03, lng: 121.56, rating: 4.5, userRatingCount: 100, photoName: null, primaryType: "restaurant", businessStatus: "OPERATIONAL", openStatus: "open", openStatusLabel: "營業中", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "" },
  { id: "2", name: "某某火鍋", address: "台北市", lat: 25.03, lng: 121.56, rating: 4.4, userRatingCount: 80, photoName: null, primaryType: "restaurant", businessStatus: "OPERATIONAL", openStatus: "open", openStatusLabel: "營業中", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "" },
  { id: "3", name: "阿明牛肉麵", address: "台北市", lat: 25.03, lng: 121.56, rating: 4.3, userRatingCount: 60, photoName: null, primaryType: "restaurant", businessStatus: "OPERATIONAL", openStatus: "open", openStatusLabel: "營業中", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "" },
];

const filtered = filterPlacesByExclusion(places, withExclusion.excludedCategories);
assert(!filtered.some((p) => p.name.includes("火鍋")), "filters hotpot place");
assert(!filtered.some((p) => p.name.includes("義大利")), "filters italian place");
assert(filtered.some((p) => p.name.includes("牛肉麵")), "keeps neutral place");

assert(placeMatchesExcludedCategories({ name: "Hot Pot House" }, expandExcludedKeywords(["hotpot"])), "matches english hotpot");
assert(!placeMatchesExcludedCategories({ name: "牛肉麵" }, expandExcludedKeywords(["hotpot", "italian"])), "neutral place not excluded");

const liftSession = applyExclusionToSession("火鍋也可以", {
  ...restaurantSession,
  excludedCategories: expandExcludedKeywords(["hotpot", "italian"]),
});
assert(
  !liftSession.excludedCategories?.includes("火鍋"),
  "lift removes hotpot exclusion",
);

if (failed > 0) process.exit(1);
console.log("\nAll recommendation exclusion checks passed.");
