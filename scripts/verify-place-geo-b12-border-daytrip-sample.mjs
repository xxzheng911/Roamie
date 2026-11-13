#!/usr/bin/env node
/**
 * B12（tester 獨立抽樣）— 同名不同國家地點修正第 4 輪：
 *  S1 15 km 內跨國城鎮（新抽樣，非 H 段既有點）countryCodeForCoordinates：判成他國 = FAIL，null = INFO。
 *  S2 S1 判錯點的實際影響（resolve 端到端）：handoff 只有自身座標（或無國名地址＋座標），
 *     唯一候選為正確地點且 secondary 寫出正確國名 → HEAD 會採用；修正後被丟棄 = FAIL。
 *  S3 S1 判錯點的 Autocomplete regionCode（INFO：HEAD 一律送 TW）。
 *  S4 S1 判錯點的 Details 防護：自身座標＋Details 座標（距離規則）→ 必須接受；
 *     Details 沒回座標、只有地址時（INFO）。
 *  S5 跨國一日遊、行程點無地址無座標（context 升級硬訊號）→ resolve／Details 結果（INFO，規則 3 設計內）。
 *  S6 同國一日遊延伸點：context-only（400 km）與自身座標 → 不得拒絕／丟棄。
 *  S7 原始案例（遠距跨國同名）仍被擋：resolve 丟棄、Details 拒絕。
 *
 * 執行：npx vite-node scripts/verify-place-geo-b12-border-daytrip-sample.mjs --config scripts/vite.verify.config.mjs
 * 外部網路 0（fetch／http／net 全攔截），searchPlaces 以 mock 取代。
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARD_TIMEOUT_MS = 55_000;
const watchdog = setTimeout(() => {
  process.stdout.write(`\n[b12-sample] 超過 ${HARD_TIMEOUT_MS}ms，強制結束\n`);
  process.exit(2);
}, HARD_TIMEOUT_MS);
watchdog.unref?.();

let externalCalls = 0;
const trap = (kind, detail) => {
  externalCalls += 1;
  throw new Error(`[b12-sample] external ${kind} blocked ${String(detail).slice(0, 80)}`);
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
globalThis.__b12SearchPlaces = async (query, opts) => {
  searchLog.push({ query, center: opts?.center });
  return { suggestions: candidateProvider(query, opts) ?? [], error: null };
};

const results = [];
const record = (sec, id, title, status, detail = "") => results.push({ sec, id, title, status, detail });

const { createServer } = await import("vite");
const { ViteNodeServer } = await import("vite-node/server");
const { ViteNodeRunner } = await import("vite-node/client");
const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
const MOCK_ID = "\0b12-places-service";
const REAL_PLACES_SERVICE = `${WORK_ROOT}/src/services/placesService.ts?b12-real`;
const server = await createServer({
  root: WORK_ROOT,
  configFile: false,
  envDir: false,
  logLevel: "silent",
  clearScreen: false,
  plugins: [
    {
      name: "b12-mock-places-service",
      enforce: "pre",
      resolveId(id) {
        if (id.includes("b12-real")) return null;
        if (/(^|\/)services\/placesService(\.ts)?$/.test(id)) return MOCK_ID;
        return null;
      },
      load(id) {
        if (id !== MOCK_ID) return null;
        return [
          `export * from ${JSON.stringify(REAL_PLACES_SERVICE)};`,
          `export const searchPlaces = (...args) => globalThis.__b12SearchPlaces(...args);`,
        ].join("\n");
      },
    },
    tsconfigPaths(),
  ],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

const COUNTRY_TEXT = {
  TW: "Taiwan", JP: "Japan", KR: "South Korea", CN: "China", HK: "Hong Kong", MO: "Macau",
  AU: "Australia", SG: "Singapore", MY: "Malaysia", US: "USA", MX: "Mexico", FR: "France",
  DE: "Germany", AT: "Austria", CH: "Switzerland", IT: "Italy",
};
const POI = ["point_of_interest", "establishment"];
const origConsole = { info: console.info, log: console.log, warn: console.warn, debug: console.debug };
const quiet = () => {
  console.info = console.log = console.warn = console.debug = () => {};
};
const loud = () => Object.assign(console, origConsole);

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
  const cc = g.countryCodeForCoordinates;

  const runResolve = async (handoff, candidates) => {
    searchLog = [];
    candidateProvider = () => candidates;
    quiet();
    try {
      return { got: (await resolveGooglePlaceIdForDetail(handoff, "zh-TW")) ?? null, searches: searchLog.length };
    } finally {
      loud();
    }
  };

  // ════════ S1. 15 km 內跨國城鎮（真實座標，公開地圖概略值）════════
  // [id, 名稱, lat, lng, 真實國家, 英文地名（供候選 secondary）]
  const BORDER = [
    ["K1", "Kehl 市中心（德）", 48.5728, 7.815, "DE", "Hauptstraße, 77694 Kehl"],
    ["K2", "Kehl 兩岸公園 Garten der zwei Ufer（德側）", 48.5687, 7.8034, "DE", "Rheinpromenade, 77694 Kehl"],
    ["K3", "Kehl 火車站（德）", 48.5747, 7.8105, "DE", "Bahnhofstraße, 77694 Kehl"],
    ["F1", "Freilassing 火車站（德）", 47.8373, 12.977, "DE", "Bahnhofstraße, 83395 Freilassing"],
    ["F2", "Bad Reichenhall（德）", 47.725, 12.877, "DE", "83435 Bad Reichenhall"],
    ["F3", "Salzburg 機場 W.A. Mozart（奧）", 47.7933, 13.0043, "AT", "Innsbrucker Bundesstraße 95, 5020 Salzburg"],
    ["B1", "Weil am Rhein Vitra Design Museum（德）", 47.6017, 7.6195, "DE", "Charles-Eames-Straße 2, 79576 Weil am Rhein"],
    ["B2", "Saint-Louis（法，巴塞爾機場旁）", 47.59, 7.56, "FR", "68300 Saint-Louis"],
    ["B3", "Lörrach（德）", 47.615, 7.661, "DE", "79539 Lörrach"],
    ["B4", "Riehen Fondation Beyeler（瑞）", 47.5884, 7.6531, "CH", "Baselstrasse 101, 4125 Riehen"],
    ["B5", "Basel Münster（瑞）", 47.5565, 7.5925, "CH", "Münsterplatz, 4051 Basel"],
    ["G1", "Annemasse（法）", 46.1934, 6.2342, "FR", "74100 Annemasse"],
    ["G2", "Ferney-Voltaire 伏爾泰城堡（法）", 46.2558, 6.1081, "FR", "Allée du Château, 01210 Ferney-Voltaire"],
    ["G3", "Saint-Julien-en-Genevois（法）", 46.1442, 6.0819, "FR", "74160 Saint-Julien-en-Genevois"],
    ["G4", "Salève 纜車下站 Étrembières（法）", 46.1777, 6.1888, "FR", "Route du Téléphérique, 74100 Étrembières"],
    ["G5", "Gaillard（法）", 46.185, 6.208, "FR", "74240 Gaillard"],
    ["G6", "Divonne-les-Bains（法）", 46.357, 6.139, "FR", "01220 Divonne-les-Bains"],
    ["G7", "日內瓦機場（瑞）", 46.2381, 6.109, "CH", "Route de l'Aéroport 21, 1215 Le Grand-Saconnex"],
    ["G8", "CERN Meyrin（瑞）", 46.2338, 6.0557, "CH", "Esplanade des Particules 1, 1211 Meyrin"],
    ["T1", "Tijuana Avenida Revolución（墨）", 32.531, -117.036, "MX", "Av. Revolución, Zona Centro, Tijuana, B.C."],
    ["T2", "San Ysidro Las Americas Premium Outlets（美）", 32.5463, -117.0329, "US", "4211 Camino De La Plaza, San Diego, CA 92173"],
    ["T3", "San Ysidro 口岸（美）", 32.5427, -117.0294, "US", "San Ysidro, San Diego, CA 92173"],
    ["T4", "Chula Vista（美）", 32.6401, -117.0842, "US", "Chula Vista, CA"],
    ["T5", "Imperial Beach（美）", 32.5839, -117.1131, "US", "Imperial Beach, CA"],
    ["J1", "新山 City Square（馬）", 1.46, 103.764, "MY", "Jalan Wong Ah Fook, Johor Bahru, Johor"],
    ["J2", "新加坡 兀蘭關卡 Woodlands Checkpoint（新）", 1.445, 103.769, "SG", "21 Woodlands Crossing, Singapore 738203"],
    ["J3", "新加坡 Causeway Point 商場（新）", 1.436, 103.786, "SG", "1 Woodlands Square, Singapore 738099"],
    ["J4", "新加坡 Woodlands Waterfront Park（新）", 1.453, 103.78, "SG", "Admiralty Road West, Singapore"],
    ["J5", "新加坡 Kranji 戰爭紀念碑（新）", 1.4192, 103.7581, "SG", "9 Woodlands Road, Singapore 738656"],
    ["J6", "新山 Legoland Malaysia（馬）", 1.4268, 103.6292, "MY", "Persiaran Medini Utara 3, Iskandar Puteri, Johor"],
    ["M1", "澳門 關閘 Portas do Cerco（澳）", 22.2155, 113.549, "MO", "Portas do Cerco, Macau"],
    ["M2", "澳門 紅街市（澳）", 22.2068, 113.544, "MO", "Avenida do Almirante Lacerda, Macau"],
    ["M3", "澳門 威尼斯人（澳）", 22.1474, 113.56, "MO", "Estrada da Baía de N. Senhora da Esperança, Cotai, Macau"],
    ["M4", "澳門 旅遊塔（澳）", 22.18, 113.5367, "MO", "Largo da Torre de Macau, Macau"],
    ["M5", "珠海 拱北口岸（中）", 22.2152, 113.5508, "CN", "广东省珠海市香洲区拱北"],
    ["M6", "珠海 長隆海洋王國（中）", 22.101, 113.537, "CN", "广东省珠海市横琴新区"],
    ["S1", "香港 羅湖站（港）", 22.528, 114.113, "HK", "Lo Wu, New Territories"],
    ["S2", "香港 上水（港）", 22.5016, 114.1283, "HK", "Sheung Shui, New Territories"],
    ["S3", "香港 落馬洲（港）", 22.5145, 114.0657, "HK", "Lok Ma Chau, New Territories"],
    ["S4", "香港 濕地公園（港）", 22.467, 114.009, "HK", "Wetland Park Road, Tin Shui Wai"],
    ["S5", "深圳 羅湖商業城（中）", 22.5333, 114.1166, "CN", "广东省深圳市罗湖区"],
    ["S6", "深圳 福田口岸（中）", 22.5155, 114.0665, "CN", "广东省深圳市福田区"],
    ["S7", "香港 尖沙咀（港）", 22.2988, 114.1722, "HK", "Tsim Sha Tsui, Kowloon"],
    ["C1", "Chiasso（瑞，科莫旁）", 45.832, 9.031, "CH", "6830 Chiasso"],
    ["C2", "Como 大教堂（義）", 45.8115, 9.0838, "IT", "Piazza del Duomo, 22100 Como CO"],
  ];
  const wrong = [];
  for (const [id, name, lat, lng, want] of BORDER) {
    const got = cc(lat, lng);
    if (got === want) record("S1", id, `${name} → ${want}`, "PASS", `got=${got}`);
    else if (got === null) record("S1", id, `${name} → null（可接受）`, "INFO", `got=null want=${want}`);
    else {
      wrong.push([id, name, lat, lng, want, got]);
      record("S1", id, `${name} 判成他國`, "FAIL", `got=${got} want=${want}`);
    }
  }

  // ════════ S2. 判錯點的實際影響：resolve 端到端 ════════
  const byId = new Map(BORDER.map((b) => [b[0], b]));
  for (const [id, name, lat, lng, want, got] of wrong) {
    const [, , , , , addr] = byId.get(id);
    const label = `B12-${id}`;
    const cand = { placeId: `ChIJ_B12_${id}_${want}`, label, secondary: `${addr}, ${COUNTRY_TEXT[want]}`, types: ["tourist_attraction", ...POI] };
    // (a) 只有自身座標（收藏／行程點常見）
    const a = await runResolve({ placeId: `saved-${id}`, name: label, address: null, lat, lng }, [cand]);
    record(
      "S2",
      `${id}a`,
      `${name}：handoff 只有自身座標，唯一候選＝正確地點（secondary 含 ${COUNTRY_TEXT[want]}）→ 應採用（HEAD 採用）`,
      a.got === cand.placeId ? "PASS" : "FAIL",
      `got=${a.got} searches=${a.searches} 座標推國=${got}`,
    );
    // (b) 自身地址看不出國家＋座標
    const b = await runResolve({ placeId: `saved-${id}`, name: label, address: addr, lat, lng }, [cand]);
    record(
      "S2",
      `${id}b`,
      `${name}：handoff 地址無國名＋座標 → 應採用（HEAD 採用）`,
      b.got === cand.placeId ? "PASS" : "FAIL",
      `got=${b.got} searches=${b.searches}`,
    );
  }

  // ════════ S3. Autocomplete regionCode（INFO）════════
  for (const [id, name, lat, lng, want, got] of wrong) {
    const code = geoRegion.isTaiwanCoordinates(lat, lng) ? "TW" : cc(lat, lng);
    record("S3", id, `${name}：Autocomplete regionCode`, "INFO", `送出=${code ?? "(不送)"} 真實=${want}（HEAD 一律送 TW；regionCode 只影響排序／格式）`);
  }

  // ════════ S4. Details 防護（判錯點）════════
  for (const [id, name, lat, lng, want] of wrong) {
    const [, , , , , addr] = byId.get(id);
    const full = `${addr}, ${COUNTRY_TEXT[want]}`;
    const okCoords = g.isResolvedPlaceGeoConsistent({ name, lat, lng }, { lat: lat + 0.001, lng: lng + 0.001, address: full });
    record("S4", `${id}a`, `${name}：自身座標＋Details 座標相距 <1 km → 接受`, okCoords ? "PASS" : "FAIL", `got=${okCoords}`);
    const okAddrOnly = g.isResolvedPlaceGeoConsistent({ name, lat, lng }, { lat: null, lng: null, address: full });
    record("S4", `${id}b`, `${name}：自身座標、Details 未回座標只回地址（少見）`, okAddrOnly ? "PASS" : "INFO", `got=${okAddrOnly}（false＝正確地點被拒）`);
  }

  // ════════ S5. 跨國一日遊、行程點無地址無座標（context 升級硬訊號，規則 3 設計內）════════
  const CROSS = [
    ["X1", "香港行程 → 澳門大三巴", { city: "香港", country: "香港" }, "大三巴牌坊", "Macau", 22.1975, 113.5409],
    ["X2", "香港行程 → 深圳 東門老街", { city: "香港", country: "Hong Kong" }, "東門老街", "广东省深圳市罗湖区, China", 22.5455, 114.1194],
    ["X3", "新加坡行程 → 新山 Legoland", { city: "新加坡", country: "Singapore" }, "Legoland Malaysia", "Iskandar Puteri, Johor, Malaysia", 1.4268, 103.6292],
    ["X4", "聖地牙哥行程 → Tijuana", { city: "San Diego", country: "USA" }, "Avenida Revolución", "Zona Centro, Tijuana, B.C., Mexico", 32.531, -117.036],
    ["X5", "日內瓦行程 → 霞慕尼 南針峰纜車", { city: "日內瓦", country: "Switzerland" }, "Aiguille du Midi", "74400 Chamonix-Mont-Blanc, France", 45.9237, 6.8694],
    ["X6", "薩爾斯堡行程 → 貝希特斯加登 鷹巢", { city: "薩爾斯堡", country: "Austria" }, "Kehlsteinhaus", "83471 Berchtesgaden, Germany", 47.6106, 13.0418],
    ["X7", "史特拉斯堡行程 → Kehl", { city: "Strasbourg", country: "France" }, "Kehl Rheinpark", "77694 Kehl, Germany", 48.5687, 7.8034],
  ];
  for (const [id, title, dest, placeName, secondary, lat, lng] of CROSS) {
    const item = { id: `it-${id}`, title: placeName, placeName, lat: null, lng: null, address: null, time: "10:00" };
    const h = tripHandoff.itineraryItemToPlaceHandoff(item, "zh-TW", dest);
    const cand = { placeId: `ChIJ_B12_${id}`, label: placeName, secondary, types: ["tourist_attraction", ...POI] };
    const r = await runResolve(h, [cand]);
    const det = g.isResolvedPlaceGeoConsistent(h, { lat, lng, address: secondary });
    const hExt = tripHandoff.itineraryItemToPlaceHandoff({ ...item, destinationScope: "nearby_extension", extensionDestination: placeName }, "zh-TW", dest);
    const rExt = await runResolve(hExt, [cand]);
    record(
      "S5",
      id,
      `${title}（行程點無地址無座標）`,
      "INFO",
      `一般行程點：resolve=${r.got ?? "null"} Details 接受=${det}｜標為 nearby_extension：resolve=${rExt.got ?? "null"}（HEAD 皆採用）`,
    );
  }

  // ════════ S6. 同國一日遊延伸點 ════════
  const DAY = [
    ["D1", "京都 → 奈良 東大寺", "京都", "Japan", "東大寺", "日本奈良縣奈良市雜司町406-1", 34.689, 135.8398],
    ["D2", "東京 → 箱根 大涌谷", "東京", "Japan", "大涌谷", "日本神奈川縣足柄下郡箱根町仙石原", 35.2443, 139.0197],
    ["D3", "首爾 → 水原華城", "首爾", "South Korea", "水原華城", "大韓民國京畿道水原市八達區", 37.2871, 127.0119],
    ["D4", "台北 → 九份老街", "台北", "台灣", "九份老街", "台灣新北市瑞芳區基山街", 25.1092, 121.8446],
    ["D5", "雪梨 → 藍山 三姊妹岩", "雪梨", "Australia", "Three Sisters", "Echo Point Rd, Katoomba NSW 2780, Australia", -33.732, 150.3119],
    ["D6", "東京 → 日光東照宮", "東京", "Japan", "日光東照宮", "日本栃木縣日光市山內2301", 36.758, 139.5988],
    ["D7", "大阪 → 廣島 原爆圓頂", "大阪", "Japan", "原爆圓頂館", "日本廣島縣廣島市中區大手町1-10", 34.3955, 132.4536],
    ["D8", "東京 → 河口湖", "東京", "Japan", "河口湖", "日本山梨縣南都留郡富士河口湖町", 35.5167, 138.75],
    ["D9", "首爾 → 南怡島", "首爾", "South Korea", "南怡島", "大韓民國江原道春川市南山面", 37.7911, 127.5254],
    ["D10", "台北 → 十分老街", "台北", "台灣", "十分老街", "台灣新北市平溪區十分街", 25.0418, 121.7756],
    ["D11", "札幌 → 小樽運河", "札幌", "Japan", "小樽運河", "日本北海道小樽市港町", 43.1994, 140.9943],
    ["D12", "福岡 → 太宰府天滿宮", "福岡", "Japan", "太宰府天滿宮", "日本福岡縣太宰府市宰府4-7-1", 33.5215, 130.5349],
    ["D13", "東京 → 輕井澤", "東京", "Japan", "輕井澤王子購物廣場", "日本長野縣北佐久郡輕井澤町", 36.3427, 138.6331],
    ["D14", "雪梨 → 獵人谷", "雪梨", "Australia", "Hunter Valley Gardens", "Broke Rd, Pokolbin NSW 2320, Australia", -32.7505, 151.2813],
    ["D15", "東京 → 京都 清水寺（延伸）", "東京", "Japan", "清水寺", "日本京都府京都市東山區清水1-294", 34.9949, 135.785],
  ];
  for (const [id, title, city, country, placeName, secondary, lat, lng] of DAY) {
    const cand = { placeId: `ChIJ_B12_${id}`, label: placeName, secondary, types: ["tourist_attraction", ...POI] };
    // (a) 行程點無地址無座標（context-only），一般行程點
    const item = { id: `it-${id}`, title: placeName, placeName, lat: null, lng: null, address: null, time: "10:00" };
    const h = tripHandoff.itineraryItemToPlaceHandoff(item, "zh-TW", { city, country });
    const r = await runResolve(h, [cand]);
    const det = g.isResolvedPlaceGeoConsistent(h, { lat, lng, address: secondary });
    record("S6", `${id}a`, `${title}：context-only 行程點 → resolve 採用、Details 接受`, r.got === cand.placeId && det ? "PASS" : "FAIL", `resolve=${r.got} Details=${det}`);
    // (b) 有自身座標（略偏 0.01°）
    const own = { placeId: `saved-${id}`, name: placeName, address: null, lat: lat + 0.01, lng: lng + 0.01, contextCity: city };
    const r2 = await runResolve(own, [cand]);
    const det2 = g.isResolvedPlaceGeoConsistent(own, { lat, lng, address: secondary });
    record("S6", `${id}b`, `${title}：自身座標 → resolve 採用、Details 接受`, r2.got === cand.placeId && det2 ? "PASS" : "FAIL", `resolve=${r2.got} Details=${det2} 座標推國=${cc(own.lat, own.lng)}`);
  }
  // INFO：400 km 邊界（東京行程含大阪／神戶點、無地址無座標）
  {
    const tokyo = { name: "x", contextCity: "東京", contextCountry: "Japan" };
    const pts = [
      ["大阪城", 34.6873, 135.5262],
      ["環球影城 USJ", 34.6654, 135.4323],
      ["神戶港", 34.6826, 135.1867],
    ];
    const detail = pts.map(([n, lat, lng]) => `${n}=${g.isResolvedPlaceGeoConsistent(tokyo, { lat, lng, address: "日本大阪府" })}`).join(" ");
    record("S6", "D16", "東京行程中的關西點（context-only，400 km 邊界）", "INFO", detail);
  }

  // ════════ S7. 遠距跨國同名仍被擋 ════════
  const UB = { placeId: "ChIJ_UB_SYDNEY_TOWER_MN", label: "Sydney Tower", secondary: "Chinggis Avenue, Ulaanbaatar, Mongolia", types: ["premise", ...POI] };
  const SYD = { placeId: "ChIJ_SYD_SYDNEY_TOWER_EYE_AU", label: "Sydney Tower Eye", secondary: "Market Street, Sydney NSW, Australia", types: ["tourist_attraction", ...POI] };
  const UB_COORD = { lat: 47.9184, lng: 106.9177 };
  const cases = [
    ["R1", "雪梨座標", { name: "Sydney Tower", address: null, lat: -33.8705, lng: 151.2089 }],
    ["R2", "藍山座標（座標推國 null）", { name: "Sydney Tower", address: null, lat: -33.712, lng: 150.311 }],
    ["R3", "地址含 Australia", { name: "Sydney Tower", address: "100 Market St, Sydney NSW 2000, Australia", lat: null, lng: null }],
    ["R4", "行程點 context-only（Sydney／Australia）", { name: "Sydney Tower", address: null, lat: null, lng: null, contextCity: "Sydney", contextCountry: "Australia" }],
    ["R5", "收藏 city=雪梨（context-only）", { name: "Sydney Tower", address: null, lat: null, lng: null, contextCity: "雪梨" }],
    ["R6", "延伸行程點 contextCity=藍山（不在城市表、無國家）", { name: "Sydney Tower", address: null, lat: null, lng: null, contextCity: "藍山" }],
  ];
  for (const [id, title, h] of cases) {
    const r = await runResolve({ placeId: `saved-${id}`, ...h }, [UB, SYD]);
    const det = g.isResolvedPlaceGeoConsistent(h, { ...UB_COORD, address: UB.secondary });
    const detNoAddr = g.isResolvedPlaceGeoConsistent(h, { ...UB_COORD, address: null });
    const resolvedSafe = r.got !== UB.placeId;
    const blocked = resolvedSafe || (!det && !detNoAddr);
    record(
      "S7",
      id,
      `Sydney Tower｜${title}：蒙古同名最終不得顯示（resolve 丟棄或 Details 拒絕）`,
      blocked ? "PASS" : id === "R6" ? "INFO" : "FAIL",
      `resolve=${r.got} searches=${r.searches} Details(蒙古,含地址)=${det} Details(蒙古,只座標)=${detNoAddr}`,
    );
  }
  // 其他遠距同名：巴黎艾菲爾鐵塔 vs 拉斯維加斯、清邁 Nimman vs 洛杉磯同名
  {
    const LV = { placeId: "ChIJ_LV_EIFFEL", label: "Eiffel Tower", secondary: "Las Vegas Blvd S, Las Vegas, NV, USA", types: ["tourist_attraction", ...POI] };
    const PA = { placeId: "ChIJ_PA_EIFFEL", label: "Tour Eiffel", secondary: "Champ de Mars, Paris, France", types: ["tourist_attraction", ...POI] };
    const r = await runResolve({ placeId: "saved-eiffel", name: "Eiffel Tower", address: null, lat: 48.8584, lng: 2.2945 }, [LV, PA]);
    record("S7", "R7", "Eiffel Tower｜巴黎座標，拉斯維加斯完全同名排第一 → 丟棄美國、採用巴黎", r.got === PA.placeId ? "PASS" : "FAIL", `resolve=${r.got} searches=${r.searches}`);
    const det = g.isResolvedPlaceGeoConsistent({ name: "Eiffel Tower", lat: 48.8584, lng: 2.2945 }, { lat: 36.1125, lng: -115.1728, address: LV.secondary });
    record("S7", "R8", "Eiffel Tower｜巴黎座標、Details 抓回拉斯維加斯 → 拒絕", det === false ? "PASS" : "FAIL", `got=${det}`);
  }

  const out = ["\n=== verify-place-geo-b12-border-daytrip-sample ==="];
  for (const r of results) out.push(`[${r.status}] ${r.sec}/${r.id} ${r.title}\n       ${r.detail}`);
  out.push(`[INFO] 外部網路呼叫總數 = ${externalCalls}`);
  const failed = results.filter((r) => r.status === "FAIL");
  out.push(`摘要：PASS ${results.filter((r) => r.status === "PASS").length}／FAIL ${failed.length}／INFO ${results.filter((r) => r.status === "INFO").length}${failed.length ? `；失敗：${failed.map((r) => `${r.sec}/${r.id}`).join(", ")}` : ""}`);
  process.stdout.write(`${out.join("\n")}\n`);
  if (failed.length || externalCalls > 0) exitCode = 1;
} catch (e) {
  loud();
  process.stdout.write(`[b12-sample] 執行失敗：${e?.stack ?? e}\n`);
  exitCode = 1;
} finally {
  await server.close().catch(() => {});
  clearTimeout(watchdog);
}
process.exit(exitCode);
