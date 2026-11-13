#!/usr/bin/env node
/**
 * B1 — 同名不同國家地點的地理防護回歸測試（Sydney Tower 被存成烏蘭巴托地址）。
 *
 * 執行：npx vite-node scripts/verify-place-detail-same-name-geo-guard.mjs --config scripts/vite.verify.config.mjs
 *
 * 作法：
 *  - 在本腳本內另起一個 vite + vite-node runner，用 plugin 把 `@/services/placesService` 換成
 *    「re-export 真模組 + 覆寫 searchPlaces」的虛擬模組，因此載入的是真正的
 *    src/lib/place-detail-resolve.ts / src/lib/saved-place-utils.ts（含修正後新增的 helper）。
 *  - searchPlaces 由 mock 依 query 回傳固定候選；fetch / XHR / http(s) / net / tls 全部攔截計數，必須為 0。
 *  - 每個案例獨立記錄 PASS / FAIL；「待規格」案例只記錄現況，不影響 exit code。
 *
 * 涵蓋：
 *  a. Sydney Tower：handoff 帶雪梨／澳洲脈絡（地址、城市、座標、收藏清單入口）→ 不得選烏蘭巴托的同名「Sydney Tower」。
 *  b. N Seoul Tower vs 他國同名；Hilton Hotel 連鎖同名。
 *  c. 正例：地理相符的完全同名（含 台/臺 異體字、座標脈絡、只有一個合理候選）仍要採用；既有 googlePlaceId 不查詢。
 *  d. 完全沒有地理脈絡：記錄現況（待規格）。
 *  成本：每次解析的 searchPlaces 呼叫數不得超過修正前上限（有地址 ≤2、無地址 ≤1），fetch = 0。
 */
// 由腳本位置推得 repo 根目錄，才能在 verify-rel1-head-snapshot 建的 HEAD 快照上對照執行。
const WORK_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const HARD_TIMEOUT_MS = 50_000;
const watchdog = setTimeout(() => {
  process.stdout.write(`\n[geo-guard] 超過 ${HARD_TIMEOUT_MS}ms，強制結束\n`);
  process.exit(2);
}, HARD_TIMEOUT_MS);
watchdog.unref?.();

