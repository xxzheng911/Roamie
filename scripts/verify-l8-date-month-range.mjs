/**
 * L8 (tester, independent) — date provenance edges of the global-planning merge, all four locales:
 *  M. a sentence with BOTH a month and a start–end range (「12月 12/10-12/14 京都」"12/10-12/14 in
 *     December") keeps this turn's range as a confirmed user date (monthChanged must not clear it),
 *     and 「1」 afterwards never asks for the dates again;
 *  O. a month-only change to another month (「改成1月」"make it January"「1月に変更」「1월로 바꿔」)
 *     clears start / end AND dateProvenance (no stale confirmed provenance left behind);
 *  U. month_default / ai_suggested / unknown dates are never upgraded to user_date by an unrelated
 *     turn, a pick, a destination switch or a month-only turn.
 * fetch is stubbed (must stay 0); geocode / Places are fixtures.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=240 scripts/verify-l8-date-month-range.mjs
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";
import { readFileSync as rf, copyFileSync as cf, existsSync as ex } from "node:fs";
import { join as pj } from "node:path";
import { spawnSync as sp } from "node:child_process";

const out = console.log.bind(console);
{
  // `-- --head-dir=<snapshot>`: the same script in the snapshot first (recorded, not asserted).
  const headDir = process.argv.slice(2).find((a) => a.startsWith("--head-dir="))?.slice(11);
  if (headDir) {
    const self = "scripts/verify-l8-date-month-range.mjs";
    if (!ex(pj(headDir, self)) || rf(pj(headDir, self), "utf8") !== rf(self, "utf8")) cf(self, pj(headDir, self));
    const r = sp("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs"], { cwd: headDir, encoding: "utf8", timeout: 220_000, maxBuffer: 64 << 20 });
    out(`HEAD RUN (status ${r.status}) ↓\n${(r.stdout ?? "").split("\n").map((l) => `HEAD| ${l}`).join("\n")}\nHEAD RUN ↑\n`);
  }
}
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog: run exceeded time limit"); process.exit(3); }, 230_000).unref();
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
const dateConfirm = await load("src/lib/ai/trip-date-confirmation.ts");
const createDates = await load("src/lib/ai/resolve-trip-create-dates.ts");
const { existsSync } = await import("node:fs");
const partialApi = existsSync("src/lib/ai/combination-partial-modify-reply.ts") ? await load("src/lib/ai/combination-partial-modify-reply.ts") : null;

const DESTS = {
  sydney: { match: /sydney|雪梨|シドニー|시드니/i, city: "Sydney", region: "New South Wales", countryRaw: "Australia", code: "AU", lat: -33.8688, lng: 151.2093, lang: "en", address: "Sydney NSW, Australia",
    places: ["Sydney Opera House", "Sydney Harbour Bridge", "The Rocks", "Darling Harbour", "Circular Quay", "Bondi Beach", "Australian Museum", "Art Gallery of New South Wales", "Museum of Contemporary Art", "Powerhouse Museum", "Australian National Maritime Museum", "Museum of Sydney", "Royal Botanic Garden Sydney", "Hyde Park", "Centennial Park", "Barangaroo Reserve", "Chinese Garden of Friendship", "Observatory Hill"] },
  kyoto: { match: /kyoto|京都|교토/i, city: "京都市", region: "京都府", countryRaw: "Japan", code: "JP", lat: 35.0116, lng: 135.7681, lang: "ja", address: "Kyoto Japan",
    places: ["清水寺", "金閣寺", "銀閣寺", "元離宮二条城", "産寧坂", "二寧坂", "京都国立博物館", "京都市京セラ美術館", "京都鉄道博物館", "京都文化博物館", "京都国際マンガミュージアム", "細見美術館", "京都御苑", "円山公園", "京都府立植物園", "嵐山公園", "梅小路公園", "鴨川公園"] },
};
const countryOf = (d) => countryNorm.normalizeCountryReference(d.countryRaw, d.code).country || d.countryRaw;
const geocodeLog = [];
const geocode = async (q) => {
  geocodeLog.push(q);
  const d = Object.values(DESTS).find((x) => x.match.test(q));
  if (!d) return { rawResultCount: 0, location: null };
  return { rawResultCount: 1, location: { placeId: `ChIJ_${d.code}_${d.city}`, country: countryOf(d), city: d.city, region: d.region, lat: d.lat, lng: d.lng, formattedName: d.city, displayLabel: d.city } };
};
const poolFor = (dest) => {
  const d = Object.values(DESTS).find((x) => x.match.test(dest ?? ""));
  if (!d) return [];
  return d.places.map((name, i) => ({ id: `ChIJ${d.code}P${i}`, name, sourceLocale: d.lang, lat: d.lat + i * 0.0003, lng: d.lng,
    types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park",
    rating: 4.6, userRatingCount: 10000, address: d.address, businessStatus: "OPERATIONAL" }));
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const fresh = () => { discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache(); };

async function sendTurn(s0, t, locale) {
  const s = clone(s0);
  const lastReply = s.lastAssistantReply;
  const flag = Boolean(partialApi && partialApi.isCombinationChoiceTurn(s) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply?.(t)));
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, lastReply);
  if (planningState.isReplanIntent(t) && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const m = travelContext.mergeTravelContext(n, t, lastReply);
  let session = m.session; let ctx = m.context;
  if (ctx.destinationCandidate?.status === "pending") { session = await globalPlanning.resolveGlobalPlanningCandidate(session, locale, geocode); ctx = session.travelContext ?? ctx; }
  const days = ctx.days ?? session.tripDays;
  if (ctx.destination && days && !ctx.destinationClarification) {
    await discovery.ensureDestinationCombinationsReady({ destination: ctx.destination, destinationCountry: ctx.destinationCountryCode ?? ctx.destinationCountry, locale, days,
      resolvedDestination: ctx.destinationCoordinates ? { label: ctx.destination, city: ctx.destinationCity ?? ctx.destination, country: ctx.destinationCountryCode ?? ctx.destinationCountry, countryCode: ctx.destinationCountryCode,
        type: ctx.destinationType ?? "city", latitude: ctx.destinationCoordinates.lat, longitude: ctx.destinationCoordinates.lng, placeId: session.tripDestination?.placeId, source: "trip_destination", scopeLocked: false } : undefined,
      searchPlaces: async () => ({ places: poolFor(ctx.destination), error: null }) }).catch(() => null);
  }
  const r = stateMachine.processAdviceTurn(t, session, ctx, undefined, locale);
  const next = advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply ?? lastReply }, r.advice);
  let gate = null;
  if (r.advice.triggerItineraryGeneration) {
    const paused = dateConfirm.prepareTripDateConfirmation({ ...next, travelContext: { ...ctx, ...(r.advice.contextPatch ?? {}) } }, { entry: "direct" });
    gate = paused ? { paused: true, copy: dateConfirm.tripDateConfirmationCopy(paused, locale), proposed: paused.pendingQuestion?.dateConfirmation?.proposed ?? null } : { paused: false };
  }
  const tc = next.travelContext ?? {};
  return { s: next, snap: { dest: tc.destination ?? null, start: tc.startDate ?? null, end: tc.endDate ?? null, month: tc.travelMonth ?? null, sugg: tc.suggestedStartDate ?? null,
    prov: tc.dateProvenance ?? null, pending: next.pendingQuestion?.type ?? null, trigger: Boolean(r.advice.triggerItineraryGeneration), gate,
    created: (() => { try { const c = createDates.resolveTripCreateDates({ context: tc, session: next, days: tc.days ?? next.tripDays ?? 5 }); return { start: c.startDate ?? null, confirmed: c.datesConfirmed, source: c.source, explicit: c.hasExplicitDates }; } catch (e) { return String(e?.message ?? e).slice(0, 80); } })(),
    reply: (r.advice.reply ?? "").split("\n").filter(Boolean).slice(0, 2).join(" / ").slice(0, 120) } };
}

const failures = [];
async function check(name, fn) { try { await fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 8).join("\n  ")}`); } }
const LOCALES = ["zh-TW", "en", "ja", "ko"];
const STEP1_NOV = { "zh-TW": "11/3-11/7 我要去雪梨", en: "11/3-11/7 I'm going to sydney", ja: "11/3-11/7 シドニーへ旅行", ko: "11/3-11/7 시드니 여행" };
const STEP1_DEC = { "zh-TW": "12/10-12/14 我要去雪梨", en: "12/10-12/14 I'm going to sydney", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행" };
const MONTH_RANGE_SWITCH = { "zh-TW": "12月 12/10-12/14 京都", en: "Kyoto 12/10-12/14 in December", ja: "12月 12/10-12/14 京都に変更", ko: "12월 12/10-12/14 교토로 바꿔" };
const MONTH_RANGE_ONLY = { "zh-TW": "改成12月 12/10-12/14", en: "12/10-12/14 in December", ja: "12月 12/10〜12/14にします", ko: "12월 12/10-12/14로 할게요" };
const MONTH_ONLY = { "zh-TW": "改成1月", en: "make it January", ja: "1月に変更", ko: "1월로 바꿔" };
const STEP1_MONTH = { "zh-TW": "12月去雪梨5天", en: "Sydney for 5 days in December", ja: "12月にシドニーへ5日間旅行", ko: "12월에 시드니 5일 여행" };
const rows = [];

for (const locale of LOCALES) {
  fresh();
  const nov = await sendTurn(sessionMod.createEmptySession(), STEP1_NOV[locale], locale);
  rows.push(`[${locale}] STEP1 11/3-11/7 ${JSON.stringify(nov.snap)}`);
  for (const [kind, t, wantDest] of [["switch", MONTH_RANGE_SWITCH[locale], "京都"], ["dates", MONTH_RANGE_ONLY[locale], null]]) {
    fresh();
    const r = await sendTurn(nov.s, t, locale);
    const pick = r.snap.pending === "combination_choice" ? await sendTurn(r.s, "1", locale) : null;
    rows.push(`[${locale}] M-${kind} 「${t}」 ${JSON.stringify(r.snap)}\n      → 「1」 gate=${JSON.stringify(pick?.snap.gate ?? null)} created=${JSON.stringify(pick?.snap.created ?? null)}`);
    await check(`M [${locale}] ${kind} 「${t}」 keeps this turn's range as a confirmed user date; 「1」 is not asked again`, () => {
      const info = `\n  ${JSON.stringify(r.snap)}\n  pick=${JSON.stringify(pick?.snap ?? null)}`;
      if (wantDest) assert.equal(tpc.normalizeDestinationLabel(r.snap.dest ?? ""), wantDest, `destination${info}`);
      assert.equal(r.snap.start, "2026-12-10", `start${info}`);
      assert.equal(r.snap.end, "2026-12-14", `end${info}`);
      assert.equal(r.snap.prov?.source, "user_date", `provenance${info}`);
      assert.equal(r.snap.prov?.confirmed, true, `confirmed${info}`);
      assert.equal(r.snap.prov?.startDate, "2026-12-10", `provenance dates${info}`);
      assert.ok(pick, `no combination listing after the turn (pending=${r.snap.pending})${info}`);
      assert.notEqual(pick.snap.gate?.paused, true, `date asked again${info}`);
    });
  }
  fresh();
  const dec = await sendTurn(sessionMod.createEmptySession(), STEP1_DEC[locale], locale);
  fresh();
  const mo = await sendTurn(dec.s, MONTH_ONLY[locale], locale);
  rows.push(`[${locale}] O 「${MONTH_ONLY[locale]}」 ${JSON.stringify(mo.snap)}`);
  await check(`O [${locale}] month-only 「${MONTH_ONLY[locale]}」 clears start / end and provenance`, () => {
    const info = `\n  ${JSON.stringify(mo.snap)}`;
    assert.equal(mo.snap.start, null, `start kept${info}`);
    assert.equal(mo.snap.end, null, `end kept${info}`);
    assert.ok(!mo.snap.prov || mo.snap.prov.confirmed !== true, `confirmed provenance left behind${info}`);
    assert.ok(!mo.snap.prov || mo.snap.prov.source !== "user_date", `user_date provenance left behind${info}`);
  });
  // U. month default from STEP1 (no typed dates) → unrelated turn → pick.
  fresh();
  const md = await sendTurn(sessionMod.createEmptySession(), STEP1_MONTH[locale], locale);
  const unrelated = md.snap.pending === "combination_choice" ? await sendTurn(md.s, { "zh-TW": "我想輕鬆一點", en: "something relaxed", ja: "ゆったりがいい", ko: "여유롭게 하고 싶어요" }[locale], locale) : null;
  const pickMd = md.snap.pending === "combination_choice" ? await sendTurn(md.s, "1", locale) : null;
  rows.push(`[${locale}] U STEP1-month ${JSON.stringify(md.snap)}\n      unrelated ${JSON.stringify(unrelated?.snap ?? null)}\n      → 「1」 ${JSON.stringify(pickMd?.snap ?? null)}`);
  await check(`U [${locale}] month-only STEP1 dates are never a confirmed user date (listing, unrelated turn, 「1」)`, () => {
    for (const [k, v] of [["step1", md.snap], ["unrelated", unrelated?.snap], ["pick", pickMd?.snap]]) {
      if (!v) continue;
      const info = `\n  ${k}: ${JSON.stringify(v)}`;
      assert.ok(!(v.prov?.source === "user_date"), `upgraded to user_date${info}`);
      assert.notEqual(v.prov?.confirmed, true, `confirmed${info}`);
      if (typeof v.created === "object" && v.created.start) assert.equal(v.created.confirmed, false, `trip create dates confirmed${info}`);
    }
    if (pickMd?.snap.trigger) assert.equal(pickMd.snap.gate?.paused, true, `generation started on unconfirmed dates without the date gate\n  ${JSON.stringify(pickMd.snap)}`);
  });
  // U2. ai_suggested / month_default / unknown injected on the Dec session → switch → month-only.
  for (const [k, prov] of [["ai_suggested", { source: "ai_suggested", confirmed: false }], ["month_default", { source: "month_default", confirmed: false }], ["unknown", { source: "unknown", confirmed: false }]]) {
    const base = clone(dec.s);
    base.travelContext = { ...base.travelContext, startDate: "2026-12-15", endDate: "2026-12-19", suggestedStartDate: "2026-12-15", dateProvenance: { ...prov, startDate: "2026-12-15", endDate: "2026-12-19" } };
    base.tripStartDate = "2026-12-15"; base.tripEndDate = "2026-12-19";
    fresh();
    const sw = await sendTurn(base, { "zh-TW": "改去京都", en: "switch to Kyoto", ja: "京都に変更", ko: "교토로 바꿔" }[locale], locale);
    const pick = sw.snap.pending === "combination_choice" ? await sendTurn(sw.s, "1", locale) : null;
    rows.push(`[${locale}] U2 ${k} switch ${JSON.stringify(sw.snap)}\n      → 「1」 gate=${JSON.stringify(pick?.snap.gate ?? null)} created=${JSON.stringify(pick?.snap.created ?? null)}`);
    await check(`U2 [${locale}] ${k} dates are not upgraded by a destination switch / pick`, () => {
      const info = `\n  ${JSON.stringify(sw.snap)}\n  pick=${JSON.stringify(pick?.snap ?? null)}`;
      assert.ok(sw.snap.prov?.source !== "user_date" && sw.snap.prov?.confirmed !== true, `switch upgraded${info}`);
      if (pick) {
        assert.ok(pick.snap.prov?.source !== "user_date" && pick.snap.prov?.confirmed !== true, `pick upgraded${info}`);
        if (typeof pick.snap.created === "object") assert.equal(pick.snap.created.confirmed, false, `create dates confirmed${info}`);
        if (pick.snap.trigger) assert.equal(pick.snap.gate?.paused, true, `generation without date gate${info}`);
      }
    });
  }
}
out("\nINFO rows\n  " + rows.join("\n  "));
await check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.exit(failures.length ? 1 : 0);
