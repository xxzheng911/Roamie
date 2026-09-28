import assert from "node:assert/strict";
import fs from "node:fs";
import { exploreSearchPresentation } from "../src/lib/explore-search-presentation.ts";
import {
  applyExploreProgressiveUpdate,
  buildMapExploreCacheKeys,
  convergeExploreDisplayedPlaces,
  exploreDisplayedPlaceKey,
  mergeStableExploreProgress,
  resolveExploreFirstPaintCache,
  shouldEnterExploreFullLoading,
  shouldResetExploreResultsForScope,
  stabilizeExploreCardPhoto,
} from "../src/lib/explore-client-loading.ts";
import { mergeExploreAllCategoryResults } from "../src/lib/explore-all-places-merge.ts";
import { searchExploreCategoryPlaces } from "../src/lib/explore-category-search.ts";
import { publishHomeNearbyCache } from "../src/lib/home-nearby-repository.ts";
import { homeNearbyLoadKey } from "../src/lib/home-nearby-picks-policy.ts";
import { homeNearbyLoadPeriodKey } from "../src/lib/home-nearby-search.ts";
import { invalidateMapPlacesCache, writeMapPlacesCache } from "../src/lib/map-places-cache.ts";
import {
  EXPLORE_ALL_SUBCATEGORY_IDS,
  getExploreCategoryById,
} from "../src/lib/places-search-config.ts";

const route = fs.readFileSync("src/routes/_app.map.tsx", "utf8");
const loadingSource = fs.readFileSync("src/lib/explore-client-loading.ts", "utf8");
const cards = fs.readFileSync("src/components/map/MapExplorePlaceCards.tsx", "utf8");

