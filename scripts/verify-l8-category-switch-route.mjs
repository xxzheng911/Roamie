/**
 * L8 (tester, independent) — category / activity words after switch wording, NOW vs HEAD
 * (`-- --head-dir=<snapshot>`, re-runs itself there with --child).
 *
 *  1. 「改去X」「不去海邊了，改去X」"switch to X" "X instead" "instead of the beach, X"「Xに変更」「X로 바꿔」
 *     for category / activity X (博物館 溫泉 夜市 購物 咖啡廳 老街 動物園 遊樂園 / museum onsen shopping …):
 *     never the destination, never a planning-session reset, never a geocode of X (asserted);
 *  2. the route send order after the switch gate (_app.chat.tsx 10863 → 11590 → 11612 → 12011 →
 *     12111 → 12523 → 12574 → 12629 → 12880 → 12997/13024): which branch answers the turn
 *     (recorded only, approximate; the asserted reconstruction is verify-l8-museum-route-chain.mjs);
 *  3. named real places (「改去京都國立博物館」) recorded only.
 *
 * fetch is stubbed (must stay 0); geocode / Places are fixtures.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=400 scripts/verify-l8-category-switch-route.mjs -- --head-dir=<snapshot>
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDirArg = argv.find((a) => a.startsWith("--head-dir="))?.slice("--head-dir=".length);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog: run exceeded time limit"); process.exit(3); }, CHILD ? 250_000 : 380_000).unref();

let fetchCalls = 0;
globalThis.fetch = async (...a) => { fetchCalls++; throw new Error("NO_NETWORK " + String(a[0])); };
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const opt = async (p) => (existsSync(p) ? load(p) : {});
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
const aliases = await load("src/lib/ai/destination-locale-aliases.ts");
const partialApi = await opt("src/lib/ai/combination-partial-modify-reply.ts");
const placeIntent = await load("src/lib/ai/chat-place-intent.ts");
const refresh = await load("src/lib/ai/chat-recommendation-refresh.ts");
const mustVisit = await load("src/lib/ai/must-visit-places.ts");
const nearbyClar = await load("src/lib/ai/nearby-location-clarification.ts");
const chatIntent = await load("src/lib/ai/chat-intent.ts");
const arbitrate = await load("src/lib/ai/recommendation-refinement/arbitrate.ts");
const turnEngine = await load("src/lib/ai/chat-turn-engine.ts");
const catTypes = await load("src/lib/ai/chat-place-category-types.ts");
const catDest = await load("src/lib/ai/chat-category-destination.ts");
const turnDestMod = await load("src/lib/ai/chat-turn-destination.ts");
/** userText the App hands to resolveCategoryTurnDestination (_app.chat.tsx 12492 / 6584); HEAD: the raw text. */
const appCategoryUserText = (t) => (typeof tpc.categorySwitchSearchText === "function" && tpc.categorySwitchSearchText(t) ? "" : t);
const sameDest = (d) => (d ? tpc.normalizeDestinationLabel(aliases.canonicalFromDisplayName(d) ?? aliases.applyCityLocaleAlias(d) ?? d) : d);

