/**
 * L6 (tester, independent) — combination-choice destination switch: misfires, date provenance and
 * date labels, NOW vs HEAD (`-- --head-dir=<snapshot>`, the script re-runs itself there with --child).
 *
 *  A. misfire sentences while choosing combinations (negated attractions, 「可以但第二天輕鬆一點」,
 *     「いいけど高い」「좋은데 비싸요」, "let's do 1 and 3"「1번으로 하자」「1にして」…): the route switch
 *     classifier and the observable session change must equal HEAD (no new switch);
 *  B. date provenance / labels per locale: STEP1 listing, the switch listing, and the generation
 *     date gate (prepareTripDateConfirmation, as completeAdviceTurn → pauseForTripDates) — recorded;
 *     zh/en/ja/ko must agree with each other (asserted);
 *  C. 「雪梨不去了，我要去京都」and neighbours outside combination choice (classifier + destination
 *     parsers, NOW vs HEAD) — recorded, plus the non-destination wish forms must not switch;
 *  D. unprovenanced dates (route _app.chat.tsx:14064 write / month default) through a re-listing:
 *     never confirmed, never silently used as the user's dates.
 *
 * fetch is stubbed (must stay 0); geocode / Places are fixtures.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=280 scripts/verify-l-combination-switch-misfires.mjs -- --head-dir=<snapshot>
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDirArg = argv.find((a) => a.startsWith("--head-dir="))?.slice("--head-dir=".length);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog: run exceeded time limit"); process.exit(3); }, CHILD ? 270_000 : 560_000).unref();

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
const resetMod = await load("src/lib/ai/trip-planning-session-reset.ts");
const dateConfirm = await load("src/lib/ai/trip-date-confirmation.ts");
const createDates = await load("src/lib/ai/resolve-trip-create-dates.ts");
const aliases = await load("src/lib/ai/destination-locale-aliases.ts");
const sameDest = (d) => (d ? tpc.normalizeDestinationLabel(aliases.canonicalFromDisplayName(d) ?? aliases.applyCityLocaleAlias(d) ?? d) : d);
const partialApi = existsSync("src/lib/ai/combination-partial-modify-reply.ts") ? await load("src/lib/ai/combination-partial-modify-reply.ts") : null;

// ------------------------------------------------------------------ fixtures (same shape as L2 / L4)
const DESTS = {
  sydney: { match: /sydney|雪梨|シドニー|시드니/i, city: "Sydney", region: "New South Wales", countryRaw: "Australia", code: "AU", lat: -33.8688, lng: 151.2093,
    places: ["Sydney Opera House", "Sydney Harbour Bridge", "The Rocks", "Darling Harbour", "Circular Quay", "Bondi Beach",
      "Australian Museum", "Art Gallery of New South Wales", "Museum of Contemporary Art", "Powerhouse Museum", "Australian National Maritime Museum", "Museum of Sydney",
      "Royal Botanic Garden Sydney", "Hyde Park", "Centennial Park", "Barangaroo Reserve", "Chinese Garden of Friendship", "Observatory Hill"], address: "Sydney NSW, Australia", lang: "en" },
  kyoto: { match: /kyoto|京都|교토/i, city: "京都市", region: "京都府", countryRaw: "Japan", code: "JP", lat: 35.0116, lng: 135.7681,
    places: ["清水寺", "金閣寺", "銀閣寺", "元離宮二条城", "産寧坂", "二寧坂", "京都国立博物館", "京都市京セラ美術館", "京都鉄道博物館", "京都文化博物館", "京都国際マンガミュージアム", "細見美術館",
      "京都御苑", "円山公園", "京都府立植物園", "嵐山公園", "梅小路公園", "鴨川公園"], address: "Kyoto Japan", lang: "ja" },
};
const countryOf = (d) => countryNorm.normalizeCountryReference(d.countryRaw, d.code).country || d.countryRaw;
const geocodeLog = [];
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
const fresh = () => { discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache(); };

function snapOf(prev, next, r) {
  const tc = next.travelContext ?? {};
  return { dest: tc.destination ?? null, days: tc.days ?? null, start: tc.startDate ?? null, end: tc.endDate ?? null,
    sugg: tc.suggestedStartDate ?? null, prov: tc.dateProvenance ?? null, month: tc.travelMonth ?? null,
    pending: next.pendingQuestion?.type ?? null, base: next.pendingQuestion?.baseDestination ?? null,
    offered: tc.offeredCombinations?.length ?? 0, selected: tc.selectedCombinationIds ?? null,
    sidChanged: next.planningSessionId !== prev.planningSessionId, trigger: Boolean(r?.advice?.triggerItineraryGeneration),
    patch: r?.advice?.contextPatch ?? null, reply: r?.advice?.reply ?? "" };
}

/** Send flow after the route's switch gate (NO_SWITCH branch); same chain as L2 / L4. */
async function sendTurn(s0, t, locale) {
  const s = clone(s0);
  const lastReply = s.lastAssistantReply;
  const flag = Boolean(partialApi && partialApi.isCombinationChoiceTurn(s) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply(t)));
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, lastReply);
  if (planningState.isReplanIntent(t) && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const g0 = geocodeLog.length;
  const m = travelContext.mergeTravelContext(n, t, lastReply);
  let session = m.session; let ctx = m.context;
  if (ctx.destinationCandidate?.status === "pending") {
    session = await globalPlanning.resolveGlobalPlanningCandidate(session, locale, geocode);
    ctx = session.travelContext ?? ctx;
  }
  const unresolved = Boolean(ctx.destinationClarification || (ctx.destinationCandidate && ctx.destinationCandidate.status !== "resolved"));
  const days = ctx.days ?? session.tripDays;
  if (!unresolved && ctx.destination && days) {
    await discovery.ensureDestinationCombinationsReady({
      destination: ctx.destination, destinationCountry: ctx.destinationCountryCode ?? ctx.destinationCountry, locale, days,
      resolvedDestination: ctx.destinationCoordinates ? { label: ctx.destination, city: ctx.destinationCity ?? ctx.destination, country: ctx.destinationCountryCode ?? ctx.destinationCountry,
        countryCode: ctx.destinationCountryCode, type: ctx.destinationType ?? "city", latitude: ctx.destinationCoordinates.lat, longitude: ctx.destinationCoordinates.lng,
        placeId: session.tripDestination?.placeId, source: "trip_destination", scopeLocked: false } : undefined,
      searchPlaces: async () => ({ places: poolFor(ctx.destination), error: null }),
    }).catch(() => null);
  }
  const r = stateMachine.processAdviceTurn(t, session, ctx, undefined, locale);
  const next = advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply ?? lastReply }, r.advice);
  // completeAdviceTurn → pauseForTripDates({...updated, travelContext: {...context, ...patch}}) on generation.
  let dateGate = null;
  if (r.advice.triggerItineraryGeneration) {
    const paused = dateConfirm.prepareTripDateConfirmation({ ...next, travelContext: { ...ctx, ...(r.advice.contextPatch ?? {}) } }, { entry: "direct" });
    dateGate = paused ? { paused: true, copy: dateConfirm.tripDateConfirmationCopy(paused, locale), proposed: paused.pendingQuestion?.dateConfirmation?.proposed ?? null } : { paused: false };
  }
  return { s: next, ctx, snap: { ...snapOf(s, next, r), geo: geocodeLog.slice(g0), dateGate } };
}

