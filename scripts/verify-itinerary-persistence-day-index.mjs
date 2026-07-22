#!/usr/bin/env node
/**
 * Persistence day-index / style-template crash guards
 *
 * Reproduces: undefined is not an object (evaluating '...[plan.day-1]')
 * when style is a Chinese label (緊湊 / 慢旅行) and code did
 * STYLE_DAY_SLOT_TEMPLATES[style][plan.day-1].
 *
 * 執行：node scripts/verify-itinerary-persistence-day-index.mjs
 */
import assert from "node:assert/strict";
import {
  resolvePlannerStyleKey,
  resolveStyleDaySlotTemplate,
  buildItineraryFromDayPlan,
  buildItineraryDaysFromDayPlan,
  clampTripDayNumber,
  ensurePersistenceDayMap,
  persistenceDaysFromMap,
} from "../src/lib/ai/ai-day-plan-source.ts";
import { fillSparseDaysWithControlledRepeats } from "../src/lib/ai/ai-multi-day-planner.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

console.log("verify-itinerary-persistence-day-index");

test("resolvePlannerStyleKey maps Chinese labels (no throw)", () => {
  assert.equal(resolvePlannerStyleKey("慢旅行"), "slow_nature");
  assert.equal(resolvePlannerStyleKey("緊湊"), "mixed");
  assert.equal(resolvePlannerStyleKey("classic_landmarks"), "classic_landmarks");
  assert.equal(resolvePlannerStyleKey(undefined), "mixed");
});

test("resolveStyleDaySlotTemplate never throws on illegal style + day", () => {
  for (const style of ["緊湊", "慢旅行", "unknown", "", null, "mixed"]) {
    for (const day of [1, 2, 3, 4, 5, 0, 6, -1]) {
      const template = resolveStyleDaySlotTemplate(style, day);
      assert.ok(Array.isArray(template) && template.length > 0, `style=${style} day=${day}`);
    }
  }
});

test("fillSparseDaysWithControlledRepeats tolerates Chinese style (crash repro)", () => {
  const place = (id, name) => ({
    id,
    name,
    address: "서울",
    lat: 37.57,
    lng: 126.98,
    rating: 4.5,
    userRatingCount: 100,
    photoName: null,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: true,
  });
  const plans = [
    { day: 1, entries: [{ time: "10:00", label: "景點", name: "A", place: place("a", "A") }] },
    { day: 2, entries: [] },
    { day: 3, entries: [{ time: "10:00", label: "景點", name: "B", place: place("b", "B") }] },
    { day: 4, entries: [] },
    { day: 5, entries: [{ time: "10:00", label: "景點", name: "C", place: place("c", "C") }] },
  ];
  const pool = [
    place("a", "A"),
    place("b", "B"),
    place("c", "C"),
    place("d", "D"),
    place("e", "E"),
    place("f", "F"),
    place("g", "G"),
    place("h", "H"),
  ];
  // Pre-fix: STYLE_DAY_SLOT_TEMPLATES["緊湊"][plan.day-1] threw here.
  const out = fillSparseDaysWithControlledRepeats({
    plans,
    pool,
    days: 5,
    style: /** @type {any} */ ("緊湊"),
    plannedDate: "2027-02-15",
  });
  assert.equal(out.length, 5);
  assert.deepEqual(
    out.map((p) => p.day),
    [1, 2, 3, 4, 5],
  );
});

test("Persistence day Map: out-of-range days clamp, missing days created empty", () => {
  const items = [
    {
      date: "2027-02-15",
      time: "10:00",
      title: "X",
      placeName: "X",
      description: "X",
      dayIndex: -1,
    },
    {
      date: "2027-02-19",
      time: "11:00",
      title: "Y",
      placeName: "Y",
      description: "Y",
      dayIndex: 9,
    },
  ];
  const byDay = ensurePersistenceDayMap(
    5,
    items.map((item) => ({
      day: clampTripDayNumber((item.dayIndex ?? 0) + 1, 5),
      items: [item],
    })),
    ["2027-02-15", "2027-02-16", "2027-02-17", "2027-02-18", "2027-02-19"],
  );
  const days = persistenceDaysFromMap(byDay);
  assert.equal(days.length, 5);
  assert.deepEqual(
    days.map((d) => d.dayIndex),
    [1, 2, 3, 4, 5],
  );
  assert.ok(days.every((d) => d != null));
});

test("buildItineraryDaysFromDayPlan uses Map and keeps Day1..N", () => {
  const plan = {
    planningSessionId: "s1",
    destination: "首爾",
    days: 5,
    items: [
      {
        dayIndex: 1,
        orderIndex: 0,
        time: "10:00",
        slotType: "attraction",
        placeId: "p1",
        name: "景福宮",
        address: "서울",
        lat: 37.57,
        lng: 126.97,
        type: "tourist_attraction",
      },
      {
        dayIndex: 6,
        orderIndex: 0,
        time: "11:00",
        slotType: "attraction",
        placeId: "p2",
        name: "南山",
        address: "서울",
        lat: 37.55,
        lng: 126.98,
        type: "tourist_attraction",
      },
    ],
  };
  const dates = {
    startDate: "2027-02-15",
    endDate: "2027-02-19",
    hasExplicitDates: true,
    dayDates: ["2027-02-15", "2027-02-16", "2027-02-17", "2027-02-18", "2027-02-19"],
  };
  const itineraryItems = buildItineraryFromDayPlan(plan, dates);
  const days = buildItineraryDaysFromDayPlan(plan, dates, itineraryItems);
  assert.equal(days.length, 5);
  assert.deepEqual(
    days.map((d) => d.dayIndex),
    [1, 2, 3, 4, 5],
  );
  // Day6 item clamped into Day5 — never creates Day6 or crashes.
  assert.ok(days[4].items.some((i) => i.placeName === "南山"));
});

console.log("All persistence day-index checks passed.");
