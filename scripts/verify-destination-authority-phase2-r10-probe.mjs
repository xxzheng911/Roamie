#!/usr/bin/env node
/**
 * R10 — F10（more_places 續推／快照只當候選／in-flight＋暫時失敗冷卻）真實模組 probe（離線 Mock）。
 * 直接載入各樹 src/lib/ai/chat-turn-destination.ts（work＝現行；f9＝scratchpad *.pre-F10.ts overlay；
 * pre＝*.pre-G2S1.ts overlay），以 mock geocodeFn 計數，Date.now 可控，驗證：
 *  - 續推語句 / 新目的地 / 未知城市＋續推字 的 resolveMorePlacesTurnDestination 結果與 geocode 次數
 *  - 快照（合法／偽造／舊版）只當候選、驗證成功才可搜尋、失敗不信任
 *  - 每候選最多一次必要驗證（重新載入＝新 runner 模組狀態）、in-flight 去重、15 秒冷卻
 *  - pushRecommendationRefinement（L6203-6213）可達性：arbitration + isUnconfirmedSearchDestination
 * 只讀原始碼；外部請求全部攔截（任何一次即 FAIL）。不修改任何檔案。
 * 執行：node scripts/verify-destination-authority-phase2-r10-probe.mjs
 */
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const CTD = `${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`;
const OVERLAY = { f9: `${PRE_DIR}/chat-turn-destination.pre-F10.ts`, pre: `${PRE_DIR}/chat-turn-destination.pre-G2S1.ts` };

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
      mod[fn] = (...a) => {
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

const { readFileSync } = await import("node:fs");
let TREE = "work";
const plugin = {
  name: "r10-ctd-overlay",
  enforce: "pre",
  load(id) {
    if (id.split("?")[0] !== CTD || TREE === "work") return null;
    return readFileSync(OVERLAY[TREE], "utf8");
  },
};
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
  plugins: [plugin, tsconfigPaths()],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await server.environments.client.pluginContainer.buildStart({});
const vn = new ViteNodeServer(server);
/** 新 runner＝新模組實例（等同重新載入 App：模組層快取全部清空） */
async function freshModules(tree = "work") {
  TREE = tree;
  vn.fetchCache?.clear?.();
  vn.fetchPromiseMap?.clear?.();
  vn.transformPromiseMap?.clear?.();
  for (const mod of server.moduleGraph.idToModuleMap.values()) server.moduleGraph.invalidateModule(mod);
  const runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
  await runner.executeId("/@vite/env");
  const imp = (p) => runner.executeFile(`${WORK_ROOT}/src/${p}`);
  return {
    ctd: await imp("lib/ai/chat-turn-destination.ts"),
    dres: await imp("lib/ai/destination-resolution.ts"),
    crs: await imp("lib/ai/conversation-recommendation-session.ts"),
    refine: await imp("lib/ai/recommendation-refinement/index.ts"),
    crg: await imp("lib/ai/continue-recommendation-intent.ts"),
    refresh: await imp("lib/ai/chat-recommendation-refresh.ts"),
    tc: await imp("lib/ai/travel-context.ts"),
    mvp: await imp("lib/ai/must-visit-places.ts"),
    __imp: imp,
  };
}

// ── mock geocode（同 r9 realistic：已知行政區回完整行政層級；其餘只回父城市）──
const LOC = (o) => ({ placeId: `mock-${o.formattedName}`, country: o.country ?? "日本", city: o.city ?? "", region: o.region, district: o.district, sublocality: o.sublocality, lat: o.lat ?? 35, lng: o.lng ?? 135, formattedName: o.formattedName, displayLabel: o.formattedName });
const REAL = {
  台中西屯: LOC({ country: "台灣", city: "台中市", region: "台中市", district: "西屯區", formattedName: "台中市西屯區", lat: 24.18, lng: 120.62 }),
  香港跑馬地: LOC({ country: "香港", city: "香港", region: "香港島", district: "灣仔區", sublocality: "跑馬地", formattedName: "跑馬地", lat: 22.27, lng: 114.18 }),
};
const PARENTS = ["台中", "香港", "京都", "大阪", "台北", "東京"];
let geoMode = "ok";
let geoDelay = 0;
const geoLog = [];
const geocodeFn = async (req) => {
  const q = String(req?.data?.query ?? "");
  geoLog.push(q);
  if (geoDelay) await new Promise((r) => setTimeout(r, geoDelay));
  if (geoMode === "timeout") throw new Error("provider timeout");
  if (geoMode === "null") return null;
  if (geoMode === "zero") return { location: null, error: null, providerResult: { ok: false, status: "ZERO_RESULTS", query: q } };
  if (geoMode === "neterr") return { location: null, error: "geocode_network_error", providerResult: { ok: false, status: "geocode_network_error", query: q } };
  const key = q.split(",")[0].trim();
  const parent = PARENTS.find((p) => key.startsWith(p)) ?? key;
  const location = REAL[key] ?? LOC({ country: /台/.test(parent) ? "台灣" : "日本", city: parent, region: parent, formattedName: parent });
  return { location, error: null, providerResult: { ok: true, status: "OK", query: q } };
};
let fakeNow = null;
const realNow = Date.now;
Date.now = () => (fakeNow ?? realNow());

const out = [];
const P = (...a) => out.push(a.join(" "));
const LOCALE = "zh-TW";
const S0 = { recommendedPlaces: [], selectedPlaces: [], phase: "recommend", discovery: {}, updatedAt: "2026-01-01T00:00:00.000Z", activeCategoryIntent: "restaurant", conversationMode: "destination_planning" };
const pool = (d) => [1, 2, 3, 4].map((j) => ({ name: `${d}-p${j}`, placeName: `${d}-p${j}`, placeId: `p-${d}-${j}`, googlePlaceId: `p-${d}-${j}`, lat: 24, lng: 120, rating: 4.5, category: "restaurant" }));
const recOf = (M, d, scope, p = pool(d)) => M.crs.createRecommendationSession({ destination: d, topic: "restaurant", pool: p, batchSize: 3, usedQueries: [], recommendationPage: 0, parentCity: scope?.parentCity, area: scope?.area, searchScope: scope ? "area" : "city", searchRegionLabel: d }).session;
const sess = (M, d, extra = {}, scope) => ({ ...S0, recommendationSession: recOf(M, d, scope), travelContext: { interests: [], destination: d }, recommendedPlaces: pool(d), ...extra });
// pushMorePlaceRecommendations 呼叫前的 activeSession（caller 以 travelContext.destination=destForMore 呼叫）
async function more(M, session, text) {
  const destForMore = session.activeRecommendationContext?.destinationName || session.recommendationSession?.destination || session.travelContext?.destination || session.tripPlanningContext?.destination || session.tripDestination?.city;
  const active = { ...session, travelContext: { ...(session.travelContext ?? { interests: [] }), destination: destForMore, tripPurpose: "more_place_recommendations" } };
  const merged = M.tc.mergeTravelContext(active, text);
  const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, active);
  const g0 = geoLog.length;
  let dest;
  try {
    dest = await M.ctd.resolveMorePlacesTurnDestination({ ctx: placeCtx, session: merged.session, userText: text, locale: LOCALE, geocodeFn });
  } catch (e) {
    dest = `ERR:${e?.message ?? e}`;
  }
  return { dest: dest ?? null, geo: geoLog.slice(g0) };
}
async function category(M, session, text) {
  const merged = M.tc.mergeTravelContext(session, text);
  const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, session);
  const g0 = geoLog.length;
  const r0 = M.ctd.resolveCategoryTurnDestination({ ctx: placeCtx, session: merged.session, userText: text, locale: LOCALE });
  const r = await M.ctd.validateCategoryTurnDestination(r0, { locale: LOCALE, geocodeFn });
  const plan = M.ctd.planCategoryTurnClarification(r);
  return { dest: r.destination ?? null, conf: `${r.confidence}/${r.source}`, plan: plan ? `${plan.kind}:${plan.confirmedParentCity ?? plan.clarificationLabel}` : null, geo: geoLog.slice(g0) };
}
const fmt = (x) => `dest=${x.dest ?? "-"}${x.conf ? ` (${x.conf})` : ""}${x.plan ? ` plan=${x.plan}` : ""} geocode=${x.geo.length}${x.geo.length ? `[${x.geo.join(",")}]` : ""}`;
const fails = [];
const expect = (id, cond, msg) => {
  P(`  ${cond ? "PASS" : "FAIL"} ${id}：${msg}`);
  if (!cond) fails.push(`${id}：${msg}`);
};

