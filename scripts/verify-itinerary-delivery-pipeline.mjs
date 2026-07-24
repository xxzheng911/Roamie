#!/usr/bin/env node
/**
 * Planner → Validator → Replan → Delivery pipeline acceptance (offline).
 *
 * Cases:
 *  1. Osaka 4d all combinations
 *  2. Tokyo 5d all combinations
 *  3. Nagoya 4d
 *  4. Seoul 5d
 *  5. Bangkok 5d
 *
 * Plus regression guards:
 *  - false user_exclusions from AI conversation summary
 *  - amusement_park not matched by "park" exclusion keyword
 *  - replan keep original
 *  - stop unwrap contract
 *
 * Run: npm run verify:itinerary-delivery-pipeline
 */
import assert from "node:assert/strict";
import {
  validatePlaceForCombination,
  resolveCombinationThemeKey,
} from "../src/lib/ai/combination-category-contract.ts";
import {
  extractUserAuthoredExclusionText,
  parseExcludedCategoriesFromText,
  placeMatchesExcludedCategories,
  exclusionKeywordMatchesPlace,
} from "../src/lib/ai/recommendation-exclusion.ts";
import {
  setItineraryValidatorEnabledOverride,
  validateItineraryPlan,
  shouldBlockItineraryDelivery,
  dayCountsOfPlans,
  logItineraryDeliveryBlocked,
} from "../src/lib/ai/itinerary-validator/index.ts";
import { replanUntilItineraryValid } from "../src/lib/ai/itinerary-validator/replan.ts";
import { normalizeItineraryStop } from "../src/lib/ai/real-place-supplement.ts";
import { buildCombinationSelectionAllowlist } from "../src/lib/ai/destination-combination-suggestions.ts";
import { resolveDestinationTravelProfile } from "../src/lib/ai/destination-travel-profile.ts";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(e);
  }
}

function place(partial) {
  return {
    address: `${partial.city ?? "大阪"}市某某區1-1`,
    photoName: "photos/x",
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: true,
    userRatingCount: 200,
    rating: 4.4,
    lat: 34.6937,
    lng: 135.5023,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction", "point_of_interest"],
    ...partial,
  };
}

function entry(time, label, p) {
  return { time, label, name: p.name, place: p };
}

const CITY_COORDS = {
  大阪: { lat: 34.6937, lng: 135.5023 },
  東京: { lat: 35.6812, lng: 139.7671 },
  名古屋: { lat: 35.1815, lng: 136.9066 },
  首爾: { lat: 37.5665, lng: 126.978 },
  曼谷: { lat: 13.7563, lng: 100.5018 },
};

const PLACE_TYPE_HINTS = {
  通天閣: { primaryType: "observation_deck", types: ["observation_deck", "tourist_attraction"] },
  天保山: { primaryType: "ferris_wheel", types: ["ferris_wheel", "tourist_attraction"] },
  天保山摩天輪: { primaryType: "ferris_wheel", types: ["ferris_wheel", "tourist_attraction"] },
  環球影城: { primaryType: "amusement_park", types: ["amusement_park", "tourist_attraction"] },
  日本環球影城: { primaryType: "amusement_park", types: ["amusement_park", "tourist_attraction"] },
  海遊館: { primaryType: "aquarium", types: ["aquarium", "tourist_attraction"] },
  大阪城: { primaryType: "tourist_attraction", types: ["tourist_attraction", "castle"] },
  道頓堀: { primaryType: "tourist_attraction", types: ["tourist_attraction"] },
  心齋橋: { primaryType: "tourist_attraction", types: ["tourist_attraction", "shopping_mall"] },
  新世界: { primaryType: "tourist_attraction", types: ["tourist_attraction"] },
  難波: { primaryType: "tourist_attraction", types: ["tourist_attraction"] },
  美國村: { primaryType: "tourist_attraction", types: ["tourist_attraction"] },
  黑門市場: { primaryType: "market", types: ["market", "food"] },
  淺草寺: { primaryType: "place_of_worship", types: ["place_of_worship", "tourist_attraction"] },
  東京晴空塔: { primaryType: "observation_deck", types: ["observation_deck", "tourist_attraction"] },
  上野公園: { primaryType: "park", types: ["park"] },
  阿美橫町: { primaryType: "market", types: ["market"] },
  大皇宮: { primaryType: "tourist_attraction", types: ["tourist_attraction", "place_of_worship"] },
  玉佛寺: { primaryType: "place_of_worship", types: ["place_of_worship"] },
  景福宮: { primaryType: "tourist_attraction", types: ["tourist_attraction"] },
};

