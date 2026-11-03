#!/usr/bin/env node
/**
 * R15 — Destination Authority 全量回歸（A2-T5，tester；使用者裁決 2026-10-21：CC-1 同意建 Evidence Mock、CC-2 接受一次必要驗證、
 *       CC-3 暫不接受為 PASS、只做唯讀診斷）。
 *
 * 建立方式（同 r14 模式）：r12／r13／r14 保留不改。r15 在執行期讀入 r14 原文（sha1 必須 = scratchpad/pre-r15-test-sha.txt 的
 * c60827a3…），套用 R15_R14_PATCHES（r14 原文層；每個錨點必須「恰好出現一次」，否則 INFRA-FAIL、不執行），再以 AsyncFunction 執行。
 * patched r14 照常讀入 r13（sha 8debfb44…）、套 R14_PATCHES（50 個，不變），之後再套 R15_R13_PATCHES（r13 原文層，錨點同樣恰好一次）。
 * 主程序與 collect 子程序都是同一份內容（子程序路徑改為 r15）。
 *
 * 只允許的變更（逐項見 --emit-diff 產生的 scratchpad/r15.diff）：
 *  r15-V  版本識別：r15 路徑（子程序）、標題、摘要行、F7 後變動檔白名單 r1[0-4] → r1[0-5]。
 *  r15-E  Provider Mock 證據契約（取代 r14 的診斷旗標 --evidence-mock；r15 不接受該旗標）：
 *         geocode Mock 的 ok 回應改由「該樹」正式 destination-provider-result.ts 產生：
 *           providerResult = tripLocationToProviderResult(location, { provider:"geocode", query, rawResultCount:1, httpStatus:200,
 *                              apiStatus:"OK", sourceShape:"geocode_results",
 *                              evidence: providerEvidenceForGeocodeLocation(<Google Geocoding JSON>, location) })
 *         ＝location.functions.ts L1210-1218 的同一組呼叫（destination-provider-result.ts L162-178、L547-578）。
 *         Google Geocoding JSON 由 Mock 地點合成：results[0] = { place_id = location.placeId, types（同 r14GeocodeEvidence 的判定）,
 *         address_components[country].short_name = countryCode, geometry.location = {lat,lng} }（不含 viewport：見 UNVERIFIED）。
 *         因此成功回應帶出 Place ID、types（Geocoding 來源；無 primaryType＝dpr L48）、countryCode、administrativeArea、
 *         Provider Coordinates（latitude／longitude）。base 樹（aa2db59）的 dpr 沒有 providerEvidenceForGeocodeLocation → 依當時正式形狀不帶證據。
 *         失敗模式 timeout／null／zero／neterr 的回應與 r13 逐字相同（不補證據）。
 *  r15-N  新增負向證據情境（不加入 SCENARIOS／MODES，不進既有 judge；只新增斷言）：EV-<fault>-<target>，
 *         fault = poi（POI types）／country（他國結果）／coord00（(0,0)，正式形狀）／coordOOB（超界，偽造 envelope）／coordNaN（NaN，偽造 envelope），
 *         target = 奈良（城市中心驗證）／台中西屯（行政區驗證）／里斯本（全球城市候選）。期望（work）：Fail Closed（不可信、不搜尋、不扣點）。
 *  r15-C  CC-2 計數：驗證流程次數 vs 實際 geocode Mock 請求次數（各樹分開）；請求分類 必要驗證／非必要重複／Provider 失敗重試；
 *         R15-PROBE（work 樹單元探針，同一 vite-node runner 直接呼叫正式 chat-turn-destination.ts）：並發去重、成功快取、
 *         失敗不信 Client 快照、15s cooldown、Places（primaryType）形狀、行政區負向證據。
 *
 *  r15-F  Fixture 有效性分類（A2-T6，使用者裁決 2026-10-21 授權修正 Evidence Mock）：geocode Mock 在 ok 模式下先依 Fixture 的
 *         地理表分類查詢字串（與 r13 realisticLocation 相同的前處理：取第一個逗號前、trim），只有「有效」才回成功＋證據：
 *           real   ＝ r13 REAL 表的精確鍵（具體地點／行政區）
 *           parent ＝ r13 PARENTS 已知城市為前綴（回應＝父城市本身的 LOC：formattedName／types 只證明父城市，從不證明尾段）
 *           alias  ＝ R15_ALIASES 明確列出的同一地點其他寫法（英文名／日文字形；來源 destination-geocode.ts 查詢變體表），回應不變
 *           unknown＝ 以上皆非（r13 realisticLocation 的「label = 查詢字串、國家預設日本」預設分支）
 *         unknown → 回 ZERO_RESULTS（形狀與 r13 GEO_MODE=zero 逐字相同；所有樹一致），不再由 Mock 自動產生「日本 locality」成功證據。
 *         有效分類的回應與修正前逐字相同；timeout／null／zero／neterr 與 EV 故障（poi／country／coord*）語意不變。
 *         報告新增「r15-F 有效性分類普查」：本次執行所有 geocode 查詢字串 → 分類、情境、樹；
 *         以及「修正前後 work P1 逐條比較」（修正前＝scratchpad/r15-full-A/B.log；只比本次有跑的情境）。
 *  r15-X  外掛情境掛載點（A2-T6）：--extra-scenarios=<scripts/verify-*.mjs>（目前唯一使用者：verify-more-places-cross-destination.mjs）。
 *         只記錄的每輪欄位 r15Rec／r15Cards／r15Credits；情境自帶的 r15Real（具體地點 Fixture）、r15EmptyDest（指定目的地 Places 回空）、
 *         r15Init（初始 Session：以該樹正式 createRecommendationSession 建立，同 r13 r9Rec 手法）；
 *         r13 情境沒有這些欄位 → 行為不變。F7 後變動檔白名單加上該測試的精確路徑（否則新檔會讓 r13 pre-tree 檢查 INFRA-FAIL）。
 *
 * 不變：r13 的情境／Fixture／Assertion／expect／MODES／Credits 結算條件／Provider 請求限制／P1／P2 分類，r14 的 r14-A2 斷言、
 * INFRA 檢查（sha、anchor、白名單、未知依賴 FAIL）。外部請求攔截同 r13（任何外部請求 → FAIL）。
 *
 * 執行：node scripts/verify-destination-authority-phase2-r15.mjs --brief --f10 --pa2 [--only=ID,…] [--out=<scratchpad>/x.log] [--conc=N]
 *       node scripts/verify-destination-authority-phase2-r15.mjs --extract-report
 *       node scripts/verify-destination-authority-phase2-r15.mjs --emit-diff     （寫 scratchpad/r15.diff）
 *       node scripts/verify-destination-authority-phase2-r15.mjs --emit-fix-diff （寫 scratchpad/r15-fix.diff：修正前 r15 → 修正後；不覆寫 r15.diff）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R14_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r14.mjs`;
const R14_SHA = "c60827a3dcf7be637f2dff5e59b0414005621575"; // scratchpad/pre-r15-test-sha.txt
const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");
const L = (...lines) => lines.join("\n");

if (process.argv.includes("--evidence-mock")) {
  console.log("INFRA-FAIL r15 不接受 --evidence-mock（r15 的 Evidence Mock 為正式契約、永遠啟用；診斷旗標只屬於 r14）");
  process.exit(1);
}

// ════════════════════════ r15-X：外掛情境掛載點（A2-T6；只在主程序帶 --extra-scenarios= 時啟用）════════════════════════
/**
 * --extra-scenarios=<scripts/verify-*.mjs>：模組匯出 { scenarios, report({ results, TREES, out }) }。情境照 r13 子程序同一路徑執行
 * （同一套擷取／閉包／Mock／外部網路攔截／r15-F 分類），每個情境以 s.r15Modes（{id,geo,search}）× TREES 加入 jobs；
 * 不加入 SCENARIOS／MODES、不進 r13 judge。子程序不載入模組（情境內容經 VERIFY_P2_SCENARIO 傳遞）。
 */
const R15_X_ARG = process.argv.find((a) => a.startsWith("--extra-scenarios="))?.slice("--extra-scenarios=".length) ?? null;
const R15_X = { mod: null, fail: 0, pass: 0, ran: false };

// ════════════════════════ r15-E：Provider Mock 證據契約 ════════════════════════
/** POI types（Geocoding 對景點／設施的回應）。 */
const R15_POI_TYPES = ["tourist_attraction", "point_of_interest", "establishment"];
const R15_FAULTS = {
  poi: "POI 類型（Geocoding types=tourist_attraction/point_of_interest/establishment）",
  country: "國家不符（整筆結果在他國：country=韓國、countryCode=KR）",
  coord00: "座標 (0,0)（正式形狀：tripLocationToProviderResult 視為有效座標 → ok:true）",
  coordOOB: "座標超界 lat=95.5 lng=200.25（偽造 envelope：正式 Server L1194 不會產生 ok:true；測 Client 端防線）",
  coordNaN: "座標 NaN（偽造 envelope：同上）",
};
/** 合成一筆 Google Geocoding API 回應（只含正式 providerEvidenceForGeocodeLocation 會讀的欄位）。 */
function r15GoogleGeocodeJson(loc, types, countryCode) {
  return {
    status: "OK",
    results: [
      {
        place_id: loc.placeId,
        types,
        formatted_address: loc.formattedName,
        address_components: countryCode ? [{ long_name: loc.country, short_name: countryCode, types: ["country", "political"] }] : [],
        geometry: { location: { lat: loc.lat, lng: loc.lng } },
      },
    ],
  };
}
/**
 * geocode Mock 的 ok 回應（子程序內呼叫；dpr＝該樹的正式 destination-provider-result.ts）。
 * fault 只在 EV 情境（scenario.r15Fault）套用；其餘情境 = 正式成功形狀。
 */
function r15BuildGeocodeOk(dpr, { location, q, ev, fault }) {
  let loc = location;
  let types = ev?.types;
  let countryCode = ev?.countryCode;
  let forged = null;
  if (fault === "poi") types = [...R15_POI_TYPES];
  else if (fault === "country") {
    loc = { ...loc, country: "韓國" };
    countryCode = "KR";
  } else if (fault === "coord00") loc = { ...loc, lat: 0, lng: 0 };
  else if (fault === "coordOOB") forged = { lat: 95.5, lng: 200.25 };
  else if (fault === "coordNaN") forged = { lat: Number.NaN, lng: Number.NaN };
  const google = r15GoogleGeocodeJson(loc, types, countryCode);
  const evidence = typeof dpr.providerEvidenceForGeocodeLocation === "function" ? dpr.providerEvidenceForGeocodeLocation(google, loc) : undefined;
  let providerResult = dpr.tripLocationToProviderResult(loc, {
    provider: "geocode",
    query: q,
    rawResultCount: 1,
    httpStatus: 200,
    apiStatus: "OK",
    sourceShape: "geocode_results",
    ...(evidence ? { evidence } : {}),
  });
  if (forged) {
    loc = { ...loc, ...forged };
    providerResult = { ...providerResult, latitude: forged.lat, longitude: forged.lng };
  }
  return { location: loc, error: null, providerResult };
}
/** Places（Autocomplete → Details）來源的成功形狀（location.functions.ts L1014-1023）；只用於單元探針。 */
function r15BuildPlacesOk(dpr, { location, q, types, primaryType, countryCode }) {
  const evidence = dpr.providerEvidenceFromPlaceDetails({
    types,
    primaryType,
    addressComponents: countryCode ? [{ longText: location.country, shortText: countryCode, types: ["country", "political"] }] : [],
  });
  const providerResult = dpr.tripLocationToProviderResult(location, { provider: "places_autocomplete", query: q, httpStatus: 200, apiStatus: "OK", sourceShape: "places_details", evidence });
  return { location, error: null, providerResult };
}
const r15DprCache = { mod: null };
/** EV 情境的故障只注入「驗證流程內」的 geocode 回應（流程外＝上游 global candidate／weather 等維持正式成功形狀），以隔離 A2 閘門本身。 */
const r15FaultNow = (scenario) => (scenario?.r15Fault && globalThis.__R15_FLOW?.length ? scenario.r15Fault : null);

