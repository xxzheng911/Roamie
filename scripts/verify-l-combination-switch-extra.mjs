/**
 * L4 (tester, independent) — extra spec A cases for the combination-choice destination switch,
 * on the same send-flow chain as verify-l-combination-destination-switch (tripIntent → prepare →
 * mergeTravelContext → [global resolve] → combinations ready → processAdviceTurn → applyAdviceResultToSession)
 * plus the route CONFIRMED_SWITCH branch (applyConfirmedDestinationSwitch → wouldMerge… → merge).
 *
 *  1. negated switch, four locales, with / without dates (dates carried or replaced);
 *  2. month-only switch across the year boundary (travelYear), and same-month (dates kept);
 *  3. mood / vibe / budget / pace of the old trip do not survive the switch (global + route path);
 *  4. after a switch, picking combination 1 generates the NEW destination's itinerary;
 *  5. two switches in a row (雪梨 → 京都 → 大阪), each a single new planning session;
 *  6. date provenance: the switch must not turn unconfirmed dates into confirmed ones;
 *  7. wouldMergeTravelContextResetTrip prediction == merge's actual reset, every case;
 *  8. 「改成去首爾吧」with a Seoul pool lists Seoul combinations (vs. partial-modify fixture);
 *  9. spec A phrasing variants (「可以但改去大阪」"fine but change it to Osaka" 「いいけど大阪に変えて」…).
 *
 * fetch is stubbed (must stay 0); geocode / Places are fixtures and counted.
 * Run: npx vite-node scripts/verify-l-combination-switch-extra.mjs --config scripts/vite.verify.config.mjs
 */
import assert from "node:assert/strict";

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog: run exceeded time limit"); process.exit(3); }, 280_000).unref();

let fetchCalls = 0;
globalThis.fetch = async (...a) => { fetchCalls++; throw new Error("NO_NETWORK " + String(a[0])); };
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
const tpc = await load("src/lib/ai/trip-planning-context.ts");
const reset = await load("src/lib/ai/trip-planning-session-reset.ts");
const partialApi = await load("src/lib/ai/combination-partial-modify-reply.ts");
const createDates = await load("src/lib/ai/resolve-trip-create-dates.ts");

