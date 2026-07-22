/**
 * Region Adjacency / Nearby Region — destination-agnostic living-circle rules.
 *
 * Priority: adjacent → 30–90min living circle → popular → farther (opt-in).
 * Day policy: 1–3 none / 4–5 max 1 / 6+ max 2–3.
 */
import assert from "node:assert/strict";
import {
  applyNearbyRegionPolicyToThemes,
  isNearbyRegionThemeTitle,
  isTooFarForDefaultNearby,
  resolveNearbyDayPolicy,
  resolveNearbyRegions,
} from "../src/lib/ai/region-adjacency/index.ts";
import { getDestinationCombinations } from "../src/lib/ai/destination-combination-suggestions.ts";
import { buildDynamicDestinationCombinations as buildFromProfile } from "../src/lib/ai/destination-travel-profile.ts";
import { parseNearbyExtensionsFromText } from "../src/lib/ai/combination-selection-reply.ts";

let failed = 0;
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(e);
  }
}

console.log("=== region adjacency / nearby region ===\n");

check("day policy: 1–3 → no nearby default", () => {
  for (const d of [1, 2, 3]) {
    const p = resolveNearbyDayPolicy(d);
    assert.equal(p.maxNearbyOptions, 0);
    assert.equal(p.suggestNearbyByDefault, false);
  }
});

check("day policy: 4–5 → max 1", () => {
  for (const d of [4, 5]) {
    const p = resolveNearbyDayPolicy(d);
    assert.equal(p.maxNearbyOptions, 1);
    assert.equal(p.suggestNearbyByDefault, true);
  }
});

check("day policy: 6+ → max 3", () => {
  const p = resolveNearbyDayPolicy(6);
  assert.equal(p.maxNearbyOptions, 3);
  assert.equal(p.suggestNearbyByDefault, true);
});

check("名古屋 default nearby excludes 伊勢 / 合掌造", () => {
  const r = resolveNearbyRegions("名古屋", { tripDays: 6 });
  const labels = r.candidates.map((c) => c.label);
  assert.ok(labels.includes("犬山"), `expected 犬山 in ${labels.join(",")}`);
  assert.ok(!labels.includes("伊勢"), "伊勢 must not be default nearby");
  assert.ok(!labels.includes("合掌造"), "合掌造 must not be default nearby");
  assert.ok(
    isTooFarForDefaultNearby("名古屋", "伊勢"),
    "伊勢 marked too far",
  );
  assert.ok(
    isTooFarForDefaultNearby("名古屋", "伊勢神宮"),
    "伊勢神宮 alias marked too far",
  );
});

check("名古屋 farther only when includeFarther", () => {
  const r = resolveNearbyRegions("名古屋", {
    tripDays: 7,
    includeFarther: true,
    forceInclude: true,
    maxCandidates: 10,
  });
  const labels = r.candidates.map((c) => c.label);
  assert.ok(labels.includes("伊勢") || labels.includes("合掌造"));
});

check("hierarchy: 東京✔橫濱 ✖箱根（非同 metro／獨立旅遊區）", () => {
  const r = resolveNearbyRegions("東京", { tripDays: 6 });
  const labels = r.candidates.map((c) => c.label);
  assert.ok(labels.includes("橫濱"));
  assert.ok(!labels.includes("箱根"));
  assert.ok(isTooFarForDefaultNearby("東京", "箱根"));
  assert.equal(isTooFarForDefaultNearby("東京", "橫濱"), false);
});

check("hierarchy: 名古屋✔犬山 ✖伊勢", () => {
  const labels = resolveNearbyRegions("名古屋", { tripDays: 6 }).candidates.map(
    (c) => c.label,
  );
  assert.ok(labels.includes("犬山"));
  assert.ok(!labels.includes("伊勢"));
  assert.ok(isTooFarForDefaultNearby("名古屋", "伊勢"));
});

check("hierarchy: 大阪✔京都／神戶 ✖白濱", () => {
  const labels = resolveNearbyRegions("大阪", { tripDays: 6 }).candidates.map(
    (c) => c.label,
  );
  assert.ok(labels.includes("京都"));
  assert.ok(labels.includes("神戶"));
  assert.ok(!labels.includes("白濱"));
  assert.ok(isTooFarForDefaultNearby("大阪", "白濱"));
});

