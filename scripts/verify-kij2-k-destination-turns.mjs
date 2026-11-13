/**
 * KIJ2-K — first-turn destinations, city-states, and destination switch while choosing combinations.
 *
 * Pipeline per turn (same order as send() in src/routes/_app.chat.tsx, reduced to the branches
 * reachable in these fixtures; mirrors scripts/verify-combination-date-correction.mjs):
 *   classifyDestinationSwitchTurn (L8773) → isRepeatedTripDateConfirmation early return (L8774) →
 *   A2 gate: NEGATED_UNCERTAIN → E1 switch confirmation (L9210), CONFIRMED_SWITCH → Authority
 *   (resolveTrustedRecommendationSearchScope) + applyConfirmedDestinationSwitch (L9404) →
 *   partial-modify flag (L10864) → applyTripIntentToSession → prepareSessionForUserTurn → replan reset
 *   (L11350) → mergeTravelContext (L11396) → resolveGlobalPlanningCandidate (L11443, mocked geocode)
 *   → clarification branch (L11590) / discovery (mocked Places) → processAdviceTurn →
 *   applyAdviceResultToSession.
 *
 * Geocode mock mirrors src/lib/location.functions.ts L280-L317 (country-level hit: city falls back to
 * the country name; city-states: city = formatted name, country = normalized country, no region).
 * fetch is stubbed (must stay 0). HEAD comparison: `-- --head-dir=<snapshot>` re-runs this file in the
 * snapshot with `--child` and prints both results side by side.
 *
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=400 scripts/verify-kij2-k-destination-turns.mjs -- --head-dir=<snap>
 */
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
const loadOpt = async (p) => (existsSync(p) ? await load(p) : null);

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
const tpc = await load("src/lib/ai/trip-planning-context.ts");
const turnDest = await load("src/lib/ai/chat-turn-destination.ts");
const dateConfirm = await loadOpt("src/lib/ai/trip-date-confirmation.ts");
const partialApi = await loadOpt("src/lib/ai/combination-partial-modify-reply.ts");