// ------------------------------------------------------------------ fixtures (same shape as L2)
const DESTS = {
  sydney: { match: /sydney|雪梨|シドニー|시드니/i, city: "Sydney", region: "New South Wales", countryRaw: "Australia", code: "AU", lat: -33.8688, lng: 151.2093,
    places: ["Sydney Opera House", "Sydney Harbour Bridge", "The Rocks", "Darling Harbour", "Circular Quay", "Bondi Beach",
      "Australian Museum", "Art Gallery of New South Wales", "Museum of Contemporary Art", "Powerhouse Museum", "Australian National Maritime Museum", "Museum of Sydney",
      "Royal Botanic Garden Sydney", "Hyde Park", "Centennial Park", "Barangaroo Reserve", "Chinese Garden of Friendship", "Observatory Hill"], address: "Sydney NSW, Australia", lang: "en" },
  kyoto: { match: /kyoto|京都|교토/i, city: "京都市", region: "京都府", countryRaw: "Japan", code: "JP", lat: 35.0116, lng: 135.7681,
    places: ["清水寺", "金閣寺", "銀閣寺", "元離宮二条城", "産寧坂", "二寧坂", "京都国立博物館", "京都市京セラ美術館", "京都鉄道博物館", "京都文化博物館", "京都国際マンガミュージアム", "細見美術館",
      "京都御苑", "円山公園", "京都府立植物園", "嵐山公園", "梅小路公園", "鴨川公園"], address: "Kyoto Japan", lang: "ja" },
  // Same fixtures as L2 (combinations build from them). Osaka / Seoul pools of this shape do NOT build
  // combinations even without any switch (verify-l-seoul-pool-probe), so they are not used for listings.
  kamakura: { match: /kamakura|鎌倉|가마쿠라/i, city: "鎌倉市", region: "神奈川県", countryRaw: "Japan", code: "JP", lat: 35.3192, lng: 139.5467, places: ["鶴岡八幡宮", "高徳院", "長谷寺", "報国寺", "明月院", "建長寺", "鎌倉文学館", "鎌倉国宝館", "鎌倉歴史文化交流館", "川喜多映画記念館", "鏑木清方記念美術館", "吉屋信子記念館",
    "源氏山公園", "鎌倉中央公園", "由比ヶ浜海水浴場", "鎌倉海浜公園", "葛原岡神社", "稲村ヶ崎公園"], address: "Kamakura Japan", lang: "ja" },
  taitung: { match: /taitung|台東|臺東/i, city: "台東縣", region: "台東縣", countryRaw: "Taiwan", code: "TW", lat: 22.758, lng: 121.1444,
    places: ["三仙台", "伯朗大道", "鹿野高台", "小野柳", "多良車站", "加路蘭", "國立臺灣史前文化博物館", "鐵花村", "臺東美術館", "池上穀倉藝術館", "臺東故事館", "卑南遺址公園",
      "臺東森林公園", "琵琶湖", "大坡池", "海濱公園", "知本國家森林遊樂區", "關山親水公園"], address: "Taitung Taiwan", lang: "zh-TW" },
};
const countryOf = (d) => countryNorm.normalizeCountryReference(d.countryRaw, d.code).country || d.countryRaw;
const geocodeLog = [];
const placesLog = [];
const geocode = async (q) => {
  geocodeLog.push(q);
  const d = Object.values(DESTS).find((x) => x.match.test(q));
  if (!d) return { rawResultCount: 0, location: null };
  return { rawResultCount: 1, location: { placeId: `ChIJ_${d.code}_${d.city}`, country: countryOf(d), city: d.city, region: d.region, lat: d.lat, lng: d.lng, formattedName: d.city, displayLabel: d.city } };
};
const destKey = (dest) => Object.keys(DESTS).find((k) => DESTS[k].match.test(dest ?? ""));
const poolFor = (dest) => {
  const key = destKey(dest);
  if (!key) return [];
  const d = DESTS[key];
  return d.places.map((name, i) => ({ id: `ChIJ${d.code}${key}P${i}`, name, sourceLocale: d.lang,
    lat: d.lat + i * 0.0003, lng: d.lng, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park",
    rating: 4.6, userRatingCount: 10000, address: d.address, businessStatus: "OPERATIONAL" }));
};
const clone = (v) => JSON.parse(JSON.stringify(v));

function snapOf(next, r) {
  const tc = next.travelContext ?? {};
  return { dest: tc.destination ?? null, days: tc.days ?? null, start: tc.startDate ?? null, end: tc.endDate ?? null,
    month: tc.travelMonth ?? null, year: tc.travelYear ?? null, prov: tc.dateProvenance ?? null,
    pending: next.pendingQuestion?.type ?? null, base: next.pendingQuestion?.baseDestination ?? null, offered: tc.offeredCombinations ?? [],
    selected: tc.selectedCombinationIds ?? null, selectedNames: tc.selectedCombinationPlaceNames ?? null, sid: next.planningSessionId ?? null,
    trigger: Boolean(r?.advice?.triggerItineraryGeneration), discovery: r?.discovery ?? null, mood: tc.mood ?? null, vibe: tc.vibe ?? null, budget: tc.budget ?? null, pace: tc.pace ?? null,
    reply: (r?.advice?.reply ?? "").replace(/\n/g, " / ") };
}

