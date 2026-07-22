/**
 * Global Destination Anchor acceptance — country → city/island/region → days.
 *
 * Cases cover free-text cities (熊本 not in option list), islands, tourism areas,
 * alias normalization, distinct geocode query retries, and no Taiwan fallback.
 */
import assert from "node:assert/strict";
import { isGeographicPlaceTypes } from "../src/lib/location/geographic-only.ts";
import {
  resolveDestinationAlias,
  buildAliasGeocodeQueries,
  clearDestinationAliasIndex,
} from "../src/lib/ai/destination-alias-resolver.ts";
import {
  buildDestinationGeocodeQueries,
  clearDestinationGeocodeCache,
  resolveDestinationApproxCenter,
} from "../src/lib/ai/destination-geocode.ts";
import {
  resolveDestinationAnchor,
  buildDestinationOptionsFromCityList,
  matchDestinationOptionFromPreviousTurn,
  clearCityCentroidCache,
} from "../src/lib/ai/destination-anchor.ts";
import {
  discoverDestinationCombinations,
  clearDiscoveredCombinationsCache,
  getLastCombinationDiscoveryFailure,
} from "../src/lib/ai/destination-combination-discovery.ts";
import { clearResolvedDestinationScope } from "../src/lib/ai/resolved-destination-scope.ts";

const COORDS = {
  蘇梅島: { lat: 9.512, lng: 100.0136, country: "泰國", countryCode: "TH", entityType: "island" },
  普吉島: { lat: 7.8804, lng: 98.3923, country: "泰國", countryCode: "TH", entityType: "island" },
  北海道: { lat: 43.0618, lng: 141.3545, country: "日本", countryCode: "JP", entityType: "region" },
  沖繩: { lat: 26.2124, lng: 127.6809, country: "日本", countryCode: "JP", entityType: "island" },
  熊本: { lat: 32.8032, lng: 130.7079, country: "日本", countryCode: "JP", entityType: "city" },
  福岡: { lat: 33.5904, lng: 130.4017, country: "日本", countryCode: "JP", entityType: "city" },
  廣島: { lat: 34.3853, lng: 132.4553, country: "日本", countryCode: "JP", entityType: "city" },
  濟州島: { lat: 33.4996, lng: 126.5312, country: "韓國", countryCode: "KR", entityType: "island" },
  峇里島: { lat: -8.4095, lng: 115.1889, country: "印尼", countryCode: "ID", entityType: "island" },
  芭達雅: { lat: 12.9236, lng: 100.8825, country: "泰國", countryCode: "TH", entityType: "resort_area" },
  深圳: { lat: 22.5431, lng: 114.0579, country: "中國", countryCode: "CN", entityType: "city" },
  清邁: { lat: 18.7883, lng: 98.9853, country: "泰國", countryCode: "TH", entityType: "city" },
  首爾: { lat: 37.5665, lng: 126.978, country: "韓國", countryCode: "KR", entityType: "city" },
  釜山: { lat: 35.1796, lng: 129.0756, country: "韓國", countryCode: "KR", entityType: "city" },
  峴港: { lat: 16.0544, lng: 108.2022, country: "越南", countryCode: "VN", entityType: "city" },
  巴塞隆納: { lat: 41.3874, lng: 2.1686, country: "西班牙", countryCode: "ES", entityType: "city" },
  巴黎: { lat: 48.8566, lng: 2.3522, country: "法國", countryCode: "FR", entityType: "city" },
  墨爾本: { lat: -37.8136, lng: 144.9631, country: "澳洲", countryCode: "AU", entityType: "city" },
  高雄: { lat: 22.6273, lng: 120.3014, country: "台灣", countryCode: "TW", entityType: "city" },
  長灘島: { lat: 11.9674, lng: 121.9248, country: "菲律賓", countryCode: "PH", entityType: "island" },
  富國島: { lat: 10.227, lng: 103.967, country: "越南", countryCode: "VN", entityType: "island" },
  蘭卡威: { lat: 6.35, lng: 99.8, country: "馬來西亞", countryCode: "MY", entityType: "island" },
  聖托里尼: { lat: 36.3932, lng: 25.4615, country: "希臘", countryCode: "GR", entityType: "island" },
  馬略卡島: { lat: 39.6953, lng: 3.0176, country: "西班牙", countryCode: "ES", entityType: "island" },
  塔斯馬尼亞: { lat: -41.4545, lng: 145.9707, country: "澳洲", countryCode: "AU", entityType: "island" },
  北馬累環礁: { lat: 4.4167, lng: 73.5, country: "馬爾地夫", countryCode: "MV", entityType: "archipelago" },
  佛羅倫斯: { lat: 43.7696, lng: 11.2558, country: "義大利", countryCode: "IT", entityType: "city" },
  阿里山: { lat: 23.508, lng: 120.801, country: "台灣", countryCode: "TW", entityType: "resort_area" },
};