// ════════════════════════ r15-F：Fixture 有效性分類 ════════════════════════
/**
 * 明確列出的「同一真實地點的其他寫法」→ Fixture 的 PARENTS／REAL 鍵。來源：正式 destination-geocode.ts 的查詢變體表
 * （例：奈良 → "Nara, Japan"、金澤 → "金沢市, 石川県, 日本"／"Kanazawa, Japan"），這些字串在 r13 的 realisticLocation 不會命中
 * REAL／PARENTS。白名單只收 Fixture 地理表已有地點的別名，不收任何虛構字串，也不以「未知」為條件做特殊處理。
 */
const R15_ALIASES = {
  Kyoto: "京都", 京都府: "京都", Osaka: "大阪", 大阪府: "大阪", Tokyo: "東京", "Tokyo Metropolis": "東京", 東京都: "東京",
  Nara: "奈良", "Nara City": "奈良", Kanazawa: "金澤", 金沢: "金澤", 金沢市: "金澤", Hokkaido: "北海道", Okinawa: "沖繩", "Okinawa Island": "沖繩", 沖縄: "沖繩",
  Chiba: "千葉", "Hong Kong": "香港", Taipei: "台北", 臺北: "台北", 臺北市: "台北", Taichung: "台中", "Taichung City": "台中", 臺中: "台中", 臺中市: "台中",
  Tainan: "台南", 臺南: "台南", 臺南市: "台南", Hsinchu: "新竹", "Hsinchu City": "新竹", "Hsinchu County": "新竹", Hualien: "花蓮", Nantou: "南投", "Nantou County": "南投",
  Puli: "埔里", Lisbon: "里斯本", Lisboa: "里斯本", Porto: "波爾圖",
};
/**
 * 依 Fixture 地理表分類一個 geocode 查詢字串（前處理與 r13 realisticLocation 相同）。
 * real／parent 與 realisticLocation 的前兩個分支一一對應；unknown ＝ realisticLocation 的預設分支且不在 R15_ALIASES。
 */
