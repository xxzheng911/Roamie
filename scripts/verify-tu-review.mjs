import "./verify-netguard-full.mjs";
/**
 * T-U (tester, independent review). W (working tree) vs H (HEAD snapshot via --head-dir).
 * One section per run (--only=replan|city|b7|scope).
 *  replan  B5(d): redistributePlacesEvenly / repairRedistributeAcrossDays (:1208) / replanUntilItineraryValid (:1919)
 *  city    B6: wrapper (real searchDestinationPlaces + unified search) per --city=台北|台南|京都|金澤|slowgrow --style=mixed|slow_nature [--k=N]
 *  b7      B7 A(b)/(c): 慶州 thin pool, rate-limited variants, Taipei complete; chat render/fallback model + 4-locale copy
 *  scope   B7 B: evaluateDestinationScopeGate table, blocked contextPatch, 安東 end-to-end, same-name conflicts
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=N scripts/verify-tu-review.mjs -- --only=city --city=台南 --style=mixed --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const ONLY = argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "replan";
const LIMIT = Number(argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 200);
const CITY = argv.find((a) => a.startsWith("--city="))?.slice(7) ?? "台南";
const STYLE = argv.find((a) => a.startsWith("--style="))?.slice(8) ?? "mixed";
const KARG = argv.find((a) => a.startsWith("--k="))?.slice(4);
const K0ARG = argv.find((a) => a.startsWith("--k0="))?.slice(5);
const SCALE = Number(argv.find((a) => a.startsWith("--scale="))?.slice(8) ?? 1);
const COREARG = argv.find((a) => a.startsWith("--core="))?.slice(7);
const CORE = COREARG != null ? Number(COREARG) : null;
const out = console.log.bind(console);
const progress = (s) => process.stderr.write(`@@P ${CHILD ? "H" : "W"} ${s}\n`);
const captured = [];
const CAPTURE_RE = /ITINERARY_REPLAN_FORCE_REDISTRIBUTE|ITINERARY_AUTO_REPAIR|AI_POOL_EXPAND|AI_POOL_REPLAN\]|INSUFFICIENT|RENDER_BLOCKED|POOL_READY|AI_STYLE_PLACES_RESULT|HARD_FAIL|NOT_RENDERABLE|RATE_PROTECTION|RATE_LIMIT|SEARCH_SKIPPED|COOLDOWN|PLACES_BUDGET|GUARD_BLOCK/i;
for (const k of ["log", "info", "warn", "debug", "error"]) console[k] = (...a) => { const s = String(a[0] ?? ""); if (CAPTURE_RE.test(s)) captured.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ").slice(0, 200)); };
const armTimer = () => setTimeout(() => { out(`FAIL internal watchdog ${LIMIT}s (${CHILD ? "HEAD child" : "W"})`); process.exit(3); }, LIMIT * 1000).unref();
if (CHILD) armTimer();
if (ONLY === "replan" || ONLY === "city" || ONLY === "plan" || ONLY === "expand" || ONLY === "b7") process.env.VITE_VERBOSE_LOG = "1";

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); };
const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: String(e?.message ?? e).split("\n")[0].slice(0, 220), at: String(e?.stack ?? "").split("\n").slice(1, 5).map((s) => s.trim().replace(/^.*\/(src|scripts)\//, "$1/").slice(0, 120)) }; } };

const hours = (open, close, days = [0, 1, 2, 3, 4, 5, 6]) => ({
  periods: days.map((day) => ({ open: { day, hour: Math.floor(open / 60), minute: open % 60 }, close: { day, hour: Math.floor(close / 60), minute: close % 60 } })),
  weekdayDescriptions: [],
});
let pid = 0;
const gPlace = ({ name, types, rating = 4.4, reviews = 1500, oh = hours(7 * 60, 22 * 60), lat, lng, addr, tag = "x", spread = 1, utc = 480 }) => {
  pid += 1;
  const bare = `ChIJ${tag}${String(pid).padStart(5, "0")}abcdefghijklmnop`.slice(0, 27);
  return {
    id: `places/${bare}`, placeId: bare, displayName: { text: name }, formattedAddress: addr ?? `${name} 1`,
    location: { latitude: lat + ((pid % 17) - 8) * 0.0021 * spread, longitude: lng + ((pid % 13) - 6) * 0.0024 * spread }, rating, userRatingCount: reviews,
    primaryType: types[0], types: [...types], regularOpeningHours: oh, utcOffsetMinutes: utc, businessStatus: "OPERATIONAL",
  };
};
const PARK = ["park", "point_of_interest", "establishment"];
const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const CH = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥東南西北春夏秋冬金木水火土日月星雲風雪梅蘭竹菊松柏桃李杏荷楓櫻鶴鷺燕鹿";

// ---------------- city fixtures ----------------
const CITY_CFG = {
  台北: { tag: "tpe", label: "台北", country: "台灣", cc: "TW", lat: 25.0330, lng: 121.5654, addr: "臺灣台北市", tz: "Asia/Taipei", utc: 480, K: 20, rev: 6000,
    real: { attr: ["中正紀念堂", "西門町", "台北101觀景台", "龍山寺", "行天宮", "華山1914文化創意產業園區", "松山文創園區", "迪化街", "國父紀念館", "大稻埕碼頭"], museum: ["國立故宮博物院", "臺北市立美術館", "國立臺灣博物館"], park: ["大安森林公園", "陽明山國家公園", "象山步道"], food: ["鼎泰豐信義店", "阜杭豆漿", "林東芳牛肉麵"], cafe: ["Fika Fika Cafe", "日日裝咖啡"], market: ["南門市場", "永康街商圈"], night: ["饒河街觀光夜市", "士林夜市"] },
    n: { attr: 26, museum: 8, park: 8, food: 40, cafe: 14, market: 6, night: 3 } },
  台南: { tag: "tnn", label: "台南", country: "台灣", cc: "TW", lat: 22.9997, lng: 120.2270, addr: "臺灣台南市", tz: "Asia/Taipei", utc: 480, K: 12, rev: 2500,
    real: { attr: ["赤崁樓", "安平古堡", "神農街", "林百貨", "孔廟文化園區", "安平樹屋", "四草綠色隧道", "藍晒圖文創園區"], museum: ["國立臺灣文學館", "奇美博物館"], park: ["台南公園", "漁光島"], food: ["阿堂鹹粥", "富盛號碗粿", "度小月擔仔麵"], cafe: ["窄門咖啡", "鹿早茶屋"], market: ["水仙宮市場", "國華街"], night: ["花園夜市", "大東夜市"] },
    n: { attr: 14, museum: 3, park: 3, food: 24, cafe: 8, market: 3, night: 1 } },
  京都: { tag: "kyo", label: "京都", country: "日本", cc: "JP", lat: 35.0116, lng: 135.7681, addr: "日本京都府京都市", tz: "Asia/Tokyo", utc: 540, K: 20, rev: 8000,
    real: { attr: ["清水寺", "伏見稻荷大社", "金閣寺", "銀閣寺", "二條城", "八坂神社", "嵐山竹林小徑", "南禪寺", "祇園花見小路", "哲學之道"], museum: ["京都國立博物館", "京都市京瓷美術館"], park: ["圓山公園", "京都御苑"], food: ["一蘭拉麵京都河原町店", "奧丹清水", "錦天滿宮前豆腐"], cafe: ["% Arabica 京都東山", "小川珈琲本店"], market: ["錦市場", "新京極商店街"], night: [] },
    n: { attr: 26, museum: 6, park: 5, food: 32, cafe: 12, market: 3, night: 0 } },
  金澤: { tag: "kzw", label: "金澤", country: "日本", cc: "JP", lat: 36.5613, lng: 136.6562, addr: "日本石川縣金澤市", tz: "Asia/Tokyo", utc: 540, K: 10, rev: 2000,
    real: { attr: ["兼六園", "金澤城公園", "東茶屋街", "長町武家屋敷跡", "妙立寺", "尾山神社", "主計町茶屋街"], museum: ["金澤21世紀美術館", "鈴木大拙館"], park: ["卯辰山公園"], food: ["近江町市場壽司", "金澤咖哩GoGo", "治部煮老舖"], cafe: ["ひがし茶屋咖啡", "金箔霜淇淋箔一"], market: ["近江町市場"], night: [] },
    n: { attr: 10, museum: 3, park: 2, food: 18, cafe: 7, market: 2, night: 0 } },
};
CITY_CFG.slowgrow = { ...CITY_CFG.台南, tag: "slw", label: "台南", K: 3 };

const SUFFIX = { attr: ["老街", "古蹟", "文化園區", "歷史街區", "藝術村", "觀景台", "神社", "老宅"], museum: ["博物館", "美術館", "紀念館"], park: ["濕地公園", "森林步道", "海濱公園"], food: ["小吃", "食堂", "料理", "麵館", "飯館"], cafe: ["咖啡", "珈琲館", "甜點店"], market: ["市場", "商店街"], night: ["夜市"] };
const TYPES = { attr: ["tourist_attraction", "point_of_interest"], museum: ["museum", "tourist_attraction"], park: ["park", "tourist_attraction"], food: ["restaurant", "food"], cafe: ["cafe", "coffee_shop"], market: ["market", "tourist_attraction"], night: ["night_market", "tourist_attraction"] };
async function buildCityInventory(cfg) {
  const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
  pid = 0;
  const inv = {};
  for (const cat of Object.keys(TYPES)) {
    const names = [...(cfg.real[cat] ?? [])];
    for (let i = 0; i < Math.round((cfg.n[cat] ?? 0) * SCALE); i += 1) names.push(`${cfg.label}${CH[(i * 7 + cat.length) % CH.length]}${CH[(i * 3 + 5) % CH.length]}${SUFFIX[cat][i % SUFFIX[cat].length]}`);
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
const EXP_RE = /(postGeocodeExpand|prePlanExpand\.r\d+|replanExpand\.r\d+)/;
function makeCitySearch(inv, K, opts = {}) {
  const c = { server: 0, callers: {}, expansionCalls: 0, expansionKeys: new Set(), expansionInvocations: new Set(), nonExpansion: 0, rateLimitedReturned: 0 };
  const searchPlaces = async ({ data }) => {
    c.server += 1;
    const caller = String(data?.placesCaller ?? "?");
    const short = caller.replace(/\.r\d{4,5}$/, "").replace(/\.(top_rated|popular|hidden_gems|open_now)$/, "").replace(/\.[a-z_]+$/, ".*");
    c.callers[short] = (c.callers[short] ?? 0) + 1;
    // Every pool-expansion batch caller ends with `<category>.<variant>.r<radius>` (place-pool-expansion runBatch).
    const m = caller.match(/^(.*?)\.([a-z_]+)\.(top_rated|popular|hidden_gems|open_now)\.r(\d+)/);
    if (m) {
      c.expansionCalls += 1;
      const inv = m[1].replace(/^.*?\.(?=[A-Za-z]*(Expand|destinationTripPlanning))/, "").slice(-48);
      c.expansionInvocations.add(inv);
      c.perInvocation = c.perInvocation ?? {};
      c.perInvocation[inv] = (c.perInvocation[inv] ?? 0) + 1;
      c.expansionKeys.add(`${m[4]}|${data?.query ?? ""}|${(data?.includedTypes ?? []).join(",")}`);
    } else c.nonExpansion += 1;
    if (opts.rateLimitAfter != null && c.server > opts.rateLimitAfter) {
      c.rateLimitedReturned += 1;
      if (opts.rateMode === "cooldown" && opts.noteRateLimited) { opts.noteRateLimited({ retryAfterMs: 60_000 }); return { places: [], error: null }; }
      return { places: [], error: "places_rate_limited" };
    }
    const cat = route(data?.query ?? "", data?.includedTypes);
    const attrList = [...inv.attr, ...inv.museum.slice(0, 2), ...inv.park.slice(0, 2)];
    // Never return an empty server list: unified search then falls back to the browser client search,
    // which fails under node and starts a guard cooldown (fixture artifact, not product behaviour under test).
    const list = cat === "attr" || !inv[cat]?.length ? attrList : inv[cat];
    if (!list.length) return { places: [], error: null };
    const kEff = m ? K : (opts.K0 ?? K);
    if (list.length <= kEff) return { places: list, error: null };
    const off = hash(`${data?.query ?? ""}|${(data?.includedTypes ?? []).join(",")}|${data?.radius ?? ""}`) % list.length;
    const res = []; for (let i = 0; i < kEff; i += 1) res.push(list[(off + i) % list.length]);
    return { places: res, error: null };
  };
  return { c, searchPlaces };
}
async function runWrapper({ cfg, style, label, searchPlaces, c, locale = "zh-TW", sessionTag }) {
  const dpr = await import("../src/lib/ai/destination-place-recommendation.ts");
  const { createUnifiedSearchPlacesFn } = await import("../src/lib/places-search-unified.ts");
  const { resetPlannerSession } = await import("../src/lib/ai/planner-session-guard.ts");
  const unified = createUnifiedSearchPlacesFn(async (args) => searchPlaces(args));
  let plannerCalls = 0;
  const wrapped = async (args) => { plannerCalls += 1; return unified(args); };
  const L = label ?? cfg.label;
  const text = style === "mixed" ? `幫我排${L}4天行程` : `幫我排${L}4天慢活自然行程`;
  const ctx = { destination: L, days: 4, planningDaysConfirmed: true, planningTripStyle: style, startDate: "2026-11-20", endDate: "2026-11-23", country: cfg.country, destinationCountry: cfg.cc, destinationType: "city", interests: [] };
  const sid = `tu-${sessionTag}-${style}`;
  resetPlannerSession(sid);
  const geocodeFn = async () => ({ location: { placeId: `geocode:${cfg.tag}`, country: cfg.country, city: L, lat: cfg.lat, lng: cfg.lng, formattedName: `${cfg.addr}`, displayLabel: L, timezone: cfg.tz, utcOffsetMinutes: cfg.utc }, error: null });
  const r = await dpr.buildDestinationMustVisitRecommendation({ destination: L, userText: text, locale, context: ctx, searchPlaces: wrapped, geocodeFn, fetchWeatherFn: async () => null, planningSessionId: sid, trustedCenter: { lat: cfg.lat, lng: cfg.lng } });
  const items = r.dayPlan?.items ?? [];
  const perDay = [1, 2, 3, 4].map((d) => items.filter((i) => i.dayIndex === d).length);
  return { r, text, ctx, summary: {
    renderSuccess: Boolean(items.length) && (r.recommendations?.length ?? 0) > 0 && r.dayPlan?.days === 4,
    perDay, dayPlanItems: items.length, days: r.dayPlan?.days ?? 0, recs: r.recommendations?.length ?? 0,
    candidateInsufficient: "candidateInsufficient" in r ? r.candidateInsufficient : "absent",
    plannerCalls, serverCalls: c.server, expansionCalls: c.expansionCalls, distinctExpansionQueries: c.expansionKeys.size, expansionInvocations: [...c.expansionInvocations], expansionPerInvocation: c.perInvocation ?? {},
    nonExpansionCalls: c.nonExpansion, rateLimitedReturned: c.rateLimitedReturned,
    topCallers: Object.entries(c.callers).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k.slice(-60)}=${v}`),
    summaryHead: String(r.summary ?? "").slice(0, 160),
  } };
}

// ---------------- chat render/fallback model (labeled: logic model, not React render) ----------------
function chatModelReturn(result, locale, copyFn, hasBranch) {
  const dp = result.dayPlan?.items?.length ? result.dayPlan : undefined;
  const recs = dp ? dp.items : result.recommendations ?? [];
  if (!recs.length && !String(result.summary ?? "").trim()) return { applied: false, path: "empty_render" };
  const days = result.dayPlan?.days ?? 0;
  const success = Boolean(dp?.items.length) && recs.length > 0 && days > 0 && days === 4;
  const ci = hasBranch && result.candidateInsufficient === true;
  if (!success) {
    if (ci) return { applied: true, path: "candidates_insufficient_copy", content: copyFn() };
    return { applied: false, path: "incomplete_render -> applyLocalFallback" };
  }
  return { applied: true, path: "render_itinerary" };
}

async function collect() {
  const R = {};
  // ================= REPLAN (B5 d) =================
  if (ONLY === "replan") {
    progress("replan import");
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    const mdp = await import("../src/lib/ai/ai-multi-day-planner.ts");
    const rp = await import("../src/lib/ai/itinerary-validator/replan.ts");
    const vi = await import("../src/lib/ai/itinerary-validator/index.ts");
    const gate = await import("../src/lib/ai/tourism-quality-gate.ts");
    progress("replan imported");
    const LAT = 36.5684; const LNG = 128.7294;
    pid = 0;
    const g = (name, types, reviews, rating = 4.4, oh) => gPlace({ name, types, reviews, rating, lat: LAT, lng: LNG, addr: `경상북도 안동시 ${name}`, tag: "rpl", oh, utc: 540 });
    const ATTR = [["안동하회마을", 12000], ["월영교", 9000], ["도산서원", 5000], ["병산서원", 3000], ["부용대", 1500], ["안동민속박물관", 1200], ["봉정사", 2600], ["임청각", 900], ["안동구시장", 3000], ["낙동강 음악분수", 700]].map(([n, c]) => g(n, ["tourist_attraction", "point_of_interest"], c, 4.6, hours(9 * 60, 18 * 60)));
    const FOOD = [["안동찜닭 골목 원조", 900], ["맛있는 헛제사밥", 500], ["옥야식당", 1200], ["안동국시 명가", 400], ["간고등어 정식", 350], ["신시장 한우", 600], ["월영교 식당", 300], ["하회 손두부", 420], ["안동 갈비골목", 800], ["버버리찰떡", 700], ["안동 콩국수", 330], ["경북 한정식", 520]].map(([n, c]) => g(n, ["restaurant", "food"], c));
    const CAFE = [["카페 월영", 400], ["안동 한옥카페", 300], ["낙강물길 카페", 250], ["커피 하회", 180], ["도산 찻집", 160]].map(([n, c]) => g(n, ["cafe", "coffee_shop"], c));
    const ORD = [["옥동근린공원", 40], ["태화어린이공원", 22], ["용상마을공원", 30], ["정하동네공원", 35], ["명륜소공원", 18]].map(([n, c]) => g(n, PARK, c, 4.2));
    const ALL = normalizeGooglePlaces([...ATTR, ...FOOD, ...CAFE, ...ORD]);
    const ordIds = new Set(ALL.filter((p) => ORD.some((o) => o.displayName.text === p.name)).map((p) => p.id));
    R.gateOrdinary = Object.fromEntries(ALL.filter((p) => ordIds.has(p.id)).map((p) => [p.name, gate.evaluateTourismQuality(p).ok]));
    R.gateFalseNonPark = ALL.filter((p) => !ordIds.has(p.id) && !gate.evaluateTourismQuality(p).ok).map((p) => p.name);
    const ordNames = (plans) => plans.flatMap((d) => (d.entries ?? []).map((e) => e.name ?? e.place?.name)).filter((n) => ALL.some((p) => ordIds.has(p.id) && p.name === n));
    const counts = (plans) => plans.map((d) => (d.entries ?? []).length);
    const entry = (p, time) => ({ time, label: "景點", name: p.name, place: p });
    const byName = (n) => ALL.find((p) => p.name === n);
    // (1) redistributePlacesEvenly direct
    for (const style of ["slow_nature", "mixed"]) {
      R[`redistribute|${style}`] = await safe(() => { const plans = mdp.redistributePlacesEvenly({ places: [...ORD.map((o) => byName(o.displayName.text)), ...ALL], days: 4, style, plannedDate: "2026-11-20", pace: style === "slow_nature" ? "slow" : undefined }); return { counts: counts(plans), ordinary: ordNames(plans) }; });
    }
    const pickedPark = byName("태화어린이공원");
    R["redistribute|slow_nature|userPicked 태화어린이공원"] = await safe(() => { const plans = mdp.redistributePlacesEvenly({ places: [pickedPark, ...ALL], days: 4, style: "slow_nature", plannedDate: "2026-11-20", pace: "slow", relaxDiversityFor: (p) => p.id === pickedPark.id }); return { counts: counts(plans), ordinary: ordNames(plans) }; });
    R["redistribute|only ordinary parks"] = await safe(() => { const plans = mdp.redistributePlacesEvenly({ places: ALL.filter((p) => ordIds.has(p.id)), days: 4, style: "slow_nature", plannedDate: "2026-11-20" }); return { counts: counts(plans), ordinary: ordNames(plans) }; });
    // (2) repairRedistributeAcrossDays (:1208), force=true, uneven plan with ordinary parks in pool
    const seed = () => [
      { day: 1, entries: [entry(byName("안동하회마을"), "09:00"), entry(byName("옥야식당"), "12:00"), entry(byName("월영교"), "14:00"), entry(byName("카페 월영"), "15:30"), entry(byName("도산서원"), "16:30"), entry(byName("안동찜닭 골목 원조"), "18:30")] },
      { day: 2, entries: [entry(byName("병산서원"), "10:00")] },
      { day: 3, entries: [] }, { day: 4, entries: [] },
    ];
    for (const style of ["slow_nature", "mixed"]) {
      captured.length = 0;
      R[`repairRedistribute(:1208)|${style}`] = await safe(() => { const plans = rp.repairRedistributeAcrossDays(seed(), ALL, 4, style, "2026-11-20", undefined, true, null, undefined, style === "slow_nature" ? "slow" : undefined); return { counts: counts(plans), ordinary: ordNames(plans), log: captured.filter((s) => /redistribute/.test(s)).slice(0, 2) }; });
    }
    R["repairRedistribute(:1208)|selected_only picked park"] = await safe(() => {
      const s = seed(); s[1].entries.push(entry(pickedPark, "11:30"));
      const lock = null;
      const plans = rp.repairRedistributeAcrossDays(s, ALL, 4, "slow_nature", "2026-11-20", undefined, true, lock, { style: "slow_nature", placeAuthority: "selected_only", lockedPlaceIds: [pickedPark.id], lockedPlaceNames: [pickedPark.name] }, "slow");
      return { counts: counts(plans), ordinary: ordNames(plans) };
    });
    // (3) replanUntilItineraryValid (:1919 force redistribute on identical empty day map)
    vi.setItineraryValidatorEnabledOverride?.(true);
    for (const style of ["slow_nature", "mixed"]) {
      captured.length = 0;
      R[`replanUntilValid|${style}`] = await safe(() => {
        const plans = seed();
        const input = { requestedDays: 4, style, plannedDate: "2026-11-20", destination: "안동", ...(style === "slow_nature" ? { pace: "slow" } : {}) };
        const initial = vi.validateItineraryPlan({ ...input, plans });
        const o = rp.replanUntilItineraryValid({ plans, pool: ALL, days: 4, style, plannedDate: "2026-11-20", validatorInput: input }, initial);
        return { initialPass: initial.pass, initialFailed: initial.failedRules.map((x) => x.code).slice(0, 6), stopReason: o.stopReason, pass: o.validation?.pass, failed: (o.validation?.failedRules ?? []).map((x) => x.code).slice(0, 6), counts: counts(o.plans), ordinary: ordNames(o.plans),
          forceRedistributeHit: captured.some((s) => /FORCE_REDISTRIBUTE/.test(s)), autoRepairRedistributeHit: captured.some((s) => /redistribute_across_days/.test(s)) };
      });
    }
    vi.setItineraryValidatorEnabledOverride?.(null);
  }

  // ================= CITY (B6) =================
  if (ONLY === "city") {
    const cfg = { ...CITY_CFG[CITY] };
    if (!cfg.tag) return { error: `unknown city ${CITY}` };
    if (KARG) cfg.K = Number(KARG);
    const REVARG = argv.find((a) => a.startsWith("--rev="))?.slice(6);
    if (REVARG) cfg.rev = Number(REVARG);
    progress(`city ${CITY} ${STYLE} K=${cfg.K}`);
    const inv = await buildCityInventory(cfg);
    R.inventory = Object.fromEntries(Object.entries(inv).map(([k, v]) => [k, v.length]));
    const { c, searchPlaces } = makeCitySearch(inv, cfg.K, K0ARG ? { K0: Number(K0ARG) } : {});
    R.params = { K: cfg.K, K0: K0ARG ?? null, scale: SCALE };
    const t0 = Date.now();
    R[`wrapper|${CITY}|${STYLE}|K=${cfg.K}`] = await safe(async () => (await runWrapper({ cfg, style: STYLE, searchPlaces, c, sessionTag: cfg.tag })).summary);
    R.budgetStops = captured.filter((s) => /AI_POOL_EXPAND_BUDGET/.test(s)).length;
    R.poolReplanRounds = captured.filter((s) => /AI_POOL_REPLAN\]/.test(s)).length;
    R.expandRadiusLogs = captured.filter((s) => /AI_POOL_EXPAND_RADIUS/.test(s)).length;
    if (argv.includes("--diag")) R.diag = [...new Set(captured.filter((s) => !/AI_POOL_EXPAND_(BATCH|RADIUS)/.test(s)).map((s) => s.slice(0, 160)))].slice(0, 25);
    R.ms = Date.now() - t0;
  }

  // ================= PLAN (B6, planner layer; no places-api-guard) =================
  // generateTripPlanFromStyle with injected search fns (same entry as verify-ts-review th planner).
  // Non-expansion queries return K0 places, expansion batches (`<cat>.<variant>.r<radius>`) return K.
  if (ONLY === "plan") {
    const cfg = { ...CITY_CFG[CITY] };
    if (!cfg.tag) return { error: `unknown city ${CITY}` };
    if (KARG) cfg.K = Number(KARG);
    const REVARG = argv.find((a) => a.startsWith("--rev="))?.slice(6);
    if (REVARG) cfg.rev = Number(REVARG);
    const K0 = K0ARG ? Number(K0ARG) : cfg.K;
    progress(`plan ${CITY} ${STYLE} K0=${K0} K=${cfg.K}`);
    const dtp = await import("../src/lib/ai/destination-trip-planning.ts");
    const { classifyDestinationForPlaceSearch } = await import("../src/lib/ai/landmark-place-strategy.ts");
    const { resetPlannerSession } = await import("../src/lib/ai/planner-session-guard.ts");
    const inv = await buildCityInventory(cfg);
    R.inventory = Object.fromEntries(Object.entries(inv).map(([k, v]) => [k, v.length]));
    R.params = { K: cfg.K, K0, scale: SCALE, rev: cfg.rev, core: CORE };
    const c = { server: 0, exp: 0, expKeys: new Set(), perInv: {}, supplement: 0, flagTrueOnExpansion: 0, flagFalseOnExpansion: 0 };
    const EXP = /^(.*?)\.(?:([a-z_]+)\.(top_rated|popular|hidden_gems|open_now)|(initial))\.r(\d+)$/;
    const searchPlaces = async ({ data }) => {
      c.server += 1;
      const caller = String(data?.placesCaller ?? "");
      const m = caller.match(EXP);
      const cat = route(data?.query ?? "", data?.includedTypes);
      const full = cat === "attr" ? [...inv.attr, ...inv.museum.slice(0, 2), ...inv.park.slice(0, 2)] : inv[cat];
      // --core=f: non-expansion queries only see the first f of each category list; expansion sees all.
      // --attr-full: attraction lane fully visible to primary search (expansion attraction batches then add 0).
      const list = m || CORE == null || (cat === "attr" && argv.includes("--attr-full")) ? full : full.slice(0, Math.max(1, Math.ceil(full.length * CORE)));
      const kEff = m ? cfg.K : K0;
      if (!list.length) return { places: [], error: null };
      if (list.length <= kEff) return { places: list, error: null };
      const off = hash(`${data?.query ?? ""}|${(data?.includedTypes ?? []).join(",")}|${data?.radius ?? ""}`) % list.length;
      const res = []; for (let i = 0; i < kEff; i += 1) res.push(list[(off + i) % list.length]);
      return { places: res, error: null };
    };
    const searchDestinationPlaces = async (p) => {
      const m = String(p.caller ?? "").match(EXP);
      c.callerSamples = c.callerSamples ?? new Set();
      if (c.callerSamples.size < 30) c.callerSamples.add(String(p.caller ?? "").replace(/^verify\.tu\.plan/, "~").slice(0, 70));
      if (m) {
        c.perInv[m[1].slice(-40)] = (c.perInv[m[1].slice(-40)] ?? 0) + (p.attempts?.length ?? 0);
        if (p.disableAutomaticSupplement) c.flagTrueOnExpansion += 1; else c.flagFalseOnExpansion += 1;
      }
      const seen = new Set(); const all = [];
      const run = async (attempts, tag) => {
        for (const a of attempts) {
          if (m) { c.exp += 1; c.expKeys.add(`${m[5]}|${a.query}|${(a.includedTypes ?? []).join(",")}`); }
          const r = await searchPlaces({ data: { query: a.query, includedTypes: a.includedTypes, lat: p.lat, lng: p.lng, radius: p.radius, mode: a.mode, placesCaller: tag } });
          for (const x of r.places) if (!seen.has(x.id) && !(p.excludePlaceIds ?? []).includes(x.id)) { seen.add(x.id); all.push(x); }
        }
      };
      await run(p.attempts?.length ? p.attempts : [{ query: `${p.label} 景點`, includedTypes: ["tourist_attraction"] }], String(p.caller ?? ""));
      // Model the real searchDestinationPlaces automatic supplement (label+景點 / English fallback) when not disabled and result < 6.
      if (!p.disableAutomaticSupplement && all.length < 6) {
        c.supplement += 2;
        await run([{ query: `${p.label} 景點`, includedTypes: ["tourist_attraction"] }, { query: `${p.label} attractions`, includedTypes: ["tourist_attraction"] }], `${p.caller}.supplement`);
      }
      return all;
    };
    const sid = `tu-plan-${cfg.tag}-${STYLE}`;
    resetPlannerSession(sid);
    const geocodeFn = async () => ({ location: { placeId: `geocode:${cfg.tag}`, country: cfg.country, city: cfg.label, lat: cfg.lat, lng: cfg.lng, formattedName: cfg.addr, displayLabel: cfg.label, timezone: cfg.tz, utcOffsetMinutes: cfg.utc }, error: null });
    const t0 = Date.now();
    R[`planner|${CITY}|${STYLE}|K0=${K0}|K=${cfg.K}`] = await safe(async () => {
      const plan = await dtp.generateTripPlanFromStyle({
        label: cfg.label, lat: cfg.lat, lng: cfg.lng, locale: "zh-TW", searchPlaces, weather: null,
        context: { destination: cfg.label, days: 4, country: cfg.country, startDate: "2026-11-20", endDate: "2026-11-23" },
        style: STYLE, days: 4, caller: "verify.tu.plan", searchContext: { destination: cfg.label, days: 4 }, geocodeSucceeded: true,
        searchProfile: classifyDestinationForPlaceSearch(cfg.label), weatherSearchLabel: cfg.label, templateNameSearchAttempts: () => [],
        searchDestinationPlaces, planningSessionId: sid, geocodeFn,
      });
      const composed = plan.composedPlans ?? [];
      return {
        complete: (plan.dayPlan?.items?.length ?? 0) > 0 && plan.dayPlan?.days === 4 && !plan.candidateInsufficient,
        dayPlanItems: plan.dayPlan?.items?.length ?? 0, dayPlanDays: plan.dayPlan?.days ?? 0,
        composedCounts: composed.map((d) => (d.entries ?? []).length),
        candidateInsufficient: plan.candidateInsufficient ? { required: plan.candidateInsufficient.requiredCount, available: plan.candidateInsufficient.availableCount } : null,
        poolExpansionExhausted: plan.poolExpansionExhausted ?? null,
        serverCalls: c.server, expansionQueries: c.exp, distinctExpansionQueries: c.expKeys.size, expansionPerInvocation: c.perInv,
        callerSamples: argv.includes("--diag") ? [...(c.callerSamples ?? [])] : undefined,
        supplementQueries: c.supplement, expansionBatchesWithSupplementDisabled: c.flagTrueOnExpansion, expansionBatchesWithSupplementEnabled: c.flagFalseOnExpansion,
      };
    });
    R.budgetStops = captured.filter((s) => /AI_POOL_EXPAND_BUDGET/.test(s)).length;
    R.expandStarts = captured.filter((s) => /AI_POOL_EXPAND_START/.test(s)).length;
    R.poolReplanRounds = captured.filter((s) => /AI_POOL_REPLAN\]/.test(s)).length;
    R.rateProtection = captured.filter((s) => /RATE_PROTECTION|COOLDOWN_STARTED/.test(s)).length;
    if (argv.includes("--diag")) R.diag = [...new Set(captured.filter((s) => /AI_STYLE_PLACES_RESULT|AI_POOL_REPLAN|AI_POOL_EXPAND|INSUFFICIENT_RESULT|RENDER_BLOCKED/.test(s)).map((s) => s.slice(0, 150)))].slice(0, 30);
    R.ms = Date.now() - t0;
  }

  // ================= EXPAND (B6 unit: expandPlacePoolUntilSufficient with scripted per-batch gain) =================
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
      // Scenic already sufficient, dining short; only dining categories (index >= 14) add places.
      dining_only: { base: [16, 4], gain: ({ dining }) => (dining ? [3, "dining"] : [0]) },
      // Every batch adds 1 place, alternating kinds.
      slow_1_per_batch: { base: [12, 6], gain: ({ i }) => [1, i % 2 ? "dining" : "scenic"] },
      // Gain on every 2nd batch (never 6 zeros in a row).
      sparse_every_2nd: { base: [12, 6], gain: ({ i }) => (i % 2 ? [1, i % 4 === 1 ? "dining" : "scenic"] : [0]) },
      // First 7 batches add nothing, then 3 each.
      late_gain_after_7: { base: [12, 6], gain: ({ i }) => (i >= 7 ? [3, i % 2 ? "dining" : "scenic"] : [0]) },
      // Quick: first batch adds plenty.
      fast: { base: [12, 6], gain: ({ i }) => [3, i % 2 ? "dining" : "scenic"] },
    };
    R.radiusSteps = mdp.PLANNING_RADIUS_STEPS_M;
    R.categoryOrder = ppe.POOL_EXPANSION_CATEGORIES.map((c) => c.key);
    for (const [name, sc] of Object.entries(scenarios)) {
      seq = 0;
      const existing = base(...sc.base);
      let i = 0; let queries = 0; const tags = [];
      const searchBatch = async ({ attempts, caller }) => {
        const dining = isDiningBatch(attempts);
        const [n, kind] = sc.gain({ i, dining });
        i += 1; queries += attempts.length; tags.push(caller.replace(/^.*?verify\.tu\.expand\./, ""));
        return [...existing.slice(0, 3), ...Array.from({ length: n }, () => mk(kind ?? (dining ? "dining" : "scenic")))];
      };
      captured.length = 0;
      R[`expand|${name}`] = await safe(async () => {
        const out = await ppe.expandPlacePoolUntilSufficient({ label: "金澤", lat: LAT, lng: LNG, days: 4, style: "mixed", existingPlaces: existing, caller: "verify.tu.expand", searchBatch });
        return { basePoolReady: mdp.isPlannerPoolReady(existing, 4), ready: mdp.isPlannerPoolReady(out, 4), pool: out.length, batches: i, queries, firstTags: tags.slice(0, 3), lastTag: tags.slice(-1)[0] ?? null, budgetStop: captured.some((s) => /AI_POOL_EXPAND_BUDGET/.test(s)) };
      });
    }
  }

  // ================= B7 A(b)/(c) =================
  if (ONLY === "b7") {
    progress("b7 import");
    const { chatRuntimeCopy } = await import("../src/lib/chat-runtime-copy.ts");
    const { displayDestinationForCopy } = await import("../src/lib/ai/destination-locale-aliases.ts");
    const must = await import("../src/lib/ai/must-visit-places.ts");
    const guard = await import("../src/lib/places-api-guard.ts");
    const chatSrc = readFileSync("src/routes/_app.chat.tsx", "utf8");
    const hasBranch = /if \(candidateInsufficient && requestedTripDays\)[\s\S]{0,400}itineraryCandidatesInsufficient[\s\S]{0,300}return true;/.test(chatSrc);
    R.chatSource = { hasInsufficientBranch: hasBranch, passesFlagToRender: /renderDestinationReply\([^)]*candidateInsufficient === true\)/.test(chatSrc) };
    R.copy = Object.fromEntries(["zh-TW", "en", "ja", "ko"].map((L) => { const v = chatRuntimeCopy("itineraryCandidatesInsufficient", L, { destination: displayDestinationForCopy("慶州", undefined, L), days: 4 }); return [L, { text: String(v).slice(0, 160), rawKey: /itineraryCandidatesInsufficient/.test(String(v)), unfilled: /\{(destination|days)\}/.test(String(v)) }]; }));
    // Thin (Andong-like data, label 慶州) — same fixture shape as T-S th
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
    const TRIAL = argv.find((a) => a.startsWith("--trial="))?.slice(8);
    const plc = await import("../src/lib/places-classic-landmark-cache.ts");
    const trial = async (key, inv, K, cfg, sopts, locale = "zh-TW") => {
      if (TRIAL && !key.includes(TRIAL)) return;
      progress(`b7 ${key}`);
      // One user submission per trial (send() → beginPlacesGenerationSession); round2 = same submission.
      guard.beginPlacesGenerationSession(`tu-b7-${key}`);
      await new Promise((r) => setTimeout(r, 20));
      captured.length = 0;
      R[key] = await safe(async () => {
        const { c, searchPlaces } = makeCitySearch(inv, K, { ...sopts, noteRateLimited: guard.notePlacesRateLimited });
        const reserves = { n: 0 }; const pushes = { n: 0 };
        const push = async (round) => {
          pushes.n += 1; reserves.n += 1; // pushDestinationPlaceRecommendation: beginPlaceRecommendationCredits once per call
          const w = await runWrapper({ cfg, style: "mixed", searchPlaces, c, locale, sessionTag: `${key}-${round}` });
          const ret = chatModelReturn(w.r, locale, () => chatRuntimeCopy("itineraryCandidatesInsufficient", locale, { destination: displayDestinationForCopy(cfg.label, undefined, locale), days: 4 }), hasBranch);
          return { w, ret };
        };
        const first = await push(1);
        first.w.summary.rlFlagsAfterWrapper = { rateLimitEncountered: plc.hasPlacesRateLimitEncountered(), isPlacesRateLimited: guard.isPlacesRateLimited(), textRateLimited: guard.getPlacesApiCallStats?.().textRateLimited ?? null };
        first.w.summary.blockLogs = [...new Set(captured.filter((s) => /RENDER_BLOCKED|BLOCK_SAVE|INSUFFICIENT_RESULT|PLACES_RATE_LIMIT_FALLBACK|POOL_EXPAND_BUDGET/.test(s)).map((s) => s.slice(0, 140)))].slice(0, 8);
        let second = null;
        let fallbackGate = null;
        if (!first.ret.applied) {
          // applyLocalFallback (:7751) re-enters pushDestinationPlaceRecommendation when shouldFetchDestinationPlaces passes
          // Same call shape as applyLocalFallback (:7749-7751): mergeTravelContext(scopedSession, text) then (text, ctx, session).
          const tcm = await import("../src/lib/ai/travel-context.ts");
          const scopedSession = { travelContext: first.w.ctx, tripDays: 4, conversationMode: "destination_planning", phase: "recommend" };
          const merged = tcm.mergeTravelContext(scopedSession, first.w.text);
          fallbackGate = must.shouldFetchDestinationPlaces(first.w.text, merged.context, scopedSession);
          if (fallbackGate) second = await push(2);
        }
        const diag = [...new Set(captured.filter((s) => /RATE|COOLDOWN|SKIPPED|BUDGET|GUARD/i.test(s)).map((s) => s.slice(0, 130)))].slice(0, 6);
        return { round1: { ...first.w.summary, chat: first.ret }, fallbackShouldFetch: fallbackGate, round2: second ? { ...second.w.summary, chat: second.ret } : null, pushCount: pushes.n, creditReserves: reserves.n, diag };
      });
    };
    await trial("thin慶州|zh-TW", thinInv(), 16, cfgG, {});
    await trial("thin慶州|en", thinInv(), 16, cfgG, {}, "en");
    await trial("thin慶州|rate429 after 3", thinInv(), 16, cfgG, { rateLimitAfter: 3 });
    await trial("thin慶州|cooldown(notePlacesRateLimited) after 3", thinInv(), 16, cfgG, { rateLimitAfter: 3, rateMode: "cooldown" });
    const tpe = CITY_CFG.台北;
    await trial("complete台北", await buildCityInventory(tpe), tpe.K, tpe, {});
  }

  // ================= SCOPE (B7 B) =================
  if (ONLY === "scope") {
    progress("scope import");
    const ds = await import("../src/lib/ai/destination-scope.ts");
    const de = await import("../src/lib/ai/destination-entity.ts");
    const C = { lat: 36.5684, lng: 128.7294 };
    const LABELS = [["安東", "KR"], ["안동", "KR"], ["Andong", "KR"], ["全州", "KR"], ["大邱", "KR"], ["仁川", "KR"], ["光州", "KR"], ["宮崎", "JP"], ["蘇州", "CN"], ["鹿港", "TW"], ["會安", "VN"],
      ["京畿道", "KR"], ["慶尚北道", "KR"], ["江原道", "KR"], ["廣東省", "CN"], ["沖縄県", "JP"], ["首爾", "KR"], ["台北", "TW"], ["慶州", "KR"], ["日本", "JP"], ["韓國", "KR"]];
    const pick = (g) => `${g.placesCallBlocked ? "BLOCK" : "allow"}|${g.destinationType}|${g.scopePrecision}|ref=${g.requiresDestinationRefinement}`;
    R.gate = Object.fromEntries(LABELS.map(([l, cc]) => [l, {
      entity: de.resolveDestinationEntity(l)?.type ?? null,
      canDiscover: ds.canDiscoverDestinationPlaces(l),
      noCenter: pick(ds.evaluateDestinationScopeGate({ destination: l, countryCode: cc, requestedIntent: "must_visit_places" })),
      center: pick(ds.evaluateDestinationScopeGate({ destination: l, countryCode: cc, requestedIntent: "must_visit_places", trustedCenter: C })),
      centerTypeCity: pick(ds.evaluateDestinationScopeGate({ destination: l, destinationType: "city", countryCode: cc, requestedIntent: "must_visit_places", trustedCenter: C })),
    }]));
    // (d) gate with conflicting country hint: gate has no country check of its own
    R.gateConflict = {
      "光州 cc=JP + KR center": pick(ds.evaluateDestinationScopeGate({ destination: "光州", countryCode: "JP", trustedCenter: { lat: 35.1595, lng: 126.8526 } })),
      "安東 cc=CN + KR center": pick(ds.evaluateDestinationScopeGate({ destination: "安東", countryCode: "CN", trustedCenter: C })),
    };
    // (b) blocked contextPatch through the wrapper (no Places calls expected)
    const dpr = await import("../src/lib/ai/destination-place-recommendation.ts");
    let calls = 0;
    const sp = async () => { calls += 1; return { places: [], error: null }; };
    for (const [l, cc, center] of [["日本", "JP"], ["韓國", "KR"], ["京畿道", "KR", C], ["京畿道", "KR"], ["安東", "KR"], ["慶尚北道", "KR", C]]) {
      calls = 0;
      const key = `patch|${l}|${center ? "center" : "noCenter"}`;
      progress(key);
      R[key] = await safe(async () => {
        const r = await dpr.buildDestinationMustVisitRecommendation({ destination: l, userText: `${l}必去景點`, locale: "zh-TW", context: { destination: l, destinationCountry: cc, interests: [] }, searchPlaces: sp, geocodeFn: async () => ({ location: null, error: "x" }), fetchWeatherFn: async () => null, planningSessionId: `tu-scope-${l}`, ...(center ? { trustedCenter: center } : {}) });
        return { searchCalls: calls, contextPatch: r.contextPatch, recs: r.recommendations?.length ?? 0, summary: String(r.summary ?? "").slice(0, 120) };
      });
    }
    // (c) 安東 end-to-end (pure pipeline pieces of send() → push → wrapper)
    const tc = await import("../src/lib/ai/travel-context.ts");
    const must = await import("../src/lib/ai/must-visit-places.ts");
    const cps = await import("../src/lib/ai/chat-planning-state.ts");
    const ctd = await import("../src/lib/ai/chat-turn-destination.ts");
    const ats = await import("../src/lib/ai/ai-trip-style.ts");
    const mixedOpt = ats.TRIP_STYLE_OPTIONS?.find?.((o) => o.key === "mixed");
    R.mixedOption = mixedOpt ? { label: mixedOpt.label, short: mixedOpt.shortLabel, idx: ats.TRIP_STYLE_OPTIONS.indexOf(mixedOpt) + 1 } : null;
    const geoQueries = [];
    const geoKR = async (a) => { geoQueries.push(JSON.stringify(a?.data ?? a ?? {}).slice(0, 120)); return { location: { placeId: "ChIJandong0000abcdefghijkl", country: "대한민국", countryCode: "KR", city: "안동시", lat: 36.5684, lng: 128.7294, formattedName: "대한민국 경상북도 안동시", displayLabel: "안동시", timezone: "Asia/Seoul", utcOffsetMinutes: 540 }, error: null }; };
    for (const text of ["我想去安東 3 天", "幫我排安東3天行程", "안동 3일 여행 일정 짜줘"]) {
      const key = `e2e|${text}`;
      progress(key);
      R[key] = await safe(async () => {
        const session0 = { travelContext: { interests: [] }, conversationMode: "general" };
        let m1;
        try { m1 = tc.mergeTravelContext(session0, text); } catch (e) { return { failedStep: "mergeTravelContext(turn1)", error: String(e?.message ?? e).slice(0, 160), stack: String(e?.stack ?? "").split("\n").slice(1, 4).map((s) => s.trim().slice(0, 120)) }; }
        const st = (name, fn) => { try { return { ok: true, v: fn() }; } catch (e) { return { ok: false, step: name, error: String(e?.message ?? e).slice(0, 160), stack: String(e?.stack ?? "").split("\n").slice(1, 4).map((s) => s.trim().slice(0, 140)) }; } };
        const sess1 = m1.session ?? session0;
        const pc = st("mergeContextForPlaceFetch", () => must.mergeContextForPlaceFetch(m1.context, sess1));
        if (!pc.ok) return { mergeKeys: Object.keys(m1 ?? {}), ...pc };
        const placeCtx = pc.v;
        // Same call shape as send() (:12656): (text, ctx, session)
        const f1 = st("shouldFetchDestinationPlaces", () => must.shouldFetchDestinationPlaces(text, placeCtx, sess1));
        if (!f1.ok) return { turn1ctx: { destination: placeCtx.destination, days: placeCtx.days, destinationType: placeCtx.destinationType }, ...f1 };
        const fetch1 = f1.v;
        const mv = st("resolveMustVisitDestination", () => must.resolveMustVisitDestination(placeCtx, text) ?? null);
        if (!mv.ok) return { fetch1, ...mv };
        const mvd = mv.v;
        m1.session = sess1;
        // Turn 2: user picks a style after ask_trip_style (stylePlanTurn path bypasses shouldFetchDestinationPlaces)
        // Style chosen by its label text (avoids numeric-selection ownership, which needs a persisted workspace).
        const t2 = String(R.mixedOption?.label ?? "Roamie 幫我混搭推薦");
        const s2 = { ...m1.session, travelContext: { ...placeCtx, planningDaysConfirmed: true }, pendingQuestion: { type: "ask_trip_style", options: (ats.TRIP_STYLE_OPTIONS ?? []).map((o) => o.key) }, chatPlanningState: "waitingStyleSelection" };
        const m2 = tc.mergeTravelContext(s2, t2);
        const ctx2 = must.mergeContextForPlaceFetch(m2.context, s2);
        const styleTurn = cps.shouldTriggerTripStylePlanning(t2, s2, ctx2);
        const dest2 = must.resolveMustVisitDestination(ctx2, t2) ?? ctx2.destination ?? null;
        geoQueries.length = 0;
        const scope = dest2 ? await ctd.resolveTrustedRecommendationSearchScope({ label: dest2, ctx: ctx2, session: s2, locale: "zh-TW", geocodeFn: geoKR }) : null;
        let wrapper = null;
        if (scope?.status === "trusted") {
          const { c, searchPlaces } = makeCitySearch({ attr: [], museum: [], park: [], food: [], cafe: [], market: [], night: [] }, 10);
          // Andong-like thin inventory
          const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
          pid = 0;
          const g = (name, types, reviews, rating = 4.4, oh) => gPlace({ name, types, reviews, rating, lat: 36.5684, lng: 128.7294, addr: `경상북도 안동시 ${name}`, tag: "and", oh, utc: 540 });
          const inv = { attr: normalizeGooglePlaces([["안동하회마을", 12000], ["월영교", 9000], ["도산서원", 5000], ["병산서원", 3000], ["부용대", 1500]].map(([n, k]) => g(n, ["tourist_attraction", "point_of_interest"], k, 4.6, hours(9 * 60, 18 * 60)))),
            museum: normalizeGooglePlaces([g("안동민속박물관", ["museum", "tourist_attraction"], 1200)]), park: normalizeGooglePlaces([g("태화어린이공원", PARK, 22, 4.1)]),
            food: normalizeGooglePlaces([["안동찜닭 골목 원조", 900], ["옥야식당", 1200], ["맛있는 헛제사밥", 500], ["간고등어 정식", 350], ["신시장 한우", 600], ["하회 손두부", 420]].map(([n, k]) => g(n, ["restaurant", "food"], k))),
            cafe: normalizeGooglePlaces([g("카페 월영", ["cafe", "coffee_shop"], 400), g("안동 한옥카페", ["cafe"], 300)]), market: [], night: [] };
          const real = makeCitySearch(inv, 16);
          const dpr2 = await import("../src/lib/ai/destination-place-recommendation.ts");
          const { createUnifiedSearchPlacesFn } = await import("../src/lib/places-search-unified.ts");
          const unified = createUnifiedSearchPlacesFn(async (a) => real.searchPlaces(a));
          const ctxW = { ...ctx2, destination: scope.destination, planningTripStyle: ctx2.planningTripStyle ?? "mixed", planningDaysConfirmed: true };
          const r = await dpr2.buildDestinationMustVisitRecommendation({ destination: scope.destination, userText: t2, locale: "zh-TW", context: ctxW, searchPlaces: unified, geocodeFn: geoKR, fetchWeatherFn: async () => null, planningSessionId: `tu-e2e-${text}`, trustedCenter: scope.center });
          void c;
          const items = r.dayPlan?.items ?? [];
          wrapper = { serverCalls: real.c.server, expansionCalls: real.c.expansionCalls, dayPlanItems: items.length, days: r.dayPlan?.days ?? 0, recs: r.recommendations?.length ?? 0,
            candidateInsufficient: "candidateInsufficient" in r ? r.candidateInsufficient : "absent", contextPatch: r.contextPatch, summary: String(r.summary ?? "").slice(0, 200) };
        }
        return { turn1: { destination: m1.context.destination ?? null, days: m1.context.days ?? null, destinationType: m1.context.destinationType ?? null, shouldFetchDestinationPlaces: fetch1, mustVisitDestination: mvd },
          turn2: { text: t2, styleTurn, style: ctx2.planningTripStyle ?? null, dest2 },
          trustedScope: scope ? { status: scope.status, reason: scope.reason, destination: scope.destination, centerSource: scope.centerSource, center: scope.center } : null, geocodeCalls: geoQueries.length, wrapper };
      });
    }
    // (d) same-name conflicts at the trusted-scope layer
    const geoCN = async () => ({ location: { placeId: "ChIJgz000000abcdefghijklm", country: "中国", countryCode: "CN", city: "光州", lat: 32.13, lng: 114.9, formattedName: "中国河南省信阳市光州", displayLabel: "光州", timezone: "Asia/Shanghai", utcOffsetMinutes: 480 }, error: null });
    const geoKRg = async () => ({ location: { placeId: "ChIJgwangju00abcdefghijkl", country: "대한민국", countryCode: "KR", city: "광주광역시", lat: 35.1595, lng: 126.8526, formattedName: "대한민국 광주광역시", displayLabel: "광주", timezone: "Asia/Seoul", utcOffsetMinutes: 540 }, error: null });
    for (const [k, label, cc, geo] of [["光州 hint=KR geo=CN", "光州", "KR", geoCN], ["光州 hint=KR geo=KR", "光州", "KR", geoKRg], ["安東 hint=JP geo=KR", "安東", "JP", geoKR], ["光州 noHint geo=CN", "光州", undefined, geoCN]]) {
      progress(`conflict ${k}`);
      R[`conflict|${k}`] = await safe(async () => {
        const ctx = { destination: label, ...(cc ? { destinationCountry: cc } : {}), days: 3, interests: [] };
        const s = await ctd.resolveTrustedRecommendationSearchScope({ label, ctx, session: { travelContext: ctx }, locale: "zh-TW", geocodeFn: geo });
        const gateWithCenter = s.status === "trusted" ? pick(ds.evaluateDestinationScopeGate({ destination: s.destination, countryCode: cc, trustedCenter: s.center })) : null;
        return { status: s.status, reason: s.reason ?? null, destination: s.destination ?? null, center: s.center ?? null, centerSource: s.centerSource ?? null, gateWithCenter };
      });
    }
  }
  R.fetchCalls = fetchCalls;
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TU_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tu-review.mjs";
    for (const f of [self, "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const headHasBudget = /POOL_EXPANSION_QUERY_BUDGET/.test(readFileSync(join(headDir, "src/lib/ai/place-pool-expansion.ts"), "utf8"));
    out(`HEAD snapshot sanity: POOL_EXPANSION_QUERY_BUDGET present=${headHasBudget} (expected false)`);
    const childLimit = Math.max(30, LIMIT - 10);
    const pass = argv.filter((a) => a.startsWith("--city=") || a.startsWith("--style=") || a.startsWith("--k=") || a.startsWith("--k0=") || a.startsWith("--scale=") || a.startsWith("--rev=") || a.startsWith("--core=") || a.startsWith("--trial=") || a === "--diag" || a === "--attr-full");
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", `--only=${ONLY}`, `--limit=${childLimit}`, ...pass], { cwd: headDir, encoding: "utf8", timeout: (childLimit + 15) * 1000, killSignal: "SIGKILL", maxBuffer: 256 << 20 });
    const m = (r.stdout ?? "").match(/@@TU_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    const prog = (r.stderr ?? "").match(/@@P [^\n]*/g) ?? [];
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"} lastProgress=${prog.slice(-1)[0] ?? "-"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: stdout tail=${(r.stdout ?? "").slice(-400)} stderr tail=${(r.stderr ?? "").slice(-600)}`);
  }
  armTimer();
  const WR = await collect();
  const S = (v) => JSON.stringify(v);
  out(`==== section ${ONLY} ${ONLY === "city" ? `${CITY} ${STYLE}` : ""} ====`);
  for (const k of Object.keys(WR)) {
    out(`${k}\n  W=${S(WR[k])}`);
    if (HR) out(`  H=${S(HR[k])}`);
  }
  process.stdout.write("", () => process.exit(0));
}
