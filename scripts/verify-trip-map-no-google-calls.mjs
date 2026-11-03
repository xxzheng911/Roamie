/**
 * T156 — Trip Workspace V1 第 2 階段：地圖分頁不得新增 Places／Routes／Geocoding 呼叫（靜態掃描）
 *
 * 執行：node scripts/verify-trip-map-no-google-calls.mjs
 *
 * 掃描對象：
 *   src/lib/trip/trip-day-groups.ts       （必須存在；含其相對路徑 import 的遞移閉包）
 *   src/lib/trip/trip-map-markers.ts      （必須存在；含其相對路徑 import 的遞移閉包）
 *   src/components/GoogleMap.tsx          （必須存在）
 *   src/components/trip/TripWorkspace*.tsx、src/components/trip/TripMap*.tsx（存在者皆掃描）
 *   另要求至少一個地圖元件：src/components/trip/ 下檔名符合 /^Trip(Workspace)?Map.*\.tsx$/
 *
 * 規則：
 *   1. import 規格字串（含 export-from、動態 import()、require()）不得命中 FORBIDDEN_SPECIFIER。
 *   2. 去除註解後的原始碼不得出現 FORBIDDEN_CODE（Places／Directions／Geocoder 等 JS API 類別、
 *      importLibrary 載入 places/routes/geocoding、Google REST 網域）。
 *   3. GoogleMap.tsx：含 "google" 的 import 只允許既有白名單（google-maps-loader 等，見下）。
 *   4. 兩個純邏輯模組不得有 "@/..." 的值 import（`import type` 可）。
 * 不存在的必要檔案記為 FAIL。
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

let passed = 0;
let failed = 0;
const failures = [];

function record(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`FAIL  ${name}\n      ${msg}`);
  }
}

const FORBIDDEN_SPECIFIER =
  /places|\broutes?\b|geocod|directions|distance-?matrix|itinerary-place-fetch|location\.functions|trip-stop-search|trip-stop-coords|google-rest|google-maps-api|google-routes|unified-place-cache|place-details/i;

const FORBIDDEN_CODE = [
  /\bPlacesService\b/,
  /\bAutocompleteService\b/,
  /\bAutocompleteSuggestion\b/,
  /\bDirectionsService\b/,
  /\bDistanceMatrixService\b/,
  /\bGeocoder\b/,
  /google\.maps\.places\b/,
  /importLibrary\(\s*["'`](places|routes|geocoding)["'`]/,
  /maps\.googleapis\.com/,
  /places\.googleapis\.com/,
  /routes\.googleapis\.com/,
  /\bitineraryPlaceFetch\b|\bfetchItineraryPlace/i,
  /\bgeocodeTripLocationFromText\b|\bresolveTripStopCoords\b|\bresolveTripStop\b/,
];

// GoogleMap.tsx 目前（T156 撰寫時）含 "google" 的 import 白名單
const GOOGLE_MAP_GOOGLE_IMPORT_WHITELIST = new Set([
  "@/lib/google-maps-client",
  "@/lib/google-maps-init-log",
  "@/lib/google-maps-loader",
]);

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** 回傳 [{ spec, typeOnly }] */
function extractImports(src) {
  const code = stripComments(src);
  const out = [];
  const reFrom = /\b(import|export)\s+(type\s+)?[^;"'`]*?\bfrom\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(reFrom)) out.push({ spec: m[3], typeOnly: Boolean(m[2]) });
  for (const m of code.matchAll(/\bimport\s*["']([^"']+)["']/g)) {
    out.push({ spec: m[1], typeOnly: false });
  }
  for (const m of code.matchAll(/\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    out.push({ spec: m[1], typeOnly: false });
  }
  for (const m of code.matchAll(/\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    out.push({ spec: m[1], typeOnly: false });
  }
  return out;
}

function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.find((p) => existsSync(p) && !p.endsWith("/")) ?? null;
}

/** 檔案本身＋相對路徑 import 的遞移閉包 */
function relativeClosure(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { spec } of extractImports(readFileSync(file, "utf8"))) {
      if (!spec.startsWith(".")) continue;
      const next = resolveRelative(file, spec);
      if (next) stack.push(next);
    }
  }
  return [...seen];
}

