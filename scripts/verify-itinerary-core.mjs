/**
 * Core itinerary policy + planner gates (pool, real place, assign/refill, overwrite guard).
 */
import assert from "node:assert/strict";
import {
  countDiningPoolPlaces,
  countScenicPoolPlaces,
  isPlannerPoolReady,
  minCandidatePoolSize,
  minDiningPoolSize,
  minRenderableItemsPerDay,
  minScenicPoolSize,
  redistributePlacesEvenly,
} from "../src/lib/ai/ai-multi-day-planner.ts";
import {
  isItineraryRenderable,
  plannerTotalPlaces,
  preferBetterComposedPlans,
  ensureAllDayPlansExist,
} from "../src/lib/ai/ai-day-plan-source.ts";
import {
  filterRealPlanningPlaces,
  isRealGooglePlanningPlace,
  resolvePlanningPlaceId,
} from "../src/lib/ai/planning-real-place.ts";
import { normalizeGooglePlace, normalizeGooglePlaces } from "../src/lib/ai/normalize-google-place.ts";
import {
  buildRealCityPool,
  chijPlaceId,
  INTEGRATION_CITIES,
  mockRealPlace,
  finishVerifyScript,
} from "./lib/itinerary-verify-helpers.mjs";

let failures = 0;

function ok(message) {
  console.log(`OK ${message}`);
}

function fail(message) {
  console.error(`FAIL ${message}`);
  failures += 1;
}

function check(name, fn) {
  try {
    fn();
    ok(name);
  } catch (error) {
    fail(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("=== verify-itinerary-core ===\n");

check("minCandidatePoolSize(4)=24", () => {
  assert.equal(minCandidatePoolSize(4), 24);
  assert.equal(minDiningPoolSize(4), 12);
  assert.equal(minScenicPoolSize(4), 12);
});

check("real place filter accepts places/ prefix ids", () => {
  const normalized = normalizeGooglePlace({
    id: "places/ChIJabc123def456ghi789",
    displayName: { text: "赤崁樓" },
    location: { latitude: 23, longitude: 120 },
    types: ["tourist_attraction"],
  });
  assert.ok(normalized);
  assert.equal(isRealGooglePlanningPlace(normalized), true);
  assert.equal(normalized.id, "ChIJabc123def456ghi789");
});

check("pool=8 for 4d is not ready", () => {
  const city = INTEGRATION_CITIES[0];
  const tiny = normalizeGooglePlaces(
    Array.from({ length: 8 }, (_, i) =>
      mockRealPlace({
        name: `台中景點${i + 1}`,
        city: city.name,
        lat: city.lat,
        lng: city.lng,
        kind: "attraction",
        index: i,
        cityCode: city.code,
      }),
    ),
  );
  assert.equal(filterRealPlanningPlaces(tiny).length, 8);
  assert.equal(isPlannerPoolReady(tiny, 4), false);
});

check("pool=24 composition ready for 4d", () => {
  const city = INTEGRATION_CITIES[0];
  const pool = normalizeGooglePlaces(buildRealCityPool(city, 4));
  assert.ok(pool.length >= 24);
  assert.equal(isPlannerPoolReady(pool, 4), true);
  assert.ok(countDiningPoolPlaces(pool) >= 12);
  assert.ok(countScenicPoolPlaces(pool) >= 12);
});

check("12/4 redistribute is not renderable", () => {
  const city = INTEGRATION_CITIES[1];
  const pool = normalizeGooglePlaces(
    Array.from({ length: 12 }, (_, i) =>
      mockRealPlace({
        name: `台南景點${i + 1}`,
        city: city.name,
        lat: city.lat,
        lng: city.lng,
        kind: "attraction",
        index: i,
        cityCode: city.code,
      }),
    ),
  );
  const distributed = redistributePlacesEvenly({ places: pool, days: 4, style: "classic_landmarks" });
  assert.equal(plannerTotalPlaces(distributed), 12);
  assert.equal(isItineraryRenderable(distributed, 4, "classic_landmarks"), false);
});

check("overwrite guard keeps non-empty plan", () => {
  const good = ensureAllDayPlansExist(
    [
      { day: 1, entries: [{ name: "a" }, { name: "b" }, { name: "c" }] },
      { day: 2, entries: [{ name: "d" }, { name: "e" }] },
      { day: 3, entries: [{ name: "f" }, { name: "g" }] },
      { day: 4, entries: [{ name: "h" }, { name: "i" }] },
    ],
    4,
  );
  const empty = ensureAllDayPlansExist([], 4);
  const kept = preferBetterComposedPlans(empty, good, 4);
  assert.equal(plannerTotalPlaces(kept), 9);
});

check("minRenderableItemsPerDay thresholds", () => {
  assert.equal(minRenderableItemsPerDay(1), 5);
  assert.equal(minRenderableItemsPerDay(4), 7);
});

for (const city of INTEGRATION_CITIES) {
  check(`${city.name} 4d pool expansion target`, () => {
    const pool = normalizeGooglePlaces(buildRealCityPool(city, 4));
    assert.equal(isPlannerPoolReady(pool, 4), true);
    assert.ok(pool.every((p) => /^ChIJ/i.test(resolvePlanningPlaceId(p))));
  });
}

finishVerifyScript(failures, "verify-itinerary-core");
