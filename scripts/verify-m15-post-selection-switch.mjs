/**
 * M15 (tester, independent pre-release review of M14). App-order harness copied from
 * verify-m11-combination-roundtrip.mjs (A2 gate → CONFIRMED wrapper or NO_SWITCH chain), tolerant
 * module loading so the same scenarios also run in a HEAD snapshot (`--head-dir=<snap>`; the script
 * copies itself there and runs with `--child`, rows compared as JSON).
 *  a) after a combination was picked (「1」), zh negated 「不去熱海了，改去雪梨」 (CONFIRMED wrapper) and the
 *     en / ja / ko equivalents: what the user sees this turn and the next turn.
 *  b) itinerary already generated (App trip_created cleanup) / generation crashed mid-way / generation
 *     failed: switch city (four locales, local and geocoded targets): old trip state cleared, new
 *     combinations, dates kept.
 *  c) after 「1」 with another pending question (itinerary_next_step / trip_style_choice / ask_preference):
 *     switch city, WORK vs HEAD.
 *  d) finalizedScopePatchFor: same-place scope adoption (country / city never lost), discovery failure,
 *     country-level trip narrowing to a city — WORK vs HEAD field comparison.
 *  e) typed 海雲台 / Haeundae / 해운대 (geocode Haeundae-gu) then 「not 海雲台 anymore, switch to Sydney」 (four locales).
 * fetch is stubbed (must stay 0); geocode / Places are fixtures.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=580 scripts/verify-m15-post-selection-switch.mjs [-- --head-dir=<snapshot>] [--only=a,b,c,d,e]
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const ONLY = argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const want = (sec) => !ONLY || ONLY.includes(sec);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 540_000).unref();
let fetchCalls = 0;
globalThis.fetch = async (...a) => { fetchCalls++; throw new Error("NO_NETWORK " + String(a[0])); };
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);

const resolvedScope = await load("src/lib/ai/resolved-destination-scope.ts");
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
const partialApi = await loadOpt("src/lib/ai/combination-partial-modify-reply.ts");
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
const planSession = await load("src/lib/ai/ai-planning-session.ts");
const tripStyle = await loadOpt("src/lib/ai/ai-trip-style.ts");
const numericAuth = await loadOpt("src/lib/ai/numeric-selection-authority.ts");
let authorityInstance = 0;
let turnDest = await load("src/lib/ai/chat-turn-destination.ts");
const freshAuthority = async () => { turnDest = await load(`src/lib/ai/chat-turn-destination.ts?m15=${++authorityInstance}`); };
const geoClar = await load("src/lib/ai/destination-geographic-clarification.ts");
const contRec = await load("src/lib/ai/continue-recommendation-intent.ts");
const placeRecIntent = await load("src/lib/ai/place-recommendation-intent/parse.ts");
const APP_SRC = readFileSync("src/routes/_app.chat.tsx", "utf8");
const APP_RELISTS = APP_SRC.includes("switchRelistsCombinations");

// ------------------------------------------------------------------ fixtures (m11)
const GEO = {
  sydney: { re: /sydney|雪梨|シドニー|시드니/i, city: "Sydney", region: "New South Wales", country: "Australia", code: "AU", lat: -33.8688, lng: 151.2093 },
  kyoto: { re: /kyoto|京都|교토/i, city: "Kyoto", region: "Kyoto", country: "Japan", code: "JP", lat: 35.0116, lng: 135.7681 },
  atami: { re: /atami|熱海|热海|아타미/i, city: "Atami", region: "Shizuoka", country: "Japan", code: "JP", lat: 35.0959, lng: 139.0717 },
  beppu: { re: /beppu|別府|别府|벳푸/i, city: "Beppu", region: "Oita", country: "Japan", code: "JP", lat: 33.2846, lng: 131.4912 },
  haeundae: { re: /haeundae|해운대|海雲台|海雲臺|海云台/i, city: "Haeundae-gu", region: "Busan", country: "South Korea", code: "KR", lat: 35.1631, lng: 129.1635 },
  tokyo: { re: /tokyo|東京|도쿄/i, city: "Tokyo", region: "Tokyo", country: "Japan", code: "JP", lat: 35.6762, lng: 139.6503 },
  // Discovery-failure fixture: geocodes fine, Places always empty, never discovered elsewhere in the run.
  nikko: { re: /nikko|日光|닛코/i, city: "Nikko", region: "Tochigi", country: "Japan", code: "JP", lat: 36.7199, lng: 139.6982 },
};
const LOCAL = { sydney: ["Sydney", "雪梨", "シドニー", "시드니"], kyoto: ["Kyoto", "京都市", "京都市", "교토시"], atami: ["Atami", "熱海市", "熱海市", "아타미시"],
  beppu: ["Beppu", "別府市", "別府市", "벳푸시"], haeundae: ["Haeundae-gu", "海雲臺區", "海雲台区", "해운대구"], tokyo: ["Tokyo", "東京", "東京都", "도쿄"], nikko: ["Nikko", "日光市", "日光市", "닛코시"] };
let curLocale = "en";
const localCity = (k) => LOCAL[k][["en", "zh-TW", "ja", "ko"].indexOf(curLocale)] ?? GEO[k].city;
const keyOf = (q) => Object.keys(GEO).find((k) => GEO[k].re.test(q ?? ""));
const destKeyOf = (d) => keyOf(d) ?? Object.keys(LOCAL).find((k) => LOCAL[k].includes(d ?? ""));
const geocodeLog = [];
const locationOf = (k) => { const d = GEO[k]; return { placeId: `ChIJ_${d.code}_${d.city}`, country: countryNorm.normalizeCountryReference(d.country, d.code).country || d.country,
  city: localCity(k), region: d.region, lat: d.lat, lng: d.lng, formattedName: localCity(k), displayLabel: localCity(k) }; };
const geocode = async (q) => { geocodeLog.push(q); const k = keyOf(q); if (!k) return { rawResultCount: 0, location: null }; return { rawResultCount: 1, location: locationOf(k) }; };
const authorityGeocodeLog = [];
const authorityGeocodeFn = async ({ data }) => {
  authorityGeocodeLog.push(data.query);
  const k = keyOf(data.query);
  if (!k) return { location: null, error: null, providerResult: { ok: true, rawResultCount: 0 } };
  const loc = locationOf(k);
  return { location: loc, error: null, providerResult: { ok: true, rawResultCount: 1, placeId: loc.placeId, types: ["locality", "political"], primaryType: "locality", countryCode: GEO[k].code, latitude: loc.lat, longitude: loc.lng } };
};
let failPlacesFor = null;
const poolFor = (dest) => {
  const k = keyOf(dest) ?? destKeyOf(dest) ?? (/japan|日本|일본/i.test(dest ?? "") ? "tokyo" : undefined);
  if (!k || k === failPlacesFor || k === "nikko") return [];
  const d = GEO[k];
  return Array.from({ length: 18 }, (_, i) => ({ id: `ChIJ${d.code}${k}P${i}`, name: `${localCity(k)} ${["Shrine", "Temple", "Park", "Museum", "Garden", "Tower"][i % 6]} ${i + 1}`, sourceLocale: "en",
    lat: d.lat + i * 0.0003, lng: d.lng, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park",
    rating: 4.6, userRatingCount: 10000, address: `${localCity(k)}, ${d.country}`, businessStatus: "OPERATIONAL" }));
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const fresh = () => { discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache(); };
const freshAll = () => { fresh(); resolvedScope.clearResolvedDestinationScope?.(); };
const comboCache = await loadOpt("src/lib/ai/places-cost-cache/combination-cache.ts");
const sessionPool = await loadOpt("src/lib/ai/places-cost-cache/session-pool.ts");
const cooldown = await loadOpt("src/lib/ai/places-cost-cache/query-cooldown.ts");
const rateProt = await loadOpt("src/lib/ai/places-cost-cache/rate-protection.ts");
const integrity = await loadOpt("src/lib/ai/combination-itinerary-integrity.ts");
/** Every Places / combination memo emptied, so the next discovery really calls searchPlaces. */
const hardFresh = () => { fresh(); comboCache?.clearCombinationCache?.(); sessionPool?.clearSessionCandidatePool?.(); cooldown?.clearPlacesQueryCooldown?.(); rateProt?.clearPlacesRateProtection?.(); integrity?.clearCombinationPoolMemo?.(); };
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
const names = (arr) => (arr ?? []).map((p) => p?.name ?? p?.placeName ?? p?.displayName ?? (typeof p === "string" ? p : "")).filter(Boolean);
const snapOf = (s, branch, reply, extra = {}) => {
  const tc = s.travelContext ?? {};
  return { branch, dest: tc.destination ?? null, country: tc.destinationCountry ?? null, code: tc.destinationCountryCode ?? null, type: tc.destinationType ?? null, region: tc.destinationRegion ?? null,
    trip: s.tripDestination ? `${s.tripDestination.city ?? "-"}/${s.tripDestination.country ?? "-"}` : null, tripPlace: s.tripDestination?.placeId ?? null, tpc: s.tripPlanningContext?.destination ?? null,
    days: tc.days ?? s.tripDays ?? null, start: tc.startDate ?? null, end: tc.endDate ?? null, city: tc.destinationCity ?? null,
    coords: tc.destinationCoordinates ? `${tc.destinationCoordinates.lat?.toFixed?.(3)},${tc.destinationCoordinates.lng?.toFixed?.(3)}` : null, scopeId: tc.destinationScopeId ?? null,
    cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null, inputs: tc.destinationInputNames ?? null,
    pending: s.pendingQuestion?.type ?? null, base: s.pendingQuestion?.baseDestination ?? null, pendingCountry: s.pendingQuestion?.destinationCountry ?? null,
    offered: (tc.offeredCombinations ?? []).length, offeredAll: (tc.offeredCombinations ?? []).flatMap((c) => (c?.places ?? c?.placeNames ?? []).map((p) => (typeof p === "string" ? p : p?.name))).join("|") || null,
    selected: tc.selectedCombinationIds ?? null, phase: s.phase ?? null, aiState: s.aiItineraryState ?? null, draft: Boolean(s.draftTrip), dayPlan: Boolean(s.currentDayPlan),
    weather: s.weather ? (s.weather.location ?? s.weather.city ?? "set") : null, tcWeather: tc.weather ? (tc.weather.location ?? tc.weather.city ?? "set") : null,
    lastTrip: s.lastGeneratedTripId ?? null, rec: names(s.recommendedPlaces).join("|") || null, stops: names(s.plannedStops).join("|") || null, selPlaces: names(s.selectedPlaces).join("|") || null,
    purpose: tc.tripPurpose ?? null, failure: tc.lastItineraryFailure?.code ?? null,
    sid: s.planningSessionId ?? null, reply: (reply ?? "").replace(/\n/g, " / ").slice(0, 260), ...extra };
};

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
  const merged = travelContext.mergeTravelContext(n, t, s0.lastAssistantReply);
  n = merged.session;
  if (merged.context.destinationCandidate?.status === "pending") {
    n = await globalPlanning.resolveGlobalPlanningCandidate(n, locale, sw
      ? async (q) => (sw.record ? { location: sw.record.location, rawResultCount: 1 } : sw.providerCalls >= 1 ? undefined : geocode(q))
      : geocode);
    merged.context = n.travelContext ?? merged.context;
  }
  if (sw) {
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
  n = tpc.mergeTripPlanningContext(t, n, merged.context).session;
  // _app.chat.tsx 11733–11747 (missing from the m7 / m11 harness): a finished trip (phase done) or a
  // destination different from the merged one starts a new planning session before the hints.
  {
    const destForSession = merged.context.destination?.trim() || n.tripDestination?.displayLabel?.trim() || n.tripDestination?.city?.trim();
    const isTripStyleSelection = n.pendingQuestion?.type === "ask_trip_style"
      || (tripStyle?.parseAskTripStyleSelection?.(t) != null && !(numericAuth?.rejectNumericSelection?.(n, t) ?? false));
    if (!isTripStyleSelection) {
      if (n.phase === "done") n = planSession.startNewPlanningSession(n, "phase_done");
      else if (planSession.shouldStartNewPlanningSession(n, destForSession)) n = planSession.startNewPlanningSession(n, "destination_change");
    }
  }
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
    const dateAsk = cityDays.buildDateAndDurationQuestionReply(destLabel || "這趟", planningCtx.destinationCountry ?? n.travelContext?.destinationCountry, { context: planningCtx, userText: t, blockedLegacyTemplate: branch, locale });
    const s = { ...n, pendingQuestion: dateAsk.pendingQuestion, travelContext: { ...planningCtx, destination: destLabel || planningCtx.destination, tripPurpose: "region_selected", conversationState: "awaiting_days", planningDaysConfirmed: false } };
    return { s, row: snapOf(s, `${branch} date/duration question`, dateAsk.reply) };
  };
  if (!routeGuard.allowed && (routeGuard.reason === "missing_trip_duration" || routeGuard.reason === "pending_duration_question" || !durationGuard.hasValidTripDuration(durationFields))) {
    const destLabel = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || "";
    if (destLabel && !scopeMod.isCountryLevelDestination(destLabel)) return dateQuestion("12954");
  }
  if (durationGuard.canEnterCombinationDiscovery(guardInput)) await ensure(planningCtx, discoverySession, locale);
  const r = stateMachine.processAdviceTurn(t, n, planningCtx, undefined, locale);
  const failureCopy = r.advice.reply && /暫時無法取得.*景點資料/.test(r.advice.reply) && !(r.advice.pendingQuestion?.type === "combination_choice" || r.advice.contextPatch?.tripPurpose === "combination_suggestions_offered");
  if (r.advice.reply && !failureCopy) { const s = finish(r, s0.lastAssistantReply); return { s, row: snapOf(s, "planning advice", r.advice.reply, { guard: routeGuard.reason ?? "ok" }) }; }
  if (!durationGuard.hasValidTripDuration({ days: durationGuard.resolveValidTripDays(durationGuard.tripDurationFieldsFromContext(planningCtx, n)), ...durationGuard.tripDurationFieldsFromContext(planningCtx, n) })) return dateQuestion("13058");
  const ack = durationGuard.buildDestinationDirectionAck({ destination: planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || copyMod.chatRuntimeCopy("tripFallback", locale), tripDays: planningCtx.days ?? n.tripDays, startDate: planningCtx.startDate, endDate: planningCtx.endDate, locale });
  const failure = prodUi.productionUiMessages?.[locale]?.p7fe9e2ed49 ?? "(p7fe9e2ed49)";
  const s = { ...n, pendingQuestion: { type: "ask_preference", options: ["REFRESH"], baseDestination: planningCtx.destination } };
  return { s, row: snapOf(s, "LAST-RESORT (p7fe9e2ed49)", [ack, "", failure].join("\n"), { guard: routeGuard.reason ?? "ok" }) };
}

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

