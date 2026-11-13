/**
 * M5 (tester, independent) — combination-choice destination switch to a destination that needs a
 * geocode (熱海 / Atami / 해운대 / 草津温泉 / 別府) plus the local one (京都), four locales, through the
 * route's send chain after the switch gate (same reconstruction as verify-l8-museum-route-chain:
 * tripIntent → prepare → [CONFIRMED_SWITCH wrapper + second-reset guards] → mergeTravelContext →
 * resolveGlobalPlanningCandidate → candidate branch / partial / mergeTripPlanningContext … planning
 * branch → processAdviceTurn → last-resort copy when advice is empty (13037..13153)).
 *
 * Asserted (spec A):
 *   hit : one reset, dates / days / provenance kept, combinations re-listed for the new destination,
 *         geocode = 1 call, then 「1」 behaves like 「1」 on the original trip (no date question).
 *   miss: the confirm question stays, no reset, dates kept; re-typing the name then switches by the
 *         same rule (one reset, dates kept, combinations), and 「1」 does not ask for dates.
 *   wouldMergeTravelContextResetTrip prediction vs the real merge (risk e).
 * Recorded against HEAD (`-- --head-dir=<snapshot>`): country-level combination choice + a city
 * name (risk a), 「熱海, 日本」 confirmation (risk c), empty-pool switch reply (risk b).
 * fetch is stubbed (must stay 0); geocode / Places are fixtures.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=500 scripts/verify-m5-combination-geocode-switch.mjs -- --head-dir=<snapshot>
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const TRACE = argv.filter((a) => a.startsWith("--trace=")).map((a) => a.slice(8));
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 420_000).unref();
let fetchCalls = 0;
globalThis.fetch = async (...a) => { fetchCalls++; throw new Error("NO_NETWORK " + String(a[0])); };
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const opt = async (p) => (existsSync(p) ? load(p) : null);
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
const partialApi = await opt("src/lib/ai/combination-partial-modify-reply.ts");
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
const durationGuard = await load("src/lib/ai/trip-duration-guard.ts");
const prodUi = await load("src/lib/i18n/production-ui.ts");
const scopeMod = await load("src/lib/ai/destination-scope.ts");
const copyMod = await load("src/lib/chat-runtime-copy.ts");
const pdd = await load("src/lib/ai/pending-duration-discovery.ts");
const cityDays = await load("src/lib/ai/city-days-planning.ts");

// ------------------------------------------------------------------ fixtures
const GEO = {
  sydney: { re: /sydney|雪梨|シドニー|시드니/i, city: "Sydney", region: "New South Wales", country: "Australia", code: "AU", lat: -33.8688, lng: 151.2093 },
  kyoto: { re: /kyoto|京都|교토/i, city: "Kyoto", region: "Kyoto", country: "Japan", code: "JP", lat: 35.0116, lng: 135.7681 },
  atami: { re: /atami|熱海|热海|아타미/i, city: "Atami", region: "Shizuoka", country: "Japan", code: "JP", lat: 35.0959, lng: 139.0717 },
  beppu: { re: /beppu|別府|别府|벳푸/i, city: "Beppu", region: "Oita", country: "Japan", code: "JP", lat: 33.2846, lng: 131.4914 },
  kusatsu: { re: /kusatsu|草津|구사쓰/i, city: "Kusatsu", region: "Gunma", country: "Japan", code: "JP", lat: 36.6206, lng: 138.5961 },
  haeundae: { re: /haeundae|해운대|海雲台|海雲臺|海云台/i, city: "Haeundae-gu", region: "Busan", country: "South Korea", code: "KR", lat: 35.1631, lng: 129.1635 },
  tokyo: { re: /tokyo|東京|도쿄/i, city: "Tokyo", region: "Tokyo", country: "Japan", code: "JP", lat: 35.6762, lng: 139.6503 },
};
// Localized geocode labels (Google geocode in the App language), e.g. 熱海市 for zh-TW / ja.
const LOCAL = { sydney: ["Sydney", "雪梨", "シドニー", "시드니"], kyoto: ["Kyoto", "京都市", "京都市", "교토시"], atami: ["Atami", "熱海市", "熱海市", "아타미시"],
  beppu: ["Beppu", "別府市", "別府市", "벳푸시"], kusatsu: ["Kusatsu", "草津町", "草津町", "구사쓰"], haeundae: ["Haeundae-gu", "海雲臺區", "海雲台区", "해운대구"], tokyo: ["Tokyo", "東京", "東京都", "도쿄"] };
let curLocale = "en";
const localCity = (k) => LOCAL[k][["en", "zh-TW", "ja", "ko"].indexOf(curLocale)] ?? GEO[k].city;
const keyOf = (q) => Object.keys(GEO).find((k) => GEO[k].re.test(q ?? ""));
let geoMode = "hit"; // hit | miss (everything but Sydney → 0 results)
let poolMode = "full"; // full | empty (no places outside Sydney / Japan country)
const geocodeLog = [];
const geocode = async (q) => {
  geocodeLog.push(q);
  const k = keyOf(q);
  if (!k || (geoMode === "miss" && k !== "sydney")) return { rawResultCount: 0, location: null };
  const d = GEO[k];
  return { rawResultCount: 1, location: { placeId: `ChIJ_${d.code}_${d.city}`, country: countryNorm.normalizeCountryReference(d.country, d.code).country || d.country,
    city: localCity(k), region: d.region, lat: d.lat, lng: d.lng, formattedName: localCity(k), displayLabel: localCity(k) } };
};
const poolFor = (dest) => {
  const k = keyOf(dest) ?? (/japan|日本|일본/i.test(dest ?? "") ? "tokyo" : undefined);
  if (!k) return [];
  if (poolMode === "empty" && k !== "sydney") return [];
  const d = GEO[k];
  return Array.from({ length: 18 }, (_, i) => ({ id: `ChIJ${d.code}${k}P${i}`, name: `${localCity(k)} ${["Shrine", "Temple", "Park", "Museum", "Garden", "Tower"][i % 6]} ${i + 1}`, sourceLocale: "en",
    lat: d.lat + i * 0.0003, lng: d.lng, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park",
    rating: 4.6, userRatingCount: 10000, address: `${localCity(k)}, ${d.country}`, businessStatus: "OPERATIONAL" }));
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const fresh = () => { discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache(); };
/** _app.chat.tsx prepareDestinationCombinations (1866..1968): guard → matchedCombinationScope → discovery with the App's geocodeFn. */
const discoveryGeocodeLog = [];
const discoveryGeocodeFn = async ({ data }) => { discoveryGeocodeLog.push(data.query); const r = await geocode(data.query); geocodeLog.pop(); return { location: r.location, error: null, providerResult: { rawResultCount: r.rawResultCount } }; };
const ensure = async (ctx, session, locale) => {
  const comboDest = ctx.destination?.trim() || session.tripPlanningContext?.destination?.trim() || session.tripDestination?.city?.trim();
  if (!comboDest) return;
  const durationFields = durationGuard.tripDurationFieldsFromContext ? durationGuard.tripDurationFieldsFromContext(ctx, session) : { days: ctx.days ?? session.tripDays };
  const days = durationGuard.resolveValidTripDays ? durationGuard.resolveValidTripDays(durationFields) : (ctx.days ?? session.tripDays);
  const guard = durationGuard.evaluateCombinationDiscoveryGuard({ destination: comboDest, destinationType: ctx.destinationType, destinationCountry: ctx.destinationCountry, destinationCity: ctx.destinationCity,
    destinationCountryCode: ctx.destinationCountryCode, destinationCoordinates: ctx.destinationCoordinates, destinationScopeId: ctx.destinationScopeId, ...durationFields, days, pendingQuestion: session.pendingQuestion, session });
  const rd = guard.resolvedDestination;
  lastGuard = `${guard.allowed}/${guard.reason ?? "-"}/${days}/scope=${rd?.label ?? "-"}:${rd?.countryCode ?? "-"}:${rd?.type ?? "-"}:${rd?.source ?? "-"}:${rd?.latitude ?? "-"} trip=${session.tripDestination?.city ?? "-"}/${session.tripDestination?.country ?? "-"} ctxCountry=${ctx.destinationCountry ?? "-"}`;
  if (!guard.allowed || days == null) return;
  const label = tpc.normalizeDestinationLabel(comboDest);
  if (scopeMod.isCountryLevelDestination(label, guard.resolvedDestination)) { lastGuard += " countryLevel"; return; }
  const cached = discovery.getCachedDiscoveredCombinations?.(label);
  if (cached && cached.length >= 3) { lastGuard += " cached"; return; }
  lastGuard += ` matched=${scopeMod.matchedCombinationScope(label, guard.resolvedDestination)?.label ?? "none"}`;
  await discovery.ensureDestinationCombinationsReady({ destination: label, resolvedDestination: scopeMod.matchedCombinationScope(label, guard.resolvedDestination), geocodeFn: discoveryGeocodeFn, locale, days,
    generationRequestId: `combo_${label}`, destinationCountry: ctx.destinationCountry ?? session.travelContext?.destinationCountry ?? session.tripDestination?.country,
    searchPlaces: async () => ({ places: poolFor(comboDest), error: null }) }).catch(() => null);
};
const finish = (r, lastReply) => advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply || lastReply }, r.advice);