function assertNoGoogleCalls(file) {
  const src = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);
  for (const { spec } of extractImports(src)) {
    assert.ok(!FORBIDDEN_SPECIFIER.test(spec), `${rel} import 了禁止模組 "${spec}"`);
  }
  const code = stripComments(src);
  for (const re of FORBIDDEN_CODE) {
    const hit = code.match(re);
    assert.ok(!hit, `${rel} 出現禁止用法 "${hit?.[0]}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("== 純邏輯模組（必須存在） ==");
for (const relPath of ["src/lib/trip/trip-day-groups.ts", "src/lib/trip/trip-map-markers.ts"]) {
  const file = join(ROOT, relPath);
  record(`${relPath} 存在`, () => assert.ok(existsSync(file), `檔案不存在：${relPath}`));
  record(`${relPath}（含相對 import 閉包）未 import Places／Routes／Geocoding`, () => {
    assert.ok(existsSync(file), `檔案不存在：${relPath}`);
    for (const f of relativeClosure(file)) assertNoGoogleCalls(f);
  });
  record(`${relPath} 沒有 "@/..." 的值 import（node 可直接載入）`, () => {
    assert.ok(existsSync(file), `檔案不存在：${relPath}`);
    for (const f of relativeClosure(file)) {
      for (const { spec, typeOnly } of extractImports(readFileSync(f, "utf8"))) {
        assert.ok(
          typeOnly || !spec.startsWith("@/"),
          `${relative(ROOT, f)} 值 import "${spec}"（請改 import type 或相對路徑純模組）`,
        );
      }
    }
  });
}

console.log("\n== GoogleMap.tsx ==");
const googleMapFile = join(SRC, "components/GoogleMap.tsx");
record("src/components/GoogleMap.tsx 存在", () =>
  assert.ok(existsSync(googleMapFile), "檔案不存在：src/components/GoogleMap.tsx"),
);
record("GoogleMap.tsx 未 import／使用 Places／Routes／Geocoding", () => {
  assert.ok(existsSync(googleMapFile), "檔案不存在");
  assertNoGoogleCalls(googleMapFile);
});
record("GoogleMap.tsx 含 google 的 import 只限既有白名單（google-maps-loader 等）", () => {
  assert.ok(existsSync(googleMapFile), "檔案不存在");
  for (const { spec } of extractImports(readFileSync(googleMapFile, "utf8"))) {
    if (!/google/i.test(spec)) continue;
    assert.ok(GOOGLE_MAP_GOOGLE_IMPORT_WHITELIST.has(spec), `不在白名單的 google import "${spec}"`);
  }
});

console.log("\n== src/components/trip/ 地圖相關元件 ==");
const tripComponentDir = join(SRC, "components/trip");
const componentFiles = existsSync(tripComponentDir)
  ? readdirSync(tripComponentDir)
      .filter((n) => /^(TripWorkspace|TripMap).*\.tsx$/.test(n) && !/\.test\.tsx$/.test(n))
      .sort()
  : [];
record("至少有一個地圖元件（src/components/trip/Trip(Workspace)?Map*.tsx）", () => {
  const maps = componentFiles.filter((n) => /^Trip(Workspace)?Map.*\.tsx$/.test(n));
  assert.ok(
    maps.length > 0,
    `找不到地圖元件；目前掃描到：${componentFiles.join(", ") || "（無）"}`,
  );
});
for (const name of componentFiles) {
  record(`src/components/trip/${name} 未 import／使用 Places／Routes／Geocoding`, () =>
    assertNoGoogleCalls(join(tripComponentDir, name)),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n總結：${passed} PASS / ${failed} FAIL（共 ${passed + failed}）`);
if (failed > 0) {
  console.log("失敗清單：");
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
