#!/usr/bin/env node
/**
 * Phase 1 Step B #1：LocationSearchField Autocomplete → places-gateway
 *
 * 不打真實 Places API；以 mock searchFn + 統計驗證：
 * - Flag OFF → legacy 路徑
 * - Flag ON  → pie 路徑（底層仍為同一 searchPlaces 實作）
 * - ON/OFF 結果一致
 * - 底層 autocomplete 各觸發恰好 1 次（無加倍請求）
 *
 * 執行：npm run verify:pie-step-b-location-autocomplete
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  searchAutocompleteViaGateway,
  setPieFacadeEnabledOverride,
  resetPlacesGatewayAutocompleteStats,
  getPlacesGatewayAutocompleteStats,
  pieFacade,
} from "../src/lib/pie/index.ts";
import { searchPlaces as legacySearchAutocomplete } from "../src/services/placesService.ts";

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

console.info("[verify:pie-step-b-location-autocomplete] Step B #1\n");

test("LocationSearchField imports places-gateway (not pie-facade / not direct searchPlaces)", () => {
  const src = readFileSync(join(root, "src/components/LocationSearchField.tsx"), "utf8");
  assert.match(src, /searchAutocompleteViaGateway/);
  assert.match(src, /from ["']@\/lib\/pie\/places-gateway["']/);
  assert.doesNotMatch(src, /from ["']@\/lib\/pie\/pie-facade["']/);
  assert.doesNotMatch(src, /from ["']@\/lib\/pie["']/);
  // Autocomplete 不得再直呼 placesService.searchPlaces
  assert.doesNotMatch(
    src,
    /searchPlaces\s+as\s+searchPlacesService/,
  );
});

test("facade autocomplete is same function as legacy (no extra API layer)", () => {
  assert.equal(pieFacade.searchAutocomplete, legacySearchAutocomplete);
});

await testAsync("flag OFF routes to legacy; single underlying call; stable result", async () => {
  setPieFacadeEnabledOverride(false);
  resetPlacesGatewayAutocompleteStats();

  let underlyingCalls = 0;
  const mockSearchFn = async () => {
    underlyingCalls += 1;
    return {
      suggestions: [
        { placeId: "ChIJ_off", label: "台北車站", secondary: "台北市" },
      ],
      error: null,
    };
  };

  const result = await searchAutocompleteViaGateway("台北車站", {
    locale: "zh-TW",
    sessionToken: "verify-off",
    searchFn: mockSearchFn,
  });

  const stats = getPlacesGatewayAutocompleteStats();
  assert.equal(stats.lastAutocompletePath, "legacy");
  assert.equal(stats.autocomplete.legacy, 1);
  assert.equal(stats.autocomplete.pie, 0);
  assert.equal(underlyingCalls, 1, "API/underlying calls must not increase");
  assert.equal(result.error, null);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0]?.placeId, "ChIJ_off");
  assert.equal(result.suggestions[0]?.label, "台北車站");
});

await testAsync("flag ON routes to pie; single underlying call; same shape", async () => {
  setPieFacadeEnabledOverride(true);
  resetPlacesGatewayAutocompleteStats();

  let underlyingCalls = 0;
  const mockSearchFn = async () => {
    underlyingCalls += 1;
    return {
      suggestions: [
        { placeId: "ChIJ_on", label: "東京駅", secondary: "Tokyo" },
      ],
      error: null,
    };
  };

  const result = await searchAutocompleteViaGateway("東京駅", {
    locale: "ja",
    sessionToken: "verify-on",
    searchFn: mockSearchFn,
  });

  const stats = getPlacesGatewayAutocompleteStats();
  assert.equal(stats.lastAutocompletePath, "pie");
  assert.equal(stats.autocomplete.pie, 1);
  assert.equal(stats.autocomplete.legacy, 0);
  assert.equal(underlyingCalls, 1, "API/underlying calls must not increase");
  assert.equal(result.error, null);
  assert.equal(result.suggestions[0]?.placeId, "ChIJ_on");
  assert.equal(result.suggestions[0]?.label, "東京駅");
});

await testAsync("ON/OFF same inputs → same outputs (no behavior drift)", async () => {
  const mockSearchFn = async (query, locale) => ({
    suggestions: [
      {
        placeId: "ChIJ_same",
        label: `Hit:${query}:${locale}`,
        secondary: "same",
      },
    ],
    error: null,
  });

  const args = [
    "京都",
    { locale: "zh-TW", sessionToken: "verify-parity", searchFn: mockSearchFn },
  ];

  setPieFacadeEnabledOverride(false);
  resetPlacesGatewayAutocompleteStats();
  const off = await searchAutocompleteViaGateway(...args);

  setPieFacadeEnabledOverride(true);
  resetPlacesGatewayAutocompleteStats();
  const on = await searchAutocompleteViaGateway(...args);

  assert.deepEqual(on, off);
  setPieFacadeEnabledOverride(null);
});

await testAsync("error path identical ON/OFF", async () => {
  const mockSearchFn = async () => ({
    suggestions: [],
    error: "quota_exceeded",
  });

  setPieFacadeEnabledOverride(false);
  const off = await searchAutocompleteViaGateway("x", {
    locale: "en",
    searchFn: mockSearchFn,
  });

  setPieFacadeEnabledOverride(true);
  const on = await searchAutocompleteViaGateway("x", {
    locale: "en",
    searchFn: mockSearchFn,
  });

  assert.deepEqual(on, off);
  assert.equal(on.error, "quota_exceeded");
  assert.equal(on.suggestions.length, 0);
  setPieFacadeEnabledOverride(null);
});

setPieFacadeEnabledOverride(null);
console.info("\n[verify:pie-step-b-location-autocomplete] all passed");
