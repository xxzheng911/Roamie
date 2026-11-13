/**
 * M2 (tester, independent) — the reply the user actually sees for category / activity switch
 * wording, through the App's send chain after the merge (same reconstruction as
 * verify-l8-museum-route-chain.mjs) PLUS the category push itself:
 *   _app.chat.tsx 12487 resolveCategoryTurnDestination(userText: categorySwitchSearchText(t) ? "" : t)
 *   → 12603 pushDestinationCategoryPlaceRecommendation({ turnDestination })      (path "12603")
 *   / 13541 / 13682 / 7762 push without turnDestination → 6580 same resolution     (path "6584")
 *   → 6578 validateCategoryTurnDestination → 6594 planCategoryTurnClarification (whichRegion /
 *     parentScopeConfirm copy) → 6675 resolveTrustedContextTurnDestination → 6686 trusted scope
 *   → 6732 buildDestinationCategoryRecommendations (real builder; Places is a fixture spy)
 *   → 6881 combination_choice pending kept → next 「1」 still selects.
 * Each row is also computed with the HEAD App input (raw userText) in the same tree for comparison.
 * 4 locales × 2 stages (combination_choice / general) × 博物館 溫泉 夜市 咖啡廳 × 2 forms.
 * fetch is stubbed (must stay 0). `--geo=hit`: unknown geocode queries resolve to a fake town.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=400 scripts/verify-m2-category-switch-app-reply.mjs
 */
import assert from "node:assert/strict";

const argv = process.argv.slice(2);
const GEO_MODE = argv.find((a) => a.startsWith("--geo="))?.slice(6) ?? "miss";
const VERBOSE = argv.includes("--verbose");
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 380_000).unref();
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
const partialApi = await load("src/lib/ai/combination-partial-modify-reply.ts");
const planningFlow = await load("src/lib/chat-planning-flow.ts");
const constraints = await load("src/lib/ai/planning-conversation-constraints.ts");
const budget = await load("src/lib/ai/budget-refinement.ts");
const addAll = await load("src/lib/ai/parse-add-all-to-trip-intent.ts");
const refresh = await load("src/lib/ai/chat-recommendation-refresh.ts");
const mustVisit = await load("src/lib/ai/must-visit-places.ts");
const placeIntent = await load("src/lib/ai/chat-place-intent.ts");
const nearbyClar = await load("src/lib/ai/nearby-location-clarification.ts");
const chatIntent = await load("src/lib/ai/chat-intent.ts");
const arbitrate = await load("src/lib/ai/recommendation-refinement/arbitrate.ts");
const turnEngine = await load("src/lib/ai/chat-turn-engine.ts");
const catTypes = await load("src/lib/ai/chat-place-category-types.ts");
const catDest = await load("src/lib/ai/chat-category-destination.ts");
const turnDestMod = await load("src/lib/ai/chat-turn-destination.ts");
const builder = await load("src/lib/ai/chat-destination-category-recommendation.ts");
const durationGuard = await load("src/lib/ai/trip-duration-guard.ts");
const prodUi = await load("src/lib/i18n/production-ui.ts");
const copyMod = await load("src/lib/chat-runtime-copy.ts");
const copy = (k, l, v) => copyMod.chatRuntimeCopy(k, l, v);

const D = { match: /sydney|雪梨|シドニー|시드니/i, city: "Sydney", region: "New South Wales", countryRaw: "Australia", code: "AU", lat: -33.8688, lng: 151.2093,
  places: ["Sydney Opera House", "Sydney Harbour Bridge", "The Rocks", "Darling Harbour", "Circular Quay", "Bondi Beach", "Australian Museum", "Art Gallery of New South Wales", "Museum of Contemporary Art", "Powerhouse Museum", "Australian National Maritime Museum", "Museum of Sydney", "Royal Botanic Garden Sydney", "Hyde Park", "Centennial Park", "Barangaroo Reserve", "Chinese Garden of Friendship", "Observatory Hill"] };
