import assert from "node:assert/strict";
import { buildDailyPrepAdvice } from "../src/lib/recommendation/daily-prep-advice.ts";
import { localizeWeatherSummary } from "../src/lib/weather-scene.ts";

const persisted = JSON.stringify({
  city: "目前位置",
  tempC: 27,
  condition: "Few clouds",
  isDaytime: false,
  precipProbability: 0,
  available: true,
  source: "open-meteo-fallback",
  scene: "night",
});
const expected = {
  "zh-TW": ["目前位置", "夜晚出門，記得保暖"],
  en: ["Current location", "Heading out at night"],
  ja: ["現在地", "夜のお出かけ"],
  ko: ["현재 위치", "밤 외출"],
};
const weather = Object.freeze(JSON.parse(persisted));
for (const [locale, [location, night]] of Object.entries(expected)) {
  // Exercise the Home route's locale projection and advice builder using one legacy cache.
  const projected = localizeWeatherSummary(weather, locale);
  const advice = buildDailyPrepAdvice(projected, locale, projected.city);
  assert.equal(advice.headline, `${location} · ${night}`);
  assert.equal(buildDailyPrepAdvice(weather, locale).headline, advice.headline);
  for (const input of [null, { ...weather, available: false }]) {
    assert.ok(buildDailyPrepAdvice(input, locale, weather.city).headline.startsWith(`${location} · `));
  }
  assert.ok(buildDailyPrepAdvice({ ...weather, available: false }, locale).headline.startsWith(`${location} · `));
  for (const city of ["高雄", "Tokyo", "大阪", "目前位置咖啡館"]) {
    assert.equal(buildDailyPrepAdvice({ ...weather, city }, locale).headline, `${city} · ${night}`);
    assert.equal(buildDailyPrepAdvice(weather, locale, city).headline, `${city} · ${night}`);
    assert.ok(buildDailyPrepAdvice(null, locale, city).headline.startsWith(`${city} · `));
  }
  assert.equal(buildDailyPrepAdvice({ ...weather, city: "" }, locale).headline, night);
  assert.ok(!buildDailyPrepAdvice(null, locale).headline.includes("undefined"));
  assert.equal(JSON.stringify(weather), persisted, "Read projection must not rewrite cached facts");
  console.log(`PASS Home Outfit location, legacy cache, real places and night copy: ${locale}`);
}
