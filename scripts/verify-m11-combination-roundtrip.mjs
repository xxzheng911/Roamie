/**
 * M11 (tester, independent review of M10). WORK tree only (optional `-- --head-dir=<snapshot>` for the
 * Springfield INFO comparison). App-order harness copied from verify-m7-combination-review.mjs.
 *  a) multi round trip while choosing combinations, four locales, negated / switch / mixed wording:
 *     雪梨 → 熱海 → 雪梨 → 熱海 → 別府 → 熱海 → 海雲台 → 雪梨 (each step: right combinations, no last-resort,
 *     no desync, dates kept, geocode 1 on a city's first visit and 0 on a return, no previous destination).
 *  b) negating the current geocoded destination (海雲台 / 熱海 / 別府) and switching to a known city.
 *  c) currentDestinationLabels widening: stale destinationInputNames, district-suffix stripping, alias matching.
 *  d) restoreProviderScopeLock: scope never applied to another label, same-name-other-country fixture,
 *     App restart (empty caches) re-queries.
 * fetch is stubbed (must stay 0); geocode / Places are fixtures.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=500 scripts/verify-m11-combination-roundtrip.mjs [-- --head-dir=<snapshot>]
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const SPRING_CHILD = argv.includes("--spring-child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 470_000).unref();
let fetchCalls = 0;
globalThis.fetch = async (...a) => { fetchCalls++; throw new Error("NO_NETWORK " + String(a[0])); };
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const resolvedScope = await load("src/lib/ai/resolved-destination-scope.ts");
let authorityInstance = 0;

// ------------------------------------------------------------------ d2 Springfield fixture (also runs in the HEAD child)
async function springfieldChecks() {
  const R = {};
  const US = { placeId: "P_SPR_US", city: "Springfield", region: "Illinois", country: "United States", lat: 39.7817, lng: -89.6501, formattedName: "Springfield", displayLabel: "Springfield" };
  const AU = { placeId: "P_SPR_AU", city: "Springfield", region: "Queensland", country: "Australia", lat: -27.6536, lng: 152.9170, formattedName: "Springfield", displayLabel: "Springfield" };
  let answer = US; let calls = 0;
  const geo = async () => { calls++; return { location: answer, error: null, providerResult: { ok: true, rawResultCount: 1, placeId: answer.placeId, types: ["locality", "political"], primaryType: "locality", countryCode: answer === US ? "US" : "AU", latitude: answer.lat, longitude: answer.lng } }; };
  const td = await load(`src/lib/ai/chat-turn-destination.ts?m11spring=${++authorityInstance}`);
  const ask = async (country) => {
    const c0 = calls;
    const r = await td.resolveTrustedRecommendationSearchScope({ label: "Springfield", ctx: { interests: [], destination: "Springfield", destinationCountry: country }, session: {}, locale: "en", geocodeFn: geo }).catch((e) => ({ status: `throw ${e?.message}` }));
    const sc = resolvedScope.getResolvedDestinationScope("Springfield");
    return { status: r.status, source: r.centerSource ?? null, lat: r.center?.lat ?? null, calls: calls - c0, scopeLat: sc?.latitude ?? null, scopeCode: sc?.countryCode ?? null, loc: resolvedScope.getTrustedProviderLocation?.("Springfield")?.placeId ?? null };
  };
  resolvedScope.clearResolvedDestinationScope();
  R.us = await ask("United States");
  // Trip reset clears the label's scope; trip B (Australia) locked its own Springfield through its own geocode.
  resolvedScope.clearResolvedDestinationScope("Springfield");
  resolvedScope.lockDestinationCoordinatesFromGeocode({ destination: "Springfield", lat: AU.lat, lng: AU.lng, country: AU.country, location: AU });
  answer = AU;
  R.auLocked = await ask("Australia");
  // Trip B without its own lock yet (scope cleared): what does the Authority hand an Australian trip?
  resolvedScope.clearResolvedDestinationScope("Springfield");
  R.auCleared = await ask("Australia");
  resolvedScope.clearResolvedDestinationScope();
  // Authority verification of two-character 府 names (CONFIRMED「不去雪梨了，改去別府」 stops at k2 when unverified).
  R.fu = {};
  for (const [label, loc] of [["別府", { city: "別府市", region: "大分縣" }], ["別府", { city: "Beppu", region: "Oita" }], ["別府市", { city: "別府市", region: "大分縣" }], ["甲府", { city: "甲府市", region: "山梨縣" }], ["熱海", { city: "熱海市", region: "靜岡縣" }]]) {
    const tdf = await load(`src/lib/ai/chat-turn-destination.ts?m11fu=${++authorityInstance}`);
    const fn = async () => ({ location: { placeId: `P_${label}`, country: "日本", lat: 33.2846, lng: 131.4912, formattedName: loc.city, displayLabel: loc.city, ...loc }, error: null,
      providerResult: { ok: true, rawResultCount: 1, placeId: `P_${label}`, types: ["locality", "political"], primaryType: "locality", countryCode: "JP", latitude: 33.2846, longitude: 131.4912 } });
    const r = await tdf.resolveTrustedRecommendationSearchScope({ label, ctx: { interests: [] }, session: {}, locale: "zh-TW", geocodeFn: fn }).catch((e) => ({ status: `throw ${e?.message}` }));
    R.fu[`${label}|${loc.city}`] = { status: r.status, reason: r.reason ?? null, dest: r.destination ?? null };
  }
  resolvedScope.clearResolvedDestinationScope();
  return R;
}
if (SPRING_CHILD) {
  const r = await springfieldChecks();
  process.stdout.write(`@@M11_JSON@@${JSON.stringify(r)}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}

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
const durationGuard = await load("src/lib/ai/trip-duration-guard.ts");
const prodUi = await load("src/lib/i18n/production-ui.ts");
const scopeMod = await load("src/lib/ai/destination-scope.ts");
const copyMod = await load("src/lib/chat-runtime-copy.ts");
const pdd = await load("src/lib/ai/pending-duration-discovery.ts");
const cityDays = await load("src/lib/ai/city-days-planning.ts");
let turnDest = await load("src/lib/ai/chat-turn-destination.ts");
const freshAuthority = async () => { turnDest = await load(`src/lib/ai/chat-turn-destination.ts?m11=${++authorityInstance}`); };
const geoClar = await load("src/lib/ai/destination-geographic-clarification.ts");
const contRec = await load("src/lib/ai/continue-recommendation-intent.ts");
const placeRecIntent = await load("src/lib/ai/place-recommendation-intent/parse.ts");
const APP_SRC = readFileSync("src/routes/_app.chat.tsx", "utf8");
const APP_RELISTS = APP_SRC.includes("switchRelistsCombinations");

// ------------------------------------------------------------------ fixtures (m7 + 別府)
const GEO = {
  sydney: { re: /sydney|雪梨|シドニー|시드니/i, city: "Sydney", region: "New South Wales", country: "Australia", code: "AU", lat: -33.8688, lng: 151.2093 },
  kyoto: { re: /kyoto|京都|교토/i, city: "Kyoto", region: "Kyoto", country: "Japan", code: "JP", lat: 35.0116, lng: 135.7681 },
  atami: { re: /atami|熱海|热海|아타미/i, city: "Atami", region: "Shizuoka", country: "Japan", code: "JP", lat: 35.0959, lng: 139.0717 },
  beppu: { re: /beppu|別府|别府|벳푸/i, city: "Beppu", region: "Oita", country: "Japan", code: "JP", lat: 33.2846, lng: 131.4912 },
  haeundae: { re: /haeundae|해운대|海雲台|海雲臺|海云台/i, city: "Haeundae-gu", region: "Busan", country: "South Korea", code: "KR", lat: 35.1631, lng: 129.1635 },
  tokyo: { re: /tokyo|東京|도쿄/i, city: "Tokyo", region: "Tokyo", country: "Japan", code: "JP", lat: 35.6762, lng: 139.6503 },
};
const LOCAL = { sydney: ["Sydney", "雪梨", "シドニー", "시드니"], kyoto: ["Kyoto", "京都市", "京都市", "교토시"], atami: ["Atami", "熱海市", "熱海市", "아타미시"],
  beppu: ["Beppu", "別府市", "別府市", "벳푸시"], haeundae: ["Haeundae-gu", "海雲臺區", "海雲台区", "해운대구"], tokyo: ["Tokyo", "東京", "東京都", "도쿄"] };
let curLocale = "en";
const localCity = (k) => LOCAL[k][["en", "zh-TW", "ja", "ko"].indexOf(curLocale)] ?? GEO[k].city;
const keyOf = (q) => Object.keys(GEO).find((k) => GEO[k].re.test(q ?? ""));
const destKeyOf = (d) => keyOf(d) ?? Object.keys(LOCAL).find((k) => LOCAL[k].includes(d ?? ""));
const geocodeLog = [];
const locationOf = (k) => { const d = GEO[k]; return { placeId: `ChIJ_${d.code}_${d.city}`, country: countryNorm.normalizeCountryReference(d.country, d.code).country || d.country,
  city: localCity(k), region: d.region, lat: d.lat, lng: d.lng, formattedName: localCity(k), displayLabel: localCity(k) }; };
const geocode = async (q) => {
  geocodeLog.push(q);
  const k = keyOf(q);
  if (!k) return { rawResultCount: 0, location: null };
  return { rawResultCount: 1, location: locationOf(k) };
};
const authorityGeocodeLog = [];
const authorityGeocodeFn = async ({ data }) => {
  authorityGeocodeLog.push(data.query);
  const k = keyOf(data.query);
  if (!k) return { location: null, error: null, providerResult: { ok: true, rawResultCount: 0 } };
  const loc = locationOf(k);
  return { location: loc, error: null, providerResult: { ok: true, rawResultCount: 1, placeId: loc.placeId, types: ["locality", "political"], primaryType: "locality",
    countryCode: GEO[k].code, latitude: loc.lat, longitude: loc.lng } };
};
const poolFor = (dest) => {
  const k = keyOf(dest) ?? destKeyOf(dest) ?? (/japan|日本|일본/i.test(dest ?? "") ? "tokyo" : undefined);
  if (!k) return [];
  const d = GEO[k];
  return Array.from({ length: 18 }, (_, i) => ({ id: `ChIJ${d.code}${k}P${i}`, name: `${localCity(k)} ${["Shrine", "Temple", "Park", "Museum", "Garden", "Tower"][i % 6]} ${i + 1}`, sourceLocale: "en",
    lat: d.lat + i * 0.0003, lng: d.lng, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park",
    rating: 4.6, userRatingCount: 10000, address: `${localCity(k)}, ${d.country}`, businessStatus: "OPERATIONAL" }));
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const fresh = () => { discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache(); };
/** App restart / new App session: every in-memory cache empty (discovery, pool, scope locks, provider locations). */
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
const snapOf = (s, branch, reply, extra = {}) => {
  const tc = s.travelContext ?? {};
  return { branch, dest: tc.destination ?? null, country: tc.destinationCountry ?? null, code: tc.destinationCountryCode ?? null, type: tc.destinationType ?? null,
    trip: s.tripDestination ? `${s.tripDestination.city ?? "-"}/${s.tripDestination.country ?? "-"}` : null, tpc: s.tripPlanningContext?.destination ?? null,
    days: tc.days ?? s.tripDays ?? null, start: tc.startDate ?? null, end: tc.endDate ?? null, city: tc.destinationCity ?? null,
    cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null, inputs: tc.destinationInputNames ?? null,
    pending: s.pendingQuestion?.type ?? null, base: s.pendingQuestion?.baseDestination ?? null,
    offered: (tc.offeredCombinations ?? []).length, offeredAll: (tc.offeredCombinations ?? []).flatMap((c) => (c?.places ?? c?.placeNames ?? []).map((p) => (typeof p === "string" ? p : p?.name))).join("|") || null,
    sid: s.planningSessionId ?? null, reply: (reply ?? "").replace(/\n/g, " / ").slice(0, 240), ...extra };
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

/** One user turn in _app.chat.tsx order: A2 gate then the NO_SWITCH chain (same as verify-m7). */
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

// ------------------------------------------------------------------ sentences
const LOCALES = ["zh-TW", "en", "ja", "ko"];
const NAME = {
  "zh-TW": { sydney: "雪梨", atami: "熱海", beppu: "別府", haeundae: "海雲台", kyoto: "京都" },
  en: { sydney: "Sydney", atami: "Atami", beppu: "Beppu", haeundae: "Haeundae", kyoto: "Kyoto" },
  ja: { sydney: "シドニー", atami: "熱海", beppu: "別府", haeundae: "海雲台", kyoto: "京都" },
  ko: { sydney: "시드니", atami: "아타미", beppu: "벳푸", haeundae: "해운대", kyoto: "교토" },
};
const NEG = { "zh-TW": (a, b) => `不去${a}了，改去${b}`, en: (a, b) => `not ${a} anymore, switch to ${b}`, ja: (a, b) => `${a}はやめて、${b}に変更`, ko: (a, b) => `${a} 말고 ${b}로 바꿔` };
const SWITCH = { "zh-TW": (b) => `改去${b}`, en: (b) => `switch to ${b}`, ja: (b) => `${b}に変更`, ko: (b) => `${b}로 바꿔` };
const STEP1 = { "zh-TW": "12/10-12/14 我要去雪梨", en: "12/10-12/14 I'm going to sydney", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행" };
const SEQ = ["atami", "sydney", "atami", "beppu", "atami", "haeundae", "sydney"];
const LAST_RESORT = /暫時無法取得足夠的實際地點組合|couldn.t get enough real place combinations|実際のスポットの組み合わせ|실제 장소 조합을 충분히|暫時無法取得.*景點資料/i;
const DESYNC = /^B |stop|wrapper_|k2_|p1 |LAST-RESORT|HARNESS|candidate advice|E1 ask|missing candidate/;
const textOf = (mode, locale, prev, next, i) => {
  const m = mode === "mixed" ? (i % 2 ? "switch" : "neg") : mode;
  return m === "neg" ? NEG[locale](NAME[locale][prev], NAME[locale][next]) : SWITCH[locale](NAME[locale][next]);
};
const scopeOf = (k) => {
  for (const l of [...new Set([...LOCAL[k], ...Object.values(NAME).map((n) => n[k])])]) {
    const sc = resolvedScope.getResolvedDestinationScope(l);
    if (sc) return { label: l, lat: sc.latitude, lng: sc.longitude, code: sc.countryCode ?? null };
  }
  return null;
};
const total = (x) => x.geo.length + x.ageo.length + x.dgeo.length;

async function first(t, locale) { return appTurn(sessionMod.createEmptySession(), t, locale); }

// ------------------------------------------------------------------ run
const ONLY = argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const want = (sec) => !ONLY || ONLY.includes(sec);
const failures = [];
const j =(v) => JSON.stringify(v);
const check = (name, fn) => { try { fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 12).join("\n  ")}`); } };
const pk = (x) => x && { cls: x.cls ?? null, cand: x.cand ?? null, branch: x.branch, via: x.via ?? null, authority: x.authority ?? null, dest: x.dest, code: x.code, trip: x.trip, wrapperTrip: x.wrapperTrip ?? null, days: x.days, start: x.start, end: x.end,
  city: x.city ?? null, pending: x.pending, offered: x.offered, first: (x.offeredAll ?? "").split("|").slice(0, 2).join("|"), sidChanged: x.sidChanged, chainReset: x.chainReset ?? null, inputs: x.inputs,
  guard: x.guard ?? null, discoveryRuns: x.discoveryRuns ?? null, placesCalls: x.placesCalls ?? null, trusted: x.trusted ?? null,
  geo: [x.geo?.length, x.ageo?.length, x.dgeo?.length], geoQ: [...(x.geo ?? []), ...(x.ageo ?? []), ...(x.dgeo ?? [])], reply: (x.reply ?? "").slice(0, 110) };

/** A switch turn landed on `want`'s combinations with dates kept, no last-resort / desync, no other destination's results. */
const assertSwitched = (row, want, prev, info) => {
  assert.ok(!DESYNC.test(row.branch), `branch ${row.branch}${info}`);
  assert.equal(destKeyOf(row.dest), want, `dest ${row.dest}${info}`);
  assert.equal(row.pending, "combination_choice", `pending${info}`);
  assert.ok(row.offered > 0, `no combinations${info}`);
  const names = (row.offeredAll ?? "").split("|");
  assert.ok(names.every((n) => GEO[want].re.test(n) || LOCAL[want].some((l) => n.includes(l))), `combinations not all of ${want}: ${row.offeredAll}${info}`);
  for (const other of Object.keys(GEO).filter((k) => k !== want)) {
    assert.ok(!names.some((n) => GEO[other].re.test(n) || LOCAL[other].some((l) => n.includes(l))), `${other} result in combinations${info}`);
  }
  if (row.trip) assert.ok(!prev || destKeyOf(row.trip.split("/")[0]) !== prev, `trip still ${row.trip}${info}`);
  assert.ok(!LAST_RESORT.test(row.reply), `last-resort copy${info}`);
  assert.equal(row.start, "2026-12-10", `start${info}`); assert.equal(row.end, "2026-12-14", `end${info}`); assert.equal(row.days, 5, `days${info}`);
  assert.equal(row.sidChanged, true, `no reset${info}`);
  if (row.chainReset != null) assert.equal(row.chainReset, false, `second reset${info}`);
  assert.ok(![...row.geo, ...row.ageo, ...row.dgeo].some((q) => /不去|やめて|말고|anymore|改去|に変更|바꿔|switch/.test(q)), `whole sentence geocoded${info}`);
};
const assertScopeOwn = (k, info) => {
  const sc = scopeOf(k);
  if (sc) assert.ok(Math.abs(sc.lat - GEO[k].lat) < 0.05 && Math.abs(sc.lng - GEO[k].lng) < 0.05, `${k} scope at another place ${j(sc)}${info}`);
};

// a) round trips
for (const locale of want("a") ? LOCALES : []) for (const mode of ["neg", "switch", "mixed"]) {
  freshAll(); await freshAuthority(); curLocale = locale;
  const s1 = await first(STEP1[locale], locale);
  let s = s1.s;
  check(`a [${locale}] ${mode} STEP1 Sydney combinations`, () => { assert.equal(destKeyOf(s1.row.dest), "sydney", j(pk(s1.row))); assert.equal(s1.row.pending, "combination_choice", j(pk(s1.row))); });
  const seen = new Set(["sydney"]);
  let prev = "sydney";
  for (const [i, next] of SEQ.entries()) {
    const t = textOf(mode, locale, prev, next, i);
    const firstVisit = !seen.has(next);
    const r = await appTurn(s, t, locale);
    const row = r.row;
    out(`ROW a [${locale}] ${mode} #${i + 1} 「${t}」 ${firstVisit ? "first" : "return"} ${j(pk(row))}`);
    const info = `\n  ${j(pk(row))}`;
    check(`a [${locale}] ${mode} #${i + 1} ${prev}→${next} 「${t}」: ${next} combinations, dates kept, no last-resort / desync / old results`, () => assertSwitched(row, next, prev, info));
    // M13: the user approved one geocode per destination switch, so a return visit may query once (≤1), never more.
    check(`a [${locale}] ${mode} #${i + 1} ${prev}→${next}: geocode ${firstVisit ? "≤1 (first visit)" : "≤1 (return)"}`, () => {
      if (firstVisit) assert.ok(total(row) <= 1, `geocode ${j([row.geo, row.ageo, row.dgeo])}${info}`);
      else assert.ok(total(row) <= 1, `return visit queried more than once ${j([row.geo, row.ageo, row.dgeo])}${info}`);
    });
    if (firstVisit && next !== "sydney") check(`a [${locale}] ${mode} #${i + 1} first visit of ${next} queried the provider once`, () => assert.equal(total(row), 1, `${j([row.geo, row.ageo, row.dgeo])}${info}`));
    check(`a [${locale}] ${mode} #${i + 1}: every visited label's scope is its own place (no restored scope on another label)`, () => { for (const k of seen) assertScopeOwn(k, info); assertScopeOwn(next, info); });
    seen.add(next); prev = next; s = r.s;
    if (mode === "neg" && i === 1) {
      // d3) App restart on the Sydney list (session kept, every cache empty): back to 熱海 must query again and work.
      freshAll(); await freshAuthority();
      const t2 = textOf("neg", locale, "sydney", "atami", 0);
      const rr = await appTurn(s, t2, locale);
      out(`ROW d3 [${locale}] restart → 「${t2}」 ${j(pk(rr.row))}`);
      check(`d3 [${locale}] after App restart 「${t2}」: re-queried once, Atami combinations, no last-resort`, () => {
        assertSwitched(rr.row, "atami", "sydney", `\n  ${j(pk(rr.row))}`);
        assert.equal(total(rr.row), 1, `geocode after restart ${j([rr.row.geo, rr.row.ageo, rr.row.dgeo])}`);
        if (rr.row.authority) assert.equal(rr.row.authority, "provider_this_turn", j(pk(rr.row)));
      });
      // Continue the original sequence in a session whose caches were not cleared: rebuild state.
      freshAll(); await freshAuthority();
      // Re-seed caches as before the restart (Sydney → Atami → Sydney again) so the remaining steps keep their meaning.
      const a1 = await appTurn(s1.s, textOf("neg", locale, "sydney", "atami", 0), locale);
      const a2 = await appTurn(a1.s, textOf("neg", locale, "atami", "sydney", 1), locale);
      s = a2.s;
    }
  }
  const one = await appTurn(s, "1", locale);
  out(`ROW a [${locale}] ${mode} 「1」 ${j(pk(one.row))}`);
  check(`a [${locale}] ${mode} final 「1」: no last-resort, no reset, still Sydney`, () => {
    assert.ok(!LAST_RESORT.test(one.row.reply), j(pk(one.row))); assert.equal(one.row.sidChanged, false, j(pk(one.row)));
    assert.equal(destKeyOf(one.row.dest), "sydney", j(pk(one.row)));
  });
}