const country = countryNorm.normalizeCountryReference(D.countryRaw, D.code).country || D.countryRaw;
const geocodeLog = [];
const sydneyLoc = { placeId: "ChIJ_AU_Sydney", country, city: D.city, region: D.region, lat: D.lat, lng: D.lng, formattedName: D.city, displayLabel: D.city };
// global-planning geocode (raw form)
const geocodeRaw = async (q) => { geocodeLog.push(q); if (D.match.test(q)) return { rawResultCount: 1, location: sydneyLoc };
  return GEO_MODE === "hit" ? { rawResultCount: 1, location: { placeId: `ChIJ_FAKE_${q}`, country: "Japan", city: q, region: "", lat: 35, lng: 135, formattedName: q, displayLabel: q } } : { rawResultCount: 0, location: null }; };
// App geocodeLocationFn (envelope form)
const geocodeFn = async (req) => {
  const q = String(req?.data?.query ?? req?.data?.destinationName ?? "");
  geocodeLog.push(q);
  const loc = D.match.test(q) ? sydneyLoc : GEO_MODE === "hit" ? { placeId: `ChIJ_FAKE_${q}`, country: "Japan", city: q, region: "", lat: 35, lng: 135, formattedName: q, displayLabel: q } : null;
  if (!loc) return { location: null, error: null, providerResult: { ok: false, status: "ZERO_RESULTS", provider: "geocode", rawResultCount: 0, parsedResultCount: 0, failureReason: "geocode_zero_results", query: q } };
  return { location: loc, error: null, providerResult: { ok: true, status: "OK", provider: "geocode", rawResultCount: 1, parsedResultCount: 1, latitude: loc.lat, longitude: loc.lng, query: q } };
};
const placesLog = [];
const searchPlaces = async ({ data }) => {
  placesLog.push(String(data?.query ?? ""));
  const type = data?.intentCategory === "cafe" ? "cafe" : data?.intentCategory === "restaurant" ? "restaurant" : data?.intentCategory === "shopping" || /購物|商場|百貨|商店街|地下街|市場|mall|shopping/i.test(String(data?.query)) ? "shopping_mall" : /museum|博物|美術|박물/i.test(String(data?.query)) ? "museum" : "tourist_attraction";
  const places = (argv.includes("--many") ? [1, 2, 3, 4, 5, 6] : [1, 2, 3]).map((i) => ({ id: `pid-${type}-${i}`, googlePlaceId: `pid-${type}-${i}`, name: `Sydney ${type} ${i}`, address: `${i} George St, Sydney NSW 2000, Australia`,
    lat: D.lat + i / 1000, lng: D.lng + i / 1000, rating: 4.5, userRatingCount: 800, photoName: null, primaryType: type, types: [type, "point_of_interest"], businessStatus: "OPERATIONAL",
    openStatus: "unknown", openStatusLabel: "", todayHoursLabel: "", closingSoonNote: "", nextOpenHint: "" }));
  return { places, error: null, rawCount: places.length };
};
const pool = () => D.places.map((name, i) => ({ id: `ChIJAUP${i}`, name, sourceLocale: "en", lat: D.lat + i * 0.0003, lng: D.lng, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.6, userRatingCount: 10000, address: "Sydney NSW, Australia", businessStatus: "OPERATIONAL" }));
const clone = (v) => JSON.parse(JSON.stringify(v));
const fresh = () => { discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache(); };
const ensure = async (ctx, session, locale) => {
  const days = ctx.days ?? session.tripDays;
  if (!ctx.destination || !days) return;
  await discovery.ensureDestinationCombinationsReady({ destination: ctx.destination, destinationCountry: ctx.destinationCountryCode ?? ctx.destinationCountry, locale, days,
    resolvedDestination: ctx.destinationCoordinates ? { label: ctx.destination, city: ctx.destinationCity ?? ctx.destination, country: ctx.destinationCountryCode ?? ctx.destinationCountry, countryCode: ctx.destinationCountryCode,
      type: ctx.destinationType ?? "city", latitude: ctx.destinationCoordinates.lat, longitude: ctx.destinationCoordinates.lng, placeId: session.tripDestination?.placeId, source: "trip_destination", scopeLocked: false } : undefined,
    searchPlaces: async () => ({ places: D.match.test(ctx.destination) ? pool() : [], error: null }) }).catch(() => null);
};
async function turn(s0, t, locale) {
  const partial = partialApi.isCombinationChoiceTurn(s0) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply?.(t));
  let n = partial ? clone(s0) : tripIntent.applyTripIntentToSession(t, clone(s0));
  n = convState.prepareSessionForUserTurn(n, s0.lastAssistantReply);
  if (planningState.isReplanIntent(t) && !partial) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const m = travelContext.mergeTravelContext(n, t, s0.lastAssistantReply);
  let s = m.session; let ctx = m.context;
  if (ctx.destinationCandidate?.status === "pending") { s = await globalPlanning.resolveGlobalPlanningCandidate(s, locale, geocodeRaw); ctx = s.travelContext ?? ctx; }
  await ensure(ctx, s, locale);
  const r = stateMachine.processAdviceTurn(t, s, ctx, undefined, locale);
  return { s: advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply }, r.advice), advice: r.advice };
}

