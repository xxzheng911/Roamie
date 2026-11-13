import "./verify-netguard-full.mjs";
/**
 * T-V (tester, independent review of B8). W (working tree) vs H (HEAD snapshot via --head-dir).
 * One section per run (--only=copy|expand|th|replan).
 *  copy    1(a)(b)(c): 慶州 thin wrapper x4 locales, late-429 / cooldown variants that land on the same wrapper branch, 台北 complete
 *  expand  2(a): tu expand 5 scenarios + both_missing + needs_100plus sweep; shared budget across calls; prioritization order
 *  th      2(b)(c): ts-th fixture (Andong data, label --label, default 慶州) planner (attempt-level distinct keys across all
 *          expansion invocations) + unified wrapper (server calls split expansion / non-expansion) per --style
 *  replan  3: repairRedistributeAcrossDays (:1216) with ordinary-park-only pools
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=N scripts/verify-tv-review.mjs -- --only=copy --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const ONLY = argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "expand";
const LIMIT = Number(argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 280);
const STYLE = argv.find((a) => a.startsWith("--style="))?.slice(8) ?? "mixed";
const LABEL = argv.find((a) => a.startsWith("--label="))?.slice(8) ?? "慶州";
const out = console.log.bind(console);
const progress = (s) => process.stderr.write(`@@P ${CHILD ? "H" : "W"} ${s}\n`);
const captured = [];
const CAPTURE_RE = /ITINERARY_AUTO_REPAIR|AI_POOL_EXPAND|RENDER_BLOCKED|INSUFFICIENT|BLOCK_SAVE|RATE_LIMIT|COOLDOWN|RATE_PROTECTION|PLANNER_POOL_GATE/i;
for (const k of ["log", "info", "warn", "debug", "error"]) console[k] = (...a) => { const s = String(a[0] ?? ""); if (CAPTURE_RE.test(s)) captured.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ").slice(0, 260)); };
const armTimer = () => setTimeout(() => { out(`FAIL internal watchdog ${LIMIT}s (${CHILD ? "HEAD child" : "W"})`); process.exit(3); }, LIMIT * 1000).unref();
if (CHILD) armTimer();
process.env.VITE_VERBOSE_LOG = "1";

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); };
const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: String(e?.message ?? e).split("\n")[0].slice(0, 220), at: String(e?.stack ?? "").split("\n").slice(1, 5).map((s) => s.trim().replace(/^.*\/(src|scripts)\//, "$1/").slice(0, 120)) }; } };

const hours = (open, close, days = [0, 1, 2, 3, 4, 5, 6]) => ({
  periods: days.map((day) => ({ open: { day, hour: Math.floor(open / 60), minute: open % 60 }, close: { day, hour: Math.floor(close / 60), minute: close % 60 } })),
  weekdayDescriptions: [],
});
let pid = 0;
const gPlace = ({ name, types, rating = 4.4, reviews = 1500, oh = hours(7 * 60, 22 * 60), lat, lng, addr, tag = "x", spread = 1, utc = 480, linear = false }) => {
  pid += 1;
  const bare = `ChIJ${tag}${String(pid).padStart(5, "0")}abcdefghijklmnop`.slice(0, 27);
  const dLat = linear ? pid * 0.0009 * spread : ((pid % 17) - 8) * 0.0021 * spread;
  const dLng = linear ? pid * 0.0011 * spread : ((pid % 13) - 6) * 0.0024 * spread;
  return {
    id: `places/${bare}`, placeId: bare, displayName: { text: name }, formattedAddress: addr ?? `${name} 1`,
    location: { latitude: lat + dLat, longitude: lng + dLng }, rating, userRatingCount: reviews,
    primaryType: types[0], types: [...types], regularOpeningHours: oh, utcOffsetMinutes: utc, businessStatus: "OPERATIONAL",
  };
};
const PARK = ["park", "point_of_interest", "establishment"];
const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const CH = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥東南西北春夏秋冬金木水火土日月星雲風雪梅蘭竹菊松柏桃李杏荷楓櫻鶴鷺燕鹿";
// pool-expansion batch caller: `<prefix>.<category>.<variant>.r<radius>` or `<prefix>.initial.r<radius>` (place-pool-expansion runBatch)
const EXP_RE = /^(.*?)\.(?:([a-z_]+)\.(top_rated|popular|hidden_gems|open_now)|(initial))\.r(\d+)/;
const branchOf = (logs) => {
  const s = logs.join("\n");
  if (/itinerary_validator_failed/.test(s)) return "validator_failed(:1315)";
  if (/insufficient_candidates/.test(s)) return "insufficient_candidates(:1367)";
  if (/itinerary_plan_incomplete/.test(s)) return "itinerary_plan_incomplete(:1367)";
  if (/no_valid_geocoded_places/.test(s)) return "no_valid_geocoded(:1393)";
  return "none(render)";
};

// ---------------- 台北 fixture (same as tu city) ----------------
const TPE = { tag: "tpe", label: "台北", country: "台灣", cc: "TW", lat: 25.0330, lng: 121.5654, addr: "臺灣台北市", tz: "Asia/Taipei", utc: 480, K: 20, rev: 6000,
  real: { attr: ["中正紀念堂", "西門町", "台北101觀景台", "龍山寺", "行天宮", "華山1914文化創意產業園區", "松山文創園區", "迪化街", "國父紀念館", "大稻埕碼頭"], museum: ["國立故宮博物院", "臺北市立美術館", "國立臺灣博物館"], park: ["大安森林公園", "陽明山國家公園", "象山步道"], food: ["鼎泰豐信義店", "阜杭豆漿", "林東芳牛肉麵"], cafe: ["Fika Fika Cafe", "日日裝咖啡"], market: ["南門市場", "永康街商圈"], night: ["饒河街觀光夜市", "士林夜市"] },
  n: { attr: 26, museum: 8, park: 8, food: 40, cafe: 14, market: 6, night: 3 } };
const SUFFIX = { attr: ["老街", "古蹟", "文化園區", "歷史街區", "藝術村", "觀景台", "神社", "老宅"], museum: ["博物館", "美術館", "紀念館"], park: ["濕地公園", "森林步道", "海濱公園"], food: ["小吃", "食堂", "料理", "麵館", "飯館"], cafe: ["咖啡", "珈琲館", "甜點店"], market: ["市場", "商店街"], night: ["夜市"] };
const TYPES = { attr: ["tourist_attraction", "point_of_interest"], museum: ["museum", "tourist_attraction"], park: ["park", "tourist_attraction"], food: ["restaurant", "food"], cafe: ["cafe", "coffee_shop"], market: ["market", "tourist_attraction"], night: ["night_market", "tourist_attraction"] };
async function buildCityInventory(cfg) {
  const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
  pid = 0;
  const inv = {};
  for (const cat of Object.keys(TYPES)) {
    const names = [...(cfg.real[cat] ?? [])];
    for (let i = 0; i < (cfg.n[cat] ?? 0); i += 1) names.push(`${cfg.label}${CH[(i * 7 + cat.length) % CH.length]}${CH[(i * 3 + 5) % CH.length]}${SUFFIX[cat][i % SUFFIX[cat].length]}`);
    const oh = cat === "night" ? hours(17 * 60, 23 * 60 + 30) : cat === "museum" ? hours(9 * 60, 17 * 60) : cat === "cafe" ? hours(9 * 60, 20 * 60) : hours(7 * 60, 22 * 60);
    inv[cat] = normalizeGooglePlaces([...new Set(names)].map((name, i) => gPlace({ name, types: TYPES[cat], reviews: Math.max(300, Math.round(cfg.rev * (1 - i * 0.02))), rating: 4.3 + (i % 4) * 0.1, lat: cfg.lat, lng: cfg.lng, addr: `${cfg.addr}${name}`, tag: cfg.tag, oh, utc: cfg.utc })));
  }
  return inv;
}
const route = (q, types) => {
  const s = `${q} ${(types ?? []).join(",")}`.toLowerCase();
  if (/night_market|夜市/.test(s)) return "night";
  if (/restaurant|food|美食|餐|早餐|breakfast|lunch|dinner|meal|小吃|맛집|식당|料理/.test(s)) return "food";
  if (/cafe|coffee|咖啡|bakery|烘焙|dessert|甜點|카페/.test(s)) return "cafe";
  if (/museum|art_gallery|博物|美術|gallery|cultural_center|library/.test(s)) return "museum";
  if (/park|natural_feature|公園|自然|hiking|garden|步道|공원/.test(s)) return "park";
  if (/market|shopping|store|市場|商圈|購物|伴手|購物街/.test(s)) return "market";
  return "attr";
};
// Same as tu makeCitySearch (server-level fixture), plus expansion/non-expansion split.
function makeCitySearch(inv, K, opts = {}) {
  const c = { server: 0, expansion: 0, nonExpansion: 0, expKeys: new Set(), rateLimitedReturned: 0 };
  const searchPlaces = async ({ data }) => {
    c.server += 1;
    const caller = String(data?.placesCaller ?? "?");
    const m = caller.match(EXP_RE);
    if (m) { c.expansion += 1; c.expKeys.add(`${m[5]}|${data?.query ?? ""}|${(data?.includedTypes ?? []).join(",")}`); } else c.nonExpansion += 1;
    if (opts.rateLimitAfter != null && c.server > opts.rateLimitAfter) {
      c.rateLimitedReturned += 1;
      if (opts.rateMode === "cooldown" && opts.noteRateLimited) { opts.noteRateLimited({ retryAfterMs: 60_000 }); return { places: [], error: null }; }
      return { places: [], error: "places_rate_limited" };
    }
    const cat = route(data?.query ?? "", data?.includedTypes);
    const attrList = [...inv.attr, ...inv.museum.slice(0, 2), ...inv.park.slice(0, 2)];
    const list = cat === "attr" || !inv[cat]?.length ? attrList : inv[cat];
    if (!list.length) return { places: [], error: null };
    if (list.length <= K) return { places: list, error: null };
    const off = hash(`${data?.query ?? ""}|${(data?.includedTypes ?? []).join(",")}|${data?.radius ?? ""}`) % list.length;
    const res = []; for (let i = 0; i < K; i += 1) res.push(list[(off + i) % list.length]);
    return { places: res, error: null };
  };
  return { c, searchPlaces };
}
async function runWrapper({ cfg, style, searchPlaces, locale = "zh-TW", sessionTag }) {
  const dpr = await import("../src/lib/ai/destination-place-recommendation.ts");
  const { createUnifiedSearchPlacesFn } = await import("../src/lib/places-search-unified.ts");
  const { resetPlannerSession } = await import("../src/lib/ai/planner-session-guard.ts");
  const unified = createUnifiedSearchPlacesFn(async (args) => searchPlaces(args));
  const L = cfg.label;
  const text = style === "mixed" ? `幫我排${L}4天行程` : `幫我排${L}4天慢活自然行程`;
  const ctx = { destination: L, days: 4, planningDaysConfirmed: true, planningTripStyle: style, startDate: "2026-11-20", endDate: "2026-11-23", country: cfg.country, destinationCountry: cfg.cc, destinationType: "city", interests: [] };
  const sid = `tv-${sessionTag}-${style}`;
  resetPlannerSession(sid);
  const geocodeFn = async () => ({ location: { placeId: `geocode:${cfg.tag}`, country: cfg.country, city: L, lat: cfg.lat, lng: cfg.lng, formattedName: `${cfg.addr}`, displayLabel: L, timezone: cfg.tz, utcOffsetMinutes: cfg.utc }, error: null });
  const r = await dpr.buildDestinationMustVisitRecommendation({ destination: L, userText: text, locale, context: ctx, searchPlaces: unified, geocodeFn, fetchWeatherFn: async () => null, planningSessionId: sid, trustedCenter: { lat: cfg.lat, lng: cfg.lng } });
  return { r, text, ctx };
}
// _app.chat.tsx renderDestinationReply (:5577-5612) decision, as a logic model (not a React render).
function chatModel(result, locale, copyFn) {
  const dp = result.dayPlan?.items?.length ? result.dayPlan : undefined;
  const recs = dp ? dp.items : result.recommendations ?? [];
  if (!recs.length && !String(result.summary ?? "").trim()) return { applied: false, path: "empty_render -> return false" };
  const requested = 4;
  const success = Boolean(dp?.items.length) && recs.length > 0 && (dp?.days ?? 0) > 0 && dp.days === requested;
  const ci = result.candidateInsufficient === true;
  if (!success) {
    if (ci) return { applied: true, path: "candidates_insufficient_copy", content: copyFn() };
    return { applied: false, path: "incomplete_render -> return false -> applyLocalFallback" };
  }
  return { applied: true, path: "render_itinerary" };
}

async function collect() {
  const R = {};
  // ================= COPY (1) =================
  if (ONLY === "copy") {
    progress("copy import");
    const { chatRuntimeCopy } = await import("../src/lib/chat-runtime-copy.ts");
    const { displayDestinationForCopy } = await import("../src/lib/ai/destination-locale-aliases.ts");
    const must = await import("../src/lib/ai/must-visit-places.ts");
    const guard = await import("../src/lib/places-api-guard.ts");
    const plc = await import("../src/lib/places-classic-landmark-cache.ts");
    const chatSrc = readFileSync("src/routes/_app.chat.tsx", "utf8");
    R.chatSource = {
      insufficientBranchReturnsTrue: /if \(candidateInsufficient && requestedTripDays\)[\s\S]{0,400}itineraryCandidatesInsufficient[\s\S]{0,300}return true;/.test(chatSrc),
      flagPassedToRender: /renderDestinationReply\([^)]*candidateInsufficient === true\)/.test(chatSrc),
      settleBeforeCopy: /settlePlaceCredits\(false\);\s*\/\/[^\n]*\n\s*if \(candidateInsufficient && requestedTripDays\)/.test(chatSrc),
    };
    const LOCS = ["zh-TW", "en", "ja", "ko"];
    R.copy = Object.fromEntries(LOCS.map((L) => { const v = String(chatRuntimeCopy("itineraryCandidatesInsufficient", L, { destination: displayDestinationForCopy("慶州", undefined, L), days: 4 })); return [L, { text: v.slice(0, 170), rawKey: /itineraryCandidatesInsufficient/.test(v), unfilled: /\{[a-zA-Z]+\}/.test(v), empty: !v.trim() }]; }));
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    const LAT = 35.8562; const LNG = 129.2247;
    const thinInv = () => {
      pid = 0;
      const g = (name, types, reviews, rating = 4.3, oh) => gPlace({ name, types, reviews, rating, lat: LAT, lng: LNG, addr: `경상북도 경주시 ${name}`, tag: "gyj", oh, utc: 540 });
      const F = normalizeGooglePlaces([["경주 한정식", 900], ["교리김밥", 1500], ["황남빵 본점", 1200], ["경주 쌈밥골목", 400], ["보문 순두부", 350], ["경주 한우", 600]].map(([n, c]) => g(n, ["restaurant", "food"], c)));
      const C = normalizeGooglePlaces([["카페 황리단", 400], ["경주 한옥카페", 300]].map(([n, c]) => g(n, ["cafe", "coffee_shop"], c)));
      const A = normalizeGooglePlaces([["불국사", 12000], ["석굴암", 9000], ["첨성대", 5000], ["동궁과 월지", 8000]].map(([n, c]) => g(n, ["tourist_attraction", "point_of_interest"], c, 4.6, hours(9 * 60, 22 * 60))));
      const P = normalizeGooglePlaces([["황성공원", 60, 4.2], ["태화어린이공원", 22, 4.1]].map(([n, c, r]) => g(n, PARK, c, r)));
      return { attr: A, museum: [], park: P, food: F, cafe: C, market: [], night: [] };
    };
    const cfgG = { tag: "gyj", label: "慶州", country: "대한민국", cc: "KR", lat: LAT, lng: LNG, addr: "대한민국 경상북도 경주시", tz: "Asia/Seoul", utc: 540 };
    const trial = async (key, inv, K, cfg, sopts, locale = "zh-TW") => {
      progress(`copy ${key}`);
      guard.beginPlacesGenerationSession(`tv-copy-${key}`);
      await new Promise((r) => setTimeout(r, 20));
      captured.length = 0;
      R[key] = await safe(async () => {
        const { c, searchPlaces } = makeCitySearch(inv, K, { ...sopts, noteRateLimited: guard.notePlacesRateLimited });
        const counts = { push: 0, reserve: 0 };
        const copyFn = () => String(chatRuntimeCopy("itineraryCandidatesInsufficient", locale, { destination: displayDestinationForCopy(cfg.label, undefined, locale), days: 4 }));
        const push = async (round) => {
          counts.push += 1; counts.reserve += 1; // pushDestinationPlaceRecommendation reserves once per call
          const before = captured.length;
          const w = await runWrapper({ cfg, style: "mixed", searchPlaces, locale, sessionTag: `${key}-${round}` });
          const logs = captured.slice(before).filter((s) => /RENDER_BLOCKED/.test(s));
          return { w, logs, ret: chatModel(w.r, locale, copyFn) };
        };
        const first = await push(1);
        const rl = { rateLimitEncountered: plc.hasPlacesRateLimitEncountered(), isPlacesRateLimited: guard.isPlacesRateLimited(), textRateLimited: guard.getPlacesApiCallStats?.().textRateLimited ?? null };
        let fallbackShouldFetch = null; let second = null;
        if (!first.ret.applied) {
          const tcm = await import("../src/lib/ai/travel-context.ts");
          const scoped = { travelContext: first.w.ctx, tripDays: 4, conversationMode: "destination_planning", phase: "recommend" };
          const merged = tcm.mergeTravelContext(scoped, first.w.text);
          fallbackShouldFetch = must.shouldFetchDestinationPlaces(first.w.text, merged.context, scoped);
          if (fallbackShouldFetch) second = await push(2);
        }
        const content = first.ret.content ?? "";
        return {
          branch: branchOf(first.logs), blockReasons: [...new Set(first.logs.map((s) => (s.match(/(itinerary_validator_failed:[A-Za-z_,]*|insufficient_candidates|itinerary_plan_incomplete|no_valid_geocoded_places)/) ?? [])[1]).filter(Boolean))].slice(0, 3),
          candidateInsufficient: "candidateInsufficient" in first.w.r ? first.w.r.candidateInsufficient : "absent",
          dayPlanItems: first.w.r.dayPlan?.items?.length ?? 0, days: first.w.r.dayPlan?.days ?? 0, summaryHead: String(first.w.r.summary ?? "").slice(0, 70),
          chatPath: first.ret.path, shownText: content.slice(0, 120), shownRawKey: /itineraryCandidatesInsufficient/.test(content), shownUnfilled: /\{[a-zA-Z]+\}/.test(content),
          rlFlags: rl, serverCalls: c.server, expansionCalls: c.expansion, nonExpansionCalls: c.nonExpansion, rateLimitedReturned: c.rateLimitedReturned,
          fallbackShouldFetch, round2: second ? { branch: branchOf(second.logs), candidateInsufficient: second.w.r.candidateInsufficient ?? "absent", chatPath: second.ret.path } : null,
          pushCount: counts.push, creditReserves: counts.reserve,
        };
      });
    };
    // Isolated rate-limit run: first (and only) trial of a fresh process so no candidate cache is reused.
    const RA = argv.find((a) => a.startsWith(CHILD ? "--rate-after-h=" : "--rate-after-w="))?.split("=")[1];
    if (RA != null) {
      const mode = argv.find((a) => a.startsWith("--rate-mode="))?.slice(12) ?? "429";
      const loc = argv.find((a) => a.startsWith("--rate-locale="))?.slice(14) ?? "zh-TW";
      R.rateRun = { after: Number(RA), mode, loc };
      await trial(`thin慶州|RATE`, thinInv(), 16, cfgG, { rateLimitAfter: Number(RA), ...(mode === "cooldown" ? { rateMode: "cooldown" } : {}) }, loc);
      // control in the same process for the same locale is cached; report only the isolated rate trial
      return R;
    }
    for (const L of LOCS) await trial(`thin慶州|${L}`, thinInv(), 16, cfgG, {}, L);
    const N = R["thin慶州|zh-TW"]?.serverCalls ?? 40;
    R.rateLimitPoints = { baselineServerCalls: N, points: [N - 1, Math.floor(N * 0.75), Math.floor(N / 2), 3] };
    const PT = ["N-1", "0.75N", "0.5N", "3"];
    for (const [i, after] of R.rateLimitPoints.points.entries()) await trial(`thin慶州|429 after ${PT[i]}`, thinInv(), 16, cfgG, { rateLimitAfter: after });
    for (const [lab, after] of [["N-1", N - 1], ["3", 3]]) await trial(`thin慶州|cooldown after ${lab}`, thinInv(), 16, cfgG, { rateLimitAfter: after, rateMode: "cooldown" });
    await trial("thin慶州|429 after N-1|en", thinInv(), 16, cfgG, { rateLimitAfter: N - 1 }, "en");
    await trial("complete台北|zh-TW", await buildCityInventory(TPE), TPE.K, TPE, {});
  }

  // ================= EXPAND (2a) =================
  if (ONLY === "expand") {
    const ppe = await import("../src/lib/ai/place-pool-expansion.ts");
    const mdp = await import("../src/lib/ai/ai-multi-day-planner.ts");
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    pid = 0;
    const LAT = 36.5613; const LNG = 136.6562;
    let seq = 0;
    const mk = (kind) => { seq += 1; const isD = kind === "dining"; return normalizeGooglePlaces([gPlace({ name: `金澤${isD ? "食堂" : "名所"}${seq}`, types: isD ? ["restaurant", "food"] : ["tourist_attraction", "point_of_interest"], reviews: 1500, rating: 4.4, lat: LAT, lng: LNG, addr: `日本石川縣金澤市${seq}`, tag: "exp", utc: 540 })])[0]; };
    const base = (nScenic, nDining) => [...Array.from({ length: nScenic }, () => mk("scenic")), ...Array.from({ length: nDining }, () => mk("dining"))];
    const isDiningBatch = (attempts) => (attempts[0]?.includedTypes ?? []).some((t) => /restaurant|cafe|bakery|food|meal/.test(t));
    const scenarios = {
      // ---- tu expand 5 (unchanged definitions) ----
      dining_only: { base: [16, 4], gain: ({ dining }) => (dining ? [3, "dining"] : [0]) },
      slow_1_per_batch: { base: [12, 6], gain: ({ i }) => [1, i % 2 ? "dining" : "scenic"] },
      sparse_every_2nd: { base: [12, 6], gain: ({ i }) => (i % 2 ? [1, i % 4 === 1 ? "dining" : "scenic"] : [0]) },
      late_gain_after_7: { base: [12, 6], gain: ({ i }) => (i >= 7 ? [3, i % 2 ? "dining" : "scenic"] : [0]) },
      fast: { base: [12, 6], gain: ({ i }) => [3, i % 2 ? "dining" : "scenic"] },
      // ---- new: both scenic and dining short; each batch only yields its own kind ----
      both_missing_kind_true: { base: [4, 2], gain: ({ dining }) => [1, dining ? "dining" : "scenic"] },
      // both short, scenic categories yield nothing (thin scenic city), only dining batches add
      both_missing_scenic_dry: { base: [4, 2], gain: ({ dining }) => (dining ? [2, "dining"] : [0]) },
      // ---- new: need many queries (1 new place every Nth batch, never 8 zero batches in a row) ----
      needs_100plus_every3: { base: [8, 4], gain: ({ i }) => (i % 3 === 2 ? [1, i % 2 ? "dining" : "scenic"] : [0]) },
      needs_100plus_every5: { base: [10, 6], gain: ({ i }) => (i % 5 === 4 ? [1, i % 2 ? "dining" : "scenic"] : [0]) },
      needs_100plus_every7: { base: [12, 8], gain: ({ i }) => (i % 7 === 6 ? [1, i % 2 ? "dining" : "scenic"] : [0]) },
    };
    R.radiusSteps = mdp.PLANNING_RADIUS_STEPS_M;
    R.minPool = mdp.minCandidatePoolSize(4);
    R.budgetConst = ppe.POOL_EXPANSION_QUERY_BUDGET ?? "absent";
    R.zeroGainConst = ppe.POOL_EXPANSION_MAX_ZERO_GAIN_BATCHES ?? "absent";
    const comp = (pool) => { const g = mdp.evaluatePlannerPoolGate(pool, 4); return { attraction: g.pools.attraction, dining: g.pools.lunch, missing: g.missingSlots.join(",") }; };
    for (const [name, sc] of Object.entries(scenarios)) {
      seq = 0;
      const existing = base(...sc.base);
      let i = 0; let queries = 0; const tags = []; const keys = new Set();
      const searchBatch = async ({ attempts, caller, radiusM }) => {
        const dining = isDiningBatch(attempts);
        const [n, kind] = sc.gain({ i, dining });
        i += 1; queries += attempts.length; tags.push(caller.replace(/^.*?verify\.tv\.expand\./, ""));
        for (const a of attempts) keys.add(`${radiusM}|${a.query}|${(a.includedTypes ?? []).join(",")}`);
        return [...existing.slice(0, 3), ...Array.from({ length: n }, () => mk(kind ?? (dining ? "dining" : "scenic")))];
      };
      captured.length = 0;
      R[`expand|${name}`] = await safe(async () => {
        const o = await ppe.expandPlacePoolUntilSufficient({ label: "金澤", lat: LAT, lng: LNG, days: 4, style: "mixed", existingPlaces: existing, caller: "verify.tv.expand", searchBatch });
        return { baseReady: mdp.isPlannerPoolReady(existing, 4), baseComp: comp(existing), ready: mdp.isPlannerPoolReady(o, 4), pool: o.length, comp: comp(o), batches: i, queries, distinctKeys: keys.size,
          firstTags: tags.slice(0, 2), firstDiningBatchIdx: tags.findIndex((t) => /^(night_market|cafe|breakfast|restaurant|bakery)\./.test(t)), lastTag: tags.slice(-1)[0] ?? null,
          budgetStop: captured.some((s) => /AI_POOL_EXPAND_BUDGET/.test(s)) };
      });
    }
    // Shared budget across several expansion calls in one generation (as generateTripPlanFromStyle does).
    R.sharedBudget = await safe(async () => {
      if (typeof ppe.createPoolExpansionQueryBudget !== "function") return "createPoolExpansionQueryBudget absent";
      const budget = ppe.createPoolExpansionQueryBudget();
      const keys = new Set(); let sent = 0; const perCall = [];
      seq = 0;
      for (let call = 0; call < 6; call += 1) {
        const existing = base(4, 2);
        let n = 0;
        const searchBatch = async ({ attempts, radiusM }) => { n += attempts.length; sent += attempts.length; for (const a of attempts) keys.add(`${radiusM}|${a.query}|${(a.includedTypes ?? []).join(",")}`); return []; };
        // never-ready pool, zero gain: each call would stop on zero-gain streak; budget must still bound the sum
        await ppe.expandPlacePoolUntilSufficient({ label: `金澤`, lat: LAT, lng: LNG, days: 4, style: "mixed", existingPlaces: existing, caller: `verify.tv.shared${call}`, searchBatch, queryBudget: budget });
        perCall.push(n);
      }
      // gaining variant: every batch adds 1 place but pool kept below ready by days=30
      const budget2 = ppe.createPoolExpansionQueryBudget();
      const keys2 = new Set(); let sent2 = 0; const perCall2 = [];
      for (let call = 0; call < 4; call += 1) {
        const existing = base(4, 2);
        let n = 0;
        const searchBatch = async ({ attempts, radiusM }) => { n += attempts.length; sent2 += attempts.length; for (const a of attempts) keys2.add(`${radiusM}|${a.query}|${(a.includedTypes ?? []).join(",")}`); return [mk("scenic")]; };
        await ppe.expandPlacePoolUntilSufficient({ label: `金澤`, lat: LAT, lng: LNG, days: 30, style: "mixed", existingPlaces: existing, caller: `verify.tv.shared2.${call}`, searchBatch, queryBudget: budget2 });
        perCall2.push(n);
      }
      return { zeroGain: { sent, distinct: keys.size, perCall, budgetSeen: budget.seen.size }, gaining: { sent: sent2, distinct: keys2.size, perCall: perCall2, budgetSeen: budget2.seen.size } };
    });
    // Without a shared budget (each call its own) for comparison: gaining variant
    R.unsharedGaining = await safe(async () => {
      seq = 0; let sent = 0; const perCall = [];
      for (let call = 0; call < 4; call += 1) {
        const existing = base(4, 2); let n = 0;
        const searchBatch = async ({ attempts }) => { n += attempts.length; sent += attempts.length; return [mk("scenic")]; };
        await ppe.expandPlacePoolUntilSufficient({ label: `金澤`, lat: LAT, lng: LNG, days: 30, style: "mixed", existingPlaces: existing, caller: `verify.tv.unshared.${call}`, searchBatch });
        perCall.push(n);
      }
      return { sent, perCall };
    });
  }

  // ================= TH (2b, 2c) =================
  if (ONLY === "th") {
    progress("th import");
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    const dtp = await import("../src/lib/ai/destination-trip-planning.ts");
    const { classifyDestinationForPlaceSearch } = await import("../src/lib/ai/landmark-place-strategy.ts");
    const { resetPlannerSession } = await import("../src/lib/ai/planner-session-guard.ts");
    const LAT = 36.5684; const LNG = 128.7294;
    pid = 0;
    // Identical fixture to verify-ts-review.mjs th (linear coords, utc 480 default there).
    const g = (name, types, reviews, rating = 4.3, oh) => gPlace({ name, types, reviews, rating, lat: LAT, lng: LNG, addr: `경상북도 안동시 ${name}`, tag: "andong", oh, linear: true });
    const FOOD = [["안동찜닭 골목 원조", ["restaurant", "food"], 900], ["맛있는 헛제사밥", ["restaurant", "food"], 500], ["옥야식당", ["restaurant", "food"], 1200], ["안동국시 명가", ["restaurant", "food"], 400], ["간고등어 정식", ["restaurant", "food"], 350], ["신시장 한우", ["restaurant", "food"], 600], ["월영교 식당", ["restaurant", "food"], 300], ["하회 손두부", ["restaurant", "food"], 420], ["안동 갈비골목", ["restaurant", "food"], 800], ["버버리찰떡", ["bakery", "food"], 700]].map(([n, t, c]) => g(n, t, c));
    const CAFE = [["카페 월영", ["cafe", "coffee_shop"], 400], ["안동 한옥카페", ["cafe"], 300], ["낙강물길 카페", ["cafe"], 250], ["커피 하회", ["cafe"], 180]].map(([n, t, c]) => g(n, t, c));
    const ATTR = [["안동하회마을", ["tourist_attraction", "point_of_interest"], 12000, 4.6], ["월영교", ["tourist_attraction", "point_of_interest"], 9000, 4.6], ["도산서원", ["tourist_attraction", "historical_landmark"], 5000, 4.6], ["병산서원", ["tourist_attraction", "historical_landmark"], 3000, 4.6], ["부용대", ["tourist_attraction", "natural_feature"], 1500, 4.6], ["안동민속박물관", ["museum", "tourist_attraction"], 1200, 4.4]].map(([n, t, c, r]) => g(n, t, c, r, hours(9 * 60, 18 * 60)));
    const ORD_SPEC = [["옥동근린공원", PARK, 40, 4.2], ["태화어린이공원", PARK, 22, 4.1], ["용상마을공원", PARK, 30, 4.0], ["정하동네공원", PARK, 35, 4.2], ["명륜소공원", PARK, 18, 4.3], ["강남공원", PARK, 60, 4.2], ["송현공원", PARK, 45, 4.1]];
    const PARKS_ORD = ORD_SPEC.map(([n, t, c, r]) => g(n, t, c, r));
    const PARKS_OK = [["낙동강 음악분수", ["tourist_attraction", "park"], 700, 4.4], ["안동댐 월영공원", ["park", "tourist_attraction"], 1500, 4.4]].map(([n, t, c, r]) => g(n, t, c, r));
    const SHOP = [["안동구시장", ["market", "tourist_attraction"], 3000, 4.3], ["안동 웅부공원", ["park"], 900, 4.3]].map(([n, t, c, r]) => g(n, t, c, r));
    const ALL = normalizeGooglePlaces([...FOOD, ...CAFE, ...ATTR, ...PARKS_ORD, ...PARKS_OK, ...SHOP]);
    const byType = (re) => ALL.filter((p) => (p.types ?? []).some((t) => re.test(t)));
    const ORD_RE = new RegExp(ORD_SPEC.map(([n]) => n).join("|"));
    const c = { server: 0, exp: 0, nonExp: 0, expKeys: new Set(), perInv: {} };
    const reset = () => { c.server = 0; c.exp = 0; c.nonExp = 0; c.expKeys = new Set(); c.perInv = {}; };
    const searchPlaces = async ({ data }) => {
      c.server += 1;
      const caller = String(data?.placesCaller ?? data?.caller ?? data?.placesLane ?? "?");
      const m = caller.match(EXP_RE);
      if (m) { c.exp += 1; c.expKeys.add(`${m[5]}|${data?.query ?? ""}|${(data?.includedTypes ?? []).join(",")}`); const inv = m[1].slice(-50); c.perInv[inv] = (c.perInv[inv] ?? 0) + 1; } else c.nonExp += 1;
      const q = `${data?.query ?? ""} ${(data?.includedTypes ?? []).join(",")} ${data?.mode ?? ""}`.toLowerCase();
      let places;
      if (/restaurant|food|美食|餐|맛집|식당|breakfast|lunch|dinner|bakery|早餐|午餐|晚餐/.test(q)) places = byType(/restaurant|food|bakery/);
      else if (/cafe|coffee|咖啡|카페|dessert/.test(q)) places = byType(/cafe|coffee/);
      else if (/museum|博物|美術|gallery/.test(q)) places = byType(/museum/);
      else if (/park|公園|공원|nature|自然|garden|hiking/.test(q)) places = byType(/park|natural/);
      else if (/shop|market|市場|商圈|mall|night/.test(q)) places = byType(/market|shopping/);
      else places = ALL.filter((p) => !(p.types ?? []).some((t) => /restaurant|food|cafe|bakery/.test(t)));
      return { places: places.slice(0, 16), error: null };
    };
    // planner layer: attempts are exactly what runBatch sent (budget key = radius|query|types)
    const att = { total: 0, keys: new Set(), perInv: {}, batches: 0 };
    const searchDestinationPlaces = async (p) => {
      const m = String(p.caller ?? "").match(EXP_RE);
      const list = p.attempts?.length ? p.attempts.slice(0, 12) : [{ query: `${p.label} 景點`, includedTypes: ["tourist_attraction"] }, { query: `${p.label} restaurant`, includedTypes: ["restaurant"] }];
      if (m) { att.batches += 1; for (const a of p.attempts ?? []) { att.total += 1; att.keys.add(`${m[5]}|${a.query}|${(a.includedTypes ?? []).join(",")}`); } const inv = m[1].replace(/^verify\.tv\.th\.?/, "~").slice(-50); att.perInv[inv] = (att.perInv[inv] ?? 0) + (p.attempts?.length ?? 0); }
      const seen = new Set(); const all = [];
      for (const a of list) {
        const r = await searchPlaces({ data: { query: a.query, includedTypes: a.includedTypes, lat: p.lat, lng: p.lng, mode: a.mode, placesCaller: m ? String(p.caller) : "searchDestinationPlaces" } });
        for (const x of r.places) if (!seen.has(x.id)) { seen.add(x.id); all.push(x); }
      }
      return all;
    };
    const geocodeFn = async () => ({ location: { placeId: "geocode:andong", country: "대한민국", city: "안동시", lat: LAT, lng: LNG, formattedName: "대한민국 경상북도 안동시", displayLabel: "안동시", timezone: "Asia/Seoul", utcOffsetMinutes: 540 }, error: null });
    const style = STYLE;
    reset();
    const sid = `tv-th-${style}`;
    resetPlannerSession(sid);
    progress(`th planner ${style}`);
    captured.length = 0;
    R[`planner|${style}`] = await safe(async () => {
      const plan = await dtp.generateTripPlanFromStyle({
        label: "안동", lat: LAT, lng: LNG, locale: "zh-TW", searchPlaces, weather: null,
        context: { destination: "안동", days: 4, country: "대한민국", startDate: "2026-11-20", endDate: "2026-11-23" },
        style, days: 4, caller: "verify.tv.th", searchContext: { destination: "안동", days: 4 }, geocodeSucceeded: true,
        searchProfile: classifyDestinationForPlaceSearch("안동"), weatherSearchLabel: "안동", templateNameSearchAttempts: () => [],
        searchDestinationPlaces, planningSessionId: sid, geocodeFn,
      });
      const names = (plan.composedPlans ?? []).flatMap((d) => (d.entries ?? []).map((e) => e.name));
      return { serverCalls: c.server, expansionAttemptsSent: att.total, distinctExpansionKeys: att.keys.size, expansionBatches: att.batches, perInvocationAttempts: att.perInv,
        candidateInsufficient: plan.candidateInsufficient ? { required: plan.candidateInsufficient.requiredCount, available: plan.candidateInsufficient.availableCount } : null,
        dayPlanItems: plan.dayPlan?.items?.length ?? 0, composedCounts: (plan.composedPlans ?? []).map((d) => (d.entries ?? []).length), ordinaryScheduled: names.filter((n) => ORD_RE.test(n ?? "")) };
    });
    R[`planner|${style}|budgetStops`] = captured.filter((s) => /AI_POOL_EXPAND_BUDGET/.test(s)).length;
    // unified wrapper (same as ts th --unified --wrapper-only round1)
    const dpr = await import("../src/lib/ai/destination-place-recommendation.ts");
    const { createUnifiedSearchPlacesFn } = await import("../src/lib/places-search-unified.ts");
    const WL = LABEL;
    const text = style === "mixed" ? `幫我排${WL}4天行程` : `幫我排${WL}4天慢活自然行程`;
    const ctx = { destination: WL, days: 4, planningDaysConfirmed: true, planningTripStyle: style, startDate: "2026-11-20", endDate: "2026-11-23", country: "대한민국", destinationCountry: "KR", destinationType: "city", interests: [] };
    const sid2 = `ts-thw-${style}`;
    resetPlannerSession(sid2);
    const unified = createUnifiedSearchPlacesFn(async (args) => searchPlaces(args));
    let plannerCalls = 0;
    const wrapped = async (args) => { plannerCalls += 1; return unified(args); };
    reset();
    captured.length = 0;
    progress(`th wrapper ${style}`);
    R[`wrapper|${WL}|${style}`] = await safe(async () => {
      const r = await dpr.buildDestinationMustVisitRecommendation({ destination: WL, userText: text, locale: "zh-TW", context: ctx, searchPlaces: wrapped, geocodeFn, fetchWeatherFn: async () => null, planningSessionId: sid2, trustedCenter: { lat: LAT, lng: LNG } });
      const items = r.dayPlan?.items ?? [];
      return { plannerCalls, serverCalls: c.server, expansionServerCalls: c.exp, nonExpansionServerCalls: c.nonExp, distinctExpansionServerKeys: c.expKeys.size, expansionPerInvocation: c.perInv,
        dayPlanItems: items.length, days: r.dayPlan?.days ?? 0, recs: r.recommendations?.length ?? 0, candidateInsufficient: "candidateInsufficient" in r ? r.candidateInsufficient : "absent",
        ordinaryScheduled: items.map((i) => i.name).filter((n) => ORD_RE.test(n ?? "")), summary: String(r.summary ?? "").slice(0, 80) };
    });
    R[`wrapper|${style}|budgetStops`] = captured.filter((s) => /AI_POOL_EXPAND_BUDGET/.test(s)).length;
  }

  // ================= REPLAN (3) =================
  if (ONLY === "replan") {
    progress("replan import");
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    const mdp = await import("../src/lib/ai/ai-multi-day-planner.ts");
    const rp = await import("../src/lib/ai/itinerary-validator/replan.ts");
    const gate = await import("../src/lib/ai/tourism-quality-gate.ts");
    const LAT = 35.8562; const LNG = 129.2247;
    pid = 0;
    const g = (name, types, reviews, rating = 4.4, oh) => gPlace({ name, types, reviews, rating, lat: LAT, lng: LNG, addr: `경상북도 경주시 ${name}`, tag: "rpv", oh, utc: 540 });
    const ORD_N = [["옥동근린공원", 40], ["태화어린이공원", 22], ["용상마을공원", 30], ["정하동네공원", 35], ["명륜소공원", 18], ["강남공원", 60], ["송현공원", 45], ["황성동네공원", 28], ["용강어린이공원", 19], ["동천소공원", 33]];
    const ORD = normalizeGooglePlaces(ORD_N.map(([n, c]) => g(n, PARK, c, 4.2)));
    const REAL = normalizeGooglePlaces([g("불국사", ["tourist_attraction", "point_of_interest"], 12000, 4.6, hours(9 * 60, 18 * 60)), g("첨성대", ["tourist_attraction", "point_of_interest"], 5000, 4.6, hours(9 * 60, 22 * 60)), g("교리김밥", ["restaurant", "food"], 1500), g("카페 황리단", ["cafe", "coffee_shop"], 400)]);
    const ordIds = new Set(ORD.map((p) => p.id));
    R.gateOrdinary = Object.fromEntries(ORD.map((p) => [p.name, gate.evaluateTourismQuality(p).ok]));
    const e = (p, time, label = "景點") => ({ time, label, name: p.name, place: p });
    const counts = (plans) => plans.map((d) => (d.entries ?? []).length);
    const ordNames = (plans) => plans.flatMap((d) => (d.entries ?? []).filter((x) => ordIds.has(x.place?.id)).map((x) => x.name));
    const cases = {
      // (i) pool = ordinary parks only; plan has a few real stops on day1 (uneven) -> force redistribute
      "realDay1+ordPool": () => ({ plans: [{ day: 1, entries: [e(REAL[0], "09:00"), e(REAL[2], "12:00", "午餐"), e(REAL[1], "14:00"), e(REAL[3], "15:30", "下午茶")] }, { day: 2, entries: [] }, { day: 3, entries: [] }, { day: 4, entries: [] }], pool: ORD }),
      // (ii) pool = ordinary parks only; plan empty
      "empty+ordPool": () => ({ plans: [1, 2, 3, 4].map((day) => ({ day, entries: [] })), pool: ORD }),
      // (iii) plan already spread (2/day, real), pool = ordinary parks
      "real2perDay+ordPool": () => ({ plans: [{ day: 1, entries: [e(REAL[0], "09:00"), e(REAL[2], "12:00", "午餐")] }, { day: 2, entries: [e(REAL[1], "10:00"), e(REAL[3], "15:00", "下午茶")] }, { day: 3, entries: [e(REAL[0], "09:00")] }, { day: 4, entries: [] }], pool: ORD }),
      // control: richer real pool (redistribution should still be adopted, W == H)
      "control realPool": () => ({ plans: [{ day: 1, entries: [e(REAL[0], "09:00"), e(REAL[2], "12:00", "午餐"), e(REAL[1], "14:00")] }, { day: 2, entries: [] }, { day: 3, entries: [] }, { day: 4, entries: [] }], pool: normalizeGooglePlaces(Array.from({ length: 14 }, (_, i) => g(`경주명소${i}`, i % 2 ? ["restaurant", "food"] : ["tourist_attraction", "point_of_interest"], 2000 + i * 10, 4.5))) }),
    };
    for (const style of ["slow_nature", "mixed"]) {
      for (const [k, mkCase] of Object.entries(cases)) {
        captured.length = 0;
        R[`repair|${style}|${k}`] = await safe(() => {
          const { plans, pool } = mkCase();
          const inCounts = counts(plans);
          const merged = [...plans.flatMap((d) => d.entries.map((x) => x.place)), ...pool];
          let direct = null;
          try { const d = mdp.redistributePlacesEvenly({ places: merged, days: 4, style, plannedDate: "2026-11-20", pace: style === "slow_nature" ? "slow" : undefined }); direct = { counts: counts(d), ordinary: ordNames(d).length }; } catch (err) { direct = { error: String(err?.message ?? err).slice(0, 100) }; }
          const o = rp.repairRedistributeAcrossDays(plans, pool, 4, style, "2026-11-20", undefined, true, null, undefined, style === "slow_nature" ? "slow" : undefined);
          return { in: inCounts, mergedPool: merged.length, redistributeDirect: direct, out: counts(o), outTotal: counts(o).reduce((a, b) => a + b, 0), ordinaryInOut: ordNames(o), log: captured.filter((s) => /redistribute_across_days/.test(s)).map((s) => s.replace(/^.*step=/, "step=")).slice(0, 1) };
        });
      }
    }
  }
  R.fetchCalls = fetchCalls;
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TV_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tv-review.mjs";
    for (const f of [self, "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const headSrc = readFileSync(join(headDir, "src/lib/ai/place-pool-expansion.ts"), "utf8");
    out(`HEAD snapshot sanity: ZERO_GAIN present=${/POOL_EXPANSION_MAX_ZERO_GAIN_BATCHES/.test(headSrc)} prioritize present=${/prioritizeMissingCategories/.test(headSrc)} (expected false/false); W replan :1216 guard present=${/totalOf\(redistributed\) >= totalOf\(current\)/.test(readFileSync("src/lib/ai/itinerary-validator/replan.ts", "utf8"))}`);
    const childLimit = Math.max(30, LIMIT - 10);
    const pass = argv.filter((a) => a.startsWith("--style=") || a.startsWith("--label=") || a.startsWith("--rate-after-h=") || a.startsWith("--rate-mode=") || a.startsWith("--rate-locale="));
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", `--only=${ONLY}`, `--limit=${childLimit}`, ...pass], { cwd: headDir, encoding: "utf8", timeout: (childLimit + 15) * 1000, killSignal: "SIGKILL", maxBuffer: 256 << 20 });
    const m = (r.stdout ?? "").match(/@@TV_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    const prog = (r.stderr ?? "").match(/@@P [^\n]*/g) ?? [];
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"} lastProgress=${prog.slice(-1)[0] ?? "-"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: stdout tail=${(r.stdout ?? "").slice(-400)} stderr tail=${(r.stderr ?? "").slice(-600)}`);
  }
  armTimer();
  const WR = await collect();
  const S = (v) => JSON.stringify(v);
  out(`==== section ${ONLY} ${ONLY === "th" ? `${LABEL} ${STYLE}` : ""} ====`);
  for (const k of Object.keys(WR)) {
    out(`${k}\n  W=${S(WR[k])}`);
    if (HR) out(`  H=${S(HR[k])}`);
  }
  process.stdout.write("", () => process.exit(0));
}
