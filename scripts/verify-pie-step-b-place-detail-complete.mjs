#!/usr/bin/env node
/**
 * Phase 1 Step B 完結：剩餘 Place Detail 呼叫端皆經 places-gateway。
 *
 * 執行：npm run verify:pie-step-b-place-detail-complete
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pieFacade,
  fetchPlaceDetailsForScreenWithKeyViaGateway,
  fetchPlaceDetailsForIntroViaGateway,
  fetchGooglePlaceDetailsForHandoffViaGateway,
  getPlaceDetailsServerFnViaGateway,
  getPlaceLiteDetailsViaGateway,
  setPieFacadeEnabledOverride,
  resetPieMetrics,
  getPieMetricsSnapshot,
} from "../src/lib/pie/index.ts";
import {
  fetchPlaceDetailsForScreenWithKey,
  fetchPlaceDetailsForIntro,
  getPlaceDetails as getPlaceDetailsServerFn,
} from "../src/lib/places.functions.ts";
import { fetchGooglePlaceDetailsForHandoff } from "../src/lib/place-detail-resolve.ts";
import { getPlaceDetails as getPlaceLiteDetails } from "../src/services/placesService.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

console.info("[verify:pie-step-b-place-detail-complete] Place Detail migration complete\n");

test("facade detail APIs are same references as legacy", () => {
  assert.equal(pieFacade.getPlaceLiteDetails, getPlaceLiteDetails);
  assert.equal(pieFacade.fetchPlaceDetailsForScreenWithKey, fetchPlaceDetailsForScreenWithKey);
  assert.equal(pieFacade.fetchPlaceDetailsForIntro, fetchPlaceDetailsForIntro);
  assert.equal(pieFacade.fetchGooglePlaceDetailsForHandoff, fetchGooglePlaceDetailsForHandoff);
  assert.equal(pieFacade.getPlaceDetailsServerFn, getPlaceDetailsServerFn);
  assert.equal(getPlaceDetailsServerFnViaGateway, getPlaceDetailsServerFn);
});

const callSites = [
  {
    file: "src/components/LocationSearchField.tsx",
    must: [/getPlaceLiteDetailsViaGateway/, /places-gateway/],
    mustNot: [/from ["']@\/services\/placesService["']/],
  },
  {
    file: "src/components/TripStopSearchField.tsx",
    must: [/getPlaceLiteDetailsViaGateway/, /places-gateway/],
    mustNot: [/getPlaceDetails\s*,/, /getPlaceDetails\s+as/],
  },
  {
    file: "src/lib/explore-map-search.ts",
    must: [/getPlaceLiteDetailsViaGateway/, /fetchPlaceDetailsForScreenWithKeyViaGateway/],
    mustNot: [/getPlaceDetails\s*,/, /fetchPlaceDetailsForScreenWithKey\s*,/],
  },
  {
    file: "src/lib/explore-primary-place.ts",
    must: [/fetchPlaceDetailsForScreenWithKeyViaGateway/],
    mustNot: [/fetchPlaceDetailsForScreenWithKey\s*,/],
  },
  {
    file: "src/routes/_app.place.tsx",
    must: [
      /fetchGooglePlaceDetailsForHandoffViaGateway/,
      /fetchPlaceDetailsForScreenWithKeyViaGateway/,
      /getPlaceDetailsServerFnViaGateway/,
    ],
    mustNot: [/fetchGooglePlaceDetailsForHandoff\s*,/, /getPlaceDetails\s*,/],
  },
  {
    file: "src/routes/_app.chat.tsx",
    must: [/getPlaceDetailsServerFnViaGateway/],
    mustNot: [/getPlaceDetails\s*}?\s*from ["']@\/lib\/places\.functions["']/],
  },
  {
    file: "src/routes/_app.map.tsx",
    must: [/getPlaceDetailsServerFnViaGateway/],
    mustNot: [/getPlaceDetails\s+as\s+fetchExplorePlaceDetails/],
  },
  {
    file: "src/lib/recommendation.functions.ts",
    must: [/fetchPlaceDetailsForIntroViaGateway/],
    mustNot: [/fetchPlaceDetailsForIntro\s*}?\s*from ["']@\/lib\/places\.functions["']/],
  },
];

for (const site of callSites) {
  test(`${site.file} uses places-gateway for Place Detail`, () => {
    const src = read(site.file);
    for (const re of site.must) assert.match(src, re);
    for (const re of site.mustNot ?? []) assert.doesNotMatch(src, re);
    assert.doesNotMatch(src, /from ["']@\/lib\/pie\/pie-facade["']/);
  });
}

test("gateway helpers are functions (flag OFF default)", () => {
  setPieFacadeEnabledOverride(null);
  for (const fn of [
    getPlaceLiteDetailsViaGateway,
    fetchPlaceDetailsForScreenWithKeyViaGateway,
    fetchPlaceDetailsForIntroViaGateway,
    fetchGooglePlaceDetailsForHandoffViaGateway,
  ]) {
    assert.equal(typeof fn, "function");
  }
  resetPieMetrics();
  const snap = getPieMetricsSnapshot();
  assert.equal(snap.totals.detail, 0);
});

setPieFacadeEnabledOverride(null);
console.info("\n[verify:pie-step-b-place-detail-complete] all passed");
console.info("PIE Gateway Phase 1 (Place Detail) closed — other Places paths intentionally deferred.");
