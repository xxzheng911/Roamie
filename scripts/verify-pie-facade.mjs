#!/usr/bin/env node
/**
 * PIE Facade Phase 1 Step A 契約驗證（不打真實 Places API）。
 * 執行：npx vite-node --config scripts/vite.verify.config.mjs scripts/verify-pie-facade.mjs
 */
import assert from "node:assert/strict";
import {
  getPieFacade,
  isPieFacadeEnabled,
  pieFacade,
  setPieFacadeEnabledOverride,
  searchAutocompleteViaGateway,
  searchExploreViaGateway,
  getPlaceLiteDetailsViaGateway,
  fetchPlaceDetailsForScreenViaGateway,
  getPlaceImageViaGateway,
  normalizePlaceViaGateway,
} from "../src/lib/pie/index.ts";
import {
  normalizePlace as legacyNormalizePlace,
  searchPlaces as legacySearchAutocomplete,
  getPlaceDetails as legacyGetPlaceLiteDetails,
} from "../src/services/placesService.ts";
import {
  executeExploreSearch,
  fetchPlaceDetailsForScreen,
} from "../src/lib/places.functions.ts";
import { getPlaceImage as legacyGetPlaceImage } from "../src/services/placeImageService.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

console.info("[verify:pie-facade] Phase 1 Step A\n");

test("default feature flag is OFF (legacy path for TestFlight)", () => {
  setPieFacadeEnabledOverride(null);
  assert.equal(isPieFacadeEnabled(), false);
});

test("override can enable / disable flag", () => {
  setPieFacadeEnabledOverride(true);
  assert.equal(isPieFacadeEnabled(), true);
  setPieFacadeEnabledOverride(false);
  assert.equal(isPieFacadeEnabled(), false);
  setPieFacadeEnabledOverride(null);
});

test("facade version and capabilities", () => {
  const facade = getPieFacade();
  assert.equal(facade.version, "1.0.0-step-b");
  assert.deepEqual([...facade.capabilities].sort(), [
    "cache",
    "detail",
    "image",
    "normalize",
    "search",
  ]);
});

test("facade methods are the same function references as legacy modules", () => {
  assert.equal(pieFacade.searchAutocomplete, legacySearchAutocomplete);
  assert.equal(pieFacade.searchExplore, executeExploreSearch);
  assert.equal(pieFacade.getPlaceLiteDetails, legacyGetPlaceLiteDetails);
  assert.equal(pieFacade.fetchPlaceDetailsForScreen, fetchPlaceDetailsForScreen);
  assert.equal(pieFacade.getPlaceImage, legacyGetPlaceImage);
  assert.equal(pieFacade.normalizePlace, legacyNormalizePlace);
});

test("normalizePlace delegate matches legacy output", () => {
  const input = {
    placeId: "places/ChIJtest",
    name: "測試地點",
    address: "台北",
    lat: 25.0,
    lng: 121.5,
    rating: 4.5,
  };
  assert.deepEqual(pieFacade.normalizePlace(input), legacyNormalizePlace(input));
});

test("gateway normalize matches legacy whether flag ON or OFF", () => {
  const input = {
    placeId: "ChIJabc",
    name: "Gateway Test",
    address: "Tokyo",
    lat: 35.6,
    lng: 139.7,
  };
  const expected = legacyNormalizePlace(input);

  setPieFacadeEnabledOverride(false);
  assert.deepEqual(normalizePlaceViaGateway(input), expected);

  setPieFacadeEnabledOverride(true);
  assert.deepEqual(normalizePlaceViaGateway(input), expected);

  setPieFacadeEnabledOverride(null);
});

test("gateway exports are callable functions", () => {
  for (const fn of [
    searchAutocompleteViaGateway,
    searchExploreViaGateway,
    getPlaceLiteDetailsViaGateway,
    fetchPlaceDetailsForScreenViaGateway,
    getPlaceImageViaGateway,
    normalizePlaceViaGateway,
  ]) {
    assert.equal(typeof fn, "function");
  }
});

test("cache / detail / image delegate namespaces exist", () => {
  assert.equal(typeof pieFacade.cache.readUnifiedPlaceDetailsCache, "function");
  assert.equal(typeof pieFacade.cache.writeUnifiedPlaceDetailsCache, "function");
  assert.equal(typeof pieFacade.detail.resolveGooglePlaceIdForDetail, "function");
  assert.equal(typeof pieFacade.image.resolveGooglePlacePhoto, "function");
});

console.info("\n[verify:pie-facade] all passed");