/**
 * One user turn through the route chain. Returns the persisted session + an observable row.
 * resets = planningSessionId changes during the turn (wrapper + merge + resolve).
 */
async function routeTurn(s0, t, locale) {
  curLocale = locale;
  const g0 = geocodeLog.length;
  const dg0 = discoveryGeocodeLog.length;
  const sid0 = s0.planningSessionId;
  const cls = tpc.classifyDestinationSwitchTurn(t);
  let base = clone(s0);
  let verified = false;
  let resets = 0;
  if (cls.state === "CONFIRMED_SWITCH") {
    // Route wrapper: Authority geocode (1 call) of the target label, then applyConfirmedDestinationSwitch.
    const auth = await geocode(cls.targetLabel ?? t);
    if (!auth.location) return { s: s0, row: { branch: "wrapper authority miss", cls: cls.state, geo: geocodeLog.slice(g0), resets: 0 } };
    const res = travelContext.applyConfirmedDestinationSwitch(base, { label: cls.targetLabel ?? auth.location.city, requestText: t, resetAlreadyThisTurn: false });
    if (!res.applied) return { s: s0, row: { branch: `wrapper stop ${res.stop}`, cls: cls.state, geo: geocodeLog.slice(g0), resets: 0 } };
    if (res.session.planningSessionId !== base.planningSessionId) resets++;
    base = res.session; verified = true;
  } else if (cls.state !== "NO_SWITCH") {
    return { s: s0, row: { branch: `route gate ${cls.state}`, cls: cls.state, geo: geocodeLog.slice(g0), resets: 0 } };
  }
  const predicted = travelContext.wouldMergeTravelContextResetTrip(clone(base), t);
  const msgs = [{ role: "user", content: "prev" }, { role: "assistant", content: s0.lastAssistantReply ?? "" }];
  const partial = Boolean(partialApi && partialApi.isCombinationChoiceTurn(base) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply?.(t)));
  let n = partial ? clone(base) : tripIntent.applyTripIntentToSession(t, clone(base));
  n = convState.prepareSessionForUserTurn(n, s0.lastAssistantReply);
  if (planningState.isReplanIntent(t) && !partial) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  if (verified && travelContext.wouldMergeTravelContextResetTrip(n, t)) return { s: s0, row: { branch: "merge_second_reset_blocked (turn stopped)", cls: cls.state, geo: geocodeLog.slice(g0), resets } };
  const sidBeforeMerge = n.planningSessionId;
  const merged = travelContext.mergeTravelContext(n, t, s0.lastAssistantReply);
  n = merged.session;
  const mergeReset = n.planningSessionId !== sidBeforeMerge;
  if (mergeReset) resets++;
  let resolveReset = false;
  if (merged.context.destinationCandidate?.status === "pending") {
    const before = n.planningSessionId;
    n = await globalPlanning.resolveGlobalPlanningCandidate(n, locale, geocode);
    merged.context = n.travelContext ?? merged.context;
    resolveReset = n.planningSessionId !== before;
    if (resolveReset) resets++;
  }
  const common = () => ({ cls: cls.state, predicted, mergeReset, resolveReset, resets, sidChanged: n.planningSessionId !== sid0, geo: geocodeLog.slice(g0), dgeo: discoveryGeocodeLog.slice(dg0) });
  if (verified && travelContext.wouldMergeTravelContextResetTrip(n, t)) return { s: s0, row: { branch: "c3_downstream_reset (turn stopped)", ...common() } };
  const snap = (s, r, branch, reply, pending) => {
    const tc = s.travelContext ?? {};
    return { branch, ...common(), dest: tc.destination ?? null, days: tc.days ?? s.tripDays ?? null, start: tc.startDate ?? null, end: tc.endDate ?? null,
      month: tc.travelMonth ?? null, prov: tc.dateProvenance ? `${tc.dateProvenance.source}/${tc.dateProvenance.confirmed}` : null,
      cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null, clar: tc.destinationClarification ?? null,
      pending: pending ?? s.pendingQuestion?.type ?? null, base: s.pendingQuestion?.baseDestination ?? null, offered: (tc.offeredCombinations ?? []).length,
      opts: (s.pendingQuestion?.options ?? []).map((o) => String(o).slice(0, 12)), offeredDest: tc.offeredCombinations?.[0]?.destination ?? null, ctxCity: tc.destinationCity ?? null,
      selected: tc.selectedCombinationIds ?? null, sid: s.planningSessionId ?? null, gen: Boolean(r?.advice?.triggerItineraryGeneration || r?.advice?.generateItinerary || r?.advice?.itinerary),
      reply: (reply ?? "").replace(/\n/g, " / ").slice(0, 220) };
  };
  if (merged.context.destinationClarification || (merged.context.destinationCandidate && merged.context.destinationCandidate.status !== "resolved")) {
    const r = stateMachine.processAdviceTurn(t, n, merged.context, undefined, locale);
    const s = finish(r, s0.lastAssistantReply);
    return { s, row: snap(s, r, "11601 candidate advice", r.advice.reply) };
  }
  if (partial) { const r = stateMachine.processAdviceTurn(t, n, merged.context, undefined, locale); const s = finish(r, s0.lastAssistantReply); return { s, row: snap(s, r, "partial modify", r.advice.reply) }; }
  const trace = [];
  const tr = (step) => trace.push(`${step}:trip=${n.tripDestination?.city ?? "-"},type=${n.travelContext?.destinationType ?? "-"},dest=${n.travelContext?.destination ?? "-"},coords=${n.travelContext?.destinationCoordinates ? 1 : 0}`);
  tr("afterResolve");
  if (budget.isBudgetRefinementText(t)) n = budget.applyBudgetRefinementToSession(t, { ...n, travelContext: merged.context });
  n = tpc.mergeTripPlanningContext(t, n, merged.context).session; tr("mergeTripPlanningContext");
  n = sessionMod.extractPlanningHintsFromText(t, n); tr("extractPlanningHints");
  n = sessionMod.extractDiscoveryFromText(t, n); tr("extractDiscovery");
  n = planningFlow.extractChatPlanningContextFromText(t, n); tr("extractChatPlanningContext");
  if (TRACE.includes(t)) out(`TRACE [${locale}] 「${t}」 ${trace.join(" | ")}`);
  const destCandidate = merged.context.destination?.trim() || n.tripDestination?.displayLabel?.trim() || n.tripDestination?.city?.trim();
  let delta = constraints.parsePlanningConstraintDelta({ text: t, shownCandidates: [], authoritativeDestination: n.travelContext?.destination ?? merged.context.destination ?? destCandidate });
  delta = constraints.disambiguatePlanningDestinationEntity({ delta, destination: destCandidate });
  const req = constraints.resolvePlanningContextRequirement({ text: t, delta, candidateCount: 0, destinationDetected: Boolean(destCandidate), durationOrDateDetected: Boolean(merged.context.days || merged.context.startDate || merged.context.endDate) });
  if (req.requiresCandidateContext) return { s: n, row: snap(n, null, "missing candidate context clarification", prodUi.productionUiMessages?.[locale]?.p0bde867c73 ?? "(p0bde867c73)") };
  n = constraints.applyPlanningConstraintDelta(n, delta, []);
  if (planningState.isStyleReselectTurn(t, n, merged.context)) return { s: n, row: snap(n, null, "style reselect", "(style reselect)") };
  if (addAll.isAddAllToTripIntent(t) || delta.acceptRemainingCandidates === true) return { s: n, row: snap(n, null, "add-all", "(add-all)") };
  if (refresh.shouldAcceptAlternativeRecommendations(msgs, t)) return { s: n, row: snap(n, null, "alternative", "(alternative)") };
  if (refresh.shouldRefetchPlaces(t, n, merged.context, msgs)) return { s: n, row: snap(n, null, "refetch", "(refetch)") };
  const pc = mustVisit.mergeContextForPlaceFetch(n.travelContext ?? merged.context, n);
  if (mustVisit.shouldFetchDestinationPlaces(t, pc, n)) return { s: n, row: snap(n, null, "destination places", "(destination places)") };
  const cat = placeIntent.shouldFetchDestinationCategoryPlaces(t, pc, n);
  const auth = nearbyClar.resolveChatRouteAuthority({ structuredShortcut: false, explicitNearbyRequest: chatIntent.userExplicitlyWantsNearbyPlaces(t), pendingNearbyLocationRequest: Boolean(n.pendingNearbyLocationRequest), resolvedNearbyIntent: chatIntent.inferNearbyIntentFromContext(pc, t, n) ?? null, categoryPlaceQuery: cat });
  if (auth === "destination_category") return { s: n, row: snap(n, null, "destination category", "(category places)") };
  if (arbitrate.shouldSkipTripPlanningForRefinement(t, n)) return { s: n, row: snap(n, null, "refinement", "(refinement)") };
  const planning = (turnEngine.isPlanningTurnActive(n, merged.context) || convState.isDestinationPlanningSession(n, merged.context))
    && !mustVisit.shouldFetchDestinationPlaces(t, pc, n) && !cat
    && !(catTypes.hasCategoryPlaceQuery(t) && !tpc.coerceTravelDestination(catDest.resolveDestinationForCategorySearch(pc, n, t)));
  if (!planning) return { s: n, row: snap(n, null, "13156+ later dispatch", "(later dispatch)") };
  const planningCtx = n.travelContext ?? merged.context;
  // 12914..12990: answered-duration session, discovery guard, duration question.
  const discoverySession = pdd.sessionForAnsweredDurationDiscovery(t, n, planningCtx);
  const durationFields = durationGuard.tripDurationFieldsFromContext(planningCtx, n);
  const validDays = durationGuard.resolveValidTripDays(durationFields);
  const guardInput = { destination: planningCtx.destination, destinationType: planningCtx.destinationType, destinationCountry: planningCtx.destinationCountry, destinationCity: planningCtx.destinationCity,
    destinationCountryCode: planningCtx.destinationCountryCode, destinationCoordinates: planningCtx.destinationCoordinates, destinationScopeId: planningCtx.destinationScopeId,
    ...durationFields, days: validDays, pendingQuestion: discoverySession.pendingQuestion, session: discoverySession };
  const routeGuard = durationGuard.evaluateCombinationDiscoveryGuard(guardInput);
  const dateQuestion = (branch) => {
    const destLabel = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || "";
    const dateAsk = cityDays.buildDateAndDurationQuestionReply(destLabel || "這趟", planningCtx.destinationCountry ?? n.travelContext?.destinationCountry, { context: planningCtx, userText: t, blockedLegacyTemplate: branch, locale });
    const s = { ...n, pendingQuestion: dateAsk.pendingQuestion, travelContext: { ...planningCtx, destination: destLabel || planningCtx.destination, tripPurpose: "region_selected", conversationState: "awaiting_days", planningDaysConfirmed: false } };
    return { s, row: { ...snap(s, null, `${branch} date/duration question`, dateAsk.reply), guard: routeGuard.reason } };
  };
  if (!routeGuard.allowed && (routeGuard.reason === "missing_trip_duration" || routeGuard.reason === "pending_duration_question" || !durationGuard.hasValidTripDuration(durationFields))) {
    const destLabel = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || "";
    if (destLabel && !scopeMod.isCountryLevelDestination(destLabel)) return dateQuestion("12954");
  }
  if (durationGuard.canEnterCombinationDiscovery(guardInput)) await ensure(planningCtx, discoverySession, locale);
  const r = stateMachine.processAdviceTurn(t, n, planningCtx, undefined, locale);
  lastDisc = `route=${routeGuard.allowed}/${routeGuard.reason ?? "-"} ${lastGuard} ${JSON.stringify(discovery.getLastCombinationDiscoveryFailure?.() ?? null).slice(0, 200)}`;
  lastGuard = "-";
  const failureCopy = r.advice.reply && /暫時無法取得.*景點資料/.test(r.advice.reply) && !(r.advice.pendingQuestion?.type === "combination_choice" || r.advice.contextPatch?.tripPurpose === "combination_suggestions_offered");
  if (r.advice.reply && !failureCopy) { const s = finish(r, s0.lastAssistantReply); return { s, row: { ...snap(s, r, "13028 planning advice", r.advice.reply), disc: lastDisc } }; }
  if (!durationGuard.hasValidTripDuration({ days: durationGuard.resolveValidTripDays(durationGuard.tripDurationFieldsFromContext(planningCtx, n)), ...durationGuard.tripDurationFieldsFromContext(planningCtx, n) })) return dateQuestion("13058");
  const ack = durationGuard.buildDestinationDirectionAck({ destination: planningCtx.destination, tripDays: planningCtx.days ?? n.tripDays, startDate: planningCtx.startDate, endDate: planningCtx.endDate, locale });
  const failure = prodUi.productionUiMessages?.[locale]?.p7fe9e2ed49 ?? "(p7fe9e2ed49)";
  const s = { ...n, pendingQuestion: { type: "ask_preference", options: ["REFRESH"], baseDestination: planningCtx.destination } };
  return { s, row: { ...snap(s, r, "13037 empty advice → last-resort copy", [ack, "", failure].join("\n"), "ask_preference"), disc: lastDisc } };
}
let lastDisc = null;
let lastGuard = "-";
async function step1(t, locale) { fresh(); return (await routeTurn(sessionMod.createEmptySession(), t, locale)).s; }

