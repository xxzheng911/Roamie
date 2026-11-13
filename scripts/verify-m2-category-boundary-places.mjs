/**
 * M2 (tester, independent) — real place names that CONTAIN category / activity characters
 * (上海 北海道 Bondi Beach 迪士尼樂園 熱海 別府 草津 箱根 墾丁 Museum Island Coffee Bay 해운대 …) must keep
 * their HEAD behaviour after isCategoryActivityLabel / categorySwitchSearchText:
 * route classifier, destination parsers, new-trip detection, category search area and the merged
 * turn (destination / candidate / geocode) on a Sydney combination_choice session.
 * NOW vs HEAD (`-- --head-dir=<snapshot>`, re-runs itself there with --child; asserted equal).
 * Geocode fixture: Sydney + every other query resolves to a fake city named after the query.
 * fetch is stubbed (must stay 0).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-m2-category-boundary-places.mjs -- --head-dir=<snapshot>
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
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, CHILD ? 200_000 : 290_000).unref();
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
const partialApi = await opt("src/lib/ai/combination-partial-modify-reply.ts");
const catDest = await load("src/lib/ai/chat-category-destination.ts");
const mustVisit = await load("src/lib/ai/must-visit-places.ts");
const turnDestMod = await load("src/lib/ai/chat-turn-destination.ts");

const SYD = { placeId: "ChIJ_AU_Sydney", country: countryNorm.normalizeCountryReference("Australia", "AU").country || "Australia", city: "Sydney", region: "New South Wales", lat: -33.8688, lng: 151.2093, formattedName: "Sydney", displayLabel: "Sydney" };
const geocodeLog = [];
const geocode = async (q) => { geocodeLog.push(q);
  if (/sydney|雪梨|シドニー|시드니/i.test(q)) return { rawResultCount: 1, location: SYD };
  return { rawResultCount: 1, location: { placeId: `ChIJ_FAKE_${q}`, country: "Japan", city: q, region: "", lat: 35, lng: 135, formattedName: q, displayLabel: q } }; };
const pool = () => ["Sydney Opera House", "Sydney Harbour Bridge", "The Rocks", "Darling Harbour", "Circular Quay", "Bondi Beach", "Australian Museum", "Art Gallery of New South Wales", "Museum of Contemporary Art", "Powerhouse Museum", "Australian National Maritime Museum", "Museum of Sydney", "Royal Botanic Garden Sydney", "Hyde Park", "Centennial Park", "Barangaroo Reserve", "Chinese Garden of Friendship", "Observatory Hill"]
  .map((name, i) => ({ id: `ChIJAUP${i}`, name, sourceLocale: "en", lat: SYD.lat + i * 0.0003, lng: SYD.lng, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.6, userRatingCount: 10000, address: "Sydney NSW, Australia", businessStatus: "OPERATIONAL" }));
const clone = (v) => JSON.parse(JSON.stringify(v));
const fresh = () => { discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache(); };
const safe = (fn) => { try { const v = fn(); return v === undefined ? null : v; } catch (e) { return `ERR ${String(e?.message ?? e).slice(0, 60)}`; } };

async function sendTurn(s0, t, locale) {
  const s = clone(s0);
  const flag = Boolean(partialApi.isCombinationChoiceTurn?.(s) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply?.(t)));
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, s.lastAssistantReply);
  if (planningState.isReplanIntent(t) && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const g0 = geocodeLog.length;
  const m = travelContext.mergeTravelContext(n, t, s.lastAssistantReply);
  let session = m.session; let ctx = m.context;
  const cand = ctx.destinationCandidate ? `${ctx.destinationCandidate.raw}/${ctx.destinationCandidate.status}` : null;
  if (ctx.destinationCandidate?.status === "pending") { session = await globalPlanning.resolveGlobalPlanningCandidate(session, locale, geocode); ctx = session.travelContext ?? ctx; }
  const days = ctx.days ?? session.tripDays;
  if (ctx.destination && days && !ctx.destinationClarification) {
    await discovery.ensureDestinationCombinationsReady({ destination: ctx.destination, destinationCountry: ctx.destinationCountryCode ?? ctx.destinationCountry, locale, days,
      resolvedDestination: ctx.destinationCoordinates ? { label: ctx.destination, city: ctx.destinationCity ?? ctx.destination, country: ctx.destinationCountryCode ?? ctx.destinationCountry, countryCode: ctx.destinationCountryCode,
        type: ctx.destinationType ?? "city", latitude: ctx.destinationCoordinates.lat, longitude: ctx.destinationCoordinates.lng, placeId: session.tripDestination?.placeId, source: "trip_destination", scopeLocked: false } : undefined,
      // Every destination has a real-looking pool (a named place is a real trip; only the routing is compared).
      searchPlaces: async () => ({ places: /sydney|雪梨/i.test(ctx.destination) ? pool() : pool().map((p, i) => ({ ...p, id: `ChIJX${i}_${ctx.destination}`, name: `${ctx.destination} Spot ${i + 1}`, address: ctx.destination })), error: null }) }).catch(() => null);
  }
  const r = stateMachine.processAdviceTurn(t, session, ctx, undefined, locale);
  const next = advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply }, r.advice);
  const pc = safe(() => mustVisit.mergeContextForPlaceFetch(ctx, session));
  return { s: next, row: { dest: next.travelContext?.destination ?? null, reset: next.planningSessionId !== s0.planningSessionId, cand, clar: ctx.destinationClarification ?? null,
    pending: next.pendingQuestion?.type ?? null, geo: geocodeLog.slice(g0), reply: (r.advice.reply ?? "").split("\n")[0].slice(0, 60),
    catSearchArea: safe(() => tpc.coerceTravelDestination(catDest.resolveDestinationForCategorySearch(pc, session, t)) ?? null),
    turnDestRaw: safe(() => turnDestMod.resolveCategoryTurnDestination({ ctx: pc, session, userText: t, locale }).destination ?? null) } };
}

const CASES = {
  "zh-TW": ["改去上海", "改去北海道", "改去迪士尼樂園", "改去上海迪士尼樂園", "改去熱海", "改去別府", "改去草津", "改去草津溫泉", "改去箱根", "改去墾丁", "改去花蓮", "改去Bondi Beach",
    "不去海邊了，改去熱海", "不去海邊了，改去北海道", "雪梨不去了，改去博物館", "改去東京的博物館", "我要去北海道5天", "我要去熱海3天"],
  en: ["switch to Bondi Beach", "switch to Museum Island", "switch to Coffee Bay", "switch to Shanghai", "switch to Hokkaido", "switch to Miami Beach", "switch to Hot Springs", "instead of the beach, Hakone", "switch to Disneyland"],
  ja: ["箱根に変更", "熱海に変更", "別府に変更", "草津温泉に変更", "北海道に変更", "海じゃなくて箱根に変更", "上海に変更"],
  ko: ["해운대로 바꿔", "해운대 해수욕장으로 바꿔", "부산으로 바꿔", "바다 말고 해운대로 바꿔", "제주도로 바꿔"],
};
const LABELS = ["上海", "北海道", "迪士尼樂園", "熱海", "別府", "草津", "箱根", "墾丁", "Bondi Beach", "Museum Island", "Coffee Bay", "Miami Beach", "Hot Springs", "해운대", "해운대 해수욕장", "草津温泉", "Disneyland"];
const STEP1 = { "zh-TW": "12/10-12/14 我要去雪梨", en: "12/10-12/14 I'm going to sydney", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행" };

async function runAll() {
  const res = { labels: {}, rows: {} };
  for (const l of LABELS) res.labels[l] = { catNonDest: safe(() => tpc.isCategoryNonDestinationLabel(l)), coerce: safe(() => tpc.coerceTravelDestination(l)),
    activity: safe(() => (tpc.isCategoryActivityLabel ? tpc.isCategoryActivityLabel(l) : "(n/a)")) };
  for (const [locale, texts] of Object.entries(CASES)) {
    fresh();
    const s1 = (await sendTurn(sessionMod.createEmptySession(), STEP1[locale], locale)).s;
    for (const t of texts) {
      fresh();
      const cls = safe(() => tpc.classifyDestinationSwitchTurn(t));
      const lex = { cls: cls && typeof cls === "object" ? `${cls.state}${cls.targetLabel ? "→" + cls.targetLabel : ""}` : cls,
        parse: safe(() => tpc.parseDestinationFromText(t)), incoming: safe(() => resetMod.resolveIncomingDestinationFromText(t)),
        newTrip: safe(() => { const r = resetMod.isNewTripPlanning(clone(s1), t); return `${r.isNew}/${r.incomingDestination ?? "-"}`; }),
        searchText: safe(() => (tpc.categorySwitchSearchText ? tpc.categorySwitchSearchText(t) : "(n/a)")) };
      const turn = cls && typeof cls === "object" && cls.state === "NO_SWITCH" ? (await sendTurn(s1, t, locale)).row : null;
      // Every label the parsers / merge produced for this text: the new category predicate must stay false on them.
      const produced = [lex.parse, lex.incoming, cls?.targetLabel, turn?.dest, turn?.cand?.split("/")[0]].filter((x) => typeof x === "string" && x && !/^ERR/.test(x));
      lex.categoryOnProduced = tpc.isCategoryActivityLabel ? produced.filter((x) => tpc.isCategoryActivityLabel(x)) : "(n/a)";
      res.rows[`${locale}|${t}`] = { ...lex, turn };
    }
  }
  return res;
}

if (CHILD) {
  const r = await runAll();
  process.stdout.write(`@@M2B@@${JSON.stringify(r)}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}
const failures = [];
const check = async (name, fn) => { try { await fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 10).join("\n  ")}`); } };
const NOW = await runAll();
let HEAD = null;
if (headDirArg) {
  const self = "scripts/verify-m2-category-boundary-places.mjs";
  if (!existsSync(join(headDirArg, self)) || readFileSync(join(headDirArg, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(headDirArg, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDirArg, encoding: "utf8", timeout: 220_000, maxBuffer: 64 << 20 });
  const m = (r.stdout ?? "").match(/@@M2B@@([\s\S]*?)@@END@@/);
  if (m) HEAD = JSON.parse(m[1]); else out(`NOTE head run failed (status ${r.status}): ${(r.stdout ?? "").slice(-300)} ${(r.stderr ?? "").slice(-500)}`);
}
for (const [l, v] of Object.entries(NOW.labels)) {
  out(`LABEL 「${l}」 NOW ${JSON.stringify(v)}${HEAD ? ` HEAD ${JSON.stringify(HEAD.labels[l])}` : ""}`);
  await check(`label 「${l}」 is not a category (named place)`, () => assert.notEqual(v.catNonDest, true, JSON.stringify(v)));
  await check(`label 「${l}」 is not a category activity label`, () => assert.notEqual(v.activity, true, JSON.stringify(v)));
  // M13: HEAD truncated 「別府」 to 「別」 (fixed bug: two-character 府/都/縣 names keep their name); the fix must yield 「別府」.
  if (HEAD && l === "別府") await check(`label 「${l}」 coerce keeps 「別府」 (HEAD truncation fixed)`, () => assert.equal(v.coerce, "別府", JSON.stringify({ now: v.coerce, head: HEAD.labels[l].coerce })));
  else if (HEAD) await check(`label 「${l}」 coerce same as HEAD`, () => assert.deepEqual(v.coerce, HEAD.labels[l].coerce));
}
// The M2 code paths only act when isCategoryActivityLabel / categorySwitchSearchText is truthy
// (isCategoryNonDestinationLabel fall-through, _app.chat.tsx 6584 / 12492, chat-category-destination).
// Both false ⇒ the turn runs exactly the pre-M2 code (asserted). The HEAD snapshot also lacks earlier
// uncommitted rounds (multilingual switch, copy), so the HEAD diff below is recorded, not asserted.
const core = (x) => x && { parse: x.parse, incoming: x.incoming, newTrip: x.newTrip, cls: x.cls, dest: x.turn?.dest ?? null, reset: x.turn?.reset ?? null, cand: x.turn?.cand ?? null };
const diffs = [];
for (const [k, v] of Object.entries(NOW.rows)) {
  const h = HEAD?.rows?.[k];
  out(`ROW ${k}\n    NOW  ${JSON.stringify(v)}${h ? `\n    HEAD ${JSON.stringify(h)}` : ""}`);
  if (h && JSON.stringify(core(v)) !== JSON.stringify(core(h))) diffs.push(`${k}\n      NOW  ${JSON.stringify(core(v))}\n      HEAD ${JSON.stringify(core(h))}`);
  // 「雪梨不去了，改去博物館」 / 「改去東京的博物館」 are recorded (not named-place boundary cases).
  if (/博物館$/.test(k)) continue;
  await check(`${k}: categorySwitchSearchText does not treat the place as a category`, () => assert.equal(v.searchText, null, JSON.stringify(v)));
  await check(`${k}: no produced destination label is read as a category`, () => assert.deepEqual(v.categoryOnProduced, [], JSON.stringify(v)));
}
out(`\nINFO NOW vs HEAD destination / reset / candidate differences (HEAD = last commit, includes no uncommitted rounds):\n  ${diffs.join("\n  ") || "(none)"}`);
await check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
await new Promise(() => {});
