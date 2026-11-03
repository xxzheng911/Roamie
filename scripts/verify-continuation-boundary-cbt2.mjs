#!/usr/bin/env node
/**
 * CB-T2 — 續推邊界契約（方案 A）獨立驗收補測。離線、只用 Mock、不寫任何檔案。
 * - 兩棵樹：work（現行）與 pre（CB 前：chat-turn-destination.pre-CB.ts / continue-recommendation-intent.pre-CB.ts，
 *   以 vite load plugin 在記憶體中替換，不寫檔）。每段 freshModules() = 新模組實例（等同重新載入 App）。
 * - more_places：pushMorePlaceRecommendations 鏡像（destination 為真 → 搜尋＋beginPlaceRecommendationCredits）。
 * - 類別路徑：resolveCategoryTurnDestination → validateCategoryTurnDestination。
 * - 外部網路全部攔截（fetch / http / https / net），任何一次即 FAIL。
 * 執行：node scripts/verify-continuation-boundary-cbt2.mjs
 */
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const SCRATCH = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";

for (const k of Object.keys(process.env)) if (/KEY|SECRET|TOKEN|PRIVATE|PASSWORD|SUPABASE|OPENAI|GOOGLE|WEATHER/i.test(k)) delete process.env[k];
Object.assign(process.env, { GOOGLE_MAPS_API_KEY: "mock-key", VITE_SUPABASE_URL: "http://mock-supabase.invalid", VITE_SUPABASE_PUBLISHABLE_KEY: "mock-key" });
let external = 0;
const extLog = [];
globalThis.fetch = async (u) => {
  external += 1;
  extLog.push(String(u?.url ?? u));
  throw new Error("[ext-trap] fetch blocked");
};
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
{
  const net = require("net");
  net.connect = net.createConnection = () => {
    external += 1;
    extLog.push("net");
    throw new Error("[ext-trap] net blocked");
  };
}
const { readFileSync } = await import("node:fs");
const orig = { ...console };
for (const k of ["info", "log", "warn", "debug", "error"]) console[k] = () => {};