function r15Validity(rawQuery, fixture, scenario) {
  const key = String(rawQuery).split(",")[0].trim();
  // r15-X：外掛情境可宣告自己的具體地點（同 REAL 表形狀；只對該情境的子程序有效，r13 情境沒有此欄位）
  if (scenario?.r15Real && Object.prototype.hasOwnProperty.call(scenario.r15Real, key)) return { cls: "real", key, ref: `${key}（情境 Fixture）`, location: scenario.r15Real[key] };
  if (fixture?.REAL && Object.prototype.hasOwnProperty.call(fixture.REAL, key)) return { cls: "real", key, ref: key };
  const parent = (fixture?.PARENTS ?? []).filter((p) => key.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  if (parent) return { cls: "parent", key, ref: parent };
  if (Object.prototype.hasOwnProperty.call(R15_ALIASES, key)) return { cls: "alias", key, ref: R15_ALIASES[key] };
  return { cls: "unknown", key, ref: null };
}
/** unknown 的回應：與 r13 GEO_MODE=zero 分支逐字相同的 ZERO_RESULTS（所有樹都已處理過這個形狀）。 */
const r15ZeroResults = (q) => ({ location: null, error: null, providerResult: { ok: false, status: "ZERO_RESULTS", provider: "geocode", rawResultCount: 0, parsedResultCount: 0, failureReason: "geocode_zero_results", query: q } });
async function r15GeocodeOk({ location, q, scenario, imp, ev, evFn, fixture }) {
  if (!fixture) throw new Error("r15-F：geocodeOk 缺少 Fixture 地理表（REAL／PARENTS）"); // 不允許無分類就回成功
  const validity = r15Validity(q, fixture, scenario);
  if (validity.cls === "unknown") return r15ZeroResults(q);
  r15DprCache.mod ??= await imp("lib/ai/destination-provider-result.ts");
  const loc = validity.location ?? location; // r15-X：情境 Fixture 地點（只在外掛情境）
  // 情境 Fixture 地點的證據以同一個 r14GeocodeEvidence 判定（evFn）；其餘沿用呼叫端以 realisticLocation 結果算好的 ev（修正前同值）
  return r15BuildGeocodeOk(r15DprCache.mod, { location: loc, q, ev: validity.location ? evFn(loc) : ev, fault: r15FaultNow(scenario) });
}
const r15GeoTag = (mode, scenario, q, fixture) => {
  const { location: _omit, ...validity } = r15Validity(q, fixture, scenario);
  return {
    flow: globalThis.__R15_FLOW?.at(-1) ?? null,
    outcome: mode === "ok" ? (validity.cls === "unknown" ? "fail:unconfirmed" : r15FaultNow(scenario) ? `fault:${scenario.r15Fault}` : "ok") : `fail:${mode}`,
    validity,
  };
};
/** r15-X：外掛情境宣告「此目的地的 Places 搜尋回空」（r13 情境沒有此欄位 → 恆為 false）。 */
const r15SearchEmpty = (scenario, data) =>
  Array.isArray(scenario?.r15EmptyDest) && scenario.r15EmptyDest.some((d) => String(data?.destinationName ?? "").includes(d) || String(data?.query ?? "").includes(d));

// ════════════════════════ r15-N：負向證據情境 ════════════════════════
const R15_EV_TARGETS = [
  { k: "nara", label: "奈良", turns: ["奈良推薦景點"], turn: 0, note: "Authority 確認、無靜態中心 → validateCityCandidateCenter" },
  { k: "xitun", label: "台中西屯", turns: ["台中西屯美食"], turn: 0, note: "已知父城市＋尾段 → runAreaProviderValidation" },
  { k: "lisbon", label: "里斯本", turns: ["我想去里斯本", "推薦景點"], turn: 1, note: "全球城市候選 → validateCityCandidateCenter" },
];
const R15_EV = Object.keys(R15_FAULTS).flatMap((fault) =>
  R15_EV_TARGETS.map((t) => ({
    id: `EV-${fault}-${t.k}`,
    label: `（r15 負向證據：${fault}）${t.turns.join(" → ")}`,
    turns: t.turns,
    r15Fault: fault,
    r15Target: { label: t.label, turn: t.turn, note: t.note },
  })),
);
const R15_PROBE = { id: "R15-PROBE", label: "（r15 CC-2 單元探針，work 樹，直接呼叫正式 chat-turn-destination.ts）", turns: [], r15Probe: true };
const R15_EV_MODE = { id: "ok", geo: "ok", search: "ok" };
function r15ExtraJobs(ONLY, TREES) {
  const jobs = [];
  for (const s of R15_EV) if (!ONLY || ONLY.has(s.id)) for (const tree of TREES) jobs.push({ s, m: R15_EV_MODE, tree });
  if (!ONLY || ONLY.has(R15_PROBE.id)) jobs.push({ s: R15_PROBE, m: R15_EV_MODE, tree: "work" });
  // r15-X：外掛情境（只有 --extra-scenarios= 時）
  for (const s of R15_X.mod?.scenarios ?? []) if (!ONLY || ONLY.has(s.id)) for (const m of s.r15Modes ?? [R15_EV_MODE]) for (const tree of TREES) jobs.push({ s, m, tree });
  return jobs;
}
/** r15-X：本輪結束時 recommendationSession 的地理範圍與池（只記錄；子程序內呼叫）。 */
const r15RecScope = (r) =>
  r
    ? {
        destination: r.destination ?? null,
        parentCity: r.parentCity ?? null,
        area: r.area ?? null,
        searchScope: r.searchScope ?? null,
        topic: r.topic ?? null,
        pool: Array.isArray(r.pool) ? r.pool.length : 0,
        cursor: r.cursor ?? null,
        poolIds: (Array.isArray(r.pool) ? r.pool : []).map((p) => p?.googlePlaceId ?? p?.placeId ?? null),
      }
    : null;
/**
 * r15-X：外掛情境的初始 Session（子程序內）。spec＝{ topic, rec: { destination, parentCity?, area?, n, batch }, travelDestination }；
 * 池項目與 r13 r9Pool 同形（名稱「<目的地>-舊地點N」）；recommendationSession 由該樹正式 createRecommendationSession 產生。
 */
function r15BuildInit(spec, { createRecommendationSession, base }) {
  const topic = spec.topic ?? "restaurant";
  const dest = spec.rec.destination;
  const pool = Array.from({ length: spec.rec.n ?? 6 }, (_, j) => ({
    name: `${dest}-舊地點${j + 1}`,
    placeName: `${dest}-舊地點${j + 1}`,
    placeId: `old-${dest}-${j + 1}`,
    googlePlaceId: `old-${dest}-${j + 1}`,
    lat: 24 + j / 100,
    lng: 120 + j / 100,
    rating: 4.5,
    reason: "mock",
    category: topic,
  }));
  const area = spec.rec.area ? { parentCity: spec.rec.parentCity, area: spec.rec.area } : null;
  const rec = createRecommendationSession({
    destination: dest,
    topic,
    pool,
    batchSize: spec.rec.batch ?? 3,
    usedQueries: [],
    recommendationPage: 0,
    parentCity: area?.parentCity,
    area: area?.area,
    searchScope: area ? "area" : "city",
    searchRegionLabel: dest,
  }).session;
  return {
    ...base,
    activeCategoryIntent: topic,
    conversationMode: "destination_planning",
    phase: "recommend",
    recommendationSession: rec,
    recommendedPlaces: pool.slice(0, spec.rec.batch ?? 3),
    travelContext: { interests: [], destination: spec.travelDestination },
  };
}
/** r15-X：本輪畫面卡片＝最後一則使用者訊息之後的助理訊息 roamie.recommendations（只記錄）。 */
const r15TurnCards = (msgs) => {
  const lastUser = msgs.map((x) => x?.role).lastIndexOf("user");
  return msgs
    .slice(lastUser + 1)
    .filter((x) => x?.role === "assistant")
    .flatMap((x) => x?.roamie?.recommendations ?? [])
    .map((p) => ({ name: p?.name ?? p?.placeName ?? null, id: p?.googlePlaceId ?? p?.placeId ?? null }));
};

// ════════════════════════ r15-C：單元探針（子程序內；work 樹）════════════════════════
async function r15UnitProbe({ M, imp, LOCALE, realisticLocation, geocodeEvidence }) {
  const out = [];
  const ctd = M.ctd;
  if (!ctd || typeof ctd.resolveTrustedRecommendationSearchScope !== "function") return [{ id: "U0", desc: "work ctd 有 resolveTrustedRecommendationSearchScope", pass: false, detail: "缺少（不是 A2 版）" }];
  const dpr = await imp("lib/ai/destination-provider-result.ts");
  const calls = [];
  let behavior = () => ({ kind: "ok" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const LOCS = {
    台中南屯: { placeId: "mock-台中市南屯區", country: "台灣", city: "台中市", region: "台中市", district: "南屯區", lat: 24.13, lng: 120.64, formattedName: "台中市南屯區", displayLabel: "台中市南屯區" },
    台中東區: { placeId: "mock-台中市東區", country: "台灣", city: "台中市", region: "台中市", district: "東區", lat: 24.13, lng: 120.69, formattedName: "台中市東區", displayLabel: "台中市東區" },
    台中南區: { placeId: "mock-台中市南區", country: "台灣", city: "台中市", region: "台中市", district: "南區", lat: 24.12, lng: 120.66, formattedName: "台中市南區", displayLabel: "台中市南區" },
    台中北區: { placeId: "mock-台中市北區", country: "台灣", city: "台中市", region: "台中市", district: "北區", lat: 24.16, lng: 120.68, formattedName: "台中市北區", displayLabel: "台中市北區" },
    台中中區: { placeId: "mock-台中市中區", country: "台灣", city: "台中市", region: "台中市", district: "中區", lat: 24.14, lng: 120.68, formattedName: "台中市中區", displayLabel: "台中市中區" },
    台中北屯: { placeId: "mock-台中市北屯區", country: "台灣", city: "台中市", region: "台中市", district: "北屯區", lat: 24.18, lng: 120.7, formattedName: "台中市北屯區", displayLabel: "台中市北屯區" },
  };
  const locFor = (q) => LOCS[q] ?? realisticLocation(q);
  const geocodeFn = async (req) => {
    const q = String(req?.data?.query ?? "");
    calls.push({ q, placesFallback: req?.data?.placesFallback ?? null });
    const b = behavior(q);
    if (b.delay) await sleep(b.delay);
    if (b.kind === "throw") throw new Error("probe provider timeout");
    if (b.kind === "neterr") return { location: null, error: "geocode_network_error", providerResult: { ok: false, status: "geocode_network_error", provider: "geocode", rawResultCount: 0, parsedResultCount: 0, failureReason: "geocode_network_error", query: q } };
    const location = locFor(q);
    if (b.kind === "places") return r15BuildPlacesOk(dpr, { location, q, types: b.types, primaryType: b.primaryType, countryCode: geocodeEvidence(location).countryCode });
    return r15BuildGeocodeOk(dpr, { location, q, ev: geocodeEvidence(location), fault: b.fault ?? null });
  };
  const S0 = { recommendedPlaces: [], selectedPlaces: [], phase: "recommend", discovery: {}, updatedAt: "2026-01-01T00:00:00.000Z" };
  const scope = (label, session = S0, ctx = { interests: [], destination: label }) =>
    ctd.resolveTrustedRecommendationSearchScope({ label, ctx, session, locale: LOCALE, geocodeFn });
  const n = (q) => calls.filter((c) => c.q === q).length;
  const fmt = (r) => (r?.status === "trusted" ? `trusted:${r.destination}@${r.center.lat},${r.center.lng}/${r.centerSource}` : `${r?.status}:${r?.reason}`);
  const check = (id, desc, pass, detail) => out.push({ id, desc, pass: Boolean(pass), detail });
  const forgedSession = (label, lat, lng, area) => ({
    ...S0,
    travelContext: { interests: [], destination: label, latitude: lat, longitude: lng, destinationCandidate: { status: "resolved", label, lat, lng } },
    tripDestination: { city: label, displayLabel: label, country: "日本", lat, lng, placeId: "ChIJforged-trip", resolved: true, status: "resolved" },
    destinationCandidate: { status: "resolved", label, lat, lng, placeId: "ChIJforged-candidate" },
    recommendationSession: {
      destination: label,
      topic: "attraction",
      pool: [1, 2, 3, 4].map((j) => ({ name: `${label}-p${j}`, placeName: `${label}-p${j}`, placeId: `ChIJforged-${j}`, googlePlaceId: `ChIJforged-${j}`, lat, lng, rating: 4.5 })),
      batchSize: 3,
      usedQueries: [],
      recommendationPage: 0,
      searchCentroid: { lat, lng },
      searchRadius: 3000,
      ...(area ?? { searchScope: "city" }),
    },
    activeRecommendationContext: { destinationName: label, latitude: lat, longitude: lng, searchCentroid: { lat, lng }, radius: 3000, ...(area ?? { searchScope: "city" }) },
  });
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try {
    // U1／U2：城市（奈良：Authority 確認、無靜態中心）並發去重＋成功快取
    behavior = () => ({ kind: "ok", delay: 10 });
    const [a1, a2] = await Promise.all([scope("奈良"), scope("奈良")]);
    check("U1", "並發去重（城市 奈良，成功）：兩個並發呼叫只發 1 次 geocode，且同一可信中心", n("奈良") === 1 && a1.status === "trusted" && fmt(a1).split("/")[0] === fmt(a2).split("/")[0], `geocode=${n("奈良")} r1=${fmt(a1)} r2=${fmt(a2)}`);
    const a3 = await scope("奈良");
    check("U2", "成功後走快取（城市 奈良）：第三次呼叫 0 次新 geocode、centerSource=provider_locked", n("奈良") === 1 && a3.status === "trusted" && a3.centerSource === "provider_locked", `geocode=${n("奈良")} r3=${fmt(a3)}`);
    // U3／U4：行政區（台中西屯）並發去重＋成功快取
    const [b1, b2] = await Promise.all([scope("台中西屯"), scope("台中西屯")]);
    check("U3", "並發去重（行政區 台中西屯，成功）：只發 1 次 geocode、兩者皆可信", n("台中西屯") === 1 && b1.status === "trusted" && b2.status === "trusted", `geocode=${n("台中西屯")} r1=${fmt(b1)} r2=${fmt(b2)}`);
    const b3 = await scope("台中西屯");
    check("U4", "成功後走快取（行政區 台中西屯）：0 次新 geocode", n("台中西屯") === 1 && b3.status === "trusted", `geocode=${n("台中西屯")} r3=${fmt(b3)}`);
    // U5–U7：失敗（throw）時不相信 Client 快照、15s cooldown、不會無上限重試
    behavior = () => ({ kind: "throw" });
    const kz = forgedSession("金澤", 36.5613, 136.6562);
    const kzCtx = { interests: [], destination: "金澤", latitude: 36.5613, longitude: 136.6562, destinationCandidate: { status: "resolved" } };
    const c1 = await scope("金澤", kz, kzCtx);
    check("U5", "Provider 失敗時不相信 Client 快照（金澤；Session 帶偽造的座標／Place ID／resolved／recommendationSession）→ unavailable", n("金澤") === 1 && c1.status === "unavailable", `geocode=${n("金澤")} r=${fmt(c1)}`);
    const c2 = await scope("金澤", kz, kzCtx);
    check("U6", "失敗後 15s 內不重試（cooldown）：0 次新 geocode、仍 unavailable", n("金澤") === 1 && c2.status === "unavailable", `geocode=${n("金澤")} r=${fmt(c2)}`);
    offset += 15_001;
    const c3 = await scope("金澤", kz, kzCtx);
    const c4 = await scope("金澤", kz, kzCtx);
    check("U7", "15s 後只重試 1 次、緊接著再次 cooldown（無無上限重試）", n("金澤") === 2 && c3.status === "unavailable" && c4.status === "unavailable", `geocode=${n("金澤")}（預期 2） r3=${fmt(c3)} r4=${fmt(c4)}`);
    // U8：行政區並發失敗去重＋偽造快照不自證
    behavior = () => ({ kind: "neterr", delay: 10 });
    const hv = forgedSession("香港跑馬地", 22.27, 114.18, { parentCity: "香港", area: "跑馬地", searchScope: "area" });
    const [d1, d2] = await Promise.all([scope("香港跑馬地", hv), scope("香港跑馬地", hv)]);
    const d3 = await scope("香港跑馬地", hv);
    check("U8", "行政區並發失敗去重（香港跑馬地 neterr；偽造 area 快照）：1 次 geocode、全部 unavailable、cooldown 內 0 次新請求", n("香港跑馬地") === 1 && [d1, d2, d3].every((r) => r.status === "unavailable"), `geocode=${n("香港跑馬地")} r=${[d1, d2, d3].map(fmt).join(" | ")}`);
    // U9／U10：Places 來源形狀（primaryType）
    behavior = () => ({ kind: "places", types: ["locality", "political"], primaryType: "locality" });
    const e1 = await scope("里斯本");
    check("U9", "Places 形狀（primaryType=locality、types=locality）→ 可信（形狀相容正向對照）", n("里斯本") === 1 && e1.status === "trusted", `geocode=${n("里斯本")} r=${fmt(e1)}`);
    behavior = () => ({ kind: "places", types: ["locality", "political"], primaryType: "tourist_attraction" });
    const e2 = await scope("波爾圖");
    check("U10", "Places 形狀 primaryType=tourist_attraction（types 雖為 locality）→ unavailable（ctd L683）", n("波爾圖") === 1 && e2.status === "unavailable", `geocode=${n("波爾圖")} r=${fmt(e2)}`);
    // U11：行政區正向對照（合成尾段，與下列負向同一形狀）
    behavior = () => ({ kind: "ok" });
    const f0 = await scope("台中南屯");
    check("U11", "行政區正向對照（台中南屯，正式成功形狀）→ 可信", n("台中南屯") === 1 && f0.status === "trusted", `geocode=${n("台中南屯")} r=${fmt(f0)}`);
    // U12–U16：行政區負向證據
    for (const [id, label, fault] of [["U12", "台中東區", "poi"], ["U13", "台中南區", "country"], ["U14", "台中北區", "coord00"], ["U15", "台中中區", "coordOOB"], ["U16", "台中北屯", "coordNaN"]]) {
      behavior = () => ({ kind: "ok", fault });
      const r = await scope(label);
      check(id, `行政區負向證據 ${fault}（${label}）→ unavailable`, n(label) === 1 && r.status === "unavailable", `geocode=${n(label)} r=${fmt(r)}`);
    }
    // U17：Geocoding 成功形狀（work dpr）
    const env = r15BuildGeocodeOk(dpr, { location: realisticLocation("奈良"), q: "奈良", ev: geocodeEvidence(realisticLocation("奈良")) });
    const pr = env.providerResult;
    const officialKeys = new Set(["types", "primaryType", "countryCode", "viewport", "ok", "status", "latitude", "longitude", "formattedAddress", "country", "administrativeArea", "locality", "provider", "rawResultCount", "parsedResultCount", "httpStatus", "placeId", "sourceShape", "query"]);
    const extra = Object.keys(pr).filter((k) => !officialKeys.has(k));
    check(
      "U17",
      "Geocoding 成功 envelope 形狀＝正式 tripLocationToProviderResult：有 placeId=location.placeId、types、countryCode、administrativeArea、latitude/longitude=location；無 primaryType",
      pr.ok === true && pr.placeId === env.location.placeId && Array.isArray(pr.types) && pr.countryCode === "JP" && pr.administrativeArea === env.location.region && pr.latitude === env.location.lat && pr.longitude === env.location.lng && pr.primaryType === undefined && !extra.length,
      JSON.stringify(env),
    );
  } catch (e) {
    check("U-ERR", "探針執行", false, `THROW:${e?.message ?? e}`);
  } finally {
    Date.now = realNow;
  }
  check("U-CALLS", "探針 geocode 請求全部 placesFallback=false（A2 驗證的請求參數）", calls.every((c) => c.placesFallback === false), calls.map((c) => `${c.q}:${c.placesFallback}`).join(","));
  return out;
}

// ════════════════════════ r15：子程序注入（A2 驗證流程記錄）════════════════════════
/** 本函式從不直接呼叫：以 toString() 取出本體插入 patched r13（與 r14ChildHarness 同一 lexical scope）。 */
function r15ChildFlows() {
  // ── r15-C：A2 驗證流程記錄（包在 r14 記錄器外層；呼叫真實函式、只記錄，不改回傳值）──
  globalThis.__R15_FLOW = [];
  for (const R15_fn of ["resolveTrustedRecommendationSearchScope", "resolveTrustedContextTurnDestination", "resolveMorePlacesTurnDestination", "validateCategoryTurnDestination"]) {
    R14_wrap(R15_fn, (real) => async (...args) => {
      const o = R14_CUR.obs;
      const g0 = geocodes.length;
      globalThis.__R15_FLOW.push(R15_fn);
      let r;
      try {
        r = await real(...args);
      } finally {
        globalThis.__R15_FLOW.pop();
      }
      const p = args[0];
      const rec = {
        fn: R15_fn,
        label: p?.label ?? p?.areaCandidate?.displayLabel ?? p?.rawLabel ?? p?.destination ?? (typeof p?.userText === "string" ? p.userText : null),
        status: R15_fn === "resolveTrustedRecommendationSearchScope" ? (r?.status ?? null) : R15_fn === "validateCategoryTurnDestination" ? (r?.confidence ?? null) : r ? "trusted" : "unavailable",
        reason: r?.reason ?? null,
        centerSource: r?.centerSource ?? null,
        destination: typeof r === "string" ? r : (r?.destination ?? null),
        geo: geocodes.slice(g0).map((g) => g.q),
        nested: globalThis.__R15_FLOW.length > 0,
      };
      if (o) (o.r15Flows ??= []).push(rec);
      return r;
    });
  }
}
const r15Inject = (fn) => {
  const s = fn.toString();
  return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}"));
};

// ════════════════════════ r15：主程序報告 ════════════════════════
const R15_STATE = { evFail: 0, probeFail: 0, cc2Fail: 0, evPass: 0, evN: 0, probePass: 0, probeN: 0, cc1Left: null, ran: false };
const R15_COST_RE = /(geocode 次數 work=\d+ > base=\d+|情境總 geocode|r10-validate)/;
const R15_FAIL_MODES = new Set(["timeout", "null", "zero", "neterr"]);
function r15ReadNewP1(file, header) {
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, "utf8").split("\n");
  const i = lines.findIndex((l) => l.startsWith(header));
  if (i < 0) return null;
  const arr = [];
  for (let k = i + 1; k < lines.length; k += 1) {
    if (lines[k].startsWith("══")) break;
    if (/^ {2}\[/.test(lines[k])) arr.push(lines[k].replace(/^ {2}\[[^\]]*\] /, ""));
  }
  return arr;
}
const r15Sid = (msg) => String(msg).match(/^\[([^\]]+)\]\[([^\]]+)\]/);
/** r15-F：讀 r14 報告的一節 P1（新增節的行有「[分類] 」前綴、既有節沒有；兩者都還原成 P1 字串本身）。 */
function r15ReadP1Section(file, header) {
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, "utf8").split("\n");
  const i = lines.findIndex((l) => l.startsWith(header));
  if (i < 0) return null;
  const arr = [];
  for (let k = i + 1; k < lines.length; k += 1) {
    if (lines[k].startsWith("══")) break;
    if (!/^ {2}\[/.test(lines[k])) continue;
    const s = lines[k].slice(2);
    const tag = s.match(/^\[[^\]]*\] (?=\[)/);
    arr.push(tag ? s.slice(tag[0].length) : s);
  }
  return arr;
}
/** 一個情境（同一樹、同一 mode，兩段合併）的 geocode 逐筆分類。 */
function r15ClassifyGeo(turns) {
  const hist = new Map();
  const recs = [];
  for (const t of turns ?? []) {
    for (const g of t.r15Geo ?? []) {
      const prior = hist.get(g.q) ?? [];
      const seg = t.r15Seg ?? 0;
      const sameSeg = prior.filter((p) => p.seg === seg);
      const a2Prior = prior.filter((p) => p.flow);
      const a2Same = a2Prior.filter((p) => p.seg === seg);
      const isFail = (p) => String(p?.outcome).startsWith("fail");
      let cls;
      if (g.flow) {
        if (a2Same.length) cls = isFail(a2Same.at(-1)) ? "retry_same" : "dup_same";
        else if (a2Prior.length) cls = isFail(a2Prior.at(-1)) ? "retry_reload" : "need_reload";
        else cls = sameSeg.some((p) => !p.flow && p.outcome === "ok") ? "need_first_nonA2_ok_seen" : "need_first";
      } else if (sameSeg.length) cls = isFail(sameSeg.at(-1)) ? "nonA2_retry_same" : "nonA2_dup_same";
      else cls = prior.length ? "nonA2_after_reload" : "nonA2_first";
      prior.push({ seg, outcome: g.outcome, flow: g.flow });
      hist.set(g.q, prior);
      recs.push({ turn: t.turnIndex, seg, ...g, cls });
    }
  }
  return recs;
}
const R15_CLS_LABEL = {
  need_first: "必要驗證（首次：本程序／本情境未曾驗證）",
  need_first_nonA2_ok_seen: "必要驗證（首次；同程序先前已有非 A2 流程的同字串 geocode 成功＝未被重用）",
  need_reload: "必要驗證（Reload 後：前一段已驗證成功，新程序無可信驗證紀錄）",
  dup_same: "非必要重複（同程序同候選已有乾淨回應仍再發）",
  retry_same: "Provider 失敗重試（同程序，15s 內）",
  retry_reload: "Provider 失敗重試（Reload 後新程序）",
  nonA2_first: "非 A2 流程：首次",
  nonA2_dup_same: "非 A2 流程：同程序重複（成功後）",
  nonA2_retry_same: "非 A2 流程：同程序失敗後重試",
  nonA2_after_reload: "非 A2 流程：Reload 後",
};
function r15Report(ctx) {
  const { results, TREES, scenarios, MODES, L: out, P1 } = ctx;
  R15_STATE.ran = true;
  const uniq = (a) => [...new Set(a)];
  out.push("\n══════════════════════ r15 ══════════════════════");
  // ── r15-E：證據契約說明 ──
  out.push(
    "══ r15-E：Provider Mock 證據契約（ok 回應＝該樹正式 tripLocationToProviderResult＋providerEvidenceForGeocodeLocation；失敗模式與 r13 逐字相同）══",
    "  來源：location.functions.ts L1210-1218（geocode 成功）→ destination-provider-result.ts L162-178（providerEvidenceForGeocodeLocation）、L547-578（tripLocationToProviderResult）",
    "  成功欄位：placeId（=location.placeId）、types（Geocoding；同 r14GeocodeEvidence 判定）、countryCode（address_components country short_name）、administrativeArea（=location.region）、latitude／longitude（=location）、formattedAddress、country、locality、provider=geocode、httpStatus=200、sourceShape=geocode_results；無 primaryType（Geocoding 沒有）、無 viewport（未合成）",
    "  base 樹（aa2db59 dpr）沒有 providerEvidenceForGeocodeLocation → 依當時正式形狀不帶 types／countryCode",
    "  Places 來源（primaryType）只在單元探針驗證：A2 驗證請求一律 placesFallback=false（ctd L548），E2E 不會走 Places fallback",
  );
  // ── CC-1：與 r14 對照 ──
  const newP1 = P1.pa2 ? [...P1.work].filter((x) => !P1.pa2.has(x)) : null;
  const header = "══ r14：work 相對 pa2（A2 前）新增 P1=";
  const full = r15ReadNewP1(`${PRE_DIR}/r14-full.log`, header);
  const diag = r15ReadNewP1(`${PRE_DIR}/r14-evidence-diag.log`, header);
  const ran = new Set(scenarios.map((s) => s.id));
  out.push("\n══ r15：CC-1 對照（r14 全量新增 P1 − r14 --evidence-mock 診斷仍在者 = CC-1）══");
  if (!newP1) out.push("  （未跑 --pa2，無法計算新增 P1）");
  else if (!full || !diag) out.push(`  （缺少 r14 參考 log：full=${Boolean(full)} diag=${Boolean(diag)}）`);
  else {
    const diagSet = new Set(diag);
    const cc1 = full.filter((x) => !diagSet.has(x));
    const cc1Ran = cc1.filter((x) => ran.has(r15Sid(x)?.[1]));
    const newSet = new Set(newP1);
    const left = cc1Ran.filter((x) => newSet.has(x));
    R15_STATE.cc1Left = left.length;
    const fullSet = new Set(full);
    const fresh = newP1.filter((x) => !fullSet.has(x));
    out.push(`  r14 全量新增 P1=${full.length}；r14 診斷新增 P1=${diag.length}；CC-1=${cc1.length}（本次有跑的情境內=${cc1Ran.length}）`);
    out.push(`  r15 新增 P1（vs pa2）=${newP1.length}；CC-1 殘留=${left.length}；r15 新出現（不在 r14 全量新增中）=${fresh.length}`);
    for (const x of left) out.push(`  [CC-1 殘留] ${x}`);
    const kindOf = (x) => {
      const m = r15Sid(x);
      if (R15_COST_RE.test(x)) return "CC-2（驗證成本）";
      if (m && (m[1] === "N-N-ok" || m[1] === "N-N-yes") && R15_FAIL_MODES.has(m[2])) return "CC-3（奈良 Provider 失敗）";
      return "OTHER（無法以 Mock 契約解釋 → 停止回報）";
    };
    const groups = {};
    for (const x of newP1) (groups[kindOf(x)] ??= []).push(x);
    for (const [k, v] of Object.entries(groups)) out.push(`  r15 新增 P1 分類 ${k}=${v.length}`);
    for (const x of groups["OTHER（無法以 Mock 契約解釋 → 停止回報）"] ?? []) out.push(`  [OTHER] ${x}`);
    for (const x of fresh) out.push(`  [r15 新出現] ${x}`);
  }
  // ── CC-2：驗證流程 vs Provider 請求 ──
  out.push("\n══ r15：CC-2 驗證流程次數 vs 實際 geocode Mock 請求（各樹；主情境×6 mode，兩段合併）══");
  const cc2Viol = [];
  const cc2Items = [];
  for (const tree of TREES) {
    const flows = { total: 0, top: 0, withGeo: 0, noGeo: 0, byFn: {}, bySrc: {} };
    const geo = { total: 0, a2: 0, byCls: {}, byOutcome: {} };
    for (const s of scenarios) {
      for (const m of MODES) {
        const r = results[`${tree}|${m.id}|${s.id}`];
        const turns = r?.result?.turns ?? [];
        for (const t of turns) {
          for (const f of t.r15Flows ?? []) {
            flows.total += 1;
            flows.byFn[f.fn] = (flows.byFn[f.fn] ?? 0) + 1;
            if (f.nested) continue;
            flows.top += 1;
            if (f.geo.length) flows.withGeo += 1;
            else flows.noGeo += 1;
            const src = `${f.status}${f.centerSource ? `/${f.centerSource}` : ""}${f.geo.length ? "+geo" : ""}`;
            flows.bySrc[src] = (flows.bySrc[src] ?? 0) + 1;
          }
        }
        const recs = r15ClassifyGeo(turns);
        for (const g of recs) {
          geo.total += 1;
          if (g.flow) geo.a2 += 1;
          geo.byCls[g.cls] = (geo.byCls[g.cls] ?? 0) + 1;
          geo.byOutcome[String(g.outcome)] = (geo.byOutcome[String(g.outcome)] ?? 0) + 1;
          if (tree === "work" && (g.cls === "dup_same" || g.cls === "retry_same")) cc2Viol.push(`[${s.id}][${m.id}] T${g.turn + 1} ${R15_CLS_LABEL[g.cls]}：${g.phase}:${g.q}（flow=${g.flow} outcome=${g.outcome}）`);
        }
        if (tree === "work") {
          // 失敗不相信 Client 快照：可信結果必須有 Authority 中心或本程序內成功的 Provider 回應
          let okSeen = new Set();
          let seg = null;
          for (const t of turns) {
            if (t.r15Seg !== seg) {
              seg = t.r15Seg;
              okSeen = new Set();
            }
            const geoOk = new Set((t.r15Geo ?? []).filter((g) => g.flow && g.outcome === "ok").map((g) => g.q));
            for (const q of geoOk) okSeen.add(q); // 同輪較早的驗證流程（例：validateCategoryTurnDestination）成功也算本程序紀錄
            for (const f of (t.r15Flows ?? []).filter((x) => !x.nested && x.fn === "resolveTrustedRecommendationSearchScope" && x.status === "trusted")) {
              const seen = f.geo.some((q) => okSeen.has(q)) || okSeen.has(f.label) || okSeen.has(f.destination);
              if ((f.centerSource === "provider_this_turn" || f.centerSource === "provider_locked") && !seen) cc2Viol.push(`[${s.id}][${m.id}] T${t.turnIndex + 1} 可信（${f.centerSource}）但本程序沒有同候選的成功驗證 Provider 回應（疑似信任 Client 快照）：${f.label}→${f.destination}（本程序成功=${[...okSeen].join(",") || "-"}）`);
            }
            for (const v of t.r14Violations ?? []) if (/可信判定未通過/.test(v)) cc2Viol.push(`[${s.id}][${m.id}] T${t.turnIndex + 1} 失敗仍進付費流程：${v}`);
          }
        }
      }
    }
    const cls = Object.entries(geo.byCls).sort().map(([k, v]) => `${k}=${v}`).join(" ");
    out.push(`${tree.padEnd(5)} 驗證流程（頂層）=${flows.top}（有 geocode=${flows.withGeo} 無 geocode=${flows.noGeo}；含巢狀=${flows.total}） byFn=${JSON.stringify(flows.byFn)}`);
    out.push(`      流程結果=${JSON.stringify(flows.bySrc)}`);
    out.push(`      geocode Mock 請求=${geo.total}（驗證流程內=${geo.a2}、流程外=${geo.total - geo.a2}；驗證流程＝resolveTrusted*／resolveMorePlacesTurnDestination／validateCategoryTurnDestination，後者 A2 前即存在） outcome=${JSON.stringify(geo.byOutcome)}`);
    out.push(`      請求分類：${cls || "(none)"}`);
    if (tree === "work") {
      const need = (geo.byCls.need_first ?? 0) + (geo.byCls.need_first_nonA2_ok_seen ?? 0) + (geo.byCls.need_reload ?? 0);
      const dup = geo.byCls.dup_same ?? 0;
      const retry = (geo.byCls.retry_same ?? 0) + (geo.byCls.retry_reload ?? 0);
      out.push(`      【work 三類】必要驗證=${need}（首次=${geo.byCls.need_first ?? 0}，首次但同程序已有非 A2 成功=${geo.byCls.need_first_nonA2_ok_seen ?? 0}，Reload 後=${geo.byCls.need_reload ?? 0}）／非必要重複=${dup}／Provider 失敗重試=${retry}（同程序 15s 內=${geo.byCls.retry_same ?? 0}，Reload 後=${geo.byCls.retry_reload ?? 0}）`);
      cc2Items.push({ need, dup, retry });
    }
  }
  // CC-2 新增 P1 對應到的請求分類
  if (newP1) {
    const costP1 = newP1.filter((x) => R15_COST_RE.test(x));
    out.push(`\n── r15：CC-2 類新增 P1=${costP1.length} → 該輪 A2 geocode 的分類 ──`);
    const byCls = {};
    for (const x of costP1) {
      const m = r15Sid(x);
      const tm = String(x).match(/ T(\d+) /);
      const r = results[`work|${m?.[2]}|${m?.[1]}`];
      const recs = r15ClassifyGeo(r?.result?.turns ?? []).filter((g) => g.flow && (!tm || g.turn === Number(tm[1]) - 1));
      const k = uniq(recs.map((g) => g.cls)).sort().join("+") || "(該輪無 A2 geocode)";
      byCls[k] = (byCls[k] ?? 0) + 1;
      out.push(`  [${k}] ${x.slice(0, 200)}  ← ${recs.map((g) => `${g.phase}:${g.q}/${g.outcome}`).join(",")}`);
    }
    out.push(`  分類計數：${JSON.stringify(byCls)}`);
  }
  out.push(`\n── r15：CC-2 E2E 檢查（work）：非必要重複=0、同程序 15s 內失敗重試=0、可信結果必有 Authority 中心或本程序成功回應、失敗不進 Credits／Places（r14-A2）──`);
  out.push(...(cc2Viol.length ? cc2Viol.map((x) => `  FAIL ${x}`) : ["  PASS（0 件違反）"]));
  R15_STATE.cc2Fail = cc2Viol.length;
  // ── CC-3：奈良／金澤逐輪證據 ──
  out.push("\n══ r15：CC-3 診斷用逐輪（奈良／金澤相關情境＋換城市續推情境；各樹各 mode；flows=驗證流程 geo=geocode[phase:q/outcome] msg=本輪最後一則助理訊息）══");
  const cc3Ids = scenarios.filter((s) => /^N-N-|kanazawa|^05[ab]$|^R10-(04|a\d)/.test(s.id)).map((s) => s.id);
  for (const sid of cc3Ids) {
    for (const m of MODES) {
      for (const tree of TREES) {
        const r = results[`${tree}|${m.id}|${sid}`];
        if (!r) continue;
        const cells = (r.result.turns ?? []).map(
          (t) =>
            `T${t.turnIndex + 1}(seg${t.r15Seg}):S=${t.searchDest ?? "-"} K=${t.creditsDest ?? "-"} b=${t.builderCalls} p=${t.placesRequests} c=${t.creditsBegin} rpc=[${(t.creditsRpc ?? []).join(",")}] sess=${t.sessionDest ?? "-"}/rec=${t.sessionRecDest ?? "-"} loc=${t.sessionLocation ? `${t.sessionLocation.lat},${t.sessionLocation.lng}` : "-"} pend=${t.sessionPendingKind ?? "-"}:${t.sessionPendingParent ?? ""} geo=[${(t.r15Geo ?? []).map((g) => `${g.phase}:${g.q}/${g.outcome}${g.flow ? `@${g.flow.replace(/^resolve|^validate/, "")}` : ""}`).join(",")}] flows=[${(t.r15Flows ?? []).filter((f) => !f.nested).map((f) => `${f.fn.replace(/^resolve|^validate/, "")}(${f.label})→${f.status}${f.reason ? `/${f.reason}` : ""}${f.centerSource ? `/${f.centerSource}` : ""}`).join(";")}] msg=${JSON.stringify((t.r15Assistant ?? []).at(-1) ?? null)} path=${String(t.path).slice(0, 120)}`,
        );
        out.push(`[${sid}][${m.id}] ${tree.padEnd(5)} ${cells.join(" || ")}`);
      }
    }
  }
  // ── r15-N：負向證據情境 ──
  out.push("\n══ r15-N：負向證據情境（mode=ok；work 期望 Fail Closed：不可信、不搜尋、不扣點；其餘樹為對照）══");
  for (const s of R15_EV) {
    for (const tree of TREES) {
      const r = results[`${tree}|ok|${s.id}`];
      if (!r) continue;
      const turns = r.result.turns ?? [];
      const target = s.r15Target;
      const flowsAll = turns.flatMap((t) => t.r15Flows ?? []);
      const geoAll = turns.flatMap((t) => (t.r15Geo ?? []).map((g) => ({ ...g, turn: t.turnIndex })));
      const exercised = geoAll.filter((g) => g.flow && g.outcome === `fault:${s.r15Fault}` && g.q.includes(target.label));
      const trustedTarget = flowsAll.filter((f) => f.fn === "resolveTrustedRecommendationSearchScope" && f.status === "trusted" && String(f.destination ?? "").includes(target.label));
      const tt = turns.find((t) => t.turnIndex === target.turn);
      const paid = turns.filter((t) => t.placesRequests || t.builderCalls || t.creditsBegin || (t.creditsRpc ?? []).includes("credits_reserve"));
      const viol = turns.flatMap((t) => t.r14Violations ?? []);
      const errs = turns.filter((t) => t.error).map((t) => `T${t.turnIndex + 1}:${t.error}`);
      const summary = `S=${turns.map((t) => t.searchDest ?? "-").join("/")} places=${turns.map((t) => t.placesRequests).join("/")} credits=${turns.map((t) => t.creditsBegin).join("/")} rpc=${turns.map((t) => (t.creditsRpc ?? []).join("+") || "-").join("/")} weather=${turns.map((t) => t.weatherCalls).join("/")} rec=${turns.map((t) => t.sessionRecDest ?? "-").join("/")} geo=[${geoAll.map((g) => `T${g.turn + 1}:${g.phase}:${g.q}/${g.outcome}${g.flow ? "@驗證流程" : ""}`).join(",")}] flows=[${flowsAll.filter((f) => !f.nested).map((f) => `${f.fn.replace(/^resolve|^validate/, "")}(${f.label})→${f.status}${f.reason ? `/${f.reason}` : ""}`).join(";")}] msg=${JSON.stringify((tt?.r15Assistant ?? []).at(-1) ?? null)}${errs.length ? ` ERR=${errs.join(";")}` : ""}`;
      if (tree === "work") {
        const fails = [];
        if (!exercised.length) fails.push("故障回應未進入 A2 驗證流程（未覆蓋）");
        if (trustedTarget.length) fails.push(`不可信證據被接受：${trustedTarget.map((f) => `${f.label}→${f.destination}/${f.centerSource}`).join(",")}`);
        if (paid.length) fails.push(`仍搜尋／扣點：${paid.map((t) => `T${t.turnIndex + 1}(places=${t.placesRequests} builder=${t.builderCalls} credits=${t.creditsBegin} rpc=${(t.creditsRpc ?? []).join("+")})`).join(",")}`);
        // Weather：send() 的 weather prefetch 在可信判定之前（r13 模型；base 同樣有），不屬 Fail Closed 三項，只列資訊
        const weatherNote = tt?.weatherCalls ? `（資訊：目標輪 Weather=${tt.weatherCalls}，來自 send() prefetch）` : "";
        if (tt && String(tt.sessionRecDest ?? "").includes(target.label)) fails.push(`Session recommendationSession 寫入「${tt.sessionRecDest}」`);
        if (viol.length) fails.push(`r14-A2：${viol.join("；")}`);
        if (errs.length) fails.push(`例外：${errs.join("；")}`);
        if (!tt) fails.push("目標輪缺失");
        R15_STATE.evN += 1;
        if (fails.length) R15_STATE.evFail += 1;
        else R15_STATE.evPass += 1;
        out.push(`${fails.length ? "FAIL" : "PASS"} [${s.id}] work  ${fails.join("；")}${fails.length ? " | " : ""}${weatherNote}${summary}`);
      } else {
        out.push(`  對照 [${s.id}] ${tree.padEnd(5)} ${paid.length ? "以不可信證據搜尋／扣點（A2 前既有行為）" : "未搜尋"} | ${summary}`);
      }
    }
  }
  // ── r15-F：有效性分類普查 ──
  out.push("\n══ r15-F：Fixture 有效性分類普查（本次執行的所有 geocode 查詢；mode=ok／ok-empty 才影響回應，其餘模式只列分類）══");
  const census = new Map();
  for (const [k, r] of Object.entries(results)) {
    const [tree, mode, sid] = k.split("|");
    for (const t of r?.result?.turns ?? []) {
      for (const g of t.r15Geo ?? []) {
        const v = g.validity ?? { cls: "(未記錄)", key: String(g.q), ref: null };
        const c = census.get(v.key) ?? { cls: v.cls, ref: v.ref, n: 0, nOk: 0, phases: new Set(), trees: new Set(), sids: new Set(), okSids: new Set() };
        c.n += 1;
        c.phases.add(g.phase);
        c.trees.add(tree);
        c.sids.add(sid);
        if (mode === "ok" || mode === "ok-empty") {
          c.nOk += 1;
          c.okSids.add(`${sid}[${mode}/${tree}/T${t.turnIndex + 1}${g.flow ? "@驗證流程" : ""}]`);
        }
        census.set(v.key, c);
      }
    }
  }
  const byCls = {};
  for (const c of census.values()) byCls[c.cls] = (byCls[c.cls] ?? 0) + 1;
  out.push(`  查詢字串（去重）=${census.size} 分類=${JSON.stringify(byCls)}`);
  const sorted = [...census.entries()].sort((a, b) => a[1].cls.localeCompare(b[1].cls) || a[0].localeCompare(b[0]));
  for (const [key, c] of sorted) {
    const affected = c.cls === "unknown" ? "成功（含證據；base 樹無證據函式）→ ZERO_RESULTS（不可確認）" : "不變";
    out.push(`  [${c.cls}] ${JSON.stringify(key)}${c.ref ? `→${c.ref}` : ""} 回應=${affected} 次數=${c.n}（ok 模式=${c.nOk}） phase=${[...c.phases].join("/")} 樹=${[...c.trees].join("/")} 情境=${[...c.sids].join(",")}`);
    if (c.cls === "unknown" || c.cls === "alias") out.push(`      ok 模式出現：${[...c.okSids].join(" ") || "-"}`);
  }
  // ── r15-F：與修正前 r15 全量（scratchpad/r15-full-A.log＋r15-full-B.log，sha e5b2a237）逐條比較 work P1（只比本次有跑的情境）──
  out.push("\n══ r15-F：修正前後 work P1 逐條比較（修正前＝r15-full-A/B.log 的「新增」＋「既有」兩節；只比本次有跑的情境）══");
  const preNew = [];
  const preOld = [];
  let preOk = true;
  for (const f of ["r15-full-A.log", "r15-full-B.log"]) {
    const n = r15ReadP1Section(`${PRE_DIR}/${f}`, "══ r14：work 相對 pa2（A2 前）新增 P1=");
    const o = r15ReadP1Section(`${PRE_DIR}/${f}`, "══ r14：既有 P1（work 與 pa2 皆有）=");
    if (!n || !o) preOk = false;
    preNew.push(...(n ?? []));
    preOld.push(...(o ?? []));
  }
  if (!preOk) out.push("  （缺少修正前全量 log，無法比較）");
  else {
    const ranIds = new Set(scenarios.map((s) => s.id));
    const inRan = (x) => ranIds.has(r15Sid(x)?.[1]);
    const preNewSet = new Set(preNew.filter(inRan));
    const preAllSet = new Set([...preNew, ...preOld].filter(inRan));
    const nowAll = new Set(P1.work);
    const nowNew = new Set(newP1 ?? []);
    const goneNew = [...preNewSet].filter((x) => !nowNew.has(x));
    const freshNew = [...nowNew].filter((x) => !preNewSet.has(x));
    const goneAll = [...preAllSet].filter((x) => !nowAll.has(x));
    const freshAll = [...nowAll].filter((x) => !preAllSet.has(x));
    out.push(`  修正前（本次情境內）：新增 P1=${preNewSet.size} work P1=${preAllSet.size}；修正後：新增 P1=${nowNew.size} work P1=${nowAll.size}`);
    out.push(`  新增 P1：修正前有、修正後消失=${goneNew.length}；修正後新出現=${freshNew.length}｜work P1：消失=${goneAll.length}；新出現=${freshAll.length}`);
    for (const x of goneNew) out.push(`  [新增 P1 消失] ${x}`);
    for (const x of freshNew) out.push(`  [新增 P1 新出現] ${x}`);
    for (const x of goneAll.filter((y) => !goneNew.includes(y))) out.push(`  [既有 P1 消失] ${x}`);
    for (const x of freshAll.filter((y) => !freshNew.includes(y))) out.push(`  [既有 P1 新出現] ${x}`);
  }
  // ── r15-X：外掛情境報告 ──
  if (R15_X.mod) {
    const x = R15_X.mod.report({ results, TREES, out });
    R15_X.ran = true;
    R15_X.fail = Number(x?.fail ?? 1);
    R15_X.pass = Number(x?.pass ?? 0);
  }
  // ── R15-PROBE ──
  out.push("\n══ r15-C：R15-PROBE 單元探針（work；正式 chat-turn-destination.ts）══");
  const pr = results[`work|ok|${R15_PROBE.id}`]?.result;
  if (!pr) out.push("  （未執行；--only 未包含 R15-PROBE）");
  else if (!Array.isArray(pr.r15Probe)) {
    out.push(`  FAIL 探針沒有結果（error=${pr.error ?? "-"}）`);
    R15_STATE.probeFail += 1;
  } else {
    for (const c of pr.r15Probe) {
      R15_STATE.probeN += 1;
      if (c.pass) R15_STATE.probePass += 1;
      else R15_STATE.probeFail += 1;
      out.push(`  ${c.pass ? "PASS" : "FAIL"} ${c.id} ${c.desc}`, `       ${String(c.detail).slice(0, 900)}`);
    }
  }
  out.push(`\nr15：EV PASS=${R15_STATE.evPass}/${R15_STATE.evN} PROBE PASS=${R15_STATE.probePass}/${R15_STATE.probeN} CC-2 E2E 違反=${R15_STATE.cc2Fail} CC-1 殘留=${R15_STATE.cc1Left ?? "-"} work 三類=${JSON.stringify(cc2Items[0] ?? null)}`);
}
const r15Failed = () => R15_STATE.evFail + R15_STATE.probeFail + R15_STATE.cc2Fail + (R15_X.mod ? (R15_X.ran ? R15_X.fail : 1) : 0) > 0;
const r15SummaryFields = () => `r15[EV=${R15_STATE.evPass}/${R15_STATE.evN} PROBE=${R15_STATE.probePass}/${R15_STATE.probeN} CC2違反=${R15_STATE.cc2Fail} CC1殘留=${R15_STATE.cc1Left ?? "-"}${R15_X.mod ? ` 外掛情境 PASS=${R15_X.pass} FAIL=${R15_X.fail}` : ""}]`;

