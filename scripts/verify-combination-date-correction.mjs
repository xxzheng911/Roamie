/**
 * K1 — date correction while choosing combinations (「Sorry it's 12/10-12/13」).
 *
 * Device repro (en): 「12/10-12/14 I'm going to sydney」→ Sydney combinations offered; then
 * 「Sorry it's 12/10-12/13」→「I couldn't get suitable place combinations for Australia right now.」
 *
 * Expected: the destination stays the same city, only dates / days change; no discovery
 * failure copy; the correction sentence is never geocoded as a destination.
 *
 * Pipeline emulation per turn (same order as send() in src/routes/_app.chat.tsx):
 *   partial-modify flag (workspace only) → applyTripIntentToSession → prepareSessionForUserTurn →
 *   replan reset → mergeTravelContext → resolveGlobalPlanningCandidate (pending candidate only,
 *   mocked geocodeTripLocationFromText) → discovery (mocked Places search) → processAdviceTurn →
 *   applyAdviceResultToSession.
 *
 * The geocode mock mirrors src/lib/location.functions.ts L280-L317: a Google result that is the
 * country itself yields { country, city: country } (city falls back to the country name).
 *
 * fetch is stubbed (must stay 0). HEAD comparison: `-- --head-dir=<snapshot>` re-runs this file in
 * a scripts/verify-rel1-head-snapshot.mjs snapshot with `--child` and prints both results.
 * Run: npx vite-node scripts/verify-combination-date-correction.mjs --config scripts/vite.verify.config.mjs -- --head-dir=<snapshot>
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDirArg = argv.find((a) => a.startsWith("--head-dir="))?.slice("--head-dir=".length);

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => {
  out("FAIL watchdog: run exceeded time limit");
  process.exit(3);
}, 280_000).unref();

let fetchCalls = 0;
globalThis.fetch = async (...args) => {
  fetchCalls++;
  throw new Error("NO_NETWORK in verify: " + String(args[0]));
};
const load = (p) => import(/* @vite-ignore */ `/${p}`);

const sessionMod = await load("src/lib/chat-session.ts");
const travelContext = await load("src/lib/ai/travel-context.ts");
const stateMachine = await load("src/lib/ai/chat-state-machine.ts");
const advice = await load("src/lib/ai/destination-advice.ts");
const globalPlanning = await load("src/lib/ai/global-planning-context.ts");
const discovery = await load("src/lib/ai/destination-combination-discovery.ts");
const poolCache = await load("src/lib/ai/places-cost-cache/candidate-pool-cache.ts");
const tripIntent = await load("src/lib/recommendation/trip-intent.ts");
const convState = await load("src/lib/ai/chat-conversation-state.ts");
const planningState = await load("src/lib/ai/chat-planning-state.ts");
const countryNorm = await load("src/lib/ai/destination-country-normalize.ts");
const signals = await load("src/lib/ai/travel-language-signals.ts");
const tpc = await load("src/lib/ai/trip-planning-context.ts");
const partialApi = existsSync("src/lib/ai/combination-partial-modify-reply.ts")
  ? await load("src/lib/ai/combination-partial-modify-reply.ts")
  : null;