function fixturePlace(name, city, index) {
  const coords = CITY_COORDS[city] ?? CITY_COORDS.大阪;
  const hint = PLACE_TYPE_HINTS[name] ?? {};
  const jitter = (index % 7) * 0.0015;
  return place({
    id: `ChIJ${city}${index}${name}`.slice(0, 27),
    name,
    city,
    lat: coords.lat + jitter,
    lng: coords.lng + jitter * 0.8,
    ...hint,
  });
}

const MEAL_SLOTS = [
  ["08:00", "早餐", { primaryType: "cafe", types: ["cafe", "restaurant"] }],
  ["12:30", "午餐", { primaryType: "restaurant", types: ["restaurant"] }],
  ["18:30", "晚餐", { primaryType: "restaurant", types: ["restaurant"] }],
];

function buildPlansFromNames(city, names, days) {
  const coords = CITY_COORDS[city] ?? CITY_COORDS.大阪;
  const attractions = names.map((n, i) => fixturePlace(n, city, i));
  const plans = [];
  let ai = 0;
  for (let d = 1; d <= days; d += 1) {
    const entries = [];
    // breakfast
    const [bt, bl, bhint] = MEAL_SLOTS[0];
    entries.push(
      entry(
        bt,
        bl,
        place({
          id: `b-${city}-${d}`,
          name: `${city}早餐${d}`,
          city,
          lat: coords.lat,
          lng: coords.lng,
          ...bhint,
        }),
      ),
    );
    // 2 attractions
    for (let k = 0; k < 2; k += 1) {
      const p = attractions[ai % attractions.length];
      ai += 1;
      entries.push(
        entry(k === 0 ? "09:30" : "15:00", "景點", {
          ...p,
          id: `${p.id}-d${d}-${k}`,
          lat: coords.lat + (ai % 5) * 0.002,
          lng: coords.lng + (ai % 5) * 0.001,
        }),
      );
    }
    // lunch
    const [lt, ll, lhint] = MEAL_SLOTS[1];
    entries.push(
      entry(
        lt,
        ll,
        place({
          id: `l-${city}-${d}`,
          name: `${city}午餐${d}`,
          city,
          lat: coords.lat + 0.003,
          lng: coords.lng + 0.002,
          ...lhint,
        }),
      ),
    );
    // dinner
    const [dt, dl, dhint] = MEAL_SLOTS[2];
    entries.push(
      entry(
        dt,
        dl,
        place({
          id: `d-${city}-${d}`,
          name: `${city}晚餐${d}`,
          city,
          lat: coords.lat + 0.004,
          lng: coords.lng + 0.003,
          ...dhint,
        }),
      ),
    );
    plans.push({ day: d, entries });
  }
  return plans;
}