// ════ A. 續推語句 × 京都已確認對話（work / f9 / pre 比較：resolveMorePlacesTurnDestination 只在 work；f9／pre 以各自 more_places 鏡像）════
const PHRASES = [
  "再推薦幾個", "還有嗎", "換一批", "繼續推薦", "再來幾個", "更多", "還有其他的嗎", "再推薦幾個咖啡廳", "那咖啡廳呢", "more", "想要室內的", "不要寺廟",
  "換大阪，再推薦幾個", "換大阪再推薦幾個", "大阪再推薦幾個", "大阪還有嗎",
  "換里斯本，再推薦幾個", "換里斯本再推薦幾個", "里斯本再推薦幾個", "換成里斯本再推薦幾個", "去里斯本再來幾個", "換到里斯本還有嗎", "那里斯本還有嗎", "改去里斯本再推薦幾個",
  "換金澤，再推薦幾個", "換首爾，再推薦幾個", "換巴黎再推薦幾個", "換馬孔多，再推薦幾個", "換波爾圖還有嗎",
  "換台中西屯，再推薦幾個", "台中西屯再推薦幾個", "台中牛牛區再推薦幾個", "換台中牛牛區再推薦幾個",
];
P("\n══ A. 京都已確認（ctx=京都、rec=京都）→ 續推語句：work resolveMorePlacesTurnDestination；Authority 讀到的片段 ══");
{
  const M = await freshModules("work");
  for (const t of PHRASES) {
    geoMode = "ok";
    const r = await more(M, sess(M, "京都"), t);
    const rd = M.dres.resolveDestination({ text: t });
    const frag = rd.areaCandidate ? `tail=${rd.areaCandidate.parentCity}+${rd.areaCandidate.area}` : rd.provisionalCandidate ? `prov=${rd.provisionalCandidate.areaCandidate ?? "?"}` : rd.rawLabel ? `raw=${rd.rawLabel}` : "-";
    P(`  「${t}」 → ${fmt(r)} | grammar=${M.crg.matchesContinueRecommendationGrammar(t)} refetch=${M.refresh.shouldRefetchPlaces(t, sess(M, "京都"), { interests: [], destination: "京都" })} | authority=${rd.destination ?? "-"}/${rd.confidence}/${rd.source} ${frag}`);
  }
}

