#!/usr/bin/env node
/**
 * Planner Integration P4.2 — Itinerary Validator 正式啟用驗收（Case A–J）
 *
 * 執行：npm run verify:itinerary-validator-p4-2
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isItineraryValidatorEnabled,
  setItineraryValidatorEnabledOverride,
  validateItineraryPlan,
  compareItineraryPersistenceDayCounts,
  shouldBlockItineraryDelivery,
  dayCountsOfPlans,
  ITINERARY_VALIDATOR_VERSION,
  MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS,
} from "../src/lib/ai/itinerary-validator/index.ts";
import { replanUntilItineraryValid, evaluateMinimumAcceptableQuality } from "../src/lib/ai/itinerary-validator/replan.ts";
import { isRecEngineValidatorEnabled } from "../src/lib/recommendation/engine/index.ts";
import { isPiePlannerSearchEnabled } from "../src/lib/pie/feature-flag-planner-search.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function place(partial) {
  return {
    address: "東京都某某區1-1",
    photoName: "photos/x",
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: true,
    userRatingCount: 80,
    rating: 4.5,
    lat: 35.68,
    lng: 139.76,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    ...partial,
  };
}

function entry(time, label, p) {
  return { time, label, name: p.name, place: p };
}

function fullDay(day, baseLat = 35.68, baseLng = 139.76, prefix = "") {
  const tag = prefix || `d${day}`;
  return {
    day,
    entries: [
      entry("08:00", "早餐", place({
        id: `b-${tag}`,
        name: `Breakfast ${tag}`,
        lat: baseLat,
        lng: baseLng,
        primaryType: "cafe",
        types: ["cafe", "restaurant"],
      })),
      entry("09:30", "景點", place({
        id: `a1-${tag}`,
        name: `Attraction A ${tag}`,
        lat: baseLat + 0.002,
        lng: baseLng + 0.001,
      })),
      entry("12:30", "午餐", place({
        id: `l-${tag}`,
        name: `Lunch ${tag}`,
        lat: baseLat + 0.004,
        lng: baseLng + 0.002,
        primaryType: "restaurant",
        types: ["restaurant"],
      })),
      entry("15:00", "景點", place({
        id: `a2-${tag}`,
        name: `Attraction B ${tag}`,
        lat: baseLat + 0.005,
        lng: baseLng + 0.002,
      })),
      entry("18:30", "晚餐", place({
        id: `d-${tag}`,
        name: `Dinner ${tag}`,
        lat: baseLat + 0.006,
        lng: baseLng + 0.003,
        primaryType: "restaurant",
        types: ["restaurant"],
      })),
    ],
  };
}

/** 橫濱日：2～4 個橫濱地點 */
function yokohamaDay(day) {
  return {
    day,
    entries: [
      entry("09:30", "景點", place({
        id: `yk-a1-${day}`,
        name: "橫濱赤磚倉庫",
        address: "神奈川県横浜市中区",
        lat: 35.451,
        lng: 139.643,
        destinationScope: "nearby_extension",
        extensionDestination: "橫濱",
      })),
      entry("12:30", "午餐", place({
        id: `yk-l-${day}`,
        name: "橫濱中華街午餐",
        address: "横浜市中華街",
        lat: 35.442,
        lng: 139.646,
        primaryType: "restaurant",
        types: ["restaurant"],
        destinationScope: "nearby_extension",
        extensionDestination: "橫濱",
      })),
      entry("15:00", "景點", place({
        id: `yk-a2-${day}`,
        name: "橫濱港未來",
        address: "横浜市西区",
        lat: 35.455,
        lng: 139.632,
        destinationScope: "nearby_extension",
        extensionDestination: "橫濱",
      })),
      entry("18:30", "晚餐", place({
        id: `yk-d-${day}`,
        name: "橫濱晚餐餐廳",
        address: "横浜市",
        lat: 35.448,
        lng: 139.64,
        primaryType: "restaurant",
        types: ["restaurant"],
        destinationScope: "nearby_extension",
        extensionDestination: "橫濱",
      })),
    ],
  };
}

