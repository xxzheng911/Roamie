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
  assert.equal(
    buildDailyPrepAdvice({ ...weather, city: "Lindefu" }, locale).headline,
    `${location} · ${night}`,
  );
  assert.equal(
    buildDailyPrepAdvice(weather, locale, "Lindefu").headline,
    `${location} · ${night}`,
  );
  // KIJ2 spec: non-zh locales use the city-table name; unknown labels stay raw; zh-TW unchanged.
  const cityTable = {
    "高雄市": { en: "Kaohsiung", ja: "高雄", ko: "가오슝" },
    "大阪市": { en: "Osaka", ja: "大阪", ko: "오사카" },
    "高雄": { en: "Kaohsiung", ja: "高雄", ko: "가오슝" },
    Tokyo: { en: "Tokyo", ja: "東京", ko: "도쿄" },
    "大阪": { en: "Osaka", ja: "大阪", ko: "오사카" },
  };
  const shown = (city) => (locale === "zh-TW" ? city : (cityTable[city]?.[locale] ?? city));
  for (const city of ["高雄市", "三民區", "大阪市", "新宿區"]) {
    assert.equal(buildDailyPrepAdvice({ ...weather, city }, locale).headline, `${shown(city)} · ${night}`, `${locale} ${city}`);
  }
  for (const city of ["高雄", "Tokyo", "大阪", "目前位置咖啡館"]) {
    assert.equal(buildDailyPrepAdvice({ ...weather, city }, locale).headline, `${shown(city)} · ${night}`, `${locale} ${city}`);
    assert.equal(buildDailyPrepAdvice(weather, locale, city).headline, `${shown(city)} · ${night}`, `${locale} arg ${city}`);
    assert.ok(buildDailyPrepAdvice(null, locale, city).headline.startsWith(`${shown(city)} · `), `${locale} null ${city}`);
  }
  assert.equal(shown("三民區"), "三民區");
  assert.equal(shown("目前位置咖啡館"), "目前位置咖啡館");
  assert.equal(buildDailyPrepAdvice({ ...weather, city: "" }, locale).headline, night);
  assert.ok(!buildDailyPrepAdvice(null, locale).headline.includes("undefined"));
  assert.equal(JSON.stringify(weather), persisted, "Read projection must not rewrite cached facts");
  console.log(`PASS Home Outfit location, legacy cache, real places and night copy: ${locale}`);
}