// b) negate the current geocoded destination, switch to a known city (Sydney, Kyoto)
for (const locale of want("b") ? LOCALES : []) for (const cur of ["haeundae", "atami", "beppu"]) for (const to of ["sydney", "kyoto"]) {
  freshAll(); await freshAuthority(); curLocale = locale;
  const s1 = (await first(STEP1[locale], locale)).s;
  const reach = await appTurn(s1, SWITCH[locale](NAME[locale][cur]), locale);
  const t = NEG[locale](NAME[locale][cur], NAME[locale][to]);
  const r = await appTurn(reach.s, t, locale);
  out(`ROW b [${locale}] on ${cur} (${reach.row.dest}, inputs ${j(reach.row.inputs)}) 「${t}」 ${j(pk(r.row))}`);
  // Sydney is a return visit (0); Kyoto is this session's first visit (≤1).
  check(`b [${locale}] on ${cur} 「${t}」: switches to ${to}, dates kept, no last-resort, geocode ${to === "sydney" ? "0" : "≤1"}`, () => {
    assertSwitched(r.row, to, cur, `\n  REACH ${j(pk(reach.row))}\n  ROW ${j(pk(r.row))}`);
    assert.ok(total(r.row) <= (to === "sydney" ? 0 : 1), `geocode ${j([r.row.geo, r.row.ageo, r.row.dgeo])}`);
  });
}

