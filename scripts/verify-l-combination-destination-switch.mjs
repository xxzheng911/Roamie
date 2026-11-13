/**
 * L2 — combination-choice destination switch (spec A), reject-all (B) and mix (C) through the
 * send-flow chain (tripIntent → prepare → mergeTravelContext → [global resolve] → combinations
 * ready → processAdviceTurn → applyAdviceResultToSession), four locales.
 *
 * Also simulates the chat route's CONFIRMED_SWITCH branch (classifyDestinationSwitchTurn →
 * applyConfirmedDestinationSwitch wrapper → wouldMergeTravelContextResetTrip → mergeTravelContext),
 * which runs BEFORE the merge for explicit wording in src/routes/_app.chat.tsx (L8773 / L9404 / L11379).
 *
 * fetch is stubbed (must stay 0); geocode / Places are fixtures and counted.
 * HEAD comparison for the "must not trigger" cases: `-- --head-dir=<snapshot>` re-runs the flow
 * in the snapshot with `--child` and compares the observable fields.
 *
 * Run: npx vite-node scripts/verify-l-combination-destination-switch.mjs --config scripts/vite.verify.config.mjs [-- --head-dir=<snapshot>]
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDirArg = argv.find((a) => a.startsWith("--head-dir="))?.slice("--head-dir=".length);
const DEBUG = argv.filter((a) => a.startsWith("--debug=")).map((a) => a.slice("--debug=".length));

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog: run exceeded time limit"); process.exit(3); }, 280_000).unref();

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
const reset = await load("src/lib/ai/trip-planning-session-reset.ts");
const partialApi = existsSync("src/lib/ai/combination-partial-modify-reply.ts") ? await load("src/lib/ai/combination-partial-modify-reply.ts") : null;
const copyMod = await load("src/lib/chat-runtime-copy.ts");
const aliases = await load("src/lib/ai/destination-locale-aliases.ts");

// ------------------------------------------------------------------ fixtures
const gen = (prefix, n = 18) => Array.from({ length: n }, (_, i) => `${prefix} Spot ${i + 1}`);
const DESTS = {
  sydney: { match: /sydney|雪梨|シドニー|시드니/i, city: "Sydney", region: "New South Wales", countryRaw: "Australia", code: "AU", lat: -33.8688, lng: 151.2093,
    places: ["Sydney Opera House", "Sydney Harbour Bridge", "The Rocks", "Darling Harbour", "Circular Quay", "Bondi Beach",
      "Australian Museum", "Art Gallery of New South Wales", "Museum of Contemporary Art", "Powerhouse Museum", "Australian National Maritime Museum", "Museum of Sydney",
      "Royal Botanic Garden Sydney", "Hyde Park", "Centennial Park", "Barangaroo Reserve", "Chinese Garden of Friendship", "Observatory Hill"], address: "Sydney NSW, Australia", lang: "en" },
  kyoto: { match: /kyoto|京都|교토/i, city: "京都市", region: "京都府", countryRaw: "Japan", code: "JP", lat: 35.0116, lng: 135.7681,
    places: ["清水寺", "金閣寺", "銀閣寺", "元離宮二条城", "産寧坂", "二寧坂", "京都国立博物館", "京都市京セラ美術館", "京都鉄道博物館", "京都文化博物館", "京都国際マンガミュージアム", "細見美術館",
      "京都御苑", "円山公園", "京都府立植物園", "嵐山公園", "梅小路公園", "鴨川公園"], address: "Kyoto Japan", lang: "ja" },
  tokyo: { match: /tokyo|東京|도쿄/i, city: "東京都", region: "東京都", countryRaw: "Japan", code: "JP", lat: 35.6762, lng: 139.6503,
    places: ["浅草寺", "東京スカイツリー", "東京タワー", "明治神宮", "渋谷スクランブル交差点", "皇居", "東京国立博物館", "国立新美術館", "森美術館", "江戸東京博物館", "国立科学博物館", "東京都現代美術館",
      "上野恩賜公園", "新宿御苑", "代々木公園", "浜離宮恩賜庭園", "井の頭恩賜公園", "六義園"], address: "Tokyo Japan", lang: "ja" },
  kamakura: { match: /kamakura|鎌倉|가마쿠라/i, city: "鎌倉市", region: "神奈川県", countryRaw: "Japan", code: "JP", lat: 35.3192, lng: 139.5467, places: ["鶴岡八幡宮", "高徳院", "長谷寺", "報国寺", "明月院", "建長寺", "鎌倉文学館", "鎌倉国宝館", "鎌倉歴史文化交流館", "川喜多映画記念館", "鏑木清方記念美術館", "吉屋信子記念館",
      "源氏山公園", "鎌倉中央公園", "由比ヶ浜海水浴場", "鎌倉海浜公園", "葛原岡神社", "稲村ヶ崎公園"], address: "Kamakura Japan", lang: "ja" },
  taitung: { match: /taitung|台東|臺東/i, city: "台東縣", region: "台東縣", countryRaw: "Taiwan", code: "TW", lat: 22.758, lng: 121.1444,
    places: ["三仙台", "伯朗大道", "鹿野高台", "小野柳", "多良車站", "加路蘭", "國立臺灣史前文化博物館", "鐵花村", "臺東美術館", "池上穀倉藝術館", "臺東故事館", "卑南遺址公園",
      "臺東森林公園", "琵琶湖", "大坡池", "海濱公園", "知本國家森林遊樂區", "關山親水公園"], address: "Taitung Taiwan", lang: "zh-TW" },
};
const countryOf = (d) => countryNorm.normalizeCountryReference(d.countryRaw, d.code).country || d.countryRaw;
const geocodeLog = [];
const placesLog = [];
const geocode = async (q) => {
  geocodeLog.push(q);
  const d = Object.values(DESTS).find((x) => x.match.test(q));
  if (!d) return { rawResultCount: 0, location: null };
  return { rawResultCount: 1, location: { placeId: `ChIJ_${d.code}_${d.city}`, country: countryOf(d), city: d.city, region: d.region, lat: d.lat, lng: d.lng, formattedName: d.city, displayLabel: d.city } };
};
const ZH_TOKYO = ["淺草寺", "東京晴空塔", "東京鐵塔", "明治神宮", "澀谷十字路口", "皇居", "東京國立博物館", "國立新美術館", "森美術館", "江戶東京博物館", "國立科學博物館", "東京都現代美術館",
  "上野恩賜公園", "新宿御苑", "代代木公園", "濱離宮恩賜庭園", "井之頭恩賜公園", "六義園"];
const poolFor = (dest, locale) => {
  const d = Object.values(DESTS).find((x) => x.match.test(dest));
  if (!d) return [];
  const key = Object.keys(DESTS).find((k) => DESTS[k] === d);
  const zhTokyo = key === "tokyo" && locale === "zh-TW";
  return (zhTokyo ? ZH_TOKYO : d.places).map((name, i) => ({ id: `ChIJ${d.code}${key}P${i}`, name, sourceLocale: zhTokyo ? "zh-TW" : d.lang,
    lat: d.lat + i * 0.0003, lng: d.lng, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park",
    rating: 4.6, userRatingCount: 10000, address: d.address, businessStatus: "OPERATIONAL" }));
};
const clone = (v) => JSON.parse(JSON.stringify(v));

function snapOf(next, r, extra = {}) {
  const tc = next.travelContext ?? {};
  return { dest: tc.destination ?? null, days: tc.days ?? null, tripDays: next.tripDays ?? null, start: tc.startDate ?? null, end: tc.endDate ?? null,
    month: tc.travelMonth ?? null, year: tc.travelYear ?? null,
    pending: next.pendingQuestion?.type ?? null, base: next.pendingQuestion?.baseDestination ?? null, offered: tc.offeredCombinations?.length ?? 0,
    selected: tc.selectedCombinationIds ?? null, sid: next.planningSessionId ?? null,
    itin: Boolean(r?.advice?.itinerary || r?.advice?.generatedItinerary || r?.advice?.generateItinerary),
    reply: (r?.advice?.reply ?? "").replace(/\n/g, " / "), ...extra };
}

/** Send flow after the route's switch gate (NO_SWITCH branch). */
async function sendTurn(s0, t, locale, opts = {}) {
  const s = clone(s0);
  const lastReply = s.lastAssistantReply;
  const flag = partialApi && partialApi.isCombinationChoiceTurn(s) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply(t));
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, lastReply);
  if (planningState.isReplanIntent(t) && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  if (opts.beforeMerge) n = opts.beforeMerge(n);
  const g0 = geocodeLog.length; const p0 = placesLog.length;
  const dbg = DEBUG.includes(t);
  if (dbg) out(`DEBUG 「${t}」 [${locale}] before=${JSON.stringify({ s: [s.travelContext?.startDate, s.travelContext?.endDate, s.travelContext?.days, s.travelContext?.travelMonth, s.pendingQuestion?.type], n: [n.travelContext?.startDate, n.travelContext?.endDate, n.travelContext?.days, n.pendingQuestion?.type, n.planningSessionId === s.planningSessionId], replan: planningState.isReplanIntent(t), flag, global: (() => { const g = globalPlanning.globalPlanningTurn(n, t); return g ? [g.destination, g.startDate, g.endDate, g.days, g.travelMonth, g.destinationClarification, g.destinationInputNames] : null; })() })}`);
  const m = travelContext.mergeTravelContext(n, t, lastReply);
  if (dbg) out(`DEBUG   merged=${JSON.stringify([m.context.destination, m.context.startDate, m.context.endDate, m.context.days, m.context.travelMonth, m.session.pendingQuestion?.type, m.context.destinationClarification])}`);
  let session = m.session; let ctx = m.context;
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
      searchPlaces: async (q) => { placesLog.push(JSON.stringify(q?.query ?? q?.textQuery ?? ctx.destination)); return { places: poolFor(ctx.destination, locale), error: null }; },
    }).catch(() => null);
  }
  if (dbg) out(`DEBUG   provenance before=${JSON.stringify(s.travelContext?.dateProvenance ?? null)} merged=${JSON.stringify(ctx.dateProvenance ?? null)}`);
  if (dbg) out(`DEBUG   preAdvice=${JSON.stringify([ctx.startDate, ctx.endDate, ctx.days, session.tripStartDate, session.travelDate, session.pendingQuestion?.type])}`);
  const r = stateMachine.processAdviceTurn(t, session, ctx, undefined, locale);
  if (dbg) out(`DEBUG   reply=${JSON.stringify(r.advice?.reply ?? "")}`);
  if (dbg) out(`DEBUG   advice=${JSON.stringify({ rs: [r.session.travelContext?.startDate, r.session.travelContext?.endDate, r.session.travelContext?.days, r.session.tripStartDate], patchDates: [r.advice?.contextPatch?.startDate, r.advice?.contextPatch?.endDate, r.advice?.contextPatch?.suggestedStartDate, r.advice?.contextPatch?.dateProvenance] })}`);
  const next = advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply ?? lastReply }, r.advice);
  return { s: next, mergedSession: m.session, snap: snapOf(next, r, { geo: geocodeLog.slice(g0), places: placesLog.length - p0 }) };
}