async function readyAndAdvise(t, session, ctx, locale, lastReply) {
  const unresolved = Boolean(ctx.destinationClarification || (ctx.destinationCandidate && ctx.destinationCandidate.status !== "resolved"));
  const days = ctx.days ?? session.tripDays;
  let ready = null;
  if (!unresolved && ctx.destination && days) {
    ready = await discovery.ensureDestinationCombinationsReady({
      destination: ctx.destination, destinationCountry: ctx.destinationCountryCode ?? ctx.destinationCountry, locale, days,
      resolvedDestination: ctx.destinationCoordinates ? { label: ctx.destination, city: ctx.destinationCity ?? ctx.destination, country: ctx.destinationCountryCode ?? ctx.destinationCountry,
        countryCode: ctx.destinationCountryCode, type: ctx.destinationType ?? "city", latitude: ctx.destinationCoordinates.lat, longitude: ctx.destinationCoordinates.lng,
        placeId: session.tripDestination?.placeId, source: "trip_destination", scopeLocked: false } : undefined,
      searchPlaces: async (q) => { placesLog.push(JSON.stringify(q?.query ?? q?.textQuery ?? ctx.destination)); return { places: poolFor(ctx.destination), error: null }; },
    }).catch((e) => ({ ok: false, failureReason: String(e) }));
  }
  const r = stateMachine.processAdviceTurn(t, session, ctx, undefined, locale);
  const next = advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply ?? lastReply }, r.advice);
  r.discovery = ready ? { ok: ready.ok, reason: ready.failureReason ?? null, detail: ready.failureDetail ?? null, coords: ctx.destinationCoordinates ?? null, cc: ctx.destinationCountryCode ?? ctx.destinationCountry ?? null, type: ctx.destinationType ?? null, city: ctx.destinationCity ?? null } : null;
  return { r, next };
}

/** Send flow, NO_SWITCH branch (route gate passed). Also records the reset prediction. */
async function sendTurn(s0, t, locale) {
  const s = clone(s0);
  const lastReply = s.lastAssistantReply;
  const flag = partialApi.isCombinationChoiceTurn(s) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply(t));
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, lastReply);
  if (planningState.isReplanIntent(t) && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const predicted = travelContext.wouldMergeTravelContextResetTrip(clone(n), t);
  const g0 = geocodeLog.length;
  const m = travelContext.mergeTravelContext(n, t, lastReply);
  const mergeReset = m.session.planningSessionId !== n.planningSessionId;
  let session = m.session; let ctx = m.context;
  if (ctx.destinationCandidate?.status === "pending") {
    session = await globalPlanning.resolveGlobalPlanningCandidate(session, locale, geocode);
    ctx = session.travelContext ?? ctx;
  }
  const { r, next } = await readyAndAdvise(t, session, ctx, locale, lastReply);
  return { s: next, snap: { ...snapOf(next, r), predicted, mergeReset, geo: geocodeLog.slice(g0) } };
}

/** Route CONFIRMED_SWITCH branch → merge → combinations → advice. */
async function routeTurn(s0, t, label, locale) {
  const s = clone(s0);
  const res = travelContext.applyConfirmedDestinationSwitch(s, { label, requestText: t, resetAlreadyThisTurn: false });
  if (!("applied" in res) || !res.applied) return { stop: res.stop ?? "not_applied" };
  const wouldReset = travelContext.wouldMergeTravelContextResetTrip(clone(res.session), t);
  const sidAfterWrapper = res.session.planningSessionId;
  const m = travelContext.mergeTravelContext(res.session, t, s.lastAssistantReply);
  // The route resolves the target through the Destination Authority (existing HEAD lookup) before
  // this point; simulate its trusted result (placeId) so discovery reads a resolved destination.
  const d = DESTS[destKey(label)];
  const routed = d && m.context.destinationCoordinates && !m.session.tripDestination?.placeId
    ? { ...m.session, tripDestination: { ...(m.session.tripDestination ?? {}), placeId: `ChIJ_${d.code}_${d.city}`, city: d.city, country: countryOf(d), lat: d.lat, lng: d.lng } }
    : m.session;
  const { r, next } = await readyAndAdvise(t, routed, m.context, locale, s.lastAssistantReply);
  return { s: next, snap: { ...snapOf(next, r), wouldReset, mergeReset: m.session.planningSessionId !== sidAfterWrapper, wrapperReset: sidAfterWrapper !== s.planningSessionId } };
}

