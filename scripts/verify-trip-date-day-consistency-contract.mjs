#!/usr/bin/env node
import assert from "node:assert/strict";
import { resolveSuggestedTripDates } from "../src/lib/ai/resolve-suggested-trip-dates.ts";
import { resolveTripCreateDates } from "../src/lib/ai/resolve-trip-create-dates.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

console.log("\n[verify:trip-date-day-consistency-contract]\n");

test("explicit start/end uses inclusive day count", () => {
  const out = resolveSuggestedTripDates({
    days: 3,
    startDate: "2026-12-01",
    endDate: "2026-12-05",
  });
  assert.ok(out);
  assert.equal(out?.days, 5);
});

test("single-day range stays 1", () => {
  const out = resolveSuggestedTripDates({
    days: 5,
    startDate: "2026-12-01",
    endDate: "2026-12-01",
  });
  assert.ok(out);
  assert.equal(out?.days, 1);
});

test("cross-month range counts inclusively", () => {
  const out = resolveSuggestedTripDates({
    days: 2,
    startDate: "2026-01-30",
    endDate: "2026-02-02",
  });
  assert.ok(out);
  assert.equal(out?.days, 4);
});

test("trip create dates honors inclusive days over safeDays", () => {
  const out = resolveTripCreateDates({
    context: { interests: [], startDate: "2026-12-01", endDate: "2026-12-05" },
    session: { tripStartDate: "2026-12-01", tripEndDate: "2026-12-05" },
    days: 3,
    userText: "",
  });
  assert.equal(out.days, 5);
  assert.equal(out.dayDates.length, 5);
});

console.log("\n[verify:trip-date-day-consistency-contract] OK\n");
