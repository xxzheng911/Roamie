/**
 * M7 (tester, independent review of M6). WORK vs HEAD snapshot (`-- --head-dir=<snapshot>`).
 *  a) country-level trip (日本) + another country's city that needs a geocode (해운대 / 海雲台 / Haeundae):
 *     does it narrow a Japan trip into a Korean city, list wrong combinations, or leave mixed countries?
 *  b) 「城市, 國家」 outside combination choice (fresh first turn / after a miss outside combinations) vs HEAD.
 *  c) two-character place names (津市 府中 市川 都城 京都 東京都 大阪府 …) normalized label / known / scope vs HEAD.
 *  d) rule 7 (ask_days answer ≠ kept range days clears the range): only ask_days / duration_choice, only
 *     when the turn gives no new dates; STEP1 「12/10-12/14 京都 5天」 untouched.
 *  e) zh CONFIRMED 「不去雪梨了，改去熱海」 after a geocode miss, rebuilt in _app.chat.tsx order
 *     (classify → resolveTrustedRecommendationSearchScope → P1 → applyConfirmedDestinationSwitch →
 *     e3_applied unless the turn asks for recommendations); what the user actually sees.
 *     M9: App arguments trustedCenter / trustedLocation (provider_this_turn: the Authority's envelope;
 *     provider_locked: null → wrapper cache), plus an "omit" run; while choosing combinations the turn
 *     re-lists (no E3 return) through pin / merge / C3 guards; outside combination choice = HEAD.
 *     Also: provider-location cache collisions / clearing, and JP / jp / Japan / 日本 geocode country formats.
 * fetch is stubbed (must stay 0); geocode / Places are fixtures.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=500 scripts/verify-m7-combination-review.mjs -- --head-dir=<snapshot>
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
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
let turnDest = await load("src/lib/ai/chat-turn-destination.ts");
// The Authority keeps its own provider-verified centers (chat-turn-destination.ts providerTrustedCenters, no
// clear export). A fresh module instance (query id) gives the harness a clean Authority for one scenario.
let authorityInstance = 0;
const freshAuthority = async () => { turnDest = await load(`src/lib/ai/chat-turn-destination.ts?m9=${++authorityInstance}`); };
const geoClar = await load("src/lib/ai/destination-geographic-clarification.ts");
const contRec = await load("src/lib/ai/continue-recommendation-intent.ts");
const placeRecIntent = await load("src/lib/ai/place-recommendation-intent/parse.ts");
const resolvedScope = await load("src/lib/ai/resolved-destination-scope.ts");
// M9: the App (this tree's _app.chat.tsx) re-lists combinations on a CONFIRMED switch while choosing
// combinations instead of returning at e3_applied; the HEAD snapshot's App does not (same harness, both trees).
const APP_SRC = readFileSync("src/routes/_app.chat.tsx", "utf8");
const APP_RELISTS = APP_SRC.includes("switchRelistsCombinations");
const APP_PASSES_TRUSTED = /trustedLocation:\s*\n?\s*switchProbe\.providerCalls > 0/.test(APP_SRC);

// ------------------------------------------------------------------ fixtures (same as verify-m5-combination-geocode-switch)
const GEO = {
  sydney: { re: /sydney|雪梨|シドニー|시드니/i, city: "Sydney", region: "New South Wales", country: "Australia", code: "AU", lat: -33.8688, lng: 151.2093 },
  kyoto: { re: /kyoto|京都|교토/i, city: "Kyoto", region: "Kyoto", country: "Japan", code: "JP", lat: 35.0116, lng: 135.7681 },
  atami: { re: /atami|熱海|热海|아타미/i, city: "Atami", region: "Shizuoka", country: "Japan", code: "JP", lat: 35.0959, lng: 139.0717 },
  haeundae: { re: /haeundae|해운대|海雲台|海雲臺|海云台/i, city: "Haeundae-gu", region: "Busan", country: "South Korea", code: "KR", lat: 35.1631, lng: 129.1635 },
  tokyo: { re: /tokyo|東京|도쿄/i, city: "Tokyo", region: "Tokyo", country: "Japan", code: "JP", lat: 35.6762, lng: 139.6503 },
};
const LOCAL = { sydney: ["Sydney", "雪梨", "シドニー", "시드니"], kyoto: ["Kyoto", "京都市", "京都市", "교토시"], atami: ["Atami", "熱海市", "熱海市", "아타미시"],
  haeundae: ["Haeundae-gu", "海雲臺區", "海雲台区", "해운대구"], tokyo: ["Tokyo", "東京", "東京都", "도쿄"] };
let curLocale = "en";
const localCity = (k) => LOCAL[k][["en", "zh-TW", "ja", "ko"].indexOf(curLocale)] ?? GEO[k].city;
const keyOf = (q) => Object.keys(GEO).find((k) => GEO[k].re.test(q ?? ""));
let geoMode = "hit";
const geocodeLog = [];
const locationOf = (k) => { const d = GEO[k]; return { placeId: `ChIJ_${d.code}_${d.city}`, country: countryNorm.normalizeCountryReference(d.country, d.code).country || d.country,
  city: localCity(k), region: d.region, lat: d.lat, lng: d.lng, formattedName: localCity(k), displayLabel: localCity(k) }; };
const geocode = async (q) => {
  geocodeLog.push(q);
  const k = keyOf(q);
  if (!k || (geoMode === "miss" && k !== "sydney")) return { rawResultCount: 0, location: null };
  return { rawResultCount: 1, location: locationOf(k) };
};
/** Provider-shaped envelope for the Destination Authority (resolveTrustedRecommendationSearchScope / discovery). */
const authorityGeocodeLog = [];
const authorityGeocodeFn = async ({ data }) => {
  authorityGeocodeLog.push(data.query);
  const k = keyOf(data.query);
  if (!k || (geoMode === "miss" && k !== "sydney")) return { location: null, error: null, providerResult: { ok: true, rawResultCount: 0 } };
  const loc = locationOf(k);
  return { location: loc, error: null, providerResult: { ok: true, rawResultCount: 1, placeId: loc.placeId, types: ["locality", "political"], primaryType: "locality",
    countryCode: GEO[k].code, latitude: loc.lat, longitude: loc.lng } };
};
const poolFor = (dest) => {
  const k = keyOf(dest) ?? (/japan|日本|일본/i.test(dest ?? "") ? "tokyo" : undefined);
  if (!k) return [];
  const d = GEO[k];
  return Array.from({ length: 18 }, (_, i) => ({ id: `ChIJ${d.code}${k}P${i}`, name: `${localCity(k)} ${["Shrine", "Temple", "Park", "Museum", "Garden", "Tower"][i % 6]} ${i + 1}`, sourceLocale: "en",
    lat: d.lat + i * 0.0003, lng: d.lng, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park",
    rating: 4.6, userRatingCount: 10000, address: `${localCity(k)}, ${d.country}`, businessStatus: "OPERATIONAL" }));
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const prog = (m) => { if (argv.includes("--progress")) process.stderr.write(`${m}\n`); };
const fresh = () => { discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache(); };
/** M9: also drop the Destination Authority scope locks + provider-location cache (App restart / clean turn). */
const freshAll = () => { fresh(); resolvedScope.clearResolvedDestinationScope?.(); };
// Combination discovery provider calls (separate from the Authority's own request).
const discoveryGeocodeLog = [];
const discoveryGeocodeFn = async (req) => { discoveryGeocodeLog.push(req.data.query); const r = await authorityGeocodeFn(req); authorityGeocodeLog.pop(); return r; };
let discoveryRuns = 0;
let placesCalls = 0;
const ensure = async (ctx, session, locale) => {
  const comboDest = ctx.destination?.trim() || session.tripPlanningContext?.destination?.trim() || session.tripDestination?.city?.trim();
  if (!comboDest) return;
  const durationFields = durationGuard.tripDurationFieldsFromContext(ctx, session);
  const days = durationGuard.resolveValidTripDays(durationFields);
  const guard = durationGuard.evaluateCombinationDiscoveryGuard({ destination: comboDest, destinationType: ctx.destinationType, destinationCountry: ctx.destinationCountry, destinationCity: ctx.destinationCity,
    destinationCountryCode: ctx.destinationCountryCode, destinationCoordinates: ctx.destinationCoordinates, destinationScopeId: ctx.destinationScopeId, ...durationFields, days, pendingQuestion: session.pendingQuestion, session });
  if (!guard.allowed || days == null) return;
  const label = tpc.normalizeDestinationLabel(comboDest);
  if (scopeMod.isCountryLevelDestination(label, guard.resolvedDestination)) return;
  const cached = discovery.getCachedDiscoveredCombinations?.(label);
  if (cached && cached.length >= 3) return;
  discoveryRuns++;
  await discovery.ensureDestinationCombinationsReady({ destination: label, resolvedDestination: scopeMod.matchedCombinationScope(label, guard.resolvedDestination), geocodeFn: discoveryGeocodeFn, locale, days,
    generationRequestId: `combo_${label}`, destinationCountry: ctx.destinationCountry ?? session.travelContext?.destinationCountry ?? session.tripDestination?.country,
    searchPlaces: async () => { placesCalls++; return { places: poolFor(comboDest), error: null }; } }).catch(() => null);
};
const finish = (r, lastReply) => advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply || lastReply }, r.advice);
const snapOf = (s, branch, reply, extra = {}) => {
  const tc = s.travelContext ?? {};
  return { branch, dest: tc.destination ?? null, country: tc.destinationCountry ?? null, code: tc.destinationCountryCode ?? null, type: tc.destinationType ?? null,
    trip: s.tripDestination ? `${s.tripDestination.city ?? "-"}/${s.tripDestination.country ?? "-"}` : null, tpc: s.tripPlanningContext?.destination ?? null, area: s.preferredArea ?? null,
    days: tc.days ?? s.tripDays ?? null, start: tc.startDate ?? null, end: tc.endDate ?? null, prov: tc.dateProvenance ? `${tc.dateProvenance.source}/${tc.dateProvenance.confirmed}` : null,
    cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}${tc.destinationCandidate.countryHint ? `/hint=${tc.destinationCandidate.countryHint}` : ""}` : null,
    pending: s.pendingQuestion?.type ?? null, pendingCountry: s.pendingQuestion?.destinationCountry ?? null, base: s.pendingQuestion?.baseDestination ?? null,
    offered: (tc.offeredCombinations ?? []).length, offeredFirst: (tc.offeredCombinations?.[0]?.places ?? tc.offeredCombinations?.[0]?.placeNames ?? []).slice(0, 2).map((p) => (typeof p === "string" ? p : p?.name)).join("|") || null,
    sid: s.planningSessionId ?? null, reply: (reply ?? "").replace(/\n/g, " / ").slice(0, 240), ...extra };
};

/**
 * NO_SWITCH turn: same route chain as verify-m5-combination-geocode-switch routeTurn (post A2 gate).
 * `sw` (M9): a verified CONFIRMED switch continuing this turn — _app.chat.tsx 10897 pin + 10917 pin guard,
 * 11393 merge second-reset guard, 11463 Authority-record reuse in resolveGlobalPlanningCandidate, 11537 C3.
 */
async function chainTurn(s0, base, t, locale, sw) {
  const msgs = [{ role: "user", content: "prev" }, { role: "assistant", content: s0.lastAssistantReply ?? "" }];
  const partial = !sw && Boolean(partialApi && partialApi.isCombinationChoiceTurn(base) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply?.(t)));
  let n = partial ? clone(base) : tripIntent.applyTripIntentToSession(t, clone(base));
  if (sw) {
    n = { ...n, location: sw.switched.location, preferredArea: sw.switched.preferredArea, tripDestination: sw.switched.tripDestination,
      travelContext: n.travelContext ? { ...n.travelContext, destinationCountry: sw.authorityCountry, destinationCountryCode: countryNorm.normalizeCountryReference(sw.authorityCountry).countryCode, destinationScopeId: undefined } : n.travelContext };
    if (travelContext.wouldMergeTravelContextResetTrip(n, t)) return { s: sw.switched, row: snapOf(sw.switched, "B pin_second_reset_blocked", "(destinationSwitchAppliedSyncPending)") };
    if (n.planningSessionId !== sw.switched.planningSessionId) return { s: sw.switched, row: snapOf(sw.switched, "B pin_mismatch", "(destinationSwitchAppliedSyncPending)") };
  }
  n = convState.prepareSessionForUserTurn(n, s0.lastAssistantReply);
  if (planningState.isReplanIntent(t) && !partial && !sw) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  if (sw && travelContext.wouldMergeTravelContextResetTrip(n, t)) return { s: sw.switched, row: snapOf(sw.switched, "B merge_second_reset_blocked", "(destinationSwitchAppliedSyncPending)") };
  prog("  mergeTravelContext");
  const merged = travelContext.mergeTravelContext(n, t, s0.lastAssistantReply);
  n = merged.session;
  prog(`  merged cand=${merged.context.destinationCandidate?.raw}/${merged.context.destinationCandidate?.status}`);
  if (merged.context.destinationCandidate?.status === "pending") {
    n = await globalPlanning.resolveGlobalPlanningCandidate(n, locale, sw
      ? async (q) => (sw.record ? { location: sw.record.location, rawResultCount: 1 } : sw.providerCalls >= 1 ? undefined : geocode(q))
      : geocode);
    merged.context = n.travelContext ?? merged.context;
  }
  if (sw) {
    // C3 (simplified): destination is still D*, no further reset downstream, same planning session.
    const c3 = merged.context.destinationClarification ? "clarification"
      : merged.context.destinationCandidate && merged.context.destinationCandidate.status !== "resolved" ? "candidate"
      : !equivalentSwitch(merged.context.destination ?? n.travelContext?.destination, sw.trusted, merged.context, n, locale) ? "destination"
      : n.planningSessionId !== sw.switched.planningSessionId ? "plan_version"
      : travelContext.wouldMergeTravelContextResetTrip(n, t) ? "downstream_reset" : null;
    if (c3) return { s: sw.switched, row: snapOf(sw.switched, `B c3_${c3}`, "(destinationSwitchAppliedSyncPending)") };
  }
  if (merged.context.destinationClarification || (merged.context.destinationCandidate && merged.context.destinationCandidate.status !== "resolved")) {
    const r = stateMachine.processAdviceTurn(t, n, merged.context, undefined, locale);
    const s = finish(r, s0.lastAssistantReply);
    return { s, row: snapOf(s, "candidate advice", r.advice.reply) };
  }
  if (partial) { const r = stateMachine.processAdviceTurn(t, n, merged.context, undefined, locale); const s = finish(r, s0.lastAssistantReply); return { s, row: snapOf(s, "partial modify", r.advice.reply) }; }
  if (budget.isBudgetRefinementText(t)) n = budget.applyBudgetRefinementToSession(t, { ...n, travelContext: merged.context });
  prog(`  mergeTripPlanningContext dest=${merged.context.destination} cand=${merged.context.destinationCandidate?.raw}/${merged.context.destinationCandidate?.status}`);
  n = tpc.mergeTripPlanningContext(t, n, merged.context).session;
  prog("  extract*");
  n = sessionMod.extractPlanningHintsFromText(t, n);
  n = sessionMod.extractDiscoveryFromText(t, n);
  n = planningFlow.extractChatPlanningContextFromText(t, n);
  const destCandidate = merged.context.destination?.trim() || n.tripDestination?.displayLabel?.trim() || n.tripDestination?.city?.trim();
  let delta = constraints.parsePlanningConstraintDelta({ text: t, shownCandidates: [], authoritativeDestination: n.travelContext?.destination ?? merged.context.destination ?? destCandidate });
  delta = constraints.disambiguatePlanningDestinationEntity({ delta, destination: destCandidate });
  const req = constraints.resolvePlanningContextRequirement({ text: t, delta, candidateCount: 0, destinationDetected: Boolean(destCandidate), durationOrDateDetected: Boolean(merged.context.days || merged.context.startDate || merged.context.endDate) });
  if (req.requiresCandidateContext) return { s: n, row: snapOf(n, "missing candidate context clarification", prodUi.productionUiMessages?.[locale]?.p0bde867c73 ?? "(p0bde867c73)") };
  n = constraints.applyPlanningConstraintDelta(n, delta, []);
  if (planningState.isStyleReselectTurn(t, n, merged.context)) return { s: n, row: snapOf(n, "style reselect", "(style reselect)") };
  if (addAll.isAddAllToTripIntent(t) || delta.acceptRemainingCandidates === true) return { s: n, row: snapOf(n, "add-all", "(add-all)") };
  if (refresh.shouldAcceptAlternativeRecommendations(msgs, t)) return { s: n, row: snapOf(n, "alternative", "(alternative)") };
  if (refresh.shouldRefetchPlaces(t, n, merged.context, msgs)) return { s: n, row: snapOf(n, "refetch", "(refetch)") };
  const pc = mustVisit.mergeContextForPlaceFetch(n.travelContext ?? merged.context, n);
  if (mustVisit.shouldFetchDestinationPlaces(t, pc, n)) return { s: n, row: snapOf(n, "destination places", "(destination places)") };
  const cat = placeIntent.shouldFetchDestinationCategoryPlaces(t, pc, n);
  const auth = nearbyClar.resolveChatRouteAuthority({ structuredShortcut: false, explicitNearbyRequest: chatIntent.userExplicitlyWantsNearbyPlaces(t), pendingNearbyLocationRequest: Boolean(n.pendingNearbyLocationRequest), resolvedNearbyIntent: chatIntent.inferNearbyIntentFromContext(pc, t, n) ?? null, categoryPlaceQuery: cat });
  if (auth === "destination_category") return { s: n, row: snapOf(n, "destination category", "(category places)") };
  if (arbitrate.shouldSkipTripPlanningForRefinement(t, n)) return { s: n, row: snapOf(n, "refinement", "(refinement)") };
  const planning = (turnEngine.isPlanningTurnActive(n, merged.context) || convState.isDestinationPlanningSession(n, merged.context))
    && !mustVisit.shouldFetchDestinationPlaces(t, pc, n) && !cat
    && !(catTypes.hasCategoryPlaceQuery(t) && !tpc.coerceTravelDestination(catDest.resolveDestinationForCategorySearch(pc, n, t)));
  if (!planning) return { s: n, row: snapOf(n, "later dispatch", "(later dispatch)") };
  const planningCtx = n.travelContext ?? merged.context;
  const discoverySession = pdd.sessionForAnsweredDurationDiscovery(t, n, planningCtx);
  const durationFields = durationGuard.tripDurationFieldsFromContext(planningCtx, n);
  const validDays = durationGuard.resolveValidTripDays(durationFields);
  const guardInput = { destination: planningCtx.destination, destinationType: planningCtx.destinationType, destinationCountry: planningCtx.destinationCountry, destinationCity: planningCtx.destinationCity,
    destinationCountryCode: planningCtx.destinationCountryCode, destinationCoordinates: planningCtx.destinationCoordinates, destinationScopeId: planningCtx.destinationScopeId,
    ...durationFields, days: validDays, pendingQuestion: discoverySession.pendingQuestion, session: discoverySession };
  const routeGuard = durationGuard.evaluateCombinationDiscoveryGuard(guardInput);
  const dateQuestion = (branch) => {
    const destLabel = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || "";
    prog(`  dateQuestion ${branch} dest=${destLabel}`);
    const dateAsk = cityDays.buildDateAndDurationQuestionReply(destLabel || "這趟", planningCtx.destinationCountry ?? n.travelContext?.destinationCountry, { context: planningCtx, userText: t, blockedLegacyTemplate: branch, locale });
    const s = { ...n, pendingQuestion: dateAsk.pendingQuestion, travelContext: { ...planningCtx, destination: destLabel || planningCtx.destination, tripPurpose: "region_selected", conversationState: "awaiting_days", planningDaysConfirmed: false } };
    return { s, row: snapOf(s, `${branch} date/duration question`, dateAsk.reply) };
  };
  if (!routeGuard.allowed && (routeGuard.reason === "missing_trip_duration" || routeGuard.reason === "pending_duration_question" || !durationGuard.hasValidTripDuration(durationFields))) {
    const destLabel = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || "";
    if (destLabel && !scopeMod.isCountryLevelDestination(destLabel)) return dateQuestion("12954");
  }
  prog(`  ensure guard=${routeGuard.reason ?? "ok"}`);
  if (durationGuard.canEnterCombinationDiscovery(guardInput)) await ensure(planningCtx, discoverySession, locale);
  prog("  processAdviceTurn");
  const r = stateMachine.processAdviceTurn(t, n, planningCtx, undefined, locale);
  prog(`  processAdviceTurn done reply=${JSON.stringify((r.advice.reply ?? "").slice(0, 80))}`);
  const failureCopy = r.advice.reply && /暫時無法取得.*景點資料/.test(r.advice.reply) && !(r.advice.pendingQuestion?.type === "combination_choice" || r.advice.contextPatch?.tripPurpose === "combination_suggestions_offered");
  if (r.advice.reply && !failureCopy) { prog("  finish"); const s = finish(r, s0.lastAssistantReply); prog("  finish done"); return { s, row: snapOf(s, "planning advice", r.advice.reply, { guard: routeGuard.reason ?? "ok" }) }; }
  if (!durationGuard.hasValidTripDuration({ days: durationGuard.resolveValidTripDays(durationGuard.tripDurationFieldsFromContext(planningCtx, n)), ...durationGuard.tripDurationFieldsFromContext(planningCtx, n) })) return dateQuestion("13058");
  prog(`  buildDestinationDirectionAck dest=${planningCtx.destination}`);
  // _app.chat.tsx 13132: destLabel || tripFallback.
  const ack = durationGuard.buildDestinationDirectionAck({ destination: planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || copyMod.chatRuntimeCopy("tripFallback", locale), tripDays: planningCtx.days ?? n.tripDays, startDate: planningCtx.startDate, endDate: planningCtx.endDate, locale });
  prog("  ack done");
  const failure = prodUi.productionUiMessages?.[locale]?.p7fe9e2ed49 ?? "(p7fe9e2ed49)";
  const s = { ...n, pendingQuestion: { type: "ask_preference", options: ["REFRESH"], baseDestination: planningCtx.destination } };
  return { s, row: snapOf(s, "LAST-RESORT (p7fe9e2ed49)", [ack, "", failure].join("\n"), { guard: routeGuard.reason ?? "ok" }) };
}

/** Same as _app.chat.tsx isEquivalentSwitchDestination (936..969). */
function equivalentSwitch(label, trusted, ctx, session, locale) {
  const l = label?.trim(); const tr = trusted?.trim();
  if (!l || !tr) return false;
  if (tpc.normalizeDestinationLabel(l) === tpc.normalizeDestinationLabel(tr)) return true;
  const resolve = (text) => turnDest.resolveCategoryTurnDestination({ ctx, session, userText: text, locale });
  const own = resolve(l);
  if (own.source === "session" || (own.confidence !== "confirmed" && own.confidence !== "curated")) return false;
  if (tpc.normalizeDestinationLabel(own.destination ?? "") !== tpc.normalizeDestinationLabel(tr)) return false;
  const ref = resolve(tr);
  return ref.source !== "session" && (ref.confidence === "confirmed" || ref.confidence === "curated") && ref.destinationType === own.destinationType;
}

/** One user turn in _app.chat.tsx order: A2 gate (9101..9612) then the NO_SWITCH chain. */
async function appTurn(s0, t, locale, opts = {}) {
  if (argv.includes("--progress")) process.stderr.write(`· [${locale}] 「${t}」 geo=${geoMode}\n`);
  curLocale = locale;
  const g0 = geocodeLog.length; const a0 = authorityGeocodeLog.length; const d0 = discoveryGeocodeLog.length;
  const runs0 = discoveryRuns; const places0 = placesCalls;
  const sid0 = s0.planningSessionId;
  const cls = tpc.classifyDestinationSwitchTurn(t);
  const geoOf = () => ({ geo: geocodeLog.slice(g0), ageo: authorityGeocodeLog.slice(a0), dgeo: discoveryGeocodeLog.slice(d0), discoveryRuns: discoveryRuns - runs0, placesCalls: placesCalls - places0 });
  const stopCopy = (dest, prev) => dest?.trim() ? copyMod.chatRuntimeCopy("destinationSwitchStopped", locale, { destination: dest.trim(), previous: prev?.trim() ?? "" }) : copyMod.chatRuntimeCopy("destinationSwitchExpired", locale);
  const previousLabel = geoClar.destinationSwitchTrustedPrevious(s0);
  if (cls.state === "NEGATED_UNCERTAIN") return { s: s0, row: { ...snapOf(s0, "E1 ask (NEGATED_UNCERTAIN)", "(destinationSwitchConfirm / Expired)"), cls: cls.state, ...geoOf() } };
  if (cls.state === "CONFIRMED_SWITCH") {
    const targetLabel = cls.targetLabel?.trim();
    if (!targetLabel) return { s: s0, row: { ...snapOf(s0, "k2_no_target", stopCopy()), cls: cls.state, ...geoOf() } };
    let trusted;
    // _app.chat.tsx 9112 switchProbe: wraps only the Authority's own provider request.
    const probe = { providerCalls: 0, captured: undefined };
    const capturingGeocodeFn = async (req) => { probe.providerCalls++; const envelope = await authorityGeocodeFn(req); probe.captured = { request: { ...req.data }, envelope }; return envelope; };
    try { trusted = await turnDest.resolveTrustedRecommendationSearchScope({ label: targetLabel, ctx: s0.travelContext ?? { interests: [] }, session: s0, locale, geocodeFn: capturingGeocodeFn }); }
    catch { trusted = { status: "unavailable", reason: "authority_error" }; }
    if (trusted.status !== "trusted") return { s: s0, row: { ...snapOf(s0, `k2_${trusted.reason}`, stopCopy(targetLabel, previousLabel)), cls: cls.state, ...geoOf() } };
    const switchBase = { ...clone(s0), pendingClarification: undefined };
    const p1Ctx = switchBase.travelContext ?? { interests: [] };
    const textIntent = tripIntent.parseTripIntentFromText(t, { ...switchBase, location: undefined, preferredArea: undefined, tripDestination: undefined });
    const p1Labels = [tpc.parseDestinationFromText(t), globalPlanning.globalPlanningTurn(switchBase, t)?.destinationCandidate?.raw, textIntent.destinationCity, textIntent.destinationArea].filter((x) => x?.trim());
    const p1Failed = p1Labels.find((label) => !equivalentSwitch(label, trusted.destination, p1Ctx, switchBase, locale));
    if (p1Failed) return { s: s0, row: { ...snapOf(s0, `p1 stop (${p1Failed})`, stopCopy(targetLabel, previousLabel)), cls: cls.state, p1Labels, ...geoOf() } };
    // _app.chat.tsx 9415: the App's own arguments (opts.trustedLocation === "omit": wrapper must use its cache).
    const trustedLocation = probe.providerCalls > 0 ? probe.captured?.envelope.location ?? null : null;
    const res = travelContext.applyConfirmedDestinationSwitch(switchBase, { label: targetLabel, requestText: t, turnResetBase: { planningSessionId: s0.planningSessionId, planVersion: s0.planVersion }, resetAlreadyThisTurn: false,
      trustedCenter: trusted.center, ...(opts.trustedLocation === "omit" ? {} : { trustedLocation }) });
    const authority = probe.providerCalls > 0 ? "provider_this_turn" : "provider_locked";
    const baseCand = switchBase.travelContext?.destinationCandidate;
    // _app.chat.tsx: switchRelistsCombinations = isCombinationSwitchRelistBase(switchBase) (older WORK: M14 condition).
    const relists = APP_RELISTS && (globalPlanning.isCombinationSwitchRelistBase
      ? globalPlanning.isCombinationSwitchRelistBase(switchBase)
      : (switchBase.pendingQuestion?.type === "combination_choice" || Boolean(baseCand?.combinationSwitch && baseCand.status !== "resolved")));
    if ("stop" in res || !res.applied) return { s: s0, row: { ...snapOf(s0, "stop" in res ? `wrapper_${res.stop}` : "wrapper_not_applied", stopCopy(targetLabel, previousLabel)), cls: cls.state, authority, ...geoOf() } };
    const switched = { ...res.session, planningSelection: undefined, placeDetailFocus: undefined, placeFocusRecommendationScope: undefined, activeShownCandidates: undefined };
    const switchedLabel = switched.travelContext?.destination ?? switched.tripPlanningContext?.destination;
    if (!equivalentSwitch(switchedLabel, trusted.destination, switched.travelContext ?? { interests: [] }, switched, locale)) return { s: s0, row: { ...snapOf(s0, "B_committed_sync_pending", "(destinationSwitchAppliedSyncPending / NotSynced)"), cls: cls.state, authority, ...geoOf() } };
    const wrapperTrip = switched.tripDestination ? `${switched.tripDestination.city ?? "-"}/${switched.tripDestination.country ?? "-"}/${switched.tripDestination.placeId ?? "-"}` : null;
    const reqText = cls.requestText?.trim() ?? "";
    const route = reqText ? arbitrate.resolveChatIntentArbitration(reqText, switched).route : undefined;
    const asksRec = contRec.analyzeContinueRecommendationStructure(t).isContinue || (Boolean(reqText) && placeRecIntent.hasExplicitPlaceRecommendationIntent(reqText))
      || route === "NEW_RECOMMENDATION" || route === "MORE_RECOMMENDATIONS" || route === "RECOMMENDATION_REFINEMENT";
    const extra = { cls: cls.state, authority, relists, wrapperTrip, trusted: `${trusted.destination}/${trusted.centerSource ?? "-"}` };
    if (!asksRec && !relists) {
      const reply = copyMod.chatRuntimeCopy("destinationSwitchKept", locale, { previous: trusted.destination, destination: trusted.destination });
      const s = { ...switched, lastAssistantReply: reply };
      return { s, row: { ...snapOf(s, "e3_applied (turn returns)", reply), ...extra, sidChanged: s.planningSessionId !== sid0, chainReset: false, ...geoOf() } };
    }
    const providerCountry = probe.captured?.envelope.location?.country;
    const record = probe.providerCalls > 0 && probe.captured ? { targetLabel, location: probe.captured.envelope.location, country: providerCountry } : undefined;
    const sw = { switched, trusted: trusted.destination, providerCalls: probe.providerCalls, record, authorityCountry: providerCountry ?? (switched.travelContext?.destinationCountry?.trim() || undefined) };
    const r = await chainTurn(s0, switched, t, locale, sw);
    return { s: r.s, row: { ...r.row, ...extra, via: relists ? "confirmed+relist" : "confirmed+recommendation", sidChanged: r.s.planningSessionId !== sid0, chainReset: r.s.planningSessionId !== switched.planningSessionId, ...geoOf() } };
  }
  let r;
  try { r = await chainTurn(s0, clone(s0), t, locale); }
  catch (e) { return { s: s0, row: { ...snapOf(s0, `HARNESS THROW ${String(e?.message ?? e).slice(0, 160)}`, ""), cls: cls.state, ...geoOf() } }; }
  return { s: r.s, row: { ...r.row, cls: cls.state, sidChanged: r.s.planningSessionId !== sid0, ...geoOf() } };
}
async function first(t, locale) { fresh(); return appTurn(sessionMod.createEmptySession(), t, locale); }

const STEP1 = { "zh-TW": "12/10-12/14 我要去雪梨", en: "12/10-12/14 I'm going to sydney", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행" };
const STEP1_JP = { "zh-TW": "12/10-12/14 我要去日本", en: "12/10-12/14 I'm going to Japan", ja: "12/10-12/14 日本へ旅行", ko: "12/10-12/14 일본 여행" };
const JP_OTHER = { "zh-TW": ["改去海雲台", "我要去海雲台", "海雲台"], en: ["switch to Haeundae", "Haeundae"], ja: ["海雲台に変更", "海雲台"], ko: ["해운대로 바꿔", "해운대"] };
const JP_OWN = { "zh-TW": ["改去熱海"], en: ["switch to Atami"], ja: ["熱海に変更"], ko: ["아타미로 바꿔"] };
const CC_FRESH = { "zh-TW": ["熱海, 日本 12/10-12/14", "熱海, 日本", "熱海 日本 12/10-12/14", "京都, 日本"], en: ["Atami, Japan 12/10-12/14", "Atami, Japan"], ja: ["熱海, 日本 12/10-12/14", "熱海 日本"], ko: ["해운대, 한국 12/10-12/14", "해운대 한국"] };
// Outside combination choice: first sentence misses (unknown city), then 「城市, 國家」.
const CC_AFTER_MISS = { "zh-TW": ["12/10-12/14 我要去熱海", "熱海, 日本"], en: ["12/10-12/14 I'm going to Atami", "Atami, Japan"], ja: ["12/10-12/14 熱海へ旅行", "熱海, 日本"], ko: ["12/10-12/14 해운대 여행", "해운대, 한국"] };
const LABELS = ["津", "津市", "府中", "府中市", "市川", "市川市", "都城", "都城市", "京都", "京都市", "京都府", "東京", "東京都", "大阪", "大阪府", "大阪市", "別府", "別府市", "甲府", "甲府市", "成都", "成都市", "草津町", "熱海市", "海雲臺區", "堺市", "北海道", "府中町", "市原市", "都市", "中市"];
const CONFIRMED = { "zh-TW": [["改去熱海", "不去雪梨了，改去熱海"], ["改去熱海", "雪梨不去了，改去京都"]], en: [["switch to Atami", "not sydney anymore, switch to Atami"]], ja: [["熱海に変更", "シドニーはやめて、熱海に変更"]], ko: [["해운대로 바꿔", "시드니 말고 해운대로 바꿔"]] };

const single = argv.find((a) => a.startsWith("--single="))?.slice(9);
if (single) {
  const loc = argv.find((a) => a.startsWith("--locale="))?.slice(9) ?? "en";
  const r = await first(single, loc);
  out(`SINGLE [${loc}] 「${single}」 ${JSON.stringify(r.row)}`);
  process.exit(0);
}
async function runAll() {
  const R = { labels: {} };
  for (const x of LABELS) {
    const label = tpc.normalizeDestinationLabel(x);
    const scope = scopeMod.resolveDestinationScopeFields?.(x);
    R.labels[x] = { label, known: tpc.isKnownDestinationLabel(label), scope: scope ? `${scope.destinationName}/${scope.destinationType}/${scope.destinationCountry ?? "-"}` : null,
      parsed: tpc.parseDestinationFromText(`我要去${x}`) ?? null };
  }
  for (const locale of Object.keys(STEP1)) {
    geoMode = "hit";
    // a) country-level Japan + another country's city (real STEP1 and the synthetic combination_choice pending).
    const j1 = (await first(STEP1_JP[locale], locale)).s;
    const jc = { ...clone(j1), pendingQuestion: { type: "combination_choice", options: ["1", "2", "3"], baseDestination: j1.travelContext?.destination, destinationCountry: j1.travelContext?.destinationCountry } };
    for (const [pre, base] of [["jp", j1], ["jpc", jc]]) for (const t of [...JP_OTHER[locale], ...JP_OWN[locale]]) {
      fresh(); geoMode = "hit";
      const a = await appTurn(base, t, locale);
      R[`a|${pre}|${locale}|${t}`] = a.row;
      R[`a|${pre}|${locale}|${t}|1`] = (await appTurn(a.s, "1", locale)).row;
    }
    // b) 「城市, 國家」 outside combination choice.
    for (const t of CC_FRESH[locale]) { geoMode = "hit"; R[`b|fresh|${locale}|${t}`] = (await first(t, locale)).row; }
    {
      const [t1, t2] = CC_AFTER_MISS[locale];
      geoMode = "miss"; const m = await first(t1, locale);
      R[`b|miss|${locale}|${t1}`] = m.row;
      fresh(); geoMode = "hit"; const c = await appTurn(m.s, t2, locale);
      R[`b|miss|${locale}|${t2}`] = c.row;
      R[`b|miss|${locale}|${t2}|1`] = (await appTurn(c.s, "1", locale)).row;
    }
    // d) rule 7.
    geoMode = "hit";
    const kyoto = { "zh-TW": "12/10-12/14 京都 5天", en: "Kyoto 12/10-12/14 5 days", ja: "12/10-12/14 京都 5日間", ko: "12/10-12/14 교토 5일" }[locale];
    R[`d|step1|${locale}`] = (await first(kyoto, locale)).row;
    // ask_days with a kept 12/10–12/14 range (narrowing 日本 → 京都 asks the length).
    fresh(); const nk = await appTurn(j1, JP_OWN[locale][0].replace(/熱海|Atami|아타미/, (m) => m), locale);
    R[`d|askdays|${locale}|base`] = nk.row;
    const daysTexts = { "zh-TW": ["5", "3", "3天", "12/10-12/12 3天", "12/11-12/15", "12月"], en: ["5", "3", "3 days", "12/10-12/12 3 days"], ja: ["5", "3", "3日間"], ko: ["5", "3", "3일"] }[locale];
    for (const t of daysTexts) { fresh(); R[`d|askdays|${locale}|${t}`] = (await appTurn(nk.s, t, locale)).row; }
    // Not a days question: combination_choice on Sydney with 12/10-12/14 + 「3天」 / pending none.
    const s1 = (await first(STEP1[locale], locale)).s;
    R[`d|combo|${locale}|base`] = snapOf(s1, "STEP1", s1.lastAssistantReply);
    const three = { "zh-TW": "3天", en: "3 days", ja: "3日間", ko: "3일" }[locale];
    fresh(); R[`d|combo|${locale}|${three}`] = (await appTurn(s1, three, locale)).row;
    fresh(); R[`d|combo|${locale}|3`] = (await appTurn(s1, "3", locale)).row;
    fresh(); R[`d|combo|${locale}|5days`] = (await appTurn(s1, { "zh-TW": "5天", en: "5 days", ja: "5日間", ko: "5일" }[locale], locale)).row;
    const noPending = { ...clone(s1), pendingQuestion: undefined };
    fresh(); R[`d|nopending|${locale}|${three}`] = (await appTurn(noPending, three, locale)).row;
    fresh(); R[`d|nopending|${locale}|3`] = (await appTurn(noPending, "3", locale)).row;
    // globalPlanningTurn directly (pure).
    for (const [pq, t] of [["ask_days", "3"], ["ask_days", "5"], ["duration_choice", "3"], ["combination_choice", "3"], ["ask_days", three], ["ask_days", `12/10-12/12 ${three}`]]) {
      const ses = { ...clone(nk.s), pendingQuestion: { type: pq, options: [] } };
      const c = globalPlanning.globalPlanningTurn(ses, t);
      R[`d|gpt|${locale}|${pq}|${t}`] = c ? { days: c.days ?? null, start: c.startDate ?? null, end: c.endDate ?? null } : null;
    }
    // e) CONFIRMED sentences on the combination list (M9: App order with trustedCenter / trustedLocation).
    //    kinds: direct / miss × this (provider_this_turn, App args) / omit (no trustedLocation → wrapper cache) /
    //    locked (scope + provider location locked by an earlier turn → provider_locked); plain = 「改去熱海」 reference.
    const outside = (await first({ "zh-TW": "我要去雪梨", en: "I'm going to sydney", ja: "シドニーへ旅行", ko: "시드니 여행" }[locale], locale)).s;
    R[`e|outside-base|${locale}`] = snapOf(outside, "outside base", outside.lastAssistantReply);
    const preLock = async (label, s) => { await turnDest.resolveTrustedRecommendationSearchScope({ label, ctx: s.travelContext ?? { interests: [] }, session: s, locale, geocodeFn: authorityGeocodeFn }).catch(() => null); };
    for (const [missText, t] of CONFIRMED[locale]) {
      const target = tpc.classifyDestinationSwitchTurn(t).targetLabel ?? missText;
      freshAll(); geoMode = "hit";
      const plain = await appTurn(s1, plainOf(missText, t), locale);
      R[`e|plain|${locale}|${t}`] = plain.row;
      for (const kind of E_KINDS) {
        freshAll(); await freshAuthority(); geoMode = "hit";
        let base = s1;
        if (kind === "direct-roundtrip") {
          // Realistic provider_locked: the Authority verified the target earlier in this App session, the user
          // went back (the reset clears the left destination's scope lock), then switches to it again.
          const a1 = await appTurn(s1, t, locale);
          R[`e|${kind}|${locale}|${t}|first`] = a1.row;
          const back = await appTurn(a1.s, BACK[locale][t], locale);
          R[`e|${kind}|${locale}|${t}|back`] = back.row;
          if (locale === "ko") R[`e|koback|${locale}|${t}`] = (await appTurn(a1.s, KO_BACK_NEGATED, locale)).row;
          base = back.s; fresh();
        }
        if (kind.startsWith("miss")) {
          geoMode = "miss";
          const m = await appTurn(s1, missText, locale);
          R[`e|${kind}|${locale}|${t}|missturn`] = m.row;
          base = m.s; fresh(); geoMode = "hit";
        }
        if (kind.endsWith("locked")) {
          const g = authorityGeocodeLog.length;
          await preLock(target, base);
          const sc = resolvedScope.getResolvedDestinationScope(target);
          R[`e|${kind}|${locale}|${t}|prelock`] = { calls: authorityGeocodeLog.length - g, scope: sc ? `${sc.normalizedName}/${sc.latitude}/${sc.countryCode ?? "-"}/${sc.source}` : null, location: resolvedScope.getTrustedProviderLocation?.(target)?.placeId ?? null };
        }
        const a = await appTurn(base, t, locale, kind.endsWith("omit") ? { trustedLocation: "omit" } : {});
        R[`e|${kind}|${locale}|${t}`] = a.row;
        for (const next of NEXT[locale]) R[`e|${kind}|${locale}|${t}|next|${next}`] = (await appTurn(a.s, next, locale)).row;
        if (kind === "direct-this") {
          // App restart: every in-memory cache (scope locks, provider locations, discovery / pool) empty.
          for (const next of NEXT[locale]) { freshAll(); await freshAuthority(); R[`e|restart|${locale}|${t}|next|${next}`] = (await appTurn(a.s, next, locale)).row; }
        }
      }
      // Not choosing combinations: the negated switch keeps HEAD's E3 return.
      for (const [tag, base] of [["nopending", { ...clone(s1), pendingQuestion: undefined }], ["askdays", outside]]) {
        freshAll(); geoMode = "hit";
        R[`e|outside-${tag}|${locale}|${t}`] = (await appTurn(base, t, locale)).row;
      }
    }
  }
  R.cache = await cacheChecks();
  R.ccfmt = await countryFormatChecks();
  return R;
}
/** 「改去X」 reference sentence for a CONFIRMED sentence switching to X (the miss text names 熱海 for both zh pairs). */
const plainOf = (missText, t) => (/京都/.test(t) ? "改去京都" : missText);
const E_KINDS = ["direct-this", "direct-omit", "direct-locked", "direct-roundtrip", "miss-this", "miss-omit", "miss-locked"];
const isLocked = (kind) => kind.endsWith("locked") || kind === "direct-roundtrip";
const BACK = { "zh-TW": { "不去雪梨了，改去熱海": "不去熱海了，改去雪梨", "雪梨不去了，改去京都": "京都不去了，改去雪梨" }, en: { "not sydney anymore, switch to Atami": "not atami anymore, switch to sydney" },
  ja: { "シドニーはやめて、熱海に変更": "熱海はやめて、シドニーに変更" }, ko: { "시드니 말고 해운대로 바꿔": "시드니로 바꿔" } };
// Observed (M9): 「해운대 말고 시드니로 바꿔」 on the Haeundae list does not switch back; reported separately (INFO row).
const KO_BACK_NEGATED = "해운대 말고 시드니로 바꿔";
const NEXT = { "zh-TW": ["1", "5天", "推薦組合", "幫我排行程", "好"], en: ["1", "5 days", "recommend combinations"], ja: ["1", "5日間", "おすすめの組み合わせ"], ko: ["1", "5일", "조합 추천해줘"] };

/** b) provider-location cache (resolved-destination-scope.ts): collisions, clearing, overwrite. WORK only. */
async function cacheChecks() {
  const get = resolvedScope.getTrustedProviderLocation;
  if (!get) return null;
  const loc = (city, country, lat, lng, id, extra = {}) => ({ placeId: id, city, country, lat, lng, formattedName: city, displayLabel: city, ...extra });
  const lock = (destination, l, withLocation = true) => resolvedScope.lockDestinationCoordinatesFromGeocode({ destination, lat: l.lat, lng: l.lng, country: l.country, ...(withLocation ? { location: l } : {}) });
  const R = {};
  const pid = (x) => x?.placeId ?? null;
  resolvedScope.clearResolvedDestinationScope();
  const sydney = loc("Sydney", "Australia", -33.8688, 151.2093, "P_SYD");
  lock("雪梨", sydney);
  R.sydneyAsSydney = pid(get("Sydney"));
  R.sydneyAsAtami = pid(get("熱海"));
  const atami = loc("熱海市", "日本", 35.0959, 139.0717, "P_ATAMI");
  lock("熱海", atami);
  R.atami = pid(get("熱海"));
  R.atamiAsSydney = pid(get("雪梨"));
  resolvedScope.clearResolvedDestinationScope("熱海");
  R.atamiAfterClear = pid(get("熱海"));
  R.sydneyAfterAtamiClear = pid(get("雪梨"));
  resolvedScope.clearResolvedDestinationScope();
  R.sydneyAfterClearAll = pid(get("雪梨"));
  // 京都府 / 京都: one normalized label (prefecture answer reused for the city label).
  lock("京都府", loc("京都府", "日本", 35.0212, 135.7556, "P_KYOTO_PREF", { region: "京都府" }));
  R.kyotoPrefAsKyoto = pid(get("京都"));
  resolvedScope.clearResolvedDestinationScope();
  // Same label, a different place locked later without a provider location: the old answer must not come back.
  lock("府中", loc("府中市", "日本", 35.6689, 139.4776, "P_FUCHU_TOKYO"));
  lock("府中", loc("府中市", "日本", 34.5683, 133.2366, "-"), false);
  R.fuchuAfterOtherLock = pid(get("府中"));
  resolvedScope.clearResolvedDestinationScope();
  // A lock the scope gate rejects (京都 at Sydney coordinates) after a valid one.
  lock("京都", loc("京都市", "日本", 35.0116, 135.7681, "P_KYOTO"));
  lock("京都", loc("Kyoto", "Australia", -33.8688, 151.2093, "P_WRONG"));
  R.kyotoAfterRejected = pid(get("京都"));
  R.kyotoScopeAfterRejected = resolvedScope.getResolvedDestinationScope("京都")?.latitude ?? null;
  resolvedScope.clearResolvedDestinationScope();
  return R;
}

/** d) country-level 日本 trip + a same-country city: geocode country in any spelling never reads as another country. */
async function countryFormatChecks() {
  const R = {};
  for (const locale of ["zh-TW", "en", "ja", "ko"]) {
    curLocale = locale; freshAll(); geoMode = "hit";
    const j1 = (await first(STEP1_JP[locale], locale)).s;
    const jc = { ...clone(j1), pendingQuestion: { type: "combination_choice", options: ["1", "2", "3"], baseDestination: j1.travelContext?.destination, destinationCountry: j1.travelContext?.destinationCountry } };
    const turns = { "zh-TW": ["改去熱海", "我要去熱海", "改去京都", "我要去大阪", "改去北海道"], en: ["switch to Atami", "switch to Kyoto", "switch to Osaka", "switch to Hokkaido"],
      ja: ["熱海に変更", "京都に変更", "大阪に変更", "北海道に変更"], ko: ["아타미로 바꿔", "교토로 바꿔", "오사카로 바꿔", "홋카이도로 바꿔"] }[locale];
    const places = { 熱海: [35.0959, 139.0717, "熱海市", "Shizuoka"], Atami: [35.0959, 139.0717, "Atami", "Shizuoka"], 아타미: [35.0959, 139.0717, "아타미시", "Shizuoka"],
      京都: [35.0116, 135.7681, "京都市", "Kyoto"], Kyoto: [35.0116, 135.7681, "Kyoto", "Kyoto"], 교토: [35.0116, 135.7681, "교토시", "Kyoto"],
      大阪: [34.6937, 135.5023, "大阪市", "Osaka"], Osaka: [34.6937, 135.5023, "Osaka", "Osaka"], 오사카: [34.6937, 135.5023, "오사카시", "Osaka"],
      北海道: [43.2203, 142.8635, "", "北海道"], Hokkaido: [43.2203, 142.8635, "", "Hokkaido"], 홋카이도: [43.2203, 142.8635, "", "홋카이도"] };
    for (const [pre, base] of [["jp", j1], ["jpc", jc]]) for (const t of turns) for (const country of ["JP", "jp", "Japan", "日本", "日本国", "일본", "japan"]) {
      const merged = travelContext.mergeTravelContext(clone(base), t, base.lastAssistantReply);
      const cand = merged.context.destinationCandidate;
      const key = `${pre}|${locale}|${t}|${country}`;
      if (cand?.status !== "pending") { R[key] = { candidate: cand ? `${cand.raw}/${cand.status}` : null, mergeReset: merged.session.planningSessionId !== base.planningSessionId }; continue; }
      const p = places[Object.keys(places).find((k) => cand.raw.includes(k))];
      const resolved = await globalPlanning.resolveGlobalPlanningCandidate(merged.session, locale, async () => p ? { rawResultCount: 1, location: { placeId: `P_${cand.raw}`, lat: p[0], lng: p[1], city: p[2], region: p[3], country, formattedName: p[2] || p[3], displayLabel: p[2] || p[3] } } : { rawResultCount: 0, location: null });
      R[key] = { candidate: `${cand.raw}/${resolved.travelContext?.destinationCandidate?.status ?? "-"}`, countryTrip: Boolean(cand.countryTrip),
        reset: resolved.planningSessionId !== base.planningSessionId, dest: resolved.travelContext?.destination ?? null, code: resolved.travelContext?.destinationCountryCode ?? null,
        pending: resolved.pendingQuestion?.type ?? null, offered: (resolved.travelContext?.offeredCombinations ?? []).length };
    }
  }
  freshAll();
  return R;
}

if (CHILD) {
  const r = await runAll();
  process.stdout.write(`@@M7_JSON@@${JSON.stringify(r)}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}
