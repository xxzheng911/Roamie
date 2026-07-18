/**
 * Theme fallback must only provide search directions — never fake place names.
 * Combination options require Places-backed (or curated real-name) pools.
 */
import assert from "node:assert/strict";
import {
  buildThemeFallbackCombinations,
  buildThemeSearchDirectionsForDestination,
  buildDestinationCombinationSuggestionsReply,
  getDestinationCombinations,
  isThemeCategoryLabel,
  dropGenericCombinationLabel,
} from "../src/lib/ai/destination-combination-suggestions.ts";
import {
  clearDiscoveredCombinationsCache,
  setCachedDiscoveredCombinations,
  structuredCombinationsToTitlesPlaces,
} from "../src/lib/ai/destination-combination-discovery.ts";
import { buildThemeSearchDirections } from "../src/lib/ai/destination-discovery-queries.ts";

const BANNED = [
  "海灘",
  "跳島",
  "日落海岸",
  "老城",
  "教堂",
  "市集",
  "海鮮",
  "夜市",
  "酒吧街",
  "瀑布",
  "山林",
  "湖畔",
];

const CITIES = [
  "宿霧",
  "東京",
  "台中",
  "花蓮",
  "巴黎",
  "首爾",
  "曼谷",
  "倫敦",
];

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

console.log("=== theme fallback is search-only ===\n");

check("banned labels detected", () => {
  for (const label of BANNED) {
    assert.equal(isThemeCategoryLabel(label), true, label);
    assert.equal(dropGenericCombinationLabel(label), true, `drop ${label}`);
  }
});

check("宿霧 theme directions have queries and empty places", () => {
  const directions = buildThemeSearchDirections("宿霧", "菲律賓");
  assert.ok(directions.length >= 3);
  for (const d of directions) {
    assert.ok(d.queries.length >= 2, `${d.title} has queries`);
    assert.ok(d.searchKeywords.length >= 2, `${d.title} has keywords`);
  }
  const legacy = buildThemeFallbackCombinations("宿霧", "菲律賓");
  assert.equal(legacy.length, directions.length);
  for (const combo of legacy) {
    assert.equal(combo.places.length, 0, `${combo.title} places must be empty`);
  }
  assert.equal(
    buildThemeSearchDirectionsForDestination("宿霧", "菲律賓").length,
    directions.length,
  );
});

check("getDestinationCombinations never returns banned labels", () => {
  for (const city of CITIES) {
    clearDiscoveredCombinationsCache(city);
    const combos = getDestinationCombinations(city);
    const places = combos.flatMap((c) => c.places);
    for (const banned of BANNED) {
      assert.ok(!places.includes(banned), `${city} must not include ${banned}`);
    }
  }
});

check("forceCombinations with category labels cannot build reply", () => {
  const fake = buildThemeFallbackCombinations("宿霧", "菲律賓").map((c, i) => ({
    title: c.title,
    places: BANNED.slice(i * 3, i * 3 + 3),
  }));
  const reply = buildDestinationCombinationSuggestionsReply("宿霧", 6, {
    forceCombinations: fake,
  });
  assert.equal(reply, null, "category-label forceCombinations → null reply");
});

