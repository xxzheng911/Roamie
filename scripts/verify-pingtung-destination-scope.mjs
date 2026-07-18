/**
 * Pingtung (屏東) destination scope regression — country enrichment, region type, climate.
 */
import assert from "node:assert/strict";
import { resolveDestinationApproxCenter } from "../src/lib/ai/destination-geocode.ts";
import {
  validateDestinationScope,
  resolveDestinationCountryLabel,
  enrichDestinationCountry,
  finalizeDestinationScope,
  clearResolvedDestinationScope,
} from "../src/lib/ai/resolved-destination-scope.ts";
import {
  resolveDestinationEntity,
  resolveClimateZoneForDestination,
  isTravelRegionLabel,
} from "../src/lib/ai/destination-entity.ts";
import { lookupStructuredCountryForCity } from "../src/lib/ai/country-city-options.ts";
import { resolveDestinationScopeFields } from "../src/lib/ai/destination-scope.ts";
import { buildDestinationSearchAreas } from "../src/lib/ai/destination-discovery-queries.ts";

const PINGTUNG = { lat: 22.669, lng: 120.489 };
const TAIWAN_DEFAULT = { lat: 23.9739, lng: 120.9823 };

clearResolvedDestinationScope();

// --- Country enrichment ---
assert.equal(lookupStructuredCountryForCity("屏東"), "台灣");
assert.equal(resolveDestinationCountryLabel("屏東"), "台灣");
assert.equal(resolveDestinationEntity("屏東").country, "台灣");

const enriched = enrichDestinationCountry({
  destination: "屏東",
  country: null,
  latitude: PINGTUNG.lat,
  longitude: PINGTUNG.lng,
});
assert.equal(enriched.country, "台灣");
assert.equal(enriched.countryCode, "TW");

// unknown country + TW coords must NOT be country_coordinate_mismatch
const unknownCountryScope = validateDestinationScope({
  destination: "屏東",
  country: null,
  latitude: PINGTUNG.lat,
  longitude: PINGTUNG.lng,
});
assert.equal(unknownCountryScope.ok, true, `expected pass, got ${unknownCountryScope.reason}`);
assert.equal(unknownCountryScope.country, "台灣");
assert.equal(unknownCountryScope.countryCode, "TW");

// Explicit UK + Taiwan coords → real mismatch
const mismatch = validateDestinationScope({
  destination: "愛丁堡",
  country: "英國",
  latitude: PINGTUNG.lat,
  longitude: PINGTUNG.lng,
});
assert.equal(mismatch.ok, false);
assert.equal(mismatch.reason, "country_coordinate_mismatch");

// --- Region type ---
assert.equal(isTravelRegionLabel("屏東"), true);
assert.equal(isTravelRegionLabel("宜蘭"), true);
assert.equal(isTravelRegionLabel("北海道"), true);
assert.equal(resolveDestinationEntity("屏東").type, "region");
const scopeFields = resolveDestinationScopeFields("屏東");
assert.equal(scopeFields.destinationType, "region");
assert.equal(scopeFields.destinationCountry, "台灣");
assert.equal(scopeFields.destinationRegion, "屏東");

// --- Climate ---
const climate = resolveClimateZoneForDestination({
  destination: "屏東",
  country: "台灣",
  latitude: PINGTUNG.lat,
  longitude: PINGTUNG.lng,
});
assert.notEqual(climate.climateZone, "temperate_continental");
assert.ok(
  climate.climateZone === "tropical" || climate.climateZone === "subtropical",
  `unexpected climate=${climate.climateZone}`,
);
assert.equal(climate.source, "coordinates");
assert.notEqual(resolveDestinationEntity("屏東").climateZone, "temperate_continental");

// --- Approx + finalize ---
const approx = resolveDestinationApproxCenter("屏東", "台灣");
assert.ok(approx);
assert.ok(Math.abs(approx.lat - PINGTUNG.lat) < 0.05);
assert.ok(Math.abs(approx.lng - PINGTUNG.lng) < 0.05);
assert.notEqual(approx.lat, TAIWAN_DEFAULT.lat);

const finalized = finalizeDestinationScope({
  destination: "屏東",
  latitude: approx.lat,
  longitude: approx.lng,
  source: "approx_center",
  country: "台灣",
  generationRequestId: "verify_pingtung_1",
});
assert.ok(finalized);
assert.equal(finalized.country, "台灣");
assert.equal(finalized.countryCode, "TW");
assert.equal(finalized.type, "region");

const reused = finalizeDestinationScope({
  destination: "屏東",
  latitude: approx.lat,
  longitude: approx.lng,
  source: "approx_center",
  country: "台灣",
  generationRequestId: "verify_pingtung_1",
});
assert.equal(reused?.scopeId, finalized.scopeId);

// Search areas expand region (縣 + sub-areas via discovery hints later)
const areas = buildDestinationSearchAreas({ destination: "屏東", country: "台灣" });
assert.ok(areas.includes("屏東"));
assert.ok(areas.some((a) => a.includes("縣") || a.includes("市")));

console.log("[verify-pingtung-destination-scope] ok");
console.log(
  JSON.stringify(
    {
      DESTINATION_SCOPE_FINAL: {
        destination: finalized.normalizedName,
        type: finalized.type,
        country: finalized.country,
        countryCode: finalized.countryCode,
        lat: finalized.latitude,
        lng: finalized.longitude,
      },
      climate,
      areas,
    },
    null,
    2,
  ),
);
