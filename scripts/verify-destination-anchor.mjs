/**
 * Destination Anchor acceptance — islands / regions / provinces + legacy city cases.
 *
 * Case A–G: Thailand Phuket/Samui, Indonesia Bali, Japan Hokkaido/Okinawa, Korea Jeju
 * Case H: fictional island → destination_resolution_failed
 * Plus prior Nagoya / multi-city regressions.
 */
import assert from "node:assert/strict";
import { normalizeDestinationLabel } from "../src/lib/ai/trip-planning-context.ts";
import { resolveDestinationEntity } from "../src/lib/ai/destination-entity.ts";
import { resolveDestinationCountryLabel } from "../src/lib/ai/resolved-destination-scope.ts";
import {
  buildDestinationGeocodeQueries,
  clearDestinationGeocodeCache,
} from "../src/lib/ai/destination-geocode.ts";
import {
  resolveDestinationAlias,
  buildAliasGeocodeQueries,
} from "../src/lib/ai/destination-alias-resolver.ts";
import {
  resolveDestinationAnchor,
  clearCityCentroidCache,
  rememberCityCentroid,
  buildDestinationOptionsFromCityList,
  matchDestinationOptionMetadata,
} from "../src/lib/ai/destination-anchor.ts";
import {
  discoverDestinationCombinations,
  clearDiscoveredCombinationsCache,
  getLastCombinationDiscoveryFailure,
  buildDestinationRecommendationFailedMessage,
} from "../src/lib/ai/destination-combination-discovery.ts";
import { clearResolvedDestinationScope } from "../src/lib/ai/resolved-destination-scope.ts";

const NAGOYA = { lat: 35.1815, lng: 136.9066 };
const PHUKET = { lat: 7.8804, lng: 98.3923 };
const SAMUI = { lat: 9.512, lng: 100.0136 };
const BALI = { lat: -8.4095, lng: 115.1889 };
const PATTAYA = { lat: 12.9236, lng: 100.8825 };
const HOKKAIDO = { lat: 43.0618, lng: 141.3545 };
const OKINAWA = { lat: 26.2124, lng: 127.6809 };
const JEJU = { lat: 33.4996, lng: 126.5312 };

let failed = 0;
function check(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result
        .then(() => console.log(`OK ${name}`))
        .catch((e) => {
          failed += 1;
          console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
        });
    }
    console.log(`OK ${name}`);
    return Promise.resolve();
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
    return Promise.resolve();
  }
}

function resetDestination(label) {
  clearDestinationGeocodeCache(label);
  clearCityCentroidCache(label);
  clearResolvedDestinationScope(label);
  clearDiscoveredCombinationsCache(label);
}

function mockGeocode(lat, lng, country = "日本", city = "mock") {
  return async ({ data }) => ({
    location: {
      placeId: `mock:${data.query}`,
      country,
      city,
      lat,
      lng,
      formattedName: data.query,
      displayLabel: data.query,
      address: data.query,
      timezone: undefined,
      utcOffsetMinutes: null,
    },
    error: null,
  });
}

