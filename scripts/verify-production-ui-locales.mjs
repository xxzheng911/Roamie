import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { productionUiMessages } from "../src/lib/i18n/production-ui.ts";
import { translate } from "../src/lib/i18n/translate.ts";
import { recommendationDisplayForLocale } from "../src/lib/recommendation-display-locale.ts";
import { formatDurationMinutes, formatDateShort } from "../src/lib/picker-utils.ts";
import { CHAT_SHORTCUT_SEND_CHIPS } from "../src/lib/chat-shortcut-chips.ts";
const locales = ["zh-TW", "en", "ja", "ko"];
const keys = Object.keys(productionUiMessages["zh-TW"]).sort();
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
for (const locale of locales) {
  assert.deepEqual(Object.keys(productionUiMessages[locale]).sort(), keys);
  for (const key of keys) {
    const text = productionUiMessages[locale][key];
    assert.ok(text.trim());
    assert.deepEqual(vars(text), vars(productionUiMessages["zh-TW"][key]));
    assert.equal(translate(locale, `productionUi.${key}`), text);
    if (locale === "en" || locale === "ko")
      assert.doesNotMatch(text, /\p{Script=Han}/u, `${locale}.${key}`);
  }
}
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.tsx?$/.test(f)) {
      for (const match of fs.readFileSync(f, "utf8").matchAll(/\bproductionUi\.([A-Za-z0-9_]+)/g)) {
        assert.ok(keys.includes(match[1]), `Missing translation ${f}: ${match[0]}`);
      }
    }
  }
}
walk("src");
const original = {
  id: "r1",
  title: "中文生成標題",
  generatedLocale: "zh-TW",
  mood: "中文心情",
  cover_image: null,
  created_at: "2026-01-01",
  payload: {
    version: 2,
    title: "中文生成標題",
    summary: "中文摘要",
    moodTag: "中文心情",
    recommendations: [
      {
        googlePlaceId: "official-id",
        name: "清水寺",
        placeName: "清水寺",
        address: "京都市東山区",
        type: "attraction",
        types: ["tourist_attraction"],
        description: "中文描述",
        reason: "中文推薦理由",
        estimatedTime: "一小時",
        lat: 34.99,
        lng: 135.78,
        googleMapsUrl: "https://maps.google.com/",
        reasonSource: "ai",
        sourceCombinationId: 7,
      },
    ],
    itinerary: [
      {
        date: "2026-01-01",
        time: "10:00",
        title: "中文行程文案",
        placeName: "清水寺",
        description: "中文描述",
        notes: "AI 生成備註",
        lat: 34.99,
        lng: 135.78,
      },
    ],
  },
};
const snapshot = JSON.stringify(original);
for (const locale of locales) {
  const view = recommendationDisplayForLocale(original, locale);
  assert.equal(view.id, original.id);
  for (const k of [
    "googlePlaceId",
    "name",
    "placeName",
    "address",
    "lat",
    "lng",
    "sourceCombinationId",
    "types",
  ])
    assert.deepEqual(view.payload.recommendations[0][k], original.payload.recommendations[0][k]);
  assert.equal(view.payload.itinerary[0].date, original.payload.itinerary[0].date);
  if (locale === "zh-TW") assert.equal(view, original);
  else {
    assert.equal(view.title, translate(locale, "productionUi.savedRecommendations"));
    assert.notEqual(view.payload.summary, original.payload.summary);
    assert.equal(view.payload.recommendations[0].description, "");
    assert.equal(view.payload.itinerary[0].title, "清水寺");
  }
  assert.equal(
    JSON.stringify(original),
    snapshot,
    "display projection must not mutate stored data",
  );
  const legacy = { ...original, generatedLocale: undefined };
  assert.notEqual(recommendationDisplayForLocale(legacy, locale).title, legacy.title);
  assert.ok(formatDateShort("2026-05-22", { locale, withYear: true }).includes("2026"));
  assert.notEqual(formatDurationMinutes(75, locale), "");
}
assert.equal(
  recommendationDisplayForLocale(original, "zh-TW").payload.summary,
  "中文摘要",
  "switch back restores original prose",
);
assert.deepEqual(CHAT_SHORTCUT_SEND_CHIPS, [
  "今天想放鬆走走",
  "想找安靜的咖啡廳",
  "下雨天可以去哪",
]);
assert.match(fs.readFileSync("src/routes/_app.index.tsx", "utf8"), /generatedLocale:\s*locale/);
assert.match(
  fs.readFileSync("src/routes/_app.recommendations.tsx", "utf8"),
  /recommendationDisplayForLocale\(storedRecord, locale\)/,
);
console.log(
  `PASS: ${keys.length} keys × 4 locales, all source key references, persisted recommendation locale projection and data preservation, picker formatting, canonical payloads.`,
);

// Legacy persisted sentinels must stay canonical when display text is localized.
assert.match(
  fs.readFileSync("src/routes/_app.chat.tsx", "utf8"),
  /isChatRuntimeCopyPrefix\(last\.content, "loading_recommendations"\)/,
);
assert.match(fs.readFileSync("src/components/saved/SavedTripItineraryEditor.tsx", "utf8"), /tripView\.destination !== "尚未設定"/);
