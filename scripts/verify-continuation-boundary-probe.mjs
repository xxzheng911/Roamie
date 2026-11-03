#!/usr/bin/env node
/**
 * CB-T1 — 續推邊界契約（方案 A）離線 Regression probe。
 * 只針對外部可觀察行為：resolveMorePlacesTurnDestination（more_places 搜尋目的地；
 * _app.chat.tsx pushMorePlaceRecommendations：destination 為真才 beginPlaceRecommendationCredits）、
 * validateCategoryTurnDestination（類別路徑）、mock geocode 呼叫次數與查詢字串。
 * 另含 matchesContinueRecommendationGrammar() 的 golden 基準（F10 狀態錄製，內嵌於本檔 GOLDEN）。
 *
 * - 載入真實模組（vite-node），每段 freshModules() 為新模組實例（等同重新載入 App）。
 * - 外部網路全部攔截（fetch / http / https / net），任何一次即 FAIL。
 * - 不修改任何檔案。
 * 執行：node scripts/verify-continuation-boundary-probe.mjs
 *       node scripts/verify-continuation-boundary-probe.mjs --dump-golden   （只印出目前 grammar 回傳值 JSON）
 */
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const DUMP_GOLDEN = process.argv.includes("--dump-golden");

for (const k of Object.keys(process.env)) if (/KEY|SECRET|TOKEN|PRIVATE|PASSWORD|SUPABASE|OPENAI|GOOGLE|WEATHER/i.test(k)) delete process.env[k];
Object.assign(process.env, { GOOGLE_MAPS_API_KEY: "mock-key", VITE_SUPABASE_URL: "http://mock-supabase.invalid", VITE_SUPABASE_PUBLISHABLE_KEY: "mock-key" });
let external = 0;
const extLog = [];
globalThis.fetch = async (u) => {
  external += 1;
  extLog.push(String(u?.url ?? u));
  throw new Error("[ext-trap] fetch blocked");
};
{
  const { createRequire } = await import("node:module");
  const require = createRequire(`${WORK_ROOT}/package.json`);
  for (const m of ["http", "https"]) {
    const mod = require(m);
    for (const fn of ["request", "get"]) {
      mod[fn] = () => {
        external += 1;
        extLog.push(`${m}.${fn}`);
        throw new Error("[ext-trap] http blocked");
      };
    }
  }
  const net = require("net");
  net.connect = net.createConnection = () => {
    external += 1;
    extLog.push("net");
    throw new Error("[ext-trap] net blocked");
  };
}
const orig = { ...console };
for (const k of ["info", "log", "warn", "debug", "error"]) console[k] = () => {};