// e) first-visit negated switch from the Sydney list to each geocoded city (CONFIRMED path in zh).
for (const locale of want("e") ? LOCALES : []) for (const to of ["atami", "beppu", "haeundae"]) {
  freshAll(); await freshAuthority(); curLocale = locale;
  const s1 = (await first(STEP1[locale], locale)).s;
  const t = NEG[locale](NAME[locale].sydney, NAME[locale][to]);
  const r = await appTurn(s1, t, locale);
  out(`ROW e [${locale}] 「${t}」 ${j(pk(r.row))}`);
  check(`e [${locale}] Sydney list 「${t}」: ${to} combinations, one geocode, no stop / last-resort`, () => {
    assertSwitched(r.row, to, "sydney", `\n  ${j(pk(r.row))}`);
    assert.equal(total(r.row), 1, `geocode ${j([r.row.geo, r.row.ageo, r.row.dgeo])}`);
  });
}

// c1) stale destinationInputNames must never block a switch to that name.
for (const locale of want("c1") ? LOCALES : []) {
  freshAll(); await freshAuthority(); curLocale = locale;
  const hStart = { "zh-TW": "12/10-12/14 我要去海雲台", en: "12/10-12/14 I'm going to Haeundae", ja: "12/10-12/14 海雲台へ旅行", ko: "12/10-12/14 해운대 여행" }[locale];
  const h0 = await first(hStart, locale);
  const a = await appTurn(h0.s, SWITCH[locale](NAME[locale].atami), locale);
  const back = await appTurn(a.s, SWITCH[locale](NAME[locale].haeundae), locale);
  out(`ROW c1 [${locale}] 「${hStart}」 ${j(pk(h0.row))}\n   → atami ${j(pk(a.row))}\n   → back ${j(pk(back.row))}`);
  check(`c1 [${locale}] typed 海雲台 first → 熱海 → 「${SWITCH[locale](NAME[locale].haeundae)}」 switches back`, () => {
    assert.equal(destKeyOf(h0.row.dest), "haeundae", `start ${j(pk(h0.row))}`);
    assertSwitched(a.row, "atami", "haeundae", `\n  ${j(pk(a.row))}`);
    assertSwitched(back.row, "haeundae", "atami", `\n  ${j(pk(back.row))}`);
  });
  // Injected stale inputs (a path that left destinationInputNames behind) on the Atami list.
  for (const stale of [[NAME[locale].haeundae], ["海雲台", "해운대", "Haeundae"]]) {
    const staleSession = { ...clone(a.s), travelContext: { ...a.s.travelContext, destinationInputNames: stale } };
    for (const t of [SWITCH[locale](NAME[locale].haeundae), NEG[locale](NAME[locale].atami, NAME[locale].haeundae)]) {
      freshAll(); await freshAuthority();
      const r = await appTurn(staleSession, t, locale);
      out(`ROW c1 [${locale}] stale ${j(stale)} 「${t}」 ${j(pk(r.row))}`);
      check(`c1 [${locale}] stale inputs ${j(stale)} on Atami 「${t}」: switches to Haeundae`, () => assertSwitched(r.row, "haeundae", "atami", `\n  ${j(pk(r.row))}`));
    }
  }
}