/** Route CONFIRMED_SWITCH wrapper (Authority result = fixture label) → merge → advice. */
async function routeTurn(s0, t, label, locale) {
  const s = clone(s0);
  const res = travelContext.applyConfirmedDestinationSwitch(s, { label, requestText: t, resetAlreadyThisTurn: false });
  if (!("applied" in res) || !res.applied) return { stop: res.stop ?? "not_applied" };
  const m = travelContext.mergeTravelContext(res.session, t, s.lastAssistantReply);
  const d = DESTS[destKey(label)];
  const routed = d && !m.session.tripDestination?.placeId
    ? { ...m.session, tripDestination: { ...(m.session.tripDestination ?? {}), placeId: `ChIJ_${d.code}_${d.city}`, city: d.city, country: countryOf(d), lat: d.lat, lng: d.lng } } : m.session;
  const ctx = m.context;
  if (ctx.destination && (ctx.days ?? routed.tripDays)) {
    await discovery.ensureDestinationCombinationsReady({ destination: ctx.destination, destinationCountry: ctx.destinationCountryCode ?? ctx.destinationCountry, locale, days: ctx.days ?? routed.tripDays,
      resolvedDestination: ctx.destinationCoordinates ? { label: ctx.destination, city: ctx.destinationCity ?? ctx.destination, country: ctx.destinationCountryCode ?? ctx.destinationCountry, countryCode: ctx.destinationCountryCode,
        type: ctx.destinationType ?? "city", latitude: ctx.destinationCoordinates.lat, longitude: ctx.destinationCoordinates.lng, placeId: routed.tripDestination?.placeId, source: "trip_destination", scopeLocked: false } : undefined,
      searchPlaces: async () => ({ places: poolFor(ctx.destination), error: null }) }).catch(() => null);
  }
  const r = stateMachine.processAdviceTurn(t, routed, ctx, undefined, locale);
  const next = advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply ?? s.lastAssistantReply }, r.advice);
  return { s: next, snap: snapOf(s, next, r) };
}

