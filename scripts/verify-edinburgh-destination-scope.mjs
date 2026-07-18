/**
 * Edinburgh / UK destination scope + discovery query regression checks.
 */
import assert from "node:assert/strict";
import { resolveDestinationApproxCenter } from "../src/lib/ai/destination-geocode.ts";
import {
  validateDestinationScope,
  resolveDestinationCountryLabel,
} from "../src/lib/ai/resolved-destination-scope.ts";
import {
  buildDestinationDiscoveryQueries,
  buildDestinationSearchAreas,
  resolveDiscoveryRegionProfile,
} from "../src/lib/ai/destination-discovery-queries.ts";
import { resolveDestinationEntity } from "../src/lib/ai/destination-entity.ts";
import { lookupStructuredCountryForCity } from "../src/lib/ai/country-city-options.ts";
import { isKnownTouristCityLabel } from "../src/lib/ai/trip-planning-context.ts";

const TAIWAN_DEFAULT = { lat: 23.9739, lng: 120.9823 };
const EDINBURGH = { lat: 55.9533, lng: -3.1883 };

assert.equal(isKnownTouristCityLabel("愛丁堡"), true, "愛丁堡 should be known tourist city");
assert.equal(lookupStructuredCountryForCity("愛丁堡"), "英國");
assert.equal(resolveDestinationEntity("愛丁堡").country, "英國");
assert.equal(resolveDestinationCountryLabel("愛丁堡", "英國"), "英國");
assert.equal(resolveDiscoveryRegionProfile("愛丁堡", "英國"), "europe");

const approx = resolveDestinationApproxCenter("愛丁堡", "英國");
assert.ok(approx, "愛丁堡 must have approx center");
assert.notEqual(approx.lat, TAIWAN_DEFAULT.lat, "must not use Taiwan default lat");
assert.notEqual(approx.lng, TAIWAN_DEFAULT.lng, "must not use Taiwan default lng");
assert.ok(Math.abs(approx.lat - EDINBURGH.lat) < 0.2, "lat near Edinburgh");
assert.ok(Math.abs(approx.lng - EDINBURGH.lng) < 0.2, "lng near Edinburgh");

const unknownIntl = resolveDestinationApproxCenter("虛構海外城", "法國");
assert.equal(unknownIntl, null, "unknown overseas city must not fall back to Taiwan");

const okScope = validateDestinationScope({
  destination: "愛丁堡",
  country: "英國",
  latitude: EDINBURGH.lat,
  longitude: EDINBURGH.lng,
});
assert.equal(okScope.ok, true, "Edinburgh coords valid for UK");

const badScope = validateDestinationScope({
  destination: "愛丁堡",
  country: "英國",
  latitude: TAIWAN_DEFAULT.lat,
  longitude: TAIWAN_DEFAULT.lng,
});
assert.equal(badScope.ok, false, "Taiwan coords invalid for Edinburgh");
assert.ok(
  badScope.reason === "country_coordinate_mismatch" ||
    badScope.reason === "taiwan_default_fallback",
  `unexpected reason=${badScope.reason}`,
);

const areas = buildDestinationSearchAreas({ destination: "愛丁堡", country: "英國" });
assert.ok(!areas.some((a) => a === "愛丁堡市" || /市$/.test(a) && a.includes("愛丁堡")), 
  `must not append 市 for Edinburgh: ${areas.join("|")}`);
assert.ok(areas.includes("Edinburgh") || areas.includes("愛丁堡"), "areas include city name");

const queries = buildDestinationDiscoveryQueries({
  destination: "愛丁堡",
  country: "英國",
  area: "愛丁堡",
});
const blob = queries.join("||");
assert.ok(!/市老街/.test(blob.replace(/\s+/g, "")), `must not build 市老街: ${blob}`);
assert.ok(!queries.some((q) => /老街|夜市|傳統市場/.test(q)), `no Taiwan templates: ${blob}`);
assert.ok(
  queries.some((q) => /old town|museum|historic|park|castle|attraction/i.test(q)),
  `expect Europe themes: ${blob}`,
);

const twQueries = buildDestinationDiscoveryQueries({
  destination: "台南",
  country: "台灣",
  area: "台南",
});
assert.ok(
  twQueries.some((q) => /老街|夜市/.test(q)),
  "Taiwan cities may still use 老街/夜市",
);

console.log("[verify-edinburgh-destination-scope] ok");
console.log(
  JSON.stringify({
    edinburghApprox: approx,
    queries: queries.slice(0, 10),
    areas,
  }),
);
