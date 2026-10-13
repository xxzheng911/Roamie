/**
 * Daily schedule balance (P0-A consecutive meals / P0-B long stretch without a break).
 * Exercises the formal Selected Combination builder, Planner assembly, final route ordering,
 * Itinerary Validator and Replan with mocks only (no Google / AI / network).
 * Part A uses only pre-existing APIs and an independent oracle so it also runs on older code.
 */
import assert from "node:assert/strict";
import { buildMixedItineraryWithDiagnostics } from "../src/lib/trip/mixed-itinerary-schedule.ts";
import { applyPlannerRouteAndCapacityAssembly } from "../src/lib/ai/planner-day-route-assembly.ts";
import { applyFinalDayRouteOrdering } from "../src/lib/ai/final-day-route-ordering.ts";
import { validateItineraryPlan } from "../src/lib/ai/itinerary-validator/validate.ts";
import { replanUntilItineraryValid } from "../src/lib/ai/itinerary-validator/replan.ts";
import {
  applyComposedPlansToItineraryItems,
  composedPlansFromItineraryItems,
} from "../src/lib/ai/itinerary-validator/from-payload.ts";

let requests = 0;
globalThis.fetch = async () => {
  requests += 1;
  throw new Error("No network allowed");
};
const results = [];
const test = async (name, fn) => {
  try {
    await fn();
    results.push([name, "PASS"]);
  } catch (error) {
    results.push([name, `FAIL: ${String(error?.message ?? error).split("\n")[0].slice(0, 160)}`]);
  }
};

// ── Independent oracle (does not import the new contract) ──
const minutes = (t) => {
  const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const FOOD = new Set(["restaurant", "ramen_restaurant", "sushi_restaurant", "japanese_restaurant"]);
const isMealPlace = (p) => (p.types ?? [p.primaryType ?? p.type]).some((t) => FOOD.has(t));
const isBreakPlace = (p) => isMealPlace(p) || (p.types ?? [p.primaryType ?? p.type]).includes("cafe");
const inLunch = (m) => m >= 660 && m <= 870;
const inDinner = (m) => m >= 1020 && m <= 1260;
const sortDay = (entries) => [...entries].sort((a, b) => minutes(a.time) - minutes(b.time));
function consecutiveMealGaps(entries) {
  const sorted = sortDay(entries);
  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    if (isMealPlace(sorted[i - 1].place) && isMealPlace(sorted[i].place)) {
      gaps.push(minutes(sorted[i].time) - minutes(sorted[i - 1].time));
    }
  }
  return gaps;
}
function longestNoBreakStretch(entries) {
  let best = { stops: 0, span: 0 };
  let run = [];
  for (const e of sortDay(entries)) {
    if (isBreakPlace(e.place)) run = [];
    else {
      run.push(e);
      const span = minutes(run.at(-1).time) - minutes(run[0].time);
      if (run.length > best.stops) best = { stops: run.length, span };
    }
  }
  return best;
}