function runCityCase(label, city, days, selectText) {
  setItineraryValidatorEnabledOverride(true);
  const profile = resolveDestinationTravelProfile(city);
  const allowlist = buildCombinationSelectionAllowlist(city, selectText);
  assert.ok(allowlist, `${city}: allowlist`);
  assert.ok(allowlist.selectedCombinationIds.length >= 1, `${city}: selected ids`);

  const placeNames =
    allowlist.allowedPlaceNames.length > 0
      ? allowlist.allowedPlaceNames
      : (profile?.themes ?? []).flatMap((t) => t.places).slice(0, 12);

  assert.ok(placeNames.length >= 3, `${city}: enough places`);

  // Category contract: food titles reject landmarks; classic/family allow tourism types.
  for (const title of allowlist.allowedTitles.length
    ? allowlist.allowedTitles
    : (profile?.themes ?? []).map((t) => t.title)) {
    const theme = resolveCombinationThemeKey("soft", title);
    if (theme === "food" || /美食探索/.test(title)) {
      const temple = validatePlaceForCombination(
        {
          name: "大須觀音",
          primaryType: "place_of_worship",
          types: ["place_of_worship", "tourist_attraction"],
        },
        "soft",
        { title },
      );
      assert.equal(temple.valid, false, `${city} ${title} must reject temple`);
      continue;
    }
    if (theme === "attraction" || /經典|親子|娛樂/.test(title)) {
      const sample = validatePlaceForCombination(
        {
          name: "通天閣",
          primaryType: "observation_deck",
          types: ["observation_deck", "tourist_attraction"],
        },
        "soft",
        { title },
      );
      if (/經典|親子/.test(title)) {
        assert.equal(sample.valid, true, `${city} ${title} must allow observation_deck`);
      }
    }
  }

  const plans = buildPlansFromNames(city, placeNames, days);
  const stopCount = plans.reduce((n, p) => n + p.entries.length, 0);

  // Simulate AI conversation summary that used to false-trigger exclusions.
  const fakeSummary = [
    "使用者：1、2、3",
    "Roamie：好，節奏不要排太滿，公園與景點會穿插安排。",
    `已選地點：${placeNames.slice(0, 6).join("、")}`,
  ].join("\n");

  const validation = validateItineraryPlan({
    plans,
    requestedDays: days,
    style: "mixed",
    plannedDate: "2026-12-03",
    endDate:
      days === 4
        ? "2026-12-06"
        : days === 5
          ? "2026-12-07"
          : "2026-12-06",
    userText: fakeSummary,
    excludedCategories: [],
    destination: city,
    creationPath: "selected_places",
  });

  assert.equal(
    validation.failedRules.some((r) => r.code === "user_exclusions"),
    false,
    `${city}: user_exclusions must pass (got ${validation.failedRules.map((r) => r.message).join("|")})`,
  );

  let finalValidation = validation;
  let finalPlans = plans;
  if (!validation.pass) {
    const replanned = replanUntilItineraryValid(
      {
        plans,
        pool: plans.flatMap((p) => p.entries.map((e) => e.place)),
        days,
        style: "mixed",
        plannedDate: "2026-12-03",
        validatorInput: {
          requestedDays: days,
          style: "mixed",
          plannedDate: "2026-12-03",
          userText: fakeSummary,
          excludedCategories: [],
          destination: city,
          creationPath: "selected_places",
        },
      },
      validation,
    );
    finalPlans = replanned.plans;
    finalValidation = replanned.validation;
  }

  assert.equal(finalValidation.pass, true, `${city}: validator pass`);
  assert.equal(shouldBlockItineraryDelivery(finalValidation), false, `${city}: delivery allowed`);
  const counts = dayCountsOfPlans(finalPlans);
  assert.equal(counts.length, days, `${city}: day count`);
  assert.ok(
    counts.every((c) => c >= 2),
    `${city}: each day >= 2 stops (${counts.join(",")})`,
  );
  assert.ok(stopCount >= days * 2, `${city}: planner produced enough stops`);

  console.log(
    `    ${label}: stops=${stopCount} dayCounts=${counts.join(",")} score=${finalValidation.score} delivery=ok`,
  );
}

console.log("\n=== Exclusion / category regressions ===");

