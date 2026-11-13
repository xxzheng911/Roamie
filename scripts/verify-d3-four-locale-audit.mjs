/**
 * D3 — independent tester audit of the D2 four-locale trip-page fixes.
 *
 *   A. localization gate: 15 Google-returned names × 4 locales (JP / KR / TW / AU / EU-US),
 *      called with the production opts ({ locale, softPassEnglish: true }).
 *   B. formatTripDateRangeLabel / tripForecastSummary date ranges and no-date copy per locale.
 *   C. tripForecastSummary destination name per locale.
 *   D. device language switch zh-TW → en → ja → ko on the same destination WITHOUT manual cache
 *      clearing: the new list uses the new language; same-locale repeat is a cache hit
 *      (mocked Google searchPlaces call count must not grow).
 *   E. TSX: SavedTripItineraryEditor / TripDetailScreen / RoamieResponseView have no visible
 *      hard-coded zh; every i18n key they reference (and the 5 new nativeQa keys) exists in
 *      all four locales; zh-TW values equal the literals they replaced (HEAD byte-equal).
 *
 * Network: fetch is stubbed to throw and must stay at 0; Places search is an injected mock.
 * Run: npx vite-node scripts/verify-d3-four-locale-audit.mjs --config scripts/vite.verify.config.mjs [-- --samples]
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SAMPLES = process.argv.includes("--samples");
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug", "error"]) console[k] = () => {};
const watchdog = setTimeout(() => { out("FAIL watchdog: verify-d3-four-locale-audit exceeded 5 minutes"); process.exit(3); }, 5 * 60_000);
watchdog.unref();

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("NO_NETWORK in verify-d3-four-locale-audit"); };
delete process.env.OPENAI_API_KEY;
delete process.env.GOOGLE_MAPS_API_KEY;
delete process.env.GOOGLE_PLACES_API_KEY;

const load = (p) => import(/* @vite-ignore */ `/${p}`);
const gate = await load("src/lib/ai/itinerary-localization-gate.ts");
const guards = await load("src/lib/trip/itinerary-guards.ts");
const outfitCtx = await load("src/lib/outfit/trip-outfit-context.ts");
const policy = await load("src/lib/outfit/trip-weather-policy.ts");
const discovery = await load("src/lib/ai/destination-combination-discovery.ts");
const combos = await load("src/lib/ai/destination-combination-suggestions.ts");
const { i18nMessages } = await load("src/lib/i18n/messages.ts");
const { translate } = await load("src/lib/i18n/translate.ts");
const translit = await load("src/lib/place-localization/latin-zh-transliteration.ts");

