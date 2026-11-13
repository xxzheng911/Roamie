/**
 * M16 (tester, independent review of the "all stages switch city with one rule" change).
 * Harness: same App-order turn as verify-m15-post-selection-switch.mjs (A2 gate → CONFIRMED wrapper or
 * NO_SWITCH chain; switchRelistsCombinations mirrored as isCombinationSwitchRelistBase(switchBase)).
 * Runs in WORK and, with `--head-dir=<snap>`, in a HEAD snapshot (rows compared as JSON).
 *  f) generation failed in the App's real shape (pendingQuestion activity_choice + chatPlanningState
 *     generationFailed; prepared-fail path and catch path phase ready / FAILED) → switch city.
 *  g) ask_preference from other sources (city preference 經典景點/美食咖啡/…; refresh after no combination):
 *     the original answers must behave as HEAD; explicit switch reported; bare city must be HEAD.
 *     ask_days pending + switch must be HEAD.
 *  h) must-not-change after a pick / after generation: bare city, near extension (東京 → 鎌倉), date only,
 *     country name, category word, Mix — WORK vs HEAD.
 *  i) misfires after a pick / after generation / on the refresh ask_preference: sentences with switch
 *     wording that are not a city switch (pace, days, dates, day-level edit, current city).
 *  n) other negation forms (four locales) after a pick / after generation.
 *  j) generation in flight: the old generation snapshot is never current for the switched session
 *     (isCurrentTripDateSnapshot false → the App drops the stale result); send is blocked while generating.
 *  k) saved trips: no network (fetch=0, Supabase writes need fetch), no storage writes besides none, switch
 *     modules import no saved-trip / Supabase module.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=580 scripts/verify-m16-post-selection-switch-review.mjs [-- --head-dir=<snapshot>] [--only=f,g,h,i,n]
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
// Storage writes are recorded (saved trips must never be written by a chat switch).
const storageWrites = [];
{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { storageWrites.push(`set:${k}`); mem.set(k, String(v)); },
    removeItem: (k) => { storageWrites.push(`remove:${k}`); mem.delete(k); }, clear: () => { storageWrites.push("clear"); mem.clear(); }, key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep existing */ }
}
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
const dateConfirm = await loadOpt("src/lib/ai/trip-date-confirmation.ts");
let authorityInstance = 0;
let turnDest = await load("src/lib/ai/chat-turn-destination.ts");
const freshAuthority = async () => { turnDest = await load(`src/lib/ai/chat-turn-destination.ts?m16=${++authorityInstance}`); };
const geoClar = await load("src/lib/ai/destination-geographic-clarification.ts");
const contRec = await load("src/lib/ai/continue-recommendation-intent.ts");
const placeRecIntent = await load("src/lib/ai/place-recommendation-intent/parse.ts");
const APP_SRC = readFileSync("src/routes/_app.chat.tsx", "utf8");
const APP_RELISTS = APP_SRC.includes("switchRelistsCombinations");