/** 6553..6881 pushDestinationCategoryPlaceRecommendation (pure parts), with the App's userText for the resolution. */
async function categoryPush({ activeSession, t, locale, path, resolutionText, turnDestination12487 }) {
  const g0 = geocodeLog.length; const p0 = placesLog.length;
  const merged = travelContext.mergeTravelContext(activeSession, t);
  const placeCtx = mustVisit.mergeContextForPlaceFetch(merged.context, activeSession);
  const intents = placeIntent.parseChatPlaceIntents(t);
  const done = (o) => ({ ...o, geo: geocodeLog.slice(g0), places: placesLog.slice(p0), intents });
  if (!intents.length) return done({ outcome: "push=false (no intents) → caller fallback", reply: null });
  const td0 = path === "12603" ? turnDestination12487 : turnDestMod.resolveCategoryTurnDestination({ ctx: placeCtx, session: merged.session, userText: resolutionText, locale });
  const td = await turnDestMod.validateCategoryTurnDestination(td0, { locale, geocodeFn });
  const plan = turnDestMod.planCategoryTurnClarification(td);
  if (plan) {
    const label = plan.kind === "parent_city_scope" ? plan.confirmedParentCity : plan.clarificationLabel;
    return done({ outcome: `clarification ${plan.kind}`, reply: copy(plan.kind === "parent_city_scope" ? "parentScopeConfirm" : "whichRegion", locale, { destination: label }), clarification: true });
  }
  const searchDest = td.destination ?? (await turnDestMod.resolveTrustedContextTurnDestination({ ctx: placeCtx, session: merged.session, userText: t, locale, geocodeFn }));
  const noResults = () => copy("noResults", locale, { destination: path === "12603" ? (turnDestination12487?.destination ?? "") : "" });
  if (!searchDest) return done({ outcome: "push=false (no search destination) → noResults", reply: path === "12603" ? noResults() : null });
  const scope = await turnDestMod.resolveTrustedRecommendationSearchScope({ label: searchDest, ctx: placeCtx, session: merged.session, locale, geocodeFn });
  if (scope.status !== "trusted") return done({ outcome: `push=false (scope ${scope.reason}) → noResults`, reply: path === "12603" ? noResults() : null, searchDest });
  const built = await builder.buildDestinationCategoryRecommendations({ destination: scope.destination, intents, userText: t, context: { ...placeCtx, destination: scope.destination }, locale,
    searchPlaces, geocodeFn, excludePlaceIds: [], rejectedPlaceNames: [], session: activeSession, userProfile: null, trustedCenter: scope.center });
  if (!built.recommendations.length) return done({ outcome: "push=false (0 recommendations) → noResults", reply: path === "12603" ? noResults() : null, searchDest: scope.destination });
  const keptPending = activeSession.pendingQuestion?.type === "combination_choice" ? activeSession.pendingQuestion : undefined;
  // 6851: shopping or > DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE (3) → alignedSummary (destinationPlaces copy + uiT heading);
  // otherwise the builder summary below is the message text.
  const viaAligned = intents[0] === "shopping" || built.recommendations.length > 3;
  return done({ outcome: `category places (${intents[0]}) in ${scope.destination} [${built.recommendations.length} recs → ${viaAligned ? "alignedSummary" : "builder summary"}]`,
    reply: viaAligned ? `${copy("destinationPlaces", locale, { destination: scope.destination })} … (uiT heading + list)` : built.summary, searchDest: scope.destination, recs: built.recommendations.map((r) => r.name),
    nextSession: { ...merged.session, pendingQuestion: keptPending } });
}