const DESTS = {
  sydney: { match: /sydney|雪梨|シドニー|시드니/i, city: "Sydney", region: "New South Wales", countryRaw: "Australia", code: "AU", lat: -33.8688, lng: 151.2093,
    places: ["Sydney Opera House", "Sydney Harbour Bridge", "The Rocks", "Darling Harbour", "Circular Quay", "Bondi Beach",
      "Australian Museum", "Art Gallery of New South Wales", "Museum of Contemporary Art", "Powerhouse Museum", "Australian National Maritime Museum", "Museum of Sydney",
      "Royal Botanic Garden Sydney", "Hyde Park", "Centennial Park", "Barangaroo Reserve", "Chinese Garden of Friendship", "Observatory Hill"], address: "Sydney NSW, Australia", lang: "en" },
};
const countryOf = (d) => countryNorm.normalizeCountryReference(d.countryRaw, d.code).country || d.countryRaw;
const geocodeLog = [];
// --geo=miss (default): unknown queries return no result (a category word is not a place);
// --geo=hit: unknown queries resolve to a fake city hit (worst case: the provider matches a POI / town name).
const GEO_MODE = argv.find((a) => a.startsWith("--geo="))?.slice(6) ?? "miss";
const geocode = async (q) => {
  geocodeLog.push(q);
  const d = Object.values(DESTS).find((x) => x.match.test(q));
  if (!d && GEO_MODE !== "hit") return { rawResultCount: 0, location: null };
  if (!d) return { rawResultCount: 1, location: { placeId: `ChIJ_FAKE_${q}`, country: "Japan", city: q, region: "", lat: 35, lng: 135, formattedName: q, displayLabel: q } };
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
const safe = (fn) => { try { return fn(); } catch (e) { return `ERR ${String(e?.message ?? e).slice(0, 80)}`; } };

async function sendTurn(s0, t, locale) {
  const s = clone(s0);
  const lastReply = s.lastAssistantReply;
  const flag = Boolean(partialApi.isCombinationChoiceTurn && partialApi.isCombinationChoiceTurn(s) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply?.(t)));
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, lastReply);
  if (planningState.isReplanIntent(t) && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const g0 = geocodeLog.length;
  const m = travelContext.mergeTravelContext(n, t, lastReply);
  let session = m.session; let ctx = m.context;
  const mergedCandidate = ctx.destinationCandidate ? { raw: ctx.destinationCandidate.raw, status: ctx.destinationCandidate.status } : null;
  const mergedClar = ctx.destinationClarification ?? null;
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
  return { s: next, session, ctx, flag, mergedCandidate, mergedClar, advice: r.advice, geo: geocodeLog.slice(g0), locale };
}

