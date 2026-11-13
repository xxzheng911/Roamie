/**
 * TS-CHAT-L10N — destination display name + punctuation per locale in chat replies.
 *
 * Covers (deterministic, no network; fetch is stubbed and must stay at 0 calls):
 *  - displayDestinationForCopy: 雪梨 → Sydney / シドニー / 시드니; "Kyoto" input →
 *    en Kyoto, ja 京都, ko 교토 (spec ruling: ja/ko use the local-language name).
 *  - Every alias canonical: en/ko never Han, ja never the hiragana reading.
 *  - buildDestinationDirectionAck (range / days / open) for all four locales.
 *  - Real Discovery (mocked searchPlaces) → buildDestinationCombinationSuggestionPayload:
 *    combination rows and the date line (exact / tentative / start-only) in four locales,
 *    including place names that contain a comma ("St Mary's Cathedral, Sydney").
 *  - zh-TW displayText byte-equal to the HEAD formula (`：` / `、` / `～`).
 *  - buildNextStepAfterAdviceSelection combination_choice + buildPlanningContextSummary.
 *  - en / ko chat runtime copy uses ASCII apostrophes only.
 *  Round 2:
 *  - User-spelling fallback for alias-less canonicals (嘉義 / 宜蘭 / 花蓮 → Chiayi / Yilan /
 *    Hualien) and rejection of non-place replies ("yes", "3 days", …).
 *  - koParticle / applyKoParticles (batchim, no batchim, non-Hangul).
 *  - buildDefaultRoutesReply: zh-TW = HEAD formula; en/ja/ko have no zh names / CJK punct.
 *  - styleOptionDisplay through buildNextStepAfterAdviceSelection (美食咖啡 / 都可以).
 *  - Six new chat-runtime keys: zh-TW equals the HEAD inline copy.
 *
 * Run: npx vite-node scripts/verify-chat-destination-display-locale.mjs --config scripts/vite.verify.config.mjs
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};

let fetchCalls = 0;
globalThis.fetch = async (...args) => {
  fetchCalls++;
  throw new Error("NO_NETWORK in verify: " + String(args[0]));
};

const { displayDestinationForCopy, koParticle, applyKoParticles } = await import(
  "../src/lib/ai/destination-locale-aliases.ts"
);
const { buildDefaultRoutesReply, getDestinationStyleGuide } = await import(
  "../src/lib/ai/destination-style-guide.ts"
);
const { isSuggestionInDestinationScope } = await import("../src/lib/ai/destination-combination-suggestions.ts");
const { normalizeDestinationLabel } = await import("../src/lib/ai/trip-planning-context.ts");
const { USE_DEFAULT_ROUTES } = await import("../src/lib/ai/destination-pending-question.ts");
const { buildDestinationDirectionAck } = await import("../src/lib/ai/trip-duration-guard.ts");
const { discoverDestinationCombinations, clearDiscoveredCombinationsCache } = await import(
  "../src/lib/ai/destination-combination-discovery.ts"
);
const { buildDestinationCombinationSuggestionPayload } = await import(
  "../src/lib/ai/destination-combination-suggestions.ts"
);
const { buildNextStepAfterAdviceSelection } = await import("../src/lib/ai/destination-pending-question.ts");
const { buildPlanningContextSummary } = await import("../src/lib/ai/chat-turn-engine.ts");
const { chatRuntimeMessages } = await import("../src/lib/i18n/chat-runtime.ts");
const { chatRuntimeCopy } = await import("../src/lib/chat-runtime-copy.ts");

const LOCALES = ["zh-TW", "en", "ja", "ko"];
const HAN = /\p{Script=Han}/u;
const ZH_PUNCT = /[：、～]/;
const failures = [];
function check(name, fn) {
  try {
    fn();
    out(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    out(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").join("\n  ")}`);
  }
}

// ---------------------------------------------------------------- display names
check("display name: 雪梨 / 京都 per locale (spec ruling)", () => {
  const sydney = { "zh-TW": "雪梨", en: "Sydney", ja: "シドニー", ko: "시드니" };
  const kyoto = { "zh-TW": "京都", en: "Kyoto", ja: "京都", ko: "교토" };
  for (const locale of LOCALES) {
    assert.equal(displayDestinationForCopy("雪梨", undefined, locale), sydney[locale], `雪梨 ${locale}`);
    assert.equal(displayDestinationForCopy("雪梨", "Sydney trip", locale), sydney[locale], `雪梨+text ${locale}`);
    assert.equal(
      displayDestinationForCopy("京都", "I'd like to go to Kyoto", locale),
      kyoto[locale],
      `京都 from "Kyoto" ${locale}`,
    );
  }
});

check("display name: unknown Latin label falls back to the user's own spelling", () => {
  for (const locale of ["en", "ja", "ko"]) {
    assert.equal(displayDestinationForCopy("Hobart", "Hobart", locale), "Hobart");
  }
});

check("display name: every alias canonical — en/ko no Han, ja no hiragana reading", () => {
  const src = fs.readFileSync("src/lib/ai/destination-locale-aliases.ts", "utf8");
  const start = src.indexOf("const CITY_LOCALE_ALIASES");
  const block = src.slice(start, src.indexOf("};", start));
  const canonicals = [
    ...new Set([...block.matchAll(/^\s*(?:"[^"]+"|[^\s:"]+):\s*"([^"]+)"/gm)].map((m) => m[1])),
  ];
  assert.ok(canonicals.length >= 50, `parsed ${canonicals.length} canonicals`);
  const leaks = [];
  for (const c of canonicals) {
    const en = displayDestinationForCopy(c, undefined, "en");
    const ja = displayDestinationForCopy(c, undefined, "ja");
    const ko = displayDestinationForCopy(c, undefined, "ko");
    if (HAN.test(en)) leaks.push(`en ${c}→${en}`);
    if (HAN.test(ko)) leaks.push(`ko ${c}→${ko}`);
    if (/[぀-ゟ]/.test(ja)) leaks.push(`ja ${c}→${ja}`);
    assert.equal(displayDestinationForCopy(c, undefined, "zh-TW"), c);
  }
  assert.deepEqual(leaks, []);
});

// ---------------------------------------------------------------- direction ack
check("directionAck: range / days / open in four locales (zh-TW = HEAD copy)", () => {
  const range = {
    "zh-TW": "好，我先記下雪梨 2026/12/01～2026/12/05 的行程方向。",
    en: "I'll note Sydney, 2026/12/01–2026/12/05, as the trip direction.",
    ja: "シドニーで2026/12/01〜2026/12/05の旅程を考えていきます。",
    ko: "시드니 2026/12/01–2026/12/05 일정을 먼저 적어 둘게요.",
  };
  const days = {
    "zh-TW": "好，我先記下京都 3 天的行程方向。",
    en: "I'll note a 3-day direction for Kyoto.",
    ja: "京都で3日間の旅程を考えていきます。",
    ko: "교토 3일 일정을 먼저 적어 둘게요.",
  };
  const open = {
    "zh-TW": "好的，我們以雪梨為主往下規劃。",
    en: "Let's keep planning around Sydney.",
    ja: "シドニーを中心にこの先を計画します。",
    // Spec: ko particle follows the final consonant of the shown name (시드니 → 를).
    ko: "시드니를 중심으로 이어서 계획할게요.",
  };
  for (const locale of LOCALES) {
    assert.equal(
      buildDestinationDirectionAck({ destination: "雪梨", tripDays: 5, startDate: "2026-12-01", endDate: "2026-12-05", locale }),
      range[locale],
    );
    assert.equal(
      buildDestinationDirectionAck({ destination: "京都", tripDays: 3, locale, userText: "I'd like to go to Kyoto" }),
      days[locale],
    );
    assert.equal(buildDestinationDirectionAck({ destination: "雪梨", locale }), open[locale]);
  }
});

// ---------------------------------------------------------------- combination rows + date line
const mk = (i, name, type) => ({
  id: `ChIJSydVerify${i}`,
  name,
  lat: -33.86 + i * 0.001,
  lng: 151.2 + i * 0.001,
  types: [type],
  primaryType: type,
  rating: 4.6,
  userRatingCount: 5000,
  address: "Sydney NSW, Australia",
  businessStatus: "OPERATIONAL",
});
const POOL = [
  mk(1, "St Mary's Cathedral, Sydney", "tourist_attraction"),
  mk(2, "Sydney Opera House, Bennelong Point", "tourist_attraction"),
  mk(3, "Sydney Harbour Bridge", "tourist_attraction"),
  mk(4, "Royal Botanic Garden Sydney", "park"),
  mk(5, "Art Gallery of New South Wales", "museum"),
  mk(6, "Australian Museum", "museum"),
  mk(7, "Hyde Park", "park"),
  mk(8, "Bondi Beach", "tourist_attraction"),
  mk(9, "Taronga Zoo Sydney", "zoo"),
  mk(10, "Museum of Contemporary Art Australia", "museum"),
  mk(11, "The Rocks", "tourist_attraction"),
  mk(12, "Darling Harbour", "tourist_attraction"),
  mk(13, "Queen Victoria Building", "shopping_mall"),
  mk(14, "Centennial Park", "park"),
  mk(15, "Sea Life Sydney Aquarium", "aquarium"),
];

/** Independent restatement of the spec (not a copy of formatCombinationRow). */
function expectedRow(index, title, names, locale) {
  if (locale === "zh-TW" || locale === "ja") return `${index}. ${title}：${names.join("、")}`;
  const sep = names.some((n) => n.includes(",") || n.includes("，")) ? "; " : ", ";
  return `${index}. ${title}: ${names.join(sep)}`;
}
// Spec: date range is `2026/12/10–2026/12/12` (en dash, no surrounding spaces) for en / ko.
const DATE_EXACT = {
  "zh-TW": "旅行日期：2026/12/01～2026/12/05",
  en: "Travel dates: 2026/12/01–2026/12/05",
  ja: "旅行日程：2026/12/01〜2026/12/05",
  ko: "여행 날짜: 2026/12/01–2026/12/05",
};
const DATE_TENTATIVE = {
  "zh-TW": "暫定旅行日期：2026/12/01～2026/12/05",
  en: "Tentative travel dates: 2026/12/01–2026/12/05",
  ja: "仮の旅行日程：2026/12/01〜2026/12/05",
  ko: "잠정 여행 날짜: 2026/12/01–2026/12/05",
};
const DATE_START_ONLY = {
  "zh-TW": "旅行日期：2026/12/01",
  en: "Travel dates: 2026/12/01",
  ja: "旅行日程：2026/12/01",
  ko: "여행 날짜: 2026/12/01",
};

