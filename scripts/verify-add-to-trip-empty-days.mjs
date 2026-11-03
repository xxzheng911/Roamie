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
// ef49b88（多語系上線）把「新增地點」三鍵選單由固定 grid-cols-3／whitespace-nowrap／h-3 icon
// 改成共用的 LOCALIZED_ACTION_GRID／LOCALIZED_ACTION_BUTTON（verify-opening-layout-localization 明確禁止 nowrap），
// 文案改由 uiT("productionUi.<id>") 取用。這裡改驗同一個三鍵選單在新版型下仍存在、且「去探索看看」仍會先存檔再導向 /map。
const productionUi = readFileSync(new URL("../src/lib/i18n/production-ui.ts", import.meta.url), "utf8");
const zhSection = productionUi.slice(productionUi.indexOf('"zh-TW": {'), productionUi.indexOf("\n  en: {"));
const zhKey = (text) => {
  const m = [...zhSection.matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)].filter((x) => x[2] === text);
  assert.ok(m.length > 0, `zh-TW production UI copy missing: ${text}`);
  return m.map((x) => x[1]);
};
const addMenuStart = editorSource.indexOf("<div className={LOCALIZED_ACTION_GRID}>");
assert.ok(addMenuStart >= 0, "add-place menu must use LOCALIZED_ACTION_GRID");
const addMenu = editorSource.slice(addMenuStart, editorSource.indexOf("</div>", editorSource.indexOf('navigate({ to: "/map" })', addMenuStart)));
for (const [icon, text] of [
  ["Bookmark", "從收藏新增"],
  ["Sparkles", "請 Roamie 推薦"],
  ["MapIcon", "去探索看看"],
]) {
  assert.match(addMenu, new RegExp(`<${icon} className="[^"]*shrink-0[^"]*" />`), `${icon} action icon must stay in the add-place menu`);
  assert.ok(
    zhKey(text).some((k) => addMenu.includes(`uiT("productionUi.${k}")`)),
    `add-place menu must render「${text}」`,
  );
}
assert.equal((addMenu.match(/className=\{LOCALIZED_ACTION_BUTTON\}/g) ?? []).length, 3, "add-place menu keeps exactly three actions");
const mapIconAt = addMenu.indexOf("<MapIcon");
const exploreAction = addMenu.slice(addMenu.lastIndexOf("<button", mapIconAt), mapIconAt);
assert.ok(
  exploreAction.indexOf("await saveNow()") >= 0 &&
    exploreAction.indexOf("await saveNow()") < exploreAction.indexOf('navigate({ to: "/map" })'),
  "「去探索看看」must persist before navigating to /map",
);
assert.match(editorSource, /await saveNow\(\)/);
assert.match(editorSource, /navigate\(\{ to: "\/map" \}\)/);
assert.doesNotMatch(editorSource, /\{tripView\.summary \?/);
console.log("[verify:add-to-trip-empty-days] OK");