check("Places-backed cache yields real-name reply for 宿霧", () => {
  clearDiscoveredCombinationsCache("宿霧");
  setCachedDiscoveredCombinations("宿霧", [
    {
      combinationId: "cebu:1",
      title: "市區文化組合",
      theme: "historic",
      placeCandidates: [
        { name: "Basilica del Santo Niño", googlePlaceId: "ChIJ1", types: ["church"], coordinates: { lat: 10.29, lng: 123.9 } },
        { name: "Magellan's Cross", googlePlaceId: "ChIJ2", types: ["tourist_attraction"], coordinates: { lat: 10.29, lng: 123.9 } },
        { name: "Fort San Pedro", googlePlaceId: "ChIJ3", types: ["tourist_attraction"], coordinates: { lat: 10.29, lng: 123.9 } },
      ],
      primaryCandidates: [
        { name: "Basilica del Santo Niño", googlePlaceId: "ChIJ1", types: ["church"] },
        { name: "Magellan's Cross", googlePlaceId: "ChIJ2", types: ["tourist_attraction"] },
        { name: "Fort San Pedro", googlePlaceId: "ChIJ3", types: ["tourist_attraction"] },
      ],
    },
    {
      combinationId: "cebu:2",
      title: "海島放鬆組合",
      theme: "coast",
      placeCandidates: [
        { name: "Mactan Island", googlePlaceId: "ChIJ4", types: ["natural_feature"] },
        { name: "Nalusuan Island", googlePlaceId: "ChIJ5", types: ["natural_feature"] },
        { name: "Hilutungan Island", googlePlaceId: "ChIJ6", types: ["natural_feature"] },
      ],
      primaryCandidates: [
        { name: "Mactan Island", googlePlaceId: "ChIJ4", types: ["natural_feature"] },
        { name: "Nalusuan Island", googlePlaceId: "ChIJ5", types: ["natural_feature"] },
        { name: "Hilutungan Island", googlePlaceId: "ChIJ6", types: ["natural_feature"] },
      ],
    },
    {
      combinationId: "cebu:3",
      title: "近郊自然組合",
      theme: "suburb",
      placeCandidates: [
        { name: "Kawasan Falls", googlePlaceId: "ChIJ7", types: ["natural_feature"] },
        { name: "Osmeña Peak", googlePlaceId: "ChIJ8", types: ["natural_feature"] },
        { name: "Moalboal", googlePlaceId: "ChIJ9", types: ["locality"] },
      ],
      primaryCandidates: [
        { name: "Kawasan Falls", googlePlaceId: "ChIJ7", types: ["natural_feature"] },
        { name: "Osmeña Peak", googlePlaceId: "ChIJ8", types: ["natural_feature"] },
        { name: "Moalboal", googlePlaceId: "ChIJ9", types: ["locality"] },
      ],
    },
  ]);

  const combos = getDestinationCombinations("宿霧");
  assert.ok(combos.length >= 3, `cached 宿霧 combos >= 3 (got ${combos.length})`);
  for (const c of combos) {
    assert.ok(c.places.length >= 3, `${c.title} has >=3 places`);
    for (const banned of BANNED) {
      assert.ok(!c.places.includes(banned));
    }
  }
  const reply = buildDestinationCombinationSuggestionsReply("宿霧", 6);
  assert.ok(reply?.includes("建議組合"));
  assert.ok(reply?.includes("Basilica del Santo Niño") || reply?.includes("Magellan"));
  for (const banned of BANNED) {
    assert.ok(!reply?.includes(`：${banned}`) && !reply?.includes(`、${banned}`), `reply excludes ${banned}`);
  }

  const titlesPlaces = structuredCombinationsToTitlesPlaces(
    /** @type {any} */ (
      [
        {
          title: "t",
          placeCandidates: [{ name: "A" }, { name: "B" }, { name: "C" }],
          primaryCandidates: [{ name: "A" }, { name: "B" }, { name: "C" }],
        },
      ]
    ),
  );
  assert.deepEqual(titlesPlaces[0].places, ["A", "B", "C"]);
  clearDiscoveredCombinationsCache("宿霧");
});

console.log("\n=== per-city combo counts (curated or empty without Places) ===\n");
for (const city of CITIES) {
  clearDiscoveredCombinationsCache(city);
  const combos = getDestinationCombinations(city);
  const counts = combos.map((c) => c.places.length);
  console.log(
    `${city}: combos=${combos.length} placesPerCombo=[${counts.join(",")}] ` +
      `(empty until Places discovery unless curated)`,
  );
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nTheme fallback search-only checks passed.");
