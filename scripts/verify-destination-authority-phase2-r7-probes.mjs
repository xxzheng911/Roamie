#!/usr/bin/env node
/**
 * R7 — Location Authority 方案 A（F8）獨立驗收：真實模組 probe（不走 send() 鏡像）。
 *
 * 樹：work（現行工作區＝F8 後）、pre（F6＝F7 前備份：chat-turn-destination.ts / resolve-chat-location.ts overlay）、
 *     base（aa2db59；chat-turn-destination.ts 不存在 → 只跑 resolveChatLocation 相關 probe）。
 * resolveChatLocation 以「各樹原始碼」載入，只把 4 個平台依賴（effective-location / device-location /
 * location-app-gate / dev-verbose-log）的 import 換成 globalThis.__R7_LOC__ mock（其餘函式本體逐字不動）。
 * _app.chat.tsx 內的 turnStartSession / catch 組裝以「F6 / F8 兩版各自逐字鏡像」呼叫真實模組（標註為鏡像）。
 *
 * 安全：Mock Key、攔截 fetch / http(s) / net / tls；任何外部請求 → FAIL。
 * 執行：node scripts/verify-destination-authority-phase2-r7-probes.mjs
 */
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const BASE_REF = "aa2db59";
const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r7-probes.mjs`;
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const PRE_FILES = {
  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-F7.ts`,
  "src/lib/ai/resolve-chat-location.ts": `${PRE_DIR}/resolve-chat-location.pre-F7.ts`,
};
const MOCK_ENV = {
  GOOGLE_MAPS_API_KEY: "mock-key",
  VITE_GOOGLE_MAPS_API_KEY: "mock-key",
  OPENWEATHER_API_KEY: "mock-key",
  OPENAI_API_KEY: "mock-key",
  VITE_SUPABASE_URL: "http://mock-supabase.invalid",
  VITE_SUPABASE_PUBLISHABLE_KEY: "mock-key",
  SUPABASE_URL: "http://mock-supabase.invalid",
  SUPABASE_PUBLISHABLE_KEY: "mock-key",
};
const SECRET_RE = /KEY|SECRET|TOKEN|PRIVATE|PASSWORD|SUPABASE|OPENAI|GOOGLE|WEATHER|APPLE|CAPACITOR|ROAMIE_ADMIN/i;
const { execFileSync, spawn } = await import("node:child_process");
const git = (args) => execFileSync("git", args, { cwd: WORK_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const RCL_REL = "src/lib/ai/resolve-chat-location.ts";

// resolveChatLocation 平台依賴 → mock（只替換 import 敘述）
function mockRcl(src) {
  const reps = [
    [/import\s*\{\s*devVerboseInfo\s*\}\s*from\s*"@\/lib\/dev-verbose-log";/, "const devVerboseInfo = () => {};"],
    [
      /import\s*\{\s*ensureEffectiveLocationBootstrap,\s*getEffectiveLocationSnapshot,?\s*\}\s*from\s*"@\/lib\/effective-location";/,
      "const ensureEffectiveLocationBootstrap = (...a) => globalThis.__R7_LOC__.bootstrap(...a);\nconst getEffectiveLocationSnapshot = (...a) => globalThis.__R7_LOC__.snapshot(...a);",
    ],
    [/import\s*\{\s*requestDeviceLocation\s*\}\s*from\s*"@\/lib\/device-location";/, "const requestDeviceLocation = (...a) => globalThis.__R7_LOC__.device(...a);"],
    [/import\s*\{\s*isAppActiveForLocation\s*\}\s*from\s*"@\/lib\/location-app-gate";/, "const isAppActiveForLocation = (...a) => globalThis.__R7_LOC__.active(...a);"],
  ];
  let out = src;
  const miss = [];
  for (const [re, rep] of reps) {
    if (!re.test(out)) miss.push(String(re));
    out = out.replace(re, rep);
  }
  if (/@\/lib\/(effective-location|device-location|location-app-gate|dev-verbose-log)/.test(out)) miss.push("殘留平台 import");
  return { out, miss };
}

// ════════════════════════ child ════════════════════════
if (process.env.VERIFY_R7P_ROLE === "child") {
  for (const k of Object.keys(process.env)) if (SECRET_RE.test(k) && !(k in MOCK_ENV)) delete process.env[k];
  Object.assign(process.env, MOCK_ENV);
  const { createRequire } = await import("node:module");
  const require = createRequire(`${WORK_ROOT}/package.json`);
  const ext = [];
  const trap = (kind, d) => {
    ext.push(`${kind}:${String(d).slice(0, 120)}`);
    throw new Error(`[ext-trap] ${kind}`);
  };
  globalThis.fetch = async (i) => trap("fetch", typeof i === "string" ? i : i?.url);
  const http = require("node:http");
  const https = require("node:https");
  const net = require("node:net");
  const tls = require("node:tls");
  http.request = http.get = (a) => trap("http", a?.href ?? a);
  https.request = https.get = (a) => trap("https", a?.href ?? a);
  net.connect = net.createConnection = (a) => trap("net", a?.host ?? a);
  tls.connect = (a) => trap("tls", a?.host ?? a);
  const orig = { info: console.info, log: console.log, warn: console.warn, debug: console.debug, error: console.error };
  for (const k of Object.keys(orig)) console[k] = () => {};

  const { readFileSync } = await import("node:fs");
  const TREE = process.env.VERIFY_R7P_TREE;
  const overlay = JSON.parse(process.env.VERIFY_R7P_OVERLAY);
  const content = new Map();
  const hidden = new Set();
  if (TREE === "base") {
    for (const rel of overlay.modified) {
      if (!/\.(ts|tsx)$/.test(rel)) continue;
      try {
        content.set(`${WORK_ROOT}/${rel}`, git(["show", `${BASE_REF}:${rel}`]));
      } catch {
        hidden.add(`${WORK_ROOT}/${rel}`);
      }
    }
    for (const rel of overlay.hidden) hidden.add(`${WORK_ROOT}/${rel}`);
  } else if (TREE === "pre") {
    for (const [rel, file] of Object.entries(PRE_FILES)) content.set(`${WORK_ROOT}/${rel}`, readFileSync(file, "utf8"));
  }
  const hits = new Set();
  let rclMiss = null;
  const plugin = {
    name: "r7-overlay",
    enforce: "pre",
    load(id) {
      const file = id.split("?")[0];
      if (hidden.has(file)) throw new Error(`[overlay] ${file} 不存在於 ${BASE_REF}`);
      if (file === `${WORK_ROOT}/${RCL_REL}`) {
        const src = content.get(file) ?? readFileSync(file, "utf8");
        const { out, miss } = mockRcl(src);
        rclMiss = miss;
        hits.add(`${RCL_REL}(mocked${content.has(file) ? ",overlay" : ""})`);
        return out;
      }
      if (content.has(file)) {
        hits.add(file.slice(WORK_ROOT.length + 1));
        return content.get(file);
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
    plugins: [plugin, tsconfigPaths()],
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.environments.client.pluginContainer.buildStart({});
  const vn = new ViteNodeServer(server);
  const runner = new ViteNodeRunner({
    root: server.config.root,
    base: server.config.base,
    fetchModule: (id) => vn.fetchModule(id),
    resolveId: (id, importer) => vn.resolveId(id, importer),
  });
  await runner.executeId("/@vite/env");
  const imp = (p) => runner.executeFile(`${WORK_ROOT}/src/${p}`);

  const LOC = { cfg: {}, calls: { snapshot: 0, bootstrap: 0, device: 0, active: 0 } };
  globalThis.__R7_LOC__ = {
    snapshot: () => (LOC.calls.snapshot++, LOC.cfg.snapshot ?? null),
    bootstrap: async () => (LOC.calls.bootstrap++, LOC.cfg.bootstrap ?? null),
    active: () => (LOC.calls.active++, LOC.cfg.active ?? true),
    device: async () => {
      LOC.calls.device++;
      if (LOC.cfg.deviceThrows) throw new Error("device unavailable");
      return LOC.cfg.device ?? { lat: null, lng: null, city: "", usedFallback: true };
    },
  };
  const setLoc = (cfg) => {
    LOC.cfg = cfg;
    LOC.calls = { snapshot: 0, bootstrap: 0, device: 0, active: 0 };
  };

  const out = { tree: TREE, checks: [], reports: {}, hits: [], rclMiss: null, ext, errors: [] };
  const M = {};
  for (const [k, p] of [
    ["rcl", "lib/ai/resolve-chat-location.ts"],
    ["tripIntent", "lib/recommendation/trip-intent.ts"],
    ["tc", "lib/ai/travel-context.ts"],
    ["tap", "lib/trip/trip-add-place-session.ts"],
    ["owner", "lib/ai/plan-ai-action-owner.ts"],
    ["pdc", "lib/ai/place-detail-chat.ts"],
    ["ctd", "lib/ai/chat-turn-destination.ts"],
  ]) {
    try {
      M[k] = await imp(p);
    } catch (e) {
      M[k] = null;
      out.errors.push(`import ${p}: ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }
  const B0 = () => ({ recommendedPlaces: [], selectedPlaces: [], phase: "discover", discovery: {}, updatedAt: "2026-01-01T00:00:00.000Z" });
  const GPS = { lat: 24.18, lng: 120.62 };
  const KYOTO = { lat: 35.0116, lng: 135.7681 };
  const XIMEN = { lat: 25.042, lng: 121.507 };
  const isLL = (l, p) => Boolean(l) && l.lat === p.lat && l.lng === p.lng;
  const noKyoto = (v) => !String(v ?? "").includes("京都");
  const pick = (s) =>
    s && typeof s === "object"
      ? {
          location: s.location ? { lat: s.location.lat ?? null, lng: s.location.lng ?? null, city: s.location.city ?? null } : null,
          authority: s.nearbyLocationAuthority
            ? { src: s.nearbyLocationAuthority.source, lat: s.nearbyLocationAuthority.lat, lng: s.nearbyLocationAuthority.lng, label: s.nearbyLocationAuthority.displayLabel }
            : null,
          currentLocation: s.travelContext?.currentLocation ?? null,
          destination: s.travelContext?.destination ?? null,
          preferredArea: s.preferredArea ?? null,
          pending: s.pendingClarification?.kind ?? null,
        }
      : s;
  const check = (id, item, ok, detail) => out.checks.push({ id, item, ok: Boolean(ok), detail });
  const guard = async (id, fn) => {
    try {
      await fn();
    } catch (e) {
      out.errors.push(`${id}: THROW ${String(e?.stack ?? e).slice(0, 300)}`);
      check(id, "-", false, `THROW ${String(e?.message ?? e)}`);
    }
  };
  const TEXT = "改去京都看楓葉推薦景點";
  const turnChain = async (before, text, loc, rclOpts) => {
    const s1 = M.tripIntent.applyTripIntentToSession(text, before);
    const s1m = M.tc.mergeTravelContext(s1, text).session;
    setLoc(loc ?? {});
    const s2 = await M.rcl.resolveChatLocation(s1m, rclOpts);
    const calls = { ...LOC.calls };
    return { s1, s1m, s2, calls };
  };
  const ctd = (s, b) => M.ctd.withoutUnconfirmedSessionDestinations(s, b);
  const HAS_CTD = Boolean(M.ctd);

  // ── 1. R-1：resolveChatLocation 裝置來源 city（三樹）──
  for (const [tag, city] of [["emptyStr", ""], ["undefined", undefined], ["taichung", "台中市"]]) {
    await guard(`I1-rcl-device-${tag}`, async () => {
      const { s1, s2, calls } = await turnChain(B0(), TEXT, { device: { ...GPS, city, usedFallback: false } });
      out.reports[`I1-rcl-device-${tag}`] = { s1: pick(s1), s2: pick(s2), calls };
      check(
        `I1-rcl-device-${tag}`,
        "1/7",
        isLL(s2.location, GPS) && noKyoto(s2.location?.city) && noKyoto(s2.nearbyLocationAuthority?.displayLabel),
        `device.city=${JSON.stringify(city)} applyTripIntent 佔位=${JSON.stringify(pick(s1).location)} → rcl location=${JSON.stringify(pick(s2).location)} authority=${JSON.stringify(pick(s2).authority)}`,
      );
    });
  }
  // 舊資料：本輪前 location = {0,0,大阪}（city 缺失型 persisted 也一併：before.location 無 city）
  await guard("I1-rcl-device-oldPlaceholder", async () => {
    const before = { ...B0(), location: { lat: 0, lng: 0, city: "大阪" } };
    const { s2 } = await turnChain(before, TEXT, { device: { ...GPS, city: undefined, usedFallback: false } });
    check("I1-rcl-device-oldPlaceholder", "1/7", isLL(s2.location, GPS) && noKyoto(s2.location?.city) && s2.location?.city !== "大阪", `rcl location=${JSON.stringify(pick(s2).location)} authority=${JSON.stringify(pick(s2).authority)}`);
  });
  // effective snapshot（可信快照）city 沿用快照
  await guard("I1-rcl-snapshot", async () => {
    const { s2, calls } = await turnChain(B0(), TEXT, { snapshot: { ...GPS, city: "台中市", isFallback: false, source: "gps" } });
    check("I1-rcl-snapshot", "1", isLL(s2.location, GPS) && s2.location?.city === "台中市" && calls.device === 0, `location=${JSON.stringify(pick(s2).location)} calls=${JSON.stringify(calls)}`);
  });

  if (HAS_CTD) {
    // ── 1. R-1 原始 probe（原樣輸入，僅回報）──
    await guard("I1-orig-r6_destCoordsNoPrev", async () => {
      const r = ctd({ ...B0(), location: { ...KYOTO, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } }, B0());
      out.reports["I1-orig-r6_destCoordsNoPrev"] = pick(r);
    });
    // ── 1. 完整鏈路：applyTripIntent 佔位 → rcl（device city ""／缺失）→ 澄清清理 ──
    for (const [tag, city] of [["emptyStr", ""], ["undefined", undefined]]) {
      await guard(`I1-chain-${tag}`, async () => {
        const before = B0();
        const { s2 } = await turnChain(before, TEXT, { device: { ...GPS, city, usedFallback: false } });
        const r = ctd(s2, before);
        out.reports[`I1-chain-${tag}`] = pick(r);
        check(
          `I1-chain-${tag}`,
          "1/7",
          isLL(r.location, GPS) && noKyoto(r.location?.city) && noKyoto(r.travelContext?.currentLocation) && noKyoto(r.nearbyLocationAuthority?.displayLabel),
          JSON.stringify(pick(r)),
        );
      });
    }
    await guard("I1-chain-oldPlaceholder", async () => {
      const before = { ...B0(), location: { lat: 0, lng: 0, city: "大阪" }, travelContext: { interests: [], currentLocation: "大阪" } };
      const { s2 } = await turnChain(before, TEXT, { device: { ...GPS, city: undefined, usedFallback: false } });
      const r = ctd(s2, before);
      check("I1-chain-oldPlaceholder", "1/7", isLL(r.location, GPS) && noKyoto(r.location?.city) && noKyoto(r.nearbyLocationAuthority?.displayLabel), JSON.stringify(pick(r)));
    });

    // ── 3. A：本輪可信定位（device，city 台中市）──
    await guard("I3-A", async () => {
      const before = B0();
      const { s2 } = await turnChain(before, TEXT, { device: { ...GPS, city: "台中市", usedFallback: false } });
      const r = ctd(s2, before);
      check("I3-A", "3", isLL(r.location, GPS) && r.location.city === "台中市" && r.nearbyLocationAuthority?.source === "device" && isLL(r.nearbyLocationAuthority, GPS) && noKyoto(r.travelContext?.currentLocation), JSON.stringify(pick(r)));
    });
    // B：輪前有效位置（GPS 台中＋device authority）；applyTripIntent 改寫 city=京都
    const beforeB = () => ({
      ...B0(),
      location: { ...GPS, city: "台中市" },
      nearbyLocationAuthority: { displayLabel: "台中市", ...GPS, source: "device" },
      travelContext: { interests: [], currentLocation: "台中市" },
    });
    await guard("I3-B", async () => {
      const before = beforeB();
      const { s1, s2, calls } = await turnChain(before, TEXT, {});
      const r = ctd(s2, before);
      out.reports["I3-B"] = { s1: pick(s1), s2: pick(s2), calls, r: pick(r) };
      check("I3-B", "3/6", isLL(r.location, GPS) && r.location.city === "台中市" && r.travelContext?.currentLocation === "台中市" && r.nearbyLocationAuthority?.displayLabel === "台中市" && calls.device === 0, JSON.stringify(pick(r)));
    });
    // C：Trip Add Place（旗標＋context）目的地座標不得冒充 GPS
    const tripCtx = {
      mode: "trip_add_place",
      source: "trip_detail_add_place",
      tripId: "00000000-0000-4000-8000-000000000001",
      destination: "京都",
      tripDates: { dayCount: 3, label: "3 天" },
      selectedDay: 1,
      dayIndex: 0,
      dateKey: "2026-11-01",
      currentPlaces: [],
      existingPlaceNames: [],
      destinationLocation: { ...KYOTO },
    };
    await guard("I3-C1-tripBeforeGps", async () => {
      const before = { ...B0(), fromTripAddPlace: true, tripAddPlaceContext: tripCtx, location: { ...GPS, city: "台中市" }, travelContext: { interests: [], currentLocation: "台中市" } };
      const sess = M.tap.reinforceTripAddPlaceSession(before, "推薦咖啡廳");
      const r = ctd(sess, before);
      out.reports["I3-C1-tripBeforeGps"] = { reinforced: pick(sess), r: pick(r) };
      check("I3-C1-tripBeforeGps", "3/9", isLL(r.location, GPS) && r.location.city === "台中市" && r.travelContext?.currentLocation === "台中市" && !r.nearbyLocationAuthority, JSON.stringify(pick(r)));
    });
    await guard("I3-C2-tripNoPrev", async () => {
      const before = { ...B0(), fromTripAddPlace: true, tripAddPlaceContext: tripCtx };
      const sess = M.tap.reinforceTripAddPlaceSession(before, "推薦咖啡廳");
      const r = ctd(sess, before);
      check("I3-C2-tripNoPrev", "3/9", !r.location && !r.nearbyLocationAuthority && noKyoto(r.travelContext?.currentLocation), JSON.stringify(pick(r)));
    });
    await guard("I3-C3-tripFlagOnlyInSession", async () => {
      const before = { ...B0(), location: { ...GPS, city: "台中市" }, travelContext: { interests: [], currentLocation: "台中市" } };
      const sess = M.tap.reinforceTripAddPlaceSession({ ...before, fromTripAddPlace: true, tripAddPlaceContext: tripCtx }, "推薦咖啡廳");
      const r = ctd(sess, before);
      check("I3-C3-tripFlagOnlyInSession", "3/9", isLL(r.location, GPS) && r.location.city === "台中市" && r.travelContext?.currentLocation === "台中市", JSON.stringify(pick(r)));
    });
    await guard("I3-C4-byModeNoFlag(report)", async () => {
      const before = { ...B0(), location: { ...GPS, city: "台中市" }, travelContext: { interests: [], currentLocation: "台中市" } };
      const sess = { ...before, conversationMode: "trip_add_place", tripAddPlaceContext: tripCtx, location: { ...KYOTO, city: "京都" }, travelContext: { interests: [], destination: "京都", currentLocation: "京都" } };
      out.reports["I3-C4-byModeNoFlag(report)"] = pick(ctd(sess, before));
    });
    // D：{0,0} 佔位
    await guard("I3-D1-zeroNoPrev", async () => {
      const r = ctd({ ...B0(), location: { lat: 0, lng: 0, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } }, B0());
      check("I3-D1-zeroNoPrev", "3", !r.location && noKyoto(r.travelContext?.currentLocation), JSON.stringify(pick(r)));
    });
    await guard("I3-D2-zeroPrevGps", async () => {
      const before = beforeB();
      const r = ctd({ ...before, location: { lat: 0, lng: 0, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } }, before);
      check("I3-D2-zeroPrevGps", "3", isLL(r.location, GPS) && r.location.city === "台中市", JSON.stringify(pick(r)));
    });
    await guard("I3-D3-zeroDeviceUnavailable", async () => {
      const before = B0();
      const { s1, s2, calls } = await turnChain(before, TEXT, { device: { lat: null, lng: null, city: "", usedFallback: true } });
      const r = ctd(s2, before);
      const scope = M.rcl.resolveNearbyRecommendationScope(r);
      check("I3-D3-zeroDeviceUnavailable", "3", !r.location && scope.deviceLocationAvailable === false && calls.device === 1, `s1.loc=${JSON.stringify(pick(s1).location)} r=${JSON.stringify(pick(r))} scope=${JSON.stringify(scope)}`);
    });
    // E：Nearby 使用者指定中心
    const clarAuth = { displayLabel: "西門町", ...XIMEN, source: "clarification" };
    await guard("I3-E1-clarCenterPrevGps", async () => {
      const before = { ...B0(), location: { ...GPS, city: "台中市" }, nearbyLocationAuthority: clarAuth, travelContext: { interests: [], currentLocation: "台中市" } };
      const { s2, calls } = await turnChain(before, TEXT, {}, { requireNearbyAuthority: true });
      const r = ctd(s2, before);
      out.reports["I3-E1-clarCenterPrevGps"] = { s2: pick(s2), calls, r: pick(r) };
      check("I3-E1-clarCenterPrevGps", "3/11", isLL(r.location, GPS) && r.location.city === "台中市" && r.nearbyLocationAuthority?.source === "clarification" && isLL(r.nearbyLocationAuthority, XIMEN) && r.travelContext?.currentLocation === "台中市", JSON.stringify(pick(r)));
    });
    await guard("I3-E2-clarCenterNoPrev", async () => {
      const before = { ...B0(), nearbyLocationAuthority: clarAuth };
      const { s2 } = await turnChain(before, TEXT, {}, { requireNearbyAuthority: true });
      const r = ctd(s2, before);
      check("I3-E2-clarCenterNoPrev", "3/11", !r.location && r.nearbyLocationAuthority?.source === "clarification" && r.travelContext?.currentLocation !== "西門町" && noKyoto(r.nearbyLocationAuthority?.displayLabel), JSON.stringify(pick(r)));
    });
    await guard("I3-E3-deviceAuthCopyNoPrev", async () => {
      const before = { ...B0(), nearbyLocationAuthority: { displayLabel: "台中市", ...GPS, source: "device" } };
      const { s2 } = await turnChain(before, TEXT, {}, { requireNearbyAuthority: true });
      const r = ctd(s2, before);
      out.reports["I3-E3-deviceAuthCopyNoPrev"] = pick(r);
      check("I3-E3-deviceAuthCopyNoPrev", "3/11", isLL(r.location, GPS) && noKyoto(r.location?.city) && r.nearbyLocationAuthority?.source === "device", JSON.stringify(pick(r)));
    });
    await guard("I3-E4-explicitCenterPrevGps", async () => {
      const before = { ...B0(), location: { ...GPS, city: "台中市" }, nearbyLocationAuthority: { displayLabel: "西門町", ...XIMEN, source: "explicit" } };
      const { s2 } = await turnChain(before, TEXT, {}, { requireNearbyAuthority: true });
      const r = ctd(s2, before);
      check("I3-E4-explicitCenterPrevGps", "3/11", isLL(r.location, GPS) && r.location.city === "台中市" && r.nearbyLocationAuthority?.source === "explicit", JSON.stringify(pick(r)));
    });
    await guard("I3-E5-clarWrittenAsLocation(report)", async () => {
      // _app.chat.tsx L7997-8008：nearby 澄清同時寫 location（城市=displayLabel）與 authority（同座標）
      const before = { ...B0(), location: { ...XIMEN, city: "西門町" }, nearbyLocationAuthority: clarAuth };
      const { s2 } = await turnChain(before, TEXT, {});
      out.reports["I3-E5-clarWrittenAsLocation(report)"] = pick(ctd(s2, before));
    });
    // 澄清取消後不留錯誤城市（authority displayLabel）
    await guard("I3-E6-cancelNoWrongCity", async () => {
      const before = B0();
      const { s2 } = await turnChain(before, TEXT, { device: { ...GPS, city: undefined, usedFallback: false } });
      const r = ctd(s2, before);
      const t2 = M.tripIntent.applyTripIntentToSession("不用", r);
      const t3 = M.tripIntent.applyTripIntentToSession("推薦咖啡廳", t2);
      check("I3-E6-cancelNoWrongCity", "3/12", noKyoto(t3.location?.city) && noKyoto(t3.nearbyLocationAuthority?.displayLabel), `T1=${JSON.stringify(pick(r))} T3=${JSON.stringify(pick(t3))}`);
    });

    // ── 5. 人在京都同時搜尋京都 ──
    const beforeKyoto = () => ({
      ...B0(),
      location: { ...KYOTO, city: "京都" },
      nearbyLocationAuthority: { displayLabel: "京都", ...KYOTO, source: "device" },
      travelContext: { interests: [], currentLocation: "京都" },
    });
    await guard("I5-K1-prevKyotoGps", async () => {
      const before = beforeKyoto();
      const { s2 } = await turnChain(before, TEXT, {});
      const r = ctd(s2, before);
      check("I5-K1-prevKyotoGps", "5", isLL(r.location, KYOTO) && r.location.city === "京都" && r.travelContext?.currentLocation === "京都" && r.nearbyLocationAuthority?.displayLabel === "京都", JSON.stringify(pick(r)));
    });
    await guard("I5-K2-deviceKyotoThisTurn", async () => {
      const before = B0();
      const { s2 } = await turnChain(before, TEXT, { device: { ...KYOTO, city: "京都", usedFallback: false } });
      const r = ctd(s2, before);
      check("I5-K2-deviceKyotoThisTurn", "5", isLL(r.location, KYOTO) && r.location.city === "京都" && r.nearbyLocationAuthority?.displayLabel === "京都", JSON.stringify(pick(r)));
    });
    await guard("I5-K3-snapshotKyotoThisTurn", async () => {
      const before = B0();
      const { s2 } = await turnChain(before, TEXT, { snapshot: { ...KYOTO, city: "京都", isFallback: false, source: "gps" } });
      const r = ctd(s2, before);
      check("I5-K3-snapshotKyotoThisTurn", "5", isLL(r.location, KYOTO) && r.location.city === "京都", JSON.stringify(pick(r)));
    });
    await guard("I5-K4-prevKyotoTripsearch", async () => {
      const before = beforeKyoto();
      const { s2 } = await turnChain(before, "京都旅遊推薦景點", {});
      const r = ctd(s2, before);
      check("I5-K4-prevKyotoTripsearch", "5", isLL(r.location, KYOTO) && r.location.city === "京都" && r.travelContext?.currentLocation === "京都", JSON.stringify(pick(r)));
    });

    // ── 6. 台中＋目的地京都，拒絕下一輪京都不得由 location.city 復活 ──
    await guard("I6-taichung-reject", async () => {
      const before = beforeB();
      const { s2 } = await turnChain(before, TEXT, {});
      const r = ctd(s2, before);
      const t2 = M.tripIntent.applyTripIntentToSession("不用", r);
      const t3 = M.tripIntent.applyTripIntentToSession("推薦咖啡廳", t2);
      check("I6-taichung-reject", "6", r.location?.city === "台中市" && t3.location?.city === "台中市" && noKyoto(t3.nearbyLocationAuthority?.displayLabel), `T1=${JSON.stringify(pick(r))} T3=${JSON.stringify(pick(t3))}`);
    });
    // R-1 需求邊界（既有行為，非 F8 引入）：已確認「京都推薦景點」成功輪 persist(nextSession) 帶 location.city=京都，下一輪 sameCoords 沿用
    await guard("I6-confirmedKyotoThenClar(R-1 邊界)", async () => {
      const before = beforeB();
      const turn1 = M.tc.mergeTravelContext(M.tripIntent.applyTripIntentToSession("京都推薦景點", before), "京都推薦景點").session;
      const { s2 } = await turnChain(turn1, TEXT, {});
      const r = ctd(s2, turn1);
      out.reports["I6-confirmedKyotoThenClar(R-1 邊界)"] = { turn1Persisted: pick(turn1), clar: pick(r) };
      check("I6-confirmedKyotoThenClar(R-1 邊界)", "1/6", noKyoto(r.location?.city), `turn1(成功輪 persist)=${JSON.stringify(pick(turn1).location)} → 澄清輪=${JSON.stringify(pick(r).location)}`);
    });

    // ── 9. Trip Add Place auto + catch（J1 鏡像）──
    const mirrorTurnStart = (ver, ref, session) =>
      ver === "F8"
        ? { ...ref, location: session.location, nearbyLocationAuthority: session.nearbyLocationAuthority, pendingClarification: undefined }
        : { ...ref, pendingClarification: undefined };
    const mirrorCatch = (ver, session, nextSession, turnStartSession) => {
      if (ver !== "F8") return session;
      const turnLocation = ctd(nextSession, turnStartSession);
      return { ...session, location: turnLocation.location, nearbyLocationAuthority: turnLocation.nearbyLocationAuthority };
    };
    const VER = TREE === "work" ? "F8" : "F6";
    await guard("I9-tripAuto-catch", async () => {
      const before = { ...B0(), fromTripAddPlace: true, tripAddPlaceContext: tripCtx, location: { ...GPS, city: "台中市" }, travelContext: { interests: [], currentLocation: "台中市" } };
      const ts = mirrorTurnStart(VER, before, before);
      const next = M.tap.reinforceTripAddPlaceSession(M.tripIntent.applyTripIntentToSession("推薦咖啡廳", before), "推薦咖啡廳");
      const retry = mirrorCatch(VER, before, next, ts);
      check("I9-tripAuto-catch", "9/14", isLL(retry.location, GPS) && retry.location.city === "台中市" && retry.nearbyLocationAuthority === before.nearbyLocationAuthority, `next.loc=${JSON.stringify(pick(next).location)} retry=${JSON.stringify(pick(retry))}`);
    });

    // ── 10. Place Detail 錨點（L8463 sessionWithPlaceDetailSearchCenter persist）→ 下一輪 ──
    await guard("I10-placeDetailAnchorNextTurn", async () => {
      const item = { id: "pd-1", name: "清水寺", placeId: "pd-1", googlePlaceId: "pd-1", lat: 34.9949, lng: 135.785, address: "京都市東山區" };
      const base = { ...beforeB(), travelContext: { interests: [], destination: "京都", currentLocation: "台中市" } };
      const detail = M.pdc.sessionWithPlaceDetailSearchCenter(M.pdc.enterPlaceDetailChat(base, item));
      const { s2 } = await turnChain(detail, TEXT, {});
      const r = ctd(s2, detail);
      out.reports["I10-placeDetailAnchorNextTurn"] = { detailPersisted: pick(detail), next: pick(r) };
      check("I10-placeDetailAnchorNextTurn", "10", r.travelContext?.currentLocation === "台中市" && r.nearbyLocationAuthority?.displayLabel === "台中市", JSON.stringify(pick(r)));
    });

    // ── 14. J1 catch 組裝（F6 / F8 鏡像各跑真實 ctd）＋ L6892 尾段 resolveChatLocation／Places 嘗試微模型 ──
    for (const ver of ["F6", "F8"]) {
      await guard(`J1-${ver}-gpsLate`, async () => {
        const before = B0();
        const ts = mirrorTurnStart(ver, before, before);
        const { s2 } = await turnChain(before, TEXT, { device: { ...GPS, city: "", usedFallback: false } });
        const next = { ...s2, preferredArea: "京都", pendingClarification: { kind: "parent_city_scope", confirmedParentCity: "京都", rawGeographicLabel: "京都看楓葉" } };
        const retry = mirrorCatch(ver, before, next, ts);
        // L6890-6970：deviceSession = resolveChatLocation(scopedSession)；lat!=null → searchNearbyPlaces（attempts 至少 1）
        const tail = async (cfg) => {
          setLoc(cfg);
          const dev = await M.rcl.resolveChatLocation(retry);
          return { device: LOC.calls.device, placesAttempt: dev.location?.lat != null && dev.location?.lng != null ? 1 : 0 };
        };
        const deviceOk = await tail({ device: { ...GPS, city: "", usedFallback: false } });
        const deviceGone = await tail({ device: { lat: null, lng: null, city: "", usedFallback: true } });
        setLoc({});
        const normal = await M.rcl.resolveChatLocation(s2);
        const normalTail = { device: LOC.calls.device, placesAttempt: normal.location?.lat != null ? 1 : 0 };
        out.reports[`J1-${ver}-gpsLate`] = { retry: pick(retry), tailDeviceOk: deviceOk, tailDeviceGone: deviceGone, normalPathTail: normalTail };
        if (ver === VER) {
          check(`J1-${ver}-gpsLate`, "14", isLL(retry.location, GPS) && noKyoto(retry.location?.city) && !retry.pendingClarification && retry.preferredArea === undefined && deviceOk.placesAttempt <= normalTail.placesAttempt && deviceGone.placesAttempt <= normalTail.placesAttempt, JSON.stringify(out.reports[`J1-${ver}-gpsLate`]));
        }
      });
      await guard(`J1-${ver}-prevGpsKyoto`, async () => {
        const before = { ...beforeB(), preferredArea: "大阪", travelContext: { interests: [], destination: "大阪", currentLocation: "台中市" } };
        const ts = mirrorTurnStart(ver, before, before);
        const { s2 } = await turnChain(before, TEXT, {});
        const retry = mirrorCatch(ver, before, s2, ts);
        if (ver === VER) check(`J1-${ver}-prevGpsKyoto`, "14/6", isLL(retry.location, GPS) && retry.location.city === "台中市" && retry.preferredArea === "大阪" && retry.travelContext?.destination === "大阪", JSON.stringify(pick(retry)));
      });
    }
    // catch 中 turnLocation 在內層 try 之外：withoutUnconfirmedSessionDestinations 若拋例外即逃出外層 catch
    await guard("J1-catch-throwRisk(report)", async () => {
      const before = beforeB();
      const bad = [
        ["preferredArea=number", { ...before, preferredArea: 123 }],
        ["tripPlanningContext.destination=number", { ...before, tripPlanningContext: { selectedPlaces: [], destination: 42 } }],
        ["travelContext.destinationCity=number", { ...before, travelContext: { interests: [], destinationCity: 7 } }],
        ["location=null", { ...before, location: null }],
      ];
      const res = {};
      for (const [k, s] of bad) {
        try {
          ctd(s, before);
          res[k] = "ok";
        } catch (e) {
          res[k] = `THROW ${String(e?.message ?? e).slice(0, 80)}`;
        }
      }
      out.reports["J1-catch-throwRisk(report)"] = res;
    });

    // ── restorePendingPlanAiOwner 邊界（L7621 → L7728 turnStartSession）──
    for (const ver of ["F6", "F8"]) {
      await guard(`OWNER-${ver}`, async () => {
        const ref = { ...beforeB(), tripCreationAuthority: { explicitCreate: true, intentSource: "plan_ai_create", generationId: "g-ref" } };
        const stored = {
          ...B0(),
          phase: "discover",
          pendingHandoff: { kind: "mock" },
          tripCreationAuthority: { explicitCreate: true, intentSource: "plan_ai_create", generationId: "g-stored" },
          tripActionDiagnostic: { actionSource: "plan_ai_button" },
          location: { lat: 34.69, lng: 135.5, city: "大阪" },
          travelContext: { interests: [], currentLocation: "大阪" },
        };
        const session = M.owner.restorePendingPlanAiOwner(ref, stored);
        const switched = session === stored;
        const ts = mirrorTurnStart(ver, ref, session);
        const s1 = M.tripIntent.applyTripIntentToSession(TEXT, session);
        const s1m = M.tc.mergeTravelContext(s1, TEXT).session;
        setLoc({});
        const s2 = await M.rcl.resolveChatLocation(s1m);
        const r = ctd(s2, ts);
        out.reports[`OWNER-${ver}`] = { switched, r: pick(r) };
        if (ver === VER) check(`OWNER-${ver}`, "owner", switched && noKyoto(r.location?.city), `switched=${switched} r=${JSON.stringify(pick(r))}`);
      });
    }
  }

  out.hits = [...hits];
  out.rclMiss = rclMiss;
  for (const k of Object.keys(orig)) console[k] = orig[k];
  process.stdout.write(`\n@@R7P@@${JSON.stringify(out)}\n`, () => process.exit(0));
} else {
  // ════════════════════════ main ════════════════════════
  const { existsSync, readFileSync } = await import("node:fs");
  const infra = [];
  for (const [rel, file] of Object.entries(PRE_FILES)) {
    if (!existsSync(file)) infra.push(`pre 備份不存在 ${file}`);
    else if (readFileSync(file, "utf8") === readFileSync(`${WORK_ROOT}/${rel}`, "utf8")) infra.push(`pre 備份與現行 ${rel} 相同`);
  }
  // pre-F7 時 resolve-chat-location.ts 尚未修改：備份必須等於 HEAD
  if (existsSync(PRE_FILES[RCL_REL]) && readFileSync(PRE_FILES[RCL_REL], "utf8") !== git(["show", `HEAD:${RCL_REL}`])) infra.push("resolve-chat-location.pre-F7.ts ≠ HEAD 版本");
  for (const [label, src] of [["work", readFileSync(`${WORK_ROOT}/${RCL_REL}`, "utf8")], ["pre", readFileSync(PRE_FILES[RCL_REL], "utf8")], ["base", git(["show", `${BASE_REF}:${RCL_REL}`])]]) {
    const { miss } = mockRcl(src);
    if (miss.length) infra.push(`${label} rcl mock 替換失敗：${miss.join(",")}`);
  }
  if (infra.length) {
    console.log(["INFRA-FAIL", ...infra].join("\n"));
    process.exit(1);
  }
  const OVERLAY = {
    modified: git(["diff", "--name-only", BASE_REF, "--", "src"]).split("\n").filter(Boolean),
    hidden: git(["ls-files", "--others", "--exclude-standard", "--", "src"]).split("\n").filter(Boolean),
  };
  const ENV_ALLOW = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "SHELL", "TERM", "TZ"];
  const run = (tree) =>
    new Promise((resolve) => {
      const env = { NODE_ENV: "development", ...MOCK_ENV, VERIFY_R7P_ROLE: "child", VERIFY_R7P_TREE: tree, VERIFY_R7P_OVERLAY: JSON.stringify(OVERLAY) };
      for (const k of ENV_ALLOW) if (process.env[k] != null) env[k] = process.env[k];
      const child = spawn(process.execPath, [SCRIPT], { cwd: WORK_ROOT, env });
      let so = "";
      let se = "";
      child.stdout.on("data", (d) => (so += d));
      child.stderr.on("data", (d) => (se += d));
      child.on("close", (code) => {
        const line = so.split("\n").find((l) => l.startsWith("@@R7P@@"));
        resolve(line ? JSON.parse(line.slice(7)) : { tree, fatal: `code=${code} ${se.slice(-800)}` });
      });
    });
  const R = {};
  for (const tree of ["work", "pre", "base"]) R[tree] = await run(tree);
  const lines = [];
  let workFail = 0;
  let ext = 0;
  for (const tree of ["work", "pre", "base"]) {
    const r = R[tree];
    if (r.fatal) {
      lines.push(`INFRA-FAIL ${tree}: ${r.fatal}`);
      if (tree !== "base") workFail += 1;
      continue;
    }
    ext += r.ext.length;
    lines.push(`\n══ ${tree}  overlay=${r.hits.join(",") || "(none)"} rclMiss=${JSON.stringify(r.rclMiss)} ext=${r.ext.length} errors=${r.errors.length} ══`);
    for (const e of r.errors) lines.push(`  ERR ${e}`);
    for (const c of r.checks) {
      lines.push(`  ${c.ok ? "PASS" : "FAIL"} [${c.item}] ${c.id} :: ${c.detail}`);
      if (tree === "work" && !c.ok) workFail += 1;
    }
    for (const [k, v] of Object.entries(r.reports)) lines.push(`  REPORT ${k} :: ${JSON.stringify(v)}`);
  }
  // work 與 pre 的判定差異
  const byId = (t) => Object.fromEntries((R[t]?.checks ?? []).map((c) => [c.id, c.ok]));
  const w = byId("work");
  const p = byId("pre");
  const b = byId("base");
  lines.push("\n══ 判定對照（work / pre(F6) / base）══");
  for (const id of Object.keys(w)) lines.push(`  ${id.padEnd(40)} work=${w[id] ? "PASS" : "FAIL"} pre=${id in p ? (p[id] ? "PASS" : "FAIL") : "-"} base=${id in b ? (b[id] ? "PASS" : "FAIL") : "-"}`);
  lines.push(`\nverify-destination-authority-phase2-r7-probes: work FAIL=${workFail} external=${ext} → ${workFail === 0 && ext === 0 ? "PASS" : "FAIL"}`);
  console.log(lines.join("\n"));
  process.exit(workFail === 0 && ext === 0 ? 0 : 1);
}