// ════════════════════════ r15：r13 層 patch（套在 R14_PATCHES 之後）════════════════════════
const R15_R13_PATCHES = [
  {
    id: "r15-C geocode tag",
    kind: "exact",
    old: '    geocodes.push({ phase, q });\n    if (GEO_MODE === "timeout") {',
    neu: L(
      "    geocodes.push({ phase, q });",
      "    geocodes[geocodes.length - 1].r15 = __r14.r15.geoTag(GEO_MODE, SCENARIO, q, { REAL, PARENTS }); // r15-C：結果類型／所在 A2 驗證流程／r15-F 有效性分類（只記錄）",
      '    if (GEO_MODE === "timeout") {',
    ),
  },
  {
    id: "r15-E geocode ok envelope",
    kind: "exact",
    old: L(
      "    // r14：只有診斷旗標 --evidence-mock 時才加上 A1／A2 身分證據（placeId／types／countryCode）；正式執行與 r13 逐字相同",
      '    return { location, error: null, providerResult: { ok: true, status: "OK", provider: "geocode", rawResultCount: 1, parsedResultCount: 1, latitude: location.lat, longitude: location.lng, query: q, ...(globalThis.__R14_EVIDENCE_MOCK ? __r14.geocodeEvidence(location) : {}) } };',
    ),
    neu: L(
      "    // r15-E：ok 回應＝該樹正式 tripLocationToProviderResult＋providerEvidenceForGeocodeLocation（location.functions.ts L1210-1218）；",
      "    //        EV 情境（SCENARIO.r15Fault）才套用負向證據；timeout／null／zero／neterr 分支（上方）與 r13 逐字相同",
      "    // r15-F：Fixture 有效性分類（REAL／PARENTS／R15_ALIASES）；unknown → ZERO_RESULTS（同 zero 分支形狀），不由 Mock 自動產生成功證據",
      "    return await __r14.r15.geocodeOk({ location, q, scenario: SCENARIO, imp, ev: __r14.geocodeEvidence(location), evFn: __r14.geocodeEvidence, fixture: { REAL, PARENTS } });",
    ),
  },
  {
    id: "r15-C flows",
    kind: "exact",
    old: "  // ── 元件閉包（R14_CLOSURE_DEPS 已審查清單；逐一實作，不是 noop）──\n",
    neu: `${r15Inject(r15ChildFlows)}\n  // ── 元件閉包（R14_CLOSURE_DEPS 已審查清單；逐一實作，不是 noop）──\n`,
  },
  {
    id: "r15-C turn msgs start",
    kind: "exact",
    old: "      const r14r0 = R14_rpc.length; // r14-Δ3\n",
    neu: "      const r14r0 = R14_rpc.length; // r14-Δ3\n      const r15m0 = msgs.length; // r15-C\n",
  },
  {
    id: "r15-C turn obs",
    kind: "exact",
    old: "      obs.geocodes = geocodes.slice(g0).map((g) => `${g.phase}:${g.q}`);\n",
    neu: L(
      "      obs.geocodes = geocodes.slice(g0).map((g) => `${g.phase}:${g.q}`);",
      "      // r15-C：本輪 geocode 的結果類型／所在 A2 驗證流程、程序段（重新載入＝新程序）、本輪新增的助理訊息（只記錄）",
      "      obs.r15Geo = geocodes.slice(g0).map((g) => ({ phase: g.phase, q: g.q, flow: g.r15?.flow ?? null, outcome: g.r15?.outcome ?? null, validity: g.r15?.validity ?? null }));",
      "      obs.r15Seg = process.env.VERIFY_P2_INIT ? 1 : 0;",
      '      obs.r15Assistant = msgs.slice(r15m0).filter((x) => x?.role === "assistant").map((x) => String(x.content ?? "").slice(0, 160));',
      "      obs.r15Flows ??= [];",
      "      // r15-X：recommendationSession 地理範圍／池、本輪畫面卡片、本輪 Credits metadata（只記錄；r13 judge 不讀）",
      "      obs.r15Rec = __r14.r15.recScope(persisted.recommendationSession);",
      "      obs.r15Cards = __r14.r15.turnCards(msgs);",
      "      obs.r15Credits = creditsBegin.slice(c0).map((c) => ({ destination: c.destination ?? null, path: c.path ?? null }));",
      "",
    ),
  },
  {
    id: "r15-X init session",
    kind: "exact",
    old: "  // r5-Δ3：resolveChatLocation（src/lib/ai/resolve-chat-location.ts）mock",
    neu: L(
      "  // r15-X：外掛情境自帶初始 Session（只在沒有 VERIFY_P2_INIT／initKind 時；r13 情境沒有 r15Init → 不執行）。與 r9Rec 同法：以該樹正式 createRecommendationSession 建立",
      "  if (!process.env.VERIFY_P2_INIT && !SCENARIO.initKind && SCENARIO.r15Init) persisted = __r14.r15.buildInit(SCENARIO.r15Init, { createRecommendationSession: M.crs.createRecommendationSession, base: baseSession() });",
      "  // r5-Δ3：resolveChatLocation（src/lib/ai/resolve-chat-location.ts）mock",
    ),
  },
  {
    id: "r15-X search empty",
    kind: "exact",
    old: '    if (SEARCH_MODE !== "ok") return { places: [], error: null, rawCount: 0 };\n',
    neu: '    if (SEARCH_MODE !== "ok" || __r14.r15.searchEmpty(SCENARIO, data)) return { places: [], error: null, rawCount: 0 }; // r15-X：外掛情境 r15EmptyDest（r13 情境恆 false）\n',
  },
  {
    id: "r15-C probe",
    kind: "exact",
    old: "    for (const [turnIndex, turn] of (SCENARIO.turns ?? []).entries()) {\n",
    neu: L(
      "    if (SCENARIO.r15Probe) result.r15Probe = await __r14.r15.unitProbe({ M, imp, LOCALE, realisticLocation, geocodeEvidence: __r14.geocodeEvidence }); // r15-C：單元探針（情境沒有 turns）",
      "    for (const [turnIndex, turn] of (SCENARIO.turns ?? []).entries()) {",
      "",
    ),
  },
  {
    id: "r15-N jobs",
    kind: "exact",
    old: "for (const s of scenarios) for (const m of MODES) for (const tree of TREES) jobs.push({ s, m, tree });\n",
    neu: L(
      "for (const s of scenarios) for (const m of MODES) for (const tree of TREES) jobs.push({ s, m, tree });",
      "for (const j of __r14.r15.extraJobs(ONLY, TREES)) jobs.push(j); // r15-N／C：負向證據情境與單元探針（不加入 SCENARIOS／MODES、不進既有 judge）",
      "",
    ),
  },
  {
    id: "r15-V exit",
    kind: "exact",
    old: "process.exit(p1W.size ? 1 : 0);",
    neu: "process.exit(p1W.size || __r14.r15.failed() ? 1 : 0); // r15：P1 判定不變；r15 新增斷言失敗另計",
  },
];

