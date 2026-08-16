/**
 * Locale-aware administrative-area aliases.
 * Traditional Chinese, Japanese kanji, English romanization, and suffix variants
 * are the same evidence — not city-specific flow branches.
 */

import { applyCityLocaleAlias, cityLocaleEvidenceAliases } from "@/lib/ai/destination-locale-aliases";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

/** Common CJK place-name variants → a shared comparison form. */
const CJK_PLACE_FOLD: Record<string, string> = {
  澀: "渋",
  渋: "渋",
  淺: "浅",
  浅: "浅",
  廣: "広",
  広: "広",
  灣: "湾",
  湾: "湾",
  驛: "駅",
  駅: "駅",
  國: "国",
  国: "国",
  縣: "県",
  県: "県",
  齋: "斎",
  斎: "斎",
  樂: "楽",
  楽: "楽",
  濱: "浜",
  浜: "浜",
  橫: "横",
  横: "横",
  龍: "竜",
  竜: "竜",
  臺: "台",
  區: "区",
  银: "銀",
  桥: "橋",
  顿: "頓",
};

/**
 * English / kana / Japanese-kanji area labels → canonical zh stem.
 * Data only; matching logic stays generic.
 */
const AREA_LOCALE_ALIASES: Record<string, string> = {
  shibuya: "澀谷",
  "shibuya city": "澀谷",
  "shibuya-ku": "澀谷",
  "shibuya ward": "澀谷",
  しぶや: "澀谷",
  シブヤ: "澀谷",
  渋谷: "澀谷",
  shinjuku: "新宿",
  "shinjuku city": "新宿",
  "shinjuku-ku": "新宿",
  しんじゅく: "新宿",
  シンジュク: "新宿",
  ueno: "上野",
  うえの: "上野",
  ウエノ: "上野",
  ginza: "銀座",
  ぎんざ: "銀座",
  ギンザ: "銀座",
  asakusa: "淺草",
  あさくさ: "淺草",
  アサクサ: "淺草",
  浅草: "淺草",
  harajuku: "原宿",
  はらじゅく: "原宿",
  ハラジュク: "原宿",
  roppongi: "六本木",
  ろっぽんぎ: "六本木",
  ロッポンギ: "六本木",
  shinsaibashi: "心齋橋",
  心斎橋: "心齋橋",
  しんさいばし: "心齋橋",
  シンサイバシ: "心齋橋",
  dotonbori: "道頓堀",
  どうとんぼり: "道頓堀",
  ドートンボリ: "道頓堀",
  gion: "祇園",
  ぎおん: "祇園",
  ギオン: "祇園",
  anping: "安平",
  xinyi: "信義",
  "xinyi district": "信義",
  xitun: "西屯",
  "xitun district": "西屯",
  gushan: "鼓山",
  "gushan district": "鼓山",
  banqiao: "板橋",
  "banqiao district": "板橋",
  myeongdong: "明洞",
  hongdae: "弘大",
};

const ADMIN_SUFFIX =
  /(?:市|縣|县|區|区|鎮|镇|鄉|乡|町|都|府|州|City|District|Ward|Ku|Shi|Ken)$/i;

export function foldPlaceScript(value: string): string {
  return Array.from(value)
    .map((ch) => CJK_PLACE_FOLD[ch] ?? ch)
    .join("");
}

export function stripAdministrativeSuffix(value: string): string {
  return value.replace(ADMIN_SUFFIX, "").trim();
}

export function normalizeAreaEvidence(value: string): string {
  return foldPlaceScript(
    value
      .normalize("NFKC")
      .trim()
      .replace(/臺/g, "台")
      .replace(/[\s,，、/／.·'’\-]+/g, ""),
  ).toLowerCase();
}

export function applyAreaLocaleAlias(label: string): string {
  const raw = label.trim();
  if (!raw) return raw;
  if (AREA_LOCALE_ALIASES[raw]) return AREA_LOCALE_ALIASES[raw]!;
  const lower = raw.toLowerCase();
  if (AREA_LOCALE_ALIASES[lower]) return AREA_LOCALE_ALIASES[lower]!;
  const folded = foldPlaceScript(raw);
  if (AREA_LOCALE_ALIASES[folded]) return AREA_LOCALE_ALIASES[folded]!;
  const stripped = stripAdministrativeSuffix(raw);
  if (stripped !== raw) {
    const aliased = applyAreaLocaleAlias(stripped);
    if (aliased !== stripped) return aliased;
  }
  const withoutCity = lower
    .replace(/\s+city$/, "")
    .replace(/\s+district$/, "")
    .replace(/\s+ward$/, "")
    .replace(/-ku$/, "")
    .trim();
  if (withoutCity !== lower && AREA_LOCALE_ALIASES[withoutCity]) {
    return AREA_LOCALE_ALIASES[withoutCity]!;
  }
  return applyCityLocaleAlias(raw);
}

export function areaEvidenceAliases(area: string): string[] {
  const canonical = applyAreaLocaleAlias(area);
  const normalized = normalizeDestinationLabel(canonical).trim() || normalizeDestinationLabel(area).trim();
  const stem = stripAdministrativeSuffix(normalized);
  const folded = foldPlaceScript(stem);
  const englishKeys = Object.entries(AREA_LOCALE_ALIASES)
    .filter(([, zh]) => zh === stem || zh === normalized)
    .map(([alias]) => alias);
  return [...new Set([
    normalized,
    stem,
    folded,
    `${stem}區`,
    `${stem}区`,
    `${folded}区`,
    `${folded}區`,
    `${stem} District`,
    `${stem} City`,
    `${folded} City`,
    `${stem}-ku`,
    `${folded}-ku`,
    `${stem}ku`,
    `${folded}ku`,
    ...englishKeys,
    ...englishKeys.map((alias) => `${alias} city`),
    ...englishKeys.map((alias) => `${alias} district`),
    ...englishKeys.map((alias) => `${alias}-ku`),
  ].filter((value) => value && value.replace(/\s+/g, "").length >= 2))];
}

export function parentCityEvidenceAliases(parentCity: string): string[] {
  const canonical = applyCityLocaleAlias(normalizeDestinationLabel(parentCity).trim());
  const folded = foldPlaceScript(canonical);
  return [...new Set(
    [
      canonical,
      folded,
      canonical.replace(/台/g, "臺"),
      canonical.replace(/臺/g, "台"),
      `${canonical}都`,
      `${canonical}市`,
      `${canonical}縣`,
      `${canonical}县`,
      ...cityLocaleEvidenceAliases(canonical),
    ].filter(Boolean),
  )];
}

export function administrativeLabelsMatch(left: string, right: string): boolean {
  const a = normalizeAreaEvidence(stripAdministrativeSuffix(applyAreaLocaleAlias(left)));
  const b = normalizeAreaEvidence(stripAdministrativeSuffix(applyAreaLocaleAlias(right)));
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

export function evidenceIncludesArea(blob: string, area: string): boolean {
  const haystack = normalizeAreaEvidence(blob);
  if (!haystack) return false;
  return areaEvidenceAliases(area).some((alias) => {
    const needle = normalizeAreaEvidence(alias);
    return needle.length >= 2 && haystack.includes(needle);
  });
}

export function evidenceIncludesParentCity(blob: string, parentCity: string): boolean {
  const haystack = normalizeAreaEvidence(blob);
  if (!haystack) return false;
  return parentCityEvidenceAliases(parentCity).some((alias) => {
    const needle = normalizeAreaEvidence(alias);
    return needle.length >= 2 && haystack.includes(needle);
  });
}
