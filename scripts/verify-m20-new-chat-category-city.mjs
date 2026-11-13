/**
 * M20 (tester, independent review of M18 round 2): NEW chat category wish → "which city?" → city-only answer
 * continuation; ko gaps; cityOnlyAnswerDestination edge answers; ja / ko / en destination parsing; ko Japan region_choice.
 *  --section=u  unit: runs src/lib/ai/trip-planning-context.m19-category-wish.test.ts + cityOnlyAnswerDestination /
 *               stripTravelWishSuffix / isNonPlaceDestinationText / parseDestinationFromText tables (pure, no network).
 *  --section=n  NEW chat two / three turns through the m16 harness (mirror of _app.chat.tsx), with three mirrored
 *               additions (only when the App source contains them, so the HEAD child runs HEAD's order):
 *                 A) turn start: a user turn consumes session.pendingClarification (9038)
 *                 B) 11288: pending destination_area with an empty area label + originalUserText, answer is
 *                    cityOnlyAnswerDestination and the wish is categorySwitchSearchText → category continuation
 *                    (pushDestinationCategoryPlaceRecommendation is NOT run here: only its inputs are recorded)
 *                 C) 12651: early dispatch "ask city" for a category wish with no destination (records the pending)
 *                 D) 13173: no destination + no duration after planning advice → buildDestinationPlanningClarify
 *  --section=k  ko / en / ja country-level first turn (日本 / Japan / 일본) → region_choice, then a category wish.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-m20-new-chat-category-city.mjs -- --section=n [--head-dir=<snapshot>]
 */
