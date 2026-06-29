#!/usr/bin/env node
/**
 * 地點詳情頁營業時間單行文案回歸。
 * 執行：npx vite-node scripts/verify-place-detail-opening.mjs
 */
import assert from "node:assert/strict";
import { resolvePlaceDetailOpeningLine } from "../src/lib/normalized-opening-status.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

console.info("[verify:place-detail-opening] 地點詳情營業文案\n");

test("營業中 · 今日營業至（Google nextCloseTime）", () => {
  assert.equal(
    resolvePlaceDetailOpeningLine({
      openNow: true,
      openUntilTime: "23:00",
      todayHoursLabel: "今日 14:00–23:00",
      nextOpenHint: "",
      businessStatus: "OPERATIONAL",
    }),
    "營業中 · 今日營業至 23:00",
  );
});

test("休息中 · 今日開始營業（尚未開門）", () => {
  assert.equal(
    resolvePlaceDetailOpeningLine({
      openNow: false,
      nextOpenHint: "今天 15:00 開始營業",
      todayHoursLabel: "今日 14:00–23:00",
      openUntilTime: "",
      businessStatus: "OPERATIONAL",
    }),
    "休息中 · 今日 15:00 開始營業",
  );
});

test("已打烊 · 明日開始營業", () => {
  assert.equal(
    resolvePlaceDetailOpeningLine({
      openNow: false,
      nextOpenHint: "明天 15:00 開始營業",
      todayHoursLabel: "今日 14:00–23:00",
      openUntilTime: "",
      businessStatus: "OPERATIONAL",
    }),
    "已打烊 · 明日 15:00 開始營業",
  );
});

test("無 Google 營業資料", () => {
  assert.equal(
    resolvePlaceDetailOpeningLine({
      openNow: null,
      nextOpenHint: "",
      todayHoursLabel: "",
      openUntilTime: "",
      businessStatus: "OPERATIONAL",
    }),
    "營業資訊暫缺",
  );
});

test("不應同時顯示時段與 nextOpenHint（只取狀態行）", () => {
  const line = resolvePlaceDetailOpeningLine({
    openNow: false,
    nextOpenHint: "今天 15:00 開始營業",
    todayHoursLabel: "今日 14:00–23:00",
    openUntilTime: "",
    businessStatus: "OPERATIONAL",
  });
  assert.equal(line.includes("14:00"), false);
  assert.equal(line, "休息中 · 今日 15:00 開始營業");
});

console.info("\n[verify:place-detail-opening] 全部通過\n");
