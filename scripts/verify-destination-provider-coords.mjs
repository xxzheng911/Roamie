/**
 * Smoke: extractCoordinatesFromProviderResponse + query caps + country normalize.
 */
import assert from "node:assert/strict";
import { extractCoordinatesFromProviderResponse, extractDestinationCandidatesFromProviderResponse } from "../src/lib/ai/destination-provider-coords.ts";
import {
  buildDestinationGeocodeQueries,
  resolveGeocodeRegionBias,
} from "../src/lib/ai/destination-geocode.ts";
import { countryCodeForCountryName } from "../src/lib/ai/resolved-destination-scope.ts";
import { normalizeCountryReference } from "../src/lib/ai/destination-country-normalize.ts";

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

check("empty status still extracts geometry.location", () => {
  const extracted = extractCoordinatesFromProviderResponse({
    status: "",
    results: [
      {
        place_id: "x",
        formatted_address: "Nagoya",
        geometry: { location: { lat: 35.18, lng: 136.9 } },
        types: ["locality", "political"],
        address_components: [{ long_name: "Japan", short_name: "JP", types: ["country"] }],
      },
    ],
  });
  assert.equal(extracted.candidates.length, 1);
  assert.equal(extracted.candidates[0].latitude, 35.18);
  assert.equal(extracted.candidates[0].countryCode, "JP");
});

check("lat()/lng() callables extracted", () => {
  const extracted = extractCoordinatesFromProviderResponse({
    results: [
      {
        geometry: {
          location: {
            lat: () => 30.0444,
            lng: () => 31.2357,
          },
        },
        types: ["locality"],
      },
    ],
  });
  assert.equal(extracted.candidates.length, 1);
  assert.equal(extracted.candidates[0].latitude, 30.0444);
});

check("0,0 is finite and accepted", () => {
  const extracted = extractCoordinatesFromProviderResponse({
    results: [{ geometry: { location: { lat: 0, lng: 0 } }, types: ["locality"] }],
  });
  assert.equal(extracted.candidates.length, 1);
});

check("extractDestinationCandidatesFromProviderResponse candidates[]", () => {
  const list = extractDestinationCandidatesFromProviderResponse(
    { candidates: [{ name: "Cairo", location: { latitude: 30.04, longitude: 31.23 } }] },
    { provider: "proxy", sourceQuery: "Cairo" },
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].provider, "proxy");
  assert.ok(Number.isFinite(list[0].latitude));
});

check("Egypt country normalize → EG", () => {
  assert.equal(normalizeCountryReference("埃及").countryCode, "EG");
  assert.equal(countryCodeForCountryName("埃及"), "EG");
  assert.equal(resolveGeocodeRegionBias("埃及", "EG"), "eg");
});

check("Places New location.latitude/longitude", () => {
  const extracted = extractCoordinatesFromProviderResponse({
    id: "places/abc",
    displayName: { text: "Phuket" },
    location: { latitude: 7.88, longitude: 98.39 },
    types: ["administrative_area_level_1"],
  });
  assert.equal(extracted.candidates.length, 1);
  assert.ok(Number.isFinite(extracted.candidates[0].latitude));
  assert.ok(Number.isFinite(extracted.candidates[0].longitude));
});

check("query cap <= 3 for Nagoya / Phuket / Gobi", () => {
  for (const [dest, country] of [
    ["名古屋", "日本"],
    ["普吉島", "泰國"],
    ["戈壁", "蒙古"],
  ]) {
    const plan = buildDestinationGeocodeQueries(dest, "zh-TW", country);
    assert.ok(plan.length <= 3, `${dest} queryCount=${plan.length}`);
    assert.ok(plan.length >= 1, `${dest} empty plan`);
  }
});

check("country normalize 日本/泰國/蒙古 → JP/TH/MN", () => {
  assert.equal(normalizeCountryReference("日本").countryCode, "JP");
  assert.equal(normalizeCountryReference("泰國").countryCode, "TH");
  assert.equal(normalizeCountryReference("蒙古").countryCode, "MN");
  assert.equal(countryCodeForCountryName("蒙古"), "MN");
  assert.equal(resolveGeocodeRegionBias("日本", "日本"), "jp");
  assert.equal(resolveGeocodeRegionBias("蒙古", "蒙古"), "mn");
  assert.equal(resolveGeocodeRegionBias("日本", "JP"), "jp");
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\n[verify-destination-provider-coords] ok");