import "./verify-netguard-full.mjs";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const section = argv.find((a) => a.startsWith("--section="))?.slice(10) ?? "u";
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 570_000).unref();
let fetchCalls = 0;
globalThis.fetch = async (...a) => { fetchCalls++; throw new Error("NO_NETWORK " + String(a[0])); };
const storageWrites = [];
{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { storageWrites.push(`set:${k}`); mem.set(k, String(v)); },
    removeItem: (k) => { storageWrites.push(`remove:${k}`); mem.delete(k); }, clear: () => { storageWrites.push("clear"); mem.clear(); }, key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep existing */ }
}
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);
const safe = (f) => { try { const v = f(); return v === undefined ? null : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 60)}`; } };
const j = (v) => JSON.stringify(v);
const R = {};
const failures = [];
const fail = (k, msg) => { failures.push(k); out(`FAIL ${k}: ${msg}`); };

// ------------------------------------------------------------------ u) unit
if (section === "u" && !CHILD) {
  const tpc = await load("src/lib/ai/trip-planning-context.ts");
  // The vitest-free test file prints its own ok / FAIL lines and sets process.exitCode on failure.
  const before = process.exitCode;
  const restore = console.log; console.log = out;
  await load("src/lib/ai/trip-planning-context.m19-category-wish.test.ts");
  console.log = restore;
  if (process.exitCode && process.exitCode !== before) fail("u|m19-test-file", "test file reported failures");
  const CITY = [
    // [answer, expected label or null, note]
    ["東京", "東京", "bare city"], ["Tokyo", "東京", "en alias"], ["도쿄", "東京", "ko alias"], ["東京で", "東京", "ja particle"],
    ["東京吧", "東京", "zh filler"], ["東京好了", "東京", "zh filler"], ["是東京", "東京", "leading 是"], ["京都", "京都", "bare city"],
    ["東京 3天", null, "days → general flow"], ["12/10去東京", null, "date → general flow"], ["算了", null, "cancel"], ["東京三天", null, "days (CJK numeral)"],
    ["好", null, "not a city"], ["是", null, "not a city"], ["不知道", null, "not a city"], ["隨便", null, "not a city"], ["都可以", null, "not a city"],
    ["東京的博物館", null, "category"], ["東京旅行", null, "zh trip wording"],
  ];
  const INFO_CITY = ["go Tokyo", "Tokyo trip", "도쿄 여행", "도쿄요", "도쿄로", "Tokyo please", "東京へ行きたい", "我想去東京", "去東京", "大阪", "Osaka", "오사카", "北海道", "日本"];
  for (const [t, want, note] of CITY) {
    const got = safe(() => tpc.cityOnlyAnswerDestination(t));
    const k = `u|cityOnly|${t}`;
    if ((got ?? null) !== want) fail(k, `got ${j(got)} want ${j(want)} (${note})`);
    else out(`PASS ${k} → ${j(got)} (${note})`);
  }
  for (const t of INFO_CITY) out(`INFO u|cityOnly|${t} → ${j(safe(() => tpc.cityOnlyAnswerDestination(t)))}`);
  const STRIP = [["東京へ行きたい", "東京"], ["京都に行きたい", "京都"], ["大阪へ行きます", "大阪"], ["北海道に行こう", "北海道"], ["도쿄에 가고 싶어", "도쿄"], ["東京", "東京"]];
  for (const [t, want] of STRIP) {
    const got = safe(() => tpc.stripTravelWishSuffix(t));
    if (got !== want) fail(`u|strip|${t}`, `got ${j(got)} want ${j(want)}`); else out(`PASS u|strip|${t} → ${got}`);
  }
  const NONPLACE = [["底要去哪", true], ["要吃什麼", true], ["東京へ行きたい", true], ["도쿄에 가고 싶어", true], ["明日香", false], ["東京", false], ["今天", true]];
  for (const [t, want] of NONPLACE) {
    const got = safe(() => tpc.isNonPlaceDestinationText(t));
    if (got !== want) fail(`u|nonplace|${t}`, `got ${j(got)} want ${j(want)}`); else out(`PASS u|nonplace|${t} → ${got}`);
  }
  for (const t of ["東京へ行きたい", "京都に行きたい", "大阪へ行きます", "北海道に行こう", "도쿄에 가고 싶어", "I'd like to go to Kyoto", "도쿄 3일", "도쿄 여행", "我想去明日香", "今天到底要去哪"]) {
    out(`INFO u|parse|${t} parse=${j(safe(() => tpc.parseDestinationFromText(t)))} resolve=${j(safe(() => tpc.resolveDestinationFromText(t)))}`);
  }
}

// ------------------------------------------------------------------ n / k) App mirror
let H = null;
if (section === "n" || section === "k" || section === "q") {
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  if (from < 0 || to < 0) { out("FAIL harness slice not found"); process.exit(2); }
  let slice = HARNESS_SRC.slice(from, to);
  const APP = readFileSync("src/routes/_app.chat.tsx", "utf8");
  const HAS_ASK_CITY = APP.includes('rawGeographicLabel: "",') && APP.includes("categorySwitchSearchText(trimmed) &&");
  const HAS_NO_DEST_ASK = APP.includes('content: buildDestinationPlanningClarify(planningCtx, nextSession, "destination", locale)');
  // M18 round 3 (_app.chat.tsx 12714 / 11314 / 11330): stored category words, country guard, 「{city}{word}」 text.
  const HAS_WORD = APP.includes("categorySearchWord: categorySwitchSearchText(trimmed)");
  const ANCHOR_C = '  if (auth === "destination_category") return';
  const ANCHOR_D = 'return dateQuestion("13058");';
  if (!slice.includes(ANCHOR_C) || !slice.includes(ANCHOR_D)) { out("FAIL harness anchors not found"); process.exit(2); }
  // C) _app.chat.tsx 12651 (isTripAddPlaceSession: a new chat is never a trip add-place session).
  if (HAS_ASK_CITY) slice = slice.replace(ANCHOR_C, `  if (auth === "other" && tpc.categorySwitchSearchText(t) && !catDest.resolveDestinationForCategorySearch(pc, n, t) && !n.pendingQuestion && !n.pendingClarification
    && !n.pendingNearbyLocationRequest && !n.fromMoodFlow && !n.fromMoodCard && !n.homeMoodShortcutEntry) {
    const askCity = tpc.buildDestinationPlanningClarify(pc, n, "destination", locale);
    const s = { ...n, lastAssistantReply: askCity, pendingClarification: geoClar.buildPendingGeographicClarification({ rawGeographicLabel: "", categoryIntent: placeIntent.parseChatPlaceIntents(t)[0] ?? "attraction", originalUserText: t${HAS_WORD ? ", categorySearchWord: tpc.categorySwitchSearchText(t)" : ""} }),
      travelContext: n.travelContext?.tripPurpose === "recommend_places" ? { ...n.travelContext, tripPurpose: undefined } : n.travelContext };
    return { s, row: snapOf(s, "12651 ask city (category wish)", askCity, { pendClar: s.pendingClarification }) };
  }
