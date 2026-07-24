/**
 * Combination theme titles keyed by App locale (effectiveAppLocale).
 * Titles are product copy — never AI / destination-language generated.
 * Never emit mechanical "推薦景點組合 N".
 */
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import type { Locale } from "@/lib/i18n/types";

const THEME_TITLES: Record<string, Record<Locale, string>> = {
  historic: {
    "zh-TW": "舊城文化組合",
    en: "Old Town Culture",
    ja: "旧市街文化コンビ",
    ko: "구시가지 문화 조합",
  },
  culture: {
    "zh-TW": "藝文博物館組合",
    en: "Arts & Museums",
    ja: "アート＆ミュージアム",
    ko: "예술·박물관 조합",
  },
  nature: {
    "zh-TW": "城市慢遊組合",
    en: "City Stroll",
    ja: "街歩きコンビ",
    ko: "도심 산책 조합",
  },
  coast: {
    "zh-TW": "海岸夕陽組合",
    en: "Coastal Sunset",
    ja: "海岸サンセット",
    ko: "해안 노을 조합",
  },
  cafe: {
    "zh-TW": "咖啡散步組合",
    en: "Cafe Walk",
    ja: "カフェ散歩",
    ko: "카페 산책 조합",
  },
  food: {
    "zh-TW": "人氣美食組合",
    en: "Food Favorites",
    ja: "人気グルメ",
    ko: "인기 맛집 조합",
  },
  shopping: {
    "zh-TW": "購物散策組合",
    en: "Shopping Stroll",
    ja: "ショッピング散策",
    ko: "쇼핑 산책 조합",
  },
  market: {
    "zh-TW": "商圈市集組合",
    en: "Markets & Streets",
    ja: "商店街＆マーケット",
    ko: "상권·시장 조합",
  },
  attraction: {
    "zh-TW": "經典景點組合",
    en: "Classic Sights",
    ja: "定番スポット",
    ko: "클래식 명소 조합",
  },
  suburb: {
    "zh-TW": "近郊自然組合",
    en: "Nearby Nature",
    ja: "近郊ネイチャー",
    ko: "근교 자연 조합",
  },
  temple_trail: {
    "zh-TW": "佛塔古蹟巡禮",
    en: "Pagoda Trail",
    ja: "パゴダ巡り",
    ko: "불탑 유적 순례",
  },
  sunset_views: {
    "zh-TW": "日落觀景組合",
    en: "Sunset Views",
    ja: "夕日ビュー",
    ko: "일몰 전망 조합",
  },
  temple_culture: {
    "zh-TW": "寺廟文化組合",
    en: "Temple Culture",
    ja: "寺院文化",
    ko: "사찰 문화 조합",
  },
  classic_pagoda: {
    "zh-TW": "經典佛塔組合",
    en: "Classic Pagodas",
    ja: "定番パゴダ",
    ko: "클래식 불탑 조합",
  },
  landmark_walk: {
    "zh-TW": "經典地標組合",
    en: "Landmark Walk",
    ja: "ランドマーク散策",
    ko: "랜드마크 산책 조합",
  },
  culture_stroll: {
    "zh-TW": "文化散步組合",
    en: "Culture Stroll",
    ja: "文化さんぽ",
    ko: "문화 산책 조합",
  },
};

const ZH_TO_KEY: Record<string, string> = {
  舊城文化組合: "historic",
  藝文博物館組合: "culture",
  城市慢遊組合: "nature",
  海岸夕陽組合: "coast",
  咖啡散步組合: "cafe",
  人氣美食組合: "food",
  購物散策組合: "shopping",
  商圈市集組合: "market",
  經典景點組合: "attraction",
  經典地標組合: "landmark_walk",
  近郊自然組合: "suburb",
  近郊一日組合: "suburb",
  近郊放鬆組合: "suburb",
  海島放鬆組合: "coast",
  市區文化組合: "historic",
  自然風景組合: "suburb",
  在地美食組合: "food",
  佛塔古蹟巡禮: "temple_trail",
  日落觀景組合: "sunset_views",
  寺廟文化組合: "temple_culture",
  經典佛塔組合: "classic_pagoda",
  文化散步組合: "culture_stroll",
};