const STEP1 = {
  sydney: { en: "12/10-12/14 I'm going to sydney", "zh-TW": "12/10-12/14 我要去雪梨", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행" },
  tokyo: { en: "12/10-12/14 I'm going to Tokyo", "zh-TW": "12/10-12/14 我要去東京", ja: "12/10-12/14 東京へ旅行", ko: "12/10-12/14 도쿄 여행" },
};

// Observable cases. kind: switch(dest, dates) | keep (no switch, same as HEAD) | dates (date correction) | reject | mix
const K = "京都";
/** Keep rows where WORK intentionally stops geocoding a bare category wish (see the keep branch below). */
const CATEGORY_NO_GEOCODE_IMPROVEMENTS = new Set(["想去海邊"]);
const CASES = {
  en: [
    ["I'm going to Kyoto 12/10-12/13", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["Kyoto 12/10-12/13", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["switch to Kyoto", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-14", days: 5 }],
    ["change to Kyoto", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-14", days: 5 }],
    ["I'm going to Kyoto in January", { kind: "switch", dest: K, start: null, end: null, days: 5, month: "1月" }],
    // Same month as the current 12/10-12/14 dates: not a different month, dates stay.
    ["I'm going to Kyoto in December", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-14", days: 5 }],
    ["Sorry it's 12/10-12/13", { kind: "dates", start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["sydney 12/10-12/13", { kind: "dates", start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["1", { kind: "keep" }], ["1 and 3", { kind: "keep" }], ["Australia", { kind: "keep" }], ["Japan", { kind: "keep" }],
    ["keep day 1", { kind: "hold" }], ["no need to change", { kind: "keep" }],
    ["none of them", { kind: "reject" }], ["neither", { kind: "reject" }], ["I don't like any of them", { kind: "reject" }],
    ["mix them up", { kind: "mix" }], ["mix and match", { kind: "mix" }], ["let's mix", { kind: "mix" }], ["either is fine", { kind: "mix" }],
  ],
  "zh-TW": [
    ["京都 12/10-12/13", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["改去京都", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-14", days: 5 }],
    ["我要去京都", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-14", days: 5 }],
    ["換成京都", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-14", days: 5 }],
    ["我下個月要去台東", { kind: "switch", dest: "台東", start: "2026-12-10", end: "2026-12-14", days: 5 }],
    // Negated-clause form: the chat route's CONFIRMED_SWITCH branch (wrapper reset) handles it.
    ["不去雪梨了，改去京都", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-14", days: 5, routeOnly: true }],
    ["我1月要去京都", { kind: "switch", dest: K, start: null, end: null, days: 5, month: "1月" }],
    ["抱歉是12/10-12/13", { kind: "dates", start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["雪梨 12/10-12/13", { kind: "dates", start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["1、3", { kind: "keep" }], ["混搭", { kind: "keep" }], ["第一天保留", { kind: "hold" }], ["不用改", { kind: "keep" }],
    ["澳洲", { kind: "keep" }], ["日本", { kind: "keep" }], ["美食", { kind: "keep" }],
    // M5（已核可的規格更新）：與目前 12/10-12/14 同月的「12月」保留日期與天數，不再清掉日期。
    ["12月", { kind: "dates", start: "2026-12-10", end: "2026-12-14", days: 5 }], ["十分", { kind: "keep" }],
    ["美食 12/10-12/13", { kind: "nodest" }], ["想去海邊", { kind: "keep" }], ["溫泉", { kind: "keep" }],
    ["全部都不要", { kind: "reject" }], ["都不要", { kind: "reject" }], ["一組都不要", { kind: "reject" }],
    ["全部", { kind: "keep" }],
  ],
  ja: [
    ["京都 12/10-12/13", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["12月に京都に行きます", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-14", days: 5 }],
    ["京都に変更", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-14", days: 5 }],
    ["1月に京都に行きます", { kind: "switch", dest: K, start: null, end: null, days: 5, month: "1月" }],
    ["すみません、12/10〜12/13です", { kind: "dates", start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["シドニー 12/10-12/13", { kind: "dates", start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["1と3", { kind: "keep" }], ["日本", { kind: "keep" }], ["オーストラリア", { kind: "keep" }], ["十分", { kind: "keep" }], ["グルメ", { kind: "keep" }],
    ["どれもいらない", { kind: "reject" }], ["全部いらない", { kind: "reject" }],
    ["ミックスしてください", { kind: "mix" }], ["おまかせでいいです", { kind: "mix" }],
  ],
  ko: [
    ["교토 12/10-12/13", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["교토로 바꿔", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-14", days: 5 }],
    ["다음 달에 교토로 갈게요", { kind: "switch", dest: K, start: "2026-12-10", end: "2026-12-14", days: 5 }],
    ["1월에 교토로 갈게요", { kind: "switch", dest: K, start: null, end: null, days: 5, month: "1月" }],
    ["죄송해요 12/10-12/13이에요", { kind: "dates", start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["시드니 12/10-12/13", { kind: "dates", start: "2026-12-10", end: "2026-12-13", days: 4 }],
    ["1, 3", { kind: "keep" }], ["일본", { kind: "keep" }], ["호주", { kind: "keep" }], ["맛집", { kind: "keep" }],
    ["다 싫어요", { kind: "reject" }], ["전부 싫어", { kind: "reject" }],
    ["알아서 해", { kind: "mix" }], ["섞어서 해줘", { kind: "mix" }],
  ],
};
// Tokyo trip: nearby extension (no switch) vs explicit switch.
const NEARBY = {
  en: [["Kamakura", { kind: "keep" }], ["switch to Kamakura", { kind: "switch", dest: "鎌倉", start: "2026-12-10", end: "2026-12-14", days: 5 }]],
  "zh-TW": [["鎌倉", { kind: "keep" }], ["改去鎌倉", { kind: "switch", dest: "鎌倉", start: "2026-12-10", end: "2026-12-14", days: 5 }]],
  ja: [["鎌倉", { kind: "keep" }]],
  ko: [["가마쿠라", { kind: "keep" }]],
};

/** Route CONFIRMED_SWITCH branch (Authority result = fixture label, no network). */
function routeConfirmedPath(s0, t, trustedLabel) {
  const s = clone(s0);
  const res = travelContext.applyConfirmedDestinationSwitch(s, { label: trustedLabel, requestText: t, resetAlreadyThisTurn: false });
  if (!("applied" in res) || !res.applied) return { stop: res.stop ?? "not_applied" };
  const wouldReset = travelContext.wouldMergeTravelContextResetTrip(res.session, t);
  const sidAfterWrapper = res.session.planningSessionId;
  const m = travelContext.mergeTravelContext(res.session, t, s.lastAssistantReply);
  const tc = m.context;
  return { applied: true, wouldReset, sidChangedByMerge: m.session.planningSessionId !== sidAfterWrapper, sidOld: s.planningSessionId, sid: m.session.planningSessionId,
    dest: tc.destination ?? null, days: tc.days ?? m.session.tripDays ?? null, start: tc.startDate ?? null, end: tc.endDate ?? null, pending: m.session.pendingQuestion?.type ?? null };
}

async function runAll() {
  const res = {};
  for (const [tripKey, table] of [["sydney", CASES], ["tokyo", NEARBY]]) {
    for (const locale of Object.keys(table)) {
      discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache();
      const st = await sendTurn(sessionMod.createEmptySession(), STEP1[tripKey][locale], locale);
      res[`${tripKey}|${locale}|STEP1`] = st.snap;
      for (const [t] of table[locale]) {
        const r = await sendTurn(st.s, t, locale);
        const switchState = tpc.classifyDestinationSwitchTurn(t);
        res[`${tripKey}|${locale}|${t}`] = { ...r.snap, routeState: switchState.state, routeTarget: switchState.targetLabel ?? null, base0: st.s };
      }
    }
  }
  return res;
}

if (CHILD) {
  const r = await runAll();
  for (const v of Object.values(r)) delete v.base0;
  out(`@@L2_JSON@@${JSON.stringify(r)}@@END@@`);
  process.exit(0);
}

const failures = [];
async function check(name, fn) {
  try { await fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 6).join("\n  ")}`); }
}
function headResults() {
  if (!headDirArg) return null;
  assert.ok(existsSync(join(headDirArg, "src")), `bad --head-dir ${headDirArg}`);
  const self = "scripts/verify-l-combination-destination-switch.mjs";
  if (!existsSync(join(headDirArg, self)) || readFileSync(join(headDirArg, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(headDirArg, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDirArg, encoding: "utf8", timeout: 270_000, maxBuffer: 64 << 20 });
  const m = (r.stdout ?? "").match(/@@L2_JSON@@([\s\S]*?)@@END@@/);
  assert.ok(m, `HEAD child produced no JSON (status ${r.status}): ${(r.stdout ?? "").slice(-600)} ${(r.stderr ?? "").slice(-800)}`);
  return JSON.parse(m[1]);
}

const WORK = await runAll();
let HEAD = null;
try { HEAD = headResults(); } catch (e) { out(`NOTE head comparison unavailable: ${e.message}`); }
const rejectCopy = Object.fromEntries(["en", "zh-TW", "ja", "ko"].map((l) => [l, copyMod.chatRuntimeCopy("combinationRejectAll", l)]));
const same = (d) => (d ? tpc.normalizeDestinationLabel(aliases.canonicalFromDisplayName(d) ?? aliases.applyCityLocaleAlias(d) ?? d) : d);
const pick = (s) => ({ dest: s.dest, days: s.days, start: s.start, end: s.end, pending: s.pending, base: s.base, itin: s.itin, selected: s.selected });

for (const [tripKey, table] of [["sydney", CASES], ["tokyo", NEARBY]]) {
  for (const locale of Object.keys(table)) {
    const s1 = WORK[`${tripKey}|${locale}|STEP1`];
    await check(`[${locale}] ${tripKey} STEP1 lists combinations (5 days)`, () => {
      assert.equal(s1.pending, "combination_choice", JSON.stringify(pick(s1)));
      assert.equal(s1.days, 5);
      assert.ok(s1.offered > 0);
    });
    for (const [t, exp] of table[locale]) {
      const w = WORK[`${tripKey}|${locale}|${t}`];
      const h = HEAD?.[`${tripKey}|${locale}|${t}`];
      const info = () => `work=${JSON.stringify({ ...pick(w), month: w.month, year: w.year, route: w.routeState, reply: w.reply.slice(0, 120), geo: w.geo })}${h ? `\n head=${JSON.stringify({ ...pick(h), route: h.routeState, geo: h.geo })}` : ""}`;
      const name = `[${locale}] ${tripKey} 「${t}」 ${exp.kind}`;
      if (exp.routeOnly && w.routeState !== "NO_SWITCH") continue; // checked on the route path below
      await check(name, () => {
        // No new geocode: a switch never geocodes; other turns geocode exactly as HEAD.
        if (exp.kind === "switch") assert.equal(w.geo.length, 0, `geocode calls ${JSON.stringify(w.geo)}\n${info()}`);
        else if (h) assert.deepEqual(w.geo.filter((q) => !h.geo.includes(q)), [], `geocode HEAD did not make\n${info()}`);
        if (exp.kind === "switch") {
          assert.equal(w.dest, exp.dest, info());
          assert.equal(w.start, exp.start, `start\n${info()}`);
          assert.equal(w.end, exp.end, `end\n${info()}`);
          assert.equal(w.days, exp.days, `days\n${info()}`);
          if (exp.month) assert.equal(w.month, exp.month, `month\n${info()}`);
          assert.notEqual(w.sid, s1.sid, `planningSessionId must change\n${info()}`);
          assert.equal(w.pending, "combination_choice", `new combinations listed\n${info()}`);
          assert.equal(w.base, exp.dest, `pending base\n${info()}`);
          assert.ok(w.offered > 0, `offered\n${info()}`);
          assert.equal(w.itin, false, info());
          assert.ok(!/Sydney|雪梨|シドニー|시드니|東京|Tokyo|도쿄/.test(w.reply) || exp.dest === "鎌倉", `reply mentions old destination\n${info()}`);
        } else if (exp.kind === "dates") {
          assert.equal(same(w.dest), same(s1.dest), info());
          assert.equal(w.sid, s1.sid, `planningSessionId must stay\n${info()}`);
          assert.equal(w.start, exp.start, info()); assert.equal(w.end, exp.end, info()); assert.equal(w.days, exp.days, info());
          assert.equal(w.pending, "combination_choice", info());
          assert.equal(w.itin, false, info());
        } else if (exp.kind === "reject") {
          assert.equal(same(w.dest), same(s1.dest), info());
          assert.equal(w.itin, false, `reject-all generated an itinerary\n${info()}`);
          assert.ok(!w.selected?.length, `selected ${JSON.stringify(w.selected)}\n${info()}`);
          assert.equal(w.pending, "combination_choice", info());
          assert.equal(w.reply.replace(/ \/ /g, "\n"), rejectCopy[locale], info());
        } else if (exp.kind === "mix") {
          assert.equal(same(w.dest), same(s1.dest), info());
          assert.ok(w.itin || (w.selected?.length ?? 0) >= s1.offered, `mix must select all combinations\n${info()}`);
        } else if (exp.kind === "hold") {
          // Hold wording (第一天… / keep day 1) is held on the combination list (earlier-round spec).
          assert.equal(same(w.dest), same(s1.dest), info());
          assert.equal(w.sid, s1.sid, info());
          assert.equal(w.pending, "combination_choice", info());
          assert.equal(w.itin, false, info());
        } else if (exp.kind === "nodest") {
          assert.equal(same(w.dest), same(s1.dest), info());
          assert.equal(w.sid, s1.sid, info());
        } else {
          assert.equal(same(w.dest), same(s1.dest), `must not switch\n${info()}`);
          assert.equal(w.sid, s1.sid, `planningSessionId must stay\n${info()}`);
          // M16 round 4 (tester review): a bare category / activity wish (「想去海邊」) is no longer
          // geocoded as a destination candidate. HEAD geocoded 「海邊, 澳洲」 and dropped the
          // combination_choice pending; WORK keeps the trip, makes 0 geocode calls and stays on the
          // combination list. Only that exact improvement is accepted; every other diff vs HEAD still fails.
          const categoryNoGeocodeImprovement = Boolean(h) && CATEGORY_NO_GEOCODE_IMPROVEMENTS.has(t) &&
            (h.geo?.length ?? 0) > 0 && (w.geo?.length ?? 0) === 0 && w.pending === "combination_choice" &&
            same(w.dest) === same(h.dest) && w.start === h.start && w.end === h.end && w.days === h.days;
          if (h && !categoryNoGeocodeImprovement) assert.deepEqual(pick(w), pick(h), `differs from HEAD\n${info()}`);
        }
      });
    }
  }
}

// The route's CONFIRMED_SWITCH branch runs before the merge for explicit wording. Spec A says a
// switch without dates keeps the previous dates / days — on the real send path, too.
const confirmed = [];
for (const [tripKey, table] of [["sydney", CASES], ["tokyo", NEARBY]]) for (const locale of Object.keys(table)) {
  for (const [t, exp] of table[locale]) {
    const w = WORK[`${tripKey}|${locale}|${t}`];
    if (w.routeState === "NO_SWITCH") continue;
    confirmed.push({ tripKey, locale, t, exp, w });
  }
}
out(`INFO route classifyDestinationSwitchTurn != NO_SWITCH: ${JSON.stringify(confirmed.map((c) => `${c.locale}:${c.t}=${c.w.routeState}`))}`);
for (const { tripKey, locale, t, exp, w } of confirmed) {
  await check(`[${locale}] route ${w.routeState} 「${t}」 keeps spec A on the real send path`, () => {
    if (w.routeState !== "CONFIRMED_SWITCH") {
      // NEGATED_UNCERTAIN asks a confirm question first; never a silent switch.
      assert.notEqual(exp.kind, "keep", `non-switch text classified ${w.routeState}`);
      return;
    }
    assert.equal(exp.kind, "switch", `non-switch text takes the route switch branch (Authority lookup + reset): ${t}`);
    const r = routeConfirmedPath(w.base0, t, exp.dest);
    assert.ok(r.applied, `wrapper stop ${JSON.stringify(r)}`);
    assert.equal(r.wouldReset, false, "second-reset guard would stop the turn");
    assert.equal(r.sidChangedByMerge, false, "merge reset a second time");
    assert.notEqual(r.sid, r.sidOld);
    assert.equal(r.dest, exp.dest, JSON.stringify(r));
    assert.equal(r.days, exp.days, `days not carried on route CONFIRMED path: ${JSON.stringify(r)}`);
    assert.equal(r.start, exp.start, `start not carried on route CONFIRMED path: ${JSON.stringify(r)}`);
    assert.equal(r.end, exp.end, `end not carried on route CONFIRMED path: ${JSON.stringify(r)}`);
  });
}

// Stale async: the switched session is a new planning session, so a result keyed on the old one
// (isGlobalResolutionCurrent / planningSessionId) can never be applied.
await check("stale async: switch merge opens a new planning session; no Sydney scope / combinations left", () => {
  const base = clone(WORK["sydney|zh-TW|京都 12/10-12/13"].base0);
  const m = travelContext.mergeTravelContext(clone(base), "京都 12/10-12/13");
  assert.notEqual(m.session.planningSessionId, base.planningSessionId);
  assert.equal(m.session.pendingQuestion?.baseDestination === "雪梨", false, "old combination pending kept");
  assert.equal(m.context.offeredCombinations, undefined);
  assert.equal(m.context.destinationCoordinates, undefined);
  assert.equal(m.context.destinationScopeId, undefined);
  assert.ok(!/Sydney|雪梨/.test(JSON.stringify(m.session.tripDestination ?? {})), "tripDestination still Sydney");
  assert.ok(!m.session.tripPlanningContext || m.session.tripPlanningContext.destination === "京都", `tripPlanningContext ${m.session.tripPlanningContext?.destination}`);
});

// Residue: fields the legacy destination reset drops but the combination switch keeps.
await check("month-only switch does not keep the old trip's travelYear (residue keys listed as INFO)", async () => {
  const base = { ...clone(WORK["sydney|zh-TW|京都 12/10-12/13"].base0) };
  base.travelContext = { ...base.travelContext, mood: "放鬆", vibe: "海邊", companion: "情侶", budget: "低", pace: "slow", travelYear: 2026 };
  const sw = travelContext.mergeTravelContext(clone(base), "我1月要去京都");
  const legacy = reset.resetForDestinationChange(clone(base), { reason: "destination_changed", incomingDestination: "京都" });
  const carried = new Set(["days", "travelMonth", "startDate", "endDate", "destination", "destinationCountry", "destinationCountryCode", "destinationCity", "destinationRegion", "destinationType", "destinationInputNames", "lastIntent", "tripPurpose"]);
  const extra = Object.keys(sw.context).filter((k) => sw.context[k] !== undefined && sw.context[k] !== null && legacy.travelContext?.[k] === undefined && !carried.has(k));
  out(`INFO switch-only context keys: ${JSON.stringify(extra.map((k) => `${k}=${JSON.stringify(sw.context[k])}`))}`);
  out(`INFO legacy-reset keeps: mood=${JSON.stringify(legacy.travelContext?.mood)} vibe=${JSON.stringify(legacy.travelContext?.vibe)} companion=${JSON.stringify(legacy.travelContext?.companion)}`);
  // Old trip's travelYear (2026, December trip) must not survive a month-only switch to January.
  assert.ok(!(sw.context.travelMonth === "1月" && sw.context.travelYear === 2026), `stale travelYear 2026 with travelMonth 1月 (Dec 2026 trip → January): ${sw.context.travelYear}`);
});

await check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
if (HEAD) out("INFO HEAD comparison ran");
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.exit(failures.length ? 1 : 0);
