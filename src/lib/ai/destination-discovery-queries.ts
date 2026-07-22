/**
 * Region-aware Places discovery queries.
 * Never append Taiwan-only suffixes (市老街 / 夜市 / …) to overseas cities.
 */
import { EN_CITY_NAMES } from "@/lib/ai/destination-geocode";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import { lookupStructuredCountryForCity } from "@/lib/ai/country-city-options";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { resolveDestinationCountryLabel } from "@/lib/ai/resolved-destination-scope";

export type DiscoveryRegionProfile =
  | "taiwan"
  | "cjk"
  | "europe"
  | "island"
  | "generic";

const EUROPE_COUNTRIES = new Set([
  "英國",
  "英国",
  "法國",
  "法国",
  "德國",
  "德国",
  "義大利",
  "意大利",
  "西班牙",
  "葡萄牙",
  "希臘",
  "希腊",
  "瑞士",
  "比利時",
  "比利时",
  "奧地利",
  "奥地利",
  "瑞典",
  "挪威",
  "丹麥",
  "丹麦",
  "芬蘭",
  "芬兰",
  "波蘭",
  "波兰",
  "捷克",
  "匈牙利",
  "愛爾蘭",
  "爱尔兰",
  "冰島",
  "冰岛",
  "荷蘭",
  "荷兰",
  "土耳其",
]);

const CJK_COUNTRIES = new Set([
  "日本",
  "韓國",
  "韩国",
  "中國",
  "中国",
  "香港",
  "澳門",
  "澳门",
]);

const ISLAND_COUNTRIES = new Set([
  "菲律賓",
  "菲律宾",
  "印尼",
  "印度尼西亞",
  "馬來西亞",
  "马来西亚",
  "泰國",
  "泰国",
]);

export function resolveDiscoveryRegionProfile(
  destination: string,
  countryHint?: string | null,
): DiscoveryRegionProfile {
  const label = normalizeDestinationLabel(destination);
  const entity = resolveDestinationEntity(label);
  const country =
    resolveDestinationCountryLabel(label, countryHint) ??
    entity.country ??
    lookupStructuredCountryForCity(label);

  if (country === "台灣" || country === "台湾") return "taiwan";
  if (entity.type === "island" || /(島|岛)$/.test(label)) return "island";
  if (country && ISLAND_COUNTRIES.has(country)) return "island";
  if (country && EUROPE_COUNTRIES.has(country)) return "europe";
  if (country && CJK_COUNTRIES.has(country)) return "cjk";
  return "generic";
}

export function buildDestinationSearchAreas(params: {
  destination: string;
  country?: string | null;
}): string[] {
  const label = normalizeDestinationLabel(params.destination);
  const profile = resolveDiscoveryRegionProfile(label, params.country);
  const en = EN_CITY_NAMES[label];
  const entity = resolveDestinationEntity(label);
  const country =
    resolveDestinationCountryLabel(label, params.country) ?? entity.country;

  if (profile === "taiwan") {
    return [...new Set([label, `${label}市`, `${label}縣`, `${label}島`].filter(Boolean))];
  }

  const areas = [label];
  if (en) {
    areas.push(en);
    if (country) {
      const countryEn =
        country === "英國" || country === "英国"
          ? "United Kingdom"
          : country === "法國" || country === "法国"
            ? "France"
            : country;
      areas.push(`${en}, ${countryEn}`);
    }
  }
  if (country) areas.push(`${label}, ${country}`);
  return [...new Set(areas.filter(Boolean))];
}

/**
 * Build text-search queries for combination discovery.
 * Taiwan keeps 老街/夜市 styles; Europe/elsewhere use place-type themes.
 */
export function buildDestinationDiscoveryQueries(params: {
  destination: string;
  country?: string | null;
  locale?: string;
  themes?: string[];
  area?: string;
}): string[] {
  const label = normalizeDestinationLabel(params.destination);
  const area = (params.area ?? label).trim() || label;
  const profile = resolveDiscoveryRegionProfile(label, params.country);
  const en = EN_CITY_NAMES[label];
  const enArea = area === label && en ? en : area;

  let queries: string[] = [];

  // Desert / sparse regions — widen to known gateways + natural features.
  if (label === "戈壁" || label === "戈壁沙漠" || /gobi/i.test(en ?? "")) {
    queries = [
      "Gobi Desert Mongolia attractions",
      "Gobi Desert national park",
      "Yolyn Am",
      "Dalanzadgad attractions",
      "Sainshand Mongolia",
      "戈壁沙漠 景點",
      "蒙古 戈壁 景點",
      `${enArea} desert`,
      `${enArea} national park`,
    ];
  } else if (profile === "taiwan") {
    queries = [
      `${area} 景點`,
      `${area} 必去`,
      `${area} 博物館`,
      `${area} 美術館`,
      `${area} 公園`,
      `${area} 夜市`,
      `${area} 老街`,
      `${area} tourist attractions`,
    ];
  } else if (profile === "europe") {
    queries = [
      `${enArea} tourist attractions`,
      `${enArea} historic landmark`,
      `${enArea} old town`,
      `${enArea} museum`,
      `${enArea} art gallery`,
      `${enArea} castle`,
      `${enArea} park`,
      `${enArea} market`,
      `${area} 景點`,
      `${area} 博物館`,
    ];
  } else if (profile === "island") {
    queries = [
      `${enArea} beach`,
      `${enArea} scenic spot`,
      `${enArea} nature reserve`,
      `${enArea} snorkeling`,
      `${enArea} tourist attractions`,
      `${area} 海灘`,
      `${area} 景點`,
      `${area} 自然`,
    ];
  } else if (profile === "cjk") {
    queries = [
      `${area} 景點`,
      `${area} 必去`,
      `${area} 博物館`,
      `${area} 美術館`,
      `${area} 公園`,
      `${enArea} tourist attractions`,
      `${enArea} museum`,
      `${enArea} park`,
    ];
  } else {
    queries = [
      `${enArea} tourist attractions`,
      `${enArea} museum`,
      `${enArea} park`,
      `${enArea} market`,
      `${area} 景點`,
      `${area} 博物館`,
      `${area} 公園`,
    ];
  }

  const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  logAiPipeline(
    "[DISCOVERY_QUERY_BUILT]",
    `destination=${label}`,
    `country=${params.country ?? "unknown"}`,
    `profile=${profile}`,
    `queries=[${unique.slice(0, 12).join("|")}]`,
  );
  return unique;
}