/** Route predicates in send order (after the switch gate), on the merged session / context. */
function routeTrace(s0, t, st) {
  const msgs = [{ role: "assistant", content: s0.lastAssistantReply ?? "" }];
  const sess = st.session; const ctx = st.ctx;
  const placeCtx = safe(() => mustVisit.mergeContextForPlaceFetch(ctx, sess));
  const pc = typeof placeCtx === "string" ? ctx : placeCtx;
  const trace = {
    candidateBranch: Boolean(ctx.destinationClarification || (ctx.destinationCandidate && ctx.destinationCandidate.status !== "resolved")),
    partialModify: st.flag,
    alternative: safe(() => refresh.shouldAcceptAlternativeRecommendations(msgs, t)),
    refetch: safe(() => refresh.shouldRefetchPlaces(t, sess, ctx, msgs)),
    destinationPlaces: safe(() => mustVisit.shouldFetchDestinationPlaces(t, pc, sess)),
    categoryQuery: safe(() => placeIntent.shouldFetchDestinationCategoryPlaces(t, pc, sess)),
    hasCategory: safe(() => catTypes.hasCategoryPlaceQuery(t)),
    nearbyIntent: safe(() => chatIntent.inferNearbyIntentFromContext(pc, t, sess) ?? null),
    skipForRefinement: safe(() => arbitrate.shouldSkipTripPlanningForRefinement(t, sess)),
    planningActive: safe(() => turnEngine.isPlanningTurnActive(sess, ctx) || convState.isDestinationPlanningSession(sess, ctx)),
    categoryDest: safe(() => tpc.coerceTravelDestination(catDest.resolveDestinationForCategorySearch(pc, sess, t)) ?? null),
    // _app.chat.tsx 12487 / 6580: the destination 12577 / 12603 searches, resolved from the userText
    // the App actually passes (12492 / 6584: categorySwitchSearchText(t) ? "" : t; HEAD passes t).
    turnDest: safe(() => turnDestMod.resolveCategoryTurnDestination({ ctx: pc, session: sess, userText: appCategoryUserText(t), locale: st.locale }).destination ?? null),
    // 6594: clarification the category push asks instead of searching (before provider validation).
    turnClar: safe(() => { const res = turnDestMod.resolveCategoryTurnDestination({ ctx: pc, session: sess, userText: appCategoryUserText(t), locale: st.locale });
      const p = turnDestMod.planCategoryTurnClarification(res); return p ? { kind: p.kind, label: p.clarificationLabel ?? p.confirmedParentCity ?? null } : null; }),
    advicePlace: Boolean(st.advice.triggerPlaceRecommendations), adviceGen: Boolean(st.advice.triggerItineraryGeneration),
  };
  trace.authority = safe(() => nearbyClar.resolveChatRouteAuthority({ structuredShortcut: false, explicitNearbyRequest: chatIntent.userExplicitlyWantsNearbyPlaces(t),
    pendingNearbyLocationRequest: Boolean(sess.pendingNearbyLocationRequest), resolvedNearbyIntent: trace.nearbyIntent, categoryPlaceQuery: trace.categoryQuery === true }));
  const reply = (st.advice.reply ?? "").trim();
  let branch;
  if (trace.candidateBranch) branch = reply ? "11590 candidate advice" : "11590 candidate advice (EMPTY reply)";
  else if (trace.partialModify) branch = reply ? "11612 partial-modify advice" : "11612 partial-modify advice (EMPTY reply)";
  else if (trace.alternative === true) branch = "12011 alternative recommendations";
  else if (trace.refetch === true) branch = "12111 refetch / more places";
  else if (trace.destinationPlaces === true) branch = "12523 destination places";
  else if (trace.authority === "destination_category") branch = `12574 destination category places (turnDest=${trace.turnDest}${trace.turnDest ? "" : trace.turnClar && typeof trace.turnClar === "object" ? ` → 6603 clarification ${trace.turnClar.kind} 「${trace.turnClar.label}」` : " → 12622 noResults with empty destination"})`;
  else if (trace.skipForRefinement === true) branch = "12629 refinement";
  else if (trace.planningActive === true && !(trace.hasCategory === true && !trace.categoryDest)) branch = reply ? "12997 planning advice" : "13112 planning: EMPTY advice → discovery-failure copy (pending → ask_preference)";
  else branch = "13156+ later dispatch";
  return { ...trace, branch };
}