/** Real send path: route gate first (CONFIRMED_SWITCH → wrapper), else the plain send flow. */
async function realTurn(s0, t, locale, trustedLabel) {
  const cls = tpc.classifyDestinationSwitchTurn(t);
  if (cls.state === "CONFIRMED_SWITCH") {
    const r = await routeTurn(s0, t, trustedLabel, locale);
    return { ...r, route: cls.state };
  }
  if (cls.state !== "NO_SWITCH") return { route: cls.state, snap: null };
  return { ...(await sendTurn(s0, t, locale)), route: cls.state };
}

const failures = [];
async function check(name, fn) {
  try { await fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 8).join("\n  ")}`); }
}
const fresh = () => { discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache(); };
const STEP1 = { en: "12/10-12/14 I'm going to sydney", "zh-TW": "12/10-12/14 我要去雪梨", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행" };
const sydneyTrip = {};
for (const locale of Object.keys(STEP1)) {
  fresh();
  sydneyTrip[locale] = (await sendTurn(sessionMod.createEmptySession(), STEP1[locale], locale)).s;
}
const show = (x) => JSON.stringify({ ...x, offered: x?.offered?.length, reply: x?.reply?.slice(0, 140) });
const kyotoPlaces = new Set(DESTS.kyoto.places);

function assertSwitched(w, base, exp, extra = "") {
  const info = `${extra}\n  ${show(w)}`;
  assert.equal(w.dest, exp.dest, `dest${info}`);
  assert.equal(w.start, exp.start, `start${info}`);
  assert.equal(w.end, exp.end, `end${info}`);
  assert.equal(w.days, exp.days, `days${info}`);
  if (exp.month !== undefined) assert.equal(w.month, exp.month, `month${info}`);
  if (exp.year !== undefined) assert.equal(w.year, exp.year, `year${info}`);
  assert.notEqual(w.sid, base.planningSessionId, `planningSessionId unchanged${info}`);
  assert.equal(w.pending, "combination_choice", `pending${info}`);
  assert.equal(w.base, exp.dest, `pending base${info}`);
  assert.ok(w.offered.length > 0, `offered${info}`);
  assert.equal(w.trigger, false, `generation triggered${info}`);
}

// ------------------------------------------------------------------ 1. negated switch, four locales
const NEG = {
  "zh-TW": [["不去雪梨了，改去京都", false], ["不去雪梨了，改去京都 12/20-12/23", true], ["雪梨不去了，我要去京都", false]],
  en: [["Not Sydney anymore, switch to Kyoto", false], ["Not Sydney anymore, switch to Kyoto 12/20-12/23", true], ["Forget Sydney, I'm going to Kyoto", false]],
  ja: [["シドニーはやめて、京都に変更", false], ["シドニーはやめて、12/20-12/23 京都に変更", true], ["シドニーじゃなくて京都に行きます", false]],
  ko: [["시드니 말고 교토로 바꿔", false], ["시드니 말고 12/20-12/23 교토로 바꿔", true], ["시드니는 안 가고 교토로 갈게요", false]],
};
for (const [locale, rows] of Object.entries(NEG)) for (const [t, dated] of rows) {
  await check(`[${locale}] negated 「${t}」 → 京都, ${dated ? "new dates 12/20-12/23" : "dates 12/10-12/14 carried"}`, async () => {
    fresh();
    const base = sydneyTrip[locale];
    const r = await realTurn(base, t, locale, "京都");
    assert.ok(r.snap, `route ${r.route}: asks a confirm question / stops instead of switching (spec A: negated form switches in every locale)`);
    assertSwitched(r.snap, base, dated ? { dest: "京都", start: "2026-12-20", end: "2026-12-23", days: 4 } : { dest: "京都", start: "2026-12-10", end: "2026-12-14", days: 5 }, `route=${r.route}`);
    if (r.route === "CONFIRMED_SWITCH") {
      assert.equal(r.snap.wouldReset, false, "second-reset guard would stop the turn");
      assert.equal(r.snap.mergeReset, false, "merge reset a second time");
    } else {
      assert.equal(r.snap.geo.length, 0, `geocode ${JSON.stringify(r.snap.geo)}`);
    }
  });
}

// ------------------------------------------------------------------ 2. month-only, year boundary
// Today (fixture run) is Nov 2026; the Sydney trip is 2026-12-10..14.
const MONTH = {
  "zh-TW": [["我1月要去京都", { start: null, end: null, days: 5, month: "1月", year: 2027 }], ["我12月要去京都", { start: "2026-12-10", end: "2026-12-14", days: 5 }], ["明年1月改去京都", { start: null, end: null, days: 5, month: "1月", year: 2027 }]],
  en: [["I'm going to Kyoto in January", { start: null, end: null, days: 5, month: "1月", year: 2027 }]],
  ja: [["1月に京都に行きます", { start: null, end: null, days: 5, month: "1月", year: 2027 }]],
  ko: [["1월에 교토로 갈게요", { start: null, end: null, days: 5, month: "1月", year: 2027 }]],
};
for (const [locale, rows] of Object.entries(MONTH)) for (const [t, exp] of rows) {
  await check(`[${locale}] month 「${t}」 → ${exp.start ? "dates kept" : `${exp.month} ${exp.year}, dates cleared, days kept`}`, async () => {
    fresh();
    const base = sydneyTrip[locale];
    const r = await realTurn(base, t, locale, "京都");
    assert.ok(r.snap, `route ${r.route}`);
    assertSwitched(r.snap, base, { dest: "京都", ...exp }, `route=${r.route}`);
    if (!exp.start) {
      // Month-only: dates are a month default, never confirmed calendar dates.
      assert.ok(!r.snap.prov?.confirmed, `provenance confirmed after month-only switch: ${JSON.stringify(r.snap.prov)}`);
    }
  });
}
// Month-only trip (no dates) across the year: 1月 trip → 「我12月要去京都」 → 12月 2026.
await check("[zh-TW] month-only trip (1月 2027, no dates) → 「我12月要去京都」 → 12月, year 2026, days 5", async () => {
  fresh();
  // Built from the dated trip: dates removed, month 1月 2027 (a 「1月去雪梨5天」 first turn asks a preference first).
  const base = clone(sydneyTrip["zh-TW"]);
  base.travelContext = { ...base.travelContext, startDate: undefined, endDate: undefined, dateProvenance: undefined, travelMonth: "1月", travelYear: 2027 };
  base.tripStartDate = undefined; base.tripEndDate = undefined; base.travelDate = undefined;
  const r = await realTurn(base, "我12月要去京都", "zh-TW", "京都");
  assertSwitched(r.snap, base, { dest: "京都", start: null, end: null, days: 5, month: "12月", year: 2026 });
  const same = await realTurn(base, "我1月要去京都", "zh-TW", "京都");
  assertSwitched(same.snap, base, { dest: "京都", start: null, end: null, days: 5, month: "1月" }, "same month");
});

// ------------------------------------------------------------------ 3. mood / vibe residue
const RESIDUE = { mood: "放鬆", vibe: "海邊", budget: "低", pace: "slow" };
const SW = { "zh-TW": ["改去京都", "不去雪梨了，改去京都", "我1月要去京都"], en: ["switch to Kyoto"], ja: ["京都に変更"], ko: ["교토로 바꿔"] };
for (const [locale, rows] of Object.entries(SW)) for (const t of rows) {
  await check(`[${locale}] 「${t}」 drops the old trip's mood / vibe / budget / pace (as the legacy reset)`, async () => {
    fresh();
    const base = clone(sydneyTrip[locale]);
    base.travelContext = { ...base.travelContext, ...RESIDUE };
    const legacy = reset.resetForDestinationChange(clone(base), { reason: "destination_changed", incomingDestination: "京都" });
    const r = await realTurn(base, t, locale, "京都");
    assert.ok(r.snap, `route ${r.route}`);
    assert.equal(r.snap.dest, "京都");
    for (const k of Object.keys(RESIDUE)) {
      assert.equal(r.snap[k], legacy.travelContext?.[k] ?? null, `${k}=${JSON.stringify(r.snap[k])} (legacy reset ${JSON.stringify(legacy.travelContext?.[k])}) route=${r.route}`);
    }
  });
}

