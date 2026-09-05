import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  isPlaceOperationalForRecommendation,
  placeOperationalEligibility,
} from "../src/lib/place-operational-eligibility.ts";
import { sanitizeHomeNearbyPicksForDisplay } from "../src/lib/home-nearby-display.ts";
import { writePlaceRuntimeCache } from "../src/lib/place-runtime-cache.ts";
import { mergePlaceFactualFields } from "../src/lib/unified-place-cache.ts";
import { resolvePlaceDetailOpeningLine } from "../src/lib/normalized-opening-status.ts";
import {
  applyRecommendedMode,
  estimateTravelModesLocal,
  recommendTransportMode,
} from "../src/lib/estimate-travel-mode.ts";
import { getPlanTransportOptions } from "../src/lib/i18n/plan-form-options.ts";
import { buildUnifiedPlaceCards } from "../src/lib/unified-place-card.ts";
import { buildWeatherRecommendation } from "../src/lib/weather-scene.ts";

const place = (businessStatus) => ({
  id: "ChIJ-operational-test",
  name: "Test Cafe",
  address: "",
  lat: 25,
  lng: 121,
  rating: 4.5,
  userRatingCount: 100,
  photoName: null,
  primaryType: "cafe",
  types: ["cafe"],
  businessStatus,
  openStatus: "unknown",
  openStatusLabel: "",
  todayHoursLabel: "",
  closingSoonNote: "",
  nextOpenHint: "",
});

test("operational contract rejects all explicit non-operational evidence but preserves unknown", () => {
  assert.equal(isPlaceOperationalForRecommendation(place("OPERATIONAL")), true);
  assert.equal(isPlaceOperationalForRecommendation(place("CLOSED_TEMPORARILY")), false);
  assert.equal(isPlaceOperationalForRecommendation(place("CLOSED_PERMANENTLY")), false);
  assert.equal(isPlaceOperationalForRecommendation(place(null)), true);
  assert.equal(placeOperationalEligibility({ permanently_closed: true }).eligible, false);
});

test("Home restore rechecks newer runtime closed status", () => {
  const cached = place("OPERATIONAL");
  writePlaceRuntimeCache(cached.id, { businessStatus: "CLOSED_PERMANENTLY" });
  assert.deepEqual(sanitizeHomeNearbyPicksForDisplay([cached], { logDrop: false }), []);
});

test("factual merge preserves status and newer closed evidence wins", () => {
  assert.equal(mergePlaceFactualFields(place(null), place("CLOSED_PERMANENTLY")).businessStatus, "CLOSED_PERMANENTLY");
  assert.equal(mergePlaceFactualFields(place("OPERATIONAL"), place("CLOSED_PERMANENTLY")).businessStatus, "CLOSED_PERMANENTLY");
  assert.equal(mergePlaceFactualFields(place("CLOSED_PERMANENTLY"), place(undefined)).businessStatus, "CLOSED_PERMANENTLY");
});

test("closed Detail states are explicit", () => {
  assert.equal(resolvePlaceDetailOpeningLine(place("CLOSED_PERMANENTLY")), "已停止營業");
  assert.equal(resolvePlaceDetailOpeningLine(place("CLOSED_TEMPORARILY")), "暫停營業");
});

test("closed candidates are removed before batch reason generation", () => {
  assert.equal(buildUnifiedPlaceCards([{ place: place("CLOSED_PERMANENTLY") }]).length, 0);
});

test("long-distance formula estimates are unavailable and cannot be recommended", () => {
  const modes = estimateTravelModesLocal(2_368_600);
  assert.equal(modes.find((mode) => mode.id === "walk")?.available, false);
  assert.equal(modes.find((mode) => mode.id === "motorcycle")?.available, false);
  assert.equal(modes.find((mode) => mode.id === "transit")?.available, false);
  const rec = recommendTransportMode(modes, { distanceMeters: 2_368_600, inTaiwan: true });
  assert.equal(applyRecommendedMode(modes, rec.modeId).some((mode) => mode.recommended), false);
  assert.doesNotMatch(modes.map((mode) => mode.hint).join(" "), /台灣市區/);
});

test("Plan labels change without changing persisted values", () => {
  const options = getPlanTransportOptions("zh-TW");
  assert.deepEqual(options.find((item) => item.value === "步行為主"), { value: "步行為主", label: "步行" });
  assert.deepEqual(options.find((item) => item.value === "租車自駕"), { value: "租車自駕", label: "開車" });
  const source = readFileSync(new URL("../src/routes/_app.plan.tsx", import.meta.url), "utf8");
  assert.match(source, /overflow-x-auto/);
  assert.match(source, /shrink-0 whitespace-nowrap/);
  assert.doesNotMatch(source, /flex flex-wrap gap-2[\s\S]{0,200}transportOptions/);
});

test("Explore restores missing metadata and never renders Unknown category", () => {
  const source = readFileSync(new URL("../src/routes/_app.map.tsx", import.meta.url), "utf8");
  assert.match(source, /rawCategory\.toLowerCase\(\) !== "unknown"/);
  assert.match(source, /reason: p\.reason/);
  const persisted = readFileSync(new URL("../src/lib/explore-map-persistent-cache.ts", import.meta.url), "utf8");
  assert.match(persisted, /reason: _reason/);
  assert.match(persisted, /displayCategory: _displayCategory/);
});

test("fallback weather uses product formatter while source remains diagnostic", () => {
  const advice = buildWeatherRecommendation({
    tempC: 27,
    feelsLikeC: 27,
    condition: "多雲",
    isDaytime: true,
  });
  assert.ok(advice.text.length > 0);
  assert.doesNotMatch(advice.text, /備援|fallback|provider|OpenWeather|Open-Meteo/i);
  for (const file of ["weather.functions.ts", "weather-open-meteo-client.ts"]) {
    const source = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /recommendationText:\s*"已使用備援天氣來源。"/);
    assert.match(source, /source:\s*"open-meteo-fallback"/);
  }
});