const { createServer } = await import("vite");
const { ViteNodeServer } = await import("vite-node/server");
const { ViteNodeRunner } = await import("vite-node/client");
const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
const server = await createServer({
  root: WORK_ROOT,
  configFile: false,
  envDir: false,
  logLevel: "silent",
  clearScreen: false,
  plugins: [tsconfigPaths()],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await server.environments.client.pluginContainer.buildStart({});
const vn = new ViteNodeServer(server);
/** 新 runner＝新模組實例（等同重新載入 App：模組層快取全部清空） */
async function freshModules() {
  vn.fetchCache?.clear?.();
  vn.fetchPromiseMap?.clear?.();
  vn.transformPromiseMap?.clear?.();
  for (const mod of server.moduleGraph.idToModuleMap.values()) server.moduleGraph.invalidateModule(mod);
  const runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
  await runner.executeId("/@vite/env");
  const imp = (p) => runner.executeFile(`${WORK_ROOT}/src/${p}`);
  return {
    ctd: await imp("lib/ai/chat-turn-destination.ts"),
    crs: await imp("lib/ai/conversation-recommendation-session.ts"),
    refine: await imp("lib/ai/recommendation-refinement/index.ts"),
    crg: await imp("lib/ai/continue-recommendation-intent.ts"),
    tc: await imp("lib/ai/travel-context.ts"),
    mvp: await imp("lib/ai/must-visit-places.ts"),
  };
}

// ── mock geocode：已知行政區回完整行政層級；POI 回 POI；國際城市回城市；其餘只回父城市 ──
const LOC = (o) => ({ placeId: `mock-${o.formattedName}`, country: o.country ?? "日本", city: o.city ?? "", region: o.region, district: o.district, sublocality: o.sublocality, lat: o.lat ?? 35, lng: o.lng ?? 135, formattedName: o.formattedName, displayLabel: o.formattedName });
const REAL = {
  台中西屯: LOC({ country: "台灣", city: "台中市", region: "台中市", district: "西屯區", formattedName: "台中市西屯區", lat: 24.18, lng: 120.62 }),
  台中市西屯區: LOC({ country: "台灣", city: "台中市", region: "台中市", district: "西屯區", formattedName: "台中市西屯區", lat: 24.18, lng: 120.62 }),
  香港跑馬地: LOC({ country: "香港", city: "香港", region: "香港島", district: "灣仔區", sublocality: "跑馬地", formattedName: "跑馬地", lat: 22.27, lng: 114.18 }),
  香港又一村: LOC({ country: "香港", city: "香港", region: "九龍", district: "深水埗區", sublocality: "又一村", formattedName: "又一村", lat: 22.34, lng: 114.17 }),
  台南看西街教會: LOC({ country: "台灣", city: "台南市", region: "台南市", district: "中西區", formattedName: "看西街教會", lat: 22.99, lng: 120.2 }),
  東京玩具美術館: LOC({ country: "日本", city: "東京都", region: "東京都", district: "新宿區", formattedName: "東京玩具美術館", lat: 35.69, lng: 139.72 }),
  里斯本: LOC({ country: "葡萄牙", city: "里斯本", region: "里斯本", formattedName: "里斯本", lat: 38.72, lng: -9.14 }),
  波爾圖: LOC({ country: "葡萄牙", city: "波爾圖", region: "波爾圖", formattedName: "波爾圖", lat: 41.15, lng: -8.61 }),
  金澤: LOC({ country: "日本", city: "金澤市", region: "石川縣", formattedName: "金澤", lat: 36.56, lng: 136.66 }),
};
const PARENTS = ["台中", "台南", "香港", "京都", "大阪", "台北", "東京"];
let geoMode = "ok";
const geoLog = [];
const geocodeFn = async (req) => {
  const q = String(req?.data?.query ?? "");
  geoLog.push(q);
  if (geoMode === "timeout") throw new Error("provider timeout");
  if (geoMode === "null") return null;
  if (geoMode === "zero") return { location: null, error: null, providerResult: { ok: false, status: "ZERO_RESULTS", query: q } };
  // ok / ok-empty（ok-empty＝geocode 成功、之後 Places 搜尋空；本 probe 不執行 Places，geocode 行為同 ok）
  const key = q.split(",")[0].replace(/\s+/g, "").trim();
  if (REAL[key]) return { location: REAL[key], error: null, providerResult: { ok: true, status: "OK", query: q } };
  const parent = PARENTS.find((p) => key.startsWith(p)) ?? key;
  const location = LOC({ country: /台/.test(parent) ? "台灣" : "日本", city: parent, region: parent, formattedName: parent });
  return { location, error: null, providerResult: { ok: true, status: "OK", query: q } };
};

const LOCALE = "zh-TW";
const S0 = { recommendedPlaces: [], selectedPlaces: [], phase: "recommend", discovery: {}, updatedAt: "2026-01-01T00:00:00.000Z", activeCategoryIntent: "restaurant", conversationMode: "destination_planning" };
const pool = (d) => [1, 2, 3, 4].map((j) => ({ name: `${d}-p${j}`, placeName: `${d}-p${j}`, placeId: `p-${d}-${j}`, googlePlaceId: `p-${d}-${j}`, lat: 24, lng: 120, rating: 4.5, category: "restaurant" }));
const recOf = (M, d, scope) => M.crs.createRecommendationSession({ destination: d, topic: "restaurant", pool: pool(d), batchSize: 3, usedQueries: [], recommendationPage: 0, parentCity: scope?.parentCity, area: scope?.area, searchScope: scope ? "area" : "city", searchRegionLabel: d }).session;
const sess = (M, d, extra = {}, scope) => ({ ...S0, recommendationSession: recOf(M, d, scope), travelContext: { interests: [], destination: d }, recommendedPlaces: pool(d), ...extra });
const tripSess = (M, d, country, lat, lng) => ({ ...sess(M, d), tripDestination: { placeId: `mock-${d}`, city: d, displayLabel: d, country, lat, lng } });

/** pushMorePlaceRecommendations 鏡像：caller 以 travelContext.destination=destForMore 呼叫；destination 為真 → 搜尋＋begin Credits */
async function more(M, session, text) {
  const destForMore = session.activeRecommendationContext?.destinationName || session.recommendationSession?.destination || session.travelContext?.destination || session.tripPlanningContext?.destination || session.tripDestination?.city;
  const active = { ...session, travelContext: { ...(session.travelContext ?? { interests: [] }), destination: destForMore, tripPurpose: "more_place_recommendations" } };
  const merged = M.tc.mergeTravelContext(active, text);
  const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, active);
  const g0 = geoLog.length;
  let dest;
  let err = null;
  try {
    dest = await M.ctd.resolveMorePlacesTurnDestination({ ctx: placeCtx, session: merged.session, userText: text, locale: LOCALE, geocodeFn });
  } catch (e) {
    err = String(e?.message ?? e);
    dest = undefined;
  }
  const d = dest ?? null;
  return { path: "more", dest: d, search: !!d, credits: !!d, geo: geoLog.slice(g0), err };
}
/** 類別路徑：resolveCategoryTurnDestination → validateCategoryTurnDestination（搜尋＝destination 為真） */
async function category(M, session, text) {
  const merged = M.tc.mergeTravelContext(session, text);
  const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, session);
  const g0 = geoLog.length;
  let r = null;
  let err = null;
  try {
    const r0 = M.ctd.resolveCategoryTurnDestination({ ctx: placeCtx, session: merged.session, userText: text, locale: LOCALE });
    r = await M.ctd.validateCategoryTurnDestination(r0, { locale: LOCALE, geocodeFn });
  } catch (e) {
    err = String(e?.message ?? e);
  }
  const d = r?.destination ?? null;
  return { path: "category", dest: d, search: !!d, credits: !!d, geo: geoLog.slice(g0), err, conf: r ? `${r.confidence}/${r.source}` : "-" };
}
const fmt = (x) => `[${x.path}] dest=${x.dest ?? "-"} search=${x.search ? "Y" : "N"} credits=${x.credits ? "begin" : "no"} geocode=${x.geo.length}${x.geo.length ? `[${x.geo.join(" | ")}]` : ""}${x.conf ? ` (${x.conf})` : ""}${x.err ? ` ERR=${x.err}` : ""}`;

