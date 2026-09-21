/**
 * Planning form option layout is intrinsic: column count follows width and font scale.
 * Run: vite-node --config scripts/vite.verify.config.mjs scripts/verify-planning-form-responsive.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getPlanBudgetOptions,
  getPlanStyleOptions,
  getPlanTransportOptions,
} from "../src/lib/i18n/plan-form-options.ts";

const locales = ["zh-TW", "en", "ja", "ko"];
const plan = fs.readFileSync("src/routes/_app.plan.tsx", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");

function section(start, end) {
  const from = plan.indexOf(start);
  const to = plan.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing plan section ${start}`);
  return plan.slice(from, to);
}

const people = section('t("plan.travelers")', 't("plan.budget")');
const budget = section('t("plan.budget")', 't("plan.transport")');
const transport = section('t("plan.transport")', 't("plan.styles")');
const styles = section('t("plan.styles")', 'type="submit"');
const cta = plan.slice(plan.indexOf('type="submit"'));

for (const block of [people, budget, transport, styles, cta]) {
  assert.doesNotMatch(block, /locale\s*===/);
  assert.doesNotMatch(block, /truncate|line-clamp|text-ellipsis|overflow-hidden/);
  assert.doesNotMatch(block, /text-\[10px\]|text-\[9px\]|text-\[8px\]/);
}
assert.doesNotMatch(css, /plan-budget-grid[\s\S]*locale\s*===/);
assert.doesNotMatch(budget, /grid-cols-4|whitespace-nowrap|h-5 |h-3\.5/);
assert.match(
  css,
  /\.plan-budget-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*9\.75rem\),\s*1fr\)\)/,
);
assert.match(budget, /plan-budget-grid/);
assert.match(budget, /min-h-11/);
assert.match(budget, /min-w-0/);
assert.match(budget, /whitespace-normal/);
assert.match(budget, /break-words/);
assert.match(budget, /budgetMode === b\.value/);
assert.doesNotMatch(budget, /scale-|w-\[|h-\[/);

assert.match(people, /flex-wrap/);
assert.match(people, /max-w-full/);
assert.doesNotMatch(people, /overflow-x-auto|whitespace-nowrap/);

assert.match(transport, /overflow-x-auto/);
assert.match(transport, /shrink-0/);
assert.match(transport, /whitespace-nowrap/);
assert.match(transport, /min-h-11/);
assert.doesNotMatch(transport, /truncate|w-\[|max-w-\[/);

assert.match(styles, /flex-wrap/);
assert.match(styles, /max-w-full/);
assert.match(styles, /whitespace-normal/);
assert.doesNotMatch(styles, /overflow-x-auto|whitespace-nowrap/);

assert.match(cta, /w-full/);
assert.match(cta, /whitespace-normal/);
assert.match(cta, /min-w-0/);
assert.match(plan, /t\("plan\.submit"\)/);
assert.match(plan, /t\("plan\.aiAssist"\)/);
assert.match(plan, /RoamieDatePicker/);
assert.match(plan, /className="min-w-0"/);

const budgetValues = ["budget", "standard", "quality", "luxury"];
const transportByLocale = {
  "zh-TW": [
    ["大眾運輸", "大眾運輸"],
    ["步行為主", "步行"],
    ["租車自駕", "開車"],
    ["計程車/共乘", "計程車/共乘"],
    ["單車", "單車"],
  ],
  en: ["Public transit", "Mostly walking", "Self-drive", "Taxi / rideshare", "Cycling"].map(
    (value) => [value, value],
  ),
  ja: ["公共交通", "徒歩中心", "レンタカー", "タクシー・配車", "自転車"].map((value) => [
    value,
    value,
  ]),
  ko: ["대중교통", "도보 위주", "렌터카", "택시·호출", "자전거"].map((value) => [value, value]),
};
const stylesByLocale = {
  "zh-TW": [
    "美食探索",
    "文青咖啡",
    "自然戶外",
    "城市漫遊",
    "藝術展覽",
    "文化體驗",
    "親子同遊",
    "露營野遊",
  ],
  en: [
    "Food exploration",
    "Café culture",
    "Outdoors",
    "City wandering",
    "Art & exhibitions",
    "Cultural experiences",
    "Family-friendly",
    "Camping & outdoors",
  ],
  ja: [
    "グルメ探索",
    "カフェ",
    "自然・アウトドア",
    "街歩き",
    "アート・展覧会",
    "文化体験",
    "親子",
    "キャンプ",
  ],
  ko: ["미식 탐험", "카페", "자연·야외", "도시 산책", "예술·전시", "문화 체험", "가족", "캠핑"],
};

for (const locale of locales) {
  const options = getPlanBudgetOptions(locale);
  assert.deepEqual(
    options.map((option) => option.value),
    budgetValues,
  );
  assert.equal(options.length, 4);
  for (const option of options) {
    assert.ok(option.label.trim());
    assert.ok(option.hint.trim());
    assert.doesNotMatch(option.label, /…|\.\.\./);
    assert.doesNotMatch(option.hint, /…|\.\.\./);
  }
  const labels = new Set(options.map((option) => `${option.label}\n${option.hint}`));
  assert.equal(labels.size, 4, `${locale} budget cards collapsed`);
  assert.deepEqual(
    getPlanTransportOptions(locale).map((option) => [option.value, option.label]),
    transportByLocale[locale],
  );
  assert.deepEqual(getPlanStyleOptions(locale), stylesByLocale[locale]);
  for (const label of [
    ...transportByLocale[locale].map((pair) => pair[1]),
    ...stylesByLocale[locale],
  ]) {
    assert.ok(label.trim());
    assert.doesNotMatch(label, /…|\.\.\./);
  }
}

const jaBudget = getPlanBudgetOptions("ja");
assert.equal(jaBudget[0].hint, "リーズナブル・ローカル");
assert.equal(jaBudget[1].hint, "のんびり快適");
assert.equal(jaBudget.find((option) => option.value === "budget").label, "節約");
assert.equal(jaBudget.find((option) => option.value === "standard").label, "標準");

function columns(viewport, scale) {
  const rem = 16 * scale;
  const available = viewport - 1.25 * rem * 2;
  const minTrack = Math.min(available, 9.75 * rem);
  const gap = 0.5 * rem;
  let count = 1;
  while (count < 4) {
    const next = count + 1;
    if (next * minTrack + (next - 1) * gap <= available + 0.5) count = next;
    else break;
  }
  return count;
}

const expectedColumns = {
  "320@1": 1,
  "320@1.25": 1,
  "320@1.5": 1,
  "375@1": 2,
  "375@1.25": 1,
  "375@1.5": 1,
  "390@1": 2,
  "390@1.25": 1,
  "390@1.5": 1,
  "430@1": 2,
  "430@1.25": 1,
  "430@1.5": 1,
  "768@1": 4,
  "768@1.25": 3,
  "768@1.5": 2,
  "820@1": 4,
  "820@1.25": 3,
  "820@1.5": 3,
};

for (const viewport of [320, 375, 390, 430, 768, 820]) {
  for (const scale of [1, 1.25, 1.5]) {
    const count = columns(viewport, scale);
    const key = `${viewport}@${scale}`;
    assert.equal(count, expectedColumns[key], key);
    assert.ok(count >= 1 && count <= 4);
  }
}

assert.equal(columns(390, 1), 2, "iPhone-width budget row must leave the forced 4-column overflow");
assert.equal(columns(320, 1.5), 1);
assert.equal(columns(430, 1.5), 1);
assert.equal(columns(768, 1), 4);

const jaHint = "リーズナブル・ローカル";
function cardInner(viewport, scale) {
  const rem = 16 * scale;
  const available = viewport - 1.25 * rem * 2;
  const count = columns(viewport, scale);
  const gap = 0.5 * rem;
  const card = (available - gap * (count - 1)) / count;
  return card - 0.625 * rem * 2;
}
for (const [viewport, scale] of [
  [320, 1.5],
  [390, 1],
  [430, 1.5],
  [768, 1],
  [820, 1],
]) {
  const inner = cardInner(viewport, scale);
  const char = 12 * scale;
  assert.ok(inner >= char * 2, `${viewport}@${scale} card is narrower than two characters`);
  if (jaHint.length * char > inner) {
    assert.match(budget, /whitespace-normal/);
  }
}

console.log("PASS planning form responsive layout");
for (const [key, count] of Object.entries(expectedColumns)) {
  console.log(`  ${key}: ${count} column(s)`);
}