/** Send chain after the switch gate (see verify-l8-museum-route-chain.mjs) → the user's final text. */
async function appTurn(s0, t, locale) {
  const msgs = [{ role: "user", content: "step1" }, { role: "assistant", content: s0.lastAssistantReply ?? "" }];
  const g0 = geocodeLog.length;
  const partial = partialApi.isCombinationChoiceTurn(s0) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply?.(t));
  let n = partial ? clone(s0) : tripIntent.applyTripIntentToSession(t, clone(s0));
  n = convState.prepareSessionForUserTurn(n, s0.lastAssistantReply);
  if (planningState.isReplanIntent(t) && !partial) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const merged = travelContext.mergeTravelContext(n, t, s0.lastAssistantReply);
  n = merged.session;
  if (merged.context.destinationCandidate?.status === "pending") { n = await globalPlanning.resolveGlobalPlanningCandidate(n, locale, geocodeRaw); merged.context = n.travelContext ?? merged.context; }
  const base = () => ({ reset: n.planningSessionId !== s0.planningSessionId, candidate: merged.context.destinationCandidate?.raw ?? null, clar: merged.context.destinationClarification ?? null });
  if (merged.context.destinationClarification || (merged.context.destinationCandidate && merged.context.destinationCandidate.status !== "resolved")) {
    const r = stateMachine.processAdviceTurn(t, n, merged.context, undefined, locale);
    return { branch: "11590 candidate advice", reply: r.advice.reply ?? "", pending: r.route?.pendingQuestion?.type ?? null, geo: geocodeLog.slice(g0), dest: merged.context.destination, ...base() };
  }
  if (partial) { const r = stateMachine.processAdviceTurn(t, n, merged.context, undefined, locale); return { branch: "11612 partial modify", reply: r.advice.reply ?? "", pending: r.route?.pendingQuestion?.type ?? null, geo: geocodeLog.slice(g0), dest: merged.context.destination, ...base() }; }
  if (budget.isBudgetRefinementText(t)) n = budget.applyBudgetRefinementToSession(t, { ...n, travelContext: merged.context });
  n = tpc.mergeTripPlanningContext(t, n, merged.context).session;
  n = sessionMod.extractPlanningHintsFromText(t, n);
  n = sessionMod.extractDiscoveryFromText(t, n);
  n = planningFlow.extractChatPlanningContextFromText(t, n);
  const destCandidate = merged.context.destination?.trim() || n.tripDestination?.displayLabel?.trim() || n.tripDestination?.city?.trim();
  let delta = constraints.parsePlanningConstraintDelta({ text: t, shownCandidates: [], authoritativeDestination: n.travelContext?.destination ?? merged.context.destination ?? destCandidate });
  delta = constraints.disambiguatePlanningDestinationEntity({ delta, destination: destCandidate });
  const req = constraints.resolvePlanningContextRequirement({ text: t, delta, candidateCount: 0, destinationDetected: Boolean(destCandidate), durationOrDateDetected: Boolean(merged.context.days || merged.context.startDate || merged.context.endDate) });
  const stop = (branch) => ({ branch, reply: null, geo: geocodeLog.slice(g0), dest: merged.context.destination, ...base() });
  if (req.requiresCandidateContext) return { ...stop("11843 missing candidate context"), reply: prodUi.productionUiMessages?.[locale]?.p0bde867c73 ?? "(p0bde867c73)" };
  n = constraints.applyPlanningConstraintDelta(n, delta, []);
  if (planningState.isStyleReselectTurn(t, n, merged.context)) return stop("11877 style reselect");
  if (planningState.shouldTriggerTripStylePlanning(t, n, merged.context) && (n.pendingQuestion?.type === "ask_trip_style" || n.chatPlanningState === "waitingStyleSelection")) return stop("11904 style planning");
  if (addAll.isAddAllToTripIntent(t) || delta.acceptRemainingCandidates === true) return stop("11929 add-all");
  if (refresh.shouldAcceptAlternativeRecommendations(msgs, t)) return stop("12011 alternative");
  if (refresh.shouldRefetchPlaces(t, n, merged.context, msgs)) return stop("12111 refetch");
  const pc = mustVisit.mergeContextForPlaceFetch(n.travelContext ?? merged.context, n);
  const appText = tpc.categorySwitchSearchText(t) ? "" : t;
  const td12487 = (text) => turnDestMod.resolveCategoryTurnDestination({ ctx: pc, session: n, userText: text, locale });
  if (mustVisit.shouldFetchDestinationPlaces(t, pc, n)) return stop("12523 destination places");
  const cat = placeIntent.shouldFetchDestinationCategoryPlaces(t, pc, n);
  const auth = nearbyClar.resolveChatRouteAuthority({ structuredShortcut: false, explicitNearbyRequest: chatIntent.userExplicitlyWantsNearbyPlaces(t), pendingNearbyLocationRequest: Boolean(n.pendingNearbyLocationRequest), resolvedNearbyIntent: chatIntent.inferNearbyIntentFromContext(pc, t, n) ?? null, categoryPlaceQuery: cat });
  if (auth === "destination_category") {
    const activeSession = { ...n, travelContext: pc };
    const res = {};
    for (const [key, text] of [["now", appText], ["headInput", t]]) {
      const td = td12487(text);
      res[key] = {
        turnDest: td.destination ?? null,
        turnClar: (() => { const p = turnDestMod.planCategoryTurnClarification(td); return p ? `${p.kind}:${p.clarificationLabel ?? p.confirmedParentCity}` : null; })(),
        p12603: await categoryPush({ activeSession, t, locale, path: "12603", resolutionText: text, turnDestination12487: td }),
        p6584: await categoryPush({ activeSession: n, t, locale, path: "6584", resolutionText: text }),
      };
    }
    return { branch: "12574 destination category", appText, ...res.now, reply: res.now.p12603.reply, headInput: res.headInput, geo: geocodeLog.slice(g0), dest: merged.context.destination, nextSession: res.now.p12603.nextSession, ...base() };
  }
  if (arbitrate.shouldSkipTripPlanningForRefinement(t, n)) return stop("12629 refinement");
  const planning = (turnEngine.isPlanningTurnActive(n, merged.context) || convState.isDestinationPlanningSession(n, merged.context))
    && !mustVisit.shouldFetchDestinationPlaces(t, pc, n) && !cat
    && !(catTypes.hasCategoryPlaceQuery(t) && !tpc.coerceTravelDestination(catDest.resolveDestinationForCategorySearch(pc, n, t)));
  if (!planning) return stop("13156+ later dispatch");
  const planningCtx = n.travelContext ?? merged.context;
  await ensure(planningCtx, n, locale);
  const r = stateMachine.processAdviceTurn(t, n, planningCtx, undefined, locale);
  const pending = r.advice.pendingQuestion ?? r.route?.pendingQuestion;
  if (r.advice.reply) return { branch: "12997 planning advice", reply: r.advice.reply, pending: pending?.type ?? null, geo: geocodeLog.slice(g0), dest: planningCtx.destination, ...base(),
    nextSession: advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: pending, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply }, r.advice) };
  const ack = durationGuard.buildDestinationDirectionAck({ destination: planningCtx.destination, tripDays: planningCtx.days ?? n.tripDays, startDate: planningCtx.startDate, endDate: planningCtx.endDate, locale });
  return { branch: "13112 last-resort discovery-failure copy", reply: [ack, "", prodUi.productionUiMessages?.[locale]?.p7fe9e2ed49 ?? "(p7fe9e2ed49)"].join("\n"), pending: "ask_preference", geo: geocodeLog.slice(g0), dest: planningCtx.destination, ...base() };
}

