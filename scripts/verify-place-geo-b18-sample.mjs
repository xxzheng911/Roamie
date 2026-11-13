#!/usr/bin/env node
/**
 * B18（tester 獨立抽樣，第 7 輪）— 同名不同國家地點：最終規則 A–F 的實跑驗證。點位與既有腳本不重複。
 *
 *  M  必須實跑：自身地址「100 Market St, Sydney」（無國名）× context（Sydney／Australia、雪梨／澳洲、
 *     只有 contextCity、只有 contextCountry、ISO）× 候選（只有烏蘭巴托、烏蘭巴托＋雪梨各一）
 *     × Details（Mongolia 地址／只有座標／地址無國名）。另以 HEAD 快照實跑 same-name a3／b4 對照。
 *  F  擋錯：真實 Google formattedAddress 格式的正確地點 40+ 點（zh-TW／en／ja／ko 各 10+），
 *     各 handoff 組合 × 候選組 × Details 語系，最終必須顯示正確地點；國名辨識不得判成他國。
 *  L  漏擋：遠距同名 10 組 × handoff 組合 × 他國候選變體 × Details 變體，依規則 E 必須擋者全部擋下；
 *     無固定資料者與 HEAD 相同。
 *  R  工程師自述風險 1–3 與規則 A 邊界探針（Greece, NY 類美國地名、Basel 機場等）。
 *  C  呼叫次數：每次 resolve 的 searchPlaces 次數 ≤ HEAD；外部網路 = 0。
 *
 * 執行：npx vite-node scripts/verify-place-geo-b18-sample.mjs --config scripts/vite.verify.config.mjs
 */
import fs from "node:fs";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HEAD_SNAPSHOT =
  "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad/snap-HEAD";
const HARD_TIMEOUT_MS = 150_000;
const watchdog = setTimeout(() => {
  process.stdout.write(`\n[b18-sample] 超過 ${HARD_TIMEOUT_MS}ms，強制結束\n`);
  process.exit(2);
}, HARD_TIMEOUT_MS);
watchdog.unref?.();

let externalCalls = 0;
const trap = (kind, detail) => {
  externalCalls += 1;
  throw new Error(`[b18-sample] external ${kind} blocked ${String(detail).slice(0, 80)}`);
};
globalThis.fetch = async (u) => trap("fetch", u?.url ?? u);
globalThis.XMLHttpRequest = class {
  open(_m, u) {
    trap("xhr", u);
  }
  send() {}
  setRequestHeader() {}
};
{
  const { createRequire } = await import("node:module");
  const require = createRequire(`${WORK_ROOT}/package.json`);
  for (const m of ["http", "https"]) {
    const mod = require(m);
    mod.request = (a) => trap(m, a?.href ?? a?.hostname ?? a);
    mod.get = (a) => trap(m, a?.href ?? a?.hostname ?? a);
  }
  const net = require("net");
  net.connect = net.createConnection = (a) => trap("net", a?.host ?? a);
  require("tls").connect = (a) => trap("tls", a?.host ?? a);
}

let searchLog = [];
let candidateProvider = () => [];
globalThis.__b18SearchPlaces = async (query, opts) => {
  searchLog.push({ query, center: opts?.center });
  return { suggestions: candidateProvider(query, opts) ?? [], error: null };
};

const results = [];
const record = (sec, id, title, status, detail = "") => results.push({ sec, id, title, status, detail });

const { createServer } = await import("vite");
const { ViteNodeServer } = await import("vite-node/server");
const { ViteNodeRunner } = await import("vite-node/client");
const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
const MOCK_ID = "\0b18-places-service";
const REAL_PLACES_SERVICE = `${WORK_ROOT}/src/services/placesService.ts?b18-real`;
const server = await createServer({
  root: WORK_ROOT,
  configFile: false,
  envDir: false,
  logLevel: "silent",
  clearScreen: false,
  plugins: [
    {
      name: "b18-mock-places-service",
      enforce: "pre",
      resolveId(id, importer) {
        if (id.includes("b18-real")) return null;
        if (/(^|\/)services\/placesService(\.ts)?$/.test(id)) return MOCK_ID;
        if (id.startsWith("@/") && importer?.startsWith(HEAD_SNAPSHOT)) {
          const base = `${HEAD_SNAPSHOT}/src/${id.slice(2)}`;
          for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
            if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
          }
        }
        return null;
      },
      load(id) {
        if (id !== MOCK_ID) return null;
        return [
          `export * from ${JSON.stringify(REAL_PLACES_SERVICE)};`,
          `export const searchPlaces = (...args) => globalThis.__b18SearchPlaces(...args);`,
        ].join("\n");
      },
    },
    tsconfigPaths(),
  ],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false, fs: { strict: false } },
  optimizeDeps: { noDiscovery: true, include: [] },
});

const POI = ["tourist_attraction", "point_of_interest", "establishment"];
const origConsole = { info: console.info, log: console.log, warn: console.warn, debug: console.debug };
const quiet = () => {
  console.info = console.log = console.warn = console.debug = () => {};
};
const loud = () => Object.assign(console, origConsole);
const setStr = (s) => JSON.stringify([...s].sort());