P("\n══ A1. 同一批語句在 f9（F10 前＝G2S1 鏡像：resolveCategoryTurnDestination）與 pre（G2S1 前：placeCtx.destination＋isUnconfirmed）══");
for (const tree of ["f9", "pre"]) {
  const M = await freshModules(tree);
  const cells = [];
  for (const t of PHRASES) {
    const s = sess(M, "京都");
    const active = { ...s, travelContext: { ...s.travelContext, destination: "京都", tripPurpose: "more_place_recommendations" } };
    const merged = M.tc.mergeTravelContext(active, t);
    const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, active);
    let d;
    if (tree === "f9") d = M.ctd.resolveCategoryTurnDestination({ ctx: placeCtx, session: merged.session, userText: t, locale: LOCALE }).destination;
    else {
      const x = placeCtx.destination?.trim() || active.tripPlanningContext?.destination?.trim() || active.tripDestination?.city?.trim();
      d = x && !M.ctd.isUnconfirmedSearchDestination(x, active) ? x : undefined;
    }
    cells.push(`${t}=${d ?? "-"}`);
  }
  P(`  ${tree}: ${cells.join(" | ")}`);
}

P("\n══ A2. 新目的地優先／不擴大範圍／不新增非必要 geocode（work；京都已確認對話）══");
{
  const M = await freshModules("work");
  geoMode = "ok";
  for (const t of ["換里斯本，再推薦幾個", "換里斯本再推薦幾個", "里斯本再推薦幾個", "去里斯本再來幾個", "換到里斯本還有嗎", "換金澤，再推薦幾個", "換馬孔多，再推薦幾個", "換波爾圖還有嗎"]) {
    const r = await more(M, sess(M, "京都"), t);
    expect(`A2-newDest-${t}`, r.dest !== "京都", `京都 → ${t} ${fmt(r)}（本輪指定新目的地，不得沿用京都）`);
  }
  for (const t of ["大阪還有嗎", "台中西屯還有嗎"]) {
    const r = await more(M, sess(M, "京都"), t);
    expect(`A2-geo-${t}`, r.geo.every((q) => !/還$/.test(q)), `京都 → ${t} ${fmt(r)}（不得以續推字尾組成的標籤呼叫 geocode）`);
  }
  for (const t of ["台中西屯再推薦幾個", "台中牛牛區再推薦幾個"]) {
    const r = await more(M, sess(M, "京都"), t);
    expect(`A2-scope-${t}`, r.dest !== "台中", `京都 → ${t} ${fmt(r)}（不得未經確認擴大成整個台中）`);
  }
}

