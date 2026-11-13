/**
 * A7 — independent destination sweep: every Han canonical (alias table + display table +
 * EN_CITY_NAMES) through 17 reply builders that verify-chat-l10n-full-flow's 10-builder sweep
 * does not cover, four locales.
 *
 *  - en / ko: no Han / kana, no 「：、～，」, en no Hangul, date ranges `–` without spaces, `Day N`.
 *  - ja: no Traditional-only characters, no `～`, no `N天`, no Hangul, no 「地名 + 空格 + N日間」,
 *    `Day N`, numeric ranges use 〜.
 *  - ko: particle after the shown destination follows its final consonant (independent rule).
 *  - fallback cards (non-zh): address is the locale display name; en/ko visible fields have no Han.
 *  - zh-TW: every builder output byte-equal to the HEAD snapshot (child run with `--zh-only`).
 *
 * fetch stubbed (0 calls). Watchdog ends the run.
 * Run: npx vite-node scripts/verify-chat-l10n-destination-sweep.mjs --config scripts/vite.verify.config.mjs -- --head-dir=<snapshot>
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const ZH_ONLY = argv.includes("--zh-only");
const headDirArg = argv.find((a) => a.startsWith("--head-dir="))?.slice("--head-dir=".length);
const listArg = argv.find((a) => a.startsWith("--list="))?.slice("--list=".length);

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => {
  out("FAIL watchdog: run exceeded time limit");
  process.exit(3);
}, ZH_ONLY ? 280_000 : 560_000).unref();
let fetchCalls = 0;
globalThis.fetch = async (...args) => {
  fetchCalls++;
  throw new Error("NO_NETWORK in verify: " + String(args[0]));
};
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const M = {
  aliases: await load("src/lib/ai/destination-locale-aliases.ts"),
  guard: await load("src/lib/ai/trip-duration-guard.ts"),
  styleGuide: await load("src/lib/ai/destination-style-guide.ts"),
  tripStyle: await load("src/lib/ai/ai-trip-style.ts"),
  planning: await load("src/lib/ai/itinerary-planning.ts"),
  nativeQa: await load("src/lib/native-qa-display.ts"),
  season: await load("src/lib/ai/destination-season-reply.ts"),
  mustVisit: await load("src/lib/ai/must-visit-places.ts"),
  contextIntent: await load("src/lib/ai/chat-context-intent.ts"),
  landmark: await load("src/lib/ai/landmark-place-strategy.ts"),
  localFallback: await load("src/lib/ai/local-recommendation-fallback.ts"),
  session: await load("src/lib/chat-session.ts"),
};

function canonicals() {
  const src = readFileSync("src/lib/ai/destination-locale-aliases.ts", "utf8");
  const a0 = src.indexOf("const CITY_LOCALE_ALIASES");
  const aliasBlock = src.slice(a0, src.indexOf("};", a0));
  const d0 = src.indexOf("const CITY_DISPLAY_NAMES");
  const displayBlock = src.slice(d0, src.indexOf("\n};", d0));
  const displayKeys = [...displayBlock.matchAll(/^\s*([^\s:/]+):\s*\{\s*ja:/gm)].map((m) => JSON.parse(`"${m[1]}"`));
  return { aliasBlock, displayKeys };
}

const PLACES = ["A", "B", "C"].map((n, i) => ({ id: `ChIJSweep${i}`, placeId: `ChIJSweep${i}`, name: `Spot ${n}`, lat: 35 + i * 0.01, lng: 135 + i * 0.01, types: ["tourist_attraction"], rating: 4.5, userRatingCount: 1000, address: "Somewhere" }));

function safe(fn) {
  try {
    const v = fn();
    return v == null ? "<null>" : typeof v === "string" ? v : JSON.stringify(v);
  } catch (e) {
    return `<error ${String(e?.message ?? e).slice(0, 80)}>`;
  }
}
function builders(d, L) {
  return {
    season: safe(() => M.season.buildBestTravelTimeReply(d, { locale: L })),
    dateAssess: safe(() => M.season.buildTravelDateAssessmentReply(d, { interests: [], travelMonth: "12月" }, undefined, L)),
    mustVisit: safe(() => M.mustVisit.buildMustVisitPlacesReply({ interests: [], destination: d, days: 3 }, L)),
    dailyRhythm: safe(() => M.mustVisit.buildDailyRhythmReply({ interests: [], destination: d, days: 4 }, L)),
    planningAB: safe(() => M.planning.buildItineraryPlanningReply({ interests: [], destination: d, days: 4 }, [], L)),
    dailyRecs: safe(() => M.planning.buildDailyRecommendationsReply({ interests: [], destination: d, days: 3 }, [], L)),
    styleQ: safe(() => M.styleGuide.buildDestinationStyleChoiceQuestion(d, { days: 3, month: "12月", locale: L })),
    createAck: safe(() => M.contextIntent.buildCreateItineraryAckReply({ destination: d, days: 3, preferences: [], locale: L })),
    tripStyle: safe(() => M.tripStyle.buildTripStyleSelectionAdviceResult("local_life", { interests: [], destination: d, days: 3 }, undefined, L).reply),
    buckets: safe(() => M.tripStyle.buildDayPlanSummaryFromBuckets(d, 2, "mixed", [{ day: 1, names: ["Spot A"] }, { day: 2, names: ["Spot B"] }], L)),
    tripCopy: safe(() => { const c = M.nativeQa.generatedTripCopy(d, 3, 9, L); return `${c.title}\n${c.summary}`; }),
    nearbyExt: safe(() => M.planning.itineraryGenerationStatusReply({ interests: [], destination: "東京", days: 5, nearbyExtensions: [d] }, L)),
    unresolvedExt: safe(() => M.planning.itineraryGenerationStatusReply({ interests: [], destination: "東京", days: 5, unresolvedNearbyExtensions: [d] }, L)),
    landmark: safe(() => M.landmark.buildLandmarkCompanionIntro({ label: d, nearestCity: d, kind: "landmark" }, "sunny", true, L)),
    ackRange: safe(() => M.guard.buildDestinationDirectionAck({ destination: d, tripDays: 3, startDate: "2026-12-10", endDate: "2026-12-12", locale: L })),
    localFallback: safe(() => M.localFallback.generateLocalRecommendationFallback({ context: { interests: [], destination: d }, session: M.session.createEmptySession(), locale: L, places: PLACES }).summary),
    fallbackCards: safe(() => M.mustVisit.buildNamedFallbackRecommendations(d, L).map((r) => ({ name: r.name, placeName: r.placeName, reason: r.reason, description: r.description, address: r.address }))),
  };
}

if (ZH_ONLY) {
  const list = JSON.parse(Buffer.from(listArg, "base64").toString("utf8"));
  const res = {};
  for (const d of list) res[d] = builders(d, "zh-TW");
  // Large payload: exit only after the pipe has flushed.
  process.stdout.write("@@ZH_JSON@@" + JSON.stringify({ res, fetchCalls }) + "@@END@@\n", () => process.exit(0));
  await new Promise(() => {});
}

const { aliasBlock, displayKeys } = canonicals();
const geocode = await load("src/lib/ai/destination-geocode.ts");
const CANON = [
  ...new Set([
    ...[...aliasBlock.matchAll(/^\s*(?:"[^"]+"|[^\s:"]+):\s*"([^"]+)"/gm)].map((m) => m[1]),
    ...displayKeys,
    ...Object.keys(geocode.EN_CITY_NAMES ?? {}),
  ]),
].filter((c) => /\p{Script=Han}/u.test(c));

const HAN = /\p{Script=Han}/u;
const KANA = /[぀-ヿ]/;
const HANGUL = /[가-힣]/;
const ZH_ONLY_CHARS = /[這們來說對經區邊點體驗讓麼裡從關當與發覺灣臺濟廣戶繩橫綠縣幫鐵覽樂圖舊藝寶實處應營劃畫歡氣鬆擇單雙傳滿澀廳啡你您嗎呢吧喔囉號趟]/gu;
function expectedKoParticle(word, particle) {
  const pairs = { 을: ["을", "를"], 를: ["을", "를"], 이: ["이", "가"], 가: ["이", "가"], 은: ["은", "는"], 는: ["은", "는"], 과: ["과", "와"], 와: ["과", "와"], 으로: ["으로", "로"], 로: ["으로", "로"] };
  const [withB, without] = pairs[particle];
  const code = word.trim().slice(-1).codePointAt(0);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return null;
  const jong = (code - 0xac00) % 28;
  if (particle === "으로" || particle === "로") return jong === 0 || jong === 8 ? "로" : "으로";
  return jong === 0 ? without : withB;
}

const failures = [];
function check(name, fn) {
  try {
    fn();
    out(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    out(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").slice(0, 60).join("\n  ")}`);
  }
}

const R = {};
for (const L of ["zh-TW", "en", "ja", "ko"]) {
  R[L] = {};
  for (const d of CANON) R[L][d] = builders(d, L);
}
const BUILDER_NAMES = Object.keys(R.en[CANON[0]]);
out(`destinations=${CANON.length} builders=${BUILDER_NAMES.length}`);

check("builders run without error in every locale", () => {
  const bad = [];
  for (const L of Object.keys(R)) for (const d of CANON) for (const [b, v] of Object.entries(R[L][d])) if (v.startsWith("<error")) bad.push(`${L} ${d} ${b}: ${v}`);
  assert.deepEqual(bad.slice(0, 40), [], `${bad.length} errors`);
});

for (const L of ["en", "ko"]) {
  check(`${L}: ${CANON.length} destinations × ${BUILDER_NAMES.length} builders — no Han / kana / CJK punct, Day N, ranges`, () => {
    const bad = [];
    for (const d of CANON) {
      for (const [b, v] of Object.entries(R[L][d])) {
        if (v === "<null>") continue;
        if (HAN.test(v)) bad.push(`${d} ${b} Han ${JSON.stringify([...new Set(v.match(/\p{Script=Han}+/gu))])}`);
        if (KANA.test(v)) bad.push(`${d} ${b} kana`);
        if (/[：、～，]/.test(v)) bad.push(`${d} ${b} punct ${JSON.stringify(v.match(/[：、～，]/g))}`);
        if (L === "en" && HANGUL.test(v)) bad.push(`${d} ${b} Hangul`);
        if (/Day\d/.test(v)) bad.push(`${d} ${b} Day without space`);
        for (const m of v.matchAll(/\d\s*[~〜]\s*\d|\d\s+[–-]\s+\d|\d\s+–|–\s+\d/g)) bad.push(`${d} ${b} range "${m[0]}"`);
      }
    }
    assert.deepEqual([...new Set(bad)].slice(0, 60), [], `${new Set(bad).size} issues`);
  });
}

check(`ja: ${CANON.length} destinations × ${BUILDER_NAMES.length} builders — no zh-only chars / ～ / N天 / Hangul / 「地名 N日間」, Day N, 〜 ranges`, () => {
  const bad = [];
  for (const d of CANON) {
    for (const [b, v] of Object.entries(R.ja[d])) {
      if (v === "<null>") continue;
      const zh = v.match(ZH_ONLY_CHARS);
      if (zh) bad.push(`${d} ${b} zh-only ${[...new Set(zh)].join("")}`);
      if (/～/.test(v)) bad.push(`${d} ${b} ～`);
      if (/\d\s*天/.test(v)) bad.push(`${d} ${b} 天`);
      if (HANGUL.test(v)) bad.push(`${d} ${b} Hangul`);
      for (const m of v.matchAll(/([^\s\d·・.．:：、。（(\n])[\u3000]+(\d+日間)/gu)) bad.push(`${d} ${b} name+space+N日間 "${m[0]}"`);
      if (/Day\d/.test(v)) bad.push(`${d} ${b} Day without space`);
      for (const m of v.matchAll(/\d+[月日時分]?\s*[–—~\-]\s*\d+/g)) if (!/^\d{4}\/\d{2}/.test(m[0])) bad.push(`${d} ${b} range "${m[0]}"`);
    }
  }
  assert.deepEqual([...new Set(bad)].slice(0, 60), [], `${new Set(bad).size} issues`);
});

check(`ko: particle after the shown destination (${CANON.length} destinations)`, () => {
  const bad = [];
  let latinParticle = 0;
  for (const d of CANON) {
    const shown = M.aliases.displayDestinationForCopy(d, undefined, "ko");
    const esc = shown.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const [b, v] of Object.entries(R.ko[d])) {
      for (const m of v.matchAll(new RegExp(`${esc}['’”]?(으로|을|를|이|가|은|는|과|와|로)(?=[\\s.,!?)]|$)`, "gu"))) {
        const exp = expectedKoParticle(shown, m[1]);
        if (exp === null) latinParticle++;
        else if (exp !== m[1]) bad.push(`${d}→${shown} ${b}: "${m[0]}" (expected ${exp})`);
      }
    }
  }
  out(`  ko: Latin-ending names followed directly by a particle (pronunciation-dependent, not asserted): ${latinParticle}`);
  assert.deepEqual([...new Set(bad)].slice(0, 60), [], `${new Set(bad).size} issues`);
});

check("fallback cards (non-zh): address = locale display name; en/ko visible fields have no Han", () => {
  const bad = [];
  let cards = 0;
  for (const L of ["en", "ja", "ko"]) {
    for (const d of CANON) {
      const list = JSON.parse(R[L][d].fallbackCards);
      const shown = M.aliases.displayDestinationForCopy(d, undefined, L);
      for (const c of list) {
        cards++;
        if (c.address !== shown) bad.push(`${L} ${d} address "${c.address}" (display "${shown}")`);
        if (L !== "ja") for (const [f, v] of Object.entries(c)) if (typeof v === "string" && HAN.test(v)) bad.push(`${L} ${d} ${f}=${JSON.stringify(v)}`);
      }
    }
  }
  out(`  fallback cards checked: ${cards}`);
  assert.deepEqual([...new Set(bad)].slice(0, 40), [], `${new Set(bad).size} issues`);
});

check(`zh-TW: ${CANON.length} × ${BUILDER_NAMES.length} outputs byte-equal to HEAD`, () => {
  const dir = headDirArg;
  assert.ok(dir && existsSync(join(dir, "src")), "pass -- --head-dir=<snapshot>");
  assert.ok(!existsSync(join(dir, "src/lib/ai/combination-partial-modify-reply.ts")), "snapshot must be HEAD source");
  const self = "scripts/verify-chat-l10n-destination-sweep.mjs";
  if (!existsSync(join(dir, self)) || readFileSync(join(dir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(dir, self));
  const list = Buffer.from(JSON.stringify(CANON), "utf8").toString("base64");
  const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--zh-only", `--list=${list}`],
    { cwd: dir, encoding: "utf8", timeout: 300_000, maxBuffer: 256 << 20 });
  const m = (r.stdout ?? "").match(/@@ZH_JSON@@([\s\S]*?)@@END@@/);
  assert.ok(m, `HEAD child produced no JSON (status ${r.status}): ${(r.stderr ?? "").slice(-1500)}`);
  const head = JSON.parse(m[1]);
  assert.equal(head.fetchCalls, 0);
  const diffs = [];
  for (const d of CANON) for (const b of BUILDER_NAMES) {
    if (R["zh-TW"][d][b] !== head.res[d][b]) diffs.push(`${d} ${b}\n    NOW  ${JSON.stringify(R["zh-TW"][d][b]).slice(0, 220)}\n    HEAD ${JSON.stringify(head.res[d][b]).slice(0, 220)}`);
  }
  assert.deepEqual(diffs.slice(0, 30), [], `${diffs.length} diffs`);
});

check("display name with user text: never the user's own casing / spelling (trusted table only)", () => {
  const bad = [];
  const cases = [["嘉義", "我想去 cHiAyI 玩"], ["九份", "JIUFEN please"], ["淡水", "tamsui!!"], ["臺東", "TAITUNG"], ["嘉義", "chia-yi"]];
  for (const [canon, text] of cases) {
    for (const L of ["en", "ja", "ko"]) {
      const plain = M.aliases.displayDestinationForCopy(canon, undefined, L);
      const withText = M.aliases.displayDestinationForCopy(canon, text, L);
      out(`  ${L} ${canon} + ${JSON.stringify(text)} → ${withText} (no text: ${plain})`);
      if (withText !== plain) bad.push(`${L} ${canon} + ${JSON.stringify(text)} → "${withText}" (without user text "${plain}")`);
    }
  }
  assert.deepEqual(bad, []);
});

check("no network: fetch never called", () => assert.equal(fetchCalls, 0));

// Samples for the reviewers.
out("\n================ SAMPLES ================");
for (const d of ["合掌造", "白川鄉", "城南", "大城", "凡爾賽", "九份", "臺東", "濟州島", "蔚藍海岸", "湖區"]) {
  if (!CANON.includes(d)) { out(`  ${d}: not a canonical`); continue; }
  out(`  ${d}: en=${M.aliases.displayDestinationForCopy(d, undefined, "en")} ja=${M.aliases.displayDestinationForCopy(d, undefined, "ja")} ko=${M.aliases.displayDestinationForCopy(d, undefined, "ko")}`);
  for (const L of ["en", "ja", "ko"]) out(`    [${L}] nearbyExt: ${R[L][d].nearbyExt}`);
}
out("=========================================\n");

if (failures.length) {
  out(`FAIL ${failures.length} check(s): ${failures.join(" | ")}`);
  process.exit(1);
}
out("PASS chat l10n destination sweep");
process.exit(0);
