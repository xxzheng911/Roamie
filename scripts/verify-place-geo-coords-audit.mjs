#!/usr/bin/env node
/**
 * B8 — 同名不同國家地點：座標→國家寬範圍檢查、手算座標實測、resolve 層 context-only 案例。
 *
 * 執行：npx vite-node scripts/verify-place-geo-coords-audit.mjs --config scripts/vite.verify.config.mjs
 *
 * 段落：
 *  A. 任務單指定城市（海參崴／札幌／函館／福岡／對馬／那霸／釜山／浦項／濟州）countryCodeForCoordinates 實測（斷言）。
 *  B. Autocomplete regionCode（autocompleteRegionCode 以 TS AST 抽出）：福岡 → JP 等（斷言）。
 *  C. 寬範圍：place-geo-guard CITIES 與 destination-geocode DESTINATION_APPROX_CENTER 所有已知中心點
 *     逐一跑 countryCodeForCoordinates，統計判錯／null（判錯為 FAIL）。
 *  D. 邊境／離島抽樣（判錯列為 FAIL，未建模國家列 INFO）。
 *  E. 國家框涵蓋（containment）：地點真的在該國，卻被國家框判為 mismatch → 會丟棄正確候選／拒絕正確 Details（FAIL）。
 *  F. resolve 層：自身無地址、無座標，只有 contextCity／contextCountry → 丟棄國家明確不符的候選；
 *     有自身座標／地址時 context 不得丟棄（searchPlaces mock，外部網路 0）。
 *  G. Details 防護 isResolvedPlaceGeoConsistent（context-only 硬訊號、自身座標優先）。
 */
import fs from "node:fs";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARD_TIMEOUT_MS = 55_000;
const watchdog = setTimeout(() => {
  process.stdout.write(`\n[geo-coords-audit] 超過 ${HARD_TIMEOUT_MS}ms，強制結束\n`);
  process.exit(2);
}, HARD_TIMEOUT_MS);
watchdog.unref?.();

