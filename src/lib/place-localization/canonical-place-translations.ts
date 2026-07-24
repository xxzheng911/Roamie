/**
 * Canonical / structural Traditional Chinese place-name builders.
 *
 * Only emits a translation when confidence ≥ MIN_CONFIDENCE.
 * Unknown proper nouns use latin→zh transliteration when paired with a
 * clear landmark type suffix (tower / temple / viewpoint / …).
 */

import { transliterateLatinToZh } from "@/lib/place-localization/latin-zh-transliteration";
import {
  formatBrandDisplayNameZh,
  isBrandName,
  isTranslatableLandmark,
} from "@/lib/place-localization/place-name-translation-policy";
import {
  lookupVerifiedPlaceTranslation,
  normalizePlaceNameKey,
  type VerifiedPlaceTranslation,
} from "@/lib/place-localization/verified-place-translations";

/** Minimum confidence to use a generated translation in UI. */
export const MIN_TRANSLATION_CONFIDENCE = 0.8;

/** Verified proper-noun → 繁中 (mythological / geographic tokens). */
const VERIFIED_PROPER_NOUNS: Record<string, string> = {
  probona: "普羅博納",
  asklepios: "阿斯克勒庇俄斯",
  asclepius: "阿斯克勒庇俄斯",
  asklepius: "阿斯克勒庇俄斯",
  acropolis: "衛城",
  agora: "阿哥拉",
  athens: "雅典",
  olympia: "奧林匹亞",
  delphi: "德爾斐",
  parthenon: "帕特農",
  zeus: "宙斯",
  apollo: "阿波羅",
  athena: "雅典娜",
  dionysus: "狄俄倪索斯",
  poseidon: "波塞頓",
  hera: "希拉",
  hermes: "赫耳墨斯",
  tokyo: "東京",
  sapporo: "札幌",
  jeju: "濟州",
  namsan: "南山",
  seoul: "首爾",
  bagan: "蒲甘",
  phuket: "普吉",
  bangkok: "曼谷",
  yangon: "仰光",
  mandalay: "曼德勒",
  "nan myint": "南敏",
  nanmyint: "南敏",
};

type StructuralPattern = {
  re: RegExp;
  /** Build zh name from capture groups; return null to skip. */
  build: (match: RegExpMatchArray) => { zh: string; confidence: number } | null;
};

/** English dictionary / org words — do not phonetically invent 繁中 from these. */
const COMMON_EN_LEXICON_RE =
  /\b(conservation|elephant|center|centre|project|foundation|international|national|community|service|services|company|limited|group|sanctuary|rescue|wildlife|nature|protect(?:ion)?|society|association|organization|organisation|institute|university|hospital|clinic|school|office|the|and|of|for|with|from)\b/i;

function properNounZh(token: string): { zh: string; confidence: number } | null {
  const key = normalizePlaceNameKey(token).replace(/[^a-z0-9\s\-]/g, "").trim();
  if (!key) return null;
  const exact = VERIFIED_PROPER_NOUNS[key];
  if (exact) return { zh: exact, confidence: 0.92 };
  // Multi-word: translate known parts only when every token is verified.
  const parts = key.split(/[\s\-]+/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => VERIFIED_PROPER_NOUNS[p])) {
    return {
      zh: parts.map((p) => VERIFIED_PROPER_NOUNS[p]!).join(""),
      confidence: 0.9,
    };
  }
  // Do not phonetically invent from English lexicon phrases (Elephant Conservation…).
  if (COMMON_EN_LEXICON_RE.test(token) || parts.length > 3) return null;
  // Fall back to phonetic transliteration for short romanized stems.
  const translit = transliterateLatinToZh(token);
  if (translit && translit.confidence >= MIN_TRANSLATION_CONFIDENCE) {
    return { zh: translit.zh, confidence: translit.confidence };
  }
  return null;
}

