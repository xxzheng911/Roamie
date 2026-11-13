import "./verify-netguard-full.mjs";
/**
 * T-Q (tester, independent review). W (working tree) vs H (HEAD via --head-dir).
 *  Q6  ordinary-park tourism gate (evaluateTourismQuality / isLocalNeighborhoodPark) + Busan 4-day planner harness
 *  Q1  kr route fallback: Google call counts / mode order (bound server fn + client-proxy fetch stub, all offline)
 *  Q5  last-entry: isOpenAtScheduled / validatePlaceOpenAtTime / latestArrivalMinutes round trip / recalc flag / card render
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-tq-review-q.mjs -- --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug", "error"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 560s"); process.exit(3); }, 560_000).unref();

// ---- client-proxy fetch stub (installed on top of netguard; sockets stay guarded) ----
let clientCalls = [];
globalThis.fetch = async (input, init) => {
  const s = `${typeof input === "string" ? input : input?.url ?? ""} ${typeof init?.body === "string" ? init.body : ""}`;
  const m = s.match(/TWO_WHEELER|BICYCLE|bicycling|TRANSIT|transit|DRIVE|driving|WALK|walking/);
  clientCalls.push(m ? m[0].toUpperCase().replace("BICYCLING", "BICYCLE").replace("DRIVING", "DRIVE").replace("WALKING", "WALK") : "?");
  throw new Error("offline stub: client proxy");
};

const NAV0 = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const NAV_LANG = { "zh-TW": "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
const setNav = (loc) => {
  if (!loc) { if (NAV0) Object.defineProperty(globalThis, "navigator", NAV0); else delete globalThis.navigator; return; }
  Object.defineProperty(globalThis, "navigator", { value: { language: NAV_LANG[loc], languages: [NAV_LANG[loc]], userAgent: "probe" }, configurable: true, writable: true });
};
const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: String(e?.message ?? e).split("\n")[0].slice(0, 200) }; } };

// ---------------- fixtures ----------------
const hours = (open, close, days = [0, 1, 2, 3, 4, 5, 6]) => ({
  periods: days.map((day) => ({ open: { day, hour: Math.floor(open / 60), minute: open % 60 }, close: { day, hour: Math.floor(close / 60), minute: close % 60 } })),
  weekdayDescriptions: [],
});
let pid = 0;
const gPlace = ({ name, types, rating = 4.4, reviews = 1500, oh = hours(7 * 60, 22 * 60), lat = 35.1796, lng = 129.0756, addr }) => {
  pid += 1;
  const bare = `ChIJbusan${String(pid).padStart(5, "0")}abcdefghijkl`.slice(0, 27);
  return {
    id: `places/${bare}`, placeId: bare, displayName: { text: name }, formattedAddress: addr ?? `부산광역시 ${name} 1`,
    location: { latitude: lat + pid * 0.0007, longitude: lng + pid * 0.0007 }, rating, userRatingCount: reviews,
    primaryType: types[0], types: [...types], regularOpeningHours: oh, utcOffsetMinutes: 540, businessStatus: "OPERATIONAL",
  };
};
const P = (name, types, rating, reviews, address = "") => ({ id: `ChIJgate${name}`, name, address, types, primaryType: types[0], rating, userRatingCount: reviews });
const PARK = ["park", "point_of_interest", "establishment"];
const GATE = [
  ["a 꿈동산공원 (park,4.2,45)", P("꿈동산공원", PARK, 4.2, 45, "부산광역시 부산진구")],
  ["a 꿈동산공원 (park,4.2,79)", P("꿈동산공원", PARK, 4.2, 79, "부산광역시 부산진구")],
  ["b 용두산공원 (park+tourist_attraction,4.3,12000)", P("용두산공원", ["tourist_attraction", "park", "point_of_interest"], 4.3, 12000)],
  ["b 용두산공원 (park only,4.3,12000)", P("용두산공원", PARK, 4.3, 12000)],
  ["b 동백공원 해운대 (park only,4.5,3000)", P("동백공원", PARK, 4.5, 3000, "부산광역시 해운대구 우동")],
  ["b APEC나루공원 (park only,4.5,2100)", P("APEC나루공원", PARK, 4.5, 2100, "부산광역시 해운대구")],
  ["b mid park (park only,4.3,150)", P("민락수변공원", PARK, 4.3, 150)],
  ["b mid park (park only,3.9,250)", P("대신공원", PARK, 3.9, 250)],
  ["c 태백산국립공원 (park,4.6,40)", P("태백산국립공원", PARK, 4.6, 40)],
  ["c 한려해상국립공원 (national_park,4.6,30)", P("한려해상국립공원", ["national_park", "park"], 4.6, 30)],
  ["same tourist_attraction+park (4.3,50)", P("이기대공원", ["tourist_attraction", "park"], 4.3, 50)],
  ["same tourist_attraction+park (4.0,10)", P("송도공원", ["tourist_attraction", "park", "point_of_interest"], 4.0, 10)],
  ["same park+natural_feature (4.2,40)", P("해맞이공원", ["park", "natural_feature"], 4.2, 40)],
  ["d TW 中正公園 (park,4.1,60)", P("中正公園", PARK, 4.1, 60, "台中市北區")],
  ["d TW 仁愛公園 (park,4.3,20)", P("仁愛公園", PARK, 4.3, 20, "台北市大安區")],
  ["d TW 中央公園 (park,4.3,150)", P("中央公園", PARK, 4.3, 150, "高雄市")],
  ["d JP 西町公園 (park,3.9,40)", P("西町公園", PARK, 3.9, 40, "東京都")],
  ["d JP 南公園 (park,4.2,70)", P("南公園", PARK, 4.2, 70, "福岡市")],
  ["d EN Riverside Park (park,4.2,60)", P("Riverside Park", PARK, 4.2, 60, "Taipei")],
  ["d EN Ohori Park (park,4.5,9000)", P("Ohori Park", PARK, 4.5, 9000, "Fukuoka")],
  ["e cafe 소공원커피 (cafe,4.6,300)", P("소공원커피", ["cafe", "food", "point_of_interest"], 4.6, 300)],
  ["e park 발전소공원 (park,4.4,150)", P("당인리발전소공원", PARK, 4.4, 150, "서울특별시 마포구")],
  ["e park 연구소공원 (park,4.1,190)", P("해양연구소공원", PARK, 4.1, 190)],
  ["e restaurant 공원식당 (restaurant,4.5,60)", P("공원식당", ["restaurant", "food"], 4.5, 60)],
  ["e restaurant 공원식당 (restaurant,4.5,500)", P("공원식당", ["restaurant", "food"], 4.5, 500)],
  ["e museum addr 소공원 (museum,4.4,120)", P("부산근대역사관", ["museum", "tourist_attraction"], 4.4, 120, "부산 중구 대청로 소공원 옆")],
  ["e museum name 공원 (museum,4.2,60)", P("공원박물관", ["museum"], 4.2, 60)],
  ["e 어린이대공원 (park+amusement,4.3,9000)", P("부산어린이대공원", ["park", "amusement_park"], 4.3, 9000)],
  ["e 어린이대공원 low (park,4.3,150)", P("성지곡어린이대공원", PARK, 4.3, 150)],
];
const CLASSIC = ["꿈동산공원", "소공원커피", "당인리발전소공원", "용두산공원", "초량어린이공원", "대연근린공원", "부산어린이대공원", "中正公園", "上野公園", "西町児童公園"];

function busanPool(thin) {
  pid = 0;
  const rest = ["쌍둥이돼지국밥", "할매재첩국", "해운대암소갈비집", "초량밀면", "개미집 낙곱새", "거대갈비", "금수복국", "원조할매국밥", "부산명물횟집", "송정3대국수", "광안리 조개구이", "해목", "이재모피자", "가야밀면", "속씨원한대구탕", "남포동 국수"];
  const cafes = ["모모스커피", "블루보틀 부산", "카페 385", "웨이브온 커피", "에테르", "신기산업"];
  const attrsAll = ["감천문화마을", "해동용궁사", "태종대", "해운대해수욕장", "부산 X the SKY", "흰여울문화마을", "송도해상케이블카", "오륙도 스카이워크", "광안리해수욕장", "영도대교", "범어사", "더베이101", "해운대블루라인파크", "청사포 다릿돌전망대"];
  const museums = [["ARTE MUSEUM BUSAN", 10 * 60, 20 * 60], ["국립해양박물관", 9 * 60, 18 * 60], ["부산시립미술관", 10 * 60, 18 * 60]];
  const attrs = thin ? attrsAll.slice(0, 5) : attrsAll;
  const shops = ["신세계 센텀시티", "롯데백화점 광복점", "국제시장", "부평깡통시장", "서면 지하상가", "전포카페거리"];
  const bars = ["더웨이브 바", "광안리 루프탑 바", "해운대 펍", "서면 와인바"];
  const famousParks = [["용두산공원", ["tourist_attraction", "park"], 4.3, 12000], ["APEC나루공원", PARK, 4.5, 2100], ["이기대수변공원", ["park", "natural_feature"], 4.6, 5000]];
  const ordinary = [["꿈동산공원", 4.2, 45], ["초량어린이공원", 4.1, 22], ["대연근린공원", 4.0, 30], ["수민소공원", 4.3, 18], ["망미마을공원", 4.2, 25], ["남천동네공원", 4.1, 35], ["해맞이언덕공원", 4.2, 60]];
  return [
    ...rest.map((n, i) => gPlace({ name: n, types: ["restaurant", "food"], rating: 4.2 + (i % 5) * 0.1, reviews: 300 + i * 40 })),
    ...cafes.map((n) => gPlace({ name: n, types: ["cafe", "coffee_shop"], reviews: 800 })),
    ...attrs.map((n, i) => gPlace({ name: n, types: ["tourist_attraction", "point_of_interest"], rating: 4.4, reviews: 2000 + i * 100 })),
    ...museums.map(([n, o, c]) => gPlace({ name: n, types: ["museum", "tourist_attraction"], rating: 4.5, reviews: 6000, oh: hours(o, c) })),
    ...shops.map((n) => gPlace({ name: n, types: ["shopping_mall"], reviews: 5000 })),
    ...bars.map((n) => gPlace({ name: n, types: ["bar"], reviews: 400, oh: hours(18 * 60, 23 * 60 + 30) })),
    ...famousParks.map(([n, t, r, c]) => gPlace({ name: n, types: t, rating: r, reviews: c })),
    ...ordinary.map(([n, r, c]) => gPlace({ name: n, types: PARK, rating: r, reviews: c })),
  ];
}
const ORDINARY_RE = /꿈동산공원|초량어린이공원|대연근린공원|수민소공원|망미마을공원|남천동네공원|해맞이언덕공원/;

// ---------------- collect ----------------
async function collect() {
  const R = {};
  // ===== Q6 gate =====
  const gate = await import("../src/lib/ai/tourism-quality-gate.ts");
  for (const [k, p] of GATE) R[`G|${k}`] = await safe(() => { const d = gate.evaluateTourismQuality(p); return { ok: d.ok, reason: d.reason ?? null, detail: d.detail ?? null }; });
  const classic = await import("../src/lib/ai/ai-classic-landmark-rules.ts");
  for (const n of CLASSIC) R[`C|${n}`] = await safe(() => classic.isLocalNeighborhoodPark({ id: `ChIJc${n}`, name: n, types: ["park"], primaryType: "park", rating: 4.4, userRatingCount: 3000 }));

  // ===== Q6 planner harness (Busan 4 days) =====
  {
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    const src = await import("../src/lib/ai/ai-day-plan-source.ts");
    const { rankPlacesForTripPlanning } = await import("../src/lib/ai/destination-trip-planning.ts");
    const cp = await import("../src/lib/ai/planning-candidate-pool.ts");
    const { applyQualityGate } = await import("../src/lib/ai/candidate-pool/stages/quality.ts");
    for (const gated of [false, true]) for (const thin of [false, true]) for (const style of ["classic_landmarks", "mixed", "slow_nature", "local_life"]) {
      R[`PL|${gated ? "gated" : "raw"}|${thin ? "thin" : "rich"}|${style}`] = await safe(() => {
        const raw = normalizeGooglePlaces(busanPool(thin));
        const pool = gated ? applyQualityGate(raw, { style }).kept : raw;
        const ranked = rankPlacesForTripPlanning({ places: pool, style, days: 4, context: { interests: [], destination: "부산", days: 4 }, weather: null, lat: 35.1796, lng: 129.0756, profile: null, label: "부산" });
        let plans = src.ensureAllDayPlansExist(ranked.composedPlans, 4);
        let rebuilt = false;
        if (!src.isItineraryRenderable(plans, 4, style)) {
          rebuilt = true;
          const ensured = cp.ensureRenderableStyleDayPlans({ composedPlans: ranked.composedPlans, places: pool, style, label: "부산", days: 4, lat: 35.1796, lng: 129.0756 });
          const rb = cp.rebuildDayPlansFromCandidatePool({ composedPlans: ranked.composedPlans, candidatePool: ensured.candidatePool, style, label: "부산", days: 4, lat: 35.1796, lng: 129.0756 });
          plans = src.preferBetterComposedPlans(src.ensureAllDayPlansExist(rb, 4), plans, 4);
        }
        const perDay = plans.map((p) => p.entries.length);
        const names = plans.flatMap((p) => p.entries.map((e) => e.name));
        return { poolSize: pool.length, poolOrdinary: pool.filter((p) => ORDINARY_RE.test(p.name ?? "")).length, perDay, total: perDay.reduce((a, b) => a + b, 0), renderable: src.isItineraryRenderable(plans, 4, style), rebuilt,
          ordinary: names.filter((n) => ORDINARY_RE.test(n)), parks: names.filter((n) => /공원/.test(n)), scenicPerDay: plans.map((p) => p.entries.filter((e) => /景點|上午|下午|晚上/.test(e.label)).length) };
      });
    }
  }

  // ===== Q1 routes =====
  {
    const { bindRoutesServerFns } = await import("../src/services/routesService.ts");
    const { clearRouteDurationCache } = await import("../src/lib/route-duration-cache.ts");
    const fb = await import("../src/lib/saved-trip/route-duration-fallback.ts");
    let calls = [];
    let respond = () => ({ ok: false, statusCode: 500, message: "unset" });
    const unused = async () => { throw new Error("unused"); };
    bindRoutesServerFns({ computeDuration: async ({ data }) => { calls.push(data.travelMode); return respond(data.travelMode); }, computeDistance: unused, computeTripLegs: unused, computeLegEstimates: unused, testConnection: unused });
    const ok = (m) => ({ ok: true, data: { durationMinutes: m === "TRANSIT" ? 23 : m === "DRIVE" ? 12 : 31, distanceMeters: 2100 } });
    const zero = { ok: false, statusCode: 200, googleStatus: "ZERO_RESULTS", message: "ZERO_RESULTS" };
    const zeroAvail = { ...zero, availableTravelModes: ["TRANSIT"] };
    const RESP = {
      zero: () => zero,
      zeroAvailTransit: () => zeroAvail,
      okTransitOnly: (m) => (m === "TRANSIT" ? ok(m) : zeroAvail),
      okAll: (m) => ok(m),
      rate429: () => ({ ok: false, statusCode: 429, googleStatus: "429", message: "429" }),
    };
    let seq = 0;
    for (const region of ["kr", "jp", "tw", "us"]) for (const mode of ["WALK", "DRIVE", "TRANSIT", "BICYCLE"]) for (const allow of [true, false]) for (const km of [0.8, 6]) for (const [rk, rf] of Object.entries(RESP)) {
      seq += 1;
      clearRouteDurationCache(); calls = []; clientCalls = []; respond = rf;
      const origin = { lat: 35.1 + seq * 0.01, lng: 129.0 };
      const ctx = { scope: { tripId: `t${seq}`, dateKey: "2026-11-20", dayIndex: 0, legIndex: 0, legKey: `a${seq}→b${seq}` }, origin, destination: { lat: origin.lat + km / 111, lng: 129.0 }, query: { region, locationContext: { kr: "대한민국 부산", jp: "日本 京都", tw: "台灣 台北", us: "United States San Francisco" }[region] }, cacheKey: `ck${seq}` };
      R[`RT|${region}|${mode}|${allow ? "auto" : "manual"}|${km}|${rk}`] = await safe(async () => {
        const r = await fb.fetchRouteWithDirectionFallbacks(ctx, mode, { allowModeFallback: allow });
        return { server: [...calls], client: [...clientCalls], result: r };
      });
    }
    // end-to-end through the scoped leg service (manual kr WALK / DRIVE)
    const svc = await safe(() => import("../src/lib/saved-trip/route-duration-service.ts"));
    if (!svc.error) for (const mode of ["WALK", "DRIVE", "TRANSIT"]) for (const allow of [true, false]) {
      seq += 1;
      clearRouteDurationCache(); svc.clearScopedRouteCache?.(); calls = []; clientCalls = []; respond = RESP.okTransitOnly;
      R[`RS|kr|${mode}|${allow ? "auto" : "manual"}`] = await safe(async () => {
        const r = await svc.fetchScopedLegDuration({ scope: { tripId: `s${seq}`, dateKey: "2026-11-20", dayIndex: 0, legIndex: 0, legKey: `x${seq}→y${seq}` }, origin: { lat: 35.15 + seq * 0.01, lng: 129.05 }, destination: { lat: 35.16 + seq * 0.01, lng: 129.06 }, preferredMode: mode, allowModeFallback: allow, query: { region: "kr", locationContext: "대한민국 부산" } });
        return { server: [...calls], client: [...clientCalls], ok: r.ok, routeStatus: r.routeStatus, fallbackReason: r.fallbackReason, resolvedMode: r.resolvedMode, mode: r.mode, durationMinutes: r.durationMinutes };
      });
    }
  }

  // ===== Q5 last entry =====
  {
    const fap = await import("../src/lib/filter-available-places.ts");
    const slot = await import("../src/lib/ai/ai-day-plan-slot-rules.ts");
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    pid = 900;
    const sun1018 = { periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 10, minute: 0 }, close: { day, hour: day === 0 ? 18 : 20, minute: 0 } })), weekdayDescriptions: [] };
    const [arte] = normalizeGooglePlaces([gPlace({ name: "ARTE MUSEUM BUSAN", types: ["museum", "tourist_attraction", "point_of_interest"], rating: 4.6, reviews: 9000, oh: sun1018 })]);
    const [rest21] = normalizeGooglePlaces([gPlace({ name: "해운대암소갈비집", types: ["restaurant", "food"], rating: 4.3, reviews: 3000, oh: hours(11 * 60, 21 * 60) })]);
    const [rest1930] = normalizeGooglePlaces([gPlace({ name: "할매재첩국", types: ["restaurant", "food"], rating: 4.3, reviews: 3000, oh: hours(11 * 60, 19 * 60 + 30) })]);
    const [galleryCafe] = normalizeGooglePlaces([gPlace({ name: "Gallery Cafe Seomyeon", types: ["cafe", "food"], rating: 4.5, reviews: 600, oh: hours(10 * 60, 21 * 60) })]);
    const [park] = normalizeGooglePlaces([gPlace({ name: "용두산공원", types: ["tourist_attraction", "park"], rating: 4.3, reviews: 12000, oh: hours(9 * 60, 22 * 60) })]);
    const [overnight] = normalizeGooglePlaces([gPlace({ name: "Night Museum", types: ["museum"], oh: { periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 18, minute: 0 }, close: { day: (day + 1) % 7, hour: 2, minute: 0 } })), weekdayDescriptions: [] } })]);
    const [h24] = normalizeGooglePlaces([gPlace({ name: "24h Library", types: ["library"], oh: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }], weekdayDescriptions: [] } })]);
    const [noPeriods] = normalizeGooglePlaces([gPlace({ name: "No Hours Museum", types: ["museum"], oh: { weekdayDescriptions: ["월요일: 10:00~18:00"] } })]);
    const [split] = normalizeGooglePlaces([gPlace({ name: "Split Hours Gallery", types: ["art_gallery"], oh: { periods: [0, 1, 2, 3, 4, 5, 6].flatMap((day) => [{ open: { day, hour: 10, minute: 0 }, close: { day, hour: 12, minute: 0 } }, { open: { day, hour: 14, minute: 0 }, close: { day, hour: 20, minute: 0 } }]), weekdayDescriptions: [] } })]);
    R["Q5|norm-hours-kept"] = { arte: Boolean(arte?.regularOpeningHours?.periods?.length), off: arte?.utcOffsetMinutes ?? null, isCulture: slot.isMuseumCulturePlace(arte) };
    const FRI = "2026-11-20"; const SUN = "2026-11-22";
    const V = (p, d, t) => safe(() => slot.validatePlaceOpenAtTime(p, d, t));
    for (const [k, p, d, ts] of [
      ["arte-fri", arte, FRI, ["10:00", "17:30", "18:30", "18:59", "19:00", "19:30", "20:00"]],
      ["arte-sun", arte, SUN, ["16:30", "16:59", "17:00", "17:30"]],
      ["rest21-fri", rest21, FRI, ["19:00", "19:30", "20:00", "20:30", "20:59", "21:00"]],
      ["rest1930-fri", rest1930, FRI, ["18:00", "18:30", "19:00", "19:29", "19:30"]],
      ["galleryCafe-fri", galleryCafe, FRI, ["19:30", "20:00", "20:15", "20:59"]],
      ["park-fri", park, FRI, ["19:00", "21:00", "21:30"]],
      ["split-fri", split, FRI, ["11:30", "18:30", "19:30"]],
    ]) for (const t of ts) R[`V|${k}|${t}`] = await V(p, d, t);
    for (const t of ["10:00", "17:30", "19:00", "19:30"]) R[`S|arte-fri|${t}`] = await safe(() => fap.isOpenAtScheduled(slot.placeHoursDataFromPlace(arte), new Date(`${FRI}T12:00:00`), t, slot.isMuseumCulturePlace(arte) ? 60 : 0));
    for (const t of ["20:30", "21:00"]) R[`S|rest21-fri-default|${t}`] = await safe(() => fap.isOpenAtScheduled(slot.placeHoursDataFromPlace(rest21), new Date(`${FRI}T12:00:00`), t));
    // weekday map + round trip
    R["Q5|weekdayMap"] = await safe(() => ({ arte: slot.latestArrivalByWeekdayForPlace?.(arte) ?? "n/a", rest21: slot.latestArrivalByWeekdayForPlace?.(rest21) ?? "n/a", galleryCafe: slot.latestArrivalByWeekdayForPlace?.(galleryCafe) ?? "n/a", park: slot.latestArrivalByWeekdayForPlace?.(park) ?? "n/a", overnight: slot.latestArrivalByWeekdayForPlace?.(overnight) ?? "n/a", h24: slot.latestArrivalByWeekdayForPlace?.(h24) ?? "n/a", noPeriods: slot.latestArrivalByWeekdayForPlace?.(noPeriods) ?? "n/a", split: slot.latestArrivalByWeekdayForPlace?.(split) ?? "n/a" }));
    const src = await import("../src/lib/ai/ai-day-plan-source.ts");
    const types = await import("../src/lib/ai/types.ts");
    const plan = src.composedPlansToAiDayPlan({ composedPlans: [
      { day: 1, entries: [
        { label: "景點", time: "17:30", name: "ARTE MUSEUM BUSAN", place: arte },
        { label: "晚餐", time: "18:30", name: "해운대암소갈비집", place: rest21 },
        { label: "景點", time: "19:00", name: "Night Museum", place: overnight },
      ] },
      { day: 2, entries: [
        { label: "景點", time: "10:00", name: "24h Library", place: h24 },
        { label: "景點", time: "11:00", name: "No Hours Museum", place: noPeriods },
        { label: "景點", time: "14:00", name: "Split Hours Gallery", place: split },
        { label: "景點", time: "16:00", name: "ARTE MUSEUM BUSAN 2", place: { ...arte, id: `${arte.id}x`, name: "ARTE MUSEUM BUSAN 2" } },
      ] },
    ], destination: "부산", days: 2, planningSessionId: "tq" });
    const built = await safe(() => src.buildItineraryFromDayPlan(plan, { startDate: FRI, endDate: "2026-11-21", dayDates: [FRI, SUN] }));
    const pick = (arr) => Array.isArray(arr) ? arr.map((i) => ({ t: i.placeName ?? i.title, date: i.date, has: Object.prototype.hasOwnProperty.call(i, "latestArrivalMinutes"), v: i.latestArrivalMinutes ?? null })) : arr;
    R["Q5|built"] = pick(built);
    if (Array.isArray(built)) {
      const parsed = await safe(() => types.RoamieResponseSchema.parse({ title: "t", summary: "s", moodTag: "m", recommendations: [], itinerary: built }).itinerary);
      R["Q5|parsed"] = pick(parsed);
      R["Q5|renormalized"] = Array.isArray(parsed) ? pick(parsed.map((i) => types.normalizeItineraryItem(i))) : parsed;
      const json = await safe(() => types.RoamieResponseSchema.parse(JSON.parse(JSON.stringify({ title: "t", summary: "s", moodTag: "m", recommendations: [], itinerary: built }))).itinerary);
      R["Q5|jsonRoundTrip"] = pick(json);
    }
    // recalc
    const rc = await import("../src/lib/saved-trip/recalculate-arrival-times.ts");
    const { buildDayLegKey } = await import("../src/lib/transit/types.ts");
    const mk = (name, extra = {}) => types.normalizeItineraryItem({ date: FRI, time: "10:00", title: name, placeName: name, localizedDisplayName: name, ...extra });
    const A = mk("감천문화마을"); const B = mk("해동용궁사"); const ARTE = mk("ARTE MUSEUM BUSAN", { latestArrivalMinutes: 1140 }); const D = mk("해운대암소갈비집", { latestArrivalMinutes: 1260 });
    const leg = (m) => ({ durationMinutes: m, routeStatus: "ok", transportStatus: "ok", resolvedMode: "DRIVE", transportMode: "DRIVE", requestedMode: "DRIVE" });
    const settingsFor = (bToArte, arteToD = 20) => ({ startTime: "10:00", legMinutes: { [B.placeName]: 360 }, defaultTransportLabel: "租車自駕",
      transitLegs: { [buildDayLegKey(FRI, A.placeName, B.placeName)]: leg(30), [buildDayLegKey(FRI, B.placeName, ARTE.placeName)]: leg(bToArte), [buildDayLegKey(FRI, ARTE.placeName, D.placeName)]: leg(arteToD) } });
    const rows = (arr) => arr.map((i) => `${i.placeName}@${i.time}${i.arrivedAfterLastEntry === undefined ? "" : i.arrivedAfterLastEntry ? "!LATE" : "!ok"}`);
    R["RC|19:17"] = await safe(() => rows(rc.recalculateArrivalTimesForDay([A, B, ARTE, D], settingsFor(107), FRI, 0)));
    R["RC|18:30"] = await safe(() => rows(rc.recalculateArrivalTimesForDay([A, B, ARTE, D], settingsFor(60), FRI, 0)));
    R["RC|restLate"] = await safe(() => rows(rc.recalculateArrivalTimesForDay([A, B, ARTE, D], settingsFor(60, 120), FRI, 0)));
    const legacy = [A, B, mk("ARTE MUSEUM BUSAN"), mk("해운대암소갈비집")];
    R["RC|legacy"] = await safe(() => rows(rc.recalculateArrivalTimesForDay(legacy, settingsFor(107), FRI, 0)));
    R["RC|earlyReturnLast"] = await safe(() => rows(rc.recalculateArrivalTimesForDay([A, B, D, { ...ARTE, time: "19:30" }], settingsFor(60), FRI, 3)));
    R["RC|earlyReturnLastOk"] = await safe(() => rows(rc.recalculateArrivalTimesForDay([A, B, D, { ...ARTE, time: "18:00" }], settingsFor(60), FRI, 3)));
    R["RC|anchorMid"] = await safe(() => rows(rc.recalculateArrivalTimesForDay([A, { ...B, time: "17:00" }, ARTE, D], settingsFor(107), FRI, 1)));
    R["RC|staleFlagCleared"] = await safe(() => rows(rc.recalculateArrivalTimesForDay([A, B, { ...ARTE, arrivedAfterLastEntry: true }, D], settingsFor(60), FRI, 0)));
    R["RC|all"] = await safe(() => rows(rc.recalculateAllArrivalTimes([A, B, ARTE, D], settingsFor(107))));
    // preserve branch (no usable leg durations)
    const sync = await safe(() => import("../src/lib/saved-trip/apply-transit-leg-sync.ts"));
    if (!sync.error) {
      const noLegs = { startTime: "10:00", legMinutes: { [B.placeName]: 360 }, defaultTransportLabel: "大眾運輸" };
      const failed = { [buildDayLegKey(FRI, A.placeName, B.placeName)]: { durationMinutes: 0, routeStatus: "failed", transportStatus: "failed" } };
      R["SY|preserve-fresh"] = await safe(() => rows(sync.applyTransitLegSyncToItems({ itemsBefore: [A, B, { ...ARTE, time: "19:17" }, D], itemsWithCoords: [A, B, { ...ARTE, time: "19:17" }, D], settings: noLegs, transitLegs: failed }).items));
      R["SY|preserve-staleTrue"] = await safe(() => rows(sync.applyTransitLegSyncToItems({ itemsBefore: [A, B, { ...ARTE, time: "18:00" }, D], itemsWithCoords: [A, B, { ...ARTE, time: "18:00", arrivedAfterLastEntry: true }, D], settings: noLegs, transitLegs: failed }).items));
    }
    // cross-day move keeps Friday latestArrivalMinutes on a Sunday (close 18:00)
    const mut = await import("../src/lib/trip/trip-stop-mutations.ts");
    R["MV|crossDay"] = await safe(() => {
      const items = [A, B, ARTE, D, { ...mk("범어사"), date: SUN }];
      const moved = mut.moveStopAcrossDays(items, FRI, 2, SUN, { kind: "end" }, 0, 1);
      const m = moved.find((i) => i.placeName === "ARTE MUSEUM BUSAN");
      return { date: m?.date, latestArrivalMinutes: m?.latestArrivalMinutes ?? null, sundayCorrect: 17 * 60 };
    });
    // card render (SSR) x 4 locales
    R["CARD"] = await safe(async () => {
      const { createElement } = await import("react");
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { I18nProvider } = await import("../src/hooks/use-i18n.tsx");
      const { TripPlaceCard } = await import("../src/components/saved/TripPlaceCard.tsx");
      const { translate } = await import("../src/lib/i18n/translate.ts");
      const res = {};
      for (const loc of ["zh-TW", "en", "ja", "ko"]) {
        setNav(loc);
        const copy = translate(loc, "saved.mayBePastLastEntry");
        const render = (flag) => renderToStaticMarkup(createElement(I18nProvider, null, createElement(TripPlaceCard, { item: { ...ARTE, time: "19:17", ...(flag === undefined ? {} : { arrivedAfterLastEntry: flag }) }, indexInDay: 2, dayCount: 4, settings: {}, onSetArrivalTime() {}, onSetDurationMinutes() {}, onMoveUp() {}, onMoveDown() {}, onDelete() {} })));
        const h = { t: render(true), f: render(false), u: render(undefined) };
        res[loc] = { copy, keyMissing: copy === "saved.mayBePastLastEntry" || !copy, trueHas: h.t.includes(copy), falseHas: h.f.includes(copy), undefHas: h.u.includes(copy), rawKeyLeak: h.t.includes("saved.mayBePastLastEntry") };
      }
      setNav(null);
      return res;
    });
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TQ_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tq-review-q.mjs";
    for (const f of [self, "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 280_000, maxBuffer: 256 << 20 });
    const m = (r.stdout ?? "").match(/@@TQ_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-800)}`);
  }
  const WR = await collect();
  const H = (k) => (HR ? HR[k] : "n/a");
  const S = (v) => JSON.stringify(v);
  const failures = [];
  const SHOW = argv.find((a) => a.startsWith("--show="))?.slice(7).split(",");
  let CUR = "";
  const pr = (...a) => { if (!SHOW || SHOW.includes(CUR)) out(...a); };
  const fail = (k, m) => { failures.push(k); pr(`FAIL ${k}: ${m}`); };

  CUR = "gate"; pr("==== Q6 gate: evaluateTourismQuality (W | H) ====");
  for (const [k] of GATE) pr(`${k.padEnd(48)} W=${S(WR[`G|${k}`])} H=${S(H(`G|${k}`))}`);
  const gok = (k, R) => R?.[`G|${k}`]?.ok;
  if (gok(GATE[0][0], WR) !== false) fail("Q6a", "꿈동산공원 not rejected in W");
  if (HR && gok(GATE[0][0], HR) !== true) fail("Q6a-head", "꿈동산공원 not passing in HEAD (cannot show diff)");
  for (const [k] of GATE.filter(([k]) => /^b /.test(k) && !/3\.9,250|4\.3,150/.test(k))) if (gok(k, WR) !== true) fail(`Q6b ${k}`, "famous park rejected");
  for (const [k] of GATE.filter(([k]) => /^c /.test(k))) if (gok(k, WR) !== true) fail(`Q6c ${k}`, "national park rejected");
  for (const [k] of GATE.filter(([k]) => /^same /.test(k))) if (HR && gok(k, WR) !== gok(k, HR)) fail(`Q6same ${k}`, "tourist_attraction+park behaviour changed");
  for (const [k] of GATE.filter(([k]) => /^e /.test(k))) if (HR && gok(k, WR) !== gok(k, HR)) fail(`Q6e ${k}`, `non-ordinary place verdict changed W=${gok(k, WR)} H=${gok(k, HR)}`);
  CUR = "classic"; pr("==== Q6 classic isLocalNeighborhoodPark (W | H) ====");
  for (const n of CLASSIC) pr(`${n.padEnd(16)} W=${S(WR[`C|${n}`])} H=${S(H(`C|${n}`))}`);
  if (HR && WR["C|당인리발전소공원"] !== HR["C|당인리발전소공원"]) fail("Q6e-classic 당인리발전소공원", "substring 소공원 flips classic local-park");
  if (HR && WR["C|소공원커피"] !== HR["C|소공원커피"]) fail("Q6e-classic 소공원커피", "substring 소공원 flips classic local-park");
  CUR = "planner"; pr("==== Q6 planner harness: Busan 4 days (W | H) ====");
  for (const k of Object.keys(WR).filter((k) => k.startsWith("PL|"))) {
    const w = WR[k]; const h = H(k);
    const c = (x) => (!x || x.error ? S(x) : `pool=${x.poolSize}(ordinary ${x.poolOrdinary}) perDay=${x.perDay} total=${x.total} renderable=${x.renderable} rebuilt=${x.rebuilt} ordinary=[${x.ordinary}] parks=[${x.parks}]`);
    pr(`${k}\n     W ${c(w)}\n     H ${c(h)}`);
    if (w?.error) { fail(k, `W error ${w.error}`); continue; }
    if (w.ordinary.length && k.startsWith("PL|gated|")) fail(`${k}#ordinary`, `ordinary park still scheduled after gate: ${w.ordinary}`);
    if (w.perDay.some((n) => n === 0)) fail(`${k}#emptyDay`, `empty day ${w.perDay}`);
    if (h && !h.error && h.perDay) {
      for (let d = 0; d < 4; d++) if (w.perDay[d] < h.perDay[d] - 1) fail(`${k}#day${d + 1}`, `stops dropped by >1: W=${w.perDay[d]} H=${h.perDay[d]}`);
      if (h.renderable && !w.renderable) fail(`${k}#renderable`, "renderable in HEAD, not in W");
    }
  }

  CUR = "routes"; pr("==== Q1 routes (server calls + client-proxy calls) ====");
  const rtKeys = Object.keys(WR).filter((k) => k.startsWith("RT|"));
  let shown = 0;
  for (const k of rtKeys) {
    const w = WR[k]; const h = H(k);
    const [, region, mode, how, , rk] = k.split("|");
    if (w?.error) { fail(k, `W error ${w.error}`); continue; }
    const wAll = [...w.server, ...w.client];
    const hAll = h && !h.error ? [...h.server, ...h.client] : null;
    const sameResult = h && !h.error ? S(w.result) === S(h.result) : null;
    if (region === "kr") {
      if (wAll.some((m) => m !== "TRANSIT")) fail(k, `kr non-TRANSIT call ${wAll}`);
      if (how === "manual" && mode !== "TRANSIT" && wAll.length !== 0) fail(k, `kr manual ${mode} made ${wAll.length} calls`);
      if (how === "manual" && mode !== "TRANSIT" && h && !h.error && rk !== "okAll" && rk !== "rate429" && !sameResult) fail(`${k}#result`, `manual result differs W=${S(w.result)} H=${S(h.result)}`);
      // BICYCLE auto: W intentionally adds one TRANSIT try (route-duration-fallback.ts:468); reported as a behaviour change, not a failure.
      if (how === "auto" && mode === "BICYCLE" && !sameResult) pr(`  NOTE ${k}: intentional change W=${w.result.ok ? `ok ${w.result.resolvedMode}` : `fail ${w.result.fallbackReason}`} H=${h?.result?.ok ? `ok ${h.result.resolvedMode}` : `fail ${h?.result?.fallbackReason}`}`);
      else if (how === "auto" && ["zero", "zeroAvailTransit", "okTransitOnly"].includes(rk) && h && !h.error && !sameResult) fail(`${k}#result`, `auto result differs W=${S(w.result).slice(0, 300)} H=${S(h.result).slice(0, 300)}`);
    } else if (h && !h.error) {
      if (S(w.server) !== S(h.server) || S(w.client) !== S(h.client) || !sameResult) fail(k, `non-kr behaviour changed W=${S(wAll)} H=${S(hAll)}`);
    }
    if (region === "kr" && (shown++ < 400)) {
      if ((rk === "okTransitOnly" || rk === "okAll") && k.includes("|0.8|")) pr(`${k.padEnd(42)} W calls=${S(w.server)}+client${S(w.client)} res=${w.result.ok ? `ok ${w.result.resolvedMode} ${w.result.durationMinutes}m` : `fail ${w.result.fallbackReason}/${w.result.routeStatus}`} | H calls=${hAll ? `${S(h.server)}+client${S(h.client)}` : "n/a"} res=${h?.result ? (h.result.ok ? `ok ${h.result.resolvedMode} ${h.result.durationMinutes}m` : `fail ${h.result.fallbackReason}/${h.result.routeStatus}`) : "n/a"} same=${sameResult}`);
    }
  }
  const nonKr = rtKeys.filter((k) => !k.startsWith("RT|kr|"));
  pr(`non-kr cases=${nonKr.length} identical(calls+result)=${nonKr.filter((k) => { const w = WR[k]; const h = H(k); return h && !h.error && S(w.server) === S(h.server) && S(w.client) === S(h.client) && S(w.result) === S(h.result); }).length}`);
  const sumCalls = (R, pre) => R ? Object.keys(R).filter((k) => k.startsWith(pre)).reduce((a, k) => a + (R[k]?.server?.length ?? 0) + (R[k]?.client?.length ?? 0), 0) : "n/a";
  for (const pre of ["RT|kr|", "RT|jp|", "RT|tw|", "RT|us|"]) pr(`total Google calls ${pre.padEnd(7)} W=${sumCalls(WR, pre)} H=${sumCalls(HR, pre)}`);
  for (const k of Object.keys(WR).filter((k) => k.startsWith("RS|"))) pr(`${k.padEnd(22)} W=${S(WR[k])}\n  ${"".padEnd(22)} H=${S(H(k))}`);

  CUR = "q5"; pr("==== Q5 last entry ====");
  pr(`norm W=${S(WR["Q5|norm-hours-kept"])} H=${S(H("Q5|norm-hours-kept"))}`);
  for (const k of Object.keys(WR).filter((k) => k.startsWith("V|") || k.startsWith("S|"))) pr(`${k.padEnd(28)} W=${S(WR[k])} H=${S(H(k))}`);
  if (WR["V|arte-fri|19:00"] !== false) fail("Q5a 19:00", "ARTE 19:00 not rejected");
  if (WR["V|arte-fri|17:30"] !== true) fail("Q5a 17:30", "ARTE 17:30 rejected");
  if (WR["V|arte-sun|17:00"] !== false || WR["V|arte-sun|16:59"] !== true) fail("Q5a sun", "Sunday last entry 17:00 wrong");
  for (const k of Object.keys(WR).filter((k) => /^V\|(rest21|rest1930|park)/.test(k))) if (HR && WR[k] !== HR[k]) fail(`Q5b ${k}`, `non-culture changed W=${WR[k]} H=${HR[k]}`);
  for (const k of Object.keys(WR).filter((k) => /^V\|galleryCafe/.test(k))) if (HR && WR[k] !== HR[k]) fail(`Q5b-cafe ${k}`, `cafe named "Gallery" treated as culture W=${WR[k]} H=${HR[k]}`);
  pr(`weekdayMap W=${S(WR["Q5|weekdayMap"])}`);
  for (const k of ["Q5|built", "Q5|parsed", "Q5|renormalized", "Q5|jsonRoundTrip"]) pr(`${k.padEnd(18)} W=${S(WR[k])}\n  ${"".padEnd(18)} H=${S(H(k))}`);
  // built order (sorted by day/time): 0 ARTE Fri, 1 restaurant, 2 overnight, 3 24h, 4 no periods, 5 split, 6 ARTE Sun
  const atB = (k, i) => (Array.isArray(WR[k]) ? WR[k][i] : null);
  for (const k of ["Q5|built", "Q5|parsed", "Q5|renormalized", "Q5|jsonRoundTrip"]) {
    if (atB(k, 0)?.v !== 1140) fail(`Q5c ${k}`, "ARTE Fri latestArrivalMinutes != 1140");
    if (atB(k, 6)?.v !== 1020 || atB(k, 6)?.date !== "2026-11-22") fail(`Q5c ${k} sun`, `ARTE Sun latestArrivalMinutes != 1020: ${S(atB(k, 6))}`);
    for (const i of [2, 3, 4, 5]) if (atB(k, i)?.has) fail(`Q5g ${k} #${i}`, `field written: ${S(atB(k, i))}`);
    if (atB(k, 1)?.has) fail(`Q5-scope ${k}`, `restaurant gets latestArrivalMinutes=${atB(k, 1)?.v} (spec: culture only / other categories unchanged)`);
  }
  for (const k of Object.keys(WR).filter((k) => k.startsWith("RC|") || k.startsWith("SY|") || k.startsWith("MV|"))) pr(`${k.padEnd(22)} W=${S(WR[k])}\n  ${"".padEnd(22)} H=${S(H(k))}`);
  const has = (k, s) => Array.isArray(WR[k]) && WR[k].some((r) => r === s);
  if (!has("RC|19:17", "ARTE MUSEUM BUSAN@19:17!LATE")) fail("Q5d 19:17", S(WR["RC|19:17"]));
  if (!has("RC|18:30", "ARTE MUSEUM BUSAN@18:30!ok")) fail("Q5d 18:30", S(WR["RC|18:30"]));
  if (Array.isArray(WR["RC|legacy"]) && WR["RC|legacy"].some((r) => r.includes("!"))) fail("Q5d legacy", S(WR["RC|legacy"]));
  if (!has("RC|earlyReturnLast", "ARTE MUSEUM BUSAN@19:30!LATE")) fail("Q5e early return", S(WR["RC|earlyReturnLast"]));
  if (!has("RC|staleFlagCleared", "ARTE MUSEUM BUSAN@18:30!ok")) fail("Q5 stale flag", S(WR["RC|staleFlagCleared"]));
  if (Array.isArray(WR["RC|restLate"]) && WR["RC|restLate"].some((r) => /해운대암소갈비집@.*!LATE/.test(r))) fail("Q5-scope restaurant card", `restaurant flagged as past last admission: ${S(WR["RC|restLate"])}`);
  if (Array.isArray(WR["SY|preserve-staleTrue"]) && WR["SY|preserve-staleTrue"].some((r) => r === "ARTE MUSEUM BUSAN@18:00!LATE")) fail("Q5 risk2 preserve", "flag LATE kept with time 18:00 in preserve branch");
  if (WR["MV|crossDay"]?.latestArrivalMinutes === 1140) fail("Q5 cross-day stale", `moved to Sunday keeps Friday limit 1140 (Sunday should be 1020) ${S(WR["MV|crossDay"])}`);
  pr(`CARD W=${S(WR.CARD)}\n  CARD H=${S(H("CARD"))}`);
  if (WR.CARD?.error) fail("Q5f card", WR.CARD.error);
  else for (const [loc, c] of Object.entries(WR.CARD)) if (c.keyMissing || !c.trueHas || c.falseHas || c.undefHas || c.rawKeyLeak) fail(`Q5f card ${loc}`, S(c));

  out(`\nSUMMARY failures=${failures.length}${failures.length ? `\n  - ${failures.join("\n  - ")}` : ""}`);
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
