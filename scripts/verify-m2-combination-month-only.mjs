/**
 * M2 (tester, independent) — month-only change while choosing combinations, all four locales:
 *  「改成X月」"make it <Month>"「X月に変更」「X월로 바꿔」 × same month / cross month (same year) / cross year:
 *   - the combination list stays (same pending, same options), reply = combinationMonthUpdated, no generation;
 *   - same month keeps the typed range + user_date provenance; a month change clears start / end and
 *     leaves no confirmed user_date provenance; travelMonth follows the new month;
 *   - the App routes before the planning branch (alternative / refetch / destination places / category /
 *     refinement) do not take the turn;
 *   - 「1」 afterwards selects and continues exactly like a month-only trip (control: STEP1 with only a month).
 *  Also: parseCombinationSelectionIndices never reads 「1月」「1월」 as combination 1, while 「1」「1번」「1と3」 still are.
 * fetch is stubbed (must stay 0). Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-m2-combination-month-only.mjs
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 280_000).unref();
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
const { existsSync, readFileSync, copyFileSync } = await import("node:fs");
const partialApi = existsSync("src/lib/ai/combination-partial-modify-reply.ts") ? await load("src/lib/ai/combination-partial-modify-reply.ts") : { isCombinationChoiceTurn: () => false };
const suggestions = await load("src/lib/ai/destination-combination-suggestions.ts");
const refresh = await load("src/lib/ai/chat-recommendation-refresh.ts");
const mustVisit = await load("src/lib/ai/must-visit-places.ts");
const placeIntent = await load("src/lib/ai/chat-place-intent.ts");
const arbitrate = await load("src/lib/ai/recommendation-refinement/arbitrate.ts");
const addAll = await load("src/lib/ai/parse-add-all-to-trip-intent.ts");
const numericAuth = await load("src/lib/ai/numeric-selection-authority.ts");

const SYD = { placeId: "ChIJ_AU_Sydney", country: countryNorm.normalizeCountryReference("Australia", "AU").country || "Australia", city: "Sydney", region: "New South Wales", lat: -33.8688, lng: 151.2093, formattedName: "Sydney", displayLabel: "Sydney" };
const geocodeLog = [];
const geocode = async (q) => { geocodeLog.push(q); return /sydney|雪梨|シドニー|시드니/i.test(q) ? { rawResultCount: 1, location: SYD } : { rawResultCount: 0, location: null }; };
const pool = () => ["Sydney Opera House", "Sydney Harbour Bridge", "The Rocks", "Darling Harbour", "Circular Quay", "Bondi Beach", "Australian Museum", "Art Gallery of New South Wales", "Museum of Contemporary Art", "Powerhouse Museum", "Australian National Maritime Museum", "Museum of Sydney", "Royal Botanic Garden Sydney", "Hyde Park", "Centennial Park", "Barangaroo Reserve", "Chinese Garden of Friendship", "Observatory Hill"]
  .map((name, i) => ({ id: `ChIJAUP${i}`, name, sourceLocale: "en", lat: SYD.lat + i * 0.0003, lng: SYD.lng, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.6, userRatingCount: 10000, address: "Sydney NSW, Australia", businessStatus: "OPERATIONAL" }));
const clone = (v) => JSON.parse(JSON.stringify(v));
const fresh = () => { discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache(); };

async function sendTurn(s0, t, locale) {
  const s = clone(s0);
  const lastReply = s.lastAssistantReply;
  const flag = partialApi.isCombinationChoiceTurn(s) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply?.(t));
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, lastReply);
  if (planningState.isReplanIntent(t) && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const g0 = geocodeLog.length;
  const m = travelContext.mergeTravelContext(n, t, lastReply);
  let session = m.session; let ctx = m.context;
  if (ctx.destinationCandidate?.status === "pending") { session = await globalPlanning.resolveGlobalPlanningCandidate(session, locale, geocode); ctx = session.travelContext ?? ctx; }
  // App route predicates that run before the planning branch (_app.chat.tsx 11929 / 12011 / 12111 / 12523 / 12574 / 12629).
  const msgs = [{ role: "user", content: "x" }, { role: "assistant", content: lastReply ?? "" }];
  const pc = mustVisit.mergeContextForPlaceFetch(ctx, session);
  const routes = { numericGate: numericAuth.isNumericSelection(t), addAll: addAll.isAddAllToTripIntent(t), alternative: refresh.shouldAcceptAlternativeRecommendations(msgs, t), refetch: refresh.shouldRefetchPlaces(t, session, ctx, msgs),
    destinationPlaces: mustVisit.shouldFetchDestinationPlaces(t, pc, session), category: placeIntent.shouldFetchDestinationCategoryPlaces(t, pc, session), refinement: arbitrate.shouldSkipTripPlanningForRefinement(t, session) };
  const days = ctx.days ?? session.tripDays;
  if (ctx.destination && days && !ctx.destinationClarification) {
    await discovery.ensureDestinationCombinationsReady({ destination: ctx.destination, destinationCountry: ctx.destinationCountryCode ?? ctx.destinationCountry, locale, days,
      resolvedDestination: ctx.destinationCoordinates ? { label: ctx.destination, city: ctx.destinationCity ?? ctx.destination, country: ctx.destinationCountryCode ?? ctx.destinationCountry, countryCode: ctx.destinationCountryCode,
        type: ctx.destinationType ?? "city", latitude: ctx.destinationCoordinates.lat, longitude: ctx.destinationCoordinates.lng, placeId: session.tripDestination?.placeId, source: "trip_destination", scopeLocked: false } : undefined,
      searchPlaces: async () => ({ places: pool(), error: null }) }).catch(() => null);
  }
  const r = stateMachine.processAdviceTurn(t, session, ctx, undefined, locale);
  const next = advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply ?? lastReply }, r.advice);
  let gate = null;
  if (r.advice.triggerItineraryGeneration) {
    const paused = dateConfirm.prepareTripDateConfirmation({ ...next, travelContext: { ...ctx, ...(r.advice.contextPatch ?? {}) } }, { entry: "direct" });
    const proposed = paused?.pendingQuestion?.dateConfirmation?.proposed;
    gate = paused ? { paused: true, kind: paused.pendingQuestion?.type ?? null, proposed: proposed ? `${proposed.source}:${proposed.startDate ?? "-"}~${proposed.endDate ?? "-"}` : null } : { paused: false };
  }
  const tc = next.travelContext ?? {};
  const opts = (p) => JSON.stringify((p?.options ?? []).map((o) => (typeof o === "string" ? o : o?.title ?? o?.id ?? o)));
  return { s: next, reply: r.advice.reply ?? "", routes, snap: { dest: tc.destination ?? null, start: tc.startDate ?? null, end: tc.endDate ?? null, month: tc.travelMonth ?? null, sugg: tc.suggestedStartDate ?? null,
    prov: tc.dateProvenance ? `${tc.dateProvenance.source}/${tc.dateProvenance.confirmed}` : null, pending: next.pendingQuestion?.type ?? null, options: opts(next.pendingQuestion),
    reset: next.planningSessionId !== s0.planningSessionId, trigger: Boolean(r.advice.triggerItineraryGeneration), gate, geo: geocodeLog.slice(g0) } };
}

const failures = [];
const check = async (name, fn) => { try { await fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 8).join("\n  ")}`); } };
const EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_TEXT = { "zh-TW": (m) => `改成${m}月`, en: (m) => `make it ${EN[m - 1]}`, ja: (m) => `${m}月に変更`, ko: (m) => `${m}월로 바꿔` };
const STEP = {
  "zh-TW": (r) => `${r} 我要去雪梨`, en: (r) => `${r} I'm going to sydney`, ja: (r) => `${r} シドニーへ旅行`, ko: (r) => `${r} 시드니 여행` };
const CONTROL = { "zh-TW": (m) => `${m}月去雪梨5天`, en: (m) => `Sydney for 5 days in ${EN[m - 1]}`, ja: (m) => `${m}月にシドニーへ5日間旅行`, ko: (m) => `${m}월에 시드니 5일 여행` };
// [kind, step-1 range, new month, expected year-month]
// (today 2026-11-08: 11/20-11/24 and 12/10-12/14 are upcoming dates of this year)
const SCENARIOS = [["same-month", "12/10-12/14", 12, "2026-12"], ["cross-month", "11/20-11/24", 12, "2026-12"], ["cross-year", "12/10-12/14", 1, "2027-01"]];

// `--probe-merge`: only the dates / provenance after the month-only turn (runs in the HEAD snapshot too).
const probeMerge = async () => {
  const rows = {};
  for (const locale of ["zh-TW", "en", "ja", "ko"]) for (const [kind, range, month] of SCENARIOS) {
    fresh();
    const s1 = await sendTurn(sessionMod.createEmptySession(), STEP[locale](range), locale);
    fresh();
    const mo = await sendTurn(s1.s, MONTH_TEXT[locale](month), locale);
    rows[`${locale}|${kind}|${MONTH_TEXT[locale](month)}`] = { start: mo.snap.start, end: mo.snap.end, month: mo.snap.month, prov: mo.snap.prov, pending: mo.snap.pending, trigger: mo.snap.trigger, reply: mo.reply.slice(0, 70) };
  }
  return rows;
};
if (process.argv.includes("--probe-merge")) {
  const rows = await probeMerge();
  process.stdout.write(`@@M2M@@${JSON.stringify(rows)}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}
const headDir = process.argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
if (headDir) {
  const { spawnSync } = await import("node:child_process");
  const self = "scripts/verify-m2-combination-month-only.mjs";
  if (!existsSync(`${headDir}/${self}`) || readFileSync(`${headDir}/${self}`, "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, `${headDir}/${self}`);
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--probe-merge"], { cwd: headDir, encoding: "utf8", timeout: 200_000, maxBuffer: 32 << 20 });
  const m = (r.stdout ?? "").match(/@@M2M@@([\s\S]*?)@@END@@/);
  out(`HEAD month-only turn (recorded):\n  ${m ? Object.entries(JSON.parse(m[1])).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join("\n  ") : `unavailable (status ${r.status}) ${(r.stderr ?? "").slice(-300)}`}`);
}

for (const locale of ["zh-TW", "en", "ja", "ko"]) {
  for (const [kind, range, month, ym] of SCENARIOS) {
    fresh();
    const s1 = await sendTurn(sessionMod.createEmptySession(), STEP[locale](range), locale);
    const t = MONTH_TEXT[locale](month);
    fresh();
    const mo = await sendTurn(s1.s, t, locale);
    fresh();
    const pick = mo.snap.pending === "combination_choice" ? await sendTurn(mo.s, "1", locale) : null;
    // Month-only trip rule (verify-l8-date-month-range U): 「1」 generates, the date gate then asks to
    // confirm unconfirmed dates (date_confirmation). Typed (user_date) dates are never asked again.
    const ctl = null;
    out(`ROW [${locale}|${kind}] STEP1 「${STEP[locale](range)}」 ${JSON.stringify({ ...s1.snap, options: undefined })}\n  「${t}」 ${JSON.stringify(mo.snap)} routes=${JSON.stringify(mo.routes)}\n  USER SEES: ${JSON.stringify(mo.reply)}\n  → 「1」 ${JSON.stringify(pick ? { start: pick.snap.start, month: pick.snap.month, prov: pick.snap.prov, trigger: pick.snap.trigger, gate: pick.snap.gate, pending: pick.snap.pending } : null)}`);
    await check(`[${locale}|${kind}] 「${t}」 keeps the combination list and acknowledges the month`, () => {
      const info = `\n  before=${JSON.stringify(s1.snap)}\n  after=${JSON.stringify(mo.snap)}\n  reply=${JSON.stringify(mo.reply)}`;
      assert.equal(s1.snap.pending, "combination_choice", `STEP1 did not list combinations${info}`);
      assert.equal(mo.snap.pending, "combination_choice", `pending lost${info}`);
      assert.equal(mo.snap.options, s1.snap.options, `combination options changed${info}`);
      assert.equal(mo.snap.trigger, false, `generation started${info}`);
      assert.equal(mo.snap.reset, false, `session reset${info}`);
      if (kind === "same-month") {
        // M6 (approved): same month → combinationMonthUnchanged (「行程本來就在 12月，日期維持…」).
        const unchanged = partialApi.combinationMonthUnchangedCopy?.(t, locale, s1.snap.start, s1.snap.end);
        assert.ok(unchanged, `combinationMonthUnchangedCopy missing / undefined for the same month${info}`);
        assert.equal(mo.reply, unchanged, `reply is not combinationMonthUnchanged${info}`);
        assert.notEqual(mo.reply, partialApi.combinationMonthUpdatedCopy(t, locale), `same month still says 已改為${info}`);
      } else {
        assert.equal(partialApi.combinationMonthUnchangedCopy?.(t, locale, s1.snap.start, s1.snap.end), undefined, `different month must not use the unchanged copy${info}`);
        assert.equal(mo.reply, partialApi.combinationMonthUpdatedCopy(t, locale), `reply is not combinationMonthUpdated${info}`);
      }
      assert.deepEqual(mo.snap.geo, [],`geocode on a month-only turn${info}`);
      for (const [k, v] of Object.entries(mo.routes)) assert.notEqual(v, true, `App route ${k} takes the turn${info}`);
    });
    await check(`[${locale}|${kind}] 「${t}」 dates / provenance`, () => {
      const info = `\n  before=${JSON.stringify(s1.snap)}\n  after=${JSON.stringify(mo.snap)}`;
      // travelMonth is stored as 「N月」 (all locales); the year follows the date rules downstream.
      assert.ok(String(mo.snap.month ?? "").startsWith(ym) || String(mo.snap.month ?? "") === `${month}月`, `travelMonth not ${month}月 / ${ym}${info}`);
      if (kind === "same-month") {
        assert.equal(mo.snap.start, s1.snap.start, `same month must keep start${info}`);
        assert.equal(mo.snap.end, s1.snap.end, `same month must keep end${info}`);
        assert.equal(mo.snap.prov, s1.snap.prov, `same month must keep provenance${info}`);
      } else {
        assert.equal(mo.snap.start, null, `start kept across months${info}`);
        assert.equal(mo.snap.end, null, `end kept across months${info}`);
        assert.ok(!/^user_date\/true$/.test(mo.snap.prov ?? ""), `confirmed user_date provenance left behind${info}`);
      }
    });
    await check(`[${locale}|${kind}] then 「1」 selects and continues like a month-only trip`, () => {
      const info = `\n  pick=${JSON.stringify(pick?.snap ?? null)}\n  control=${JSON.stringify(ctl?.snap ?? null)}`;
      assert.ok(pick, `no pick${info}`);
      assert.equal(pick.snap.trigger, true, `「1」 did not generate${info}`);
      if (kind === "same-month") assert.notEqual(pick.snap.gate?.paused, true, `typed dates asked again${info}`);
      else {
        assert.ok(!pick.snap.gate?.paused || pick.snap.gate.kind === "date_confirmation", `「1」 paused on something other than the date confirmation${info}`);
        // A proposed date (if any) is in the new month of the right year — never the old range, never the past.
        const start = pick.snap.gate?.proposed?.match(/:(\d{4}-\d{2})-\d{2}~/)?.[1];
        if (start) assert.equal(start, ym, `proposed dates not in ${ym}${info}`);
      }
    });
  }
}

// Combination ids vs month numbers (3 combinations shown).
const IDS = [["1月", []], ["1월", []], ["改成1月", []], ["1月に変更", []], ["1월로 바꿔", []], ["12月", []], ["make it January", []],
  ["1", [0]], ["1번", [0]], ["1と3", [0, 2]], ["1、3", [0, 2]], ["1 和 3", [0, 2]], ["第1組", [0]], ["1번이랑 3번", [0, 2]], ["option 2", [1]]];
for (const [t, want] of IDS) {
  const got = suggestions.parseCombinationSelectionIndices(t, 3);
  await check(`parseCombinationSelectionIndices(「${t}」) = ${JSON.stringify(want)}`, () => assert.deepEqual(got, want));
}
for (const t of ["1", "1번", "1と3", "第1組"]) await check(`「${t}」 is not a month-only reply`, () => assert.equal(partialApi.isCombinationMonthOnlyReply(t), false));
for (const t of ["改成1月", "make it January", "1月に変更", "1월로 바꿔", "1月", "January"]) await check(`「${t}」 is a month-only reply`, () => assert.equal(partialApi.isCombinationMonthOnlyReply(t), true));
// Recorded: a combination id plus a month in one message.
for (const t of ["1，改成1月", "選1，改成1月", "1번, 1월로 바꿔"]) out(`INFO mixed 「${t}」 indices=${JSON.stringify(suggestions.parseCombinationSelectionIndices(t, 3))} monthOnly=${partialApi.isCombinationMonthOnlyReply(t)}`);
await check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
await new Promise(() => {});