// ------------------------------------------------------------------ fixtures
const DESTS = {
  sydney: {
    names: { en: "sydney", "zh-TW": "雪梨", ja: "シドニー", ko: "시드니" },
    match: /sydney|雪梨|シドニー|시드니/i,
    city: "Sydney", region: "New South Wales", countryRaw: "Australia", code: "AU",
    lat: -33.8688, lng: 151.2093, countryLat: -25.27, countryLng: 133.77,
    places: ["Sydney Opera House", "Sydney Harbour Bridge", "The Rocks", "Darling Harbour", "Circular Quay", "Bondi Beach",
      "Australian Museum", "Art Gallery of New South Wales", "Museum of Contemporary Art", "Powerhouse Museum", "Australian National Maritime Museum", "Museum of Sydney",
      "Royal Botanic Garden Sydney", "Hyde Park", "Centennial Park", "Barangaroo Reserve", "Chinese Garden of Friendship", "Observatory Hill"],
    address: "Sydney NSW, Australia",
  },
  tokyo: {
    names: { en: "Tokyo", "zh-TW": "東京", ja: "東京", ko: "도쿄" },
    match: /tokyo|東京|도쿄/i,
    city: "東京都", region: "東京都", countryRaw: "Japan", code: "JP",
    lat: 35.6762, lng: 139.6503, countryLat: 36.2, countryLng: 138.25,
    places: ["浅草寺", "東京タワー", "明治神宮", "東京スカイツリー", "皇居", "渋谷スクランブル交差点",
      "東京国立博物館", "国立科学博物館", "森美術館", "江戸東京博物館", "国立新美術館", "東京都現代美術館",
      "上野恩賜公園", "新宿御苑", "代々木公園", "浜離宮恩賜庭園", "六義園", "井の頭恩賜公園"],
    address: "Tokyo Japan",
  },
  seoul: {
    names: { en: "Seoul", "zh-TW": "首爾", ja: "ソウル", ko: "서울" },
    match: /seoul|首爾|ソウル|서울/i,
    city: "서울특별시", region: "서울특별시", countryRaw: "South Korea", code: "KR",
    lat: 37.5665, lng: 126.978, countryLat: 35.9, countryLng: 127.77,
    places: ["경복궁", "창덕궁", "북촌한옥마을", "N서울타워", "명동", "인사동",
      "국립중앙박물관", "국립현대미술관", "서울역사박물관", "전쟁기념관", "리움미술관", "국립민속박물관",
      "남산공원", "서울숲", "한강공원", "올림픽공원", "북한산국립공원", "낙산공원"],
    address: "Seoul South Korea",
  },
  kyoto: {
    names: { en: "Kyoto", "zh-TW": "京都", ja: "京都", ko: "교토" },
    match: /kyoto|京都|교토/i,
    city: "京都市", region: "京都府", countryRaw: "Japan", code: "JP",
    lat: 35.0116, lng: 135.7681, countryLat: 36.2, countryLng: 138.25,
    places: ["清水寺", "金閣寺", "銀閣寺", "元離宮二条城", "産寧坂", "二寧坂",
      "京都国立博物館", "京都市京セラ美術館", "京都鉄道博物館", "京都文化博物館", "京都国際マンガミュージアム", "細見美術館",
      "京都御苑", "円山公園", "京都府立植物園", "嵐山公園", "梅小路公園", "鴨川公園"],
    address: "Kyoto Japan",
  },
};

const STEP1 = {
  en: (n) => `12/10-12/14 I'm going to ${n}`,
  "zh-TW": (n) => `12/10-12/14 我要去${n}`,
  ja: (n) => `12/10-12/14 ${n}へ旅行`,
  ko: (n) => `12/10-12/14 ${n} 여행`,
};

/** [sentence, expected start, expected end, expected days] */
const CORRECTIONS = {
  en: [["Sorry it's 12/10-12/13", "12-10", "12-13", 4], ["Actually 12/11-12/14", "12-11", "12-14", 4], ["change dates to 12/10-12/13", "12-10", "12-13", 4]],
  "zh-TW": [["抱歉是12/10-12/13", "12-10", "12-13", 4], ["改成12/10到12/13", "12-10", "12-13", 4]],
  ja: [["すみません、12/10〜12/13です", "12-10", "12-13", 4]],
  ko: [["죄송해요 12/10-12/13이에요", "12-10", "12-13", 4]],
};

const FAILURE_RE = /couldn.t get suitable place combinations|暫時無法取得|無法確認|取得できません|가져올 수 없|組み合わせを取得|조합을/;

function countryOf(d) {
  const n = countryNorm.normalizeCountryReference(d.countryRaw, d.code);
  return n.country || d.countryRaw;
}
function cityLocation(d) {
  const country = countryOf(d);
  return { placeId: `ChIJ_${d.code}_${d.city}`, country, city: d.city, region: d.region, lat: d.lat, lng: d.lng, formattedName: d.city, displayLabel: d.city };
}
/** location.functions.ts L280-L317 on a country-level Google result: city falls back to the country. */
function countryLocation(d) {
  const country = countryOf(d);
  return { placeId: `ChIJ_country_${d.code}`, country, city: country, region: undefined, lat: d.countryLat, lng: d.countryLng, formattedName: country, displayLabel: country };
}

const geocodeLog = [];
/** Mock Google geocode: the city name resolves to the city; any other text with the country hint
 * ("<junk>, Australia") resolves to the country itself (Google's top hit for such a query). */