test("AI summary with 不要排太滿 does not parse exclusions", () => {
  const text = [
    "使用者：1、2、3",
    "Roamie：節奏不要排太滿，公園景點會穿插。",
  ].join("\n");
  assert.equal(extractUserAuthoredExclusionText(text), "");
  assert.deepEqual(parseExcludedCategoriesFromText(text), []);
});

test("explicit user 不要公園 still parses", () => {
  const text = "使用者：不要公園、不要戶外";
  const parsed = parseExcludedCategoriesFromText(text);
  assert.ok(parsed.some((k) => /公園|park/i.test(k)), JSON.stringify(parsed));
});

test("park keyword does not match amusement_park", () => {
  const usj = {
    name: "日本環球影城",
    primaryType: "amusement_park",
    types: ["amusement_park", "tourist_attraction"],
  };
  assert.equal(exclusionKeywordMatchesPlace("park", usj), false);
  assert.equal(placeMatchesExcludedCategories(usj, ["park", "公園"]), false);
});

test("美食探索 uses food contract; 親子娛樂 still allows attractions", () => {
  assert.equal(resolveCombinationThemeKey("soft", "美食探索組合"), "food");
  assert.equal(
    validatePlaceForCombination(
      { name: "通天閣", primaryType: "observation_deck", types: ["observation_deck", "tourist_attraction"] },
      "soft",
      { title: "美食探索組合" },
    ).valid,
    false,
  );
  assert.equal(
    validatePlaceForCombination(
      { name: "一蘭道頓堀店", primaryType: "restaurant", types: ["restaurant"] },
      "soft",
      { title: "美食探索組合" },
    ).valid,
    true,
  );
  assert.equal(
    validatePlaceForCombination(
      { name: "天保山摩天輪", primaryType: "ferris_wheel", types: ["ferris_wheel", "tourist_attraction"] },
      "soft",
      { title: "親子娛樂組合" },
    ).valid,
    true,
  );
});

test("stop unwrap contract accepts selected place shape", () => {
  const result = normalizeItineraryStop(
    {
      placeName: "大阪城",
      googlePlaceId: "ChIJosakaCastle001",
      lat: 34.6873,
      lng: 135.5262,
      address: "大阪市中央區",
      date: "2026-12-03",
      time: "09:30",
    },
    0,
  );
  assert.equal(result.ok, true);
});

test("replan soft-pass uses quality gate (timeline soft error)", () => {
  setItineraryValidatorEnabledOverride(true);
  const plans = buildPlansFromNames("大阪", ["大阪城", "道頓堀", "通天閣", "環球影城"], 4);
  // Force a soft timeline failure — quality gate should soft-pass (structure ok).
  const initial = validateItineraryPlan({
    plans,
    requestedDays: 4,
    plannedDate: "2026-12-03",
    endDate: "2026-12-06",
    destination: "大阪",
    userText: "",
  });
  const outcome = replanUntilItineraryValid(
    {
      plans,
      pool: [],
      days: 4,
      style: "mixed",
      plannedDate: "2026-12-03",
      validatorInput: {
        requestedDays: 4,
        plannedDate: "2026-12-03",
        endDate: "2026-12-06",
        destination: "大阪",
        userText: "",
      },
    },
    initial.pass
      ? {
          ...initial,
          pass: false,
          failedRules: [
            {
              code: "timeline_conflict",
              message: "time_conflict:day1:20:30:A+B",
              day: 1,
              severity: "fail",
            },
          ],
          replanReasons: ["replan_for_route_timeline"],
          path: "validator",
        }
      : initial,
  );
  assert.equal(outcome.plans.length, 4);
  assert.ok(outcome.plans.reduce((n, p) => n + p.entries.length, 0) >= 8);
  assert.equal(outcome.validation.pass, true);
});

