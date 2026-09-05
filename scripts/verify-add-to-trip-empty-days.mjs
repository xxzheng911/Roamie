#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveTripDateOptions } from "../src/lib/trip/trip-date-options.ts";
import { insertStopOnDate, removeStopAt } from "../src/lib/trip/trip-stop-mutations.ts";

const dates = Array.from({ length: 6 }, (_, i) => `2026-11-${String(25 + i).padStart(2, "0")}`);
const item = (date, placeName) => ({
  date,
  time: "10:00",
  title: placeName,
  description: "",
  placeName,
  lat: null,
  lng: null,
});
const payload = {
  version: 2,
  days: 6,
  recommendations: [],
  itinerary: dates.filter((_, i) => i !== 1).map((date, i) => item(date, `Place ${i + 1}`)),
  tripSettings: { tripStartDate: dates[0], tripEndDate: dates[5] },
};

assert.deepEqual(resolveTripDateOptions(payload), dates, "empty Day 2 remains selectable");

const dayThreeIndex = payload.itinerary.findIndex((entry) => entry.date === dates[2]);
const withoutLastPlace = removeStopAt(payload.itinerary, dates[2], 0);
assert.equal(
  withoutLastPlace.some((entry) => entry.date === dates[2]),
  false,
);
assert.deepEqual(
  resolveTripDateOptions({ ...payload, itinerary: withoutLastPlace }),
  dates,
  "deleting the last place does not delete its trip day",
);

const withPlaceOnEmptyDay = insertStopOnDate(withoutLastPlace, item("", "New Place"), {
  date: dates[1],
  position: "end",
});
assert.equal(
  withPlaceOnEmptyDay.some((entry) => entry.date === dates[1] && entry.placeName === "New Place"),
  true,
);
assert.deepEqual(
  resolveTripDateOptions(
    JSON.parse(JSON.stringify({ ...payload, itinerary: withPlaceOnEmptyDay })),
  ),
  dates,
  "persisted payload retains all days",
);

assert.ok(dayThreeIndex >= 0);

const editorSource = readFileSync(
  new URL("../src/components/saved/SavedTripItineraryEditor.tsx", import.meta.url),
  "utf8",
);
assert.match(editorSource, /grid grid-cols-3 gap-1\.5/);
assert.match(editorSource, /去探索看看/);
assert.match(editorSource, /await saveNow\(\)/);
assert.match(editorSource, /navigate\(\{ to: "\/map" \}\)/);
assert.match(editorSource, /whitespace-nowrap/);
assert.match(editorSource, /<Bookmark className="h-3 w-3 shrink-0" \/>/);
assert.doesNotMatch(editorSource, /\{tripView\.summary \?/);
console.log("[verify:add-to-trip-empty-days] OK");
