#!/usr/bin/env node
/**
 * CC-T1 — 續推邊界・限定相容性修正（CC）獨立驗收。離線、只用 Mock、不寫任何檔案。
 * 模組載入方式與 verify-continuation-boundary-cbt2.mjs 相同（同一行程內 vite load overlay；無子行程）。
 * 三棵樹：work（現行＝post-CC）、precc（CC 前：*.pre-CC.ts overlay）、precb（CB 前：*.pre-CB.ts overlay，只用於句首詞對照）。
 * more_places：pushMorePlaceRecommendations 鏡像（destination 為真 → Places 搜尋＋beginPlaceRecommendationCredits）。
 * 類別路徑：resolveCategoryTurnDestination → validateCategoryTurnDestination（destination 為真 → 搜尋＋扣點）。
 * 外部網路全部攔截（fetch / http / https / net），任何一次即 FAIL。
 * 執行：node scripts/verify-continuation-boundary-cct1.mjs
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

const CTD = `${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`;
const CRI = `${WORK_ROOT}/src/lib/ai/continue-recommendation-intent.ts`;
const OVERLAY = {
  precc: { [CTD]: readFileSync(`${SCRATCH}/chat-turn-destination.pre-CC.ts`, "utf8"), [CRI]: readFileSync(`${SCRATCH}/continue-recommendation-intent.pre-CC.ts`, "utf8") },
  precb: { [CTD]: readFileSync(`${SCRATCH}/chat-turn-destination.pre-CB.ts`, "utf8"), [CRI]: readFileSync(`${SCRATCH}/continue-recommendation-intent.pre-CB.ts`, "utf8") },
};
let TREE = "work";
const overlayHits = new Set();
const overlayPlugin = {
  name: "cct1-overlay",
  enforce: "pre",
  load(id) {
    const files = OVERLAY[TREE];
    if (!files) return null;
    const f = id.split("?")[0];
    if (files[f] != null) {
      overlayHits.add(`${TREE}:${f.slice(WORK_ROOT.length + 1)}`);
      return files[f];
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
  };
  // 版本判別：work＝CB＋CC；precc＝CB、無 CC；precb＝無 CB
  const cb = typeof M.crg.analyzeContinueRecommendationStructure === "function";
  const cc = typeof M.crg.hasDanglingContinuationFragment === "function";
  const want = { work: [true, true], precc: [true, false], precb: [false, false] }[tree];
  if (cb !== want[0] || cc !== want[1]) throw new Error(`tree ${tree} overlay mismatch (cb=${cb} cc=${cc})`);
  return M;
}

// ── mock geocode（同 cbt2；另加 香港又一城／台南再發號 POI）──
const LOC = (o) => ({ placeId: `mock-${o.formattedName}`, country: o.country ?? "日本", city: o.city ?? "", region: o.region, district: o.district, sublocality: o.sublocality, lat: o.lat ?? 35, lng: o.lng ?? 135, formattedName: o.formattedName, displayLabel: o.formattedName });
const REAL = {
  台中西屯: LOC({ country: "台灣", city: "台中市", region: "台中市", district: "西屯區", formattedName: "台中市西屯區", lat: 24.18, lng: 120.62 }),
  香港跑馬地: LOC({ country: "香港", city: "香港", region: "香港島", district: "灣仔區", sublocality: "跑馬地", formattedName: "跑馬地", lat: 22.27, lng: 114.18 }),
  香港又一村: LOC({ country: "香港", city: "香港", region: "九龍", district: "深水埗區", sublocality: "又一村", formattedName: "又一村", lat: 22.34, lng: 114.17 }),
  香港又一城: LOC({ country: "香港", city: "香港", region: "九龍", district: "深水埗區", formattedName: "又一城", lat: 22.337, lng: 114.174 }),
  台南看西街教會: LOC({ country: "台灣", city: "台南市", region: "台南市", district: "中西區", formattedName: "看西街教會", lat: 22.99, lng: 120.2 }),
  台南再發號: LOC({ country: "台灣", city: "台南市", region: "台南市", district: "中西區", formattedName: "再發號", lat: 22.99, lng: 120.2 }),
  東京玩具美術館: LOC({ country: "日本", city: "東京都", region: "東京都", district: "新宿區", formattedName: "東京玩具美術館", lat: 35.69, lng: 139.72 }),
  里斯本: LOC({ country: "葡萄牙", city: "里斯本", region: "里斯本", formattedName: "里斯本", lat: 38.72, lng: -9.14 }),
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
  const key = q.split(",")[0].replace(/\s+/g, "").trim();
  if (REAL[key]) return { location: REAL[key], error: null, providerResult: { ok: true, status: "OK", query: q } };
  const parent = PARENTS.find((p) => key.startsWith(p)) ?? key;
  return { location: LOC({ country: /台/.test(parent) ? "台灣" : "日本", city: parent, region: parent, formattedName: parent }), error: null, providerResult: { ok: true, status: "OK", query: q } };
};

const LOCALE = "zh-TW";
const S0 = { recommendedPlaces: [], selectedPlaces: [], phase: "recommend", discovery: {}, updatedAt: "2026-01-01T00:00:00.000Z", activeCategoryIntent: "restaurant", conversationMode: "destination_planning" };
const pool = (d) => [1, 2, 3, 4].map((j) => ({ name: `${d}-p${j}`, placeName: `${d}-p${j}`, placeId: `p-${d}-${j}`, googlePlaceId: `p-${d}-${j}`, lat: 24, lng: 120, rating: 4.5, category: "restaurant" }));
const recOf = (M, d, scope) => M.crs.createRecommendationSession({ destination: d, topic: "restaurant", pool: pool(d), batchSize: 3, usedQueries: [], recommendationPage: 0, parentCity: scope?.parentCity, area: scope?.area, searchScope: scope ? "area" : "city", searchRegionLabel: d }).session;
const sess = (M, d, extra = {}, scope) => ({ ...S0, recommendationSession: recOf(M, d, scope), travelContext: { interests: [], destination: d }, recommendedPlaces: pool(d), ...extra });
const tripSess = (M, d, country, lat, lng) => ({ ...sess(M, d), tripDestination: { placeId: `mock-${d}`, city: d, displayLabel: d, country, lat, lng } });
const KYOTO = (M) => sess(M, "京都");

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
  let plan = null;
  try {
    const r0 = M.ctd.resolveCategoryTurnDestination({ ctx: placeCtx, session: merged.session, userText: text, locale: LOCALE });
    r = await M.ctd.validateCategoryTurnDestination(r0, { locale: LOCALE, geocodeFn });
    plan = M.ctd.planCategoryTurnClarification(r);
  } catch (e) {
    err = String(e?.message ?? e);
  }
  const d = r?.destination ?? null;
  return { path: "cat", dest: d, search: !!d, credits: !!d, geo: geoLog.slice(g0), err, plan };
}
const fmtPlan = (p) => (p ? ` clarify=${p.kind}:${p.confirmedParentCity ?? p.clarificationLabel}` : "");
const fmt = (x) => `dest=${x.dest ?? "-"} search=${x.search ? "Y" : "N"} credits=${x.credits ? "begin" : "no"} geo=${x.geo.length}${x.geo.length ? `[${x.geo.join("|")}]` : ""}${fmtPlan(x.plan)}${x.err ? ` ERR=${x.err}` : ""}`;
const LEGIT = /又一村|又一城|再發號|看西街/g;
const CONT_IN_QUERY_RE = /(推薦|幾個|還有|嗎|呢|一批|其他|再|還$|又$|^換|^好[，,]?|^請|\d+\s*[個个間间家]|[一二兩两三四五六七八九十][個个間间家]|咖啡)/;
const cleanQ = (x) => x.geo.every((q) => !CONT_IN_QUERY_RE.test(q.split(",")[0].trim().replace(LEGIT, "")));

const out = [];
const P = (...a) => out.push(a.join(" "));
const rows = [];
function expect(id, cond, detail, tag = "") {
  rows.push({ id, ok: !!cond, detail, tag });
  P(`  ${cond ? "PASS" : "FAIL"} ${id}${tag ? ` [${tag}]` : ""}：${detail}`);
}
const info = (m) => P(`  INFO ${m}`);
const prov = {}; // tree → { geo, search, credits }
const tally = (tree, r) => {
  prov[tree] ??= { geo: 0, search: 0, credits: 0, turns: 0 };
  prov[tree].geo += r.geo.length;
  prov[tree].search += r.search ? 1 : 0;
  prov[tree].credits += r.credits ? 1 : 0;
  prov[tree].turns += 1;
};
async function run(tree, mode, fn, mk, text) {
  const M = await freshModules(tree);
  geoMode = mode;
  const r = await fn(M, mk(M), text);
  tally(tree, r);
  return r;
}
const MODES = ["ok", "timeout", "null", "zero"];
const PATHS = [["more", more], ["cat", category]];

// ════ 0. 樹完整性 ════
P("\n══ 0. 樹完整性 ══");
expect("0-work-eq-postCC-ctd", readFileSync(CTD, "utf8") === readFileSync(`${SCRATCH}/chat-turn-destination.post-CC.ts`, "utf8"), "work ctd = post-CC 備份");
expect("0-work-eq-postCC-cri", readFileSync(CRI, "utf8") === readFileSync(`${SCRATCH}/continue-recommendation-intent.post-CC.ts`, "utf8"), "work cri = post-CC 備份");
{
  const w = readFileSync(CRI, "utf8");
  const p = OVERLAY.precc[CRI];
  const cut = (s) => s.slice(0, s.indexOf("// ─────────────── Structured continuation boundary"));
  const tailOf = (s) => s.slice(s.indexOf("/**\n * Optional category mentioned in a continue phrase"));
  expect("0-cri-frozen-outside-block", cut(w) === cut(p) && tailOf(w) === tailOf(p) && cut(w).length > 0, "cri 結構化區塊外與 pre-CC 逐字相同");
}

// ════ 1. 必要驗證句 × 兩路徑 × 4 Provider 模式 × (work, precc)，已確認京都 ════
P("\n══ 1. 必要驗證句（已確認京都）══");
const REQ = [
  ["再推薦3個", "kyoto"], ["再推薦5間", "kyoto"], ["大阪再推薦3個", "osaka"], ["台中西屯再推薦3個", "xitun"], ["台中西屯再", "dangling"],
  ["大阪還有嗎", "osaka"], ["還有嗎", "kyoto"], ["再推薦幾個", "kyoto"], ["換一批", "kyoto"], ["換里斯本，再推薦幾個", "lisbon"],
  ["換金澤，再推薦幾個", "kanazawa"], ["台中牛牛區再推薦幾個", "niuniu"],
];
function judge(kind, mode, w) {
  const ok = mode === "ok";
  switch (kind) {
    case "kyoto": return w.dest === "京都" && w.geo.length === 0 && w.credits;
    case "osaka": return w.dest === "大阪" && w.geo.length === 0 && w.credits;
    case "kanazawa": return w.dest === "金澤" && w.geo.length === 0 && w.credits;
    case "xitun": return w.dest !== "台中" && w.dest !== "京都" && w.geo.length <= 1 && cleanQ(w) && (ok ? w.dest === "台中西屯" && w.geo.length === 1 && w.geo[0].startsWith("台中西屯") : w.dest === null && !w.credits);
    case "dangling": return w.dest !== "台中" && w.dest !== "京都" && w.geo.length === 0;
    case "lisbon": return w.dest !== "京都" && w.geo.length <= 1 && cleanQ(w) && (w.dest === null ? !w.credits : w.dest === "里斯本");
    case "niuniu": return w.dest !== "台中" && w.dest !== "京都" && !w.credits && w.geo.length <= 1 && cleanQ(w);
    default: return false;
  }
}
const table1 = [];
for (const [t, kind] of REQ) {
  for (const [pname, fn] of PATHS) {
    for (const mode of MODES) {
      const w = await run("work", mode, fn, KYOTO, t);
      const p = await run("precc", mode, fn, KYOTO, t);
      table1.push(`  | ${t} | ${pname} | ${mode} | work: ${fmt(w)} | precc: ${fmt(p)} |`);
      expect(`1-${pname}-${mode}-${t}`, judge(kind, mode, w), `work ${fmt(w)}；precc ${fmt(p)}`);
    }
  }
}
P("\n  必要驗證句表：", ...table1);

// ════ 2. 合法地名保護（已確認京都；單獨／＋再推薦幾個／＋還有嗎／＋再推薦3個；兩路徑）════
P("\n══ 2. 合法地名保護 ══");
const NAMES = [["香港跑馬地", "跑馬地", "香港"], ["香港又一村", "又一村", "香港"], ["台南看西街教會", "看西街教會", "台南"], ["東京玩具美術館", "玩具美術館", "東京"]];
const table2 = [];
for (const [name, core, parent] of NAMES) {
  for (const suffix of ["", "再推薦幾個", "還有嗎", "再推薦3個"]) {
    const t = `${name}${suffix}`;
    for (const [pname, fn] of PATHS) {
      for (const mode of ["ok", "timeout", "zero"]) {
        const w = await run("work", mode, fn, KYOTO, t);
        const p = await run("precc", mode, fn, KYOTO, t);
        table2.push(`  | ${t} | ${pname} | ${mode} | work: ${fmt(w)} | precc: ${fmt(p)} |`);
        const notCut = w.geo.every((q) => q.includes(core));
        expect(`2-${pname}-${mode}-${t}`, w.dest !== "京都" && w.dest !== parent && w.geo.length <= 1 && notCut && cleanQ(w) && (mode === "ok" || !w.credits), `work ${fmt(w)}；precc ${fmt(p)}`);
      }
    }
  }
}
P("\n  合法地名表：", ...table2);

// ════ 3. 補測 ════
P("\n══ 3. 補測 ══");
const table3 = [];
async function both3(id, text, mk, fn, judgeFn, modes = ["ok"]) {
  for (const mode of modes) {
    const w = await run("work", mode, fn, mk, text);
    const p = await run("precc", mode, fn, mk, text);
    table3.push(`  | ${id} | ${text} | ${fn === more ? "more" : "cat"} | ${mode} | work: ${fmt(w)} | precc: ${fmt(p)} |`);
    if (judgeFn) expect(`3-${id}-${fn === more ? "more" : "cat"}-${mode}-${text}`, judgeFn(w, mode), `work ${fmt(w)}；precc ${fmt(p)}`);
    else info(`${id} ${text} [${fn === more ? "more" : "cat"}/${mode}] work ${fmt(w)}；precc ${fmt(p)}`);
  }
}
for (const fn of [more, category]) {
  await both3("cn-qty", "再推薦三個", KYOTO, fn, (w) => w.dest === "京都" && w.geo.length === 0, MODES);
  await both3("cn-qty", "大阪再推薦兩間", KYOTO, fn, (w) => w.dest === "大阪" && w.geo.length === 0, MODES);
  await both3("cn-qty", "台中西屯再推薦兩間", KYOTO, fn, (w, m) => cleanQ(w) && w.geo.length <= 1 && w.dest !== "台中" && w.dest !== "京都" && (m === "ok" ? w.dest === "台中西屯" : w.dest === null), MODES);
  await both3("fullwidth-qty", "再推薦３個", KYOTO, fn, (w) => w.dest === "京都" && w.geo.length === 0);
  await both3("cat-residual", "台中西屯再", KYOTO, fn, (w) => w.dest !== "台中" && w.dest !== "京都" && w.geo.length === 0, MODES);
  await both3("cat-residual", "大阪再推薦3個咖啡廳", KYOTO, fn, (w) => w.dest === "大阪" && w.geo.length === 0 && cleanQ(w));
  await both3("cat-residual", "台中西屯再推薦3個咖啡廳", KYOTO, fn, (w, m) => cleanQ(w) && w.geo.length <= 1 && w.dest !== "台中" && w.dest !== "京都" && (m === "ok" ? w.dest === "台中西屯" : w.dest === null), MODES);
  await both3("dangling", "大阪再", KYOTO, fn, (w) => w.dest !== "京都" && cleanQ(w) && w.geo.length <= 1);
  await both3("dangling", "大阪還", KYOTO, fn, (w) => w.dest !== "京都" && cleanQ(w));
  await both3("dangling", "台中西屯還", KYOTO, fn, (w) => w.dest !== "京都" && w.dest !== "台中" && cleanQ(w));
  // 已確認里斯本（tripDestination resolved）
  const LIS = (M) => tripSess(M, "里斯本", "葡萄牙", 38.72, -9.14);
  await both3("lisbon-confirmed", "里斯本再推薦幾個", LIS, fn, (w) => w.dest === "里斯本" && w.geo.length === 0, MODES);
  await both3("lisbon-confirmed", "里斯本還有嗎", LIS, fn, (w) => w.dest === "里斯本" && w.geo.length === 0, MODES);
  await both3("lisbon-confirmed", "里斯本再推薦3個", LIS, fn, (w) => w.dest === "里斯本" && w.geo.length === 0);
  await both3("lisbon-confirmed", "換金澤，再推薦幾個", LIS, fn, (w) => w.dest === "金澤" && w.geo.length === 0);
  // 續推字出現在合法地名中（以續推字開頭的尾段風險）
  await both3("legit-marker", "台南再發號", KYOTO, fn, (w) => w.dest !== "京都" && w.dest !== "台南" && w.geo.every((q) => q.includes("再發號")));
  await both3("legit-marker", "台南再發號還有嗎", KYOTO, fn, (w) => w.dest !== "京都" && w.dest !== "台南" && w.geo.every((q) => q.includes("再發號")));
  await both3("legit-marker", "香港又一城", KYOTO, fn, (w) => w.dest !== "京都" && w.dest !== "香港" && w.geo.every((q) => q.includes("又一城")));
  await both3("legit-marker", "香港又一城再推薦3個", KYOTO, fn, (w) => w.dest !== "京都" && w.dest !== "香港" && w.geo.every((q) => q.includes("又一城")));
}
// 已確認台中西屯：同一模組先驗證（第一次 1 次 geocode），再測「台中再推薦幾個」不得被當成同一範圍
P("\n  已確認台中西屯 → 台中再推薦幾個／台中西屯再推薦3個；已確認台中 → 台中西屯再推薦幾個");
for (const tree of ["work", "precc"]) {
  const M = await freshModules(tree);
  geoMode = "ok";
  const s = sess(M, "台中西屯", {}, { parentCity: "台中", area: "西屯" });
  const seq = [];
  for (const t of ["再推薦幾個", "台中西屯再推薦3個", "台中西屯還有嗎", "台中再推薦幾個", "台中還有嗎", "再推薦3個"]) {
    const r = await more(M, s, t);
    tally(tree, r);
    seq.push([t, r]);
  }
  const line = seq.map(([t, r]) => `${t}→${fmt(r)}`).join("；");
  info(`${tree} 台中西屯 已確認序列：${line}`);
  if (tree === "work") {
    const g = seq.reduce((a, [, r]) => a + r.geo.length, 0);
    expect("3-xitun-confirmed-same", seq[1][1].dest === "台中西屯" && seq[2][1].dest === "台中西屯" && seq[5][1].dest === "台中西屯" && g <= 1, `同範圍延續（台中西屯）且 geocode 合計=${g}≤1`);
    // 「台中」不是「台中西屯」：不得以同範圍捷徑回傳台中西屯；使用者點名的台中由 Authority 判斷（記錄）
    expect("3-xitun-confirmed-parent-named-not-same-scope", seq[3][1].dest !== "台中西屯" && seq[4][1].dest !== "台中西屯" && seq[3][1].dest !== "京都", `台中再推薦幾個 ${fmt(seq[3][1])}；台中還有嗎 ${fmt(seq[4][1])}`);
  }
  const M2 = await freshModules(tree);
  geoMode = "ok";
  const sTc = sess(M2, "台中");
  const r2 = await more(M2, sTc, "台中西屯再推薦幾個");
  tally(tree, r2);
  const r3 = await more(M2, sTc, "台中再推薦3個");
  tally(tree, r3);
  info(`${tree} 已確認台中 → 台中西屯再推薦幾個 ${fmt(r2)}；台中再推薦3個 ${fmt(r3)}`);
  if (tree === "work") expect("3-taichung-confirmed-district-named", r2.dest === "台中西屯" && r2.geo.length === 1 && r3.dest === "台中" && r3.geo.length === 0, `台中西屯再推薦幾個 ${fmt(r2)}；台中再推薦3個 ${fmt(r3)}`);
}
P("\n  補測表：", ...table3);

// ════ 4. 偽造／舊版快照 ════
P("\n══ 4. 偽造／舊版快照（台中牛牛區）══");
const FORGED = [
  ["legacy", (M) => sess(M, "台中牛牛區")],
  ["forgedRec", (M) => sess(M, "台中牛牛區", {}, { parentCity: "台中", area: "牛牛區" })],
  ["forgedActive", (M) => ({ ...S0, activeRecommendationContext: M.refine.ensureActiveRecommendationContext(S0, { destination: "台中牛牛區", intent: "restaurant", parentCity: "台中", area: "牛牛區", searchScope: "area" }), travelContext: { interests: [], destination: "台中牛牛區" }, recommendedPlaces: pool("台中牛牛區") })],
];
for (const mode of MODES) {
  for (const [label, mk] of FORGED) {
    for (const tree of ["work", "precc"]) {
      const M = await freshModules(tree);
      geoMode = mode;
      const s = mk(M);
      const rs = [];
      for (const t of ["再推薦3個", "再推薦三個", "台中牛牛區再推薦3個", "台中牛牛區再推薦幾個", "台中牛牛區再", "還有嗎"]) rs.push(await more(M, s, t));
      rs.push(await category(M, s, "推薦咖啡廳"));
      rs.push(await category(M, s, "台中牛牛區再"));
      for (const r of rs) tally(tree, r);
      const g = rs.reduce((a, r) => a + r.geo.length, 0);
      const ok = rs.every((r) => r.dest == null && !r.credits && cleanQ(r)) && g <= 1;
      if (tree === "work") expect(`4-${label}-${mode}`, ok, `${rs.map(fmt).join("；")}（geocode 合計=${g}）`);
      else info(`precc 4-${label}-${mode}：${rs.map(fmt).join("；")}（geocode 合計=${g}）`);
    }
  }
}
// 既有信任邊界記錄：偽造 tripDestination（未經驗證的牛牛區）→ 同名捷徑 vs 純續推（兩者都只依 confirmedContextDestination）
for (const tree of ["work", "precc"]) {
  const M = await freshModules(tree);
  geoMode = "ok";
  const s = tripSess(M, "台中牛牛區", "台灣", 24.1, 120.6);
  const a = await more(M, s, "再推薦幾個");
  const b = await more(M, s, "台中牛牛區再推薦幾個");
  info(`${tree} 偽造 tripDestination=台中牛牛區：再推薦幾個 ${fmt(a)}；台中牛牛區再推薦幾個 ${fmt(b)}`);
}

// ════ 5. matchesContinueRecommendationGrammar 對外行為（work vs precc）════
P("\n══ 5. 舊 grammar 對外行為 ══");
{
  const SENT = [
    "還有嗎", "再推薦幾個", "換一批", "還有其他咖啡廳嗎", "好，再推薦幾個", "請再推薦幾個", "再推薦3個", "再推薦5間", "再推薦三個", "大阪再推薦3個", "大阪再推薦兩間", "台中西屯再推薦3個",
    "台中西屯再", "大阪再", "大阪還", "大阪還有嗎", "換里斯本，再推薦幾個", "換金澤，再推薦幾個", "台中牛牛區再推薦幾個", "香港跑馬地", "香港又一村", "台南看西街教會", "東京玩具美術館",
    "香港又一村再推薦3個", "台南再發號", "香港又一城", "幫我再推薦幾個", "麻煩再推薦幾個", "OK，再推薦幾個", "可以再推薦幾個嗎", "再", "又", "換", "還", "推薦咖啡廳", "幫我規劃東京五天行程",
    "大阪再推薦3個咖啡廳", "再推薦３個", "里斯本再推薦幾個", "台中再推薦幾個", "我想找壽喜燒", "不要101跟龍山寺其他都可以",
  ];
  const Mw = await freshModules("work");
  const gw = Object.fromEntries(SENT.map((t) => [t, Mw.crg.matchesContinueRecommendationGrammar(t)]));
  const cw = Object.fromEntries(SENT.map((t) => [t, Mw.crg.continueRecommendationMentionedCategory(t)]));
  const Mp = await freshModules("precc");
  const diffs = SENT.filter((t) => gw[t] !== Mp.crg.matchesContinueRecommendationGrammar(t) || cw[t] !== Mp.crg.continueRecommendationMentionedCategory(t));
  expect("5-grammar-unchanged", diffs.length === 0, diffs.length ? `差異：${diffs.join("、")}` : `${SENT.length} 句 matches／mentionedCategory 與 pre-CC 完全相同`);
  // 結構函式（work）：數字／量詞不得進 candidate
  const A = Mw.crg.analyzeContinueRecommendationStructure;
  const D = Mw.crg.hasDanglingContinuationFragment;
  for (const [t, cont, cand] of [
    ["再推薦3個", true, ""], ["再推薦5間", true, ""], ["再推薦三個", true, ""], ["大阪再推薦3個", true, "大阪"], ["大阪再推薦兩間", true, "大阪"], ["台中西屯再推薦3個", true, "台中西屯"],
    ["再推薦３個", true, ""], ["台中西屯再", false, null], ["大阪再推薦3個咖啡廳", true, "大阪"], ["香港又一村再推薦3個", true, "香港又一村"], ["台南再發號還有嗎", true, "台南再發號"],
  ]) {
    const v = A(t);
    expect(`5-structure-${t}`, v.isContinue === cont && (cand == null || v.candidateText === cand) && !/\d|[個个間间家]$/.test(v.candidateText), `${JSON.stringify(v)} dangling=${D(t)}`);
  }
  for (const t of ["大阪再", "大阪還", "台中西屯還", "香港又一村", "台南再發號", "香港又一城", "東京玩具美術館", "台中西屯咖啡廳更多", "推薦台中西屯咖啡廳，換", "台中西屯美食再看"]) {
    info(`work A("${t}").isContinue=${A(t).isContinue} candidate="${A(t).candidateText}" dangling=${D(t)} grammar=${gw[t] ?? Mw.crg.matchesContinueRecommendationGrammar(t)}`);
  }
}

// ════ 6. 句首詞（不在本次範圍；如實記錄 precb／precc／work）════
P("\n══ 6. 句首詞（未解決項；只記錄）══");
for (const t of ["幫我再推薦幾個", "麻煩再推薦幾個", "OK，再推薦幾個", "可以再推薦幾個嗎", "幫我再推薦3個"]) {
  const res = {};
  for (const tree of ["precb", "precc", "work"]) {
    const M = await freshModules(tree);
    geoMode = "ok";
    res[tree] = await more(M, KYOTO(M), t);
  }
  info(`${t}：precb ${fmt(res.precb)}；precc ${fmt(res.precc)}；work ${fmt(res.work)}`);
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
for (const [tree, v] of Object.entries(prov)) P(`  Provider（§1–§4 合計）${tree}: turns=${v.turns} geocode=${v.geo} placesSearch(鏡像)=${v.search} beginCredits(鏡像)=${v.credits}`);
P(`overlay hits：${[...overlayHits].join(", ")}`);
P(`\nexternal=${external}${external ? ` ${extLog.join(";")}` : ""}`);
P(`verify-continuation-boundary-cct1: PASS=${rows.length - fails.length} FAIL=${fails.length} → ${fails.length || external ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(fails.length || external ? 1 : 0);