// ------------------------------------------------------------------ 4. switch then pick 1 → new destination itinerary
for (const [locale, t] of [["zh-TW", "改去京都"], ["en", "switch to Kyoto"], ["ja", "京都に変更"], ["ko", "교토로 바꿔"], ["zh-TW", "不去雪梨了，改去京都"]]) {
  await check(`[${locale}] 「${t}」 then 「1」 → 京都 itinerary from 京都 places only`, async () => {
    fresh();
    const base = sydneyTrip[locale];
    const sw = await realTurn(base, t, locale, "京都");
    assert.ok(sw.snap, `route ${sw.route}`);
    assert.equal(sw.snap.pending, "combination_choice", show(sw.snap));
    const pick = await sendTurn(sw.s, "1", locale);
    const w = pick.snap;
    assert.equal(w.dest, "京都", show(w));
    assert.deepEqual(w.selected, [1], show(w));
    assert.equal(w.trigger, true, `「1」 did not start generation\n  ${show(w)}`);
    assert.equal(w.days, 5, show(w));
    assert.equal(w.start, "2026-12-10"); assert.equal(w.end, "2026-12-14");
    assert.equal(w.sid, sw.snap.sid, "picking a combination must not open another planning session");
    const chosen = sw.snap.offered.find((c) => c.id === 1);
    const names = (chosen?.places ?? []).map((p) => p.originalName ?? p.name);
    assert.ok(names.length > 0, `combination 1 has no places ${JSON.stringify(chosen).slice(0, 200)}`);
    assert.deepEqual(names.filter((n) => !kyotoPlaces.has(n)), [], `combination 1 has non-京都 places`);
    if (w.selectedNames?.length) assert.deepEqual(w.selectedNames.filter((n) => !kyotoPlaces.has(n) && !names.includes(n)), [], `selected names ${JSON.stringify(w.selectedNames)}`);
    const foreign = JSON.stringify(sw.snap.offered).match(/Sydney|Opera House|Bondi|Darling Harbour/g);
    assert.equal(foreign, null, `Sydney places in 京都 combinations: ${foreign}`);
  });
}