function makeGeocode(d) {
  return async (query) => {
    geocodeLog.push(query);
    if (d.match.test(query)) return { rawResultCount: 1, location: cityLocation(d) };
    const country = countryOf(d);
    const hinted = [country, d.countryRaw, d.code].some((c) => c && query.includes(`, ${c}`));
    if (hinted) return { rawResultCount: 1, location: countryLocation(d) };
    return { rawResultCount: 0, location: null };
  };
}

/** zh-TW Places responses come back in Han script (languageCode=zh-TW); kana / Hangul would be
 * dropped by the zh-TW localization gate, which is a fixture artefact, not the bug under test. */
const ZH_PLACES = {
  tokyo: ["淺草寺", "東京鐵塔", "明治神宮", "東京晴空塔", "皇居", "澀谷十字路口",
    "東京國立博物館", "國立科學博物館", "森美術館", "江戶東京博物館", "國立新美術館", "東京都現代美術館",
    "上野恩賜公園", "新宿御苑", "代代木公園", "濱離宮恩賜庭園", "六義園", "井之頭恩賜公園"],
  seoul: ["景福宮", "昌德宮", "北村韓屋村", "南山首爾塔", "明洞", "仁寺洞",
    "國立中央博物館", "國立現代美術館", "首爾歷史博物館", "戰爭紀念館", "三星美術館", "國立民俗博物館",
    "南山公園", "首爾林", "漢江公園", "奧林匹克公園", "北漢山國立公園", "駱山公園"],
};
function poolFor(d, locale) {
  const key = Object.keys(DESTS).find((k) => DESTS[k] === d);
  const zh = locale === "zh-TW" ? ZH_PLACES[key] : undefined;
  return (zh ?? d.places).map((name, i) => ({
    id: `ChIJ${d.code}Place${i}`, name, sourceLocale: zh ? "zh-TW" : d.code === "AU" ? "en" : d.code === "KR" ? "ko" : "ja",
    lat: d.lat + i * 0.0003, lng: d.lng,
    types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"],
    primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park",
    rating: 4.6, userRatingCount: 10000, address: d.address, businessStatus: "OPERATIONAL",
  }));
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/** One send() turn (see header). */
async function sendTurn(s0, t, locale, d) {
  const s = clone(s0);
  const lastReply = s.lastAssistantReply;
  const flag = partialApi
    ? partialApi.isCombinationChoiceTurn(s) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply(t))
    : false;
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, lastReply);
  if (planningState.isReplanIntent(t) && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const m = travelContext.mergeTravelContext(n, t, lastReply);
  let session = m.session;
  let ctx = m.context;
  const geocodeBefore = geocodeLog.length;
  const candidateRaw = ctx.destinationCandidate?.status === "pending" ? ctx.destinationCandidate.raw : null;
  const candidateHint = ctx.destinationCandidate?.status === "pending" ? ctx.destinationCandidate.countryHint ?? null : null;
  if (ctx.destinationCandidate?.status === "pending") {
    session = await globalPlanning.resolveGlobalPlanningCandidate(session, locale, makeGeocode(d));
    ctx = session.travelContext ?? ctx;
  }
  let ready = null;
  let searchCalls = 0;
  const unresolved = Boolean(ctx.destinationClarification || (ctx.destinationCandidate && ctx.destinationCandidate.status !== "resolved"));
  const days = ctx.days ?? session.tripDays;
  if (!unresolved && ctx.destination && days) {
    ready = await discovery.ensureDestinationCombinationsReady({
      destination: ctx.destination,
      destinationCountry: ctx.destinationCountryCode ?? ctx.destinationCountry,
      locale,
      days,
      resolvedDestination: ctx.destinationCoordinates
        ? {
            label: ctx.destination, city: ctx.destinationCity ?? ctx.destination, country: ctx.destinationCountryCode ?? ctx.destinationCountry,
            countryCode: ctx.destinationCountryCode, type: ctx.destinationType ?? "city",
            latitude: ctx.destinationCoordinates.lat, longitude: ctx.destinationCoordinates.lng,
            placeId: session.tripDestination?.placeId, source: "trip_destination", scopeLocked: false,
          }
        : undefined,
      searchPlaces: async () => {
        searchCalls++;
        return { places: poolFor(d, locale), error: null };
      },
    }).catch((e) => ({ ok: false, failureReason: `threw:${e?.message ?? e}` }));
  }
  const r = stateMachine.processAdviceTurn(t, session, ctx, undefined, locale);
  const next = advice.applyAdviceResultToSession(
    { ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply ?? lastReply },
    r.advice,
  );
  return {
    r, s: next, flag,
    trace: {
      flag, candidateRaw, candidateHint, geocodeQueries: geocodeLog.slice(geocodeBefore),
      readyOk: ready ? Boolean(ready.ok) : null, readyFailure: ready && !ready.ok ? ready.failureReason ?? discovery.getLastCombinationDiscoveryFailure()?.reason ?? null : null,
      searchCalls,
    },
  };
}