/** 續推字不得進入 geocode 查詢字串（契約 5）：尾段續推字／句首續推動詞／句首語助詞 */
const CONT_IN_QUERY_RE = /(再推薦|推薦幾個|幾個|還有|嗎|呢|一批|其他|再$|還$|又$|^換|^好[，,]?|^請)/;
const cleanQueries = (x) => x.geo.every((q) => !CONT_IN_QUERY_RE.test(q.split(",")[0].trim()));

const out = [];
const P = (...a) => out.push(a.join(" "));
const rows = [];
/** status: PASS / FAIL；p1: 對應 R10 P1 編號；amb: 期望有歧義（仍依契約字面判定） */
function expect(id, cond, detail, { p1 = "", amb = "", contract = "" } = {}) {
  rows.push({ id, ok: !!cond, detail, p1, amb, contract });
  P(`  ${cond ? "PASS" : "FAIL"} ${id}${p1 ? ` <${p1}>` : ""}${amb ? " [歧義]" : ""}：${detail}`);
}
const info = (msg) => P(`  INFO ${msg}`);

const PURE = ["還有嗎", "再推薦幾個", "換一批", "還有其他咖啡廳嗎", "好，再推薦幾個", "請再推薦幾個"];
const MODES = ["ok", "ok-empty", "timeout", "null", "zero"];

