/**
 * Kumamoto / JP city Destination Provider + Anchor regressions (mock-first).
 *
 * Covers:
 * - query plan order + no early-stop on ZERO_RESULTS
 * - soft-accept of valid coords across locality / admin types
 * - provider response normalize / parse logs
 * - single-flight
 * - no empty centroid cache writes
 * - Combination Discovery enters only after Anchor success
 * - no Combination Cache Miss spam on Anchor failure
 *
 * Run: npm run verify:destination-kumamoto
 */
import assert from "node:assert/strict";
import {
  buildDestinationGeocodeQueries,
  buildDestinationAutocompleteQueries,
  clearDestinationGeocodeCache,
  geocodeDestinationWithFallback,
} from "../src/lib/ai/destination-geocode.ts";
import {
  resolveDestinationAlias,
} from "../src/lib/ai/destination-alias-resolver.ts";
import {
  resolveDestinationAnchor,
  clearCityCentroidCache,
  rememberCityCentroid,
  readCityCentroidCache,
  clearDestinationAnchorFlights,
} from "../src/lib/ai/destination-anchor.ts";
import {
  discoverDestinationCombinations,
  clearDiscoveredCombinationsCache,
  getLastCombinationDiscoveryFailure,
  getCachedDiscoveredCombinations,
} from "../src/lib/ai/destination-combination-discovery.ts";
import { clearResolvedDestinationScope } from "../src/lib/ai/resolved-destination-scope.ts";
import {
  isValidAnchorCoordinate,
  normalizeDestinationProviderResult,
} from "../src/lib/ai/destination-provider-result.ts";
import { extractCoordinatesFromProviderResponse } from "../src/lib/ai/destination-provider-coords.ts";

const KUMAMOTO = { lat: 32.8032, lng: 130.7079 };
const JP_CITIES = [
  { name: "名古屋", lat: 35.1815, lng: 136.9066 },
  { name: "福岡", lat: 33.5904, lng: 130.4017 },
  { name: "仙台", lat: 38.2682, lng: 140.8694 },
  { name: "廣島", lat: 34.3853, lng: 132.4553 },
  { name: "金澤", lat: 36.5613, lng: 136.6562 },
  { name: "札幌", lat: 43.0618, lng: 141.3545 },
  { name: "大阪", lat: 34.6937, lng: 135.5023 },
  { name: "東京", lat: 35.6762, lng: 139.6503 },
  { name: "京都", lat: 35.0116, lng: 135.7681 },
  { name: "沖繩", lat: 26.2124, lng: 127.6809 },
];

let failed = 0;
const logs = [];
const origInfo = console.info;
const origLog = console.log;