function stripParenthetical(name: string): { primary: string; alias?: string } {
  const m = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) return { primary: (m[1] ?? "").trim(), alias: (m[2] ?? "").trim() };
  return { primary: name.trim() };
}

const STRUCTURAL_PATTERNS: StructuralPattern[] = [
  {
    re: /^(.+?)\s+viewing\s+tower$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}觀景塔`, confidence: Math.min(0.9, noun.confidence + 0.04) };
    },
  },
  {
    re: /^(.+?)\s+viewing\s+mound$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}觀景丘`, confidence: Math.min(0.88, noun.confidence + 0.02) };
    },
  },
  {
    re: /^(.+?)\s+manmade\s+sunset\s+hill$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}人工夕陽丘`, confidence: Math.min(0.88, noun.confidence + 0.02) };
    },
  },
  {
    re: /^(.+?)\s+sunset\s+(hill|viewpoint|point)$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      const suffix = (m[2] ?? "").toLowerCase() === "hill" ? "夕陽丘" : "夕陽觀景點";
      return { zh: `${noun.zh}${suffix}`, confidence: Math.min(0.88, noun.confidence + 0.02) };
    },
  },
  {
    re: /^(.+?)\s+(viewpoint|lookout|observation\s+deck)$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}觀景點`, confidence: Math.min(0.88, noun.confidence + 0.02) };
    },
  },
  {
    re: /^(.+?)\s+park$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}公園`, confidence: Math.min(0.93, noun.confidence + 0.02) };
    },
  },
  {
    re: /^temple\s+of\s+(.+)$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}神殿`, confidence: Math.min(0.93, noun.confidence + 0.02) };
    },
  },
  {
    re: /^(.+?)\s+(temple|pagoda|stupa)$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      const kind = (m[2] ?? "").toLowerCase();
      const suffix = kind === "temple" ? "寺" : "佛塔";
      return { zh: `${noun.zh}${suffix}`, confidence: Math.min(0.9, noun.confidence) };
    },
  },
  {
    re: /^(.+?)\s+museum$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}博物館`, confidence: Math.min(0.9, noun.confidence) };
    },
  },
  {
    re: /^(.+?)\s+tower$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}塔`, confidence: Math.min(0.9, noun.confidence) };
    },
  },
  {
    re: /^(.+?)\s+castle$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}城`, confidence: Math.min(0.88, noun.confidence) };
    },
  },
  {
    re: /^(.+?)\s+bridge$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}橋`, confidence: Math.min(0.88, noun.confidence) };
    },
  },
  {
    re: /^(.+?)\s+square$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}廣場`, confidence: Math.min(0.88, noun.confidence) };
    },
  },
  {
    re: /^(.+?)\s+cathedral$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}大教堂`, confidence: Math.min(0.9, noun.confidence) };
    },
  },
  {
    re: /^(.+?)\s+church$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}教堂`, confidence: Math.min(0.88, noun.confidence) };
    },
  },
  {
    re: /^(.+?)\s+beach$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}海灘`, confidence: Math.min(0.88, noun.confidence) };
    },
  },
  {
    re: /^(.+?)\s+island$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}島`, confidence: Math.min(0.88, noun.confidence) };
    },
  },
  {
    re: /^(.+?)\s+hill$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) return null;
      return { zh: `${noun.zh}山丘`, confidence: Math.min(0.85, noun.confidence) };
    },
  },
];

/** Generic EN type phrases with high confidence (no proper-noun inventing). */
const GENERIC_PHRASE_ZH: Array<{ re: RegExp; zh: string; confidence: number }> = [
  { re: /dry\s*food\s*market/i, zh: "乾貨市場", confidence: 0.95 },
  { re: /traditional\s*market/i, zh: "傳統市場", confidence: 0.95 },
  { re: /wet\s*market/i, zh: "傳統市場", confidence: 0.95 },
  { re: /night\s*market/i, zh: "夜市", confidence: 0.95 },
  { re: /flea\s*market/i, zh: "跳蚤市場", confidence: 0.95 },
  { re: /hello\s*kitty\s*island/i, zh: "Hello Kitty 島", confidence: 0.95 },
  { re: /mysterious\s*road/i, zh: "神秘之路", confidence: 0.92 },
  { re: /nuwemaru\s*street/i, zh: "暖暖路步行街", confidence: 0.92 },
  { re: /glass\s*castle/i, zh: "琉璃城", confidence: 0.85 },
  { re: /camellia\s*hill/i, zh: "山茶花之丘", confidence: 0.9 },
  { re: /clock\s*tower/i, zh: "時計台", confidence: 0.85 },
  { re: /olympic\s*cauldron|olympic\s*flame/i, zh: "奧運聖火台", confidence: 0.9 },
  { re: /drinking\s*fountain|water\s*fountain/i, zh: "飲水處", confidence: 0.85 },
  { re: /pedestrian\s*shopping\s*street/i, zh: "步行街", confidence: 0.85 },
  { re: /sunset\s*viewpoint/i, zh: "夕陽觀景點", confidence: 0.88 },
  // Generic local-language type phrases (diacritic-stripped keys via tryStructuralAscii)
  { re: /^nha\s+vong\s*canh$/i, zh: "觀景亭", confidence: 0.9 },
  { re: /^vong\s*canh$/i, zh: "觀景點", confidence: 0.88 },
];

/**
 * Vietnamese / SE-Asia type-prefix patterns (matched on diacritic-stripped ASCII).
 * Type words only — not destination-specific place hardcodes.
 */
const LOCAL_TYPE_PREFIX_PATTERNS: StructuralPattern[] = [
  {
    re: /^tuong\s+(.+)$/i,
    build: (m) => {
      const rest = (m[1] ?? "").trim();
      // Prefer tokenized transliteration so "ca chep hoa rong" → 鯉魚化龍雕像
      const t = transliterateLatinToZh(rest);
      if (t && t.usedKnownTokens && t.confidence >= MIN_TRANSLATION_CONFIDENCE) {
        return { zh: `${t.zh}雕像`, confidence: Math.min(0.9, t.confidence + 0.04) };
      }
      const noun = properNounZh(rest);
      if (!noun) {
        if (!t || t.confidence < MIN_TRANSLATION_CONFIDENCE) return null;
        return { zh: `${t.zh}雕像`, confidence: Math.min(0.86, t.confidence) };
      }
      return { zh: `${noun.zh}雕像`, confidence: Math.min(0.88, noun.confidence) };
    },
  },
  {
    re: /^nha\s+(.+)$/i,
    build: (m) => {
      const rest = (m[1] ?? "").trim();
      if (/^vong\s*canh$/i.test(rest)) return { zh: "觀景亭", confidence: 0.9 };
      const noun = properNounZh(rest);
      if (!noun) {
        const t = transliterateLatinToZh(rest);
        if (!t || t.confidence < MIN_TRANSLATION_CONFIDENCE) return null;
        return { zh: `${t.zh}館`, confidence: Math.min(0.84, t.confidence) };
      }
      return { zh: `${noun.zh}館`, confidence: Math.min(0.86, noun.confidence) };
    },
  },
  {
    re: /^bao\s*tang\s+(.+)$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) {
        const t = transliterateLatinToZh(m[1] ?? "");
        if (!t || t.confidence < MIN_TRANSLATION_CONFIDENCE) return null;
        return { zh: `${t.zh}博物館`, confidence: Math.min(0.86, t.confidence) };
      }
      return { zh: `${noun.zh}博物館`, confidence: Math.min(0.9, noun.confidence) };
    },
  },
  {
    re: /^cau\s+(.+)$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) {
        const t = transliterateLatinToZh(m[1] ?? "");
        if (!t || t.confidence < MIN_TRANSLATION_CONFIDENCE) return null;
        return { zh: `${t.zh}橋`, confidence: Math.min(0.86, t.confidence) };
      }
      return { zh: `${noun.zh}橋`, confidence: Math.min(0.88, noun.confidence) };
    },
  },
  {
    re: /^ghenh\s+(.+)$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) {
        const t = transliterateLatinToZh(m[1] ?? "");
        if (!t || t.confidence < MIN_TRANSLATION_CONFIDENCE) return null;
        return { zh: `${t.zh}礁岩`, confidence: Math.min(0.84, t.confidence) };
      }
      return { zh: `${noun.zh}礁岩`, confidence: Math.min(0.86, noun.confidence) };
    },
  },
  {
    re: /^bai\s+(.+)$/i,
    build: (m) => {
      const noun = properNounZh(m[1] ?? "");
      if (!noun) {
        const t = transliterateLatinToZh(m[1] ?? "");
        if (!t || t.confidence < MIN_TRANSLATION_CONFIDENCE) return null;
        return { zh: `${t.zh}海灘`, confidence: Math.min(0.84, t.confidence) };
      }
      return { zh: `${noun.zh}海灘`, confidence: Math.min(0.86, noun.confidence) };
    },
  },
];

export type CanonicalTranslationResult = Omit<VerifiedPlaceTranslation, "localizationSource"> & {
  localizationSource: "verified_zh" | "canonical_zh" | "brand_exception";
};

export type CanonicalLookupInput = {
  originalName?: string | null;
  placeId?: string | null;
  canonicalPlaceId?: string | null;
  countryCode?: string | null;
  types?: string[] | null;
  primaryType?: string | null;
  englishName?: string | null;
};

function tryStructural(original: string): CanonicalTranslationResult | null {
  const asciiKey = normalizePlaceNameKey(original);

  for (const { re, zh, confidence } of GENERIC_PHRASE_ZH) {
    const haystack = re.test(original) ? original : re.test(asciiKey) ? asciiKey : null;
    if (!haystack || confidence < MIN_TRANSLATION_CONFIDENCE) continue;
    const mostlyPhrase = haystack.replace(re, "").trim().length < 3;
    if (mostlyPhrase || confidence >= 0.9) {
      return {
        originalName: original,
        localizedDisplayName: zh,
        languageCode: "zh-TW",
        localizationSource: "canonical_zh",
        translationConfidence: confidence,
      };
    }
  }

  for (const pattern of STRUCTURAL_PATTERNS) {
    const match = original.match(pattern.re);
    if (!match) continue;
    const built = pattern.build(match);
    if (!built || built.confidence < MIN_TRANSLATION_CONFIDENCE) continue;
    return {
      originalName: original,
      localizedDisplayName: built.zh,
      languageCode: "zh-TW",
      localizationSource: "canonical_zh",
      translationConfidence: built.confidence,
    };
  }

  // Local-language type prefixes (Vietnamese etc.) on diacritic-stripped key
  for (const pattern of LOCAL_TYPE_PREFIX_PATTERNS) {
    const match = asciiKey.match(pattern.re);
    if (!match) continue;
    const built = pattern.build(match);
    if (!built || built.confidence < MIN_TRANSLATION_CONFIDENCE) continue;
    return {
      originalName: original,
      localizedDisplayName: built.zh,
      languageCode: "zh-TW",
      localizationSource: "canonical_zh",
      translationConfidence: built.confidence,
    };
  }

  return null;
}

function tryBareLandmarkTransliteration(
  original: string,
  input: CanonicalLookupInput,
): CanonicalTranslationResult | null {
  if (!isTranslatableLandmark({
    name: original,
    types: input.types,
    primaryType: input.primaryType,
  })) {
    return null;
  }
  // Only bare Latin (no clear English type suffix already handled above).
  if (/\b(temple|pagoda|tower|park|museum|beach|hill|mound|viewpoint)\b/i.test(original)) {
    return null;
  }
  // Reject long English descriptive phrases — Gate should drop, not invent garbage 音譯.
  const ascii = normalizePlaceNameKey(original);
  const tokens = ascii.split(/[\s\-_/]+/).filter(Boolean);
  if (tokens.length > 4) return null;
  if (COMMON_EN_LEXICON_RE.test(original) || COMMON_EN_LEXICON_RE.test(ascii)) return null;

  const translit = transliterateLatinToZh(ascii);
  if (!translit || translit.confidence < MIN_TRANSLATION_CONFIDENCE) return null;

  const types = [input.primaryType ?? "", ...(input.types ?? [])].join(" ").toLowerCase();
  const worship =
    /\b(place_of_worship|hindu_temple|temple|pagoda|stupa|shrine)\b/i.test(types) ||
    /\b(temple|pagoda|stupa|shrine)\b/i.test(original);
  const hasLocalDiacritics =
    /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(
      original,
    ) || /[\u0300-\u036f]/.test(original.normalize("NFD"));
  // Bare multi-word Latin without worship context is too risky without verified dict —
  // except local-diacritic romanization (VN/TH/…) where phonetic 繁中 is the recovery path.
  if (!worship && !hasLocalDiacritics && tokens.length > 1 && !translit.usedKnownTokens) {
    return null;
  }

  const suffix = worship ? "佛塔" : "";
  const zh = `${translit.zh}${suffix}`;
  return {
    originalName: original,
    localizedDisplayName: zh,
    languageCode: "zh-TW",
    localizationSource: "canonical_zh",
    translationConfidence: Math.min(translit.confidence, worship ? 0.86 : 0.82),
    placeId: input.placeId ?? undefined,
    canonicalPlaceId: input.canonicalPlaceId ?? undefined,
    countryCode: input.countryCode ?? undefined,
  };
}

/**
 * Resolve a verifiable 繁中 name from canonical patterns / verified nouns.
 * Returns null when confidence would be below threshold.
 */
export function lookupCanonicalPlaceTranslation(
  input: CanonicalLookupInput,
): CanonicalTranslationResult | null {
  const verified = lookupVerifiedPlaceTranslation(input);
  if (verified && verified.translationConfidence >= MIN_TRANSLATION_CONFIDENCE) {
    return { ...verified, localizationSource: "verified_zh" };
  }

  const original = (input.originalName ?? "").trim();
  if (!original) return null;

  // Brand keep + 繁中 type (not a full translation).
  if (
    isBrandName({
      name: original,
      types: input.types,
      primaryType: input.primaryType,
    })
  ) {
    const brandZh = formatBrandDisplayNameZh(original);
    if (brandZh) {
      return {
        originalName: original,
        localizedDisplayName: brandZh,
        languageCode: "zh-TW",
        localizationSource: "brand_exception",
        translationConfidence: 0.9,
        placeId: input.placeId ?? undefined,
        canonicalPlaceId: input.canonicalPlaceId ?? undefined,
        countryCode: input.countryCode ?? undefined,
      };
    }
  }

  const { primary, alias } = stripParenthetical(original);
  const candidates = [primary, alias, original].filter(
    (v, i, arr): v is string => Boolean(v) && arr.indexOf(v) === i,
  );

  for (const candidate of candidates) {
    const structural = tryStructural(candidate);
    if (structural) {
      return {
        ...structural,
        placeId: input.placeId ?? undefined,
        canonicalPlaceId: input.canonicalPlaceId ?? undefined,
        countryCode: input.countryCode ?? undefined,
      };
    }
  }

  // Prefer alias when it is a better-known proper noun (e.g. Nan Myint Tower).
  if (alias) {
    const aliasStructural = tryStructural(alias);
    if (aliasStructural) {
      return {
        ...aliasStructural,
        placeId: input.placeId ?? undefined,
        canonicalPlaceId: input.canonicalPlaceId ?? undefined,
        countryCode: input.countryCode ?? undefined,
      };
    }
  }

  for (const candidate of candidates) {
    const bare = tryBareLandmarkTransliteration(candidate, input);
    if (bare) return bare;
  }

  return null;
}