console.info("[verify:itinerary-validator-p4-2] Itinerary Validator P4.2 Case A–J\n");

test("default itinerary-validator flag is OFF (without override / env may differ)", () => {
  setItineraryValidatorEnabledOverride(null);
  // env may enable; only assert override works
  setItineraryValidatorEnabledOverride(false);
  assert.equal(isItineraryValidatorEnabled(), false);
});

test("Recommendation Validator / PIE Search independent", () => {
  setItineraryValidatorEnabledOverride(false);
  assert.equal(isItineraryValidatorEnabled(), false);
  assert.equal(typeof isRecEngineValidatorEnabled(), "boolean");
  assert.equal(isPiePlannerSearchEnabled(), false);
});

test("MAX Auto Repair attempts is 3", () => {
  assert.equal(MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS, 3);
});

// ——— Case H：Flag OFF ———
test("Case H: Flag OFF pass-through; no structured rules", () => {
  setItineraryValidatorEnabledOverride(false);
  const plans = [fullDay(1)];
  const before = JSON.stringify(plans);
  const result = validateItineraryPlan({ plans, requestedDays: 1 });
  assert.equal(result.path, "pass_through");
  assert.equal(result.pass, true);
  assert.equal(result.failedRules.length, 0);
  assert.equal(shouldBlockItineraryDelivery(result), false);
  assert.equal(JSON.stringify(plans), before);
});

// ——— Case A：東京 6 天＋橫濱 ———
test("Case A: Tokyo 6d + Yokohama concentrated day passes", () => {
  setItineraryValidatorEnabledOverride(true);
  const plans = [
    fullDay(1, 35.68, 139.76, "t1"),
    fullDay(2, 35.66, 139.7, "t2"),
    fullDay(3, 35.71, 139.8, "t3"),
    fullDay(4, 35.69, 139.75, "t4"),
    fullDay(5, 35.67, 139.73, "t5"),
    yokohamaDay(6),
  ];
  const result = validateItineraryPlan({
    plans,
    requestedDays: 6,
    destination: "東京",
    nearbyExtensions: ["橫濱"],
    creationPath: "style",
  });
  assert.equal(result.path, "validator");
  assert.equal(result.pass, true, JSON.stringify(result.failedRules));
  assert.ok(result.nearbyCoverage);
  assert.deepEqual(result.nearbyCoverage.expectedExtensions, ["橫濱"]);
  assert.ok(result.nearbyCoverage.coveredExtensions.includes("橫濱"));
  assert.equal(result.nearbyCoverage.missingExtensions.length, 0);
  const counts = dayCountsOfPlans(plans);
  assert.equal(counts.length, 6);
  assert.ok(counts.every((c) => c >= 2));
  assert.equal(shouldBlockItineraryDelivery(result), false);
});

// ——— Case B：東京 3 天 ———
test("Case B: Tokyo 3d balanced plan passes", () => {
  setItineraryValidatorEnabledOverride(true);
  const plans = [
    fullDay(1, 35.68, 139.76, "b1"),
    fullDay(2, 35.66, 139.7, "b2"),
    fullDay(3, 35.71, 139.8, "b3"),
  ];
  const result = validateItineraryPlan({
    plans,
    requestedDays: 3,
    destination: "東京",
    creationPath: "style",
  });
  assert.equal(result.pass, true, JSON.stringify(result.failedRules));
  assert.ok(!result.failedRules.some((r) => r.code === "place_duplicate"));
});