const STEP1 = { "zh-TW": "12/10-12/14 我要去雪梨", en: "12/10-12/14 I'm going to sydney", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행" };
const koRo = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c % 28 !== 0 && c % 28 !== 8 ? `${w}으로` : `${w}로`; };
const WORDS = { "zh-TW": ["博物館", "溫泉", "夜市", "咖啡廳"], en: ["museum", "onsen", "night market", "cafe"], ja: ["博物館", "温泉", "夜市", "カフェ"], ko: ["박물관", "온천", "야시장", "카페"] };
const FORMS = {
  "zh-TW": (w) => [`改去${w}`, `不去海邊了，改去${w}`],
  en: (w) => [`switch to ${w}`, `instead of the beach, ${w}`],
  ja: (w) => [`${w}に変更`, `海じゃなくて${w}に変更`],
  ko: (w) => [`${koRo(w)} 바꿔`, `바다 말고 ${koRo(w)} 바꿔`],
};
// Supported by the App's category recommendation (spec 1-3): must search the current destination.
// ja / ko category words outside the App's category detection are accepted by the assigner (M2 ruling).
const SUPPORTED = { "zh-TW": /博物館|咖啡廳|購物|美食|夜市/, en: /museum|cafe|shopping/, ja: /博物館/, ko: /^$/ };
// Same tree, ordinary category requests (no switch wording): recorded to tell new vs pre-existing copy.
const CONTROL = { "zh-TW": ["雪梨博物館推薦", "雪梨咖啡廳推薦"], en: ["museums in Sydney", "cafes in Sydney"], ja: ["シドニーの博物館", "シドニーのカフェ"], ko: ["시드니 박물관 추천", "시드니 카페 추천"] };
const EXTRA = { "zh-TW": ["不去海邊了，改去購物", "改去購物", "不去海邊了，改去美食"], en: ["switch to shopping", "switch to coffee shops"], ja: [], ko: [] };