// ════════════════════════ r15：r14 原文層 patch ════════════════════════
const R15_R14_PATCHES = [
  {
    id: "r15-V header",
    kind: "exact",
    old: " * R14 — Destination Authority 全量回歸（A2-T4，tester；使用者授權 2026-10-21）。\n",
    neu: L(
      " * R15 — r14 的執行期 patch 版（A2-T5）：說明見 scripts/verify-destination-authority-phase2-r15.mjs 檔頭（r15-V／E／N／C）。",
      " * 執行：node scripts/verify-destination-authority-phase2-r15.mjs --brief --f10 --pa2",
      " *",
      " * ── 以下為 r14 原始說明 ──",
      " * R14 — Destination Authority 全量回歸（A2-T4，tester；使用者授權 2026-10-21）。",
      "",
    ),
  },
  {
    id: "r15-V static imports → __r15.imp（AsyncFunction 執行需要）",
    kind: "exact",
    old: L('import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";', 'import { createHash } from "node:crypto";', 'import { execFileSync } from "node:child_process";'),
    neu: L(
      'const { readFileSync, existsSync, statSync, writeFileSync } = await __r15.imp("node:fs"); // r15：同 r14 的 import（AsyncFunction 內不能用 import 陳述式）',
      'const { createHash } = await __r15.imp("node:crypto");',
      'const { execFileSync } = await __r15.imp("node:child_process");',
    ),
  },
  { id: "r15-V typescript import", kind: "exact", old: '  const ts = (await import("typescript")).default;', neu: '  const ts = (await __r15.imp("typescript")).default; // r15' },
  { id: "r15-V __r14.imp", kind: "exact", old: "  imp: (s) => import(s),", neu: "  imp: __r15.imp, // r15" },
  {
    id: "r15-V child script",
    kind: "exact",
    old: "phase2-r14.mjs`; // r14-Δ0（子程序同樣執行 r14＝patched r13）",
    neu: "phase2-r15.mjs`; // r15：子程序執行 r15（＝r14＋R15 patch；原 r14-Δ0）",
  },
  {
    id: "r15-V whitelist",
    kind: "exact",
    old: "r1[0-4])/.test(f)) unexpected.push(f); // r14-Δ6：r1[0-4]",
    // 錨點位於 r14 的 R14_PATCHES 雙引號字串內 → 引號以 \" 跳脫
    neu: 'r1[0-5])/.test(f) && f !== \\"scripts/verify-more-places-cross-destination.mjs\\") unexpected.push(f); // r15：r1[0-5]（原 r14-Δ6：r1[0-4]）；r15-X：＋A2-T6 授權的 more_places 獨立測試（精確路徑）',
  },
  {
    id: "r15-V r13 label",
    kind: "exact",
    old: "verify-destination-authority-phase2-r13(r14 沿用): work P1=",
    neu: "verify-destination-authority-phase2-r13(r15 沿用): work P1=",
  },
  {
    id: "r15-V banner",
    kind: "exact",
    old: '  L.push("\\n══════════════════════ r14 ══════════════════════");',
    neu: '  L.push("\\n══════════════════════ r14（r15 沿用）══════════════════════");',
  },
  {
    id: "r15-C report",
    kind: "exact",
    old: "  L.push(`\\n情境=${scenarios.length} 模式=${MODES.length} 樹=",
    neu: "  __r15.report({ ...ctx, L, P1 }); // r15：r15-E／CC-1／CC-2／CC-3／EV／PROBE 各節（只新增輸出）\n  L.push(`\\n情境=${scenarios.length} 模式=${MODES.length} 樹=",
  },
  {
    id: "r15-V summary",
    kind: "exact",
    old: '  L.push(`verify-destination-authority-phase2-r14: work P1=${sz("work")} pa2 P1=${sz("pa2")} f10 P1=${sz("f10")} pre P1=${sz("pre")} base P1=${sz("base")} 新增P1(vs pa2)=${newVsPa2} 既有P1=${existing} external=${extHits.length} → ${P1.work.size ? "FAIL" : "PASS"}`);',
    neu: '  L.push(`verify-destination-authority-phase2-r15: work P1=${sz("work")} pa2 P1=${sz("pa2")} f10 P1=${sz("f10")} pre P1=${sz("pre")} base P1=${sz("base")} 新增P1(vs pa2)=${newVsPa2} 既有P1=${existing} external=${extHits.length} ${__r15.summaryFields()} → ${P1.work.size || __r15.failed() ? "FAIL" : "PASS"}`); // r15',
  },
  {
    id: "r15 r13 patches",
    kind: "exact",
    old: "function r14ApplyPatches(src) {\n",
    neu: L(
      "const R14_BASE_PATCH_COUNT = R14_PATCHES.length; // r15：r14 原有 patch 數（--emit-diff 用來重建 r14 執行內容）",
      "for (const p of __r15.r13Patches) R14_PATCHES.push(p); // r15：R15_R13_PATCHES 套在 R14_PATCHES 之後（同一套錨點恰好一次檢查）",
      "function r14ApplyPatches(src) {",
      "",
    ),
  },
  {
    id: "r15-V emit-diff",
    kind: "region",
    from: 'if (process.argv.includes("--emit-diff")) {\n',
    to: "const __r14 = {\n",
    neu: L(
      'if (process.argv.includes("--emit-diff") || process.argv.includes("--emit-fix-diff")) { // r15-F：--emit-fix-diff 寫 r15-fix.diff',
      "  // r15：r14 執行內容（r13＋R14_PATCHES）與 r15 執行內容（r13＋R14_PATCHES＋R15_R13_PATCHES）",
      "  const r15Extra = R14_PATCHES.splice(R14_BASE_PATCH_COUNT);",
      "  const r14Only = r14ApplyPatches(r13Text);",
      "  R14_PATCHES.push(...r15Extra);",
      "  await __r15.emitDiff({ r13File: R13_FILE, r14Only, r15Exec: r14Patched, r14BasePatchCount: R14_BASE_PATCH_COUNT });",
      "  process.exit(0);",
      "}",
      "",
    ),
  },
  { id: "r15 __r14.r15", kind: "exact", old: "  geocodeEvidence: r14GeocodeEvidence,\n};\n", neu: "  geocodeEvidence: r14GeocodeEvidence,\n  r15: __r15, // r15\n};\n" },
];