// ── 網路攔截 ─────────────────────────────────────────────────────────
let externalCalls = 0;
const externalLog = [];
const trap = (kind, detail) => {
  externalCalls += 1;
  externalLog.push(`${kind}:${String(detail).slice(0, 120)}`);
  throw new Error(`[geo-coords-audit] external ${kind} blocked`);
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

// ── searchPlaces mock ───────────────────────────────────────────────
let searchLog = [];
let candidateProvider = () => [];
globalThis.__geoAuditSearchPlaces = async (query, opts) => {
  searchLog.push({ query, center: opts?.center });
  return { suggestions: candidateProvider(query, opts) ?? [], error: null };
};

const results = [];
const record = (sec, id, title, status, detail = "") => results.push({ sec, id, title, status, detail });
const eq = (sec, id, title, got, want) =>
  record(sec, id, title, JSON.stringify(got) === JSON.stringify(want) ? "PASS" : "FAIL", `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);

const { createServer } = await import("vite");
const { ViteNodeServer } = await import("vite-node/server");
const { ViteNodeRunner } = await import("vite-node/client");
const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
const MOCK_ID = "\0geo-audit-places-service";
const REAL_PLACES_SERVICE = `${WORK_ROOT}/src/services/placesService.ts?geo-audit-real`;
const server = await createServer({
  root: WORK_ROOT,
  configFile: false,
  envDir: false,
  logLevel: "silent",
  clearScreen: false,
  plugins: [
    {
      name: "geo-audit-mock-places-service",
      enforce: "pre",
      resolveId(id) {
        if (id.includes("geo-audit-real")) return null;
        if (/(^|\/)services\/placesService(\.ts)?$/.test(id)) return MOCK_ID;
        return null;
      },
      load(id) {
        if (id !== MOCK_ID) return null;
        return [
          `export * from ${JSON.stringify(REAL_PLACES_SERVICE)};`,
          `export const searchPlaces = (...args) => globalThis.__geoAuditSearchPlaces(...args);`,
        ].join("\n");
      },
    },
    tsconfigPaths(),
  ],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

async function extractFunctions(file, names, deps) {
  const ts = (await import("typescript")).default;
  const source = fs.readFileSync(`${WORK_ROOT}/${file}`, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const ctx = vm.createContext({ ...deps, console: { info() {}, warn() {}, log() {} } });
  const missing = [];
  for (const name of names) {
    const node = tree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
    if (!node) {
      missing.push(name);
      continue;
    }
    const js = ts.transpileModule(node.getText(tree).replace(/^export /, ""), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInContext(js, ctx);
  }
  return { ctx, missing };
}

/** 每個國家碼在 candidate 文字中使用的國名（必須是 place-geo-guard names 內的寫法） */
const COUNTRY_TEXT = {
  TW: "Taiwan", JP: "Japan", KR: "South Korea", CN: "China", HK: "Hong Kong", MO: "Macau", RU: "Russia",
  MN: "Mongolia", AU: "Australia", NZ: "New Zealand", TH: "Thailand", VN: "Vietnam", SG: "Singapore",
  MY: "Malaysia", ID: "Indonesia", PH: "Philippines", KH: "Cambodia", MV: "Maldives", IN: "India",
  AE: "United Arab Emirates", US: "USA", CA: "Canada", MX: "Mexico", GB: "United Kingdom", IE: "Ireland",
  FR: "France", IT: "Italy", ES: "Spain", PT: "Portugal", DE: "Germany", NL: "Netherlands", BE: "Belgium",
  CH: "Switzerland", AT: "Austria", CZ: "Czechia", GR: "Greece", TR: "Turkey", EG: "Egypt", IS: "Iceland",
};

let exitCode = 0;
const origConsole = { info: console.info, log: console.log, warn: console.warn, debug: console.debug };
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
  const cc = g.countryCodeForCoordinates;

  // ════════ A. 任務單指定城市（工程師手算 → 實測）════════
  const REQUIRED = [
    ["A1", "海參崴 Vladivostok", 43.1155, 131.8855, "RU"],
    ["A2", "札幌 Sapporo", 43.0618, 141.3545, "JP"],
    ["A3", "函館 Hakodate", 41.7687, 140.7288, "JP"],
    ["A4", "福岡 Fukuoka", 33.5904, 130.4017, "JP"],
    ["A5", "對馬 嚴原 Izuhara", 34.2028, 129.2878, "JP"],
    ["A6", "對馬 比田勝 Hitakatsu", 34.6536, 129.4757, "JP"],
    ["A7", "那霸 Naha", 26.2124, 127.6809, "JP"],
    ["A8", "釜山 Busan", 35.1796, 129.0756, "KR"],
    ["A9", "浦項 Pohang", 36.019, 129.3435, "KR"],
    ["A10", "濟州 Jeju", 33.4996, 126.5312, "KR"],
    ["A11", "北九州 Kitakyushu", 33.8834, 130.8752, "JP"],
    ["A12", "長崎 Nagasaki", 32.7503, 129.8779, "JP"],
    ["A13", "五島 福江 Fukue", 32.6955, 128.841, "JP"],
    ["A14", "壹岐 Iki", 33.7495, 129.6912, "JP"],
    ["A15", "下關 Shimonoseki", 33.9578, 130.9414, "JP"],
    ["A16", "石垣 Ishigaki", 24.3448, 124.1572, "JP"],
    ["A17", "與那國 Yonaguni", 24.4683, 122.9886, "JP"],
    ["A18", "稚內 Wakkanai", 45.4156, 141.6731, "JP"],
    ["A19", "釧路 Kushiro", 42.9849, 144.3814, "JP"],
    ["A20", "蔚山 Ulsan", 35.5384, 129.3114, "KR"],
    ["A21", "巨濟 Geoje", 34.8806, 128.6211, "KR"],
    ["A22", "鬱陵島 Ulleungdo", 37.4844, 130.9057, "KR"],
    ["A23", "江陵 Gangneung", 37.7519, 128.8761, "KR"],
    ["A24", "束草 Sokcho", 38.207, 128.5918, "KR"],
    ["A25", "慶州 Gyeongju", 35.8562, 129.2247, "KR"],
    ["A26", "納霍德卡 Nakhodka", 42.8240, 132.8927, "RU"],
    ["A27", "琿春 Hunchun（中國，近海參崴）", 42.8628, 130.3667, "CN"],
  ];
  for (const [id, name, lat, lng, want] of REQUIRED) eq("A", id, `countryCodeForCoordinates ${name}`, cc(lat, lng), want);

  // ════════ B. Autocomplete regionCode ════════
  {
    const geoRegion = await load("src/lib/geo-region.ts");
    const cfg = await load("src/lib/places-search-config.ts");
    const { ctx: ac, missing } = await extractFunctions("src/lib/trip-stop-search.functions.ts", ["autocompleteRegionCode"], {
      PLACES_REGION: cfg.PLACES_REGION,
      isTaiwanCoordinates: geoRegion.isTaiwanCoordinates,
      countryCodeForCoordinates: g.countryCodeForCoordinates,
    });
    if (missing.length) record("B", "B0", "autocompleteRegionCode 存在", "FAIL", `缺少 ${missing}`);
    else {
      eq("B", "B1", "Autocomplete 福岡座標 → JP", ac.autocompleteRegionCode(33.5904, 130.4017), "JP");
      eq("B", "B2", "Autocomplete 海參崴座標 → RU", ac.autocompleteRegionCode(43.1155, 131.8855), "RU");
      eq("B", "B3", "Autocomplete 釜山座標 → KR", ac.autocompleteRegionCode(35.1796, 129.0756), "KR");
      eq("B", "B4", "Autocomplete 對馬座標 → JP", ac.autocompleteRegionCode(34.2028, 129.2878), "JP");
      eq("B", "B5", "Autocomplete 高雄座標 → TW（照舊）", ac.autocompleteRegionCode(22.6273, 120.3014), "TW");
      eq("B", "B6", "Autocomplete 澎湖座標 → TW（照舊）", ac.autocompleteRegionCode(23.5711, 119.5793), "TW");
      eq("B", "B7", "Autocomplete 馬祖南竿座標 → TW（照舊）", ac.autocompleteRegionCode(26.1505, 119.9499), "TW");
      eq("B", "B8", "Autocomplete 蘭嶼座標 → TW（照舊）", ac.autocompleteRegionCode(22.0446, 121.5480), "TW");
    }
  }

  // ════════ C. 寬範圍：所有已知城市中心點 ════════
  const wide = [];
  {
    const guardSrc = fs.readFileSync(`${WORK_ROOT}/src/lib/place-geo-guard.ts`, "utf8");
    const citiesBlock = guardSrc.slice(guardSrc.indexOf("const CITIES"), guardSrc.indexOf("const COUNTRY_BY_CODE"));
    const re = /names:\s*\[([^\]]*)\],\s*country:\s*"(\w+)",\s*center:\s*\{\s*lat:\s*([-\d.]+),\s*lng:\s*([-\d.]+)/g;
    let m;
    while ((m = re.exec(citiesBlock))) {
      const name = m[1].split(",")[0].replace(/["\s]/g, "");
      wide.push({ src: "guard.CITIES", name, want: m[2], lat: Number(m[3]), lng: Number(m[4]) });
    }
    const geoSrc = fs.readFileSync(`${WORK_ROOT}/src/lib/ai/destination-geocode.ts`, "utf8");
    const start = geoSrc.indexOf("const DESTINATION_APPROX_CENTER");
    const block = geoSrc.slice(start, geoSrc.indexOf("};", start));
    const DEST_COUNTRY = {
      嘉義: "TW", 新竹: "TW", 台中: "TW", 臺中: "TW", 彰化: "TW", 花蓮: "TW", 台南: "TW", 臺南: "TW", 高雄: "TW",
      台北: "TW", 臺北: "TW", 阿里山: "TW", 台東: "TW", 臺東: "TW", 宜蘭: "TW", 屏東: "TW", 苗栗: "TW",
      東京: "JP", 橫濱: "JP", 鎌倉: "JP", 箱根: "JP", 大阪: "JP", 京都: "JP", 沖繩: "JP", 北海道: "JP", 札幌: "JP",
      九州: "JP", 福岡: "JP", 那霸: "JP", 首爾: "KR", 釜山: "KR", 濟州: "KR", 曼谷: "TH", 清邁: "TH", 新加坡: "SG",
      墨爾本: "AU", 雪梨: "AU", 巴黎: "FR", 倫敦: "GB", 愛丁堡: "GB", 曼徹斯特: "GB", 湖區: "GB", 紐約: "US",
      洛杉磯: "US", 舊金山: "US", 香港: "HK", 澳門: "MO", 摩納哥: "MC", 梵蒂岡: "VA", 峇里島: "ID", 長灘島: "PH",
      宿霧: "PH", 冰島: "IS", 雷克雅維克: "IS",
    };
    const re2 = /^\s*([^\s:]+):\s*\{\s*lat:\s*([-\d.]+),\s*lng:\s*([-\d.]+)/gm;
    while ((m = re2.exec(block))) {
      wide.push({ src: "geocode.APPROX", name: m[1], want: DEST_COUNTRY[m[1]] ?? "?", lat: Number(m[2]), lng: Number(m[3]) });
    }
  }
  const modeled = new Set(Object.keys(COUNTRY_TEXT));
  const wrongWide = [];
  const nullWide = [];
  const unmodeledWide = [];
  for (const c of wide) {
    const got = cc(c.lat, c.lng);
    c.got = got;
    if (!modeled.has(c.want)) {
      unmodeledWide.push(c);
      continue;
    }
    if (got === null) nullWide.push(c);
    else if (got !== c.want) wrongWide.push(c);
  }
  record(
    "C",
    "C1",
    `寬範圍已知城市（${wide.length} 筆）countryCodeForCoordinates 判錯 = 0`,
    wrongWide.length ? "FAIL" : "PASS",
    `判錯 ${wrongWide.length}：${wrongWide.map((c) => `${c.name}(${c.src}) 應 ${c.want} 得 ${c.got}`).join("；") || "無"}`,
  );
  record("C", "C2", "寬範圍已知城市 null 數（INFO）", "INFO", `null ${nullWide.length}：${nullWide.map((c) => `${c.name} 應 ${c.want}`).join("；") || "無"}`);
  record(
    "C",
    "C3",
    "寬範圍：未建模國家（INFO）",
    "INFO",
    unmodeledWide.map((c) => `${c.name} 實際 ${c.want} 得 ${c.got}`).join("；") || "無",
  );

  // ════════ D. 邊境／離島抽樣 ════════
  const SAMPLES = [
    ["新加坡 Singapore", 1.3521, 103.8198, "SG"],
    ["新山 Johor Bahru（市中心）", 1.4556, 103.7611, "MY"],
    ["新山 Johor Bahru（Larkin）", 1.4964, 103.7425, "MY"],
    ["巴淡島 Batam", 1.1301, 104.0529, "ID"],
    ["曼谷 Bangkok", 13.7563, 100.5018, "TH"],
    ["清邁 Chiang Mai", 18.7883, 98.9853, "TH"],
    ["烏隆他尼 Udon Thani", 17.4138, 102.7872, "TH"],
    ["孔敬 Khon Kaen", 16.4419, 102.8356, "TH"],
    ["達叻 Trat", 12.2428, 102.5175, "TH"],
    ["合艾 Hat Yai", 7.0086, 100.4747, "TH"],
    ["河內 Hanoi", 21.0278, 105.8342, "VN"],
    ["胡志明市 Ho Chi Minh City", 10.8231, 106.6297, "VN"],
    ["芹苴 Can Tho", 10.0452, 105.7469, "VN"],
    ["富國島 Phu Quoc", 10.2899, 103.984, "VN"],
    ["峴港 Da Nang", 16.0544, 108.2022, "VN"],
    ["金邊 Phnom Penh", 11.5564, 104.9282, "KH"],
    ["暹粒 Siem Reap", 13.3671, 103.8448, "KH"],
    ["南寧 Nanning", 22.817, 108.3665, "CN"],
    ["峇里島 Bali", -8.4095, 115.1889, "ID"],
    ["吉隆坡 Kuala Lumpur", 3.139, 101.6869, "MY"],
    ["檳城 Penang George Town", 5.4141, 100.3288, "MY"],
    ["蘭卡威 Langkawi", 6.35, 99.8, "MY"],
    ["亞庇 Kota Kinabalu", 5.9804, 116.0735, "MY"],
    ["馬尼拉 Manila", 14.5995, 120.9842, "PH"],
    ["宿霧 Cebu", 10.3157, 123.8854, "PH"],
    ["長灘島 Boracay", 11.9674, 121.9248, "PH"],
    ["巴丹群島 Basco", 20.4487, 121.9702, "PH"],
    ["墾丁 Kenting", 21.9483, 120.7798, "TW"],
    ["澳門 Macau", 22.1987, 113.5439, "MO"],
    ["氹仔 Taipa", 22.1567, 113.5583, "MO"],
    ["珠海 Zhuhai（市中心）", 22.2707, 113.5767, "CN"],
    ["珠海 拱北 Gongbei", 22.2166, 113.5481, "CN"],
    ["珠海 橫琴 Hengqin", 22.1333, 113.5333, "CN"],
    ["深圳 Shenzhen 福田", 22.5431, 114.0579, "CN"],
    ["深圳 羅湖 Luohu", 22.5485, 114.1315, "CN"],
    ["香港 Hong Kong", 22.3193, 114.1694, "HK"],
    ["香港 元朗 Yuen Long", 22.4445, 114.0222, "HK"],
    ["首爾 Seoul", 37.5665, 126.978, "KR"],
    ["丹東 Dandong", 40.1292, 124.3947, "CN"],
    ["大連 Dalian", 38.914, 121.6147, "CN"],
    ["青島 Qingdao", 36.0671, 120.3826, "CN"],
    ["廈門 Xiamen", 24.4798, 118.0894, "CN"],
    ["金門 Kinmen", 24.4493, 118.3767, "TW"],
    ["拉薩 Lhasa", 29.65, 91.1, "CN"],
    ["呼倫貝爾 海拉爾 Hailar", 49.2122, 119.7364, "CN"],
    ["赤峰 Chifeng", 42.2578, 118.8869, "CN"],
    ["烏蘭巴托 Ulaanbaatar", 47.8864, 106.9057, "MN"],
    ["哈巴羅夫斯克 Khabarovsk", 48.4802, 135.0719, "RU"],
    ["巴黎 Paris", 48.8566, 2.3522, "FR"],
    ["布魯塞爾 Brussels", 50.8503, 4.3517, "BE"],
    ["里爾 Lille", 50.6292, 3.0573, "FR"],
    ["史特拉斯堡 Strasbourg", 48.5734, 7.7521, "FR"],
    ["尼斯 Nice", 43.7102, 7.262, "FR"],
    ["土魯斯 Toulouse", 43.6047, 1.4442, "FR"],
    ["蒙彼利埃 Montpellier", 43.6108, 3.8767, "FR"],
    ["阿雅克肖 Ajaccio（科西嘉）", 41.9192, 8.7386, "FR"],
    ["阿姆斯特丹 Amsterdam", 52.3676, 4.9041, "NL"],
    ["慕尼黑 Munich", 48.1351, 11.582, "DE"],
    ["德勒斯登 Dresden", 51.0504, 13.7373, "DE"],
    ["柏林 Berlin", 52.52, 13.405, "DE"],
    ["維也納 Vienna", 48.2082, 16.3738, "AT"],
    ["蘇黎世 Zurich", 47.3769, 8.5417, "CH"],
    ["日內瓦 Geneva", 46.2044, 6.1432, "CH"],
    ["米蘭 Milan", 45.4642, 9.19, "IT"],
    ["科莫 Como", 45.8081, 9.0852, "IT"],
    ["波札諾 Bolzano", 46.4983, 11.3548, "IT"],
    ["里斯本 Lisbon", 38.7223, -9.1393, "PT"],
    ["塞維亞 Seville", 37.3891, -5.9845, "ES"],
    ["倫敦 London", 51.5074, -0.1278, "GB"],
    ["貝爾法斯特 Belfast", 54.5973, -5.9301, "GB"],
    ["都柏林 Dublin", 53.3498, -6.2603, "IE"],
    ["雅典 Athens", 37.9838, 23.7275, "GR"],
    ["伊斯坦堡 Istanbul", 41.0082, 28.9784, "TR"],
    ["伊茲密爾 Izmir", 38.4237, 27.1428, "TR"],
    ["卡帕多奇亞 Göreme", 38.6431, 34.8289, "TR"],
    ["杜拜 Dubai", 25.2048, 55.2708, "AE"],
    ["阿布達比 Abu Dhabi", 24.4539, 54.3773, "AE"],
    ["開羅 Cairo", 30.0444, 31.2357, "EG"],
    ["紐約 New York", 40.7128, -74.006, "US"],
    ["西雅圖 Seattle", 47.6062, -122.3321, "US"],
    ["溫哥華 Vancouver", 49.2827, -123.1207, "CA"],
    ["維多利亞 Victoria BC", 48.4284, -123.3656, "CA"],
    ["多倫多 Toronto", 43.6532, -79.3832, "CA"],
    ["蒙特婁 Montreal", 45.5017, -73.5673, "CA"],
    ["卡加利 Calgary", 51.0447, -114.0719, "CA"],
    ["休士頓 Houston", 29.7604, -95.3698, "US"],
    ["聖地牙哥 San Diego", 32.7157, -117.1611, "US"],
    ["紐奧良 New Orleans", 29.9511, -90.0715, "US"],
    ["邁阿密 Miami", 25.7617, -80.1918, "US"],
    ["檀香山 Honolulu", 21.3069, -157.8583, "US"],
    ["關島 Guam", 13.4443, 144.7937, "US"],
    ["坎昆 Cancún", 21.1619, -86.8515, "MX"],
    ["雪梨 Sydney", -33.8688, 151.2093, "AU"],
    ["奧克蘭 Auckland", -36.8485, 174.7633, "NZ"],
    ["皇后鎮 Queenstown", -45.0312, 168.6626, "NZ"],
    ["馬列 Malé", 4.1755, 73.5093, "MV"],
    ["雷克雅維克 Reykjavik", 64.1466, -21.9426, "IS"],
    // 未建模國家：理想為 null（回傳其他國家只列 INFO，供評估）
    ["永珍 Vientiane（寮國，未建模）", 17.9757, 102.6331, "LA"],
    ["加德滿都 Kathmandu（尼泊爾，未建模）", 27.7172, 85.324, "NP"],
    ["可倫坡 Colombo（斯里蘭卡，未建模）", 6.9271, 79.8612, "LK"],
    ["多哈 Doha（卡達，未建模）", 25.2854, 51.531, "QA"],
    ["阿拉木圖 Almaty（哈薩克，未建模）", 43.222, 76.8512, "KZ"],
    ["仰光 Yangon（緬甸，未建模）", 16.8409, 96.1735, "MM"],
    ["佩特拉 Petra（約旦，未建模）", 30.3285, 35.4444, "JO"],
    ["平壤 Pyongyang（北韓，未建模）", 39.0392, 125.7625, "KP"],
    ["開城 Kaesong（北韓，未建模）", 37.9708, 126.5544, "KP"],
    ["莫斯科 Moscow", 55.7558, 37.6173, "RU"],
  ];
  const wrongSample = [];
  const nullSample = [];
  const unmodeledSample = [];
  for (const [name, lat, lng, want] of SAMPLES) {
    const got = cc(lat, lng);
    if (!modeled.has(want)) {
      unmodeledSample.push(`${name} 得 ${got}`);
      continue;
    }
    if (got === want) continue;
    if (got === null) nullSample.push(`${name} 應 ${want}`);
    else wrongSample.push(`${name} 應 ${want} 得 ${got}`);
  }
  record("D", "D1", `邊境／離島抽樣（${SAMPLES.length} 筆，含 ${unmodeledSample.length} 筆未建模）判錯 = 0`, wrongSample.length ? "FAIL" : "PASS", `判錯 ${wrongSample.length}：${wrongSample.join("；") || "無"}`);
  record("D", "D2", "邊境抽樣 null（INFO）", "INFO", `null ${nullSample.length}：${nullSample.join("；") || "無"}`);
  record("D", "D3", "未建模國家抽樣（INFO）", "INFO", unmodeledSample.join("；"));

  // ════════ E. 國家框涵蓋（會不會丟棄正確地點）════════
  const containmentFails = [];
  const allPoints = [
    ...wide.filter((c) => modeled.has(c.want)).map((c) => [c.name, c.lat, c.lng, c.want]),
    ...SAMPLES.filter((s) => modeled.has(s[3])),
    ["聖彼得堡 St Petersburg", 59.9311, 30.3609, "RU"],
    ["豪勳爵島 Lord Howe Island", -31.5553, 159.0821, "AU"],
    ["休達 Ceuta", 35.8894, -5.3213, "ES"],
    ["獨島 Dokdo", 37.2411, 131.8647, "KR"],
    ["阿留申 Adak", 51.88, -176.6581, "US"],
    ["馬祖 東引", 26.3667, 120.4833, "TW"],
    ["小笠原 父島", 27.0944, 142.1917, "JP"],
  ];
  for (const [name, lat, lng, want] of allPoints) {
    const text = `${name}, ${COUNTRY_TEXT[want]}`;
    // 方向 1：handoff 有自身座標、候選文字含正確國名 → 不得 mismatch（否則丟棄正確候選）
    const v1 = g.judgeCandidateGeo(g.buildPlaceGeoContext({ lat, lng }), text);
    // 方向 2：handoff 有正確國家地址、Details 抓回的座標在該國 → 不得拒絕
    const ok2 = g.isResolvedPlaceGeoConsistent({ address: `Somewhere, ${COUNTRY_TEXT[want]}` }, { lat, lng, address: text });
    if (v1 === "mismatch" || !ok2) containmentFails.push(`${name}(${want}) 候選判定=${v1} Details 接受=${ok2}`);
  }
  record("E", "E1", `國家框涵蓋：${allPoints.length} 個真實地點不得被判為他國（不得丟棄正確候選／拒絕正確 Details）`, containmentFails.length ? "FAIL" : "PASS", containmentFails.join("；") || "無");

  // ════════ F. resolve 層 ════════
  const resolveMod = await load("src/lib/place-detail-resolve.ts");
  const savedUtils = await load("src/lib/saved-place-utils.ts");
  const tripHandoff = await load("src/lib/trip/trip-itinerary-place-handoff.ts");
  const { resolveGooglePlaceIdForDetail } = resolveMod;
  const POI = ["point_of_interest", "establishment"];
  const UB = { placeId: "ChIJ_UB_SYDNEY_TOWER_MN", label: "Sydney Tower", secondary: "Chinggis Avenue, Ulaanbaatar, Mongolia", types: ["premise", ...POI] };
  const SYD = { placeId: "ChIJ_SYD_SYDNEY_TOWER_EYE_AU", label: "Sydney Tower Eye", secondary: "Market Street, Sydney NSW, Australia", types: ["tourist_attraction", ...POI] };
  const SYD_EXACT = { ...SYD, placeId: "ChIJ_SYD_SYDNEY_TOWER_AU", label: "Sydney Tower" };
  const UNK_EXACT = { placeId: "ChIJ_UNK_SYDNEY_TOWER", label: "Sydney Tower", secondary: "Market Street", types: ["tourist_attraction", ...POI] };
  const LA_SAPPORO = { placeId: "ChIJ_LA_SAPPORO_BEER_MUSEUM_US", label: "札幌啤酒博物館", secondary: "Los Angeles, CA, USA", types: ["restaurant", ...POI] };
  const JP_SAPPORO = { placeId: "ChIJ_SPK_SAPPORO_BEER_MUSEUM_JP", label: "札幌啤酒博物館", secondary: "日本北海道札幌市東區", types: ["museum", ...POI] };
  const SYDNEY = { lat: -33.8705, lng: 151.2089 };

  const runResolve = async (id, title, handoff, candidates, check, maxSearches) => {
    searchLog = [];
    candidateProvider = () => candidates;
    const before = externalCalls;
    let got = null;
    let err = null;
    console.info = console.log = console.warn = console.debug = () => {};
    try {
      got = (await resolveGooglePlaceIdForDetail(handoff, "zh-TW")) ?? null;
    } catch (e) {
      err = e;
    } finally {
      Object.assign(console, origConsole);
    }
    const problems = [];
    if (err) problems.push(`例外 ${err?.message ?? err}`);
    const v = check(got);
    if (v !== true) problems.push(v);
    if (searchLog.length > maxSearches) problems.push(`searchPlaces ${searchLog.length} 次 > 上限 ${maxSearches}`);
    if (externalCalls !== before) problems.push("外部網路呼叫");
    record("F", id, title, problems.length ? "FAIL" : "PASS", `got=${got} searches=${searchLog.length} centers=${searchLog.map((s) => (s.center ? `${s.center.lat},${s.center.lng}` : "none")).join("|")} ${problems.join("；")}`);
  };
  const is = (want) => (got) => (got === want ? true : `got ${got} want ${want}`);
  const base = (o) => ({ placeId: `saved-${o.name}`, address: null, lat: null, lng: null, ...o });

  await runResolve("F1", "context-only contextCountry=AU（無地址、無座標）→ 丟棄蒙古同名、採用雪梨", base({ name: "Sydney Tower", contextCountry: "AU" }), [UB, SYD], is(SYD.placeId), 1);
  // F2（B14 指派者裁定）：context 國家只影響排序 → 唯一候選 UB 可被採用（或 null），但同一案例 Details 必須被拒絕。
  await runResolve("F2", "context-only contextCountry=Australia、唯一候選是蒙古同名 → 可採用 UB（或 null），查詢 1 次", base({ name: "Sydney Tower", contextCountry: "Australia" }), [UB], (got) => (got === UB.placeId || got === null ? true : `got ${got}`), 1);
  {
    const f2Handoff = base({ name: "Sydney Tower", contextCountry: "Australia" });
    const ubDetails = [
      g.isResolvedPlaceGeoConsistent(f2Handoff, { lat: 47.9184, lng: 106.9177, address: "Chinggis Avenue, Ulaanbaatar, Mongolia" }),
      g.isResolvedPlaceGeoConsistent(f2Handoff, { lat: 47.9184, lng: 106.9177, address: "Chinggis Avenue" }),
      g.isResolvedPlaceGeoConsistent(f2Handoff, { lat: 47.9184, lng: 106.9177, address: null }),
    ];
    eq("F", "F2b", "F2 同一案例：Details 抓回烏蘭巴托（含國名／無國名／無地址）→ 全部拒絕", ubDetails, [false, false, false]);
  }
  await runResolve("F3", "context-only contextCity=札幌（無國家）→ 丟棄洛杉磯同名、採用札幌", base({ name: "札幌啤酒博物館", contextCity: "札幌" }), [LA_SAPPORO, JP_SAPPORO], is(JP_SAPPORO.placeId), 1);
  await runResolve("F4", "context-only contextCity=Sydney、他國完全同名排第一 → 採用雪梨完全同名", base({ name: "Sydney Tower", contextCity: "Sydney" }), [UB, SYD_EXACT], is(SYD_EXACT.placeId), 1);
  await runResolve("F5", "context-only、候選看不出國家（unknown）→ 保留（唯一候選時採用）", base({ name: "Sydney Tower", contextCountry: "AU" }), [UNK_EXACT], is(UNK_EXACT.placeId), 1);
  // F6（B10 指派者裁定）：依規則 1，context-only 時 unknown 完全同名可勝出（同 HEAD）；安全靠 Details 防護 G3。
  await runResolve("F6", "context-only、unknown 完全同名 vs 雪梨非完全同名 → 解析為 SYD 或 unknown 候選", base({ name: "Sydney Tower", contextCountry: "AU" }), [UNK_EXACT, SYD], (got) => (got === SYD.placeId || got === UNK_EXACT.placeId ? true : `got ${got}`), 1);
  {
    const f6Ctx = { name: "Sydney Tower", contextCountry: "AU" };
    const ub = g.isResolvedPlaceGeoConsistent(f6Ctx, { lat: 47.9184, lng: 106.9177, address: null });
    const ubAddr = g.isResolvedPlaceGeoConsistent(f6Ctx, { lat: 47.9184, lng: 106.9177, address: "Chinggis Avenue, Ulaanbaatar, Mongolia" });
    const syd = g.isResolvedPlaceGeoConsistent(f6Ctx, { lat: -33.8705, lng: 151.2089, address: "Market Street" });
    eq("F", "F6b", "F6 後續：unknown 候選抓回 Details 在烏蘭巴托（只有座標／含地址）→ false；在雪梨 → true", [ub, ubAddr, syd], [false, false, true]);
  }
  await runResolve("F7", "規則 3：自身座標在雪梨、contextCountry=JP（錯）→ context 不得丟棄雪梨候選", base({ name: "Sydney Tower Eye", ...SYDNEY, contextCountry: "JP" }), [SYD], is(SYD.placeId), 1);
  await runResolve("F8", "規則 3：自身地址無國名、contextCountry=MN（錯）→ 不得丟棄雪梨候選", base({ name: "Sydney Tower Eye", address: "100 Market St", contextCountry: "MN" }), [SYD], is(SYD.placeId), 2);
  await runResolve("F9", "規則 3：自身座標在雪梨、contextCity=台北（舊收藏）→ 他國同名仍以座標丟棄", base({ name: "Sydney Tower", ...SYDNEY, contextCity: "台北" }), [UB, SYD], (g2) => (g2 === UB.placeId ? "選到蒙古同名" : true), 1);
  {
    const savedRow = { id: "row-b8", name: "Sydney Tower", category: "tourist_attraction", address: null, city: "雪梨", lat: null, lng: null, notes: null, mood_tag: null, cover_image: null, image_url: null, image_source: null, metadata: {}, created_at: "2026-11-05T00:00:00.000Z" };
    await runResolve("F10", "收藏清單入口 savedPlaceToHandoff（city=雪梨，無地址座標）→ 丟棄蒙古同名", savedUtils.savedPlaceToHandoff(savedRow), [UB, SYD], is(SYD.placeId), 1);
    const item = { id: "it-1", title: "Sydney Tower", placeName: "Sydney Tower", lat: null, lng: null, address: null, time: "10:00" };
    let h = null;
    try {
      h = tripHandoff.itineraryItemToPlaceHandoff(item, "zh-TW", { city: "Sydney", country: "Australia" });
    } catch (e) {
      record("F", "F11", "行程點 itineraryItemToPlaceHandoff 建立 handoff", "FAIL", String(e?.message ?? e));
    }
    if (h) {
      eq("F", "F11a", "行程點 handoff 帶 contextCity／contextCountry", [h.contextCity, h.contextCountry], ["Sydney", "Australia"]);
      await runResolve("F11", "行程點入口（目的地 Sydney／Australia，無地址座標）→ 丟棄蒙古同名", h, [UB, SYD], is(SYD.placeId), 1);
      const hExt = tripHandoff.itineraryItemToPlaceHandoff({ ...item, destinationScope: "nearby_extension", extensionDestination: "藍山" }, "zh-TW", { city: "Sydney", country: "Australia" });
      eq("F", "F12", "延伸行程點：contextCity=延伸目的地、帶入主目的地 contextCountry", [hExt.contextCity, hExt.contextCountry], ["藍山", "Australia"]);
    }
  }
  await runResolve("F13", "d1 無任何地理脈絡 → 維持舊行為（完全同名 +100，採用第一個完全同名）", base({ name: "Sydney Tower" }), [UB, SYD], is(UB.placeId), 1);

  // F14（INFO）：台灣地址、完全同名候選的 secondary 看不出國家 → 依規則 1 不給 +100；記錄與 HEAD 計分的差異
  {
    const TPE_EXACT_UNK = { placeId: "ChIJ_TPE_101_EXACT_UNK", label: "台北101", secondary: "信義路五段7號", types: ["tourist_attraction", ...POI] };
    const TPE_MALL = { placeId: "ChIJ_TPE_101_MALL_TW", label: "台北101購物中心", secondary: "台灣台北市信義區市府路45號", types: ["shopping_mall", ...POI] };
    searchLog = [];
    candidateProvider = () => [TPE_EXACT_UNK, TPE_MALL];
    console.info = console.log = console.warn = console.debug = () => {};
    let got = null;
    try {
      got = await resolveGooglePlaceIdForDetail(base({ name: "台北101", address: "台北市信義區" }), "zh-TW");
    } finally {
      Object.assign(console, origConsole);
    }
    // B10：規則 1 下 unknown 完全同名照 HEAD 給 +100（140），購物中心 40+20=60 → 與 HEAD 相同選完全同名。
    record("F", "F14", "台灣：地址「台北市信義區」、完全同名 unknown vs 非完全同名台灣候選 → 與 HEAD 相同選完全同名", got === TPE_EXACT_UNK.placeId && searchLog.length <= 1 ? "PASS" : "FAIL", `got=${got} searches=${searchLog.length} want=${TPE_EXACT_UNK.placeId}`);
  }

  // ════════ H. B10 未收錄的真實地點（非中心點；判成他國 = FAIL，null 可接受）════════
  {
    const OFF = [
      // 日本
      ["名古屋城", 35.1856, 136.8999, "JP"], ["仙台 松島", 38.3686, 141.0628, "JP"], ["廣島 宮島", 34.2959, 132.3199, "JP"], ["金澤 兼六園", 36.5621, 136.6626, "JP"],
      ["高山", 36.1461, 137.2522, "JP"], ["白川鄉", 36.2578, 136.9063, "JP"], ["日光", 36.7199, 139.6982, "JP"], ["青森", 40.8222, 140.7474, "JP"],
      ["岡山", 34.6551, 133.9195, "JP"], ["熊本", 32.8031, 130.7079, "JP"], ["別府", 33.2846, 131.4914, "JP"], ["富良野", 43.342, 142.3832, "JP"],
      ["宮古島", 24.8055, 125.2811, "JP"], ["奄美", 28.377, 129.494, "JP"], ["河口湖", 35.5167, 138.75, "JP"], ["新潟", 37.9161, 139.0364, "JP"],
      // 韓國
      ["大邱 西門市場", 35.869, 128.581, "KR"], ["光州 忠壯路", 35.1468, 126.923, "KR"], ["全州 韓屋村", 35.8242, 127.148, "KR"], ["安東 河回村", 36.5391, 128.5187, "KR"],
      ["春川", 37.8813, 127.7298, "KR"], ["水原華城", 37.2871, 127.0119, "KR"], ["大田", 36.3504, 127.3845, "KR"], ["西歸浦", 33.2541, 126.5601, "KR"], ["統營", 34.8544, 128.4331, "KR"], ["坡州 DMZ", 37.8895, 126.7400, "KR"],
      // 台灣
      ["台中 逢甲", 24.1797, 120.646, "TW"], ["花蓮 太魯閣", 24.1586, 121.6214, "TW"], ["小琉球", 22.34, 120.37, "TW"], ["金門 金城", 24.4329, 118.3171, "TW"], ["馬祖 北竿", 26.2219, 120.0, "TW"],
      // 中國
      ["西安 兵馬俑", 34.3841, 109.2785, "CN"], ["成都 熊貓基地", 30.733, 104.146, "CN"], ["昆明 石林", 24.8167, 103.325, "CN"], ["大理", 25.6065, 100.2676, "CN"],
      ["麗江", 26.8721, 100.2299, "CN"], ["張家界", 29.117, 110.479, "CN"], ["黃山", 30.13, 118.17, "CN"], ["蘇州", 31.299, 120.5853, "CN"], ["武漢", 30.5928, 114.3055, "CN"],
      ["陽朔", 24.7781, 110.4966, "CN"], ["福州", 26.0745, 119.2965, "CN"], ["泉州", 24.8741, 118.6758, "CN"], ["平潭", 25.5, 119.79, "CN"], ["東莞", 23.0207, 113.7518, "CN"], ["中山", 22.5176, 113.3926, "CN"], ["三亞", 18.2528, 109.5119, "CN"],
      // 港澳
      ["香港 大嶼山天壇大佛", 22.254, 113.905, "HK"], ["香港 赤柱", 22.219, 114.211, "HK"], ["香港 沙田", 22.383, 114.188, "HK"], ["澳門 大三巴", 22.1973, 113.5409, "MO"], ["澳門 路環", 22.1166, 113.566, "MO"],
      // 東南亞
      ["普吉 芭東", 7.8961, 98.2964, "TH"], ["華欣", 12.5684, 99.9577, "TH"], ["蘇美島", 9.512, 100.0136, "TH"], ["清萊", 19.9105, 99.8406, "TH"], ["拜縣", 19.3583, 98.4417, "TH"], ["北碧", 14.0228, 99.5328, "TH"], ["象島", 12.05, 102.33, "TH"],
      ["會安古鎮", 15.8794, 108.335, "VN"], ["大叻", 11.9404, 108.4583, "VN"], ["下龍灣", 20.9101, 107.1839, "VN"], ["寧平", 20.2506, 105.9745, "VN"], ["美奈", 10.9333, 108.2833, "VN"], ["頭頓", 10.346, 107.0843, "VN"], ["海防", 20.8449, 106.6881, "VN"],
      ["薄荷島", 9.65, 123.85, "PH"], ["愛妮島", 11.1956, 119.4075, "PH"], ["錫亞高", 9.8482, 126.0458, "PH"], ["碧瑤", 16.4023, 120.596, "PH"], ["怡朗", 10.7202, 122.5621, "PH"], ["科隆", 11.9986, 120.2043, "PH"], ["美岸", 17.5747, 120.3869, "PH"],
      ["怡保", 4.5975, 101.0901, "MY"], ["金馬崙", 4.4718, 101.3767, "MY"], ["哥打峇魯", 6.1254, 102.2381, "MY"], ["山打根", 5.8394, 118.1172, "MY"],
      ["新加坡 聖淘沙", 1.2494, 103.8303, "SG"], ["新加坡 樟宜", 1.3644, 103.9915, "SG"], ["新加坡 兀蘭", 1.4382, 103.789, "SG"],
      ["峇里 烏布", -8.5069, 115.2625, "ID"], ["龍目島", -8.5833, 116.1167, "ID"], ["萬隆", -6.9175, 107.6191, "ID"], ["婆羅浮屠", -7.6079, 110.2038, "ID"],
      ["馬德望", 13.0957, 103.2022, "KH"], ["西哈努克", 10.6093, 103.5296, "KH"], ["貢布", 10.6104, 104.1815, "KH"],
      // 大洋洲
      ["墨爾本 大洋路 Lorne", -38.542, 143.975, "AU"], ["伯斯 費里曼圖", -32.0569, 115.7439, "AU"], ["凱恩斯 濱海", -16.92, 145.78, "AU"], ["拜倫灣", -28.6474, 153.602, "AU"],
      ["藍山 Katoomba", -33.712, 150.311, "AU"], ["紐卡索", -32.9283, 151.7817, "AU"], ["湯斯維爾", -19.259, 146.8169, "AU"], ["朗塞斯頓", -41.4332, 147.1441, "AU"], ["烏魯魯", -25.3444, 131.0369, "AU"],
      ["奧克蘭 天空塔", -36.8485, 174.7622, "NZ"], ["哈比村", -37.8721, 175.6829, "NZ"], ["陶波", -38.6857, 176.0702, "NZ"], ["但尼丁", -45.8788, 170.5028, "NZ"], ["蒂卡波", -44.0047, 170.4772, "NZ"], ["瓦納卡", -44.7032, 169.1321, "NZ"],
      // 北美
      ["洛杉磯 聖塔莫尼卡", 34.0195, -118.4912, "US"], ["迪士尼 安那翰", 33.8121, -117.919, "US"], ["芝加哥 千禧公園", 41.8826, -87.6226, "US"], ["邁阿密海灘", 25.7907, -80.13, "US"],
      ["檀香山 威基基", 21.2793, -157.8292, "US"], ["大峽谷", 36.0544, -112.1401, "US"], ["優勝美地", 37.8651, -119.5383, "US"], ["費城", 39.9526, -75.1652, "US"],
      ["丹佛", 39.7392, -104.9903, "US"], ["亞特蘭大", 33.749, -84.388, "US"], ["奧斯汀", 30.2672, -97.7431, "US"], ["底特律", 42.3314, -83.0458, "US"],
      ["尼加拉瀑布 美國側", 43.0962, -79.0377, "US"], ["貝靈漢", 48.7519, -122.4787, "US"], ["聖地牙哥 海洋世界", 32.7641, -117.2264, "US"], ["西雅圖 雷尼爾山", 46.8523, -121.7603, "US"],
      ["卡加利 塔", 51.0443, -114.0631, "CA"], ["露易絲湖", 51.4254, -116.1773, "CA"], ["惠斯勒", 50.1163, -122.9574, "CA"], ["尼加拉瀑布 加拿大側", 43.0896, -79.0849, "CA"], ["翠湖 Mont-Tremblant", 46.1185, -74.5962, "CA"], ["溫哥華 史丹利公園", 49.3043, -123.1443, "CA"],
      ["坎昆 Playa del Carmen", 20.6296, -87.0739, "MX"],
      // 歐洲
      ["里昂 老城", 45.762, 4.827, "FR"], ["馬賽 舊港", 43.2951, 5.374, "FR"], ["凡爾賽", 48.8049, 2.1204, "FR"], ["亞維農", 43.9493, 4.8055, "FR"], ["安錫", 45.8992, 6.1294, "FR"], ["霞慕尼", 45.9237, 6.8694, "FR"], ["科爾馬", 48.0794, 7.3585, "FR"], ["坎城", 43.5528, 7.0174, "FR"],
      ["米蘭 大教堂", 45.4642, 9.1916, "IT"], ["拿坡里 港口", 40.84, 14.25, "IT"], ["阿瑪菲", 40.634, 14.6027, "IT"], ["龐貝", 40.7462, 14.4989, "IT"], ["五漁村", 44.127, 9.712, "IT"], ["維洛那", 45.4384, 10.9916, "IT"], ["西恩納", 43.3188, 11.3308, "IT"], ["的里雅斯特", 45.6495, 13.7768, "IT"], ["科蒂納", 46.5405, 12.1357, "IT"],
      ["柏林 布蘭登堡門", 52.5163, 13.3777, "DE"], ["漢堡 倉庫城", 53.544, 9.993, "DE"], ["新天鵝堡", 47.5576, 10.7498, "DE"], ["加爾米施", 47.4917, 11.0955, "DE"], ["貝希特斯加登", 47.6309, 13.001, "DE"], ["康斯坦茲", 47.6779, 9.1732, "DE"], ["弗萊堡", 47.999, 7.8421, "DE"], ["海德堡", 49.3988, 8.6724, "DE"], ["萊比錫", 51.3397, 12.3731, "DE"],
      ["維也納 美泉宮", 48.1845, 16.3122, "AT"], ["格拉茲", 47.0707, 15.4395, "AT"],
      ["蘇黎世 湖畔", 47.3667, 8.545, "CH"], ["采爾馬特", 46.0207, 7.7491, "CH"], ["巴塞爾", 47.5596, 7.5886, "CH"], ["聖莫里茲", 46.4908, 9.8355, "CH"],
      ["布拉格 查理大橋", 50.0865, 14.4114, "CZ"], ["卡羅維瓦利", 50.231, 12.871, "CZ"],
      ["巴塞隆納 聖家堂", 41.4036, 2.1744, "ES"], ["蒙特塞拉特", 41.5934, 1.8379, "ES"], ["伊比沙", 38.9067, 1.4206, "ES"], ["聖塞巴斯蒂安", 43.3183, -1.9812, "ES"], ["維戈", 42.2406, -8.7207, "ES"], ["聖地牙哥德孔波斯特拉", 42.8782, -8.5448, "ES"], ["托雷多", 39.8628, -4.0273, "ES"],
      ["里斯本 貝倫塔", 38.6916, -9.216, "PT"], ["辛特拉", 38.8029, -9.3817, "PT"], ["拉哥斯", 37.1028, -8.673, "PT"],
      ["阿姆斯特丹 水壩廣場", 52.3731, 4.8926, "NL"], ["烏特勒支", 52.0907, 5.1214, "NL"], ["羊角村", 52.74, 6.08, "NL"], ["恩荷芬", 51.4416, 5.4697, "NL"], ["馬斯垂克", 50.8514, 5.691, "NL"],
      ["根特", 51.0543, 3.7174, "BE"],
      ["愛丁堡 城堡", 55.9486, -3.1999, "GB"], ["巴斯", 51.3811, -2.359, "GB"], ["約克", 53.96, -1.0873, "GB"], ["卡地夫", 51.4816, -3.1791, "GB"], ["倫敦德里", 54.9966, -7.3086, "GB"],
      ["莫赫斷崖", 52.9715, -9.4309, "IE"], ["基拉尼", 52.0599, -9.5044, "IE"],
      ["以弗所", 37.9395, 27.3417, "TR"], ["吉薩金字塔", 29.9792, 31.1342, "EG"], ["沙姆沙伊赫", 27.9158, 34.33, "EG"], ["藍湖溫泉", 63.8804, -22.4495, "IS"],
      ["莫斯科 紅場", 55.7539, 37.6208, "RU"], ["聖彼得堡 冬宮", 59.9398, 30.3146, "RU"], ["彼得夏宮", 59.8863, 29.9086, "RU"], ["謝爾吉耶夫鎮", 56.3153, 38.1359, "RU"],
    ];
    const wrong = [];
    const nulls = [];
    for (const [name, lat, lng, want] of OFF) {
      const got = cc(lat, lng);
      if (got === want) continue;
      if (got === null) nulls.push(name);
      else wrong.push(`${name} 應 ${want} 得 ${got}`);
    }
    record("H", "H1", `未收錄真實地點抽樣（${OFF.length} 筆，非中心點）判成他國 = 0`, wrong.length ? "FAIL" : "PASS", `判錯 ${wrong.length}：${wrong.join("；") || "無"}`);
    record("H", "H2", "未收錄真實地點 null（可接受，INFO）", "INFO", `null ${nulls.length}：${nulls.join("；") || "無"}`);

    // H3：判錯的實際影響 — handoff 只有正確國家地址（無座標），Details 抓回正確座標 → 不得拒絕
    const rejected = [];
    for (const [name, lat, lng, want] of OFF) {
      const ok = g.isResolvedPlaceGeoConsistent({ name, address: `${name}, ${COUNTRY_TEXT[want]}` }, { lat, lng, address: `${name}, ${COUNTRY_TEXT[want]}` });
      if (!ok) rejected.push(`${name}(${want})`);
    }
    record("H", "H3", "影響：handoff 地址含正確國名、無座標，Details 抓回正確地點 → 不得拒絕（HEAD 會接受）", rejected.length ? "FAIL" : "PASS", `被拒 ${rejected.length}：${rejected.join("；") || "無"}`);

    // H4：判錯的實際影響 — handoff 有自身座標、Autocomplete 正確候選 secondary 含正確國名 → 不得丟棄
    const dropped = [];
    for (const [name, lat, lng, want] of OFF) {
      const v = g.judgeCandidateGeo(g.buildPlaceGeoContext({ lat, lng }), `${name}, ${COUNTRY_TEXT[want]}`);
      if (v === "mismatch") dropped.push(`${name}(${want})`);
    }
    record("H", "H4", "影響：handoff 有自身座標，正確候選 secondary 含正確國名 → 不得丟棄（HEAD 會採用）", dropped.length ? "FAIL" : "PASS", `被丟 ${dropped.length}：${dropped.join("；") || "無"}`);

    // H5：端到端 — 新天鵝堡：handoff 只有德國地址，Details 抓回真實座標
    eq("H", "H5", "端到端 Details：新天鵝堡 handoff 地址「Schwangau, Germany」、Details 座標 47.5576,10.7498 地址 Germany → 應接受", g.isResolvedPlaceGeoConsistent({ name: "Neuschwanstein Castle", address: "Neuschwansteinstraße 20, 87645 Schwangau, Germany" }, { lat: 47.5576, lng: 10.7498, address: "Neuschwansteinstraße 20, 87645 Schwangau, Germany" }), true);
    // H6：端到端 resolve — 福州三坊七巷 handoff 座標、候選 secondary 中國 → 應採用
    await runResolve("H6", "端到端 resolve：福州三坊七巷 handoff 只有座標、唯一候選在中國福州 → 應採用（HEAD 會採用）", base({ name: "三坊七巷", lat: 26.0858, lng: 119.2964 }), [{ placeId: "ChIJ_FOC_SFQX_CN", label: "三坊七巷", secondary: "中國福建省福州市鼓樓區", types: ["tourist_attraction", ...POI] }], is("ChIJ_FOC_SFQX_CN"), 1);
  }

  // ════════ G. Details 防護 ════════
  const cons = g.isResolvedPlaceGeoConsistent;
  eq("G", "G1", "Details：context-only AU、抓回烏蘭巴托 → 拒絕", cons({ name: "x", contextCountry: "AU" }, { lat: 47.92, lng: 106.92, address: "Ulaanbaatar, Mongolia" }), false);
  eq("G", "G2", "Details：context-only AU、抓回雪梨 → 接受", cons({ name: "x", contextCountry: "AU" }, { lat: -33.87, lng: 151.21, address: "Market St, Sydney NSW 2000, Australia" }), true);
  eq("G", "G3", "Details：context-only city=雪梨、抓回烏蘭巴托（只有座標）→ 拒絕", cons({ name: "x", contextCity: "雪梨" }, { lat: 47.92, lng: 106.92, address: null }), false);
  eq("G", "G4", "Details：自身座標雪梨＋contextCountry=JP（錯）、抓回雪梨 → 接受（context 不參與）", cons({ name: "x", ...SYDNEY, contextCountry: "JP" }, { lat: -33.87, lng: 151.21, address: "Sydney NSW, Australia" }), true);
  // G5（B18 指派者裁定，規則 E）：地址存在但沒寫國名 → 參考國為 context（台北＝TW）；Details 明確寫 Australia、距 TW 錨點 > 400 km → 拒絕。
  eq("G", "G5", "Details：自身地址無國名＋contextCity=台北、抓回雪梨（明確 Australia）→ 拒絕（B18 規則 E）", cons({ name: "x", address: "100 Market St", contextCity: "台北" }, { lat: -33.87, lng: 151.21, address: "Sydney NSW, Australia" }), false);
  eq("G", "G5b", "Details：自身地址無國名＋contextCity=台北、抓回雪梨（只有座標）→ 拒絕（> 2000 km 且推得 AU）", cons({ name: "x", address: "100 Market St", contextCity: "台北" }, { lat: -33.87, lng: 151.21, address: null }), false);
  eq("G", "G5c", "Details：自身地址無國名、無 context、無座標、抓回雪梨 → 接受（與 HEAD 相同）", cons({ name: "x", address: "100 Market St" }, { lat: -33.87, lng: 151.21, address: "Sydney NSW, Australia" }), true);
  eq("G", "G6", "Details：無任何脈絡 → 接受（舊行為）", cons({ name: "x" }, { lat: 47.92, lng: 106.92, address: "Ulaanbaatar, Mongolia" }), true);
  eq("G", "G7", "Details：context-only 國家=日本、抓回福岡 → 接受", cons({ name: "x", contextCountry: "日本" }, { lat: 33.5904, lng: 130.4017, address: "日本福岡縣福岡市" }), true);
  // G8（B14 指派者裁定）：規則 3d，距韓國已知中心點（釜山）約 70 km < 400 km → 接受（跨國一日遊）。
  eq("G", "G8", "Details：context-only 國家=韓國、抓回對馬（日本，距釜山約 70 km）→ 接受", cons({ name: "x", contextCountry: "韓國" }, { lat: 34.2028, lng: 129.2878, address: "日本長崎縣對馬市" }), true);

  // ── 輸出 ──────────────────────────────────────────────────────────
  const out = ["\n=== verify-place-geo-coords-audit ==="];
  for (const r of results) out.push(`[${r.status}] ${r.sec}/${r.id} ${r.title}\n       ${r.detail}`);
  out.push(`[INFO] 外部網路呼叫總數 = ${externalCalls}${externalCalls ? ` ${externalLog.join("; ")}` : ""}`);
  const failed = results.filter((r) => r.status === "FAIL");
  out.push(`摘要：PASS ${results.filter((r) => r.status === "PASS").length}／FAIL ${failed.length}／INFO ${results.filter((r) => r.status === "INFO").length}${failed.length ? `；失敗：${failed.map((r) => `${r.sec}/${r.id}`).join(", ")}` : ""}`);
  process.stdout.write(`${out.join("\n")}\n`);
  if (failed.length || externalCalls > 0) exitCode = 1;
} catch (e) {
  Object.assign(console, origConsole);
  process.stdout.write(`[geo-coords-audit] 執行失敗：${e?.stack ?? e}\n`);
  exitCode = 1;
} finally {
  await server.close().catch(() => {});
  clearTimeout(watchdog);
}
process.exit(exitCode);
