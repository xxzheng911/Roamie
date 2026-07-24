/**
 * Combination Localization Runtime — zh-TW must not deliver bare English.
 * Run: npx vite-node --config scripts/vite.verify.config.mjs scripts/verify-combination-localization.mjs
 */
import assert from "node:assert/strict";
import { applyCombinationLocalizationGate } from "../src/lib/ai/combination-localization-gate.ts";
import {
  deriveCombinationThemeTitle,
  isMechanicalCombinationTitle,
} from "../src/lib/ai/combination-theme-titles.ts";
import {
  isCompleteLocalizationForLocale,
  resolvePlaceDisplayName,
} from "../src/lib/place-display-name.ts";
import { clearLocalizedPlaceNameCache } from "../src/lib/place-localization/localized-place-name-cache.ts";
import { formatBrandDisplayNameZh } from "../src/lib/place-localization/place-name-translation-policy.ts";

clearLocalizedPlaceNameCache();

const HAS_CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const HAS_THAI_RE = /[\u0e00-\u0e7f]/;
const HAS_GREEK_RE = /[\u0370-\u03ff\u1f00-\u1fff]/;
const HAS_KANA_RE = /[\u3040-\u30ff]/;
const HAS_HANGUL_RE = /[\uac00-\ud7a3]/;
const HAS_MYANMAR_RE = /[\u1000-\u109f]/;

function assertZh(name, label) {
  assert.ok(HAS_CJK_RE.test(name), `${label} must contain 繁中: ${name}`);
  assert.ok(!HAS_THAI_RE.test(name), `${label} must not contain Thai`);
  assert.ok(!HAS_MYANMAR_RE.test(name), `${label} must not contain Myanmar`);
}

// --- Bagan cases from production screenshot ---
const baganCases = [
  "Bagan Viewing Tower (Bagan Nan Myint Tower)",
  "Nyaung Lat Phet Viewing Mound (Sunset Viewpoint)",
  "Minnanthu Manmade Sunset Hill",
  "Bulethi",
];

for (const raw of baganCases) {
  clearLocalizedPlaceNameCache();
  const resolved = resolvePlaceDisplayName(
    {
      name: raw,
      originalName: raw,
      englishName: raw,
      types: raw === "Bulethi" ? ["place_of_worship", "tourist_attraction"] : ["tourist_attraction"],
      primaryType: raw === "Bulethi" ? "place_of_worship" : "tourist_attraction",
    },
    "zh-TW",
  );
  assertZh(resolved.localizedDisplayName, raw);
  const complete = isCompleteLocalizationForLocale(resolved, "zh-TW");
  assert.equal(complete.ok, true, `${raw} must be Gate-complete: ${complete.reason} → ${resolved.localizedDisplayName} (${resolved.localizationSource})`);
  assert.notEqual(resolved.localizationSource, "english");
  assert.notEqual(resolved.localizationSource, "english_fallback");
  console.log(`OK bagan: ${raw} → ${resolved.localizedDisplayName} [${resolved.localizationSource}]`);
}

// --- Brand exception keeps Latin stem + 繁中 type ---
clearLocalizedPlaceNameCache();
const brand = formatBrandDisplayNameZh("Tree O’ Clock Gallery & Restaurant");
assert.ok(brand && /Tree O.? Clock/.test(brand) && HAS_CJK_RE.test(brand), brand);
const brandResolved = resolvePlaceDisplayName(
  {
    name: "Tree O’ Clock Gallery & Restaurant",
    originalName: "Tree O’ Clock Gallery & Restaurant",
    types: ["restaurant"],
  },
  "zh-TW",
);
assert.equal(brandResolved.localizationSource, "brand_exception");
assertZh(brandResolved.localizedDisplayName, "brand");
console.log(`OK brand: ${brandResolved.localizedDisplayName}`);

// --- Gate rejects Thai / Greek / Kana / Hangul / bare English ---
clearLocalizedPlaceNameCache();
const gated = applyCombinationLocalizationGate(
  [
    {
      combinationId: "test:phuket",
      title: "經典景點組合",
      theme: "attraction",
      placeCandidates: [
        { name: "普吉老城區", types: ["tourist_attraction"] },
        { name: "土生華人博物館", types: ["museum"] },
        { name: "เมืองเก่าท่องเที่ยวภูเก็ต", types: ["tourist_attraction"] },
        { name: "Phuket Elephant Conservation", types: ["tourist_attraction"] },
        { name: "Tree O’ Clock Gallery & Restaurant", types: ["restaurant"] },
      ],
    },
    {
      combinationId: "test:bagan",
      title: "推薦景點組合 3",
      theme: "attraction",
      placeCandidates: [
        { name: "摩奴訶寺", types: ["place_of_worship"] },
        { name: "摩訶菩提寺", types: ["place_of_worship"] },
        {
          name: "Bulethi",
          types: ["place_of_worship"],
          primaryType: "place_of_worship",
        },
      ],
    },
  ],
  { locale: "zh-TW", minPlacesPerCombo: 2, minCombinations: 2 },
);

assert.ok(gated.combinations.length >= 2, `expected ≥2 combos, got ${gated.combinations.length}`);
for (const combo of gated.combinations) {
  for (const p of combo.placeCandidates) {
    assertZh(p.localizedDisplayName || "", combo.title);
    assert.ok(!HAS_THAI_RE.test(p.localizedDisplayName || ""));
  }
  assert.ok(!isMechanicalCombinationTitle(combo.title) || true);
}

const allNames = gated.combinations.flatMap((c) =>
  c.placeCandidates.map((p) => p.localizedDisplayName),
);
assert.ok(
  !allNames.some((n) => /Phuket Elephant|Elephant Conservation/i.test(n || "")),
  "unverified English descriptive names must not pass gate",
);
assert.ok(!allNames.some((n) => n === "Bulethi"), "Bulethi English must not pass");
assert.ok(allNames.some((n) => /布雷迪/.test(n || "")), "Bulethi must resolve to 繁中");
assert.ok(
  !gated.combinations.some((c) => isMechanicalCombinationTitle(c.title)),
  "mechanical titles must be rewritten by gate",
);

// Mechanical title derivation
const derived = deriveCombinationThemeTitle(
  [
    { name: "摩奴訶寺", types: ["place_of_worship"] },
    { name: "摩訶菩提寺", types: ["place_of_worship"] },
    { name: "布雷迪佛塔", types: ["place_of_worship"] },
  ],
  { locale: "zh-TW", baseTitle: "推薦景點組合 3", usedTitles: new Set(["經典景點組合"]) },
);
assert.ok(!isMechanicalCombinationTitle(derived), derived);
assert.ok(HAS_CJK_RE.test(derived), derived);
console.log(`OK theme derive: 推薦景點組合 3 → ${derived}`);

// Foreign scripts never complete for zh-TW
for (const foreign of ["Ακρόπολη", "東京タワー", "남산타워", "ရွှေ့ဂူကြီး"]) {
  clearLocalizedPlaceNameCache();
  const r = resolvePlaceDisplayName(foreign, "zh-TW");
  // May fall back to original; Gate completeness must fail if still foreign/english-only
  if (/[\u0370-\u03ff\u3040-\u30ff\uac00-\ud7a3\u1000-\u109f]/.test(r.localizedDisplayName)) {
    const c = isCompleteLocalizationForLocale(r, "zh-TW");
    assert.equal(c.ok, false, foreign);
  }
}

console.log("verify-combination-localization: OK");
console.log(
  "Sample gated places:",
  gated.combinations.map((c) => `${c.title}:${c.placeCandidates.map((p) => p.localizedDisplayName).join("、")}`).join(" | "),
);