let exitCode = 0;
try {
  await server.environments.client.pluginContainer.buildStart({});
  const vn = new ViteNodeServer(server);
  const runner = new ViteNodeRunner({
    root: WORK_ROOT,
    base: "/",
    fetchModule: (id) => vn.fetchModule(id),
    resolveId: (id, importer) => vn.resolveId(id, importer),
  });
  await runner.executeId("/@vite/env");
  const load = (p) => runner.executeFile(`${WORK_ROOT}/${p}`);
  const g = await load("src/lib/place-geo-guard.ts");
  const work = await load("src/lib/place-detail-resolve.ts");
  const tripHandoff = await load("src/lib/trip/trip-itinerary-place-handoff.ts");
  const savedUtils = await load("src/lib/saved-place-utils.ts");
  const searchCtx = await load("src/lib/ai/chat-place-search-context.ts");
  const destEntity = await load("src/lib/ai/destination-entity.ts");

  let headResolve = null;
  {
    const headFile = `${HEAD_SNAPSHOT}/src/lib/place-detail-resolve.ts`;
    try {
      const src = fs.readFileSync(headFile, "utf8");
      if (src.includes("place-geo-guard")) throw new Error("snapshot 不是 HEAD（含 place-geo-guard）");
      headResolve = (await runner.executeFile(headFile)).resolveGooglePlaceIdForDetail;
    } catch (e) {
      record("C", "HEAD-load", "載入 HEAD 版 place-detail-resolve", "FAIL", String(e?.message ?? e).slice(0, 160));
    }
  }
  record("C", "HEAD-load", "HEAD 版 resolve 可載入（供對照）", headResolve ? "PASS" : "FAIL", headResolve ? "snap-HEAD/src/lib/place-detail-resolve.ts" : "未載入");

  const countStats = { runs: 0, over: [] };
  const runResolve = async (fn, handoff, candidates) => {
    searchLog = [];
    candidateProvider = () => candidates;
    quiet();
    try {
      const got = (await fn(handoff, "zh-TW")) ?? null;
      return { got, searches: searchLog.length, centers: searchLog.map((s) => s.center ?? null) };
    } finally {
      loud();
    }
  };

  /** 模擬 _app.place.tsx：resolve → Details（googleFormattedAddress）→ 地理防護。同時跑 HEAD 對照。 */
  const displayed = async (handoff, candidates, detailsById, tag = "") => {
    const h = { placeId: `saved-${handoff.name}`, ...handoff };
    const r = await runResolve(work.resolveGooglePlaceIdForDetail, h, candidates);
    let head = null;
    if (headResolve) {
      head = await runResolve(headResolve, { ...h }, candidates);
      countStats.runs += 1;
      if (r.searches > head.searches) countStats.over.push(`${tag} 工作樹 ${r.searches} > HEAD ${head.searches}`);
    }
    const headShown = head ? head.got ?? "base" : null;
    if (!r.got) return { shown: "base", headShown, ...r };
    const needs = g.hasHardPlaceGeoContext(g.buildPlaceGeoContext(handoff));
    const det = detailsById[r.got];
    if (needs && det && !g.isResolvedPlaceGeoConsistent(handoff, det)) return { shown: "rejected", headShown, ...r };
    return { shown: r.got, headShown, ...r };
  };

  const itin = (name, destination, ext) =>
    tripHandoff.itineraryItemToPlaceHandoff(
      {
        id: `it-${name}`,
        title: name,
        placeName: name,
        lat: null,
        lng: null,
        address: null,
        time: "10:00",
        ...(ext ? { destinationScope: "nearby_extension", extensionDestination: ext } : {}),
      },
      "zh-TW",
      destination,
    );
  const saved = (name, city) =>
    savedUtils.savedPlaceToHandoff({
      id: `saved-row-${name}`,
      name,
      category: "tourist_attraction",
      address: null,
      city,
      lat: null,
      lng: null,
      notes: null,
      mood_tag: null,
      cover_image: null,
      image_url: null,
      image_source: null,
      metadata: {},
      created_at: "2026-11-01T00:00:00.000Z",
    });

  // ════════ M. 必須實跑：100 Market St, Sydney ════════
  {
    const NAME = "Sydney Tower Eye";
    const UB = { placeId: "ChIJ_B18_UB_STE", label: NAME, secondary: "Chinggis Avenue, Ulaanbaatar, Mongolia", types: POI };
    const UB_UNK = { ...UB, placeId: "ChIJ_B18_UB_STE_U", secondary: "Chinggis Avenue" };
    const SYD = { placeId: "ChIJ_B18_SYD_STE", label: NAME, secondary: "Market Street, Sydney NSW, Australia", types: POI };
    const SYD_PART = { ...SYD, placeId: "ChIJ_B18_SYD_STE_P", label: "Sydney Tower" };
    const UB_C = { lat: 47.9184, lng: 106.9177 };
    const SYD_DET = { lat: -33.8705, lng: 151.2089, address: "100 Market St, Sydney NSW 2000, Australia" };
    const ubDetails = {
      "Mongolia 地址": { ...UB_C, address: "Chinggis Avenue, Ulaanbaatar 14200, Mongolia" },
      "只有座標": { ...UB_C, address: null },
      "地址無國名": { ...UB_C, address: "Chinggis Avenue, Ulaanbaatar" },
      "Монгол 地址": { ...UB_C, address: "Чингисийн өргөн чөлөө, Улаанбаатар, Монгол" },
    };
    const ADDR = "100 Market St, Sydney";
    const ctxs = [
      ["Sydney／Australia", { contextCity: "Sydney", contextCountry: "Australia" }],
      ["雪梨／澳洲", { contextCity: "雪梨", contextCountry: "澳洲" }],
      ["只有 contextCity=Sydney", { contextCity: "Sydney" }],
      ["只有 contextCity=雪梨", { contextCity: "雪梨" }],
      ["只有 contextCountry=Australia", { contextCountry: "Australia" }],
      ["只有 contextCountry=澳洲", { contextCountry: "澳洲" }],
      ["只有 contextCountry=AU", { contextCountry: "AU" }],
    ];
    for (const [cname, ctx] of ctxs) {
      const h = { name: NAME, address: ADDR, lat: null, lng: null, ...ctx };
      const gc = g.buildPlaceGeoContext(h);
      const problems = [];
      const notes = [];
      if (!g.hasHardPlaceGeoContext(gc)) problems.push("無硬訊號（Details 防線不會啟動）");
      // 1. 只有烏蘭巴托：resolve 結果 + Details 變體
      for (const [dname, d] of Object.entries(ubDetails)) {
        const r = await displayed(h, [UB], { [UB.placeId]: d }, `M/${cname}/UB-only/${dname}`);
        notes.push(`只有UB+${dname}: resolve=${r.got === UB.placeId ? "UB" : r.got ?? "null"} 顯示=${r.shown === UB.placeId ? "UB" : r.shown}`);
        if (r.got !== UB.placeId) problems.push(`只有UB：resolve 應選 UB 交給 Details（實得 ${r.got}）`);
        if (r.shown === UB.placeId) problems.push(`只有UB+${dname}：顯示烏蘭巴托（應拒絕）`);
      }
      // 2. 烏蘭巴托＋雪梨各一（兩種順序、雪梨完全同名／部分同名）
      for (const [sname, cands, want] of [
        ["UB,SYD", [UB, SYD], SYD.placeId],
        ["SYD,UB", [SYD, UB], SYD.placeId],
        ["UB,SYD部分同名", [UB, SYD_PART], SYD_PART.placeId],
      ]) {
        const det = { [UB.placeId]: ubDetails["Mongolia 地址"], [SYD.placeId]: SYD_DET, [SYD_PART.placeId]: SYD_DET };
        const r = await displayed(h, cands, det, `M/${cname}/${sname}`);
        notes.push(`${sname}: 顯示=${r.shown === want ? "雪梨" : r.shown}`);
        if (r.got !== want) problems.push(`${sname}：應選中雪梨（實得 ${r.got}）`);
      }
      // 3. 烏蘭巴托候選看不出國家＋雪梨部分同名：規格不扣分 → 可能選 UB_UNK，但 Details 必須拒絕
      {
        const det = { [UB_UNK.placeId]: ubDetails["Mongolia 地址"], [SYD_PART.placeId]: SYD_DET };
        const r = await displayed(h, [UB_UNK, SYD_PART], det, `M/${cname}/UBunk`);
        notes.push(`UB無國名+SYD部分: resolve=${r.got === UB_UNK.placeId ? "UB" : r.got === SYD_PART.placeId ? "雪梨" : r.got} 顯示=${r.shown === SYD_PART.placeId ? "雪梨" : r.shown}`);
        if (r.shown === UB_UNK.placeId) problems.push("UB 看不出國家：最終顯示烏蘭巴托");
      }
      // 4. center
      const r0 = await runResolve(work.resolveGooglePlaceIdForDetail, { placeId: "saved-x", ...h }, [SYD]);
      const c = r0.centers[0];
      notes.push(`center=${c ? `${c.lat},${c.lng}` : "無"}`);
      record("M", `M-${cname}`, `「${ADDR}」＋${cname}：UB 擋下、有雪梨候選時選雪梨`, problems.length ? "FAIL" : "PASS", `${notes.join("｜")}${problems.length ? ` 問題：${problems.join("；")}` : ""}`);
    }
    // 無 context：與 HEAD 相同
    {
      const h = { name: NAME, address: ADDR, lat: null, lng: null };
      const diffs = [];
      const notes = [];
      for (const [sname, cands] of [["只有UB", [UB]], ["UB,SYD", [UB, SYD]], ["UB,SYD部分同名", [UB, SYD_PART]]]) {
        const r = await displayed(h, cands, { [UB.placeId]: ubDetails["Mongolia 地址"], [SYD.placeId]: SYD_DET, [SYD_PART.placeId]: SYD_DET }, `M/noctx/${sname}`);
        notes.push(`${sname}: 工作樹=${r.shown} HEAD=${r.headShown}`);
        if (r.shown !== r.headShown) diffs.push(sname);
      }
      record("M", "M-無context", `「${ADDR}」無 context、無座標 → 與 HEAD 相同`, diffs.length ? "FAIL" : "PASS", notes.join("｜"));
    }
    // same-name a3／b4 以 HEAD 快照實跑
    {
      const UBX = { placeId: "ChIJ_UB_SYDNEY_TOWER_MONGOLIA", label: "Sydney Tower", secondary: "Chinggis Avenue, Ulaanbaatar, Mongolia", types: ["premise", "point_of_interest", "establishment"] };
      const SYDX = { placeId: "ChIJ_SYD_SYDNEY_TOWER_EYE_AU", label: "Sydney Tower Eye", secondary: "Market Street, Sydney NSW, Australia", types: POI };
      const US1 = { placeId: "ChIJ_LAX_TAIPEI_101_RESTAURANT_US", label: "台北101", secondary: "Rowland Heights, CA, USA", types: ["restaurant", "point_of_interest"] };
      const TP1 = { placeId: "ChIJ_TPE_TAIPEI_101_TW", label: "台北101", secondary: "臺灣臺北市信義區信義路五段7號", types: POI };
      const a3 = await displayed({ name: "Sydney Tower", address: "Sydney", lat: null, lng: null }, [UBX, SYDX], {}, "a3");
      const b4 = await displayed({ name: "台北101", address: "台北市信義區", lat: null, lng: null }, [US1, TP1], {}, "b4");
      const ok = a3.got === a3.headShown && b4.got === b4.headShown && a3.got === UBX.placeId && b4.got === US1.placeId;
      record("M", "a3b4-HEAD", "same-name a3／b4 改寫後的期望值與 HEAD 快照實跑一致", ok ? "PASS" : "FAIL", `a3 工作樹=${a3.got} HEAD=${a3.headShown}｜b4 工作樹=${b4.got} HEAD=${b4.headShown}`);
    }
  }

  // ════════ F. 擋錯：真實 Google formattedAddress 格式 ════════
  const COUNTRY_EN = { JP: "Japan", KR: "South Korea", CN: "China", HK: "Hong Kong", MO: "Macau", TW: "Taiwan", US: "United States", GB: "United Kingdom", AE: "United Arab Emirates", AU: "Australia", SG: "Singapore", CA: "Canada", IN: "India" };
  // { id, loc, name, lat, lng, cc, own（handoff 地址，該語系、含國名）, local（無國名）, det（Details 該語系）, detEn, ctry（該語系國名）, city（contextCity，可為 null）, kind }
  const F = [
    // ── zh-TW ──
    { id: "Z01", loc: "zh-TW", name: "三十三間堂", lat: 34.9879, lng: 135.7718, cc: "JP", own: "日本〒605-0941 京都府京都市東山區三十三間堂廻り657", local: "京都府京都市東山區三十三間堂廻り657", det: "日本〒605-0941 京都府京都市東山區三十三間堂廻り６５７", detEn: "657 Sanjusangendomawari, Higashiyama Ward, Kyoto, 605-0941, Japan", ctry: "日本", city: "京都", kind: "日本〒＋都道府縣" },
    { id: "Z02", loc: "zh-TW", name: "北村韓屋村", lat: 37.5826, lng: 126.9831, cc: "KR", own: "韓國首爾特別市鐘路區桂洞路37", local: "首爾特別市鐘路區桂洞路37", det: "韓國首爾特別市鐘路區桂洞路37", detEn: "37 Gyedong-gil, Jongno District, Seoul, South Korea", ctry: "韓國", city: "首爾", kind: "韓國特別市" },
    { id: "Z03", loc: "zh-TW", name: "錦里古街", lat: 30.6447, lng: 104.0483, cc: "CN", own: "中國四川省成都市武侯區武侯祠大街231號", local: "四川省成都市武侯區武侯祠大街231號", det: "中國四川省成都市武侯區武侯祠大街231號附1號", detEn: "231 Wuhouci St, Wuhou District, Chengdu, Sichuan, China, 610041", ctry: "中國", city: "成都", kind: "中國省" },
    { id: "Z04", loc: "zh-TW", name: "象鼻山", lat: 25.2667, lng: 110.2967, cc: "CN", own: "中國廣西壯族自治區桂林市象山區濱江路", local: "廣西壯族自治區桂林市象山區濱江路", det: "中國廣西壯族自治區桂林市象山區濱江路", detEn: "Binjiang Rd, Xiangshan District, Guilin, Guangxi, China", ctry: "中國", city: "桂林", kind: "中國自治區" },
    { id: "Z05", loc: "zh-TW", name: "天星小輪尖沙咀碼頭", lat: 22.2938, lng: 114.1686, cc: "HK", own: "香港尖沙咀天星碼頭", local: "尖沙咀天星碼頭", det: "中國香港尖沙咀天星碼頭", detEn: "Star Ferry Pier, Tsim Sha Tsui, Hong Kong", ctry: "香港", city: "香港", kind: "香港（中國香港前綴）" },
    { id: "Z06", loc: "zh-TW", name: "媽閣廟", lat: 22.1863, lng: 113.5311, cc: "MO", own: "澳門媽閣廟前地", local: "媽閣廟前地", det: "中國澳門媽閣廟前地", detEn: "Largo do Pagode da Barra, Macao", ctry: "澳門", city: "澳門", kind: "澳門（中國澳門前綴）" },
    { id: "Z07", loc: "zh-TW", name: "華山1914文化創意產業園區", lat: 25.0441, lng: 121.5294, cc: "TW", own: "100台灣台北市中正區八德路一段1號", local: "100台北市中正區八德路一段1號", det: "100臺灣臺北市中正區八德路一段1號", detEn: "No. 1, Section 1, Bade Rd, Zhongzheng District, Taipei City, Taiwan 100", ctry: "台灣", city: "台北", kind: "台灣郵遞區號＋臺" },
    { id: "Z08", loc: "zh-TW", name: "黃金市集", lat: 25.2697, lng: 55.2967, cc: "AE", own: "Deira - Al Ras - 杜拜 - 阿拉伯聯合大公國", local: "Deira - Al Ras - 杜拜", det: "Deira - Al Ras - 杜拜 - 阿拉伯聯合大公國", detEn: "Deira - Al Ras - Dubai - United Arab Emirates", ctry: "阿聯酋", city: "杜拜", kind: "杜拜「 - 」分段" },
    { id: "Z09", loc: "zh-TW", name: "大都會藝術博物館", lat: 40.7794, lng: -73.9632, cc: "US", own: "美國紐約州紐約第五大道1000號", local: "1000 5th Ave, New York, NY 10028", det: "1000 5th Ave, New York, NY 10028美國", detEn: "1000 5th Ave, New York, NY 10028, USA", ctry: "美國", city: "紐約", kind: "美國州碼（國名緊接郵遞區號）" },
    { id: "Z10", loc: "zh-TW", name: "大英博物館", lat: 51.5194, lng: -0.127, cc: "GB", own: "英國倫敦大羅素街", local: "Great Russell St, London WC1B 3DG", det: "Great Russell St, London WC1B 3DG英國", detEn: "Great Russell St, London WC1B 3DG, UK", ctry: "英國", city: "倫敦", kind: "英國郵遞區號" },
    { id: "Z11", loc: "zh-TW", name: "中華民國總統府", lat: 25.0401, lng: 121.512, cc: "TW", own: "中華民國臺北市中正區重慶南路一段122號", local: "臺北市中正區重慶南路一段122號", det: "100臺灣臺北市中正區重慶南路一段122號", detEn: "No. 122, Section 1, Chongqing S Rd, Zhongzheng District, Taipei City, Taiwan 100", ctry: "臺灣", city: "臺北", kind: "台灣（中華民國／臺）" },
    // ── en ──
    { id: "E01", loc: "en", name: "Japanese Tea Garden", lat: 37.7702, lng: -122.4703, cc: "US", own: "75 Hagiwara Tea Garden Dr, San Francisco, CA 94118, USA", local: "75 Hagiwara Tea Garden Dr, San Francisco, CA 94118", det: "75 Hagiwara Tea Garden Dr, San Francisco, CA 94118, USA", detEn: "75 Hagiwara Tea Garden Dr, San Francisco, CA 94118, United States", ctry: "USA", city: "San Francisco", kind: "美國州碼" },
    { id: "E02", loc: "en", name: "Canada Place", lat: 49.2888, lng: -123.1111, cc: "CA", own: "999 Canada Pl, Vancouver, BC V6C 3T4, Canada", local: "999 Canada Pl, Vancouver, BC V6C 3T4", det: "999 Canada Pl, Vancouver, BC V6C 3T4, Canada", detEn: "Canada Place, 999 Canada Pl, Vancouver, BC V6C 3T4, Canada", ctry: "Canada", city: "Vancouver", kind: "國名不在邊緣段（Canada Pl）" },
    { id: "E03", loc: "en", name: "India Gate", lat: 28.6129, lng: 77.2295, cc: "IN", own: "Kartavya Path, India Gate, New Delhi, Delhi 110001, India", local: "Kartavya Path, India Gate, New Delhi, Delhi 110001", det: "Kartavya Path, India Gate, New Delhi, Delhi 110001, India", detEn: "Kartavya Path, India Gate, New Delhi, Delhi 110001, India", ctry: "India", city: null, kind: "國名不在邊緣段（India Gate）" },
    { id: "E04", loc: "en", name: "Chinese Garden of Friendship", lat: -33.8763, lng: 151.2026, cc: "AU", own: "Pier St, Sydney NSW 2000, Australia", local: "Pier St, Sydney NSW 2000", det: "Pier St, Sydney NSW 2000, Australia", detEn: "Pier St, Haymarket NSW 2000, Australia", ctry: "Australia", city: "Sydney", kind: "澳洲 NSW 州碼" },
    { id: "E05", loc: "en", name: "Sky Garden", lat: 51.5113, lng: -0.0836, cc: "GB", own: "1 Sky Garden Walk, London EC3M 8AF, UK", local: "1 Sky Garden Walk, London EC3M 8AF", det: "1 Sky Garden Walk, London EC3M 8AF, UK", detEn: "1 Sky Garden Walk, London EC3M 8AF, United Kingdom", ctry: "United Kingdom", city: "London", kind: "英國郵遞區號" },
    { id: "E06", loc: "en", name: "Dean Village", lat: 55.9526, lng: -3.2167, cc: "GB", own: "Dean Path, Edinburgh EH4 3BL, UK", local: "Dean Path, Edinburgh EH4 3BL", det: "Dean Path, Edinburgh EH4 3BL, UK", detEn: "Dean Path, Edinburgh EH4 3BL, United Kingdom", ctry: "UK", city: "Edinburgh", kind: "英國郵遞區號（蘇格蘭）" },
    { id: "E07", loc: "en", name: "Turkey Run State Park", lat: 39.8836, lng: -87.2003, cc: "US", own: "8121 Park Rd, Marshall, IN 47859, USA", local: "8121 Park Rd, Marshall, IN 47859", det: "8121 Park Rd, Marshall, IN 47859, USA", detEn: "8121 Park Rd, Marshall, IN 47859, United States", ctry: "United States", city: null, kind: "美國州碼 IN＋名稱含 Turkey" },
    { id: "E08", loc: "en", name: "Burj Al Arab", lat: 25.1412, lng: 55.1853, cc: "AE", own: "Jumeirah St - Umm Suqeim 3 - Dubai - United Arab Emirates", local: "Jumeirah St - Umm Suqeim 3 - Dubai", det: "Jumeirah St - Umm Suqeim 3 - Dubai - United Arab Emirates", detEn: "Jumeirah St - Umm Suqeim 3 - Dubai - United Arab Emirates", ctry: "UAE", city: "Dubai", kind: "杜拜「 - 」分段" },
    { id: "E09", loc: "en", name: "Tian Tan Buddha", lat: 22.254, lng: 113.905, cc: "HK", own: "Ngong Ping Rd, Lantau Island, Hong Kong", local: "Ngong Ping Rd, Lantau Island", det: "Ngong Ping Rd, Lantau Island, Hong Kong", detEn: "Ngong Ping, Lantau Island, Hong Kong, China", ctry: "Hong Kong", city: "Hong Kong", kind: "香港（Hong Kong, China）" },
    { id: "E10", loc: "en", name: "Senado Square", lat: 22.1936, lng: 113.5398, cc: "MO", own: "Largo do Senado, Macau", local: "Largo do Senado", det: "Largo do Senado, Macao", detEn: "Largo do Senado, Macau, China", ctry: "Macao", city: "Macau", kind: "澳門（Macau／Macao／Macau, China）" },
    { id: "E11", loc: "en", name: "Tamsui Old Street", lat: 25.1696, lng: 121.4407, cc: "TW", own: "Zhongzheng Rd, Tamsui District, New Taipei City, Taiwan 251", local: "Zhongzheng Rd, Tamsui District, New Taipei City", det: "Zhongzheng Rd, Tamsui District, New Taipei City, Taiwan 251", detEn: "Zhongzheng Rd, Tamsui District, New Taipei City, Taiwan 251", ctry: "Taiwan", city: "New Taipei", kind: "台灣（Taiwan 251）" },
    // ── ja ──
    { id: "J01", loc: "ja", name: "銀閣寺", lat: 35.027, lng: 135.7982, cc: "JP", own: "日本、〒606-8402 京都府京都市左京区銀閣寺町２", local: "〒606-8402 京都府京都市左京区銀閣寺町２", det: "日本、〒606-8402 京都府京都市左京区銀閣寺町２", detEn: "2 Ginkakujicho, Sakyo Ward, Kyoto, 606-8402, Japan", ctry: "日本", city: "京都", kind: "日本〒＋都道府縣" },
    { id: "J02", loc: "ja", name: "日本橋高島屋", lat: 35.6807, lng: 139.7741, cc: "JP", own: "日本、〒103-8265 東京都中央区日本橋２丁目４−１", local: "日本橋２丁目４−１", det: "日本、〒103-8265 東京都中央区日本橋２丁目４−１", detEn: "2 Chome-4-1 Nihonbashi, Chuo City, Tokyo 103-8265, Japan", ctry: "日本", city: "東京", kind: "國名不在邊緣段（日本橋）" },
    { id: "J03", loc: "ja", name: "通天閣", lat: 34.6525, lng: 135.5063, cc: "JP", own: "日本、〒556-0002 大阪府大阪市浪速区恵美須東１丁目１８−６", local: "大阪府大阪市浪速区恵美須東１丁目１８−６", det: "日本、〒556-0002 大阪府大阪市浪速区恵美須東１丁目１８−６", detEn: "1 Chome-18-6 Ebisuhigashi, Naniwa Ward, Osaka, 556-0002, Japan", ctry: "日本", city: "大阪", kind: "日本〒" },
    { id: "J04", loc: "ja", name: "大通公園", lat: 43.0597, lng: 141.3474, cc: "JP", own: "日本、〒060-0042 北海道札幌市中央区大通西７丁目", local: "北海道札幌市中央区大通西７丁目", det: "日本、〒060-0042 北海道札幌市中央区大通西７丁目", detEn: "Odorinishi 7 Chome, Chuo Ward, Sapporo, Hokkaido 060-0042, Japan", ctry: "日本", city: "札幌", kind: "日本〒（北海道）" },
    { id: "J05", loc: "ja", name: "首里城", lat: 26.217, lng: 127.7195, cc: "JP", own: "日本、〒903-0815 沖縄県那覇市首里金城町１丁目２", local: "沖縄県那覇市首里金城町１丁目２", det: "日本、〒903-0815 沖縄県那覇市首里金城町１丁目２", detEn: "1 Chome-2 Shurikinjocho, Naha, Okinawa 903-0815, Japan", ctry: "日本", city: "那覇", kind: "日本〒（沖縄県）" },
    { id: "J06", loc: "ja", name: "広蔵市場", lat: 37.57, lng: 126.9996, cc: "KR", own: "韓国 ソウル特別市鍾路区昌慶宮路 88", local: "ソウル特別市鍾路区昌慶宮路 88", det: "大韓民国 ソウル特別市鍾路区昌慶宮路 88", detEn: "88 Changgyeonggung-ro, Jongno District, Seoul, South Korea", ctry: "韓国", city: "ソウル", kind: "韓國（大韓民国／特別市）" },
    { id: "J07", loc: "ja", name: "豫園", lat: 31.2272, lng: 121.4921, cc: "CN", own: "中国 上海市黄浦区安仁街137号", local: "上海市黄浦区安仁街137号", det: "中華人民共和国 上海市黄浦区安仁街137号", detEn: "137 Anren St, Huangpu, Shanghai, China, 200010", ctry: "中国", city: "上海", kind: "中國（中華人民共和国）" },
    { id: "J08", loc: "ja", name: "龍山寺", lat: 25.0372, lng: 121.4999, cc: "TW", own: "台湾 〒108 台北市萬華区広州街211号", local: "台北市萬華区広州街211号", det: "台湾 〒108 台北市萬華区広州街211号", detEn: "No. 211, Guangzhou St, Wanhua District, Taipei City, Taiwan 108", ctry: "台湾", city: "台北", kind: "台灣（台湾 〒）" },
    { id: "J09", loc: "ja", name: "ビクトリア・ピーク", lat: 22.2759, lng: 114.1455, cc: "HK", own: "香港 ザ・ピーク", local: "ザ・ピーク", det: "香港 ザ・ピーク ピーク・ロード", detEn: "The Peak, Hong Kong", ctry: "香港", city: "香港", kind: "香港（ja）" },
    { id: "J10", loc: "ja", name: "ドバイ・フレーム", lat: 25.2354, lng: 55.3003, cc: "AE", own: "アラブ首長国連邦 ドバイ ザビール2 ザビールパーク", local: "ドバイ ザビール2 ザビールパーク", det: "アラブ首長国連邦 ドバイ ザビール2 ザビールパーク", detEn: "Zabeel Park Gate 3 - Al Kifaf - Dubai - United Arab Emirates", ctry: "アラブ首長国連邦", city: "ドバイ", kind: "杜拜（ja）" },
    { id: "J11", loc: "ja", name: "アメリカ自然史博物館", lat: 40.7813, lng: -73.974, cc: "US", own: "アメリカ合衆国 〒10024 ニューヨーク州 ニューヨーク セントラル・パーク・ウェスト 200", local: "ニューヨーク州 ニューヨーク セントラル・パーク・ウェスト 200", det: "アメリカ合衆国 〒10024 ニューヨーク州 ニューヨーク セントラル・パーク・ウェスト 200", detEn: "200 Central Park West, New York, NY 10024, USA", ctry: "アメリカ合衆国", city: "ニューヨーク", kind: "美國（ja 州）" },
    // ── ko ──
    { id: "K01", loc: "ko", name: "창덕궁", lat: 37.5794, lng: 126.991, cc: "KR", own: "대한민국 서울특별시 종로구 율곡로 99", local: "서울특별시 종로구 율곡로 99", det: "대한민국 서울특별시 종로구 율곡로 99", detEn: "99 Yulgok-ro, Jongno District, Seoul, South Korea", ctry: "대한민국", city: "서울", kind: "韓國特別市" },
    { id: "K02", loc: "ko", name: "해동용궁사", lat: 35.1884, lng: 129.2233, cc: "KR", own: "대한민국 부산광역시 기장군 기장읍 용궁길 86", local: "부산광역시 기장군 기장읍 용궁길 86", det: "대한민국 부산광역시 기장군 기장읍 용궁길 86", detEn: "86 Yongkung-gil, Gijang-eup, Gijang-gun, Busan, South Korea", ctry: "한국", city: "부산", kind: "韓國廣域市" },
    { id: "K03", loc: "ko", name: "천지연폭포", lat: 33.2447, lng: 126.5595, cc: "KR", own: "대한민국 제주특별자치도 서귀포시 천지동 667-7", local: "제주특별자치도 서귀포시 천지동 667-7", det: "대한민국 제주특별자치도 서귀포시 천지동 667-7", detEn: "667-7 Cheonji-dong, Seogwipo-si, Jeju-do, South Korea", ctry: "대한민국", city: "제주", kind: "韓國特別自治道" },
    { id: "K04", loc: "ko", name: "후마윤의 묘", lat: 28.5933, lng: 77.2507, cc: "IN", own: "인도 델리 니자무딘 동부 마투라 로드", local: "델리 니자무딘 동부 마투라 로드", det: "인도 델리 니자무딘 동부 마투라 로드", detEn: "Mathura Road, Nizamuddin East, New Delhi, Delhi 110013, India", ctry: "인도", city: null, kind: "印度（ko 인도 前綴）" },
    { id: "K05", loc: "ko", name: "교토 타워", lat: 34.9875, lng: 135.7592, cc: "JP", own: "일본 〒600-8216 교토부 교토시 시모교구 히가시시오코지초 721-1", local: "교토부 교토시 시모교구 히가시시오코지초 721-1", det: "일본 〒600-8216 교토부 교토시 시모교구 히가시시오코지초 721-1", detEn: "721-1 Higashishiokojicho, Shimogyo Ward, Kyoto, 600-8216, Japan", ctry: "일본", city: "교토", kind: "日本（ko 〒）" },
    { id: "K06", loc: "ko", name: "천단공원", lat: 39.8822, lng: 116.4066, cc: "CN", own: "중국 베이징시 둥청구 톈탄루 1", local: "베이징시 둥청구 톈탄루 1", det: "중국 베이징시 둥청구 톈탄루 1", detEn: "1 Tiantan E Rd, Dongcheng, Beijing, China, 100061", ctry: "중국", city: "北京", kind: "中國（ko）" },
    { id: "K07", loc: "ko", name: "디화제", lat: 25.0558, lng: 121.51, cc: "TW", own: "대만 타이베이시 다퉁구 디화가 1단", local: "타이베이시 다퉁구 디화가 1단", det: "대만 Taipei City, Datong District, Dihua St, Section 1", detEn: "Section 1, Dihua St, Datong District, Taipei City, Taiwan 103", ctry: "대만", city: "台北", kind: "台灣（ko 대만）" },
    { id: "K08", loc: "ko", name: "홍콩 우주 박물관", lat: 22.2942, lng: 114.1719, cc: "HK", own: "홍콩 침사추이 솔즈베리 로드 10", local: "침사추이 솔즈베리 로드 10", det: "홍콩 Tsim Sha Tsui, Salisbury Rd, 10號", detEn: "10 Salisbury Rd, Tsim Sha Tsui, Hong Kong", ctry: "홍콩", city: "홍콩", kind: "香港（ko 홍콩）" },
    { id: "K09", loc: "ko", name: "그랜드 리스보아", lat: 22.1903, lng: 113.5434, cc: "MO", own: "마카오 Avenida de Lisboa, 2-4號", local: "Avenida de Lisboa, 2-4號", det: "마카오 Avenida de Lisboa, 2-4號", detEn: "Avenida de Lisboa, 2-4, Macao", ctry: "마카오", city: "마카오", kind: "澳門（ko 마카오）" },
    { id: "K10", loc: "ko", name: "피어 39", lat: 37.8087, lng: -122.4098, cc: "US", own: "미국 CA 94133 샌프란시스코 비치 스트리트 피어 39", local: "CA 94133 샌프란시스코 비치 스트리트", det: "미국 CA 94133 샌프란시스코 비치 스트리트 피어 39", detEn: "Pier 39, The Embarcadero, San Francisco, CA 94133, USA", ctry: "미국", city: "샌프란시스코", kind: "美國州碼（ko）" },
    { id: "K11", loc: "ko", name: "부르즈 칼리파 전망대", lat: 25.1975, lng: 55.2742, cc: "AE", own: "아랍에미리트 두바이 다운타운 두바이 셰이크 모하메드 빈 라시드 대로 1", local: "두바이 다운타운 두바이", det: "아랍에미리트 두바이 다운타운 두바이 셰이크 모하메드 빈 라시드 대로 1", detEn: "1 Sheikh Mohammed bin Rashid Blvd - Downtown Dubai - Dubai - United Arab Emirates", ctry: "아랍에미리트", city: "두바이", kind: "杜拜（ko）" },
  ];
  {
    const byLoc = {};
    for (const p of F) byLoc[p.loc] = (byLoc[p.loc] ?? 0) + 1;
    record("F", "F0", "擋錯樣本數：四語系各 ≥ 10 點", Object.values(byLoc).length === 4 && Object.values(byLoc).every((n) => n >= 10) ? "PASS" : "FAIL", JSON.stringify(byLoc));
  }

  // F1：國名辨識（只看邊緣段）不得判成他國；辨識不到記 INFO（只會少擋、不會擋錯）
  {
    const wrong = [];
    const unseen = [];
    for (const p of F) {
      for (const [k, t] of [["own", p.own], ["det", p.det], ["detEn", p.detEn], ["local", p.local]]) {
        const s = g.explicitCountriesInGeoText(t);
        if (s.size && !s.has(p.cc)) wrong.push(`${p.id}.${k}「${t}」→${setStr(s)}（應 ${p.cc}）`);
        if (k !== "local" && !s.size) unseen.push(`${p.id}.${k}「${t}」`);
        if (k === "local" && s.size) wrong.push(`${p.id}.local（無國名）「${t}」→${setStr(s)}`);
      }
      const cc = g.countryCodeFromCountryText(p.ctry);
      if (cc !== p.cc) unseen.push(`${p.id}.ctry「${p.ctry}」→${cc}`);
    }
    record("F", "F1", "國名辨識：四語系地址邊緣段不得判成他國，無國名地址不得辨識出國家", wrong.length ? "FAIL" : "PASS", wrong.join("；") || "無誤判");
    record("F", "F1-unseen", "國名辨識：寫了國名但辨識不到（只影響漏擋，不會擋錯）", "INFO", unseen.join("；") || "無");
  }

  // F2：座標推國家不得判成他國（null 可接受）
  {
    const wrong = [];
    const nulls = [];
    for (const p of F) {
      const c = g.countryCodeForCoordinates(p.lat, p.lng);
      if (c && c !== p.cc) wrong.push(`${p.id} ${p.name}→${c}`);
      if (!c) nulls.push(p.id);
    }
    record("F", "F2", "座標推國家不得判成他國", wrong.length ? "FAIL" : "PASS", `${wrong.join("；") || "無誤判"}｜null：${nulls.join(",") || "無"}`);
  }

  // F3：端到端 — 各 handoff 組合 × 候選組 × Details 語系，必須顯示正確地點
  const RIVAL_US = { secondary: "3655 Las Vegas Blvd S, Las Vegas, NV 89109, USA", lat: 36.1125, lng: -115.1728, address: "3655 Las Vegas Blvd S, Las Vegas, NV 89109, USA" };
  const RIVAL_JP = { secondary: "日本東京都港區台場1丁目", lat: 35.6272, lng: 139.7714, address: "日本〒135-0091 東京都港區台場1丁目" };
  let fTotal = 0;
  const fLost = [];
  const fRivalWithHard = { total: 0, correct: 0, other: [] };
  const fUnrankable = [];
  for (const p of F) {
    const off = { lat: p.lat + 0.003, lng: p.lng + 0.003 };
    const en = COUNTRY_EN[p.cc];
    const hs = [
      ["own-coords", { name: p.name, address: null, ...off }],
      ["own-coords+ctx", { name: p.name, address: null, ...off, contextCountry: p.ctry }],
      ["addr-full", { name: p.name, address: p.own, lat: null, lng: null }],
      ["addr-full-en", { name: p.name, address: p.detEn, lat: null, lng: null }],
      ["addr-local", { name: p.name, address: p.local, lat: null, lng: null }],
      ["addr-local+ctx-country", { name: p.name, address: p.local, lat: null, lng: null, contextCountry: p.ctry }],
      ["addr-full+ctx-en", { name: p.name, address: p.own, lat: null, lng: null, contextCountry: en }],
      ["ctx-country", { name: p.name, address: null, lat: null, lng: null, contextCountry: p.ctry }],
      ["ctx-iso", { name: p.name, address: null, lat: null, lng: null, contextCountry: p.cc }],
      ["itinerary", itin(p.name, { city: p.city, country: p.ctry })],
    ];
    if (p.city) {
      hs.push(["addr-local+ctx-city", { name: p.name, address: p.local, lat: null, lng: null, contextCity: p.city }]);
      hs.push(["ctx-city", { name: p.name, address: null, lat: null, lng: null, contextCity: p.city }]);
      hs.push(["saved", saved(p.name, p.city)]);
      hs.push(["extension", itin(p.name, { city: "某主目的地", country: p.ctry }, p.city)]);
    }
    const correct = { placeId: `ChIJ_B18_${p.id}`, label: p.name, secondary: p.det, types: POI };
    const correctEn = { ...correct, placeId: `ChIJ_B18_${p.id}_EN`, secondary: p.detEn };
    const correctShort = { ...correct, placeId: `ChIJ_B18_${p.id}_S`, secondary: p.local };
    const rv = ["US", "CA"].includes(p.cc) ? RIVAL_JP : RIVAL_US;
    const rival = { placeId: `ChIJ_B18_${p.id}_RIVAL`, label: p.name, secondary: rv.secondary, types: POI };
    const correctIds = new Set([correct.placeId, correctEn.placeId, correctShort.placeId]);
    const detVariants = [
      ["Details 該語系", { lat: p.lat, lng: p.lng, address: p.det }],
      ["Details en", { lat: p.lat, lng: p.lng, address: p.detEn }],
    ];
    for (const [hname, h] of hs) {
      const hard = g.hasHardPlaceGeoContext(g.buildPlaceGeoContext(h));
      for (const [dname, d] of detVariants) {
        const det = { [correct.placeId]: d, [correctEn.placeId]: d, [correctShort.placeId]: d, [rival.placeId]: { lat: rv.lat, lng: rv.lng, address: rv.address } };
        for (const [sname, cands] of [["只有正確", [correct]], ["只有正確(en 候選)", [correctEn]], ["只有正確(無國名候選)", [correctShort]]]) {
          fTotal += 1;
          const r = await displayed(h, cands, det, `F/${p.id}/${hname}/${sname}/${dname}`);
          if (!correctIds.has(r.shown)) fLost.push(`${p.id}(${p.loc}) ${hname}/${sname}/${dname} → ${r.shown}（resolve=${r.got}）`);
        }
        if (hard) {
          // 規格（C／F）會排序的情境：自身地址明確國名、rankCountries、或自身座標保守推得出國家。
          const gc = g.buildPlaceGeoContext(h);
          const rankable = gc.ownCountries.size > 0 || gc.rankCountries.size > 0 || (gc.coords && g.countryCodeForCoordinates(gc.coords.lat, gc.coords.lng));
          const r = await displayed(h, [rival, correct], det, `F/${p.id}/${hname}/rival/${dname}`);
          if (rankable) {
            fRivalWithHard.total += 1;
            if (correctIds.has(r.shown)) fRivalWithHard.correct += 1;
            else fRivalWithHard.other.push(`${p.id} ${hname}/${dname} → ${r.shown === rival.placeId ? "他國" : r.shown}`);
          } else {
            fUnrankable.push(`${p.id} ${hname}/${dname} → ${correctIds.has(r.shown) ? "正確" : r.shown === rival.placeId ? "他國" : r.shown}（HEAD=${correctIds.has(r.headShown) ? "正確" : r.headShown === rival.placeId ? "他國" : r.headShown}）`);
            if (r.shown === rival.placeId) fRivalWithHard.other.push(`${p.id} ${hname}/${dname} → 他國（不得顯示）`);
          }
        }
      }
    }
  }
  record("F", "F3", "擋錯端到端：只有正確候選時，各 handoff 組合 × 候選格式 × Details 語系最終皆顯示正確地點", fLost.length ? "FAIL" : "PASS", `${fTotal} 例；${fLost.length ? `遺失 ${fLost.length}：${fLost.slice(0, 20).join("；")}` : "全部顯示"}`);
  record("F", "F4", "規格會排序的固定資料下，他國同名候選排第一 → 仍顯示正確地點（且任何情境都不顯示他國）", fRivalWithHard.other.length ? "FAIL" : "PASS", `${fRivalWithHard.correct}/${fRivalWithHard.total} 正確${fRivalWithHard.other.length ? `；其他：${fRivalWithHard.other.slice(0, 15).join("；")}` : ""}`);
  record("F", "F4-unrankable", "只有自身座標且座標推不出國家、無 context：規格不排序 → 他國候選被選中後由 300 km 規則拒絕 → base（HEAD 顯示他國）", "INFO", `${fUnrankable.length} 例：${fUnrankable.join("；") || "無"}`);

  // F5：聊天結果篩選不得剔除正確地點（四語系國名 × Details 兩種語系）
  {
    const dropped = [];
    for (const p of F) {
      const places = [{ id: "a", address: p.det }, { id: "b", address: p.detEn }, { id: "c", address: p.own }, { id: "d", address: p.local }];
      for (const dc of [p.ctry, COUNTRY_EN[p.cc], p.cc]) {
        const kept = g.filterPlacesByCountryAddress(places, dc);
        if (kept.length !== places.length) dropped.push(`${p.id} destinationCountry=${dc} 剔除 ${places.filter((x) => !kept.includes(x)).map((x) => x.address).join(" | ")}`);
      }
      const sc = { searchMode: "destination", destinationName: p.city ?? p.name, textOnlyDestinationSearch: true, destinationCountry: p.ctry };
      const kept2 = searchCtx.filterTextOnlyDestinationCountryMismatch(places, sc);
      if (kept2.length !== places.length) dropped.push(`${p.id} filterTextOnlyDestinationCountryMismatch 剔除 ${places.length - kept2.length}`);
    }
    record("F", "F5", "聊天結果篩選：正確地點（四語系地址）不得被剔除", dropped.length ? "FAIL" : "PASS", dropped.slice(0, 15).join("；") || "無剔除");
  }

  // ════════ L. 漏擋：遠距同名 10 組 ════════
  // correct: { lat, lng, cc, own, ownEn, local, det, ctryZh, ctryEn, city, mainCity }
  // rival: { lat, lng, cc, inferred（預期保守推國）, sec, secUnk, det, detNoCountry, coordsOnlyBlocks（規則 E：> 2000 km 且推得他國） }
  const L = [
    { id: "L01", name: "Sydney Tower Eye",
      correct: { lat: -33.8705, lng: 151.2089, cc: "AU", own: "澳洲新南威爾斯州雪梨市場街100號", ownEn: "100 Market St, Sydney NSW 2000, Australia", local: "100 Market St, Sydney NSW 2000", det: "100 Market St, Sydney NSW 2000, Australia", ctryZh: "澳洲", ctryEn: "Australia", city: "雪梨", mainCity: "墨爾本" },
      rival: { lat: 1.5583, lng: 110.3492, cc: "MY", inferred: "MY", sec: "Jalan Padungan, Kuching, Sarawak, Malaysia", secUnk: "Jalan Padungan, Kuching", det: "Jalan Padungan, 93100 Kuching, Sarawak, Malaysia", detNoCountry: "Jalan Padungan, 93100 Kuching, Sarawak", coordsOnlyBlocks: true } },
    { id: "L02", name: "Eiffel Tower",
      correct: { lat: 48.8584, lng: 2.2945, cc: "FR", own: "法國巴黎戰神廣場", ownEn: "Av. Gustave Eiffel, 75007 Paris, France", local: "Av. Gustave Eiffel, 75007 Paris", det: "Av. Gustave Eiffel, 75007 Paris, France", ctryZh: "法國", ctryEn: "France", city: "巴黎", mainCity: "里昂" },
      rival: { lat: 30.392, lng: 120.288, cc: "CN", inferred: "CN", sec: "中國浙江省杭州市臨平區天都城", secUnk: "臨平區天都城", det: "中國浙江省杭州市臨平區天都城", detNoCountry: "浙江省杭州市臨平區天都城", coordsOnlyBlocks: true } },
    { id: "L03", name: "Big Ben",
      correct: { lat: 51.5007, lng: -0.1246, cc: "GB", own: "英國倫敦西敏", ownEn: "London SW1A 0AA, UK", local: "Westminster, London SW1A 0AA", det: "London SW1A 0AA, UK", ctryZh: "英國", ctryEn: "United Kingdom", city: "倫敦", mainCity: "愛丁堡" },
      rival: { lat: 13.7466, lng: 100.5393, cc: "TH", inferred: "TH", sec: "Sukhumvit Rd, Khlong Toei, Bangkok, Thailand", secUnk: "Sukhumvit Rd, Khlong Toei", det: "Sukhumvit Rd, Khlong Toei, Bangkok 10110, Thailand", detNoCountry: "Sukhumvit Rd, Khlong Toei, Bangkok 10110", coordsOnlyBlocks: true } },
    { id: "L04", name: "Times Square",
      correct: { lat: 40.758, lng: -73.9855, cc: "US", own: "美國紐約州紐約時代廣場", ownEn: "Manhattan, NY 10036, USA", local: "Manhattan, NY 10036", det: "Manhattan, NY 10036, USA", ctryZh: "美國", ctryEn: "United States", city: "紐約", mainCity: "波士頓" },
      rival: { lat: 22.2783, lng: 114.1823, cc: "HK", inferred: "HK", sec: "1 Matheson St, Causeway Bay, Hong Kong", secUnk: "1 Matheson St, Causeway Bay", det: "1 Matheson St, Causeway Bay, Hong Kong", detNoCountry: "1 Matheson St, Causeway Bay", coordsOnlyBlocks: true } },
    { id: "L05", name: "Brooklyn Bridge",
      correct: { lat: 40.7061, lng: -73.9969, cc: "US", own: "美國紐約州紐約布魯克林大橋", ownEn: "Brooklyn Bridge, New York, NY 10038, USA", local: "Brooklyn Bridge, New York, NY 10038", det: "Brooklyn Bridge, New York, NY 10038, USA", ctryZh: "美國", ctryEn: "USA", city: "New York", mainCity: "華盛頓" },
      rival: { lat: 37.5326, lng: 127.0246, cc: "KR", inferred: "KR", sec: "대한민국 서울특별시 강남구 압구정로", secUnk: "강남구 압구정로", det: "대한민국 서울특별시 강남구 압구정로 165", detNoCountry: "서울특별시 강남구 압구정로 165", coordsOnlyBlocks: true } },
    { id: "L06", name: "Hilton Garden Inn",
      correct: { lat: -37.8152, lng: 144.9586, cc: "AU", own: "澳洲維多利亞州墨爾本伊莉莎白街", ownEn: "15 Elizabeth St, Melbourne VIC 3000, Australia", local: "15 Elizabeth St, Melbourne VIC 3000", det: "15 Elizabeth St, Melbourne VIC 3000, Australia", ctryZh: "澳洲", ctryEn: "Australia", city: "墨爾本", mainCity: "雪梨" },
      rival: { lat: 30.0478, lng: 31.2336, cc: "EG", inferred: "EG", sec: "Corniche El Nil, Cairo Governorate, Egypt", secUnk: "Corniche El Nil", det: "Corniche El Nil, Qasr El Nil, Cairo Governorate 4272077, Egypt", detNoCountry: "Corniche El Nil, Qasr El Nil", coordsOnlyBlocks: true } },
    { id: "L07", name: "JW Marriott Hotel",
      correct: { lat: 13.7426, lng: 100.5532, cc: "TH", own: "泰國曼谷素坤逸路4巷", ownEn: "4 Sukhumvit Rd, Khlong Toei, Bangkok 10110, Thailand", local: "4 Sukhumvit Rd, Khlong Toei, Bangkok 10110", det: "4 Sukhumvit Rd, Khlong Toei, Bangkok 10110, Thailand", ctryZh: "泰國", ctryEn: "Thailand", city: "曼谷", mainCity: "清邁" },
      rival: { lat: 25.0853, lng: 55.145, cc: "AE", inferred: "AE", sec: "Al Sufouh Rd - Dubai Marina - Dubai - United Arab Emirates", secUnk: "Al Sufouh Rd - Dubai Marina", det: "Al Sufouh Rd - Dubai Marina - Dubai - United Arab Emirates", detNoCountry: "Al Sufouh Rd - Dubai Marina - Dubai", coordsOnlyBlocks: true } },
    { id: "L08", name: "Starbucks Reserve Roastery",
      correct: { lat: 35.6496, lng: 139.6967, cc: "JP", own: "日本〒153-0042 東京都目黑區青葉台2丁目19−23", ownEn: "2 Chome-19-23 Aobadai, Meguro City, Tokyo 153-0042, Japan", local: "東京都目黑區青葉台2丁目19−23", det: "日本〒153-0042 東京都目黒区青葉台２丁目１９−２３", ctryZh: "日本", ctryEn: "Japan", city: "東京", mainCity: "大阪" },
      // 上海距日本最近已知點（五島）約 710 km：明確國名 → > 400 km 須擋；只有座標 → < 2000 km 規格允許放過
      rival: { lat: 31.2296, lng: 121.4554, cc: "CN", inferred: "CN", sec: "中國上海市靜安區南京西路789號", secUnk: "南京西路789號", det: "中國上海市靜安區南京西路789號", detNoCountry: "上海市靜安區南京西路789號", coordsOnlyBlocks: false } },
    { id: "L09", name: "Hard Rock Cafe",
      correct: { lat: 50.0857, lng: 14.4202, cc: "CZ", own: "捷克布拉格老城區", ownEn: "Malé nám. 142/3, 110 00 Staré Město, Czechia", local: "Malé nám. 142/3, 110 00 Staré Město", det: "Malé nám. 142/3, 110 00 Staré Město, Czechia", ctryZh: "捷克", ctryEn: "Czech Republic", city: "布拉格", mainCity: "維也納" },
      rival: { lat: 21.1338, lng: -86.7465, cc: "MX", inferred: "MX", sec: "Blvd. Kukulcan, Zona Hotelera, Cancún, Q.R., Mexico", secUnk: "Blvd. Kukulcan, Zona Hotelera", det: "Blvd. Kukulcan Km 9.5, Zona Hotelera, 77500 Cancún, Q.R., Mexico", detNoCountry: "Blvd. Kukulcan Km 9.5, Zona Hotelera, 77500 Cancún, Q.R.", coordsOnlyBlocks: true } },
    { id: "L10", name: "Disneyland Park",
      correct: { lat: 48.8722, lng: 2.7758, cc: "FR", own: "法國馬恩河谷舍西", ownEn: "Bd de Parc, 77700 Coupvray, France", local: "Bd de Parc, 77700 Coupvray", det: "Bd de Parc, 77700 Coupvray, France", ctryZh: "法國", ctryEn: "France", city: "巴黎", mainCity: "里昂" },
      rival: { lat: 33.8121, lng: -117.919, cc: "US", inferred: "US", sec: "Disneyland Dr, Anaheim, CA, USA", secUnk: "Disneyland Dr, Anaheim", det: "1313 Disneyland Dr, Anaheim, CA 92802, USA", detNoCountry: "1313 Disneyland Dr, Anaheim, CA 92802", coordsOnlyBlocks: true } },
  ];
  // L0：資料前提（以防 oracle 用錯前提）
  {
    const bad = [];
    for (const l of L) {
      const c = l.correct;
      const r = l.rival;
      if (setStr(g.explicitCountriesInGeoText(c.own)) !== setStr([c.cc])) bad.push(`${l.id} own→${setStr(g.explicitCountriesInGeoText(c.own))}`);
      if (setStr(g.explicitCountriesInGeoText(c.ownEn)) !== setStr([c.cc])) bad.push(`${l.id} ownEn→${setStr(g.explicitCountriesInGeoText(c.ownEn))}`);
      if (g.explicitCountriesInGeoText(c.local).size) bad.push(`${l.id} local 應無國名`);
      if (setStr(g.explicitCountriesInGeoText(r.sec)) !== setStr([r.cc])) bad.push(`${l.id} rival.sec→${setStr(g.explicitCountriesInGeoText(r.sec))}`);
      if (setStr(g.explicitCountriesInGeoText(r.det)) !== setStr([r.cc])) bad.push(`${l.id} rival.det→${setStr(g.explicitCountriesInGeoText(r.det))}`);
      if (g.explicitCountriesInGeoText(r.secUnk).size || g.explicitCountriesInGeoText(r.detNoCountry).size) bad.push(`${l.id} rival 無國名變體被辨識出國家`);
      if (g.countryCodeForCoordinates(r.lat, r.lng) !== r.inferred) bad.push(`${l.id} rival 推國=${g.countryCodeForCoordinates(r.lat, r.lng)}（預期 ${r.inferred}）`);
      if (g.countryCodeFromCountryText(c.ctryZh) !== c.cc || g.countryCodeFromCountryText(c.ctryEn) !== c.cc) bad.push(`${l.id} 國名文字辨識錯誤`);
    }
    record("L", "L0", "漏擋樣本前提：國名辨識與座標推國符合預期", bad.length ? "FAIL" : "PASS", bad.join("；") || "OK");
  }
  const leakStats = { hardBlockedOk: 0, leaks: [], allowed: [], overBlock: [], headDiff: [], noFixed: 0, correctLost: [] };
  for (const l of L) {
    const c = l.correct;
    const r = l.rival;
    const off = { lat: c.lat + 0.003, lng: c.lng + 0.003 };
    const N = l.name;
    // [名稱, handoff, O（自身地址明確國名）, C（自身座標）, R（context 參考國）]
    const hs = [
      ["own-coords", { name: N, address: null, ...off }, [], true, []],
      ["own-coords+ctx", { name: N, address: null, ...off, contextCountry: c.ctryZh }, [], true, [c.cc]],
      ["addr-full-zh", { name: N, address: c.own, lat: null, lng: null }, [c.cc], false, []],
      ["addr-full-en", { name: N, address: c.ownEn, lat: null, lng: null }, [c.cc], false, []],
      ["addr-local", { name: N, address: c.local, lat: null, lng: null }, [], false, []],
      ["addr-local+ctx-country", { name: N, address: c.local, lat: null, lng: null, contextCountry: c.ctryEn }, [], false, [c.cc]],
      ["addr-local+ctx-city", { name: N, address: c.local, lat: null, lng: null, contextCity: c.city }, [], false, [c.cc]],
      ["ctx-city", { name: N, address: null, lat: null, lng: null, contextCity: c.city }, [], false, [c.cc]],
      ["ctx-country-zh", { name: N, address: null, lat: null, lng: null, contextCountry: c.ctryZh }, [], false, [c.cc]],
      ["ctx-country-en", { name: N, address: null, lat: null, lng: null, contextCountry: c.ctryEn }, [], false, [c.cc]],
      ["ctx-iso", { name: N, address: null, lat: null, lng: null, contextCountry: c.cc }, [], false, [c.cc]],
      ["ctx-city+country", { name: N, address: null, lat: null, lng: null, contextCity: c.city, contextCountry: c.ctryZh }, [], false, [c.cc]],
      ["itinerary", itin(N, { city: c.city, country: c.ctryZh }), [], false, [c.cc]],
      ["extension", itin(N, { city: c.mainCity, country: c.ctryZh }, c.city), [], false, [c.cc]],
      ["saved", saved(N, c.city), [], false, [c.cc]],
    ];
    const RIV = { placeId: `ChIJ_B18_${l.id}_RIV`, label: N, secondary: r.sec, types: POI };
    const RIV_U = { ...RIV, placeId: `ChIJ_B18_${l.id}_RIVU`, secondary: r.secUnk };
    const COR = { placeId: `ChIJ_B18_${l.id}_COR`, label: N, secondary: c.det, types: POI };
    const COR_P = { ...COR, placeId: `ChIJ_B18_${l.id}_CORP`, label: `${N} ${c.city}` };
    const rivalIds = new Set([RIV.placeId, RIV_U.placeId]);
    const corIds = new Set([COR.placeId, COR_P.placeId]);
    const rdVariants = [
      ["full", { lat: r.lat, lng: r.lng, address: r.det }, true, true],
      ["nocountry", { lat: r.lat, lng: r.lng, address: r.detNoCountry }, false, true],
      ["coordsOnly", { lat: r.lat, lng: r.lng, address: null }, false, true],
      ["nocoords", { lat: null, lng: null, address: r.det }, true, false],
    ];
    for (const [hname, h, O, C, R] of hs) {
      const noFixed = !O.length && !C && !R.length;
      for (const [vname, rd, vExplicit, vCoords] of rdVariants) {
        // 規則 E 的預期（獨立 oracle；資料前提由 L0 檢查）
        let mustBlock = false;
        if (C && vCoords) mustBlock = true; // a. 自身座標相距 > 300 km
        else if (O.length && vExplicit) mustBlock = true; // b. 雙方明確國名不同
        else if (!C && vCoords) {
          const ref = O.length ? O : R;
          if (ref.length) mustBlock = vExplicit ? true /* 全部 > 400 km */ : r.coordsOnlyBlocks;
        }
        const det = { [RIV.placeId]: rd, [RIV_U.placeId]: rd, [COR.placeId]: { lat: c.lat, lng: c.lng, address: c.det }, [COR_P.placeId]: { lat: c.lat, lng: c.lng, address: c.det } };
        for (const [sname, cands] of [["只有他國", [RIV]], ["他國排第一", [RIV, COR_P]], ["他國無國名排第一", [RIV_U, COR_P]], ["雙方完全同名", [RIV, COR]]]) {
          const out = await displayed(h, cands, det, `L/${l.id}/${hname}/${vname}/${sname}`);
          const tag = `${l.id} ${hname}/${vname}/${sname}`;
          if (noFixed) {
            leakStats.noFixed += 1;
            if (out.shown !== out.headShown) leakStats.headDiff.push(`${tag}：工作樹=${out.shown} HEAD=${out.headShown}`);
            continue;
          }
          if (rivalIds.has(out.shown)) {
            if (mustBlock) leakStats.leaks.push(tag);
            else leakStats.allowed.push(tag);
          } else {
            if (mustBlock) leakStats.hardBlockedOk += 1;
            else if (!corIds.has(out.shown) && cands.length === 1) leakStats.overBlock.push(`${tag}→${out.shown}`);
          }
          // 有正確候選、他國候選明確寫出他國國名、有固定資料 → 必須選正確（排序 -150）
          if (cands.some((x) => corIds.has(x.placeId)) && cands[0] === RIV && !corIds.has(out.shown)) {
            leakStats.correctLost.push(`${tag}→${out.shown === RIV.placeId ? "他國" : out.shown}`);
          }
        }
      }
    }
  }
  record("L", "L1", "漏擋：規則 E 必須拒絕的情境全部擋下（resolve 未採用或 Details 拒絕）", leakStats.leaks.length ? "FAIL" : "PASS", `擋下 ${leakStats.hardBlockedOk}；漏擋 ${leakStats.leaks.length}${leakStats.leaks.length ? `：${leakStats.leaks.slice(0, 20).join("；")}` : ""}`);
  record("L", "L2", "有固定資料、他國候選明確寫出他國國名且排第一 → 改選正確候選", leakStats.correctLost.length ? "FAIL" : "PASS", leakStats.correctLost.slice(0, 20).join("；") || "全部選中正確");
  record("L", "L3", "無固定資料（地址無國名、無 context、無座標）→ 與 HEAD 相同", leakStats.headDiff.length ? "FAIL" : "PASS", `${leakStats.noFixed} 例${leakStats.headDiff.length ? `；不同：${leakStats.headDiff.slice(0, 10).join("；")}` : ""}`);
  {
    const kinds = {};
    for (const t of leakStats.allowed) {
      const k = t.split(" ")[1].split("/")[1];
      kinds[k] = (kinds[k] ?? 0) + 1;
    }
    record("L", "L4", "規格允許放過（Details 無座標、只有座標且推不出／2000 km 內）", "INFO", `${leakStats.allowed.length} 例 ${JSON.stringify(kinds)}；例：${leakStats.allowed.slice(0, 6).join("；")}`);
    record("L", "L5", "Details 變體規格允許放過、但 resolve 已依規則 D 丟棄（自身地址國名 ≠ 候選 secondary 國名）", "INFO", `${leakStats.overBlock.length} 例${leakStats.overBlock.length ? `：${leakStats.overBlock.slice(0, 8).join("；")}` : ""}`);
  }

  // ════════ R. 工程師自述風險與規則 A 邊界 ════════
  // R1：searchText destinationCountry 實際傳入值（entity.country）→ regionCode
  {
    const rows = [];
    const unmapped = [];
    const ents = destEntity.listRegisteredDestinationEntities();
    const vals = new Set();
    for (const e of ents) if (e.country) vals.add(e.country);
    // 非註冊目的地：type=country／city_state 時 inferCountry 回傳名稱本身
    for (const label of ["德國", "英國", "法國", "西班牙", "紐西蘭", "加拿大", "Germany", "Japan", "歐洲", "東南亞", "北海道", "京都", "首爾", "曼谷", "布拉格", "伊斯坦堡", "杜拜", "烏蘭巴托"]) {
      const e = destEntity.resolveDestinationEntity(label);
      rows.push(`${label}→type=${e.type} country=${e.country ?? "-"}`);
      if (e.country) vals.add(e.country);
    }
    const mapping = [...vals].map((v) => {
      const code = g.countryCodeFromCountryText(v);
      if (!code) unmapped.push(v);
      return `${v}=${code ?? "null"}`;
    });
    // payload：非 textOnly 時與 HEAD 相同（不帶 destinationCountry）
    const base = { searchMode: "destination", destinationName: "京都", destinationLatLng: { lat: 35, lng: 135.7 }, textOnlyDestinationSearch: false, destinationCountry: "日本", destinationCity: "京都" };
    const p1 = searchCtx.placesSearchContextPayload(base);
    const p2 = searchCtx.placesSearchContextPayload({ ...base, destinationLatLng: null, textOnlyDestinationSearch: true });
    const payloadOk = !("destinationCountry" in p1) && p2.destinationCountry === "日本";
    record("R", "R1", "風險 1：destinationCountry 實際值皆為中文國名（entity.country）；對不到國家碼時不補 regionCode＝HEAD 行為（HEAD 本來就不補）", payloadOk ? "PASS" : "FAIL",
      `entity.country→code：${mapping.join("、")}｜對不到：${unmapped.join("、") || "無"}｜非 textOnly payload 不帶 destinationCountry=${!("destinationCountry" in p1)}｜textOnly 帶=${p2.destinationCountry}｜${rows.join("；")}`);
    // textOnlyDestinationRegionCode（AST 抽出）：台灣不送、地圖自由搜尋不送
    let fn = null;
    try {
      const ts = (await import("typescript")).default;
      const file = "src/lib/places.functions.ts";
      const source = fs.readFileSync(`${WORK_ROOT}/${file}`, "utf8");
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const node = tree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "textOnlyDestinationRegionCode");
      if (node) {
        const ctx = vm.createContext({ countryCodeFromCountryText: g.countryCodeFromCountryText });
        vm.runInContext(ts.transpileModule(node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
        fn = ctx.textOnlyDestinationRegionCode;
      }
    } catch (e) {
      record("R", "R1b", "textOnlyDestinationRegionCode 抽出", "FAIL", String(e?.message ?? e));
    }
    if (fn) {
      const cases = [
        [{ skipLocationBias: true, searchMode: "destination", destinationCountry: "日本" }, "JP"],
        [{ skipLocationBias: true, searchMode: "destination", destinationCountry: "台灣" }, undefined],
        [{ skipLocationBias: true, searchMode: "destination", destinationCountry: "摩納哥" }, undefined],
        [{ skipLocationBias: true, searchMode: "destination", destinationCountry: "京都" }, undefined],
        [{ skipLocationBias: true, searchMode: "destination", destinationCountry: "香港" }, "HK"],
        [{ skipLocationBias: false, searchMode: "destination", destinationCountry: "日本" }, undefined],
        [{ skipLocationBias: true, searchMode: "destination", destinationCountry: "日本", placesCaller: "map.freeTextSearch" }, undefined],
        [{ skipLocationBias: true, searchMode: "destination" }, undefined],
      ];
      const bad = cases.filter(([d, want]) => fn(d) !== want).map(([d, want]) => `${JSON.stringify(d)}→${fn(d)}（預期 ${want}）`);
      record("R", "R1b", "textOnlyDestinationRegionCode：國名→碼、台灣／城市名／未建模國家／非 textOnly／地圖自由搜尋皆不送", bad.length ? "FAIL" : "PASS", bad.join("；") || `${cases.length} 例符合`);
    }
  }
  // R2：延伸點 contextCity 在城市表內時，排序只看延伸目的地
  {
    const notes = [];
    // a. 倫敦行程 → 延伸巴黎：法國候選優先（正確）
    const hA = itin("Musée d'Orsay", { city: "倫敦", country: "United Kingdom" }, "巴黎");
    const ctxA = g.buildPlaceGeoContext(hA);
    notes.push(`倫敦→延伸巴黎：rank=${setStr(ctxA.rankCountries)} soft=${setStr(ctxA.softCountries)}`);
    const FR = { placeId: "ChIJ_B18_R2_FR", label: "Musée d'Orsay", secondary: "Esplanade Valéry Giscard d'Estaing, Paris, France", types: POI };
    const GBX = { placeId: "ChIJ_B18_R2_GB", label: "Musée d'Orsay", secondary: "Soho, London, UK", types: POI };
    const rA = await displayed(hA, [GBX, FR], { [FR.placeId]: { lat: 48.86, lng: 2.3266, address: "1 Rue de la Légion d'Honneur, 75007 Paris, France" }, [GBX.placeId]: { lat: 51.513, lng: -0.136, address: "Soho, London W1D, UK" } }, "R2a");
    notes.push(`他國(GB)排第一 → 顯示=${rA.shown === FR.placeId ? "巴黎(正確)" : rA.shown}`);
    // b. 波特蘭行程 → 延伸「溫哥華」（使用者其實指華盛頓州 Vancouver，15 km）：城市表把溫哥華當 CA
    const hB = itin("Fort Vancouver", { city: "Portland", country: "United States" }, "溫哥華");
    const ctxB = g.buildPlaceGeoContext(hB);
    const WA = { placeId: "ChIJ_B18_R2_WA", label: "Fort Vancouver National Historic Site", secondary: "East Evergreen Boulevard, Vancouver, WA, USA", types: POI };
    const BC = { placeId: "ChIJ_B18_R2_BC", label: "Fort Vancouver Pub", secondary: "Granville St, Vancouver, BC, Canada", types: ["bar", ...POI] };
    const det = { [WA.placeId]: { lat: 45.6262, lng: -122.6562, address: "1501 E Evergreen Blvd, Vancouver, WA 98661, USA" }, [BC.placeId]: { lat: 49.28, lng: -123.12, address: "Granville St, Vancouver, BC V6Z, Canada" } };
    const rB = await displayed(hB, [WA, BC], det, "R2b");
    notes.push(`波特蘭→延伸溫哥華（實為 WA）：rank=${setStr(ctxB.rankCountries)}；候選 WA 在前 → 工作樹顯示=${rB.shown === WA.placeId ? "WA(正確)" : rB.shown === BC.placeId ? "BC(錯)" : rB.shown} HEAD=${rB.headShown === WA.placeId ? "WA" : rB.headShown === BC.placeId ? "BC" : rB.headShown}`);
    record("R", "R2", "風險 2：延伸點排序只看延伸目的地（跨國延伸正確；城市表同名歧義時偏向表內國家）", rA.shown === FR.placeId ? "INFO" : "FAIL", notes.join("｜"));
  }
  // R3：「京都・大阪」組合字串
  {
    const notes = [];
    const JP = { placeId: "ChIJ_B18_R3_JP", label: "一蘭", secondary: "日本大阪府大阪市中央區道頓堀1丁目4−16", types: ["restaurant", ...POI] };
    const US = { placeId: "ChIJ_B18_R3_US", label: "一蘭", secondary: "132 W 31st St, New York, NY 10001, USA", types: ["restaurant", ...POI] };
    const det = { [JP.placeId]: { lat: 34.6687, lng: 135.5013, address: "日本〒542-0071 大阪府大阪市中央区道頓堀１丁目４−１６" }, [US.placeId]: { lat: 40.7484, lng: -73.9902, address: "132 W 31st St, New York, NY 10001, USA" } };
    for (const [k, h] of [
      ["saved city=京都・大阪", saved("一蘭", "京都・大阪")],
      ["itinerary 京都・大阪／日本", itin("一蘭", { city: "京都・大阪", country: "日本" })],
      ["saved city=京都、大阪", saved("一蘭", "京都、大阪")],
    ]) {
      const ctx = g.buildPlaceGeoContext(h);
      const r = await displayed(h, [US, JP], det, `R3/${k}`);
      notes.push(`${k}：rank=${setStr(ctx.rankCountries)} hard=${g.hasHardPlaceGeoContext(ctx)} cityTerms=${JSON.stringify(ctx.cityTerms)} 顯示=${r.shown === JP.placeId ? "日本" : r.shown === US.placeId ? "美國" : r.shown} HEAD=${r.headShown === JP.placeId ? "日本" : r.headShown === US.placeId ? "美國" : r.headShown}`);
    }
    record("R", "R3", "風險 3：組合字串 contextCity 只做文字加分（只有組合城市時無固定資料＝HEAD 行為；有 contextCountry 時排序正確）", "INFO", notes.join("｜"));
  }
  // R4：規則 A 邊界 — 美國城鎮名等於國名（Greece NY、Mexico NY、Italy TX、China ME、Turkey NC）
  {
    const rows = [];
    let regress = 0;
    for (const [town, st, lat, lng] of [["Greece", "NY", 43.2098, -77.6931], ["Mexico", "NY", 43.4595, -76.2288], ["Italy", "TX", 32.1840, -96.8847], ["China", "ME", 44.4787, -69.5170], ["Turkey", "NC", 34.9913, -78.1836], ["Scotland", "CT", 41.6987, -72.0812], ["Wales", "WI", 43.0047, -88.3759], ["Belgium", "WI", 43.4997, -87.8504]]) {
      const name = `${town} Public Library`;
      const h = { name, address: `${town}, ${st}`, lat: null, lng: null };
      const cand = { placeId: `ChIJ_B18_R4_${town}`, label: name, secondary: `Main St, ${town}, ${st}, USA`, types: POI };
      const det = { [cand.placeId]: { lat, lng, address: `1 Main St, ${town}, ${st} 00000, USA` } };
      const own = setStr(g.explicitCountriesInGeoText(h.address));
      const out = await displayed(h, [cand], det, `R4/${town}`);
      const lost = out.shown !== cand.placeId;
      if (lost && out.headShown === cand.placeId) regress += 1;
      // 候選 secondary 以城鎮開頭時（Autocomplete 常見格式）
      const cand2 = { ...cand, placeId: `${cand.placeId}_2`, secondary: `${town}, ${st}, USA` };
      const out2 = await displayed(h, [cand2], { [cand2.placeId]: { lat, lng, address: `${town}, ${st} 00000, USA` } }, `R4b/${town}`);
      rows.push(`「${town}, ${st}」own=${own}：候選「Main St, ${town}, ${st}, USA」→${lost ? (out.got ? "Details 拒絕" : "resolve 丟棄→null") : "顯示"}（HEAD 顯示）；候選「${town}, ${st}, USA」→${out2.shown === cand2.placeId ? "顯示" : out2.shown}`);
    }
    record("R", "R4", "規則 A 邊界：handoff 地址為「美國城鎮, 州」且城鎮名等於國名 → 正確地點被丟／拒（相對 HEAD 回歸，但符合規則 A 字面）", regress ? "INFO" : "PASS", `回歸 ${regress} 例｜${rows.join("；")}`);
  }
  // R5：其他規則 A 邊界（INFO）
  {
    const probe = (t) => `「${t}」→${setStr(g.explicitCountriesInGeoText(t))}`;
    const rows = [
      probe("Taipei City, Taiwan (ROC)"),
      probe("大韓民国 ソウル特別市中区"),
      probe("中華人民共和国 上海市"),
      probe("1 Hong Kong St, Singapore"),
      probe("Hong Kong SAR"),
      probe("Kowloon, Hong Kong SAR, China"),
      probe("中国台湾省台北市"),
      probe("日本大通1, 横浜市中区"),
      probe("スイス村, 長野県"),
      probe("美國學校路"),
      probe("Taiwan, Province of China"),
      probe("Georgia, USA"),
      probe("Jersey City, NJ, USA"),
      probe("Ireland Island, Bermuda"),
      probe("Plaza de España, 41013 Sevilla, España"),
      probe("Via Roma, 00100 Roma RM, Italia"),
    ];
    // EuroAirport：自身地址寫 Basel, Switzerland，Details 實際在法國 Saint-Louis
    const h = { name: "EuroAirport Basel Mulhouse Freiburg", address: "Basel, Switzerland", lat: null, lng: null };
    const c = { placeId: "ChIJ_B18_R5_BSL", label: "EuroAirport Basel Mulhouse Freiburg", secondary: "68300 Saint-Louis, France", types: ["airport", ...POI] };
    const out = await displayed(h, [c], { [c.placeId]: { lat: 47.59, lng: 7.5291, address: "68300 Saint-Louis, France" } }, "R5/BSL");
    rows.push(`EuroAirport（自身地址 Basel, Switzerland；實際在法國）→${out.shown === c.placeId ? "顯示" : out.got ? "Details 拒絕" : "resolve 丟棄"}（HEAD ${out.headShown === c.placeId ? "顯示" : out.headShown}）`);
    // 香港／澳門「SAR, China」寫法：自身地址寫 Hong Kong，Details／候選寫「Hong Kong SAR, China」
    for (const [nm, own, sar, lat, lng] of [
      ["Tian Tan Buddha", "Ngong Ping Rd, Lantau Island, Hong Kong", "Ngong Ping, Lantau Island, Hong Kong SAR, China", 22.254, 113.905],
      ["Ruins of St. Paul's", "Rua de São Paulo, Macau", "Rua de São Paulo, Macao SAR, China", 22.1975, 113.5409],
    ]) {
      const hh = { name: nm, address: own, lat: null, lng: null };
      const cc1 = { placeId: `ChIJ_B18_R5_${nm.length}`, label: nm, secondary: sar, types: POI };
      const o1 = await displayed(hh, [cc1], { [cc1.placeId]: { lat, lng, address: sar } }, `R5/${nm}`);
      const cc2 = { ...cc1, placeId: `${cc1.placeId}_B`, secondary: own };
      const o2 = await displayed(hh, [cc2], { [cc2.placeId]: { lat, lng, address: sar } }, `R5b/${nm}`);
      rows.push(`${nm}：自身「${own}」× 候選＋Details「${sar}」→${o1.shown === cc1.placeId ? "顯示" : o1.got ? "Details 拒絕" : "resolve 丟棄"}；候選同自身、Details「…SAR, China」→${o2.shown === cc2.placeId ? "顯示" : o2.shown}（HEAD 皆顯示）`);
    }
    record("R", "R5", "規則 A 其他邊界探針（INFO）", "INFO", rows.join("；"));
  }

  // ════════ C. 呼叫次數 ════════
  record("C", "C1", "每次 resolve 的 searchPlaces 次數 ≤ HEAD", countStats.over.length ? "FAIL" : "PASS", `${countStats.runs} 次對照${countStats.over.length ? `；超過：${countStats.over.slice(0, 10).join("；")}` : ""}`);
  record("C", "C2", "外部網路呼叫 = 0", externalCalls === 0 ? "PASS" : "FAIL", `${externalCalls}`);
} catch (e) {
  record("X", "crash", "腳本例外", "FAIL", String(e?.stack ?? e).slice(0, 800));
} finally {
  loud();
  const out = ["\n=== verify-place-geo-b18-sample ==="];
  for (const r of results) {
    out.push(`[${r.status}] ${r.sec}/${r.id} ${r.title}`);
    if (r.detail) out.push(`       ${r.detail}`);
  }
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL");
  const info = results.filter((r) => r.status === "INFO").length;
  out.push(`[INFO] 外部網路呼叫總數 = ${externalCalls}`);
  out.push(`摘要：PASS ${pass}／FAIL ${fail.length}／INFO ${info}${fail.length ? `；失敗：${fail.map((r) => `${r.sec}/${r.id}`).join(", ")}` : ""}`);
  process.stdout.write(`${out.join("\n")}\n`);
  if (fail.length || externalCalls) exitCode = 1;
  clearTimeout(watchdog);
  await server.close().catch(() => {});
  process.exit(exitCode);
}