${ANCHOR_C}`);
  // D) _app.chat.tsx 13173.
  if (HAS_NO_DEST_ASK) slice = slice.replace(ANCHOR_D, `{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || "";
    if (!dl) { const reply = tpc.buildDestinationPlanningClarify(planningCtx, n, "destination", locale); const s = { ...n, travelContext: planningCtx, lastAssistantReply: reply }; return { s, row: snapOf(s, "13173 ask destination", reply) }; }
    return dateQuestion("13058"); }`);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, first, freshAll, freshAuthority, STEP1, NAME, pk, geoClar, tpc, placeIntent, catDest, catTypes, arbitrate, mustVisit, clone, sessionMod, scopeMod, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  H.HAS = { HAS_ASK_CITY, HAS_NO_DEST_ASK, HAS_CONT: APP.includes("cityOnlyAnswerDestination(trimmed)"), HAS_WORD,
    HAS_COUNTRY_GUARD: APP.includes("answeredCity && !isCountryLevelDestination(answeredCity)"), HAS_JOIN: APP.includes("buildCityCategoryContinuationText(pendingGeographic, answeredCity)") };
}

/** One user turn: A) turn-start consumption, B) 11288 continuation, then the harness (with C / D). */
async function m20Turn(s0, t, locale) {
  const pending = s0.pendingClarification;
  const base = { ...H.clone(s0), pendingClarification: undefined };
  if (H.HAS.HAS_CONT && pending?.kind === "destination_area" && !pending.rawGeographicLabel.trim() && pending.originalUserText?.trim()) {
    const wish = pending.originalUserText.trim();
    const city = H.geoClar.isPlaceClarificationTripPlanningOverride(t) ? undefined : H.tpc.cityOnlyAnswerDestination(t);
    if (city && !(H.HAS.HAS_COUNTRY_GUARD && H.scopeMod.isCountryLevelDestination(city)) && H.tpc.categorySwitchSearchText(wish)) {
      const joined = H.HAS.HAS_JOIN ? H.geoClar.buildCityCategoryContinuationText?.(pending, city) : undefined;
      const categoryText = joined ?? (H.placeIntent.parseChatPlaceIntents(wish).length ? wish : H.geoClar.buildParentScopeCategoryUserText(pending, city));
      const s = { ...base, activeCategoryIntent: pending.categoryIntent, travelContext: { ...(base.travelContext ?? { interests: [] }), destination: city } };
      return { s, row: { branch: "11288 category continuation", dest: city, categoryText, intent: pending.categoryIntent, pending: s.pendingQuestion?.type ?? null, pendClar: null,
        start: s.travelContext?.startDate ?? null, geo: [], ageo: [], dgeo: [], reply: `(pushDestinationCategoryPlaceRecommendation dest=${city} text=${categoryText} intent=${pending.categoryIntent})` } };
    }
  }
  return H.appTurn(base, t, locale);
}
const row = (r) => ({ ...H.pk(r.row), branch: r.row.branch, categoryText: r.row.categoryText ?? null, intent: r.row.intent ?? null,
  pendClar: r.s.pendingClarification ? { label: r.s.pendingClarification.rawGeographicLabel, intent: r.s.pendingClarification.categoryIntent, text: r.s.pendingClarification.originalUserText } : null,
  pending: r.s.pendingQuestion?.type ?? null, runs: r.row.discoveryRuns ?? 0, places: r.row.placesCalls ?? 0, fullReply: (r.row.reply ?? "").slice(0, 300) });
const fresh = async (locale) => { H.freshAll(); await H.freshAuthority(); H.setLocale(locale); return H.sessionMod.createEmptySession(); };

const CITY_OF = { "zh-TW": "東京", en: "Tokyo", ja: "東京", ko: "도쿄" };
const WISHES = [["zh-TW", "我想去博物館"], ["zh-TW", "明天去海邊"], ["zh-TW", "我想去夜市"], ["zh-TW", "想去泡湯"], ["zh-TW", "我想泡溫泉"],
  ["en", "I want to go to a museum"], ["en", "I want to go to the beach"], ["ja", "美術館に行きたい"], ["ko", "박물관에 가고 싶어"], ["ko", "바다에 가고 싶어"]];
const ZH_ANSWERS = ["東京 3天", "12/10去東京", "算了", "東京吧", "東京好了", "好", "是", "不知道", "隨便"];
const EN_ANSWERS = ["go Tokyo", "Tokyo trip"];
const KO_ANSWERS = ["도쿄 여행", "도쿄 3일", "도쿄요"];
const CONTROLS = [["zh-TW", "推薦咖啡廳"], ["zh-TW", "我想去東京玩"], ["en", "I want to go to Tokyo"], ["ja", "東京へ行きたい"], ["ja", "京都に行きたい"], ["ja", "大阪へ行きます"],
  ["ja", "北海道に行こう"], ["ko", "도쿄에 가고 싶어"], ["en", "I'd like to go to Kyoto"], ["ko", "도쿄 3일"], ["ko", "12/10-12/14 도쿄 여행"]];

if (section === "n") {
  for (const [locale, w] of WISHES) {
    const r1 = await m20Turn(await fresh(locale), w, locale);
    R[`n1|${locale}|${w}`] = row(r1);
    const answers = [CITY_OF[locale], ...(locale === "zh-TW" && w === "我想去博物館" ? ZH_ANSWERS : []), ...(locale === "en" && w === "I want to go to a museum" ? EN_ANSWERS : []),
      ...(locale === "ko" && w === "박물관에 가고 싶어" ? KO_ANSWERS : [])];
    for (const a of answers) {
      const s1 = (await m20Turn(await fresh(locale), w, locale)).s;
      const r2 = await m20Turn(s1, a, locale);
      R[`n2|${locale}|${w}|${a}`] = row(r2);
      if (a === "算了" || a === "好") {
        const r3 = await m20Turn(r2.s, "東京", locale);
        R[`n3|${locale}|${w}|${a}|東京`] = row(r3);
      }
    }
  }
  for (const [locale, t] of CONTROLS) R[`c|${locale}|${t}`] = row(await m20Turn(await fresh(locale), t, locale));
  // INFO only (not requirements): the same answers typed on a fresh chat, to tell "lost after the city question"
  // from "the general flow never reads it".
  for (const [locale, t] of [["en", "go Tokyo"], ["en", "Tokyo trip"], ["ko", "도쿄요"], ["ko", "도쿄 여행"], ["zh-TW", "東京"], ["ko", "도쿄"]]) {
    R[`i|${locale}|${t}`] = row(await m20Turn(await fresh(locale), t, locale));
  }
}
if (section === "k") {
  for (const [locale, place, cats] of [["ko", "일본", ["온천", "온천에 가고 싶어", "박물관에 가고 싶어", "벳푸"]], ["en", "Japan", ["hot springs", "I want to go to Beppu"]], ["ja", "日本", ["温泉", "別府"]]]) {
    for (const c of cats) {
      const s0 = (await m20Turn(await fresh(locale), H.STEP1[locale](place), locale)).s;
      const r = await m20Turn(s0, c, locale);
      R[`k|${locale}|${c}`] = { first: (s0.lastAssistantReply ?? "").replace(/\n/g, " / ").slice(0, 140), ...row(r) };
    }
  }
}

// q) probe (INFO): why ja 「美術館に行きたい」 on a Sydney trip left the destination-category route.
if (section === "q") {
  for (const [locale, t] of [["ja", "美術館に行きたい"], ["ja", "美術館"], ["ja", "シドニーの美術館を教えて"], ["ko", "박물관에 가고 싶어"], ["en", "I want to go to a museum"], ["zh-TW", "我想去博物館"]]) {
    H.freshAll(); await H.freshAuthority(); H.setLocale(locale);
    const s = (await H.first(H.STEP1[locale](H.NAME[locale].sydney), locale)).s;
    const pc = H.mustVisit.mergeContextForPlaceFetch(s.travelContext, s);
    R[`q|${locale}|${t}`] = {
      future: safe(() => H.tpc.isFutureTripPlanningStatement(t)), hasCat: safe(() => H.catTypes.hasCategoryPlaceQuery(t)),
      catDest: safe(() => H.catDest.resolveDestinationForCategorySearch(pc, s, t)), fetchCat: safe(() => H.placeIntent.shouldFetchDestinationCategoryPlaces(t, pc, s)),
      intents: safe(() => H.placeIntent.parseChatPlaceIntents(t)), refine: safe(() => H.arbitrate.shouldSkipTripPlanningForRefinement(t, s)),
      route: safe(() => H.arbitrate.resolveChatIntentArbitration(t, s).route), catSwitch: safe(() => H.tpc.categorySwitchSearchText?.(t)),
    };
  }
}

if (CHILD) {
  process.stdout.write(`@@M20_JSON@@${JSON.stringify({ R, fetchCalls })}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}