const STEP1 = { "zh-TW": "12/10-12/14 我要去雪梨", en: "12/10-12/14 I'm going to sydney", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행" };
const STEP1_JP = { "zh-TW": "12/10-12/14 我要去日本", en: "12/10-12/14 I'm going to Japan", ja: "12/10-12/14 日本へ旅行", ko: "12/10-12/14 일본 여행" };
const SWITCH = {
  "zh-TW": [["改去熱海", "atami"], ["改去Atami", "atami"], ["改去海雲台", "haeundae"], ["改去草津溫泉", "kusatsu"], ["改去別府", "beppu"], ["改去京都", "kyoto"]],
  en: [["switch to Atami", "atami"], ["switch to Haeundae", "haeundae"], ["switch to Beppu", "beppu"], ["switch to Kyoto", "kyoto"]],
  ja: [["熱海に変更", "atami"], ["Atamiに変更", "atami"], ["草津温泉に変更", "kusatsu"], ["別府に変更", "beppu"], ["京都に変更", "kyoto"]],
  ko: [["해운대로 바꿔", "haeundae"], ["아타미로 바꿔", "atami"], ["벳푸로 바꿔", "beppu"], ["교토로 바꿔", "kyoto"]],
};
const RETYPE = { "zh-TW": [["改去熱海", "熱海"], ["改去別府", "別府"]], en: [["switch to Atami", "Atami"]], ja: [["熱海に変更", "熱海"], ["草津温泉に変更", "草津温泉"]], ko: [["해운대로 바꿔", "해운대"]] };
const RETYPE_CC = { "zh-TW": ["改去熱海", "熱海, 日本"], en: ["switch to Atami", "Atami, Japan"], ja: ["熱海に変更", "熱海, 日本"], ko: ["해운대로 바꿔", "해운대, 한국"] };
const COUNTRY_TURNS = {
  "zh-TW": ["京都", "熱海", "我要去京都", "改去京都", "改去熱海", "京都和大阪", "改去海雲台", "我要去海雲台", "海雲台"], en: ["Kyoto", "Atami", "switch to Kyoto", "switch to Atami", "switch to Haeundae", "Haeundae"],
  ja: ["京都", "熱海", "京都に変更", "熱海に変更", "京都に行きます", "海雲台に変更", "海雲台"], ko: ["교토", "아타미", "교토로 바꿔", "해운대로 바꿔", "해운대"],
};
// M8 spec 2 (approved): another country's city that needs a geocode, WITH switch wording, on a country-level
// trip (日本) = destination switch (one reset, dates kept, combinations re-listed). The bare name keeps HEAD.
const OTHER_COUNTRY_SWITCH = new Set(["改去海雲台", "我要去海雲台", "switch to Haeundae", "海雲台に変更", "해운대로 바꿔"]);
const OTHER_COUNTRY_BARE = new Set(["海雲台", "Haeundae", "해운대"]);
// [text, kind]: "categoryCopy" = new not-in-combinations copy (no switch, no reset); "switch" = switch to the named place.
const SPEC_C = {
  "zh-TW": [["改去溫泉", "categoryCopy"]], en: [["switch to hot springs", "categoryCopy"]],
  ja: [["海じゃなくて箱根に変更", "switch", /箱根/], ["温泉に変更", "categoryCopy"]], ko: [["온천으로 바꿔", "categoryCopy"]],
};
const FRESH = {
  "zh-TW": ["12/10-12/14 我要去海雲台", "12/10-12/14 我要去草津溫泉", "12/10-12/14 我要去Atami", "12/10-12/14 我要去別府", "12/10-12/14 我要去熱海"],
  en: ["12/10-12/14 I'm going to Haeundae", "12/10-12/14 I'm going to Beppu"], ja: ["12/10-12/14 別府へ旅行", "12/10-12/14 熱海へ旅行"], ko: ["12/10-12/14 해운대 여행"],
};
const CONFIRMED = { "zh-TW": ["不去雪梨了，改去熱海", "雪梨不去了，改去京都"], en: ["not sydney anymore, switch to Atami"], ja: ["シドニーはやめて、熱海に変更"], ko: ["시드니 말고 해운대로 바꿔"] };

async function runAll() {
  const R = {};
  R.labels = Object.fromEntries(["別府", "別府市", "草津町", "草津温泉", "草津溫泉", "海雲臺區", "海雲台", "熱海市", "熱海", "京都府", "Atami", "아타미시", "해운대구"].map((x) => [x, tpc.normalizeDestinationLabel(x)]));
  for (const locale of Object.keys(STEP1)) {
    geoMode = "hit"; poolMode = "full";
    const s1 = await step1(STEP1[locale], locale);
    R[`${locale}|STEP1`] = (await (async () => { const t = clone(s1); const tc = t.travelContext ?? {}; return { pending: t.pendingQuestion?.type ?? null, dest: tc.destination, days: tc.days, start: tc.startDate, end: tc.endDate, prov: tc.dateProvenance ? `${tc.dateProvenance.source}/${tc.dateProvenance.confirmed}` : null, sid: t.planningSessionId, offered: (tc.offeredCombinations ?? []).length }; })());
    /* same in-memory discovery cache as the App */ R[`${locale}|STEP1|1`] = (await routeTurn(s1, "1", locale)).row;
    for (const [t] of SWITCH[locale]) {
      fresh(); geoMode = "hit";
      const a = await routeTurn(s1, t, locale);
      R[`hit|${locale}|${t}`] = a.row;
      /* same in-memory discovery cache as the App */ R[`hit|${locale}|${t}|1`] = (await routeTurn(a.s, "1", locale)).row;
      // Re-merge of the same text on the switched session (applyLocalFallback / push* helpers).
      const re = travelContext.mergeTravelContext(clone(a.s), t, a.s.lastAssistantReply);
      R[`hit|${locale}|${t}|remerge`] = { sidChanged: re.session.planningSessionId !== a.s.planningSessionId, cand: re.context.destinationCandidate ? `${re.context.destinationCandidate.raw}/${re.context.destinationCandidate.status}` : null, dest: re.context.destination ?? null };
    }
    for (const [t, again] of RETYPE[locale]) {
      fresh(); geoMode = "miss";
      const a = await routeTurn(s1, t, locale);
      R[`miss|${locale}|${t}`] = a.row;
      fresh(); geoMode = "hit";
      const b = await routeTurn(a.s, again, locale);
      R[`miss|${locale}|${t}|${again}`] = b.row;
      /* same in-memory discovery cache as the App */ R[`miss|${locale}|${t}|${again}|1`] = (await routeTurn(b.s, "1", locale)).row;
    }
    {
      const [t, cc] = RETYPE_CC[locale];
      fresh(); geoMode = "miss";
      const a = await routeTurn(s1, t, locale);
      fresh(); geoMode = "hit";
      const b = await routeTurn(a.s, cc, locale);
      R[`cc|${locale}|${cc}`] = b.row;
      /* same in-memory discovery cache as the App */ R[`cc|${locale}|${cc}|1`] = (await routeTurn(b.s, "1", locale)).row;
    }
    for (const t of CONFIRMED[locale]) {
      fresh(); geoMode = "hit";
      const a = await routeTurn(s1, t, locale);
      R[`confirmed|${locale}|${t}`] = a.row;
      // Risk e: a verified (CONFIRMED_SWITCH) turn right after a geocode miss left a combinationSwitch candidate.
      fresh(); geoMode = "miss";
      const m = await routeTurn(s1, RETYPE[locale][0][0], locale);
      fresh(); geoMode = "hit";
      R[`confirmedAfterMiss|${locale}|${t}`] = (await routeTurn(m.s, t, locale)).row;
    }
    // Empty pool (risk b).
    for (const [t] of SWITCH[locale].filter(([, k]) => k === "beppu")) {
      fresh(); geoMode = "hit"; poolMode = "empty";
      const a = await routeTurn(s1, t, locale);
      R[`empty|${locale}|${t}`] = a.row;
      /* same in-memory discovery cache as the App */ R[`empty|${locale}|${t}|1`] = (await routeTurn(a.s, "1", locale)).row;
      poolMode = "full";
    }
    // Spec C items on the combination list.
    for (const t of SPEC_C[locale] ?? []) { fresh(); geoMode = "hit"; R[`specC|${locale}|${t[0]}`] = (await routeTurn(s1, t[0], locale)).row; }
    // Outside combination choice (ask_days after 「我要去雪梨」): switch wording keeps HEAD behaviour.
    {
      geoMode = "hit"; poolMode = "full";
      const a0 = await step1({ "zh-TW": "我要去雪梨", en: "I'm going to sydney", ja: "シドニーへ旅行", ko: "시드니 여행" }[locale], locale);
      R[`other|${locale}|STEP`] = { pending: a0.pendingQuestion?.type ?? null };
      for (const [t] of SWITCH[locale].slice(0, 2)) { fresh(); R[`other|${locale}|${t}`] = (await routeTurn(a0, t, locale)).row; }
    }
    // Baseline: the same geocoded destinations as a fresh trip (no switch), WORK vs HEAD.
    for (const t of FRESH[locale]) {
      geoMode = "hit"; poolMode = "full"; fresh();
      const a = await routeTurn(sessionMod.createEmptySession(), t, locale);
      R[`fresh|${locale}|${t}`] = a.row;
      R[`fresh|${locale}|${t}|1`] = (await routeTurn(a.s, "1", locale)).row;
      // M8 spec 3 at the resolver: a first-turn candidate carries no afterMiss and keeps the ask_days pending.
      const pm = travelContext.mergeTravelContext(sessionMod.createEmptySession(), t, undefined);
      const pc = pm.context.destinationCandidate;
      const pr = pc?.status === "pending" ? await globalPlanning.resolveGlobalPlanningCandidate(pm.session, locale, geocode) : null;
      geocodeLog.length = Math.max(0, geocodeLog.length - (pr ? 1 : 0));
      R[`freshpure|${locale}|${t}`] = { cand: pc ? `${pc.raw}/${pc.status}` : null, afterMiss: Boolean(pc?.afterMiss), pending: pr?.pendingQuestion?.type ?? null, status: pr?.travelContext?.destinationCandidate?.status ?? null };
    }
    // Country-level combination choice (risk a).
    geoMode = "hit"; poolMode = "full";
    const j1 = await step1(STEP1_JP[locale], locale);
    R[`jp|${locale}|STEP1`] = { pending: j1.pendingQuestion?.type ?? null, dest: j1.travelContext?.destination, type: j1.travelContext?.destinationType, days: j1.travelContext?.days, start: j1.travelContext?.startDate, offered: (j1.travelContext?.offeredCombinations ?? []).length, sid: j1.planningSessionId, reply: (j1.lastAssistantReply ?? "").replace(/\n/g, " / ").slice(0, 160) };
    for (const t of COUNTRY_TURNS[locale]) {
      fresh();
      const a = await routeTurn(j1, t, locale);
      R[`jp|${locale}|${t}`] = a.row;
      /* same in-memory discovery cache as the App */ R[`jp|${locale}|${t}|1`] = (await routeTurn(a.s, "1", locale)).row;
    }
    // Country-level session whose pending is combination_choice (front-end report: Japan combinations listed).
    const jc = { ...clone(j1), pendingQuestion: { type: "combination_choice", options: ["1", "2", "3"], baseDestination: j1.travelContext?.destination, destinationCountry: j1.travelContext?.destinationCountry } };
    for (const t of COUNTRY_TURNS[locale]) {
      fresh();
      const a = await routeTurn(jc, t, locale);
      R[`jpc|${locale}|${t}`] = a.row;
      /* same in-memory discovery cache as the App */ R[`jpc|${locale}|${t}|1`] = (await routeTurn(a.s, "1", locale)).row;
    }
  }
  return R;
}

if (CHILD) {
  const r = await runAll();
  // Large JSON over a pipe: exit only after stdout flushed.
  process.stdout.write(`@@M5_JSON@@${JSON.stringify(r)}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}

function headResults() {
  if (!headDir) return null;
  const self = "scripts/verify-m5-combination-geocode-switch.mjs";
  if (!existsSync(join(headDir, self)) || readFileSync(join(headDir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(headDir, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 400_000, maxBuffer: 64 << 20 });
  const m = (r.stdout ?? "").match(/@@M5_JSON@@([\s\S]*?)@@END@@/);
  if (!m) { out(`NOTE HEAD child produced no JSON (status ${r.status}): ${(r.stdout ?? "").slice(-400)} ${(r.stderr ?? "").slice(-600)}`); return null; }
  return JSON.parse(m[1]);
}

const W = await runAll();
const H = headResults();
out(`INFO normalizeDestinationLabel WORK ${JSON.stringify(W.labels)}${H ? `\nINFO normalizeDestinationLabel HEAD ${JSON.stringify(H.labels)}` : ""}`);
const failures = [];
const check = (name, fn) => { try { fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 8).join("\n  ")}`); } };
const j = (v) => JSON.stringify(v);
const DATE_ASK = /日期|幾號|哪幾天|什麼時候|出發日|when\b|which dates|travel dates|いつ|日程を|日付|날짜|언제|며칠/i;
const cityLabel = (k) => GEO[k].city;