// ════ B. 必驗 1–4 / 7 / 8 ════
P("\n══ B. 必驗 1–4、7、8（work）══");
{
  const M = await freshModules("work");
  geoMode = "ok";
  for (const [t, want] of [["再推薦幾個", "京都"], ["還有嗎", "京都"], ["換一批", "京都"], ["換大阪，再推薦幾個", "大阪"], ["大阪再推薦幾個", "大阪"]]) {
    const r = await more(M, sess(M, "京都"), t);
    expect(`B-京都-${t}`, r.dest === want && r.geo.length === 0, `京都 → ${t} ${fmt(r)}（應=${want}、geocode=0）`);
  }
  // 里斯本：同一對話帶既有 resolved candidate（global candidate flow）或 resolved trip
  const lisResolvedCtx = { ...sess(M, "里斯本"), travelContext: { interests: [], destination: "里斯本", destinationCandidate: { status: "resolved" } } };
  const lisTrip = { ...sess(M, "里斯本"), tripDestination: { placeId: "mock-lisbon", city: "里斯本", displayLabel: "里斯本", country: "葡萄牙", lat: 38.72, lng: -9.14 } };
  const lisLegacy = sess(M, "里斯本");
  for (const [id, s] of [["resolvedCandidate", lisResolvedCtx], ["resolvedTrip", lisTrip]]) {
    for (const t of ["再推薦幾個", "還有嗎", "換一批"]) {
      const r = await more(M, s, t);
      expect(`B-里斯本-${id}-${t}`, r.dest === "里斯本" && r.geo.length === 0, `里斯本(${id}) → ${t} ${fmt(r)}`);
    }
  }
  const rl = await more(M, lisLegacy, "再推薦幾個");
  P(`  INFO 里斯本 舊快照（只有 recommendationSession=里斯本、無 resolved 證據）→ 再推薦幾個 ${fmt(rl)}`);
  for (const t of ["再推薦幾個", "還有嗎", "換一批"]) {
    const r = await more(M, sess(M, "金澤"), t);
    expect(`B-金澤-${t}`, r.dest === "金澤" && r.geo.length === 0, `金澤 → ${t} ${fmt(r)}`);
  }
  const lisToKyoto = await more(M, lisTrip, "換京都，再推薦幾個");
  expect("B-里斯本→換京都", lisToKyoto.dest === "京都", `里斯本(trip) → 換京都，再推薦幾個 ${fmt(lisToKyoto)}`);
}