let HEAD = null;
if (headDir && section !== "u") {
  const self = "scripts/verify-m20-new-chat-category-city.mjs";
  const harness = "scripts/verify-m16-post-selection-switch-review.mjs";
  for (const f of [self, harness]) if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", `--section=${section}`],
    { cwd: headDir, encoding: "utf8", timeout: 540_000, maxBuffer: 128 << 20 });
  const m = (r.stdout ?? "").match(/@@M20_JSON@@([\s\S]*?)@@END@@/);
  HEAD = m ? JSON.parse(m[1]).R : null;
  if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
}

const BAD_COPY = /this trip\.|以這趟為主|この旅行への|이번 여행.*여행/i;
const ASK_CITY = { "zh-TW": /哪個城市或地區/, en: /Which city or area/i, ja: /どの街やエリア|どの都市やエリア/, ko: /어느 도시나 지역/ };
const brief = (x) => x ? `${x.branch} dest=${x.dest} tpc=${x.tpc} cand=${x.cand ?? "-"} pend=${x.pending ?? "-"} clar=${x.pendClar ? j(x.pendClar) : "-"} ${x.start}~${x.end} geo=${(x.geoQ ?? []).length}${(x.geoQ ?? []).length ? j(x.geoQ) : ""} runs=${x.runs} places=${x.places}${x.categoryText ? ` cat=${x.categoryText}/${x.intent}` : ""} | ${(x.fullReply ?? x.reply ?? "").slice(0, 150)}` : "-";
const line = (k, x) => `${k}\n   W ${brief(x)}${HEAD?.[k] ? `\n   H ${brief(HEAD[k])}` : ""}`;
if (section === "n" || section === "k") out(`INFO mirror: askCity=${H.HAS.HAS_ASK_CITY} noDestAsk=${H.HAS.HAS_NO_DEST_ASK} continuation=${H.HAS.HAS_CONT} word=${H.HAS.HAS_WORD} countryGuard=${H.HAS.HAS_COUNTRY_GUARD} join=${H.HAS.HAS_JOIN} (mirror stops at the push inputs; Places queries: verify-m21 --section=a)`);
for (const [k, x] of Object.entries(R)) {
  const issues = [];
  const [kind, locale, ...rest] = k.split("|");
  if (kind === "i") { out(`INFO ${line(k, x)}`); continue; }
  if (kind === "q") { out(`INFO ${k}\n   W ${j(x)}${HEAD?.[k] ? `\n   H ${j(HEAD[k])}` : ""}`); continue; }
  const geo = (x.geoQ ?? []).length;
  if (kind === "n1") {
    if (!ASK_CITY[locale].test(x.fullReply ?? "")) issues.push("did not ask which city / area");
    if (BAD_COPY.test(x.fullReply ?? "")) issues.push("placeholder destination copy");
    if (geo) issues.push(`geocode ${j(x.geoQ)}`);
    if (x.places || x.runs) issues.push(`places=${x.places} runs=${x.runs}`);
    if (!x.pendClar || x.pendClar.label !== "" || !x.pendClar.text) issues.push(`category not remembered (${j(x.pendClar)})`);
  }
  if (kind === "n2") {
    const [w, a] = rest;
    const cityOnly = a === CITY_OF[locale] || ["東京吧", "東京好了", "도쿄요"].includes(a);
    if (cityOnly) {
      if (x.branch !== "11288 category continuation") issues.push(`no category continuation (${x.branch})`);
      if (!/東京|Tokyo/.test(x.dest ?? "")) issues.push(`dest ${x.dest}`);
      // Requirement 4: the continuation searches the ORIGINAL category in that city. The text handed to
      // pushDestinationCategoryPlaceRecommendation must still carry the wish's category word.
      const wishCategory = H.tpc.categorySwitchSearchText(w);
      if (x.branch === "11288 category continuation" && wishCategory && !wishCategory.split(/\s+/).some((c) => (x.categoryText ?? "").toLowerCase().includes(c.toLowerCase()))) {
        issues.push(`original category 「${wishCategory}」 lost: search text 「${x.categoryText}」 intent=${x.intent}`);
      }
    } else if (["東京 3天", "12/10去東京", "算了"].includes(a)) {
      if (x.branch === "11288 category continuation") issues.push("continued the category search (should be the general flow)");
    }
    if (x.pendClar) issues.push(`category pending survived (${j(x.pendClar)})`);
    if (w === "明天去海邊" && x.start !== "2026-11-10" && x.branch === "11288 category continuation") out(`NOTE ${k}: 明天 start date not carried (${x.start})`);
  }
  if (kind === "n3") {
    if (x.branch === "11288 category continuation") issues.push("pending valid for more than one turn");
  }
  if (kind === "c") {
    const t = rest[0];
    if (x.branch?.startsWith("12651")) issues.push("asked city for a non-category sentence");
    if (/へ行きたいへの|に行きたいへの|へ行きますへの|に行こうへの|에 가고 싶어.*여행/.test(x.fullReply ?? "")) issues.push("wish wording read as the destination");
    const want = /東京|도쿄|Tokyo/.test(t) ? /東京|Tokyo|도쿄/ : /京都|Kyoto/.test(t) ? /京都|Kyoto/ : /大阪/.test(t) ? /大阪/ : /北海道/.test(t) ? /北海道/ : null;
    if (want && t !== "도쿄 3일" && !want.test(`${x.dest} ${x.tpc} ${x.cand}`)) issues.push(`destination not parsed (dest=${x.dest} cand=${x.cand})`);
    if (t === "推薦咖啡廳" && x.pendClar) issues.push("nearby ask turned into a city question");
  }
  if (kind === "k") {
    const c = rest[0];
    const isPlace = /벳푸|Beppu|別府/.test(c);
    if (!isPlace) {
      if (geo) issues.push(`geocode ${j(x.geoQ)}`);
      if (x.places) issues.push(`places ${x.places}`);
      if (/LAST-RESORT/.test(x.branch ?? "")) issues.push("LAST-RESORT");
      if (x.pending !== "region_choice") issues.push(`pending ${x.pending} (want region_choice)`);
      if (!/東京|Tokyo|도쿄|大阪|Osaka|오사카/.test(x.fullReply ?? "")) issues.push("regions not re-listed");
    } else if (!/別府|Beppu|벳푸/i.test(`${x.dest} ${x.tpc} ${x.cand}`)) issues.push("real place not narrowed");
  }
  if (issues.length) {
    const h = HEAD?.[k];
    const headSame = h && issues.every((i) => i.startsWith("destination not parsed") ? !/東京|Tokyo|도쿄/.test(`${h.dest} ${h.tpc} ${h.cand}`) : false);
    out(`ISSUE ${line(k, x)}\n   -> ${issues.join("; ")}`);
    if (headSame) out(`KNOWN ${k}: HEAD-existing`); else fail(k, issues.join("; "));
  } else if (kind !== "u") out(`PASS ${line(k, x)}`);
}
if (fetchCalls) fail("fetch", `no network fetch=${fetchCalls}`);
out(failures.length ? `FAIL ${failures.length} check(s)` : "PASS all");
process.exit(failures.length ? 1 : 0);