// c2) district-suffix stripping must not block a switch (pure globalPlanningTurn on a combination-choice session).
if (want("c2")) {
  curLocale = "zh-TW"; freshAll();
  const base = (await first(STEP1["zh-TW"], "zh-TW")).s;
  const craft = (dest, country, inputs) => ({ ...clone(base), tripDestination: { city: dest, displayLabel: dest, country },
    travelContext: { ...base.travelContext, destination: dest, destinationCity: dest, destinationCountry: country, destinationInputNames: inputs, offeredCombinations: base.travelContext.offeredCombinations },
    pendingQuestion: { ...base.pendingQuestion, type: "combination_choice", baseDestination: dest } });
  const target = (c) => c ? (c.destinationCandidate?.raw ?? c.destination ?? null) : null;
  const CASES = [
    ["中央區", "日本", ["中央區"], "改去京都", /京都/],
    ["中央區", "日本", ["中央區"], "不去中央區了，改去京都", /京都/],
    ["中央区", "日本", ["中央区"], "京都に変更", /京都/],
    ["中區", "台灣", ["中區"], "改去台北", /台北|臺北/],
    ["中區", "台灣", ["中區"], "不去中區了，改去台南", /台南|臺南/],
    ["중구", "대한민국", ["중구"], "교토로 바꿔", /교토|京都|Kyoto/i],
    ["Jung-gu", "South Korea", ["Jung-gu"], "switch to Kyoto", /kyoto|京都/i],
    ["Chuo Ward", "Japan", ["Chuo"], "switch to Kyoto", /kyoto|京都/i],
    ["해운대구", "대한민국", ["해운대"], "해운대 말고 교토로 바꿔", /교토|京都|Kyoto/i],
    ["海雲臺區", "南韓", ["海雲台"], "不去海雲台了，改去雪梨", /雪梨|Sydney/i],
  ];
  // Stripped name equals another real place (松山區 → 松山 Matsuyama, 大同區 → 大同, 中山區 → 中山): reported, not asserted.
  const INFO_CASES = [["松山區", "台灣", ["松山區"], "改去松山"], ["大同區", "台灣", ["大同區"], "改去大同"], ["中山區", "台灣", ["中山區"], "改去中山"], ["中央區", "日本", ["中央區"], "改去中央"]];
  for (const [dest, country, inputs, t, want] of CASES) {
    const c = globalPlanning.globalPlanningTurn(craft(dest, country, inputs), t);
    out(`ROW c2 「${dest}」 「${t}」 → ${j({ target: target(c), dest: c?.destination ?? null, cand: c?.destinationCandidate ?? null })}`);
    check(`c2 current 「${dest}」 「${t}」: not blocked by suffix stripping (target ${want})`, () => assert.ok(want.test(target(c) ?? ""), j({ target: target(c), dest: c?.destination, cand: c?.destinationCandidate })));
  }
  for (const [dest, country, inputs, t] of INFO_CASES) {
    const c = globalPlanning.globalPlanningTurn(craft(dest, country, inputs), t);
    out(`INFO c2 「${dest}」 「${t}」 → ${j({ target: target(c), dest: c?.destination ?? null, cand: c?.destinationCandidate ?? null })}${target(c) && target(c) !== dest ? "" : "  ← stays on current (stripped label collision)"}`);
  }
}