assert.equal([...route.matchAll(/searchExploreCategoryPlaces\(/g)].length, 1);
assert.doesNotMatch(loadingSource, /searchPlaces|\/api\/google|searchNearby|searchText/);
assert.match(route, /useLayoutEffect/);
assert.match(route, /resolveExploreFirstPaintCache/);
assert.match(route, /shouldEnterExploreFullLoading\(visibleResultsRef\.current\.length\)/);
assert.match(route, /applyExploreProgressiveUpdate/);
assert.match(route, /convergeExploreDisplayedPlaces/);
assert.match(cards, /key=\{p\.id\}/);
assert.match(route, /loading=\{resultPresentation\.fullLoading\}/);
assert.match(route, /backgroundLoading=\{resultPresentation\.backgroundLoading\}/);

function place(id, name, extra = {}) {
  return {
    id,
    name,
    originalName: name,
    address: "1 Test Street",
    lat: extra.lat ?? 25.033,
    lng: extra.lng ?? 121.565,
    rating: extra.rating ?? 4.2,
    userRatingCount: extra.userRatingCount ?? 12,
    photoName: extra.photoName ?? `photos/${id}`,
    coverImageUrl: extra.coverImageUrl ?? `https://img.example/${id}`,
    primaryType: extra.primaryType ?? "cafe",
    types: extra.types ?? ["cafe", "point_of_interest", "establishment"],
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openNow: true,
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    categoryId: extra.categoryId ?? "coffee",
    reason: "nearby",
    ...extra,
  };
}

function nearbyLocation(lat, lng, label = "") {
  const scope = buildMapExploreCacheKeys({
    center: { lat, lng },
    categoryId: "all",
    locale: "zh-TW",
    mode: "nearby",
  });
  return { lat, lng, locationKey: scope.locationKey, label };
}

function frame(places, backgroundRecommendationLoading) {
  return exploreSearchPresentation({
    primary: null,
    recommendations: places,
    primarySearchLoading: false,
    backgroundRecommendationLoading,
  });
}

const taipei = nearbyLocation(25.033, 121.565, "台北");
const tokyo = nearbyLocation(35.68, 139.69, "東京");
const warmPlaces = [
  place("ChIJwarm-cafe", "Warm Cafe", { lat: taipei.lat, lng: taipei.lng, rating: 4.8 }),
  place("ChIJwarm-sight", "Warm Sight", {
    lat: taipei.lat,
    lng: taipei.lng,
    rating: 4.4,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction", "point_of_interest", "establishment"],
    categoryId: "sight",
  }),
];
const taipeiAll = buildMapExploreCacheKeys({
  center: taipei,
  categoryId: "all",
  locale: "zh-TW",
  mode: "nearby",
  nearbyLocationKey: taipei.locationKey,
});
writeMapPlacesCache(taipeiAll.cacheKey, warmPlaces, null);

// Case 1: warm cache re-entry paints cards and never enters full loading.
const warm = resolveExploreFirstPaintCache({ locale: "zh-TW", location: taipei, session: null });
assert.equal(warm.source, "explore-map");
assert.equal(warm.categoryId, "all");
assert.equal(warm.query, "");
assert.deepEqual(warm.places.map((item) => item.id), ["ChIJwarm-cafe", "ChIJwarm-sight"]);
assert.equal(shouldEnterExploreFullLoading(warm.places.length), false);
const warmFrames = [];
let shown = warm.places.map((item) => item);
let loading = false;
warmFrames.push(frame(shown, loading));
if (shouldEnterExploreFullLoading(shown.length)) loading = true;
warmFrames.push(frame(shown, loading));
const sightOnly = [shown[1]];
const progressed = mergeStableExploreProgress(shown, sightOnly, exploreDisplayedPlaceKey);
assert.equal(progressed, shown, "background category result must not replace visible cards");
warmFrames.push(frame(progressed, loading));
loading = false;
warmFrames.push(frame(progressed, loading));
assert.equal(warmFrames.filter((item) => item.fullLoading).length, 0);
assert.ok(warmFrames.every((item) => item.places.length === 2));

// Case 2: cache hit plus background hydration keeps cards.
assert.equal(shouldEnterExploreFullLoading(2), false);
assert.equal(frame(shown, true).fullLoading, false);
assert.equal(frame(shown, true).backgroundLoading, true);
assert.equal(frame(shown, true).places.length, 2);

// Case 3 + 4 + 8: progressive categories keep identity, then converge to official ranking.
const coffee = place("ChIJcoffee", "Coffee", { rating: 4.1, categoryId: "coffee" });
const sight = place("ChIJsight", "Sight", {
  rating: 4.9,
  primaryType: "tourist_attraction",
  types: ["tourist_attraction", "point_of_interest", "establishment"],
  categoryId: "sight",
});
const district = place("ChIJdistrict", "District", {
  rating: 4.6,
  primaryType: "shopping_mall",
  types: ["shopping_mall", "point_of_interest", "establishment"],
  categoryId: "district",
  websiteUri: "https://mall.example.test",
  nationalPhoneNumber: "03-1234-5678",
});
let cold = [];
let coldLoading = true;
const coldFrames = [frame(cold, coldLoading)];
assert.equal(shouldEnterExploreFullLoading(cold.length), true);
const batches = [
  [coffee],
  [coffee, sight],
  [coffee, sight, district],
];
for (const batch of batches) {
  const next = applyExploreProgressiveUpdate({
    current: cold,
    incoming: batch,
    requestId: 1,
    currentRequestId: 1,
    aborted: false,
    keyOf: exploreDisplayedPlaceKey,
  });
  assert.ok(next);
  if (cold.length > 0) assert.equal(next[0], cold[0]);
  cold = next;
  coldFrames.push(frame(cold, coldLoading));
}
assert.equal(coldFrames.filter((item) => item.fullLoading).length, 1);
assert.ok(coldFrames.slice(1).every((item) => item.fullLoading === false));
assert.deepEqual(cold.map((item) => item.id), ["ChIJcoffee", "ChIJsight", "ChIJdistrict"]);
assert.equal(cold[0], coffee);
assert.equal(cold[1], sight);

const official = mergeExploreAllCategoryResults(
  { coffee: [coffee], sight: [sight], district: [district] },
  { origin: { lat: taipei.lat, lng: taipei.lng }, timeBucket: "day" },
);
const converged = convergeExploreDisplayedPlaces(cold, official, exploreDisplayedPlaceKey);
assert.deepEqual(
  converged.map(exploreDisplayedPlaceKey),
  official.map(exploreDisplayedPlaceKey),
);
assert.notDeepEqual(
  cold.map((item) => item.id),
  official.map((item) => item.id),
  "progressive order must not freeze the official ranking",
);
assert.equal(converged.find((item) => item.id === coffee.id), coffee);
assert.equal(stabilizeExploreCardPhoto(coffee, { ...coffee, coverImageUrl: "https://signed/new" }).coverImageUrl, coffee.coverImageUrl);
const withoutPhoto = { ...district, photoName: null, coverImageUrl: null };
assert.equal(stabilizeExploreCardPhoto(withoutPhoto, district), district);

// Canonical identity does not duplicate or remount.
const canonical = mergeStableExploreProgress(
  [coffee],
  [{ ...coffee, id: `places/${coffee.id}` }, sight],
  exploreDisplayedPlaceKey,
);
assert.equal(canonical.length, 2);
assert.equal(canonical[0], coffee);

// Case 5: a different location does not reuse the warm cache.
invalidateMapPlacesCache(taipeiAll.cacheKey);
writeMapPlacesCache(taipeiAll.cacheKey, warmPlaces, null);
const otherLocation = resolveExploreFirstPaintCache({
  locale: "zh-TW",
  location: tokyo,
  session: null,
});
assert.equal(otherLocation.source, "none");
assert.equal(otherLocation.places.length, 0);
assert.equal(shouldEnterExploreFullLoading(otherLocation.places.length), true);
assert.equal(
  shouldResetExploreResultsForScope({
    displayedScopeKey: taipeiAll.sessionKey,
    nextScopeKey: otherLocation.sessionKey,
    hasScopeCache: false,
  }),
  true,
);

// Case 6: coffee/city scope does not reuse the nearby all cache.
const coffeeSession = {
  center: {
    lat: 35.68,
    lng: 139.69,
    label: "東京",
    placeId: "ChIJtokyo",
    types: ["locality"],
    primaryType: "locality",
  },
  query: "東京",
  categoryId: "coffee",
  locale: "zh-TW",
  savedAt: Date.now(),
};
const coffeeScope = buildMapExploreCacheKeys({
  center: coffeeSession.center,
  categoryId: "coffee",
  locale: "zh-TW",
  mode: "city",
  cityPlaceId: coffeeSession.center.placeId,
  cityLabel: coffeeSession.center.label,
});
const mismatched = resolveExploreFirstPaintCache({
  locale: "zh-TW",
  location: tokyo,
  session: coffeeSession,
});
assert.equal(mismatched.source, "none");
assert.equal(mismatched.places.length, 0);
assert.equal(mismatched.categoryId, "coffee");
writeMapPlacesCache(coffeeScope.cacheKey, [coffee], null);
const coffeeHit = resolveExploreFirstPaintCache({
  locale: "zh-TW",
  location: tokyo,
  session: coffeeSession,
});
assert.equal(coffeeHit.source, "explore-map");
assert.deepEqual(coffeeHit.places.map((item) => item.id), [coffee.id]);
assert.equal(coffeeHit.mode, "city");

// Invalid cache cannot paint. A different locale is a different scope.
const invalidKey = buildMapExploreCacheKeys({
  center: tokyo,
  categoryId: "all",
  locale: "en",
  mode: "nearby",
});
writeMapPlacesCache(
  invalidKey.cacheKey,
  [place("ChIJlocality", "Locality", { primaryType: "locality", types: ["locality", "political"] })],
  null,
);
assert.equal(
  resolveExploreFirstPaintCache({
    locale: "en",
    location: nearbyLocation(tokyo.lat, tokyo.lng),
    session: null,
  }).source,
  "none",
);

// Shared nearby is only the all/nearby fallback for the same load key.
const sharedCenter = { lat: 22.627, lng: 120.301 };
const sharedLocation = nearbyLocation(sharedCenter.lat, sharedCenter.lng, "高雄");
const sharedPlace = place("ChIJshared-cafe", "Shared Cafe", sharedCenter);
const sharedKey = homeNearbyLoadKey(
  sharedCenter.lat,
  sharedCenter.lng,
  homeNearbyLoadPeriodKey(),
  "zh-TW",
);
publishHomeNearbyCache([sharedPlace], sharedKey, sharedCenter);
const sharedHit = resolveExploreFirstPaintCache({
  locale: "zh-TW",
  location: sharedLocation,
  session: null,
});
assert.equal(sharedHit.source, "shared-nearby");
assert.deepEqual(sharedHit.places.map((item) => item.id), [sharedPlace.id]);
invalidateMapPlacesCache(coffeeScope.cacheKey);
assert.equal(
  resolveExploreFirstPaintCache({
    locale: "zh-TW",
    location: sharedLocation,
    session: coffeeSession,
  }).source,
  "none",
  "a coffee city session must not paint the shared all cache",
);

// Case 7: aborted or superseded progress is dropped.
const kept = [coffee];
assert.equal(
  applyExploreProgressiveUpdate({
    current: kept,
    incoming: [coffee, sight],
    requestId: 1,
    currentRequestId: 2,
    aborted: false,
    keyOf: exploreDisplayedPlaceKey,
  }),
  null,
);
assert.equal(
  applyExploreProgressiveUpdate({
    current: kept,
    incoming: [coffee, sight],
    requestId: 4,
    currentRequestId: 4,
    aborted: true,
    keyOf: exploreDisplayedPlaceKey,
  }),
  null,
);
assert.deepEqual(kept.map((item) => item.id), [coffee.id]);

// Warm subcategory caches still perform zero Google searches.
const budgetCenter = { lat: 24.147, lng: 120.673 };
let searches = 0;
for (const categoryId of EXPLORE_ALL_SUBCATEGORY_IDS) {
  const key = buildMapExploreCacheKeys({
    center: budgetCenter,
    categoryId,
    locale: "zh-TW",
    mode: "nearby",
  }).cacheKey;
  writeMapPlacesCache(
    key,
    [place(`ChIJ${categoryId}`, categoryId, { ...budgetCenter, categoryId, primaryType: "cafe", types: ["cafe", "point_of_interest", "establishment"] })],
    null,
  );
}
const budget = await searchExploreCategoryPlaces(getExploreCategoryById("all"), {
  userLocation: budgetCenter,
  weather: null,
  locale: "zh-TW",
  reasonProfile: null,
  saved: [],
  recommendMode: "nearby",
  searchPlacesFn: async () => {
    searches += 1;
    return { places: [], error: null };
  },
});
assert.equal(searches, 0);
assert.ok(budget.length > 0);

// No ready location means no cache paint and one full loading.
assert.equal(
  resolveExploreFirstPaintCache({ locale: "zh-TW", location: null, session: null }).source,
  "none",
);
assert.equal(frame([], true).fullLoading, true);
assert.equal(frame([coffee], true).fullLoading, false);

console.log("Explore repeated-loading UX: 8 cases + warm request budget 0 PASS");