// ------------------------------------------------------------------ fixtures
const PLACES18 = (prefix) => Array.from({ length: 18 }, (_, i) => `${prefix} ${["Temple", "Tower", "Market", "Garden", "Museum", "Bridge"][i % 6]} ${i + 1}`);
const DESTS = {
  sydney: { match: /sydney|雪梨|シドニー|시드니/i, formatted: "Sydney", region: "New South Wales", countryRaw: "Australia", code: "AU", lat: -33.8688, lng: 151.2093, places: PLACES18("Sydney"), srcLocale: "en" },
  tokyo: { match: /tokyo|東京|도쿄/i, formatted: "東京都", region: "東京都", countryRaw: "Japan", code: "JP", lat: 35.6762, lng: 139.6503, places: PLACES18("東京"), srcLocale: "ja" },
  kyoto: { match: /kyoto|京都|교토/i, formatted: "京都市", region: "京都府", countryRaw: "Japan", code: "JP", lat: 35.0116, lng: 135.7681, places: PLACES18("京都"), srcLocale: "ja" },
  singapore: { match: /singapore|新加坡|シンガポール|싱가포르/i, formatted: "Singapore", region: undefined, countryRaw: "Singapore", code: "SG", lat: 1.3521, lng: 103.8198, places: PLACES18("Singapore"), srcLocale: "en" },
  hongkong: { match: /hong ?kong|香港|홍콩/i, formatted: "Hong Kong", region: undefined, countryRaw: "Hong Kong", code: "HK", lat: 22.3193, lng: 114.1694, places: PLACES18("Hong Kong"), srcLocale: "en" },
  macau: { match: /maca[uo]|澳門|澳门|マカオ|마카오/i, formatted: "Macao", region: undefined, countryRaw: "Macao", code: "MO", lat: 22.1987, lng: 113.5439, places: PLACES18("Macao"), srcLocale: "en" },
};
const countryOf = (d) => countryNorm.normalizeCountryReference(d.countryRaw, d.code).country || d.countryRaw;
/** Google answers in the request language (send() passes locale): city-states' formatted name follows it. */
const CITY_STATE_FORMATTED = {
  SG: { en: "Singapore", "zh-TW": "新加坡", ja: "シンガポール", ko: "싱가포르" },
  HK: { en: "Hong Kong", "zh-TW": "香港", ja: "香港", ko: "홍콩" },
  MO: { en: "Macao", "zh-TW": "澳門", ja: "マカオ", ko: "마카오" },
};
let geocodeLocale = "en";
function cityLocation(d) {
  const country = countryOf(d);
  const city = CITY_STATE_FORMATTED[d.code]?.[geocodeLocale] ?? d.formatted ?? country;
  return { placeId: `ChIJ_${d.code}_${city}`, country: country || city, city, region: d.region, lat: d.lat, lng: d.lng, formattedName: city, displayLabel: city };
}
const geocodeLog = [];
const geocodeFor = async (query) => {
  geocodeLog.push(query);
  for (const d of Object.values(DESTS)) if (d.match.test(query)) return { rawResultCount: 1, location: cityLocation(d) };
  return { rawResultCount: 0, location: null };
};
/** A2 Authority geocode envelope (GeocodeDestinationFn). */
const authorityGeocode = async (req) => {
  const r = await geocodeFor(req?.data?.query ?? "");
  return { location: r.location, providerResult: { ok: Boolean(r.location), rawResultCount: r.rawResultCount }, error: null };
};
function poolFor(destination) {
  const d = Object.values(DESTS).find((x) => x.match.test(destination ?? "")) ?? DESTS.sydney;
  return d.places.map((name, i) => ({
    id: `ChIJ${d.code}Place${i}`, name, sourceLocale: d.srcLocale, lat: d.lat + i * 0.0003, lng: d.lng,
    types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park",
    rating: 4.6, userRatingCount: 10000, address: `${d.formatted} ${d.countryRaw}`, businessStatus: "OPERATIONAL",
  }));
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const SWITCH_COPY_RE = /要切換|切換到|switch to .*\?|切り替え|변경할까요|바꿀까요/i;
const FAILURE_RE = /couldn.t get suitable place combinations|暫時無法取得|無法確認|取得できません|가져올 수 없|請確認目的地|Please confirm the destination|目的地を確認|목적지를 확인/i;

// _app.chat.tsx L923-L969 (module-private): P1 equivalence.
function sameNormalized(a, b) {
  const l = a?.trim(); const r = b?.trim();
  return Boolean(l && r && tpc.normalizeDestinationLabel(l) === tpc.normalizeDestinationLabel(r));
}
function isEquivalentSwitchDestination({ label, trusted, ctx, session, locale }) {
  label = label?.trim(); trusted = trusted?.trim();
  if (!label || !trusted) return false;
  if (sameNormalized(label, trusted)) return true;
  const resolve = (text) => turnDest.resolveCategoryTurnDestination({ ctx, session, userText: text, locale });
  const own = resolve(label);
  if (own.source === "session" || (own.confidence !== "confirmed" && own.confidence !== "curated")) return false;
  if (!sameNormalized(own.destination, trusted)) return false;
  const ref = resolve(trusted);
  return ref.source !== "session" && (ref.confidence === "confirmed" || ref.confidence === "curated") && ref.destinationType === own.destinationType;
}

/** One send() turn (see header). */
async function sendTurn(s0, t, locale) {
  geocodeLocale = locale;
  let s = clone(s0);
  const lastReply = s.lastAssistantReply;
  const geocodeBefore = geocodeLog.length;
  const turnSwitch = tpc.classifyDestinationSwitchTurn(t);
  const base = { switchState: turnSwitch.state, switchTarget: turnSwitch.targetLabel ?? null };
  if (dateConfirm?.isRepeatedTripDateConfirmation?.(s, t) && turnSwitch.state === "NO_SWITCH") {
    return { s, reply: null, gate: "repeated_date_confirmation_silent_return", ...base };
  }
  let switched = false;
  let gate = null;
  if (turnSwitch.state === "NEGATED_UNCERTAIN") {
    return { s, reply: "[E1 destinationSwitchConfirm]", gate: "e1_switch_confirmation", ...base, geocodeQueries: geocodeLog.slice(geocodeBefore) };
  }
  if (turnSwitch.state === "CONFIRMED_SWITCH") {
    const target = turnSwitch.targetLabel?.trim();
    const scope = await turnDest.resolveTrustedRecommendationSearchScope({ label: target, ctx: s.travelContext ?? { interests: [] }, session: s, locale, geocodeFn: authorityGeocode }).catch((e) => ({ status: "unavailable", reason: `threw:${e?.message}` }));
    if (scope.status !== "trusted") return { s, reply: "[destinationSwitchStopped]", gate: `k2_${scope.reason}`, ...base };
    const res = travelContext.applyConfirmedDestinationSwitch({ ...s, pendingClarification: undefined }, { label: target, requestText: t, turnResetBase: { planningSessionId: s.planningSessionId, planVersion: s.planVersion }, resetAlreadyThisTurn: false });
    if ("stop" in res || !res.applied) return { s, reply: "[destinationSwitchStopped]", gate: "stop" in res ? `wrapper_${res.stop}` : "wrapper_not_applied", ...base };
    s = res.session; switched = true; gate = "switch_committed";
  }
  const flag = partialApi ? partialApi.isCombinationChoiceTurn(s) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply(t)) : false;
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, lastReply);
  if (planningState.isReplanIntent(t) && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const m = travelContext.mergeTravelContext(n, t, lastReply);
  let session = m.session;
  let ctx = m.context;
  const candidateRaw = ctx.destinationCandidate?.status === "pending" ? ctx.destinationCandidate.raw : null;
  if (ctx.destinationCandidate?.status === "pending") {
    session = await globalPlanning.resolveGlobalPlanningCandidate(session, locale, geocodeFor);
    ctx = session.travelContext ?? ctx;
  }
  const unresolved = Boolean(ctx.destinationClarification || (ctx.destinationCandidate && ctx.destinationCandidate.status !== "resolved"));
  let ready = null;
  const days = ctx.days ?? session.tripDays;
  if (!unresolved && !flag && ctx.destination && days) {
    ready = await discovery.ensureDestinationCombinationsReady({
      destination: ctx.destination, destinationCountry: ctx.destinationCountryCode ?? ctx.destinationCountry, locale, days,
      resolvedDestination: ctx.destinationCoordinates ? {
        label: ctx.destination, city: ctx.destinationCity ?? ctx.destination, country: ctx.destinationCountryCode ?? ctx.destinationCountry,
        countryCode: ctx.destinationCountryCode, type: ctx.destinationType ?? "city", latitude: ctx.destinationCoordinates.lat, longitude: ctx.destinationCoordinates.lng,
        placeId: session.tripDestination?.placeId, source: "trip_destination", scopeLocked: false,
      } : undefined,
      searchPlaces: async () => ({ places: poolFor(ctx.destination), error: null }),
    }).catch((e) => ({ ok: false, failureReason: `threw:${e?.message ?? e}` }));
  }
  const r = stateMachine.processAdviceTurn(t, session, ctx, undefined, locale);
  const next = advice.applyAdviceResultToSession(
    { ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply ?? lastReply },
    r.advice,
  );
  return {
    s: next, reply: r.advice.reply ?? null, gate: gate ?? (unresolved ? "clarification_branch" : flag ? "partial_modify_branch" : "advice"), switched, flag, candidateRaw,
    geocodeQueries: geocodeLog.slice(geocodeBefore), readyOk: ready ? Boolean(ready.ok) : null,
    readyFailure: ready && !ready.ok ? ready.failureReason ?? discovery.getLastCombinationDiscoveryFailure?.()?.reason ?? null : null, ...base,
  };
}
function snap(turn) {
  const s = turn.s; const tc = s.travelContext ?? {};
  return {
    destination: tc.destination ?? null, destinationType: tc.destinationType ?? null, destinationCountry: tc.destinationCountry ?? null,
    tripDestinationCity: s.tripDestination?.city ?? null, startDate: tc.startDate ?? null, endDate: tc.endDate ?? null, days: tc.days ?? null,
    pending: s.pendingQuestion?.type ?? null, offered: tc.offeredCombinations?.length ?? 0, clarification: tc.destinationClarification ?? null,
    candidateStatus: tc.destinationCandidate?.status ?? null,
    reply: turn.reply, gate: turn.gate, switchState: turn.switchState, switchTarget: turn.switchTarget, flag: turn.flag ?? null,
    candidateRaw: turn.candidateRaw ?? null, geocodeQueries: turn.geocodeQueries ?? [], readyOk: turn.readyOk ?? null, readyFailure: turn.readyFailure ?? null,
  };
}
function fresh() {
  discovery.clearDiscoveredCombinationsCache();
  poolCache.clearCandidatePoolCache();
}

