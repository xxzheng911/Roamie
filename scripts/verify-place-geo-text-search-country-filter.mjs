#!/usr/bin/env node
/**
 * B4 — 同名不同國家地點：place-geo-guard helper、Autocomplete regionCode、無座標目的地國家篩選。
 *
 * 執行：npx vite-node scripts/verify-place-geo-text-search-country-filter.mjs --config scripts/vite.verify.config.mjs
 *   --only=flow   只跑「給我更多／替代推薦／聊聊推薦」呼叫次數段（可在 HEAD 快照上跑，用來比對呼叫次數）
 *
 * 作法：
 *  - 內嵌 vite + vite-node runner 載入真模組（place-geo-guard、chat-place-search-context、
 *    destination-place-recommendation、chat-place-recommendation）。
 *  - 不 export 的 autocompleteRegionCode（trip-stop-search.functions.ts）、textOnlyDestinationRegionCode
 *    與 searchText（places.functions.ts）用 TypeScript AST 抽出原始碼，注入真的依賴（geo-region、place-geo-guard）
 *    與 mock postPlaces，在 vm 中執行。
 *  - fetch / XHR / http(s) / net / tls 全部攔截，外部呼叫必須為 0。
 *  - 各段獨立記錄 PASS / FAIL / INFO。
 */
import fs from "node:fs";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "";
const HARD_TIMEOUT_MS = 55_000;
const watchdog = setTimeout(() => {
  process.stdout.write(`\n[geo-country-filter] 超過 ${HARD_TIMEOUT_MS}ms，強制結束\n`);
  process.exit(2);
}, HARD_TIMEOUT_MS);
watchdog.unref?.();