// ════ C. 快照只當候選＋成本（每情境 fresh 模組＝重新載入）════
const XT = { parentCity: "台中", area: "西屯" };
const HV = { parentCity: "香港", area: "跑馬地" };
P("\n══ C. Session Restore／快照（每段 fresh 模組＝重新載入；mode=geocode 行為）══");
for (const [label, scope] of [["台中西屯", XT], ["香港跑馬地", HV]]) {
  const M = await freshModules("work");
  geoMode = "ok";
  const s = sess(M, label, {}, scope);
  const a = await more(M, s, "再推薦幾個");
  const b = await more(M, s, "再推薦幾個");
  const c = await category(M, s, "推薦咖啡廳");
  const d = await more(M, s, "還有嗎");
  expect(`C-${label}-reload-more`, a.dest === label && a.geo.length === 1, `重新載入後首次 再推薦幾個 ${fmt(a)}（應=${label}、geocode=1）`);
  expect(`C-${label}-more-again`, b.dest === label && b.geo.length === 0, `第二次 再推薦幾個 ${fmt(b)}（geocode=0）`);
  expect(`C-${label}-cafe-after`, c.dest === label && c.geo.length === 0, `推薦咖啡廳 ${fmt(c)}（geocode=0）`);
  expect(`C-${label}-haiyouma`, d.dest === label && d.geo.length === 0, `還有嗎 ${fmt(d)}（geocode=0）`);
}
{
  const M = await freshModules("work");
  geoMode = "ok";
  const s = sess(M, "台中西屯", {}, XT);
  const c = await category(M, s, "推薦咖啡廳");
  const m2 = await more(M, s, "再推薦幾個");
  expect("C-台中西屯-reload-cafe-then-more", c.dest === "台中西屯" && c.geo.length === 1 && m2.dest === "台中西屯" && m2.geo.length === 0, `重新載入 → 推薦咖啡廳 ${fmt(c)} → 再推薦幾個 ${fmt(m2)}`);
  const x = await more(M, s, "台中西屯再推薦幾個");
  P(`  INFO (c) 台中西屯（已驗證）→ 台中西屯再推薦幾個 ${fmt(x)}`);
  const x2 = await more(M, s, "西屯再推薦幾個");
  P(`  INFO (c) 台中西屯（已驗證）→ 西屯再推薦幾個 ${fmt(x2)}`);
  const x3 = await more(M, s, "台中西屯還有嗎");
  P(`  INFO (c) 台中西屯（已驗證）→ 台中西屯還有嗎 ${fmt(x3)}`);
}
// in-flight：同輪類別路徑＋more_places 並行
{
  const M = await freshModules("work");
  geoMode = "ok";
  geoDelay = 20;
  const s = sess(M, "台中西屯", {}, XT);
  const g0 = geoLog.length;
  const [c, m] = await Promise.all([category(M, s, "推薦咖啡廳"), more(M, s, "再推薦幾個")]);
  geoDelay = 0;
  const n = geoLog.length - g0;
  expect("C-inflight", n === 1 && c.dest === "台中西屯" && m.dest === "台中西屯", `並行 類別＋more_places：geocode 合計=${n}（應=1） cat=${c.dest} more=${m.dest}`);
}
// 失敗 mode：timeout / null / zero / neterr；冷卻 15 秒
for (const mode of ["timeout", "null", "zero", "neterr"]) {
  const M = await freshModules("work");
  geoMode = mode;
  fakeNow = 1_000_000;
  const s = sess(M, "台中西屯", {}, XT);
  const a = await more(M, s, "再推薦幾個");
  const b = await more(M, s, "還有嗎");
  const b2 = await more(M, s, "再推薦幾個");
  fakeNow += 14_000;
  const b3 = await more(M, s, "換一批");
  fakeNow -= 14_000;
  const c = await category(M, s, "推薦咖啡廳");
  expect(`C-${mode}-cool-more`, b2.dest === null && b2.geo.length === 0 && b3.dest === null && b3.geo.length === 0, `${mode}：冷卻內 再推薦幾個 ${fmt(b2)}；14 秒時 換一批 ${fmt(b3)}（皆 geocode=0、不信任）`);
  fakeNow += 16_000;
  const d = await more(M, s, "再推薦幾個");
  geoMode = "ok";
  fakeNow += 16_000;
  const e = await more(M, s, "再推薦幾個");
  fakeNow = null;
  expect(`C-${mode}-1`, a.dest === null && a.geo.length === 1, `${mode}：重新載入後 再推薦幾個 ${fmt(a)}（不得信任、geocode=1）`);
  expect(`C-${mode}-cool`, b.dest === null && b.geo.length === 0, `${mode}：冷卻內 還有嗎 ${fmt(b)}（geocode=0）`);
  P(`  INFO ${mode}：冷卻內 推薦咖啡廳 ${fmt(c)}`);
  expect(`C-${mode}-retry`, d.dest === null && d.geo.length === 1, `${mode}：16 秒後 再推薦幾個 ${fmt(d)}（再試一次 geocode=1，仍不信任）`);
  expect(`C-${mode}-recover`, e.dest === "台中西屯" && e.geo.length === 1, `${mode}：Provider 恢復後（再 16 秒）再推薦幾個 ${fmt(e)}`);
}
// 偽造快照（recommendationSession / activeRecommendationContext）、舊版快照
P("\n══ C2. 偽造／舊版快照（work）══");
for (const mode of ["ok", "timeout", "null", "zero"]) {
  const M = await freshModules("work");
  geoMode = mode;
  const forged = sess(M, "台中牛牛區", {}, { parentCity: "台中", area: "牛牛區" });
  const a = await more(M, forged, "再推薦幾個");
  const b = await more(M, forged, "還有嗎");
  const c = await category(M, forged, "推薦咖啡廳");
  expect(`C2-forgedRec-${mode}`, a.dest === null && b.dest === null && c.dest === null && a.geo.length <= 1 && b.geo.length === 0, `偽造 recommendationSession=台中牛牛區：再推薦幾個 ${fmt(a)}；還有嗎 ${fmt(b)}；推薦咖啡廳 ${fmt(c)}`);
  const M2 = await freshModules("work");
  const active = M2.refine.ensureActiveRecommendationContext(S0, { destination: "台中牛牛區", intent: "restaurant", parentCity: "台中", area: "牛牛區", searchScope: "area" });
  const fa = { ...S0, activeRecommendationContext: active, travelContext: { interests: [], destination: "台中牛牛區" }, recommendedPlaces: pool("台中牛牛區") };
  const a2 = await more(M2, fa, "再推薦幾個");
  const c2 = await category(M2, fa, "推薦咖啡廳");
  expect(`C2-forgedActive-${mode}`, a2.dest === null && c2.dest === null && a2.geo.length <= 1, `偽造 activeRecommendationContext=台中牛牛區：再推薦幾個 ${fmt(a2)}；推薦咖啡廳 ${fmt(c2)}`);
  // 偽造成「合法名稱」但父城市不同（台北+西屯）
  const M3 = await freshModules("work");
  const wrong = sess(M3, "台中西屯", {}, { parentCity: "台北", area: "西屯" });
  const a3 = await more(M3, wrong, "再推薦幾個");
  expect(`C2-wrongParent-${mode}`, a3.dest === null && a3.geo.length === 0, `快照 台中西屯 但 parentCity=台北：${fmt(a3)}`);
  // 舊版快照（aa2db59 無 area 欄位；searchScope=city）
  const M4 = await freshModules("work");
  const legacy = sess(M4, "台中牛牛區");
  const a4 = await more(M4, legacy, "再推薦幾個");
  const c4 = await category(M4, legacy, "推薦咖啡廳");
  expect(`C2-legacyTail-${mode}`, a4.dest === null && c4.dest === null && a4.geo.length === 0, `舊版快照 台中牛牛區（city scope）：再推薦幾個 ${fmt(a4)}；推薦咖啡廳 ${fmt(c4)}`);
  const legacyX = sess(M4, "台中西屯");
  const a5 = await more(M4, legacyX, "再推薦幾個");
  P(`  INFO ${mode} 舊版快照 台中西屯（city scope、無 area）→ 再推薦幾個 ${fmt(a5)}`);
}
geoMode = "ok";