for (const locale of Object.keys(STEP1)) {
  const s1 = W[`${locale}|STEP1`];
  const base1 = W[`${locale}|STEP1|1`];
  check(`[${locale}] STEP1 lists Sydney combinations 12/10-12/14`, () => {
    assert.equal(s1.pending, "combination_choice", j(s1)); assert.equal(s1.days, 5); assert.equal(s1.start, "2026-12-10"); assert.ok(s1.offered > 0);
  });
  for (const [t, k] of SWITCH[locale]) {
    const a = W[`hit|${locale}|${t}`]; const b = W[`hit|${locale}|${t}|1`];
    const info = `\n  switch=${j(a)}\n  then1=${j(b)}\n  baseline1=${j(base1)}`;
    check(`[${locale}] hit 「${t}」: one reset, dates/days/provenance kept, ${cityLabel(k)} combinations listed, geocode ≤ 1`, () => {
      assert.equal(a.resets, 1, `resets=${a.resets}${info}`);
      // Spec A: one geocode per switch (candidate resolve + combination discovery together); the local 京都 table needs none.
      const total = a.geo.length + (a.dgeo?.length ?? 0);
      if (k !== "kyoto") assert.equal(total, 1, `geocode calls resolve=${j(a.geo)} discovery=${j(a.dgeo)}${info}`);
      else assert.ok(total <= 1, `geocode calls resolve=${j(a.geo)} discovery=${j(a.dgeo)}${info}`);
      assert.ok(GEO[k].re.test(a.dest ?? "") || LOCAL[k].includes(a.dest), `dest ${a.dest}${info}`);
      assert.equal(a.start, s1.start, `start${info}`); assert.equal(a.end, s1.end, `end${info}`); assert.equal(a.days, s1.days, `days${info}`);
      assert.equal(a.prov, s1.prov, `provenance${info}`);
      assert.equal(a.pending, "combination_choice", `pending${info}`);
      assert.ok(a.offered > 0, `offered${info}`);
      assert.ok(!/Sydney|雪梨|シドニー|시드니/.test(a.reply), `reply still mentions Sydney${info}`);
    });
    check(`[${locale}] hit 「${t}」 → 「1」: same outcome as 「1」 on the original trip, no date question`, () => {
      assert.equal(b.resets, 0, `resets=${b.resets}${info}`);
      assert.equal(b.pending, base1.pending, `pending differs from baseline${info}`);
      assert.equal(b.gen, base1.gen, `generation flag differs from baseline${info}`);
      assert.equal(b.start, s1.start, `start${info}`); assert.equal(b.days, s1.days, `days${info}`);
      assert.ok(!/ask_days|date/.test(b.pending ?? ""), `pending ${b.pending}${info}`);
      if (!DATE_ASK.test(base1.reply)) assert.ok(!DATE_ASK.test(b.reply), `reply asks for dates${info}`);
    });
    const re = W[`hit|${locale}|${t}|remerge`];
    out(`INFO [${locale}] re-merge 「${t}」 on the switched session (fallback helpers): ${j(re)}`);
    check(`[${locale}] hit 「${t}」: re-merging the same text on the switched session does not reset`, () => assert.equal(re.sidChanged, false, j(re)));
  }
  for (const [t, again] of RETYPE[locale]) {
    const a = W[`miss|${locale}|${t}`]; const b = W[`miss|${locale}|${t}|${again}`]; const c = W[`miss|${locale}|${t}|${again}|1`];
    const info = `\n  miss=${j(a)}\n  retype=${j(b)}\n  then1=${j(c)}`;
    check(`[${locale}] miss 「${t}」: confirm question kept, no reset, dates kept, prediction matches`, () => {
      assert.equal(a.resets, 0, `resets${info}`);
      assert.equal(a.geo.length, 1, `geocode ${j(a.geo)}${info}`);
      assert.match(a.cand ?? "", /unresolved|conflict/, `candidate${info}`);
      assert.ok(a.reply.trim(), `empty reply${info}`);
      assert.equal(a.start, s1.start, `start${info}`); assert.equal(a.end, s1.end, `end${info}`); assert.equal(a.days, s1.days, `days${info}`);
    });
    check(`[${locale}] miss 「${t}」 → 「${again}」: switches by the same rule; 「1」 does not ask for dates`, () => {
      assert.equal(b.resets, 1, `resets${info}`);
      assert.equal(b.geo.length, 1, `geocode ${j(b.geo)}${info}`);
      assert.equal(b.start, s1.start, `start${info}`); assert.equal(b.end, s1.end, `end${info}`); assert.equal(b.days, s1.days, `days${info}`);
      assert.equal(b.prov, s1.prov, `provenance${info}`);
      assert.equal(b.pending, "combination_choice", `pending${info}`); assert.ok(b.offered > 0, `offered${info}`);
      assert.equal(c.resets, 0, `1 resets${info}`);
      assert.equal(c.pending, base1.pending, `1 pending vs baseline ${base1.pending}${info}`);
      assert.equal(c.gen, base1.gen, `1 generation vs baseline${info}`);
      assert.equal(c.start, s1.start, `1 start${info}`);
    });
  }
  // Risk e: the pure prediction must equal what the merge + resolve did.
  for (const key of Object.keys(W).filter((x) => /^(hit|miss)\|/.test(x) && x.split("|")[1] === locale && x.split("|").length === 3)) {
    const r = W[key];
    check(`[${locale}] risk e ${key}: wouldMergeTravelContextResetTrip=${r.predicted} vs merge+resolve resets=${(r.mergeReset ? 1 : 0) + (r.resolveReset ? 1 : 0)}`, () => {
      const actual = r.mergeReset || r.resolveReset;
      if (/^hit/.test(key)) assert.equal(r.predicted, actual, j(r));
      else assert.equal(actual, false, j(r)); // miss: predicted true, nothing reset (route only consults it on verified turns)
    });
  }
  for (const t of CONFIRMED[locale]) {
    const r = W[`confirmed|${locale}|${t}`];
    check(`[${locale}] CONFIRMED/route 「${t}」: one reset, not stopped by the second-reset guards, dates kept`, () => {
      assert.ok(!/stopped|stop|miss/.test(r.branch), j(r));
      assert.equal(r.resets, 1, j(r));
      if (r.start !== undefined) { assert.equal(r.start, s1.start, j(r)); assert.equal(r.days, s1.days, j(r)); }
    });
  }
  for (const t of CONFIRMED[locale]) {
    const r = W[`confirmedAfterMiss|${locale}|${t}`];
    out(`INFO [${locale}] risk e verified turn after a miss 「${RETYPE[locale][0][0]}」(miss) → 「${t}」 ${j({ branch: r.branch, cls: r.cls, resets: r.resets, dest: r.dest, start: r.start, pending: r.pending, cand: r.cand })}`);
    if (r.cls === "CONFIRMED_SWITCH") check(`[${locale}] risk e 「${t}」 after a geocode miss: the verified switch is not stopped by the second-reset guard`, () => {
      assert.ok(!/stopped/.test(r.branch), j(r));
      assert.equal(r.resets, 1, j(r));
    });
  }
  for (const [t] of SWITCH[locale].filter(([, k]) => k === "beppu")) {
    const a = W[`empty|${locale}|${t}`]; const b = W[`empty|${locale}|${t}|1`];
    out(`INFO [${locale}] empty pool 「${t}」 → ${a.branch} pending=${a.pending} reply=${j(a.reply)}\n     → 「1」 ${b.branch} pending=${b.pending} reply=${j(b.reply)}`);
    if (H?.[`empty|${locale}|${t}`]) out(`     HEAD 「${t}」 → ${H[`empty|${locale}|${t}`].branch} pending=${H[`empty|${locale}|${t}`].pending} reply=${j(H[`empty|${locale}|${t}`].reply)}\n     HEAD → 「1」 ${H[`empty|${locale}|${t}|1`]?.branch} reply=${j(H[`empty|${locale}|${t}|1`]?.reply)}`);
    check(`[${locale}] risk b empty pool 「${t}」 and its 「1」: the user sees a non-empty reply`, () => {
      assert.ok(a.reply.trim(), `empty reply ${j(a)}`);
      assert.ok(b.reply.trim() && !/^\(/.test(b.reply), `「1」 reply ${j(b)}`);
    });
  }
  {
    const cc = RETYPE_CC[locale][1]; const r = W[`cc|${locale}|${cc}`]; const r1 = W[`cc|${locale}|${cc}|1`]; const h = H?.[`cc|${locale}|${cc}`];
    out(`INFO [${locale}] risk c miss → 「${cc}」 WORK ${j(r)}\n     → 「1」 ${j(r1)}${h ? `\n     HEAD ${j(h)}` : ""}`);
  }
  for (const [t, kind, re] of SPEC_C[locale] ?? []) {
    const r = W[`specC|${locale}|${t}`];
    const notIn = copyMod.chatRuntimeCopy("combinationCategoryNotInCombinations", locale, { destination: "§", category: "¤" }).split(/[§¤]/).filter((s) => s.trim().length > 3);
    check(`[${locale}] spec C 「${t}」 ${kind}`, () => {
      if (kind === "switch") {
        assert.ok(re.test(r.dest ?? ""), j(r)); assert.equal(r.resets, 1, j(r)); assert.equal(r.start, s1.start, j(r)); assert.equal(r.days, s1.days, j(r));
      } else {
        assert.equal(r.resets, 0, j(r)); assert.equal(r.pending, "combination_choice", j(r));
        assert.ok(notIn.length && notIn.every((piece) => r.reply.includes(piece.trim().slice(0, 12))), `not the category-not-in-combinations copy: ${j(r.reply)}`);
      }
    });
  }
  for (const [t] of SWITCH[locale].slice(0, 2)) {
    const w = W[`other|${locale}|${t}`]; const h = H?.[`other|${locale}|${t}`];
    const pk = (x) => x && { branch: x.branch, resets: x.resets, dest: x.dest, days: x.days, start: x.start, pending: x.pending, cand: x.cand, geo: x.geo, reply: (x.reply ?? "").replace(/’/g, "'") };
    if (h) check(`[${locale}] outside combination choice (${W[`other|${locale}|STEP`].pending}) 「${t}」 behaves as HEAD`, () => assert.deepEqual(pk(w), pk(h), `WORK ${j(pk(w))}\n  HEAD ${j(pk(h))}`));
  }
  for (const t of FRESH[locale]) {
    const pk = (x) => x && { branch: x.branch, dest: x.dest, pending: x.pending, offered: x.offered, gen: x.gen, reply: (x.reply ?? "").slice(0, 80), disc: (x.disc ?? "").slice(0, 70) };
    out(`ROW fresh [${locale}] 「${t}」\n     WORK ${j(pk(W[`fresh|${locale}|${t}`]))}\n     HEAD ${j(pk(H?.[`fresh|${locale}|${t}`]))}\n     WORK→1 ${j(pk(W[`fresh|${locale}|${t}|1`]))}\n     HEAD→1 ${j(pk(H?.[`fresh|${locale}|${t}|1`]))}`);
    // M8 spec 3: a first-turn geocode candidate with dates keeps HEAD's pending (ask_days flow); afterMiss only after a miss.
    const hf = H?.[`fresh|${locale}|${t}`];
    const fp = W[`freshpure|${locale}|${t}`];
    out(`INFO freshpure [${locale}] 「${t}」 ${j(fp)}`);
    if (fp?.cand) check(`[${locale}] fresh first turn 「${t}」: resolver keeps the ask_days pending (no afterMiss on a first turn)`, () => {
      assert.equal(fp.afterMiss, false, j(fp));
      if (fp.status === "resolved") assert.equal(fp.pending, "ask_days", j(fp));
    });
    if (hf) check(`[${locale}] fresh first turn 「${t}」: not worse than HEAD (HEAD date question kept; no new last-resort copy)`, () => {
      const wf = W[`fresh|${locale}|${t}`];
      if (/date\/duration question/.test(hf.branch)) assert.equal(wf.branch, hf.branch, `WORK ${j(pk(wf))}\n  HEAD ${j(pk(hf))}`);
      if (!/last-resort/.test(hf.branch)) assert.ok(!/last-resort/.test(wf.branch), `WORK ${j(pk(wf))}\n  HEAD ${j(pk(hf))}`);
    });
  }
  // Risk a: country-level combination choice + a city name, compared with HEAD.
  const jp = W[`jp|${locale}|STEP1`];
  out(`INFO [${locale}] JP STEP1 ${j(jp)}${H ? `\n     HEAD ${j(H[`jp|${locale}|STEP1`])}` : ""}`);
  for (const pre of ["jp", "jpc"]) for (const t of COUNTRY_TURNS[locale]) {
    const w = W[`${pre}|${locale}|${t}`]; const h = H?.[`${pre}|${locale}|${t}`];
    const pick = (x) => x && { branch: x.branch, resets: x.resets, dest: x.dest, start: x.start, end: x.end, days: x.days, prov: x.prov, pending: x.pending, cand: x.cand, geo: x.geo.length, reply: x.reply.slice(0, 110) };
    out(`ROW risk a [${locale}] ${pre} 「${t}」\n     WORK ${j(pick(w))}\n     HEAD ${j(pick(h))}\n     WORK→1 ${j(pick(W[`${pre}|${locale}|${t}|1`]))}\n     HEAD→1 ${j(pick(H?.[`${pre}|${locale}|${t}|1`]))}`);
    const w1 = W[`${pre}|${locale}|${t}|1`];
    if (OTHER_COUNTRY_SWITCH.has(t)) check(`[${locale}] risk a ${pre} 「${t}」: another country's city is a destination switch (one reset, dates kept, Haeundae combinations, geocode 1; 「1」 no reset)`, () => {
      const info = `\n  WORK ${j(pick(w))}\n  WORK→1 ${j(pick(w1))}\n  JP STEP1 ${j(jp)}`;
      assert.equal(w.resets, 1, `resets ${w.resets}${info}`);
      assert.ok(GEO.haeundae.re.test(w.dest ?? "") || LOCAL.haeundae.includes(w.dest), `dest ${w.dest}${info}`);
      assert.equal(w.start, jp.start, `start${info}`); assert.equal(w.days, jp.days, `days${info}`);
      assert.ok(w.end, `end dropped${info}`);
      assert.equal(w.pending, "combination_choice", `pending${info}`); assert.ok(w.offered > 0, `offered${info}`);
      assert.equal(w.geo.length + (w.dgeo?.length ?? 0), 1, `geocode resolve=${j(w.geo)} discovery=${j(w.dgeo)}${info}`);
      assert.equal(w1.resets, 0, `「1」 resets${info}`);
      assert.ok(!/ask_days|date/.test(w1.pending ?? ""), `「1」 pending ${w1.pending}${info}`);
    });
    else if (OTHER_COUNTRY_BARE.has(t)) { if (h) check(`[${locale}] risk a ${pre} bare 「${t}」: same as HEAD (country mismatch confirmation, no reset)`, () => {
      const pb = (x) => ({ branch: x.branch, resets: x.resets, dest: x.dest, start: x.start, days: x.days, pending: x.pending, cand: x.cand, geo: x.geo.length, reply: x.reply.replace(/’/g, "'") });
      assert.deepEqual(pb(w), pb(h), `WORK ${j(pb(w))}\n  HEAD ${j(pb(h))}`);
    }); }
    else if (h) check(`[${locale}] risk a ${pre} 「${t}」: no reset where HEAD did not reset (country → city stays the narrowing flow)`, () => {
      if (h.resets === 0) assert.equal(w.resets, 0, `WORK resets ${w.resets}, HEAD 0\n  WORK ${j(pick(w))}\n  HEAD ${j(pick(h))}`);
    });
  }
}
check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
if (!H) out("NOTE: HEAD comparison not run (risk a not asserted)");
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.exit(failures.length ? 1 : 0);
