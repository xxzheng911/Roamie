/**
 * A8 — en place-name articles (src/lib/i18n/en-place-articles.ts) + translate() site-wide sampling.
 *
 *  1. Unit: every listed name × every preposition / verb template gets "the"; sentence-initial,
 *     title-style, already-"the" and lowercase-context cases are not doubled; ja / ko / zh-TW unchanged.
 *  2. Site-wide: every en dictionary string with {vars} (i18nMessages.en, i.e. everything translate()
 *     serves) is filled with a listed name and with a plain name. Output must equal plain
 *     interpolation except "the " inserted exactly where a placeholder follows one of the trigger
 *     words; no "the the"; plain names never change. Keys whose changed variable is not
 *     place-like are listed for review.
 *  3. Builders that post-process whole en text (static article call sites) are listed.
 *
 * No network (fetch stubbed, must stay 0). Watchdog ends the run.
 * Run: npx vite-node scripts/verify-en-place-articles.mjs --config scripts/vite.verify.config.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => {
  out("FAIL watchdog: run exceeded time limit");
  process.exit(3);
}, 120_000).unref();

let fetchCalls = 0;
globalThis.fetch = async (...args) => {
  fetchCalls++;
  throw new Error("NO_NETWORK in verify: " + String(args[0]));
};

const { applyEnglishPlaceArticles, englishNameInSentence, EN_NAMES_WITH_ARTICLE } = await import("../src/lib/i18n/en-place-articles.ts");
const { translate } = await import("../src/lib/i18n/translate.ts");
const { i18nMessages } = await import("../src/lib/i18n/messages.ts");

const failures = [];
const SAMPLES = [];
function check(name, fn) {
  try {
    fn();
    out(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    out(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").join("\n  ")}`);
  }
}

const PREPS = ["in", "for", "to", "around", "of", "from", "at", "across", "explore", "visit", "through", "note", "noted", "plan"];
const NAMES = [...EN_NAMES_WITH_ARTICLE];
const PLAIN = ["Kyoto", "Sydney", "Taipei", "Chiayi", "Seoul", "Busan", "Japan", "France", "Bali"];

// ---------------------------------------------------------------- 1. unit
check("every listed name × every trigger word gets exactly one “the”", () => {
  const bad = [];
  for (const name of NAMES) {
    for (const p of PREPS) {
      const src = `Let's plan ${p} ${name} next.`;
      const want = `Let's plan ${p} the ${name} next.`;
      const got = applyEnglishPlaceArticles(src, "en");
      if (got !== want) bad.push(`${JSON.stringify(src)} → ${JSON.stringify(got)}`);
      // Capitalised trigger at sentence start ("In Netherlands, …").
      const cap = p[0].toUpperCase() + p.slice(1);
      const got2 = applyEnglishPlaceArticles(`${cap} ${name}, it rains.`, "en");
      if (got2 !== `${cap} the ${name}, it rains.`) bad.push(`cap ${cap} ${name} → ${JSON.stringify(got2)}`);
    }
  }
  assert.deepEqual(bad, []);
});

check("sentence-initial / title / already “the” / plain names are unchanged; idempotent", () => {
  const bad = [];
  for (const name of NAMES) {
    const same = [
      `${name} is lovely in December.`,
      `${name} · 3-day trip`,
      `${name}: must-visit places`,
      `Slow couple trip ideas for the ${name}`,
      `in the ${name}`,
      `explore The ${name}`,
      `Kyoto, ${name}, Osaka`,
    ];
    for (const s of same) {
      const got = applyEnglishPlaceArticles(s, "en");
      if (got !== s) bad.push(`${JSON.stringify(s)} → ${JSON.stringify(got)}`);
    }
    const once = applyEnglishPlaceArticles(`Trip to ${name}`, "en");
    if (applyEnglishPlaceArticles(once, "en") !== once) bad.push(`not idempotent: ${once}`);
    if (/\bthe\s+the\b/i.test(once)) bad.push(`double the: ${once}`);
  }
  for (const name of PLAIN) {
    for (const p of PREPS) {
      const s = `Plan ${p} ${name}.`;
      if (applyEnglishPlaceArticles(s, "en") !== s) bad.push(`plain changed: ${s}`);
    }
  }
  assert.deepEqual(bad, []);
});

check("“Gobi Desert” wins over “Gobi”; no partial-word matches (into / onto / Netherlandsish)", () => {
  assert.equal(applyEnglishPlaceArticles("Camp in Gobi Desert tonight", "en"), "Camp in the Gobi Desert tonight");
  assert.equal(applyEnglishPlaceArticles("Camp in Gobi tonight", "en"), "Camp in the Gobi tonight");
  for (const s of ["Fly into Maldives", "Step onto Red Sea", "in Netherlandsish style", "plan2 to Maldivesx"]) {
    assert.equal(applyEnglishPlaceArticles(s, "en"), s, s);
  }
});

check("ja / ko / zh-TW / undefined locale: never touched", () => {
  const bad = [];
  for (const locale of ["ja", "ko", "zh-TW", undefined]) {
    for (const name of NAMES) {
      const s = `trip to ${name} / ${name}への旅 / ${name}로 여행 / 去${name}`;
      if (applyEnglishPlaceArticles(s, locale) !== s) bad.push(`${locale}: ${s}`);
      if (englishNameInSentence(name, locale ?? "ja") !== name) bad.push(`englishNameInSentence ${locale} ${name}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.equal(englishNameInSentence("Netherlands", "en"), "the Netherlands");
  assert.equal(englishNameInSentence(" french riviera ", "en"), "the french riviera");
  assert.equal(englishNameInSentence("Kyoto", "en"), "Kyoto");
});

// A9: same-line only (a name starting the next line is a title) + note / noted / plan triggers.
check("A9: note / noted / plan add “the”; never across a line break; no doubling; word boundaries hold", () => {
  const cases = [
    ["I'll plan Netherlands first", "I'll plan the Netherlands first"],
    ["Noted Maldives — beaches it is.", "Noted the Maldives — beaches it is."],
    ["Please note Philippines has a rainy season.", "Please note the Philippines has a rainy season."],
    ["plan\tGold Coast", "plan\tthe Gold Coast"],
    ["Plan  Gobi Desert", "Plan  the Gobi Desert"],
    // unchanged
    ["Places worth a visit\nNetherlands · 3-day trip", null],
    ["Trip plan\nNetherlands · 3 days", null],
    ["Noted:\nMaldives", null],
    ["Noted\nMaldives", null],
    ["travel to\r\nNetherlands", null],
    ["noted the Philippines", null],
    ["plan The Netherlands", null],
    ["planning Netherlands", null],
    ["footnote Maldives", null],
    ["notes Maldives", null],
    ["planned Netherlands", null],
    ["noted Kyoto", null],
    ["plan Japan", null],
  ];
  const bad = [];
  for (const [src, want] of cases) {
    const got = applyEnglishPlaceArticles(src, "en");
    if (got !== (want ?? src)) bad.push(`${JSON.stringify(src)} → ${JSON.stringify(got)} (want ${JSON.stringify(want ?? src)})`);
    if (applyEnglishPlaceArticles(got, "en") !== got) bad.push(`not idempotent: ${JSON.stringify(got)}`);
    for (const l of ["ja", "ko", "zh-TW"]) if (applyEnglishPlaceArticles(src, l) !== src) bad.push(`${l} changed: ${src}`);
    SAMPLES.push(`A9 ${JSON.stringify(src)} → ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- 2. site-wide translate() sampling
function leaves(node, prefix, acc) {
  if (typeof node === "string") acc.push([prefix, node]);
  else if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) leaves(v, prefix ? `${prefix}.${k}` : k, acc);
  }
  return acc;
}
const EN = leaves(i18nMessages.en, "", []).filter(([, v]) => /\{\w+\}/.test(v));
// A9: same-line whitespace only (spec: never across a line break).
const TRIGGER_TAIL = new RegExp(`\\b(?:${PREPS.join("|")})[ \\t]+$`, "i");
const PLACE_VAR = /dest|city|place|country|region|location|area|label|name|where|spot|venue|from|to|origin|base|stop|title|trip|scope/i;

/** Independent expectation: interpolate; insert "the " where the placeholder follows a trigger word. */
function expected(template, vars, listed) {
  // Pass 1: plain interpolation, remembering where each value sits.
  let plain = "";
  let last = 0;
  const spots = [];
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    plain += template.slice(last, m.index);
    const v = String(vars[m[1]] ?? "");
    spots.push({ at: plain.length, v });
    plain += v;
    last = m.index + m[0].length;
  }
  plain += template.slice(last);
  // Pass 2: insert "the " where a listed value follows a trigger word and ends on a word boundary.
  let outText = plain;
  for (const { at, v } of [...spots].reverse()) {
    if (!listed.has(v)) continue;
    const after = plain.charAt(at + v.length);
    if (!TRIGGER_TAIL.test(plain.slice(0, at)) || /\w/.test(after)) continue;
    outText = outText.slice(0, at) + "the " + outText.slice(at);
  }
  return outText;
}