// ════ D. (f) pushRecommendationRefinement 可達性（L6203-6213）════
P("\n══ D. (f) pushRecommendationRefinement 對偽造快照的放行（真實模組 arbitration／isUnconfirmedSearchDestination）══");
{
  const M = await freshModules("work");
  const forged = sess(M, "台中牛牛區", {}, { parentCity: "台中", area: "牛牛區" });
  const active = M.refine.ensureActiveRecommendationContext(forged, { destination: "台中牛牛區", intent: "restaurant", parentCity: "台中", area: "牛牛區", searchScope: "area", places: pool("台中牛牛區") });
  const forgedA = { ...forged, activeRecommendationContext: active };
  for (const t of ["便宜一點的", "有沒有日式的", "要評價高一點的", "再推薦幾個", "還有嗎"]) {
    const a1 = M.refine.resolveChatIntentArbitration(t, forged);
    const a2 = M.refine.resolveChatIntentArbitration(t, forgedA);
    P(`  「${t}」 rec-only route=${a1.route} refinement=${a1.refinement ? "Y" : "N"} | active route=${a2.route} refinement=${a2.refinement ? "Y" : "N"} refetch=${M.refresh.shouldRefetchPlaces(t, forged, forged.travelContext)}`);
  }
  // 京都已確認對話：shouldRefetchPlaces 為 true 的語句實際走哪條 arbitration（MORE_RECOMMENDATIONS → L6238 return false → pushMorePlaceRecommendations）
  const ky = sess(M, "京都");
  const kyA = { ...ky, activeRecommendationContext: M.refine.ensureActiveRecommendationContext(ky, { destination: "京都", intent: "attraction", places: pool("京都") }) };
  for (const t of ["還有嗎", "想要室內的", "不要寺廟", "換一批", "再推薦幾個", "換里斯本，再推薦幾個", "大阪還有嗎"]) {
    const a1 = M.refine.resolveChatIntentArbitration(t, ky);
    const a2 = M.refine.resolveChatIntentArbitration(t, kyA);
    P(`  京都「${t}」 refetch=${M.refresh.shouldRefetchPlaces(t, ky, ky.travelContext)} rec-only route=${a1.route} | active route=${a2.route} refinement=${a2.refinement ? JSON.stringify(a2.refinement).slice(0, 80) : "-"}`);
  }
  // L6203-6292 鏡像：RECOMMENDATION_REFINEMENT → applyRefinementPatchToSession（無信任檢查）→ Credits metadata=recCtx.destinationName → buildRecommendationRefinementResults
  {
    const exe = await M.__imp("lib/ai/recommendation-refinement/execute.ts");
    const arb = M.refine.resolveChatIntentArbitration("便宜一點的", forgedA);
    const s2 = arb.refinement ? M.refine.applyRefinementPatchToSession(forgedA, arb.refinement) : forgedA;
    const recCtx = s2.activeRecommendationContext;
    const placesQ = [];
    const g0 = geoLog.length;
    let res = null;
    try {
      res = await exe.buildRecommendationRefinementResults({
        context: recCtx,
        travelContext: { interests: [], destination: recCtx.destinationName },
        locale: LOCALE,
        searchPlaces: async ({ data }) => {
          placesQ.push(`${data?.query ?? ""}@${data?.destinationName ?? data?.cacheCity ?? "-"}`);
          return { places: [], error: null, rawCount: 0 };
        },
        geocodeFn,
        session: s2,
      });
    } catch (e) {
      res = `ERR:${e?.message ?? e}`;
    }
    P(`  (f) 偽造 activeRecommendationContext＋「便宜一點的」：route=${arb.route} creditsMetadata.destination=${recCtx?.destinationName ?? "-"} geocode=${geoLog.length - g0}[${geoLog.slice(g0).join(",")}] placesSearch=${placesQ.length}[${placesQ.slice(0, 4).join(",")}] result=${typeof res === "string" ? res : res ? "obj" : "null"}`);
  }
  P(`  isUnconfirmedSearchDestination("台中牛牛區", 偽造 rec) = ${M.ctd.isUnconfirmedSearchDestination("台中牛牛區", forged)}（false＝L6213 放行）`);
  P(`  isUnconfirmedSearchDestination("台中牛牛區", 無快照) = ${M.ctd.isUnconfirmedSearchDestination("台中牛牛區", { ...S0 })}`);
}

