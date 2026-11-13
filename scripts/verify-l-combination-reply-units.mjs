/**
 * L2 — unit checks for spec B–G (four locales, trigger and non-trigger):
 *  B reject-all (isRejectAllCombinationsReply / selection parsers / combinationRejectAll copy)
 *  C localized mix / all replies
 *  D ko ui-coverage insight sentences without batchim-dependent fixed particles after a quote
 *  E zh-TW combinationDatesUpdated uses「～」
 *  F home city display (서울 / ソウル, 新竹縣 vs 新竹市, ja 新北市)
 *  G normalizeCountryReference for 홍콩 / マカオ / 마카오 / SAR spellings
 * No network (fetch stubbed, must stay 0).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=120 scripts/verify-l-combination-reply-units.mjs
 */
import assert from "node:assert/strict";

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("NO_NETWORK"); };

const load = (p) => import(/* @vite-ignore */ `/${p}`);
const sugg = await load("src/lib/ai/destination-combination-suggestions.ts");
const selReply = await load("src/lib/ai/combination-selection-reply.ts");
const home = await load("src/lib/home-location-display.ts");
const cn = await load("src/lib/ai/destination-country-normalize.ts");
const { chatRuntimeCopy } = await load("src/lib/chat-runtime-copy.ts");
const { translate } = await load("src/lib/i18n/translate.ts");
const { buildHomePlusInsight } = await load("src/lib/home-personalization-insight.ts");