const changedNonPlace = new Map();
let listedChanged = 0;
check(`site-wide: ${EN.length} en strings with {vars} — only trigger-word positions get “the”; plain names never change`, () => {
  assert.ok(EN.length > 50, `too few en strings with vars (${EN.length})`);
  const bad = [];
  const listedSet = new Set(NAMES);
  for (const [key, template] of EN) {
    const varNames = [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
    // a) plain names: identical to naive interpolation
    for (const plain of PLAIN) {
      const vars = Object.fromEntries(varNames.map((v) => [v, plain]));
      const naive = template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
      const got = translate("en", key, vars);
      if (got !== naive) bad.push(`plain ${key} [${plain}]: ${JSON.stringify(got)} vs ${JSON.stringify(naive)}`);
    }
    // b) listed names: one var at a time (others numeric), then all vars
    for (const name of NAMES) {
      // Non-target vars get a realistic non-place filler (styleChoiceIntro {days} is " (3 days)").
      // All-vars-same-name is skipped for adjacent placeholders ("{destination}{days}"): "Gobi DesertGobi Desert" is not real input.
      const sets = [...varNames.map((target) => Object.fromEntries(varNames.map((v) => [v, v === target ? name : " (3 days)"]))), ...(/\}\{/.test(template) ? [] : [Object.fromEntries(varNames.map((v) => [v, name]))])];
      for (const vars of sets) {
        const got = translate("en", key, vars);
        const want = expected(template, vars, listedSet);
        if (got !== want) bad.push(`listed ${key} ${JSON.stringify(vars)}:\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
        if (/\bthe\s+the\b/i.test(got) && !/\bthe\s+the\b/i.test(template)) bad.push(`double the ${key}: ${got}`);
        const naive = template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
        if (got !== naive) {
          listedChanged++;
          for (const v of varNames) {
            if (vars[v] !== name) continue;
            const idx = template.indexOf(`{${v}}`);
            const before = template.slice(0, idx);
            if (TRIGGER_TAIL.test(before) && !PLACE_VAR.test(v)) changedNonPlace.set(`${key}{${v}}`, `${before.slice(-30)}{${v}}`);
          }
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 40), [], `${bad.length} mismatches`);
});

check("site-wide: ja / ko / zh-TW translate() output equals plain interpolation for listed names", () => {
  const bad = [];
  for (const locale of ["ja", "ko", "zh-TW"]) {
    const all = leaves(i18nMessages[locale], "", []).filter(([, v]) => /\{\w+\}/.test(v));
    for (const [key, template] of all) {
      for (const name of ["Netherlands", "Gold Coast"]) {
        const vars = Object.fromEntries([...template.matchAll(/\{(\w+)\}/g)].map((m) => [m[1], name]));
        const naive = template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
        const got = translate(locale, key, vars);
        if (got !== naive) bad.push(`${locale} ${key}: ${got}`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} mismatches`);
});

check("site-wide: en strings already containing a trigger word + listed name literally (static text) are listed", () => {
  const literal = leaves(i18nMessages.en, "", []).filter(([, v]) => NAMES.some((n) => new RegExp(`\\b(?:${PREPS.join("|")})\\s+${n.replace(/ /g, "\\s+")}\\b`, "i").test(v)));
  SAMPLES.push(`static en strings with "<trigger> <listed name>": ${literal.length ? literal.map(([k]) => k).join(", ") : "none"}`);
});

// ---------------------------------------------------------------- 3. call sites
check("call sites: translate() applies articles only for en; builders call applyEnglishPlaceArticles with locale", () => {
  const tr = fs.readFileSync("src/lib/i18n/translate.ts", "utf8");
  assert.match(tr, /locale === "en" \? applyEnglishPlaceArticles\(filled, locale\) : filled/);
  const files = ["src/lib/ai/must-visit-places.ts", "src/lib/ai/destination-place-recommendation.ts", "src/lib/ai/itinerary-planning.ts", "src/lib/ai/ai-trip-style.ts", "src/lib/ai/destination-season-reply.ts", "src/lib/i18n/plan-handoff-copy.ts", "src/routes/_app.chat.tsx"];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const calls = [...src.matchAll(/applyEnglishPlaceArticles\(/g)].length;
    assert.ok(calls >= 1, `${f}: no call`);
    SAMPLES.push(`call site ${f}: ${calls} call(s)`);
  }
  const chat = fs.readFileSync("src/routes/_app.chat.tsx", "utf8");
  assert.match(chat, /applyEnglishPlaceArticles\(`Slow couple trip ideas for \$\{shownDestination\}`, locale\)/);
});

// Samples
for (const [name, vars] of [["chatRuntime.directionAckDays", { destination: "Netherlands", days: 3 }], ["chatRuntime.directionAckOpen", { destination: "Maldives" }], ["chatRuntime.directionAckRange", { destination: "Philippines", start: "2026/12/01", end: "2026/12/05" }]]) {
  for (const locale of ["zh-TW", "en", "ja", "ko"]) SAMPLES.push(`[${locale}] ${name}: ${translate(locale, name, vars)}`);
}

check("no network: fetch never called", () => assert.equal(fetchCalls, 0));

out("\n================ SAMPLES ================");
out(`  en strings with vars: ${EN.length}; listed-name fills that changed output: ${listedChanged}`);
out(`  changed at a trigger word where the variable name is not place-like (${changedNonPlace.size}):`);
for (const [k, v] of changedNonPlace) out(`    ${k}: …${JSON.stringify(v)}`);
for (const l of SAMPLES) out("  " + l);
out("=========================================\n");

if (failures.length) {
  out(`FAIL ${failures.length} check(s): ${failures.join(" | ")}`);
  process.exit(1);
}
out("PASS en place articles: unit, site-wide translate sampling, call sites");
process.exit(0);