// ——— Case C：排除火鍋／義式 ———
test("Case C: user exclusions hotpot/italian fail when present", () => {
  setItineraryValidatorEnabledOverride(true);
  const day = fullDay(1, 35.68, 139.76, "ex");
  day.entries[2] = entry("12:30", "午餐", place({
    id: "hotpot-1",
    name: "麻辣火鍋專賣",
    lat: 35.681,
    lng: 139.761,
    primaryType: "restaurant",
    types: ["restaurant"],
  }));
  day.entries[4] = entry("18:30", "晚餐", place({
    id: "italian-1",
    name: "義式披薩屋",
    lat: 35.682,
    lng: 139.762,
    primaryType: "restaurant",
    types: ["restaurant", "italian_restaurant"],
  }));
  const result = validateItineraryPlan({
    plans: [day],
    requestedDays: 1,
    userText: "不要火鍋、不要義式",
  });
  assert.equal(result.pass, false);
  assert.ok(result.failedRules.some((r) => r.code === "user_exclusions"));
});

test("Case C+: exclusions absent → user_exclusions not failed", () => {
  setItineraryValidatorEnabledOverride(true);
  const result = validateItineraryPlan({
    plans: [fullDay(1, 35.68, 139.76, "ok")],
    requestedDays: 1,
    userText: "不要火鍋、不要義式",
  });
  assert.ok(!result.failedRules.some((r) => r.code === "user_exclusions"));
});

// ——— Case D：近郊缺失 ———
test("Case D: nearbyExtensions missing → fail + block delivery", () => {
  setItineraryValidatorEnabledOverride(true);
  const plans = [
    fullDay(1, 35.68, 139.76, "nd1"),
    fullDay(2, 35.66, 139.7, "nd2"),
    fullDay(3, 35.71, 139.8, "nd3"),
  ];
  const result = validateItineraryPlan({
    plans,
    requestedDays: 3,
    nearbyExtensions: ["橫濱"],
    destination: "東京",
  });
  assert.equal(result.pass, false);
  assert.ok(result.failedRules.some((r) => r.code === "nearby_extension_coverage"));
  assert.deepEqual(result.nearbyCoverage?.missingExtensions, ["橫濱"]);
  assert.equal(shouldBlockItineraryDelivery(result), true);
});

// ——— Case E：晴空塔家族重複 ———
test("Case E: Skytree canonical family duplicates fail", () => {
  setItineraryValidatorEnabledOverride(true);
  const day1 = fullDay(1, 35.71, 139.81, "sk1");
  const day2 = fullDay(2, 35.71, 139.81, "sk2");
  day1.entries[1] = entry("09:30", "景點", place({
    id: "skytree-tower",
    name: "東京晴空塔",
    lat: 35.7101,
    lng: 139.8107,
  }));
  day2.entries[1] = entry("09:30", "景點", place({
    id: "skytree-town",
    name: "東京晴空塔城",
    lat: 35.7102,
    lng: 139.8108,
  }));
  day2.entries[3] = entry("15:00", "景點", place({
    id: "tokyo-skytree-en",
    name: "Tokyo Skytree",
    lat: 35.71005,
    lng: 139.81075,
  }));
  const result = validateItineraryPlan({
    plans: [day1, day2],
    requestedDays: 2,
  });
  assert.equal(result.pass, false);
  assert.ok(result.failedRules.some((r) => r.code === "place_duplicate"));
});

// ——— Case F：單點日 ———
test("Case F: single-place day fails day_place_count", () => {
  setItineraryValidatorEnabledOverride(true);
  const plans = [
    fullDay(1, 35.68, 139.76, "f1"),
    fullDay(2, 35.66, 139.7, "f2"),
    fullDay(3, 35.71, 139.8, "f3"),
    {
      day: 4,
      entries: [
        entry("10:00", "景點", place({
          id: "lonely",
          name: "Lonely Spot",
          lat: 35.7,
          lng: 139.77,
        })),
      ],
    },
    fullDay(5, 35.69, 139.75, "f5"),
    fullDay(6, 35.67, 139.73, "f6"),
  ];
  const result = validateItineraryPlan({ plans, requestedDays: 6 });
  assert.equal(result.pass, false);
  const fail = result.failedRules.find((r) => r.code === "day_place_count");
  assert.ok(fail);
  assert.equal(fail.day, 4);
  assert.ok(result.affectedDays.includes(4));
  assert.equal(shouldBlockItineraryDelivery(result), true);
});