const MECHANICAL_TITLE_RE = /^推薦景點組合\s*\d+$/i;

/** Resolve a theme title for the effective App locale. */
export function combinationThemeTitle(
  themeKeyOrZhTitle: string,
  locale: Locale = effectiveAppLocale(),
): string {
  const trimmed = themeKeyOrZhTitle.trim();
  if (MECHANICAL_TITLE_RE.test(trimmed)) {
    return THEME_TITLES.attraction?.[locale] ?? THEME_TITLES.attraction!["zh-TW"];
  }
  const key =
    THEME_TITLES[trimmed]
      ? trimmed
      : ZH_TO_KEY[trimmed] ?? trimmed;
  const row = THEME_TITLES[key];
  if (row) return row[locale] ?? row["zh-TW"];
  return trimmed;
}

/** Localize a combination title that may already be zh-TW product copy. */
export function localizeCombinationThemeTitle(
  title: string,
  locale: Locale = effectiveAppLocale(),
): string {
  return combinationThemeTitle(title, locale);
}

export type ThemeTitlePlaceHint = {
  name?: string;
  localizedDisplayName?: string;
  types?: string[];
  primaryType?: string | null;
  normalizedCategory?: string;
};

/**
 * Derive a localized, content-aware title when the base theme title collides
 * or when a mechanical numbered title would otherwise be used.
 */
export function deriveCombinationThemeTitle(
  places: ThemeTitlePlaceHint[],
  opts?: {
    locale?: Locale;
    baseTitle?: string;
    usedTitles?: Set<string>;
    destinationLabel?: string;
  },
): string {
  const locale = opts?.locale ?? effectiveAppLocale();
  const used = opts?.usedTitles ?? new Set<string>();
  const blob = places
    .map((p) =>
      [p.localizedDisplayName, p.name, p.primaryType, ...(p.types ?? []), p.normalizedCategory]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ")
    .toLowerCase();

  const candidates: string[] = [];

  const templeScore =
    (blob.match(/temple|pagoda|stupa|佛塔|寺|廟|神社|shrine/g) ?? []).length;
  const sunsetScore =
    (blob.match(/sunset|viewpoint|viewing|觀景|夕陽|日落|mound|observation/g) ?? [])
      .length;
  const historicScore =
    (blob.match(/historic|ruin|古蹟|舊城|monument|palace|castle/g) ?? []).length;
  const museumScore =
    (blob.match(/museum|gallery|博物|美術/g) ?? []).length;

  if (templeScore >= 2) {
    candidates.push("temple_trail", "temple_culture", "classic_pagoda");
  }
  if (sunsetScore >= 2) {
    candidates.push("sunset_views", "coast");
  }
  if (historicScore >= 2) candidates.push("historic");
  if (museumScore >= 2) candidates.push("culture");
  candidates.push("landmark_walk", "culture_stroll", "attraction");

  if (opts?.baseTitle) {
    const base = localizeCombinationThemeTitle(opts.baseTitle, locale);
    if (!used.has(base) && !MECHANICAL_TITLE_RE.test(opts.baseTitle)) {
      return base;
    }
  }

  for (const key of candidates) {
    const title = combinationThemeTitle(key, locale);
    if (!used.has(title)) return title;
  }

  // Destination-flavored last resort — still never mechanical numbering.
  const dest = (opts?.destinationLabel ?? "").trim();
  if (dest && locale === "zh-TW") {
    const flavored = `${dest}經典景點組合`;
    if (!used.has(flavored)) return flavored;
    const walk = `${dest}文化散步組合`;
    if (!used.has(walk)) return walk;
  }

  return combinationThemeTitle("culture_stroll", locale);
}

export function isMechanicalCombinationTitle(title: string): boolean {
  return MECHANICAL_TITLE_RE.test(title.trim());
}