// c3) known-city aliases: the current one never switches, another one always does.
for (const locale of want("c3") ? LOCALES : []) {
  freshAll(); await freshAuthority(); curLocale = locale;
  const s1 = (await first(STEP1[locale], locale)).s;
  const same = { "zh-TW": ["改去Sydney", "改去シドニー"], en: ["switch to 雪梨", "switch to sydney"], ja: ["Sydneyに変更", "雪梨に変更"], ko: ["Sydney로 바꿔", "雪梨로 바꿔"] }[locale];
  const other = { "zh-TW": ["不去Sydney了，改去京都", "不去シドニー了，改去京都"], en: ["not 雪梨 anymore, switch to Kyoto", "not SYDNEY anymore, switch to Kyoto"], ja: ["雪梨はやめて、京都に変更", "Sydneyはやめて、京都に変更"], ko: ["Sydney 말고 교토로 바꿔", "雪梨 말고 교토로 바꿔"] }[locale];
  for (const t of same) {
    const r = await appTurn(s1, t, locale);
    out(`ROW c3 [${locale}] same 「${t}」 ${j(pk(r.row))}`);
    check(`c3 [${locale}] 「${t}」 on the Sydney list: no switch / reset, no last-resort`, () => {
      assert.equal(r.row.sidChanged, false, j(pk(r.row)));
      assert.equal(destKeyOf(r.row.dest), "sydney", j(pk(r.row)));
      assert.ok(!LAST_RESORT.test(r.row.reply), j(pk(r.row)));
    });
  }
  for (const t of other) {
    const r = await appTurn(s1, t, locale);
    out(`ROW c3 [${locale}] other 「${t}」 ${j(pk(r.row))}`);
    check(`c3 [${locale}] 「${t}」 on the Sydney list: switches to Kyoto`, () => assertSwitched(r.row, "kyoto", "sydney", `\n  ${j(pk(r.row))}`));
  }
}

// p) diagnostics for the failing rows (INFO only).
if (ONLY?.includes("p")) {
  const show = (tag, s, t) => {
    const cls = tpc.classifyDestinationSwitchTurn(t);
    const g = globalPlanning.globalPlanningTurn(clone(s), t);
    const tc = s.travelContext ?? {};
    out(`INFO p ${tag} 「${t}」 cls=${cls.state}/${cls.targetLabel ?? "-"} gpt=${j(g ? { dest: g.destination ?? null, cand: g.destinationCandidate ?? null, clar: g.destinationClarification ?? null, inputs: g.destinationInputNames ?? null } : null)} session=${j({ dest: tc.destination, city: tc.destinationCity, inputs: tc.destinationInputNames, clar: tc.destinationClarification, trip: s.tripDestination && [s.tripDestination.city, s.tripDestination.displayLabel], pending: s.pendingQuestion?.type, base: s.pendingQuestion?.baseDestination })}`);
  };
  for (const locale of LOCALES) {
    freshAll(); await freshAuthority(); curLocale = locale;
    const s1 = (await first(STEP1[locale], locale)).s;
    show(`[${locale}] STEP1`, s1, NEG[locale](NAME[locale].sydney, NAME[locale].atami));
    const a1 = await appTurn(s1, NEG[locale](NAME[locale].sydney, NAME[locale].atami), locale);
    const back = await appTurn(a1.s, SWITCH[locale](NAME[locale].sydney), locale);
    show(`[${locale}] after plain back`, back.s, NEG[locale](NAME[locale].sydney, NAME[locale].atami));
    const backNeg = await appTurn(a1.s, NEG[locale](NAME[locale].atami, NAME[locale].sydney), locale);
    show(`[${locale}] after neg back`, backNeg.s, NEG[locale](NAME[locale].sydney, NAME[locale].atami));
    show(`[${locale}] after neg back`, backNeg.s, NEG[locale](NAME[locale].sydney, NAME[locale].beppu));
    out(`INFO p [${locale}] rows a1 ${j(pk(a1.row))}\n   plain back ${j(pk(back.row))}\n   neg back ${j(pk(backNeg.row))}`);
    const again = await appTurn(back.s, NEG[locale](NAME[locale].sydney, NAME[locale].atami), locale);
    out(`INFO p [${locale}] plain back → 「${NEG[locale](NAME[locale].sydney, NAME[locale].atami)}」 ${j(pk(again.row))}`);
    const b = await appTurn(backNeg.s, NEG[locale](NAME[locale].sydney, NAME[locale].beppu), locale);
    out(`INFO p [${locale}] neg back → beppu ${j(pk(b.row))}`);
    show(`[${locale}] on beppu`, b.s, NEG[locale](NAME[locale].beppu, NAME[locale].atami));
    const h = await appTurn(s1, SWITCH[locale](NAME[locale].haeundae), locale);
    show(`[${locale}] on haeundae`, h.s, NEG[locale](NAME[locale].haeundae, NAME[locale].kyoto));
    show(`[${locale}] Sydney list`, s1, { "zh-TW": "改去シドニー", en: "not 雪梨 anymore, switch to Kyoto", ja: "雪梨はやめて、京都に変更", ko: "雪梨 말고 교토로 바꿔" }[locale]);
    const staleSession = { ...clone(a1.s), travelContext: { ...a1.s.travelContext, destinationInputNames: [NAME[locale].haeundae] } };
    show(`[${locale}] stale atami`, staleSession, SWITCH[locale](NAME[locale].haeundae));
    show(`[${locale}] stale atami`, staleSession, NEG[locale](NAME[locale].atami, NAME[locale].haeundae));
    show(`[${locale}] fresh atami`, a1.s, SWITCH[locale](NAME[locale].haeundae));
  }
}