const PRE_FILES = {
  [`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`]: readFileSync(`${SCRATCH}/chat-turn-destination.pre-CB.ts`, "utf8"),
  [`${WORK_ROOT}/src/lib/ai/continue-recommendation-intent.ts`]: readFileSync(`${SCRATCH}/continue-recommendation-intent.pre-CB.ts`, "utf8"),
};
let TREE = "work";
const overlayHits = new Set();
const overlayPlugin = {
  name: "cbt2-pre-overlay",
  enforce: "pre",
  load(id) {
    if (TREE !== "pre") return null;
    const f = id.split("?")[0];
    if (PRE_FILES[f] != null) {
      overlayHits.add(f);
      return PRE_FILES[f];
    }
    return null;
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
  plugins: [overlayPlugin, tsconfigPaths()],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await server.environments.client.pluginContainer.buildStart({});
const vn = new ViteNodeServer(server);
async function freshModules(tree) {
  TREE = tree;
  vn.fetchCache?.clear?.();
  vn.fetchPromiseMap?.clear?.();
  vn.transformPromiseMap?.clear?.();
  for (const mod of server.moduleGraph.idToModuleMap.values()) server.moduleGraph.invalidateModule(mod);
  const runner = new ViteNodeRunner({ root: WORK_ROOT, base: "/", fetchModule: (id) => vn.fetchModule(id), resolveId: (id, imp) => vn.resolveId(id, imp) });
  await runner.executeId("/@vite/env");
  const imp = (p) => runner.executeFile(`${WORK_ROOT}/src/${p}`);
  const M = {
    tree,
    ctd: await imp("lib/ai/chat-turn-destination.ts"),
    crs: await imp("lib/ai/conversation-recommendation-session.ts"),
    refine: await imp("lib/ai/recommendation-refinement/index.ts"),
    crg: await imp("lib/ai/continue-recommendation-intent.ts"),
    tc: await imp("lib/ai/travel-context.ts"),
    mvp: await imp("lib/ai/must-visit-places.ts"),
    dres: await imp("lib/ai/destination-resolution.ts"),
  };
  const hasCb = typeof M.crg.analyzeContinueRecommendationStructure === "function";
  if ((tree === "work") !== hasCb) throw new Error(`tree ${tree} overlay mismatch (cb=${hasCb})`);
  return M;
}

// ── mock geocode（同 verify-continuation-boundary-probe.mjs）──
const LOC = (o) => ({ placeId: `mock-${o.formattedName}`, country: o.country ?? "日本", city: o.city ?? "", region: o.region, district: o.district, sublocality: o.sublocality, lat: o.lat ?? 35, lng: o.lng ?? 135, formattedName: o.formattedName, displayLabel: o.formattedName });
const REAL = {
  台中西屯: LOC({ country: "台灣", city: "台中市", region: "台中市", district: "西屯區", formattedName: "台中市西屯區", lat: 24.18, lng: 120.62 }),
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
let geoDelay = 0;
const geocodeFn = async (req) => {
  const q = String(req?.data?.query ?? "");
  geoLog.push(q);
  if (geoDelay) await new Promise((r) => setTimeout(r, geoDelay));
  if (geoMode === "timeout") throw new Error("provider timeout");
  if (geoMode === "null") return null;
  if (geoMode === "zero") return { location: null, error: null, providerResult: { ok: false, status: "ZERO_RESULTS", query: q } };
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
  }
  const d = dest ?? null;
  return { path: "more", dest: d, search: !!d, credits: !!d, geo: geoLog.slice(g0), err };
}
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
  return { path: "cat", dest: d, search: !!d, credits: !!d, geo: geoLog.slice(g0), err };
}
const fmt = (x) => `dest=${x.dest ?? "-"} search=${x.search ? "Y" : "N"} credits=${x.credits ? "begin" : "no"} geo=${x.geo.length}${x.geo.length ? `[${x.geo.join("|")}]` : ""}${x.err ? ` ERR=${x.err}` : ""}`;
const CONT_IN_QUERY_RE = /(再推薦|推薦|幾個|還有|嗎|呢|一批|其他|再|還$|又$|^換|^好[，,]?|^請|^去|^到|\d+個)/;
const cleanQ = (x) => x.geo.every((q) => !CONT_IN_QUERY_RE.test(q.split(",")[0].trim().replace(/又一村/g, "")));

const out = [];
const P = (...a) => out.push(a.join(" "));
const rows = [];
function expect(id, cond, detail, tag = "") {
  rows.push({ id, ok: !!cond, detail, tag });
  P(`  ${cond ? "PASS" : "FAIL"} ${id}${tag ? ` [${tag}]` : ""}：${detail}`);
}
const info = (m) => P(`  INFO ${m}`);

// 每個情境：work 與 pre 各在 fresh 模組 + 京都已確認 Session 上跑 more（ok 模式），記錄對照
async function both(text, mkSession = (M) => sess(M, "京都"), mode = "ok", fn = more) {
  const res = {};
  for (const tree of ["work", "pre"]) {
    const M = await freshModules(tree);
    geoMode = mode;
    res[tree] = await fn(M, mkSession(M), text);
  }
  return res;
}

// ════ A. 必要情境表（more_places，已確認京都，Provider ok）════
P("\n══ A. 必要情境表（more_places × 已確認京都 × ok）work vs pre(CB 前) ══");
const REQUIRED = [
  ["還有嗎", "京都"], ["再推薦幾個", "京都"], ["換一批", "京都"], ["大阪還有嗎", "大阪"], ["換大阪，再推薦幾個", "大阪"],
  ["換里斯本，再推薦幾個", "≠京都"], ["換金澤，再推薦幾個", "金澤"], ["台中西屯再推薦幾個", "台中西屯"], ["台中牛牛區再推薦幾個", "無搜尋"],
  ["還有其他咖啡廳嗎", "京都"], ["好，再推薦幾個", "京都"], ["請再推薦幾個", "京都"],
  ["香港跑馬地", "≠京都"], ["香港又一村", "≠京都"], ["台南看西街教會", "≠京都"], ["東京玩具美術館", "≠京都"],
  ["里斯本", "≠京都"], ["波爾圖", "≠京都"], ["金澤", "金澤"],
];
const tableRows = [];
for (const [t, want] of REQUIRED) {
  const r = await both(t);
  tableRows.push(`  | ${t} | work: ${fmt(r.work)} | pre: ${fmt(r.pre)} |`);
  let ok;
  if (want === "≠京都") ok = r.work.dest !== "京都" && r.work.geo.length <= 1 && cleanQ(r.work);
  else if (want === "無搜尋") ok = !r.work.search && !r.work.credits && r.work.geo.length <= 1 && cleanQ(r.work);
  else ok = r.work.dest === want && r.work.geo.length <= (want === "京都" || want === "大阪" || want === "金澤" ? 0 : 1) && cleanQ(r.work);
  expect(`A-${t}`, ok, `期望 ${want}；work ${fmt(r.work)}；pre ${fmt(r.pre)}`);
}
P("\n  必要情境表（more_places）：", ...tableRows);

// ════ B. 補測邊界句（more_places × 已確認京都 × ok）════
P("\n══ B. 補測邊界句（more_places × 已確認京都 × ok）══");
// [句子, 期望 kind]：pure=沿用京都且 geo=0；dest:X=得到 X；noKyoto=不得沿用京都且查詢乾淨；info=只記錄
const EXTRA = [
  ["再推薦3個", "pure"], ["再推薦5間", "pure"], ["附近還有嗎", "pure"], ["換一批咖啡廳", "pure"], ["還有別的嗎", "pure"], ["有其他的嗎", "pure"],
  ["好", "noSearchNoGeo"], ["請", "noSearchNoGeo"], ["好。", "noSearchNoGeo"],
  ["香港又一村還有嗎", "noKyoto"], ["香港又一村再推薦幾個", "noKyoto"], ["台南看西街教會還有嗎", "noKyoto"], ["東京玩具美術館還有嗎", "noKyoto"], ["香港跑馬地還有嗎", "noKyoto"],
  ["換到里斯本還有嗎", "noKyoto"], ["去里斯本再來幾個", "noKyoto"], ["換波爾圖還有嗎", "noKyoto"],
  ["好，大阪再推薦幾個", "dest:大阪"], ["請，大阪還有嗎", "dest:大阪"], ["好，換大阪，再推薦幾個", "dest:大阪"], ["好大阪再推薦幾個", "noKyoto"], ["請大阪再推薦幾個", "noKyoto"],
  ["好，台中西屯再推薦幾個", "dest:台中西屯"], ["請換大阪再推薦幾個", "noKyoto"],
  ["大阪再推薦3個", "noKyotoClean"], ["台中西屯再推薦3個", "noKyotoClean"], ["台中西屯再推薦5間咖啡廳", "noKyotoClean"], ["大阪再來3間", "noKyotoClean"],
  ["大阪還", "noKyotoClean"], ["台中西屯再", "noKyotoClean"], ["換里斯本再", "noKyotoClean"],
  ["幫我再推薦幾個", "pure"], ["請問還有嗎", "pure"], ["嗯，還有嗎", "pure"], ["那還有嗎", "pure"], ["可以再推薦幾個嗎", "pure"], ["麻煩再推薦幾個", "pure"], ["OK，再推薦幾個", "pure"],
  ["好市多還有嗎", "noKyoto"], ["京都還有嗎", "dest:京都"], ["東京其他美術館", "info"], ["改去大阪再推薦幾個", "info"],
];
const extraRows = [];
for (const [t, kind] of EXTRA) {
  const r = await both(t);
  extraRows.push(`  | ${t} | ${kind} | work: ${fmt(r.work)} | pre: ${fmt(r.pre)} |`);
  const w = r.work;
  let ok = true;
  if (kind === "pure") ok = w.dest === "京都" && w.geo.length === 0;
  else if (kind === "noSearchNoGeo") ok = !w.search && w.geo.length === 0;
  else if (kind.startsWith("dest:")) ok = w.dest === kind.slice(5) && w.geo.length <= 1 && cleanQ(w);
  else if (kind === "noKyoto") ok = w.dest !== "京都" && w.geo.length <= 1 && cleanQ(w);
  else if (kind === "noKyotoClean") ok = w.dest !== "京都" && w.geo.length <= 1 && cleanQ(w);
  if (kind === "info") info(`${t} work ${fmt(w)}；pre ${fmt(r.pre)}`);
  else expect(`B-${t}`, ok, `期望 ${kind}；work ${fmt(w)}；pre ${fmt(r.pre)}`, ok ? "" : r.pre && (kind === "pure" ? r.pre.dest === "京都" && r.pre.geo.length === 0 : false) ? "work 退化（pre 正確）" : "");
}
P("\n  補測邊界句表（more_places）：", ...extraRows);

// ════ C. 類別路徑（resolveCategoryTurnDestination → validate）════
P("\n══ C. 類別路徑 × 已確認京都 × ok ══");
for (const t of ["大阪還有嗎", "台中西屯還有其他咖啡廳嗎", "台中西屯再推薦幾個", "換大阪，再推薦幾個", "香港又一村還有嗎", "台中西屯再推薦3個", "推薦咖啡廳", "台中西屯咖啡廳", "還有其他咖啡廳嗎"]) {
  const r = await both(t, undefined, "ok", category);
  expect(`C-${t}`, r.work.geo.length <= 1 && cleanQ(r.work), `work ${fmt(r.work)}；pre ${fmt(r.pre)}（geo≤1、查詢不含續推字）`);
}

// ════ D. Provider 失敗模式（新目的地；不得回退京都／父城市、不得扣點）════
P("\n══ D. Provider 失敗模式 ══");
for (const mode of ["timeout", "null", "zero"]) {
  for (const t of ["台中西屯再推薦幾個", "台中西屯還有嗎", "好，台中西屯再推薦幾個", "香港跑馬地還有嗎", "換里斯本，再推薦幾個", "台中西屯再推薦3個"]) {
    const r = await both(t, undefined, mode);
    expect(`D-${mode}-${t}`, r.work.dest == null && !r.work.credits && r.work.geo.length <= 1 && cleanQ(r.work), `work ${fmt(r.work)}；pre ${fmt(r.pre)}`);
  }
}

// ════ E. 國際城市／已確認同城再點名 ════
P("\n══ E. 已確認國際城市 × 純續推／同城點名 ══");
for (const [city, mk] of [
  ["里斯本", (M) => tripSess(M, "里斯本", "葡萄牙", 38.72, -9.14)],
  ["波爾圖", (M) => tripSess(M, "波爾圖", "葡萄牙", 41.15, -8.61)],
  ["金澤", (M) => sess(M, "金澤")],
]) {
  for (const t of ["還有嗎", "好，再推薦幾個", "請再推薦幾個", "換一批", "再推薦3個"]) {
    const r = await both(t, mk);
    expect(`E-${city}-${t}`, r.work.dest === city && r.work.geo.length === 0, `work ${fmt(r.work)}；pre ${fmt(r.pre)}`);
  }
  for (const t of [`${city}還有嗎`, `${city}再推薦幾個`]) {
    const r = await both(t, mk);
    expect(`E-${city}-same-${t}`, r.work.dest !== "京都" && r.work.geo.length <= 1 && cleanQ(r.work), `work ${fmt(r.work)}；pre ${fmt(r.pre)}（同城點名：記錄是否仍可搜尋）`, r.work.dest === city ? "" : "UX");
    info(`同城點名 ${t}：work dest=${r.work.dest ?? "-"} pre dest=${r.pre.dest ?? "-"}`);
  }
}

// ════ F. Reload 後續推（台中西屯／香港跑馬地；第一次 ≤1、之後 0）════
P("\n══ F. Reload 後續推 ══");
for (const [label, scope] of [["台中西屯", { parentCity: "台中", area: "西屯" }], ["香港跑馬地", { parentCity: "香港", area: "跑馬地" }]]) {
  for (const tree of ["work", "pre"]) {
    const M = await freshModules(tree);
    geoMode = "ok";
    const s = sess(M, label, {}, scope);
    const seq = ["還有嗎", "好，再推薦幾個", `${label}還有嗎`, "請再推薦幾個", "換一批"];
    const rs = [];
    for (const t of seq) rs.push([t, await more(M, s, t)]);
    const total = rs.reduce((a, [, r]) => a + r.geo.length, 0);
    const ok = rs.every(([, r]) => r.dest === label && cleanQ(r)) && total <= 1;
    const line = rs.map(([t, r]) => `${t}→${fmt(r)}`).join("；");
    if (tree === "work") expect(`F-${label}-reload`, ok, `${line}（全部=${label}、geocode 合計≤1=${total}）`);
    else info(`pre F-${label}-reload：${line}`);
  }
}

// ════ G. Provider 成本：快取、in-flight 去重、15 秒冷卻 ════
P("\n══ G. Provider 成本（同一模組實例）══");
{
  const M = await freshModules("work");
  geoMode = "ok";
  const a = await more(M, sess(M, "京都"), "台中西屯再推薦幾個");
  const b = await more(M, sess(M, "京都"), "台中西屯還有嗎");
  const c = await category(M, sess(M, "京都"), "台中西屯還有其他咖啡廳嗎");
  expect("G-cache", a.geo.length === 1 && b.geo.length === 0 && c.geo.length === 0 && a.dest === "台中西屯" && b.dest === "台中西屯", `${fmt(a)}；${fmt(b)}；${fmt(c)}（第一次 1、之後 0）`);
}
{
  const M = await freshModules("work");
  geoMode = "ok";
  geoDelay = 30;
  const g0 = geoLog.length;
  const [a, b] = await Promise.all([more(M, sess(M, "京都"), "台中西屯再推薦幾個"), more(M, sess(M, "京都"), "好，台中西屯再推薦幾個")]);
  geoDelay = 0;
  expect("G-inflight", geoLog.length - g0 === 1 && a.dest === "台中西屯" && b.dest === "台中西屯", `並行 2 次 → geocode=${geoLog.length - g0}`);
}
{
  const M = await freshModules("work");
  geoMode = "timeout";
  const a = await more(M, sess(M, "京都"), "台中西屯再推薦幾個");
  geoMode = "ok";
  const b = await more(M, sess(M, "京都"), "台中西屯還有嗎");
  expect("G-cooldown", a.geo.length === 1 && b.geo.length === 0 && a.dest == null && b.dest == null, `timeout ${fmt(a)} → 立即重試 ${fmt(b)}（15 秒內不重試、不搜尋）`);
}
{
  const M = await freshModules("work");
  geoMode = "zero";
  const a = await more(M, sess(M, "京都"), "台中西屯再推薦幾個");
  geoMode = "ok";
  const b = await more(M, sess(M, "京都"), "台中西屯再推薦幾個");
  expect("G-unavailable-cached", a.geo.length === 1 && b.geo.length === 0 && b.dest == null, `ZERO_RESULTS ${fmt(a)} → 再問 ${fmt(b)}`);
}
// 純續推 geocode 總數（work vs pre），全部 PURE × 5 mode
{
  const PURE = ["還有嗎", "再推薦幾個", "換一批", "還有其他咖啡廳嗎", "好，再推薦幾個", "請再推薦幾個"];
  const tot = { work: 0, pre: 0 };
  for (const tree of ["work", "pre"]) {
    for (const mode of ["ok", "timeout", "null", "zero"]) {
      const M = await freshModules(tree);
      geoMode = mode;
      for (const t of PURE) tot[tree] += (await more(M, sess(M, "京都"), t)).geo.length;
    }
  }
  expect("G-pure-geocode-total", tot.work === 0, `純續推 geocode 合計 work=${tot.work} pre=${tot.pre}`);
}

// ════ H. 偽造／舊版快照不得重新放行（契約 6）════
P("\n══ H. 偽造／舊版快照 × 續推句（含句首語助詞、地名接續推）══");
for (const mode of ["ok", "timeout", "zero"]) {
  const mk = [
    ["legacy", (M) => sess(M, "台中牛牛區")],
    ["forgedRec", (M) => sess(M, "台中牛牛區", {}, { parentCity: "台中", area: "牛牛區" })],
    ["forgedActive", (M) => ({ ...S0, activeRecommendationContext: M.refine.ensureActiveRecommendationContext(S0, { destination: "台中牛牛區", intent: "restaurant", parentCity: "台中", area: "牛牛區", searchScope: "area" }), travelContext: { interests: [], destination: "台中牛牛區" }, recommendedPlaces: pool("台中牛牛區") })],
  ];
  for (const [label, f] of mk) {
    const M = await freshModules("work");
    geoMode = mode;
    const s = f(M);
    const rs = [];
    for (const t of ["好，再推薦幾個", "請再推薦幾個", "換一批", "台中牛牛區還有嗎", "再推薦3個", "附近還有嗎"]) rs.push(await more(M, s, t));
    rs.push(await category(M, s, "還有其他咖啡廳嗎"));
    const g = rs.reduce((a, r) => a + r.geo.length, 0);
    expect(`H-${label}-${mode}`, rs.every((r) => r.dest == null && !r.credits && cleanQ(r)) && g <= 1, `${rs.map(fmt).join("；")}（geocode 合計=${g}）`);
  }
}

// ════ I. analyzeContinueRecommendationStructure 結構檢查（契約 1/2/3）════
P("\n══ I. 結構函式（work）══");
{
  const M = await freshModules("work");
  const A = M.crg.analyzeContinueRecommendationStructure;
  const cases = [
    ["香港又一村", false, "香港又一村"], ["台南看西街教會", false, "台南看西街教會"], ["東京玩具美術館", false, "東京玩具美術館"],
    ["香港又一村還有嗎", true, "香港又一村"], ["大阪還有嗎", true, "大阪"], ["換大阪，再推薦幾個", true, "大阪"], ["好，再推薦幾個", true, ""], ["請再推薦幾個", true, ""],
    ["好", false, "好"], ["請", false, "請"], ["再", null, null], ["又", null, null], ["換", null, null], ["還", false, "還"],
    ["好市多還有嗎", true, "好市多"], ["請客還有嗎", true, "請客"], ["好味道再推薦幾個", true, "好味道"], ["換乘站還有嗎", true, null],
  ];
  for (const [t, cont, cand] of cases) {
    const v = A(t);
    const ok = (cont == null || v.isContinue === cont) && (cand == null || v.candidateText === cand) && !/(還有|再推薦|嗎)$/.test(v.candidateText);
    expect(`I-${t}`, ok, `${JSON.stringify(v)}`);
  }
  // 可達性：舊 grammar（chat-intent／refinement 的續推判定）是否把這些句子當續推
  for (const t of ["再推薦3個", "再推薦5間", "大阪再推薦3個", "台中西屯再推薦3個", "台中西屯再", "幫我再推薦幾個", "可以再推薦幾個嗎", "麻煩再推薦幾個", "OK，再推薦幾個", "里斯本再推薦幾個", "改去大阪再推薦幾個", "大阪還"]) {
    info(`grammar("${t}")=${M.crg.matchesContinueRecommendationGrammar(t)} structure.isContinue=${A(t).isContinue} candidate="${A(t).candidateText}"`);
  }
  // 純函式：不得呼叫 Provider
  const g0 = geoLog.length;
  for (const t of ["台中西屯再推薦幾個", "里斯本還有嗎"]) A(t);
  expect("I-pure-no-provider", geoLog.length === g0 && external === 0, `geocode 增量=${geoLog.length - g0}`);
}

// ════ J. 原始碼靜態檢查（契約 3/5/7）════
P("\n══ J. 原始碼靜態檢查 ══");
{
  const cri = readFileSync(`${WORK_ROOT}/src/lib/ai/continue-recommendation-intent.ts`, "utf8");
  const ctd = readFileSync(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, "utf8");
  const criPre = PRE_FILES[`${WORK_ROOT}/src/lib/ai/continue-recommendation-intent.ts`];
  const ctdPre = PRE_FILES[`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`];
  const s = cri.indexOf("// ─────────────── Structured continuation boundary");
  const e = cri.indexOf("/**\n * Optional category mentioned in a continue phrase");
  const block = cri.slice(s, e);
  expect("J-grammar-frozen", s > 0 && e > s && cri.slice(0, s) + cri.slice(e) === criPre, "移除新增區塊後 = pre-CB（舊 grammar 凍結）");
  expect("J-no-imports-in-block", !/\bimport\b|resolveDestination|geocode|fetch\(/.test(block), "新函式區塊無 import／Authority／Provider 呼叫");
  // 只檢查程式碼（去掉 // 與 /* */ 註解；註解中的範例句不影響行為）
  const code = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const cityHit = code.match(/(京都|大阪|台中|香港|里斯本|波爾圖|金澤|東京|台南|台北)/);
  expect("J-no-city-literals", !cityHit, `新函式區塊程式碼無城市字面量${cityHit ? `（命中 ${cityHit[0]}）` : ""}；註解含城市=${/(京都|大阪|台中|香港|里斯本)/.test(block)}`);
  const newLits = [...block.matchAll(/\/\^?\(\?:([^/]+)\)\/|\/\[([^\]]+)\]\//g)].map((m) => m[1] ?? m[2]);
  info(`新函式區塊的新增 regex 字面：${JSON.stringify(newLits)}`);
  expect("J-cooldown-unchanged", ctd.includes("const TRANSIENT_RETRY_MS = 15_000;") && ctdPre.includes("const TRANSIENT_RETRY_MS = 15_000;"), "15 秒冷卻常數未變");
  const provNow = (ctd.match(/geocodeFn\(/g) ?? []).length;
  const provPre = (ctdPre.match(/geocodeFn\(/g) ?? []).length;
  expect("J-no-new-provider-call-site", provNow === provPre, `geocodeFn( 呼叫點 work=${provNow} pre=${provPre}`);
}

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();
const fails = rows.filter((r) => !r.ok);
P("\n══ 摘要 ══");
const groups = {};
for (const r of rows) {
  const g = r.id.split("-")[0];
  groups[g] ??= { pass: 0, fail: 0 };
  groups[g][r.ok ? "pass" : "fail"] += 1;
}
for (const [g, v] of Object.entries(groups)) P(`  §${g}: PASS=${v.pass} FAIL=${v.fail}`);
P(`overlay hits (pre)：${[...overlayHits].map((f) => f.slice(WORK_ROOT.length + 1)).join(", ")}`);
P(`\nexternal=${external}${external ? ` ${extLog.join(";")}` : ""}`);
P(`verify-continuation-boundary-cbt2: PASS=${rows.length - fails.length} FAIL=${fails.length} → ${fails.length || external ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(fails.length || external ? 1 : 0);