function headResults() {
  if (!headDir) return null;
  const self = "scripts/verify-m7-combination-review.mjs";
  if (!existsSync(join(headDir, self)) || readFileSync(join(headDir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(headDir, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 400_000, maxBuffer: 64 << 20 });
  const m = (r.stdout ?? "").match(/@@M7_JSON@@([\s\S]*?)@@END@@/);
  if (!m) { out(`NOTE HEAD child produced no JSON (status ${r.status}): ${(r.stdout ?? "").slice(-400)} ${(r.stderr ?? "").slice(-800)}`); return null; }
  return JSON.parse(m[1]);
}

const W = await runAll();
const H = headResults();
const j = (v) => JSON.stringify(v);
const failures = [];
const check = (name, fn) => { try { fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 10).join("\n  ")}`); } };
const LAST_RESORT = /暫時無法取得足夠的實際地點組合|couldn.t get enough real place combinations|実際のスポットの組み合わせ|실제 장소 조합을 충분히/i;
const cc = (x) => countryNorm.normalizeCountryReference(x).countryCode ?? null;

// c) labels
for (const x of LABELS) {
  const w = W.labels[x]; const h = H?.labels?.[x];
  out(`ROW c 「${x}」 WORK ${j(w)}${h ? ` HEAD ${j(h)}` : ""}`);
}
// M8 spec 4 (approved): only 府／都／縣 two-character names keep their suffix; 「津市」「堺市」 follow HEAD (→ 津 / 堺).
for (const x of ["別府", "甲府", "成都", "府中", "市川", "都城"]) check(`c 「${x}」 keeps its two characters`, () => assert.equal(W.labels[x].label, x, j(W.labels[x])));
for (const [x, want] of [["別府市", "別府"], ["京都府", "京都"], ["甲府市", "甲府"], ["成都市", "成都"], ["津市", "津"], ["堺市", "堺"]]) check(`c 「${x}」 → 「${want}」`, () => assert.equal(W.labels[x].label, want, j(W.labels[x])));
if (H) for (const x of ["津市", "堺市"]) check(`c 「${x}」 same label as HEAD`, () => assert.equal(W.labels[x].label, H.labels[x].label, `WORK ${j(W.labels[x])} HEAD ${j(H.labels[x])}`));
if (H) for (const x of LABELS) {
  const w = W.labels[x]; const h = H.labels[x];
  // Not worse than HEAD: a label HEAD knew stays known; a HEAD destination scope stays the same.
  check(`c 「${x}」 not worse than HEAD (known / scope / parse)`, () => {
    if (h.known) assert.equal(w.known, true, `WORK ${j(w)} HEAD ${j(h)}`);
    if (h.scope && h.known) assert.equal(w.scope, h.scope, `WORK ${j(w)} HEAD ${j(h)}`);
    if (h.parsed && h.known) assert.equal(w.parsed, h.parsed, `WORK ${j(w)} HEAD ${j(h)}`);
  });
}

for (const locale of Object.keys(STEP1)) {
  // a)
  for (const pre of ["jp", "jpc"]) for (const t of [...JP_OTHER[locale], ...JP_OWN[locale]]) {
    const w = W[`a|${pre}|${locale}|${t}`]; const w1 = W[`a|${pre}|${locale}|${t}|1`]; const h = H?.[`a|${pre}|${locale}|${t}`]; const h1 = H?.[`a|${pre}|${locale}|${t}|1`];
    out(`ROW a [${locale}] ${pre} 「${t}」\n     WORK ${j(w)}\n     HEAD ${j(h)}\n     WORK→1 ${j(w1)}\n     HEAD→1 ${j(h1)}`);
    const other = JP_OTHER[locale].includes(t);
    // Blocking question of the task: Korean city on the Japan trip → wrong combinations or mixed countries?
    if (other) check(`a [${locale}] ${pre} 「${t}」: no mixed countries, combinations (if any) are the named city's own`, () => {
      for (const [tag, r] of [["turn", w], ["→1", w1]]) {
        const codes = [r.code, cc(r.country), cc(r.pendingCountry), cc(r.trip?.split("/")[1])].filter(Boolean);
        assert.ok(new Set(codes).size <= 1, `${tag}: mixed countries ${j(codes)}\n  ${j(r)}`);
        if (r.offered > 0) {
          const destKey = keyOf(r.dest) ?? keyOf(r.base);
          assert.ok(destKey && GEO[destKey].re.test(r.offeredFirst ?? "") || LOCAL[destKey]?.some((l) => (r.offeredFirst ?? "").includes(l)), `${tag}: combinations not of ${r.dest}: ${r.offeredFirst}\n  ${j(r)}`);
        }
      }
    });
    if (other && h) out(`INFO a [${locale}] ${pre} 「${t}」 WORK ${w.branch}/${w.dest}/${w.code} reset=${w.sidChanged} vs HEAD ${h.branch}/${h.dest}/${h.code}${w.branch !== h.branch ? "  ← differs from HEAD" : ""}`);
    // M8 spec 2: another country's city WITH switch wording on a country-level trip = destination switch
    // (reset, dates kept, that city's combinations listed); the bare name keeps HEAD's country-mismatch confirmation.
    const bare = other && t === JP_OTHER[locale][JP_OTHER[locale].length - 1];
    if (other && !bare) check(`a [${locale}] ${pre} 「${t}」: another country's city is a destination switch (reset, dates kept, Haeundae combinations, then 「1」 no reset / last-resort)`, () => {
      const info = `\n  WORK ${j(w)}\n  WORK→1 ${j(w1)}`;
      assert.equal(w.sidChanged, true, `no reset${info}`);
      assert.equal(keyOf(w.dest) ?? (LOCAL.haeundae.includes(w.dest) ? "haeundae" : null), "haeundae", `dest${info}`);
      assert.equal(cc(w.country) ?? w.code, "KR", `country${info}`);
      assert.equal(w.start, "2026-12-10", `start${info}`); assert.equal(w.end, "2026-12-14", `end${info}`); assert.equal(w.days, 5, `days${info}`);
      assert.equal(w.pending, "combination_choice", `pending${info}`); assert.ok(w.offered > 0, `offered${info}`);
      assert.ok(w.geo.length + w.ageo.length + w.dgeo.length <= 1, `geocode calls ${j([w.geo, w.ageo, w.dgeo])}${info}`);
      assert.ok(!LAST_RESORT.test(w.reply) && !LAST_RESORT.test(w1.reply), `last-resort${info}`);
      assert.equal(w1.sidChanged, false, `「1」 reset again${info}`);
    });
    if (bare && h) check(`a [${locale}] ${pre} bare 「${t}」: same as HEAD (country mismatch confirmation, no reset)`, () => {
      // Typographic apostrophe (’ → ') is an earlier approved copy change, not a behaviour difference.
      const pk = (x) => ({ branch: x.branch, dest: x.dest, cand: x.cand, pending: x.pending, sidChanged: x.sidChanged, start: x.start, reply: x.reply.replace(/’/g, "'") });
      assert.deepEqual(pk(w), pk(h), `WORK ${j(pk(w))}\n  HEAD ${j(pk(h))}`);
      assert.equal(w.sidChanged, false, j(w));
    });
  }
  // b)
  for (const t of CC_FRESH[locale]) {
    const w = W[`b|fresh|${locale}|${t}`]; const h = H?.[`b|fresh|${locale}|${t}`];
    out(`ROW b fresh [${locale}] 「${t}」\n     WORK ${j(w)}\n     HEAD ${j(h)}`);
    // Not worse than HEAD: same destination level, dates not dropped, no new last-resort copy, geocode not increased.
    if (h) check(`b [${locale}] fresh 「${t}」: not worse than HEAD (destination level / dates / last-resort / geocode count)`, () => {
      const info = `\n  WORK ${j(w)}\n  HEAD ${j(h)}`;
      assert.equal(w.type === "country", h.type === "country", `destination level changed${info}`);
      if (h.dest) assert.ok(w.dest, `destination lost${info}`);
      if (h.start) assert.equal(w.start, h.start, `dates dropped${info}`);
      if (!LAST_RESORT.test(h.reply)) assert.ok(!LAST_RESORT.test(w.reply), `new last-resort copy${info}`);
      assert.ok(w.geo.length <= h.geo.length, `more geocode calls${info}`);
    });
  }
  {
    const [t1, t2] = CC_AFTER_MISS[locale];
    const m = W[`b|miss|${locale}|${t1}`]; const w = W[`b|miss|${locale}|${t2}`]; const w1 = W[`b|miss|${locale}|${t2}|1`];
    const hm = H?.[`b|miss|${locale}|${t1}`]; const h = H?.[`b|miss|${locale}|${t2}`]; const h1 = H?.[`b|miss|${locale}|${t2}|1`];
    out(`ROW b after-miss [${locale}] 「${t1}」(miss) WORK ${j(m)}\n     HEAD ${j(hm)}\n   → 「${t2}」 WORK ${j(w)}\n     HEAD ${j(h)}\n   → 「1」 WORK ${j(w1)}\n     HEAD ${j(h1)}`);
    check(`b [${locale}] after a miss outside combinations 「${t2}」: one geocode, city + country, dates kept, no last-resort`, () => {
      assert.equal(w.geo.length, 1, j(w));
      assert.notEqual(w.type, "country", `became a country destination ${j(w)}`);
      assert.equal(w.start, m.start, `dates ${j(w)}`);
      assert.ok(!LAST_RESORT.test(w.reply) && !LAST_RESORT.test(w1.reply), `last-resort copy ${j(w)} ${j(w1)}`);
    });
  }
  // d)
  {
    const s = W[`d|step1|${locale}`];
    out(`ROW d step1 [${locale}] ${j(s)}`);
    check(`d [${locale}] STEP1 consistent range + days keeps 12/10–12/14 and 5 days`, () => { assert.equal(s.start, "2026-12-10", j(s)); assert.equal(s.end, "2026-12-14", j(s)); assert.equal(s.days, 5, j(s)); });
    out(`ROW d askdays base [${locale}] ${j(W[`d|askdays|${locale}|base`])}${H ? `\n     HEAD ${j(H[`d|askdays|${locale}|base`])}` : ""}`);
    for (const key of Object.keys(W).filter((k) => k.startsWith(`d|askdays|${locale}|`) && !k.endsWith("|base"))) {
      const w = W[key]; const h = H?.[key];
      out(`ROW ${key}\n     WORK ${j({ days: w.days, start: w.start, end: w.end, prov: w.prov, pending: w.pending, reply: w.reply.slice(0, 120) })}\n     HEAD ${h ? j({ days: h.days, start: h.start, end: h.end, prov: h.prov, pending: h.pending, reply: h.reply.slice(0, 120) }) : "-"}`);
    }
    for (const key of Object.keys(W).filter((k) => k.startsWith(`d|gpt|${locale}|`))) out(`ROW ${key} WORK ${j(W[key])} HEAD ${j(H?.[key] ?? null)}`);
    const g = (pq, t) => W[`d|gpt|${locale}|${pq}|${t}`];
    const three = { "zh-TW": "3天", en: "3 days", ja: "3日間", ko: "3일" }[locale];
    check(`d [${locale}] globalPlanningTurn rule 7: ask_days / duration_choice 「3」 clears, 「5」 keeps, combination_choice 「3」 not via rule 7, a new range wins`, () => {
      assert.deepEqual(g("ask_days", "3"), { days: 3, start: null, end: null });
      assert.deepEqual(g("duration_choice", "3"), { days: 3, start: null, end: null });
      assert.equal(g("ask_days", "5")?.start, "2026-12-10");
      assert.equal(g("ask_days", three)?.start ?? null, null, `「${three}」 ${j(g("ask_days", three))}`);
      const nr = g("ask_days", `12/10-12/12 ${three}`);
      assert.equal(nr?.start, "2026-12-10", j(nr)); assert.equal(nr?.end, "2026-12-12", j(nr));
    });
    // M8 spec 5: while choosing combinations a bare trip length that contradicts the range (no new dates) wins and
    // clears the range; a length equal to the range keeps it; a bare 「3」 stays a combination number.
    {
      const c3 = W[`d|combo|${locale}|${three}`]; const c5 = W[`d|combo|${locale}|5days`]; const n3 = W[`d|combo|${locale}|3`];
      out(`ROW d combo [${locale}] 「${three}」 ${j({ days: c3.days, start: c3.start, end: c3.end, pending: c3.pending, sid: c3.sidChanged })} 「5」days ${j({ days: c5.days, start: c5.start, pending: c5.pending })} 「3」 ${j({ branch: n3.branch, days: n3.days, start: n3.start, pending: n3.pending, reply: n3.reply.slice(0, 80) })}`);
      check(`d [${locale}] combination_choice 「${three}」 vs 12/10–12/14: 3 days wins, conflicting range cleared; 「5」-day reply keeps the range; 「3」 is combination 3`, () => {
        assert.equal(c3.days, 3, j(c3)); assert.equal(c3.start, null, j(c3)); assert.equal(c3.end, null, j(c3));
        assert.equal(c5.days, 5, j(c5)); assert.equal(c5.start, "2026-12-10", j(c5));
        assert.equal(n3.days, 5, j(n3)); assert.equal(n3.start, "2026-12-10", j(n3));
        assert.ok(!LAST_RESORT.test(c3.reply) && !LAST_RESORT.test(n3.reply), `${j(c3)} ${j(n3)}`);
      });
    }
    if (locale === "ko") check("ko combinationMonthUnchanged copy: 「일정이 원래 {month}이라서」", () => {
      const s = copyMod.chatRuntimeCopy("combinationMonthUnchanged", "ko", { month: "12월", start: "12/10", end: "12/14" });
      assert.ok(s.startsWith("일정이 원래 12월이라서"), s);
    });
    for (const key of [`d|combo|${locale}|${three}`, `d|nopending|${locale}|${three}`, `d|nopending|${locale}|3`]) {
      const w = W[key]; const h = H?.[key];
      out(`ROW ${key}\n     WORK ${j({ branch: w.branch, days: w.days, start: w.start, end: w.end, pending: w.pending, reply: w.reply.slice(0, 120) })}\n     HEAD ${h ? j({ branch: h.branch, days: h.days, start: h.start, end: h.end, pending: h.pending, reply: h.reply.slice(0, 120) }) : "-"}`);
      if (h && !key.startsWith(`d|combo|`)) check(`d [${locale}] ${key}: outside ask_days the dates behave as HEAD`, () => { assert.equal(w.start, h.start, `WORK ${j(w)}\n  HEAD ${j(h)}`); assert.equal(w.days, h.days, `WORK ${j(w)}\n  HEAD ${j(h)}`); });
    }
  }
  // e) M8 spec 1, App order (9415 args, 9606 relist instead of the E3 return, pin / merge / C3 guards).
  for (const [missText, t] of CONFIRMED[locale]) {
    const p = W[`e|plain|${locale}|${t}`];
    const plainText = plainOf(missText, t);
    const k = keyOf(plainText);
    const pk = (x) => x && { branch: x.branch, via: x.via ?? null, authority: x.authority ?? null, dest: x.dest, code: x.code, trip: x.trip, wrapperTrip: x.wrapperTrip ?? null, days: x.days, start: x.start, end: x.end, pending: x.pending, offered: x.offered, offeredFirst: x.offeredFirst,
      sidChanged: x.sidChanged, chainReset: x.chainReset ?? null, geo: [x.geo?.length, x.ageo?.length, x.dgeo?.length], discoveryRuns: x.discoveryRuns, placesCalls: x.placesCalls, reply: (x.reply ?? "").slice(0, 120) };
    out(`ROW e plain [${locale}] 「${plainText}」 WORK ${j(pk(p))}${H ? `\n     HEAD ${j(pk(H[`e|plain|${locale}|${t}`]))}` : ""}`);
    for (const kind of E_KINDS) {
      const w = W[`e|${kind}|${locale}|${t}`]; const h = H?.[`e|${kind}|${locale}|${t}`];
      const mt = W[`e|${kind}|${locale}|${t}|missturn`];
      const pl = W[`e|${kind}|${locale}|${t}|prelock`];
      const confirmed = w.cls === "CONFIRMED_SWITCH";
      for (const step of ["first", "back"]) { const x = W[`e|${kind}|${locale}|${t}|${step}`]; if (x) out(`ROW e ${kind} [${locale}] ${step} ${j(pk(x))}`); }
      out(`ROW e ${kind} [${locale}] cls=${w.cls} ${pl ? `prelock ${j(pl)} ` : ""}${mt ? `「${missText}」(miss) ${j({ branch: mt.branch, cand: mt.cand, start: mt.start })}\n   → ` : ""}「${t}」\n     WORK ${j(pk(w))}\n     HEAD ${j(pk(h))}`);
      const info = `\n  WORK  ${j(pk(w))}\n  PLAIN ${j(pk(p))}`;
      check(`e [${locale}] ${kind} 「${t}」: re-lists ${k} combinations this turn, same as 「${plainText}」 (one reset, dates kept, no old destination, no extra geocode / discovery)`, () => {
        assert.ok(!/^B |stop|wrapper_|k2_|p1/.test(w.branch), `turn stopped: ${w.branch}${info}`);
        if (confirmed) {
          assert.equal(w.via, "confirmed+relist", `not the relist path${info}`);
          // 京都 is a local-table destination: the Authority never calls the provider for it.
          if (k !== "kyoto") assert.equal(w.authority, isLocked(kind) ? "provider_locked" : "provider_this_turn", `authority${info}`);
          assert.equal(w.chainReset, false, `second reset after the wrapper${info}`);
        }
        assert.equal(w.sidChanged, true, `no reset${info}`);
        assert.equal(tpc.normalizeDestinationLabel(w.dest ?? ""), tpc.normalizeDestinationLabel(p.dest ?? ""), `dest${info}`); assert.equal(w.code, p.code, `country code${info}`);
        assert.equal(w.start, "2026-12-10", `start${info}`); assert.equal(w.end, "2026-12-14", `end${info}`); assert.equal(w.days, 5, `days${info}`);
        assert.equal(w.pending, p.pending, `pending${info}`); assert.equal(w.pending, "combination_choice", `pending${info}`);
        assert.equal(w.offered, p.offered, `offered count${info}`); assert.equal(w.offeredFirst, p.offeredFirst, `combinations differ from 「${plainText}」${info}`);
        assert.ok(!/Sydney|雪梨|シドニー|시드니/.test(`${w.trip ?? ""} ${w.offeredFirst ?? ""}`), `old destination in trip / combinations${info}`);
        assert.ok(!LAST_RESORT.test(w.reply), `last-resort copy${info}`);
        const total = (x) => x.geo.length + x.ageo.length + x.dgeo.length;
        assert.ok(total(w) <= Math.max(1, total(p)), `geocode calls ${j([w.geo, w.ageo, w.dgeo])} vs plain ${j([p.geo, p.ageo, p.dgeo])}${info}`);
        if (isLocked(kind) && confirmed) assert.equal(w.ageo.length + w.geo.length, 0, `provider_locked made a provider call ${j([w.geo, w.ageo])}${info}`);
        assert.ok(w.placesCalls <= p.placesCalls, `Places calls ${w.placesCalls} > plain ${p.placesCalls}${info}`);
        assert.ok(w.discoveryRuns <= 1, `discovery ran ${w.discoveryRuns} times${info}`);
        assert.ok(![...w.geo, ...w.ageo, ...w.dgeo].some((q) => /不去|やめて|말고|anymore/.test(q)), `whole sentence geocoded${info}`);
      });
      if (k !== "kyoto" && confirmed) check(`e [${locale}] ${kind} 「${t}」: the wrapper carries the Authority's provider location (${kind.endsWith("this") ? "App argument" : "wrapper cache"})`, () => {
        assert.match(w.wrapperTrip ?? "", new RegExp(`ChIJ_${GEO[k].code}_`), `wrapper tripDestination ${w.wrapperTrip}${info}`);
      });
      const nexts = [...NEXT[locale].map((n) => [`e|${kind}|${locale}|${t}|next|${n}`, n]), ...(kind === "direct-this" ? NEXT[locale].map((n) => [`e|restart|${locale}|${t}|next|${n}`, `${n} (after App restart)`]) : [])];
      for (const [key, n] of nexts) {
        const x = W[key];
        out(`ROW ${key} WORK ${j({ branch: x.branch, dest: x.dest, start: x.start, days: x.days, pending: x.pending, sid: x.sidChanged, geo: [x.geo.length, x.ageo.length, x.dgeo.length], reply: x.reply.slice(0, 120) })}`);
        check(`e [${locale}] ${kind} 「${t}」 → 「${n}」: no last-resort copy, no further reset`, () => {
          assert.ok(!LAST_RESORT.test(x.reply), `${x.reply}\n  ${j(x)}`);
          assert.ok(x.reply.trim(), `empty reply ${j(x)}`);
          assert.equal(x.sidChanged, false, `reset ${j(x)}`);
          assert.ok(!/Sydney|雪梨|シドニー|시드니/.test(`${x.dest ?? ""} ${x.trip ?? ""}`), `old destination ${j(x)}`);
        });
      }
    }
    if (W[`e|koback|${locale}|${t}`]) out(`INFO e [ko] Haeundae list → 「${KO_BACK_NEGATED}」 WORK ${j(pk(W[`e|koback|${locale}|${t}`]))}${H?.[`e|koback|${locale}|${t}`] ? `\n     HEAD ${j(pk(H[`e|koback|${locale}|${t}`]))}` : ""}`);
    for (const tag of ["nopending", "askdays"]) {
      const w = W[`e|outside-${tag}|${locale}|${t}`]; const h = H?.[`e|outside-${tag}|${locale}|${t}`];
      out(`ROW e outside-${tag} [${locale}] 「${t}」 WORK ${j(pk(w))}${h ? `\n     HEAD ${j(pk(h))}` : ""}`);
      if (h) check(`e [${locale}] outside combination choice (${tag}) 「${t}」: same as HEAD (E3 return, one reset)`, () => {
        assert.equal(w.branch, h.branch, `WORK ${j(pk(w))}\n  HEAD ${j(pk(h))}`);
        assert.equal(w.sidChanged, h.sidChanged, `WORK ${j(pk(w))}\n  HEAD ${j(pk(h))}`);
        assert.equal(w.dest, h.dest, `WORK ${j(pk(w))}\n  HEAD ${j(pk(h))}`);
        if (/^e3_applied/.test(w.branch)) assert.equal(w.discoveryRuns, 0, `discovery ran on the E3 turn ${j(pk(w))}`);
      });
    }
  }
}
// b) provider-location cache.
if (W.cache) {
  out(`ROW cache ${j(W.cache)}`);
  check("cache: an old destination's provider location never answers for another label; clear (one / all) removes it", () => {
    const c = W.cache;
    assert.equal(c.sydneyAsAtami, null, j(c)); assert.equal(c.atami, "P_ATAMI", j(c));
    assert.notEqual(c.atamiAsSydney, "P_ATAMI", j(c)); assert.ok([null, "P_SYD"].includes(c.sydneyAsSydney), j(c));
    assert.equal(c.atamiAfterClear, null, j(c)); assert.equal(c.sydneyAfterAtamiClear, "P_SYD", j(c)); assert.equal(c.sydneyAfterClearAll, null, j(c));
  });
  check("cache: same label locked again for another place (no provider location) → the old answer is not returned", () => assert.equal(W.cache.fuchuAfterOtherLock, null, j(W.cache)));
  // The provider location follows the scope lock: returned only while it is the same answer (same center).
  check("cache: the trusted location always agrees with the label's current scope lock (no stale / foreign answer)", () => {
    const c = W.cache;
    if (c.kyotoAfterRejected === "P_WRONG") assert.ok(Math.abs(c.kyotoScopeAfterRejected - -33.8688) < 0.05, j(c));
    if (c.kyotoAfterRejected === "P_KYOTO") assert.ok(Math.abs(c.kyotoScopeAfterRejected - 35.0116) < 0.05, j(c));
  });
  out(`INFO cache: a second 京都 lock at Sydney coordinates (country Australia) → scope lat ${W.cache.kyotoScopeAfterRejected}, trusted location ${W.cache.kyotoAfterRejected} (validateDestinationScope accepted it, as in HEAD; the cache only mirrors the scope)`);
  out(`INFO cache: 京都府 lock read back for 「京都」 = ${W.cache.kyotoPrefAsKyoto} (same normalized label, same scope lock as HEAD)`);
}
// d) same-country city on a 日本 trip, geocode country in any format.
for (const [key, r] of Object.entries(W.ccfmt ?? {})) {
  if (!("reset" in r)) continue;
  check(`d-fmt ${key}: same-country city is never another country (no reset, JP)`, () => {
    assert.equal(r.reset, false, j(r));
    if (r.code) assert.equal(r.code, "JP", j(r));
  });
}
out(`INFO d-fmt rows ${Object.keys(W.ccfmt ?? {}).length}: ${j(Object.fromEntries(Object.entries(W.ccfmt ?? {}).filter(([k]) => /\|(JP|日本国)$/.test(k))))}`);
out(`INFO harness: APP_RELISTS=${APP_RELISTS} APP_PASSES_TRUSTED=${APP_PASSES_TRUSTED}`);
check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
if (!H) out("NOTE: HEAD comparison not run");
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.exit(failures.length ? 1 : 0);