/** Theme directions for combination OPTIONS — titles + search queries only, never fake places. */
export type ThemeSearchDirection = {
  combinationId: number;
  title: string;
  themeKey: string;
  /** Keywords used only for Places search / logging — never render as place names. */
  searchKeywords: string[];
  queries: string[];
};

/**
 * Build 4 theme search directions from region profile.
 * Callers must resolve real Places before showing combinations.
 */
export function buildThemeSearchDirections(
  destination: string,
  countryHint?: string | null,
): ThemeSearchDirection[] {
  const label = normalizeDestinationLabel(destination);
  if (!label) return [];
  const country = resolveDestinationCountryLabel(label, countryHint);
  const profile = resolveDiscoveryRegionProfile(label, country);
  const en = EN_CITY_NAMES[label];
  const area = en ?? label;
  const zh = label;

  const byProfile: Record<
    DiscoveryRegionProfile,
    Array<Omit<ThemeSearchDirection, "combinationId" | "queries">>
  > = {
    island: [
      {
        title: "海島放鬆組合",
        themeKey: "coast",
        searchKeywords: ["beach", "island", "snorkeling", "waterfront"],
      },
      {
        title: "市區文化組合",
        themeKey: "historic",
        searchKeywords: ["historical landmark", "church", "museum", "market"],
      },
      {
        title: "人氣美食組合",
        themeKey: "food",
        searchKeywords: ["restaurant", "food market", "night market", "cafe"],
      },
      {
        title: "近郊自然組合",
        themeKey: "suburb",
        searchKeywords: ["waterfall", "mountain", "nature", "scenic spot"],
      },
    ],
    taiwan: [
      {
        title: "自然風景組合",
        themeKey: "nature",
        searchKeywords: ["公園", "步道", "自然風景", "park"],
      },
      {
        title: "人氣美食組合",
        themeKey: "food",
        searchKeywords: ["人氣餐廳", "在地小吃", "必吃美食", "夜市", "甜點"],
      },
      {
        title: "購物散策組合",
        themeKey: "shopping",
        searchKeywords: ["商圈", "百貨", "購物中心", "老街", "市場", "伴手禮"],
      },
      {
        title: "咖啡散步組合",
        themeKey: "cafe",
        searchKeywords: ["咖啡廳", "cafe", "甜點", "bakery"],
      },
    ],
    cjk: [
      {
        title: "經典地標組合",
        themeKey: "attraction",
        searchKeywords: ["tourist attractions", "landmark", "temple"],
      },
      {
        title: "人氣美食組合",
        themeKey: "food",
        searchKeywords: ["restaurant", "local food", "night market", "cafe"],
      },
      {
        title: "購物散策組合",
        themeKey: "shopping",
        searchKeywords: ["shopping street", "shopping mall", "market", "department store"],
      },
      {
        title: "近郊一日組合",
        themeKey: "suburb",
        searchKeywords: ["day trip", "nature", "hot spring"],
      },
    ],
    europe: [
      {
        title: "經典地標組合",
        themeKey: "historic",
        searchKeywords: ["landmark", "old town", "historic"],
      },
      {
        title: "在地美食組合",
        themeKey: "food",
        searchKeywords: ["restaurant", "cafe", "bakery", "food market"],
      },
      {
        title: "購物散策組合",
        themeKey: "shopping",
        searchKeywords: ["shopping street", "department store", "market", "boutique"],
      },
      {
        title: "近郊放鬆組合",
        themeKey: "suburb",
        searchKeywords: ["park", "garden", "day trip"],
      },
    ],
    generic: [
      {
        title: "經典景點組合",
        themeKey: "attraction",
        searchKeywords: ["tourist attractions", "landmark"],
      },
      {
        title: "人氣美食組合",
        themeKey: "food",
        searchKeywords: ["restaurant", "local food", "cafe", "market"],
      },
      {
        title: "購物散策組合",
        themeKey: "shopping",
        searchKeywords: ["shopping mall", "shopping street", "market", "department store"],
      },
      {
        title: "近郊自然組合",
        themeKey: "nature",
        searchKeywords: ["park", "nature", "trail"],
      },
    ],
  };

  const themes = byProfile[profile] ?? byProfile.generic;
  return themes.map((theme, index) => {
    const queries = [
      ...theme.searchKeywords.map((kw) => `${area} ${kw}`),
      ...theme.searchKeywords.slice(0, 2).map((kw) => `${zh} ${kw}`),
    ].filter(Boolean);
    logAiPipeline(
      "[THEME_FALLBACK_USED_FOR_SEARCH_ONLY]",
      `destination=${label}`,
      `theme=${theme.themeKey}`,
      `title=${theme.title}`,
    );
    return {
      combinationId: index + 1,
      title: theme.title,
      themeKey: theme.themeKey,
      searchKeywords: theme.searchKeywords,
      queries: [...new Set(queries)],
    };
  });
}