// ------------------------------------------------------------------ 5. two switches in a row
// 雪梨 → 京都 → 鎌倉 (explicit wording: 鎌倉 is a nearby extension of 京都? no — of 東京) and 雪梨 → 京都 → 台東.
for (const [locale, t1, t2, d2] of [["zh-TW", "改去京都", "改去台東", "台東"], ["zh-TW", "我要去京都", "我要去台東", "台東"], ["zh-TW", "改去京都", "改去鎌倉", "鎌倉"],
  ["en", "switch to Kyoto", "switch to Kamakura", "鎌倉"], ["ja", "京都に変更", "鎌倉に変更", "鎌倉"], ["ko", "교토로 바꿔", "가마쿠라로 바꿔", "鎌倉"]]) {
  await check(`[${locale}] 雪梨 → 「${t1}」 → 「${t2}」: ${d2}, dates carried, three distinct planning sessions`, async () => {
    fresh();
    const base = sydneyTrip[locale];
    const a = await realTurn(base, t1, locale, "京都");
    assert.ok(a.snap, `route ${a.route}`);
    assertSwitched(a.snap, base, { dest: "京都", start: "2026-12-10", end: "2026-12-14", days: 5 });
    const b = await realTurn(a.s, t2, locale, d2);
    assert.ok(b.snap, `route ${b.route}`);
    assertSwitched(b.snap, a.s, { dest: d2, start: "2026-12-10", end: "2026-12-14", days: 5 }, `second switch route=${b.route}`);
    assert.equal(new Set([base.planningSessionId, a.snap.sid, b.snap.sid]).size, 3);
    assert.doesNotMatch(JSON.stringify(b.snap.offered), /清水寺|金閣寺|Sydney/, `old destination places in ${d2} combinations`);
    assert.doesNotMatch(b.snap.reply, /京都|雪梨|Sydney|シドニー|시드니|교토|Kyoto/, `reply names an old destination: ${b.snap.reply.slice(0, 160)}`);
  });
}
// 京都 → 大阪 is a Region Adjacency neighbour: recorded (spec keeps the nearby-extension behavior).
for (const [locale, t] of [["zh-TW", "我要去大阪"], ["zh-TW", "改去大阪"], ["en", "Osaka"], ["en", "switch to Osaka"]]) {
  await check(`[${locale}] 京都 trip 「${t}」 (大阪 neighbour of 京都) — recorded`, async () => {
    fresh();
    const a = await realTurn(sydneyTrip[locale], locale === "en" ? "switch to Kyoto" : "改去京都", locale, "京都");
    const b = await realTurn(a.s, t, locale, "大阪");
    out(`INFO 京都→「${t}」 route=${b.route} dest=${b.snap?.dest} pending=${b.snap?.pending} sidChanged=${b.snap ? b.snap.sid !== a.snap.sid : null} days=${b.snap?.days} start=${b.snap?.start}`);
    if (/改去|switch/.test(t)) {
      assert.equal(b.snap?.dest, "大阪", "explicit switch wording must switch");
      assert.equal(b.snap?.days, 5, `days not carried: ${show(b.snap)}`);
      assert.equal(b.snap?.start, "2026-12-10", `start not carried: ${show(b.snap)}`);
    }
  });
}

