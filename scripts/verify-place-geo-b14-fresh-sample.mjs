#!/usr/bin/env node
/**
 * B14（tester 獨立抽樣）— 同名不同國家地點第 5 輪：全新點位（與既有腳本不重複）。
 *
 *  N1 熱門觀光地 50 點：
 *     a. countryCodeForCoordinates 不得判成他國（null 可接受）。
 *     b. 只有正確候選時，各 handoff 組合（自身座標／地址含國名／地址無國名／contextCity／
 *        contextCountry／city+country）最終顯示正確地點（不得被丟、不得被拒）。
 *     c. 同名他國候選排第一時，各組合最終不得顯示他國地點（resolve 未採用或 Details 拒絕）。
 *     d. 呼叫次數 ≤ HEAD（mock 一律回同一批候選，HEAD = 1 次）。
 *  N2 CROSS_BORDER_ZONES 以外的國界城鎮：
 *     a. 座標推國不得判成他國；b. 自身座標／地址 → 正確候選採用、Details 接受；
 *     c. 鄰國行程 context-only 跨國一日遊 → Details 接受；d. regionCode 不得送他國。
 *  N3 同國長距離延伸 10+ 點：context-only（城市＋國家）、自身座標、延伸行程點 → 不得丟／拒；
 *     他國同名在有硬訊號時須被擋。
 *  N4 雪梨塔／艾菲爾 vs 拉斯維加斯：每種 handoff 組合（含延伸點，表內／表外延伸目的地）。
 *  N5 風險探針：澳洲內陸（contextCountry only、Details 地址看不出國家）、S7/R3、
 *     CROSS_BORDER_ZONES 遺漏（離已知中心點近、他國 150 km 內無已知點的國界地點）。
 *
 * 執行：npx vite-node scripts/verify-place-geo-b14-fresh-sample.mjs --config scripts/vite.verify.config.mjs
 * 外部網路 0（fetch／http／net 全攔截），searchPlaces 以 mock 取代。
 */
import fs from "node:fs";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HEAD_SNAPSHOT =
  "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad/snap-HEAD";
const HARD_TIMEOUT_MS = 90_000;
const watchdog = setTimeout(() => {
  process.stdout.write(`\n[b14-sample] 超過 ${HARD_TIMEOUT_MS}ms，強制結束\n`);
  process.exit(2);
}, HARD_TIMEOUT_MS);
watchdog.unref?.();