// ── 網路攔截（必須在載入任何 app 模組前）─────────────────────────────
let externalCalls = 0;
const externalLog = [];
const trap = (kind, detail) => {
  externalCalls += 1;
  externalLog.push(`${kind}:${String(detail).slice(0, 120)}`);
  throw new Error(`[geo-guard] external ${kind} blocked`);
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
/** @type {{query:string, center?:{lat:number,lng:number}, locale?:string}[]} */
let searchLog = [];
/** @type {(query:string, opts:any)=>any[]} */
let candidateProvider = () => [];
globalThis.__geoGuardSearchPlaces = async (query, opts) => {
  searchLog.push({ query, center: opts?.center, locale: opts?.locale });
  return { suggestions: candidateProvider(query, opts) ?? [], error: null };
};

// ── 另起 vite-node runner，替換 placesService ───────────────────────
const { createServer } = await import("vite");
const { ViteNodeServer } = await import("vite-node/server");
const { ViteNodeRunner } = await import("vite-node/client");
const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
const MOCK_ID = "\0geo-guard-places-service";
const REAL_PLACES_SERVICE = `${WORK_ROOT}/src/services/placesService.ts?geo-guard-real`;
const server = await createServer({
  root: WORK_ROOT,
  configFile: false,
  envDir: false,
  logLevel: "warn",
  clearScreen: false,
  plugins: [
    {
      name: "geo-guard-mock-places-service",
      enforce: "pre",
      resolveId(id) {
        if (id.includes("geo-guard-real")) return null;
        if (/(^|\/)services\/placesService(\.ts)?$/.test(id)) return MOCK_ID;
        return null;
      },
      load(id) {
        if (id !== MOCK_ID) return null;
        return [
          `export * from ${JSON.stringify(REAL_PLACES_SERVICE)};`,
          `export const searchPlaces = (...args) => globalThis.__geoGuardSearchPlaces(...args);`,
        ].join("\n");
      },
    },
    tsconfigPaths(),
  ],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

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
  const resolveMod = await runner.executeFile(`${WORK_ROOT}/src/lib/place-detail-resolve.ts`);
  const savedUtils = await runner.executeFile(`${WORK_ROOT}/src/lib/saved-place-utils.ts`);
  const { resolveGooglePlaceIdForDetail } = resolveMod;
  const { savedPlaceToHandoff } = savedUtils;
  if (typeof resolveGooglePlaceIdForDetail !== "function") throw new Error("resolveGooglePlaceIdForDetail 未匯出");

  // ── 候選資料（模擬 Google Autocomplete：bias 不是 restriction，他國同名仍可能出現）──
  const ID = {
    ubSydneyTower: "ChIJ_UB_SYDNEY_TOWER_MONGOLIA",
    sydneyTowerEye: "ChIJ_SYD_SYDNEY_TOWER_EYE_AU",
    laNSeoulTower: "ChIJ_LA_N_SEOUL_TOWER_USA",
    seoulNSeoulTower: "ChIJ_SEL_N_SEOUL_TOWER_KR",
    sydneyHilton: "ChIJ_SYD_HILTON_HOTEL_AU",
    tokyoHilton: "ChIJ_TYO_HILTON_TOKYO_JP",
    taipei101: "ChIJ_TPE_TAIPEI_101_TW",
    taipei101Fake: "ChIJ_LAX_TAIPEI_101_RESTAURANT_US",
  };
  const POI = ["point_of_interest", "establishment"];
  const UB_SYDNEY_TOWER = {
    placeId: ID.ubSydneyTower,
    label: "Sydney Tower",
    secondary: "Chinggis Avenue, Ulaanbaatar, Mongolia",
    types: ["premise", ...POI],
  };
  const SYD_TOWER_EYE = {
    placeId: ID.sydneyTowerEye,
    label: "Sydney Tower Eye",
    secondary: "Market Street, Sydney NSW, Australia",
    types: ["tourist_attraction", ...POI],
  };
  const LA_N_SEOUL = {
    placeId: ID.laNSeoulTower,
    label: "N Seoul Tower",
    secondary: "Wilshire Boulevard, Los Angeles, CA, USA",
    types: ["restaurant", "food", ...POI],
  };
  const SEL_N_SEOUL_ALT = {
    placeId: ID.seoulNSeoulTower,
    label: "N Seoul Tower (Namsan Tower)",
    secondary: "Namsangongwon-gil, Yongsan-gu, Seoul, South Korea",
    types: ["tourist_attraction", ...POI],
  };
  const SEL_N_SEOUL_EXACT = { ...SEL_N_SEOUL_ALT, label: "N Seoul Tower" };
  const SYD_HILTON = {
    placeId: ID.sydneyHilton,
    label: "Hilton Hotel",
    secondary: "George Street, Sydney NSW, Australia",
    types: ["lodging", ...POI],
  };
  const TYO_HILTON = {
    placeId: ID.tokyoHilton,
    label: "Hilton Tokyo",
    secondary: "Nishishinjuku, Shinjuku City, Tokyo, Japan",
    types: ["lodging", ...POI],
  };
  const TPE_101 = {
    placeId: ID.taipei101,
    label: "台北101",
    secondary: "臺灣臺北市信義區信義路五段7號",
    types: ["tourist_attraction", ...POI],
  };
  const US_101 = {
    placeId: ID.taipei101Fake,
    label: "台北101",
    secondary: "Rowland Heights, CA, USA",
    types: ["restaurant", ...POI],
  };

  const SYDNEY = { lat: -33.8705, lng: 151.2089 };
  const SEOUL = { lat: 37.5512, lng: 126.9882 };
  const TOKYO = { lat: 35.6925, lng: 139.6909 };

  const baseHandoff = (over) => ({
    placeId: over.placeId ?? `saved-${Math.random().toString(36).slice(2, 8)}`,
    name: over.name,
    address: over.address ?? null,
    lat: over.lat ?? null,
    lng: over.lng ?? null,
    ...over,
  });

  const results = [];
  const runCase = async ({ id, title, handoff, candidates, locale = "zh-TW", expect, maxSearches, pendingSpec = false }) => {
    searchLog = [];
    candidateProvider = typeof candidates === "function" ? candidates : () => candidates;
    const fetchBefore = externalCalls;
    let got;
    let thrown = null;
    try {
      got = await resolveGooglePlaceIdForDetail(handoff, locale);
    } catch (e) {
      thrown = e;
    }
    const searches = searchLog.length;
    const centers = searchLog.map((s) => (s.center ? `${s.center.lat},${s.center.lng}` : "none"));
    const problems = [];
    if (thrown) problems.push(`拋出例外：${thrown?.message ?? thrown}`);
    if (!pendingSpec && !thrown) {
      const verdict = expect(got ?? null);
      if (verdict !== true) problems.push(verdict);
    }
    if (maxSearches != null && searches > maxSearches)
      problems.push(`searchPlaces 呼叫 ${searches} 次，超過修正前上限 ${maxSearches}（不得新增 Google 呼叫）`);
    if (externalCalls !== fetchBefore) problems.push(`偵測到外部網路呼叫 ${externalCalls - fetchBefore} 次`);
    const status = pendingSpec ? (problems.length ? "FAIL" : "待規格") : problems.length ? "FAIL" : "PASS";
    results.push({ id, title, status, got: got ?? null, searches, centers, queries: searchLog.map((s) => s.query), problems });
  };

  const mustNotBe = (bad, ok) => (got) => {
    const okText = ok.map((v) => String(v)).join(" 或 ");
    if (got === bad) return `選到他國同名地點 ${bad}；預期 ${okText}`;
    if (!ok.includes(got)) return `回傳 ${got}；預期 ${okText}`;
    return true;
  };
  const mustBe = (want) => (got) => (got === want ? true : `回傳 ${got}；預期採用地理相符的 ${want}（修過頭）`);
  const sameAsHead = (headGot) => (got) => (got === headGot ? true : `回傳 ${got}；預期與 HEAD 相同（${headGot}）`);

  // ── a. Sydney Tower ───────────────────────────────────────────────
  const sydneyOk = [ID.sydneyTowerEye, null];
  await runCase({
    id: "a1",
    title: "Sydney Tower｜handoff 地址含 Sydney NSW, Australia（無座標）",
    handoff: baseHandoff({ name: "Sydney Tower", address: "100 Market St, Sydney NSW 2000, Australia" }),
    candidates: [UB_SYDNEY_TOWER, SYD_TOWER_EYE],
    expect: mustNotBe(ID.ubSydneyTower, sydneyOk),
    maxSearches: 2,
  });
  await runCase({
    id: "a2",
    title: "Sydney Tower｜handoff 只有雪梨座標（無地址）",
    handoff: baseHandoff({ name: "Sydney Tower", ...SYDNEY }),
    candidates: [UB_SYDNEY_TOWER, SYD_TOWER_EYE],
    expect: mustNotBe(ID.ubSydneyTower, sydneyOk),
    maxSearches: 1,
  });
  await runCase({
    id: "a3",
    title: "Sydney Tower｜handoff 地址只有城市「Sydney」",
    handoff: baseHandoff({ name: "Sydney Tower", address: "Sydney" }),
    candidates: [UB_SYDNEY_TOWER, SYD_TOWER_EYE],
    // B18 指派者裁定（規則 B）：城市名不推國家；地址無國名、無 context、無座標 → 與 HEAD 相同。
    // HEAD 計分：烏蘭巴托 完全同名 100 + 包含 40 = 140；雪梨 包含 40 + 地址含 Sydney 30 = 70 → 選烏蘭巴托。
    expect: sameAsHead(ID.ubSydneyTower),
    maxSearches: 2,
  });
  await runCase({
    id: "a4",
    title: "Sydney Tower｜地址＋座標皆為雪梨，候選順序 Sydney 在前",
    handoff: baseHandoff({ name: "Sydney Tower", address: "Sydney NSW, Australia", ...SYDNEY }),
    candidates: [SYD_TOWER_EYE, UB_SYDNEY_TOWER],
    expect: mustNotBe(ID.ubSydneyTower, sydneyOk),
    maxSearches: 2,
  });
  if (typeof savedPlaceToHandoff === "function") {
    // 收藏清單入口（_app.saved.index.tsx → savedPlaceToHandoff）：收藏時沒有 placeId，city=雪梨
    const saved = {
      id: "saved-row-1",
      name: "Sydney Tower",
      category: "tourist_attraction",
      address: null,
      city: "Sydney",
      lat: null,
      lng: null,
      notes: null,
      mood_tag: null,
      cover_image: null,
      image_url: null,
      image_source: null,
      metadata: {},
      created_at: "2026-11-01T00:00:00.000Z",
    };
    await runCase({
      id: "a5",
      title: "Sydney Tower｜收藏清單入口 savedPlaceToHandoff（city=Sydney，無地址、無座標、無 placeId）",
      handoff: savedPlaceToHandoff(saved),
      candidates: [UB_SYDNEY_TOWER, SYD_TOWER_EYE],
      expect: mustNotBe(ID.ubSydneyTower, sydneyOk),
      maxSearches: 1,
    });
  } else {
    results.push({ id: "a5", title: "savedPlaceToHandoff 未匯出", status: "FAIL", problems: ["savedPlaceToHandoff 不存在"], got: null, searches: 0, centers: [], queries: [] });
  }

  // ── b. 他國同名 / 連鎖同名 ─────────────────────────────────────────
  await runCase({
    id: "b1",
    title: "N Seoul Tower｜首爾地址，候選有洛杉磯同名餐廳（完全同名）",
    handoff: baseHandoff({ name: "N Seoul Tower", address: "Yongsan-gu, Seoul, South Korea" }),
    candidates: [LA_N_SEOUL, SEL_N_SEOUL_ALT],
    expect: mustNotBe(ID.laNSeoulTower, [ID.seoulNSeoulTower, null]),
    maxSearches: 2,
  });
  await runCase({
    id: "b2",
    title: "N Seoul Tower｜只有首爾座標",
    handoff: baseHandoff({ name: "N Seoul Tower", ...SEOUL }),
    candidates: [LA_N_SEOUL, SEL_N_SEOUL_ALT],
    expect: mustNotBe(ID.laNSeoulTower, [ID.seoulNSeoulTower, null]),
    maxSearches: 1,
  });
  await runCase({
    id: "b3",
    title: "Hilton Hotel｜東京地址＋座標，候選有雪梨「Hilton Hotel」（完全同名）",
    handoff: baseHandoff({ name: "Hilton Hotel", address: "Shinjuku, Tokyo, Japan", ...TOKYO }),
    candidates: [SYD_HILTON, TYO_HILTON],
    expect: mustNotBe(ID.sydneyHilton, [ID.tokyoHilton, null]),
    maxSearches: 2,
  });
  await runCase({
    id: "b4",
    title: "台北101｜台北市地址，候選有美國同名餐廳排第一",
    handoff: baseHandoff({ name: "台北101", address: "台北市信義區" }),
    candidates: [US_101, TPE_101],
    // B18 指派者裁定（規則 B）：「台北市信義區」沒寫國名、無 context、無座標 → 與 HEAD 相同。
    // HEAD 計分：兩者皆 完全同名 100 + 包含 40 = 140（候選地址是「臺」，不含「台北市信義區」）→ 同分取第一個（美國）。
    expect: sameAsHead(ID.taipei101Fake),
    maxSearches: 2,
  });

  // ── c. 正例（避免修過頭）──────────────────────────────────────────
  await runCase({
    id: "c1",
    title: "Sydney Tower Eye｜雪梨地址，完全同名且在雪梨 → 必須採用",
    handoff: baseHandoff({ name: "Sydney Tower Eye", address: "Sydney NSW, Australia" }),
    candidates: [UB_SYDNEY_TOWER, SYD_TOWER_EYE],
    expect: mustBe(ID.sydneyTowerEye),
    maxSearches: 2,
  });
  await runCase({
    id: "c2",
    title: "N Seoul Tower｜首爾地址，首爾完全同名 → 必須採用",
    handoff: baseHandoff({ name: "N Seoul Tower", address: "Yongsan-gu, Seoul, South Korea" }),
    candidates: [SEL_N_SEOUL_EXACT],
    expect: mustBe(ID.seoulNSeoulTower),
    maxSearches: 2,
  });
  await runCase({
    id: "c3",
    title: "Sydney Tower Eye｜只有雪梨座標，唯一候選在雪梨 → 必須採用",
    handoff: baseHandoff({ name: "Sydney Tower Eye", ...SYDNEY }),
    candidates: [SYD_TOWER_EYE],
    expect: mustBe(ID.sydneyTowerEye),
    maxSearches: 1,
  });
  await runCase({
    id: "c4",
    title: "台北101｜handoff「台北市」、候選地址「臺北市」（台/臺 異體字）→ 必須採用",
    handoff: baseHandoff({ name: "台北101", address: "台北市信義區" }),
    candidates: [TPE_101],
    expect: mustBe(ID.taipei101),
    maxSearches: 2,
  });
  await runCase({
    id: "c5",
    title: "Hilton Tokyo｜東京地址＋座標，東京完全同名 → 必須採用",
    handoff: baseHandoff({ name: "Hilton Tokyo", address: "Shinjuku, Tokyo, Japan", ...TOKYO }),
    candidates: [TYO_HILTON, SYD_HILTON],
    expect: mustBe(ID.tokyoHilton),
    maxSearches: 2,
  });
  await runCase({
    id: "c6",
    title: "已有 googlePlaceId → 直接回傳、0 次查詢",
    handoff: baseHandoff({ name: "Sydney Tower", googlePlaceId: ID.sydneyTowerEye, placeId: ID.sydneyTowerEye }),
    candidates: [UB_SYDNEY_TOWER],
    expect: mustBe(ID.sydneyTowerEye),
    maxSearches: 0,
  });

  // ── d. 無地理脈絡（待規格）────────────────────────────────────────
  await runCase({
    id: "d1",
    title: "Sydney Tower｜無地址、無座標、無城市（待規格：採用或回 null 皆未定）",
    handoff: baseHandoff({ name: "Sydney Tower" }),
    candidates: [UB_SYDNEY_TOWER, SYD_TOWER_EYE],
    pendingSpec: true,
    maxSearches: 1,
  });

  // ── e. B4 補充：成本與舊收藏資料 ─────────────────────────────────────
  // e1：有地址、第一次查詢的所有場館候選都是他國 → 修正前第 1 次查詢就回傳（1 次 Autocomplete），
  //     修正後會繼續第 2 個 query（名稱單獨查），Autocomplete 次數 1 → 2。
  await runCase({
    id: "e1",
    title: "成本｜有地址、第一次查詢的候選全是他國 → Autocomplete 次數不得多於修正前（1 次）",
    handoff: baseHandoff({ name: "Sydney Tower", address: "100 Market St, Sydney NSW 2000, Australia" }),
    candidates: [UB_SYDNEY_TOWER],
    expect: mustNotBe(ID.ubSydneyTower, [null]),
    maxSearches: 1,
  });
  // e2：舊收藏的 city 是「使用者當時所在城市」（HEAD 的 handleSavePlace 存 session.location.city），
  //     地點本身有雪梨座標但沒有地址 → 修正前可解析到雪梨；修正後 city=台北 壓過座標，正確候選被判 mismatch。
  if (typeof savedPlaceToHandoff === "function") {
    await runCase({
      id: "e2",
      title: "舊收藏｜city=台北（使用者所在地）、地點座標在雪梨、無地址、無 placeId → 應採用雪梨候選",
      handoff: savedPlaceToHandoff({
        id: "saved-row-legacy",
        name: "Sydney Tower Eye",
        category: "tourist_attraction",
        address: null,
        city: "台北",
        lat: SYDNEY.lat,
        lng: SYDNEY.lng,
        notes: null,
        mood_tag: null,
        cover_image: null,
        image_url: null,
        image_source: null,
        metadata: {},
        created_at: "2026-10-01T00:00:00.000Z",
      }),
      candidates: [SYD_TOWER_EYE],
      expect: mustBe(ID.sydneyTowerEye),
      maxSearches: 1,
    });
    await runCase({
      id: "e3",
      title: "舊收藏｜city=台北、地址為無國名短地址（Market St）→ 應採用雪梨候選（修正前可採用）",
      handoff: savedPlaceToHandoff({
        id: "saved-row-legacy-2",
        name: "Sydney Tower Eye",
        category: "tourist_attraction",
        address: "100 Market St",
        city: "台北",
        lat: null,
        lng: null,
        notes: null,
        mood_tag: null,
        cover_image: null,
        image_url: null,
        image_source: null,
        metadata: {},
        created_at: "2026-10-01T00:00:00.000Z",
      }),
      candidates: [SYD_TOWER_EYE],
      expect: mustBe(ID.sydneyTowerEye),
      maxSearches: 2,
    });
  }

  // ── 第 (3) 層：收藏城市欄位來源（靜態觀察，不斷言）──────────────────
  const fs = await import("node:fs");
  const chatSrc = fs.readFileSync(`${WORK_ROOT}/src/routes/_app.chat.tsx`, "utf8");
  const saveBlock = chatSrc.slice(chatSrc.indexOf("const handleSavePlace"), chatSrc.indexOf("const handleSavePlace") + 600);
  const cityLine = saveBlock.match(/city:\s*[^\n]+/)?.[0] ?? "(找不到 handleSavePlace city 欄位)";

  // ── 輸出 ──────────────────────────────────────────────────────────
  const out = [];
  out.push("\n=== verify-place-detail-same-name-geo-guard ===");
  for (const r of results) {
    out.push(`[${r.status}] ${r.id} ${r.title}`);
    out.push(`       got=${r.got} searches=${r.searches} centers=[${r.centers.join(" | ")}] queries=${JSON.stringify(r.queries)}`);
    for (const p of r.problems) out.push(`       ✗ ${p}`);
  }
  out.push(`[INFO] 第(3)層 _app.chat.tsx handleSavePlace → ${cityLine.trim()}（render 層，未斷言）`);
  out.push(`[INFO] 外部網路呼叫總數 = ${externalCalls}${externalCalls ? ` ${externalLog.join("; ")}` : ""}`);
  const failed = results.filter((r) => r.status === "FAIL");
  const passed = results.filter((r) => r.status === "PASS");
  const pending = results.filter((r) => r.status === "待規格");
  out.push(`摘要：PASS ${passed.length}／FAIL ${failed.length}／待規格 ${pending.length}${failed.length ? `；失敗：${failed.map((r) => r.id).join(", ")}` : ""}`);
  process.stdout.write(`${out.join("\n")}\n`);
  if (failed.length || externalCalls > 0) exitCode = 1;
} catch (e) {
  process.stdout.write(`[geo-guard] 執行失敗：${e?.stack ?? e}\n`);
  exitCode = 1;
} finally {
  await server.close().catch(() => {});
  clearTimeout(watchdog);
}
process.exit(exitCode);
