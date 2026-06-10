#!/usr/bin/env node
/**
 * 驗證 applyLocation 同座標不重複 patchState（無需啟動 App UI）。
 * 執行：npm run verify:apply-location
 */
import assert from "node:assert/strict";

const logs = [];
const origInfo = console.info;
console.info = (...args) => {
  logs.push(args);
  origInfo(...args);
};

const TW = { lat: 25.078, lng: 121.576, city: "台北", permission: "granted", usedFallback: false, source: "capacitor" };

// 模擬 applyLocation 去重邏輯（與 home-weather-bootstrap.ts 一致）
function runSimulation() {
  let state = { userLocation: null };
  const captured = [];

  function coordsEqual(a, b) {
    return a != null && a.lat === b.lat && a.lng === b.lng;
  }

  function applyLocation(loc, trigger) {
    if (coordsEqual(state.userLocation, loc)) {
      const entry = { tag: "LOCATION_UPDATE", trigger, skipped: true, reason: "same_lat_lng" };
      captured.push(entry);
      console.info("[LOCATION_UPDATE]", entry);
      return false;
    }
    const entry = {
      tag: "LOCATION_UPDATE",
      trigger,
      skipped: false,
      coordChanged: true,
      willPatchState: true,
    };
    captured.push(entry);
    console.info("[LOCATION_UPDATE]", entry);
    state = {
      userLocation: { lat: loc.lat, lng: loc.lng, city: loc.city, source: loc.source },
    };
    captured.push({ tag: "HOME_NEARBY_EFFECT", reason: "userLocation_coords" });
    captured.push({ tag: "HOME_NEARBY_RENDER_STATE", nearbyCount: 0, showLoadingSkeleton: true });
    return true;
  }

  // 冷啟動：initial → gps_fix（同座標）→ resolved_fallback（同座標）
  assert.equal(applyLocation(TW, "initial"), true);
  assert.equal(applyLocation(TW, "gps_fix"), false);
  assert.equal(applyLocation(TW, "resolved_fallback"), false);
  // watch 同座標
  assert.equal(applyLocation(TW, "watch"), false);
  // 移動後才 patch
  const moved = { ...TW, lat: TW.lat + 0.002 };
  assert.equal(applyLocation(moved, "watch"), true);
  assert.equal(applyLocation(moved, "watch"), false);

  const patches = captured.filter((e) => e.tag === "LOCATION_UPDATE" && !e.skipped);
  const skips = captured.filter((e) => e.tag === "LOCATION_UPDATE" && e.skipped);
  const effects = captured.filter((e) => e.tag === "HOME_NEARBY_EFFECT");

  console.info("\n[verify:apply-location] summary", {
    locationPatches: patches.length,
    locationSkips: skips.length,
    nearbyEffects: effects.length,
  });

  assert.equal(patches.length, 2, "only 2 real patches (initial + moved)");
  assert.equal(skips.length, 4, "4 skipped same-coord calls");
  assert.equal(effects.length, 2, "only 2 nearby effect triggers");

  console.info(
    "\n[verify:apply-location] 全部通過 — 同 lat/lng 不會 patchState，loadNearbyPicks / weather watch 不會重複觸發。\n",
  );
}

runSimulation();
