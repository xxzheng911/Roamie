#!/usr/bin/env node
import "./verify-netguard-full.mjs";
/**
 * Place Detail 名稱解析：場館優先、行政區候選不採用（A–E）。
 *
 * 執行：npx vite-node scripts/verify-place-detail-venue-resolution.mjs --config scripts/vite.verify.config.mjs
 *       （也可直接 node scripts/verify-place-detail-venue-resolution.mjs）
 *
 * 改版說明（B4）：
 *  - 舊版用 vm 只抽出 isAdministrativeDetailCandidate / resolveGooglePlaceIdForDetail 兩個函式，
 *    修正後 resolveGooglePlaceIdForDetail 依賴 place-geo-guard（buildPlaceGeoContext 等），vm 內沒有
 *    這些識別字 → ReferenceError。改為以內嵌 vite + vite-node runner 載入「真模組」
 *    src/lib/place-detail-resolve.ts，只把 @/services/placesService 的 searchPlaces 換成 mock。
 *  - 舊版在 vite-node 下會卡住：vite-node 的 CLI 在頂層 await 拋出例外後不一定結束（外層 vite server
 *    仍持有 handle），且腳本沒有 process.exit。新版：內層 server 在 finally 關閉、看門狗 50 秒強制結束、
 *    最後一律 process.exit(exitCode)。
 *  - 原本 A–E 斷言意圖完全保留；另加：fetch／http(s)／net／tls 全部攔截，必須 0 次。
 */
import assert from "node:assert/strict";

const WORK_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const HARD_TIMEOUT_MS = 50_000;
const watchdog = setTimeout(() => {
  process.stdout.write(`\n[venue-resolution] 超過 ${HARD_TIMEOUT_MS}ms，強制結束\n`);
  process.exit(2);
}, HARD_TIMEOUT_MS);
watchdog.unref?.();

// ── 網路攔截 ─────────────────────────────────────────────────────────
let externalCalls = 0;
const trap = (kind) => {
  externalCalls += 1;
  throw new Error(`[venue-resolution] external ${kind} blocked`);
};
globalThis.fetch = async () => trap("fetch");
{
  const { createRequire } = await import("node:module");
  const require = createRequire(`${WORK_ROOT}/package.json`);
  for (const m of ["http", "https"]) {
    const mod = require(m);
    mod.request = () => trap(m);
    mod.get = () => trap(m);
  }
  const net = require("net");
  net.connect = net.createConnection = () => trap("net");
  require("tls").connect = () => trap("tls");
}

// ── searchPlaces mock ───────────────────────────────────────────────
let calls = 0;
let candidates = [];
globalThis.__venueResolutionSearchPlaces = async () => {
  calls++;
  return { suggestions: candidates, error: null };
};

const { createServer } = await import("vite");
const { ViteNodeServer } = await import("vite-node/server");
const { ViteNodeRunner } = await import("vite-node/client");
const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
const MOCK_ID = "\0venue-resolution-places-service";
const REAL = `${WORK_ROOT}/src/services/placesService.ts?venue-resolution-real`;
const server = await createServer({
  root: WORK_ROOT,
  configFile: false,
  envDir: false,
  logLevel: "warn",
  clearScreen: false,
  plugins: [
    {
      name: "venue-resolution-mock-places-service",
      enforce: "pre",
      resolveId(id) {
        if (id.includes("venue-resolution-real")) return null;
        if (/(^|\/)services\/placesService(\.ts)?$/.test(id)) return MOCK_ID;
        return null;
      },
      load(id) {
        if (id !== MOCK_ID) return null;
        return [
          `export * from ${JSON.stringify(REAL)};`,
          `export const searchPlaces = (...args) => globalThis.__venueResolutionSearchPlaces(...args);`,
        ].join("\n");
      },
    },
    tsconfigPaths(),
  ],
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

let exitCode = 0;
const origInfo = console.info;
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
  const mod = await runner.executeFile(`${WORK_ROOT}/src/lib/place-detail-resolve.ts`);
  const { isAdministrativeDetailCandidate, resolveGooglePlaceIdForDetail } = mod;
  assert.equal(typeof resolveGooglePlaceIdForDetail, "function");
  assert.equal(typeof isAdministrativeDetailCandidate, "function");
  const searchPlaces = globalThis.__venueResolutionSearchPlaces;
  console.info = () => {};

  const admin = { placeId: "ChIJ_admin", label: "Heritage Site", types: ["sublocality_level_2", "sublocality", "political"] };
  const venue = { placeId: "ChIJ_venue", label: "Heritage Site Gardens", types: ["tourist_attraction", "park", "point_of_interest"] };
  const handoff = { name: "Heritage Site", address: "District", lat: null, lng: null };
  candidates = [admin, venue];
  assert.equal(await resolveGooglePlaceIdForDetail(handoff), venue.placeId, "A/D exact administrative name cannot beat venue");
  assert.equal(calls, 1);
  for (const types of [["political"], ["political", "establishment", "point_of_interest"], ["country"], ["locality"], ["sublocality_level_2"], ["administrative_area_level_1"], ["postal_code"]]) {
    candidates = [{ ...admin, types }];
    const before = calls;
    assert.equal(await resolveGooglePlaceIdForDetail(handoff), null, `B rejected: ${types}`);
    assert.equal(calls, before + 1, "no second search for geography-only result");
  }
  // The existing search provider output is neither filtered globally nor mutated.
  candidates = [admin];
  assert.equal((await searchPlaces()).suggestions[0], admin, "C district results remain available to city/district consumers");
  candidates = [venue];
  assert.equal(await resolveGooglePlaceIdForDetail(handoff), venue.placeId, "E valid venue unchanged");
  const before = calls;
  assert.equal(await resolveGooglePlaceIdForDetail({ ...handoff, googlePlaceId: "ChIJ_existing" }), "ChIJ_existing");
  assert.equal(calls, before, "existing identity needs no request");
  assert.equal(isAdministrativeDetailCandidate(["political", "tourist_attraction"]), false);
  assert.equal(isAdministrativeDetailCandidate(["museum"]), false);
  assert.equal(externalCalls, 0, "外部網路呼叫必須為 0");
  console.info = origInfo;
  console.log("PASS A-E: scoped venue selection, administrative-only stop, unmodified provider output, valid identity; mocked requests only (real module, external=0)");
} catch (e) {
  console.info = origInfo;
  process.stdout.write(`[venue-resolution] FAIL：${e?.stack ?? e}\n`);
  exitCode = 1;
} finally {
  await server.close().catch(() => {});
  clearTimeout(watchdog);
}
process.exit(exitCode);