// ── Fixtures: two Tokyo areas → geography-first seeding reproduces P0-A + P0-B ──
const place = (id, name, type, lat, lng, extra = {}) => ({
  id,
  googlePlaceId: `ChIJdaily${id}`,
  name,
  address: "東京都",
  lat,
  lng,
  primaryType: type,
  types: [type],
  rating: 4.5,
  userRatingCount: 1200,
  businessStatus: "OPERATIONAL",
  openStatus: "unknown",
  ...extra,
});
const asakusa = (i) => [35.7148 + i * 0.0006, 139.7967 + i * 0.0005];
const shinjuku = (i) => [35.6938 + i * 0.0006, 139.7034 + i * 0.0005];
const areaA = [
  place("r1", "淺草拉麵", "restaurant", ...asakusa(0)),
  place("r2", "淺草壽司", "restaurant", ...asakusa(1)),
  place("r3", "淺草天丼", "restaurant", ...asakusa(2)),
  place("r4", "淺草燒肉", "restaurant", ...asakusa(3)),
  place("a1", "淺草寺", "tourist_attraction", ...asakusa(4)),
  place("a2", "隅田公園", "tourist_attraction", ...asakusa(5)),
];
const areaB = [
  place("b1", "新宿御苑", "tourist_attraction", ...shinjuku(0)),
  place("b2", "都廳展望台", "tourist_attraction", ...shinjuku(1)),
  place("b3", "思出橫丁", "tourist_attraction", ...shinjuku(2)),
  place("b4", "花園神社", "tourist_attraction", ...shinjuku(3)),
  place("b5", "歌舞伎町", "tourist_attraction", ...shinjuku(4)),
];
const toRec = (p) => ({
  name: p.name,
  placeName: p.name,
  type: p.primaryType,
  types: p.types,
  primaryType: p.primaryType,
  description: p.name,
  reason: "",
  estimatedTime: "1 小時",
  address: p.address,
  lat: p.lat,
  lng: p.lng,
  googleMapsUrl: "",
  reasonSource: "template",
  googlePlaceId: p.googlePlaceId,
  photoName: null,
  rating: p.rating,
  userRatingCount: p.userRatingCount,
  businessStatus: "OPERATIONAL",
  matchedSelectedCombinationIds: [1],
  sourceCombinationId: 1,
});
const START = "2026-11-02";
const recs = [...areaA, ...areaB].map(toRec);
const placeById = new Map([...areaA, ...areaB].map((p) => [p.googlePlaceId, p]));
const build = (text) =>
  buildMixedItineraryWithDiagnostics(recs, 2, START, "東京", {
    selectedCombinationIds: [1],
    pace: "medium",
    ...(text ? { scheduleIntentText: text } : {}),
  });
const daysOf = (stops) =>
  composedPlansFromItineraryItems(stops, 2, START).map((plan) => ({
    ...plan,
    entries: plan.entries.map((e) => ({ ...e, place: placeById.get(e.place.googlePlaceId ?? e.place.id) ?? e.place })),
  }));
const validatorBase = {
  requestedDays: 2,
  style: "mixed",
  destination: "東京",
  creationPath: "direct",
  lockedPlaceIds: [],
  lockedPlaceNames: [],
};
const scheduleFailures = (validation) =>
  validation.failedRules.filter((r) =>
    ["meal_window_mismatch", "consecutive_food_stops", "long_stretch_without_break"].includes(r.code),
  );

// ════════ Part A — formal paths, pre-existing APIs ════════
const built = build();
const plans = daysOf(built.stops);