// ——— Case G：錯誤餐期 ———
test("Case G: lunch=park / breakfast=bar fail meal + nightlife", () => {
  setItineraryValidatorEnabledOverride(true);
  const day = fullDay(1, 35.68, 139.76, "meal");
  day.entries[0] = entry("08:00", "早餐", place({
    id: "bar-bf",
    name: "Morning Bar",
    lat: 35.681,
    lng: 139.76,
    primaryType: "bar",
    types: ["bar"],
  }));
  day.entries[2] = entry("12:30", "午餐", place({
    id: "park-lunch",
    name: "上野公園",
    lat: 35.714,
    lng: 139.774,
    primaryType: "park",
    types: ["park"],
  }));
  const result = validateItineraryPlan({ plans: [day], requestedDays: 1 });
  assert.equal(result.pass, false);
  const codes = new Set(result.failedRules.map((r) => r.code));
  assert.ok(codes.has("meal_slot_category"));
  assert.ok(codes.has("nightlife_timing"));
  // Soft meal/nightlife still block until Auto Repair quality soft-pass.
  assert.equal(shouldBlockItineraryDelivery(result), true);
});

test("Soft timeline_conflict blocks until Auto Repair soft-pass", () => {
  setItineraryValidatorEnabledOverride(true);
  const day = fullDay(1, 24.14, 120.67, "tc");
  day.entries[1] = entry("20:30", "景點", place({
    id: "museum-night",
    name: "臺中文學館",
    lat: 24.141,
    lng: 120.671,
    primaryType: "museum",
    types: ["museum"],
  }));
  day.entries.push(entry("20:30", "景點", place({
    id: "trail-night",
    name: "柳川古道",
    lat: 24.142,
    lng: 120.672,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
  })));
  const result = validateItineraryPlan({
    plans: [day],
    requestedDays: 1,
    destination: "台中",
    creationPath: "selected_places",
  });
  assert.equal(result.pass, false);
  assert.ok(result.failedRules.some((r) => r.code === "timeline_conflict"));
  assert.equal(shouldBlockItineraryDelivery(result), true);
});

test("Auto Repair soft-passes via quality gate (not stop ratio)", () => {
  setItineraryValidatorEnabledOverride(true);
  const day = fullDay(1, 24.14, 120.67, "ar");
  day.entries[1] = entry("20:30", "景點", place({
    id: "museum-ar",
    name: "臺中文學館",
    lat: 24.141,
    lng: 120.671,
    primaryType: "museum",
    types: ["museum"],
  }));
  day.entries.push(entry("20:30", "景點", place({
    id: "trail-ar",
    name: "柳川古道",
    lat: 24.142,
    lng: 120.672,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
  })));
  const plans = [day];
  const initial = validateItineraryPlan({
    plans,
    requestedDays: 1,
    destination: "台中",
    plannedDate: "2026-08-05",
  });
  assert.equal(initial.pass, false);
  const outcome = replanUntilItineraryValid(
    {
      plans,
      pool: plans.flatMap((p) => p.entries.map((e) => e.place)),
      days: 1,
      style: "mixed",
      plannedDate: "2026-08-05",
      validatorInput: {
        requestedDays: 1,
        destination: "台中",
        plannedDate: "2026-08-05",
      },
    },
    initial,
  );
  assert.equal(outcome.validation.pass, true);
  assert.ok(outcome.attempts <= 3);
  assert.equal(shouldBlockItineraryDelivery(outcome.validation), false);
});