// ------------------------------------------------------------------ fixtures (m15 + kamakura)
const GEO = {
  sydney: { re: /sydney|雪梨|シドニー|시드니/i, city: "Sydney", region: "New South Wales", country: "Australia", code: "AU", lat: -33.8688, lng: 151.2093 },
  kyoto: { re: /kyoto|京都|교토/i, city: "Kyoto", region: "Kyoto", country: "Japan", code: "JP", lat: 35.0116, lng: 135.7681 },
  atami: { re: /atami|熱海|热海|아타미/i, city: "Atami", region: "Shizuoka", country: "Japan", code: "JP", lat: 35.0959, lng: 139.0717 },
  beppu: { re: /beppu|別府|别府|벳푸/i, city: "Beppu", region: "Oita", country: "Japan", code: "JP", lat: 33.2846, lng: 131.4912 },
  haeundae: { re: /haeundae|해운대|海雲台|海雲臺|海云台/i, city: "Haeundae-gu", region: "Busan", country: "South Korea", code: "KR", lat: 35.1631, lng: 129.1635 },
  kamakura: { re: /kamakura|鎌倉|镰仓|가마쿠라/i, city: "Kamakura", region: "Kanagawa", country: "Japan", code: "JP", lat: 35.3192, lng: 139.5467 },
  tokyo: { re: /tokyo|東京|도쿄/i, city: "Tokyo", region: "Tokyo", country: "Japan", code: "JP", lat: 35.6762, lng: 139.6503 },
  nikko: { re: /nikko|日光|닛코/i, city: "Nikko", region: "Tochigi", country: "Japan", code: "JP", lat: 36.7199, lng: 139.6982 },
};
const LOCAL = { sydney: ["Sydney", "雪梨", "シドニー", "시드니"], kyoto: ["Kyoto", "京都市", "京都市", "교토시"], atami: ["Atami", "熱海市", "熱海市", "아타미시"],
  beppu: ["Beppu", "別府市", "別府市", "벳푸시"], haeundae: ["Haeundae-gu", "海雲臺區", "海雲台区", "해운대구"], kamakura: ["Kamakura", "鎌倉市", "鎌倉市", "가마쿠라시"],
  tokyo: ["Tokyo", "東京", "東京都", "도쿄"], nikko: ["Nikko", "日光市", "日光市", "닛코시"] };
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
const poolFor = (dest) => {
  const k = keyOf(dest) ?? destKeyOf(dest) ?? (/japan|日本|일본/i.test(dest ?? "") ? "tokyo" : undefined);
  if (!k || k === "nikko") return [];
  const d = GEO[k];
  return Array.from({ length: 18 }, (_, i) => ({ id: `ChIJ${d.code}${k}P${i}`, name: `${localCity(k)} ${["Shrine", "Temple", "Park", "Museum", "Garden", "Tower"][i % 6]} ${i + 1}`, sourceLocale: "en",
    lat: d.lat + i * 0.0003, lng: d.lng, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park",
    rating: 4.6, userRatingCount: 10000, address: `${localCity(k)}, ${d.country}`, businessStatus: "OPERATIONAL" }));
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const fresh = () => { discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache(); };
const freshAll = () => { fresh(); resolvedScope.clearResolvedDestinationScope?.(); };
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
    prov: tc.dateProvenance ? `${tc.dateProvenance.source}/${tc.dateProvenance.confirmed}` : null,
    cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null, inputs: tc.destinationInputNames ?? null,
    pending: s.pendingQuestion?.type ?? null, pendingOpts: (s.pendingQuestion?.options ?? []).join(",") || null, base: s.pendingQuestion?.baseDestination ?? null, pendingCountry: s.pendingQuestion?.destinationCountry ?? null,
    offered: (tc.offeredCombinations ?? []).length, offeredAll: (tc.offeredCombinations ?? []).flatMap((c) => (c?.places ?? c?.placeNames ?? []).map((p) => (typeof p === "string" ? p : p?.name))).join("|") || null,
    selected: tc.selectedCombinationIds ?? null, phase: s.phase ?? null, aiState: s.aiItineraryState ?? null, cps: s.chatPlanningState ?? null, draft: Boolean(s.draftTrip), dayPlan: Boolean(s.currentDayPlan),
    weather: s.weather ? (s.weather.location ?? s.weather.city ?? "set") : null, tcWeather: tc.weather ? (tc.weather.location ?? tc.weather.city ?? "set") : null,
    lastTrip: s.lastGeneratedTripId ?? null, rec: names(s.recommendedPlaces).join("|") || null, stops: names(s.plannedStops).join("|") || null,
    purpose: tc.tripPurpose ?? null, sid: s.planningSessionId ?? null, reply: (reply ?? "").replace(/\n/g, " / ").slice(0, 260), ...extra };
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

