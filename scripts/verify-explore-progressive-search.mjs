import assert from "node:assert/strict";
import fs from "node:fs";
import { exploreSearchPresentation } from "../src/lib/explore-search-presentation";
import {
  isPinnableSearchSelection,
  normalizeExplorePlaceId,
} from "../src/lib/explore-selected-place";
import { pickExploreCitySuggestion } from "../src/lib/explore-city-popular-places";
import { isCityRecommendSelection } from "../src/lib/explore-recommend-mode";
import { createLatestRequestGuard } from "../src/lib/latest-request-guard";

const tower = {
  id: "ChIJ_tower",
  name: "남산서울타워",
  lat: 37.55,
  lng: 126.98,
  rating: 1,
  userRatingCount: 0,
  types: ["tourist_attraction", "point_of_interest"],
};
const nearby = { id: "nearby", name: "Nearby" };
for (const label of ["首爾塔", "Tokyo Tower", "大阪城", "Seoul Tower"]) {
  assert.equal(isCityRecommendSelection({ label }), false, label);
  assert.equal(isPinnableSearchSelection({ label, placeId: tower.id, types: tower.types }), true);
}
assert.equal(isCityRecommendSelection({ label: "首爾", types: ["locality", "political"] }), true);
assert.equal(normalizeExplorePlaceId(" places/ChIJ_tower "), tower.id);
const suggestion = { placeId: tower.id, label: tower.name, types: tower.types };
assert.equal(
  pickExploreCitySuggestion("首爾塔", [
    suggestion,
    { placeId: "city", label: "首爾", types: ["locality"] },
  ]),
  suggestion,
  "localized direct hit must not become a city selection",
);

const tokyo = { placeId: "city-tokyo", label: "東京", types: ["locality"] };
assert.equal(
  pickExploreCitySuggestion("東京", [
    { placeId: "cafe", label: "東京咖啡", types: ["establishment"] },
    tokyo,
  ]),
  tokyo,
  "city authority is unchanged for an exact city query",
);

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
let state = {
  primary: null,
  recommendations: [],
  primarySearchLoading: true,
  backgroundRecommendationLoading: true,
};
const view = () => exploreSearchPresentation(state);
assert.equal(view().fullLoading, true);
assert.equal(view().showEmpty, false, "pending must not display zero/empty");
const enrichment = deferred();
const completion = enrichment.promise
  .then((places) => {
    state.recommendations = places;
  })
  .catch(() => {})
  .finally(() => {
    state.backgroundRecommendationLoading = false;
  });
state.primary = tower;
state.primarySearchLoading = false;
assert.deepEqual(view().places, [tower], "direct result renders before enrichment");
assert.equal(view().fullLoading, false);
assert.equal(view().backgroundLoading, true);
enrichment.resolve([{ ...tower, id: "places/ChIJ_tower" }, nearby]);
await completion;
assert.deepEqual(
  view().places,
  [tower, nearby],
  "append with canonical dedupe, preserving primary authority",
);
state.recommendations = [];
state.backgroundRecommendationLoading = true;
const failed = deferred();
const failure = failed.promise
  .catch(() => {})
  .finally(() => {
    state.backgroundRecommendationLoading = false;
  });
failed.reject(Error("enrichment failed"));
await failure;
assert.deepEqual(view().places, [tower], "failed enrichment retains primary");
state.primary = null;
state.backgroundRecommendationLoading = true;
assert.equal(view().showEmpty, false, "fallback pending is not empty");
state.backgroundRecommendationLoading = false;
assert.equal(view().showEmpty, true, "empty only when both phases settle");

const guard = createLatestRequestGuard();
const old = guard.begin("A");
const oldResponse = deferred();
const applied = [];
const pendingOld = oldResponse.promise.then((value) => {
  if (guard.isCurrent(old)) applied.push(value);
});
const current = guard.begin("B");
if (guard.isCurrent(current)) applied.push("B");
oldResponse.resolve("A");
await pendingOld;
assert.deepEqual(applied, ["B"]);

// Wiring contracts complement the async presentation tests above.
const route = fs.readFileSync("src/routes/_app.map.tsx", "utf8");
assert.match(route, /const eligiblePrimary = primary;/);
assert.match(route, /if \(requestId !== searchTargetRequestRef.current\) return false/);
assert.match(
  route,
  /\.catch\(\(e\) => \{\s*if \(requestId !== searchRequestIdRef.current \|\| session.controller.signal.aborted\) return/,
);
assert.match(
  route,
  /if \(requestId === searchTargetRequestRef.current\) \{\s*setResolvingSearchId\(null\)/,
);
assert.match(route, /setResults\(\[mapCard\]\)/);
assert.match(route, /const displayResults = resultPresentation.places/);
assert.match(route, /loading=\{resultPresentation.fullLoading\}/);
assert.match(route, /backgroundLoading=\{resultPresentation.backgroundLoading\}/);
assert.match(route, /displayResults\s*\.filter/);
assert.match(route, /skipLocationBias: true/);
assert.match(
  fs.readFileSync("src/lib/places.functions.ts", "utf8"),
  /data.placesCaller === "map.freeTextSearch" && data.mode === "text"\) return result/,
);
console.log(
  "Explore progressive rendering: 8 scenarios + city/POI/localized ID + route authority contracts PASS",
);
