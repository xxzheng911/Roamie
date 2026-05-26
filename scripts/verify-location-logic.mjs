#!/usr/bin/env node
/**
 * 定位邏輯回歸驗證（無需啟動 App）。
 * 執行：npm run verify:location
 */
import assert from "node:assert/strict";
import {
  DEV_SIMULATOR_TW_DEFAULT,
  isIosSimulatorPresetLocation,
  pickFallbackCoordinates,
  resolveGpsCoordinates,
  shouldRememberCoords,
} from "../src/lib/device-location-resolve.ts";

const SF = { lat: 37.785834, lng: -122.406417 };
const TAIPEI_REAL = { lat: 25.078, lng: 121.576 };
const TAIPEI_CENTER = { lat: 25.0478, lng: 121.5319 };
const LAST_GOOD_TW = { lat: 24.15, lng: 120.67 };

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

console.info("[verify:location] Roamie 定位邏輯驗證\n");

test("辨識 iOS Simulator 舊金山預設點", () => {
  assert.equal(isIosSimulatorPresetLocation(SF.lat, SF.lng), true);
  assert.equal(isIosSimulatorPresetLocation(TAIPEI_REAL.lat, TAIPEI_REAL.lng), false);
});

test("正式版：Simulator 舊金山 → 維持真實 GPS（不替換）", () => {
  const r = resolveGpsCoordinates({
    lat: SF.lat,
    lng: SF.lng,
    isDevBuild: false,
    isNativeShell: true,
    allowSimulatorGps: false,
    devOverride: null,
    lastGood: null,
  });
  assert.equal(r?.kind, "gps");
  assert.equal(r?.lat, SF.lat);
  assert.equal(r?.lng, SF.lng);
  assert.equal(r?.simulatorPreset, true);
});

test("開發版：Simulator 舊金山 → 台灣開發預設", () => {
  const r = resolveGpsCoordinates({
    lat: SF.lat,
    lng: SF.lng,
    isDevBuild: true,
    isNativeShell: true,
    allowSimulatorGps: false,
    devOverride: null,
    lastGood: null,
  });
  assert.equal(r?.kind, "dev-simulator-substitute");
  assert.equal(r?.lat, DEV_SIMULATOR_TW_DEFAULT.lat);
  assert.equal(r?.lng, DEV_SIMULATOR_TW_DEFAULT.lng);
});

test("開發版：可透過 env 覆寫 Simulator 座標", () => {
  const custom = { lat: 25.05, lng: 121.52 };
  const r = resolveGpsCoordinates({
    lat: SF.lat,
    lng: SF.lng,
    isDevBuild: true,
    isNativeShell: true,
    allowSimulatorGps: false,
    devOverride: custom,
    lastGood: null,
  });
  assert.equal(r?.lat, custom.lat);
  assert.equal(r?.substituteReason, "env");
});

test("開發版：VITE_LOCATION_USE_SIMULATOR_GPS 時保留舊金山", () => {
  const r = resolveGpsCoordinates({
    lat: SF.lat,
    lng: SF.lng,
    isDevBuild: true,
    isNativeShell: true,
    allowSimulatorGps: true,
    devOverride: null,
    lastGood: null,
  });
  assert.equal(r?.kind, "gps");
  assert.equal(r?.lat, SF.lat);
});

test("台灣真實 GPS：開發版與正式版皆不替換", () => {
  for (const isDevBuild of [true, false]) {
    const r = resolveGpsCoordinates({
      lat: TAIPEI_REAL.lat,
      lng: TAIPEI_REAL.lng,
      isDevBuild,
      isNativeShell: true,
      allowSimulatorGps: false,
      devOverride: null,
      lastGood: null,
    });
    assert.equal(r?.kind, "gps");
    assert.equal(r?.lat, TAIPEI_REAL.lat);
  }
});

test("GPS 失敗 fallback：優先上次有效座標", () => {
  const fb = pickFallbackCoordinates(LAST_GOOD_TW);
  assert.equal(fb.usedDefaultTaipei, false);
  assert.equal(fb.lat, LAST_GOOD_TW.lat);
});

test("GPS 失敗 fallback：無上次座標才用台北預設", () => {
  const fb = pickFallbackCoordinates(null);
  assert.equal(fb.usedDefaultTaipei, true);
  assert.equal(fb.lat, TAIPEI_CENTER.lat);
});

test("不記住 Simulator 美國預設與台北 fallback", () => {
  assert.equal(shouldRememberCoords(SF.lat, SF.lng), false);
  assert.equal(shouldRememberCoords(TAIPEI_CENTER.lat, TAIPEI_CENTER.lng), false);
  assert.equal(shouldRememberCoords(TAIPEI_REAL.lat, TAIPEI_REAL.lng), true);
});

console.info(
  "\n[verify:location] 全部通過。\n" +
    "  正式版 (PROD)：真實 GPS，不替換地區。\n" +
    "  開發版 (DEV)：僅 iOS Simulator 美國預設點會改為台灣測試座標。\n" +
    "  Fallback：僅在 GPS 完全失敗時，先上次有效座標、最後才台北預設。\n",
);