const FIRST_TURN = [
  ["en", "Tokyo 11/25-11/30", "tokyo", "11-25", "11-30", 6],
  ["en", "12/10-12/14 I'm going to sydney", "sydney", "12-10", "12-14", 5],
  ["zh-TW", "東京 11/25-11/30", "tokyo", "11-25", "11-30", 6],
  ["ja", "11/25-11/30に東京へ行きます", "tokyo", "11-25", "11-30", 6],
];
const CITY_STATES = [
  ["en", "Singapore 12/10-12/14", "singapore", "Sorry it's 12/10-12/13"],
  ["en", "12/10-12/14 I'm going to Singapore", "singapore", "Actually 12/11-12/14"],
  ["zh-TW", "12/10-12/14 我要去新加坡", "singapore", "抱歉是12/10-12/13"],
  ["ja", "12/10-12/14 シンガポールへ旅行", "singapore", "すみません、12/10〜12/13です"],
  ["ko", "12/10-12/14 싱가포르 여행", "singapore", "죄송해요 12/10-12/13이에요"],
  ["en", "Hong Kong 12/10-12/14", "hongkong", "Sorry it's 12/10-12/13"],
  ["zh-TW", "香港 12/10-12/14", "hongkong", "抱歉是12/10-12/13"],
  ["en", "Macau 12/10-12/14", "macau", "change dates to 12/10-12/13"],
  ["zh-TW", "12/10-12/14 我要去澳門", "macau", "改成12/10到12/13"],
  ["ko", "12/10-12/14 홍콩 여행", "hongkong", "죄송해요 12/10-12/13이에요"],
  ["ja", "12/10-12/14 マカオへ旅行", "macau", "すみません、12/10〜12/13です"],
  ["ko", "12/10-12/14 마카오 여행", "macau", "죄송해요 12/10-12/13이에요"],
  ["ja", "12/10-12/14 香港へ旅行", "hongkong", "すみません、12/10〜12/13です"],
];
const SWITCH_SENTENCES = ["I'm going to Kyoto 12/10-12/13", "switch to Kyoto", "改去京都", "Kyoto 12/10-12/13", "京都 12/10-12/13"];
const SYDNEY_STEP1 = { en: "12/10-12/14 I'm going to sydney", "zh-TW": "12/10-12/14 我要去雪梨" };

