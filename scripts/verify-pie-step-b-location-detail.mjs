#!/usr/bin/env node
/**
 * Phase 1 Step B #2：LocationSearchField getPlaceDetails → getPlaceLiteDetailsViaGateway
 * + PIE Metrics 基礎觀測
 *
 * 不打真實 Places API；以 mock resolveFn（server-fn 形狀）驗證 ON/OFF。
 *
 * 執行：npm run verify:pie-step-b-location-detail
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPlaceLiteDetailsViaGateway,
  setPieFacadeEnabledOverride,
  resetPlacesGatewayDetailLiteStats,
  getPlacesGatewayDetailLiteStats,
  pieFacade,
  getPieMetricsSnapshot,
  resetPieMetrics,
} from "../src/lib/pie/index.ts";
import { getPlaceDetails as legacyGetPlaceLiteDetails } from "../src/services/placesService.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function makeResolveFn(stopFields, counter) {
  return async ({ data }) => {
    counter.n += 1;
    return {
      stop: {
        placeId: data.placeId,
        label: stopFields.name,
        secondary: stopFields.address,
        name: stopFields.name,
        address: stopFields.address,
        lat: stopFields.lat,
        lng: stopFields.lng,
        placeType: stopFields.placeType ?? "train_station",
        googleMapsUrl: "",
        photoName: stopFields.photoName ?? null,
        rating: stopFields.rating ?? null,
      },
      error: stopFields.error ?? null,
    };
  };
}

console.info("[verify:pie-step-b-location-detail] Step B #2\n");

test("LocationSearchField details uses places-gateway only", () => {
  const src = readFileSync(join(root, "src/components/LocationSearchField.tsx"), "utf8");
  assert.match(src, /getPlaceLiteDetailsViaGateway/);
  assert.match(src, /from ["']@\/lib\/pie\/places-gateway["']/);
  assert.doesNotMatch(src, /from ["']@\/lib\/pie\/pie-facade["']/);
  assert.doesNotMatch(src, /from ["']@\/services\/placesService["']/);
});

test("facade getPlaceLiteDetails is same function as legacy", () => {
  assert.equal(pieFacade.getPlaceLiteDetails, legacyGetPlaceLiteDetails);
});

await testAsync("flag OFF → legacy path; single resolve; metrics detail+legacy", async () => {
  setPieFacadeEnabledOverride(false);
  resetPlacesGatewayDetailLiteStats();
  resetPieMetrics();

  const counter = { n: 0 };
  const resolveFn = makeResolveFn(
    {
      name: "台北車站",
      address: "台北市",
      lat: 25.0478,
      lng: 121.517,
    },
    counter,
  );

  const result = await getPlaceLiteDetailsViaGateway("ChIJ_detail_off", {
    locale: "zh-TW",
    resolveFn,
  });

  const stats = getPlacesGatewayDetailLiteStats();
  const metrics = getPieMetricsSnapshot();

  assert.equal(stats.lastDetailLitePath, "legacy");
  assert.equal(stats.detailLite.legacy, 1);
  assert.equal(stats.detailLite.pie, 0);
  assert.equal(counter.n, 1, "must not double Places resolve/HTTP");
  assert.equal(result.error, null);
  assert.equal(result.place?.placeId, "ChIJ_detail_off");
  assert.equal(result.place?.name, "台北車站");
  assert.equal(result.place?.lat, 25.0478);
  assert.equal(metrics.totals.detail, 1);
  assert.equal(metrics.byPath.legacy, 1);
  assert.equal(metrics.byPath.pie, 0);
  assert.equal(metrics.lastEvent?.op, "detail");
  assert.equal(metrics.lastEvent?.path, "legacy");
  assert.ok(["hit", "miss", "unknown"].includes(metrics.lastEvent?.cache));
});

await testAsync("flag ON → pie path; single resolve; same metrics shape", async () => {
  setPieFacadeEnabledOverride(true);
  resetPlacesGatewayDetailLiteStats();
  resetPieMetrics();

  const counter = { n: 0 };
  const resolveFn = makeResolveFn(
    {
      name: "東京駅",
      address: "Tokyo",
      lat: 35.6812,
      lng: 139.7671,
    },
    counter,
  );

  const result = await getPlaceLiteDetailsViaGateway("ChIJ_detail_on", {
    locale: "ja",
    resolveFn,
  });

  const stats = getPlacesGatewayDetailLiteStats();
  const metrics = getPieMetricsSnapshot();

  assert.equal(stats.lastDetailLitePath, "pie");
  assert.equal(stats.detailLite.pie, 1);
  assert.equal(stats.detailLite.legacy, 0);
  assert.equal(counter.n, 1);
  assert.equal(result.place?.name, "東京駅");
  assert.equal(metrics.totals.detail, 1);
  assert.equal(metrics.byPath.pie, 1);
  assert.equal(metrics.lastEvent?.path, "pie");
});

await testAsync("ON/OFF same inputs → same outputs", async () => {
  const counter = { n: 0 };
  const resolveFn = makeResolveFn(
    {
      name: "京都駅",
      address: "Kyoto",
      lat: 34.985,
      lng: 135.758,
      photoName: "photos/abc",
      rating: 4.4,
    },
    counter,
  );

  const args = ["ChIJ_parity", { locale: "zh-TW", resolveFn }];

  setPieFacadeEnabledOverride(false);
  const off = await getPlaceLiteDetailsViaGateway(...args);

  setPieFacadeEnabledOverride(true);
  const on = await getPlaceLiteDetailsViaGateway(...args);

  assert.deepEqual(on, off);
  assert.equal(on.place?.placeId, "ChIJ_parity");
  assert.equal(on.place?.photoName, "photos/abc");
  // 兩次各 1 次 resolve；不得變成 4 次
  assert.equal(counter.n, 2);
  setPieFacadeEnabledOverride(null);
});

await testAsync("fallback outcome recorded when coords missing", async () => {
  setPieFacadeEnabledOverride(false);
  resetPieMetrics();

  const counter = { n: 0 };
  const resolveFn = makeResolveFn(
    {
      name: "",
      address: "",
      lat: null,
      lng: null,
      error: "incomplete",
    },
    counter,
  );

  const result = await getPlaceLiteDetailsViaGateway("ChIJ_fb", {
    locale: "en",
    resolveFn,
    fallback: {
      placeId: "ChIJ_fb",
      label: "Fallback Place",
      secondary: "Somewhere",
    },
  });

  assert.ok(result.place);
  assert.equal(result.place?.name, "Fallback Place");
  assert.equal(counter.n, 1);
  const metrics = getPieMetricsSnapshot();
  assert.equal(metrics.lastEvent?.outcome, "fallback");
  assert.ok(metrics.totals.fallback >= 1);
  setPieFacadeEnabledOverride(null);
});

setPieFacadeEnabledOverride(null);
console.info("\n[verify:pie-step-b-location-detail] all passed");