// m13) M13 independent review probes (only with --only=m13; the full run is unchanged).
if (ONLY?.includes("m13")) {
  // m13a) pure fold: 臺／台, 區／区 and one 區／市 suffix; never a different name.
  for (const [a, b, want] of [["海雲台", "海雲臺區", true], ["海雲台", "海雲台站", false], ["新宿", "新宿區", true], ["京都", "京都府", false], ["別府", "別府市", true], ["中山", "中山區", null], ["大同", "大同區", null], ["中山", "中山市", null]]) {
    const v = typeof tpc.sameHanPlaceVariant === "function" ? tpc.sameHanPlaceVariant(a, b) : "(n/a)";
    out(`INFO m13a sameHanPlaceVariant(${a}, ${b}) = ${v}`);
    if (want !== null) check(`m13a sameHanPlaceVariant(${a}, ${b}) is ${want}`, () => assert.equal(v, want));
  }
  // m13b) mergeTripPlanningContext: a folded-equal name of ANOTHER place (centers far apart) must not keep the old place.
  freshAll(); await freshAuthority(); curLocale = "zh-TW";
  const syd = (await first(STEP1["zh-TW"], "zh-TW")).s;
  const craftTrip = (trip, dest, country, coords) => ({ ...clone(syd), pendingQuestion: undefined, tripDestination: trip,
    travelContext: { ...syd.travelContext, destination: dest, destinationCity: dest, destinationCountry: country, destinationCountryCode: undefined, destinationCoordinates: coords,
      destinationCandidate: undefined, destinationInputNames: [dest], offeredCombinations: undefined, destinationType: "city" },
    tripPlanningContext: { ...(syd.tripPlanningContext ?? {}), destination: trip.city } });
  const TP = (city, placeId, country, lat, lng) => ({ placeId, city, displayLabel: city, formattedName: city, country, region: "", lat, lng });
  const B_CASES = [
    // [trip (old resolved place), new destination, its country, its center, text, keep old placeId?]
    [TP("中山區", "P_TW_TPE_ZHONGSHAN", "台灣", 25.0640, 121.5330), "中山", "中國", { lat: 22.5170, lng: 113.3920 }, "我要去中山玩3天", false],
    [TP("大同區", "P_TW_TPE_DATONG", "台灣", 25.0630, 121.5130), "大同", "中國", { lat: 40.0760, lng: 113.3000 }, "我要去大同玩3天", false],
    [TP("熱海市", "ChIJ_JP_Atami", "日本", 35.0959, 139.0717), "別府", "日本", { lat: 33.2846, lng: 131.4912 }, "我要去別府玩3天", false],
    [TP("海雲臺區", "ChIJ_KR_Haeundae-gu", "南韓", 35.1631, 129.1635), "海雲台", "南韓", { lat: 35.1631, lng: 129.1635 }, "我要去海雲台玩3天", true],
  ];
  for (const [trip, dest, country, coords, t, keep] of B_CASES) {
    const s = craftTrip(trip, dest, country, coords);
    const r = tpc.mergeTripPlanningContext(t, s, s.travelContext);
    const td = r.session.tripDestination;
    out(`ROW m13b trip 「${trip.city}」(${trip.lat},${trip.lng}) → dest 「${dest}」(${coords.lat},${coords.lng}) 「${t}」 mode=${r.context.intent} → trip ${j(td && { placeId: td.placeId ?? null, city: td.city, lat: td.lat ?? null })}`);
    check(`m13b mergeTripPlanningContext 「${trip.city}」→「${dest}」 (${keep ? "same place, keeps resolved place" : "other place, old placeId not kept"})`, () => {
      if (keep) assert.equal(td?.placeId, trip.placeId, j(td));
      else assert.notEqual(td?.placeId, trip.placeId, `new destination 「${dest}」 written with the old place ${j(td)}`);
    });
  }
  // m13c) wrapper withTrustedSwitchScope: name folds equal (海雲臺區 = 海雲台) but the provider location is far from the trusted center.
  for (const [tag, mutate, adopt] of [["same center", (l) => l, true], ["lat +0.04", (l) => ({ ...l, lat: l.lat + 0.04 }), true],
    ["lat +0.2", (l) => ({ ...l, lat: l.lat + 0.2 }), false], ["lng -0.5", (l) => ({ ...l, lng: l.lng - 0.5 }), false],
    ["other name 海雲台站", (l) => ({ ...l, city: "海雲台站", displayLabel: "海雲台站", formattedName: "海雲台站", region: "海雲台站" }), false]]) {
    freshAll(); await freshAuthority(); curLocale = "zh-TW";
    const s1 = (await first(STEP1["zh-TW"], "zh-TW")).s;
    const trusted = await turnDest.resolveTrustedRecommendationSearchScope({ label: "海雲台", ctx: s1.travelContext, session: s1, locale: "zh-TW", geocodeFn: authorityGeocodeFn });
    const loc = mutate(locationOf("haeundae"));
    const res = travelContext.applyConfirmedDestinationSwitch({ ...clone(s1), pendingClarification: undefined }, { label: "海雲台", requestText: "不去雪梨了，改去海雲台",
      turnResetBase: { planningSessionId: s1.planningSessionId, planVersion: s1.planVersion }, resetAlreadyThisTurn: false, trustedCenter: trusted.center, trustedLocation: loc });
    const td = res.session?.tripDestination;
    out(`ROW m13c ${tag}: trusted=${trusted.status}/${j(trusted.center)} loc=(${loc.lat},${loc.lng}) ${loc.city} → applied=${res.applied ?? res.stop} trip ${j(td && { placeId: td.placeId ?? null, city: td.city, displayLabel: td.displayLabel, lat: td.lat ?? null })}`);
    check(`m13c wrapper ${tag}: provider location ${adopt ? "adopted" : "not adopted"}`, () => {
      assert.equal(trusted.status, "trusted", j(trusted));
      if (adopt) { assert.equal(td?.placeId, loc.placeId, j(td)); assert.equal(td?.displayLabel, "海雲台", j(td)); }
      else assert.ok(!(td?.placeId === loc.placeId && td?.lat === loc.lat && td?.lng === loc.lng), `far / other-name location adopted ${j(td)}`);
    });
  }
  // m13d) 「改去X」 with X = the current destination is kept; a nearby / different-named X is not swallowed.
  freshAll(); await freshAuthority(); curLocale = "zh-TW";
  const sy = (await first(STEP1["zh-TW"], "zh-TW")).s;
  const onAtami = await appTurn(sy, "改去熱海", "zh-TW");
  out(`ROW m13d reach 熱海 ${j(pk(onAtami.row))} cand=${j(onAtami.s.travelContext?.destinationCandidate ?? null)}`);
  for (const t of ["改去熱海", "改去熱海市"]) {
    const r = await appTurn(onAtami.s, t, "zh-TW");
    out(`ROW m13d same 「${t}」 ${j(pk(r.row))}`);
    check(`m13d on 熱海 「${t}」: kept (no reset, no geocode, still Atami)`, () => {
      assert.equal(r.row.sidChanged, false, j(pk(r.row))); assert.equal(destKeyOf(r.row.dest), "atami", j(pk(r.row))); assert.equal(total(r.row), 0, j(pk(r.row)));
      assert.ok(!LAST_RESORT.test(r.row.reply), j(pk(r.row)));
    });
  }
  for (const t of ["改去伊東", "改去熱川", "不去熱海了，改去伊東"]) {
    const r = await appTurn(onAtami.s, t, "zh-TW");
    out(`ROW m13d nearby 「${t}」 ${j(pk(r.row))}`);
    check(`m13d on 熱海 「${t}」: not read as the current destination (target queried)`, () => assert.ok([...r.row.geo, ...r.row.ageo, ...r.row.dgeo].some((q) => /伊東|熱川/.test(q)), j(pk(r.row))));
  }
  const haeCraft = { ...clone(sy), tripDestination: { ...locationOf("haeundae"), city: "海雲臺區", displayLabel: "海雲台" },
    travelContext: { ...sy.travelContext, destination: "海雲台", destinationCity: "海雲臺區", destinationCountry: "南韓", destinationInputNames: ["海雲台"], destinationCandidate: { raw: "海雲台", status: "resolved" } },
    pendingQuestion: { ...sy.pendingQuestion, type: "combination_choice", baseDestination: "海雲台" } };
  for (const [t, want] of [["改去海雲台站", /海雲台站/], ["改去海雲臺", null], ["改去海雲臺區", null]]) {
    const c = globalPlanning.globalPlanningTurn(clone(haeCraft), t);
    const tgt = c ? (c.destinationCandidate?.raw ?? c.destination ?? null) : null;
    out(`ROW m13d gpt on 海雲台 「${t}」 → ${j({ target: tgt, cand: c?.destinationCandidate ?? null })}`);
    check(`m13d gpt on 海雲台 「${t}」: ${want ? "switch candidate " + want : "stays current"}`, () => {
      if (want) assert.match(tgt ?? "", want, j(c?.destinationCandidate));
      else assert.ok(!c?.destinationCandidate || c.destinationCandidate.status === "resolved", j(c?.destinationCandidate));
    });
  }
  // m13e) a stale resolved candidate raw (old destination) must never make the old name read as current.
  for (const locale of LOCALES) {
    freshAll(); await freshAuthority(); curLocale = locale;
    const s1 = (await first(STEP1[locale], locale)).s;
    const a = await appTurn(s1, SWITCH[locale](NAME[locale].atami), locale);
    const back = await appTurn(a.s, SWITCH[locale](NAME[locale].sydney), locale);
    out(`ROW m13e [${locale}] after back to Sydney: cand=${j(back.s.travelContext?.destinationCandidate ?? null)} city=${back.s.travelContext?.destinationCity ?? null} trip=${back.row.trip}\n   back row ${j(pk(back.row))}`);
    check(`m13e [${locale}] 熱海 → 「${SWITCH[locale](NAME[locale].sydney)}」: destinationCity is not the previous destination`, () => {
      const city = back.s.travelContext?.destinationCity;
      assert.ok(!city || destKeyOf(city) !== "atami", `destination ${back.s.travelContext?.destination} with destinationCity ${city}`);
    });
    check(`m13e [${locale}] 熱海 → 「${SWITCH[locale](NAME[locale].sydney)}」: country / pending country are Australia (not the previous destination's)`, () => {
      const tc = back.s.travelContext ?? {};
      const info = j({ dest: tc.destination, country: tc.destinationCountry, code: tc.destinationCountryCode, type: tc.destinationType, city: tc.destinationCity, pendingCountry: back.s.pendingQuestion?.destinationCountry });
      assert.equal(countryNorm.normalizeCountryReference(tc.destinationCountry, undefined).countryCode, "AU", info);
      if (back.s.pendingQuestion?.destinationCountry) assert.equal(countryNorm.normalizeCountryReference(back.s.pendingQuestion.destinationCountry).countryCode, "AU", info);
    });
    {
      // Trace where destinationCity comes from on the plain return switch.
      const t = SWITCH[locale](NAME[locale].sydney);
      const b0 = clone(a.s);
      const sw = globalPlanning.combinationChoiceSwitchForSession(b0, t);
      const gpt = globalPlanning.globalPlanningTurn(b0, t);
      const applied = gpt ? globalPlanning.applyGlobalPlanningContext(b0, gpt) : null;
      const n1 = tripIntent.applyTripIntentToSession(t, clone(a.s));
      const merged = travelContext.mergeTravelContext(convState.prepareSessionForUserTurn(n1, a.s.lastAssistantReply), t, a.s.lastAssistantReply);
      const tp = tpc.mergeTripPlanningContext(t, merged.session, merged.context);
      let x = tp.session; const steps = [];
      x = sessionMod.extractPlanningHintsFromText(t, x); steps.push(`hints=${x.travelContext?.destinationCity}`);
      x = sessionMod.extractDiscoveryFromText(t, x); steps.push(`disc=${x.travelContext?.destinationCity}`);
      x = planningFlow.extractChatPlanningContextFromText(t, x); steps.push(`flow=${x.travelContext?.destinationCity}`);
      const dl = constraints.parsePlanningConstraintDelta({ text: t, shownCandidates: [], authoritativeDestination: x.travelContext?.destination });
      x = constraints.applyPlanningConstraintDelta(x, dl, []); steps.push(`delta=${x.travelContext?.destinationCity}`);
      await ensure(x.travelContext, x, locale);
      const adv = stateMachine.processAdviceTurn(t, x, x.travelContext, undefined, locale);
      steps.push(`adv.session=${adv.session?.travelContext?.destinationCity} patch=${adv.advice?.contextPatch?.destinationCity ?? "-"}`);
      const fin = finish(adv, a.s.lastAssistantReply); steps.push(`finish=${fin.travelContext?.destinationCity}`);
      steps.push(`finish.country=${fin.travelContext?.destinationCountry}/${fin.travelContext?.destinationCountryCode} type=${fin.travelContext?.destinationType} region=${fin.travelContext?.destinationRegion} pendingCountry=${fin.pendingQuestion?.destinationCountry ?? "-"}`);
      out(`INFO m13e [${locale}] chain ${steps.join(" | ")}`);
      out(`INFO m13e [${locale}] trace 「${t}」: atami city=${a.s.travelContext?.destinationCity} | switchFor=${j(sw && { dest: sw.destination, city: sw.scope?.destinationCity ?? null })} | gpt.city=${gpt?.destinationCity ?? null} | applied.city=${applied?.context?.destinationCity ?? null}/${applied?.session?.travelContext?.destinationCity ?? null} | tripIntent.city=${n1.travelContext?.destinationCity ?? null} | merged.city=${merged.context.destinationCity ?? null} | tpc.city=${tp.session.travelContext?.destinationCity ?? null}`);
    }
    const stale = { ...clone(back.s), travelContext: { ...back.s.travelContext, destinationCandidate: { raw: NAME[locale].atami, status: "resolved" } } };
    for (const t of [SWITCH[locale](NAME[locale].atami), NEG[locale](NAME[locale].sydney, NAME[locale].atami)]) {
      for (const [tag, s] of [["real", back.s], ["stale-cand", stale]]) {
        const r = await appTurn(s, t, locale);
        out(`ROW m13e [${locale}] ${tag} 「${t}」 ${j(pk(r.row))}`);
        check(`m13e [${locale}] ${tag} Sydney list 「${t}」: switches to Atami`, () => assertSwitched(r.row, "atami", "sydney", `\n  ${j(pk(r.row))}`));
      }
    }
    // Leave combination choice (pick 1), go back to Sydney, then switch to Atami again.
    const one = await appTurn(a.s, "1", locale);
    const b2 = await appTurn(one.s, SWITCH[locale](NAME[locale].sydney), locale);
    const a2 = await appTurn(b2.s, SWITCH[locale](NAME[locale].atami), locale);
    out(`ROW m13e [${locale}] 「1」 on Atami ${j(pk(one.row))}\n   → sydney ${j(pk(b2.row))} cand=${j(b2.s.travelContext?.destinationCandidate ?? null)}\n   → atami ${j(pk(a2.row))}`);
    check(`m13e [${locale}] 熱海 → 「1」 → 「${SWITCH[locale](NAME[locale].sydney)}」: leaves Atami`, () => assert.equal(destKeyOf(b2.row.dest), "sydney", j(pk(b2.row))));
    check(`m13e [${locale}] 熱海 → 「1」 → 雪梨 → 熱海: lands on Atami`, () => { assert.equal(destKeyOf(a2.row.dest), "atami", j(pk(a2.row))); assert.ok(!LAST_RESORT.test(a2.row.reply), j(pk(a2.row))); });
  }
  // m13f) English negated clause with non-Latin names; non-place negations untouched.
  freshAll(); await freshAuthority(); curLocale = "en";
  const en1 = (await first(STEP1.en, "en")).s;
  for (const t of ["not Sydney anymore, switch to 京都", "not 雪梨 anymore, switch to 京都", "not シドニー anymore, switch to 京都", "not 시드니 anymore, switch to 京都", "not Tokyo anymore, switch to 京都"]) {
    const r = await appTurn(en1, t, "en");
    out(`ROW m13f 「${t}」 ${j(pk(r.row))}`);
    check(`m13f en Sydney list 「${t}」: switches to Kyoto`, () => assertSwitched(r.row, "kyoto", "sydney", `\n  ${j(pk(r.row))}`));
  }
  for (const t of ["not 1", "not the beach", "not 2, the first one", "not now"]) {
    const r = await appTurn(en1, t, "en");
    out(`ROW m13f 「${t}」 ${j(pk(r.row))}`);
    check(`m13f en Sydney list 「${t}」: no switch / reset / geocode, still Sydney`, () => {
      assert.equal(r.row.sidChanged, false, j(pk(r.row))); assert.equal(destKeyOf(r.row.dest), "sydney", j(pk(r.row))); assert.equal(total(r.row), 0, j(pk(r.row)));
    });
  }
  const enAtami = await appTurn(en1, "switch to Atami", "en");
  for (const t of ["not 熱海 anymore, switch to 別府", "not Atami anymore, switch to 別府"]) {
    const r = await appTurn(enAtami.s, t, "en");
    out(`ROW m13f on Atami 「${t}」 ${j(pk(r.row))}`);
    check(`m13f en Atami list 「${t}」: switches to Beppu`, () => assertSwitched(r.row, "beppu", "atami", `\n  ${j(pk(r.row))}`));
  }
}