// ------------------------------------------------------------------ 6. date provenance
await check("provenance: STEP1 dates (typed by the user) — record provenance and confirmation before / after the switch", async () => {
  fresh();
  const base = sydneyTrip["zh-TW"];
  const before = createDates.resolveTripCreateDates({ context: base.travelContext, session: base, days: 5 });
  const r = await realTurn(base, "改去京都", "zh-TW", "京都");
  const after = createDates.resolveTripCreateDates({ context: r.s.travelContext, session: r.s, days: 5 });
  out(`INFO STEP1 provenance=${JSON.stringify(base.travelContext?.dateProvenance ?? null)} confirmed(before)=${before.datesConfirmed}/${before.source} after=${after.datesConfirmed}/${after.source} prov(after)=${JSON.stringify(r.snap.prov)}`);
  assert.equal(after.startDate, "2026-12-10");
});
for (const [label, prov] of [
  ["no provenance", undefined],
  ["stale ai_suggested provenance for other dates", { source: "ai_suggested", confirmed: false, startDate: "2026-12-15", endDate: "2026-12-19" }],
  ["month_default provenance for other dates", { source: "month_default", confirmed: false, startDate: "2026-12-15", endDate: "2026-12-19" }],
  ["matching ai_suggested (unconfirmed)", { source: "ai_suggested", confirmed: false, startDate: "2026-12-10", endDate: "2026-12-14" }],
]) {
  await check(`provenance: ${label} — the switch keeps the dates' confirmation state (no upgrade to user_date / confirmed)`, async () => {
    fresh();
    const base = clone(sydneyTrip["zh-TW"]);
    base.travelContext = { ...base.travelContext, startDate: "2026-12-10", endDate: "2026-12-14", dateProvenance: prov };
    if (!prov) delete base.travelContext.dateProvenance;
    const before = createDates.resolveTripCreateDates({ context: base.travelContext, session: base, days: 5 });
    for (const t of ["改去京都", "不去雪梨了，改去京都"]) {
      const r = await realTurn(base, t, "zh-TW", "京都");
      assert.ok(r.snap, `route ${r.route}`);
      const after = createDates.resolveTripCreateDates({ context: r.s.travelContext, session: r.s, days: 5 });
      assert.equal(after.datesConfirmed, before.datesConfirmed,
        `「${t}」 confirmation changed by the switch: before=${before.datesConfirmed}/${before.source} after=${after.datesConfirmed}/${after.source} prov=${JSON.stringify(r.snap.prov)}`);
    }
  });
}