await test("T1 no consecutive full meals closer than 3h (formal selected build)", () => {
  for (const plan of plans) {
    const tight = consecutiveMealGaps(plan.entries).filter((gap) => gap < 180);
    assert.deepEqual(tight, [], `day${plan.day} meal gaps ${consecutiveMealGaps(plan.entries)}`);
  }
});
await test("T2 full sightseeing day gets a meal/rest stop", () => {
  for (const plan of plans) {
    const stretch = longestNoBreakStretch(plan.entries);
    assert.ok(!(stretch.stops >= 4 && stretch.span >= 300), `day${plan.day} stretch ${JSON.stringify(stretch)}`);
  }
});
await test("T3 route reordering keeps the lunch anchor", () => {
  const far = place("x1", "遠方景點", "tourist_attraction", 35.75, 139.85);
  const lunch = place("x2", "午餐店", "restaurant", 35.68, 139.70);
  const near1 = place("x3", "近景點一", "tourist_attraction", 35.681, 139.701);
  const near2 = place("x4", "近景點二", "tourist_attraction", 35.682, 139.702);
  const out = applyPlannerRouteAndCapacityAssembly({
    plans: [{ day: 1, entries: [
      { time: "09:30", label: "景點", name: lunch.name, place: lunch },
      { time: "11:00", label: "景點", name: near1.name, place: near1 },
      { time: "12:30", label: "景點", name: near2.name, place: near2 },
      { time: "14:00", label: "景點", name: far.name, place: far },
    ] }],
    pool: [],
    days: 1,
    style: "mixed",
  });
  const meal = out.plans[0].entries.find((e) => e.place.id === "x2");
  assert.ok(meal && inLunch(minutes(meal.time)), `lunch at ${meal?.time}`);
  assert.equal(out.plans[0].entries.length, 4, "no stop dropped");
});
await test("T4 restaurants are labelled as meals, not stops", () => {
  for (const plan of plans) {
    for (const e of plan.entries.filter((x) => isMealPlace(x.place))) {
      assert.match(e.label, /早餐|午餐|晚餐/, `${e.name}@${e.time} label=${e.label}`);
    }
  }
});
await test("T5 meals are not concentrated on one day", () => {
  const mealCounts = plans.map((p) => p.entries.filter((e) => isMealPlace(e.place)).length);
  assert.ok(mealCounts.every((n) => n >= 1), `meals per day ${mealCounts}`);
});
await test("T6 capacity supplement cannot bypass the meal rules", () => {
  const seedA = place("c0", "起點景點", "tourist_attraction", 35.70, 139.77);
  const pool = [1, 2, 3, 4, 5].map((i) => place(`c${i}`, `補位餐廳${i}`, "restaurant", 35.70 + i * 0.0004, 139.77 + i * 0.0004));
  const out = applyPlannerRouteAndCapacityAssembly({
    plans: [{ day: 1, entries: [{ time: "09:30", label: "景點", name: seedA.name, place: seedA }] }],
    pool,
    days: 1,
    style: "mixed",
  });
  const tight = consecutiveMealGaps(out.plans[0].entries).filter((gap) => gap < 180);
  assert.deepEqual(tight, [], `entries ${out.plans[0].entries.map((e) => `${e.time} ${e.name}`)}`);
});
await test("T17 final route ordering keeps restaurants anchored", () => {
  const day = [
    { time: "09:30", label: "景點", name: "A", place: place("o1", "A", "tourist_attraction", 35.70, 139.70) },
    { time: "12:30", label: "景點", name: "R", place: place("o2", "R", "restaurant", 35.80, 139.80) },
    { time: "14:00", label: "景點", name: "B", place: place("o3", "B", "tourist_attraction", 35.701, 139.701) },
    { time: "15:30", label: "景點", name: "C", place: place("o4", "C", "tourist_attraction", 35.702, 139.702) },
  ];
  const [out] = applyFinalDayRouteOrdering([{ day: 1, entries: day }], { stage: "final_pre_persistence", logDiagnostics: false });
  const r = out.entries.find((e) => e.name === "R");
  assert.equal(r.time, "12:30", `restaurant moved to ${r.time}`);
});

// ════════ Part B — intent, validator, replan, lock, persistence ════════
const contract = await import("../src/lib/ai/daily-schedule-contract.ts").catch(() => null);
const needContract = () => assert.ok(contract, "daily schedule contract missing");
const e = (time, p, label = "景點") => ({ time, label, name: p.name, place: p });
const sights = (n, lat = 35.69) =>
  Array.from({ length: n }, (_, i) => place(`s${i}`, `景點${i}`, "tourist_attraction", lat + i * 0.001, 139.70));
const FULL_DAY = ["09:30", "11:00", "12:30", "14:00", "15:30"];

