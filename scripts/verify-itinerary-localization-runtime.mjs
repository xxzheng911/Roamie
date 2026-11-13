/**
 * Final itinerary Localization Runtime — zh-TW must not show VN/TH local names.
 * Run: npx vite-node --config scripts/vite.verify.config.mjs scripts/verify-itinerary-localization-runtime.mjs
 */
import assert from "node:assert/strict";
import { applyItineraryLocalizationGate } from "../src/lib/ai/itinerary-localization-gate.ts";
import { repairItineraryLocalizedNames } from "../src/lib/ai/repair-itinerary-localized-names.ts";
import { estimatePlaceVisitDuration } from "../src/lib/ai/estimate-place-visit-duration.ts";
import { resolvePlaceCategoryFamily } from "../src/lib/ai/place-category-family.ts";
import {
  classifyDailyDiversityCategory,
  summarizeDailyCategoryDiversity,
  wouldViolateDailyDiversity,
} from "../src/lib/ai/daily-category-diversity.ts";
import { resolvePlaceDisplayName, hasForeignLocalScript, hasLocalLatinDiacritics } from "../src/lib/place-display-name.ts";
import { clearLocalizedPlaceNameCache } from "../src/lib/place-localization/localized-place-name-cache.ts";
import { createEmptyDayBudget, wouldFitInDayBudget } from "../src/lib/ai/time-budget-planner.ts";

clearLocalizedPlaceNameCache();

const HAS_CJK_RE = /[\u4e00-\u9fff]/;
const HAS_VIET =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

const vietnamCases = [
  { name: "Nhà Vọng cảnh", types: ["tourist_attraction"] },
  { name: "Ghềnh Bàng", types: ["natural_feature", "tourist_attraction"] },
  { name: "Tượng Cá Chép Hóa Rồng", types: ["sculpture", "tourist_attraction", "point_of_interest"] },
];
// D4 (D2 r4/r5): "Ghềnh Bàng" has no known-token 繁中 name — HEAD spelled "Bàng" phonetically
// (巴恩礁岩, canonical_zh). Phonetic invention is no longer allowed, so without a Google place id the
// name stays the original (original path); with a place id it is the kept Google name
// (google_locale, not counted as foreign). The two known-token cases must still translate.
const KEPT_ORIGINAL = new Set(["Ghềnh Bàng"]);

for (const c of vietnamCases) {
  clearLocalizedPlaceNameCache();
  if (KEPT_ORIGINAL.has(c.name)) {
    const noId = resolvePlaceDisplayName({ name: c.name, originalName: c.name, types: c.types, primaryType: c.types[0] }, "zh-TW");
    assert.equal(noId.localizedDisplayName, c.name, `no place id keeps the original: ${noId.localizedDisplayName}`);
    assert.equal(noId.localizationSource, "original");
    clearLocalizedPlaceNameCache();
    const withId = resolvePlaceDisplayName({ name: c.name, originalName: c.name, placeId: "ChIJD4GhenhBang000001", types: c.types, primaryType: c.types[0] }, "zh-TW");
    assert.equal(withId.localizedDisplayName, c.name);
    assert.equal(withId.localizationSource, "google_locale");
    console.log(`OK VN (kept, no phonetic): ${c.name} → no id ${noId.localizedDisplayName} [${noId.localizationSource}] / id ${withId.localizedDisplayName} [${withId.localizationSource}]`);
    continue;
  }
  const resolved = resolvePlaceDisplayName(
    {
      name: c.name,
      originalName: c.name,
      types: c.types,
      primaryType: c.types[0],
    },
    "zh-TW",
  );
  assert.ok(HAS_CJK_RE.test(resolved.localizedDisplayName), `${c.name} → ${resolved.localizedDisplayName}`);
  assert.ok(!HAS_VIET.test(resolved.localizedDisplayName), `no VN chars: ${resolved.localizedDisplayName}`);
  assert.ok(!hasLocalLatinDiacritics(resolved.localizedDisplayName));
  assert.ok(!hasForeignLocalScript(resolved.localizedDisplayName, "zh-TW"));
  console.log(`OK VN: ${c.name} → ${resolved.localizedDisplayName} [${resolved.localizationSource}]`);
}

// Gate repairs legacy itinerary items that only have raw names
clearLocalizedPlaceNameCache();
const gated = applyItineraryLocalizationGate(
  vietnamCases.map((c, i) => ({
    date: "2026-08-01",
    time: "10:00",
    title: c.name,
    description: "",
    placeName: c.name,
    lat: 16.05,
    lng: 108.2,
    types: c.types,
    placeType: c.types[0],
    dayIndex: 0,
    sortIndex: i,
  })),
  { locale: "zh-TW", softPassEnglish: true },
);
// Only the kept-original stop (no place id, Vietnamese diacritics) counts as foreign script.
assert.equal(gated.foreignScriptStops, KEPT_ORIGINAL.size, "foreignScriptStops = kept-original stops only");
assert.equal(gated.totalStops, 3);
for (const item of gated.items) {
  if (KEPT_ORIGINAL.has(item.originalName)) {
    assert.equal(item.localizedDisplayName, item.originalName);
    continue;
  }
  assert.ok(HAS_CJK_RE.test(item.localizedDisplayName ?? ""), item.placeName);
  assert.ok(!(item.localizedDisplayName ?? "").match(HAS_VIET));
}
console.log("OK gate:", gated.items.map((i) => i.localizedDisplayName).join(" | "));

