import assert from "node:assert/strict";
import fs from "node:fs";
import { exploreSearchPresentation } from "../src/lib/explore-search-presentation.ts";
import {
  applyExploreProgressiveUpdate,
  buildMapExploreCacheKeys,
  capExploreVisiblePlaces,
  convergeExploreDisplayedPlaces,
  exploreAllVisibleDisplayLimit,
  exploreDisplayedPlaceKey,
  mergeStableExploreProgress,
  reconcileExploreVisibleSnapshot,
  resolveExploreFirstPaintCache,
  shouldCommitExploreFirstSnapshot,
  shouldEnterExploreFullLoading,
  shouldResetExploreResultsForScope,
  stabilizeExploreCardPhoto,
} from "../src/lib/explore-client-loading.ts";
import { markerSnapshotChanged, markerSnapshotKey } from "../src/lib/map-marker-snapshot.ts";
import {
  placeCoverRequestIdentity,
  shouldRestartPlaceCoverLoad,
} from "../src/hooks/use-place-cover-image.ts";
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
assert.match(route, /shouldCommitExploreFirstSnapshot/);
assert.match(route, /reconcileExploreVisibleSnapshot/);
assert.doesNotMatch(route, /applyExploreProgressiveUpdate/);
assert.match(route, /convergeExploreDisplayedPlaces/);
assert.match(cards, /key=\{p\.id\}/);
assert.match(route, /loading=\{resultPresentation\.fullLoading\}/);
assert.doesNotMatch(route, /backgroundLoading=\{resultPresentation\.backgroundLoading\}/);
assert.doesNotMatch(cards, /loading \|\| backgroundLoading/);
assert.match(cards, /\{loading \? \(/);
const presentationSource = route.slice(
  route.indexOf("const resultPresentation"),
  route.indexOf("const displayResults"),
);
assert.doesNotMatch(presentationSource, /sortMapCards/);
assert.equal(exploreAllVisibleDisplayLimit(false), 10);

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
assert.equal(
  shouldCommitExploreFirstSnapshot({
    hasVisibleSnapshot: true,
    completedCategories: 3,
    totalCategories: 5,
    bufferedCount: 10,
    displayLimit: 10,
  }),
  false,
  "warm progress must not commit another visible snapshot",
);

// Case 2: cache hit plus background hydration keeps cards.
assert.equal(shouldEnterExploreFullLoading(2), false);
assert.equal(frame(shown, true).fullLoading, false);
assert.equal(frame(shown, true).backgroundLoading, true);
assert.equal(frame(shown, true).places.length, 2);

// Case 3 + 4 + 8: subcategory waves stay in the buffer, then one official reconcile.
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
assert.equal(
  shouldCommitExploreFirstSnapshot({
    hasVisibleSnapshot: false,
    completedCategories: 1,
    totalCategories: 5,
    bufferedCount: 10,
    displayLimit: 10,
  }),
  false,
  "coffee alone must not publish",
);
const firstScreen = Array.from({ length: 10 }, (_, index) =>
  place(`ChIJfirst-${index}`, `First ${index}`, { rating: 4.5 - index * 0.01 }),
);
assert.equal(
  shouldCommitExploreFirstSnapshot({
    hasVisibleSnapshot: false,
    completedCategories: 2,
    totalCategories: 5,
    bufferedCount: firstScreen.length,
    displayLimit: 10,
  }),
  true,
);
cold = capExploreVisiblePlaces(firstScreen, 10);
coldLoading = false;
coldFrames.push(frame(cold, true));
assert.equal(coldFrames.filter((item) => item.fullLoading).length, 1);
assert.equal(coldFrames[1].fullLoading, false);
assert.equal(cold.length, 10);
assert.equal(
  shouldCommitExploreFirstSnapshot({
    hasVisibleSnapshot: true,
    completedCategories: 3,
    totalCategories: 5,
    bufferedCount: 10,
    displayLimit: 10,
  }),
  false,
);
assert.equal(capExploreVisiblePlaces([...firstScreen, district, sight], 10).length, 10);

const official = mergeExploreAllCategoryResults(
  { coffee: [coffee], sight: [sight], district: [district] },
  { origin: { lat: taipei.lat, lng: taipei.lng }, timeBucket: "day" },
);
const converged = convergeExploreDisplayedPlaces([coffee, sight, district], official, exploreDisplayedPlaceKey);
assert.deepEqual(
  converged.map(exploreDisplayedPlaceKey),
  official.map(exploreDisplayedPlaceKey),
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
assert.equal(sharedHit.source, "none", "home nearby cache must not paint Explore");
assert.equal(sharedHit.places.length, 0);
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

function visualMetrics(run) {
  const metrics = {
    visibleSnapshotPublishCount: 0,
    recommendationSpinnerMountCount: 0,
    visibleCountTransitions: 0,
    visibleOrderTransitions: 0,
    cardIdentityReplacementCount: 0,
    markerSnapshotTransitions: 0,
    repeatedPhotoSignCount: 0,
    finalReconcileCount: 0,
    maxVisible: 0,
  };
  let visible = [];
  let spinnerMounted = false;
  let photoSigned = new Set();
  const publish = (next, kind) => {
    if (next === visible) return;
    const previousKeys = visible.map(exploreDisplayedPlaceKey);
    const nextKeys = next.map(exploreDisplayedPlaceKey);
    if (visible.length !== next.length) metrics.visibleCountTransitions += 1;
    if (previousKeys.join("|") !== nextKeys.join("|")) metrics.visibleOrderTransitions += 1;
    const previousByKey = new Map(visible.map((item) => [exploreDisplayedPlaceKey(item), item]));
    for (const item of next) {
      const key = exploreDisplayedPlaceKey(item);
      const previous = previousByKey.get(key);
      if (previous && previous !== item) metrics.cardIdentityReplacementCount += 1;
      const photoIdentity = placeCoverRequestIdentity({
        placeId: item.id,
        photoName: item.photoName,
        url: item.coverImageUrl,
      });
      if (
        photoSigned.has(photoIdentity) &&
        shouldRestartPlaceCoverLoad({
          previousIdentity: photoIdentity,
          nextIdentity: photoIdentity,
          hasDisplayedImage: true,
        })
      ) {
        metrics.repeatedPhotoSignCount += 1;
      }
      photoSigned.add(photoIdentity);
    }
    const previousMarkers = visible.map((item) => markerSnapshotKey({ id: item.id, lat: item.lat, lng: item.lng, title: item.name }));
    const nextMarkers = next.map((item) => markerSnapshotKey({ id: item.id, lat: item.lat, lng: item.lng, title: item.name }));
    if (markerSnapshotChanged(previousMarkers, nextMarkers)) metrics.markerSnapshotTransitions += 1;
    visible = next;
    metrics.visibleSnapshotPublishCount += 1;
    metrics.maxVisible = Math.max(metrics.maxVisible, visible.length);
    if (kind === "reconcile") metrics.finalReconcileCount += 1;
    if (visible.length > 0) spinnerMounted = spinnerMounted;
  };
  if (run.warm) {
    publish(run.warm, "cache");
  } else if (!spinnerMounted) {
    spinnerMounted = true;
    metrics.recommendationSpinnerMountCount = 1;
  }
  for (const wave of run.waves) {
    const buffered = capExploreVisiblePlaces(wave.cards, run.displayLimit);
    assert.ok(buffered.length <= run.displayLimit);
    const beforeKeys = visible.map(exploreDisplayedPlaceKey);
    const beforeLength = visible.length;
    if (
      shouldCommitExploreFirstSnapshot({
        hasVisibleSnapshot: visible.length > 0,
        completedCategories: wave.completedCategories,
        totalCategories: wave.totalCategories,
        bufferedCount: buffered.length,
        displayLimit: run.displayLimit,
      })
    ) {
      publish(buffered, "first");
    }
    if (beforeLength > 0) {
      assert.equal(visible.length, beforeLength, "later subcategory progress must not change visible count");
      assert.deepEqual(
        visible.map(exploreDisplayedPlaceKey),
        beforeKeys,
        "later subcategory progress must not change visible order",
      );
    }
  }
  const reconciled = reconcileExploreVisibleSnapshot(
    visible,
    run.finalPlaces,
    exploreDisplayedPlaceKey,
    run.displayLimit,
  );
  assert.ok(reconciled.length <= run.displayLimit);
  if (reconciled !== visible) publish(reconciled, "reconcile");
  if (!run.warm) assert.equal(metrics.recommendationSpinnerMountCount, spinnerMounted ? 1 : 0);
  if (run.warm) assert.equal(metrics.recommendationSpinnerMountCount, 0);
  return { metrics, visible };
}

const displayLimit = 10;
const wavePlaces = (count, prefix) =>
  Array.from({ length: count }, (_, index) =>
    place(`ChIJ${prefix}-${index}`, `${prefix} ${index}`, {
      lat: 25.03 + index * 0.001,
      lng: 121.56,
      rating: 4.8 - index * 0.01,
    }),
  );
const coldWaves = [4, 7, 12, 12, 12].map((count, index) => ({
  cards: wavePlaces(count, "cold"),
  completedCategories: index + 1,
  totalCategories: 5,
}));
const coldRun = visualMetrics({
  warm: null,
  displayLimit,
  waves: coldWaves,
  finalPlaces: coldWaves[1].cards.slice(0, 8).concat(wavePlaces(3, "final")),
});
assert.equal(coldRun.metrics.recommendationSpinnerMountCount, 1);
assert.equal(coldRun.metrics.visibleSnapshotPublishCount, 2);
assert.equal(coldRun.metrics.finalReconcileCount, 1);
assert.ok(coldRun.metrics.maxVisible <= displayLimit);
assert.equal(coldRun.metrics.repeatedPhotoSignCount, 0);

const warmList = wavePlaces(10, "warm");
const warmRun = visualMetrics({
  warm: warmList,
  displayLimit,
  waves: [1, 2, 3, 4, 5].map((completedCategories) => ({
    cards: wavePlaces(12, "buffer"),
    completedCategories,
    totalCategories: 5,
  })),
  finalPlaces: warmList,
});
assert.equal(warmRun.metrics.recommendationSpinnerMountCount, 0);
assert.equal(warmRun.metrics.visibleSnapshotPublishCount, 1);
assert.equal(warmRun.metrics.finalReconcileCount, 0);
assert.equal(warmRun.metrics.visibleCountTransitions, 1);
assert.deepEqual(warmRun.visible.map((item) => item.id), warmList.map((item) => item.id));

const added = wavePlaces(1, "new")[0];
const shifted = reconcileExploreVisibleSnapshot(
  warmList,
  [added, ...warmList.slice(0, 9)],
  exploreDisplayedPlaceKey,
  displayLimit,
);
assert.equal(shifted.length <= displayLimit, true);
assert.equal(shifted[0], warmList[0], "a small final delta keeps the current first card");
assert.equal(shifted[shifted.length - 1], added);

const coverIdentity = placeCoverRequestIdentity({
  placeId: coffee.id,
  photoName: coffee.photoName,
  url: "https://signed.example/one",
});
assert.equal(
  coverIdentity,
  placeCoverRequestIdentity({
    placeId: coffee.id,
    photoName: coffee.photoName,
    url: "https://signed.example/two",
  }),
);
assert.equal(
  shouldRestartPlaceCoverLoad({
    previousIdentity: coverIdentity,
    nextIdentity: coverIdentity,
    hasDisplayedImage: true,
  }),
  false,
);
assert.equal(
  shouldRestartPlaceCoverLoad({
    previousIdentity: coverIdentity,
    nextIdentity: placeCoverRequestIdentity({ placeId: coffee.id, photoName: "photos/other" }),
    hasDisplayedImage: true,
  }),
  true,
);
assert.equal(
  markerSnapshotChanged(
    warmList.map((item) => markerSnapshotKey(item)),
    warmList.map((item) => markerSnapshotKey(item)),
  ),
  false,
);

console.log("Explore repeated-loading UX: visible snapshot contract + warm request budget 0 PASS");