async function realTurn(s0, t, locale, label) {
  const cls = tpc.classifyDestinationSwitchTurn(t);
  if (cls.state === "CONFIRMED_SWITCH") return { route: cls.state, ...(await routeTurn(s0, t, label ?? cls.targetLabel, locale)) };
  if (cls.state !== "NO_SWITCH") return { route: cls.state, snap: null };
  return { route: cls.state, ...(await sendTurn(s0, t, locale)) };
}

const LOCALES = ["zh-TW", "en", "ja", "ko"];
const STEP1 = { en: "12/10-12/14 I'm going to sydney", "zh-TW": "12/10-12/14 我要去雪梨", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행" };
const SWITCH = { "zh-TW": "改去京都", en: "switch to Kyoto", ja: "京都に変更", ko: "교토로 바꿔" };
const SWITCH_NEG = { "zh-TW": "不去雪梨了，改去京都", en: "Not Sydney anymore, switch to Kyoto", ja: "シドニーはやめて、京都に変更", ko: "시드니 말고 교토로 바꿔" };

// A. misfires — all must keep HEAD's judgement.
const MISFIRE = {
  "zh-TW": ["不去雪梨的海邊了", "不去雪梨歌劇院了", "雪梨的海邊不去了，想去博物館", "不去海邊了，改去博物館", "可以但第二天輕鬆一點", "可以但改成輕鬆一點",
    "不要雪梨歌劇院", "我不要海邊，要博物館", "1和3", "第1組", "可以但第2組", "雪梨很好但有點貴"],
  en: ["Not Sydney Opera House", "Not the Sydney Opera House, more museums", "forget the beach, more museums", "Not Bondi Beach", "let's do 1 and 3", "let's do option 2",
    "fine but day 2 more relaxed", "fine but it's pricey", "no beaches please", "instead of the beach, museums"],
  ja: ["いいけど高い", "いいけど高いですね", "1にして", "2番にして", "1と3にして", "シドニーの海はやめて、博物館にして", "海じゃなくて博物館にして", "やっぱり1にして", "いいけど2日目はゆっくり"],
  ko: ["좋은데 비싸요", "1번으로 하자", "2번으로 해 주세요", "1, 3번으로 할게요", "시드니 바다 말고 박물관으로 하자", "바다 말고 박물관", "좋은데 둘째 날은 여유롭게", "오페라 하우스 말고 박물관으로 바꿔"],
};

// L8 approved spec: sentence → the category word that must never become the destination / a geocode.
const CATEGORY_SWITCH_SPEC = { "不去海邊了，改去博物館": "博物館" };

// C. outside combination choice.
const NEG_WISH = ["雪梨不去了，我要去京都", "雪梨不去了，我想去京都", "雪梨不去了，我要去京都玩", "雪梨不去了，那我要去京都", "不去雪梨了，我要去京都",
  "雪梨不去了，我想去看海", "雪梨不去了，我要去買東西", "雪梨不去了，我想去吃好吃的", "雪梨不去了，我要去海邊", "雪梨不去了，我要去博物館", "東京不去了，我要去淺草",
  "雪梨不去了", "雪梨的海邊不去了，我要去博物館", "雪梨歌劇院不去了，我要去邦代海灘"];

const pickCls = (c) => ({ state: c.state, reason: c.reason ?? null, target: c.targetLabel ?? null, authority: c.authority ?? null });

async function runAll() {
  const res = { step1: {}, misfire: {}, sw: {}, swPick: {}, cls: {}, parse: {}, stage: {}, unprov: {} };
  const step1 = {};
  for (const locale of LOCALES) {
    fresh();
    const st = await sendTurn(sessionMod.createEmptySession(), STEP1[locale], locale);
    step1[locale] = st.s;
    res.step1[locale] = st.snap;
    // pick 1 straight away (generation date gate)
    res.step1[`${locale}|pick1`] = (await sendTurn(st.s, "1", locale)).snap;
    for (const t of MISFIRE[locale]) {
      fresh();
      const cls = tpc.classifyDestinationSwitchTurn(t);
      const r = cls.state === "NO_SWITCH" ? (await sendTurn(st.s, t, locale)).snap : null;
      res.misfire[`${locale}|${t}`] = { cls: pickCls(cls), snap: r && { ...r, patch: undefined } };
    }
    fresh();
    if (typeof travelContext.applyConfirmedDestinationSwitch === "function") {
      try {
        const sw = await realTurn(st.s, SWITCH[locale], locale, "京都");
        res.sw[locale] = { route: sw.route, snap: sw.snap ?? null };
        if (sw.s && sw.snap?.pending === "combination_choice") res.swPick[locale] = (await sendTurn(sw.s, "1", locale)).snap;
      } catch (e) { res.sw[locale] = { error: String(e?.message ?? e).slice(0, 200) }; }
      try {
        fresh();
        const neg = await realTurn(st.s, SWITCH_NEG[locale], locale, "京都");
        res.sw[`${locale}|neg`] = { route: neg.route, snap: neg.snap ?? null };
      } catch (e) { res.sw[`${locale}|neg`] = { error: String(e?.message ?? e).slice(0, 200) }; }
    }
  }
  // E. date-only corrections while choosing combinations (global calendar branch writes dates
  //    without provenance; the previous user_date provenance is for the old dates).
  res.dateFix = {};
  for (const locale of LOCALES) {
    for (const t of { "zh-TW": ["抱歉是12/10-12/13", "12/20-12/23"], en: ["Sorry it's 12/10-12/13", "12/20-12/23"], ja: ["すみません、12/10〜12/13です", "12/20-12/23"], ko: ["죄송해요 12/10-12/13이에요", "12/20-12/23"] }[locale]) {
      fresh();
      const fix = await sendTurn(step1[locale], t, locale);
      const pick = fix.snap.pending === "combination_choice" ? await sendTurn(fix.s, "1", locale) : null;
      res.dateFix[`${locale}|${t}`] = { start: fix.snap.start, end: fix.snap.end, sugg: fix.snap.sugg, prov: fix.snap.prov, pending: fix.snap.pending,
        dated: (fix.snap.reply ?? "").split("\n").filter((l) => /12\/\d\d|暫定|[Tt]entative|仮|잠정/.test(l)).slice(0, 3), gate: pick?.snap?.dateGate ?? null };
    }
  }
  // C. classifier / parsers outside combination choice
  for (const t of NEG_WISH) {
    res.cls[t] = pickCls(tpc.classifyDestinationSwitchTurn(t));
    res.parse[t] = { parseDest: tpc.parseDestinationFromText(t) ?? null, incoming: resetMod.resolveIncomingDestinationFromText(t) ?? null };
  }
  // C. stages (the CONFIRMED wrapper / merge on non-combination sessions), zh.
  const zhTrip = step1["zh-TW"];
  const askDays = (() => { const s = clone(sessionMod.createEmptySession()); return s; })();
  const stages = {
    fresh_session: askDays,
    awaiting_days: await (async () => (await sendTurn(sessionMod.createEmptySession(), "我要去雪梨", "zh-TW")).s)(),
    combination_choice: zhTrip,
    after_pick: await (async () => (await sendTurn(zhTrip, "1", "zh-TW")).s)(),
  };
  for (const [stage, s] of Object.entries(stages)) {
    for (const t of ["雪梨不去了，我要去京都", "不去雪梨了，改去京都", "雪梨不去了，我想去看海"]) {
      fresh();
      const cls = tpc.classifyDestinationSwitchTurn(t);
      let snap = null;
      try {
        if (cls.state === "CONFIRMED_SWITCH") snap = (await routeTurn(s, t, cls.targetLabel ?? "京都", "zh-TW")).snap ?? null;
        else if (cls.state === "NO_SWITCH") snap = (await sendTurn(s, t, "zh-TW")).snap;
      } catch (e) { snap = { error: String(e?.message ?? e).slice(0, 160) }; }
      res.stage[`${stage}|${t}`] = { cls: pickCls(cls), before: { dest: s.travelContext?.destination ?? null, pending: s.pendingQuestion?.type ?? null },
        snap: snap && { dest: snap.dest, days: snap.days, start: snap.start, pending: snap.pending, sidChanged: snap.sidChanged, trigger: snap.trigger, reply: (snap.reply ?? "").slice(0, 80), error: snap.error } };
    }
  }
  // D. unprovenanced dates through a listing.
  //    D1: route 14064 wrote month-default dates with NO provenance (direct generation, no listing before);
  //    D2: same dates with the matching month_default provenance (the normal case after a listing).
  for (const [k, prov] of [["no_prov", undefined], ["month_default_prov", { source: "month_default", confirmed: false, startDate: "2026-12-15", endDate: "2026-12-19" }],
    ["ai_suggested_prov", { source: "ai_suggested", confirmed: false, startDate: "2026-12-15", endDate: "2026-12-19" }]]) {
    fresh();
    const base = clone(zhTrip);
    base.travelContext = { ...base.travelContext, travelMonth: "12月", startDate: "2026-12-15", endDate: "2026-12-19", suggestedStartDate: prov ? "2026-12-15" : undefined, dateProvenance: prov };
    if (!prov) { delete base.travelContext.dateProvenance; delete base.travelContext.suggestedStartDate; }
    base.tripStartDate = "2026-12-15"; base.tripEndDate = "2026-12-19";
    // re-listing through the combination switch (the listing reads these dates)
    const sw = typeof travelContext.applyConfirmedDestinationSwitch === "function" ? await realTurn(base, "改去京都", "zh-TW", "京都").catch((e) => ({ error: String(e) })) : null;
    const pick = sw?.s ? await sendTurn(sw.s, "1", "zh-TW") : null;
    const created = sw?.s ? createDates.resolveTripCreateDates({ context: sw.s.travelContext, session: sw.s, days: 5 }) : null;
    res.unprov[k] = { switched: sw?.snap && { dest: sw.snap.dest, start: sw.snap.start, end: sw.snap.end, sugg: sw.snap.sugg, prov: sw.snap.prov, reply: sw.snap.reply.split("\n").slice(0, 3) },
      pickGate: pick?.snap?.dateGate ?? null, created: created && { start: created.startDate, confirmed: created.datesConfirmed, source: created.source, explicit: created.hasExplicitDates } };
  }
  return res;
}

if (CHILD) {
  const r = await runAll();
  // Large payload on a pipe: exit only after the write is flushed.
  process.stdout.write(`@@L6_JSON@@${JSON.stringify(r)}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}

const failures = [];
async function check(name, fn) {
  try { await fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 10).join("\n  ")}`); }
}
function childResults(dir) {
  const self = "scripts/verify-l-combination-switch-misfires.mjs";
  if (!existsSync(join(dir, self)) || readFileSync(join(dir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(dir, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: dir, encoding: "utf8", timeout: 260_000, maxBuffer: 64 << 20 });
  const m = (r.stdout ?? "").match(/@@L6_JSON@@([\s\S]*?)@@END@@/);
  assert.ok(m, `child produced no JSON (status ${r.status}): ${(r.stdout ?? "").slice(-600)} ${(r.stderr ?? "").slice(-800)}`);
  return JSON.parse(m[1]);
}

const NOW = await runAll();
let HEAD = null;
if (headDirArg) { try { HEAD = childResults(headDirArg); } catch (e) { out(`NOTE head comparison unavailable: ${e.message}`); } }
const firstLines = (reply, n = 3) => (reply ?? "").split("\n").filter(Boolean).slice(0, n).join(" / ");
const dateLine = (reply) => (reply ?? "").split("\n").find((l) => /12\/1\d|2026|暫定|Tentative|仮|임시|日程|날짜|日期|dates?/i.test(l)) ?? "(none)";

// ---------------------------------------------------------------- A. misfires
for (const locale of LOCALES) {
  for (const t of MISFIRE[locale]) {
    await check(`A [${locale}] 「${t}」 keeps HEAD's judgement (no destination switch)`, () => {
      const w = NOW.misfire[`${locale}|${t}`];
      const h = HEAD?.misfire?.[`${locale}|${t}`];
      const s1 = NOW.step1[locale];
      const info = `\n  NOW cls=${JSON.stringify(w.cls)} snap=${JSON.stringify(w.snap && { dest: w.snap.dest, days: w.snap.days, start: w.snap.start, pending: w.snap.pending, selected: w.snap.selected, sid: w.snap.sidChanged, trig: w.snap.trigger, reply: w.snap.reply.slice(0, 90) })}`
        + (h ? `\n  HEAD cls=${JSON.stringify(h.cls)} snap=${JSON.stringify(h.snap && { dest: h.snap.dest, days: h.snap.days, start: h.snap.start, pending: h.snap.pending, selected: h.snap.selected, sid: h.snap.sidChanged, trig: h.snap.trigger, reply: h.snap.reply.slice(0, 90) })}` : "");
      assert.notEqual(w.cls.state, "CONFIRMED_SWITCH", `route classifier switches${info}`);
      if (h) assert.equal(w.cls.state, h.cls.state, `classifier differs from HEAD${info}`);
      // L8 approved spec (category word after 改去): the trip stays on its destination, no session
      // reset, never a geocode of the category word — regardless of HEAD's (mis)judgement.
      if (CATEGORY_SWITCH_SPEC[t]) {
        assert.ok(w.snap, `no snapshot (classifier ${w.cls.state})${info}`);
        assert.equal(sameDest(w.snap.dest), sameDest(s1.dest), `category spec: destination changed${info}`);
        assert.equal(w.snap.sidChanged, false, `category spec: planning session reset${info}`);
        assert.deepEqual(w.snap.geo.filter((q) => q.includes(CATEGORY_SWITCH_SPEC[t])), [], `category spec: geocoded the category word${info} geo=${JSON.stringify(w.snap.geo)}`);
        if (h?.snap) assert.deepEqual(w.snap.geo.filter((q) => !h.snap.geo.includes(q)), [], `geocode HEAD did not make${info}`);
        else assert.deepEqual(w.snap.geo, [], `geocode${info}`);
        if (h?.snap && (sameDest(h.snap.dest) !== sameDest(s1.dest) || h.snap.sidChanged)) out(`INFO HEAD-original misread fixed by L8 spec: [${locale}] 「${t}」 HEAD dest=${h.snap.dest} sidChanged=${h.snap.sidChanged}`);
        return;
      }
      if (w.snap) {
        // Equal to HEAD when HEAD is available (HEAD-original misreads stay recorded, not new);
        // otherwise the trip must stay on its destination.
        const ref = h?.snap ? h.snap : { dest: s1.dest, sidChanged: false };
        assert.equal(sameDest(w.snap.dest), sameDest(ref.dest), `destination differs from ${h?.snap ? "HEAD" : "STEP1"}${info}`);
        assert.equal(w.snap.sidChanged, ref.sidChanged, `planning session reset differs${info}`);
        if (h?.snap && (sameDest(h.snap.dest) !== sameDest(s1.dest) || h.snap.sidChanged)) out(`INFO HEAD-original misread kept: [${locale}] 「${t}」 dest=${h.snap.dest} sidChanged=${h.snap.sidChanged}`);
        if (h?.snap) assert.deepEqual(w.snap.geo.filter((q) => !h.snap.geo.includes(q)), [], `geocode HEAD did not make${info}`);
        else assert.deepEqual(w.snap.geo, [], `geocode${info}`);
        // Day-ordinal partial-modify replies (「可以但第二天…」"fine but day 2 …") follow the earlier
        // approved A8/A9 spec (follow-up, nothing selected) and intentionally differ from HEAD there;
        // only the "no switch" part is compared for them.
        const partialSpec = Boolean(partialApi?.isCombinationPartialModifyReply(t));
        if (h?.snap && !partialSpec) {
          for (const k of ["pending", "trigger", "days", "sidChanged"]) assert.deepEqual(w.snap[k], h.snap[k], `${k} differs from HEAD${info}`);
          assert.deepEqual(w.snap.selected ?? null, h.snap.selected ?? null, `selected differs from HEAD${info}`);
        }
        if (partialSpec) {
          assert.equal(w.snap.pending, "combination_choice", `partial-modify spec: pending${info}`);
          assert.equal(w.snap.trigger, false, `partial-modify spec: generation${info}`);
          assert.equal(w.snap.days, s1.days, `partial-modify spec: days${info}`);
        }
      }
    });
  }
}

// ---------------------------------------------------------------- B. date provenance / labels
const table = [];
for (const locale of LOCALES) {
  const s1 = NOW.step1[locale]; const h1 = HEAD?.step1?.[locale];
  const p1 = NOW.step1[`${locale}|pick1`]; const hp1 = HEAD?.step1?.[`${locale}|pick1`];
  const sw = NOW.sw[locale]?.snap; const hsw = HEAD?.sw?.[locale]?.snap;
  const swp = NOW.swPick[locale]; const hswp = HEAD?.swPick?.[locale];
  table.push(`[${locale}] STEP1  NOW start=${s1.start} prov=${s1.prov?.source ?? "none"}/${s1.prov?.confirmed ?? "-"} sugg=${s1.sugg} | dateLine=${JSON.stringify(dateLine(s1.reply))}`);
  if (h1) table.push(`[${locale}] STEP1  HEAD start=${h1.start} prov=${h1.prov?.source ?? "none"}/${h1.prov?.confirmed ?? "-"} sugg=${h1.sugg} | dateLine=${JSON.stringify(dateLine(h1.reply))}`);
  table.push(`[${locale}] STEP1→1 NOW gate=${JSON.stringify(p1.dateGate)}${hp1 ? `\n[${locale}] STEP1→1 HEAD gate=${JSON.stringify(hp1.dateGate)}` : ""}`);
  const dated = (r) => (r ?? "").split("\n").filter((l) => /12\/1\d|暫定|[Tt]entative|仮|임시|잠정/.test(l));
  table.push(`[${locale}] STEP1  NOW datedLines=${JSON.stringify(dated(s1.reply))}${h1 ? ` | HEAD datedLines=${JSON.stringify(dated(h1.reply))}` : ""}`);
  table.push(`[${locale}] SWITCH NOW datedLines=${JSON.stringify(dated(sw?.reply))}${hsw ? ` | HEAD datedLines=${JSON.stringify(dated(hsw.reply))}` : ""}`);
  const ng = NOW.sw[`${locale}|neg`]; const hng = HEAD?.sw?.[`${locale}|neg`];
  table.push(`[${locale}] NEG-SWITCH 「${SWITCH_NEG[locale]}」 NOW route=${ng?.route} dest=${ng?.snap?.dest} start=${ng?.snap?.start} prov=${ng?.snap?.prov?.source ?? "none"} datedLines=${JSON.stringify(dated(ng?.snap?.reply))}${hng ? ` | HEAD route=${hng.route} dest=${hng.snap?.dest} datedLines=${JSON.stringify(dated(hng.snap?.reply))}` : ""}`);
  table.push(`[${locale}] STEP1  NOW first=${JSON.stringify(firstLines(s1.reply, 3))}`);
  table.push(`[${locale}] SWITCH NOW route=${NOW.sw[locale]?.route} dest=${sw?.dest} start=${sw?.start} prov=${sw?.prov?.source ?? "none"}/${sw?.prov?.confirmed ?? "-"} | first=${JSON.stringify(firstLines(sw?.reply, 3))}`);
  if (HEAD) table.push(`[${locale}] SWITCH HEAD route=${HEAD.sw?.[locale]?.route} dest=${hsw?.dest} start=${hsw?.start} pending=${hsw?.pending} | first=${JSON.stringify(firstLines(hsw?.reply, 2))}`);
  table.push(`[${locale}] SWITCH→1 NOW gate=${JSON.stringify(swp?.dateGate ?? null)}${hswp ? ` | HEAD gate=${JSON.stringify(hswp.dateGate)}` : ""}`);
}
out("\nINFO date label / provenance matrix\n  " + table.join("\n  "));

await check("B STEP1 typed dates 12/10-12/14: provenance is the same in all four locales (user_date, confirmed)", () => {
  const rows = LOCALES.map((l) => `${l}: start=${NOW.step1[l].start} prov=${JSON.stringify(NOW.step1[l].prov)}`);
  for (const l of LOCALES) assert.equal(NOW.step1[l].prov?.source, "user_date", `typed dates not a user date\n  ${rows.join("\n  ")}`);
});
await check("B STEP1 → 「1」: no locale is asked to re-enter the dates it typed (generation date gate)", () => {
  const rows = LOCALES.map((l) => `${l}: trigger=${NOW.step1[`${l}|pick1`].trigger} gate=${JSON.stringify(NOW.step1[`${l}|pick1`].dateGate)}`);
  for (const l of LOCALES) assert.notEqual(NOW.step1[`${l}|pick1`].dateGate?.paused, true, `date confirmation asked again\n  ${rows.join("\n  ")}`);
});
await check("B switch listing: the date line has the same status (tentative or not) in all four locales", () => {
  const tent = (r) => /暫定|Tentative|tentative|仮の|임시|잠정/.test(r ?? "");
  const rows = LOCALES.map((l) => `${l}: tentative=${tent(NOW.sw[l]?.snap?.reply)} prov=${JSON.stringify(NOW.sw[l]?.snap?.prov ?? null)} line=${JSON.stringify(dateLine(NOW.sw[l]?.snap?.reply))}`);
  const vals = new Set(LOCALES.map((l) => tent(NOW.sw[l]?.snap?.reply)));
  assert.equal(vals.size, 1, rows.join("\n  "));
});
await check("B switch → 「1」: no locale is asked to re-enter the dates it typed", () => {
  const rows = LOCALES.map((l) => `${l}: gate=${JSON.stringify(NOW.swPick[l]?.dateGate ?? null)}`);
  for (const l of LOCALES) assert.notEqual(NOW.swPick[l]?.dateGate?.paused, true, rows.join("\n  "));
});

// ---------------------------------------------------------------- E. date-only corrections
out("\nINFO date-only corrections while choosing combinations\n  " + Object.entries(NOW.dateFix).map(([k, v]) => `${k}: NOW ${JSON.stringify(v)}${HEAD?.dateFix?.[k] ? `\n    HEAD ${JSON.stringify(HEAD.dateFix[k])}` : ""}`).join("\n  "));
await check("E typed date corrections are never asked again at generation (all locales)", () => {
  const bad = Object.entries(NOW.dateFix).filter(([, v]) => v.gate?.paused).map(([k, v]) => `${k}: start=${v.start} prov=${JSON.stringify(v.prov)} gate=${JSON.stringify(v.gate)}`);
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- C. outside combination choice
const cRows = [];
for (const t of NEG_WISH) {
  const w = NOW.cls[t]; const h = HEAD?.cls?.[t];
  cRows.push(`「${t}」 NOW=${JSON.stringify(w)} parse=${JSON.stringify(NOW.parse[t])}${h ? `\n    HEAD=${JSON.stringify(h)} parse=${JSON.stringify(HEAD.parse[t])}${JSON.stringify(w) === JSON.stringify(h) && JSON.stringify(NOW.parse[t]) === JSON.stringify(HEAD.parse[t]) ? " (same)" : " (DIFFERS)"}` : ""}`);
}
out("\nINFO classifier / parsers (stage-independent)\n  " + cRows.join("\n  "));
const sRows = Object.entries(NOW.stage).map(([k, v]) => `${k}: NOW cls=${v.cls.state} before=${JSON.stringify(v.before)} → ${JSON.stringify(v.snap)}${HEAD?.stage?.[k] ? `\n    HEAD cls=${HEAD.stage[k].cls.state} → ${JSON.stringify(HEAD.stage[k].snap)}` : ""}`);
out("\nINFO stages\n  " + sRows.join("\n  "));
for (const t of ["雪梨不去了，我想去看海", "雪梨不去了，我要去買東西", "雪梨不去了，我想去吃好吃的", "雪梨不去了，我要去海邊", "雪梨不去了，我要去博物館", "雪梨的海邊不去了，我要去博物館"]) {
  await check(`C 「${t}」 (wish, no destination) is not a confirmed switch and equals HEAD`, () => {
    assert.notEqual(NOW.cls[t].state, "CONFIRMED_SWITCH", JSON.stringify(NOW.cls[t]));
    if (HEAD) assert.deepEqual(NOW.cls[t], HEAD.cls[t], `NOW ${JSON.stringify(NOW.cls[t])} HEAD ${JSON.stringify(HEAD.cls[t])}`);
    if (HEAD) assert.deepEqual(NOW.parse[t], HEAD.parse[t], `parsers NOW ${JSON.stringify(NOW.parse[t])} HEAD ${JSON.stringify(HEAD.parse[t])}`);
  });
}
await check("C 「雪梨不去了，我要去京都」 classified as the extended form 「雪梨不去了，去京都」", () => {
  assert.equal(NOW.cls["雪梨不去了，我要去京都"].state, "CONFIRMED_SWITCH");
  assert.equal(NOW.cls["雪梨不去了，我要去京都"].target, "京都");
});

// ---------------------------------------------------------------- D. unprovenanced dates
out("\nINFO unprovenanced dates\n  " + Object.entries(NOW.unprov).map(([k, v]) => `${k}: NOW ${JSON.stringify(v)}${HEAD?.unprov?.[k] ? `\n    HEAD ${JSON.stringify(HEAD.unprov[k])}` : ""}`).join("\n  "));
for (const k of Object.keys(NOW.unprov)) {
  await check(`D ${k}: month-default / AI dates are never promoted to confirmed or explicit user dates`, () => {
    const v = NOW.unprov[k];
    if (!v.created) return;
    assert.equal(v.created.confirmed, false, JSON.stringify(v));
    assert.equal(v.created.explicit, false, JSON.stringify(v));
    assert.notEqual(v.switched?.prov?.confirmed, true, JSON.stringify(v));
  });
}

await check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.exit(failures.length ? 1 : 0);
