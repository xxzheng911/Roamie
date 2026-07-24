/**
 * Translation policy for place display names.
 * Distinguishes brand / commercial names from translatable landmarks.
 */

const HAS_LATIN_RE = /[A-Za-z]/;
const HAS_CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

/** Commercial / venue type suffixes that signal a brand-keep policy. */
const BRAND_TYPE_SUFFIX_RE =
  /\b(gallery|restaurant|cafe|café|coffee|bar|bistro|boutique|shop|store|hotel|resort|spa|hostel|inn|pub|grill|kitchen|bakery|diner|lounge|club|studio|atelier)\b/i;

/** Explicit brand / IP tokens that should not be fully Sinicized. */
const BRAND_TOKEN_RE =
  /\b(hello\s*kitty|starbucks|mcdonald'?s|kfc|uniqlo|zara|nike|adidas|apple\s*store|ikea|muji|dior|gucci|louis\s*vuitton|chanel|hermes|hermès)\b/i;

/** Landmark / attraction type cues — prefer translate / transliterate. */
const LANDMARK_TYPE_RE =
  /\b(temple|pagoda|stupa|shrine|church|cathedral|mosque|synagogue|museum|park|garden|beach|bridge|castle|palace|fort|ruins?|tower|viewpoint|viewing|mound|hill|observatory|monument|statue|waterfall|lake|island|market|square|plaza|acropolis|agora|pyramid|tomb|cave|canyon|cliff|bay|cape|harbour|harbor|pier|lighthouse|zoo|aquarium|palace)\b/i;

const LANDMARK_TYPE_ZH: Array<{ re: RegExp; zh: string }> = [
  { re: /\bgallery\s*&\s*restaurant\b/i, zh: "藝廊餐廳" },
  { re: /\brestaurant\b/i, zh: "餐廳" },
  { re: /\bgallery\b/i, zh: "藝廊" },
  { re: /\b(cafe|café|coffee\s*shop)\b/i, zh: "咖啡廳" },
  { re: /\bhotel\b/i, zh: "飯店" },
  { re: /\bresort\b/i, zh: "度假村" },
  { re: /\bspa\b/i, zh: "SPA" },
  { re: /\bboutique\b/i, zh: "精品店" },
  { re: /\b(shop|store)\b/i, zh: "商店" },
  { re: /\bbar\b/i, zh: "酒吧" },
  { re: /\bbakery\b/i, zh: "烘焙店" },
];

export type PlaceTranslationPolicy =
  | "brand_keep_with_type"
  | "landmark_translate"
  | "landmark_transliterate"
  | "locale_passthrough"
  | "incomplete";

export type PlaceTranslationPolicyInput = {
  name: string;
  types?: string[] | null;
  primaryType?: string | null;
};

function typeBlob(input: PlaceTranslationPolicyInput): string {
  return [input.primaryType ?? "", ...(input.types ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isBrandName(input: PlaceTranslationPolicyInput | string): boolean {
  const name = typeof input === "string" ? input : input.name;
  const t = (name ?? "").trim();
  if (!t || !HAS_LATIN_RE.test(t)) return false;
  if (BRAND_TOKEN_RE.test(t)) return true;
  if (BRAND_TYPE_SUFFIX_RE.test(t) && !LANDMARK_TYPE_RE.test(t.replace(BRAND_TYPE_SUFFIX_RE, ""))) {
    return true;
  }
  // "X & Y Restaurant/Gallery" commercial pattern
  if (/\s&\s/.test(t) && BRAND_TYPE_SUFFIX_RE.test(t)) return true;
  const types = typeof input === "string" ? "" : typeBlob(input);
  if (
    /\b(restaurant|cafe|coffee_shop|bar|hotel|lodging|store|shopping_mall)\b/i.test(types) &&
    BRAND_TYPE_SUFFIX_RE.test(t)
  ) {
    return true;
  }
  return false;
}

export function isTranslatableLandmark(
  input: PlaceTranslationPolicyInput | string,
): boolean {
  const name = typeof input === "string" ? input : input.name;
  const t = (name ?? "").trim();
  if (!t) return false;
  if (isBrandName(typeof input === "string" ? t : input)) return false;
  if (LANDMARK_TYPE_RE.test(t)) return true;
  const types = typeof input === "string" ? "" : typeBlob(input);
  if (
    /\b(tourist_attraction|place_of_worship|hindu_temple|church|mosque|museum|park|natural_feature|landmark|historical_landmark|monument|observation_deck)\b/i.test(
      types,
    )
  ) {
    return true;
  }
  // Short Latin proper noun among worship/attraction contexts is treated as landmark.
  if (HAS_LATIN_RE.test(t) && !HAS_CJK_RE.test(t) && t.split(/\s+/).length <= 3) {
    if (/\b(place_of_worship|hindu_temple|tourist_attraction|landmark)\b/i.test(types)) {
      return true;
    }
  }
  return false;
}

export function resolveTranslationPolicy(
  input: PlaceTranslationPolicyInput,
): PlaceTranslationPolicy {
  const name = (input.name ?? "").trim();
  if (!name) return "incomplete";
  if (HAS_CJK_RE.test(name) && !HAS_LATIN_RE.test(name)) return "locale_passthrough";
  if (isBrandName(input)) return "brand_keep_with_type";
  if (isTranslatableLandmark(input)) {
    return LANDMARK_TYPE_RE.test(name) ? "landmark_translate" : "landmark_transliterate";
  }
  if (HAS_LATIN_RE.test(name) && !HAS_CJK_RE.test(name)) return "incomplete";
  return "locale_passthrough";
}

/** Strip commercial type words to keep the brand stem. */
export function extractBrandStem(name: string): string {
  let stem = name.trim();
  stem = stem
    .replace(/\s*&\s*/g, " & ")
    .replace(
      /\s+(gallery(\s*&\s*restaurant)?|restaurant|cafe|café|coffee\s*shop|bar|bistro|boutique|shop|store|hotel|resort|spa|hostel|inn|pub|grill|kitchen|bakery|diner|lounge|club|studio|atelier)\s*$/i,
      "",
    )
    .trim();
  return stem || name.trim();
}

/** Chinese type label for brand-keep display (e.g. 藝廊餐廳). */
export function brandTypeLabelZh(name: string): string | null {
  for (const { re, zh } of LANDMARK_TYPE_ZH) {
    if (re.test(name)) return zh;
  }
  return null;
}

/**
 * Build brand display: keep Latin brand stem + 繁中 type.
 * e.g. "Tree O' Clock Gallery & Restaurant" → "Tree O' Clock 藝廊餐廳"
 */
export function formatBrandDisplayNameZh(name: string): string | null {
  const typeZh = brandTypeLabelZh(name);
  if (!typeZh) return null;
  const stem = extractBrandStem(name);
  if (!stem) return null;
  // Avoid duplicating type if stem already ends with CJK.
  if (HAS_CJK_RE.test(stem) && stem.includes(typeZh)) return stem;
  return `${stem} ${typeZh}`.replace(/\s+/g, " ").trim();
}
