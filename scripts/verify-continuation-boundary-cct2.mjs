#!/usr/bin/env node
/**
 * CC-T2 — 確認句補測（more_places 與類別路徑 × ok／timeout／null／ZERO_RESULTS × work／precc）。
 * 離線、只用 Mock、不寫任何檔案。模組載入方式與 verify-continuation-boundary-cct1.mjs 相同
 * （同一行程內 vite createServer + vite-node runner；load plugin 在記憶體 overlay；無子行程）。
 * 兩棵樹：work（現行＝post-CC）、precc（CC 前：*.pre-CC.ts overlay）。
 * more_places：resolveMorePlacesTurnDestination（pushMorePlaceRecommendations 鏡像；destination 為真 → Places 搜尋＋beginPlaceRecommendationCredits）。
 * 類別路徑：resolveCategoryTurnDestination → validateCategoryTurnDestination（destination 為真 → 搜尋＋扣點）。
 * 每列記錄：目的地、是否搜尋、geocode 次數與查詢字串、是否 begin Credits；並對照 precc。
 * 安全條件（work 判定）：
 *  S1 未確認目的地不得搜尋／扣點（非 ok 模式下需驗證的地名 → dest=null、credits=no）
 *  S2 geocode 查詢不得含續推片段、合法地名不得被切割
 *  S3 已確認 Session（京都）物件不得被改寫
 *  S4 點名其他地點時不得退回京都付費搜尋
 * 外部網路全部攔截（fetch / http / https / net），任何一次即 FAIL。
 * 執行：node scripts/verify-continuation-boundary-cct2.mjs
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
};
let TREE = "work";
const overlayHits = new Set();
const overlayPlugin = {
  name: "cct2-overlay",
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
    crg: await imp("lib/ai/continue-recommendation-intent.ts"),
    tc: await imp("lib/ai/travel-context.ts"),
    mvp: await imp("lib/ai/must-visit-places.ts"),
  };
  const cb = typeof M.crg.analyzeContinueRecommendationStructure === "function";
  const cc = typeof M.crg.hasDanglingContinuationFragment === "function";
  const want = { work: [true, true], precc: [true, false] }[tree];
  if (cb !== want[0] || cc !== want[1]) throw new Error(`tree ${tree} overlay mismatch (cb=${cb} cc=${cc})`);
  return M;
}

// ── mock geocode（與 cct1 相同的 fixture）──
const LOC = (o) => ({ placeId: `mock-${o.formattedName}`, country: o.country ?? "日本", city: o.city ?? "", region: o.region, district: o.district, sublocality: o.sublocality, lat: o.lat ?? 35, lng: o.lng ?? 135, formattedName: o.formattedName, displayLabel: o.formattedName });
const REAL = {
  台中西屯: LOC({ country: "台灣", city: "台中市", region: "台中市", district: "西屯區", formattedName: "台中市西屯區", lat: 24.18, lng: 120.62 }),
  香港又一村: LOC({ country: "香港", city: "香港", region: "九龍", district: "深水埗區", sublocality: "又一村", formattedName: "又一村", lat: 22.34, lng: 114.17 }),
  台南看西街教會: LOC({ country: "台灣", city: "台南市", region: "台南市", district: "中西區", formattedName: "看西街教會", lat: 22.99, lng: 120.2 }),
  東京玩具美術館: LOC({ country: "日本", city: "東京都", region: "東京都", district: "新宿區", formattedName: "東京玩具美術館", lat: 35.69, lng: 139.72 }),
  里斯本: LOC({ country: "葡萄牙", city: "里斯本", region: "里斯本", formattedName: "里斯本", lat: 38.72, lng: -9.14 }),
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
const recOf = (M, d) => M.crs.createRecommendationSession({ destination: d, topic: "restaurant", pool: pool(d), batchSize: 3, usedQueries: [], recommendationPage: 0, searchScope: "city", searchRegionLabel: d }).session;
const KYOTO = (M) => ({ ...S0, recommendationSession: recOf(M, "京都"), travelContext: { interests: [], destination: "京都" }, recommendedPlaces: pool("京都") });

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
  return { dest: d, search: !!d, credits: !!d, geo: geoLog.slice(g0), err };
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
  return { dest: d, search: !!d, credits: !!d, geo: geoLog.slice(g0), err };
}
const fmt = (x) => `dest=${x.dest ?? "-"} search=${x.search ? "Y" : "N"} credits=${x.credits ? "begin" : "no"} geo=${x.geo.length}${x.geo.length ? `[${x.geo.join("|")}]` : ""}${x.err ? ` ERR=${x.err}` : ""}`;
const LEGIT = /又一村|看西街|玩具美術館/g;
const CONT_IN_QUERY_RE = /(推薦|幾個|還有|嗎|呢|一批|其他|再|還$|又$|^換|^好[，,]?|^請|\d+\s*[個个間间家]|[一二兩两三四五六七八九十][個个間间家])/;
const cleanQ = (x) => x.geo.every((q) => !CONT_IN_QUERY_RE.test(q.split(",")[0].trim().replace(LEGIT, "")));

// kind：pure＝純續推（沿用京都）；known＝本地可解析城市（大阪）；validate＝需 Provider 驗證（ok→該地；其餘→不搜尋）；
//       lisbon＝里斯本（已登記未解決：目的地確認；只驗安全，不驗是否到達）
const SENT = [
  ["再推薦3個", "pure"],
  ["再推薦三個", "pure"],
  ["大阪再推薦3個", "known", "大阪"],
  ["台中西屯再推薦3個", "validate", "台中西屯", "台中西屯", "台中"],
  ["還有嗎", "pure"],
  ["換一批", "pure"],
  ["換里斯本，再推薦幾個", "lisbon", null, "里斯本"],
  ["香港又一村", "validate", null, "又一村", "香港"],
  ["台南看西街教會", "validate", null, "看西街教會", "台南"],
  ["東京玩具美術館", "validate", null, "玩具美術館", "東京"],
];
const MODES = ["ok", "timeout", "null", "zero"];
const PATHS = [["more", more], ["cat", category]];

const out = [];
const P = (...a) => out.push(a.join(" "));
const rows = [];
function expect(id, cond, detail) {
  rows.push({ id, ok: !!cond });
  P(`  ${cond ? "PASS" : "FAIL"} ${id}：${detail}`);
}
const prov = {};
const tally = (tree, path, r) => {
  const k = `${tree}/${path}`;
  prov[k] ??= { geo: 0, search: 0, credits: 0, turns: 0 };
  prov[k].geo += r.geo.length;
  prov[k].search += r.search ? 1 : 0;
  prov[k].credits += r.credits ? 1 : 0;
  prov[k].turns += 1;
};
function judge(kind, mode, w, wantDest, core, parent) {
  const notKyoto = w.dest !== "京都";
  switch (kind) {
    case "pure":
      return { ok: w.dest === "京都" && w.geo.length === 0 && w.credits, why: "沿用京都、geocode=0" };
    case "known":
      return { ok: w.dest === wantDest && w.geo.length === 0 && w.credits, why: `${wantDest}、geocode=0` };
    case "validate": {
      const notCut = w.geo.every((q) => q.includes(core));
      const base = notKyoto && w.dest !== parent && w.geo.length <= 1 && notCut && cleanQ(w);
      if (mode === "ok") {
        // 與 cct1 §1 xitun／§2 合法地名相同標準：行政區 ok 必須到達；POI 只驗安全（到達與否記錄於表）
        const reached = wantDest ? w.dest === wantDest && w.geo.length === 1 : true;
        return { ok: base && reached, why: `S2/S4；ok →${wantDest ? ` 到達${wantDest}、geocode=1、` : " "}查詢含「${core}」` };
      }
      return { ok: base && w.dest === null && !w.search && !w.credits, why: `S1/S2/S4；${mode} → 不搜尋、不扣點、不退回京都／${parent}` };
    }
    case "lisbon":
      return { ok: notKyoto && w.geo.length <= 1 && cleanQ(w) && (w.dest === null ? !w.search && !w.credits : w.dest === "里斯本"), why: "S1/S2/S4（是否到達里斯本：已登記未解決，只記錄）" };
    default:
      return { ok: false, why: "unknown kind" };
  }
}

P("══ 0. 樹完整性 ══");
expect("0-work-eq-postCC-ctd", readFileSync(CTD, "utf8") === readFileSync(`${SCRATCH}/chat-turn-destination.post-CC.ts`, "utf8"), "work ctd = post-CC 備份");
expect("0-work-eq-postCC-cri", readFileSync(CRI, "utf8") === readFileSync(`${SCRATCH}/continue-recommendation-intent.post-CC.ts`, "utf8"), "work cri = post-CC 備份");

P("\n══ 1. 確認句（已確認京都）× 路徑 × Provider 模式 ══");
const table = [];
const diffs = [];
for (const [text, kind, wantDest, core, parent] of SENT) {
  for (const [pname, fn] of PATHS) {
    for (const mode of MODES) {
      const res = {};
      for (const tree of ["work", "precc"]) {
        const M = await freshModules(tree);
        geoMode = mode;
        const s = KYOTO(M);
        const before = JSON.stringify(s);
        const r = await fn(M, s, text);
        r.sessionIntact = JSON.stringify(s) === before;
        tally(tree, pname, r);
        res[tree] = r;
      }
      const w = res.work;
      const p = res.precc;
      table.push(`  | ${text} | ${pname} | ${mode} | work: ${fmt(w)} | precc: ${fmt(p)} |`);
      const j = judge(kind, mode, w, wantDest, core, parent);
      expect(`1-${pname}-${mode}-${text}`, j.ok && w.sessionIntact && !w.err, `${j.why}；work ${fmt(w)}${w.sessionIntact ? "" : " SESSION-MUTATED"}；precc ${fmt(p)}`);
      if (fmt(w) !== fmt(p)) diffs.push(`  ${text} [${pname}/${mode}] work ${fmt(w)} ≠ precc ${fmt(p)}`);
    }
  }
}
P("\n  確認句表：", ...table);
P(`\n══ 2. work 相對 precc（CC 前）差異列=${diffs.length} ══`, ...(diffs.length ? diffs : ["  (none)"]));

for (const k of Object.keys(orig)) console[k] = orig[k];
await server.close();
const fails = rows.filter((r) => !r.ok);
P("\n══ 摘要 ══");
for (const [k, v] of Object.entries(prov)) P(`  Provider ${k}: turns=${v.turns} geocode=${v.geo} placesSearch(鏡像)=${v.search} beginCredits(鏡像)=${v.credits}`);
P(`overlay hits：${[...overlayHits].join(", ")}`);
P(`\nexternal=${external}${external ? ` ${extLog.join(";")}` : ""}`);
P(`verify-continuation-boundary-cct2: PASS=${rows.length - fails.length} FAIL=${fails.length} → ${fails.length || external ? "FAIL" : "PASS"}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(fails.length || external ? 1 : 0);
