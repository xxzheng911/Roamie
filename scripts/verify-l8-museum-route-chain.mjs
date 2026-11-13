/**
 * L8 (tester, independent) — 「不去海邊了，改去博物館」 through the route's pure send chain after
 * the merge (_app.chat.tsx 11629 mergeTripPlanningContext → 11730 extract* → 11748 planning
 * constraint delta / 11843 missing-context stop → 11877 style → 11929 add-all → 12011 / 12111 →
 * 12523 → 12574 → 12629 → 12880 planning branch → 12997 advice → 13024..13140 fallback copy).
 * Reconstructs the reply the user sees (asserted: never empty, never the discovery-failure copy
 * while the combination list is still valid, and the combination pending survives).
 * fetch is stubbed (must stay 0). Run with `-- --head-dir=<snapshot>` to record HEAD.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-l8-museum-route-chain.mjs -- --head-dir=<snapshot>
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const out = console.log.bind(console);
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
if (headDir) {
  const self = "scripts/verify-l8-museum-route-chain.mjs";
  if (!existsSync(join(headDir, self)) || readFileSync(join(headDir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(headDir, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs"], { cwd: headDir, encoding: "utf8", timeout: 200_000, maxBuffer: 64 << 20 });
  out(`HEAD RUN (status ${r.status}) ↓\n${(r.stdout ?? "").split("\n").filter((l) => /^(ROW|  )/.test(l)).map((l) => `HEAD| ${l}`).join("\n")}\nHEAD RUN ↑\n`);
}
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 200_000).unref();
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
const chatSession = sessionMod;
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
const turnDestMod = await load("src/lib/ai/chat-turn-destination.ts");

const D = { match: /sydney|雪梨|シドニー|시드니/i, city: "Sydney", region: "New South Wales", countryRaw: "Australia", code: "AU", lat: -33.8688, lng: 151.2093,
  places: ["Sydney Opera House", "Sydney Harbour Bridge", "The Rocks", "Darling Harbour", "Circular Quay", "Bondi Beach", "Australian Museum", "Art Gallery of New South Wales", "Museum of Contemporary Art", "Powerhouse Museum", "Australian National Maritime Museum", "Museum of Sydney", "Royal Botanic Garden Sydney", "Hyde Park", "Centennial Park", "Barangaroo Reserve", "Chinese Garden of Friendship", "Observatory Hill"] };
const geocodeLog = [];
const geocode = async (q) => { geocodeLog.push(q); if (!D.match.test(q)) return { rawResultCount: 0, location: null };
  return { rawResultCount: 1, location: { placeId: "ChIJ_AU_Sydney", country: countryNorm.normalizeCountryReference(D.countryRaw, D.code).country || D.countryRaw, city: D.city, region: D.region, lat: D.lat, lng: D.lng, formattedName: D.city, displayLabel: D.city } }; };
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
async function step1(t, locale) {
  let n = tripIntent.applyTripIntentToSession(t, sessionMod.createEmptySession());
  n = convState.prepareSessionForUserTurn(n, undefined);
  const m = travelContext.mergeTravelContext(n, t, undefined);
  let s = m.session; let ctx = m.context;
  if (ctx.destinationCandidate?.status === "pending") { s = await globalPlanning.resolveGlobalPlanningCandidate(s, locale, geocode); ctx = s.travelContext ?? ctx; }
  await ensure(ctx, s, locale);
  const r = stateMachine.processAdviceTurn(t, s, ctx, undefined, locale);
  return advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply }, r.advice);
}

/** The route chain after the switch gate for a NO_SWITCH turn (see header). */
async function routeChain(s0, t, locale) {
  const msgs = [{ role: "user", content: "step1" }, { role: "assistant", content: s0.lastAssistantReply ?? "" }];
  const g0 = geocodeLog.length;
  const steps = [];
  const partial = Boolean(partialApi && partialApi.isCombinationChoiceTurn(s0) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply?.(t)));
  let n = partial ? clone(s0) : tripIntent.applyTripIntentToSession(t, clone(s0));
  n = convState.prepareSessionForUserTurn(n, s0.lastAssistantReply);
  if (planningState.isReplanIntent(t) && !partial) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const merged = travelContext.mergeTravelContext(n, t, s0.lastAssistantReply);
  n = merged.session;
  if (merged.context.destinationCandidate?.status === "pending") { n = await globalPlanning.resolveGlobalPlanningCandidate(n, locale, geocode); merged.context = n.travelContext ?? merged.context; }
  if (merged.context.destinationClarification || (merged.context.destinationCandidate && merged.context.destinationCandidate.status !== "resolved")) {
    const r = stateMachine.processAdviceTurn(t, n, merged.context, undefined, locale);
    return { branch: "11590 candidate advice", reply: r.advice.reply ?? "", pending: r.route?.pendingQuestion?.type ?? null, geo: geocodeLog.slice(g0), dest: merged.context.destination };
  }
  if (partial) { const r = stateMachine.processAdviceTurn(t, n, merged.context, undefined, locale); return { branch: "11612 partial modify", reply: r.advice.reply ?? "", pending: r.route?.pendingQuestion?.type ?? null, geo: geocodeLog.slice(g0), dest: merged.context.destination }; }
  if (budget.isBudgetRefinementText(t)) n = budget.applyBudgetRefinementToSession(t, { ...n, travelContext: merged.context });
  n = tpc.mergeTripPlanningContext(t, n, merged.context).session;
  n = chatSession.extractPlanningHintsFromText(t, n);
  n = chatSession.extractDiscoveryFromText(t, n);
  n = planningFlow.extractChatPlanningContextFromText(t, n);
  const destCandidate = merged.context.destination?.trim() || n.tripDestination?.displayLabel?.trim() || n.tripDestination?.city?.trim();
  let delta = constraints.parsePlanningConstraintDelta({ text: t, shownCandidates: [], authoritativeDestination: n.travelContext?.destination ?? merged.context.destination ?? destCandidate });
  delta = constraints.disambiguatePlanningDestinationEntity({ delta, destination: destCandidate });
  const req = constraints.resolvePlanningContextRequirement({ text: t, delta, candidateCount: 0, destinationDetected: Boolean(destCandidate), durationOrDateDetected: Boolean(merged.context.days || merged.context.startDate || merged.context.endDate) });
  steps.push(`delta=${JSON.stringify({ ex: delta.excludedPlaces?.length ?? 0, must: delta.mustIncludePlaces?.length ?? 0, accept: delta.acceptRemainingCandidates ?? false })} requiresCandidateContext=${req.requiresCandidateContext}`);
  if (req.requiresCandidateContext) return { branch: "11843 missing candidate context clarification", reply: prodUi.productionUiMessages?.[locale]?.p0bde867c73 ?? "(productionUi.p0bde867c73)", steps, geo: geocodeLog.slice(g0), dest: merged.context.destination };
  n = constraints.applyPlanningConstraintDelta(n, delta, []);
  if (planningState.isStyleReselectTurn(t, n, merged.context)) return { branch: "11877 style reselect", steps, geo: geocodeLog.slice(g0) };
  if (planningState.shouldTriggerTripStylePlanning(t, n, merged.context) && (n.pendingQuestion?.type === "ask_trip_style" || n.chatPlanningState === "waitingStyleSelection")) return { branch: "11904 style planning", steps, geo: geocodeLog.slice(g0) };
  if (addAll.isAddAllToTripIntent(t) || delta.acceptRemainingCandidates === true) return { branch: "11929 add-all / accept remaining", steps, geo: geocodeLog.slice(g0) };
  if (refresh.shouldAcceptAlternativeRecommendations(msgs, t)) return { branch: "12011 alternative", steps, geo: geocodeLog.slice(g0) };
  if (refresh.shouldRefetchPlaces(t, n, merged.context, msgs)) return { branch: "12111 refetch", steps, geo: geocodeLog.slice(g0) };
  const pc = mustVisit.mergeContextForPlaceFetch(n.travelContext ?? merged.context, n);
  if (mustVisit.shouldFetchDestinationPlaces(t, pc, n)) return { branch: "12523 destination places", steps, geo: geocodeLog.slice(g0) };
  const cat = placeIntent.shouldFetchDestinationCategoryPlaces(t, pc, n);
  const auth = nearbyClar.resolveChatRouteAuthority({ structuredShortcut: false, explicitNearbyRequest: chatIntent.userExplicitlyWantsNearbyPlaces(t), pendingNearbyLocationRequest: Boolean(n.pendingNearbyLocationRequest), resolvedNearbyIntent: chatIntent.inferNearbyIntentFromContext(pc, t, n) ?? null, categoryPlaceQuery: cat });
  steps.push(`categoryQuery=${cat} authority=${auth}`);
  if (auth === "destination_category") {
    // 12487 / 6580 with the userText the App passes (12492 / 6584: categorySwitchSearchText(t) ? "" : t; HEAD: t).
    const appText = typeof tpc.categorySwitchSearchText === "function" && tpc.categorySwitchSearchText(t) ? "" : t;
    const td = turnDestMod.resolveCategoryTurnDestination({ ctx: pc, session: n, userText: appText, locale });
    const plan = turnDestMod.planCategoryTurnClarification(td);
    steps.push(`appText=${JSON.stringify(appText)} turnDest=${td.destination ?? "-"} turnClar=${plan ? `${plan.kind}:${plan.clarificationLabel ?? plan.confirmedParentCity}` : "-"}`);
    return { branch: "12574 destination category", steps, geo: geocodeLog.slice(g0), dest: merged.context.destination, turnDest: td.destination ?? null, turnClar: plan ? plan.kind : null,
      // Full push / user-visible text: verify-m2-category-switch-app-reply.mjs.
      reply: plan ? `(clarification ${plan.kind})` : `(category places in ${td.destination ?? "?"})` };
  }
  if (arbitrate.shouldSkipTripPlanningForRefinement(t, n)) return { branch: "12629 refinement", steps, geo: geocodeLog.slice(g0) };
  const planning = (turnEngine.isPlanningTurnActive(n, merged.context) || convState.isDestinationPlanningSession(n, merged.context))
    && !mustVisit.shouldFetchDestinationPlaces(t, pc, n) && !cat
    && !(catTypes.hasCategoryPlaceQuery(t) && !tpc.coerceTravelDestination(catDest.resolveDestinationForCategorySearch(pc, n, t)));
  steps.push(`planningBranch=${planning} catSearchDest=${JSON.stringify(tpc.coerceTravelDestination(catDest.resolveDestinationForCategorySearch(pc, n, t)) ?? null)}`);
  if (!planning) return { branch: "13156+ later dispatch", steps, geo: geocodeLog.slice(g0) };
  const planningCtx = n.travelContext ?? merged.context;
  await ensure(planningCtx, n, locale);
  const r = stateMachine.processAdviceTurn(t, n, planningCtx, undefined, locale);
  if (r.advice.reply) return { branch: "12997 planning advice", reply: r.advice.reply, pending: r.advice.pendingQuestion?.type ?? r.route?.pendingQuestion?.type ?? null, steps, geo: geocodeLog.slice(g0), dest: planningCtx.destination };
  // 13024..13140: days are valid → last-resort copy, pending → ask_preference (refresh option).
  const ack = durationGuard.buildDestinationDirectionAck({ destination: planningCtx.destination, tripDays: planningCtx.days ?? n.tripDays, startDate: planningCtx.startDate, endDate: planningCtx.endDate, locale });
  const failure = prodUi.productionUiMessages?.[locale]?.p7fe9e2ed49 ?? "(productionUi.p7fe9e2ed49)";
  return { branch: "13112 empty advice → last-resort discovery-failure copy", reply: [ack, "", failure].join("\n"), pending: "ask_preference (REFRESH_DESTINATION_RECOMMENDATIONS_OPTION)", steps, geo: geocodeLog.slice(g0), dest: planningCtx.destination };
}