let sawLatinSemicolonRow = 0;
let sawLatinCommaRow = 0;
for (const locale of LOCALES) {
  clearDiscoveredCombinationsCache();
  let searchCalls = 0;
  const discovered = await discoverDestinationCombinations({
    destination: "雪梨",
    locale,
    searchPlaces: async () => {
      searchCalls++;
      return { places: POOL, error: null };
    },
  });
  check(`${locale} discovery fixture produced combinations (mock search only)`, () => {
    assert.ok(discovered?.length >= 2, `discovered=${discovered?.length}`);
    assert.ok(searchCalls >= 1);
  });

  const ack = buildDestinationDirectionAck({
    destination: "雪梨",
    tripDays: 5,
    startDate: "2026-12-01",
    endDate: "2026-12-05",
    locale,
  });
  const build = (extra) =>
    buildDestinationCombinationSuggestionPayload("雪梨", 5, { locale, weatherLine: ack, ...extra });
  const exact = build({ startDate: "2026-12-01", endDate: "2026-12-05", tentativeDates: false });
  const tentative = build({ startDate: "2026-12-01", endDate: "2026-12-05", tentativeDates: true });
  const startOnly = build({ startDate: "2026-12-01" });
  const noDate = buildDestinationCombinationSuggestionPayload("雪梨", 5, { locale });

  check(`${locale} combination rows + date lines`, () => {
    assert.ok(exact && tentative && startOnly && noDate, "payload must be deliverable");
    const lines = exact.displayText.split("\n");
    const rowLines = lines.filter((l) => /^\d+\. /.test(l));
    assert.equal(rowLines.length, exact.offeredCombinations.length);
    exact.offeredCombinations.forEach((combo, i) => {
      const names = combo.places.map((p) => p.localizedDisplayName || p.name);
      const row = expectedRow(i + 1, combo.title, names, locale);
      assert.equal(rowLines[i], row);
      if (locale === "en" || locale === "ko") {
        if (row.includes("; ")) sawLatinSemicolonRow++;
        else sawLatinCommaRow++;
      }
    });
    assert.ok(lines.includes(DATE_EXACT[locale]), `exact date line: ${JSON.stringify(lines)}`);
    assert.ok(tentative.displayText.split("\n").includes(DATE_TENTATIVE[locale]));
    assert.ok(startOnly.displayText.split("\n").includes(DATE_START_ONLY[locale]));
    assert.equal(lines[0], ack);
    if (locale === "en" || locale === "ko") {
      for (const p of [exact, tentative, startOnly, noDate]) {
        assert.doesNotMatch(p.displayText, ZH_PUNCT, "en/ko must not contain ：、～");
        assert.doesNotMatch(p.displayText, HAN, "en/ko must not contain Han (fixture names are Latin)");
        assert.doesNotMatch(p.displayText, /’/);
      }
    }
    if (locale === "ja") {
      for (const p of [exact, tentative, startOnly]) assert.doesNotMatch(p.displayText, /～/, "ja uses 〜 not ～");
      assert.doesNotMatch(exact.displayText, /雪梨/);
    }
    // No-weatherLine header uses the localized destination too.
    const noDateFirst = noDate.displayText.split("\n")[0];
    const shown = { "zh-TW": "雪梨", en: "Sydney", ja: "シドニー", ko: "시드니" }[locale];
    assert.ok(noDateFirst.includes(shown), noDateFirst);
  });

  if (locale === "zh-TW") {
    check("zh-TW displayText byte-equal to HEAD formula", () => {
      const rows = exact.offeredCombinations.map(
        (combo, i) =>
          `${i + 1}. ${combo.title}：${combo.places.map((p) => p.localizedDisplayName || p.name).join("、")}`,
      );
      const head = [
        "好，我先記下雪梨 2026/12/01～2026/12/05 的行程方向。",
        "",
        "以下是雪梨的建議組合搭配，你可以選一組或多組混搭：",
        "",
        ...rows,
        "",
        "旅行日期：2026/12/01～2026/12/05",
        "",
        "回覆你比較有興趣的組合，我來幫你生成行程。",
      ].join("\n");
      assert.equal(exact.displayText, head);
      assert.ok(exact.displayText.includes("St Mary's Cathedral, Sydney、"), "zh-TW keeps 、 even with commas");
    });
  }
}
check("comma-in-name case exercised: en/ko rows used '; ' and plain rows used ', '", () => {
  assert.ok(sawLatinSemicolonRow >= 2, `semicolon rows=${sawLatinSemicolonRow}`);
  assert.ok(sawLatinCommaRow >= 2, `comma rows=${sawLatinCommaRow}`);
});