const LOCALES = ["zh-TW", "en", "ja", "ko"];
const STEP1 = { en: "12/10-12/14 I'm going to sydney", "zh-TW": "12/10-12/14 我要去雪梨", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행" };
const ko = (w) => (/[가-힣]$/.test(w) && ((w.charCodeAt(w.length - 1) - 0xac00) % 28 !== 0) && ((w.charCodeAt(w.length - 1) - 0xac00) % 28 !== 8) ? `${w}으로` : `${w}로`);
const WORDS = {
  "zh-TW": ["博物館", "溫泉", "夜市", "購物", "咖啡廳", "老街", "動物園", "遊樂園", "美術館", "海邊"],
  en: ["museum", "museums", "onsen", "shopping", "night market", "cafe", "zoo", "theme park", "beach"],
  ja: ["博物館", "温泉", "買い物", "カフェ", "動物園", "遊園地", "夜市", "美術館"],
  ko: ["박물관", "온천", "쇼핑", "카페", "동물원", "놀이공원", "야시장", "해변"],
};
const FORMS = {
  "zh-TW": (w) => [`改去${w}`, `不去海邊了，改去${w}`, `換成${w}`],
  en: (w) => [`switch to ${w}`, `${w} instead`, `instead of the beach, ${w}`],
  ja: (w) => [`${w}に変更`, `海じゃなくて${w}に変更`],
  ko: (w) => [`${ko(w)} 바꿔`, `바다 말고 ${ko(w)} 바꿔`],
};
const NAMED = { "zh-TW": ["改去京都國立博物館", "不去海邊了，改去澳洲博物館"], en: ["switch to the Australian Museum"], ja: ["京都国立博物館に変更"], ko: ["호주 박물관으로 바꿔"] };
const pickCls = (c) => ({ state: c.state, target: c.targetLabel ?? null });

async function runAll() {
  const res = { rows: {}, named: {} };
  for (const locale of LOCALES) {
    fresh();
    const step1 = (await sendTurn(sessionMod.createEmptySession(), STEP1[locale], locale)).s;
    const afterPick = (await sendTurn(step1, "1", locale)).s;
    const stages = { combination_choice: step1, general: afterPick };
    const sentences = WORDS[locale].flatMap((w) => FORMS[locale](w).map((t) => ({ t, w })));
    for (const [stage, s0] of Object.entries(stages)) {
      for (const { t, w } of [...sentences, ...NAMED[locale].map((t) => ({ t, w: null }))]) {
        fresh();
        const cls = tpc.classifyDestinationSwitchTurn(t);
        const incoming = safe(() => resetMod.resolveIncomingDestinationFromText(t) ?? null);
        const newTrip = safe(() => { const r = resetMod.isNewTripPlanning(clone(s0), t); return { isNew: r.isNew, reason: r.reason ?? null, incoming: r.incomingDestination ?? null }; });
        let row;
        if (cls.state !== "NO_SWITCH") {
          row = { cls: pickCls(cls), incoming, newTrip, snap: null };
        } else {
          const st = await sendTurn(s0, t, locale);
          const tc = st.s.travelContext ?? {};
          row = { cls: pickCls(cls), incoming, newTrip,
            snap: { dest: tc.destination ?? null, sidChanged: st.s.planningSessionId !== s0.planningSessionId, pending: st.s.pendingQuestion?.type ?? null,
              candidate: st.mergedCandidate, clar: st.mergedClar, geo: st.geo, reply: (st.advice.reply ?? "").slice(0, 100), trigger: Boolean(st.advice.triggerItineraryGeneration),
              place: Boolean(st.advice.triggerPlaceRecommendations) },
            route: routeTrace(s0, t, st) };
        }
        (w ? res.rows : res.named)[`${locale}|${stage}|${t}`] = { ...row, word: w, before: s0.travelContext?.destination ?? null };
      }
    }
  }
  return res;
}

if (CHILD) {
  const r = await runAll();
  process.stdout.write(`@@L8_JSON@@${JSON.stringify(r)}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}

const failures = [];
async function check(name, fn) {
  try { await fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 8).join("\n  ")}`); }
}
function childResults(dir) {
  const self = "scripts/verify-l8-category-switch-route.mjs";
  if (!existsSync(join(dir, self)) || readFileSync(join(dir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(dir, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", `--geo=${GEO_MODE}`], { cwd: dir, encoding: "utf8", timeout: 240_000, maxBuffer: 64 << 20 });
  const m = (r.stdout ?? "").match(/@@L8_JSON@@([\s\S]*?)@@END@@/);
  assert.ok(m, `child produced no JSON (status ${r.status}): ${(r.stdout ?? "").slice(-600)} ${(r.stderr ?? "").slice(-800)}`);
  return JSON.parse(m[1]);
}

const NOW = await runAll();
let HEAD = null;
if (headDirArg) { try { HEAD = childResults(headDirArg); } catch (e) { out(`NOTE head comparison unavailable: ${e.message}`); } }

const fmt = (v) => v && `cls=${v.cls.state}${v.cls.target ? `→${v.cls.target}` : ""} newTrip=${JSON.stringify(v.newTrip)} ${v.snap ? `dest=${v.snap.dest} sid=${v.snap.sidChanged} pending=${v.snap.pending} cand=${JSON.stringify(v.snap.candidate)} clar=${v.snap.clar} geo=${JSON.stringify(v.snap.geo)} reply=${JSON.stringify(v.snap.reply.slice(0, 50))}` : "(route gate)"}${v.route ? ` | branch=${v.route.branch} flags=${JSON.stringify({ alt: v.route.alternative, refetch: v.route.refetch, dp: v.route.destinationPlaces, cat: v.route.categoryQuery, hasCat: v.route.hasCategory, auth: v.route.authority, refine: v.route.skipForRefinement, plan: v.route.planningActive, catDest: v.route.categoryDest, turnDest: v.route.turnDest, advPlace: v.route.advicePlace, advGen: v.route.adviceGen })}` : ""}`;
out(`INFO geocode fixture mode: ${GEO_MODE}`);
const lines = [];
for (const [k, v] of Object.entries(NOW.rows)) lines.push(`${k}\n    NOW  ${fmt(v)}${HEAD?.rows?.[k] ? `\n    HEAD ${fmt(HEAD.rows[k])}` : ""}`);
out("INFO category rows\n  " + lines.join("\n  "));
out("\nINFO named places (recorded)\n  " + Object.entries(NOW.named).map(([k, v]) => `${k}\n    NOW  ${fmt(v)}${HEAD?.named?.[k] ? `\n    HEAD ${fmt(HEAD.named[k])}` : ""}`).join("\n  "));

const brief = (v) => !v ? "-" : v.cls.state !== "NO_SWITCH" ? `route-gate ${v.cls.state}` : `dest=${v.snap.dest} reset=${v.snap.sidChanged} geo=${v.snap.geo.length ? v.snap.geo.join("/") : "0"} → ${v.route.branch.replace(/\s*\(pending → ask_preference\)/, "")}`;
out("\nSUMMARY (NOW | HEAD)\n  " + [...Object.entries(NOW.rows), ...Object.entries(NOW.named)].map(([k, v]) => {
  const h = HEAD?.rows?.[k] ?? HEAD?.named?.[k];
  return `${k}\n      NOW  ${brief(v)}${h ? `\n      HEAD ${brief(h)}${brief(h) === brief(v) ? "  (same)" : ""}` : ""}`;
}).join("\n  "));

for (const [k, v] of Object.entries(NOW.rows)) {
  await check(`category ${k}: not a destination, no reset, no geocode of 「${v.word}」`, () => {
    const info = `\n  ${fmt(v)}`;
    assert.notEqual(v.cls.state, "CONFIRMED_SWITCH", `route classifier confirms a switch${info}`);
    if (v.cls.state !== "NO_SWITCH") return; // NEGATED_UNCERTAIN: route gate asks / stops (no write)
    assert.equal(sameDest(v.snap.dest), sameDest(v.before), `destination changed${info}`);
    assert.equal(v.snap.sidChanged, false, `planning session reset${info}`);
    assert.deepEqual(v.snap.geo.filter((q) => q.toLowerCase().includes(v.word.toLowerCase())), [], `geocoded the category word${info}`);
    assert.ok(!v.snap.candidate || !String(v.snap.candidate.raw).toLowerCase().includes(v.word.toLowerCase()), `category word became a destination candidate${info}`);
    assert.ok(!(typeof v.newTrip === "object" && v.newTrip.isNew), `isNewTripPlanning says new trip${info}`);
    // The category branch searches the current destination with the App's input: no clarification.
    if (v.route?.authority === "destination_category") {
      assert.equal(sameDest(v.route.turnDest), sameDest(v.before), `App turn destination is not the current destination${info}`);
      assert.equal(v.route.turnClar, null, `App asks a clarification instead of searching${info}`);
    }
  });
}
// Route column above is an approximation (no mergeTripPlanningContext / constraint delta); the
// asserted route reconstruction for the 「不去海邊了，改去X」 family is verify-l8-museum-route-chain.mjs.
out("\nINFO approximate EMPTY-advice rows: " + JSON.stringify(Object.entries(NOW.rows).filter(([, v]) => v.route && /EMPTY/.test(v.route.branch)).map(([k]) => k)));
await check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
// Large output on a pipe: exit only after it is flushed.
process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
await new Promise(() => {});