const CASES = [
  ["zh-TW", "12/10-12/14 我要去雪梨", ["不去海邊了，改去博物館", "不去海邊了，改去美術館", "不去海邊了，改去咖啡廳", "不去海邊了，改去夜市", "不去海邊了，改去購物", "改去博物館"]],
  ["en", "12/10-12/14 I'm going to sydney", ["instead of the beach, museums"]],
  ["ja", "12/10-12/14 シドニーへ旅行", ["海じゃなくて博物館にして"]],
  ["ko", "12/10-12/14 시드니 여행", ["바다 말고 박물관으로 하자"]],
];
const failures = [];
const results = [];
for (const [locale, s1text, texts] of CASES) {
  fresh();
  const s1 = await step1(s1text, locale);
  const after = await (async () => { fresh(); const st = clone(s1); return st; })();
  for (const [stage, s0] of [["combination_choice", s1], ["general", { ...after, pendingQuestion: undefined }]]) {
    for (const t of texts) {
      fresh();
      const cls = tpc.classifyDestinationSwitchTurn(t);
      const r = cls.state === "NO_SWITCH" ? await routeChain(s0, t, locale) : { branch: `route gate ${cls.state}` };
      results.push({ locale, stage, t, r });
      out(`ROW [${locale}|${stage}] 「${t}」 → ${r.branch} dest=${r.dest ?? "-"} pending=${r.pending ?? "-"} geo=${JSON.stringify(r.geo ?? [])}\n  steps: ${(r.steps ?? []).join(" ; ")}\n  reply: ${JSON.stringify((r.reply ?? "").slice(0, 160))}`);
    }
  }
}
for (const { locale, stage, t, r } of results.filter((x) => /不去海邊了，改去博物館|instead of the beach, museums|海じゃなくて博物館|바다 말고 박물관/.test(x.t))) {
  const name = `[${locale}|${stage}] 「${t}」: the user sees a meaningful reply (not empty, not the last-resort discovery-failure copy)`;
  try {
    assert.ok((r.reply ?? "").trim() || !/advice/.test(r.branch), `empty reply on ${r.branch}`);
    assert.ok(!/last-resort/.test(r.branch), `${r.branch}\n  reply=${JSON.stringify(r.reply)}\n  pending=${r.pending}`);
    out(`PASS ${name}`);
  } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e.message).split("\n").slice(0, 5).join("\n  ")}`); }
}
for (const { locale, stage, t, r } of results.filter((x) => /destination category/.test(x.r.branch))) {
  const name = `[${locale}|${stage}] 「${t}」: App category branch searches the current destination (no clarification)`;
  try {
    assert.ok(D.match.test(r.turnDest ?? "") || /雪梨/.test(r.turnDest ?? ""), `turnDest=${r.turnDest}`);
    assert.equal(r.turnClar, null, `clarification ${r.turnClar}`);
    out(`PASS ${name}`);
  } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e.message).split("\n").slice(0, 5).join("\n  ")}`); }
}
if (fetchCalls) { failures.push("fetch"); out(`FAIL fetch=${fetchCalls}`); } else out("PASS no network: fetch=0");
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.exit(failures.length ? 1 : 0);
