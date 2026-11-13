#!/usr/bin/env node
/**
 * B16（tester 獨立抽樣，第 6 輪）— 同名不同國家地點：重點「擋錯」，點位與既有腳本不重複。
 *
 *  P1 地址含他國城市名／國名子字串的正確地點（35+ 點）：各 handoff 組合最終須顯示正確地點。
 *     對照 HEAD（scratchpad/snap-HEAD 的 place-detail-resolve.ts，無地理防護）。
 *  P2 四語系 Details／候選地址格式（zh-TW／en／ja／ko）的正確地點 24 點：
 *     handoff 地址語系 × Details 語系 16 組、context 國名（四語系）、自身座標，皆不得被丟／拒。
 *  P3 遠距同名：雪梨塔／艾菲爾／首爾塔／各地 Hilton × 各種 handoff 組合 × 他國候選變體，須擋住。
 *  P4 工程師自述風險探針與排序回歸（與 HEAD 對照）。
 *
 * 執行：npx vite-node scripts/verify-place-geo-b16-false-block-sample.mjs --config scripts/vite.verify.config.mjs
 * 外部網路 0（fetch／http／net／tls 全攔截），searchPlaces 以 mock 取代。
 */
import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HEAD_SNAPSHOT =
  "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad/snap-HEAD";
const HARD_TIMEOUT_MS = 120_000;
const watchdog = setTimeout(() => {
  process.stdout.write(`\n[b16-sample] 超過 ${HARD_TIMEOUT_MS}ms，強制結束\n`);
  process.exit(2);
}, HARD_TIMEOUT_MS);
watchdog.unref?.();

