#!/usr/bin/env node
/**
 * 東京大站 transit Directions API 煙霧測試。
 * 執行：node scripts/test-tokyo-transit-directions.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvKey() {
  const envPath = resolve(process.cwd(), ".env");
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = /^(?:EXPO_PUBLIC_GOOGLE_MAPS_API_KEY|VITE_GOOGLE_MAPS_API_KEY|GOOGLE_MAPS_API_KEY)=(.+)$/.exec(
        line.trim(),
      );
      if (m?.[1]?.trim()) return m[1].trim();
    }
  } catch {
    /* ignore */
  }
  return (
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ??
    process.env.VITE_GOOGLE_MAPS_API_KEY ??
    process.env.GOOGLE_MAPS_API_KEY ??
    ""
  );
}

const STATIONS = {
  tokyo: { name: "東京車站", lat: 35.681236, lng: 139.767125 },
  shinjuku: { name: "新宿站", lat: 35.689606, lng: 139.700646 },
  ueno: { name: "上野站", lat: 35.713768, lng: 139.777254 },
  akihabara: { name: "秋葉原站", lat: 35.698683, lng: 139.773084 },
};

const LEGS = [
  { from: "tokyo", to: "shinjuku", label: "東京車站 → 新宿站" },
  { from: "ueno", to: "akihabara", label: "上野站 → 秋葉原站" },
];

function tokyoNowUnix() {
  return Math.floor(Date.now() / 1000);
}

async function fetchTransit(apiKey, origin, destination, departureUnix) {
  const originStr = `${origin.lat},${origin.lng}`;
  const destStr = `${destination.lat},${destination.lng}`;
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", originStr);
  url.searchParams.set("destination", destStr);
  url.searchParams.set("mode", "transit");
  url.searchParams.set("region", "jp");
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("departure_time", String(departureUnix));
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  const json = await res.json();
  const legs = json.routes?.[0]?.legs ?? [];
  const durationSec = legs.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0);
  return {
    httpStatus: res.status,
    bodyStatus: json.status ?? "UNKNOWN",
    errorMessage: json.error_message ?? "",
    availableTravelModes: json.available_travel_modes?.join(",") ?? "n/a",
    durationMinutes: durationSec > 0 ? Math.round(durationSec / 60) : 0,
    originStr,
    destStr,
  };
}

async function main() {
  const apiKey = loadEnvKey();
  if (!apiKey) {
    console.error("缺少 GOOGLE_MAPS_API_KEY / EXPO_PUBLIC_GOOGLE_MAPS_API_KEY");
    process.exit(1);
  }

  const departureUnix = tokyoNowUnix();
  console.info(`[test-tokyo-transit] departureUnix=${departureUnix} (now)\n`);

  let failed = 0;
  for (const leg of LEGS) {
    const origin = STATIONS[leg.from];
    const destination = STATIONS[leg.to];
    const result = await fetchTransit(apiKey, origin, destination, departureUnix);
    const ok = result.bodyStatus === "OK" && result.durationMinutes > 0;
    console.info(`--- ${leg.label} ---`);
    console.info(
      `[TRANSIT_ZERO_RESULTS] leg=${leg.label} origin=${result.originStr} destination=${result.destStr} departureUnix=${departureUnix} status=${result.bodyStatus} available_travel_modes=${result.availableTravelModes} durationMinutes=${result.durationMinutes}`,
    );
    if (!ok) {
      failed += 1;
      console.error(`FAIL: ${result.bodyStatus} ${result.errorMessage}`);
    } else {
      console.info(`OK: transit ${result.durationMinutes} min`);
    }
    console.info("");
  }

  if (failed > 0) {
    console.error(`[test-tokyo-transit] ${failed}/${LEGS.length} legs failed`);
    console.error(
      "[test-tokyo-transit] 注意：Google Directions API 官方不提供日本大眾運輸（僅 DRIVING/WALKING/BICYCLING）。",
    );
    console.error(
      "  參考：https://developers.google.com/maps/faq#transit_directions_countries",
    );
    process.exit(1);
  }
  console.info("[test-tokyo-transit] all legs OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