check("hierarchy: travel-time alone cannot promote 箱根", () => {
  // 箱根 is ~100min and same 神奈川県 admin as 橫濱 — still not default nearby.
  const r = resolveNearbyRegions("東京", {
    tripDays: 7,
    forceInclude: true,
    maxCandidates: 20,
    includeFarther: false,
  });
  assert.ok(!r.candidates.some((c) => c.label === "箱根"));
});

check("hierarchy bypass only with includeFarther", () => {
  const r = resolveNearbyRegions("大阪", {
    tripDays: 7,
    includeFarther: true,
    forceInclude: true,
    maxCandidates: 12,
  });
  assert.ok(r.candidates.some((c) => c.label === "白濱"));
});

check("台北 → 新北／基隆／桃園", () => {
  const labels = resolveNearbyRegions("台北", { tripDays: 6 }).candidates.map(
    (c) => c.label,
  );
  for (const need of ["新北", "基隆", "桃園"]) {
    assert.ok(labels.includes(need), `missing ${need}`);
  }
});

check("首爾 → 仁川／水原／城南；南怡島 not default", () => {
  const labels = resolveNearbyRegions("首爾", { tripDays: 6 }).candidates.map(
    (c) => c.label,
  );
  for (const need of ["仁川", "水原", "城南"]) {
    assert.ok(labels.includes(need), `missing ${need}`);
  }
  assert.ok(!labels.includes("南怡島"));
});

check("short trip suppresses nearby theme", () => {
  const themes = applyNearbyRegionPolicyToThemes(
    "名古屋",
    [
      { title: "經典名古屋組合", places: ["名古屋城", "熱田神宮", "綠洲21"] },
      { title: "近郊備案", places: ["犬山城", "合掌造集落", "伊勢神宮"] },
    ],
    { tripDays: 3 },
  );
  assert.ok(!themes.some((t) => isNearbyRegionThemeTitle(t.title)));
  assert.equal(themes.length, 1);
});

check("名古屋 curated profile no longer surfaces 伊勢", () => {
  const combos = buildFromProfile("名古屋");
  const nearby = combos.find((c) => isNearbyRegionThemeTitle(c.title));
  assert.ok(nearby, "expected nearby theme when days omitted");
  const joined = nearby.places.join("、");
  assert.ok(!/伊勢|合掌/.test(joined), `unexpected far places: ${joined}`);
  assert.ok(/犬山|常滑|瀨戶|岡崎|一宮|岐阜/.test(joined), joined);
});

check("reply path: 3-day 名古屋 has no 近郊備案", () => {
  const combos = getDestinationCombinations("名古屋", { tripDays: 3 });
  assert.ok(
    !combos.some((c) => isNearbyRegionThemeTitle(c.title)),
    "short trip must not offer nearby region combo",
  );
  assert.ok(combos.length >= 3, "still enough non-nearby combos");
});

check("reply path: 6-day 名古屋 nearby is living-circle", () => {
  const combos = getDestinationCombinations("名古屋", { tripDays: 6 });
  const nearby = combos.find((c) => isNearbyRegionThemeTitle(c.title));
  assert.ok(nearby, "long trip should offer nearby");
  assert.ok(!/伊勢|合掌/.test(nearby.places.join("、")));
});

check("utterance 犬山 parses as nearby extension for 名古屋", () => {
  const found = parseNearbyExtensionsFromText("1、2跟犬山", "名古屋");
  assert.deepEqual(found, ["犬山"]);
});

check("same rules apply without city-specific if-else (東京/大阪)", () => {
  const tokyo = resolveNearbyRegions("東京", { tripDays: 5 });
  const osaka = resolveNearbyRegions("大阪", { tripDays: 5 });
  assert.equal(tokyo.dayPolicy.maxNearbyOptions, 1);
  assert.equal(osaka.dayPolicy.maxNearbyOptions, 1);
  assert.ok(tokyo.candidates.length <= 1);
  assert.ok(osaka.candidates.length <= 1);
});

console.log(`\npassed=${passed} failed=${failed}`);
if (failed) process.exit(1);
console.log("verify-region-adjacency: ok");
