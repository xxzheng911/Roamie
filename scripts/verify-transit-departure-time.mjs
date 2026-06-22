#!/usr/bin/env node
/**
 * TRANSIT departure_time 邏輯回歸驗證（無 API）。
 * 執行：node scripts/verify-transit-departure-time.mjs
 */
import assert from "node:assert/strict";
import {
  buildLegTransitSchedule,
  defaultLegTransitSchedule,
  resolveTransitDepartureTimeForQuery,
} from "../src/lib/saved-trip/leg-departure-time.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

const settings = { legMinutes: {}, legTransport: {}, transport: "transit" };

console.info("[verify:transit-departure] departure_time 邏輯驗證\n");

test("有日期 + 抵達時間 → 用 tripDate + 停留後出發", () => {
  const prev = {
    title: "A",
    placeName: "A",
    date: "2026-06-25",
    time: "10:00",
    lat: 35.68,
    lng: 139.76,
  };
  const schedule = buildLegTransitSchedule(prev, settings, "2026-06-25");
  assert.ok(schedule);
  assert.equal(schedule.tripDate, "2026-06-25");
  assert.equal(schedule.prevArrivalTime, "10:00");
  assert.equal(schedule.departLocalTime, "11:00");
  assert.equal(schedule.plannedDepartureIso, "2026-06-25T11:00:00+09:00");
});

test("group dateKey 優先於 item.date", () => {
  const prev = {
    title: "A",
    placeName: "A",
    date: "2026-06-20",
    time: "09:30",
    lat: 35.68,
    lng: 139.76,
  };
  const schedule = buildLegTransitSchedule(prev, settings, "2026-06-25");
  assert.equal(schedule?.tripDate, "2026-06-25");
  assert.equal(schedule?.plannedDepartureIso, "2026-06-25T10:30:00+09:00");
});

test("有日期但無抵達時間 → 預設 09:00 出發", () => {
  const prev = {
    title: "A",
    placeName: "A",
    date: "2026-06-25",
    time: "",
    lat: 35.68,
    lng: 139.76,
  };
  const schedule = buildLegTransitSchedule(prev, settings, "2026-06-25");
  assert.ok(schedule?.noArrivalTime);
  assert.equal(schedule?.plannedDepartureIso, "2026-06-25T09:00:00+09:00");
});

test("無日期 → default 使用 now（東京）", () => {
  const schedule = defaultLegTransitSchedule();
  assert.equal(schedule.noTripDate, true);
  const query = resolveTransitDepartureTimeForQuery(schedule);
  assert.equal(query.reason, "no_trip_date_use_now");
  assert.match(query.departureTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/);
});

test("超過 7 天 → 調整為 7 天內同星期", () => {
  const schedule = {
    tripDate: "2026-12-25",
    prevArrivalTime: "10:00",
    departLocalTime: "11:00",
    departHour: 11,
    departMinute: 0,
    tripDayOfWeek: new Date("2026-12-25T12:00:00+09:00").getUTCDay(),
    plannedDepartureIso: "2026-12-25T11:00:00+09:00",
  };
  const query = resolveTransitDepartureTimeForQuery(schedule);
  assert.equal(query.reason, "far_future_same_weekday");
  assert.equal(query.adjusted, true);
  const depMs = Date.parse(query.departureTime);
  const nowMs = Date.now();
  const maxMs = nowMs + 7 * 24 * 60 * 60 * 1000;
  assert.ok(depMs >= nowMs && depMs <= maxMs);
});

console.info("\n[verify:transit-departure] 全部通過");