await test("T7 half day is not forced to add meals", () => {
  needContract();
  const half = sights(3).map((p, i) => e(["09:30", "11:00", "12:30"][i], p));
  assert.deepEqual(contract.evaluateDailySchedule(half), []);
  const v = validateItineraryPlan({ plans: [{ day: 1, entries: half }], ...validatorBase, requestedDays: 1 });
  assert.deepEqual(scheduleFailures(v), []);
});
await test("T8 food trip allows several meals inside meal windows", () => {
  needContract();
  const r = [1, 2, 3].map((i) => place(`f${i}`, `美食${i}`, "restaurant", 35.69, 139.70 + i * 0.001));
  const day = [e("11:00", r[0], "午餐"), e("12:30", r[1], "午餐"), e("14:00", sights(1)[0]), e("19:00", r[2], "晚餐")];
  const foodie = contract.resolveDailyScheduleIntent("這次是美食之旅，想吃遍東京");
  assert.equal(foodie.foodie, true);
  assert.deepEqual(contract.evaluateDailySchedule(day, foodie), []);
  assert.ok(contract.evaluateDailySchedule(day).some((v) => v.code === "consecutive_food_stops"), "neutral intent still flags it");
  const v = validateItineraryPlan({ plans: [{ day: 1, entries: day }], ...validatorBase, requestedDays: 1, userText: "美食之旅" });
  assert.deepEqual(scheduleFailures(v), []);
});
await test("T9 explicit no-meal request is respected", () => {
  needContract();
  const day = sights(5).map((p, i) => e(FULL_DAY[i], p));
  const intent = contract.resolveDailyScheduleIntent("行程不用安排餐廳，我們自己解決");
  assert.equal(intent.noMeals, true);
  assert.deepEqual(contract.evaluateDailySchedule(day, intent), []);
  const noMeal = build("不用安排餐廳");
  const before = plans.map((p) => p.entries.filter((x) => isMealPlace(x.place)).length);
  const after = daysOf(noMeal.stops).map((p) => p.entries.filter((x) => isMealPlace(x.place)).length);
  assert.ok(after.includes(0) || before.includes(0) === false, `no forced meal rebalance ${after}`);
});
await test("T10 temple / culture trail with lunch and dinner is not rejected", () => {
  needContract();
  const t = [0, 1, 2, 3].map((i) => place(`t${i}`, `寺${i}`, "place_of_worship", 35.71 + i * 0.001, 139.79));
  const r = [0, 1].map((i) => place(`tr${i}`, `餐${i}`, "restaurant", 35.712, 139.791 + i * 0.001));
  const day = [e("09:30", t[0]), e("11:00", t[1]), e("12:30", r[0], "午餐"), e("14:00", t[2]), e("15:30", t[3]), e("19:00", r[1], "晚餐")];
  assert.deepEqual(contract.evaluateDailySchedule(day), []);
  const v = validateItineraryPlan({ plans: [{ day: 1, entries: day }], ...validatorBase, requestedDays: 1 });
  assert.deepEqual(scheduleFailures(v), []);
});
await test("T11 hiking / nature day uses the outdoor allowance", () => {
  needContract();
  const n = [0, 1, 2, 3].map((i) => place(`n${i}`, `步道${i}`, "park", 35.62 + i * 0.002, 139.24));
  const day = n.map((p, i) => e(["08:30", "11:00", "13:30", "15:30"][i], p));
  assert.deepEqual(contract.evaluateDailySchedule(day, contract.resolveDailyScheduleIntent("高尾山登山")), []);
  assert.ok(contract.evaluateDailySchedule(day).length > 0, "a 7h city stretch without a break is still flagged");
});
await test("T12 a café is a rest stop but not a full meal", () => {
  needContract();
  const cafe = place("cf", "咖啡廳", "cafe", 35.69, 139.70);
  const rest = place("rs", "餐廳", "restaurant", 35.691, 139.701);
  assert.equal(contract.isFullMealVenue(cafe), false);
  assert.equal(contract.isRestBreakVenue(cafe), true);
  const day = [...sights(2).map((p, i) => e(FULL_DAY[i], p)), e("12:30", cafe, "咖啡"), e("13:30", rest, "午餐"), ...sights(2, 35.70).map((p, i) => e(["15:30", "17:00"][i], p))];
  assert.deepEqual(contract.evaluateDailySchedule(day).filter((v) => v.code !== "meal_window_mismatch"), []);
});
const p0Plans = () => [
  { day: 1, entries: areaA.slice(0, 4).map((p, i) => e(["14:00", "15:30", "17:00", "19:00"][i], p)).concat([e("09:30", areaA[4]), e("11:00", areaA[5])]) },
  { day: 2, entries: areaB.map((p, i) => e(FULL_DAY[i], p)) },
];
await test("T13 locked places survive the schedule repair", () => {
  const locked = ["r1", "r2", "b1", "b5"];
  const input = { ...validatorBase, lockedPlaceIds: locked, lockedPlaceNames: locked.map((id) => placeById.get(`ChIJdaily${id}`).name) };
  const initial = validateItineraryPlan({ plans: p0Plans(), ...input });
  const outcome = replanUntilItineraryValid({ plans: p0Plans(), pool: [...areaA, ...areaB], days: 2, style: "mixed", validatorInput: input }, initial);
  const ids = new Set(outcome.plans.flatMap((p) => p.entries.map((x) => x.place.id)));
  for (const id of locked) assert.ok(ids.has(id), `locked ${id} lost`);
  assert.equal(outcome.plans.reduce((n, p) => n + p.entries.length, 0), 11, "no stop dropped");
  for (const plan of outcome.plans) {
    assert.deepEqual(consecutiveMealGaps(plan.entries).filter((g) => g < 180), [], `day${plan.day} still stacks meals`);
  }
});
await test("T14 selected-only: no unselected place is mixed in", () => {
  const allowed = new Set(recs.map((r) => r.googlePlaceId));
  for (const stop of built.stops) assert.ok(allowed.has(stop.googlePlaceId), `unselected ${stop.placeName}`);
  // Pace capacity may leave selected places out (unchanged behaviour); it never adds any.
  assert.ok(built.stops.length <= recs.length);
  assert.equal(new Set(built.stops.map((s) => s.googlePlaceId)).size, built.stops.length, "no duplicates");
});
await test("T15 no meal venues anywhere: reported without blocking", () => {
  needContract();
  const v = validateItineraryPlan({ plans: [{ day: 1, entries: sights(5).map((p, i) => e(FULL_DAY[i], p)) }], ...validatorBase, requestedDays: 1 });
  assert.deepEqual(scheduleFailures(v), []);
  assert.ok(v.warnings.some((w) => w.code === "long_stretch_without_break"), "surfaced as a warning");
});
await test("T16 dates and day indices stay consistent", () => {
  const dates = [...new Set(built.stops.map((s) => s.date))].sort();
  assert.deepEqual(dates, ["2026-11-02", "2026-11-03"]);
  const v = validateItineraryPlan({ plans, ...validatorBase });
  assert.ok(!v.failedRules.some((r) => r.code === "days_date_consistency" || r.code === "missing_days"));
});
await test("T18 validator flags P0, replan repairs and does not re-break the day", () => {
  const initial = validateItineraryPlan({ plans: p0Plans(), ...validatorBase });
  const outcome = replanUntilItineraryValid({ plans: p0Plans(), pool: [...areaA, ...areaB], days: 2, style: "mixed", validatorInput: validatorBase }, initial);
  for (const plan of outcome.plans) {
    assert.deepEqual(consecutiveMealGaps(plan.entries).filter((g) => g < 180), [], `day${plan.day} meal gaps ${consecutiveMealGaps(plan.entries)}`);
    const stretch = longestNoBreakStretch(plan.entries);
    assert.ok(!(stretch.stops >= 4 && stretch.span >= 300), `day${plan.day} stretch ${JSON.stringify(stretch)}`);
  }
  assert.ok(scheduleFailures(initial).length > 0, "P0 input must be flagged by the validator");
  const final = validateItineraryPlan({ plans: outcome.plans, ...validatorBase });
  assert.deepEqual(scheduleFailures(final).map((r) => `${r.code}:${r.message}`), []);
});
await test("T19 save → restore keeps the order", () => {
  const roundTrip = composedPlansFromItineraryItems(applyComposedPlansToItineraryItems(built.stops, plans, START), 2, START);
  const sig = (ps) => ps.map((p) => p.entries.map((x) => `${x.time}|${x.place.googlePlaceId ?? x.place.id}`).join(",")).join(";");
  assert.equal(sig(roundTrip), sig(daysOf(built.stops)));
});
await test("T20 intent detection works in four languages", () => {
  needContract();
  const r = contract.resolveDailyScheduleIntent;
  for (const text of ["美食之旅", "food tour in Tokyo", "大阪で食べ歩き", "도쿄 맛집 투어"]) assert.equal(r(text).foodie, true, text);
  for (const text of ["不用安排餐廳", "no meals please", "食事なしで", "식사 제외"]) assert.equal(r(text).noMeals, true, text);
  for (const text of ["一般城市旅行", "city walk", "東京観光", "서울 여행"]) {
    assert.deepEqual(r(text), { foodie: false, noMeals: false, outdoor: false }, text);
  }
});