/** One user turn in _app.chat.tsx order (same as verify-m11). */
async function appTurn(s0, t, locale) {
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
    const trustedLocation = probe.providerCalls > 0 ? probe.captured?.envelope.location ?? null : null;
    const res = travelContext.applyConfirmedDestinationSwitch(switchBase, { label: targetLabel, requestText: t, turnResetBase: { planningSessionId: s0.planningSessionId, planVersion: s0.planVersion }, resetAlreadyThisTurn: false,
      trustedCenter: trusted.center, trustedLocation });
    const authority = probe.providerCalls > 0 ? "provider_this_turn" : (trusted.centerSource ?? "provider_locked");
    const baseCand = switchBase.travelContext?.destinationCandidate;
    // Mirror of _app.chat.tsx switchRelistsCombinations = isCombinationSwitchRelistBase(switchBase)
    // (absent at HEAD → false; an older WORK without the export falls back to the M14 condition).
    const relists = APP_RELISTS && (globalPlanning.isCombinationSwitchRelistBase
      ? globalPlanning.isCombinationSwitchRelistBase(switchBase)
      : (switchBase.pendingQuestion?.type === "combination_choice" || Boolean(baseCand?.combinationSwitch && baseCand.status !== "resolved")));
    if ("stop" in res || !res.applied) return { s: s0, row: { ...snapOf(s0, "stop" in res ? `wrapper_${res.stop}` : "wrapper_not_applied", stopCopy(targetLabel, previousLabel)), cls: cls.state, authority, ...geoOf() } };
    const switched = { ...res.session, planningSelection: undefined, placeDetailFocus: undefined, placeFocusRecommendationScope: undefined, activeShownCandidates: undefined };
    const switchedLabel = switched.travelContext?.destination ?? switched.tripPlanningContext?.destination;
    if (!equivalentSwitch(switchedLabel, trusted.destination, switched.travelContext ?? { interests: [] }, switched, locale)) return { s: s0, row: { ...snapOf(s0, "B_committed_sync_pending", "(destinationSwitchAppliedSyncPending / NotSynced)"), cls: cls.state, authority, ...geoOf() } };
    const reqText = cls.requestText?.trim() ?? "";
    const route = reqText ? arbitrate.resolveChatIntentArbitration(reqText, switched).route : undefined;
    const asksRec = contRec.analyzeContinueRecommendationStructure(t).isContinue || (Boolean(reqText) && placeRecIntent.hasExplicitPlaceRecommendationIntent(reqText))
      || route === "NEW_RECOMMENDATION" || route === "MORE_RECOMMENDATIONS" || route === "RECOMMENDATION_REFINEMENT";
    const extra = { cls: cls.state, authority, relists, trusted: `${trusted.destination}/${trusted.centerSource ?? "-"}` };
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

// ------------------------------------------------------------------ sentences
const LOCALES = ["zh-TW", "en", "ja", "ko"];
const NAME = {
  "zh-TW": { sydney: "雪梨", atami: "熱海", beppu: "別府", haeundae: "海雲台", kyoto: "京都", nikko: "日光" },
  en: { sydney: "Sydney", atami: "Atami", beppu: "Beppu", haeundae: "Haeundae", kyoto: "Kyoto", nikko: "Nikko" },
  ja: { sydney: "シドニー", atami: "熱海", beppu: "別府", haeundae: "海雲台", kyoto: "京都", nikko: "日光" },
  ko: { sydney: "시드니", atami: "아타미", beppu: "벳푸", haeundae: "해운대", kyoto: "교토", nikko: "닛코" },
};
const NEG = { "zh-TW": (a, b) => `不去${a}了，改去${b}`, en: (a, b) => `not ${a} anymore, switch to ${b}`, ja: (a, b) => `${a}はやめて、${b}に変更`, ko: (a, b) => `${a} 말고 ${b}로 바꿔` };
const SWITCH = { "zh-TW": (b) => `改去${b}`, en: (b) => `switch to ${b}`, ja: (b) => `${b}に変更`, ko: (b) => `${b}로 바꿔` };
const STEP1 = { "zh-TW": "12/10-12/14 我要去雪梨", en: "12/10-12/14 I'm going to sydney", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행" };
const JAPAN1 = { "zh-TW": "12/10-12/14 我要去日本", en: "12/10-12/14 I'm going to Japan", ja: "12/10-12/14 日本へ旅行", ko: "12/10-12/14 일본 여행" };
const LAST_RESORT = /暫時無法取得足夠的實際地點組合|couldn.t get enough real place combinations|実際のスポットの組み合わせ|실제 장소 조합을 충분히|暫時無法取得.*景點資料/i;
const DESYNC = /^B |stop|wrapper_|k2_|p1 |LAST-RESORT|HARNESS|candidate advice|E1 ask|missing candidate/;
const total = (x) => x.geo.length + x.ageo.length + x.dgeo.length;
const first = (t, locale) => appTurn(sessionMod.createEmptySession(), t, locale);
const j = (v) => JSON.stringify(v);
const pk = (x) => x && { cls: x.cls ?? null, branch: x.branch, via: x.via ?? null, relists: x.relists ?? null, dest: x.dest, country: x.country, code: x.code, type: x.type, city: x.city, region: x.region,
  trip: x.trip, tpc: x.tpc, days: x.days, start: x.start, end: x.end, cand: x.cand, inputs: x.inputs, pending: x.pending, pendingCountry: x.pendingCountry, offered: x.offered,
  first: (x.offeredAll ?? "").split("|").slice(0, 2).join("|"), selected: x.selected, phase: x.phase, aiState: x.aiState, draft: x.draft, dayPlan: x.dayPlan, weather: x.weather, tcWeather: x.tcWeather,
  lastTrip: x.lastTrip, rec: x.rec, stops: x.stops, purpose: x.purpose, failure: x.failure, sidChanged: x.sidChanged ?? null, chainReset: x.chainReset ?? null,
  geo: [x.geo?.length, x.ageo?.length, x.dgeo?.length], geoQ: [...(x.geo ?? []), ...(x.ageo ?? []), ...(x.dgeo ?? [])], runs: x.discoveryRuns ?? null, places: x.placesCalls ?? null, reply: (x.reply ?? "").slice(0, 160) };

// ------------------------------------------------------------------ generated-trip state builders (App order)
const fakePlaces = (k) => poolFor(GEO[k].city).slice(0, 3).map((p) => ({ name: p.name, placeId: p.id, lat: p.lat, lng: p.lng, category: "attraction", city: localCity(k) }));
const oldWeather = (k) => ({ condition: "Sunny", temperatureC: 24, location: localCity(k), city: localCity(k) });
/** Generation ran and the App's trip_created cleanup ran (_app.chat.tsx 14800): phase done, SUCCESS, trip saved. */
const generatedDone = (s, k) => {
  const working = { ...clone(s), phase: "generating", aiItineraryState: "CREATING_TRIP", weather: oldWeather(k), plannedStops: fakePlaces(k), selectedPlaces: fakePlaces(k), recommendedPlaces: fakePlaces(k),
    currentDayPlan: { day: 1, places: fakePlaces(k) }, travelContext: { ...s.travelContext, weather: oldWeather(k), selectedCombinationIds: s.travelContext?.selectedCombinationIds?.length ? s.travelContext.selectedCombinationIds : ["combo_1"] } };
  return planSession.clearPlanningSessionState({ ...working, phase: "done", aiItineraryState: "SUCCESS", draftTrip: undefined, lastGeneratedTripId: `trip_${k}` }, "trip_created");
};
/** App killed during generation (persisted at 13949, lock not held after restart). */
const generatingCrashed = (s, k) => ({ ...clone(s), phase: "generating", aiItineraryState: "CREATING_TRIP", weather: oldWeather(k), plannedStops: fakePlaces(k), selectedPlaces: fakePlaces(k),
  currentDayPlan: { day: 1, places: fakePlaces(k) }, draftTrip: { title: `${localCity(k)} draft`, days: [] },
  travelContext: { ...s.travelContext, weather: oldWeather(k), selectedCombinationIds: s.travelContext?.selectedCombinationIds?.length ? s.travelContext.selectedCombinationIds : ["combo_1"] } });
/** Generation failed (aiItineraryState FAILED), selection kept. */
const generationFailed = (s, k) => ({ ...clone(s), aiItineraryState: "FAILED", weather: oldWeather(k), plannedStops: fakePlaces(k),
  travelContext: { ...s.travelContext, weather: oldWeather(k), selectedCombinationIds: s.travelContext?.selectedCombinationIds?.length ? s.travelContext.selectedCombinationIds : ["combo_1"] } });

// ------------------------------------------------------------------ scenarios → rows (run in WORK and in HEAD)
async function scenarios() {
  const R = {};
  const reach = async (locale, from) => {
    freshAll(); await freshAuthority(); curLocale = locale;
    let s = (await first(STEP1[locale], locale)).s;
    if (from !== "sydney") s = (await appTurn(s, SWITCH[locale](NAME[locale][from]), locale)).s;
    return s;
  };
  // a) after 「1」: negated / plain switch, next turn 「1」.
  if (want("a")) for (const locale of LOCALES) for (const [from, to] of [["atami", "sydney"], ["sydney", "atami"], ["sydney", "kyoto"]]) for (const form of ["neg", "switch"]) {
    const base = await reach(locale, from);
    const one = await appTurn(base, "1", locale);
    const t = form === "neg" ? NEG[locale](NAME[locale][from], NAME[locale][to]) : SWITCH[locale](NAME[locale][to]);
    const r = await appTurn(one.s, t, locale);
    const next = await appTurn(r.s, "1", locale);
    R[`a|${locale}|${from}>${to}|${form}`] = { t, one: pk(one.row), row: pk(r.row), next: pk(next.row), from, to };
  }
  // b) generated / crashed / failed, then switch.
  if (want("b")) for (const locale of LOCALES) for (const [stateTag, build] of [["done", generatedDone], ["crashed", generatingCrashed], ["failed", generationFailed]])
    for (const [from, to] of [["sydney", "kyoto"], ["sydney", "atami"], ["atami", "sydney"], ["atami", "beppu"]]) for (const form of ["neg", "switch"]) {
      const base = await reach(locale, from);
      const one = await appTurn(base, "1", locale);
      const gen = build(one.s, from);
      const t = form === "neg" ? NEG[locale](NAME[locale][from], NAME[locale][to]) : SWITCH[locale](NAME[locale][to]);
      const r = await appTurn(gen, t, locale);
      const next = await appTurn(r.s, "1", locale);
      R[`b|${locale}|${stateTag}|${from}>${to}|${form}`] = { t, gen: pk(snapOf(gen, "generated", "")), row: pk(r.row), next: pk(next.row), from, to };
    }
  // c) after 「1」 with another pending question.
  const PENDINGS = {
    itinerary_next_step: (d) => ({ type: "itinerary_next_step", options: ["full_itinerary", "daily_recommendations"], baseDestination: d }),
    trip_style_choice: (d) => ({ type: "trip_style_choice", options: ["relaxed", "packed"], baseDestination: d }),
    ask_preference: (d) => ({ type: "ask_preference", options: ["REFRESH"], baseDestination: d }),
  };
  if (want("c")) for (const locale of LOCALES) for (const [ptype, mk] of Object.entries(PENDINGS)) for (const [from, to] of [["sydney", "kyoto"], ["sydney", "atami"], ["atami", "sydney"]]) for (const form of ["neg", "switch"]) {
    const base = await reach(locale, from);
    const one = await appTurn(base, "1", locale);
    const withPending = { ...clone(one.s), pendingQuestion: mk(one.s.travelContext?.destination) };
    const t = form === "neg" ? NEG[locale](NAME[locale][from], NAME[locale][to]) : SWITCH[locale](NAME[locale][to]);
    const r = await appTurn(withPending, t, locale);
    R[`c|${locale}|${ptype}|${from}>${to}|${form}`] = { t, row: pk(r.row), from, to };
  }
  // d) finalizedScopePatchFor.
  if (want("d")) for (const locale of LOCALES) {
    freshAll(); await freshAuthority(); curLocale = locale;
    const s1 = await first(STEP1[locale], locale);
    R[`d|${locale}|step1-sydney`] = { row: pk(s1.row), to: "sydney" };
    // Same place, cached combinations (no discovery run): 雪梨 → 熱海 → 雪梨 → 熱海.
    const a1 = await appTurn(s1.s, SWITCH[locale](NAME[locale].atami), locale);
    R[`d|${locale}|to-atami`] = { row: pk(a1.row), to: "atami" };
    const b1 = await appTurn(a1.s, SWITCH[locale](NAME[locale].sydney), locale);
    R[`d|${locale}|back-sydney-cached`] = { row: pk(b1.row), to: "sydney" };
    const a2 = await appTurn(b1.s, SWITCH[locale](NAME[locale].atami), locale);
    R[`d|${locale}|back-atami-cached`] = { row: pk(a2.row), to: "atami" };
    // Same label re-asked after the cache was dropped (discovery runs again for the same place).
    fresh();
    const a3 = await appTurn(a2.s, NEG[locale](NAME[locale].atami, NAME[locale].sydney), locale);
    R[`d|${locale}|sydney-rediscovered`] = { row: pk(a3.row), to: "sydney" };
    // Discovery failure (日光: Places always empty) right after Sydney's successful discovery: the
    // failure branch must not take Sydney's finalized scope (country AU / city 雪梨).
    freshAll(); await freshAuthority();
    const f0 = await first(STEP1[locale], locale);
    const f1 = await appTurn(f0.s, SWITCH[locale](NAME[locale].nikko), locale);
    R[`d|${locale}|fail-nikko-after-sydney`] = { row: pk(f1.row), to: "nikko", failure: true };
    const f2 = await appTurn(f1.s, SWITCH[locale](NAME[locale].sydney), locale);
    R[`d|${locale}|fail-then-sydney`] = { row: pk(f2.row), to: "sydney" };
    // Failure right after 熱海's successful discovery (same country): city must not be 熱海.
    freshAll(); await freshAuthority();
    const g0 = await first(STEP1[locale], locale);
    const g1 = await appTurn(g0.s, SWITCH[locale](NAME[locale].atami), locale);
    const g3 = await appTurn(g1.s, SWITCH[locale](NAME[locale].nikko), locale);
    R[`d|${locale}|fail-nikko-after-atami`] = { row: pk(g3.row), to: "nikko", failure: true, from: "atami" };
    const g4 = await appTurn(g3.s, SWITCH[locale](NAME[locale].atami), locale);
    R[`d|${locale}|fail-then-atami`] = { row: pk(g4.row), to: "atami" };
    // Country-level trip (日本) narrowing to a city.
    for (const city of ["kyoto", "atami"]) {
      freshAll(); await freshAuthority();
      const j0 = await first(JAPAN1[locale], locale);
      const j1 = await appTurn(j0.s, NAME[locale][city], locale);
      R[`d|${locale}|japan>${city}`] = { j0: pk(j0.row), row: pk(j1.row), to: city };
    }
  }
  // e) typed 海雲台 variants then negate it.
  if (want("e")) for (const locale of LOCALES) for (const typed of ["海雲台", "Haeundae", "해운대"]) {
    freshAll(); await freshAuthority(); curLocale = locale;
    const s1 = (await first(STEP1[locale], locale)).s;
    const on = await appTurn(s1, SWITCH[locale](typed), locale);
    for (const neg of ["海雲台", "Haeundae", "해운대", "海雲臺"]) {
      const t = NEG[locale](neg, NAME[locale].sydney);
      const r = await appTurn(on.s, t, locale);
      R[`e|${locale}|typed ${typed}|neg ${neg}`] = { t, on: pk(on.row), row: pk(r.row), to: "sydney", prev: "haeundae" };
      // Risk probe: inputNames not written (stripped) on the Haeundae list.
      const stripped = { ...clone(on.s), travelContext: { ...on.s.travelContext, destinationInputNames: undefined } };
      const r2 = await appTurn(stripped, t, locale);
      R[`e|${locale}|typed ${typed}|neg ${neg}|noInputs`] = { t, row: pk(r2.row), to: "sydney", prev: "haeundae", info: true };
    }
  }
  return R;
}

const RES = await scenarios();
if (CHILD) {
  process.stdout.write(`@@M15_JSON@@${JSON.stringify({ rows: RES, appRelists: APP_RELISTS, fetchCalls })}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}

let HEAD = null;
if (headDir) {
  const self = "scripts/verify-m15-post-selection-switch.mjs";
  if (!existsSync(join(headDir, self)) || readFileSync(join(headDir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(headDir, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--only=${ONLY.join(",")}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 400_000, maxBuffer: 256 << 20 });
  const m = (r.stdout ?? "").match(/@@M15_JSON@@([\s\S]*?)@@END@@/);
  HEAD = m ? JSON.parse(m[1]) : null;
  if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-900)}`);
}

// ------------------------------------------------------------------ checks
const failures = [];
const check = (name, fn) => { try { fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 10).join("\n  ")}`); } };
const tab = (r) => r ? `${r.branch} | ${r.dest}/${r.code}/${r.city ?? "-"} trip=${r.trip ?? "-"} | pend=${r.pending ?? "-"} off=${r.offered} | ${r.start ?? "-"}~${r.end ?? "-"} d=${r.days ?? "-"} | sid=${r.sidChanged} geo=${r.geoQ.length} runs=${r.runs}/${r.places} | ph=${r.phase} ai=${r.aiState ?? "-"} w=${r.weather ?? "-"}/${r.tcWeather ?? "-"} stops=${r.stops ? "Y" : "-"} sel=${j(r.selected)} | ${r.reply.slice(0, 70)}` : "-";
const show = (key) => { const w = RES[key]; const h = HEAD?.rows?.[key]; out(`TAB ${key} 「${w.t ?? ""}」\n   W ${tab(w.row)}${w.next ? `\n   W1 ${tab(w.next)}` : ""}${h ? `\n   H ${tab(h.row)}${h.next ? `\n   H1 ${tab(h.next)}` : ""}` : ""}`); };
const otherKeys = (want) => Object.keys(GEO).filter((k) => k !== want && !(want === "atami" && k === "tokyo") && !(want === "kyoto" && k === "tokyo"));
/** Switched to `to`'s combinations, dates kept, one reset, ≤1 geocode, no last-resort / desync / old destination. */
const assertSwitched = (row, to, from, info) => {
  assert.ok(!DESYNC.test(row.branch), `branch ${row.branch}${info}`);
  assert.equal(destKeyOf(row.dest), to, `dest ${row.dest}${info}`);
  assert.equal(row.pending, "combination_choice", `pending ${row.pending} (combinations not re-listed)${info}`);
  assert.ok(row.offered > 0, `no combinations${info}`);
  assert.ok(!LAST_RESORT.test(row.reply), `last-resort copy${info}`);
  assert.equal(row.start, "2026-12-10", `start${info}`); assert.equal(row.end, "2026-12-14", `end${info}`); assert.equal(row.days, 5, `days${info}`);
  assert.equal(row.sidChanged, true, `no reset${info}`);
  if (row.chainReset != null) assert.equal(row.chainReset, false, `second reset${info}`);
  assert.ok(row.geoQ.length <= 1, `geocode > 1: ${j(row.geoQ)}${info}`);
  assert.ok(!row.geoQ.some((q) => /不去|やめて|말고|anymore|改去|に変更|바꿔|switch/.test(q)), `whole sentence geocoded${info}`);
};
const assertNoOld = (row, from, to, info) => {
  const old = (v) => v != null && destKeyOf(String(v).split("/")[0]) === from;
  for (const f of ["city", "trip", "tpc", "weather", "tcWeather"]) assert.ok(!old(row[f]), `${f}=${row[f]} is the previous destination${info}`);
  const code = countryNorm.normalizeCountryReference(row.country, row.code).countryCode;
  assert.equal(code, GEO[to].code, `country ${row.country}/${row.code} not ${GEO[to].code}${info}`);
  if (row.pendingCountry) assert.equal(countryNorm.normalizeCountryReference(row.pendingCountry).countryCode, GEO[to].code, `pending country ${row.pendingCountry}${info}`);
  for (const f of ["rec", "stops"]) assert.ok(!(row[f] ?? "").split("|").some((n) => n && (GEO[from].re.test(n) || LOCAL[from].some((l) => n.includes(l)))), `${f} still has ${from}: ${row[f]}${info}`);
  assert.ok(!row.draft && !row.dayPlan, `draftTrip / currentDayPlan kept${info}`);
  assert.ok(row.phase !== "done" && row.phase !== "generating", `phase ${row.phase}${info}`);
  assert.ok(row.aiState !== "SUCCESS" && row.aiState !== "CREATING_TRIP" && row.aiState !== "FAILED", `aiItineraryState ${row.aiState}${info}`);
  assert.ok(!row.lastTrip, `lastGeneratedTripId ${row.lastTrip}${info}`);
  assert.ok(!(row.selected ?? []).length, `selectedCombinationIds ${j(row.selected)}${info}`);
  const offered = (row.first ?? "").split("|").filter(Boolean);
  for (const k of otherKeys(to)) assert.ok(!offered.some((n) => GEO[k].re.test(n) || LOCAL[k].some((l) => n.includes(l))), `${k} in combinations ${row.first}${info}`);
};

for (const key of Object.keys(RES)) {
  const w = RES[key]; const h = HEAD?.rows?.[key];
  const [sec] = key.split("|");
  const info = `\n  WORK ${j(w.row)}${w.next ? `\n  WORK next ${j(w.next)}` : ""}${h ? `\n  HEAD ${j(h.row)}` : ""}`;
  show(key);
  if (sec === "a") {
    check(`${key} 「${w.t}」: ${w.to} combinations re-listed, dates kept, one reset, ≤1 geocode, no last-resort`, () => assertSwitched(w.row, w.to, w.from, info));
    check(`${key} 「${w.t}」: no previous-destination fields`, () => assertNoOld(w.row, w.from, w.to, info));
    check(`${key} next 「1」: no last-resort, stays ${w.to}`, () => { assert.ok(!LAST_RESORT.test(w.next.reply) && !/LAST-RESORT/.test(w.next.branch), `next ${j(w.next)}`); assert.equal(destKeyOf(w.next.dest), w.to, `next ${j(w.next)}`); });
  } else if (sec === "b") {
    check(`${key} 「${w.t}」: ${w.to} combinations, dates kept, one reset, ≤1 geocode, no last-resort`, () => assertSwitched(w.row, w.to, w.from, `\n  GEN ${j(w.gen)}${info}`));
    check(`${key} 「${w.t}」: generated trip / places / weather / country of ${w.from} cleared`, () => assertNoOld(w.row, w.from, w.to, `\n  GEN ${j(w.gen)}${info}`));
    check(`${key} next 「1」: no last-resort, stays ${w.to}`, () => { assert.ok(!LAST_RESORT.test(w.next.reply) && !/LAST-RESORT/.test(w.next.branch), `next ${j(w.next)}`); assert.equal(destKeyOf(w.next.dest), w.to, `next ${j(w.next)}`); });
  } else if (sec === "c") {
    // Rule: another pending keeps the existing behavior. Asserted: no throw / last-resort / desync; dest
    // either switched (to) or kept (from) — never a third place; compared with HEAD.
    check(`${key} 「${w.t}」: no harness throw / last-resort / foreign destination`, () => {
      assert.ok(!/HARNESS|LAST-RESORT/.test(w.row.branch) && !LAST_RESORT.test(w.row.reply), info);
      assert.ok([w.from, w.to].includes(destKeyOf(w.row.dest)), `dest ${w.row.dest}${info}`);
      if (destKeyOf(w.row.dest) === w.to) assertNoOld(w.row, w.from, w.to, info);
    });
    if (h) out(`INFO ${key} WORK vs HEAD: ${j({ work: [w.row.branch, w.row.dest, w.row.pending, w.row.offered], head: [h.row.branch, h.row.dest, h.row.pending, h.row.offered] })}${w.row.branch === h.row.branch && w.row.dest === h.row.dest && w.row.pending === h.row.pending ? " same" : " DIFFERS"}`);
  } else if (sec === "d") {
    check(`${key}: country / city of ${w.to} present (not lost, not another place)`, () => {
      const r = w.row;
      assert.ok(r.country, `country missing${info}`);
      assert.equal(countryNorm.normalizeCountryReference(r.country, r.code).countryCode, GEO[w.to].code, `country${info}`);
      if (r.pendingCountry) assert.equal(countryNorm.normalizeCountryReference(r.pendingCountry).countryCode, GEO[w.to].code, `pending country${info}`);
      if (r.city) assert.equal(destKeyOf(r.city), w.to, `city ${r.city}${info}`);
      assert.equal(destKeyOf(r.dest), w.to, `dest ${r.dest}${info}`);
      if (w.failure) out(`INFO ${key} failure branch: ${j({ branch: r.branch, failure: r.failure, purpose: r.purpose, pending: r.pending, city: r.city, country: r.country })}`);
      else if (!/^japan>/.test(key.split("|")[2])) { assert.equal(r.pending, "combination_choice", `pending${info}`); assert.ok(r.city, `city missing${info}`); }
      else out(`INFO ${key} country-level narrowing: pending ${r.pending} (dates ${r.start}~${r.end})`);
    });
    if (h) {
      const fields = ["dest", "country", "code", "type", "city", "region", "pending", "pendingCountry", "offered", "failure"];
      const diff = fields.filter((f) => j(w.row[f]) !== j(h.row[f]));
      out(`INFO ${key} WORK vs HEAD fields: ${diff.length ? diff.map((f) => `${f}: ${j(h.row[f])} → ${j(w.row[f])}`).join("; ") : "same"}`);
      // A field HEAD had for this same place must not disappear on WORK.
      check(`${key}: no country / city / type HEAD had for ${w.to} is lost on WORK`, () => {
        for (const f of ["country", "code", "city", "type", "pendingCountry"]) {
          if (f === "pendingCountry" && w.row.pending !== h.row.pending) continue; // another pending shape (ask_preference has no country)
          if (destKeyOf(h.row.dest) !== w.to) continue; // HEAD is on another destination: nothing to compare
          if (h.row[f] && destKeyOf(String(h.row[f])) !== undefined && destKeyOf(String(h.row[f])) !== w.to) continue; // HEAD itself polluted
          if (f === "country" || f === "code" || f === "pendingCountry") {
            const hc = countryNorm.normalizeCountryReference(h.row[f]).countryCode ?? h.row[f];
            if (h.row[f] && hc && hc !== GEO[w.to].code) continue; // HEAD's own value was another country
          }
          if (h.row[f]) assert.ok(w.row[f], `${f} lost (HEAD ${j(h.row[f])})${info}`);
        }
      });
    }
  } else if (sec === "e") {
    if (w.info) {
      const ok = (() => { try { assertSwitched(w.row, "sydney", "haeundae", ""); return true; } catch { return false; } })();
      out(`INFO ${key}: ${ok ? "switches to Sydney" : "does NOT switch to Sydney"} ${j([w.row.branch, w.row.dest, w.row.pending])}${h ? ` | HEAD ${j([h.row.branch, h.row.dest, h.row.pending])}` : ""}`);
    } else {
      check(`${key}: typed name kept in destinationInputNames on the Haeundae list`, () => {
        assert.equal(destKeyOf(w.on.dest), "haeundae", `on ${j(w.on)}`);
        assert.ok((w.on.inputs ?? []).length, `inputs empty ${j(w.on)}`);
      });
      // M16 round 3 (assigner ruling): negating the current destination in another writing system than the
      // one it was typed in (Latin / Hangul / Han, e.g. typed 海雲台 then 「not 해운대 anymore …」) is a known
      // limitation. Those rows must do no harm (no throw / last-resort, never a third place, ≤1 geocode, and
      // a switch, if any, is a clean one); same-script rows (海雲台 ↔ 海雲臺 included) must still switch.
      const scriptOf = (v) => /\p{Script=Hangul}/u.test(v) ? "hangul" : /\p{Script=Han}/u.test(v) ? "han" : "latin";
      const [, , typedPart, negPart] = key.split("|");
      const crossScript = scriptOf(typedPart.replace(/^typed /, "")) !== scriptOf(negPart.replace(/^neg /, ""));
      if (crossScript) {
        check(`${key} 「${w.t}」: cross-script negation (known limitation) does no harm`, () => {
          assert.ok(!/HARNESS|LAST-RESORT/.test(w.row.branch) && !LAST_RESORT.test(w.row.reply), info);
          assert.ok(["haeundae", "sydney"].includes(destKeyOf(w.row.dest)), `dest ${w.row.dest}${info}`);
          assert.ok(w.row.geoQ.length <= 1, `geocode > 1: ${j(w.row.geoQ)}${info}`);
          // zh-TW 「不去Haeundae了，改去雪梨」 on a 海雲台 list: the legacy 改去 switch (dates dropped, days asked again),
          // identical to HEAD — accepted only when every compared field equals HEAD.
          const sameAsHeadLegacy = h && ["branch", "dest", "pending", "start", "end", "days", "sidChanged", "offered"].every((f) => j(w.row[f]) === j(h.row[f]));
          if (destKeyOf(w.row.dest) === "sydney" && !sameAsHeadLegacy) { assertSwitched(w.row, "sydney", "haeundae", info); assertNoOld(w.row, "haeundae", "sydney", info); }
        });
        out(`INFO ${key}: cross-script ${destKeyOf(w.row.dest) === "sydney" ? "switches" : "keeps Haeundae"} ${j([w.row.branch, w.row.dest, w.row.pending, w.row.geoQ.length])}`);
      } else {
        check(`${key} 「${w.t}」: back to Sydney combinations`, () => { assertSwitched(w.row, "sydney", "haeundae", info); assertNoOld(w.row, "haeundae", "sydney", info); });
      }
    }
  }
}
check("no network: fetch=0", () => { assert.equal(fetchCalls, 0); if (HEAD) assert.equal(HEAD.fetchCalls, 0); });
out(`INFO harness: APP_RELISTS=${APP_RELISTS}${HEAD ? ` HEAD APP_RELISTS=${HEAD.appRelists}` : ""}; HEAD rows=${HEAD ? Object.keys(HEAD.rows).length : "n/a"}`);
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.exit(failures.length ? 1 : 0);
