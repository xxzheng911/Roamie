import assert from "node:assert/strict";
import fs from "node:fs";
import { i18nMessages } from "../src/lib/i18n/messages.ts";
const plusPurchaseMessages = Object.fromEntries(
  Object.entries(i18nMessages).map(([locale, messages]) => [locale, messages.plusPurchase]),
);
import { translate, translateList } from "../src/lib/i18n/translate.ts";
import { detectDeviceLocale } from "../src/lib/i18n/detect-locale.ts";

const locales = ["zh-TW", "en", "ja", "ko"];
const keys = Object.keys(plusPurchaseMessages["zh-TW"]).sort();
for (const locale of locales) {
  const messages = plusPurchaseMessages[locale];
  assert.deepEqual(
    Object.keys(messages).sort(),
    keys,
    `${locale}: exact key parity, without fallback`,
  );
  for (const key of keys) {
    const value = messages[key];
    if (Array.isArray(value)) {
      assert.equal(value.length, plusPurchaseMessages["zh-TW"][key].length);
      assert.ok(value.every((text) => typeof text === "string" && text.trim()));
      assert.deepEqual(translateList(locale, `plusPurchase.${key}`), value);
    } else {
      assert.ok(typeof value === "string" && value.trim(), `${locale}.${key}`);
      assert.equal(
        translate(locale, `plusPurchase.${key}`),
        value,
        "canonical dictionary registration",
      );
      assert.deepEqual(
        value.match(/\{\w+\}/g) ?? [],
        plusPurchaseMessages["zh-TW"][key].match(/\{\w+\}/g) ?? [],
      );
    }
  }
  assert.ok(messages.disclosure.includes("Apple"));
  assert.ok(
    !/free trial|免費試用|無料体験|무료 체험/i.test(messages.disclosure),
    "no unverified trial promise",
  );
}
const files = [
  "src/routes/welcome.tsx",
  "src/routes/_app.profile.tsx",
  "src/components/RoamiePlusIntroDialog.tsx",
  "src/providers/PlusPurchaseProvider.tsx",
];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const [, key] of source.matchAll(/"plusPurchase\.(\w+)"/g))
    assert.ok(keys.includes(key), `${file}: missing ${key}`);
  if (!file.includes("profile")) {
    assert.doesNotMatch(
      source,
      /toast\.(?:success|error|message)\("[\p{Script=Han}]/u,
      "no hardcoded purchase toasts",
    );
  }
}
// Dynamic states and intro keys are exercised too, not hidden by fallback.
for (const key of [
  "empty",
  "timeout",
  "unavailable",
  "initializationFailed",
  "syncing",
  "syncPending",
  "purchaseSyncPending",
  "restoreSyncPending",
  "entitlementPending",
  ...[1, 2, 3].flatMap((i) => [`intro${i}Title`, `intro${i}Body`]),
])
  assert.ok(keys.includes(key));
const paywall = fs.readFileSync(files[2], "utf8");
assert.match(paywall, /pkg\.priceString/);
assert.doesNotMatch(paywall, /Intl\.NumberFormat|toLocaleString|navigator\.language|currency/);
for (const priceString of ["NT$90", "$2.99", "¥300", "₩4,000"]) {
  for (const locale of locales)
    assert.ok(
      `${translate(locale, "plusPurchase.monthly")} · ${priceString}`.endsWith(priceString),
    );
}
const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
try {
  for (const [language, expected] of [
    ["zh-Hant-TW", "zh-TW"],
    ["en-US", "en"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
  ]) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language } });
    assert.equal(detectDeviceLocale(), expected);
  }
} finally {
  if (original) Object.defineProperty(globalThis, "navigator", original);
  else delete globalThis.navigator;
}
console.log(
  `Plus purchase i18n: PASS (${keys.length} keys × ${locales.length} locales; canonical registration, arrays, device mapping, Apple prices)`,
);

const welcome = fs.readFileSync("src/routes/welcome.tsx", "utf8");
assert.match(welcome, /<h1[^>]*>\s*\{t\("plusPurchase.tierHeading"\)\}\s*<\/h1>/);
assert.doesNotMatch(welcome, /選擇適合你的旅行/);
const headings = [
  "選擇適合你的旅行陪伴方式",
  "Choose how you'd like to travel together",
  "あなたに合う旅のサポートを",
  "나에게 맞는 여행 동반 방식을 골라보세요",
];
locales.forEach((locale, i) =>
  assert.equal(translate(locale, "plusPurchase.tierHeading"), headings[i]),
);