// ---------------------------------------------------------------- pending-question + summary
check("combination_choice focus copy + planning summary per locale", () => {
  const pending = { type: "combination_choice", options: [], baseDestination: "雪梨" };
  const ctx = { interests: [], destination: "雪梨", days: 5 };
  const expected = {
    // zh-TW = HEAD output (titles joined with 、, canonical destination).
    "zh-TW": "好，我會以經典景點組合、海岸夕陽組合為主，幫你安排雪梨 5 天行程。",
    en: "I'll plan a 5-day trip in Sydney around Classic Sights, Coastal Sunset.",
    ja: "定番スポット、海岸サンセットを中心に、シドニーの5日間の旅程を組み立てます。",
    // Spec: 조합 ends in a final consonant → 을.
    ko: "클래식 명소 조합, 해안 노을 조합을 중심으로 시드니 5일 일정을 짤게요.",
  };
  for (const locale of LOCALES) {
    const titles = {
      "zh-TW": "經典景點組合|海岸夕陽組合",
      en: "Classic Sights|Coastal Sunset",
      ja: "定番スポット|海岸サンセット",
      ko: "클래식 명소 조합|해안 노을 조합",
    }[locale];
    const r = buildNextStepAfterAdviceSelection(titles, pending, ctx, locale);
    const first = r.reply.split("\n")[0];
    assert.equal(first, expected[locale]);
    const fallback = buildNextStepAfterAdviceSelection("x", { ...pending, baseDestination: undefined }, { interests: [] }, locale);
    if (locale !== "zh-TW") assert.doesNotMatch(fallback.reply, /這趟/);
    const summary = buildPlanningContextSummary({ interests: [], destination: "雪梨" }, locale).split("\n")[0];
    assert.equal(
      summary,
      { "zh-TW": "目的地：雪梨", en: "Destination: Sydney", ja: "目的地：シドニー", ko: "목적지: 시드니" }[locale],
    );
  }
});