// d1) a restored scope is the label's own and never lands on another label (direct Authority calls).
if (want("d")) {
  freshAll(); await freshAuthority(); curLocale = "zh-TW";
  const call = (label) => turnDest.resolveTrustedRecommendationSearchScope({ label, ctx: { interests: [] }, session: {}, locale: "zh-TW", geocodeFn: authorityGeocodeFn });
  const a0 = authorityGeocodeLog.length;
  const r1 = await call("熱海"); const r2 = await call("別府");
  resolvedScope.clearResolvedDestinationScope("熱海"); resolvedScope.clearResolvedDestinationScope("別府");
  const r3 = await call("熱海");
  const atamiScope = scopeOf("atami"); const beppuScope = scopeOf("beppu");
  const R = { r1: r1.centerSource, r2: r2.centerSource, r3: r3.centerSource, calls: authorityGeocodeLog.length - a0, atamiScope, beppuScope, atamiLoc: resolvedScope.getTrustedProviderLocation("熱海")?.placeId ?? null, beppuLoc: resolvedScope.getTrustedProviderLocation("別府")?.placeId ?? null };
  out(`ROW d1 ${j(R)}`);
  out(`INFO d1 Authority 「別府」 → ${j(r2)}`);
  check("d1 provider_locked 熱海 after reset: restores 熱海's own scope, 別府 stays cleared, no provider call", () => {
    assert.equal(R.r3, "provider_locked", j(R));
    assert.equal(R.calls, 2, j(R));
    assert.ok(atamiScope && Math.abs(atamiScope.lat - GEO.atami.lat) < 0.01, j(R));
    assert.equal(beppuScope, null, j(R));
    assert.equal(R.beppuLoc, null, j(R));
    assert.match(R.atamiLoc ?? "", /ChIJ_JP_Atami/, j(R));
  });
  // A label whose scope is already locked (to its own place) is not touched by a restore.
  resolvedScope.clearResolvedDestinationScope("熱海");
  resolvedScope.lockDestinationCoordinatesFromGeocode({ destination: "熱海", lat: 35.1, lng: 139.08, country: "日本" });
  await call("熱海");
  const kept = scopeOf("atami");
  check("d1 existing scope lock is not overwritten by restoreProviderScopeLock", () => assert.ok(kept && kept.lat === 35.1 && kept.lng === 139.08, j(kept)));
  freshAll();
}