/** One user turn in _app.chat.tsx order (same as verify-m15). */
async function appTurn(s0, t, locale) {
  curLocale = locale;
  const g0 = geocodeLog.length; const a0 = authorityGeocodeLog.length; const d0 = discoveryGeocodeLog.length;
  const runs0 = discoveryRuns; const places0 = placesCalls; const w0 = storageWrites.length;
  const sid0 = s0.planningSessionId;
  const cls = tpc.classifyDestinationSwitchTurn(t);
  const geoOf = () => ({ geo: geocodeLog.slice(g0), ageo: authorityGeocodeLog.slice(a0), dgeo: discoveryGeocodeLog.slice(d0), discoveryRuns: discoveryRuns - runs0, placesCalls: placesCalls - places0, writes: storageWrites.slice(w0) });
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
    // _app.chat.tsx: const switchRelistsCombinations = isCombinationSwitchRelistBase(switchBase) (absent at HEAD → false).
    const relists = APP_RELISTS && Boolean(globalPlanning.isCombinationSwitchRelistBase?.(switchBase));
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

// ------------------------------------------------------------------ sentences / state builders
const LOCALES = ["zh-TW", "en", "ja", "ko"];
const NAME = {
  "zh-TW": { sydney: "雪梨", atami: "熱海", beppu: "別府", kyoto: "京都", kamakura: "鎌倉", tokyo: "東京" },
  en: { sydney: "Sydney", atami: "Atami", beppu: "Beppu", kyoto: "Kyoto", kamakura: "Kamakura", tokyo: "Tokyo" },
  ja: { sydney: "シドニー", atami: "熱海", beppu: "別府", kyoto: "京都", kamakura: "鎌倉", tokyo: "東京" },
  ko: { sydney: "시드니", atami: "아타미", beppu: "벳푸", kyoto: "교토", kamakura: "가마쿠라", tokyo: "도쿄" },
};
const NEG = { "zh-TW": (a, b) => `不去${a}了，改去${b}`, en: (a, b) => `not ${a} anymore, switch to ${b}`, ja: (a, b) => `${a}はやめて、${b}に変更`, ko: (a, b) => `${a} 말고 ${b}로 바꿔` };
const NEG2 = { "zh-TW": (a, b) => `${a}不去了，我要去${b}`, en: (a, b) => `instead of ${a}, let's switch to ${b}`, ja: (a, b) => `${a}じゃなくて${b}に変更して`, ko: (a, b) => `${a} 대신 ${b}로 변경해 줘` };
const SWITCH = { "zh-TW": (b) => `改去${b}`, en: (b) => `switch to ${b}`, ja: (b) => `${b}に変更`, ko: (b) => `${b}로 바꿔` };
const STEP1 = { "zh-TW": (c) => `12/10-12/14 我要去${c}`, en: (c) => `12/10-12/14 I'm going to ${c}`, ja: (c) => `12/10-12/14 ${c}へ旅行`, ko: (c) => `12/10-12/14 ${c} 여행` };
const NODATE = { "zh-TW": (c) => `我要去${c}`, en: (c) => `I'm going to ${c}`, ja: (c) => `${c}へ旅行`, ko: (c) => `${c} 여행` };
const LAST_RESORT = /暫時無法取得足夠的實際地點組合|couldn.t get enough real place combinations|実際のスポットの組み合わせ|실제 장소 조합을 충분히|暫時無法取得.*景點資料/i;
const DESYNC = /^B |stop|wrapper_|k2_|p1 |LAST-RESORT|HARNESS|candidate advice|E1 ask|missing candidate/;
const first = (t, locale) => appTurn(sessionMod.createEmptySession(), t, locale);
const j = (v) => JSON.stringify(v);
const pk = (x) => x && { cls: x.cls ?? null, branch: x.branch, via: x.via ?? null, relists: x.relists ?? null, dest: x.dest, country: x.country, code: x.code, type: x.type, city: x.city,
  trip: x.trip, tpc: x.tpc, days: x.days, start: x.start, end: x.end, prov: x.prov, cand: x.cand, pending: x.pending, pendingOpts: x.pendingOpts, pendingCountry: x.pendingCountry, offered: x.offered,
  first: (x.offeredAll ?? "").split("|").slice(0, 2).join("|"), selected: x.selected, phase: x.phase, aiState: x.aiState, cps: x.cps, draft: x.draft, dayPlan: x.dayPlan, weather: x.weather, tcWeather: x.tcWeather,
  lastTrip: x.lastTrip, rec: x.rec, stops: x.stops, purpose: x.purpose, sidChanged: x.sidChanged ?? null, chainReset: x.chainReset ?? null,
  geoQ: [...(x.geo ?? []), ...(x.ageo ?? []), ...(x.dgeo ?? [])], writes: x.writes ?? [], reply: (x.reply ?? "").slice(0, 200) };

const fakePlaces = (k) => poolFor(GEO[k].city).slice(0, 3).map((p) => ({ name: p.name, placeId: p.id, lat: p.lat, lng: p.lng, category: "attraction", city: localCity(k) }));
const oldWeather = (k) => ({ condition: "Sunny", temperatureC: 24, location: localCity(k), city: localCity(k) });
const withSel = (s) => ({ ...s.travelContext, weather: oldWeather(destKeyOf(s.travelContext?.destination) ?? "sydney"), selectedCombinationIds: s.travelContext?.selectedCombinationIds?.length ? s.travelContext.selectedCombinationIds : ["combo_1"] });
/** App trip_created cleanup (_app.chat.tsx 14797). */
const generatedDone = (s, k) => planSession.clearPlanningSessionState({ ...clone(s), phase: "done", aiItineraryState: "SUCCESS", weather: oldWeather(k), plannedStops: fakePlaces(k), selectedPlaces: fakePlaces(k),
  recommendedPlaces: fakePlaces(k), currentDayPlan: { day: 1, places: fakePlaces(k) }, draftTrip: undefined, lastGeneratedTripId: `trip_${k}`, travelContext: withSel(s) }, "trip_created");
/** prepared.ok false (_app.chat.tsx 15042): prepared.session + chatPlanningState generationFailed + activity_choice pending. */
const failedPrepared = (s, k) => ({ ...clone(s), weather: oldWeather(k), plannedStops: fakePlaces(k), chatPlanningState: "generationFailed",
  pendingQuestion: { type: "activity_choice", options: ["重新生成", "must_visit_places", "daily_recommendations"], baseDestination: s.travelContext?.destination },
  travelContext: { ...withSel(s), generationRequestId: `gen_${k}` } });
/** Generation threw (_app.chat.tsx 15114): phase ready, aiItineraryState FAILED, generationFailed, activity_choice pending. */
const failedCatch = (s, k) => ({ ...failedPrepared(s, k), phase: "ready", aiItineraryState: "FAILED" });
/** Generation in flight (persisted while CREATING_TRIP). */
const generating = (s, k) => ({ ...clone(s), phase: "generating", aiItineraryState: "CREATING_TRIP", weather: oldWeather(k), plannedStops: fakePlaces(k),
  currentDayPlan: { day: 1, places: fakePlaces(k) }, draftTrip: { title: `${localCity(k)} draft`, days: [] }, travelContext: { ...withSel(s), generationRequestId: `gen_${k}` } });
const cityPreference = (s) => ({ ...clone(s), pendingQuestion: cityDays.pendingQuestionForCityPreference(s.travelContext?.destination, s.travelContext?.destinationCountry),
  travelContext: { ...s.travelContext, offeredCombinations: undefined, tripPurpose: "region_selected" } });
const refreshPref = (s) => ({ ...clone(s), pendingQuestion: { type: "ask_preference", options: [discovery.REFRESH_DESTINATION_RECOMMENDATIONS_OPTION ?? "重新整理推薦"], baseDestination: s.travelContext?.destination, destinationCountry: s.travelContext?.destinationCountry },
  travelContext: { ...s.travelContext, offeredCombinations: undefined } });

// ------------------------------------------------------------------ scenarios
async function scenarios() {
  const R = {};
  const reach = async (locale, from, dated = true) => {
    freshAll(); await freshAuthority(); curLocale = locale;
    const start = from === "atami" || from === "kyoto" ? "sydney" : from;
    let s = (await first((dated ? STEP1 : NODATE)[locale](NAME[locale][start]), locale)).s;
    if (start !== from) s = (await appTurn(s, SWITCH[locale](NAME[locale][from]), locale)).s;
    return s;
  };
  const picked = async (locale, from) => (await appTurn(await reach(locale, from), "1", locale)).s;
  // f) generation failed, real App shape.
  if (want("f")) for (const locale of LOCALES) for (const [tag, build] of [["failedPrepared", failedPrepared], ["failedCatch", failedCatch], ["generating", generating]])
    for (const [from, to] of [["sydney", "kyoto"], ["atami", "sydney"]]) for (const form of ["neg", "switch"]) {
      const gen = build(await picked(locale, from), from);
      const t = form === "neg" ? NEG[locale](NAME[locale][from], NAME[locale][to]) : SWITCH[locale](NAME[locale][to]);
      const r = await appTurn(gen, t, locale);
      const stale = dateConfirm?.isCurrentTripDateSnapshot ? dateConfirm.isCurrentTripDateSnapshot(gen, r.s) : null;
      R[`f|${locale}|${tag}|${from}>${to}|${form}`] = { t, gen: pk(snapOf(gen, "gen", "")), row: pk(r.row), staleCurrent: stale, genSid: gen.planningSessionId ?? null, newSid: r.s.planningSessionId ?? null, from, to };
    }
  // g) ask_preference from other sources / ask_days.
  if (want("g")) for (const locale of LOCALES) {
    const answers = ["美食咖啡", "都可以", "B", "經典景點", "改成美食咖啡", "換成海灘放鬆"];
    for (const t of answers) {
      const s = cityPreference(await reach(locale, "sydney"));
      R[`g|${locale}|cityPref|answer ${t}`] = { t, row: pk((await appTurn(s, t, locale)).row), from: "sydney", kind: "same" };
    }
    for (const t of [NAME[locale].kyoto, SWITCH[locale](NAME[locale].kyoto), NEG[locale](NAME[locale].sydney, NAME[locale].kyoto)]) {
      const s = cityPreference(await reach(locale, "sydney"));
      R[`g|${locale}|cityPref|${t}`] = { t, row: pk((await appTurn(s, t, locale)).row), from: "sydney", to: "kyoto", kind: t === NAME[locale].kyoto ? "same" : "switchInfo" };
    }
    for (const t of ["重新整理推薦", "refresh recommendations", NAME[locale].kyoto]) {
      const s = refreshPref(await reach(locale, "sydney"));
      R[`g|${locale}|refreshPref|${t}`] = { t, row: pk((await appTurn(s, t, locale)).row), from: "sydney", kind: "same" };
    }
    {
      const s = await reach(locale, "sydney", false);
      R[`g|${locale}|askDays-state`] = { t: "(state)", row: pk(snapOf(s, "state", "")), from: "sydney", kind: "info" };
      for (const t of [SWITCH[locale](NAME[locale].kyoto), NAME[locale].kyoto]) R[`g|${locale}|askDays|${t}`] = { t, row: pk((await appTurn(s, t, locale)).row), from: "sydney", kind: "same" };
    }
  }
  // h) must-not-change after a pick / after generation.
  if (want("h")) for (const locale of LOCALES) for (const stage of ["picked", "done"]) {
    const texts = [["sydney", NAME[locale].kyoto], ["tokyo", NAME[locale].kamakura], ["sydney", "12/20-12/24"], ["sydney", { "zh-TW": "日本", en: "Japan", ja: "日本", ko: "일본" }[locale]],
      ["sydney", { "zh-TW": "海邊", en: "beach", ja: "海", ko: "바다" }[locale]], ["sydney", "Mix"]];
    for (const [from, t] of texts) {
      let s = await picked(locale, from);
      if (stage === "done") s = generatedDone(s, from);
      R[`h|${locale}|${stage}|${from}|${t}`] = { t, row: pk((await appTurn(s, t, locale)).row), from, kind: "same" };
    }
  }
  // i) misfires.
  const MIS = {
    "zh-TW": ["改成3天", "換成輕鬆一點的行程", "第二天改成去海邊", "改成12/20-12/24", "目的地附近有什麼好吃的", "改去雪梨", "雪梨改成12/20出發", "換成便宜一點的住宿"],
    en: ["change it to 3 days", "switch to a relaxed pace", "change day 2 to the beach", "change the dates to 12/20-12/24", "switch to Sydney", "show me parks instead"],
    ja: ["3日間に変更", "ペースをゆっくりに変更", "日程を12/20-12/24に変更", "シドニーに変更"],
    ko: ["3일로 바꿔", "일정을 여유롭게 바꿔줘", "12/20-12/24로 바꿔", "시드니로 바꿔"],
  };
  if (want("i")) for (const locale of LOCALES) for (const stage of ["picked", "done", "refreshPref"]) for (const t of MIS[locale]) {
    let s = await picked(locale, "sydney");
    if (stage === "done") s = generatedDone(s, "sydney");
    if (stage === "refreshPref") s = refreshPref(await reach(locale, "sydney"));
    R[`i|${locale}|${stage}|${t}`] = { t, row: pk((await appTurn(s, t, locale)).row), from: "sydney", kind: "misfire" };
  }
  // n) other negation forms.
  if (want("n")) for (const locale of LOCALES) for (const stage of ["choosing", "picked", "done"]) for (const [from, to] of [["sydney", "kyoto"], ["atami", "sydney"], ["sydney", "atami"]]) {
    let s = stage === "choosing" ? await reach(locale, from) : await picked(locale, from);
    if (stage === "done") s = generatedDone(s, from);
    const t = NEG2[locale](NAME[locale][from], NAME[locale][to]);
    R[`n|${locale}|${stage}|${from}>${to}`] = { t, row: pk((await appTurn(s, t, locale)).row), from, to };
  }
  return R;
}

const RES = await scenarios();
if (CHILD) {
  process.stdout.write(`@@M16_JSON@@${JSON.stringify({ rows: RES, appRelists: APP_RELISTS, fetchCalls, storageWrites })}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}

let HEAD = null;
if (headDir) {
  const self = "scripts/verify-m16-post-selection-switch-review.mjs";
  if (!existsSync(join(headDir, self)) || readFileSync(join(headDir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(headDir, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--only=${ONLY.join(",")}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 400_000, maxBuffer: 256 << 20 });
  const m = (r.stdout ?? "").match(/@@M16_JSON@@([\s\S]*?)@@END@@/);
  HEAD = m ? JSON.parse(m[1]) : null;
  if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-900)}`);
}

// ------------------------------------------------------------------ checks
const failures = [];
const check = (name, fn) => { try { fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 8).join("\n  ")}`); } };
const tab = (r) => r ? `${r.branch} | ${r.dest}/${r.code}/${r.city ?? "-"} | pend=${r.pending ?? "-"}${r.pendingOpts ? `(${r.pendingOpts.slice(0, 30)})` : ""} off=${r.offered} | ${r.start ?? "-"}~${r.end ?? "-"} d=${r.days ?? "-"} prov=${r.prov ?? "-"} | sid=${r.sidChanged} geo=${r.geoQ.length} | ph=${r.phase} ai=${r.aiState ?? "-"} cps=${r.cps ?? "-"} sel=${j(r.selected)} | ${r.reply.slice(0, 90)}` : "-";
const show = (key) => { const w = RES[key]; const h = HEAD?.rows?.[key]; out(`TAB ${key} 「${w.t ?? ""}」\n   W ${tab(w.row)}${h ? `\n   H ${tab(h.row)}` : ""}`); };
const otherKeys = (want) => Object.keys(GEO).filter((k) => k !== want && !(want === "atami" && k === "tokyo") && !(want === "kyoto" && k === "tokyo"));
const assertSwitched = (row, to, info) => {
  assert.ok(!DESYNC.test(row.branch), `branch ${row.branch}${info}`);
  assert.equal(destKeyOf(row.dest), to, `dest ${row.dest}${info}`);
  assert.equal(row.pending, "combination_choice", `pending ${row.pending} (combinations not re-listed)${info}`);
  assert.ok(row.offered > 0, `no combinations${info}`);
  assert.ok(!LAST_RESORT.test(row.reply), `last-resort copy${info}`);
  assert.equal(row.start, "2026-12-10", `start${info}`); assert.equal(row.end, "2026-12-14", `end${info}`); assert.equal(row.days, 5, `days${info}`);
  assert.equal(row.sidChanged, true, `no reset${info}`);
  if (row.chainReset != null) assert.equal(row.chainReset, false, `second reset${info}`);
  assert.ok(row.geoQ.length <= 1, `geocode > 1: ${j(row.geoQ)}${info}`);
};
const assertNoOld = (row, from, to, info) => {
  const old = (v) => v != null && destKeyOf(String(v).split("/")[0]) === from;
  for (const f of ["city", "trip", "tpc", "weather", "tcWeather"]) assert.ok(!old(row[f]), `${f}=${row[f]} is the previous destination${info}`);
  assert.equal(countryNorm.normalizeCountryReference(row.country, row.code).countryCode, GEO[to].code, `country ${row.country}/${row.code}${info}`);
  for (const f of ["rec", "stops"]) assert.ok(!(row[f] ?? "").split("|").some((n) => n && (GEO[from].re.test(n) || LOCAL[from].some((l) => n.includes(l)))), `${f} still has ${from}: ${row[f]}${info}`);
  assert.ok(!row.draft && !row.dayPlan, `draftTrip / currentDayPlan kept${info}`);
  assert.ok(row.phase !== "done" && row.phase !== "generating", `phase ${row.phase}${info}`);
  assert.ok(row.aiState !== "SUCCESS" && row.aiState !== "CREATING_TRIP" && row.aiState !== "FAILED", `aiItineraryState ${row.aiState}${info}`);
  assert.ok(row.cps !== "generationFailed", `chatPlanningState ${row.cps}${info}`);
  assert.ok(!row.lastTrip, `lastGeneratedTripId ${row.lastTrip}${info}`);
  assert.ok(!(row.selected ?? []).length, `selectedCombinationIds ${j(row.selected)}${info}`);
  const offered = (row.first ?? "").split("|").filter(Boolean);
  for (const k of otherKeys(to)) assert.ok(!offered.some((n) => GEO[k].re.test(n) || LOCAL[k].some((l) => n.includes(l))), `${k} in combinations ${row.first}${info}`);
};
const SAME_FIELDS = ["branch", "dest", "code", "pending", "pendingOpts", "start", "end", "days", "prov", "sidChanged", "phase", "aiState"];
/**
 * "Must not change" = no switch where HEAD has none: same destination, same reset decision, same
 * pending type as HEAD, and no date HEAD kept is lost. HEAD's own date loss (ja / ko step 1, earlier
 * rounds' provenance) and reply wording are printed as INFO, not asserted.
 */
const sameAsHead = (w, h, info) => {
  if (!h) return;
  assert.equal(destKeyOf(w.dest) ?? w.dest, destKeyOf(h.dest) ?? h.dest, `dest HEAD ${h.dest} → WORK ${w.dest}${info}`);
  assert.equal(w.sidChanged, h.sidChanged, `reset HEAD ${h.sidChanged} → WORK ${w.sidChanged}${info}`);
  assert.equal(w.pending, h.pending, `pending HEAD ${h.pending} → WORK ${w.pending}${info}`);
  for (const f of ["start", "end", "days"]) if (h[f] != null) assert.ok(w[f] != null, `${f} lost (HEAD ${h[f]})${info}`);
};
const headDiff = (w, h) => h ? SAME_FIELDS.filter((f) => j(w[f]) !== j(h[f])).map((f) => `${f}: ${j(h[f])} → ${j(w[f])}`).join("; ") || "same" : "n/a";

for (const key of Object.keys(RES)) {
  const w = RES[key]; const h = HEAD?.rows?.[key];
  const [sec] = key.split("|");
  const info = `\n  WORK ${j(w.row)}${h ? `\n  HEAD ${j(h.row)}` : ""}`;
  show(key);
  // M16 round 3 (assigner ruling): 「<current>不去了，我要去 Y」 with Y outside the local city table (熱海) keeps
  // HEAD's switch confirmation question (NEGATED_UNCERTAIN, 0 geocode, nothing switched / reset); a direct switch
  // is not required. Only the zh-TW NEG2 form is the wish wording (en / ja / ko NEG2 carry explicit switch wording).
  const wishUnknownTarget = sec === "n" && key.split("|")[1] === "zh-TW" && w.to === "atami";
  if (wishUnknownTarget) {
    check(`${key} 「${w.t}」: unknown wish target keeps HEAD's confirmation question (0 geocode, no switch)`, () => {
      assert.equal(w.row.cls, "NEGATED_UNCERTAIN", `cls ${w.row.cls}${info}`);
      assert.ok(/^E1 ask/.test(w.row.branch), `branch ${w.row.branch}${info}`);
      assert.equal(w.row.geoQ.length, 0, `geocode ${j(w.row.geoQ)}${info}`);
      assert.equal(destKeyOf(w.row.dest), w.from, `dest ${w.row.dest}${info}`);
      assert.ok(w.row.sidChanged !== true, `reset${info}`);
      if (h) { assert.equal(w.row.branch, h.row.branch, `branch vs HEAD${info}`); assert.equal(h.row.geoQ.length, 0, `HEAD geocode${info}`); }
    });
  } else if (sec === "f" || sec === "n") {
    check(`${key} 「${w.t}」: ${w.to} combinations, dates kept, one reset, ≤1 geocode`, () => assertSwitched(w.row, w.to, `${w.gen ? `\n  GEN ${j(w.gen)}` : ""}${info}`));
    check(`${key} 「${w.t}」: ${w.from} generation / failure state cleared`, () => assertNoOld(w.row, w.from, w.to, info));
    if (sec === "f") check(`${key}: old generation snapshot is not current for the switched session (stale result dropped)`, () => assert.equal(w.staleCurrent, false, `genSid=${w.genSid} newSid=${w.newSid}${info}`));
  } else if (w.kind === "same") {
    check(`${key} 「${w.t}」: no switch / reset / pending change vs HEAD, no date lost`, () => sameAsHead(w.row, h?.row, info));
    out(`INFO ${key} vs HEAD: ${headDiff(w.row, h?.row)}`);
  } else if (w.kind === "switchInfo") {
    let ok = true; try { assertSwitched(w.row, w.to, ""); assertNoOld(w.row, w.from, w.to, ""); } catch { ok = false; }
    out(`INFO ${key} 「${w.t}」 WORK ${ok ? "switches cleanly" : "does NOT switch cleanly"} ${j([w.row.branch, w.row.dest, w.row.pending, w.row.offered, w.row.start])}${h ? ` | HEAD ${j([h.row.branch, h.row.dest, h.row.pending, h.row.offered, h.row.start])}` : ""}`);
    check(`${key} 「${w.t}」: no third destination / desync`, () => { assert.ok([w.from, w.to].includes(destKeyOf(w.row.dest)), info); assert.ok(!/HARNESS|LAST-RESORT/.test(w.row.branch), info); });
  } else if (w.kind === "misfire") {
    // A reset after phase done is the App's ordinary phase_done new session (not the switch); printed below.
    check(`${key} 「${w.t}」: not a city switch (destination stays ${w.from}, same destination as HEAD, never the switch wrapper)`, () => {
      assert.equal(destKeyOf(w.row.dest), w.from, `dest ${w.row.dest}${info}`);
      assert.ok(w.row.via == null, `went through the confirmed switch (${w.row.via})${info}`);
      if (h) assert.equal(destKeyOf(w.row.dest), destKeyOf(h.row.dest), `dest vs HEAD${info}`);
    });
    if (h) { const diff = SAME_FIELDS.filter((f) => j(w.row[f]) !== j(h.row[f])); out(`INFO ${key} vs HEAD: ${diff.length ? diff.map((f) => `${f}: ${j(h.row[f])} → ${j(w.row[f])}`).join("; ") : "same"}`); }
  } else if (w.kind === "info") out(`INFO ${key}: ${tab(w.row)}`);
}
check("j) send is blocked while generating (no switch can be typed during an in-flight generation)", () => assert.ok(/if \(!trimmed \|\| streaming \|\| generating\) return;/.test(APP_SRC)));
check("k) no network: fetch=0 (no Supabase / saved-trip write possible)", () => { assert.equal(fetchCalls, 0); if (HEAD) assert.equal(HEAD.fetchCalls, 0); });
check("k) no storage writes during the switch turns", () => assert.deepEqual(storageWrites.filter((w) => /trip|saved/i.test(w)), [], j(storageWrites.slice(0, 20))));
check("k) switch modules import no saved-trip / Supabase module", () => {
  for (const f of ["src/lib/ai/global-planning-context.ts", "src/lib/ai/trip-planning-session-reset.ts", "src/lib/ai/ai-planning-session.ts"]) {
    const imports = readFileSync(f, "utf8").split("\n").filter((l) => /^import\b/.test(l));
    assert.ok(!imports.some((l) => /saved-trip|supabase|delete-trip|trip-store|savedTrips/i.test(l)), `${f}: ${imports.filter((l) => /saved|supabase/i.test(l)).join(" ")}`);
  }
});
out(`INFO harness: APP_RELISTS=${APP_RELISTS}${HEAD ? ` HEAD APP_RELISTS=${HEAD.appRelists}` : ""}; rows=${Object.keys(RES).length} HEAD rows=${HEAD ? Object.keys(HEAD.rows).length : "n/a"}; storageWrites=${storageWrites.length}`);
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.exit(failures.length ? 1 : 0);
