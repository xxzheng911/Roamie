import "./verify-netguard-full.mjs";
/**
 * T-R (tester, independent review). W (working tree) vs H (HEAD via --head-dir, d27 convention).
 * Complements scripts/verify-tq-review-q.mjs:
 *  Q6s  park gate spec cases        RG   resolveDirectionsRegion
 *  Q1b  server trip legs call count  QK   Naver button decision / URL / i18n / connector render
 *  Q5x  last-entry (c)(f)(g)(i)      QW   2.5 forecast first-day rule
 *  Q7   community filter / extra title / extra min / risk 3 / call counts
 *  TH   thin-city 4-day planner (generateTripPlanFromStyle + chat wrapper), mocked search
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-tr-review.mjs -- --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const SKIP = (argv.find((a) => a.startsWith("--skip="))?.slice(7) ?? "").split(",").filter(Boolean);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug", "error"]) console[k] = () => {};
// Server Google provider entries: one [ROUTE_REQUEST_DIAGNOSTIC] per request that reached
// fetchGoogleRestProvider (stops at missing_principal offline; in production it would bill).
let diagCalls = [];
console.warn = (...a) => { if (a[0] === "[ROUTE_REQUEST_DIAGNOSTIC]") { try { diagCalls.push(JSON.parse(a[1]).routeFamily); } catch { diagCalls.push("?"); } } };
setTimeout(() => { out("FAIL internal watchdog 570s"); process.exit(3); }, 570_000).unref();

// ---- fetch stub on top of netguard (sockets stay guarded); records every call ----
let fetchCalls = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const body = typeof init?.body === "string" ? init.body : "";
  const m = `${url} ${body}`.match(/"travelMode":"([A-Z_]+)"|mode=([a-z]+)/);
  fetchCalls.push({ host: url.replace(/^https?:\/\/([^/]+).*$/, "$1"), mode: m ? (m[1] ?? m[2]) : "?" });
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};

const NAV0 = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const NAV_LANG = { "zh-TW": "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
const setNav = (loc) => {
  if (!loc) { if (NAV0) Object.defineProperty(globalThis, "navigator", NAV0); else delete globalThis.navigator; return; }
  Object.defineProperty(globalThis, "navigator", { value: { language: NAV_LANG[loc], languages: [NAV_LANG[loc]], userAgent: "probe" }, configurable: true, writable: true });
};
const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: String(e?.message ?? e).split("\n")[0].slice(0, 220) }; } };

// ---------------- fixtures ----------------
const hours = (open, close, days = [0, 1, 2, 3, 4, 5, 6]) => ({
  periods: days.map((day) => ({ open: { day, hour: Math.floor(open / 60), minute: open % 60 }, close: { day, hour: Math.floor(close / 60), minute: close % 60 } })),
  weekdayDescriptions: [],
});
let pid = 0;
const gPlace = ({ name, types, rating = 4.4, reviews = 1500, oh = hours(7 * 60, 22 * 60), lat, lng, addr, tag = "x" }) => {
  pid += 1;
  const bare = `ChIJ${tag}${String(pid).padStart(5, "0")}abcdefghijklmnop`.slice(0, 27);
  return {
    id: `places/${bare}`, placeId: bare, displayName: { text: name }, formattedAddress: addr ?? `${name} 1`,
    location: { latitude: lat + pid * 0.0009, longitude: lng + pid * 0.0011 }, rating, userRatingCount: reviews,
    primaryType: types[0], types: [...types], regularOpeningHours: oh, utcOffsetMinutes: 540, businessStatus: "OPERATIONAL",
  };
};
const P = (name, types, rating, reviews, address = "") => ({ id: `ChIJgate${name}`, name, address, types, primaryType: types[0], rating, userRatingCount: reviews });
const PARK = ["park", "point_of_interest", "establishment"];
const GATE = [
  ["block 꿈동산공원 park 4.2/45", P("꿈동산공원", PARK, 4.2, 45, "부산광역시 부산진구"), false],
  ["block 충무로 소공원 park 4.0/30", P("충무로 소공원", PARK, 4.0, 30, "서울특별시 중구"), false],
  ["block 성지어린이공원 park 4.3/150", P("성지어린이공원", PARK, 4.3, 150), false],
  ["pass famous 4.0/200 park only", P("삼락생태공원", PARK, 4.0, 200), true],
  ["pass famous 4.5/3000 동백공원", P("동백공원", PARK, 4.5, 3000, "부산광역시 해운대구"), true],
  ["pass famous 4.0/200 named 근린공원", P("대연근린공원", PARK, 4.0, 200), true],
  ["pass 지리산국립공원 park 4.7/30", P("지리산국립공원", PARK, 4.7, 30), true],
  ["pass 북한산국립공원 national_park 4.6/20", P("북한산국립공원", ["national_park", "park"], 4.6, 20), true],
  ["same TA+park 4.3/50", P("이기대공원", ["tourist_attraction", "park"], 4.3, 50), "same"],
  ["same TA+park 3.9/10", P("송도공원", ["tourist_attraction", "park", "point_of_interest"], 3.9, 10), "same"],
  ["same TA+park name 소공원 4.1/40", P("수민소공원", ["tourist_attraction", "park"], 4.1, 40), "same"],
  ["notblock cafe 공원커피 4.5/50", P("공원커피", ["cafe", "food", "point_of_interest"], 4.5, 50), true],
  ["notblock cafe 소공원 카페 4.3/30", P("소공원 카페", ["cafe", "coffee_shop"], 4.3, 30), true],
  ["notblock cafe 소공원커피 4.6/300", P("소공원커피", ["cafe", "food"], 4.6, 300), true],
  ["notblock restaurant 공원식당 4.2/20", P("공원식당", ["restaurant", "food"], 4.2, 20), true],
  ["notblock restaurant 소공원 국밥 4.1/15", P("소공원 국밥", ["restaurant", "food"], 4.1, 15), true],
  ["notblock 당인리발전소공원 park 4.4/80", P("당인리발전소공원", PARK, 4.4, 80, "서울특별시 마포구"), true],
  ["notblock 발전소공원 park 4.4/150", P("발전소공원", PARK, 4.4, 150), true],
  ["notblock 해양연구소공원 park 4.1/80", P("해양연구소공원", PARK, 4.1, 80), true],
  ["info 발전소공원 park 4.4/79", P("발전소공원", PARK, 4.4, 79), "info"],
];
const CLASSIC = [
  ["cafe 소공원커피", { name: "소공원커피", types: ["cafe", "food"], primaryType: "cafe" }],
  ["restaurant 공원식당", { name: "공원식당", types: ["restaurant", "food"], primaryType: "restaurant" }],
  ["cafe 소공원 카페", { name: "소공원 카페", types: ["cafe"], primaryType: "cafe" }],
  ["park 당인리발전소공원", { name: "당인리발전소공원", types: ["park"], primaryType: "park" }],
  ["park 해양연구소공원", { name: "해양연구소공원", types: ["park"], primaryType: "park" }],
  ["park 초량어린이공원", { name: "초량어린이공원", types: ["park"], primaryType: "park" }],
  ["park 충무로 소공원", { name: "충무로 소공원", types: ["park"], primaryType: "park" }],
];
const REGION = [
  ["南韓", "kr"], ["한국", "kr"], ["대한민국", "kr"], ["서울", "kr"], ["부산", "kr"], ["제주", "kr"], ["韩国", "kr"], ["首尔", "kr"], ["韓国", "kr"], ["ソウル", "kr"], ["プサン", "kr"],
  ["대한민국 부산광역시", "kr"], ["South Korea", "kr"], ["韓國", "kr"],
  ["日本", "jp"], ["東京", "jp"], ["東京都", "jp"], ["大阪府大阪市", "jp"], ["京都市", "jp"], ["福岡県福岡市", "jp"], ["日本 北海道札幌市", "jp"], ["Japan", "jp"],
  ["台灣", "tw"], ["臺灣", "tw"], ["台北市", "tw"], ["Taiwan", "tw"], ["高雄", "tw"],
];

// ---------------- collect ----------------
async function collect() {
  const R = {};
  const on = (k) => !SKIP.includes(k);

  // ===== Q6 spec =====
  if (on("q6")) {
    const gate = await import("../src/lib/ai/tourism-quality-gate.ts");
    for (const [k, p] of GATE) R[`G|${k}`] = await safe(() => gate.evaluateTourismQuality(p).ok);
    const classic = await import("../src/lib/ai/ai-classic-landmark-rules.ts");
    for (const [k, p] of CLASSIC) R[`C|${k}`] = await safe(() => classic.isLocalNeighborhoodPark({ id: `ChIJc${p.name}`, rating: 4.4, userRatingCount: 300, ...p }));
  }

  // ===== region =====
  if (on("rg")) {
    const de = await import("../src/lib/directions-endpoint.ts");
    for (const [s] of REGION) R[`RG|${s}`] = await safe(() => de.resolveDirectionsRegion(s));
  }

  // ===== Q1b server trip legs =====
  if (on("q1b")) {
    const srv = await safe(() => import("../src/lib/google-routes.server.ts"));
    if (srv.error) R["Q1b|import"] = srv;
    else {
      let seq = 0;
      for (const region of ["kr", "jp", "tw", undefined]) for (const mode of ["WALK", "DRIVE", "TRANSIT", "BICYCLE"]) {
        seq += 1;
        const base = 35 + seq * 0.05;
        const places = [0, 1, 2].map((i) => ({ lat: base + i * 0.01, lng: 129 + i * 0.01 }));
        fetchCalls = []; diagCalls = [];
        const r = await safe(() => srv.getTripLegsWithDurations(places, mode, region));
        R[`Q1b|${region ?? "none"}|${mode}`] = { calls: diagCalls.length + fetchCalls.length, families: [...new Set(diagCalls)], result: r.error ? r : { ok: r.ok, legs: r.data?.map((l) => `${l.travelMode}:${l.durationMinutes}/${l.distanceMeters}`) } };
      }
    }
    // client service passes region through to the server fn
    const svc = await import("../src/services/routesService.ts");
    const seen = [];
    const unused = async () => { throw new Error("unused"); };
    svc.bindRoutesServerFns({ computeDuration: unused, computeDistance: unused, computeLegEstimates: unused, testConnection: unused,
      computeTripLegs: async ({ data }) => { seen.push({ region: data.region ?? null, mode: data.travelMode }); return { ok: true, data: data.places.slice(1).map(() => ({ durationMinutes: 0, distanceMeters: 0 })) }; } });
    for (const region of ["kr", "jp", undefined]) {
      await safe(() => svc.getTripLegsWithDurations([{ lat: 37.1 + seen.length, lng: 127 }, { lat: 37.2 + seen.length, lng: 127.1 }], "WALK", region));
    }
    R["Q1b|clientRegion"] = seen;
    // chat call site resolves region from tripDestination.country / formattedName
    const de = await import("../src/lib/directions-endpoint.ts");
    R["Q1b|chatRegion"] = Object.fromEntries(["韓國", "South Korea", "대한민국", "부산광역시, 대한민국", "韓国", "日本", "台灣", "부산"].map((s) => [s, de.resolveDirectionsRegion(s)]));
    // chat-enrichment legs (kr skipped) -> saved legs -> Naver decision
    const tl = await import("../src/lib/saved-trip/saved-trip-transit-legs.ts");
    const kr = await safe(() => import("../src/lib/saved-trip/korea-route-maps.ts"));
    const stops = [{ placeName: "감천문화마을", lat: 35.097, lng: 129.010 }, { placeName: "태종대", lat: 35.053, lng: 129.087 }];
    const legs = tl.buildSavedTripTransitLegs(stops, [{ durationMinutes: 0, distanceMeters: 0 }], "WALK");
    const leg = Object.values(legs)[0];
    R["Q1b|savedLeg"] = { routeStatus: leg.routeStatus, durationMinutes: leg.durationMinutes, naverWalk: kr.error ? "n/a" : kr.koreaNaverModeForLeg("kr", leg, "步行"), naverDrive: kr.error ? "n/a" : kr.koreaNaverModeForLeg("kr", { ...leg, requestedMode: "DRIVE" }, "租車自駕") };
  }

  // ===== QK =====
  if (on("qk")) {
    const kr = await safe(() => import("../src/lib/saved-trip/korea-route-maps.ts"));
    if (kr.error) R["QK|import"] = kr;
    else {
      const leg = (s) => ({ routeStatus: s, transportStatus: s, durationMinutes: 0 });
      for (const region of ["kr", "jp", "tw"]) for (const st of ["failed", "mode_unavailable", "transit_unavailable", "ok"]) for (const label of ["步行", "租車自駕", "大眾運輸", "機車"]) {
        R[`QK|${region}|${st}|${label}`] = kr.koreaNaverModeForLeg(region, leg(st), label);
      }
      R["QK|noLeg"] = kr.koreaNaverModeForLeg("kr", undefined, "步行");
      R["QK|url"] = {
        walk: kr.buildNaverDirectionsUrl({ lat: 35.0975, lng: 129.0106 }, "감천문화마을", { lat: 35.0532, lng: 129.0873 }, "태종대", "walk"),
        car: kr.buildNaverDirectionsUrl({ lat: 35.1, lng: 129.0 }, "A, B & C", { lat: 35.2, lng: 129.1 }, "ARTE MUSEUM BUSAN", "car"),
      };
    }
    const jp = await import("../src/lib/saved-trip/japan-transit-maps.ts");
    for (const [k, l, lab] of [["deeplink-transit", { transitUnavailableProvider: "google_maps_deeplink" }, "大眾運輸"], ["deeplink-walk", { transitUnavailableProvider: "google_maps_deeplink" }, "步行"], ["none-transit", { transitUnavailableProvider: null }, "大眾運輸"]]) {
      R[`QK|jp|${k}`] = jp.isJapanTransitMapsLeg(l, lab);
    }
    const { translate } = await import("../src/lib/i18n/translate.ts");
    for (const loc of ["zh-TW", "en", "ja", "ko"]) R[`QK|i18n|${loc}`] = { naver: translate(loc, "nativeQa.routeNaver"), route: translate(loc, "nativeQa.route") };
    R["QK|render"] = await safe(async () => {
      const { createElement } = await import("react");
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { I18nProvider } = await import("../src/hooks/use-i18n.tsx");
      const { TripLegTransportConnector } = await import("../src/components/saved/TripLegTransportConnector.tsx");
      const res = {};
      for (const loc of ["zh-TW", "en", "ja", "ko"]) {
        setNav(loc);
        const naver = translate(loc, "nativeQa.routeNaver");
        const route = translate(loc, "nativeQa.route");
        const html = (props) => renderToStaticMarkup(createElement(I18nProvider, null, createElement(TripLegTransportConnector, { transport: "步行", onTransportChange() {}, ...props })));
        const withLabel = html({ onOpenTransitMaps() {}, openMapsLabel: naver });
        const noLabel = html({ onOpenTransitMaps() {} });
        const noBtn = html({ onOpenTransitMaps: null });
        res[loc] = { naverShown: withLabel.includes(naver), routeShownWithLabel: withLabel.includes(route), routeShownDefault: noLabel.includes(route), buttonWhenNull: /<button[^>]*type="button"[^>]*class="[^"]*"[^>]*>[^<]*(?:Naver|네이버|路線|route|ルート|경로)/i.test(noBtn), rawKey: withLabel.includes("nativeQa.") };
      }
      setNav(null);
      return res;
    });
  }

  // ===== Q5 extra =====
  if (on("q5")) {
    const slot = await import("../src/lib/ai/ai-day-plan-slot-rules.ts");
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    const src = await import("../src/lib/ai/ai-day-plan-source.ts");
    const types = await import("../src/lib/ai/types.ts");
    pid = 900;
    const B = { lat: 35.1796, lng: 129.0756, tag: "q5" };
    const [arte] = normalizeGooglePlaces([gPlace({ ...B, name: "ARTE MUSEUM BUSAN", types: ["museum", "tourist_attraction", "point_of_interest"], rating: 4.6, reviews: 9000, oh: hours(10 * 60, 20 * 60) })]);
    const [galleryCafe] = normalizeGooglePlaces([gPlace({ ...B, name: "Gallery Cafe Seomyeon", types: ["cafe", "food", "point_of_interest"], rating: 4.5, reviews: 600, oh: hours(10 * 60, 21 * 60) })]);
    const [galleryCafe2] = normalizeGooglePlaces([gPlace({ ...B, name: "Art Gallery Cafe", types: ["art_gallery", "cafe"], rating: 4.5, reviews: 600, oh: hours(10 * 60, 21 * 60) })]);
    const [rest] = normalizeGooglePlaces([gPlace({ ...B, name: "해운대암소갈비집", types: ["restaurant", "food"], rating: 4.3, reviews: 3000, oh: hours(11 * 60, 21 * 60) })]);
    R["Q5|buffer"] = { arte: slot.lastEntryBufferMinutes?.(arte) ?? "n/a", galleryCafe: slot.lastEntryBufferMinutes?.(galleryCafe) ?? "n/a", galleryCafe2: slot.lastEntryBufferMinutes?.(galleryCafe2) ?? "n/a", rest: slot.lastEntryBufferMinutes?.(rest) ?? "n/a" };
    const FRI = "2026-11-20";
    for (const [k, p] of [["galleryCafe", galleryCafe], ["galleryCafe2", galleryCafe2]]) for (const t of ["19:30", "20:00", "20:30"]) R[`Q5|V|${k}|${t}`] = await safe(() => slot.validatePlaceOpenAtTime(p, FRI, t));
    const plan = src.composedPlansToAiDayPlan({ composedPlans: [{ day: 1, entries: [
      { label: "景點", time: "17:30", name: "ARTE MUSEUM BUSAN", place: arte },
      { label: "下午茶", time: "18:00", name: "Gallery Cafe Seomyeon", place: galleryCafe },
      { label: "晚餐", time: "18:30", name: "해운대암소갈비집", place: rest },
      { label: "景點", time: "19:00", name: "ARTE MUSEUM BUSAN 2", place: { ...arte, id: `${arte.id}z`, name: "ARTE MUSEUM BUSAN 2" } },
    ] }], destination: "부산", days: 1, planningSessionId: "tr" });
    const built = await safe(() => src.buildItineraryFromDayPlan(plan, { startDate: FRI, endDate: FRI, dayDates: [FRI] }));
    R["Q5|built"] = Array.isArray(built) ? built.map((i) => ({ t: i.placeName, time: i.time, lam: i.latestArrivalMinutes ?? null, late: i.arrivedAfterLastEntry ?? null, hasLam: "latestArrivalMinutes" in i, hasLate: "arrivedAfterLastEntry" in i })) : built;

    // (f) preserve branch: kr manual WALK -> every leg mode_unavailable (0 calls), no usable duration
    const sync = await import("../src/lib/saved-trip/apply-transit-leg-sync.ts");
    const { buildDayLegKey } = await import("../src/lib/transit/types.ts");
    const mk = (name, extra = {}) => types.normalizeItineraryItem({ date: FRI, time: "10:00", title: name, placeName: name, localizedDisplayName: name, ...extra });
    const A = mk("감천문화마을", { time: "10:00" }); const Bx = mk("해동용궁사", { time: "13:00" });
    const C = mk("ARTE MUSEUM BUSAN", { time: "19:17", latestArrivalMinutes: 1140 }); const D = mk("해운대암소갈비집", { time: "20:30" });
    const mu = { durationMinutes: 0, routeStatus: "mode_unavailable", transportStatus: "mode_unavailable", requestedMode: "WALK", resolvedMode: "WALK", transportMode: "WALK", fallbackReason: "mode_unavailable" };
    const legs = { [buildDayLegKey(FRI, A.placeName, Bx.placeName)]: mu, [buildDayLegKey(FRI, Bx.placeName, C.placeName)]: mu, [buildDayLegKey(FRI, C.placeName, D.placeName)]: mu };
    const settings = { startTime: "10:00", defaultTransportLabel: "步行" };
    const rows = (arr) => arr.map((i) => `${i.placeName}@${i.time}${i.arrivedAfterLastEntry === undefined ? "" : i.arrivedAfterLastEntry ? "!LATE" : "!ok"}`);
    R["Q5|f|usable"] = sync.dayHasAnyUsableLegDuration([A, Bx, C, D], FRI, settings, legs);
    R["Q5|f|preserve19:17"] = await safe(() => rows(sync.applyTransitLegSyncToItems({ itemsBefore: [A, Bx, C, D], itemsWithCoords: [A, Bx, C, D], settings, transitLegs: legs }).items));
    R["Q5|f|preserve18:00stale"] = await safe(() => rows(sync.applyTransitLegSyncToItems({ itemsBefore: [A, Bx, { ...C, time: "18:00" }, D], itemsWithCoords: [A, Bx, { ...C, time: "18:00", arrivedAfterLastEntry: true }, D], settings, transitLegs: legs }).items));
    R["Q5|f|preserveLenMismatch"] = await safe(() => rows(sync.applyTransitLegSyncToItems({ itemsBefore: [A, Bx, C], itemsWithCoords: [A, Bx, C, D], settings, transitLegs: legs }).items));

    // (g) date changes
    const dr = await import("../src/lib/saved-trip/apply-trip-date-range.ts");
    const mut = await import("../src/lib/trip/trip-stop-mutations.ts");
    const SAT = "2026-11-21";
    const itemsG = [A, Bx, C, D, mk("범어사", { date: SAT, time: "10:00" }), mk("ARTE SAT", { date: SAT, time: "15:00", latestArrivalMinutes: 1140, arrivedAfterLastEntry: false })];
    const pickG = (arr) => (Array.isArray(arr) ? arr : arr?.items ?? arr?.nextItems ?? []).filter((i) => /ARTE/.test(i.placeName)).map((i) => ({ n: i.placeName, date: i.date, lam: i.latestArrivalMinutes ?? null, late: i.arrivedAfterLastEntry ?? null }));
    const settingsG = { startTime: "10:00", tripStartDate: FRI, tripEndDate: SAT };
    R["Q5|g|rangeShift"] = await safe(() => { const r = dr.applyTripDateRange(itemsG, settingsG, "2026-11-25", "2026-11-26"); return { keys: Object.keys(r ?? {}), rows: pickG(r) }; });
    R["Q5|g|rangeSame"] = await safe(() => pickG(dr.applyTripDateRange(itemsG, settingsG, FRI, SAT)));
    R["Q5|g|rangeShrink"] = await safe(() => pickG(dr.applyTripDateRange(itemsG, settingsG, FRI, FRI)));
    R["Q5|g|singleDay"] = await safe(() => pickG(dr.updateSingleDayDate(itemsG, settingsG, FRI, "2026-11-27")));
    R["Q5|g|moveAcross"] = await safe(() => pickG(mut.moveStopAcrossDays(itemsG, FRI, 2, SAT, { kind: "end" }, 0, 1)));
    R["Q5|g|updateStopSameDate"] = await safe(() => pickG(mut.updateStop(itemsG, FRI, 2, { date: FRI, time: "19:00" })));
    R["Q5|g|updateStopNewDate"] = await safe(() => pickG(mut.updateStop(itemsG, FRI, 2, { date: SAT })));
  }

  // ===== QW =====
  if (on("qw")) {
    const parser = await import("../src/lib/weather/parse-openweather.ts");
    const policy = await import("../src/lib/outfit/trip-weather-policy.ts");
    const mkList = (startIso, n) => Array.from({ length: n }, (_, i) => ({ dt: Date.parse(startIso) / 1000 + i * 10800, main: { temp: 14, temp_min: 10 + (i % 4), temp_max: 15 + (i % 5), humidity: 60 }, clouds: { all: 30 }, wind: { speed: 3 }, weather: [{ id: 800, description: "晴" }], pop: 0.1 }));
    // Busan: now = KST 11/13 04:30 -> first 3h slot = KST 06:00 = 11/12 21:00Z; 40 slots
    const busan = mkList("2026-11-12T21:00:00Z", 40);
    for (const [k, tz] of [["tzName", "Asia/Seoul"], ["offsetOnly", undefined]]) {
      const rows = parser.aggregateForecast25ToDaily(busan, 32400, 8, tz, true);
      R[`QW|busan|${k}|rows`] = rows.map((r) => r.date);
      R[`QW|busan|${k}|13-16`] = policy.selectTripForecast(rows, policy.tripCalendarDates("2026-11-13", "2026-11-16")).map((r) => `${r.date}:${r.tempLowC}-${r.tempHighC}`);
      R[`QW|busan|${k}|14-17`] = policy.selectTripForecast(rows, policy.tripCalendarDates("2026-11-14", "2026-11-17")).map((r) => r.date);
      R[`QW|busan|${k}|13-18`] = policy.selectTripForecast(rows, policy.tripCalendarDates("2026-11-13", "2026-11-18")).map((r) => r.date);
    }
    // KST 22:30 start -> first slot KST 00:00 next day (complete day); trailing partial
    const late = mkList("2026-11-12T15:00:00Z", 40);
    R["QW|late|rows"] = parser.aggregateForecast25ToDaily(late, 32400, 8, "Asia/Seoul", true).map((r) => r.date);
    // first date with a single slot (KST 21:00)
    const single = mkList("2026-11-13T12:00:00Z", 40);
    R["QW|single|rows"] = parser.aggregateForecast25ToDaily(single, 32400, 8, "Asia/Seoul", true).map((r) => `${r.date}`);
    // middle day with a missing slot (7) must still be excluded
    const gap = mkList("2026-11-12T21:00:00Z", 40).filter((_, i) => i !== 12);
    R["QW|gap|rows"] = parser.aggregateForecast25ToDaily(gap, 32400, 8, "Asia/Seoul", true).map((r) => r.date);
    // existing verify-trip-outfit-weather cases (replicated): Tokyo fallback 8 slots of one local day
    const tokyo = mkList("2026-10-10T15:00:00Z", 8).map((x) => ({ ...x, pop: undefined }));
    const trows = parser.aggregateForecast25ToDaily(tokyo, 32400, 8, undefined, true);
    R["QW|tokyo8"] = trows.map((r) => `${r.date}:${r.precipProbability}`);
    R["QW|tokyo8|sel"] = policy.selectTripForecast(trows, ["2026-10-11"]).length;
    // non-trip (requireCompleteDays=false) path unchanged
    R["QW|busan|nonTrip"] = parser.aggregateForecast25ToDaily(busan, 32400, 8, "Asia/Seoul", false).map((r) => r.date);
  }

  // ===== Q7 =====
  if (on("q7")) {
    const disc = await import("../src/lib/ai/destination-combination-discovery.ts");
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    const cand = (name, types, lat, lng, extra = {}) => ({ name, googlePlaceId: `ChIJq7${name.length}${String(Math.round(lat * 1e4)).slice(-4)}${String(Math.round(lng * 1e4)).slice(-4)}abcdefghij`.slice(0, 27), coordinates: { lat, lng }, types, primaryType: types[0], rating: 4.5, userRatingCount: 2000, businessStatus: "OPERATIONAL", address: `雲林縣斗六市${name}`, ...extra });
    // (b) title revalidation on an :extra: combo whose 觀景台 is dropped (child_place)
    const temples = [cand("斗六福興宮", ["place_of_worship", "tourist_attraction"], 23.709, 120.543), cand("斗六真一寺", ["place_of_worship"], 23.716, 120.552), cand("斗六受天宮", ["place_of_worship", "tourist_attraction"], 23.725, 120.531)];
    const viewDropped = [cand("湖山岩夕陽觀景台", ["tourist_attraction", "observation_deck"], 23.69, 120.58), cand("雲中街生活聚落", ["tourist_attraction"], 23.704, 120.546), cand("斗六行啟記念館", ["tourist_attraction", "museum"], 23.711, 120.541), cand("太平老街", ["tourist_attraction"], 23.712, 120.545)];
    const viewKept = [cand("湖山岩夕陽步道", ["tourist_attraction", "hiking_area"], 23.67, 120.6), cand("古坑觀景平台", ["tourist_attraction"], 23.64, 120.59), cand("華山咖啡大街", ["tourist_attraction"], 23.62, 120.61)];
    const combosB = [
      { combinationId: "斗六:1", title: "舊城文化組合", theme: "historic", placeCandidates: temples, primaryCandidates: temples, fallbackCandidates: [] },
      { combinationId: "斗六:extra:2", title: "日落觀景組合", theme: "attraction", placeCandidates: viewDropped, primaryCandidates: viewDropped.slice(0, 3), fallbackCandidates: viewDropped.slice(3) },
      { combinationId: "斗六:extra:3", title: "日落觀景組合 ", theme: "attraction", placeCandidates: viewKept, primaryCandidates: viewKept, fallbackCandidates: [] },
      { combinationId: "斗六:4", title: "日落觀景組合", theme: "attraction", placeCandidates: viewDropped.map((c) => ({ ...c, googlePlaceId: `${c.googlePlaceId.slice(0, 20)}p4zzzzz`, coordinates: { lat: c.coordinates.lat + 0.2, lng: c.coordinates.lng + 0.2 } })), primaryCandidates: [], fallbackCandidates: [] },
    ];
    R["Q7|b"] = await safe(() => disc.enforcePlanningCombinationComposition(structuredClone(combosB)).map((c) => ({ id: c.combinationId, title: c.title, n: (c.primaryCandidates ?? c.placeCandidates).length, names: (c.primaryCandidates ?? c.placeCandidates).map((p) => p.name) })));
    // (a) community_center type in composition
    const comm = [cand("斗六市立圖書館", ["library", "tourist_attraction"], 23.70, 120.55), cand("斗六社教中心", ["community_center", "tourist_attraction"], 23.701, 120.557), cand("斗六文化館", ["tourist_attraction", "museum"], 23.703, 120.559), cand("雲林故事館", ["tourist_attraction", "museum"], 23.706, 120.534)];
    R["Q7|a|enforce"] = await safe(() => disc.enforcePlanningCombinationComposition([{ combinationId: "斗六:1", title: "藝文博物館組合", theme: "culture", placeCandidates: comm, primaryCandidates: comm, fallbackCandidates: [] }]).map((c) => (c.primaryCandidates ?? c.placeCandidates).map((p) => p.name)));
    // (c)/(d) cache path minimum
    const two = (pre, a, b) => [cand(`${pre}${a}`, ["tourist_attraction"], 23.6 + a * 0.01, 120.5), cand(`${pre}${b}`, ["tourist_attraction"], 23.6 + b * 0.01, 120.52)];
    const cacheCase = async (label, combos) => {
      disc.clearDiscoveredCombinationsCache();
      disc.setCachedDiscoveredCombinations(label, combos);
      const got = disc.getCachedDiscoveredCombinations(label, undefined, undefined, { locale: "zh-TW" });
      return got ? got.map((c) => `${c.combinationId}(${(c.primaryCandidates ?? c.placeCandidates).length})`) : null;
    };
    R["Q7|c|cache3"] = await safe(() => cacheCase("斗六", [
      { combinationId: "斗六:1", title: "舊城文化組合", theme: "historic", placeCandidates: two("宮", 1, 2), primaryCandidates: two("宮", 1, 2), fallbackCandidates: [] },
      { combinationId: "斗六:extra:2", title: "經典景點組合", theme: "attraction", placeCandidates: two("景", 3, 4), primaryCandidates: two("景", 3, 4), fallbackCandidates: [] },
      { combinationId: "斗六:extra:3", title: "城市慢遊組合", theme: "nature", placeCandidates: [...two("園", 5, 6), cand("園7", ["tourist_attraction"], 23.67, 120.53)], primaryCandidates: [...two("園", 5, 6), cand("園7", ["tourist_attraction"], 23.67, 120.53)], fallbackCandidates: [] },
    ]));
    R["Q7|d|cache2"] = await safe(() => cacheCase("斗六", [
      { combinationId: "斗六:1", title: "舊城文化組合", theme: "historic", placeCandidates: temples, primaryCandidates: temples, fallbackCandidates: [] },
      { combinationId: "斗六:extra:2", title: "經典景點組合", theme: "attraction", placeCandidates: two("景", 3, 4), primaryCandidates: two("景", 3, 4), fallbackCandidates: [] },
    ]));
    disc.clearDiscoveredCombinationsCache();

    // discovery runs (mock search, counted)
    const mkPool = (spec, tag) => { pid = 0; return normalizeGooglePlaces(spec.map(([name, types, reviews = 1500, rating = 4.4]) => gPlace({ name, types, reviews, rating, lat: 23.71, lng: 120.54, addr: `640雲林縣斗六市${name}`, tag }))); };
    const POOLS = {
      // (a) community / civic halls mixed into a normal pool
      community: [["斗六信義公民會館社區館", ["tourist_attraction", "point_of_interest"]], ["부산 중앙동 주민센터", ["local_government_office", "point_of_interest"]], ["斗六社教活動館", ["community_center", "point_of_interest"]],
        ["斗六文化館", ["tourist_attraction", "museum"]], ["雲林故事館", ["museum", "tourist_attraction"]], ["斗六行啟記念館", ["tourist_attraction", "historical_landmark"]],
        ["斗六福興宮", ["place_of_worship", "tourist_attraction"]], ["斗六真一寺", ["place_of_worship"]], ["斗六受天宮", ["place_of_worship", "tourist_attraction"]],
        ["太平老街", ["tourist_attraction"]], ["雲中街生活聚落", ["tourist_attraction"]], ["湖山岩", ["tourist_attraction", "place_of_worship"]],
        ["斗六膨鼠森林公園", ["park", "tourist_attraction"]], ["雲林溪", ["park", "natural_feature"]], ["斗六人文公園", ["park", "tourist_attraction"]],
        ["斗六咖啡館", ["cafe"]], ["斗六肉圓", ["restaurant", "food"]], ["斗六夜市", ["night_market", "tourist_attraction"]]],
      // (d) thin city: 1 themed bucket + leftovers where one chunk loses its 觀景台 in composition
      thin: [["斗六福興宮", ["place_of_worship", "tourist_attraction"]], ["斗六真一寺", ["place_of_worship"]], ["斗六受天宮", ["place_of_worship", "tourist_attraction"]],
        ["湖山岩夕陽觀景台", ["tourist_attraction", "observation_deck"]], ["雲中街生活聚落", ["tourist_attraction"]], ["斗六行啟記念館", ["tourist_attraction"]]],
      thin2: [["斗六福興宮", ["place_of_worship", "tourist_attraction"]], ["斗六真一寺", ["place_of_worship"]], ["斗六受天宮", ["place_of_worship", "tourist_attraction"]],
        ["雲中街觀景台", ["tourist_attraction"]], ["雲中街生活聚落", ["tourist_attraction"]], ["太平老街觀景台", ["tourist_attraction"]], ["斗六行啟記念館", ["tourist_attraction"]]],
      thin3: [["斗六福興宮", ["place_of_worship", "tourist_attraction"]], ["斗六真一寺", ["place_of_worship"]], ["斗六受天宮", ["place_of_worship", "tourist_attraction"]], ["斗六城隍廟", ["place_of_worship"]],
        ["雲林故事館", ["museum"]], ["斗六文化館", ["museum", "tourist_attraction"]],
        ["湖山岩展望台", ["tourist_attraction"]], ["雲中街生活聚落", ["tourist_attraction"]], ["太平老街", ["tourist_attraction"]]],
    };
    let geoCalls = 0;
    const geocodeFn = async () => { geoCalls += 1; return { location: { placeId: "geocode:douliu", country: "台灣", city: "斗六市", lat: 23.7117, lng: 120.5431, formattedName: "640台灣雲林縣斗六市", displayLabel: "斗六市", timezone: "Asia/Taipei", utcOffsetMinutes: 480 }, error: null }; };
    for (const [pk, spec] of Object.entries(POOLS)) {
      for (const api of ["discover", "ensure"]) {
        disc.clearDiscoveredCombinationsCache();
        const pool = mkPool(spec, `q7${pk}`);
        let calls = 0; geoCalls = 0;
        const searchPlaces = async () => { calls += 1; return { places: pool, error: null }; };
        R[`Q7|run|${pk}|${api}`] = await safe(async () => {
          const label = pk === "community" ? "斗六" : `斗六${pk === "thin" ? "" : pk}`.replace(/thin\d/, "");
          const res = api === "discover"
            ? await disc.discoverDestinationCombinations({ destination: "斗六", searchPlaces, geocodeFn, locale: "zh-TW", destinationCountry: "台灣" })
            : await disc.ensureDestinationCombinationsReady({ destination: "斗六", searchPlaces, geocodeFn, locale: "zh-TW", destinationCountry: "台灣" });
          const list = api === "discover" ? res : res?.combinations;
          const ok = api === "discover" ? Boolean(res?.length) : res?.ok;
          const reason = api === "discover" ? disc.getLastCombinationDiscoveryFailure?.()?.reason ?? null : res?.failureReason ?? null;
          return {
            label, calls, geoCalls, ok, reason,
            combos: (list ?? []).map((c) => `${c.combinationId}|${c.title}|${(c.primaryCandidates ?? c.placeCandidates).map((p) => p.name).join("、")}`),
            failMsg: ok ? null : { zh: disc.buildDestinationRecommendationFailedMessage("斗六", reason ?? undefined, "zh-TW"), en: disc.buildDestinationRecommendationFailedMessage("斗六", reason ?? undefined, "en") },
          };
        });
      }
    }
  }

  // ===== TH thin-city planner =====
  if (on("th")) {
    const { normalizeGooglePlaces } = await import("../src/lib/ai/normalize-google-place.ts");
    const dtp = await import("../src/lib/ai/destination-trip-planning.ts");
    const { classifyDestinationForPlaceSearch } = await import("../src/lib/ai/landmark-place-strategy.ts");
    const { resetPlannerSession } = await import("../src/lib/ai/planner-session-guard.ts");
    const LAT = 36.5684; const LNG = 128.7294;
    pid = 0;
    const g = (name, types, reviews, rating = 4.3, oh) => gPlace({ name, types, reviews, rating, lat: LAT, lng: LNG, addr: `경상북도 안동시 ${name}`, tag: "andong", oh });
    const FOOD = [["안동찜닭 골목 원조", ["restaurant", "food"], 900], ["맛있는 헛제사밥", ["restaurant", "food"], 500], ["옥야식당", ["restaurant", "food"], 1200], ["안동국시 명가", ["restaurant", "food"], 400], ["간고등어 정식", ["restaurant", "food"], 350], ["신시장 한우", ["restaurant", "food"], 600], ["월영교 식당", ["restaurant", "food"], 300], ["하회 손두부", ["restaurant", "food"], 420], ["안동 갈비골목", ["restaurant", "food"], 800], ["버버리찰떡", ["bakery", "food"], 700]].map(([n, t, c]) => g(n, t, c));
    const CAFE = [["카페 월영", ["cafe", "coffee_shop"], 400], ["안동 한옥카페", ["cafe"], 300], ["낙강물길 카페", ["cafe"], 250], ["커피 하회", ["cafe"], 180]].map(([n, t, c]) => g(n, t, c));
    const ATTR = [["안동하회마을", ["tourist_attraction", "point_of_interest"], 12000, 4.6], ["월영교", ["tourist_attraction", "point_of_interest"], 9000, 4.6], ["도산서원", ["tourist_attraction", "historical_landmark"], 5000, 4.6], ["병산서원", ["tourist_attraction", "historical_landmark"], 3000, 4.6], ["부용대", ["tourist_attraction", "natural_feature"], 1500, 4.6], ["안동민속박물관", ["museum", "tourist_attraction"], 1200, 4.4]].map(([n, t, c, r]) => g(n, t, c, r, hours(9 * 60, 18 * 60)));
    const PARKS_ORD = [["옥동근린공원", PARK, 40, 4.2], ["태화어린이공원", PARK, 22, 4.1], ["용상마을공원", PARK, 30, 4.0], ["정하동네공원", PARK, 35, 4.2], ["명륜소공원", PARK, 18, 4.3], ["강남공원", PARK, 60, 4.2], ["송현공원", PARK, 45, 4.1]].map(([n, t, c, r]) => g(n, t, c, r));
    const PARKS_OK = [["낙동강 음악분수", ["tourist_attraction", "park"], 700, 4.4], ["안동댐 월영공원", ["park", "tourist_attraction"], 1500, 4.4]].map(([n, t, c, r]) => g(n, t, c, r));
    const SHOP = [["안동구시장", ["market", "tourist_attraction"], 3000, 4.3], ["안동 웅부공원", ["park"], 900, 4.3]].map(([n, t, c, r]) => g(n, t, c, r));
    const ALL = normalizeGooglePlaces([...FOOD, ...CAFE, ...ATTR, ...PARKS_ORD, ...PARKS_OK, ...SHOP]);
    const byType = (re) => ALL.filter((p) => (p.types ?? []).some((t) => re.test(t)));
    const counters = { search: 0, queries: [] };
    const searchPlaces = async ({ data }) => {
      counters.search += 1;
      const q = `${data?.query ?? ""} ${(data?.includedTypes ?? []).join(",")} ${data?.mode ?? ""}`.toLowerCase();
      counters.queries.push(q.slice(0, 40));
      let places;
      if (/restaurant|food|美食|餐|맛집|식당|breakfast|lunch|dinner|bakery|早餐|午餐|晚餐/.test(q)) places = byType(/restaurant|food|bakery/);
      else if (/cafe|coffee|咖啡|카페|dessert/.test(q)) places = byType(/cafe|coffee/);
      else if (/museum|博物|美術|gallery/.test(q)) places = byType(/museum/);
      else if (/park|公園|공원|nature|自然|garden|hiking/.test(q)) places = byType(/park|natural/);
      else if (/shop|market|市場|商圈|mall|night/.test(q)) places = byType(/market|shopping/);
      else places = ALL.filter((p) => !(p.types ?? []).some((t) => /restaurant|food|cafe|bakery/.test(t)));
      return { places: places.slice(0, 16), error: null };
    };
    const searchDestinationPlaces = async (params) => {
      const seen = new Set(); const all = [];
      for (const a of (params.attempts?.length ? params.attempts.slice(0, 12) : [{ query: `${params.label} 景點`, includedTypes: ["tourist_attraction"] }, { query: `${params.label} restaurant`, includedTypes: ["restaurant"] }])) {
        const r = await searchPlaces({ data: { query: a.query, includedTypes: a.includedTypes, lat: params.lat, lng: params.lng, mode: a.mode } });
        for (const p of r.places) if (!seen.has(p.id)) { seen.add(p.id); all.push(p); }
      }
      return all;
    };
    const geocodeFn = async () => ({ location: { placeId: "geocode:andong", country: "대한민국", city: "안동시", lat: LAT, lng: LNG, formattedName: "대한민국 경상북도 안동시", displayLabel: "안동시", timezone: "Asia/Seoul", utcOffsetMinutes: 540 }, error: null });
    const ORD_RE = /옥동근린공원|태화어린이공원|용상마을공원|정하동네공원|명륜소공원|강남공원|송현공원/;
    for (const style of ["mixed", "slow_nature"]) {
      counters.search = 0; counters.queries = [];
      const sessionId = `tr-th-${style}-${Date.now()}`;
      resetPlannerSession(sessionId);
      R[`TH|planner|${style}`] = await safe(async () => {
        const plan = await dtp.generateTripPlanFromStyle({
          label: "안동", lat: LAT, lng: LNG, locale: "zh-TW", searchPlaces, weather: null,
          context: { destination: "안동", days: 4, country: "대한민국", startDate: "2026-11-20", endDate: "2026-11-23" },
          style, days: 4, caller: "verify.tr.thin", searchContext: { destination: "안동", days: 4 }, geocodeSucceeded: true,
          searchProfile: classifyDestinationForPlaceSearch("안동"), weatherSearchLabel: "안동", templateNameSearchAttempts: () => [],
          searchDestinationPlaces, planningSessionId: sessionId, geocodeFn,
        });
        const composed = plan.composedPlans ?? [];
        const names = composed.flatMap((d) => (d.entries ?? []).map((e) => e.name));
        return {
          searchCalls: counters.search,
          candidateInsufficient: plan.candidateInsufficient ? { required: plan.candidateInsufficient.requiredCount, available: plan.candidateInsufficient.availableCount, missing: plan.candidateInsufficient.missingCount, affectedDays: plan.candidateInsufficient.affectedDays } : null,
          hasDayPlan: Boolean(plan.dayPlan?.items?.length), dayPlanItems: plan.dayPlan?.items?.length ?? 0,
          perDay: composed.map((d) => d.entries?.length ?? 0), poolExpansionExhausted: plan.poolExpansionExhausted ?? null,
          ordinaryScheduled: names.filter((n) => ORD_RE.test(n)),
          summary: dtp.buildPlanningDaySummary("안동", 4, style, plan.dayBuckets ?? [], composed, { slowTravel: plan.slowTravel, expansionExhausted: plan.poolExpansionExhausted }, "zh-TW").slice(0, 160),
        };
      });
      // chat-level wrapper (what _app.chat.tsx calls)
      counters.search = 0; counters.queries = [];
      const sessionId2 = `tr-thw-${style}-${Date.now()}`;
      resetPlannerSession(sessionId2);
      R[`TH|wrapper|${style}`] = await safe(async () => {
        const dpr = await import("../src/lib/ai/destination-place-recommendation.ts");
        const r = await dpr.buildDestinationMustVisitRecommendation({
          destination: "안동", userText: style === "mixed" ? "幫我排安東4天行程" : "幫我排安東4天慢活自然行程", locale: "zh-TW",
          context: { destination: "안동", days: 4, planningDaysConfirmed: true, planningTripStyle: style, startDate: "2026-11-20", endDate: "2026-11-23", country: "대한민국", destinationCountry: "KR" },
          searchPlaces, geocodeFn, fetchWeatherFn: async () => null, planningSessionId: sessionId2, trustedCenter: { lat: LAT, lng: LNG },
        });
        return { searchCalls: counters.search, recs: r.recommendations?.length ?? 0, dayPlanItems: r.dayPlan?.items?.length ?? 0, days: r.dayPlan?.days ?? 0,
          ordinaryScheduled: (r.dayPlan?.items ?? []).map((i) => i.name).filter((n) => ORD_RE.test(n ?? "")),
          summary: (r.summary ?? "").slice(0, 200) };
      });
    }
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TR_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tr-review.mjs";
    for (const f of [self, "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const extra = SKIP.length ? [`--skip=${SKIP.join(",")}`] : [];
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...extra], { cwd: headDir, encoding: "utf8", timeout: 270_000, maxBuffer: 256 << 20 });
    const m = (r.stdout ?? "").match(/@@TR_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-800)}`);
  }
  const WR = await collect();
  const H = (k) => (HR ? HR[k] : "n/a");
  const S = (v) => JSON.stringify(v);
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const show = (k) => out(`${k.padEnd(40)} W=${S(WR[k])}\n${"".padEnd(40)} H=${S(H(k))}`);

  if (!SKIP.includes("q6")) {
    out("==== Q6 spec (evaluateTourismQuality ok) ====");
    for (const [k, , exp] of GATE) {
      const w = WR[`G|${k}`]; const h = H(`G|${k}`);
      out(`${k.padEnd(42)} W=${S(w)} H=${S(h)} expect=${exp}`);
      if (exp === "same") { if (HR && w !== h) fail(`Q6 ${k}`, "TA+park verdict changed"); }
      else if (exp !== "info" && w !== exp) fail(`Q6 ${k}`, `W=${w} expected ${exp}`);
    }
    out("---- isLocalNeighborhoodPark ----");
    for (const [k] of CLASSIC) out(`${k.padEnd(28)} W=${S(WR[`C|${k}`])} H=${S(H(`C|${k}`))}`);
    for (const k of ["cafe 소공원커피", "restaurant 공원식당", "cafe 소공원 카페", "park 당인리발전소공원", "park 해양연구소공원"]) if (WR[`C|${k}`] !== false) fail(`Q6 classic ${k}`, `W=${WR[`C|${k}`]}`);
  }
  if (!SKIP.includes("rg")) {
    out("==== resolveDirectionsRegion ====");
    for (const [s, exp] of REGION) { const w = WR[`RG|${s}`]; out(`${s.padEnd(20)} W=${w} H=${H(`RG|${s}`)} expect=${exp}`); if (w !== exp) fail(`RG ${s}`, `W=${w}`); }
  }
  if (!SKIP.includes("q1b")) {
    out("==== Q1b server getTripLegsWithDurations (fetch calls) ====");
    if (WR["Q1b|import"]) fail("Q1b import", S(WR["Q1b|import"]));
    for (const k of Object.keys(WR).filter((k) => /^Q1b\|(kr|jp|tw|none)\|/.test(k))) {
      const w = WR[k]; const h = H(k); const [, region, mode] = k.split("|");
      out(`${k.padEnd(22)} W calls=${w.calls} ${S(w.result)} | H calls=${h?.calls} ${S(h?.result)}`);
      if (region === "kr" && mode !== "TRANSIT" && w.calls !== 0) fail(k, `kr ${mode} made ${w.calls} calls`);
      if (region !== "kr" && HR && (w.calls !== h.calls || S(w.result) !== S(h.result))) fail(k, "non-kr behaviour changed");
      if (region === "kr" && mode !== "TRANSIT" && HR && S(w.result) !== S(h.result)) out(`  NOTE ${k}: result shape W=${S(w.result)} H=${S(h.result)}`);
    }
    const sum = (R, re) => R ? Object.keys(R).filter((k) => re.test(k)).reduce((a, k) => a + (R[k]?.calls ?? 0), 0) : "n/a";
    out(`total calls kr non-TRANSIT W=${sum(WR, /^Q1b\|kr\|(WALK|DRIVE|BICYCLE)/)} H=${sum(HR, /^Q1b\|kr\|(WALK|DRIVE|BICYCLE)/)}; jp/tw/none W=${sum(WR, /^Q1b\|(jp|tw|none)\|/)} H=${sum(HR, /^Q1b\|(jp|tw|none)\|/)}`);
    for (const k of ["Q1b|clientRegion", "Q1b|chatRegion", "Q1b|savedLeg"]) show(k);
    if (!WR["Q1b|clientRegion"]?.some((x) => x.region === "kr")) fail("Q1b clientRegion", "region not forwarded");
    if (WR["Q1b|savedLeg"]?.naverWalk !== "walk" || WR["Q1b|savedLeg"]?.naverDrive !== "car") fail("Q1b savedLeg->Naver", S(WR["Q1b|savedLeg"]));
  }
  if (!SKIP.includes("qk")) {
    out("==== QK ====");
    if (WR["QK|import"]) fail("QK import", S(WR["QK|import"]));
    for (const k of Object.keys(WR).filter((k) => /^QK\|(kr|jp|tw)\|(failed|mode_unavailable|transit_unavailable|ok)\|/.test(k))) {
      const [, region, st, label] = k.split("|");
      const exp = region === "kr" && st !== "ok" ? (label === "步行" ? "walk" : label === "租車自駕" ? "car" : null) : null;
      if (WR[k] !== exp) fail(k, `W=${WR[k]} expected ${exp}`);
    }
    out(`decision matrix checked: ${Object.keys(WR).filter((k) => /^QK\|(kr|jp|tw)\|/.test(k) && !/deeplink|none-transit/.test(k)).length} cases; kr|failed|步行=${WR["QK|kr|failed|步行"]} kr|mode_unavailable|租車自駕=${WR["QK|kr|mode_unavailable|租車自駕"]} kr|ok|步行=${WR["QK|kr|ok|步行"]} tw|failed|步行=${WR["QK|tw|failed|步行"]} noLeg=${WR["QK|noLeg"]}`);
    show("QK|url");
    const urlRe = /^https:\/\/map\.naver\.com\/p\/directions\/-?\d+(\.\d+)?,-?\d+(\.\d+)?,[^,/]+,,\/-?\d+(\.\d+)?,-?\d+(\.\d+)?,[^,/]+,,\/-\/(walk|car)$/;
    for (const [m, u] of Object.entries(WR["QK|url"] ?? {})) if (!urlRe.test(u) || !u.endsWith(`/-/${m}`)) fail(`QK url ${m}`, u);
    if (WR["QK|url"] && !WR["QK|url"].walk.startsWith("https://map.naver.com/p/directions/129.0106,35.0975,")) fail("QK url lng-first", WR["QK|url"].walk);
    for (const k of ["QK|jp|deeplink-transit", "QK|jp|deeplink-walk", "QK|jp|none-transit"]) { out(`${k} W=${WR[k]} H=${H(k)}`); if (HR && WR[k] !== H(k)) fail(k, "Japan transit button changed"); }
    for (const loc of ["zh-TW", "en", "ja", "ko"]) {
      const w = WR[`QK|i18n|${loc}`]; const h = H(`QK|i18n|${loc}`);
      out(`i18n ${loc} W=${S(w)} H.route=${S(h?.route)}`);
      if (!w?.naver || w.naver === "nativeQa.routeNaver") fail(`QK i18n ${loc}`, "routeNaver missing");
      if (HR && w.route !== h.route) fail(`QK i18n route ${loc}`, "Japan route copy changed");
    }
    show("QK|render");
    if (WR["QK|render"]?.error) fail("QK render", WR["QK|render"].error);
    else for (const [loc, c] of Object.entries(WR["QK|render"] ?? {})) if (!c.naverShown || c.routeShownWithLabel || !c.routeShownDefault || c.buttonWhenNull || c.rawKey) fail(`QK render ${loc}`, S(c));
  }
  if (!SKIP.includes("q5")) {
    out("==== Q5 extra ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("Q5|"))) show(k);
    const b = WR["Q5|built"];
    if (Array.isArray(b)) {
      const by = (n) => b.find((i) => i.t === n);
      if (by("ARTE MUSEUM BUSAN")?.lam !== 1140 || by("ARTE MUSEUM BUSAN")?.late !== false) fail("Q5 build 17:30", S(by("ARTE MUSEUM BUSAN")));
      if (by("ARTE MUSEUM BUSAN 2")?.late !== true) fail("Q5(i) build 19:00 flag", S(by("ARTE MUSEUM BUSAN 2")));
      if (by("Gallery Cafe Seomyeon")?.hasLam || by("Gallery Cafe Seomyeon")?.hasLate) fail("Q5(c) gallery cafe field", S(by("Gallery Cafe Seomyeon")));
      if (by("해운대암소갈비집")?.hasLam || by("해운대암소갈비집")?.hasLate) fail("Q5(b) restaurant field", S(by("해운대암소갈비집")));
    } else fail("Q5 built", S(b));
    for (const k of Object.keys(WR).filter((k) => /^Q5\|V\|/.test(k))) if (HR && WR[k] !== H(k)) fail(`Q5(c) ${k}`, `cafe validation changed W=${WR[k]} H=${H(k)}`);
    if (WR["Q5|buffer"]?.galleryCafe !== 0 || WR["Q5|buffer"]?.galleryCafe2 !== 0 || WR["Q5|buffer"]?.arte !== 60) fail("Q5 buffer", S(WR["Q5|buffer"]));
    if (WR["Q5|f|usable"] !== false) fail("Q5(f) branch", "day had usable leg -> not the preserve branch");
    const has = (k, s) => Array.isArray(WR[k]) && WR[k].includes(s);
    if (!has("Q5|f|preserve19:17", "ARTE MUSEUM BUSAN@19:17!LATE")) fail("Q5(f) preserve 19:17", S(WR["Q5|f|preserve19:17"]));
    if (!has("Q5|f|preserve18:00stale", "ARTE MUSEUM BUSAN@18:00!ok")) fail("Q5(f) preserve stale", S(WR["Q5|f|preserve18:00stale"]));
    if (!has("Q5|f|preserveLenMismatch", "ARTE MUSEUM BUSAN@19:17!LATE")) fail("Q5(f) preserve len mismatch", S(WR["Q5|f|preserveLenMismatch"]));
    const cleared = (k) => { const v = WR[k]; const rows = Array.isArray(v) ? v : v?.rows; return Array.isArray(rows) && rows.length > 0 && rows.every((r) => r.lam === null && r.late === null); };
    for (const k of ["Q5|g|rangeShift", "Q5|g|singleDay"]) if (!cleared(k)) fail(`Q5(g) ${k}`, S(WR[k]));
    const usn = WR["Q5|g|updateStopNewDate"]; const usnA = Array.isArray(usn) ? usn.find((r) => r.n === "ARTE MUSEUM BUSAN") : null;
    if (!usnA || usnA.date !== "2026-11-21" || usnA.lam !== null || usnA.late !== null) fail("Q5(g) updateStopNewDate", S(usn));
    const mv = WR["Q5|g|moveAcross"]; if (!Array.isArray(mv) || !mv.filter((r) => r.n === "ARTE MUSEUM BUSAN").every((r) => r.date === "2026-11-21" && r.lam === null)) fail("Q5(g) moveAcross", S(mv));
    const same = WR["Q5|g|rangeSame"]; if (!Array.isArray(same) || !same.some((r) => r.n === "ARTE MUSEUM BUSAN" && r.lam === 1140)) fail("Q5(g) same range keeps", S(same));
    const us = WR["Q5|g|updateStopSameDate"]; if (!Array.isArray(us) || !us.some((r) => r.n === "ARTE MUSEUM BUSAN" && r.lam === 1140)) fail("Q5(g) updateStop same date keeps", S(us));
  }
  if (!SKIP.includes("qw")) {
    out("==== QW ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("QW|"))) show(k);
    for (const v of ["tzName", "offsetOnly"]) {
      if ((WR[`QW|busan|${v}|13-16`] ?? []).length !== 4) fail(`QW busan ${v} 13-16`, S(WR[`QW|busan|${v}|13-16`]));
      if (HR && (H(`QW|busan|${v}|13-16`) ?? []).length !== 0) out(`  NOTE HEAD 13-16 not empty: ${S(H(`QW|busan|${v}|13-16`))}`);
      if ((WR[`QW|busan|${v}|rows`] ?? []).includes("2026-11-18")) fail(`QW ${v} trailing partial`, "11/18 partial kept");
      if ((WR[`QW|busan|${v}|13-18`] ?? []).length !== 0) fail(`QW ${v} 13-18`, "trip beyond coverage must be []");
    }
    if ((WR["QW|gap|rows"] ?? []).includes("2026-11-14")) fail("QW gap", "middle day with 7 slots kept");
    if (HR && S(WR["QW|busan|nonTrip"]) !== S(H("QW|busan|nonTrip"))) fail("QW nonTrip", "non-trip path changed");
    if (HR && (S(WR["QW|tokyo8"]) !== S(H("QW|tokyo8")) || WR["QW|tokyo8|sel"] !== 1)) fail("QW tokyo8", "existing case changed");
  }
  if (!SKIP.includes("q7")) {
    out("==== Q7 ====");
    show("Q7|b"); show("Q7|a|enforce"); show("Q7|c|cache3"); show("Q7|d|cache2");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("Q7|run|"))) show(k);
    const b = WR["Q7|b"];
    if (Array.isArray(b)) {
      const e2 = b.find((c) => c.id === "斗六:extra:2"); const e3 = b.find((c) => c.id === "斗六:extra:3");
      if (e2 && /日落|夕陽/.test(e2.title)) fail("Q7(b) dropped viewpoint keeps sunset title", S(e2));
      if (e3 && !/日落/.test(e3.title)) fail("Q7(b) control: 2 view places lost sunset title", S(e3));
    }
    const a = WR["Q7|a|enforce"]; if (Array.isArray(a) && a.flat().includes("斗六社教中心")) fail("Q7(a) community_center", S(a));
    if (Array.isArray(a) && !a.flat().includes("斗六文化館")) fail("Q7(a) 文化館 hurt", S(a));
    const com = WR["Q7|run|community|discover"];
    if (com?.combos) {
      const blob = com.combos.join(" ");
      for (const n of ["公民會館社區館", "주민센터", "社教活動館"]) if (blob.includes(n)) fail(`Q7(a) discovery ${n}`, "civic hall offered");
      if (HR && H("Q7|run|community|discover")?.combos?.join(" ").includes("斗六文化館") && !blob.includes("斗六文化館")) fail("Q7(a) 文化館 dropped vs HEAD", blob);
    }
    const c3 = WR["Q7|c|cache3"]; if (Array.isArray(c3) && c3.some((x) => x.startsWith("斗六:extra:2("))) fail("Q7(c) 2-pt extra survived cache", S(c3));
    if (Array.isArray(c3) && !c3.some((x) => x.startsWith("斗六:1("))) fail("Q7(c) predefined 2-pt dropped", S(c3));
    for (const k of Object.keys(WR).filter((k) => k.startsWith("Q7|run|"))) {
      const w = WR[k]; const h = H(k);
      if (w?.combos) for (const c of w.combos) { const [id, , names] = c.split("|"); if (id.includes(":extra:") && names.split("、").length < 3) fail(`Q7(c) ${k}`, `extra combo <3: ${c}`); }
      if (HR && h && !h.error && w && !w.error && w.calls > h.calls) fail(`Q7(e) ${k}`, `search calls increased W=${w.calls} H=${h.calls}`);
      if (HR && h?.ok && w && !w.ok) out(`  RISK3 ${k}: HEAD ok (${h.combos.length} combos) -> W failed reason=${w.reason} msg=${S(w.failMsg)}`);
    }
  }
  if (!SKIP.includes("th")) {
    out("==== TH thin city (안동, 4 days) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("TH|"))) show(k);
  }
  out(`\nSUMMARY failures=${failures.length}${failures.length ? `\n  - ${failures.join("\n  - ")}` : ""}`);
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