function r15Apply(src, patches, what) {
  let text = src;
  const log = [];
  const count = (hay, needle) => {
    let n = 0;
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) n += 1;
    return n;
  };
  for (const p of patches) {
    if (p.kind === "exact") {
      const n = count(text, p.old);
      if (n !== 1) throw new Error(`${what} patch ${p.id}：錨點出現 ${n} 次（必須 1 次）`);
      text = text.replace(p.old, () => p.neu);
    } else {
      const nf = count(text, p.from);
      const nt = count(text, p.to);
      if (nf !== 1 || nt !== 1) throw new Error(`${what} patch ${p.id}：from 出現 ${nf} 次、to 出現 ${nt} 次（必須各 1 次）`);
      const a = text.indexOf(p.from);
      const b = text.indexOf(p.to);
      if (!(a < b)) throw new Error(`${what} patch ${p.id}：from 不在 to 之前`);
      text = text.slice(0, a) + p.neu + text.slice(b);
    }
    log.push(p.id);
  }
  return { text, log };
}

// ════════════════════════ r15：--emit-diff ════════════════════════
const R15_DELETED_RE = /p1\.push|notes\.push|costNotes|diffExpected|expect:|MODES|ux\.push/;
function r15DiffText(a, b, la, lb) {
  try {
    return execFileSync("diff", ["-u", "--label", la, "--label", lb, a, b], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    return String(e.stdout ?? "");
  }
}
function r15DeletedStats(diff) {
  const del = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  const hit = del.filter((l) => R15_DELETED_RE.test(l));
  const by = {};
  for (const l of hit) for (const k of ["p1.push", "notes.push", "costNotes", "diffExpected", "expect:", "MODES", "ux.push"]) if (l.includes(k)) by[k] = (by[k] ?? 0) + 1;
  return { deleted: del.length, added: diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length, hit, by };
}
let R15_PATCHED_R14 = null;
async function r15EmitFixDiff({ r15Exec }) {
  // r15-F：修正前 r15（scratchpad/r15-pre-fix/，sha1 必須 = e5b2a237…）→ 修正後 r15；以及兩者的 patched r14／r13 執行內容
  const PRE_R15 = `${PRE_DIR}/r15-pre-fix/verify-destination-authority-phase2-r15.mjs`;
  const PRE_R15_SHA = "e5b2a237d94cca891fa0acde6dd1fd36ad0d82d8"; // scratchpad/pre-r15fix-test-sha.txt
  const preText = readFileSync(PRE_R15, "utf8");
  if (sha1(preText) !== PRE_R15_SHA) throw new Error(`修正前 r15 備份 sha=${sha1(preText)} ≠ ${PRE_R15_SHA}`);
  const preR14 = `${PRE_DIR}/r15.patched-r14.mjs`; // 修正前 r15 --emit-diff 產物（15:24，晚於修正前 r15 最後修改 15:21）
  const preExec = `${PRE_DIR}/r15.r15-exec.mjs`;
  const fR14 = `${PRE_DIR}/r15fix.patched-r14.mjs`;
  const fB = `${PRE_DIR}/r15fix.r15-exec.mjs`;
  writeFileSync(fR14, R15_PATCHED_R14.full);
  writeFileSync(fB, r15Exec.text);
  const d0 = r15DiffText(PRE_R15, `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r15.mjs`, "修正前 r15（sha e5b2a237）", "修正後 r15");
  const d1 = r15DiffText(preR14, fR14, "修正前 r15 執行的 r14（scratchpad/r15.patched-r14.mjs）", "修正後 r15 執行的 r14");
  const d2 = r15DiffText(preExec, fB, "修正前 r15 執行內容（scratchpad/r15.r15-exec.mjs）", "修正後 r15 執行內容");
  const s = [d0, d1, d2].map(r15DeletedStats);
  const head = [
    "# r15-fix.diff（A2-T6）",
    `# 第 0 部分：r15 檔案 刪除行=${s[0].deleted} 新增行=${s[0].added}；刪除行含 p1.push／notes.push／costNotes／diffExpected／expect:／MODES／ux.push = ${s[0].hit.length} ${JSON.stringify(s[0].by)}`,
    `# 第 1 部分：patched r14 刪除行=${s[1].deleted} 新增行=${s[1].added}；命中=${s[1].hit.length} ${JSON.stringify(s[1].by)}`,
    `# 第 2 部分：patched r13 執行內容 刪除行=${s[2].deleted} 新增行=${s[2].added}；命中=${s[2].hit.length} ${JSON.stringify(s[2].by)}`,
    ...s.flatMap((x, i) => x.hit.map((l) => `#   [第${i}部分 刪除行命中] ${l}`)),
    "",
  ];
  writeFileSync(`${PRE_DIR}/r15-fix.diff`, `${head.join("\n")}\n######## 第 0 部分：r15 檔案 ########\n${d0}\n######## 第 1 部分：patched r14 ########\n${d1}\n######## 第 2 部分：patched r13 執行內容 ########\n${d2}`);
  console.log(`wrote ${PRE_DIR}/r15-fix.diff（第0部分 ${d0.split("\n").length} 行；第1部分 ${d1.split("\n").length} 行；第2部分 ${d2.split("\n").length} 行）`);
  console.log(head.join("\n"));
}
async function r15EmitDiff({ r13File, r14Only, r15Exec, r14BasePatchCount }) {
  if (process.argv.includes("--emit-fix-diff")) return r15EmitFixDiff({ r15Exec });
  const fR14 = `${PRE_DIR}/r15.patched-r14.mjs`;
  const fA = `${PRE_DIR}/r15.r14-exec.mjs`;
  const fB = `${PRE_DIR}/r15.r15-exec.mjs`;
  writeFileSync(fR14, R15_PATCHED_R14.full);
  writeFileSync(fA, r14Only.text);
  writeFileSync(fB, r15Exec.text);
  // r14 的真實執行內容＝r14 自己 --emit-diff 產生的 scratchpad/r14.patched-r13.mjs；
  // 與 r15 內重算的「r13＋R14_PATCHES（已含 r15-V 版本識別字串）」只允許差在 3 條版本識別行（下方逐行列出）。
  const r14Ref = `${PRE_DIR}/r14.patched-r13.mjs`;
  if (!existsSync(r14Ref)) throw new Error(`缺少 ${r14Ref}（r14 --emit-diff 產物）`);
  const refText = readFileSync(r14Ref, "utf8");
  const refVsOnly = r15DiffText(r14Ref, fA, "scratchpad/r14.patched-r13.mjs", "r15 內重算的 r13＋R14_PATCHES");
  const refChanged = refVsOnly.split("\n").filter((l) => /^[-+][^-+]/.test(l));
  const VERSION_LINE = /verify-destination-authority-phase2-r1[45]\.mjs`; \/\/ r1[45]|phase2-\(r\[789\]\|r1\[0-[45]\]\)|phase2-r13\(r1[45] 沿用\)/;
  const refOk = refChanged.length === 6 && refChanged.every((l) => VERSION_LINE.test(l));
  const d1 = r15DiffText(R14_FILE, fR14, "scripts/verify-destination-authority-phase2-r14.mjs", "r15 執行的 r14（r14＋R15_R14_PATCHES）");
  const d2 = r15DiffText(r14Ref, fB, "r14 實際執行內容（scratchpad/r14.patched-r13.mjs＝r13＋R14_PATCHES）", "r15 實際執行內容（r13＋R14_PATCHES[版本識別改 r15]＋R15_R13_PATCHES）");
  const s1 = r15DeletedStats(d1);
  const s2 = r15DeletedStats(d2);
  const refSame = refText === r14Only.text ? true : refOk ? "只差 3 條版本識別行" : `不一致（${refChanged.length} 行）`;
  const head = [
    "# r15.diff（A2-T5）",
    `# r14 sha1=${R14_SHA}（已驗證）；r13 由 r14 驗證 sha1=8debfb44…`,
    `# 第 1 部分：r14 原文 → r15 實際執行的 r14（R15_R14_PATCHES ${R15_R14_PATCHES.length} 個）：${R15_R14_PATCHES.map((p) => p.id).join("｜")}`,
    `#   刪除行=${s1.deleted} 新增行=${s1.added}；刪除行含 p1.push／notes.push／costNotes／diffExpected／expect:／MODES／ux.push = ${s1.hit.length} ${JSON.stringify(s1.by)}`,
    `# 第 2 部分：r14 實際執行內容（r13＋R14_PATCHES ${r14BasePatchCount} 個）→ r15 實際執行內容（再加 R15_R13_PATCHES ${R15_R13_PATCHES.length} 個）：${R15_R13_PATCHES.map((p) => p.id).join("｜")}`,
    `#   刪除行=${s2.deleted} 新增行=${s2.added}；刪除行含 p1.push／notes.push／costNotes／diffExpected／expect:／MODES／ux.push = ${s2.hit.length} ${JSON.stringify(s2.by)}`,
    `# r14 實際執行內容（scratchpad/r14.patched-r13.mjs）vs r15 內重算的 r13＋R14_PATCHES：${refSame}`,
    ...refChanged.map((l) => `#   [版本識別差異] ${l}`),
    ...s1.hit.map((l) => `#   [第1部分 刪除行命中] ${l}`),
    ...s2.hit.map((l) => `#   [第2部分 刪除行命中] ${l}`),
    "",
  ];
  writeFileSync(`${PRE_DIR}/r15.diff`, `${head.join("\n")}\n######## 第 1 部分 ########\n${d1}\n######## 第 2 部分 ########\n${d2}`);
  console.log(`wrote ${PRE_DIR}/r15.diff（第1部分 ${d1.split("\n").length} 行；第2部分 ${d2.split("\n").length} 行）`);
  console.log(head.join("\n"));
}