// ════════ Boundary hotfix — formal assembly / validator / replan ════════
const R = (id, lng, extra) => place(id, `餐${id}`, "restaurant", 35.69, lng, extra);
const S = (id, lng) => place(id, `景${id}`, "tourist_attraction", 35.691, lng);
const assemble = (entries) =>
  applyPlannerRouteAndCapacityAssembly({ plans: [{ day: 1, entries }], pool: [], days: 1, style: "mixed" }).plans[0].entries;
await test("B1 afternoon start: no breakfast, nothing before departure", () => {
  const out = assemble([e("14:00", R("p1", 139.701)), e("15:30", S("q1", 139.702)), e("17:00", R("p2", 139.703)), e("19:00", R("p3", 139.704))]);
  assert.equal(out.length, 4);
  assert.ok(out.every((x) => minutes(x.time) >= 14 * 60), out.map((x) => x.time).join(","));
  assert.ok(!out.some((x) => /早餐/.test(x.label)), "no breakfast for an afternoon start");
  assert.ok(out.every((x) => minutes(x.time) <= 19 * 60), "trip not extended");
});
await test("B2 no meal before the day's first valid time", () => {
  const out = assemble([e("15:30", R("p4", 139.705)), e("17:00", R("p5", 139.706))]);
  assert.ok(out.every((x) => minutes(x.time) >= 15 * 60 + 30), out.map((x) => x.time).join(","));
});
const dinnerOnlyHours = {
  regularOpeningHours: {
    periods: Array.from({ length: 7 }, (_, day) => ({ open: { day, hour: 17, minute: 0 }, close: { day, hour: 22, minute: 0 } })),
    weekdayDescriptions: [],
  },
};
await test("B3 a dinner-only restaurant is not moved into its closed hours", () => {
  const kept = assemble([e("11:00", S("q2", 139.707)), e("12:30", S("q3", 139.708)), e("19:00", R("d1", 139.709, dinnerOnlyHours), "晚餐")]);
  assert.equal(kept.find((x) => x.place.id === "d1").time, "19:00", "dinner stays dinner");
  const moved = assemble([e("09:30", S("q4", 139.71)), e("11:00", R("d2", 139.711, dinnerOnlyHours)), e("12:30", S("q5", 139.712)), e("17:00", S("q6", 139.713)), e("19:00", R("d3", 139.714))]);
  const d2 = moved.find((x) => x.place.id === "d2");
  assert.ok(minutes(d2.time) >= 17 * 60, `dinner-only venue placed at ${d2.time}`);
});
await test("B6 locked keeps its day; a 預約 / 予約 / 예약 / reservation title never fixes a clock", () => {
  const input = { ...validatorBase, lockedPlaceIds: ["r1", "r2"], lockedPlaceNames: ["淺草拉麵", "淺草壽司"] };
  const outcome = replanUntilItineraryValid({ plans: p0Plans(), pool: [...areaA, ...areaB], days: 2, style: "mixed", validatorInput: input }, validateItineraryPlan({ plans: p0Plans(), ...input }));
  const where = new Map(outcome.plans.flatMap((p) => p.entries.map((x) => [x.place.id, `${p.day}@${x.time}`])));
  for (const id of ["r1", "r2"]) assert.ok(where.get(id)?.startsWith("1@"), `locked ${id} stays on day 1`);
  assert.equal(where.size, 11, "no stop lost");
  for (const label of ["晚餐 預約", "予約制", "예약", "Reservation", "booking"]) {
    const out = assemble([e("09:30", S(`k${label.length}`, 139.73)), e("15:30", R(`kr${label.length}`, 139.731), label), e("17:00", S(`k2${label.length}`, 139.732))]);
    const meal = out.find((x) => x.place.id === `kr${label.length}`);
    assert.notEqual(meal.time, "15:30", `"${label}" must not pin a restaurant at 15:30`);
  }
});
await test("B9 replan never ends with a more severe schedule", () => {
  needContract();
  const one = () => [{ day: 1, entries: areaA.slice(0, 4).map((p, i) => e(["12:30", "14:00", "17:00", "19:00"][i], p)) }];
  const input = { ...validatorBase, requestedDays: 1 };
  const outcome = replanUntilItineraryValid({ plans: one(), pool: areaA.slice(0, 4), days: 1, style: "mixed", validatorInput: input }, validateItineraryPlan({ plans: one(), ...input }));
  assert.ok(contract.dailyScheduleSeverity(outcome.plans) <= contract.dailyScheduleSeverity(one()), "severity not worse");
  assert.equal(outcome.plans[0].entries.length, 4);
  assert.ok(outcome.attempts <= 3);
});
const denseDay = (extra = []) => [...sights(5).map((p, i) => e(FULL_DAY[i], p)), ...extra];
await test("B4 dense full day is detected", () => {
  needContract();
  assert.ok(contract.evaluateDailySchedule(denseDay()).some((v) => v.code === "long_stretch_without_break"));
});
await test("B4 with a candidate the replan repairs it safely", () => {
  const meals = [R("m1", 139.72), R("m2", 139.721)];
  const day = () => [{ day: 1, entries: denseDay([e("17:00", meals[0]), e("19:00", meals[1])]) }];
  const input = { ...validatorBase, requestedDays: 1 };
  const v = validateItineraryPlan({ plans: day(), ...input });
  assert.ok(v.failedRules.some((r) => r.code === "long_stretch_without_break"), "repairable → fail");
  const outcome = replanUntilItineraryValid({ plans: day(), pool: [], days: 1, style: "mixed", validatorInput: input }, v);
  const stretch = longestNoBreakStretch(outcome.plans[0].entries);
  assert.ok(!(stretch.stops >= 4 && stretch.span >= 300), JSON.stringify(stretch));
  assert.equal(outcome.plans[0].entries.length, 7);
});
await test("B4 without a candidate: stops kept + warning, no replan loop", () => {
  const input = { ...validatorBase, requestedDays: 1 };
  const v = validateItineraryPlan({ plans: [{ day: 1, entries: denseDay() }], ...input });
  assert.ok(!v.failedRules.some((r) => r.code === "long_stretch_without_break"));
  assert.ok(v.warnings.some((w) => w.code === "long_stretch_without_break"));
  const outcome = replanUntilItineraryValid({ plans: [{ day: 1, entries: denseDay() }], pool: [], days: 1, style: "mixed", validatorInput: input }, v);
  assert.equal(outcome.plans[0].entries.length, 5);
  assert.ok(outcome.attempts <= 3);
});
await test("B4 explicit no-meal intent is respected", () => {
  const v = validateItineraryPlan({ plans: [{ day: 1, entries: denseDay() }], ...validatorBase, requestedDays: 1, userText: "不用安排餐廳" });
  assert.ok(![...v.failedRules, ...v.warnings].some((r) => r.code === "long_stretch_without_break"));
});

await test("Provider calls stay at zero", () => assert.equal(requests, 0));

let failed = 0;
for (const [name, status] of results) {
  if (status !== "PASS") failed += 1;
  console.log(`${status === "PASS" ? "PASS" : "FAIL"} ${name}${status === "PASS" ? "" : ` — ${status.slice(6)}`}`);
}
console.log(`verify-daily-schedule-balance: ${results.length - failed}/${results.length} PASS`);
if (failed) process.exit(1);