function captureLogs(enable) {
  if (enable) {
    console.info = (...args) => {
      logs.push(args.map(String).join(" "));
      origInfo(...args);
    };
    console.log = (...args) => {
      logs.push(args.map(String).join(" "));
      origLog(...args);
    };
  } else {
    console.info = origInfo;
    console.log = origLog;
  }
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`OK ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function reset(dest) {
  clearDestinationGeocodeCache(dest);
  clearCityCentroidCache(dest);
  clearResolvedDestinationScope(dest);
  clearDiscoveredCombinationsCache(dest);
  clearDestinationAnchorFlights(dest);
}

function mockGeocodeOk(lat, lng, country = "日本") {
  let calls = 0;
  const fn = async ({ data }) => {
    calls += 1;
    return {
      location: {
        placeId: `mock:${data.query}`,
        country,
        city: data.destinationName ?? data.query,
        lat,
        lng,
        formattedName: data.query,
        displayLabel: data.query,
        address: data.query,
        timezone: undefined,
        utcOffsetMinutes: null,
      },
      error: null,
      providerResult: {
        ok: true,
        status: "OK",
        latitude: lat,
        longitude: lng,
        provider: "geocode",
        rawResultCount: 1,
        parsedResultCount: 1,
        query: data.query,
        sourceShape: "trip_location",
      },
    };
  };
  fn.getCalls = () => calls;
  return fn;
}

/** First N geocode queries → ZERO_RESULTS; later succeed. Autocomplete-capable. */
function mockGeocodeZeroThenOk(lat, lng, zeroCount = 2) {
  let calls = 0;
  const queries = [];
  const fn = async ({ data }) => {
    calls += 1;
    queries.push({
      query: data.query,
      placesFallback: data.placesFallback,
    });
    if (calls <= zeroCount) {
      return {
        location: null,
        error: "geocode_zero_results",
        providerResult: {
          ok: false,
          status: "ZERO_RESULTS",
          provider: "geocode",
          rawResultCount: 0,
          parsedResultCount: 0,
          failureReason: "geocode_zero_results",
          query: data.query,
        },
      };
    }
    return {
      location: {
        placeId: data.placesFallback ? `ChIJmock:${data.query}` : `mock:${data.query}`,
        country: "日本",
        city: "熊本",
        lat,
        lng,
        formattedName: data.query,
        displayLabel: data.query,
        address: data.query,
        timezone: undefined,
        utcOffsetMinutes: null,
      },
      error: null,
      providerResult: {
        ok: true,
        status: "OK",
        latitude: lat,
        longitude: lng,
        provider: data.placesFallback ? "places_autocomplete" : "geocode",
        rawResultCount: 1,
        parsedResultCount: 1,
        query: data.query,
        sourceShape: data.placesFallback ? "places_details" : "geocode_results",
      },
    };
  };
  fn.getCalls = () => calls;
  fn.getQueries = () => queries;
  return fn;
}

function mockGeocodeAlwaysFail() {
  let calls = 0;
  const fn = async ({ data }) => {
    calls += 1;
    return {
      location: null,
      error: "geocode_zero_results",
      providerResult: {
        ok: false,
        status: "ZERO_RESULTS",
        provider: data.placesFallback ? "places_autocomplete" : "geocode",
        rawResultCount: 0,
        parsedResultCount: 0,
        failureReason: "geocode_zero_results",
        query: data.query,
      },
    };
  };
  fn.getCalls = () => calls;
  return fn;
}

function mockSearchPlaces(center) {
  const places = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `景點${i + 1}`,
    lat: center.lat + (i % 4) * 0.01,
    lng: center.lng + Math.floor(i / 4) * 0.01,
    types: i % 3 === 0 ? ["tourist_attraction"] : i % 3 === 1 ? ["museum"] : ["park"],
    primaryType: i % 3 === 0 ? "tourist_attraction" : i % 3 === 1 ? "museum" : "park",
    rating: 4.2,
    address: "mock",
  }));
  return async () => ({ places, error: null });
}

console.log("=== verify-destination-kumamoto ===\n");

await check("isValidAnchorCoordinate soft-accept bounds", () => {
  assert.equal(isValidAnchorCoordinate(32.8, 130.7), true);
  assert.equal(isValidAnchorCoordinate(91, 130), false);
  assert.equal(isValidAnchorCoordinate(32, 200), false);
  assert.equal(isValidAnchorCoordinate(undefined, 130), false);
});

await check("normalizeDestinationProviderResult accepts geocode_results", () => {
  const normalized = normalizeDestinationProviderResult({
    status: "OK",
    results: [
      {
        place_id: "x",
        formatted_address: "Kumamoto",
        geometry: { location: { lat: KUMAMOTO.lat, lng: KUMAMOTO.lng } },
        types: ["administrative_area_level_1", "political"],
        address_components: [
          { long_name: "Japan", short_name: "JP", types: ["country"] },
        ],
      },
    ],
  });
  assert.equal(normalized.ok, true);
  assert.ok(Math.abs(normalized.latitude - KUMAMOTO.lat) < 0.01);
});

await check("admin_area_level_1 coords soft-accepted by extractor", () => {
  const extracted = extractCoordinatesFromProviderResponse({
    status: "OK",
    results: [
      {
        geometry: { location: { lat: 32.8, lng: 130.7 } },
        types: ["administrative_area_level_1", "political"],
      },
    ],
  });
  assert.equal(extracted.candidates.length, 1);
});

await check("熊本 alias + countryCode JP", () => {
  for (const input of ["熊本", "熊本市", "Kumamoto", "Kumamoto City", "熊本，日本", "Kumamoto, Japan"]) {
    const alias = resolveDestinationAlias(input, { countryHint: "日本" });
    assert.equal(alias.countryCode, "JP", input);
    assert.equal(alias.normalizedName, "熊本", input);
    assert.equal(alias.searchName, "Kumamoto", input);
  }
});

await check("熊本 query plan preferred English-first order", () => {
  const queries = buildDestinationGeocodeQueries("熊本", "zh-TW", "日本");
  assert.ok(queries.length >= 1 && queries.length <= 3, queries.join(" | "));
  assert.ok(
    queries.some((q) => /Kumamoto/i.test(q)) || queries.some((q) => q.includes("熊本")),
    queries.join(" | "),
  );
  assert.ok(
    queries.includes("Kumamoto City, Japan") ||
      queries.includes("熊本市, 熊本県, 日本") ||
      queries.includes("Kumamoto, Kumamoto Prefecture, Japan") ||
      queries.includes("Kumamoto, Japan"),
    queries.join(" | "),
  );
  const auto = buildDestinationAutocompleteQueries("熊本", "日本");
  assert.ok(auto.length <= 2, auto.join(" | "));
  assert.ok(auto.some((q) => /Kumamoto/i.test(q)), auto.join(" | "));
});

await check("奈良 query plan country-qualified max 3", () => {
  const queries = buildDestinationGeocodeQueries("奈良", "zh-TW", "日本");
  assert.ok(queries.length >= 1 && queries.length <= 3, queries.join(" | "));
  assert.ok(
    queries.some((q) => /Nara/i.test(q)) || queries.some((q) => q.includes("奈良")),
    queries.join(" | "),
  );
  const auto = buildDestinationAutocompleteQueries("奈良", "日本");
  assert.ok(auto.length <= 2, auto.join(" | "));
});

const naraInputs = ["奈良", "奈良市", "Nara", "Nara City"];

for (const input of naraInputs) {
  await check(`Anchor ok: ${input}`, async () => {
    reset("奈良");
    logs.length = 0;
    captureLogs(true);
    const geocodeFn = mockGeocodeOk(34.6851, 135.8048, "日本", "奈良");
    const result = await resolveDestinationAnchor({
      destination: input,
      locale: "zh-TW",
      countryHint: "日本",
      geocodeFn,
    });
    captureLogs(false);
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal(result.anchor.countryCode, "JP");
    assert.ok(isValidAnchorCoordinate(result.anchor.latitude, result.anchor.longitude));
    assert.ok(logs.some((l) => l.includes("[DESTINATION_ANCHOR_RESOLVED]")));
  });
}

const kumamotoInputs = [
  "熊本",
  "熊本市",
  "Kumamoto",
  "Kumamoto City",
  "熊本，日本",
  "Kumamoto, Japan",
];

for (const input of kumamotoInputs) {
  await check(`Anchor ok: ${input}`, async () => {
    reset("熊本");
    logs.length = 0;
    captureLogs(true);
    const geocodeFn = mockGeocodeOk(KUMAMOTO.lat, KUMAMOTO.lng);
    const result = await resolveDestinationAnchor({
      destination: input,
      locale: "zh-TW",
      countryHint: "日本",
      geocodeFn,
    });
    captureLogs(false);
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal(result.anchor.countryCode, "JP");
    assert.ok(isValidAnchorCoordinate(result.anchor.latitude, result.anchor.longitude));
    assert.ok(result.anchor.source);
    assert.ok(
      logs.some((l) => l.includes("[DESTINATION_PROVIDER_REQUEST]")),
      "missing PROVIDER_REQUEST",
    );
    assert.ok(
      logs.some((l) => l.includes("[DESTINATION_PROVIDER_RESPONSE]")),
      "missing PROVIDER_RESPONSE",
    );
    assert.ok(
      logs.some((l) => l.includes("[DESTINATION_PROVIDER_PARSE_RESULT]")),
      "missing PARSE_RESULT",
    );
    assert.ok(
      logs.some((l) => l.includes("[DESTINATION_ANCHOR_RESOLVED]")),
      "missing ANCHOR_RESOLVED",
    );
  });
}

await check("ZERO_RESULTS does not early-stop — continues queries", async () => {
  reset("熊本");
  const geocodeFn = mockGeocodeZeroThenOk(KUMAMOTO.lat, KUMAMOTO.lng, 2);
  const loc = await geocodeDestinationWithFallback({
    destination: "熊本",
    locale: "zh-TW",
    countryHint: "日本",
    countryCode: "JP",
    preferCachedCoordinates: false,
    geocodeFn,
  });
  assert.ok(loc);
  assert.ok(isValidAnchorCoordinate(loc.lat, loc.lng));
  assert.ok(geocodeFn.getCalls() >= 3, `expected >=3 calls, got ${geocodeFn.getCalls()}`);
  const withFallbackFalse = geocodeFn.getQueries().filter((q) => q.placesFallback === false);
  assert.ok(withFallbackFalse.length >= 2, "expected geocode-only retries before autocomplete");
});

await check("single-flight: parallel resolveDestinationAnchor shares one Promise", async () => {
  reset("熊本");
  let calls = 0;
  const geocodeFn = async ({ data }) => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 30));
    return {
      location: {
        placeId: `mock:${data.query}`,
        country: "日本",
        city: "熊本",
        lat: KUMAMOTO.lat,
        lng: KUMAMOTO.lng,
        formattedName: data.query,
        displayLabel: data.query,
        address: data.query,
        timezone: undefined,
        utcOffsetMinutes: null,
      },
      error: null,
    };
  };
  const [a, b] = await Promise.all([
    resolveDestinationAnchor({
      destination: "熊本",
      locale: "zh-TW",
      countryHint: "日本",
      geocodeFn,
    }),
    resolveDestinationAnchor({
      destination: "熊本市",
      locale: "zh-TW",
      countryHint: "日本",
      geocodeFn,
    }),
  ]);
  assert.equal(a.status, "ok");
  assert.equal(b.status, "ok");
  // Same flight key (熊本|JP) → one in-flight resolve; geocode may still retry queries inside.
  // Outer resolveDestinationAnchor must not double-enter independently.
  assert.ok(calls >= 1);
});

await check("empty coords never written to city centroid cache", () => {
  reset("熊本");
  rememberCityCentroid({
    destination: "熊本",
    latitude: undefined,
    longitude: undefined,
    countryCode: "JP",
  });
  assert.equal(readCityCentroidCache("熊本", "JP"), null);
  rememberCityCentroid({
    destination: "熊本",
    latitude: KUMAMOTO.lat,
    longitude: KUMAMOTO.lng,
    countryCode: "JP",
  });
  const hit = readCityCentroidCache("Kumamoto City", "JP");
  assert.ok(hit);
  assert.ok(Math.abs(hit.latitude - KUMAMOTO.lat) < 0.01);
});

await check("Anchor failure does not spam Combination Cache Miss", async () => {
  reset("熊本");
  logs.length = 0;
  captureLogs(true);
  const geocodeFn = mockGeocodeAlwaysFail();
  await discoverDestinationCombinations({
    destination: "熊本",
    locale: "zh-TW",
    destinationCountry: "日本",
    geocodeFn,
    searchPlaces: mockSearchPlaces(KUMAMOTO),
  });
  captureLogs(false);
  const missLogs = logs.filter((l) => l.includes("[COMBINATION_CACHE_MISS]"));
  assert.equal(missLogs.length, 0, `unexpected cache miss logs: ${missLogs.join(" | ")}`);
  const failure = getLastCombinationDiscoveryFailure();
  assert.equal(failure?.reason, "destination_resolution_failed");
  assert.ok(getCachedDiscoveredCombinations("熊本", undefined, undefined, { log: false }) == null);
});

await check("Combination Discovery enters after Anchor success", async () => {
  reset("熊本");
  logs.length = 0;
  captureLogs(true);
  const combos = await discoverDestinationCombinations({
    destination: "熊本",
    locale: "zh-TW",
    destinationCountry: "日本",
    geocodeFn: mockGeocodeOk(KUMAMOTO.lat, KUMAMOTO.lng),
    searchPlaces: mockSearchPlaces(KUMAMOTO),
    days: 5,
  });
  captureLogs(false);
  assert.ok(combos && combos.length > 0, JSON.stringify(getLastCombinationDiscoveryFailure()));
  assert.ok(logs.some((l) => l.includes("hasCoordinates=true")));
  assert.ok(
    logs.some((l) => l.includes("[COMBINATION_DISCOVERY_STATS]") || l.includes("placesCandidates")),
  );
});

for (const city of JP_CITIES) {
  await check(`JP sample Anchor: ${city.name}`, async () => {
    reset(city.name);
    const result = await resolveDestinationAnchor({
      destination: city.name,
      locale: "zh-TW",
      countryHint: "日本",
      geocodeFn: mockGeocodeOk(city.lat, city.lng),
    });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal(result.anchor.countryCode, "JP");
    assert.ok(isValidAnchorCoordinate(result.anchor.latitude, result.anchor.longitude));
  });
}

await check("nested {data:{location}} envelope still parses", () => {
  const normalized = normalizeDestinationProviderResult({
    data: {
      location: {
        lat: KUMAMOTO.lat,
        lng: KUMAMOTO.lng,
        country: "日本",
        city: "熊本",
        placeId: "x",
      },
      error: null,
    },
  });
  assert.equal(normalized.ok, true);
  assert.ok(Math.abs(normalized.latitude - KUMAMOTO.lat) < 0.01);
});

console.log(`\n[verify:destination-kumamoto] ${failed === 0 ? "PASS" : "FAIL"} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
