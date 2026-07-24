/**
 * Curated, human-verified Traditional Chinese place names.
 * Only high-confidence entries — never raw machine translation dumps.
 */

export type VerifiedPlaceTranslation = {
  originalName: string;
  localizedDisplayName: string;
  languageCode: "zh-TW" | "zh-Hant";
  localizationSource: "verified_zh";
  translationConfidence: number;
  canonicalPlaceId?: string;
  placeId?: string;
  countryCode?: string;
};

/** Exact EN → 繁中 (normalized lowercase keys). */
const BY_ORIGINAL_NAME: Record<string, VerifiedPlaceTranslation> = {
  "probona park": {
    originalName: "Probona Park",
    localizedDisplayName: "普羅博納公園",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.95,
    countryCode: "GR",
  },
  "temple of asklepios": {
    originalName: "Temple of Asklepios",
    localizedDisplayName: "阿斯克勒庇俄斯神殿",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.95,
    countryCode: "GR",
  },
  "temple of asclepius": {
    originalName: "Temple of Asclepius",
    localizedDisplayName: "阿斯克勒庇俄斯神殿",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.95,
    countryCode: "GR",
  },
  "dry food market": {
    originalName: "Dry Food Market",
    localizedDisplayName: "乾貨市場",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.98,
  },
  "traditional market": {
    originalName: "Traditional Market",
    localizedDisplayName: "傳統市場",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.98,
  },
  "wet market": {
    originalName: "Wet Market",
    localizedDisplayName: "傳統市場",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.98,
  },
  "night market": {
    originalName: "Night Market",
    localizedDisplayName: "夜市",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.98,
  },
  "flea market": {
    originalName: "Flea Market",
    localizedDisplayName: "跳蚤市場",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.98,
  },
  "shopping mall": {
    originalName: "Shopping Mall",
    localizedDisplayName: "購物中心",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.95,
  },
  "department store": {
    originalName: "Department Store",
    localizedDisplayName: "百貨公司",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.95,
  },
  "food court": {
    originalName: "Food Court",
    localizedDisplayName: "美食街",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.95,
  },
  "hello kitty island": {
    originalName: "Hello Kitty Island",
    localizedDisplayName: "Hello Kitty 島",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.98,
  },
  "camellia hill": {
    originalName: "Camellia Hill",
    localizedDisplayName: "山茶花之丘",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.95,
  },
  "jeju glass castle": {
    originalName: "Jeju Glass Castle",
    localizedDisplayName: "濟州琉璃城",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.95,
    countryCode: "KR",
  },
  "mysterious road": {
    originalName: "Mysterious Road",
    localizedDisplayName: "神秘之路",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.95,
  },
  "nuwemaru street": {
    originalName: "Nuwemaru Street",
    localizedDisplayName: "暖暖路步行街",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.95,
    countryCode: "JP",
  },
  "nuwemaru street (pedestrian shopping street)": {
    originalName: "Nuwemaru Street (Pedestrian Shopping Street)",
    localizedDisplayName: "暖暖路步行街",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.95,
    countryCode: "JP",
  },
  "sapporo clock tower": {
    originalName: "Sapporo Clock Tower",
    localizedDisplayName: "札幌市時計台",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.98,
    countryCode: "JP",
  },
  "tokyo tower": {
    originalName: "Tokyo Tower",
    localizedDisplayName: "東京塔",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.99,
    countryCode: "JP",
  },
  "tokyo skytree": {
    originalName: "Tokyo Skytree",
    localizedDisplayName: "東京晴空塔",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.99,
    countryCode: "JP",
  },
  "n seoul tower": {
    originalName: "N Seoul Tower",
    localizedDisplayName: "N首爾塔",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.98,
    countryCode: "KR",
  },
  "namsan tower": {
    originalName: "Namsan Tower",
    localizedDisplayName: "南山塔",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.98,
    countryCode: "KR",
  },
  // Myanmar / Bagan — verified landmark forms (dictionary, not UI hardcode path)
  "bagan viewing tower": {
    originalName: "Bagan Viewing Tower",
    localizedDisplayName: "蒲甘觀景塔",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.95,
    countryCode: "MM",
  },
  "bagan viewing tower (bagan nan myint tower)": {
    originalName: "Bagan Viewing Tower (Bagan Nan Myint Tower)",
    localizedDisplayName: "蒲甘南敏觀景塔",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.96,
    countryCode: "MM",
  },
  "bagan nan myint tower": {
    originalName: "Bagan Nan Myint Tower",
    localizedDisplayName: "蒲甘南敏觀景塔",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.96,
    countryCode: "MM",
  },
  "nyaung lat phet viewing mound": {
    originalName: "Nyaung Lat Phet Viewing Mound",
    localizedDisplayName: "良拉特佩觀景丘",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.92,
    countryCode: "MM",
  },
  "nyaung lat phet viewing mound (sunset viewpoint)": {
    originalName: "Nyaung Lat Phet Viewing Mound (Sunset Viewpoint)",
    localizedDisplayName: "良拉特佩觀景丘",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.92,
    countryCode: "MM",
  },
  "minnanthu manmade sunset hill": {
    originalName: "Minnanthu Manmade Sunset Hill",
    localizedDisplayName: "敏南杜人工夕陽丘",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.92,
    countryCode: "MM",
  },
  bulethi: {
    originalName: "Bulethi",
    localizedDisplayName: "布雷迪佛塔",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.9,
    countryCode: "MM",
  },
  "bulethi pagoda": {
    originalName: "Bulethi Pagoda",
    localizedDisplayName: "布雷迪佛塔",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.92,
    countryCode: "MM",
  },
  "bulethi temple": {
    originalName: "Bulethi Temple",
    localizedDisplayName: "布雷迪佛塔",
    languageCode: "zh-TW",
    localizationSource: "verified_zh",
    translationConfidence: 0.92,
    countryCode: "MM",
  },
};