const fails = [];
let passes = 0;
const check = (name, fn) => {
  try { fn(); passes++; } catch (e) { fails.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 4).join("\n  ")}`); }
};

// ---------------------------------------------------------------- B reject-all
const REJECT = {
  "zh-TW": ["全部都不要", "都不要", "這些都不要", "一個都不要", "一組都不要", "都不喜歡", "這幾組都不適合"],
  en: ["none of them", "None.", "none", "neither", "neither of them", "I don't like any of them", "I don't want any of them", "no, none of them, sorry"],
  ja: ["どれもいらない", "どれもいらないです", "全部いらない", "どれも好きじゃない", "いずれも微妙"],
  ko: ["다 싫어요", "다 별로예요", "전부 싫어", "모두 필요 없어요", "둘 다 싫어"],
};
for (const [loc, list] of Object.entries(REJECT)) for (const t of list) {
  check(`B [${loc}] reject-all 「${t}」`, () => {
    assert.equal(sugg.isRejectAllCombinationsReply(t), true, "not recognised as reject-all");
    assert.equal(sugg.isUserAllOrAutoCombinationReply(t), false, "read as select-all");
    assert.deepEqual(sugg.parseCombinationSelectionIndices(t, 3), [], "selection indices");
  });
}
// The combination-selection reply parser (used by isNewTripPlanning / travel-context pending merge)
// must not read a reject-all as select-all either.
for (const t of ["全部都不要", "全部不要"]) {
  check(`B parseCombinationSelectionReply 「${t}」 selects nothing`, () => {
    const r = selReply.parseCombinationSelectionReply(t, { combinationCount: 3, primaryDestination: "雪梨" });
    assert.deepEqual(r.selectedCombinationIds, [], JSON.stringify(r));
  });
}
const NOT_REJECT = ["全部", "都可以", "都要", "1、3", "不要太累", "都不要太辣", "不要海邊", "all", "all of them", "neither day works", "none of them have museums?", "すべて", "전부", "다", "다 좋아요", "どれもいい"];
for (const t of NOT_REJECT) {
  check(`B not reject-all 「${t}」`, () => assert.equal(sugg.isRejectAllCombinationsReply(t), false));
}
for (const t of ["全部", "都可以", "all", "all of them", "すべて", "전부", "다", "1、3", "全部，也想去鎌倉"]) {
  check(`B still selects 「${t}」`, () => assert.ok(sugg.isUserAllOrAutoCombinationReply(t) || sugg.parseCombinationSelectionIndices(t, 3).length > 0));
}
for (const loc of ["zh-TW", "en", "ja", "ko"]) {
  check(`B copy combinationRejectAll ${loc} present and localized`, () => {
    const s = chatRuntimeCopy("combinationRejectAll", loc);
    assert.ok(s && !/combinationRejectAll/.test(s), s);
    if (loc === "en") assert.match(s, /^[\x20-\x7E’“”]+$/);
    if (loc === "ja") assert.match(s, /[\p{Script=Hiragana}]/u);
    if (loc === "ko") assert.match(s, /\p{Script=Hangul}/u);
    if (loc === "zh-TW") assert.match(s, /組合/);
    // Must ask the user to choose; not claim an itinerary is being generated.
    assert.doesNotMatch(s, /生成中|Planning your itinerary|旅程を整理|일정을 정리/);
  });
}

// ---------------------------------------------------------------- C mix / all
const MIX = ["mix them up", "Mix and match", "mix and match", "let's mix", "lets mix", "mix", "mix it up", "either is fine", "Either is fine.",
  "ミックスしてください", "おまかせでいいです", "おまかせ", "お任せします", "알아서 해", "알아서 해요", "알아서 해 주세요", "섞어서 해줘", "섞어줘", "섞어 주세요"];
for (const t of MIX) {
  check(`C mix 「${t}」 = all combinations`, () => {
    assert.equal(sugg.isUserAllOrAutoCombinationReply(t), true);
    assert.equal(sugg.isRejectAllCombinationsReply(t), false);
  });
}
for (const t of ["all good but change day 2", "mix day 2", "neither day works", "I like the mix of 1 and 2 but not 3", "おまかせコースは高い？", "알아서 해야 하나요?"]) {
  check(`C not all/mix 「${t}」`, () => assert.equal(sugg.isUserAllOrAutoCombinationReply(t), false));
}

// ---------------------------------------------------------------- D ko insight particles
const FIXED_AFTER_QUOTE = /”\s*(?:라고|이라고|라는|이라는|이고|고|이에요|예요|이며)/;
for (const key of ["insightProfile", "insightMoodSaved", "insightChatMood", "insightMood"]) {
  for (const value of ["맛집", "카페", "Chill", "여유"]) {
    check(`D ko ${key} value=${value} has no batchim-dependent particle after the quote`, () => {
      const s = translate("ko", `uiCoverage.${key}`, { chat: value, mood: value, facts: "느긋한 속도", categories: "카페" });
      assert.ok(s.includes(`“${value}”`), s);
      assert.doesNotMatch(s, FIXED_AFTER_QUOTE, s);
      assert.doesNotMatch(s, /\{[a-z]+\}/, s);
    });
  }
}
check("D ko buildHomePlusInsight mood (batchim value) renders naturally", () => {
  const s = buildHomePlusInsight({ savedPlaces: [], locale: "ko", selectedMood: "맛집" });
  assert.doesNotMatch(s, FIXED_AFTER_QUOTE, s);
});

// ---------------------------------------------------------------- E zh dates range
check("E zh-TW combinationDatesUpdated uses ～", () => {
  const s = chatRuntimeCopy("combinationDatesUpdated", "zh-TW", { start: "12/10", end: "12/13", days: 4 });
  assert.ok(s.includes("12/10～12/13"), s);
  assert.doesNotMatch(s, /12\/10\s*[-–~]\s*12\/13/, s);
});
for (const loc of ["en", "ja", "ko"]) {
  check(`E ${loc} combinationDatesUpdated renders start/end/days`, () => {
    const s = chatRuntimeCopy("combinationDatesUpdated", loc, { start: "12/10", end: "12/13", days: 4 });
    assert.ok(s.includes("12/10") && s.includes("12/13") && s.includes("4"), s);
    assert.doesNotMatch(s, /\{/, s);
  });
}

// ---------------------------------------------------------------- F home city display
const HOME = {
  "서울": { en: "Seoul", ja: "ソウル", ko: "서울" },
  "ソウル": { en: "Seoul", ja: "ソウル", ko: "서울" },
  "新北市": { en: "New Taipei", ja: "新北市" },
  "高雄市": { en: "Kaohsiung", ko: "가오슝" },
  "東京都": { en: "Tokyo", ko: "도쿄" },
};
for (const [city, by] of Object.entries(HOME)) for (const [loc, want] of Object.entries(by)) {
  check(`F home ${loc} 「${city}」 → ${want}`, () => assert.equal(home.resolveHomeLocationDisplayLabel(city, loc), want));
}
for (const loc of ["zh-TW", "en", "ja", "ko"]) {
  check(`F home ${loc} 新竹縣 and 新竹市 stay distinct`, () => {
    const county = home.resolveHomeLocationDisplayLabel("新竹縣", loc);
    const city = home.resolveHomeLocationDisplayLabel("新竹市", loc);
    assert.ok(county && city, `${county} / ${city}`);
    assert.notEqual(county, city, `${county} / ${city}`);
  });
  check(`F home ${loc} ja 新北市 never becomes bare 新北`, () => assert.notEqual(home.resolveHomeLocationDisplayLabel("新北市", loc), "新北"));
}
check("F home zh-TW keeps the reliable label as-is", () => {
  for (const c of ["新竹縣", "新竹市", "新北市", "서울", "ソウル"]) assert.equal(home.resolveHomeLocationDisplayLabel(c, "zh-TW"), c);
});
check("F home en 新竹縣 is a county name", () => assert.match(home.resolveHomeLocationDisplayLabel("新竹縣", "en"), /County/));
check("F home ja 新竹縣 keeps 県", () => assert.match(home.resolveHomeLocationDisplayLabel("新竹縣", "ja"), /県$/));
check("F home unknown label is returned unchanged (en)", () => assert.equal(home.resolveHomeLocationDisplayLabel("某某里", "en"), "某某里"));

// ---------------------------------------------------------------- G country normalize
for (const [raw, code] of [["홍콩", "HK"], ["Hong Kong", "HK"], ["Hong Kong SAR", "HK"], ["Hong Kong SAR, China", "HK"], ["香港特別行政區", "HK"], ["香港", "HK"],
  ["マカオ", "MO"], ["마카오", "MO"], ["Macao SAR", "MO"], ["Macau SAR", "MO"], ["Macao SAR, China", "MO"], ["Macau", "MO"], ["澳门", "MO"], ["澳門特別行政區", "MO"]]) {
  check(`G normalizeCountryReference 「${raw}」 → ${code}`, () => assert.equal(cn.normalizeCountryReference(raw).countryCode, code));
}
check("G 香港 and 澳門 stay distinct from China", () => {
  assert.notEqual(cn.normalizeCountryReference("홍콩").countryCode, "CN");
  assert.notEqual(cn.normalizeCountryReference("마카오").countryCode, "CN");
});

check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
out(fails.length ? `\nFAIL ${fails.length} / PASS ${passes}: ${fails.join(" | ")}` : `\nPASS all (${passes})`);
process.exit(fails.length ? 1 : 0);