const LOCALES = ["zh-TW", "en", "ja", "ko"];
const failures = [];
const samples = [];
function check(name, fn) {
  try { fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").join("\n  ")}`); }
}
const HAN = /\p{Script=Han}/u;
const CJK_ANY = /[\p{Script=Han}぀-ヿ가-힣]/u;
const ZH_ONLY_CHARS = /[這們來說對經區邊點體驗讓麼裡從關當與發覺灣臺濟廣戶繩橫綠縣幫鐵覽樂圖舊藝寶實處應營劃畫歡氣鬆擇單雙傳滿澀廳啡你您嗎呢吧喔囉號趟]/u;
const CATEGORY_WORDS = /(咖啡廳|咖啡館|夜市|餐廳|公園|藝廊|博物館|美術館|景點|寺廟|海灘|市場)$/u;

// ------------------------------------------------------------------ A. gate
// [primaryType, en, zh-TW, ja, ko, lat, lng]
const NAMES = [
  ["tourist_attraction", "Senso-ji", "淺草寺", "浅草寺", "센소지", 35.7148, 139.7967],
  ["tourist_attraction", "Fushimi Inari Taisha", "伏見稻荷大社", "伏見稲荷大社", "후시미 이나리 신사", 34.9671, 135.7727],
  ["tourist_attraction", "Dotonbori", "道頓堀", "道頓堀", "도톤보리", 34.6687, 135.5013],
  ["tourist_attraction", "Gyeongbokgung Palace", "景福宮", "景福宮", "경복궁", 37.5796, 126.977],
  ["tourist_attraction", "Haeundae Beach", "海雲台海水浴場", "海雲台海水浴場", "해운대해수욕장", 35.1587, 129.1604],
  ["tourist_attraction", "Gamcheon Culture Village", "甘川洞文化村", "甘川文化村", "감천문화마을", 35.0975, 129.0106],
  ["tourist_attraction", "Taipei 101", "台北101", "台北101", "타이베이 101", 25.0339, 121.5645],
  ["market", "Shilin Night Market", "士林夜市", "士林夜市", "스린 야시장", 25.0881, 121.5241],
  ["tourist_attraction", "Jiufen Old Street", "九份老街", "九份老街", "지우펀 옛거리", 25.1097, 121.8452],
  ["tourist_attraction", "Sydney Opera House", "雪梨歌劇院", "シドニー・オペラハウス", "시드니 오페라 하우스", -33.8568, 151.2153],
  ["tourist_attraction", "Bondi Beach", "邦代海灘", "ボンダイビーチ", "본다이 비치", -33.8915, 151.2767],
  ["museum", "Louvre Museum", "羅浮宮", "ルーヴル美術館", "루브르 박물관", 48.8606, 2.3376],
  ["park", "Central Park", "中央公園", "セントラル・パーク", "센트럴 파크", 40.7829, -73.9654],
  ["church", "Basílica de la Sagrada Família", "聖家堂", "サグラダ・ファミリア", "사그라다 파밀리아", 41.4036, 2.1744],
  ["cafe", "Blue Bottle Coffee Shibuya", "藍瓶咖啡 澀谷", "ブルーボトルコーヒー 渋谷", "블루보틀 커피 시부야", 35.6618, 139.7041],
];
const COL = { en: 1, "zh-TW": 2, ja: 3, ko: 4 };
const placesFor = (L) => NAMES.map((r, i) => {
  const id = `ChIJD3Audit${String(i + 1).padStart(3, "0")}`;
  return {
    id, googlePlaceId: id, placeId: id, name: r[COL[L]], address: "", lat: r[5], lng: r[6], rating: 4.6, userRatingCount: 5000 + i,
    photoName: null, primaryType: r[0], types: [r[0], "point_of_interest", "establishment"], businessStatus: "OPERATIONAL",
    openStatus: "unknown", openStatusLabel: "", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "",
  };
});
/** Itinerary items as the AI / planner hand them to the gate (placeName = Google name in request language). */
const directItems = (L) => placesFor(L).map((p, i) => ({
  dayIndex: Math.floor(i / 5), sortIndex: i % 5, time: "10:00", placeName: p.name, title: p.name, googlePlaceId: p.googlePlaceId,
  placeType: p.primaryType, types: p.types, lat: p.lat, lng: p.lng, address: "",
}));

const gateResults = {};
for (const L of LOCALES) {
  const direct = gate.applyItineraryLocalizationGate(directItems(L), { locale: L, softPassEnglish: true });
  const built = gate.applyItineraryLocalizationGate(
    guards.coalesceItineraryItems(guards.buildFallbackItineraryFromPlaces(placesFor(L), 5, "2026-12-10", "Audit", { selectedCombinationIds: [1] })),
    { locale: L, softPassEnglish: true },
  );
  const noLocale = gate.applyItineraryLocalizationGate(directItems(L), { softPassEnglish: true });
  gateResults[L] = { direct, built, noLocale };
  samples.push(`[gate ${L}] ` + direct.items.map((it, i) => `${placesFor(L)[i].name}→${it.localizedDisplayName}`).join(" | "));
}
for (const L of ["en", "ja", "ko"]) {
  check(`A gate ${L}: 15 Google names (JP/KR/TW/AU/EU-US) kept verbatim, no category suffix, no foreign script`, () => {
    const want = placesFor(L).map((p) => p.name);
    const bad = [];
    const { direct, built } = gateResults[L];
    direct.items.forEach((it, i) => {
      const name = it.localizedDisplayName ?? "";
      if (name !== want[i]) bad.push(`direct "${want[i]}" → "${name}" (${it.localizationSource})`);
      if (it.placeName !== want[i]) bad.push(`direct placeName "${want[i]}" → "${it.placeName}"`);
      if (L === "en" && CJK_ANY.test(name)) bad.push(`direct en CJK "${name}"`);
      if (CATEGORY_WORDS.test(name) && !CATEGORY_WORDS.test(want[i])) bad.push(`direct category suffix "${name}"`);
    });
    for (const it of built.items) {
      const name = it.localizedDisplayName ?? "";
      if (!want.includes(name)) bad.push(`builder → "${name}" (${it.localizationSource})`);
      if (L === "en" && CJK_ANY.test(name)) bad.push(`builder en CJK "${name}"`);
    }
    if (built.items.length < 10) bad.push(`builder kept only ${built.items.length} stops`);
    if (direct.traces.some((t) => t.requestedLocale !== L)) bad.push("trace requestedLocale mismatch");
    assert.deepEqual(bad, []);
  });
}
check("A gate zh-TW: locale:\"zh-TW\" result identical to the no-locale (HEAD default) result", () => {
  const { direct, noLocale } = gateResults["zh-TW"];
  assert.equal(JSON.stringify(direct.items), JSON.stringify(noLocale.items));
  const renamed = direct.items.map((it, i) => [placesFor("zh-TW")[i].name, it.localizedDisplayName]).filter(([a, b]) => a !== b);
  if (renamed.length) out(`  INFO zh-TW (= HEAD) renames: ${JSON.stringify(renamed)}`);
});
// D4 (指派者裁定): after D2 r4/r5 the zh-TW (no-locale) gate keeps a Google Latin name instead of
// inventing a syllable-by-syllable transliteration. Only verified / known-token 繁中 names may replace it.
check("A gate zh (no locale): en Google names are never rewritten into a phonetic transliteration", () => {
  const want = placesFor("en").map((p) => p.name);
  const bad = [];
  gateResults.en.noLocale.items.forEach((it, i) => {
    const name = it.localizedDisplayName ?? "";
    if (name === want[i]) return;
    const t = translit.transliterateLatinToZh(want[i]);
    if (t && !t.allKnownTokens && name.includes(t.zh)) bad.push(`"${want[i]}" → phonetic "${name}" (${it.localizationSource})`);
    if (!HAN.test(name)) bad.push(`"${want[i]}" → "${name}" rewritten without 繁中`);
  });
  out(`  INFO en without locale (zh device): ${gateResults.en.noLocale.items.map((it, i) => `${want[i]}→${it.localizedDisplayName}[${it.localizationSource}]`).join(" | ")}`);
  assert.deepEqual(bad, []);
});

// ------------------------------------------------------------------ B. dates
const S = "2026-12-10";
const E = "2026-12-12";
check("B formatTripDateRangeLabel: en/ko A–B, ja A〜B, zh-TW = HEAD (\"A ～ B\"); same-day / no-end = start", () => {
  const got = Object.fromEntries(LOCALES.map((L) => [L, outfitCtx.formatTripDateRangeLabel(S, E, L)]));
  samples.push(`[date range] ${JSON.stringify(got)}`);
  assert.deepEqual(got, { "zh-TW": `${S} ～ ${E}`, en: `${S}–${E}`, ja: `${S}〜${E}`, ko: `${S}–${E}` });
  for (const L of LOCALES) {
    assert.equal(outfitCtx.formatTripDateRangeLabel(S, S, L), S);
    assert.equal(outfitCtx.formatTripDateRangeLabel(S, "", L), S);
  }
  // HEAD literal (git show HEAD): `${start} ～ ${end}` and "日期待定" — two-arg calls unchanged.
  const headSrc = execFileSync("git", ["show", "HEAD:src/lib/outfit/trip-outfit-context.ts"], { encoding: "utf8" });
  assert.match(headSrc, /return `\$\{start\} ～ \$\{end\}`;/);
  assert.match(headSrc, /if \(!start\) return "日期待定";/);
  assert.equal(outfitCtx.formatTripDateRangeLabel(S, E), `${S} ～ ${E}`);
  assert.equal(outfitCtx.formatTripDateRangeLabel("", ""), "日期待定");
});
check("B no-date copy per locale (formatTripDateRangeLabel(\"\", \"\", L))", () => {
  const got = Object.fromEntries(LOCALES.map((L) => [L, outfitCtx.formatTripDateRangeLabel("", "", L)]));
  samples.push(`[no date] ${JSON.stringify(got)}`);
  assert.deepEqual(got, { "zh-TW": "日期待定", en: "Dates TBD", ja: "日程未定", ko: "날짜 미정" });
});
check("B server outfit prompt passes locale to formatTripDateRangeLabel", () => {
  const src = readFileSync("src/lib/outfit/generate-trip-outfit.server.ts", "utf8");
  assert.match(src, /formatTripDateRangeLabel\(input\.startDate, input\.endDate, locale\)/);
  const callers = execFileSync("git", ["grep", "-n", "formatTripDateRangeLabel(", "--", "src"], { encoding: "utf8" }).trim().split("\n");
  out(`  callers: ${callers.map((l) => l.split(":").slice(0, 2).join(":")).join(", ")}`);
});

// ------------------------------------------------------------------ C. forecast summary
const ROWS = [
  { date: S, condition: "晴", tempLowC: 8, tempHighC: 15, precipProbability: 20 },
  { date: E, condition: "多雲", tempLowC: 9, tempHighC: 16, precipProbability: 40 },
];
const DEST_NAMES = {
  東京: { en: /^Tokyo /, ja: /^東京 /, ko: /^도쿄 / },
  首爾: { en: /^Seoul /, ja: /^ソウル /, ko: /^서울 / },
  雪梨: { en: /^Sydney /, ja: /^シドニー /, ko: /^시드니 / },
  嘉義: { en: /^Chiayi /, ja: /^嘉義 /, ko: /^(Chiayi|자이) / },
  大阪: { en: /^Osaka /, ja: /^大阪 /, ko: /^오사카 / },
  巴黎: { en: /^Paris /, ja: /^パリ /, ko: /^파리 / },
};
check("C tripForecastSummary: destination name and date range per locale; zh-TW keeps \"<dest> A～B\"", () => {
  const bad = [];
  for (const [dest, want] of Object.entries(DEST_NAMES)) {
    for (const L of LOCALES) {
      const s = policy.tripForecastSummary(L, dest, S, E, ROWS);
      samples.push(`[forecast ${L} ${dest}] ${s}`);
      if (L === "zh-TW") { if (!s.startsWith(`${dest} ${S}～${E} · `)) bad.push(`zh ${s}`); continue; }
      if (!want[L].test(s)) bad.push(`${L} ${dest}: ${s}`);
      const range = L === "ja" ? `${S}〜${E}` : `${S}–${E}`;
      if (!s.includes(` ${range} · `)) bad.push(`${L} ${dest} range: ${s}`);
      if ((L === "en" || L === "ko") && HAN.test(s)) bad.push(`${L} ${dest} Han: ${s}`);
      if (L === "ja" && ZH_ONLY_CHARS.test(s)) bad.push(`ja ${dest} zh-only: ${s}`);
    }
  }
  assert.deepEqual(bad, []);
});

// ------------------------------------------------------------------ D. locale switch + cache
// Tokyo fixture rows: [type, en, zh-TW, ja, ko]
const TOKYO = [
  ["tourist_attraction", "Senso-ji", "淺草寺", "浅草寺", "센소지"], ["tourist_attraction", "Meiji Jingu", "明治神宮", "明治神宮", "메이지 신궁"],
  ["tourist_attraction", "Tokyo Skytree", "東京晴空塔", "東京スカイツリー", "도쿄 스카이트리"], ["park", "Ueno Park", "上野恩賜公園", "上野恩賜公園", "우에노 공원"],
  ["museum", "Tokyo National Museum", "東京國立博物館", "東京国立博物館", "도쿄 국립박물관"], ["tourist_attraction", "Shibuya Sky", "SHIBUYA SKY", "渋谷スカイ", "시부야 스카이"],
  ["park", "Shinjuku Gyoen National Garden", "新宿御苑", "新宿御苑", "신주쿠 교엔"], ["market", "Tsukiji Outer Market", "築地場外市場", "築地場外市場", "츠키지 장외시장"],
  ["tourist_attraction", "Tokyo Tower", "東京鐵塔", "東京タワー", "도쿄 타워"], ["market", "Ameya-Yokocho", "阿美橫町", "アメヤ横丁", "아메요코 시장"],
  ["park", "Imperial Palace East Gardens", "皇居東御苑", "皇居東御苑", "고쿄 히가시교엔"], ["restaurant", "Ichiran Shibuya", "一蘭 澀谷店", "一蘭 渋谷店", "이치란 시부야"],
  ["restaurant", "Sushi Dai", "壽司大", "寿司大", "스시 다이"], ["cafe", "Blue Bottle Coffee Kiyosumi", "藍瓶咖啡 清澄白河", "ブルーボトルコーヒー 清澄白河", "블루보틀 기요스미"],
  ["museum", "Mori Art Museum", "森美術館", "森美術館", "모리 미술관"],
];
const tokyoPool = (L) => TOKYO.map((r, i) => {
  const id = `ChIJD3Tokyo${String(i + 1).padStart(3, "0")}`;
  return {
    id, googlePlaceId: id, placeId: id, name: r[COL[L]], address: { en: "Tokyo, Japan", "zh-TW": "日本東京都", ja: "日本、東京都", ko: "일본 도쿄도" }[L],
    lat: 35.68 + (i % 5) * 0.006, lng: 139.76 + Math.floor(i / 5) * 0.006, rating: 4.6, userRatingCount: 6000 + i, photoName: null,
    primaryType: r[0], types: [r[0], "point_of_interest", "establishment"], businessStatus: "OPERATIONAL",
    openStatus: "unknown", openStatusLabel: "", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "",
  };
});
const DEST = "東京";
let googleCalls = 0;
const callsByLocale = {};
async function discover(L) {
  const before = googleCalls;
  await discovery.discoverDestinationCombinations({
    destination: DEST, locale: L,
    searchPlaces: async () => { googleCalls++; callsByLocale[L] = (callsByLocale[L] ?? 0) + 1; return { places: tokyoPool(L), error: null }; },
  });
  const payload = combos.buildDestinationCombinationSuggestionPayload(DEST, 3, { locale: L, startDate: S, endDate: E, tentativeDates: false });
  return { delta: googleCalls - before, text: payload?.displayText ?? "", names: (payload?.shownCandidates ?? []).map((c) => c.displayName ?? c.name) };
}
const otherLocaleNames = (L) => [...new Set(TOKYO.flatMap((r) => LOCALES.filter((x) => x !== L).map((x) => r[COL[x]])))]
  .filter((n) => !TOKYO.some((r) => r[COL[L]] === n)) // names identical across locales are not a leak
  .sort((a, b) => b.length - a.length);
const ownNames = (L) => TOKYO.map((r) => r[COL[L]]);

// D4 (指派者裁定): a language switch is the App locale (effectiveAppLocale → navigator.language)
// changing, not merely the request locale. Simulate it via navigator.language.
const navDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const setDeviceLanguage = (language) => Object.defineProperty(globalThis, "navigator", { value: { language }, configurable: true, writable: true });
const DEVICE_LANG = { "zh-TW": "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" };

discovery.clearDiscoveredCombinationsCache();
const switchRuns = [];
{
  setDeviceLanguage(DEVICE_LANG["zh-TW"]);
  const first = await discover("zh-TW");
  switchRuns.push(["zh-TW", first]);
  const zhRepeat = await discover("zh-TW");
  switchRuns.push(["zh-TW(repeat)", zhRepeat]);
  for (const L of ["en", "ja", "ko"]) {
    setDeviceLanguage(DEVICE_LANG[L]);
    const r = await discover(L);
    switchRuns.push([L, r]);
    const again = await discover(L);
    switchRuns.push([`${L}(repeat)`, again]);
  }
}
// Request-locale-only change (device stays zh-TW) keeps the cache: +0 Google calls.
let requestLocaleOnlyDelta = null;
{
  discovery.clearDiscoveredCombinationsCache();
  setDeviceLanguage(DEVICE_LANG["zh-TW"]);
  await discover("zh-TW");
  const r = await discover("en");
  requestLocaleOnlyDelta = r.delta;
}
for (const [label, r] of switchRuns) samples.push(`[switch ${label}] google+${r.delta}\n${r.text.split("\n").map((l) => "    " + l).join("\n")}`);
check("D switch zh-TW→en→ja→ko (no manual cache clear): each list uses the new locale's names only", () => {
  const bad = [];
  for (const [label, r] of switchRuns) {
    const L = label.replace("(repeat)", "");
    if (!r.text) { bad.push(`${label}: no payload`); continue; }
    let stripped = r.text;
    for (const n of [...ownNames(L)].sort((a, b) => b.length - a.length)) stripped = stripped.split(n).join("⟨G⟩");
    const leaked = otherLocaleNames(L).filter((n) => stripped.includes(n));
    if (leaked.length) bad.push(`${label}: other-locale names ${JSON.stringify(leaked)}`);
    if (!ownNames(L).some((n) => r.text.includes(n))) bad.push(`${label}: none of its own Google names shown`);
    if ((L === "en" || L === "ko") && HAN.test(stripped)) bad.push(`${label}: Han ${JSON.stringify(stripped.match(/\p{Script=Han}+/gu))}`);
  }
  assert.deepEqual(bad, []);
});
check("D Google call count: switching locale re-searches (>0); same-locale repeat is a cache hit (+0)", () => {
  const deltas = Object.fromEntries(switchRuns.map(([l, r]) => [l, r.delta]));
  out(`  google searchPlaces deltas: ${JSON.stringify(deltas)} total=${googleCalls}`);
  for (const [l, d] of Object.entries(deltas)) {
    if (l.endsWith("(repeat)")) assert.equal(d, 0, `${l} must hit cache`);
    else assert.ok(d > 0, `${l} must re-search after a locale switch`);
  }
  out(`  request-locale-only change (device zh-TW, locale:"en"): google+${requestLocaleOnlyDelta}`);
  assert.equal(requestLocaleOnlyDelta, 0, "request locale alone must not clear the cache");
});
{
  // Separate probe (async): zh-TW discover, then build an en payload without rediscovering.
  discovery.clearDiscoveredCombinationsCache();
  setDeviceLanguage(DEVICE_LANG["zh-TW"]);
  await discover("zh-TW");
  const p = combos.buildDestinationCombinationSuggestionPayload(DEST, 3, { locale: "en", startDate: S, endDate: E, tentativeDates: false });
  const text = p?.displayText ?? "";
  const leaked = ownNames("zh-TW").filter((n) => HAN.test(n) && text.includes(n));
  samples.push(`[probe en payload over zh cache, no rediscover] ${text ? text.split("\n").slice(0, 6).join(" / ") : "<null payload>"}`);
  out(`  INFO en payload over zh-TW cache (no rediscover): ${text ? `${leaked.length} zh names shown ${JSON.stringify(leaked.slice(0, 3))}` : "null payload (no stale names)"}`);
}

// Production order (_app.chat.tsx prepareDestinationCombinations L1921-1922):
//   const cachedCombinations = getCachedDiscoveredCombinations(label);          // no locale → device locale
//   if (cachedCombinations && hasDeliverableCombinationCount(cachedCombinations)) return;  // ensure… skipped
// then the reply builder calls buildDestinationCombinationSuggestionPayload(label, days, { locale }).
// syncCombinationCachesToLocale only runs inside ensure/discover, so a deliverable cache hit after
// a device language switch never reaches it.
const { hasDeliverableCombinationCount } = await load("src/lib/ai/combination-deliverability.ts");
const prodOrder = [];
for (const [from, to, lang] of [["zh-TW", "en", "en-US"], ["en", "ja", "ja-JP"], ["ja", "ko", "ko-KR"]]) {
  discovery.clearDiscoveredCombinationsCache();
  setDeviceLanguage({ "zh-TW": "zh-TW", en: "en-US", ja: "ja-JP" }[from]);
  await discover(from);
  setDeviceLanguage(lang);
  const before = googleCalls;
  const cached = discovery.getCachedDiscoveredCombinations(DEST);
  const skipped = Boolean(cached && hasDeliverableCombinationCount(cached));
  if (!skipped) {
    await discovery.ensureDestinationCombinationsReady({
      destination: DEST, locale: to, days: 3, generationRequestId: `d3_${to}`,
      searchPlaces: async () => { googleCalls++; return { places: tokyoPool(to), error: null }; },
    });
  }
  const text = combos.buildDestinationCombinationSuggestionPayload(DEST, 3, { locale: to, startDate: S, endDate: E, tentativeDates: false })?.displayText ?? "";
  let stripped = text;
  for (const n of [...ownNames(to)].sort((a, b) => b.length - a.length)) stripped = stripped.split(n).join("⟨G⟩");
  const leaked = otherLocaleNames(to).filter((n) => stripped.includes(n));
  prodOrder.push({ from, to, ensureSkipped: skipped, googleDelta: googleCalls - before, leaked, list: text.split("\n").filter((l) => /^\d+\. /.test(l)) });
}
if (navDesc) Object.defineProperty(globalThis, "navigator", navDesc); else delete globalThis.navigator;
for (const r of prodOrder) samples.push(`[prod-order ${r.from}→${r.to}] ensureSkipped=${r.ensureSkipped} google+${r.googleDelta}\n    ${r.list.join("\n    ")}`);
check("D production order (cache-hit early return at _app.chat.tsx:1921-1922) after zh→en / en→ja / ja→ko: list uses the new locale's names", () => {
  const bad = prodOrder.filter((r) => r.leaked.length || !r.list.length)
    .map((r) => `${r.from}→${r.to}: ensureSkipped=${r.ensureSkipped} google+${r.googleDelta} leaked=${JSON.stringify(r.leaked)} list=${JSON.stringify(r.list)}`);
  assert.deepEqual(bad, []);
});

// ------------------------------------------------------------------ E. TSX
const TSX = ["src/components/saved/SavedTripItineraryEditor.tsx", "src/components/trip/TripDetailScreen.tsx", "src/components/RoamieResponseView.tsx"];
function node(locale, key) {
  let n = i18nMessages[locale];
  for (const part of key.split(".")) { if (n && typeof n === "object" && part in n) n = n[part]; else return undefined; }
  return n;
}
/** Code with comments removed (block, JSX block, line). */
function stripComments(src) {
  return src.replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
}
check("E TSX: no Han in code of the three files except the internal \"尚未設定\" sentinel comparisons", () => {
  const bad = [];
  for (const f of TSX) {
    stripComments(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
      if (!HAN.test(line)) return;
      const rest = line.replace(/[!=]== "尚未設定"/g, "");
      if (HAN.test(rest)) bad.push(`${f}:${i + 1} ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(bad, []);
});
check("E TSX: every t/uiT/translate key in the three files exists in zh-TW/en/ja/ko (en/ko no Han, ja no zh-only chars)", () => {
  const bad = [];
  let n = 0;
  for (const f of TSX) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\b(?:uiT|t|translate\([^,()]*(?:\(\))?,)\(?\s*"([A-Za-z]\w*\.[\w.]+)"/g)) {
      n++;
      for (const L of LOCALES) {
        const v = node(L, m[1]);
        if (typeof v !== "string" || !v.trim()) bad.push(`${f} ${L} missing ${m[1]}`);
        else if ((L === "en" || L === "ko") && HAN.test(v)) bad.push(`${f} ${L} ${m[1]} Han: ${v}`);
        else if (L === "ja" && ZH_ONLY_CHARS.test(v)) bad.push(`${f} ja ${m[1]} zh-only: ${v}`);
      }
    }
  }
  out(`  keys checked: ${n}`);
  assert.deepEqual([...new Set(bad)], []);
});
check("E new nativeQa keys: 4 locales present, placeholders kept, zh-TW equals the HEAD literal it replaced", () => {
  const replaced = {
    "nativeQa.tripDatesTbd": "日期待定",
    "nativeQa.dateNotSet": "未指定日期",
    "nativeQa.coverCropOpenFailed": "無法開啟裁切編輯器",
    "nativeQa.coverUploadFailedShort": "封面上傳失敗",
    "productionUi.pb93438d9d6": "找不到這個行程",
    "saved.loadFailed": "讀取失敗",
    "chat.addToTrip": "加入行程",
    "trip.discussPlace": "跟 Roamie 聊這裡",
  };
  const bad = [];
  for (const [k, zh] of Object.entries(replaced)) {
    if (translate("zh-TW", k) !== zh) bad.push(`zh-TW ${k} = ${JSON.stringify(translate("zh-TW", k))} ≠ ${zh}`);
    for (const L of ["en", "ja", "ko"]) {
      const v = translate(L, k);
      if (!v || v === k || v === zh) bad.push(`${L} ${k} = ${JSON.stringify(v)}`);
    }
    samples.push(`[key ${k}] ${LOCALES.map((L) => `${L}=${translate(L, k)}`).join(" | ")}`);
  }
  const headLiteral = (n) => `縮短行程後，將有 ${n} 個地點移到「未安排」。地點不會被刪除，是否繼續？`;
  if (translate("zh-TW", "nativeQa.shortenTripConfirm", { count: 3 }) !== headLiteral(3)) bad.push(`zh shortenTripConfirm ${translate("zh-TW", "nativeQa.shortenTripConfirm", { count: 3 })}`);
  for (const L of ["en", "ja", "ko"]) {
    const v = translate(L, "nativeQa.shortenTripConfirm", { count: 3 });
    if (!v.includes("3") || v.includes("{count}") || HAN.test(L === "ja" ? "" : v)) bad.push(`${L} shortenTripConfirm ${v}`);
  }
  samples.push(`[key nativeQa.shortenTripConfirm] ${LOCALES.map((L) => `${L}=${translate(L, "nativeQa.shortenTripConfirm", { count: 3 })}`).join(" | ")}`);
  assert.deepEqual(bad, []);
});

check("no network: fetch never called", () => assert.equal(fetchCalls, 0));

if (SAMPLES) { out("\n======== SAMPLES ========"); for (const s of samples) out(s); out("=========================\n"); }
if (failures.length) { out(`FAIL ${failures.length} check(s): ${failures.join(" | ")}`); process.exit(1); }
out("PASS d3 four-locale audit");
process.exit(0);