let externalCalls = 0;
const trap = (kind, detail) => {
  externalCalls += 1;
  throw new Error(`[b16-sample] external ${kind} blocked ${String(detail).slice(0, 80)}`);
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
globalThis.__b16SearchPlaces = async (query, opts) => {
  searchLog.push({ query, center: opts?.center });
  return { suggestions: candidateProvider(query, opts) ?? [], error: null };
};

const results = [];
const record = (sec, id, title, status, detail = "") => results.push({ sec, id, title, status, detail });

const { createServer } = await import("vite");
const { ViteNodeServer } = await import("vite-node/server");
const { ViteNodeRunner } = await import("vite-node/client");
const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
const MOCK_ID = "\0b16-places-service";
const REAL_PLACES_SERVICE = `${WORK_ROOT}/src/services/placesService.ts?b16-real`;
const server = await createServer({
  root: WORK_ROOT,
  configFile: false,
  envDir: false,
  logLevel: "silent",
  clearScreen: false,
  plugins: [
    {
      name: "b16-mock-places-service",
      enforce: "pre",
      async resolveId(id, importer) {
        if (id.includes("b16-real")) return null;
        if (/(^|\/)services\/placesService(\.ts)?$/.test(id)) return MOCK_ID;
        // HEAD 快照內的 "@/..." 指向快照自己的 src（不混用工作樹模組）
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
          `export const searchPlaces = (...args) => globalThis.__b16SearchPlaces(...args);`,
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

  // HEAD 版 resolve（無地理防護）；HEAD 也沒有 Details 防線，顯示 = resolve 結果。
  let headResolve = null;
  const headFile = `${HEAD_SNAPSHOT}/src/lib/place-detail-resolve.ts`;
  if (fs.existsSync(headFile)) {
    try {
      const src = fs.readFileSync(headFile, "utf8");
      if (src.includes("place-geo-guard")) throw new Error("snapshot 不是 HEAD（含 place-geo-guard）");
      headResolve = (await runner.executeFile(headFile)).resolveGooglePlaceIdForDetail;
    } catch (e) {
      record("P0", "HEAD", "載入 HEAD 版 place-detail-resolve", "INFO", String(e?.message ?? e).slice(0, 160));
    }
  }
  record("P0", "HEAD-load", "HEAD 版 resolve 可載入（供對照）", headResolve ? "PASS" : "INFO", headResolve ? headFile : "未載入，HEAD 對照改以「HEAD 無防線＝顯示首個同分候選」推論");

  const runResolve = async (fn, handoff, candidates) => {
    searchLog = [];
    candidateProvider = () => candidates;
    quiet();
    try {
      return { got: (await fn(handoff, "zh-TW")) ?? null, searches: searchLog.length, centers: searchLog.map((s) => s.center ?? null) };
    } finally {
      loud();
    }
  };

  /** 模擬 _app.place.tsx：resolve → Details → 地理防護；回傳最終顯示的 placeId（或 base／rejected）。 */
  const displayed = async (handoff, candidates, detailsById) => {
    const h = { placeId: `saved-${handoff.name}`, ...handoff };
    const r = await runResolve(work.resolveGooglePlaceIdForDetail, h, candidates);
    if (!r.got) return { shown: "base", ...r };
    const needs = g.hasHardPlaceGeoContext(g.buildPlaceGeoContext(handoff));
    const det = detailsById[r.got];
    if (needs && det && !g.isResolvedPlaceGeoConsistent(handoff, det)) return { shown: "rejected", ...r };
    return { shown: r.got, ...r };
  };
  const displayedHead = async (handoff, candidates) => {
    if (!headResolve) return null;
    const r = await runResolve(headResolve, { placeId: `saved-${handoff.name}`, ...handoff }, candidates);
    return { shown: r.got ?? "base", ...r };
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

  // ════════ P1. 擋錯：地址含他國城市名或國名子字串 ════════
  // { id, name, lat, lng, local（handoff 地址，無國名）, full（handoff 地址，含國名）, ac（Autocomplete secondary）, det（Details 地址）, dest? }
  const P1 = [
    { id: "F01", name: "Eiffel Tower Replica", lat: 33.6627, lng: -95.547, local: "2025 S Collegiate Dr, Paris, TX 75460", full: "2025 S Collegiate Dr, Paris, TX 75460, USA", ac: "South Collegiate Drive, Paris, TX, USA", det: "2025 S Collegiate Dr, Paris, TX 75460, USA", dest: { city: "Paris, TX", country: "USA" } },
    { id: "F02", name: "Levi Jackson Wilderness Road Park", lat: 37.0872, lng: -84.0529, local: "998 Levi Jackson Mill Rd, London, KY 40744", full: "998 Levi Jackson Mill Rd, London, KY 40744, USA", ac: "Levi Jackson Mill Road, London, KY, USA", det: "998 Levi Jackson Mill Rd, London, KY 40744, USA" },
    { id: "F03", name: "Emerald Glen Park", lat: 37.7066, lng: -121.881, local: "4201 Central Pkwy, Dublin, CA 94568", full: "4201 Central Pkwy, Dublin, CA 94568, USA", ac: "Central Parkway, Dublin, CA, USA", det: "4201 Central Pkwy, Dublin, CA 94568, USA" },
    { id: "F04", name: "Big Fiddle", lat: 46.138, lng: -60.1946, local: "Esplanade, Sydney, NS B1P 6H7", full: "Esplanade, Sydney, NS B1P 6H7, Canada", ac: "Esplanade, Sydney, NS, Canada", det: "Esplanade, Sydney, NS B1P 6H7, Canada", dest: { city: "Sydney, Nova Scotia", country: "Canada" } },
    { id: "F05", name: "でんでんタウン", lat: 34.6592, lng: 135.5063, local: "大阪府大阪市浪速区日本橋4丁目", full: "日本、〒556-0005 大阪府大阪市浪速区日本橋４丁目", ac: "日本、大阪府大阪市浪速区日本橋", det: "日本、〒556-0005 大阪府大阪市浪速区日本橋４丁目", dest: { city: "大阪", country: "日本" } },
    { id: "F06", name: "日本橋三越本店", lat: 35.6866, lng: 139.7735, local: "東京都中央区日本橋室町1-4-1", full: "日本、〒103-8001 東京都中央区日本橋室町１丁目４−１", ac: "日本、東京都中央区日本橋室町", det: "日本、〒103-8001 東京都中央区日本橋室町１丁目４−１", dest: { city: "東京", country: "日本" } },
    { id: "F07", name: "Nihonbashi Bridge", lat: 35.6841, lng: 139.7746, local: "1 Chome Nihonbashi, Chuo City, Tokyo 103-0027", full: "1 Chome Nihonbashi, Chuo City, Tokyo 103-0027, Japan", ac: "Nihonbashi, Chuo City, Tokyo, Japan", det: "1 Chome Nihonbashi, Chuo City, Tokyo 103-0027, Japan" },
    { id: "F08", name: "덕수궁 돌담길", lat: 37.5658, lng: 126.9751, local: "서울특별시 중구 세종대로 99 인도", full: "대한민국 서울특별시 중구 세종대로 99 인도", ac: "대한민국 서울특별시 중구 정동", det: "대한민국 서울특별시 중구 정동길", dest: { city: "首爾", country: "韓國" } },
    { id: "F09", name: "한강대교 보행로", lat: 37.5172, lng: 126.9587, local: "서울특별시 동작구 노량진동 한강대교 인도", full: "대한민국 서울특별시 동작구 노량진동 한강대교 인도", ac: "Noryangjin-dong, Dongjak District, Seoul, South Korea", det: "Hangang Bridge, Noryangjin-dong, Dongjak District, Seoul, South Korea" },
    { id: "F10", name: "Petaling Street", lat: 3.1435, lng: 101.6976, local: "Jalan Petaling, China Town, 50000 Kuala Lumpur", full: "Jalan Petaling, China Town, 50000 Kuala Lumpur, Malaysia", ac: "Jalan Petaling, City Centre, Kuala Lumpur, Malaysia", det: "Jalan Petaling, City Centre, 50000 Kuala Lumpur, Wilayah Persekutuan Kuala Lumpur, Malaysia", dest: { city: "吉隆坡", country: "Malaysia" } },
    { id: "F11", name: "Tekka Centre", lat: 1.3063, lng: 103.8505, local: "665 Buffalo Rd, Little India 210665", full: "665 Buffalo Rd, Little India, Singapore 210665", ac: "Buffalo Road, Singapore", det: "665 Buffalo Rd, Singapore 210665", dest: { city: "新加坡", country: "Singapore" } },
    { id: "F12", name: "Mustafa Centre", lat: 1.3099, lng: 103.8553, local: "145 Syed Alwi Rd, Little India", full: "145 Syed Alwi Rd, Little India, Singapore 207704", ac: "Syed Alwi Road, Singapore", det: "145 Syed Alwi Rd, Singapore 207704" },
    { id: "F13", name: "Brickfields Little India", lat: 3.1306, lng: 101.6857, local: "Jalan Tun Sambanthan, Brickfields, Little India, 50470 Kuala Lumpur", full: "Jalan Tun Sambanthan, Brickfields, Little India, 50470 Kuala Lumpur, Malaysia", ac: "Jalan Tun Sambanthan, Brickfields, Kuala Lumpur, Malaysia", det: "Jalan Tun Sambanthan, Brickfields, 50470 Kuala Lumpur, Wilayah Persekutuan Kuala Lumpur, Malaysia" },
    { id: "F14", name: "Gerrard India Bazaar", lat: 43.6722, lng: -79.3247, local: "1426 Gerrard St E, Little India, Toronto, ON M4L 1Z6", full: "1426 Gerrard St E, Little India, Toronto, ON M4L 1Z6, Canada", ac: "Gerrard Street East, Toronto, ON, Canada", det: "1426 Gerrard St E, Toronto, ON M4L 1Z6, Canada", dest: { city: "多倫多", country: "Canada" } },
    { id: "F15", name: "Japan Center Malls", lat: 37.7852, lng: -122.43, local: "1737 Post St, Japan Town, San Francisco, CA 94115", full: "1737 Post St, Japan Town, San Francisco, CA 94115, USA", ac: "Post Street, San Francisco, CA, USA", det: "1737 Post St, San Francisco, CA 94115, USA", dest: { city: "舊金山", country: "USA" } },
    { id: "F16", name: "Koreatown Plaza", lat: 34.057, lng: -118.309, local: "928 S Western Ave, Korea Town, Los Angeles, CA 90006", full: "928 S Western Ave, Korea Town, Los Angeles, CA 90006, USA", ac: "South Western Avenue, Los Angeles, CA, USA", det: "928 S Western Ave, Los Angeles, CA 90006, USA", dest: { city: "洛杉磯", country: "USA" } },
    { id: "F17", name: "Korea Way", lat: 40.7477, lng: -73.9867, local: "W 32nd St (Korea Way), New York, NY 10001", full: "W 32nd St (Korea Way), New York, NY 10001, USA", ac: "West 32nd Street, New York, NY, USA", det: "W 32nd St, New York, NY 10001, USA" },
    { id: "F18", name: "Ferrara Bakery", lat: 40.7193, lng: -73.9973, local: "195 Grand St, Little Italy, New York, NY 10013", full: "195 Grand St, Little Italy, New York, NY 10013, USA", ac: "Grand Street, New York, NY, USA", det: "195 Grand St, New York, NY 10013, USA", dest: { city: "紐約", country: "USA" } },
    { id: "F19", name: "Little Italy Mercato", lat: 32.7236, lng: -117.169, local: "W Date St, Little Italy, San Diego, CA 92101", full: "W Date St, Little Italy, San Diego, CA 92101, USA", ac: "West Date Street, San Diego, CA, USA", det: "W Date St, San Diego, CA 92101, USA" },
    { id: "F20", name: "Little Portugal", lat: 43.649, lng: -79.429, local: "Dundas St W, Little Portugal, Toronto, ON", full: "Dundas St W, Little Portugal, Toronto, ON, Canada", ac: "Dundas Street West, Toronto, ON, Canada", det: "Dundas St W, Toronto, ON M6J, Canada" },
    { id: "F21", name: "Mexico Beach Pier", lat: 29.9418, lng: -85.4108, local: "3790 US-98, Mexico Beach, FL 32456", full: "3790 US-98, Mexico Beach, FL 32456, USA", ac: "US-98, Mexico Beach, FL, USA", det: "3790 US-98, Mexico Beach, FL 32456, USA" },
    { id: "F22", name: "Sandia Peak Tramway", lat: 35.1906, lng: -106.4801, local: "30 Tramway Rd NE, Albuquerque, New Mexico 87122", full: "30 Tramway Rd NE, Albuquerque, New Mexico 87122, USA", ac: "Tramway Road Northeast, Albuquerque, NM, USA", det: "30 Tramway Rd NE, Albuquerque, NM 87122, USA" },
    { id: "F23", name: "Windmill Island Gardens", lat: 42.7957, lng: -86.1006, local: "1 Lincoln Ave, Holland, MI 49423", full: "1 Lincoln Ave, Holland, MI 49423, USA", ac: "Lincoln Avenue, Holland, MI, USA", det: "1 Lincoln Ave, Holland, MI 49423, USA" },
    { id: "F24", name: "Baker Lake", lat: 41.3298, lng: -89.129, local: "Peru, IL 61354", full: "Peru, IL 61354, USA", ac: "Peru, IL, USA", det: "Peru, IL 61354, USA" },
    { id: "F25", name: "Greece Ridge Center", lat: 43.202, lng: -77.693, local: "271 Greece Ridge Center Dr, Greece, NY 14626", full: "271 Greece Ridge Center Dr, Greece, NY 14626, USA", ac: "Greece Ridge Center Drive, Rochester, NY, USA", det: "271 Greece Ridge Center Dr, Rochester, NY 14626, USA" },
    { id: "F26", name: "Italy Community Park", lat: 32.184, lng: -96.8847, local: "Italy, TX 76651", full: "Italy, TX 76651, USA", ac: "Italy, TX, USA", det: "Italy, TX 76651, USA" },
    { id: "F27", name: "China Lake", lat: 44.45, lng: -69.58, local: "China, ME 04358", full: "China, ME 04358, USA", ac: "China, ME, USA", det: "China, ME 04358, USA" },
    { id: "F28", name: "Turkey Town Hall", lat: 34.991, lng: -78.183, local: "Turkey, NC 28393", full: "Turkey, NC 28393, USA", ac: "Turkey, NC, USA", det: "Turkey, NC 28393, USA" },
    { id: "F29", name: "Canada Water Library", lat: 51.4979, lng: -0.0495, local: "21 Surrey Quays Rd, Canada Water, London SE16 7AR", full: "21 Surrey Quays Rd, Canada Water, London SE16 7AR, UK", ac: "Surrey Quays Road, London, UK", det: "21 Surrey Quays Rd, London SE16 7AR, UK", dest: { city: "倫敦", country: "UK" } },
    { id: "F30", name: "One Canada Square", lat: 51.5049, lng: -0.0195, local: "One Canada Square, London E14 5AB", full: "One Canada Square, London E14 5AB, UK", ac: "Canary Wharf, London, UK", det: "Canary Wharf, London E14 5AB, UK" },
    { id: "F31", name: "西宮名塩サービスエリア", lat: 34.835, lng: 135.306, local: "兵庫県西宮市塩瀬町名塩 中国自動車道", full: "日本、兵庫県西宮市塩瀬町名塩 中国自動車道", ac: "日本、兵庫県西宮市塩瀬町名塩", det: "日本、〒669-1141 兵庫県西宮市塩瀬町名塩" },
    { id: "F32", name: "India Street Car Park", lat: 55.8628, lng: -4.265, local: "India St, Glasgow G2 4PF", full: "India St, Glasgow G2 4PF, UK", ac: "India Street, Glasgow, UK", det: "India St, Glasgow G2 4PF, UK" },
    { id: "F33", name: "Covent Garden Market", lat: 42.983, lng: -81.2497, local: "130 King St, London, ON N6A 1C5", full: "130 King St, London, ON N6A 1C5, Canada", ac: "King Street, London, ON, Canada", det: "130 King St, London, ON N6A 1C5, Canada" },
    { id: "F34", name: "Venice Beach Boardwalk", lat: 33.985, lng: -118.4695, local: "1800 Ocean Front Walk, Venice, CA 90291", full: "1800 Ocean Front Walk, Venice, CA 90291, USA", ac: "Ocean Front Walk, Venice, CA, USA", det: "1800 Ocean Front Walk, Venice, CA 90291, USA" },
    { id: "F35", name: "Rome Clock Tower", lat: 34.2573, lng: -85.1647, local: "Neely St, Rome, GA 30161", full: "Neely St, Rome, GA 30161, USA", ac: "Neely Street, Rome, GA, USA", det: "Neely St, Rome, GA 30161, USA" },
    { id: "F36", name: "Melbourne Main Street", lat: 28.0786, lng: -80.6059, local: "E New Haven Ave, Melbourne, FL 32901", full: "E New Haven Ave, Melbourne, FL 32901, USA", ac: "East New Haven Avenue, Melbourne, FL, USA", det: "E New Haven Ave, Melbourne, FL 32901, USA" },
    { id: "F37", name: "Prince of Wales Hotel", lat: 49.0533, lng: -113.907, local: "Prince of Wales Rd, Waterton Park, AB T0K 2M0", full: "Prince of Wales Rd, Waterton Park, AB T0K 2M0, Canada", ac: "Waterton Park, AB, Canada", det: "Prince of Wales Rd, Waterton Park, AB T0K 2M0, Canada" },
    { id: "F38", name: "中環街市", lat: 22.2838, lng: 114.1557, local: "香港中環皇后大道中93號", full: "中國香港中環皇后大道中93號", ac: "中國香港中環", det: "香港中環皇后大道中93號" },
  ];

  const p1Summary = { cases: 0, lost: 0, headLost: 0 };
  for (const p of P1) {
    const correctAc = { placeId: `ChIJ_B16_${p.id}_AC`, label: p.name, secondary: p.ac, types: POI };
    const correctFull = { placeId: `ChIJ_B16_${p.id}_FULL`, label: p.name, secondary: p.full, types: POI };
    const details = {
      [correctAc.placeId]: { lat: p.lat, lng: p.lng, address: p.det },
      [correctFull.placeId]: { lat: p.lat, lng: p.lng, address: p.det },
    };
    const off = { lat: p.lat + 0.003, lng: p.lng - 0.003 };
    const combos = [
      ["addr-local", { name: p.name, address: p.local, lat: null, lng: null }],
      ["addr-local+coords", { name: p.name, address: p.local, ...off }],
      ["addr-full", { name: p.name, address: p.full, lat: null, lng: null }],
      ["addr-full+coords", { name: p.name, address: p.full, ...off }],
      ["own-coords", { name: p.name, address: null, ...off }],
    ];
    if (p.dest) combos.push(["itinerary", itin(p.name, p.dest)]);
    const lost = [];
    const headLost = [];
    const calls = [];
    for (const [kind, h] of combos) {
      for (const cand of [correctAc, correctFull]) {
        p1Summary.cases += 1;
        const d = await displayed(h, [cand], details);
        const hd = await displayedHead(h, [cand]);
        if (d.shown !== cand.placeId) {
          lost.push(`${kind}/${cand === correctAc ? "ac" : "full"}=${d.shown}`);
          p1Summary.lost += 1;
        }
        if (hd && hd.shown !== cand.placeId) {
          headLost.push(`${kind}=${hd.shown}`);
          p1Summary.headLost += 1;
        }
        if (hd && d.searches > hd.searches) calls.push(`${kind}:${d.searches}>${hd.searches}`);
      }
    }
    record(
      "P1",
      p.id,
      `${p.name}｜${p.local}：正確地點在各組合不被丟／拒`,
      lost.length ? "FAIL" : "PASS",
      `${lost.join("；") || "全部顯示正確地點"}${headLost.length ? `｜HEAD 也失敗：${headLost.join("；")}` : lost.length ? "｜HEAD：全部顯示正確地點（相對 HEAD 為回歸）" : ""}${calls.length ? `｜呼叫次數多於 HEAD：${calls.join("；")}` : ""}`,
    );
    if (calls.length) record("P1", `${p.id}-calls`, `${p.name}：searchPlaces 次數 ≤ HEAD`, "FAIL", calls.join("；"));
  }
  record("P1", "SUM", "P1 擋錯統計", "INFO", `組合 ${p1Summary.cases}；工作樹擋錯 ${p1Summary.lost}；HEAD 擋錯 ${p1Summary.headLost}`);

  // ════════ P2. 四語系 Details 地址格式 ════════
  const L = ["zh", "en", "ja", "ko"];
  // [id, name, lat, lng, {zh,en,ja,ko 地址}, {zh,en,ja,ko 國名}, 行程目的地城市（zh）]
  const P2 = [
    ["L01", "東京鐵塔", 35.6586, 139.7454, { zh: "日本東京都港區芝公園4丁目2-8", en: "4 Chome-2-8 Shibakoen, Minato City, Tokyo 105-0011, Japan", ja: "日本、〒105-0011 東京都港区芝公園４丁目２−８", ko: "일본 〒105-0011 Tokyo, Minato City, Shibakoen, 4 Chome−2−8" }, { zh: "日本", en: "Japan", ja: "日本", ko: "일본" }, "東京"],
    ["L02", "N首爾塔", 37.5512, 126.9882, { zh: "韓國首爾特別市龍山區南山公園路105", en: "105 Namsangongwon-gil, Yongsan District, Seoul, South Korea", ja: "韓国 〒04340 ソウル特別市龍山区南山公園キル 105", ko: "대한민국 서울특별시 용산구 남산공원길 105" }, { zh: "韓國", en: "South Korea", ja: "韓国", ko: "대한민국" }, "首爾"],
    ["L03", "台北101", 25.034, 121.5645, { zh: "110台灣台北市信義區信義路五段7號", en: "No. 7, Section 5, Xinyi Rd, Xinyi District, Taipei City, Taiwan 110", ja: "台湾 〒110 台北市信義区信義路五段7號", ko: "대만 Taipei City, Xinyi District, Section 5, Xinyi Rd, 7號 110" }, { zh: "台灣", en: "Taiwan", ja: "台湾", ko: "대만" }, "台北"],
    ["L04", "東方明珠", 31.2397, 121.4998, { zh: "中國上海市浦東新區世紀大道1號", en: "1 Century Ave, Lujiazui, Pudong, Shanghai, China, 200120", ja: "中国 〒200120 上海市浦東新区世紀大道1号", ko: "중국 상하이 시 푸둥 신구 세기대로 1" }, { zh: "中國", en: "China", ja: "中国", ko: "중국" }, "上海"],
    ["L05", "太平山頂纜車", 22.2776, 114.1594, { zh: "香港中環花園道33號", en: "33 Garden Rd, Central, Hong Kong", ja: "香港 セントラル ガーデン・ロード 33", ko: "홍콩 센트럴 가든 로드 33" }, { zh: "香港", en: "Hong Kong", ja: "香港", ko: "홍콩" }, null],
    ["L06", "鄭王廟", 13.7437, 100.4888, { zh: "泰國曼谷 Bangkok Yai, Wat Arun, 158 Thanon Wang Doem", en: "158 Thanon Wang Doem, Wat Arun, Bangkok Yai, Bangkok 10600, Thailand", ja: "タイ王国 〒10600 バンコク Wat Arun, Bangkok Yai, 158 Thanon Wang Doem", ko: "태국 10600 방콕 Bangkok Yai, Wat Arun, 158 Thanon Wang Doem" }, { zh: "泰國", en: "Thailand", ja: "タイ王国", ko: "태국" }, "曼谷"],
    ["L07", "會安古鎮", 15.8801, 108.338, { zh: "越南廣南省會安市明安坊", en: "Minh An, Hội An, Quảng Nam, Vietnam", ja: "ベトナム クアンナム省 ホイアン", ko: "베트남 꽝남성 호이안" }, { zh: "越南", en: "Vietnam", ja: "ベトナム", ko: "베트남" }, "峴港"],
    ["L08", "魚尾獅公園", 1.2868, 103.8545, { zh: "新加坡 Fullerton Rd 1號 049213", en: "1 Fullerton Rd, Singapore 049213", ja: "シンガポール 〒049213 フラトン・ロード 1", ko: "싱가포르 1 Fullerton Rd, 049213" }, { zh: "新加坡", en: "Singapore", ja: "シンガポール", ko: "싱가포르" }, null],
    ["L09", "黑風洞", 3.2379, 101.684, { zh: "馬來西亞雪蘭莪鵝嘜 68100", en: "Gombak, 68100 Batu Caves, Selangor, Malaysia", ja: "マレーシア 〒68100 セランゴール州 バトゥ洞窟", ko: "말레이시아 68100 슬랑오르 바투 동굴" }, { zh: "馬來西亞", en: "Malaysia", ja: "マレーシア", ko: "말레이시아" }, "吉隆坡"],
    ["L10", "婆羅浮屠", -7.6079, 110.2038, { zh: "印尼中爪哇馬吉朗婆羅浮屠", en: "Jl. Badrawati, Borobudur, Magelang, Central Java, Indonesia", ja: "インドネシア 中部ジャワ州 マグラン ボロブドゥール", ko: "인도네시아 중부 자바 마글랑 보로부두르" }, { zh: "印尼", en: "Indonesia", ja: "インドネシア", ko: "인도네시아" }, null],
    ["L11", "巧克力山", 9.8297, 124.1395, { zh: "菲律賓保和省卡門", en: "Carmen, Bohol, Philippines", ja: "フィリピン ボホール州 カルメン", ko: "필리핀 보홀 카르멘" }, { zh: "菲律賓", en: "Philippines", ja: "フィリピン", ko: "필리핀" }, "宿霧"],
    ["L12", "烏魯魯", -25.3444, 131.0369, { zh: "澳洲北領地彼得曼 0872", en: "Uluru-Kata Tjuta National Park, Petermann NT 0872, Australia", ja: "オーストラリア 〒0872 ノーザンテリトリー ピーターマン", ko: "오스트레일리아 노던 준주 피터만 0872" }, { zh: "澳洲", en: "Australia", ja: "オーストラリア", ko: "호주" }, null],
    ["L13", "哈比屯", -37.8721, 175.6829, { zh: "紐西蘭馬塔馬塔 Buckland Rd 501號", en: "501 Buckland Road, Hinuera, Matamata 3472, New Zealand", ja: "ニュージーランド 〒3472 マタマタ バックランド・ロード 501", ko: "뉴질랜드 3472 마타마타 Buckland Road 501" }, { zh: "紐西蘭", en: "New Zealand", ja: "ニュージーランド", ko: "뉴질랜드" }, null],
    ["L14", "大峽谷天空步道", 36.012, -113.8108, { zh: "美國亞利桑那州 Peach Springs Eagle Point Rd", en: "Eagle Point Rd, Peach Springs, AZ 86434, USA", ja: "アメリカ合衆国 〒86434 アリゾナ州 ピーチスプリングス", ko: "미국 애리조나 피치 스프링스 86434" }, { zh: "美國", en: "United States", ja: "アメリカ合衆国", ko: "미국" }, null],
    ["L15", "加拿大國家電視塔", 43.6426, -79.3871, { zh: "加拿大安大略省多倫多 Bremner Blvd 290號", en: "290 Bremner Blvd, Toronto, ON M5V 3L9, Canada", ja: "カナダ 〒M5V 3L9 オンタリオ州 トロント ブレムナー・ブールバード 290", ko: "캐나다 M5V 3L9 온타리오 토론토 Bremner Blvd 290" }, { zh: "加拿大", en: "Canada", ja: "カナダ", ko: "캐나다" }, "多倫多"],
    ["L16", "巨石陣", 51.1789, -1.8262, { zh: "英國索爾斯堡 SP4 7DE", en: "Salisbury SP4 7DE, UK", ja: "イギリス 〒SP4 7DE ソールズベリー", ko: "영국 Salisbury SP4 7DE" }, { zh: "英國", en: "United Kingdom", ja: "イギリス", ko: "영국" }, null],
    ["L17", "聖米歇爾山", 48.6361, -1.5115, { zh: "法國 50170 聖米歇爾山", en: "50170 Mont Saint-Michel, France", ja: "フランス 〒50170 モン・サン・ミシェル", ko: "프랑스 50170 몽생미셸" }, { zh: "法國", en: "France", ja: "フランス", ko: "프랑스" }, null],
    ["L18", "羅馬競技場", 41.8902, 12.4922, { zh: "義大利羅馬 Piazza del Colosseo 1號 00184", en: "Piazza del Colosseo, 1, 00184 Roma RM, Italy", ja: "イタリア 〒00184 ローマ コロッセオ広場 1", ko: "이탈리아 00184 로마 Piazza del Colosseo, 1" }, { zh: "義大利", en: "Italy", ja: "イタリア", ko: "이탈리아" }, "羅馬"],
    ["L19", "聖家堂", 41.4036, 2.1744, { zh: "西班牙巴塞隆納 C/ de Mallorca 401號", en: "C/ de Mallorca, 401, L'Eixample, 08013 Barcelona, Spain", ja: "スペイン 〒08013 バルセロナ マヨルカ通り 401", ko: "스페인 08013 바르셀로나 C/ de Mallorca, 401" }, { zh: "西班牙", en: "Spain", ja: "スペイン", ko: "스페인" }, "巴塞隆納"],
    ["L20", "新天鵝堡", 47.5576, 10.7498, { zh: "德國 87645 施萬高 Neuschwansteinstraße 20", en: "Neuschwansteinstraße 20, 87645 Schwangau, Germany", ja: "ドイツ 〒87645 シュヴァンガウ ノイシュヴァンシュタイン通り 20", ko: "독일 87645 슈반가우 Neuschwansteinstraße 20" }, { zh: "德國", en: "Germany", ja: "ドイツ", ko: "독일" }, null],
    ["L21", "哈里發塔", 25.1972, 55.2744, { zh: "阿拉伯聯合大公國杜拜 Sheikh Mohammed bin Rashid Blvd 1號", en: "1 Sheikh Mohammed bin Rashid Blvd - Downtown Dubai - Dubai - United Arab Emirates", ja: "アラブ首長国連邦 ドバイ ダウンタウン・ドバイ", ko: "아랍에미리트 두바이 다운타운 두바이" }, { zh: "阿聯酋", en: "UAE", ja: "アラブ首長国連邦", ko: "아랍에미리트" }, null],
    ["L22", "泰姬瑪哈陵", 27.1751, 78.0421, { zh: "印度北方邦阿格拉 282001", en: "Dharmapuri, Forest Colony, Tajganj, Agra, Uttar Pradesh 282001, India", ja: "インド 〒282001 ウッタル・プラデーシュ州 アーグラ", ko: "인도 우타르프라데시 아그라 282001" }, { zh: "印度", en: "India", ja: "インド", ko: "인도" }, null],
    ["L23", "甘丹寺", 47.9214, 106.8947, { zh: "蒙古烏蘭巴托", en: "Ulaanbaatar, Mongolia", ja: "モンゴル国 ウランバートル", ko: "몽골 울란바토르" }, { zh: "蒙古", en: "Mongolia", ja: "モンゴル", ko: "몽골" }, "烏蘭巴托"],
    ["L24", "聖索菲亞大教堂", 41.0086, 28.9802, { zh: "土耳其伊斯坦堡法提赫 34122", en: "Ayasofya Meydanı No:1, 34122 Fatih/İstanbul, Türkiye", ja: "トルコ 〒34122 イスタンブール ファティフ", ko: "튀르키예 34122 이스탄불 파티흐" }, { zh: "土耳其", en: "Türkiye", ja: "トルコ", ko: "튀르키예" }, "伊斯坦堡"],
  ];
  let p2Cases = 0;
  for (const [id, name, lat, lng, addr, ctry, city] of P2) {
    const lost = [];
    const off = { lat: lat - 0.002, lng: lng + 0.002 };
    for (const l2 of L) {
      const cand = { placeId: `ChIJ_B16_${id}_${l2}`, label: name, secondary: addr[l2], types: POI };
      const details = { [cand.placeId]: { lat, lng, address: addr[l2] } };
      const hs = [];
      for (const l1 of L) {
        hs.push([`addr-${l1}`, { name, address: addr[l1], lat: null, lng: null }]);
        hs.push([`addr-${l1}+coords`, { name, address: addr[l1], ...off }]);
        hs.push([`ctx-country-${l1}`, { name, address: null, lat: null, lng: null, contextCountry: ctry[l1] }]);
        hs.push([`itin-${l1}`, itin(name, { city, country: ctry[l1] })]);
        if (city) hs.push([`itin-ext-${l1}`, itin(name, { city, country: ctry[l1] }, "近郊延伸點")]);
      }
      hs.push(["own-coords", { name, address: null, ...off }]);
      if (city) hs.push(["ctx-city", { name, address: null, lat: null, lng: null, contextCity: city }]);
      for (const [kind, h] of hs) {
        p2Cases += 1;
        const d = await displayed(h, [cand], details);
        if (d.shown !== cand.placeId) lost.push(`${kind}→Details ${l2}=${d.shown}`);
      }
    }
    record("P2", id, `${name}：四語系 handoff × 四語系 Details／候選，不得被丟／拒`, lost.length ? "FAIL" : "PASS", lost.join("；") || "全部顯示正確地點");
  }
  // 韓國 ko Details 常省略「대한민국」
  {
    const cand = { placeId: "ChIJ_B16_L02_konc", label: "N首爾塔", secondary: "서울특별시 용산구 남산공원길 105", types: POI };
    const det = { [cand.placeId]: { lat: 37.5512, lng: 126.9882, address: "서울특별시 용산구 남산공원길 105" } };
    const lost = [];
    for (const [kind, h] of [
      ["addr-zh", { name: "N首爾塔", address: "韓國首爾特別市龍山區南山公園路105", lat: null, lng: null }],
      ["ctx-country", { name: "N首爾塔", address: null, lat: null, lng: null, contextCountry: "South Korea" }],
      ["itin", itin("N首爾塔", { city: "首爾", country: "韓國" })],
    ]) {
      p2Cases += 1;
      const d = await displayed(h, [cand], det);
      if (d.shown !== cand.placeId) lost.push(`${kind}=${d.shown}`);
    }
    record("P2", "L02-ko-nocountry", "N首爾塔：ko Details 無「대한민국」→ 不得被拒", lost.length ? "FAIL" : "PASS", lost.join("；") || "全部顯示正確地點");
  }
  record("P2", "SUM", "P2 組合數", "INFO", `${p2Cases} 組`);

  // ════════ P3. 遠距同名，須擋住 ════════
  const P3 = [
    {
      id: "S1", name: "Sydney Tower Eye", lat: -33.8705, lng: 151.2089,
      full: { zh: "澳洲新南威爾斯州雪梨 Market St 100號", en: "Westfield Sydney, Level 5/108 Market St, Sydney NSW 2000, Australia" },
      local: "108 Market St, Sydney NSW 2000", localNoCity: "Level 5/108 Market St", city: "雪梨", country: "Australia", ext: "藍山",
      rivals: [
        { tag: "SydneyNS-CA", sec: "Charlotte St, Sydney, NS, Canada", short: "Charlotte St, Sydney, NS", lat: 46.1368, lng: -60.1942 },
        { tag: "Shenzhen-CN", sec: "中國廣東省深圳市南山區", short: "南山區", lat: 22.5362, lng: 113.9737 },
      ],
    },
    {
      id: "S2", name: "Eiffel Tower", lat: 48.8584, lng: 2.2945,
      full: { zh: "法國巴黎 Av. Gustave Eiffel 75007", en: "Av. Gustave Eiffel, 75007 Paris, France" },
      local: "Champ de Mars, 75007 Paris", localNoCity: "Av. Gustave Eiffel, 75007", city: "巴黎", country: "France", ext: "凡爾賽",
      rivals: [
        { tag: "ParisTX-US", sec: "S Collegiate Dr, Paris, TX, USA", short: "S Collegiate Dr, Paris, TX", lat: 33.6627, lng: -95.547 },
        { tag: "WindowOfWorld-CN", sec: "中國廣東省深圳市南山區深南大道9037號", short: "南山區深南大道9037號", lat: 22.5363, lng: 113.9733 },
        { tag: "LasVegas-US", sec: "3655 S Las Vegas Blvd, Las Vegas, NV 89109, USA", short: "3655 S Las Vegas Blvd", lat: 36.1125, lng: -115.1728 },
      ],
    },
    {
      id: "S3", name: "N Seoul Tower", lat: 37.5512, lng: 126.9882,
      full: { zh: "韓國首爾特別市龍山區南山公園路105", en: "105 Namsangongwon-gil, Yongsan District, Seoul, South Korea" },
      local: "서울특별시 용산구 남산공원길 105", localNoCity: "용산구 남산공원길 105", city: "首爾", country: "South Korea", ext: "水原",
      rivals: [
        { tag: "LA-US", sec: "W Olympic Blvd, Los Angeles, CA, USA", short: "W Olympic Blvd", lat: 34.0522, lng: -118.3 },
        { tag: "Tokyo-JP", sec: "日本東京都新宿區大久保", short: "新宿區大久保", lat: 35.7013, lng: 139.7005 },
      ],
    },
    {
      id: "H1", name: "Hilton", lat: 35.6926, lng: 139.6907,
      full: { zh: "日本東京都新宿區西新宿6-6-2", en: "6 Chome-6-2 Nishishinjuku, Shinjuku City, Tokyo 160-0023, Japan" },
      local: "東京都新宿区西新宿6-6-2", localNoCity: "西新宿6-6-2", city: "東京", country: "日本", ext: "箱根",
      rivals: [
        { tag: "Sydney-AU", sec: "488 George St, Sydney NSW 2000, Australia", short: "488 George St", lat: -33.8718, lng: 151.2071 },
        { tag: "NewYork-US", sec: "1335 6th Ave, New York, NY 10019, USA", short: "1335 6th Ave", lat: 40.7623, lng: -73.9791 },
      ],
    },
    {
      id: "H2", name: "Hilton", lat: -33.8718, lng: 151.2071,
      full: { zh: "澳洲雪梨 George St 488號", en: "488 George St, Sydney NSW 2000, Australia" },
      local: "488 George St, Sydney NSW 2000", localNoCity: "488 George St", city: "Sydney", country: "AU", ext: "Blue Mountains",
      rivals: [
        { tag: "Tokyo-JP", sec: "日本東京都新宿區西新宿6-6-2", short: "西新宿6-6-2", lat: 35.6926, lng: 139.6907 },
        { tag: "Paris-FR", sec: "30 Rue de Caumartin, 75009 Paris, France", short: "30 Rue de Caumartin", lat: 48.8738, lng: 2.3283 },
      ],
    },
    {
      id: "H3", name: "Hilton", lat: 48.8738, lng: 2.3283,
      full: { zh: "法國巴黎 Rue de Caumartin 30號", en: "30 Rue de Caumartin, 75009 Paris, France" },
      local: "30 Rue de Caumartin, 75009 Paris", localNoCity: "30 Rue de Caumartin", city: "Paris", country: "法國", ext: "Giverny",
      rivals: [
        { tag: "Seoul-KR", sec: "대한민국 서울특별시 중구 소월로 50", short: "중구 소월로 50", lat: 37.5559, lng: 126.9757 },
        { tag: "NewYork-US", sec: "1335 6th Ave, New York, NY 10019, USA", short: "1335 6th Ave", lat: 40.7623, lng: -73.9791 },
      ],
    },
    {
      id: "H4", name: "Hilton", lat: 40.7623, lng: -73.9791,
      full: { zh: "美國紐約州紐約 6th Ave 1335號", en: "1335 6th Ave, New York, NY 10019, USA" },
      local: "1335 6th Ave, New York, NY 10019", localNoCity: "1335 6th Ave", city: "紐約", country: "美國", ext: "Niagara Falls",
      rivals: [
        { tag: "London-GB", sec: "22 Park Ln, London W1K 1BE, UK", short: "22 Park Ln", lat: 51.5054, lng: -0.1502 },
        { tag: "Taipei-TW", sec: "台灣新北市板橋區縣民大道二段7號", short: "縣民大道二段7號", lat: 25.0136, lng: 121.4647 },
      ],
    },
    {
      id: "H5", name: "Hilton", lat: 25.0136, lng: 121.4647,
      full: { zh: "220台灣新北市板橋區縣民大道二段7號", en: "No. 7, Section 2, Xianmin Blvd, Banqiao District, New Taipei City, Taiwan 220" },
      local: "新北市板橋區縣民大道二段7號", localNoCity: "縣民大道二段7號", city: "台北", country: "台灣", ext: "九份",
      rivals: [
        { tag: "Osaka-JP", sec: "日本大阪府大阪市北區梅田1-8-8", short: "北區梅田1-8-8", lat: 34.6999, lng: 135.4955 },
        { tag: "Melbourne-AU", sec: "192 Wellington Parade, East Melbourne VIC 3002, Australia", short: "192 Wellington Parade", lat: -37.8167, lng: 144.9855 },
      ],
    },
  ];
  const leaks = { hard: 0, soft: 0, specAllowed: 0, rivalResolved: 0 };
  const haversineKm = (a, b) => {
    const R = 6371;
    const r = (x) => (x * Math.PI) / 180;
    const dLat = r(b.lat - a.lat);
    const dLng = r(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  const KNOWN_CITY_NAMES = ["sydney", "雪梨", "paris", "巴黎", "seoul", "서울", "首爾", "tokyo", "東京", "東京都", "new york", "紐約", "台北", "新北", "london"];
  const cityNamesIn = (text) => {
    const n = g.normalizeGeoText(text);
    return KNOWN_CITY_NAMES.filter((c) => n.includes(c));
  };
  for (const p of P3) {
    const correct = { placeId: `ChIJ_B16_${p.id}_OK`, label: p.name, secondary: p.full.en, types: POI };
    const off = { lat: p.lat + 0.002, lng: p.lng + 0.002 };
    const combos = [
      ["own-coords", { name: p.name, address: null, ...off }],
      ["addr-full-zh", { name: p.name, address: p.full.zh, lat: null, lng: null }],
      ["addr-full-en", { name: p.name, address: p.full.en, lat: null, lng: null }],
      ["addr-local-city", { name: p.name, address: p.local, lat: null, lng: null }],
      ["addr-local-nocity", { name: p.name, address: p.localNoCity, lat: null, lng: null }],
      ["addr+coords", { name: p.name, address: p.local, ...off }],
      ["ctx-city", { name: p.name, address: null, lat: null, lng: null, contextCity: p.city }],
      ["ctx-country", { name: p.name, address: null, lat: null, lng: null, contextCountry: p.country }],
      ["ctx-city+country", { name: p.name, address: null, lat: null, lng: null, contextCity: p.city, contextCountry: p.country }],
      ["itinerary", itin(p.name, { city: p.city, country: p.country })],
      ["itinerary-ext", itin(p.name, { city: p.city, country: p.country }, p.ext)],
      ["itinerary-ext-nocountry", itin(p.name, { city: p.city, country: null }, p.ext)],
      ["addr-nocity+ctx-city", { name: p.name, address: p.localNoCity, lat: null, lng: null, contextCity: p.city }],
    ];
    const hardLeak = [];
    const softLeak = [];
    const allowed = [];
    const lostCorrect = [];
    for (const rv of p.rivals) {
      const variants = [
        ["sec+det", { secondary: rv.sec }, { lat: rv.lat, lng: rv.lng, address: rv.sec }],
        ["short+det", { secondary: rv.short }, { lat: rv.lat, lng: rv.lng, address: rv.sec }],
        ["short+det-nocountry", { secondary: rv.short }, { lat: rv.lat, lng: rv.lng, address: rv.short }],
        ["short+det-noaddr", { secondary: rv.short }, { lat: rv.lat, lng: rv.lng, address: null }],
        ["sec+det-nocoords", { secondary: rv.sec }, { lat: null, lng: null, address: rv.sec }],
        ["short+det-nothing", { secondary: rv.short }, { lat: null, lng: null, address: null }],
      ];
      for (const [vkind, candPatch, det] of variants) {
        // isGooglePlaceId 只接受 ChIJ[\w-]+；「+」會讓候選被跳過、測試變空測。
        const rival = { placeId: `ChIJ_B16_${p.id}_${rv.tag}_${vkind}`.replace(/[^\w-]/g, "_"), label: p.name, types: POI, ...candPatch };
        const details = { [rival.placeId]: det, [correct.placeId]: { lat: p.lat, lng: p.lng, address: p.full.en } };
        for (const [kind, h] of combos) {
          const hard = g.hasHardPlaceGeoContext(g.buildPlaceGeoContext(h));
          for (const [ord, cands] of [["rival-first", [rival, correct]], ["rival-only", [rival]]]) {
            const d = await displayed(h, cands, details);
            if (d.got === rival.placeId) leaks.rivalResolved += 1;
            if (d.shown === rival.placeId) {
              const tag = `${kind}/${rv.tag}/${vkind}/${ord}`;
              // 依規格歸因：只有「規格要求拒絕卻放過」才算 FAIL。
              const ctx = g.buildPlaceGeoContext(h);
              const detExplicit = g.explicitCountriesInGeoText(det.address);
              const inferred = det.lat == null ? null : g.countryCodeForCoordinates(det.lat, det.lng);
              const km = haversineKm(p, rv);
              const ownExplicit = [...ctx.ownCountries];
              const addrCityInDet = cityNamesIn(h.address).some((n) => g.normalizeGeoText(det.address).includes(n));
              let cause;
              if (!hard) cause = "soft";
              else if (det.lat == null) cause = "allowed:Details 無座標";
              else if (ownExplicit.length && detExplicit.size) cause = "BUG:雙方明確國名不同卻未擋";
              else if (ownExplicit.length && !detExplicit.size)
                cause = inferred && !ownExplicit.includes(inferred) && km > 2000
                  ? "GAP:自身地址有明確國名、Details 無國名只有座標（>2000 km、推得他國）未走錨點判斷"
                  : "allowed:Details 無國名、推不出他國或 2000 km 內";
              else if (addrCityInDet) cause = "allowed:Details 含同一城市名（規格 C 視為一致）";
              else if (!detExplicit.size && (!inferred || km <= 2000)) cause = "allowed:Details 無國名、推不出國家或 2000 km 內";
              else cause = "BUG:未歸因";
              if (cause === "soft") softLeak.push(tag);
              else if (cause.startsWith("allowed")) allowed.push(`${tag}［${cause.slice(8)}］`);
              else hardLeak.push(`${tag}［${cause}］`);
            }
          }
        }
      }
    }
    // 擋住同名之餘，正確候選本身也必須顯示
    for (const [kind, h] of combos) {
      const d = await displayed(h, [correct], { [correct.placeId]: { lat: p.lat, lng: p.lng, address: p.full.en } });
      if (d.shown !== correct.placeId) lostCorrect.push(`${kind}=${d.shown}`);
    }
    leaks.hard += hardLeak.length;
    leaks.soft += softLeak.length;
    leaks.specAllowed += allowed.length;
    const groupBy = (arr) => {
      const m = new Map();
      for (const s of arr) {
        const cause = s.slice(s.indexOf("［") + 1, -1);
        const key = `${cause}`;
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(s.slice(0, s.indexOf("［")));
      }
      return [...m].map(([c, xs]) => `${c} ×${xs.length}（例：${xs.slice(0, 3).join("、")}）`).join("｜");
    };
    const realBugs = hardLeak.filter((s) => s.includes("BUG:"));
    const gaps = hardLeak.filter((s) => s.includes("GAP:"));
    record("P3", `${p.id}-block`, `${p.name}（${p.city}）：規格要求拒絕的遠距同名須擋住`, realBugs.length ? "FAIL" : "PASS", realBugs.length ? groupBy(realBugs) : "規格要求拒絕者全部擋下");
    if (gaps.length) record("P3", `${p.id}-gap`, `${p.name}（${p.city}）：自身地址有明確國名但 Details 只有座標時未做錨點判斷（漏擋；規格 C 未明定，HEAD 同樣放過）`, "INFO", groupBy(gaps));
    record("P3", `${p.id}-allowed`, `${p.name}（${p.city}）：規格允許放過`, "INFO", `${allowed.length ? groupBy(allowed) : "0"}｜無硬訊號 ${softLeak.length} 例${softLeak.length ? `：${[...new Set(softLeak.map((s) => s.split("/")[0]))].join("、")}` : ""}`);
    record("P3", `${p.id}-correct`, `${p.name}（${p.city}）：只有正確候選時各組合顯示正確地點`, lostCorrect.length ? "FAIL" : "PASS", lostCorrect.join("；") || "全部顯示");
  }

  record("P3", "sanity", "P3 非空測：他國候選確實會被 resolve 選中（再交給 Details 防線）", leaks.rivalResolved > 0 ? "PASS" : "FAIL", `resolve 選中他國候選 ${leaks.rivalResolved} 次`);

  // ════════ P4. 工程師自述風險與排序回歸 ════════
  // R1 Melbourne, FL：Details 改寫成鄰近社區名（不含 Melbourne）
  {
    const h = { name: "Eau Gallie Arts District", address: "1500 Highland Ave, Melbourne, FL 32935", lat: null, lng: null };
    const fetched = { lat: 28.1302, lng: -80.6266, address: "1500 Highland Ave, Eau Gallie, FL 32935, USA" };
    const ok1 = g.isResolvedPlaceGeoConsistent(h, fetched);
    const ok2 = g.isResolvedPlaceGeoConsistent(h, { ...fetched, address: "1500 Highland Ave, Melbourne, FL 32935, USA" });
    const hv = { name: "Venice Beach Boardwalk", address: "1800 Ocean Front Walk, Venice, CA 90291", lat: null, lng: null };
    const ok3 = g.isResolvedPlaceGeoConsistent(hv, { lat: 33.985, lng: -118.4695, address: "1800 Ocean Front Walk, Los Angeles, CA 90291, USA" });
    const hl = { name: "Storybook Gardens", address: "1958 Storybook Ln, London, Ontario", lat: null, lng: null };
    const ok4 = g.isResolvedPlaceGeoConsistent(hl, { lat: 42.9706, lng: -81.2958, address: "1958 Storybook Ln, Springbank Park, ON N6K 4N4, Canada" });
    record("P4", "R1", "風險 1：地址城市錨點誤拒（handoff 地址城市與 Details 城市名不同）", ok1 && ok3 && ok4 ? "PASS" : "FAIL",
      `Melbourne FL→Eau Gallie: ${ok1}；→Melbourne FL: ${ok2}；Venice CA→Los Angeles CA: ${ok3}；London Ontario→Springbank Park ON: ${ok4}（HEAD 無防線＝皆接受）`);
  }
  // R2 S7/R3：拉斯維加斯艾菲爾 Details 無國名／無地址／無座標
  {
    const hs = [
      ["ctx-country FR", { name: "Eiffel Tower", address: null, lat: null, lng: null, contextCountry: "France" }],
      ["addr-local Paris", { name: "Eiffel Tower", address: "Champ de Mars, 75007 Paris", lat: null, lng: null }],
    ];
    const out = [];
    for (const [k, h] of hs) {
      out.push(`${k}: 無國名=${g.isResolvedPlaceGeoConsistent(h, { lat: 36.1125, lng: -115.1728, address: "3655 S Las Vegas Blvd" })}`);
      out.push(`${k}: 無地址=${g.isResolvedPlaceGeoConsistent(h, { lat: 36.1125, lng: -115.1728, address: null })}`);
      out.push(`${k}: 無座標有國名=${g.isResolvedPlaceGeoConsistent(h, { lat: null, lng: null, address: "Las Vegas, NV, USA" })}`);
      out.push(`${k}: 拉斯維加斯郊外（離已知點>50km）無國名=${g.isResolvedPlaceGeoConsistent(h, { lat: 36.6, lng: -116.0, address: "Amargosa Valley" })}`);
    }
    // B18 指派者裁定：ctx-country FR（有 context）→ Details 有座標但無國名／無地址時仍擋（規則 E：> 2000 km 且推得 US）；
    // addr-local Paris（地址無國名、無 context、無座標）→ 城市名不推國家，無固定資料 → 全部接受（與 HEAD 相同，HEAD 無 Details 防線）。
    const ctxRows = out.filter((s) => s.startsWith("ctx-country"));
    const addrRows = out.filter((s) => s.startsWith("addr-local"));
    const ctxOk = ctxRows.filter((s) => (s.includes("無國名=") || s.includes("無地址=")) && !s.includes("郊外")).every((s) => s.endsWith("false"))
      && ctxRows.filter((s) => s.includes("無座標有國名=") || s.includes("郊外")).every((s) => s.endsWith("true"));
    const addrOk = addrRows.every((s) => s.endsWith("true"));
    record("P4", "R2", "風險 2：拉斯維加斯艾菲爾（B18 裁定）— ctx-country FR：有座標無國名／無地址 → 擋；addr-local Paris（無固定資料）→ 與 HEAD 相同全部接受", ctxOk && addrOk ? "PASS" : "FAIL", out.join("；"));
  }
  // R3 國名子字串
  {
    const probe = (t) => JSON.stringify([...g.explicitCountriesInGeoText(t)]);
    const s = [
      ["大阪市浪速区日本橋", probe("大阪府大阪市浪速区日本橋4丁目")],
      ["서울 ... 인도", probe("서울특별시 중구 세종대로 99 인도")],
      ["인도어 골프", probe("서울특별시 강남구 테헤란로 152 인도어골프장")],
      ["中国自動車道", probe("兵庫県西宮市塩瀬町名塩 中国自動車道")],
      ["アメリカ", probe("アメリカ ニューヨーク州")],
      ["アメリカ合衆国", probe("アメリカ合衆国 ニューヨーク州")],
      ["中華人民共和国（ja）", probe("中華人民共和国 上海市")],
      ["Little India", probe("Little India, Singapore")],
      ["Little Italy", probe("Little Italy, New York")],
      ["Canada Water", probe("Canada Water, London")],
      ["Greece, NY", probe("Greece, NY 14626")],
      ["Indiana", probe("Indianapolis, Indiana")],
      ["Chinatown", probe("Chinatown, San Francisco")],
    ];
    record("P4", "R3", "風險 3：國名子字串辨識結果（INFO；擋錯後果見 P1）", "INFO", s.map(([k, v]) => `${k}=${v}`).join("；"));
  }
  // R5 排序回歸：地址無國名、城市推得的國家與真正國家不同 → 正確候選被 -150，他國同名被選中
  {
    const cases = [
      {
        tag: "Paris TX 艾菲爾複製品",
        h: { name: "Eiffel Tower", address: "2025 S Collegiate Dr, Paris, TX 75460", lat: null, lng: null },
        right: { placeId: "ChIJ_R5_TX", label: "Eiffel Tower", secondary: "South Collegiate Drive, Paris, TX, USA", types: POI },
        wrong: { placeId: "ChIJ_R5_FR", label: "Eiffel Tower", secondary: "Avenue Gustave Eiffel, Paris, France", types: POI },
        det: { ChIJ_R5_TX: { lat: 33.6627, lng: -95.547, address: "2025 S Collegiate Dr, Paris, TX 75460, USA" }, ChIJ_R5_FR: { lat: 48.8584, lng: 2.2945, address: "Av. Gustave Eiffel, 75007 Paris, France" } },
      },
      {
        tag: "Melbourne FL Hilton",
        h: { name: "Hilton", address: "200 Rialto Pl, Melbourne, FL 32901", lat: null, lng: null },
        right: { placeId: "ChIJ_R5_FL", label: "Hilton Melbourne Rialto Place", secondary: "Rialto Place, Melbourne, FL, USA", types: POI },
        wrong: { placeId: "ChIJ_R5_AU", label: "Hilton Melbourne Little Queen Street", secondary: "Little Queen Street, Melbourne VIC, Australia", types: POI },
        det: { ChIJ_R5_FL: { lat: 28.1036, lng: -80.6406, address: "200 Rialto Pl, Melbourne, FL 32901, USA" }, ChIJ_R5_AU: { lat: -37.8162, lng: 144.9575, address: "210 Little Queen St, Melbourne VIC 3000, Australia" } },
      },
      {
        tag: "London ON Hilton",
        h: { name: "Hilton London", address: "300 King St, London, ON N6B 1S2", lat: null, lng: null },
        right: { placeId: "ChIJ_R5_ON", label: "Hilton London", secondary: "King Street, London, ON, Canada", types: POI },
        wrong: { placeId: "ChIJ_R5_UK", label: "Hilton London", secondary: "Park Lane, London, UK", types: POI },
        det: { ChIJ_R5_ON: { lat: 42.9826, lng: -81.2459, address: "300 King St, London, ON N6B 1S2, Canada" }, ChIJ_R5_UK: { lat: 51.5054, lng: -0.1502, address: "22 Park Ln, London W1K 1BE, UK" } },
      },
    ];
    for (const c of cases) {
      const cands = [c.right, c.wrong]; // Google 回傳順序：查詢含 TX／FL／ON，本地候選在前
      const d = await displayed(c.h, cands, c.det);
      const hd = await displayedHead(c.h, cands);
      const center = d.centers?.[0];
      const workWrong = d.shown === c.wrong.placeId;
      const headWrong = hd ? hd.shown === c.wrong.placeId : null;
      record("P4", `R5-${c.tag}`, `排序：${c.tag}（地址無國名、城市名與他國大城同名）→ 不得改選他國同名`, workWrong && headWrong === false ? "FAIL" : workWrong ? "INFO" : "PASS",
        `工作樹顯示=${d.shown}；HEAD 顯示=${hd?.shown ?? "未載入"}；工作樹 Autocomplete center=${center ? `${center.lat},${center.lng}` : "無"}（HEAD 無 center）${workWrong && headWrong === false ? "（相對 HEAD 為回歸）" : ""}`);
    }
  }

  // R6 延伸點跨國：contextCountry=主目的地國家，錨點=該國所有已知中心點（contextAnchorCity 替代做法）
  {
    const ext = [
      ["新加坡→新山", { city: "新加坡", country: "Singapore" }, "新山", { lat: 1.4655, lng: 103.7578, address: "Johor Bahru, Johor, Malaysia" }, true],
      ["曼谷→暹粒", { city: "曼谷", country: "Thailand" }, "暹粒", { lat: 13.4125, lng: 103.867, address: "Krong Siem Reap, Cambodia" }, true],
      ["巴黎→倫敦", { city: "巴黎", country: "France" }, "倫敦", { lat: 51.5007, lng: -0.1246, address: "London SW1A 0AA, UK" }, true],
      ["巴黎→阿姆斯特丹", { city: "巴黎", country: "France" }, "阿姆斯特丹", { lat: 52.36, lng: 4.8852, address: "Museumstraat 1, Amsterdam, Netherlands" }, true],
      ["香港→深圳", { city: "香港", country: "Hong Kong" }, "深圳", { lat: 22.5431, lng: 114.0579, address: "中國廣東省深圳市福田區" }, true],
      ["蘇黎世→米蘭", { city: "Zurich", country: "Switzerland" }, "Milan", { lat: 45.4642, lng: 9.19, address: "Piazza del Duomo, Milano, Italy" }, true],
      ["雪梨→藍山（抓回拉斯維加斯）", { city: "雪梨", country: "Australia" }, "藍山", { lat: 36.1125, lng: -115.1728, address: "Las Vegas, NV, USA" }, false],
    ];
    const bad = [];
    for (const [tag, dest, extName, fetched, want] of ext) {
      const h = itin("景點", dest, extName);
      const got = g.isResolvedPlaceGeoConsistent(h, fetched);
      if (got !== want) bad.push(`${tag}: got=${got} want=${want}`);
    }
    record("P4", "R6", "延伸點跨國一日遊：主目的地國家錨點不誤拒、遠距他國仍擋", bad.length ? "FAIL" : "PASS", bad.join("；") || ext.map((e) => `${e[0]}=${e[4] ? "接受" : "拒絕"}`).join("；"));
  }

  const out = ["\n=== verify-place-geo-b16-false-block-sample ==="];
  for (const r of results) out.push(`[${r.status}] ${r.sec}/${r.id} ${r.title}\n       ${r.detail}`);
  out.push(`[INFO] P3 漏擋統計：硬訊號漏擋 ${leaks.hard}／規格允許 ${leaks.specAllowed}／無硬訊號 ${leaks.soft}`);
  out.push(`[INFO] 外部網路呼叫總數 = ${externalCalls}`);
  const failed = results.filter((r) => r.status === "FAIL");
  out.push(`摘要：PASS ${results.filter((r) => r.status === "PASS").length}／FAIL ${failed.length}／INFO ${results.filter((r) => r.status === "INFO").length}${failed.length ? `；失敗：${failed.map((r) => `${r.sec}/${r.id}`).join(", ")}` : ""}`);
  process.stdout.write(`${out.join("\n")}\n`);
  if (failed.length || externalCalls > 0) exitCode = 1;
} catch (e) {
  loud();
  process.stdout.write(`[b16-sample] 執行失敗：${e?.stack ?? e}\n`);
  exitCode = 1;
} finally {
  await server.close().catch(() => {});
  clearTimeout(watchdog);
}
process.exit(exitCode);