const THAILAND_OPTIONS = [
  { name: "曼谷", type: "city" },
  { name: "清邁", type: "city" },
  { name: "芭達雅", type: "city" },
  { name: "普吉島", type: "island" },
  { name: "蘇梅島", type: "island" },
];

const JAPAN_UI_OPTIONS = [
  { name: "東京", type: "city" },
  { name: "大阪", type: "city" },
  { name: "京都", type: "city" },
  { name: "北海道", type: "region" },
];

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

function mockGeocode(lat, lng, country, city = "mock") {
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

/** Simulate real Google island response: establishment + natural_feature. */
function mockIslandGeocode(lat, lng, country) {
  return async ({ data }) => ({
    location: {
      placeId: `mock-island:${data.query}`,
      country,
      city: data.query,
      lat,
      lng,
      formattedName: data.query,
      displayLabel: data.query,
      address: data.query,
      timezone: undefined,
      utcOffsetMinutes: null,
      types: ["establishment", "natural_feature"],
    },
    error: null,
  });
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

async function assertFlow(params) {
  const {
    caseId,
    country,
    destination,
    days,
    input,
    offered,
    entityType,
    countryCode,
    lat,
    lng,
    requireOptionMatch = true,
  } = params;
  const meta = COORDS[destination] ?? { lat, lng, country, countryCode, entityType };
  resetDestination(destination);
  const options =
    offered ??
    buildDestinationOptionsFromCityList(
      [{ name: destination, type: meta.entityType }],
      country,
    );

  if (requireOptionMatch) {
    const matched = matchDestinationOptionFromPreviousTurn(input ?? destination, options);
    assert.ok(matched, `${caseId}: option match failed for input=${input ?? destination}`);
    assert.equal(matched.countryCode, meta.countryCode ?? countryCode);
    assert.ok(matched.normalizedName, `${caseId}: normalizedName empty`);
  }

  const result = await resolveDestinationAnchor({
    destination: input ?? destination,
    locale: "zh-TW",
    countryHint: country,
    offeredOptions: options,
    geocodeFn: mockIslandGeocode(meta.lat, meta.lng, country),
  });
  assert.equal(result.status, "ok", `${caseId}: ${JSON.stringify(result)}`);
  assert.ok(Number.isFinite(result.anchor.latitude));
  assert.ok(Number.isFinite(result.anchor.longitude));
  assert.equal(result.anchor.countryCode, meta.countryCode ?? countryCode);
  if (meta.entityType) {
    assert.equal(result.anchor.entityType, meta.entityType);
  }
  assert.ok(result.anchor.normalizedName);

  clearDiscoveredCombinationsCache(destination);
  const combos = await discoverDestinationCombinations({
    destination,
    locale: "zh-TW",
    destinationCountry: country,
    offeredDestinationOptions: options,
    geocodeFn: mockGeocode(meta.lat, meta.lng, country, destination),
    searchPlaces: mockSearchPlaces({ lat: meta.lat, lng: meta.lng }),
    days,
  });
  const failure = getLastCombinationDiscoveryFailure();
  assert.notEqual(
    failure?.reason,
    "destination_resolution_failed",
    `${caseId} must not fail destination resolution: ${JSON.stringify(failure)}`,
  );
  assert.notEqual(failure?.detail, "no_coordinates", `${caseId} no_coordinates`);
  if (!combos?.length && failure?.reason) {
    console.log(`  note ${caseId}: discovery empty reason=${failure.reason} (anchor ok)`);
  }
  return result;
}

console.log("=== verify-destination-anchor-global ===\n");
clearDestinationAliasIndex();

await check("Geographic filter accepts island natural_feature", () => {
  assert.equal(isGeographicPlaceTypes(["establishment", "natural_feature"]), true);
  assert.equal(isGeographicPlaceTypes(["island"]), true);
  assert.equal(isGeographicPlaceTypes(["establishment", "point_of_interest"]), false);
});

await check("Alias: 蘇梅島 → Koh Samui / TH / island", () => {
  const alias = resolveDestinationAlias("蘇梅島", { countryHint: "泰國" });
  assert.equal(alias.normalizedName, "蘇梅島");
  assert.equal(alias.searchName, "Koh Samui");
  assert.equal(alias.entityType, "island");
  assert.equal(alias.countryCode, "TH");
});

await check("Alias: 熊本 → Kumamoto / JP / city（無固定座標）", () => {
  const alias = resolveDestinationAlias("熊本", { countryHint: "日本" });
  assert.equal(alias.normalizedName, "熊本");
  assert.equal(alias.searchName, "Kumamoto");
  assert.equal(alias.entityType, "city");
  assert.equal(alias.countryCode, "JP");
  assert.ok(alias.aliases.some((a) => /Kumamoto/i.test(a)));
});

await check("Alias: 佛羅倫斯 → Florence / Firenze / IT", () => {
  const a1 = resolveDestinationAlias("佛羅倫斯", { countryHint: "義大利" });
  const a2 = resolveDestinationAlias("Florence", { countryHint: "義大利" });
  const a3 = resolveDestinationAlias("Firenze", { countryHint: "義大利" });
  assert.equal(a1.normalizedName, "佛羅倫斯");
  assert.equal(a1.searchName, "Florence");
  assert.equal(a1.countryCode, "IT");
  assert.equal(a2.normalizedName, a1.normalizedName);
  assert.equal(a3.normalizedName, a1.normalizedName);
});

await check("Geocode query plan: 熊本 queries are distinct + include English", () => {
  const queries = buildDestinationGeocodeQueries("熊本", "zh-TW", "日本");
  assert.ok(queries.length >= 4, `expected >=4 queries, got ${queries.length}`);
  assert.equal(queries.length, new Set(queries).size, "retry queries must be unique");
  assert.ok(
    queries.some((q) => /Kumamoto/i.test(q)),
    `missing English: ${queries.join(" | ")}`,
  );
  assert.ok(
    queries.some((q) => /日本|Japan/i.test(q)),
    `missing country: ${queries.join(" | ")}`,
  );
  assert.ok(
    queries.some((q) => /熊本市/.test(q) || /Kumamoto City/i.test(q)),
    `missing city preference: ${queries.join(" | ")}`,
  );
  assert.ok(!queries.every((q) => q === "熊本"), "must not only retry raw 熊本");
});

await check("Geocode query plan: alias builder prefers city for 熊本", () => {
  const queries = buildAliasGeocodeQueries({
    destination: "熊本",
    countryHint: "日本",
    countryCode: "JP",
  });
  // English-first plan: Kumamoto, Kumamoto Prefecture, Japan → Kumamoto City, Japan → 熊本市…
  assert.ok(
    /Kumamoto/i.test(queries[0] ?? "") ||
      queries[0]?.includes("熊本市") ||
      /Kumamoto City/i.test(queries[0] ?? ""),
    `unexpected first query: ${queries[0]}`,
  );
  assert.ok(
    queries.some((q) => /熊本市/.test(q) || /Kumamoto City/i.test(q)),
    `missing city preference: ${queries.join(" | ")}`,
  );
  assert.equal(queries.length, new Set(queries).size);
});

await check("Overseas approx must not invent Taiwan center for 熊本", () => {
  const approx = resolveDestinationApproxCenter("熊本", "日本");
  assert.equal(approx, null);
});

await check("Case A 日本 UI 選項外自由輸入 → 熊本 → 5天", async () => {
  const result = await assertFlow({
    caseId: "A-kumamoto",
    country: "日本",
    destination: "熊本",
    days: 5,
    input: "熊本",
    offered: buildDestinationOptionsFromCityList(JAPAN_UI_OPTIONS, "日本"),
    requireOptionMatch: false,
  });
  assert.equal(result.anchor.countryCode, "JP");
  assert.ok(Math.abs(result.anchor.latitude - 32.8032) < 1);
  console.log(
    `  Kumamoto: normalized=${result.anchor.normalizedName} search=${result.anchor.searchName} countryCode=${result.anchor.countryCode} lat=${result.anchor.latitude} source=${result.anchor.source}`,
  );
});

await check("Case B 日本 → 福岡 → 5天", async () => {
  await assertFlow({
    caseId: "B-fukuoka",
    country: "日本",
    destination: "福岡",
    days: 5,
    offered: buildDestinationOptionsFromCityList(JAPAN_UI_OPTIONS, "日本"),
    requireOptionMatch: false,
  });
});

await check("Case C 日本 → 廣島 → 4天", async () => {
  await assertFlow({
    caseId: "C-hiroshima",
    country: "日本",
    destination: "廣島",
    days: 4,
    offered: buildDestinationOptionsFromCityList(JAPAN_UI_OPTIONS, "日本"),
    requireOptionMatch: false,
  });
});

await check("Case D 日本 → 沖繩 → 6天（非 city 亦可）", async () => {
  await assertFlow({
    caseId: "D-okinawa",
    country: "日本",
    destination: "沖繩",
    days: 6,
    offered: buildDestinationOptionsFromCityList(
      [...JAPAN_UI_OPTIONS, { name: "沖繩", type: "island" }],
      "日本",
    ),
  });
});

await check("Case E 泰國 → 蘇梅島 → 6天", async () => {
  await assertFlow({
    caseId: "E-samui",
    country: "泰國",
    destination: "蘇梅島",
    days: 6,
    offered: buildDestinationOptionsFromCityList(THAILAND_OPTIONS, "泰國"),
  });
});

await check("Case E2 泰國 → 芭達雅 → 6天（resort_area / tourist_area）", async () => {
  const result = await assertFlow({
    caseId: "E2-pattaya",
    country: "泰國",
    destination: "芭達雅",
    days: 6,
    offered: buildDestinationOptionsFromCityList(THAILAND_OPTIONS, "泰國"),
  });
  assert.equal(result.anchor.entityType, "resort_area");
  assert.equal(result.anchor.destinationType, "tourist_area");
  assert.equal(result.anchor.countryCode, "TH");
  assert.ok(result.anchor.administrativeArea === "Chon Buri" || !result.anchor.administrativeArea);
});

await check("Case E3 Pattaya English + full admin name", async () => {
  await assertFlow({
    caseId: "E3-pattaya-en",
    country: "泰國",
    destination: "芭達雅",
    input: "Pattaya",
    days: 6,
    offered: buildDestinationOptionsFromCityList(THAILAND_OPTIONS, "泰國"),
  });
  await assertFlow({
    caseId: "E3-pattaya-full",
    country: "泰國",
    destination: "芭達雅",
    input: "Pattaya, Chon Buri, Thailand",
    days: 6,
    offered: buildDestinationOptionsFromCityList(THAILAND_OPTIONS, "泰國"),
    requireOptionMatch: false,
  });
});

await check("Case F 韓國 → 濟州島 → 5天", async () => {
  await assertFlow({
    caseId: "F-jeju",
    country: "韓國",
    destination: "濟州島",
    days: 5,
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

await check("Case G 義大利 → 佛羅倫斯 → 4天", async () => {
  await assertFlow({
    caseId: "G-florence",
    country: "義大利",
    destination: "佛羅倫斯",
    days: 4,
    offered: buildDestinationOptionsFromCityList(
      [
        { name: "羅馬", type: "city" },
        { name: "米蘭", type: "city" },
        { name: "佛羅倫斯", type: "city" },
      ],
      "義大利",
    ),
  });
});

await check("Case H 澳洲 → 塔斯馬尼亞 → 7天", async () => {
  await assertFlow({
    caseId: "H-tasmania",
    country: "澳洲",
    destination: "塔斯馬尼亞",
    days: 7,
    offered: buildDestinationOptionsFromCityList(
      [
        { name: "雪梨", type: "city" },
        { name: "墨爾本", type: "city" },
        { name: "塔斯馬尼亞", type: "island" },
      ],
      "澳洲",
    ),
  });
});

await check("Case I 台灣 → 阿里山 → 3天（tourism area）", async () => {
  await assertFlow({
    caseId: "I-alishan",
    country: "台灣",
    destination: "阿里山",
    days: 3,
    offered: buildDestinationOptionsFromCityList(
      [
        { name: "台北", type: "city" },
        { name: "高雄", type: "city" },
        { name: "阿里山", type: "resort_area" },
      ],
      "台灣",
    ),
  });
});

await check("Alias: 深圳 → Shenzhen / CN / city（無固定座標）", () => {
  const alias = resolveDestinationAlias("深圳");
  assert.equal(alias.normalizedName, "深圳");
  assert.equal(alias.searchName, "Shenzhen");
  assert.equal(alias.entityType, "city");
  assert.equal(alias.countryCode, "CN");
  assert.equal(alias.countryHint, "中國");
  assert.ok(alias.aliases.some((a) => /Shenzhen/i.test(a)));
});

await check("Geocode query plan: 深圳 includes English + China（無 CJK City 污染）", () => {
  const queries = buildDestinationGeocodeQueries("深圳", "zh-TW", "中國");
  assert.ok(queries.length >= 4, `expected >=4 queries, got ${queries.length}`);
  assert.ok(queries.some((q) => /Shenzhen/i.test(q)), `missing English: ${queries.join(" | ")}`);
  assert.ok(queries.some((q) => /China|中國/i.test(q)), `missing country: ${queries.join(" | ")}`);
  assert.ok(!queries.some((q) => /深圳 City/.test(q)), `CJK must not append City: ${queries.join(" | ")}`);
});

await check("Case CN-A 自由輸入 → 深圳 → 4天（無父層國家）", async () => {
  const result = await assertFlow({
    caseId: "CN-A-shenzhen-direct",
    country: "中國",
    destination: "深圳",
    days: 4,
    requireOptionMatch: false,
  });
  assert.equal(result.anchor.countryCode, "CN");
  assert.equal(result.anchor.entityType, "city");
  assert.ok(Math.abs(result.anchor.latitude - 22.54) < 1);
  console.log(
    `  Shenzhen: canonical=${result.anchor.normalizedName} search=${result.anchor.searchName} countryCode=${result.anchor.countryCode} type=${result.anchor.destinationType} lat=${result.anchor.latitude} source=${result.anchor.source}`,
  );
});

await check("Case CN-B 中國 → 深圳 → 4天（父層國家繼承）", async () => {
  const chinaOptions = buildDestinationOptionsFromCityList(
    [
      { name: "北京", type: "city" },
      { name: "上海", type: "city" },
      { name: "廣州", type: "city" },
      { name: "深圳", type: "city" },
    ],
    "中國",
  );
  const result = await assertFlow({
    caseId: "CN-B-shenzhen-inherit",
    country: "中國",
    destination: "深圳",
    days: 4,
    offered: chinaOptions,
  });
  assert.equal(result.anchor.countryCode, "CN");
});

await check("Case CN-C Shenzhen English → 4 days", async () => {
  await assertFlow({
    caseId: "CN-C-shenzhen-en",
    country: "中國",
    destination: "深圳",
    input: "Shenzhen",
    days: 4,
    requireOptionMatch: false,
  });
});

await check("Case CN-D Geocode returns English China → normalize CN", async () => {
  resetDestination("深圳");
  const result = await resolveDestinationAnchor({
    destination: "深圳",
    locale: "zh-TW",
    geocodeFn: async ({ data }) => ({
      location: {
        placeId: `mock:${data.query}`,
        country: "China",
        city: "Shenzhen",
        lat: 22.5431,
        lng: 114.0579,
        formattedName: data.query,
        displayLabel: data.query,
        address: data.query,
        timezone: undefined,
        utcOffsetMinutes: null,
        types: ["locality", "political"],
      },
      error: null,
    }),
  });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.equal(result.anchor.countryCode, "CN");
  assert.equal(result.anchor.country, "中國");
});

await check("Matrix city: 清邁 / 首爾 / 釜山 / 峴港 / 巴塞隆納 / 巴黎 / 墨爾本 / 高雄", async () => {
  const cities = [
    ["清邁", "泰國", "TH"],
    ["首爾", "韓國", "KR"],
    ["釜山", "韓國", "KR"],
    ["峴港", "越南", "VN"],
    ["巴塞隆納", "西班牙", "ES"],
    ["巴黎", "法國", "FR"],
    ["墨爾本", "澳洲", "AU"],
    ["高雄", "台灣", "TW"],
  ];
  for (const [destination, country, countryCode] of cities) {
    const result = await assertFlow({
      caseId: `matrix-${destination}`,
      country,
      destination,
      days: 4,
      requireOptionMatch: false,
    });
    assert.equal(result.anchor.countryCode, countryCode, `${destination} countryCode`);
  }
});

await check("Case Bali regression 印尼 → 峇里島 → 6天", async () => {
  const result = await assertFlow({
    caseId: "bali-regression",
    country: "印尼",
    destination: "峇里島",
    days: 6,
  });
  assert.equal(result.anchor.countryCode, "ID");
  assert.equal(result.anchor.entityType, "island");
});

await check("Case J 虛構城市 → destination_resolution_failed（不得台灣 fallback）", async () => {
  const fake = "虛構城市XYZ";
  resetDestination(fake);
  const result = await resolveDestinationAnchor({
    destination: fake,
    locale: "zh-TW",
    countryHint: "法國",
    geocodeFn: async () => ({ location: null, error: "geocode_empty_response" }),
  });
  assert.equal(result.status, "destination_resolution_failed");
  assert.ok(
    [
      "destination_geocode_empty",
      "anchor_geocode_empty",
      "anchor_all_providers_failed",
      "destination_resolution_failed",
      "no_coordinates",
    ].includes(result.reason),
    `reason=${result.reason}`,
  );
  // Must not invent Taiwan coords for overseas fictional.
  const approx = resolveDestinationApproxCenter(fake, "法國");
  assert.equal(approx, null);
});

await check("Anchor 失敗不得進 Combination Discovery", async () => {
  const fake = "不存在的島嶼ZZZ";
  resetDestination(fake);
  clearDiscoveredCombinationsCache(fake);
  const combos = await discoverDestinationCombinations({
    destination: fake,
    locale: "zh-TW",
    destinationCountry: "日本",
    geocodeFn: async () => ({ location: null, error: "geocode_empty_response" }),
    searchPlaces: async () => {
      throw new Error("Places search must not run when anchor fails");
    },
    days: 5,
  });
  assert.equal(combos, null);
  const failure = getLastCombinationDiscoveryFailure();
  assert.equal(failure?.reason, "destination_resolution_failed");
  assert.equal(failure?.detail, "no_coordinates");
});

await check("countryCode 不得遺失：熊本 inherits JP", async () => {
  resetDestination("熊本");
  const result = await resolveDestinationAnchor({
    destination: "熊本",
    locale: "zh-TW",
    countryHint: "日本",
    offeredOptions: buildDestinationOptionsFromCityList(JAPAN_UI_OPTIONS, "日本"),
    geocodeFn: mockGeocode(32.8032, 130.7079, "日本", "熊本市"),
  });
  assert.equal(result.status, "ok");
  assert.equal(result.anchor.countryCode, "JP");
});

await check("Legacy island cases still pass", async () => {
  await assertFlow({
    caseId: "legacy-hokkaido",
    country: "日本",
    destination: "北海道",
    days: 7,
    offered: buildDestinationOptionsFromCityList(
      [...JAPAN_UI_OPTIONS, { name: "北海道", type: "region" }],
      "日本",
    ),
  });
});

await check("Case O 泰國 → 第五個 → 蘇梅島", async () => {
  const options = buildDestinationOptionsFromCityList(THAILAND_OPTIONS, "泰國");
  const matched = matchDestinationOptionFromPreviousTurn("第五個", options);
  assert.equal(matched?.normalizedName, "蘇梅島");
  assert.equal(matched?.entityType, "island");
  assert.equal(matched?.countryCode, "TH");
  await assertFlow({
    caseId: "O",
    country: "泰國",
    destination: "蘇梅島",
    input: "第五個",
    days: 6,
    offered: options,
  });
});

await check("Case O2 泰國 → 第三個 → 芭達雅", async () => {
  const options = buildDestinationOptionsFromCityList(THAILAND_OPTIONS, "泰國");
  const matched = matchDestinationOptionFromPreviousTurn("第三個", options);
  assert.equal(matched?.normalizedName, "芭達雅");
  assert.equal(matched?.entityType, "resort_area");
  await assertFlow({
    caseId: "O2",
    country: "泰國",
    destination: "芭達雅",
    input: "第三個",
    days: 6,
    offered: options,
  });
});

await check("Case P 泰國 → Koh Samui → 成功", async () => {
  await assertFlow({
    caseId: "P",
    country: "泰國",
    destination: "蘇梅島",
    input: "Koh Samui",
    days: 6,
    offered: buildDestinationOptionsFromCityList(THAILAND_OPTIONS, "泰國"),
  });
});

await check("Case Q 泰國 → 想去泰國的蘇梅島 → 成功", async () => {
  await assertFlow({
    caseId: "Q",
    country: "泰國",
    destination: "蘇梅島",
    input: "想去泰國的蘇梅島",
    days: 6,
    offered: buildDestinationOptionsFromCityList(THAILAND_OPTIONS, "泰國"),
  });
});

if (failed > 0) {
  console.error(`\n[verify-destination-anchor-global] ${failed} failed`);
  process.exit(1);
}
console.log("\n[verify-destination-anchor-global] ok");