// ------------------------------------------------------------------ 8. 首爾 (no working Seoul pool, see probe)
// 「改成去首爾吧」 switches like 「改去台東」; the listing then depends only on Places data for 首爾.
await check("[zh-TW] 雪梨 trip 「改成去首爾吧」 vs 「改成去台東吧」: same switch; only the Places listing differs", async () => {
  fresh();
  const base = sydneyTrip["zh-TW"];
  const seoul = await realTurn(base, "改成去首爾吧", "zh-TW", "首爾");
  fresh();
  const taitung = await realTurn(base, "改成去台東吧", "zh-TW", "台東");
  out(`INFO 首爾: ${show(seoul.snap)}\nINFO 台東: ${show(taitung.snap)}`);
  assertSwitched(taitung.snap, base, { dest: "台東", start: "2026-12-10", end: "2026-12-14", days: 5 }, "台東");
  for (const k of ["days", "start", "end", "trigger"]) assert.equal(seoul.snap[k], taitung.snap[k], k);
  assert.equal(seoul.snap.dest, "首爾");
  assert.notEqual(seoul.snap.sid, base.planningSessionId);
  assert.equal(seoul.snap.discovery?.ok, false, "首爾 discovery");
  assert.equal(taitung.snap.discovery?.ok, true, "台東 discovery");
});

// ------------------------------------------------------------------ 9. spec A phrasing variants (known destinations)
const VARIANTS = {
  "zh-TW": [["可以但改去台東", "台東"], ["可以但換成台東", "台東"], ["那改成台東好了", "台東"]],
  en: [["fine but change it to Kamakura", "鎌倉"], ["let's do Kamakura instead", "鎌倉"], ["Kamakura please", "鎌倉"]],
  ja: [["いいけど鎌倉に変えて", "鎌倉"], ["やっぱり鎌倉にして", "鎌倉"], ["鎌倉でお願いします", "鎌倉"]],
  ko: [["좋은데 가마쿠라로 바꿔", "鎌倉"], ["가마쿠라로 하자", "鎌倉"], ["가마쿠라로 해 주세요", "鎌倉"]],
};
for (const [locale, rows] of Object.entries(VARIANTS)) for (const [t, dest] of rows) {
  await check(`[${locale}] spec A variant 「${t}」 → ${dest}, dates 12/10-12/14 / 5 days carried`, async () => {
    fresh();
    const base = sydneyTrip[locale];
    const r = await realTurn(base, t, locale, dest);
    assert.ok(r.snap, `route ${r.route}`);
    assertSwitched(r.snap, base, { dest, start: "2026-12-10", end: "2026-12-14", days: 5 }, `route=${r.route}`);
  });
}

// ------------------------------------------------------------------ 7. reset prediction == actual (all NO_SWITCH turns above + non-switch turns)
const PRED = {
  "zh-TW": ["改去京都", "我要去京都", "京都 12/10-12/13", "我1月要去京都", "1", "全部", "全部都不要", "混搭", "第一天保留", "不用改", "日本", "12月", "十分", "抱歉是12/10-12/13", "可以但改去大阪"],
  en: ["switch to Kyoto", "Kyoto 12/10-12/13", "none of them", "mix and match", "keep day 1", "1 and 3", "Japan"],
  ja: ["京都に変更", "12月に京都に行きます", "どれもいらない", "ミックスしてください", "1と3"],
  ko: ["교토로 바꿔", "다음 달에 교토로 갈게요", "다 싫어요", "섞어서 해줘", "1, 3"],
};
for (const [locale, rows] of Object.entries(PRED)) {
  await check(`[${locale}] wouldMergeTravelContextResetTrip prediction equals the merge's actual reset`, async () => {
    const bad = [];
    for (const t of rows) {
      if (tpc.classifyDestinationSwitchTurn(t).state !== "NO_SWITCH") continue;
      fresh();
      const r = await sendTurn(sydneyTrip[locale], t, locale);
      if (r.snap.predicted !== r.snap.mergeReset) bad.push(`「${t}」 predicted=${r.snap.predicted} actual=${r.snap.mergeReset}`);
    }
    assert.deepEqual(bad, []);
  });
}

await check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.exit(failures.length ? 1 : 0);