async function runAll() {
  const res = { first: {}, cityStates: {}, switch: {} };
  for (const [locale, text] of FIRST_TURN) {
    fresh();
    res.first[`${locale}|${text}`] = snap(await sendTurn(sessionMod.createEmptySession(), text, locale));
  }
  for (const [locale, text, , correction] of CITY_STATES) {
    fresh();
    const step1 = await sendTurn(sessionMod.createEmptySession(), text, locale);
    const corr = await sendTurn(step1.s, correction, locale);
    res.cityStates[`${locale}|${text}`] = { step1: snap(step1), correction: snap(corr), correctionText: correction };
  }
  for (const locale of Object.keys(SYDNEY_STEP1)) {
    fresh();
    const step1 = await sendTurn(sessionMod.createEmptySession(), SYDNEY_STEP1[locale], locale);
    const cases = {};
    for (const t of SWITCH_SENTENCES) cases[t] = snap(await sendTurn(step1.s, t, locale));
    res.switch[locale] = { step1: snap(step1), cases };
  }
  return res;
}

if (CHILD) {
  const res = await runAll();
  out("@@KIJ2K_JSON@@" + JSON.stringify({ res, fetchCalls, hasPartial: Boolean(partialApi) }) + "@@END@@");
  process.exit(0);
}