test("quality gate rejects soft-pass on sparse day (not stop ratio)", () => {
  setItineraryValidatorEnabledOverride(true);
  const sparse = {
    day: 1,
    entries: [
      entry("10:00", "景點", place({
        id: "only-one",
        name: "Lonely Spot",
        lat: 24.14,
        lng: 120.67,
      })),
    ],
  };
  const validation = validateItineraryPlan({
    plans: [sparse],
    requestedDays: 1,
    destination: "台中",
  });
  const quality = evaluateMinimumAcceptableQuality([sparse], validation, { days: 1 });
  assert.equal(quality.dayStructureOk, false);
  assert.equal(quality.ok, false);
});

// ——— Case I：Direct create wiring ———
test("Case I: direct / selected_places paths wire validator", () => {
  const itineraryFn = read("src/lib/itinerary.functions.ts");
  const stateMachine = read("src/lib/ai/ai-itinerary-state-machine.ts");
  const stylePlan = read("src/lib/ai/destination-trip-planning.ts");
  const rec = read("src/lib/ai/destination-place-recommendation.ts");
  assert.match(itineraryFn, /validateItineraryPlan/);
  assert.match(itineraryFn, /itinerary_validator_failed|ITINERARY_VALIDATOR_BLOCKED/);
  assert.match(stateMachine, /validateItineraryPlan/);
  assert.match(stateMachine, /replanUntilItineraryValid/);
  assert.match(stylePlan, /replanUntilItineraryValid/);
  assert.match(stylePlan, /shouldBlockItineraryDelivery|logItineraryDeliveryBlocked/);
  assert.match(rec, /itinerary_validator_failed/);
});

// ——— Case J：Persistence mismatch ———
test("Case J: persistence dayCounts mismatch → matched=false", () => {
  const compare = compareItineraryPersistenceDayCounts({
    plannerDayCounts: [3, 3, 3, 3, 3, 3],
    validatedDayCounts: [3, 3, 3, 3, 3, 3],
    persistedDayCounts: [3, 3, 3, 1, 0, 0],
    uiDayCounts: [3, 3, 3, 1, 0, 0],
  });
  assert.equal(compare.matched, false);
});

test("Case J+: matched persistence allows delivery compare", () => {
  const compare = compareItineraryPersistenceDayCounts({
    plannerDayCounts: [3, 3, 3],
    validatedDayCounts: [3, 3, 3],
    persistedDayCounts: [3, 3, 3],
    uiDayCounts: [3, 3, 3],
  });
  assert.equal(compare.matched, true);
});

test("Flag ON: missing days / only first day fail", () => {
  setItineraryValidatorEnabledOverride(true);
  const result = validateItineraryPlan({
    plans: [fullDay(1)],
    requestedDays: 3,
  });
  assert.equal(result.pass, false);
  assert.ok(result.failedRules.some((r) => r.code === "missing_days"));
});

test("Flag ON: validator does not mutate plans", () => {
  setItineraryValidatorEnabledOverride(true);
  const plans = [fullDay(1)];
  const before = JSON.stringify(plans);
  validateItineraryPlan({ plans, requestedDays: 2 });
  assert.equal(JSON.stringify(plans), before);
});

test("Chat / Explore / Home do not call validateItineraryPlan directly", () => {
  assert.doesNotMatch(read("src/routes/_app.chat.tsx"), /validateItineraryPlan/);
  assert.doesNotMatch(read("src/routes/_app.map.tsx"), /validateItineraryPlan/);
  assert.doesNotMatch(read("src/routes/_app.index.tsx"), /validateItineraryPlan/);
});

test("validator version present", () => {
  assert.ok(
    ITINERARY_VALIDATOR_VERSION.includes("auto-repair") ||
      ITINERARY_VALIDATOR_VERSION.includes("p4.2"),
  );
});

setItineraryValidatorEnabledOverride(null);
console.info("\n[verify:itinerary-validator-p4-2] Case A–J passed — stop for device QA (no PIE Search / next phase).\n");