function mockGeocodeFailThenSucceed(lat, lng, country) {
  let calls = 0;
  return async ({ data }) => {
    calls += 1;
    if (calls === 1) {
      return { location: null, error: "geocode_empty_response" };
    }
    return {
      location: {
        placeId: `mock:${data.query}`,
        country,
        city: data.query,
        lat,
        lng,
        formattedName: data.query,
        displayLabel: data.query,
        address: data.query,
        timezone: undefined,
        utcOffsetMinutes: null,
      },
      error: null,
    };
  };
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

async function assertAnchorOk(params) {
  const {
    destination,
    country,
    countryCode,
    lat,
    lng,
    entityType,
    days,
    offered,
    input,
  } = params;
  resetDestination(destination);
  const options =
    offered ??
    buildDestinationOptionsFromCityList(
      [
        { name: "曼谷", type: "city" },
        { name: "清邁", type: "city" },
        { name: destination, type: entityType },
        { name: "蘇梅島", type: "island" },
      ],
      country,
    );
  const result = await resolveDestinationAnchor({
    destination: input ?? destination,
    locale: "zh-TW",
    countryHint: country,
    offeredOptions: options,
    geocodeFn: mockGeocode(lat, lng, country, destination),
  });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.ok(Math.abs(result.anchor.latitude - lat) < 0.5, `lat ${result.anchor.latitude}`);
  assert.ok(Math.abs(result.anchor.longitude - lng) < 0.5, `lng ${result.anchor.longitude}`);
  assert.equal(result.anchor.countryCode, countryCode);
  if (entityType) {
    assert.equal(result.anchor.entityType, entityType);
  }

  // Days confirmation must not clear destination — combination discovery entry works.
  clearDiscoveredCombinationsCache(destination);
  const combos = await discoverDestinationCombinations({
    destination,
    locale: "zh-TW",
    destinationCountry: country,
    offeredDestinationOptions: options,
    geocodeFn: mockGeocode(lat, lng, country, destination),
    searchPlaces: mockSearchPlaces({ lat, lng }),
    days,
  });
  const failure = getLastCombinationDiscoveryFailure();
  assert.notEqual(failure?.reason, "destination_resolution_failed");
  assert.notEqual(failure?.detail, "no_coordinates");
  assert.ok(combos && combos.length > 0, `expected combinations, failure=${JSON.stringify(failure)}`);
  return result;
}

console.log("=== verify-destination-anchor ===\n");

await check("Alias Resolver: 普吉島 → Phuket / island / TH", () => {
  const alias = resolveDestinationAlias("普吉島", { countryHint: "泰國" });
  assert.equal(alias.normalizedName, "普吉島");
  assert.equal(alias.searchName, "Phuket");
  assert.equal(alias.entityType, "island");
  assert.equal(alias.countryCode, "TH");
  const queries = buildAliasGeocodeQueries({
    destination: "普吉島",
    countryHint: "泰國",
  });
  assert.ok(queries.some((q) => /Phuket,\s*Thailand/i.test(q)), queries.join(" | "));
  assert.ok(queries.some((q) => /Phuket Island,\s*Thailand/i.test(q)), queries.join(" | "));
  assert.ok(queries.some((q) => /普吉島/.test(q) && /泰國|Thailand/.test(q)), queries.join(" | "));
});

await check("Alias Resolver: Phuket / 蘇梅島 / 峇里島 / 北海道", () => {
  assert.equal(resolveDestinationAlias("Phuket").normalizedName, "普吉島");
  assert.equal(resolveDestinationAlias("蘇梅島").searchName, "Koh Samui");
  assert.equal(resolveDestinationAlias("Ko Samui").normalizedName, "蘇梅島");
  assert.equal(resolveDestinationAlias("峇里島").searchName, "Bali");
  assert.equal(resolveDestinationAlias("北海道").searchName, "Hokkaido");
  assert.equal(resolveDestinationAlias("沖繩").entityType, "island");
  assert.equal(resolveDestinationAlias("濟州島").normalizedName, "濟州");
  assert.equal(resolveDestinationAlias("濟州島").searchName, "Jeju");
});

await check("Option metadata match: 普吉島 from Thailand list", () => {
  const options = buildDestinationOptionsFromCityList(
    [
      { name: "曼谷", type: "city" },
      { name: "清邁", type: "city" },
      { name: "普吉島", type: "island" },
      { name: "蘇梅島", type: "island" },
    ],
    "泰國",
  );
  const phuket = options.find((o) => o.normalizedName === "普吉島");
  assert.ok(phuket);
  assert.equal(phuket.entityType, "island");
  assert.equal(phuket.countryCode, "TH");
  assert.ok(phuket.aliases.some((a) => /phuket/i.test(a)));
  const matched = matchDestinationOptionMetadata("普吉島", options);
  assert.equal(matched?.normalizedName, "普吉島");
  const matchedEn = matchDestinationOptionMetadata("Phuket", options);
  assert.equal(matchedEn?.normalizedName, "普吉島");
});

await check("Case A 泰國 → 普吉島 → 6天", async () => {
  await assertAnchorOk({
    destination: "普吉島",
    country: "泰國",
    countryCode: "TH",
    lat: PHUKET.lat,
    lng: PHUKET.lng,
    entityType: "island",
    days: 6,
  });
});

await check("Case B 泰國 → Phuket → 6天", async () => {
  await assertAnchorOk({
    destination: "普吉島",
    input: "Phuket",
    country: "泰國",
    countryCode: "TH",
    lat: PHUKET.lat,
    lng: PHUKET.lng,
    entityType: "island",
    days: 6,
  });
});

await check("Case C 泰國 → 蘇梅島 → 5天", async () => {
  await assertAnchorOk({
    destination: "蘇梅島",
    country: "泰國",
    countryCode: "TH",
    lat: SAMUI.lat,
    lng: SAMUI.lng,
    entityType: "island",
    days: 5,
    offered: buildDestinationOptionsFromCityList(
      [
        { name: "曼谷", type: "city" },
        { name: "清邁", type: "city" },
        { name: "普吉島", type: "island" },
        { name: "蘇梅島", type: "island" },
      ],
      "泰國",
    ),
  });
});

await check("Case D 印尼 → 峇里島 → 6天", async () => {
  await assertAnchorOk({
    destination: "峇里島",
    country: "印尼",
    countryCode: "ID",
    lat: BALI.lat,
    lng: BALI.lng,
    entityType: "island",
    days: 6,
    offered: buildDestinationOptionsFromCityList(
      [
        { name: "峇里島", type: "island" },
        { name: "雅加達", type: "city" },
        { name: "日惹", type: "city" },
        { name: "龍目島", type: "island" },
      ],
      "印尼",
    ),
  });
});

await check("Alias Resolver: 芭達雅 → Pattaya / resort_area / TH / Chon Buri queries", () => {
  const alias = resolveDestinationAlias("芭達雅", { countryHint: "泰國" });
  assert.equal(alias.normalizedName, "芭達雅");
  assert.equal(alias.searchName, "Pattaya");
  assert.equal(alias.entityType, "resort_area");
  assert.equal(alias.countryCode, "TH");
  assert.equal(alias.administrativeArea, "Chon Buri");
  assert.ok(alias.aliases.some((a) => a === "芭堤雅"));
  assert.ok(alias.aliases.some((a) => a === "巴達雅"));
  assert.ok(alias.aliases.some((a) => /Pattaya City/i.test(a)));
  assert.ok(alias.aliases.some((a) => a === "พัทยา"));
  const queries = buildAliasGeocodeQueries({
    destination: "芭達雅",
    countryHint: "泰國",
  });
  assert.ok(queries.some((q) => /Pattaya,\s*Thailand/i.test(q)), queries.join(" | "));
  assert.ok(queries.some((q) => /Chon Buri/i.test(q)), queries.join(" | "));
  assert.ok(queries.some((q) => /Pattaya City/i.test(q)), queries.join(" | "));
  assert.ok(queries.some((q) => /芭達雅/.test(q) && /泰國|Thailand|春武里/.test(q)), queries.join(" | "));
  assert.ok(!queries.some((q) => /Pattaya Island/i.test(q)), "must not invent Pattaya Island");
});

await check("Case Pattaya B 泰國 → 芭達雅 → 6天", async () => {
  const result = await assertAnchorOk({
    destination: "芭達雅",
    country: "泰國",
    countryCode: "TH",
    lat: PATTAYA.lat,
    lng: PATTAYA.lng,
    entityType: "resort_area",
    days: 6,
    offered: buildDestinationOptionsFromCityList(
      [
        { name: "曼谷", type: "city" },
        { name: "清邁", type: "city" },
        { name: "芭達雅" },
        { name: "普吉島", type: "island" },
        { name: "蘇梅島", type: "island" },
      ],
      "泰國",
    ),
  });
  assert.equal(result.anchor.destinationType, "tourist_area");
  assert.equal(result.anchor.administrativeArea, "Chon Buri");
  assert.ok(
    result.anchor.source === "geocode" ||
      result.anchor.source === "alias_geocode" ||
      result.anchor.source === "option_metadata" ||
      result.anchor.source === "fallback" ||
      result.anchor.source === "context",
    `unexpected source ${result.anchor.source}`,
  );
});

await check("Case Pattaya C English alias Pattaya → 6天", async () => {
  await assertAnchorOk({
    destination: "芭達雅",
    input: "Pattaya",
    country: "泰國",
    countryCode: "TH",
    lat: PATTAYA.lat,
    lng: PATTAYA.lng,
    entityType: "resort_area",
    days: 6,
  });
});

await check("Case Pattaya D full admin name → 6天", async () => {
  await assertAnchorOk({
    destination: "芭達雅",
    input: "Pattaya, Chon Buri, Thailand",
    country: "泰國",
    countryCode: "TH",
    lat: PATTAYA.lat,
    lng: PATTAYA.lng,
    entityType: "resort_area",
    days: 6,
  });
});

await check("Case Pattaya E Thailand destinations share resolver (no Pattaya-only branch)", async () => {
  for (const [dest, lat, lng, entityType] of [
    ["曼谷", 13.7563, 100.5018, "city"],
    ["清邁", 18.7883, 98.9853, "city"],
    ["普吉島", PHUKET.lat, PHUKET.lng, "island"],
    ["蘇梅島", SAMUI.lat, SAMUI.lng, "island"],
  ]) {
    await assertAnchorOk({
      destination: dest,
      country: "泰國",
      countryCode: "TH",
      lat,
      lng,
      entityType,
      days: 5,
    });
  }
});

await check("Pattaya geocode query plan prefers Thailand + Chon Buri (not Island)", () => {
  const queries = buildDestinationGeocodeQueries("芭達雅", "zh-TW", "泰國");
  assert.ok(queries[0] && /Pattaya/i.test(queries[0]), queries.join(" | "));
  assert.ok(queries.some((q) => /Chon Buri/i.test(q)), queries.join(" | "));
  assert.ok(queries.some((q) => /Thailand|泰國/i.test(q)), queries.join(" | "));
  assert.ok(!queries.some((q) => /芭達雅島|Pattaya Island/i.test(q)), queries.join(" | "));
});

await check("Bali still resolves without inventing Pattaya hub", async () => {
  resetDestination("峇里島");
  const result = await resolveDestinationAnchor({
    destination: "峇里島",
    locale: "zh-TW",
    countryHint: "印尼",
    // No geocodeFn — Bali may use legacy approx fallback; must still succeed.
  });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.ok(Number.isFinite(result.anchor.latitude));
  assert.ok(Number.isFinite(result.anchor.longitude));
  assert.equal(result.anchor.countryCode, "ID");
});

await check("Case E 日本 → 北海道 → 7天", async () => {
  await assertAnchorOk({
    destination: "北海道",
    country: "日本",
    countryCode: "JP",
    lat: HOKKAIDO.lat,
    lng: HOKKAIDO.lng,
    entityType: "region",
    days: 7,
    offered: buildDestinationOptionsFromCityList(
      [
        { name: "東京", type: "city" },
        { name: "大阪", type: "city" },
        { name: "京都", type: "city" },
        { name: "北海道", type: "region" },
      ],
      "日本",
    ),
  });
});

await check("Case F 日本 → 沖繩 → 5天", async () => {
  await assertAnchorOk({
    destination: "沖繩",
    country: "日本",
    countryCode: "JP",
    lat: OKINAWA.lat,
    lng: OKINAWA.lng,
    entityType: "island",
    days: 5,
    offered: buildDestinationOptionsFromCityList(
      [
        { name: "東京", type: "city" },
        { name: "大阪", type: "city" },
        { name: "沖繩", type: "island" },
        { name: "北海道", type: "region" },
      ],
      "日本",
    ),
  });
});

await check("Case G 韓國 → 濟州島 → 4天", async () => {
  // normalizeDestinationLabel maps 濟州島 → 濟州
  const dest = normalizeDestinationLabel("濟州島");
  assert.equal(dest, "濟州");
  await assertAnchorOk({
    destination: dest,
    input: "濟州島",
    country: "韓國",
    countryCode: "KR",
    lat: JEJU.lat,
    lng: JEJU.lng,
    entityType: "island",
    days: 4,
    offered: buildDestinationOptionsFromCityList(
      [
        { name: "首爾", type: "city" },
        { name: "釜山", type: "city" },
        { name: "濟州島", type: "island" },
      ],
      "韓國",
    ),
  });
});

await check("Case H 虛構島嶼 → destination_resolution_failed", async () => {
  const fake = "虛構珊瑚島";
  resetDestination(fake);
  clearCityCentroidCache();
  const result = await resolveDestinationAnchor({
    destination: fake,
    locale: "zh-TW",
    countryHint: "泰國",
    geocodeFn: async () => ({ location: null, error: "geocode_empty_response" }),
  });
  assert.equal(result.status, "destination_resolution_failed");
  assert.ok(
    result.reason === "no_coordinates" ||
      result.reason === "destination_geocode_empty" ||
      result.reason === "anchor_geocode_empty" ||
      result.reason === "anchor_all_providers_failed" ||
      result.reason === "destination_resolution_failed",
    `unexpected reason=${result.reason}`,
  );
  assert.equal(result.retryable, true);

  clearDiscoveredCombinationsCache(fake);
  const combos = await discoverDestinationCombinations({
    destination: fake,
    locale: "zh-TW",
    destinationCountry: "泰國",
    geocodeFn: async () => ({ location: null, error: "geocode_empty_response" }),
    searchPlaces: async () => ({ places: [] }),
  });
  assert.equal(combos, null);
  const failure = getLastCombinationDiscoveryFailure();
  assert.equal(failure?.reason, "destination_resolution_failed");
  assert.notEqual(failure?.reason, "combination_insufficient");
  const msg = buildDestinationRecommendationFailedMessage(fake, failure?.reason);
  assert.ok(/位置資訊|無法取得/.test(msg), msg);
  assert.ok(!/實際地點組合|real_places_below_minimum/i.test(msg), msg);
});

await check("Geocode queries include parent country for 普吉島", () => {
  const queries = buildDestinationGeocodeQueries("普吉島", "zh-TW", "泰國");
  assert.ok(queries.some((q) => /Phuket/i.test(q)), queries.join(" | "));
  assert.ok(queries.some((q) => /Thailand/i.test(q)), queries.join(" | "));
  assert.ok(queries.length <= 6, `queryCount should be <=6, got ${queries.length}`);
  assert.equal(resolveDestinationEntity("普吉島").type, "island");
  assert.equal(resolveDestinationEntity("普吉島").country, "泰國");
  assert.equal(resolveDestinationCountryLabel("普吉島"), "泰國");
});

await check("戈壁 is region under 蒙古 with MN countryCode", async () => {
  assert.equal(resolveDestinationEntity("戈壁").type, "region");
  assert.equal(resolveDestinationEntity("戈壁").country, "蒙古");
  const alias = resolveDestinationAlias("戈壁", { countryHint: "蒙古" });
  assert.equal(alias.entityType, "region");
  assert.equal(alias.countryCode, "MN");
  assert.equal(alias.searchName, "Gobi");
  const queries = buildDestinationGeocodeQueries("戈壁", "zh-TW", "蒙古");
  assert.ok(queries.length <= 6, `queryCount=${queries.length}`);
  assert.ok(queries.some((q) => /Gobi|戈壁/i.test(q)), queries.join(" | "));
  assert.ok(queries.some((q) => /Mongolia|蒙古/i.test(q)), queries.join(" | "));

  const GOBI = { lat: 42.795, lng: 105.032 };
  const options = buildDestinationOptionsFromCityList(
    [
      { name: "烏蘭巴托", type: "city" },
      { name: "特勒吉", type: "region" },
      { name: "戈壁", type: "region" },
    ],
    "蒙古",
  );
  const matched = matchDestinationOptionMetadata("戈壁", options);
  assert.equal(matched?.entityType, "region");
  assert.equal(matched?.countryCode, "MN");

  resetDestination("戈壁");
  const result = await resolveDestinationAnchor({
    destination: "戈壁",
    locale: "zh-TW",
    countryHint: "蒙古",
    offeredOptions: options,
    geocodeFn: mockGeocode(GOBI.lat, GOBI.lng, "蒙古", "戈壁"),
  });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.equal(result.anchor.entityType, "region");
  assert.equal(result.anchor.countryCode, "MN");
  assert.ok(Math.abs(result.anchor.latitude - GOBI.lat) < 1);
});

await check("Legacy Case: aliases normalize to 名古屋 + country JP", () => {
  for (const raw of ["名古屋", "名古屋市", "Nagoya", "Nagoya City", "なごや"]) {
    const n = normalizeDestinationLabel(raw);
    assert.equal(n, "名古屋", `${raw} → ${n}`);
  }
  assert.equal(resolveDestinationEntity("名古屋").country, "日本");
  assert.equal(resolveDestinationCountryLabel("名古屋"), "日本");
  const queries = buildDestinationGeocodeQueries("名古屋");
  assert.ok(
    queries.some((q) => /japan|日本|aichi|愛知/i.test(q)),
    `queries should include Japan hint: ${queries.join(" | ")}`,
  );
});

await check("Legacy Case: Destination Anchor resolves 名古屋", async () => {
  resetDestination("名古屋");
  const result = await resolveDestinationAnchor({
    destination: "名古屋",
    locale: "zh-TW",
    geocodeFn: mockGeocode(NAGOYA.lat, NAGOYA.lng),
  });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.ok(Math.abs(result.anchor.latitude - NAGOYA.lat) < 0.2);
  assert.ok(Math.abs(result.anchor.longitude - NAGOYA.lng) < 0.2);
  assert.equal(result.anchor.countryCode, "JP");
});

await check("Legacy Case: Combination Discovery placeCandidates > 0", async () => {
  resetDestination("名古屋");
  const combos = await discoverDestinationCombinations({
    destination: "名古屋",
    locale: "zh-TW",
    geocodeFn: mockGeocode(NAGOYA.lat, NAGOYA.lng),
    searchPlaces: mockSearchPlaces(NAGOYA),
    days: 6,
  });
  const failure = getLastCombinationDiscoveryFailure();
  assert.notEqual(failure?.reason, "destination_resolution_failed");
  assert.ok(combos && combos.length > 0, `expected combinations, failure=${JSON.stringify(failure)}`);
});

await check("Legacy Case: geocode fail then success uses fallback/retry", async () => {
  resetDestination("名古屋");
  rememberCityCentroid({
    destination: "名古屋",
    latitude: NAGOYA.lat,
    longitude: NAGOYA.lng,
    country: "日本",
    countryCode: "JP",
  });
  const result = await resolveDestinationAnchor({
    destination: "名古屋",
    locale: "zh-TW",
    geocodeFn: mockGeocodeFailThenSucceed(NAGOYA.lat, NAGOYA.lng, "日本"),
  });
  assert.equal(result.status, "ok", JSON.stringify(result));
});

await check("Failure message is destination_resolution_failed copy", () => {
  const msg = buildDestinationRecommendationFailedMessage(
    "普吉島",
    "destination_resolution_failed",
  );
  assert.ok(/位置資訊/.test(msg), msg);
  assert.ok(!/實際地點組合/.test(msg), msg);
});

if (failed > 0) {
  console.error(`\n[verify-destination-anchor] ${failed} failed`);
  process.exit(1);
}
console.log("\n[verify-destination-anchor] ok");