function snapshot(turn) {
  const s = turn.s;
  const tc = s.travelContext ?? {};
  return {
    destination: tc.destination ?? null,
    destinationType: tc.destinationType ?? null,
    destinationCountry: tc.destinationCountry ?? null,
    destinationCity: tc.destinationCity ?? null,
    tripDestinationCity: s.tripDestination?.city ?? null,
    tripDestinationCountry: s.tripDestination?.country ?? null,
    startDate: tc.startDate ?? null,
    endDate: tc.endDate ?? null,
    days: tc.days ?? null,
    tripDays: s.tripDays ?? null,
    pending: s.pendingQuestion?.type ?? null,
    offered: tc.offeredCombinations?.length ?? 0,
    reply: turn.r.advice.reply ?? null,
    ...turn.trace,
  };
}

async function runAll() {
  const res = {};
  for (const locale of Object.keys(CORRECTIONS)) {
    for (const [key, d] of Object.entries(DESTS)) {
      discovery.clearDiscoveredCombinationsCache();
      poolCache.clearCandidatePoolCache();
      const s0 = sessionMod.createEmptySession();
      const step1 = await sendTurn(s0, STEP1[locale](d.names[locale]), locale, d);
      const fixture = snapshot(step1);
      const cases = {};
      for (const [text] of CORRECTIONS[locale]) {
        // Each correction starts from the same offered session (combination cache kept warm, as on device).
        cases[text] = snapshot(await sendTurn(step1.s, text, locale, d));
      }
      res[`${locale}|${key}`] = { fixture, cases };
    }
  }
  return res;
}

// ------------------------------------------------------------------ child (HEAD snapshot)
if (CHILD) {
  const res = await runAll();
  out("@@K1_JSON@@" + JSON.stringify({ res, fetchCalls, hasPartial: Boolean(partialApi) }) + "@@END@@");
  process.exit(0);
}

// ------------------------------------------------------------------ main
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    out(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    out(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").join("\n  ")}`);
  }
}

