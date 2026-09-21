import assert from "node:assert/strict";
import fs from "node:fs";
import { uiCoverageMessages } from "../src/lib/i18n/ui-coverage.ts";
import { translate } from "../src/lib/i18n/translate.ts";
import { localizeWeatherSummary } from "../src/lib/weather-scene.ts";
import {
  readHomeSessionPlusInsight,
  resolveHomeSessionPlusInsight,
} from "../src/lib/home-personalization-insight.ts";
import {
  CHAT_SHORTCUT_SEND_CHIPS,
  CHAT_SHORTCUT_PLAN_LABEL,
  chatShortcutLabel,
} from "../src/lib/chat-shortcut-chips.ts";
import {
  estimateTravelModesLocal,
  recommendTransportMode,
} from "../src/lib/estimate-travel-mode.ts";
import { exploreCategorySheetTitle } from "../src/lib/explore-search-radius.ts";
import { inventoryChineseLiterals } from "./audit-ui-chinese-leakage.mjs";
const locales = ["zh-TW", "en", "ja", "ko"];
const keys = Object.keys(uiCoverageMessages["zh-TW"]).sort();
const parameters = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
for (const locale of locales) {
  assert.deepEqual(Object.keys(uiCoverageMessages[locale]).sort(), keys);
  for (const key of keys) {
    const value = uiCoverageMessages[locale][key];
    assert.ok(value.trim(), `${locale}.${key} empty`);
    assert.deepEqual(
      parameters(value),
      parameters(uiCoverageMessages["zh-TW"][key]),
      `${locale}.${key} parameters`,
    );
    assert.equal(translate(locale, `uiCoverage.${key}`), value);
    // Japanese 公園 is correctly identical to Traditional Chinese.
    if (locale !== "zh-TW" && !(locale === "ja" && key === "category_park"))
      assert.notEqual(value, uiCoverageMessages["zh-TW"][key], `${locale}.${key} untranslated`);
  }
  for (const scene of ["sunny", "cloudy", "rainy", "hot", "cold", "fair", "night"]) {
    const cached = {
      scene,
      recommendationText: "舊中文快取",
      tempC: 20,
      condition: "外部天氣資料",
      available: true,
    };
    const localized = localizeWeatherSummary(cached, locale);
    assert.equal(
      localized.recommendationText,
      translate(locale, `uiCoverage.weather${scene[0].toUpperCase()}${scene.slice(1)}`),
    );
    assert.equal(localized.tempC, cached.tempC);
    assert.equal(localized.condition, cached.condition);
    assert.equal(cached.recommendationText, "舊中文快取");
  }
  assert.equal(
    localizeWeatherSummary({ available: false }, locale).recommendationText,
    translate(locale, "uiCoverage.weatherUnavailable"),
  );
  const insight = resolveHomeSessionPlusInsight("locale-switch-regression", true, {
    savedPlaces: [],
    locale,
  });
  assert.equal(insight, translate(locale, "uiCoverage.insightDefault"));
  assert.equal(readHomeSessionPlusInsight("locale-switch-regression", locale), insight);
  assert.equal(readHomeSessionPlusInsight("other-account", locale), null);
  for (const payload of [
    CHAT_SHORTCUT_PLAN_LABEL,
    ...CHAT_SHORTCUT_SEND_CHIPS,
    "生成行程",
    "再推薦一些",
    "重新生成",
    "幫我生成",
  ]) {
    const display = chatShortcutLabel(payload, locale);
    assert.ok(display);
    if (locale !== "zh-TW") assert.notEqual(display, payload);
  }
  assert.equal(chatShortcutLabel("使用者自訂文字", locale), "使用者自訂文字");
  for (const distance of [400, 1200, 1201, 37900, 1100000]) {
    const baseline = estimateTravelModesLocal(distance);
    const modes = estimateTravelModesLocal(distance, undefined, locale);
    assert.deepEqual(
      modes.map(({ id, minutes, distanceMeters }) => ({ id, minutes, distanceMeters })),
      baseline.map(({ id, minutes, distanceMeters }) => ({ id, minutes, distanceMeters })),
    );
    for (const mode of modes) assert.equal(mode.label, translate(locale, `uiCoverage.${mode.id}`));
    assert.equal(
      recommendTransportMode(modes, { distanceMeters: distance, inTaiwan: true, locale }).modeId,
      recommendTransportMode(baseline, { distanceMeters: distance, inTaiwan: true }).modeId,
    );
  }
  for (const category of ["all", "coffee", "sight", "district", "food", "night"]) {
    assert.ok(exploreCategorySheetTitle(category, locale));
    if (locale !== "zh-TW")
      assert.notEqual(
        exploreCategorySheetTitle(category, locale),
        exploreCategorySheetTitle(category),
      );
  }
}
assert.deepEqual(CHAT_SHORTCUT_SEND_CHIPS, [
  "今天想放鬆走走",
  "想找安靜的咖啡廳",
  "下雨天可以去哪",
]);
// A baseline is a visible backlog, NOT an allowlist or a claim of complete coverage.
const current = inventoryChineseLiterals();
for (const [name, rows] of [
  ["remaining", current.filter((r) => r.classification !== "allowed")],
  ["allowlist", current.filter((r) => r.classification === "allowed")],
]) {
  const stored = JSON.parse(fs.readFileSync(`docs/audits/ui-chinese-leakage-${name}.json`, "utf8"));
  const normalize = (xs) => xs.map(({ line, ...row }) => row);
  assert.deepEqual(
    normalize(rows),
    normalize(stored),
    `Chinese literal ${name} changed: classify and update the explicit inventory`,
  );
}
console.log(
  `PASS: ${keys.length} keys × 4 locales; weather/insight cache switching, chip payloads, transport enums, Explore categories; inventory guard. Full-App backlog remains (see audit).`,
);

if (process.argv.includes("--strict")) {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["scripts/verify-production-ui-reachability.mjs"], { stdio: "inherit" });
}