test("quality gate rejects soft-pass when preferences violated", () => {
  setItineraryValidatorEnabledOverride(true);
  const plans = buildPlansFromNames("大阪", ["大阪城", "道頓堀", "通天閣", "環球影城"], 4);
  const excludedId = plans[0]?.entries[0]?.place?.id;
  assert.ok(excludedId, "expected place id");
  const initial = validateItineraryPlan({
    plans,
    requestedDays: 4,
    plannedDate: "2026-12-03",
    endDate: "2026-12-06",
    destination: "大阪",
    userText: "",
    excludePlaceIds: [excludedId],
  });
  assert.equal(initial.pass, false);
  assert.ok(initial.failedRules.some((r) => r.code === "user_exclusions"));
  const outcome = replanUntilItineraryValid(
    {
      plans,
      pool: [],
      days: 4,
      style: "mixed",
      plannedDate: "2026-12-03",
      validatorInput: {
        requestedDays: 4,
        plannedDate: "2026-12-03",
        endDate: "2026-12-06",
        destination: "大阪",
        userText: "",
        excludePlaceIds: [excludedId],
      },
    },
    initial,
  );
  // Preference violation must not soft-pass via stop count / soft-only.
  assert.equal(outcome.validation.pass, false);
  assert.equal(shouldBlockItineraryDelivery(outcome.validation), true);
});

test("blocked delivery telemetry keeps plan counts separate from affected days", () => {
  setItineraryValidatorEnabledOverride(true);
  const plans = Array.from({ length: 6 }, (_, dayIndex) => ({
    day: dayIndex + 1,
    entries: Array.from({ length: 2 }, (_, entryIndex) => {
      const p = place({
        id: `telemetry-${dayIndex}-${entryIndex}`,
        name: `Telemetry ${dayIndex < 3 ? "Park" : "Attraction"} ${dayIndex}-${entryIndex}`,
        primaryType: dayIndex < 3 ? "park" : "tourist_attraction",
        types: dayIndex < 3 ? ["park", "tourist_attraction"] : ["tourist_attraction"],
      });
      return entry(`${9 + entryIndex}:00`, "景點", p);
    }),
  }));
  const validation = validateItineraryPlan({
    plans,
    requestedDays: 6,
    plannedDate: "2026-12-03",
    endDate: "2026-12-08",
    destination: "大阪",
    userText: "",
  });
  assert.equal(validation.pass, false);

  const lines = [];
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const capture = (...args) => lines.push(args.join(" "));
  console.log = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;
  try {
    logItineraryDeliveryBlocked("validator_failed", validation, {
      plans,
      payloadPresent: true,
    });
  } finally {
    Object.assign(console, originalConsole);
  }
  const chain = lines.find((line) => line.includes("[ITINERARY_FAILURE_CHAIN]"));
  assert.ok(chain, "failure chain log");
  assert.match(chain, /"payloadPresent":true/);
  assert.match(chain, /"dayCount":6/);
  assert.match(chain, /"stopCount":12/);
  assert.match(chain, /"failedRuleCount":3/);
  assert.match(chain, /"affectedDays":\[1,2,3/);
});

console.log("\n=== City delivery cases ===");

test("Case 1: 大阪 4 天全部組合", () => {
  runCityCase("Case1", "大阪", 4, "1、2、3");
});

test("Case 2: 東京 5 天全部組合", () => {
  runCityCase("Case2", "東京", 5, "1、2、3、4");
});

test("Case 3: 名古屋 4 天", () => {
  // Nagoya may use dynamic themes — select first three or all available.
  const allowlist =
    buildCombinationSelectionAllowlist("名古屋", "1、2、3") ??
    buildCombinationSelectionAllowlist("名古屋", "全部");
  assert.ok(allowlist, "名古屋 allowlist");
  runCityCase("Case3", "名古屋", 4, allowlist.selectedCombinationIds.join("、"));
});

test("Case 4: 首爾 5 天", () => {
  runCityCase("Case4", "首爾", 5, "1、2、3、4");
});

test("Case 5: 曼谷 5 天", () => {
  runCityCase("Case5", "曼谷", 5, "1、2、3");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("\n[verify-itinerary-delivery-pipeline] ALL OK");