const failures = [];
const check = async (name, fn) => { try { await fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 8).join("\n  ")}`); } };
const BAD = (locale) => [
  /預計去.*玩幾天|請確認目的地的城市與國家|哪個地區的改去|暫時無法取得足夠的實際地點組合/,
  new RegExp((prodUi.productionUiMessages?.[locale]?.p7fe9e2ed49 ?? "@@none@@").slice(0, 18).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
];
const shortReply = (s) => JSON.stringify((s ?? "").replace(/\n+/g, " ⏎ ").slice(0, 230));

out(`INFO geocode fixture mode: ${GEO_MODE}`);
for (const locale of ["zh-TW", "en", "ja", "ko"]) {
  fresh();
  const s1 = (await turn(sessionMod.createEmptySession(), STEP1[locale], locale)).s;
  const comboTitles = (s1.pendingQuestion?.options ?? s1.pendingQuestion?.combinations ?? []).map((o) => o.title ?? o.label ?? o).slice(0, 6);
  assert.equal(s1.pendingQuestion?.type, "combination_choice", `[${locale}] STEP1 did not list combinations`);
  const texts = [...WORDS[locale].flatMap((w) => FORMS[locale](w).map((t) => ({ t, w }))), ...EXTRA[locale].map((t) => ({ t, w: t.replace(/^.*?(購物|美食|shopping|coffee shops)$/, "$1") }))];
  for (const [stage, s0] of [["combination_choice", s1], ["general", { ...clone(s1), pendingQuestion: undefined }]]) {
    for (const { t, w } of texts) {
      fresh();
      const cls = tpc.classifyDestinationSwitchTurn(t);
      if (cls.state !== "NO_SWITCH") {
        out(`ROW [${locale}|${stage}] 「${t}」 → route gate ${cls.state} target=${cls.targetLabel ?? "-"}`);
        await check(`[${locale}|${stage}] 「${t}」 is not a confirmed destination switch`, () => assert.notEqual(cls.state, "CONFIRMED_SWITCH"));
        continue;
      }
      const r = await appTurn(s0, t, locale);
      const head = r.headInput ? `\n  HEAD-input(raw userText): turnDest=${r.headInput.turnDest ?? "-"} turnClar=${r.headInput.turnClar ?? "-"} | 12603: ${r.headInput.p12603.outcome} reply=${shortReply(r.headInput.p12603.reply)} geo=${JSON.stringify(r.headInput.p12603.geo)}` : "";
      out(`ROW [${locale}|${stage}] 「${t}」 → ${r.branch}${r.appText !== undefined ? ` appText=${JSON.stringify(r.appText)} turnDest=${r.turnDest ?? "-"} turnClar=${r.turnClar ?? "-"}` : ""} dest=${r.dest ?? "-"} pending=${r.pending ?? r.nextSession?.pendingQuestion?.type ?? "-"} reset=${r.reset} geo=${JSON.stringify(r.geo)}`
        + (r.p12603 ? `\n  12603: ${r.p12603.outcome} places=${JSON.stringify(r.p12603.places)} geo=${JSON.stringify(r.p12603.geo)}\n  6584 : ${r.p6584.outcome} places=${JSON.stringify(r.p6584.places)}` : "")
        + `\n  USER SEES: ${shortReply(r.reply)}` + head);
      await check(`[${locale}|${stage}] 「${t}」: no reset, destination kept, ${w} not geocoded, reply meaningful`, () => {
        const info = `\n  branch=${r.branch} reply=${shortReply(r.reply)} geo=${JSON.stringify(r.geo)} dest=${r.dest}`;
        assert.equal(r.reset, false, `planning session reset${info}`);
        assert.ok(D.match.test(r.dest ?? ""), `destination changed${info}`);
        assert.ok(!r.candidate || !String(r.candidate).toLowerCase().includes(w.toLowerCase()), `category became a destination candidate${info}`);
        assert.deepEqual(r.geo.filter((q) => q.toLowerCase().includes(w.toLowerCase()) || /改去|switch|変更|바꿔|海邊|beach|바다|海じゃ/.test(q)), [], `geocoded category / switch wording${info}`);
        assert.ok((r.reply ?? "").trim(), `empty reply${info}`);
        for (const re of BAD(locale)) assert.ok(!re.test(r.reply), `misleading / failure copy ${re}${info}`);
        assert.ok(!/last-resort/.test(r.branch), `last-resort copy${info}`);
        if (r.p12603) {
          assert.equal(r.turnClar, null, `App 12487 turn destination asks a clarification${info}`);
          assert.ok(D.match.test(r.turnDest ?? ""), `App 12487 turnDest=${r.turnDest} (expected current destination)${info}`);
          for (const p of [r.p12603, r.p6584]) {
            assert.ok(!p.clarification, `push asks clarification: ${p.reply}${info}`);
            assert.ok(/category places/.test(p.outcome), `push did not search: ${p.outcome}${info}`);
            // Places spy sees only uncached queries (the provider result cache is module-wide).
            assert.ok(p.places.every((q) => !/改去|不去|switch|instead|海邊|beach|変更|바꿔|말고|바다|海じゃ/i.test(q)), `Places queries carry switch / negated wording ${JSON.stringify(p.places)}${info}`);
          }
        }
        if (stage === "combination_choice") assert.equal((r.pending ?? r.nextSession?.pendingQuestion?.type) ?? null, "combination_choice", `combination_choice pending lost${info}`);
        if (SUPPORTED[locale].test(w)) assert.equal(r.branch, "12574 destination category", `supported category not searched in the current destination${info}`);
      });
      if (stage === "combination_choice" && r.nextSession?.pendingQuestion?.type === "combination_choice") {
        fresh();
        const pick = await turn({ ...r.nextSession, lastAssistantReply: r.reply }, "1", locale);
        await check(`[${locale}|combination_choice] 「${t}」 then 「1」 still selects a combination`, () =>
          assert.ok(pick.advice.triggerItineraryGeneration, `「1」 did not generate: ${shortReply(pick.advice.reply)}`));
      }
    }
  }
  for (const t of CONTROL[locale]) {
    fresh();
    const r = await appTurn({ ...clone(s1), pendingQuestion: undefined }, t, locale);
    out(`CONTROL [${locale}|general] 「${t}」 → ${r.branch} ${r.p12603 ? r.p12603.outcome : ""} places=${JSON.stringify(r.p12603?.places ?? [])}\n  USER SEES: ${shortReply(r.reply)}`);
  }
  if (VERBOSE) out(`INFO [${locale}] combos ${JSON.stringify(comboTitles)}`);
}
await check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
await new Promise(() => {});