let externalCalls = 0;
const trap = (kind, detail) => {
  externalCalls += 1;
  throw new Error(`[b14-sample] external ${kind} blocked ${String(detail).slice(0, 80)}`);
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
globalThis.__b14SearchPlaces = async (query, opts) => {
  searchLog.push({ query, center: opts?.center });
  return { suggestions: candidateProvider(query, opts) ?? [], error: null };
};

const results = [];
const record = (sec, id, title, status, detail = "") => results.push({ sec, id, title, status, detail });

const { createServer } = await import("vite");
const { ViteNodeServer } = await import("vite-node/server");
const { ViteNodeRunner } = await import("vite-node/client");
const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
const MOCK_ID = "\0b14-places-service";
const REAL_PLACES_SERVICE = `${WORK_ROOT}/src/services/placesService.ts?b14-real`;
const server = await createServer({
  root: WORK_ROOT,
  configFile: false,
  envDir: false,
  logLevel: "silent",
  clearScreen: false,
  plugins: [
    {
      name: "b14-mock-places-service",
      enforce: "pre",
      resolveId(id, importer) {
        if (id.includes("b14-real")) return null;
        if (/(^|\/)services\/placesService(\.ts)?$/.test(id)) return MOCK_ID;
        // B18：HEAD 快照內的 "@/..." 指向快照自己的 src（供 S04／P04 與 HEAD 對照）
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
          `export const searchPlaces = (...args) => globalThis.__b14SearchPlaces(...args);`,
        ].join("\n");
      },
    },
    tsconfigPaths(),
  ],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

const POI = ["tourist_attraction", "point_of_interest", "establishment"];
const origConsole = { info: console.info, log: console.log, warn: console.warn, debug: console.debug };
const quiet = () => {
  console.info = console.log = console.warn = console.debug = () => {};
};
const loud = () => Object.assign(console, origConsole);

// 同名他國候選（遠距）
const RIVALS = {
  US: { country: "US", secondary: "Las Vegas Blvd S, Las Vegas, NV, USA", short: "Las Vegas Blvd S, Las Vegas, NV", lat: 36.1147, lng: -115.1728 },
  JP: { country: "JP", secondary: "日本東京都港區台場", short: "港區台場", lat: 35.6272, lng: 139.7714 },
  MN: { country: "MN", secondary: "Chinggis Avenue, Ulaanbaatar, Mongolia", short: "Chinggis Avenue", lat: 47.9184, lng: 106.9177 },
};
const rivalFor = (country) => (["US", "CA", "MX"].includes(country) ? RIVALS.JP : RIVALS.US);

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
  const { resolveGooglePlaceIdForDetail } = await load("src/lib/place-detail-resolve.ts");
  const tripHandoff = await load("src/lib/trip/trip-itinerary-place-handoff.ts");
  const geoRegion = await load("src/lib/geo-region.ts");
  const cfg = await load("src/lib/places-search-config.ts");
  const cc = g.countryCodeForCoordinates;

  // B18：HEAD 版 resolve（無地理防護、無 Details 防線；顯示 = resolve 結果）
  let headResolve = null;
  {
    const headFile = `${HEAD_SNAPSHOT}/src/lib/place-detail-resolve.ts`;
    try {
      const src = fs.readFileSync(headFile, "utf8");
      if (src.includes("place-geo-guard")) throw new Error("snapshot 不是 HEAD（含 place-geo-guard）");
      headResolve = (await runner.executeFile(headFile)).resolveGooglePlaceIdForDetail;
    } catch (e) {
      record("N0", "HEAD-load", "載入 HEAD 版 place-detail-resolve", "FAIL", String(e?.message ?? e).slice(0, 160));
    }
  }

  // autocompleteRegionCode 以 TS AST 抽出（非 export）
  let regionCodeFor = null;
  {
    const ts = (await import("typescript")).default;
    const file = "src/lib/trip-stop-search.functions.ts";
    const source = fs.readFileSync(`${WORK_ROOT}/${file}`, "utf8");
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const node = tree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "autocompleteRegionCode");
    if (node) {
      const ctx = vm.createContext({
        PLACES_REGION: cfg.PLACES_REGION,
        isTaiwanCoordinates: geoRegion.isTaiwanCoordinates,
        countryCodeForCoordinates: g.countryCodeForCoordinates,
      });
      vm.runInContext(ts.transpileModule(node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
      regionCodeFor = ctx.autocompleteRegionCode;
    }
  }
  if (!regionCodeFor) record("N0", "R0", "autocompleteRegionCode 可抽出", "FAIL", "找不到函式");

  const runResolve = async (handoff, candidates, fn = resolveGooglePlaceIdForDetail) => {
    searchLog = [];
    candidateProvider = () => candidates;
    quiet();
    try {
      return { got: (await fn(handoff, "zh-TW")) ?? null, searches: searchLog.length };
    } finally {
      loud();
    }
  };

  /** 模擬 _app.place.tsx：resolve → Details → 地理防護；回傳最終顯示的 placeId（或 base／rejected）。 */
  const displayed = async (handoff, candidates, detailsById) => {
    const r = await runResolve({ placeId: `saved-${handoff.name}`, ...handoff }, candidates);
    if (!r.got) return { shown: "base", ...r };
    const needs = g.hasHardPlaceGeoContext(g.buildPlaceGeoContext(handoff));
    const det = detailsById[r.got];
    if (needs && !g.isResolvedPlaceGeoConsistent(handoff, det)) return { shown: "rejected", ...r };
    return { shown: r.got, ...r };
  };

  /**
   * 對一個真實地點跑所有 handoff 組合。
   * p = { id, name, lat, lng, country, countryText, addrFull, addrLocal, city, ext }
   */
  const comboHandoffs = (p) => {
    const off = { lat: p.lat + 0.004, lng: p.lng + 0.004 };
    const hs = [
      ["own-coords", { name: p.name, address: null, ...off }],
      ["own-coords+wrong-ctx", { name: p.name, address: null, ...off, contextCity: "台北" }],
      ["addr-country", { name: p.name, address: p.addrFull, lat: null, lng: null }],
      ["addr-local", { name: p.name, address: p.addrLocal, lat: null, lng: null }],
      ["addr+coords", { name: p.name, address: p.addrLocal, ...off }],
      ["ctx-country", { name: p.name, address: null, lat: null, lng: null, contextCountry: p.countryText }],
    ];
    if (p.city) {
      hs.push(["ctx-city", { name: p.name, address: null, lat: null, lng: null, contextCity: p.city }]);
      const item = { id: `it-${p.id}`, title: p.name, placeName: p.name, lat: null, lng: null, address: null, time: "10:00" };
      hs.push(["itinerary", tripHandoff.itineraryItemToPlaceHandoff(item, "zh-TW", { city: p.city, country: p.countryText })]);
    }
    return hs;
  };

  const checkPlace = async (sec, p, { rivalStrict = true } = {}) => {
    const correct = { placeId: `ChIJ_B14_${p.id}`, label: p.name, secondary: p.addrFull, types: POI };
    const correctLocal = { ...correct, placeId: `ChIJ_B14_${p.id}_L`, secondary: p.addrLocal };
    const rv = rivalFor(p.country);
    const rival = { placeId: `ChIJ_B14_${p.id}_RIVAL`, label: p.name, secondary: rv.secondary, types: POI };
    const rivalUnk = { ...rival, placeId: `ChIJ_B14_${p.id}_RIVALU`, secondary: rv.short };
    const details = {
      [correct.placeId]: { lat: p.lat, lng: p.lng, address: p.addrFull },
      [correctLocal.placeId]: { lat: p.lat, lng: p.lng, address: p.addrFull },
      [rival.placeId]: { lat: rv.lat, lng: rv.lng, address: rv.secondary },
      [rivalUnk.placeId]: { lat: rv.lat, lng: rv.lng, address: rv.secondary },
    };
    const lost = [];
    const leaked = [];
    const softLeaked = [];
    const calls = [];
    for (const [kind, h] of comboHandoffs(p)) {
      for (const cand of [correct, correctLocal]) {
        const d = await displayed(h, [cand], details);
        if (d.shown !== cand.placeId) lost.push(`${kind}/${cand === correct ? "sec含國名" : "sec無國名"}=${d.shown}`);
        if (d.searches > 1) calls.push(`${kind}:${d.searches}`);
      }
      // 沒有硬訊號（地址看不出國家、無座標、context 不在表內）＝ d1 舊行為，規則上不擋，只列 INFO。
      const hard = g.hasHardPlaceGeoContext(g.buildPlaceGeoContext(h));
      for (const [rname, rc] of [["rival", rival], ["rivalUnk", rivalUnk]]) {
        const d = await displayed(h, [rc, correct], details);
        if (d.shown === rc.placeId) (hard ? leaked : softLeaked).push(`${kind}/${rname}`);
        if (d.searches > 1) calls.push(`${kind}:${d.searches}`);
      }
    }
    record(sec, `${p.id}b`, `${p.label}：正確地點在各組合不被丟／拒`, lost.length ? "FAIL" : "PASS", lost.join("；") || "全部顯示正確地點");
    record(sec, `${p.id}c`, `${p.label}：同名他國（${rv.country}）在有硬訊號的組合最終不顯示`, leaked.length ? (rivalStrict ? "FAIL" : "INFO") : "PASS", `${leaked.join("；") || "全部擋下"}${softLeaked.length ? `｜無硬訊號（d1 舊行為，INFO）：${softLeaked.join("；")}` : ""}`);
    record(sec, `${p.id}d`, `${p.label}：searchPlaces 次數 ≤ HEAD(1)`, calls.length ? "FAIL" : "PASS", calls.join("；") || "皆 1 次");
  };

  // ════════ N1. 熱門觀光地 50 點 ════════
  // [id, 名稱, lat, lng, 國家碼, 國名文字, 完整地址（含國名）, 地址（無國名）, contextCity（可空）]
  const TOURIST = [
    ["T01", "東京晴空塔", 35.7101, 139.8107, "JP", "Japan", "日本東京都墨田區押上1-1-2", "墨田區押上1-1-2", "東京"],
    ["T02", "淺草寺", 35.7148, 139.7967, "JP", "Japan", "日本東京都台東區淺草2-3-1", "台東區淺草2-3-1", "東京"],
    ["T03", "伏見稻荷大社", 34.9671, 135.7727, "JP", "Japan", "日本京都府京都市伏見區深草藪之內町68", "伏見區深草藪之內町68", "京都"],
    ["T04", "金閣寺", 35.0394, 135.7292, "JP", "Japan", "日本京都府京都市北區金閣寺町1", "北區金閣寺町1", "京都"],
    ["T05", "黑門市場", 34.6655, 135.5063, "JP", "Japan", "日本大阪府大阪市中央區日本橋2-4-1", "中央區日本橋2-4-1", "大阪"],
    ["T06", "奈良公園", 34.685, 135.843, "JP", "Japan", "日本奈良縣奈良市雜司町469", "雜司町469", "奈良"],
    ["T07", "白色戀人公園", 43.0889, 141.2717, "JP", "Japan", "日本北海道札幌市西區宮之澤2條2-11-36", "西區宮之澤2條2-11-36", "札幌"],
    ["T08", "沖繩美麗海水族館", 26.6943, 127.8779, "JP", "Japan", "日本沖繩縣國頭郡本部町石川424", "國頭郡本部町石川424", "沖繩"],
    ["T09", "橫濱中華街", 35.4437, 139.6466, "JP", "Japan", "日本神奈川縣橫濱市中區山下町", "中區山下町", "橫濱"],
    ["T10", "景福宮", 37.5796, 126.977, "KR", "South Korea", "대한민국 서울특별시 종로구 사직로 161", "종로구 사직로 161", "首爾"],
    ["T11", "明洞", 37.5636, 126.9869, "KR", "South Korea", "대한민국 서울특별시 중구 명동", "중구 명동", "首爾"],
    ["T12", "海雲台海水浴場", 35.1587, 129.1604, "KR", "South Korea", "대한민국 부산광역시 해운대구 우동", "해운대구 우동", "釜山"],
    ["T13", "甘川文化村", 35.0975, 129.0106, "KR", "South Korea", "대한민국 부산광역시 사하구 감내2로 203", "사하구 감내2로 203", "釜山"],
    ["T14", "城山日出峰", 33.4581, 126.9425, "KR", "South Korea", "대한민국 제주특별자치도 서귀포시 성산읍", "서귀포시 성산읍", "濟州"],
    ["T15", "中正紀念堂", 25.0346, 121.5218, "TW", "台灣", "100台灣台北市中正區中山南路21號", "中正區中山南路21號", "台北"],
    ["T16", "西門町", 25.0422, 121.5079, "TW", "台灣", "108台灣台北市萬華區漢中街", "萬華區漢中街", "台北"],
    ["T17", "駁二藝術特區", 22.6203, 120.2817, "TW", "台灣", "803台灣高雄市鹽埕區大勇路1號", "鹽埕區大勇路1號", "高雄"],
    ["T18", "赤崁樓", 22.9975, 120.2025, "TW", "台灣", "700台灣台南市中西區民族路二段212號", "中西區民族路二段212號", "台南"],
    ["T19", "清境農場", 24.0578, 121.1622, "TW", "台灣", "546台灣南投縣仁愛鄉大同村仁和路170號", "仁愛鄉大同村仁和路170號", "南投"],
    ["T20", "外灘", 31.24, 121.49, "CN", "China", "中國上海市黃浦區中山東一路", "黃浦區中山東一路", "上海"],
    ["T21", "故宮博物院", 39.9163, 116.3972, "CN", "China", "中國北京市東城區景山前街4號", "東城區景山前街4號", "北京"],
    ["T22", "太平山頂", 22.2759, 114.1455, "HK", "Hong Kong", "香港山頂道128號", "山頂道128號", null],
    ["T23", "大皇宮", 13.75, 100.4913, "TH", "Thailand", "Na Phra Lan Rd, Phra Nakhon, Bangkok 10200, Thailand", "Na Phra Lan Rd, Phra Nakhon, Bangkok 10200", "曼谷"],
    ["T24", "素帖寺", 18.8049, 98.9216, "TH", "Thailand", "Suthep, Mueang Chiang Mai District, Chiang Mai 50200, Thailand", "Suthep, Mueang Chiang Mai District, Chiang Mai 50200", "清邁"],
    ["T25", "還劍湖", 21.0288, 105.8525, "VN", "Vietnam", "Hàng Trống, Hoàn Kiếm, Hà Nội, Vietnam", "Hàng Trống, Hoàn Kiếm", "河內"],
    ["T26", "濱城市場", 10.772, 106.698, "VN", "Vietnam", "Lê Lợi, Bến Thành, Quận 1, Hồ Chí Minh, Vietnam", "Lê Lợi, Bến Thành, Quận 1", "胡志明"],
    ["T27", "濱海灣花園", 1.2816, 103.8636, "SG", "Singapore", "18 Marina Gardens Dr, Singapore 018953", "18 Marina Gardens Dr", null],
    ["T28", "雙子塔", 3.1579, 101.7116, "MY", "Malaysia", "Kuala Lumpur City Centre, 50088 Kuala Lumpur, Malaysia", "Kuala Lumpur City Centre, 50088", "吉隆坡"],
    ["T29", "海神廟", -8.6212, 115.0868, "ID", "Indonesia", "Beraban, Kediri, Tabanan Regency, Bali, Indonesia", "Beraban, Kediri, Tabanan Regency", "峇里"],
    ["T30", "馬尼拉王城", 14.5906, 120.975, "PH", "Philippines", "Intramuros, Manila, Metro Manila, Philippines", "Intramuros", "馬尼拉"],
    ["T31", "雪梨歌劇院", -33.8568, 151.2153, "AU", "Australia", "Bennelong Point, Sydney NSW 2000, Australia", "Bennelong Point, Sydney NSW 2000", "雪梨"],
    ["T32", "聯邦廣場", -37.818, 144.9691, "AU", "Australia", "Swanston St & Flinders St, Melbourne VIC 3000, Australia", "Swanston St & Flinders St, Melbourne VIC 3000", "墨爾本"],
    ["T33", "衝浪者天堂", -28.0023, 153.431, "AU", "Australia", "Surfers Paradise QLD 4217, Australia", "Surfers Paradise QLD 4217", null],
    ["T34", "米佛峽灣", -44.6414, 167.8974, "NZ", "New Zealand", "Milford Sound 9679, New Zealand", "Milford Sound 9679", null],
    ["T35", "自由女神像", 40.6892, -74.0445, "US", "USA", "New York, NY 10004, USA", "Liberty Island, NY 10004", "紐約"],
    ["T36", "時代廣場", 40.758, -73.9855, "US", "USA", "Manhattan, NY 10036, USA", "Manhattan, NY 10036", "紐約"],
    ["T37", "金門大橋", 37.8199, -122.4783, "US", "USA", "Golden Gate Bridge, San Francisco, CA, USA", "Golden Gate Bridge, San Francisco, CA", "舊金山"],
    ["T38", "好萊塢標誌", 34.1341, -118.3215, "US", "USA", "Los Angeles, CA 90068, USA", "Mt Lee Dr, CA 90068", "洛杉磯"],
    ["T39", "百樂宮噴泉", 36.1126, -115.1767, "US", "USA", "3600 S Las Vegas Blvd, Las Vegas, NV 89109, USA", "3600 S Las Vegas Blvd, Las Vegas, NV 89109", null],
    ["T40", "CN塔", 43.6426, -79.3871, "CA", "Canada", "290 Bremner Blvd, Toronto, ON M5V 3L9, Canada", "290 Bremner Blvd, Toronto, ON M5V 3L9", "多倫多"],
    ["T41", "大笨鐘", 51.5007, -0.1246, "GB", "United Kingdom", "London SW1A 0AA, United Kingdom", "Westminster, London SW1A 0AA", "倫敦"],
    ["T42", "倫敦塔橋", 51.5055, -0.0754, "GB", "United Kingdom", "Tower Bridge Rd, London SE1 2UP, United Kingdom", "Tower Bridge Rd, London SE1 2UP", "倫敦"],
    ["T43", "羅浮宮", 48.8606, 2.3376, "FR", "France", "Rue de Rivoli, 75001 Paris, France", "Rue de Rivoli, 75001 Paris", "巴黎"],
    ["T44", "凱旋門", 48.8738, 2.295, "FR", "France", "Place Charles de Gaulle, 75008 Paris, France", "Place Charles de Gaulle, 75008 Paris", "巴黎"],
    ["T45", "羅馬競技場", 41.8902, 12.4922, "IT", "Italy", "Piazza del Colosseo, 1, 00184 Roma RM, Italy", "Piazza del Colosseo, 1, 00184 Roma RM", "羅馬"],
    ["T46", "聖馬可廣場", 45.4341, 12.3388, "IT", "Italy", "Piazza San Marco, 30100 Venezia VE, Italy", "Piazza San Marco, 30100 Venezia VE", "威尼斯"],
    ["T47", "阿爾罕布拉宮", 37.176, -3.5881, "ES", "Spain", "Calle Real de la Alhambra, 18009 Granada, Spain", "Calle Real de la Alhambra, 18009 Granada", null],
    ["T48", "聖索菲亞大教堂", 41.0086, 28.9802, "TR", "Turkey", "Sultan Ahmet, Ayasofya Meydanı No:1, 34122 Fatih/İstanbul, Türkiye", "Ayasofya Meydanı No:1, 34122 Fatih/İstanbul", "伊斯坦堡"],
    ["T49", "查理大橋旁 布拉格城堡", 50.0911, 14.4016, "CZ", "Czechia", "Hradčany, 119 08 Praha 1, Czechia", "Hradčany, 119 08 Praha 1", "布拉格"],
    ["T50", "聖家堂旁 奎爾公園", 41.4145, 2.1527, "ES", "Spain", "Gràcia, 08024 Barcelona, Spain", "Gràcia, 08024 Barcelona", "巴塞隆納"],
  ];
  const toPlace = ([id, name, lat, lng, country, countryText, addrFull, addrLocal, city]) => ({
    id, name, lat, lng, country, countryText, addrFull, addrLocal, city, label: `${id} ${name}`,
  });
  const ccWrong = [];
  const ccNull = [];
  for (const t of TOURIST) {
    const p = toPlace(t);
    const got = cc(p.lat, p.lng);
    if (got && got !== p.country) ccWrong.push(`${p.label} 應 ${p.country} 得 ${got}`);
    else if (!got) ccNull.push(p.label);
  }
  record("N1", "a", `熱門觀光地 ${TOURIST.length} 點：座標推國判成他國 = 0`, ccWrong.length ? "FAIL" : "PASS", ccWrong.join("；") || "無");
  record("N1", "a-null", "熱門觀光地座標推國 null（可接受）", "INFO", `${ccNull.length}：${ccNull.join("；") || "無"}`);
  for (const t of TOURIST) await checkPlace("N1", toPlace(t));

  // ════════ N2. CROSS_BORDER_ZONES 以外的國界城鎮 ════════
  // [id, 名稱, lat, lng, 國家, 國名文字, 完整地址, 無國名地址, 鄰國行程城市（表內，供跨國一日遊）]
  const BORDER = [
    ["B01", "Tourcoing（法，近比利時）", 50.7239, 3.1612, "FR", "France", "59200 Tourcoing, France", "59200 Tourcoing", "布魯塞爾"],
    ["B02", "Venlo（荷，近德國）", 51.3704, 6.1724, "NL", "Netherlands", "Venlo, Netherlands", "5911 Venlo", "科隆"],
    ["B03", "Gmünd（奧，近捷克）", 48.7667, 14.9833, "AT", "Austria", "3950 Gmünd, Austria", "3950 Gmünd", "布拉格"],
    ["B04", "České Velenice（捷，近奧地利）", 48.77, 14.9636, "CZ", "Czechia", "378 10 České Velenice, Czechia", "378 10 České Velenice", "維也納"],
    ["B05", "廊開 Nong Khai（泰，近寮國）", 17.8783, 102.742, "TH", "Thailand", "Nong Khai 43000, Thailand", "Mueang Nong Khai District 43000", null],
    ["B06", "東興（中，近越南）", 21.5478, 107.9719, "CN", "China", "中國廣西壯族自治區防城港市東興市", "防城港市東興市", "河內"],
    ["B07", "芒街 Móng Cái（越，近中國）", 21.5245, 107.9667, "VN", "Vietnam", "Móng Cái, Quảng Ninh, Vietnam", "Móng Cái, Quảng Ninh", null],
    // 多倫多→Sault Ste. Marie 約 500 km，超過 400 km 上限，不屬一日遊；不測跨國 context。
    ["B08", "Sault Ste. Marie（美，MI）", 46.4953, -84.3453, "US", "USA", "Sault Ste. Marie, MI 49783, USA", "Sault Ste. Marie, MI 49783", null],
    ["B09", "Sault Ste. Marie（加，ON）", 46.5219, -84.3461, "CA", "Canada", "Sault Ste. Marie, ON, Canada", "Sault Ste. Marie, ON P6A", null],
    ["B10", "Irun（西，近法國）", 43.339, -1.7896, "ES", "Spain", "20301 Irun, Gipuzkoa, Spain", "20301 Irun, Gipuzkoa", "波爾多"],
    ["B11", "Hendaye（法，近西班牙）", 43.3586, -1.7745, "FR", "France", "64700 Hendaye, France", "64700 Hendaye", null],
    ["B12", "Buffalo（美，近加拿大）", 42.8864, -78.8784, "US", "USA", "Buffalo, NY, USA", "Buffalo, NY 14202", "多倫多"],
    // 紐約→Fort Erie 約 470 km（> 400 km），不屬一日遊；不測跨國 context。
    ["B13", "Fort Erie（加，近美國）", 42.9018, -78.9722, "CA", "Canada", "Fort Erie, ON, Canada", "Fort Erie, ON L2A", null],
    ["B14", "Hainburg an der Donau（奧，近斯洛伐克）", 48.1472, 16.9417, "AT", "Austria", "2410 Hainburg an der Donau, Austria", "2410 Hainburg an der Donau", null],
    ["B15", "Baarle-Nassau（荷，比荷交錯）", 51.4396, 4.9306, "NL", "Netherlands", "5111 Baarle-Nassau, Netherlands", "5111 Baarle-Nassau", null],
    ["B16", "Enschede（荷，近德國）", 52.2215, 6.8937, "NL", "Netherlands", "Enschede, Netherlands", "7511 Enschede", null],
    ["B17", "Görlitz（德，近波蘭）", 51.1528, 14.9872, "DE", "Germany", "02826 Görlitz, Germany", "02826 Görlitz", "布拉格"],
    ["B18", "Mittenwald（德，近奧地利）", 47.4425, 11.2614, "DE", "Germany", "82481 Mittenwald, Germany", "82481 Mittenwald", null],
    ["B19", "Porlezza（義，近盧加諾）", 46.0375, 9.1286, "IT", "Italy", "22018 Porlezza CO, Italy", "22018 Porlezza CO", null],
    ["B20", "Tecate（墨，近美國）", 32.5767, -116.6275, "MX", "Mexico", "Tecate, B.C., Mexico", "Tecate, B.C.", "洛杉磯"],
  ];
  {
    const wrong = [];
    const nulls = [];
    const regionWrong = [];
    for (const b of BORDER) {
      const p = toPlace(b);
      const got = cc(p.lat, p.lng);
      if (got && got !== p.country) wrong.push(`${p.label} 應 ${p.country} 得 ${got}`);
      else if (!got) nulls.push(p.label);
      if (regionCodeFor) {
        const rc = regionCodeFor(p.lat, p.lng);
        if (rc && rc !== p.country) regionWrong.push(`${p.label} 送 ${rc}`);
      }
    }
    record("N2", "a", `國界城鎮 ${BORDER.length} 點（非 CROSS_BORDER_ZONES）：座標推國判成他國 = 0`, wrong.length ? "FAIL" : "PASS", wrong.join("；") || "無");
    record("N2", "a-null", "國界城鎮座標推國 null（可接受）", "INFO", `${nulls.length}/${BORDER.length}：${nulls.join("；")}`);
    record("N2", "d", "國界城鎮 Autocomplete regionCode 不送他國", regionWrong.length ? "FAIL" : "PASS", regionWrong.join("；") || "無（皆送正確國家或不送）");
    for (const b of BORDER) {
      // contextCity 欄位在這段改用「本國」行程城市（N2c 另測鄰國行程），因此 city 置空，避免把鄰國城市當本國。
      const p = { ...toPlace(b), city: null };
      await checkPlace("N2", p);
    }
    // c. 鄰國行程的跨國一日遊（context-only）：Details 必須接受
    const crossRejected = [];
    for (const b of BORDER) {
      const p = toPlace(b);
      if (!p.city) continue;
      const item = { id: `it-${p.id}`, title: p.name, placeName: p.name, lat: null, lng: null, address: null, time: "10:00" };
      const nbCountry = { 布魯塞爾: "Belgium", 科隆: "Germany", 布拉格: "Czechia", 維也納: "Austria", 河內: "Vietnam", 多倫多: "Canada", 波爾多: "France", 紐約: "USA", 洛杉磯: "USA" }[p.city];
      const h = tripHandoff.itineraryItemToPlaceHandoff(item, "zh-TW", { city: p.city, country: nbCountry });
      const ok = g.isResolvedPlaceGeoConsistent(h, { lat: p.lat, lng: p.lng, address: p.addrFull });
      const okNoCountry = g.isResolvedPlaceGeoConsistent(h, { lat: p.lat, lng: p.lng, address: p.addrLocal });
      const km = Math.round(g.RESOLVED_CONTEXT_CITY_MAX_DISTANCE_KM);
      if (!ok) crossRejected.push(`${p.label}（${p.city} 行程，地址含國名）`);
      record("N2", `${p.id}x`, `${p.label}：${p.city}（${nbCountry}）行程 context-only 跨國一日遊 → Details 接受`, ok ? "PASS" : "FAIL", `含國名=${ok} 無國名=${okNoCountry}（上限 ${km} km）`);
    }
  }

  // ════════ N3. 同國長距離延伸 ════════
  // [id, 名稱, 行程城市（表內）, 國名, lat, lng, 完整地址, 無國名地址, 延伸目的地名]
  const EXT = [
    ["E01", "富士急樂園", "東京", "Japan", 35.4869, 138.78, "日本山梨縣富士吉田市新西原5-6-1", "富士吉田市新西原5-6-1", "富士吉田"],
    ["E02", "草津溫泉 湯畑", "東京", "Japan", 36.6229, 138.5961, "日本群馬縣吾妻郡草津町草津", "吾妻郡草津町草津", "草津"],
    ["E03", "姬路城", "大阪", "Japan", 34.8394, 134.6939, "日本兵庫縣姬路市本町68", "姬路市本町68", "姬路"],
    ["E04", "高野山 金剛峯寺", "大阪", "Japan", 34.213, 135.5856, "日本和歌山縣伊都郡高野町高野山132", "伊都郡高野町高野山132", "高野山"],
    ["E05", "由布院 金鱗湖", "福岡", "Japan", 33.2655, 131.3555, "日本大分縣由布市湯布院町川上", "由布市湯布院町川上", "由布院"],
    ["E06", "旭山動物園", "札幌", "Japan", 43.7684, 142.4794, "日本北海道旭川市東旭川町倉沼", "旭川市東旭川町倉沼", "旭川"],
    ["E07", "澳洲戰爭紀念館", "雪梨", "Australia", -35.2809, 149.1486, "Treloar Cres, Campbell ACT 2612, Australia", "Treloar Cres, Campbell ACT 2612", "坎培拉"],
    ["E08", "十二使徒岩", "墨爾本", "Australia", -38.6621, 143.1051, "Great Ocean Rd, Port Campbell VIC 3269, Australia", "Great Ocean Rd, Port Campbell VIC 3269", "大洋路"],
    ["E09", "安木海邊", "首爾", "South Korea", 37.772, 128.9478, "대한민국 강원특별자치도 강릉시 견소동", "강릉시 견소동", "江陵"],
    ["E10", "考艾國家公園", "曼谷", "Thailand", 14.4392, 101.372, "Pak Chong District, Nakhon Ratchasima 30130, Thailand", "Pak Chong District, Nakhon Ratchasima 30130", "考艾"],
    ["E11", "聖米歇爾山", "巴黎", "France", 48.6361, -1.5115, "50170 Le Mont-Saint-Michel, France", "50170 Le Mont-Saint-Michel", "聖米歇爾山"],
    ["E12", "伍德伯里 Outlets", "紐約", "USA", 41.315, -74.126, "498 Red Apple Ct, Central Valley, NY 10917, USA", "498 Red Apple Ct, Central Valley, NY 10917", "Woodbury"],
  ];
  const countryOf = { Japan: "JP", Australia: "AU", "South Korea": "KR", Thailand: "TH", France: "FR", USA: "US" };
  for (const [id, name, city, countryText, lat, lng, addrFull, addrLocal, extName] of EXT) {
    const country = countryOf[countryText];
    const correct = { placeId: `ChIJ_B14_${id}`, label: name, secondary: addrFull, types: POI };
    const rv = rivalFor(country);
    const rival = { placeId: `ChIJ_B14_${id}_RIVAL`, label: name, secondary: rv.secondary, types: POI };
    const details = {
      [correct.placeId]: { lat, lng, address: addrFull },
      [rival.placeId]: { lat: rv.lat, lng: rv.lng, address: rv.secondary },
    };
    const item = { id: `it-${id}`, title: name, placeName: name, lat: null, lng: null, address: null, time: "10:00" };
    const combos = [
      ["行程點 city+country", tripHandoff.itineraryItemToPlaceHandoff(item, "zh-TW", { city, country: countryText }), true],
      ["收藏 city", { name, address: null, lat: null, lng: null, contextCity: city }, true],
      ["自身座標", { name, address: null, lat: lat + 0.01, lng: lng + 0.01, contextCity: city }, true],
      ["延伸點（表外延伸目的地）", tripHandoff.itineraryItemToPlaceHandoff({ ...item, destinationScope: "nearby_extension", extensionDestination: extName }, "zh-TW", { city, country: countryText }), false],
    ];
    const lost = [];
    const leaked = [];
    for (const [kind, h, hard] of combos) {
      const d1 = await displayed(h, [correct], details);
      if (d1.shown !== correct.placeId) lost.push(`${kind}=${d1.shown}`);
      const d2 = await displayed(h, [rival, correct], details);
      if (d2.shown === rival.placeId) leaked.push(`${kind}${hard ? "" : "（無硬訊號）"}`);
      // 無國名地址的 Details（例如短地址）
      const ctxOnly = !h.lat && !h.address;
      if (ctxOnly && g.hasHardPlaceGeoContext(g.buildPlaceGeoContext(h))) {
        const okLocal = g.isResolvedPlaceGeoConsistent(h, { lat, lng, address: addrLocal });
        if (!okLocal) lost.push(`${kind}（Details 地址無國名）=rejected`);
      }
    }
    record("N3", `${id}b`, `${city} → ${name}（${extName}）：正確地點不被丟／拒`, lost.length ? "FAIL" : "PASS", lost.join("；") || "全部顯示正確地點");
    const hardLeaks = leaked.filter((x) => !x.includes("無硬訊號"));
    record("N3", `${id}c`, `${city} → ${name}：同名他國（${rv.country}）有硬訊號時不顯示`, hardLeaks.length ? "FAIL" : "PASS", leaked.join("；") || "全部擋下");
  }

  // ════════ N4. 雪梨塔／艾菲爾 vs 拉斯維加斯：handoff 組合矩陣 ════════
  {
    const SYD = { placeId: "ChIJ_B14_SYD_TOWER", label: "Sydney Tower Eye", secondary: "Market St, Sydney NSW 2000, Australia", types: POI };
    const SYD_EXACT = { ...SYD, placeId: "ChIJ_B14_SYD_TOWER_X", label: "Sydney Tower" };
    const UB = { placeId: "ChIJ_B14_UB_TOWER", label: "Sydney Tower", secondary: "Chinggis Avenue, Ulaanbaatar, Mongolia", types: POI };
    const UB_UNK = { ...UB, placeId: "ChIJ_B14_UB_TOWER_U", secondary: "Chinggis Avenue" };
    const PA = { placeId: "ChIJ_B14_PA_EIFFEL", label: "Tour Eiffel", secondary: "Av. Gustave Eiffel, 75007 Paris, France", types: POI };
    const PA_EXACT = { ...PA, placeId: "ChIJ_B14_PA_EIFFEL_X", label: "Eiffel Tower" };
    const LV = { placeId: "ChIJ_B14_LV_EIFFEL", label: "Eiffel Tower", secondary: "3655 Las Vegas Blvd S, Las Vegas, NV 89109, USA", types: POI };
    const LV_UNK = { ...LV, placeId: "ChIJ_B14_LV_EIFFEL_U", secondary: "3655 Las Vegas Blvd S" };
    const det = {
      [SYD.placeId]: { lat: -33.8705, lng: 151.2089, address: "100 Market St, Sydney NSW 2000, Australia" },
      [SYD_EXACT.placeId]: { lat: -33.8705, lng: 151.2089, address: "100 Market St, Sydney NSW 2000, Australia" },
      [UB.placeId]: { lat: 47.9184, lng: 106.9177, address: "Chinggis Avenue, Ulaanbaatar, Mongolia" },
      [UB_UNK.placeId]: { lat: 47.9184, lng: 106.9177, address: "Chinggis Avenue, Ulaanbaatar, Mongolia" },
      [PA.placeId]: { lat: 48.8584, lng: 2.2945, address: "Av. Gustave Eiffel, 75007 Paris, France" },
      [PA_EXACT.placeId]: { lat: 48.8584, lng: 2.2945, address: "Av. Gustave Eiffel, 75007 Paris, France" },
      [LV.placeId]: { lat: 36.1125, lng: -115.1728, address: "3655 Las Vegas Blvd S, Las Vegas, NV 89109, USA" },
      [LV_UNK.placeId]: { lat: 36.1125, lng: -115.1728, address: "3655 Las Vegas Blvd S, Las Vegas, NV 89109, USA" },
    };
    const item = (name) => ({ id: `it-${name}`, title: name, placeName: name, lat: null, lng: null, address: null, time: "10:00" });
    const cases = [
      // [id, 標題, handoff, 候選組, 他國 placeIds]
      ["S01", "雪梨塔｜自身座標（雪梨）", { name: "Sydney Tower", address: null, lat: -33.8705, lng: 151.2089 }],
      ["S02", "雪梨塔｜自身座標（藍山，推國 null）", { name: "Sydney Tower", address: null, lat: -33.712, lng: 150.311 }],
      ["S03", "雪梨塔｜只有地址（含 Australia）", { name: "Sydney Tower", address: "100 Market St, Sydney NSW 2000, Australia", lat: null, lng: null }],
      ["S04", "雪梨塔｜只有地址（無國名，含 Sydney）", { name: "Sydney Tower", address: "100 Market St, Sydney", lat: null, lng: null }],
      ["S05", "雪梨塔｜只有 contextCity=雪梨（收藏）", { name: "Sydney Tower", address: null, lat: null, lng: null, contextCity: "雪梨" }],
      ["S06", "雪梨塔｜只有 contextCountry=Australia", { name: "Sydney Tower", address: null, lat: null, lng: null, contextCountry: "Australia" }],
      ["S07", "雪梨塔｜只有 contextCountry=AU", { name: "Sydney Tower", address: null, lat: null, lng: null, contextCountry: "AU" }],
      ["S08", "雪梨塔｜行程點 Sydney／Australia", tripHandoff.itineraryItemToPlaceHandoff(item("Sydney Tower"), "zh-TW", { city: "Sydney", country: "Australia" })],
      ["S09", "雪梨塔｜延伸點（墨爾本行程 → 延伸目的地「雪梨」，表內）", tripHandoff.itineraryItemToPlaceHandoff({ ...item("Sydney Tower"), destinationScope: "nearby_extension", extensionDestination: "雪梨" }, "zh-TW", { city: "墨爾本", country: "Australia" })],
      ["S10", "雪梨塔｜延伸點（延伸目的地「Sydney CBD」，表外）", tripHandoff.itineraryItemToPlaceHandoff({ ...item("Sydney Tower"), destinationScope: "nearby_extension", extensionDestination: "Sydney CBD" }, "zh-TW", { city: "墨爾本", country: "Australia" })],
      ["S11", "雪梨塔｜延伸點（延伸目的地「藍山」，表外）", tripHandoff.itineraryItemToPlaceHandoff({ ...item("Sydney Tower"), destinationScope: "nearby_extension", extensionDestination: "藍山" }, "zh-TW", { city: "雪梨", country: "Australia" })],
      ["P01", "艾菲爾｜自身座標（巴黎）", { name: "Eiffel Tower", address: null, lat: 48.8584, lng: 2.2945 }],
      ["P02", "艾菲爾｜自身座標（凡爾賽，推國?）", { name: "Eiffel Tower", address: null, lat: 48.8049, lng: 2.1204 }],
      ["P03", "艾菲爾｜只有地址（含 France）", { name: "Eiffel Tower", address: "Champ de Mars, 75007 Paris, France", lat: null, lng: null }],
      ["P04", "艾菲爾｜只有地址（無國名，含 Paris）", { name: "Eiffel Tower", address: "Champ de Mars, 75007 Paris", lat: null, lng: null }],
      ["P05", "艾菲爾｜只有 contextCity=巴黎", { name: "Eiffel Tower", address: null, lat: null, lng: null, contextCity: "巴黎" }],
      ["P06", "艾菲爾｜只有 contextCountry=France", { name: "Eiffel Tower", address: null, lat: null, lng: null, contextCountry: "France" }],
      ["P07", "艾菲爾｜只有 contextCountry=法國", { name: "Eiffel Tower", address: null, lat: null, lng: null, contextCountry: "法國" }],
      ["P08", "艾菲爾｜行程點 巴黎／France", tripHandoff.itineraryItemToPlaceHandoff(item("Eiffel Tower"), "zh-TW", { city: "巴黎", country: "France" })],
      ["P09", "艾菲爾｜延伸點（倫敦行程 → 延伸目的地「巴黎」，表內）", tripHandoff.itineraryItemToPlaceHandoff({ ...item("Eiffel Tower"), destinationScope: "nearby_extension", extensionDestination: "巴黎" }, "zh-TW", { city: "倫敦", country: "United Kingdom" })],
      ["P10", "艾菲爾｜延伸點（延伸目的地「Paris 7e」，表外）", tripHandoff.itineraryItemToPlaceHandoff({ ...item("Eiffel Tower"), destinationScope: "nearby_extension", extensionDestination: "Paris 7e" }, "zh-TW", { city: "倫敦", country: "United Kingdom" })],
    ];
    for (const [id, title, h] of cases) {
      const isSyd = id.startsWith("S");
      const sets = isSyd
        ? [["他國完全同名排第一", [UB, SYD]], ["他國候選看不出國家", [UB_UNK, SYD]], ["雙方完全同名", [UB, SYD_EXACT]], ["只有他國", [UB]]]
        : [["他國完全同名排第一", [LV, PA]], ["他國候選看不出國家", [LV_UNK, PA]], ["雙方完全同名", [LV, PA_EXACT]], ["只有他國", [LV]]];
      const foreign = new Set(isSyd ? [UB.placeId, UB_UNK.placeId] : [LV.placeId, LV_UNK.placeId]);
      const correctIds = new Set(isSyd ? [SYD.placeId, SYD_EXACT.placeId] : [PA.placeId, PA_EXACT.placeId]);
      const leaks = [];
      const notes = [];
      // B18 指派者裁定：地址無國名、無 context、無座標（S04／P04）→ 無固定資料，與 HEAD 相同（不擋）。
      const sameAsHead = id === "S04" || id === "P04";
      const headDiffs = [];
      for (const [sname, cands] of sets) {
        const d = await displayed(h, cands, det);
        if (sameAsHead) {
          const hr = headResolve
            ? ((await runResolve.call(null, { placeId: `saved-${h.name}`, ...h }, cands, headResolve)).got ?? "base")
            : "HEAD 未載入";
          if (hr !== d.shown) headDiffs.push(`${sname}：工作樹=${d.shown} HEAD=${hr}`);
        } else if (foreign.has(d.shown)) leaks.push(`${sname}→顯示他國`);
        notes.push(`${sname}:${correctIds.has(d.shown) ? "正確" : d.shown === "rejected" ? "擋下(base)" : d.shown === "base" ? "base" : foreign.has(d.shown) ? "他國(同 HEAD)" : d.shown}`);
      }
      const hard = g.hasHardPlaceGeoContext(g.buildPlaceGeoContext(h));
      if (sameAsHead) {
        record("N4", id, `${title}：無固定資料 → 最終顯示與 HEAD 相同（B18 裁定）`, headDiffs.length || hard ? "FAIL" : "PASS", `${notes.join("｜")} 硬訊號=${hard}${headDiffs.length ? ` 與 HEAD 不同：${headDiffs.join("；")}` : ""}`);
        continue;
      }
      record("N4", id, `${title}：最終不顯示他國地點`, leaks.length ? "FAIL" : "PASS", `${notes.join("｜")} 硬訊號=${hard} ctxCity=${h.contextCity ?? "-"} ctxCountry=${h.contextCountry ?? "-"}${leaks.length ? ` 洩漏：${leaks.join("；")}` : ""}`);
    }
  }

  // ════════ N5. 風險探針 ════════
  {
    // (1) 澳洲內陸，只有 contextCountry，Details 地址看不出國家
    const inland = [
      ["烏魯魯（en 地址含國名）", -25.3444, 131.0369, "Uluru NT 0872, Australia"],
      ["烏魯魯（en 短地址，無國名）", -25.3444, 131.0369, "Uluru NT 0872"],
      ["烏魯魯（ko formattedAddress：오스트레일리아）", -25.3444, 131.0369, "오스트레일리아 노던 준주 율라라"],
      ["愛麗絲泉（ko）", -23.698, 133.8807, "오스트레일리아 노던 준주 앨리스스프링스"],
      ["布魯姆（en 無國名）", -17.9614, 122.2359, "Broome WA 6725"],
      ["凱瑟琳峽谷（ja 含國名）", -14.3086, 132.4256, "オーストラリア ノーザンテリトリー キャサリン"],
    ];
    const ctxs = [
      ["contextCountry=Australia", { name: "x", contextCountry: "Australia" }],
      ["行程點 雪梨／Australia", { name: "x", contextCity: "雪梨", contextCountry: "Australia" }],
    ];
    for (const [cname, h] of ctxs) {
      const out = inland.map(([n, lat, lng, address]) => `${n}=${g.isResolvedPlaceGeoConsistent(h, { lat, lng, address }) ? "接受" : "拒絕"}`);
      const anyReject = out.some((x) => x.endsWith("拒絕"));
      record("N5", `AU-${cname}`, `風險：澳洲內陸正確地點、${cname}、Details 地址看不出國家`, anyReject ? "INFO" : "PASS", out.join("｜"));
    }
    // (1b) 名稱表缺漏：Google ko 地址用「오스트레일리아」，表內只有「호주」
    record(
      "N5",
      "AU-ko-name",
      "國名表：ko「오스트레일리아」可辨識為 AU",
      g.countriesInGeoText("오스트레일리아 노던 준주 율라라").has("AU") ? "PASS" : "INFO",
      `countriesInGeoText=${JSON.stringify([...g.countriesInGeoText("오스트레일리아 노던 준주 율라라")])}；「호주 …」=${JSON.stringify([...g.countriesInGeoText("호주 노던 준주")])}`,
    );
    // (2) S7/R3：handoff 只有地址（含國名），他國候選看不出國家、Details 地址也看不出國家
    {
      const h = { name: "Eiffel Tower", address: "Champ de Mars, 75007 Paris, France", lat: null, lng: null };
      const variants = [
        ["Details formattedAddress 含 USA", "3655 Las Vegas Blvd S, Las Vegas, NV 89109, USA"],
        ["Details 只有短地址（無國名）", "3655 Las Vegas Blvd S, Las Vegas"],
        ["Details 無地址", null],
      ];
      const out = variants.map(([n, address]) => `${n}=${g.isResolvedPlaceGeoConsistent(h, { lat: 36.1125, lng: -115.1728, address }) ? "接受(洩漏)" : "拒絕"}`);
      const r = await runResolve({ placeId: "saved-r3", ...h }, [
        { placeId: "ChIJ_B14_R3_LV", label: "Eiffel Tower", secondary: "Las Vegas Blvd S", types: POI },
        { placeId: "ChIJ_B14_R3_PA", label: "Tour Eiffel", secondary: "Paris, France", types: POI },
      ]);
      record("N5", "R3", "S7/R3：只有地址＋他國候選無國名 → resolve 選擇與 Details 防線（Details 回 formattedAddress 時才擋得下）", "INFO", `resolve=${r.got}｜${out.join("｜")}`);
    }
    // (3) CROSS_BORDER_ZONES 遺漏：離某國已知中心點 <50 km、150 km 內無他國已知點的國界地點
    const MISSED = [
      ["河口 Hekou（中，對岸老街）", 22.5106, 103.9406, "CN"],
      ["老街 Lào Cai（越）", 22.4856, 103.9707, "VN"],
      ["黃岐半島（中，馬祖對岸）", 26.3264, 119.8896, "CN"],
      ["Point Roberts（美，溫哥華南方飛地）", 48.985, -123.0687, "US"],
      ["黑瞎子島 中方側（中）", 48.38, 134.6, "CN"],
      ["Tsawwassen（加，Point Roberts 北側）", 49.0167, -123.0833, "CA"],
    ];
    for (const [n, lat, lng, want] of MISSED) {
      const got = cc(lat, lng);
      const rc = regionCodeFor ? regionCodeFor(lat, lng) : "?";
      const status = got && got !== want ? "FAIL" : "PASS";
      record("N5", `Z-${n}`, `CROSS_BORDER_ZONES 遺漏探針：${n} 座標推國不得判成他國`, status, `got=${got} want=${want} regionCode=${rc ?? "(不送)"}`);
    }
    // 判錯的實際影響：只影響排序（不丟棄）、Details 以距離判斷（不拒絕）
    {
      const lat = 22.5106;
      const lng = 103.9406;
      const correct = { placeId: "ChIJ_B14_HEKOU_CN", label: "河口口岸", secondary: "中國雲南省紅河州河口縣", types: POI };
      const r = await runResolve({ placeId: "saved-hekou", name: "河口口岸", address: null, lat, lng }, [correct]);
      const ok = g.isResolvedPlaceGeoConsistent({ name: "河口口岸", lat, lng }, { lat, lng, address: correct.secondary });
      record("N5", "Z-impact", "遺漏的實際影響：河口自身座標、唯一正確候選 → 仍採用、Details 接受（只影響排序與 regionCode）", r.got === correct.placeId && ok ? "PASS" : "FAIL", `resolve=${r.got} Details=${ok}`);
    }
  }

  // ════════ N7. 地址文字含「他國城市名」的碰撞（規則 2 唯一丟棄條件、規則 3b 拒絕條件的誤判）════════
  // 正確地點、地址無國名但含與他國城市表同名的地名 → 不得丟棄正確候選、不得拒絕正確 Details（HEAD 會顯示）。
  {
    const COLL = [
      // [id, 名稱, handoff 地址, 候選 secondary（真實格式）, Details 地址, lat, lng]
      ["C1", "淺草寺", "台東區淺草2-3-1", "日本東京都台東區淺草2丁目3-1", "日本〒111-0032 東京都台東區淺草2丁目3-1", 35.7148, 139.7967],
      ["C2", "上野恩賜公園", "東京都台東區上野公園", "日本東京都台東區上野公園", "日本〒110-0007 東京都台東區上野公園", 35.7156, 139.7745],
      ["C3", "上野動物園", "日本東京都台東區上野公園9-83", "台東區上野公園9-83", "日本〒110-8711 東京都台東區上野公園9-83", 35.7163, 139.7713],
      ["C4", "Venice Beach Boardwalk", "1800 Ocean Front Walk, Venice, CA 90291", "Ocean Front Walk, Venice, CA, USA", "1800 Ocean Front Walk, Venice, CA 90291, USA", 33.985, -118.4695],
      ["C5", "Esther Short Park", "605 Esther St, Vancouver, WA 98660", "Esther Street, Vancouver, WA, USA", "605 Esther St, Vancouver, WA 98660, USA", 45.6257, -122.6734],
      ["C6", "Eau Gallie Arts District", "Highland Ave, Melbourne, FL 32935", "Highland Avenue, Melbourne, FL, USA", "Highland Ave, Melbourne, FL 32935, USA", 28.1306, -80.6331],
      ["C7", "小烏來天空步道", "復興區羅馬公路", "台灣桃園市復興區", "336台灣桃園市復興區義盛里", 24.7963, 121.3913],
    ];
    for (const [id, name, address, secondary, detAddr, lat, lng] of COLL) {
      const cand = { placeId: `ChIJ_B14_${id}`, label: name, secondary, types: POI };
      const h = { name, address, lat: null, lng: null };
      const d = await displayed(h, [cand], { [cand.placeId]: { lat, lng, address: detAddr } });
      const own = [...g.buildPlaceGeoContext(h).ownCountries];
      const candC = [...g.countriesInGeoText(secondary)];
      record(
        "N7",
        id,
        `${name}：handoff 地址「${address}」→ 正確地點不得被丟／拒（HEAD 顯示）`,
        d.shown === cand.placeId ? "PASS" : "FAIL",
        `shown=${d.shown} searches=${d.searches} handoff 地址推國=${JSON.stringify(own)} 候選推國=${JSON.stringify(candC)} Details 推國=${JSON.stringify([...g.countriesInGeoText(detAddr)])}`,
      );
    }
    // ko 國名缺漏的影響：行程點 雪梨／Australia，Details 黃金海岸（約 680 km）ko 地址
    const gc = g.isResolvedPlaceGeoConsistent({ name: "x", contextCity: "雪梨", contextCountry: "Australia" }, { lat: -28.0023, lng: 153.431, address: "오스트레일리아 퀸즐랜드 서퍼스 파라다이스" });
    const gcEn = g.isResolvedPlaceGeoConsistent({ name: "x", contextCity: "雪梨", contextCountry: "Australia" }, { lat: -28.0023, lng: 153.431, address: "Surfers Paradise QLD 4217, Australia" });
    const gcCountryOnly = g.isResolvedPlaceGeoConsistent({ name: "x", contextCountry: "Australia" }, { lat: -28.0023, lng: 153.431, address: "오스트레일리아 퀸즐랜드 서퍼스 파라다이스" });
    record("N7", "KO-AU", "ko：行程點 雪梨／Australia、Details 黃金海岸（ko 地址）→ 接受", gc ? "PASS" : "INFO", `ko=${gc} en=${gcEn} 只有 contextCountry(ko)=${gcCountryOnly}（city+country 時以城市中心 400 km 判斷）`);
    const xa = g.isResolvedPlaceGeoConsistent({ name: "x", contextCity: "北京", contextCountry: "China" }, { lat: 34.3841, lng: 109.2785, address: "중국 산시성 시안시 린퉁구" });
    record("N7", "KO-CN", "ko：行程點 北京／China、Details 西安兵馬俑（ko 地址「중국」）→ 接受", xa ? "PASS" : "INFO", `got=${xa}；countriesInGeoText("중국 …")=${JSON.stringify([...g.countriesInGeoText("중국 산시성")])}`);
  }

  // ════════ N6. 台灣：無座標、只有地址時 searchPlaces center 與 HEAD 對照 ════════
  {
    const tw = [
      ["台北101", "台北市信義區信義路五段7號"],
      ["赤崁樓", "台南市中西區民族路二段212號"],
      ["駁二", "高雄市鹽埕區大勇路1號"],
    ];
    const diffs = [];
    for (const [name, address] of tw) {
      searchLog = [];
      candidateProvider = () => [{ placeId: `ChIJ_B14_TW_${name}`, label: name, secondary: `台灣${address}`, types: POI }];
      quiet();
      try {
        await resolveGooglePlaceIdForDetail({ placeId: `saved-${name}`, name, address, lat: null, lng: null }, "zh-TW");
      } finally {
        loud();
      }
      const c = searchLog[0]?.center;
      if (c) diffs.push(`${name}: center=${c.lat},${c.lng}（HEAD=未帶）`);
    }
    record("N6", "TW-center", "台灣地址、無座標：searchPlaces 的 center 與 HEAD 相同（HEAD 不帶 center）", diffs.length ? "INFO" : "PASS", diffs.join("；") || "皆未帶 center");
  }

  const out = ["\n=== verify-place-geo-b14-fresh-sample ==="];
  for (const r of results) out.push(`[${r.status}] ${r.sec}/${r.id} ${r.title}\n       ${r.detail}`);
  out.push(`[INFO] 外部網路呼叫總數 = ${externalCalls}`);
  const failed = results.filter((r) => r.status === "FAIL");
  out.push(`摘要：PASS ${results.filter((r) => r.status === "PASS").length}／FAIL ${failed.length}／INFO ${results.filter((r) => r.status === "INFO").length}${failed.length ? `；失敗：${failed.map((r) => `${r.sec}/${r.id}`).join(", ")}` : ""}`);
  process.stdout.write(`${out.join("\n")}\n`);
  if (failed.length || externalCalls > 0) exitCode = 1;
} catch (e) {
  loud();
  process.stdout.write(`[b14-sample] 執行失敗：${e?.stack ?? e}\n`);
  exitCode = 1;
} finally {
  await server.close().catch(() => {});
  clearTimeout(watchdog);
}
process.exit(exitCode);