// ------------------------------------------------------------------ main
const failures = [];
async function check(name, fn) {
  try { await fn(); out(`PASS ${name}`); } catch (error) { failures.push(name); out(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").join("\n  ")}`); }
}
const WORK = await runAll();
const md = (iso) => (iso ? iso.slice(5) : null);
const canon = (x) => (x ? tpc.normalizeDestinationLabel(x) : x);
const isDest = (label, key) => Boolean(label) && DESTS[key].match.test(`${label}`) || [label].some((l) => l && DESTS[key].match.test(tpc.normalizeDestinationLabel(l)));

for (const [locale, text, key, start, end, days] of FIRST_TURN) {
  const c = WORK.first[`${locale}|${text}`];
  await check(`first turn [${locale}] 「${text}」 → ${key} ${start}..${end}, combinations offered`, () => {
    const errs = [];
    if (!isDest(c.destination, key)) errs.push(`destination=${c.destination}`);
    if (md(c.startDate) !== start || md(c.endDate) !== end || c.days !== days) errs.push(`dates ${c.startDate}..${c.endDate} days=${c.days}`);
    if (c.pending !== "combination_choice" || c.offered < 2) errs.push(`pending=${c.pending} offered=${c.offered} gate=${c.gate}`);
    if (c.reply && FAILURE_RE.test(c.reply)) errs.push(`failure copy: ${c.reply}`);
    assert.deepEqual(errs, []);
  });
}
for (const [locale, text, key] of CITY_STATES) {
  const { step1, correction, correctionText } = WORK.cityStates[`${locale}|${text}`];
  await check(`city-state first turn [${locale}] 「${text}」 resolves ${key} (not demoted as country-level)`, () => {
    const errs = [];
    if (!isDest(step1.destination, key) && !isDest(step1.tripDestinationCity, key)) errs.push(`destination=${step1.destination} trip=${step1.tripDestinationCity}`);
    if (step1.clarification || (step1.candidateStatus && step1.candidateStatus !== "resolved")) errs.push(`clarification=${step1.clarification} candidate=${step1.candidateStatus}`);
    if (step1.pending !== "combination_choice" || step1.offered < 2) errs.push(`pending=${step1.pending} offered=${step1.offered} ready=${step1.readyOk}:${step1.readyFailure}`);
    if (step1.reply && FAILURE_RE.test(step1.reply)) errs.push(`failure copy: ${step1.reply}`);
    assert.deepEqual(errs, [], JSON.stringify(step1));
  });
  await check(`city-state date change [${locale}] 「${correctionText}」 keeps ${key}, no geocode`, () => {
    const errs = [];
    if (canon(correction.destination) !== canon(step1.destination)) errs.push(`destination ${step1.destination} → ${correction.destination}`);
    if (correction.geocodeQueries.length) errs.push(`geocoded ${JSON.stringify(correction.geocodeQueries)}`);
    if (!correction.startDate || !correction.endDate || correction.days !== 4) errs.push(`dates ${correction.startDate}..${correction.endDate} days=${correction.days}`);
    if (correction.pending !== "combination_choice") errs.push(`pending=${correction.pending}`);
    if (correction.reply && FAILURE_RE.test(correction.reply)) errs.push(`failure copy: ${correction.reply}`);
    assert.deepEqual(errs, [], JSON.stringify(correction));
  });
}
// Switch investigation: hard requirements only (no error copy, never a country as destination).
for (const [locale, { step1, cases }] of Object.entries(WORK.switch)) {
  await check(`switch fixture [${locale}] Sydney combinations offered`, () => {
    assert.equal(step1.pending, "combination_choice", JSON.stringify(step1));
  });
  for (const [t, c] of Object.entries(cases)) {
    await check(`switch [${locale}] 「${t}」: no failure copy, destination never a country`, () => {
      const errs = [];
      if (c.reply && FAILURE_RE.test(c.reply)) errs.push(`failure copy: ${c.reply}`);
      if (c.destinationType === "country" || countryNorm.localizedCountryReference?.(c.destination ?? "")?.code && !isDest(c.destination, "singapore")) errs.push(`country destination ${c.destination} (${c.destinationType})`);
      assert.deepEqual(errs, []);
    });
  }
}
// Unit: resolveGlobalPlanningCandidate country-level guard (global-planning-context.ts L93-L98).
const countryLevelInfo = [];
{
  const ctxWith = (raw, countryHint) => ({ ...sessionMod.createEmptySession(), travelContext: { interests: [], destinationCandidate: { raw, status: "pending", ...(countryHint ? { countryHint } : {}) } } });
  const countryLevelHit = (countryRaw, code, cityText) => async () => {
    const country = countryNorm.normalizeCountryReference(countryRaw, code).country || countryRaw;
    return { rawResultCount: 1, location: { placeId: `ChIJ_country_${code}`, country, city: cityText ?? country, region: undefined, lat: 1, lng: 1, formattedName: cityText ?? country, displayLabel: cityText ?? country } };
  };
  const status = async (raw, hit, hint) => (await globalPlanning.resolveGlobalPlanningCandidate(ctxWith(raw, hint), "en", hit)).travelContext?.destinationCandidate?.status;
  const CITY_STATE_RAWS = [
    ["Singapore", "SG"], ["新加坡", "SG"], ["シンガポール", "SG"], ["싱가포르", "SG"],
    ["Hong Kong", "HK"], ["香港", "HK"], ["홍콩", "HK"],
    ["Macau", "MO"], ["Macao", "MO"], ["澳門", "MO"], ["マカオ", "MO"], ["마카오", "MO"],
  ];
  const NAMES = { SG: ["Singapore", "Singapore"], HK: ["Hong Kong", "Hong Kong"], MO: ["Macao", "Macao"] };
  const rawLocale = (raw) => (/\p{Script=Hangul}/u.test(raw) ? "ko" : /\p{Script=Katakana}/u.test(raw) ? "ja" : /\p{Script=Han}/u.test(raw) ? "zh-TW" : "en");
  await check("country-level guard: city-state typed by name stays resolved (geocode answers in the typed name's language)", async () => {
    const bad = [];
    for (const [raw, code] of CITY_STATE_RAWS) {
      const cityText = CITY_STATE_FORMATTED[code][rawLocale(raw)];
      const st = await status(raw, countryLevelHit(NAMES[code][0], code, cityText));
      if (st !== "resolved") bad.push(`${raw} (city=${cityText}) → ${st}`);
    }
    assert.deepEqual(bad, []);
  });
  // Cross-language (raw script ≠ geocode language, e.g. ko user on an en UI typing 홍콩): INFO.
  for (const [raw, code] of CITY_STATE_RAWS) {
    for (const cityText of [undefined, NAMES[code][1]]) {
      const st = await status(raw, countryLevelHit(NAMES[code][0], code, cityText));
      if (st !== "resolved") countryLevelInfo.push(`${raw} with city=${cityText ?? "normalized country"} → ${st}`);
    }
  }
  countryLevelInfo.push(`normalizeCountryReference: ${["홍콩", "マカオ", "마카오", "シンガポール", "싱가포르"].map((r) => `${r}→${countryNorm.normalizeCountryReference(r).countryCode ?? "?"}`).join(", ")}`);
  await check("country-level guard: non-country text whose geocode is a country-level hit is NOT resolved", async () => {
    const bad = [];
    for (const [raw, countryRaw, code, hint] of [["Sorry it's", "Australia", "AU", "Australia"], ["抱歉是", "Japan", "JP", "日本"], ["Actually", "South Korea", "KR", "韓國"], ["Kyoto", "Japan", "JP"], ["Lindefu", "Australia", "AU"]]) {
      const st = await status(raw, countryLevelHit(countryRaw, code), hint);
      if (st === "resolved") bad.push(`${raw} → resolved as ${countryRaw}`);
    }
    assert.deepEqual(bad, []);
  });
  await check("country-level guard: a real city hit (has region / city differs from country) is unaffected", async () => {
    const st = await status("Sydney", async () => ({ rawResultCount: 1, location: cityLocation(DESTS.sydney) }));
    assert.equal(st, "resolved");
    const st2 = await status("Kyoto", async () => ({ rawResultCount: 1, location: { ...cityLocation(DESTS.kyoto), region: undefined } }));
    assert.equal(st2, "resolved");
  });
  for (const raw of ["Singapore City", "新加坡市", "Hong Kong SAR"]) {
    const code = /hong/i.test(raw) ? "HK" : "SG";
    countryLevelInfo.push(`${raw} + country-level hit → ${await status(raw, countryLevelHit(NAMES[code][0], code))}`);
  }
}
out(`INFO country-level guard edge inputs: ${countryLevelInfo.join(" | ")}`);
await check("network: fetch calls = 0", () => assert.equal(fetchCalls, 0));

let HEAD = null;
if (headDirArg) {
  await check("HEAD snapshot child ran", () => {
    const dir = headDirArg;
    assert.ok(existsSync(join(dir, "src")), `bad --head-dir ${dir}`);
    const self = "scripts/verify-kij2-k-destination-turns.mjs";
    if (!existsSync(join(dir, self)) || readFileSync(join(dir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(dir, self));
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: dir, encoding: "utf8", timeout: 270_000, maxBuffer: 64 << 20 });
    const m = (r.stdout ?? "").match(/@@KIJ2K_JSON@@([\s\S]*?)@@END@@/);
    assert.ok(m, `HEAD child produced no JSON (status ${r.status}): ${(r.stdout ?? "").slice(-800)} ${(r.stderr ?? "").slice(-1500)}`);
    HEAD = JSON.parse(m[1]);
    assert.equal(HEAD.fetchCalls, 0, "HEAD fetch calls");
  });
}

const short = (c) => c ? `switch=${c.switchState}${c.switchTarget ? `(${c.switchTarget})` : ""} gate=${c.gate} dest=${c.destination}(${c.destinationType}) ${c.startDate ?? "-"}..${c.endDate ?? "-"} days=${c.days} pending=${c.pending} offered=${c.offered} cand=${JSON.stringify(c.candidateRaw)} geo=${JSON.stringify(c.geocodeQueries)} clar=${c.clarification} ready=${c.readyOk}${c.readyFailure ? `:${c.readyFailure}` : ""}\n        reply=${JSON.stringify((c.reply ?? "").replace(/\n+/g, " / ").slice(0, 260))}` : "n/a";
out("\n---- first turn (WORK / HEAD)");
for (const id of Object.keys(WORK.first)) { out(`[${id}]\n    WORK ${short(WORK.first[id])}`); if (HEAD) out(`    HEAD ${short(HEAD.res.first[id])}`); }
out("\n---- city-states (WORK / HEAD)");
for (const [id, v] of Object.entries(WORK.cityStates)) {
  out(`[${id}] step1\n    WORK ${short(v.step1)}`); if (HEAD) out(`    HEAD ${short(HEAD.res.cityStates[id]?.step1)}`);
  out(`  「${v.correctionText}」\n    WORK ${short(v.correction)}`); if (HEAD) out(`    HEAD ${short(HEAD.res.cityStates[id]?.correction)}`);
}
out("\n---- destination switch while choosing Sydney combinations (WORK / HEAD)");
for (const [locale, v] of Object.entries(WORK.switch)) {
  out(`[${locale}] step1\n    WORK ${short(v.step1)}`); if (HEAD) out(`    HEAD ${short(HEAD.res.switch[locale]?.step1)}`);
  for (const t of Object.keys(v.cases)) {
    out(`  「${t}」\n    WORK ${short(v.cases[t])}`);
    if (HEAD) {
      const h = HEAD.res.switch[locale]?.cases?.[t];
      out(`    HEAD ${short(h)}`);
      const sw = (c) => c && /kyoto|京都/i.test(`${c.destination}`);
      out(`    switched WORK=${sw(v.cases[t])} HEAD=${sw(h)}${sw(h) && !sw(v.cases[t]) ? "  <-- REGRESSION" : ""}`);
    }
  }
}
if (HEAD) {
  await check("no regression: every sentence that switches to Kyoto on HEAD also switches on WORK", () => {
    const bad = [];
    for (const [locale, v] of Object.entries(WORK.switch)) for (const t of Object.keys(v.cases)) {
      const h = HEAD.res.switch[locale]?.cases?.[t];
      if (h && /kyoto|京都/i.test(`${h.destination}`) && !/kyoto|京都/i.test(`${v.cases[t].destination}`)) bad.push(`[${locale}] ${t}`);
    }
    assert.deepEqual(bad, []);
  });
  await check("first turn identical destination/dates to HEAD", () => {
    const bad = [];
    for (const id of Object.keys(WORK.first)) {
      const w = WORK.first[id]; const h = HEAD.res.first[id];
      if (!h || canon(w.destination) !== canon(h.destination) || w.startDate !== h.startDate || w.endDate !== h.endDate || w.pending !== h.pending) bad.push(`${id}: WORK ${w.destination} ${w.startDate}..${w.endDate} ${w.pending} / HEAD ${h?.destination} ${h?.startDate}..${h?.endDate} ${h?.pending}`);
    }
    assert.deepEqual(bad, []);
  });
}
out(`\n${failures.length ? "FAIL" : "PASS"} verify-kij2-k-destination-turns — ${failures.length} failing check(s); fetch=${fetchCalls}`);
process.exit(failures.length ? 1 : 0);