if (!DUMP_GOLDEN) {
  // ════ 1. 純續推 × 已確認京都（契約 1/2/3/6）════
  P("\n══ 1. 純續推 × 已確認京都 → 沿用京都、geocode=0（各 Provider 模式皆同）══");
  for (const mode of MODES) {
    const M = await freshModules();
    geoMode = mode;
    for (const t of PURE) {
      const r = await more(M, sess(M, "京都"), t);
      const p1 = t === "還有嗎" ? "P1-1" : "";
      expect(`1-pure-京都-${mode}-${t}`, r.dest === "京都" && r.geo.length === 0 && r.credits, `${t} ${fmt(r)}（應=京都、geocode=0、begin）`, { p1, contract: "1,2,3,6" });
    }
  }
  // 無可信 Session Destination：不得推測（契約 3）
  P("\n══ 1b. 純續推 × 無可信 Session Destination → 不搜尋、不扣點、geocode=0 ══");
  {
    const M = await freshModules();
    geoMode = "ok";
    for (const t of PURE) {
      const r = await more(M, { ...S0, travelContext: { interests: [] } }, t);
      expect(`1b-pure-noSession-${t}`, r.dest === null && !r.credits && r.geo.length === 0, `${t} ${fmt(r)}`, { contract: "3" });
    }
  }

  // ════ 2. 新目的地優先（契約 4/5/6）════
  P("\n══ 2. 新目的地 × 已確認京都 ══");
  for (const mode of MODES) {
    const M = await freshModules();
    geoMode = mode;
    for (const [t, want] of [["大阪還有嗎", "大阪"], ["換大阪，再推薦幾個", "大阪"], ["換金澤，再推薦幾個", "金澤"]]) {
      const r = await more(M, sess(M, "京都"), t);
      const p1 = t === "大阪還有嗎" ? "P1-4" : t.includes("金澤") ? "P1-2" : "";
      expect(`2-known-${mode}-${t}`, r.dest === want && r.geo.length <= 1 && cleanQueries(r) && r.credits, `${t} ${fmt(r)}（應=${want}、geocode≤1、查詢不含續推字）`, { p1, contract: "4,5,6" });
    }
    for (const city of ["里斯本", "波爾圖"]) {
      for (const t of [`換${city}，再推薦幾個`, `換${city}再推薦幾個`]) {
        const r = await more(M, sess(M, "京都"), t);
        const p1 = city === "里斯本" ? "P1-2" : "";
        // 硬性：不沿用京都、geocode≤1、查詢乾淨
        expect(`2-new-noFallback-${mode}-${t}`, r.dest !== "京都" && r.geo.length <= 1 && cleanQueries(r), `${t} ${fmt(r)}（不得沿用京都；geocode≤1；查詢不含續推字）`, { p1, contract: "4,5,6" });
        if (mode === "ok" || mode === "ok-empty") {
          expect(`2-new-providerOk-${mode}-${t}`, r.dest === city && r.credits, `${t} ${fmt(r)}（Provider 成功 → 應得到 ${city}）`, { p1, amb: "A1", contract: "4" });
        } else {
          expect(`2-new-providerFail-${mode}-${t}`, r.dest === null && !r.credits && !r.search, `${t} ${fmt(r)}（Provider 失敗 → unavailable：不搜尋、不扣點、不回退京都）`, { p1, contract: "4" });
        }
      }
    }
  }
  // 大阪還 不得進入 geocode（契約 5）— 也檢查類別路徑（契約不分路徑）
  P("\n══ 2b. 尾段續推字不得進入 geocode（more_places 與類別路徑）══");
  for (const t of ["大阪還有嗎", "台中西屯再推薦幾個", "台中西屯還有嗎", "換里斯本再推薦幾個", "換里斯本，再推薦幾個"]) {
    const M = await freshModules();
    geoMode = "ok";
    const a = await more(M, sess(M, "京都"), t);
    const M2 = await freshModules();
    const c = await category(M2, sess(M2, "京都"), t);
    const p1 = t.startsWith("大阪") ? "P1-4" : t.startsWith("台中") ? "P1-3" : "P1-2";
    expect(`2b-geoClean-more-${t}`, cleanQueries(a), `${t} ${fmt(a)}`, { p1, contract: "5" });
    expect(`2b-geoClean-category-${t}`, cleanQueries(c), `${t} ${fmt(c)}`, { p1, contract: "5" });
  }

  // ════ 3. 行政區（契約 4：不得自動擴大行政區範圍）════
  P("\n══ 3. 行政區 × 已確認京都 ══");
  for (const mode of MODES) {
    const M = await freshModules();
    geoMode = mode;
    for (const t of ["台中西屯再推薦幾個", "台中西屯還有嗎"]) {
      const r = await more(M, sess(M, "京都"), t);
      expect(`3-xitun-noExpand-${mode}-${t}`, r.dest !== "台中" && r.dest !== "京都" && r.geo.length <= 1 && cleanQueries(r), `${t} ${fmt(r)}（不得變成台中／沿用京都；geocode≤1）`, { p1: "P1-3", contract: "4,5" });
      if (mode === "ok" || mode === "ok-empty") {
        expect(`3-xitun-validated-${mode}-${t}`, r.dest === "台中西屯", `${t} ${fmt(r)}（Provider 驗證成功 → 台中西屯）`, { p1: "P1-3", amb: "A3", contract: "4" });
      } else {
        expect(`3-xitun-fail-${mode}-${t}`, r.dest === null && !r.credits, `${t} ${fmt(r)}（驗證失敗 → 不搜尋、不扣點）`, { p1: "P1-3", contract: "4" });
      }
    }
    const t = "台中牛牛區再推薦幾個";
    const r = await more(M, sess(M, "京都"), t);
    expect(`3-niuniu-${mode}`, r.dest !== "台中" && r.dest !== "京都" && !r.credits && r.geo.length <= 1 && cleanQueries(r), `${t} ${fmt(r)}（不得自行搜尋台中／京都、不扣點）`, { p1: "P1-3", contract: "4" });
  }
  P("\n══ 3b. 已確認台中西屯 → 純續推維持台中西屯；Reload 後續推（第一次 ≤1、之後 0）══");
  for (const [label, scope] of [["台中西屯", { parentCity: "台中", area: "西屯" }], ["香港跑馬地", { parentCity: "香港", area: "跑馬地" }]]) {
    const M = await freshModules();
    geoMode = "ok";
    const s = sess(M, label, {}, scope);
    const a = await more(M, s, "再推薦幾個");
    expect(`3b-${label}-reload-first`, a.dest === label && a.geo.length <= 1 && cleanQueries(a), `Reload 後首次 再推薦幾個 ${fmt(a)}`, { contract: "3,6" });
    for (const t of PURE) {
      const b = await more(M, s, t);
      expect(`3b-${label}-confirmed-${t}`, b.dest === label && b.geo.length === 0, `已確認${label} → ${t} ${fmt(b)}（geocode=0）`, { p1: t === "還有嗎" ? "P1-1" : "", contract: "1,2,3,6" });
    }
  }

  // ════ 4. 合法地名保護（契約 1/2/8）════
  P("\n══ 4. 合法地名保護 × 已確認京都（單獨／＋再推薦幾個／＋還有嗎）══");
  // [名稱, 不可被切掉的核心, 父城市, 是否 POI（POI 擴大成父城市是否可接受有歧義 A4）]
  const NAMES = [
    ["香港跑馬地", "跑馬地", "香港", false],
    ["香港又一村", "又一村", "香港", false],
    ["台南看西街教會", "看西街教會", "台南", true],
    ["東京玩具美術館", "玩具美術館", "東京", true],
  ];
  for (const [name, core, parent, poi] of NAMES) {
    for (const suffix of ["", "再推薦幾個", "還有嗎"]) {
      const M = await freshModules();
      geoMode = "ok";
      const t = `${name}${suffix}`;
      const r = await more(M, sess(M, "京都"), t);
      const notCut = r.geo.every((q) => q.includes(core));
      expect(`4-name-${t}`, r.dest !== "京都" && r.geo.length <= 1 && notCut && cleanQueries(r), `${t} ${fmt(r)}（不得當純續推沿用京都；geocode 查詢須含完整「${core}」且不含續推字）`, { contract: "1,2,5,8" });
      // 名稱被切成父城市（「又」被當續推字、尾段被丟棄）＝未驗證即擴大範圍
      expect(`4-name-noParentExpand-${t}`, r.dest !== parent, `${t} ${fmt(r)}（不得未經驗證把「${name}」縮成父城市「${parent}」搜尋）`, { amb: poi ? "A4" : "", contract: "2,4" });
      // 舊 grammar 對外行為受 golden 凍結（§8），此處只記錄；「香港又一村」=true 與契約 1 的關係見交接報告歧義 A5
      if (!suffix) info(`matchesContinueRecommendationGrammar("${name}")=${M.crg.matchesContinueRecommendationGrammar(name)}`);
    }
  }

  // ════ 5. 國際城市續推能力 ════
  P("\n══ 5. 國際城市續推（同一對話已確認）══");
  {
    const M = await freshModules();
    geoMode = "ok";
    const states = [
      ["里斯本", tripSess(M, "里斯本", "葡萄牙", 38.72, -9.14)],
      ["波爾圖", tripSess(M, "波爾圖", "葡萄牙", 41.15, -8.61)],
      ["金澤", sess(M, "金澤")],
    ];
    for (const [city, s] of states) {
      for (const t of PURE) {
        const r = await more(M, s, t);
        expect(`5-intl-${city}-${t}`, r.dest === city && r.geo.length === 0 && r.credits, `${city} → ${t} ${fmt(r)}`, { p1: t === "還有嗎" ? "P1-1" : "", contract: "3,6,8" });
      }
    }
  }

  // ════ 6. 快照安全（契約 7；F10 保護不可退化）════
  P("\n══ 6. 快照安全（每段 fresh 模組＝重新載入）══");
  for (const mode of ["ok", "timeout", "null", "zero"]) {
    {
      const M = await freshModules();
      geoMode = mode;
      const legacy = sess(M, "台中牛牛區");
      const a = await more(M, legacy, "再推薦幾個");
      const b = await more(M, legacy, "還有嗎");
      const c = await category(M, legacy, "推薦咖啡廳");
      expect(`6-legacy-${mode}`, [a, b, c].every((x) => x.dest === null && !x.credits) && a.geo.length + b.geo.length + c.geo.length <= 1, `舊版快照 台中牛牛區：${fmt(a)}；${fmt(b)}；${fmt(c)}`, { contract: "7" });
    }
    {
      const M = await freshModules();
      geoMode = mode;
      const forged = sess(M, "台中牛牛區", {}, { parentCity: "台中", area: "牛牛區" });
      const a = await more(M, forged, "再推薦幾個");
      const b = await more(M, forged, "還有嗎");
      const c = await category(M, forged, "推薦咖啡廳");
      expect(`6-forgedRec-${mode}`, [a, b, c].every((x) => x.dest === null && !x.credits) && a.geo.length + b.geo.length + c.geo.length <= 1, `偽造 recommendationSession=台中牛牛區：${fmt(a)}；${fmt(b)}；${fmt(c)}`, { contract: "7" });
    }
    {
      const M = await freshModules();
      geoMode = mode;
      const active = M.refine.ensureActiveRecommendationContext(S0, { destination: "台中牛牛區", intent: "restaurant", parentCity: "台中", area: "牛牛區", searchScope: "area" });
      const fa = { ...S0, activeRecommendationContext: active, travelContext: { interests: [], destination: "台中牛牛區" }, recommendedPlaces: pool("台中牛牛區") };
      const a = await more(M, fa, "再推薦幾個");
      const b = await more(M, fa, "還有嗎");
      const c = await category(M, fa, "推薦咖啡廳");
      expect(`6-forgedActive-${mode}`, [a, b, c].every((x) => x.dest === null && !x.credits) && a.geo.length + b.geo.length + c.geo.length <= 1, `偽造 activeRecommendationContext=台中牛牛區：${fmt(a)}；${fmt(b)}；${fmt(c)}`, { contract: "7" });
    }
  }

  // ════ 7. 結構化續推語意函式（方案 A；尚未實作則 FAIL，不崩潰）════
  P("\n══ 7. continue-recommendation-intent.ts 新增匯出（結構化續推語意）══");
  {
    const M = await freshModules();
    const KNOWN = new Set(["matchesContinueRecommendationGrammar", "continueRecommendationMentionedCategory"]);
    const extra = Object.keys(M.crg).filter((k) => typeof M.crg[k] === "function" && !KNOWN.has(k));
    expect("7-structured-export-exists", extra.length > 0, extra.length ? `新增匯出：${extra.join(", ")}` : "尚未實作（continue-recommendation-intent.ts 無新增函式匯出）", { contract: "1,2" });
    const SAMPLE = [...PURE, "大阪還有嗎", "換里斯本，再推薦幾個", "台中西屯再推薦幾個", "香港又一村", "香港又一村還有嗎", "台南看西街教會", "東京玩具美術館再推薦幾個"];
    for (const fn of extra) {
      let threw = null;
      for (const t of SAMPLE) {
        try {
          const v = M.crg[fn](t);
          info(`${fn}("${t}") = ${JSON.stringify(v)}`);
        } catch (e) {
          threw = `${t}: ${e?.message ?? e}`;
        }
      }
      expect(`7-structured-${fn}-noThrow`, !threw, threw ? `丟出例外 ${threw}` : `${fn} 以 (text) 呼叫全部樣本不丟例外（回傳值形狀由 frontend 決定，僅記錄）`);
    }
  }
}