check("en / ko chat runtime copy: ASCII apostrophe only", () => {
  for (const locale of ["en", "ko"]) {
    for (const [key, value] of Object.entries(chatRuntimeMessages[locale])) {
      assert.doesNotMatch(value, /[’‘]/, `${locale}.${key}`);
    }
  }
});

check("selection-diagnostics fixture copy matches runtime combinationSelectionNudge", () => {
  // Mirrors scripts/verify-combination-selection-diagnostics.mjs fallbackCopies (that script's
  // harness import can stall, so the copy contract is pinned here as well).
  // TS-CHAT-L10N: en/ja/ko now only ask for replies the parser accepts (numbers / “all”).
  const fixture = {
    "zh-TW": "我還不確定你想用哪幾組。請回覆組合編號（例如 1、3），或說「可以幫我生成」讓我混搭全部組合。",
    en: "I'm not sure which combinations you want. Reply with their numbers (for example, 1, 3), or reply with every number or “all” to use all combinations.",
    ja: "どの組み合わせをご希望か、まだ確認できていません。番号（例：1、3）を返信してください。すべて使う場合は、すべての番号か「すべて」と返信してください。",
    ko: "어떤 조합을 원하시는지 아직 확인하지 못했어요. 번호(예: 1, 3)를 보내 주세요. 모든 조합을 사용하려면 모든 번호를 보내거나 “전부”라고 보내 주세요.",
  };
  // Keep this pin and the diagnostics script fixture in lockstep (that script is not run here).
  const diag = fs.readFileSync("scripts/verify-combination-selection-diagnostics.mjs", "utf8");
  for (const locale of ["en", "ja", "ko"]) assert.ok(diag.includes(fixture[locale].replace(/'/g, "\\'")), `diagnostics fixture ${locale} out of date`);
  for (const locale of LOCALES) {
    assert.equal(chatRuntimeMessages[locale].combinationSelectionNudge, fixture[locale], locale);
  }
});

// ---------------------------------------------------------------- round 2: user-spelling fallback
const TW_CITIES = [
  ["嘉義", "Chiayi"],
  ["宜蘭", "Yilan"],
  ["花蓮", "Hualien"],
];
// Spec (TS-CHAT-L10N): Taiwan cities use the English name in en / ko (嘉義 → Chiayi) and kanji in
// ja (嘉義); names come from the display tables only and are never guessed from the user's text.
/** Expected display per spec; independent of displayDestinationForCopy. */
const twShown = (canonical, latin, locale) => (locale === "en" || locale === "ko" ? latin : canonical);

check("Taiwan cities 嘉義 / 宜蘭 / 花蓮: en/ko English name, ja kanji, zh canonical (with or without user text)", () => {
  for (const [canonical, latin] of TW_CITIES) {
    for (const text of [undefined, `${latin} 3 days`, `I want to go to ${latin} for 3 days`]) {
      assert.equal(displayDestinationForCopy(canonical, text, "zh-TW"), canonical, `zh-TW ${canonical} "${text}"`);
      for (const locale of ["en", "ja", "ko"]) {
        assert.equal(displayDestinationForCopy(canonical, text, locale), twShown(canonical, latin, locale), `${locale} ${canonical} "${text}"`);
      }
    }
    // Through the real ack builder.
    const text = `I want to go to ${latin} for 3 days`;
    assert.equal(
      buildDestinationDirectionAck({ destination: canonical, tripDays: 3, locale: "en", userText: text }),
      `I'll note a 3-day direction for ${latin}.`,
    );
    assert.equal(
      buildDestinationDirectionAck({ destination: canonical, tripDays: 3, locale: "ja", userText: text }),
      `${canonical}で3日間の旅程を考えていきます。`,
    );
    assert.equal(
      buildDestinationDirectionAck({ destination: canonical, tripDays: 3, locale: "ko", userText: text }),
      `${latin} 3일 일정을 먼저 적어 둘게요.`,
    );
    assert.equal(
      buildDestinationDirectionAck({ destination: canonical, tripDays: 3, locale: "zh-TW", userText: text }),
      `好，我先記下${canonical} 3 天的行程方向。`,
    );
  }
});

check("user text never changes the destination name: 'yes' / '3 days' / 'ok'", () => {
  for (const [canonical, latin] of TW_CITIES) {
    for (const text of ["yes", "Yes!", "3 days", "3days", "ok"]) {
      for (const locale of ["en", "ja", "ko"]) {
        const shown = displayDestinationForCopy(canonical, text, locale);
        assert.equal(shown, twShown(canonical, latin, locale), `${locale} ${canonical} "${text}"`);
        assert.equal(shown, displayDestinationForCopy(canonical, undefined, locale), `${locale} ${canonical} "${text}" = no-text result`);
      }
    }
  }
});

// Same "不從使用者的任意文字猜地名" rule: short Latin replies the product itself asks for (the
// “Create it for me” button label), combination titles typed back, and other known/unknown places
// must not change the name shown for the canonical destination.
check("user text never changes the destination name: chat replies / titles / other places", () => {
  const leaks = [];
  const texts = [
    "Create it for me",
    "create the itinerary",
    "all of them",
    "sounds good",
    "Classic Sights",
    "Classic Sights, Coastal Sunset",
    "plan it",
    "let's do it",
    "yes please",
    "Tokyo 3 days",
    "Hobart 3 days",
    // month / timing replies reach the pre-existing userText callers
    // (destination-season-reply, scenic-month-reply, ai-trip-style, city-days-planning).
    "December",
    "in December",
    "next week",
    "Taiwan 3 days",
  ];
  for (const [canonical, latin] of TW_CITIES) {
    for (const text of texts) {
      for (const locale of ["en", "ja", "ko"]) {
        const shown = displayDestinationForCopy(canonical, text, locale);
        if (shown !== twShown(canonical, latin, locale)) leaks.push(`${locale} ${canonical} "${text}" → "${shown}"`);
      }
    }
  }
  assert.deepEqual(leaks, []);
});

check("buildDestinationDirectionAck: a confirmation reply as userText does not change the name", () => {
  for (const [text, locale, expected] of [
    ["sounds good", "en", "I'll note a 3-day direction for Chiayi."],
    ["Create it for me", "en", "I'll note a 3-day direction for Chiayi."],
    ["all of them", "ko", "Chiayi 3일 일정을 먼저 적어 둘게요."],
    ["all of them", "ja", "嘉義で3日間の旅程を考えていきます。"],
  ]) {
    assert.equal(
      buildDestinationDirectionAck({ destination: "嘉義", tripDays: 3, locale, userText: text }),
      expected,
      `"${text}" ${locale}`,
    );
  }
});

{
  const { buildTravelDateAssessmentReply } = await import("../src/lib/ai/destination-season-reply.ts");
  check("pre-existing userText caller (buildTravelDateAssessmentReply): 'December' is not the name", () => {
    const reply = buildTravelDateAssessmentReply("嘉義", { interests: [], travelMonth: "12月" }, "December", "en");
    assert.ok(reply.startsWith("I've noted Chiayi in December."), JSON.stringify(reply));
  });
}

check("display without user text: Taiwan cities per spec; ko never shows Han", () => {
  for (const [canonical, latin] of TW_CITIES) {
    for (const locale of ["en", "ja", "ko"]) {
      assert.equal(displayDestinationForCopy(canonical, undefined, locale), twShown(canonical, latin, locale), `${locale} ${canonical}`);
    }
  }
  // Canonical with a Latin alias but no Hangul alias / display row: ko must not show Han.
  const src = fs.readFileSync("src/lib/ai/destination-locale-aliases.ts", "utf8");
  const start = src.indexOf("const CITY_LOCALE_ALIASES");
  const block = src.slice(start, src.indexOf("};", start));
  const canonicals = [
    ...new Set([...block.matchAll(/^\s*(?:"[^"]+"|[^\s:"]+):\s*"([^"]+)"/gm)].map((m) => m[1])),
  ];
  for (const c of canonicals) {
    assert.doesNotMatch(displayDestinationForCopy(c, "yes", "ko"), HAN, `ko ${c} with "yes"`);
    assert.doesNotMatch(displayDestinationForCopy(c, "3 days", "en"), HAN, `en ${c} with "3 days"`);
  }
});

// ---------------------------------------------------------------- round 2: koParticle / applyKoParticles
check("koParticle: batchim / no batchim / non-Hangul previous character", () => {
  // final consonant
  assert.equal(koParticle("서울", "을", "를"), "을");
  assert.equal(koParticle("조합", "을", "를"), "을");
  assert.equal(koParticle("부산", "이", "가"), "이");
  assert.equal(koParticle("멜버른", "은", "는"), "은");
  assert.equal(koParticle("방콕", "과", "와"), "과");
  // no final consonant
  assert.equal(koParticle("시드니", "을", "를"), "를");
  assert.equal(koParticle("교토", "이", "가"), "가");
  assert.equal(koParticle("파리", "은", "는"), "는");
  assert.equal(koParticle("다낭 ", "과", "와"), "과", "trailing space trimmed (낭 has batchim)");
  assert.equal(koParticle("하와이", "과", "와"), "와");
  // non-Hangul previous character → vowel form
  assert.equal(koParticle("Sydney", "을", "를"), "를");
  assert.equal(koParticle("Hobart", "이", "가"), "가");
  assert.equal(koParticle("嘉義", "은", "는"), "는");
  assert.equal(koParticle("123", "을", "를"), "를");
  assert.equal(koParticle("", "을", "를"), "를");
});

check("applyKoParticles: fixes only the particle right after the word; non-ko unchanged", () => {
  assert.equal(applyKoParticles("시드니을 중심으로", ["시드니"], "ko"), "시드니를 중심으로");
  assert.equal(applyKoParticles("서울를 중심으로", ["서울"], "ko"), "서울을 중심으로");
  assert.equal(applyKoParticles("교토은 좋아요.", ["교토"], "ko"), "교토는 좋아요.");
  assert.equal(applyKoParticles("부산가 좋아요", ["부산"], "ko"), "부산이 좋아요");
  assert.equal(applyKoParticles("서울와 부산", ["서울"], "ko"), "서울과 부산");
  assert.equal(applyKoParticles("시드니을", ["시드니"], "ko"), "시드니를", "end of string");
  // particle followed by Hangul is part of another word → untouched
  assert.equal(applyKoParticles("시드니이다", ["시드니"], "ko"), "시드니이다");
  // regex metacharacters in the word
  assert.equal(applyKoParticles("St. Kilda (Melbourne)을 중심으로", ["St. Kilda (Melbourne)"], "ko"),
    "St. Kilda (Melbourne)를 중심으로");
  for (const locale of ["zh-TW", "en", "ja", undefined]) {
    assert.equal(applyKoParticles("시드니을 중심으로", ["시드니"], locale), "시드니을 중심으로", String(locale));
  }
});

// ---------------------------------------------------------------- round 2: default routes
const CJK_FULLWIDTH_PUNCT = /[：、～，。！？（）「」『』；]/;
// Traditional-Chinese-only forms (ja uses 経/選/区/辺/点/体/験/対/国 … or katakana instead).
const ZH_ONLY_CHARS = /[這經區邊點體驗幾讓們來說對較濟爾雪梨蒙烏蘭國喀蘇曼邁]/;
const ROUTE_DESTS = ["蒙古", "日本", "泰國", "韓國", "雪梨", "京都", "東京", "首爾", "巴黎", "倫敦", "這趟"];

/** HEAD formula for zh-TW (independent restatement). */
function headDefaultRoutes(destination) {
  const label = normalizeDestinationLabel(destination);
  const guide = getDestinationStyleGuide(label);
  const routeList = guide.hotRoutes
    .filter((route) => isSuggestionInDestinationScope(route, label))
    .map((route, index) => `${index + 1}. ${route}`)
    .join("\n");
  return [
    `如果都可以，我會先用${label}經典熱門路線幫你抓方向。`,
    `${label}比較適合走${guide.themeDescription}：`,
    "",
    routeList,
    "",
    "你這趟大概想排幾天？我可以幫你抓 5～7 天或 8～10 天的節奏。",
  ].join("\n");
}

check("buildDefaultRoutesReply zh-TW byte-equal to HEAD formula (default arg and explicit)", () => {
  for (const d of [...ROUTE_DESTS, "嘉義"]) {
    const head = headDefaultRoutes(d);
    assert.equal(buildDefaultRoutesReply(d).reply, head, `${d} default locale`);
    assert.equal(buildDefaultRoutesReply(d, undefined, "zh-TW").reply, head, `${d} zh-TW`);
    const guide = getDestinationStyleGuide(normalizeDestinationLabel(d));
    for (const locale of LOCALES) {
      assert.deepEqual(
        buildDefaultRoutesReply(d, undefined, locale).durationOptions,
        guide.durationOptions,
        `${d} ${locale} durationOptions stay internal zh values`,
      );
    }
  }
});

check("buildDefaultRoutesReply en/ja/ko: no zh destination names, no CJK full-width punct (en/ko)", () => {
  const bad = [];
  for (const d of ROUTE_DESTS) {
    const label = normalizeDestinationLabel(d);
    const guide = getDestinationStyleGuide(label);
    for (const locale of ["en", "ja", "ko"]) {
      const reply = buildDefaultRoutesReply(d, undefined, locale).reply;
      if (locale !== "ja") {
        if (HAN.test(reply)) bad.push(`${locale} ${d} Han: ${JSON.stringify(reply)}`);
        if (CJK_FULLWIDTH_PUNCT.test(reply)) bad.push(`${locale} ${d} punct: ${JSON.stringify(reply)}`);
      } else {
        if (/[～，]/.test(reply)) bad.push(`ja ${d} zh punct: ${JSON.stringify(reply)}`);
        if (ZH_ONLY_CHARS.test(reply)) bad.push(`ja ${d} zh-only chars: ${JSON.stringify(reply)}`);
        // Raw zh route names may only appear when the ja display is the same kanji.
        for (const route of guide.hotRoutes) {
          if (reply.includes(route) && displayDestinationForCopy(route, undefined, "ja") !== route) {
            bad.push(`ja ${d} raw zh route ${route}`);
          }
        }
      }
      if (/這趟/.test(reply)) bad.push(`${locale} ${d} 這趟`);
      const lines = reply.split("\n");
      assert.ok(lines.length >= 3, `${locale} ${d} shape`);
      const rows = lines.filter((l) => /^\d+\. /.test(l));
      rows.forEach((row, i) => assert.ok(row.startsWith(`${i + 1}. `), `${locale} ${d} numbering`));
      if (!rows.length) {
        assert.doesNotMatch(lines[1], /[:：]$/, `${locale} ${d}: theme line must not end in a colon without a list`);
      }
    }
  }
  assert.deepEqual(bad, []);
  // Spot-check exact copy.
  assert.equal(
    buildDefaultRoutesReply("雪梨", undefined, "ko").reply.split("\n")[1].startsWith("시드니는 "),
    true,
    "ko 시드니 + 은/는 → 는",
  );
  assert.equal(
    buildDefaultRoutesReply("首爾", undefined, "ko").reply.split("\n")[1].startsWith("서울은 "),
    true,
    "ko 서울 + 은/는 → 은",
  );
  assert.equal(
    buildDefaultRoutesReply("京都", undefined, "en").reply.split("\n")[0],
    "If you're open to anything, I'll start with classic popular routes in Kyoto.",
  );
  assert.equal(
    buildDefaultRoutesReply("京都", undefined, "ja").reply.split("\n")[0],
    "特にこだわりがなければ、京都の定番人気ルートから方向を決めます。",
  );
});

check("buildDefaultRoutesReply via destination_style_choice + USE_DEFAULT_ROUTES keeps internal values", () => {
  for (const locale of LOCALES) {
    const pending = { type: "destination_style_choice", options: [], baseDestination: "京都" };
    const r = buildNextStepAfterAdviceSelection(USE_DEFAULT_ROUTES, pending, { interests: [] }, locale);
    assert.equal(r.reply, buildDefaultRoutesReply("京都", undefined, locale).reply, locale);
    assert.equal(r.pendingQuestion.baseDestination, "京都");
    assert.equal(r.pendingQuestion.type, "duration_choice");
  }
});

// Known gap (ticket item 5 adjacent): no userText reaches buildDefaultRoutesReply, so a
// destination without any alias (嘉義) can only show the canonical label in en / ko.
check("buildDefaultRoutesReply en/ko for alias-less 嘉義: report Han leak (known gap)", () => {
  const leaks = [];
  for (const locale of ["en", "ko"]) {
    const reply = buildDefaultRoutesReply("嘉義", undefined, locale).reply;
    if (HAN.test(reply)) leaks.push(`${locale}: ${JSON.stringify(reply)}`);
  }
  // Spec: Taiwan cities show their English name in en / ko, so this is no longer a known gap.
  assert.deepEqual(leaks, []);
});

// ---------------------------------------------------------------- round 2: style option display
check("style 美食咖啡 / 都可以 replies (ask_preference, destination_style_choice) per locale", () => {
  const ctxNoDays = { interests: [] };
  const ctx5 = { interests: [], days: 5 };
  const prefKyoto = { type: "ask_preference", options: [], baseDestination: "京都" };
  const expectNoDays = {
    美食咖啡: {
      "zh-TW": "好，那我會把京都排成美食咖啡方向。你這趟大概幾天？",
      en: "I'll plan Kyoto with a food & café focus. About how many days is this trip?",
      ja: "京都はグルメ＆カフェを中心に計画します。この旅は何日くらいの予定ですか？",
      ko: "교토는 맛집·카페 중심으로 계획할게요. 이번 여행은 대략 며칠인가요?",
    },
    都可以: {
      "zh-TW": "好，那我會把京都排成混合方向。你這趟大概幾天？",
      en: "I'll plan Kyoto with a mixed focus. About how many days is this trip?",
      ja: "京都はバランス型を中心に計画します。この旅は何日くらいの予定ですか？",
      ko: "교토는 다양한 테마 중심으로 계획할게요. 이번 여행은 대략 며칠인가요?",
    },
  };
  const expectDays = {
    美食咖啡: {
      "zh-TW": "好，那我會把京都 5 天排成美食咖啡方向。",
      en: "I'll plan 5 days in Kyoto with a food & café focus.",
      ja: "京都の5日間をグルメ＆カフェ中心に計画します。",
      ko: "교토 5일을 맛집·카페 중심으로 계획할게요.",
    },
    都可以: {
      "zh-TW": "好，那我會把京都 5 天排成混合方向。",
      en: "I'll plan 5 days in Kyoto with a mixed focus.",
      ja: "京都の5日間をバランス型中心に計画します。",
      ko: "교토 5일을 다양한 테마 중심으로 계획할게요.",
    },
  };
  const expectStyleChoice = {
    美食咖啡: {
      "zh-TW": ["好，那我會幫你把首爾排成美食咖啡方向。", "我會先抓首爾適合美食咖啡的經典區域，節奏不會排太滿。"],
      en: ["I'll plan Seoul with a food & café focus.", "I'll start with well-known areas in Seoul that fit food & café, and keep the pace light."],
      ja: ["ソウルはグルメ＆カフェを中心に計画します。", "ソウルでグルメ＆カフェに合う定番エリアから始め、詰め込みすぎないペースにします。"],
      ko: ["서울은 맛집·카페 중심으로 계획할게요.", "서울에서 맛집·카페에 맞는 대표 지역부터 시작하고, 일정을 빡빡하게 잡지 않을게요."],
    },
    都可以: {
      "zh-TW": ["好，那我會幫你把首爾排成都可以方向。", "我會先抓首爾適合都可以的經典區域，節奏不會排太滿。"],
      en: ["I'll plan Seoul with a mixed focus.", "I'll start with well-known areas in Seoul that fit mixed, and keep the pace light."],
      ja: ["ソウルはバランス型を中心に計画します。", "ソウルでバランス型に合う定番エリアから始め、詰め込みすぎないペースにします。"],
      ko: ["서울은 다양한 테마 중심으로 계획할게요.", "서울에서 다양한 테마에 맞는 대표 지역부터 시작하고, 일정을 빡빡하게 잡지 않을게요."],
    },
  };
  for (const selected of ["美食咖啡", "都可以"]) {
    for (const locale of LOCALES) {
      const a = buildNextStepAfterAdviceSelection(selected, prefKyoto, ctxNoDays, locale);
      assert.equal(a.reply, expectNoDays[selected][locale], `ask_preference no days ${selected} ${locale}`);
      assert.equal(a.pendingQuestion.baseDestination, "京都", "internal destination stays canonical");
      const b = buildNextStepAfterAdviceSelection(selected, prefKyoto, ctx5, locale);
      assert.equal(b.reply.split("\n")[0], expectDays[selected][locale], `ask_preference 5 days ${selected} ${locale}`);
      assert.equal(b.pendingQuestion.baseDestination, "京都");
      const c = buildNextStepAfterAdviceSelection(
        selected,
        { type: "destination_style_choice", options: [], baseDestination: "首爾" },
        ctxNoDays,
        locale,
      );
      const [l1, l2] = c.reply.split("\n");
      assert.deepEqual([l1, l2], expectStyleChoice[selected][locale], `style_choice ${selected} ${locale}`);
      assert.equal(c.pendingQuestion.baseDestination, "首爾");
      assert.deepEqual(c.pendingQuestion.options, getDestinationStyleGuide("首爾").durationOptions ?? ["5 天", "7 天", "10 天"]);
      if (locale === "en" || locale === "ko") assert.doesNotMatch(c.reply + a.reply + b.reply, HAN, `${locale} ${selected}`);
    }
  }
});

// ---------------------------------------------------------------- round 2: new runtime keys
check("chat-runtime new keys: zh-TW values byte-equal to the HEAD inline copy; all locales present", () => {
  const head = {
    combinationAllLocked: "好，我先記下全部組合：{styles}。",
    combinationAllLockedGenerate: "回覆「幫我生成」就可以開始排 {destination} {days} 天行程。",
    combinationSelectionRequired: "我還需要你確認想用哪些組合，才能幫你生成行程。回覆組合編號，或回「都不錯」全選。",
    defaultRoutesIntro: "如果都可以，我會先用{destination}經典熱門路線幫你抓方向。",
    defaultRoutesTheme: "{destination}比較適合走{theme}：",
    defaultRoutesDaysAsk: "你這趟大概想排幾天？我可以幫你抓 5～7 天或 8～10 天的節奏。",
  };
  for (const [key, value] of Object.entries(head)) {
    assert.equal(chatRuntimeMessages["zh-TW"][key], value, `zh-TW.${key}`);
    const vars = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const locale of ["en", "ja", "ko"]) {
      const v = chatRuntimeMessages[locale][key];
      assert.ok(typeof v === "string" && v.length, `${locale}.${key} present`);
      assert.deepEqual([...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), vars, `${locale}.${key} placeholders`);
      if (locale !== "ja") assert.doesNotMatch(v, HAN, `${locale}.${key} no Han`);
      if (locale === "ja") assert.doesNotMatch(v, /～/, `ja.${key} uses 〜`);
    }
  }
  // Interpolated zh output equals the HEAD template literals.
  const labelList = "經典景點組合、海岸夕陽組合";
  assert.equal(
    chatRuntimeCopy("combinationAllLocked", "zh-TW", { styles: labelList }),
    `好，我先記下全部組合：${labelList}。`,
  );
  assert.equal(
    chatRuntimeCopy("combinationAllLockedGenerate", "zh-TW", { destination: "雪梨", days: 5 }),
    `回覆「幫我生成」就可以開始排 雪梨 5 天行程。`,
  );
});

{
  const { isCreateItineraryIntent } = await import("../src/lib/ai/chat-context-intent.ts");
  const { isUserAllOrAutoCombinationReply } = await import("../src/lib/ai/destination-combination-suggestions.ts");
  const { chatShortcutLabel, chatShortcutContract } = await import("../src/lib/chat-shortcut-chips.ts");
  // Spec: whatever the copy tells the user to reply or tap must work.
  //  - zh combinationAllLockedGenerate: reply 「幫我生成」 → create intent (HEAD).
  //  - en/ja/ko combinationAllLockedGenerate: tap the “Create it for me” chip → the quoted text is
  //    the chip label, and the chip sends the zh routing payload 幫我生成 (generate_itinerary).
  //  - combinationSelectionRequired: zh 「都不錯」 / en “all” / ja 「すべて」 / ko “전부” → select all.
  check("new copy: every reply / button it names is recognized", () => {
    const missed = [];
    for (const locale of LOCALES) {
      const quotedOf = (key) => [...chatRuntimeMessages[locale][key].matchAll(/[“「]([^”」]+)[”」]/g)].map((m) => m[1]);
      for (const phrase of quotedOf("combinationAllLockedGenerate")) {
        if (locale === "zh-TW") {
          if (!isCreateItineraryIntent(phrase)) missed.push(`zh-TW.combinationAllLockedGenerate “${phrase}” not create`);
        } else {
          if (phrase !== chatShortcutLabel("幫我生成", locale)) missed.push(`${locale}.combinationAllLockedGenerate “${phrase}” is not the chip label`);
          const contract = chatShortcutContract("幫我生成", locale);
          if (contract.canonicalIntent !== "generate_itinerary" || !isCreateItineraryIntent(contract.routingPayload)) {
            missed.push(`${locale} chip contract ${JSON.stringify(contract)}`);
          }
        }
      }
      for (const phrase of quotedOf("combinationSelectionRequired")) {
        if (!isUserAllOrAutoCombinationReply(phrase)) missed.push(`${locale}.combinationSelectionRequired “${phrase}” not select-all`);
      }
    }
    assert.deepEqual(missed, []);
  });
}

check("no network: fetch never called", () => assert.equal(fetchCalls, 0));

if (failures.length) {
  out(`FAIL ${failures.length} check(s): ${failures.join(" | ")}`);
  process.exit(1);
}
out("PASS chat destination display locale: names, directionAck, combination rows, date lines, zh-TW HEAD parity");
process.exit(0);