/** Verified placeId → translation (optional overrides). */
const BY_PLACE_ID: Record<string, VerifiedPlaceTranslation> = {};

/**
 * Normalize for dictionary / transliteration lookup.
 * Strips combining diacritics (Vietnamese, Thai romanization, etc.) so
 * "Nhà Vọng cảnh" → "nha vong canh" without hardcoding place strings.
 */
export function normalizePlaceNameKey(name: string): string {
  return name
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[’']/g, "'");
}

export type VerifiedLookupInput = {
  originalName?: string | null;
  placeId?: string | null;
  canonicalPlaceId?: string | null;
  countryCode?: string | null;
};

/**
 * Lookup a curated verified translation.
 * Confidence is always ≥ 0.9 for dictionary hits.
 */
export function lookupVerifiedPlaceTranslation(
  input: VerifiedLookupInput,
): VerifiedPlaceTranslation | null {
  const placeId = (input.placeId ?? input.canonicalPlaceId ?? "").trim();
  if (placeId && BY_PLACE_ID[placeId]) {
    return BY_PLACE_ID[placeId]!;
  }

  const original = (input.originalName ?? "").trim();
  if (!original) return null;

  const variants = [
    original,
    original.replace(/\s*\([^)]*\)\s*$/, "").trim(),
    ...(original.match(/\(([^)]+)\)/)?.[1]
      ? [original.match(/\(([^)]+)\)/)![1]!.trim()]
      : []),
  ].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);

  for (const variant of variants) {
    const key = normalizePlaceNameKey(variant);
    const hit = BY_ORIGINAL_NAME[key];
    if (!hit) continue;

    if (
      input.countryCode &&
      hit.countryCode &&
      hit.countryCode.toUpperCase() !== input.countryCode.toUpperCase()
    ) {
      // Country mismatch — still allow generic names without country, skip country-bound ones.
      continue;
    }

    return hit;
  }

  return null;
}

/** Register / override a verified translation at runtime (tests / hydration). */
export function registerVerifiedPlaceTranslation(
  entry: VerifiedPlaceTranslation,
): void {
  if (entry.translationConfidence < 0.9) return;
  const key = normalizePlaceNameKey(entry.originalName);
  BY_ORIGINAL_NAME[key] = entry;
  if (entry.placeId) BY_PLACE_ID[entry.placeId] = entry;
  if (entry.canonicalPlaceId) BY_PLACE_ID[entry.canonicalPlaceId] = entry;
}