// d2) same name, other country.
const SPR = await springfieldChecks();
let SPR_HEAD = null;
if (headDir) {
  const self = "scripts/verify-m11-combination-roundtrip.mjs";
  if (!existsSync(join(headDir, self)) || readFileSync(join(headDir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(headDir, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--spring-child"], { cwd: headDir, encoding: "utf8", timeout: 120_000, maxBuffer: 16 << 20 });
  const m = (r.stdout ?? "").match(/@@M11_JSON@@([\s\S]*?)@@END@@/);
  SPR_HEAD = m ? JSON.parse(m[1]) : null;
  if (!m) out(`NOTE HEAD Springfield child produced no JSON (status ${r.status}): ${(r.stderr ?? "").slice(-600)}`);
}
out(`ROW d2 WORK ${j(SPR)}${SPR_HEAD ? `\n     HEAD ${j(SPR_HEAD)}` : ""}`);
check("d2 Springfield: B (Australia) scope locked at AU is not replaced by A's (US) cached answer", () => {
  assert.ok(SPR.auLocked.scopeLat != null && Math.abs(SPR.auLocked.scopeLat - -27.6536) < 0.05, j(SPR));
});
check("d2 Springfield: after a reset, an Australian trip never gets A's (US) location restored as its scope", () => {
  assert.ok(SPR.auCleared.scopeLat == null || Math.abs(SPR.auCleared.scopeLat - 39.7817) > 0.05, `US scope restored for the AU trip ${j(SPR.auCleared)}`);
});
for (const [k, v] of Object.entries(SPR.fu)) out(`ROW fu Authority 「${k.replace("|", "」 provider 「")}」 WORK ${j(v)}${SPR_HEAD?.fu ? ` HEAD ${j(SPR_HEAD.fu[k])}` : ""}`);
check("fu Authority verifies 「別府」 when the provider answers 別府市 / 大分縣 (same as 熱海 → 熱海市)", () => {
  assert.equal(SPR.fu["熱海|熱海市"].status, "trusted", j(SPR.fu));
  assert.equal(SPR.fu["別府|別府市"].status, "trusted", j(SPR.fu));
});
out(`INFO d2 Authority center for the AU trip: locked=${SPR.auLocked.lat} cleared=${SPR.auCleared.lat} (US=39.7817, AU=-27.6536)${SPR_HEAD ? ` HEAD locked=${SPR_HEAD.auLocked.lat} cleared=${SPR_HEAD.auCleared.lat}` : ""}`);

check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
out(`INFO harness: APP_RELISTS=${APP_RELISTS}`);
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.exit(failures.length ? 1 : 0);