// ════ E. g. 清理流程（withoutUnconfirmedSessionDestinations）對 Reload 後、驗證前合法 preferredArea 的影響 ════
P("\n══ E. (g) withoutUnconfirmedSessionDestinations：Reload 後（fresh 模組、未驗證）合法 台中西屯 欄位 ══");
{
  const M = await freshModules("work");
  const s = sess(M, "台中西屯", { preferredArea: "台中西屯", tripPlanningContext: { selectedPlaces: [], destination: "台中西屯", intent: "destination_planning" } }, XT);
  const r = M.ctd.withoutUnconfirmedSessionDestinations(s, s);
  P(`  未驗證：pref=${r.preferredArea ?? "-"} tpc=${r.tripPlanningContext?.destination ?? "-"} | confirmedDestinationLabelOrUndefined=${M.ctd.confirmedDestinationLabelOrUndefined("台中西屯", s) ?? "-"} confirmedContextDestination=${M.ctd.confirmedContextDestination(s.travelContext, s)?.destination ?? "-"}`);
  geoMode = "ok";
  await category(M, s, "推薦咖啡廳");
  const r2 = M.ctd.withoutUnconfirmedSessionDestinations(s, s);
  P(`  驗證後：pref=${r2.preferredArea ?? "-"} tpc=${r2.tripPlanningContext?.destination ?? "-"} | confirmedContextDestination=${M.ctd.confirmedContextDestination(s.travelContext, s)?.destination ?? "-"}`);
  for (const tree of ["f9", "pre"]) {
    const Mt = await freshModules(tree);
    const st = sess(Mt, "台中西屯", { preferredArea: "台中西屯", tripPlanningContext: { selectedPlaces: [], destination: "台中西屯", intent: "destination_planning" } }, XT);
    const rt = Mt.ctd.withoutUnconfirmedSessionDestinations(st, st);
    P(`  ${tree}：pref=${rt.preferredArea ?? "-"} tpc=${rt.tripPlanningContext?.destination ?? "-"} ctx=${Mt.ctd.confirmedContextDestination(st.travelContext, st)?.destination ?? "-"}`);
  }
}

// ════ F. h. 快照候選驗證失敗時類別路徑的澄清（work vs f9 vs pre）════
P("\n══ F. (h) 合法快照 台中西屯 Reload 後 Provider 失敗 → 推薦咖啡廳 的類別路徑（work / f9 / pre）══");
for (const tree of ["work", "f9", "pre"]) {
  for (const mode of ["ok", "timeout", "zero"]) {
    const M = await freshModules(tree);
    geoMode = mode;
    const s = sess(M, "台中西屯", {}, XT);
    const c = await category(M, s, "推薦咖啡廳");
    P(`  ${tree.padEnd(4)} ${mode.padEnd(7)} 推薦咖啡廳 ${fmt(c)}`);
  }
}
geoMode = "ok";

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();
P(`\nexternal=${external}${external ? ` ${extLog.join(";")}` : ""}`);
P(`verify-destination-authority-phase2-r10-probe: FAIL=${fails.length}${fails.length ? `\n  ${fails.join("\n  ")}` : ""} → ${fails.length || external ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(fails.length || external ? 1 : 0);