// ── 網路攔截 ─────────────────────────────────────────────────────────
let externalCalls = 0;
const externalLog = [];
const trap = (kind, detail) => {
  externalCalls += 1;
  externalLog.push(`${kind}:${String(detail).slice(0, 120)}`);
  throw new Error(`[geo-country-filter] external ${kind} blocked`);
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

const results = [];
const record = (id, title, ok, detail = "") =>
  results.push({ id, title, status: ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL", detail });
const eq = (id, title, got, want) =>
  record(id, title, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);

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
  plugins: [tsconfigPaths()],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

const origConsole = { info: console.info, log: console.log, warn: console.warn, debug: console.debug };
const mute = () => {
  console.info = console.log = console.warn = console.debug = () => {};
};
const unmute = () => Object.assign(console, origConsole);

/** 用 TS AST 抽出不 export 的函式，注入依賴後在 vm 執行 */
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

  // ════════════════ 1. place-geo-guard helpers ════════════════
  if (!ONLY || ONLY === "helpers") {
    const g = await load("src/lib/place-geo-guard.ts");
    const cc = g.countryCodeForCoordinates;
    eq("h1", "countryCodeForCoordinates 台北", cc(25.033, 121.5654), "TW");
    eq("h2", "countryCodeForCoordinates 金門（在 isTaiwanCoordinates 框外，與中國框重疊）", cc(24.4493, 118.3767), "TW");
    eq("h3", "countryCodeForCoordinates 首爾", cc(37.5665, 126.978), "KR");
    eq("h4", "countryCodeForCoordinates 香港（與中國框重疊）", cc(22.3193, 114.1694), "HK");
    eq("h5", "countryCodeForCoordinates 東京", cc(35.6762, 139.6503), "JP");
    eq("h6", "countryCodeForCoordinates 0,0", cc(0, 0), null);
    eq("h7", "countryCodeForCoordinates null/NaN", [cc(null, null), cc(NaN, 1)], [null, null]);
    eq("h8", "countryCodeForCoordinates 廈門（中國，非台灣）", cc(24.4798, 118.0894), "CN");
    eq("h9", "countryCodeForCoordinates 澳門", cc(22.1987, 113.5439), "MO");

    const sydCtx = g.buildPlaceGeoContext({ address: "Market St, Sydney NSW 2000, Australia" });
    eq("j1", "judgeCandidateGeo 雪梨 vs 烏蘭巴托 → mismatch", g.judgeCandidateGeo(sydCtx, "Ulaanbaatar, Mongolia"), "mismatch");
    eq("j2", "judgeCandidateGeo 雪梨 vs Sydney NSW → match", g.judgeCandidateGeo(sydCtx, "Market Street, Sydney NSW, Australia"), "match");
    eq("j3", "judgeCandidateGeo 地址看不出國家 → unknown", g.judgeCandidateGeo(sydCtx, "Market Street"), "unknown");
    eq("j4", "judgeCandidateGeo 候選空字串 → unknown", g.judgeCandidateGeo(sydCtx, ""), "unknown");
    const tpeCtx = g.buildPlaceGeoContext({ address: "台北市信義區" });
    // B18 指派者裁定（規則 B）：「台北市信義區」沒寫國名、無 context、無座標 → 城市名不推國家 → unknown（與 HEAD 相同不加減分）。
    eq("j5", "judgeCandidateGeo 自身地址只有城市（台北市信義區）vs 臺灣臺北市 → unknown（B18）", g.judgeCandidateGeo(tpeCtx, "臺灣臺北市信義區"), "unknown");
    // 台/臺 異體字仍須正規化：自身地址有國名「台灣」時與「臺灣」相符。
    eq("j5b", "judgeCandidateGeo 台/臺 異體字（自身地址含台灣）→ match", g.judgeCandidateGeo(g.buildPlaceGeoContext({ address: "台灣台北市信義區" }), "臺灣臺北市信義區"), "match");
    eq("j5c", "judgeCandidateGeo 台/臺 異體字（contextCountry=台灣）→ match", g.judgeCandidateGeo(g.buildPlaceGeoContext({ address: "台北市信義區", contextCountry: "台灣" }), "臺灣臺北市信義區"), "match");
    const coordCtx = g.buildPlaceGeoContext({ lat: -33.87, lng: 151.21 });
    eq("j6", "judgeCandidateGeo 只有雪梨座標 vs Mongolia → mismatch", g.judgeCandidateGeo(coordCtx, "Ulaanbaatar, Mongolia"), "mismatch");
    eq("j7", "judgeCandidateGeo 只有雪梨座標 vs Australia → match", g.judgeCandidateGeo(coordCtx, "Sydney NSW, Australia"), "match");
    const noCtx = g.buildPlaceGeoContext({});
    eq("j8", "無地理脈絡 hasPlaceGeoContext=false、judge=unknown", [g.hasPlaceGeoContext(noCtx), g.judgeCandidateGeo(noCtx, "Mongolia")], [false, "unknown"]);
    eq("j9", "Indiana（含 india 子字串）不被當成印度", [...g.countriesInGeoText("Indianapolis, Indiana, USA")], ["US"]);
    eq("j10", "New South Wales 不被當成英國", [...g.countriesInGeoText("Sydney, New South Wales")], ["AU"]);

    // isResolvedPlaceGeoConsistent
    eq("r1", "isResolved：無脈絡 → true（維持舊行為）", g.isResolvedPlaceGeoConsistent({}, { lat: 47.9, lng: 106.9, address: "Ulaanbaatar, Mongolia" }), true);
    eq("r2", "isResolved：雪梨座標 vs 烏蘭巴托座標（>300km）→ false", g.isResolvedPlaceGeoConsistent({ lat: -33.87, lng: 151.21 }, { lat: 47.9, lng: 106.9, address: null }), false);
    eq("r3", "isResolved：雪梨座標 vs 雪梨 Details → true", g.isResolvedPlaceGeoConsistent({ lat: -33.87, lng: 151.21 }, { lat: -33.8705, lng: 151.2089, address: "Sydney NSW 2000, Australia" }), true);
    eq("r4", "isResolved：contextCity=Sydney，Details 在蒙古 → false", g.isResolvedPlaceGeoConsistent({ contextCity: "Sydney" }, { lat: 47.9, lng: 106.9, address: "Ulaanbaatar, Mongolia" }), false);
    eq("r5", "isResolved：contextCountry=JP，Details 地址看不出國家、無座標 → true（unknown 保留）", g.isResolvedPlaceGeoConsistent({ contextCountry: "JP" }, { address: "Some Street" }), true);
    eq("r6", "isResolved：contextCountry=JP，Details 座標在美國 → false", g.isResolvedPlaceGeoConsistent({ contextCountry: "JP" }, { lat: 34.05, lng: -118.24, address: null }), false);

    // filterPlacesByCountryAddress
    const places = [
      { id: "jp", address: "Hakodate, Hokkaido, Japan" },
      { id: "us", address: "Los Angeles, CA, USA" },
      { id: "unk", address: "Motomachi 1-2" },
      { id: "nul", address: null },
    ];
    eq("f1", "filterPlacesByCountryAddress 日本：剔除美國，unknown/null 保留", g.filterPlacesByCountryAddress(places, "日本").map((p) => p.id), ["jp", "unk", "nul"]);
    eq("f2", "filterPlacesByCountryAddress ISO JP 同上", g.filterPlacesByCountryAddress(places, "JP").map((p) => p.id), ["jp", "unk", "nul"]);
    eq("f3", "filterPlacesByCountryAddress 無法辨識國家（摩納哥）→ 原樣", g.filterPlacesByCountryAddress(places, "摩納哥").map((p) => p.id), ["jp", "us", "unk", "nul"]);
    eq("f4", "filterPlacesByCountryAddress 無國家 → 原樣", g.filterPlacesByCountryAddress(places, undefined).map((p) => p.id), ["jp", "us", "unk", "nul"]);
    eq("f5", "filterPlacesByCountryAddress 香港：Hong Kong, China 不被剔除", g.filterPlacesByCountryAddress([{ id: "hk", address: "Tsim Sha Tsui, Hong Kong, China" }], "香港").map((p) => p.id), ["hk"]);
    const ent = await load("src/lib/ai/destination-entity.ts");
    const unknownCountries = [];
    for (const name of ["冰島", "印尼", "台灣", "土耳其", "摩納哥", "新加坡", "日本", "梵蒂岡", "法國", "泰國", "澳洲", "澳門", "瑞士", "美國", "義大利", "菲律賓", "蒙古", "越南", "韓國", "香港", "馬爾地夫"]) {
      if (!g.countryCodeFromCountryText(name)) unknownCountries.push(name);
    }
    record("f6", "destination-entity 的 country 值多數可對應國家碼（無法對應者不篩，屬安全退化）", "INFO", `無法對應：${unknownCountries.join("、") || "無"}`);
    void ent;

    // ── 舊收藏 city（使用者當時所在城市）與地點本身座標衝突 ──
    const staleCity = { contextCity: "台北", lat: -33.8705, lng: 151.2089, address: null };
    eq(
      "s1",
      "舊收藏：city=台北（使用者所在地），地點自身座標在雪梨、無地址 → 雪梨候選不應被判 mismatch",
      g.judgeCandidateGeo(g.buildPlaceGeoContext(staleCity), "Market Street, Sydney NSW, Australia"),
      "match",
    );
    eq(
      "s2",
      "舊收藏：同上，Details 抓回雪梨 → isResolvedPlaceGeoConsistent 應為 true",
      g.isResolvedPlaceGeoConsistent(staleCity, { lat: -33.8705, lng: 151.2089, address: "Sydney NSW 2000, Australia" }),
      true,
    );
    const staleShortAddr = { contextCity: "台北", address: "新宿区西新宿2丁目8-1", lat: null, lng: null };
    record(
      "s3",
      "舊收藏：city=台北、地址為無國名短地址（新宿区…），東京候選的判定（現況紀錄）",
      "INFO",
      `verdict=${g.judgeCandidateGeo(g.buildPlaceGeoContext(staleShortAddr), "Nishishinjuku, Shinjuku City, Tokyo, Japan")}`,
    );
  }

  // ════════════════ 2. Autocomplete / Text Search regionCode ════════════════
  if (!ONLY || ONLY === "region") {
    const geoRegion = await load("src/lib/geo-region.ts");
    const g = await load("src/lib/place-geo-guard.ts");
    const cfg = await load("src/lib/places-search-config.ts");
    const { ctx: ac, missing } = await extractFunctions("src/lib/trip-stop-search.functions.ts", ["autocompleteRegionCode"], {
      PLACES_REGION: cfg.PLACES_REGION,
      isTaiwanCoordinates: geoRegion.isTaiwanCoordinates,
      countryCodeForCoordinates: g.countryCodeForCoordinates,
    });
    if (missing.length) record("a0", "autocompleteRegionCode 存在", false, `缺少 ${missing}`);
    else {
      eq("a1", "Autocomplete 台北座標 → TW（照舊）", ac.autocompleteRegionCode(25.033, 121.5654), "TW");
      eq("a2", "Autocomplete 金門座標 → TW", ac.autocompleteRegionCode(24.4493, 118.3767), "TW");
      eq("a3", "Autocomplete 東京座標 → JP", ac.autocompleteRegionCode(35.6762, 139.6503), "JP");
      eq("a4", "Autocomplete 雪梨座標 → AU", ac.autocompleteRegionCode(-33.8688, 151.2093), "AU");
      eq("a5", "Autocomplete 無座標 → TW（照舊）", ac.autocompleteRegionCode(undefined, undefined), "TW");
      eq("a6", "Autocomplete 0,0 → TW（照舊）", ac.autocompleteRegionCode(0, 0), "TW");
      eq("a7", "Autocomplete 不在任何國家框（南極）→ 不送 regionCode", ac.autocompleteRegionCode(-80, 0), undefined);
      eq("a8", "Autocomplete PLACES_REGION 為 TW", cfg.PLACES_REGION, "TW");
    }

    // searchText + textOnlyDestinationRegionCode（postPlaces mock，記錄 body）
    const bodies = [];
    const { ctx: st, missing: m2 } = await extractFunctions(
      "src/lib/places.functions.ts",
      ["exploreLocale", "searchText", "textOnlyDestinationRegionCode"],
      {
        placesRegionCodeFromCoordinates: geoRegion.placesRegionCodeFromCoordinates,
        countryCodeFromCountryText: g.countryCodeFromCountryText,
        localeToGoogleLanguageCode: () => "zh-TW",
        effectiveAppLocale: () => "zh-TW",
        locationCircle: (lat, lng, radius) => ({ circle: { center: { latitude: lat, longitude: lng }, radius } }),
        placesSearchTextUrl: () => "mock://searchText",
        postPlaces: async (_url, body) => {
          bodies.push(body);
          return { places: [], error: "mock_stop", requestId: "r" };
        },
        devVerboseInfo: () => {},
      },
    );
    if (m2.length) record("t0", "searchText / textOnlyDestinationRegionCode 存在", false, `缺少 ${m2}`);
    else {
      const run = async (data) => {
        bodies.length = 0;
        const fallback = st.textOnlyDestinationRegionCode(data);
        await st.searchText("k", "q", data.lat, data.lng, 5000, 20, "zh-TW", undefined, data.skipLocationBias === true, fallback);
        return bodies[0]?.regionCode;
      };
      const base = { query: "q", searchMode: "destination", skipLocationBias: true, lat: 0, lng: 0 };
      eq("t1", "Text Search 無座標＋日本 → regionCode=JP", await run({ ...base, destinationCountry: "日本" }), "JP");
      eq("t2", "Text Search 無座標＋台灣 → 不送（照舊）", await run({ ...base, destinationCountry: "台灣" }), undefined);
      eq("t3", "Text Search 無座標＋無國家 → 不送（照舊）", await run({ ...base }), undefined);
      eq("t4", "Text Search 探索頁自由搜尋 map.freeTextSearch → 不篩不補", await run({ ...base, destinationCountry: "日本", placesCaller: "map.freeTextSearch" }), undefined);
      eq("t5", "Text Search 有座標（台北）＋日本 → 座標優先 TW", await run({ ...base, lat: 25.03, lng: 121.56, destinationCountry: "日本" }), "TW");
      eq("t6", "Text Search 非 skipLocationBias → 不補", await run({ ...base, skipLocationBias: false, destinationCountry: "日本" }), undefined);
      eq("t7", "Text Search nearby 模式 → 不補", await run({ ...base, searchMode: "nearby", destinationCountry: "日本" }), undefined);
    }

    const sc = await load("src/lib/ai/chat-place-search-context.ts");
    const textCtx = { searchMode: "destination", destinationName: "函館", destinationLatLng: null, textOnlyDestinationSearch: true, destinationCountry: "日本" };
    const coordCtx = { ...textCtx, destinationLatLng: { lat: 41.77, lng: 140.73 }, textOnlyDestinationSearch: false };
    eq("p1", "placesSearchContextPayload 無座標 → 帶 destinationCountry", sc.placesSearchContextPayload(textCtx).destinationCountry, "日本");
    eq("p2", "placesSearchContextPayload 有座標 → 不帶 destinationCountry（payload 不變）", "destinationCountry" in sc.placesSearchContextPayload(coordCtx), false);
    const ps = [
      { id: "jp", address: "Hakodate, Hokkaido, Japan" },
      { id: "us", address: "Los Angeles, CA, USA" },
      { id: "unk", address: "Motomachi" },
    ];
    eq("m1", "filterTextOnly…：mismatch 剔除、unknown 保留", sc.filterTextOnlyDestinationCountryMismatch(ps, textCtx).map((p) => p.id), ["jp", "unk"]);
    eq("m2", "filterTextOnly…：有座標時不生效", sc.filterTextOnlyDestinationCountryMismatch(ps, coordCtx).map((p) => p.id), ["jp", "us", "unk"]);
    eq("m3", "filterTextOnly…：無 searchContext 不生效", sc.filterTextOnlyDestinationCountryMismatch(ps, undefined).map((p) => p.id), ["jp", "us", "unk"]);
    eq("m4", "filterTextOnly…：無目的地國家不生效", sc.filterTextOnlyDestinationCountryMismatch(ps, { ...textCtx, destinationCountry: undefined }).map((p) => p.id), ["jp", "us", "unk"]);
    eq("m5", "filterTextOnly…：有座標時回傳同一陣列（不複製）", sc.filterTextOnlyDestinationCountryMismatch(ps, coordCtx) === ps, true);
  }

  // ════════════════ 3. 流程：呼叫次數與無結果分支 ════════════════
  if (!ONLY || ONLY === "flow") {
    // 每次流程都用全新 runner（全新模組狀態），避免 autocomplete／candidate pool／flow 快取讓後續呼叫變 0。
    const freshLoad = async (p) => {
      const r = new ViteNodeRunner({
        root: WORK_ROOT,
        base: "/",
        fetchModule: (id) => vn.fetchModule(id),
        resolveId: (id, importer) => vn.resolveId(id, importer),
      });
      await r.executeId("/@vite/env");
      return r.executeFile(`${WORK_ROOT}/${p}`);
    };
    const dpr = await load("src/lib/ai/destination-place-recommendation.ts");
    const mkPlace = (id, name, address, extra = {}) => ({
      id: `ChIJ_${id}`,
      name,
      address,
      lat: null,
      lng: null,
      rating: 4.5,
      userRatingCount: 800,
      types: ["tourist_attraction", "point_of_interest", "establishment"],
      primaryType: "tourist_attraction",
      photoName: `places/ChIJ_${id}/photos/p1`,
      businessStatus: "OPERATIONAL",
      ...extra,
    });
    const JP = Array.from({ length: 8 }, (_, i) => mkPlace(`HKD_${i}`, `函館景點${i}`, `北海道函館市元町${i}-1, Japan`));
    const US = Array.from({ length: 4 }, (_, i) => mkPlace(`US_${i}`, `Hakodate Spot ${i}`, `${100 + i} Main St, Los Angeles, CA, USA`));
    const mixed = [US[0], JP[0], US[1], JP[1], US[2], JP[2], US[3], JP[3], JP[4], JP[5], JP[6], JP[7]];

    const runFlow = async (fnName, pool, extra = {}) => {
      let searchCalls = 0;
      let geocodeCalls = 0;
      let weatherCalls = 0;
      const regionPayloads = [];
      const searchPlaces = async ({ data }) => {
        searchCalls += 1;
        regionPayloads.push(data.destinationCountry ?? null);
        return { places: pool.map((p) => ({ ...p })), error: null, rawCount: pool.length };
      };
      const geocodeFn = async () => {
        geocodeCalls += 1;
        return { lat: null, lng: null, error: "mock_no_geocode" };
      };
      const fetchWeatherFn = async () => {
        weatherCalls += 1;
        return { available: false };
      };
      const fresh = await freshLoad("src/lib/ai/destination-place-recommendation.ts");
      mute();
      let out;
      let err = null;
      try {
        out = await fresh[fnName]({
          destination: "函館",
          userText: fnName === "buildMoreDestinationRecommendations" ? "給我更多函館景點" : "函館還有什麼可以去",
          context: { destination: "函館", days: null },
          locale: "zh-TW",
          searchPlaces,
          geocodeFn,
          fetchWeatherFn,
          ...extra,
        });
      } catch (e) {
        err = e;
      } finally {
        unmute();
      }
      const addrs = (out?.recommendations ?? []).map((r) => r.address ?? r.formattedAddress ?? "");
      return {
        err: err ? String(err?.message ?? err).slice(0, 200) : null,
        searchCalls,
        geocodeCalls,
        weatherCalls,
        regionPayloads: [...new Set(regionPayloads)],
        cards: out?.recommendations?.length ?? 0,
        usCards: addrs.filter((a) => /USA/.test(a)).length,
        summaryHead: (out?.summary ?? "").slice(0, 60).replace(/\n/g, " "),
      };
    };

    const flowSummary = {};
    for (const fnName of ["buildMoreDestinationRecommendations", "buildAlternativeDestinationRecommendations"]) {
      if (typeof dpr[fnName] !== "function") {
        record(`x-${fnName}`, `${fnName} 存在`, false);
        continue;
      }
      const clean = await runFlow(fnName, JP);
      const mix = await runFlow(fnName, mixed);
      const allUs = await runFlow(fnName, US);
      flowSummary[fnName] = { clean, mix, allUs };
      const short = fnName === "buildMoreDestinationRecommendations" ? "給我更多" : "替代推薦";
      record(`${short}-0`, `${short}：三組 mock 都沒有拋錯`, !clean.err && !mix.err && !allUs.err, JSON.stringify({ c: clean.err, m: mix.err, u: allUs.err }));
      record(`${short}-1`, `${short}：混入他國同名 → searchPlaces 次數與全日本池相同`, mix.searchCalls === clean.searchCalls, `clean=${clean.searchCalls} mixed=${mix.searchCalls}`);
      record(`${short}-2`, `${short}：結果不含地址在美國的卡片`, mix.usCards === 0, `usCards=${mix.usCards} cards=${mix.cards}`);
      record(`${short}-3`, `${short}：全部為他國 → 0 張卡、走既有無結果分支、不補查`, allUs.usCards === 0 && allUs.searchCalls <= clean.searchCalls, `cards=${allUs.cards} usCards=${allUs.usCards} searches=${allUs.searchCalls} summary=${allUs.summaryHead}`);
      record(`${short}-4`, `${short}：geocode / weather 呼叫次數（INFO）`, "INFO", `geocode=${clean.geocodeCalls}/${mix.geocodeCalls}/${allUs.geocodeCalls} weather=${clean.weatherCalls}/${mix.weatherCalls}/${allUs.weatherCalls} payloadCountry=${JSON.stringify(mix.regionPayloads)}`);
    }

    // 聊聊推薦：buildNearbyPlaceRecommendation（無座標目的地）
    const cpr = await load("src/lib/ai/chat-place-recommendation.ts");
    if (typeof cpr.buildNearbyPlaceRecommendation === "function") {
      const runNearby = async (pool, details) => {
        let searchCalls = 0;
        let detailsCalls = 0;
        const searchPlaces = async () => {
          searchCalls += 1;
          return {
            places: pool.map((p) => ({
              ...p,
              name: p.name.replace("景點", "拉麵店").replace("Spot", "Ramen"),
              types: ["ramen_restaurant", "restaurant", "food", "point_of_interest", "establishment"],
              primaryType: "ramen_restaurant",
              openStatusLabel: "營業中",
              todayHoursLabel: "11:00–21:00",
            })),
            error: null,
            rawCount: pool.length,
          };
        };
        const freshCpr = await freshLoad("src/lib/ai/chat-place-recommendation.ts");
        mute();
        let out;
        let err = null;
        try {
          out = await freshCpr.buildNearbyPlaceRecommendation({
            intent: "restaurant",
            lat: 0,
            lng: 0,
            locale: "zh-TW",
            context: { destination: "函館" },
            searchPlaces,
            userText: "函館有什麼好吃的",
            cityLabel: "函館",
            searchContext: { searchMode: "destination", destinationName: "函館", destinationLatLng: null, textOnlyDestinationSearch: true, destinationCountry: "日本", destinationCity: "函館" },
            fetchPlaceDetails: details
              ? async (id) => {
                  detailsCalls += 1;
                  return null;
                }
              : undefined,
          });
        } catch (e) {
          err = e;
        } finally {
          unmute();
        }
        const addrs = (out?.recommendations ?? []).map((r) => r.address ?? "");
        return { err: err ? String(err?.message ?? err).slice(0, 200) : null, searchCalls, detailsCalls, cards: out?.recommendations?.length ?? 0, usCards: addrs.filter((a) => /USA/.test(a)).length, summaryHead: (out?.summary ?? "").slice(0, 60).replace(/\n/g, " ") };
      };
      const clean = await runNearby(JP, true);
      const mix = await runNearby(mixed, true);
      const allUs = await runNearby(US, true);
      flowSummary.buildNearbyPlaceRecommendation = { clean, mix, allUs };
      // 注意：lat/lng=0,0 時既有 filterPlacesByNearbyDistance 會以 missing_location／距離丟掉所有候選，
      // 新篩選之前就已 0 筆，因此這條路徑無法用 mock 做出「有卡片」的正例；只能比對呼叫次數與無結果分支。
      record("聊聊-0", "聊聊推薦：只允許既有 places_empty（INFO：0,0 時既有距離過濾已清空，正例無法以 mock 建立）", "INFO", JSON.stringify({ c: clean.err, m: mix.err, u: allUs.err }));
      record("聊聊-1", "聊聊推薦：混入他國同名 → searchPlaces 次數相同", mix.searchCalls === clean.searchCalls, `clean=${clean.searchCalls} mixed=${mix.searchCalls}`);
      record("聊聊-2", "聊聊推薦：Details 次數不超過全日本池", mix.detailsCalls <= clean.detailsCalls, `clean=${clean.detailsCalls} mixed=${mix.detailsCalls}`);
      record("聊聊-3", "聊聊推薦：卡片不含美國地址", mix.usCards === 0, `usCards=${mix.usCards} cards=${mix.cards}`);
      record("聊聊-4", "聊聊推薦：全部他國 → 0 卡、走既有無結果分支（places_empty）", allUs.cards === 0 && (allUs.err === "places_empty" || Boolean(allUs.summaryHead)), `cards=${allUs.cards} err=${allUs.err} summary=${allUs.summaryHead}`);
      record("聊聊-4b", "聊聊推薦：全他國池的 searchPlaces 次數（INFO，與 HEAD 對照；既有 destination guard 重試所致）", "INFO", `clean=${clean.searchCalls} allUs=${allUs.searchCalls}`);
      record("聊聊-5", "聊聊推薦：混入他國時卡片數（INFO，對照全日本池）", "INFO", `clean=${clean.cards} mixed=${mix.cards}`);
    }
    record("flow-json", "流程原始數據（供 HEAD 對照）", "INFO", JSON.stringify(flowSummary));
  }

  // ── 輸出 ──
  const out = ["\n=== verify-place-geo-text-search-country-filter ==="];
  for (const r of results) {
    out.push(`[${r.status}] ${r.id} ${r.title}`);
    if (r.status !== "PASS" || r.id === "flow-json") out.push(`       ${r.detail}`);
  }
  out.push(`[INFO] 外部網路呼叫總數 = ${externalCalls}${externalCalls ? ` ${externalLog.join("; ")}` : ""}`);
  const failed = results.filter((r) => r.status === "FAIL");
  out.push(`摘要：PASS ${results.filter((r) => r.status === "PASS").length}／FAIL ${failed.length}／INFO ${results.filter((r) => r.status === "INFO").length}${failed.length ? `；失敗：${failed.map((r) => r.id).join(", ")}` : ""}`);
  process.stdout.write(`${out.join("\n")}\n`);
  if (failed.length || externalCalls > 0) exitCode = 1;
} catch (e) {
  unmute();
  process.stdout.write(`[geo-country-filter] 執行失敗：${e?.stack ?? e}\n`);
  exitCode = 1;
} finally {
  await server.close().catch(() => {});
  clearTimeout(watchdog);
}
process.exit(exitCode);