// ════ 8. matchesContinueRecommendationGrammar golden（F10 錄製）════
const GOLDEN_SENTENCES = [
  // scripts/verify-continue-recommendation-intent.mjs CONTINUE_PHRASES
  "還有嗎", "還有其他嗎", "還有推薦嗎", "再推薦幾個", "有別的嗎", "再給我更多", "附近還有嗎", "還有其他咖啡廳嗎", "有其他的嗎", "還有其他推薦嗎", "還有別的嗎", "其他呢", "再來幾個",
  // scripts/verify-continue-recommendation-intent.mjs NON_CONTINUE
  "幫我規劃東京五天行程", "我想找壽喜燒", "天氣如何", "不要101跟龍山寺其他都可以", "不要101和龍山寺其他都可以", "不要101、龍山寺，其他都可以", "101跟龍山寺都不要", "101、龍山寺不要", "不要第一個跟第三個", "除了101跟龍山寺其他都行", "不要101跟龍山寺，但華山幫我加進去",
  // 本任務情境句
  "換一批", "好，再推薦幾個", "請再推薦幾個",
  "大阪還有嗎", "換大阪，再推薦幾個", "換金澤，再推薦幾個", "換里斯本，再推薦幾個", "換里斯本再推薦幾個", "換波爾圖，再推薦幾個", "換波爾圖再推薦幾個",
  "台中西屯再推薦幾個", "台中西屯還有嗎", "台中牛牛區再推薦幾個",
  "香港跑馬地", "香港跑馬地再推薦幾個", "香港跑馬地還有嗎",
  "香港又一村", "香港又一村再推薦幾個", "香港又一村還有嗎",
  "台南看西街教會", "台南看西街教會再推薦幾個", "台南看西街教會還有嗎",
  "東京玩具美術館", "東京玩具美術館再推薦幾個", "東京玩具美術館還有嗎",
  "里斯本", "波爾圖", "金澤", "推薦咖啡廳",
  // 單字／片段（契約 1：不得只因出現再、還、又、換）
  "還", "再", "又", "換", "大阪還", "台中西屯再", "換里斯本再", "又一村",
];
// F10（aa2db59 + 工作區未提交修改）狀態錄製；之後驗收比對，不得改變
const GOLDEN = {
  "還有嗎": true, "還有其他嗎": true, "還有推薦嗎": true, "再推薦幾個": true, "有別的嗎": true, "再給我更多": true, "附近還有嗎": true, "還有其他咖啡廳嗎": true, "有其他的嗎": true, "還有其他推薦嗎": true, "還有別的嗎": true, "其他呢": true, "再來幾個": true,
  "幫我規劃東京五天行程": false, "我想找壽喜燒": false, "天氣如何": false, "不要101跟龍山寺其他都可以": false, "不要101和龍山寺其他都可以": false, "不要101、龍山寺，其他都可以": false, "101跟龍山寺都不要": false, "101、龍山寺不要": false, "不要第一個跟第三個": false, "除了101跟龍山寺其他都行": false, "不要101跟龍山寺，但華山幫我加進去": false,
  "換一批": true, "好，再推薦幾個": true, "請再推薦幾個": true,
  "大阪還有嗎": true, "換大阪，再推薦幾個": true, "換金澤，再推薦幾個": true, "換里斯本，再推薦幾個": true, "換里斯本再推薦幾個": true, "換波爾圖，再推薦幾個": true, "換波爾圖再推薦幾個": true,
  "台中西屯再推薦幾個": true, "台中西屯還有嗎": true, "台中牛牛區再推薦幾個": true,
  "香港跑馬地": false, "香港跑馬地再推薦幾個": true, "香港跑馬地還有嗎": true,
  "香港又一村": true, "香港又一村再推薦幾個": true, "香港又一村還有嗎": true,
  "台南看西街教會": false, "台南看西街教會再推薦幾個": true, "台南看西街教會還有嗎": true,
  "東京玩具美術館": false, "東京玩具美術館再推薦幾個": true, "東京玩具美術館還有嗎": true,
  "里斯本": false, "波爾圖": false, "金澤": false, "推薦咖啡廳": false,
  "還": false, "再": true, "又": true, "換": true, "大阪還": false, "台中西屯再": true, "換里斯本再": true, "又一村": true,
};
{
  const M = await freshModules();
  const now = {};
  for (const t of GOLDEN_SENTENCES) now[t] = M.crg.matchesContinueRecommendationGrammar(t);
  if (DUMP_GOLDEN) {
    for (const k of Object.keys(orig)) console[k] = orig[k];
    await server.close();
    process.stdout.write(`${JSON.stringify(now)}\n`);
    process.exit(0);
  }
  P("\n══ 8. matchesContinueRecommendationGrammar golden（F10 基準）══");
  const missing = GOLDEN_SENTENCES.filter((t) => !(t in GOLDEN));
  expect("8-golden-complete", missing.length === 0, missing.length ? `golden 缺少 ${missing.length} 句：${missing.join("、")}` : `golden 涵蓋 ${GOLDEN_SENTENCES.length} 句`);
  for (const t of GOLDEN_SENTENCES) {
    if (!(t in GOLDEN)) continue;
    expect(`8-golden-${t}`, now[t] === GOLDEN[t], `matchesContinueRecommendationGrammar("${t}")=${now[t]}（基準=${GOLDEN[t]}）`, { contract: "golden" });
  }
}

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();

// ── 摘要表 ──
const fails = rows.filter((r) => !r.ok);
P("\n══ 摘要 ══");
const groups = {};
for (const r of rows) {
  const g = r.id.split("-")[0];
  groups[g] ??= { pass: 0, fail: 0 };
  groups[g][r.ok ? "pass" : "fail"] += 1;
}
for (const [g, v] of Object.entries(groups)) P(`  §${g}: PASS=${v.pass} FAIL=${v.fail}`);
const byP1 = {};
for (const r of fails) if (r.p1) (byP1[r.p1] ??= []).push(r.id);
for (const [p, ids] of Object.entries(byP1)) P(`  ${p} 重現（FAIL ${ids.length}）：${ids.slice(0, 6).join("；")}${ids.length > 6 ? " …" : ""}`);
P(`\nexternal=${external}${external ? ` ${extLog.join(";")}` : ""}`);
P(`verify-continuation-boundary-probe: PASS=${rows.length - fails.length} FAIL=${fails.length} → ${fails.length || external ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(fails.length || external ? 1 : 0);