// Same stops with Google place ids: the kept Google name is deliverable (foreignScriptStops = 0).
clearLocalizedPlaceNameCache();
const gatedWithIds = applyItineraryLocalizationGate(
  vietnamCases.map((c, i) => ({
    date: "2026-08-01", time: "10:00", title: c.name, description: "", placeName: c.name,
    googlePlaceId: `ChIJD4VnRuntime00000${i}`, lat: 16.05, lng: 108.2, types: c.types, placeType: c.types[0], dayIndex: 0, sortIndex: i,
  })),
  { locale: "zh-TW", softPassEnglish: true },
);
assert.equal(gatedWithIds.foreignScriptStops, 0, "with place ids foreignScriptStops must be 0");
assert.equal(gatedWithIds.totalStops, 3);
console.log("OK gate (place ids):", gatedWithIds.items.map((i) => `${i.localizedDisplayName}[${i.localizationSource}]`).join(" | "));

const repaired = repairItineraryLocalizedNames(
  vietnamCases.map((c) => ({
    date: "2026-08-01",
    time: "10:00",
    title: c.name,
    description: "",
    placeName: c.name,
    lat: null,
    lng: null,
  })),
  { locale: "zh-TW" },
);
// Kept-original stops are unchanged by repair (no phonetic name to write).
assert.equal(repaired.repairedCount, vietnamCases.length - KEPT_ORIGINAL.size, `repairedCount=${repaired.repairedCount}`);
for (const item of repaired.items) if (KEPT_ORIGINAL.has(item.originalName ?? item.title)) assert.equal(item.localizedDisplayName, item.originalName ?? item.title);
console.log("OK repair count", repaired.repairedCount);

// Museum family + daily cap 1
const museumA = {
  id: "m1",
  name: "History Museum",
  address: null,
  lat: 1,
  lng: 1,
  rating: 4.5,
  userRatingCount: 1000,
  photoName: null,
  primaryType: "tourist_attraction",
  types: ["tourist_attraction", "history_museum"],
  businessStatus: null,
  openStatus: "unknown",
  openStatusLabel: "",
  todayHoursLabel: "",
  closingSoonNote: "",
  nextOpenHint: "",
};
const museumB = {
  ...museumA,
  id: "m2",
  name: "Military Museum",
  types: ["tourist_attraction", "military_museum"],
  primaryType: "point_of_interest",
};
assert.equal(resolvePlaceCategoryFamily(museumA), "museum_family");
assert.equal(resolvePlaceCategoryFamily(museumB), "museum_family");
assert.equal(classifyDailyDiversityCategory(museumA), "museum_family");
assert.equal(wouldViolateDailyDiversity([museumA], museumB).ok, false, "2nd museum blocked");
const div = summarizeDailyCategoryDiversity(1, [museumA, museumB, { ...museumA, id: "m3", name: "Art Museum", types: ["art_museum"] }]);
assert.equal(div.gatePass, false);
console.log("OK museum diversity gate", div.violations.join(","));

// Visit duration not flat 60 for museums
const louvre = estimatePlaceVisitDuration({
  ...museumA,
  id: "louvre",
  name: "Louvre Museum",
  types: ["museum"],
  primaryType: "museum",
  userRatingCount: 80_000,
});
assert.ok(louvre.finalDuration >= 75, `louvre=${louvre.finalDuration}`);
assert.notEqual(louvre.finalDuration, 60);
console.log("OK duration", louvre.finalDuration);

// Time budget rejects overfill
const budget = createEmptyDayBudget({ day: 1, totalDays: 6, pace: "medium" });
let b = budget;
const park = {
  ...museumA,
  id: "p1",
  name: "Central Park",
  primaryType: "park",
  types: ["park"],
};
for (let i = 0; i < 12; i += 1) {
  const place = { ...park, id: `p${i}`, name: `Park ${i}` };
  const fit = wouldFitInDayBudget(b, place, null, "medium");
  if (!fit.ok) {
    console.log(`OK time budget stop at i=${i} remaining=${b.remainingMinutes}`);
    break;
  }
  b = {
    ...b,
    visitMinutes: b.visitMinutes + fit.visit,
    remainingMinutes: b.remainingMinutes - fit.visit,
    stopCount: b.stopCount + 1,
  };
  if (i === 11) assert.fail("time budget never rejected");
}

console.log("ALL PASS verify-itinerary-localization-runtime");