function headResults() {
  const dir = headDirArg;
  if (!dir) return null;
  assert.ok(existsSync(join(dir, "src")), `bad --head-dir ${dir}`);
  const self = "scripts/verify-combination-date-correction.mjs";
  if (!existsSync(join(dir, self)) || readFileSync(join(dir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(dir, self));
  const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"],
    { cwd: dir, encoding: "utf8", timeout: 270_000, maxBuffer: 64 << 20 });
  const m = (r.stdout ?? "").match(/@@K1_JSON@@([\s\S]*?)@@END@@/);
  assert.ok(m, `HEAD child produced no JSON (status ${r.status}): ${(r.stdout ?? "").slice(-800)} ${(r.stderr ?? "").slice(-1500)}`);
  return JSON.parse(m[1]);
}

// Pure root-cause probe: the correction sentence must never be a destination candidate.
await check("root cause: travelDestinationCandidates() never reads a date-correction sentence as a destination", () => {
  const bad = [];
  for (const [text] of Object.values(CORRECTIONS).flat()) {
    const names = signals.travelDestinationCandidates(text);
    if (names.length) bad.push(`${JSON.stringify(text)} → ${JSON.stringify(names)}`);
  }
  assert.deepEqual(bad, [], "date-correction sentences extracted as destination names");
});

const WORK = await runAll();
const fmtDate = (iso) => (iso ? iso.slice(5) : null);

for (const [id, { fixture, cases }] of Object.entries(WORK)) {
  const [locale, key] = id.split("|");
  const d = DESTS[key];
  await check(`${id}: step 1 offers combinations for the city (mock only)`, () => {
    assert.equal(fixture.pending, "combination_choice", `pending=${fixture.pending}\nreply=${fixture.reply}`);
    assert.ok(fixture.offered >= 2, `offered=${fixture.offered}`);
    assert.equal(fixture.days, 5, `days=${fixture.days}`);
  });
  for (const [text, start, end, days] of CORRECTIONS[locale]) {
    const c = cases[text];
    await check(`${id}: 「${text}」 keeps ${fixture.destination}, updates dates/days, no failure copy`, () => {
      const errs = [];
      if (c.geocodeQueries.length) errs.push(`sentence geocoded as destination: ${JSON.stringify(c.geocodeQueries)} (candidate=${JSON.stringify(c.candidateRaw)} hint=${JSON.stringify(c.candidateHint)})`);
      // Same city under another alias (Sydney / 雪梨) is the same destination.
      const canon = (x) => (x ? tpc.normalizeDestinationLabel(x) : x);
      if (canon(c.destination) !== canon(fixture.destination)) errs.push(`destination ${fixture.destination} → ${c.destination} (type ${c.destinationType})`);
      if (c.tripDestinationCity && canon(c.tripDestinationCity) !== canon(fixture.tripDestinationCity ?? fixture.destination)) errs.push(`tripDestination.city ${fixture.tripDestinationCity} → ${c.tripDestinationCity}`);
      if (fmtDate(c.startDate) !== start || fmtDate(c.endDate) !== end) errs.push(`dates ${c.startDate}..${c.endDate} (want ${start}..${end})`);
      if (c.days !== days) errs.push(`days ${c.days} (want ${days})`);
      if (c.reply && FAILURE_RE.test(c.reply)) errs.push(`failure copy: ${c.reply.split("\n").join(" / ")}`);
      if (c.readyOk === false) errs.push(`discovery failed: ${c.readyFailure}`);
      if (!["combination_choice"].includes(c.pending) && c.offered < 1) errs.push(`no combinations (pending=${c.pending}, offered=${c.offered})`);
      assert.deepEqual(errs, [], `${d.city}`);
    });
  }
}

await check("network: fetch calls = 0", () => assert.equal(fetchCalls, 0));

let HEAD = null;
if (headDirArg) {
  await check("HEAD snapshot probe ran (same pipeline, HEAD source)", () => {
    HEAD = headResults();
    assert.equal(HEAD.fetchCalls, 0, "HEAD fetch calls");
    assert.equal(HEAD.hasPartial, false, "snapshot must be HEAD source (no combination-partial-modify-reply.ts)");
  });
}

// ------------------------------------------------------------------ report table
const short = (c) => c ? `dest=${c.destination}(${c.destinationType}) days=${c.days} ${c.startDate ?? "-"}..${c.endDate ?? "-"} pending=${c.pending} cand=${JSON.stringify(c.candidateRaw)} geo=${JSON.stringify(c.geocodeQueries)} ready=${c.readyOk}${c.readyFailure ? `:${c.readyFailure}` : ""} reply=${JSON.stringify((c.reply ?? "").split("\n").slice(-2).join(" / ").slice(0, 140))}` : "n/a";
out("\n---- per-case (WORK vs HEAD)");
for (const [id, { cases, fixture }] of Object.entries(WORK)) {
  out(`[${id}] step1 WORK: ${short(fixture)}`);
  if (HEAD) out(`[${id}] step1 HEAD: ${short(HEAD.res[id]?.fixture)}`);
  for (const text of Object.keys(cases)) {
    out(`  「${text}」\n    WORK: ${short(cases[text])}`);
    if (HEAD) {
      const h = HEAD.res[id]?.cases?.[text];
      out(`    HEAD: ${short(h)}`);
      out(`    state-same-as-HEAD: ${h ? JSON.stringify({ ...h, reply: null }) === JSON.stringify({ ...cases[text], reply: null }) : "n/a"} reply-same-as-HEAD: ${h ? h.reply === cases[text].reply : "n/a"}`);
    }
  }
}

out(`\n${failures.length ? "FAIL" : "PASS"} verify-combination-date-correction — ${failures.length} failing check(s); fetch=${fetchCalls}`);
process.exit(failures.length ? 1 : 0);