// ════════════════════════ 執行 ════════════════════════
const r14Text = readFileSync(R14_FILE, "utf8");
if (sha1(r14Text) !== R14_SHA) {
  console.log(`INFRA-FAIL r14 sha=${sha1(r14Text)} ≠ ${R14_SHA}（r14 被修改？r15 不執行）`);
  process.exit(1);
}
const shebang = r14Text.match(/^#!.*\n/);
if (!shebang) {
  console.log("INFRA-FAIL r14 缺少 shebang");
  process.exit(1);
}
let r15PatchedR14;
try {
  r15PatchedR14 = r15Apply(r14Text.slice(shebang[0].length), R15_R14_PATCHES, "r14");
} catch (e) {
  console.log(`INFRA-FAIL r15 patch：${e?.message ?? e}`);
  process.exit(1);
}
if (/^\s*import\s/m.test(r15PatchedR14.text)) {
  console.log("INFRA-FAIL r15：patched r14 仍有 import 陳述式");
  process.exit(1);
}
R15_PATCHED_R14 = { full: `${shebang[0]}${r15PatchedR14.text}`, log: r15PatchedR14.log };
if (R15_X_ARG) {
  // r15-X：只接受 scripts/verify-*.mjs；必須匯出 scenarios（陣列，每個情境有 id／turns）與 report（函式）
  const { pathToFileURL } = await import("node:url");
  const { resolve: r15Resolve } = await import("node:path");
  const p = r15Resolve(WORK_ROOT, R15_X_ARG);
  if (!/^\/Users\/shuo\/Roamie-clean\/scripts\/verify-[\w.-]+\.mjs$/.test(p) || !existsSync(p)) {
    console.log(`INFRA-FAIL r15-X：--extra-scenarios 必須是存在的 scripts/verify-*.mjs（${p}）`);
    process.exit(1);
  }
  R15_X.mod = await import(pathToFileURL(p).href);
  const ids = new Set();
  const bad = !Array.isArray(R15_X.mod.scenarios) || typeof R15_X.mod.report !== "function" ? ["缺少 scenarios／report"] : [];
  for (const s of R15_X.mod.scenarios ?? []) {
    if (!s?.id || !Array.isArray(s.turns) || ids.has(s.id) || /^(EV-|R15-PROBE)/.test(s.id)) bad.push(`情境 ${s?.id ?? "?"} 無效或重複`);
    ids.add(s?.id);
  }
  if (bad.length) {
    console.log(`INFRA-FAIL r15-X：${bad.join("；")}`);
    process.exit(1);
  }
}
const __r15 = {
  imp: (s) => import(s),
  r13Patches: R15_R13_PATCHES,
  recScope: r15RecScope,
  turnCards: r15TurnCards,
  buildInit: r15BuildInit,
  searchEmpty: r15SearchEmpty,
  geocodeOk: r15GeocodeOk,
  geoTag: r15GeoTag,
  extraJobs: r15ExtraJobs,
  unitProbe: r15UnitProbe,
  report: r15Report,
  failed: r15Failed,
  summaryFields: r15SummaryFields,
  emitDiff: r15EmitDiff,
};
const AsyncFunction = (async () => {}).constructor;
await new AsyncFunction("__r15", `"use strict";\n${r15PatchedR14.text}`)(__r15);
