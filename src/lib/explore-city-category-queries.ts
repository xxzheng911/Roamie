import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { cityCategoryTextQueries } from "@/lib/explore-recommend-mode";

/** 城市 text search 用的英文地名 */
export const CITY_EN_QUERY_NAMES: Record<string, string> = {
  東京: "Tokyo",
  大阪: "Osaka",
  京都: "Kyoto",
  首爾: "Seoul",
  曼谷: "Bangkok",
  巴黎: "Paris",
  墨爾本: "Melbourne",
  紐約: "New York",
  倫敦: "London",
  雪梨: "Sydney",
  台北: "Taipei",
  高雄: "Kaohsiung",
  清邁: "Chiang Mai",
};

/** 各城市 × 分類的額外 fallback query（依序嘗試） */
export const CITY_CATEGORY_EXTRA_QUERIES: Record<
  string,
  Partial<Record<string, string[]>>
> = {
  東京: {
    sight: ["Tokyo Skytree", "Senso-ji Temple Tokyo", "Meiji Shrine Tokyo", "東京 観光"],
    coffee: ["Tokyo specialty coffee", "Shibuya cafe Tokyo", "東京 カフェ"],
    district: ["Shibuya Tokyo", "Ginza Tokyo", "Akihabara Tokyo", "東京 ショッピング"],
    food: [
      "東京 レストラン",
      "東京 グルメ",
      "東京 ラーメン",
      "Tokyo ramen",
      "Tsukiji restaurants Tokyo",
    ],
    night: ["Shinjuku nightlife Tokyo", "Golden Gai Tokyo", "東京 ナイト"],
  },
  大阪: {
    sight: ["Osaka Castle", "Dotonbori Osaka", "大阪 観光"],
    coffee: ["Osaka cafe", "Dotonbori cafe"],
    district: ["Dotonbori Osaka", "Shinsaibashi Osaka", "大阪 ショッピング"],
    food: ["Dotonbori restaurants Osaka", "Osaka takoyaki", "大阪 グルメ"],
    night: ["Dotonbori nightlife Osaka", "大阪 ナイト"],
  },
  首爾: {
    sight: ["Gyeongbokgung Seoul", "N Seoul Tower", "首爾 観光"],
    coffee: ["Seoul specialty coffee", "Myeongdong cafe Seoul"],
    district: ["Myeongdong Seoul", "Hongdae Seoul", "首爾 ショッピング"],
    food: ["Myeongdong restaurants Seoul", "Korean BBQ Seoul", "首爾 グルメ"],
    night: ["Hongdae nightlife Seoul", "Itaewon bars Seoul"],
  },
  曼谷: {
    sight: ["Grand Palace Bangkok", "Wat Arun Bangkok", "Bangkok temples"],
    coffee: ["Bangkok specialty coffee", "Siam cafe Bangkok"],
    district: ["Chatuchak Market Bangkok", "Siam Paragon Bangkok", "Bangkok shopping mall"],
    food: ["Bangkok street food", "Chinatown Bangkok restaurants", "Bangkok local food"],
    night: ["Khao San Road Bangkok", "Bangkok rooftop bar", "Bangkok night market"],
  },
  巴黎: {
    sight: ["Eiffel Tower Paris", "Louvre Museum Paris", "Notre Dame Paris"],
    coffee: ["Paris specialty coffee", "Le Marais cafe Paris"],
    district: ["Champs-Élysées Paris", "Galeries Lafayette Paris", "Paris shopping street"],
    food: ["Paris bistro", "Paris restaurants", "French cuisine Paris"],
    night: ["Montmartre nightlife Paris", "Paris night view", "Seine river night Paris"],
  },
  墨爾本: {
    sight: ["Federation Square Melbourne", "Royal Botanic Gardens Melbourne"],
    coffee: ["Melbourne specialty coffee", "Melbourne laneway cafe"],
    district: ["Chadstone Melbourne", "Queen Victoria Market Melbourne"],
    food: ["Melbourne restaurants", "Lygon Street Melbourne food"],
    night: ["Melbourne nightlife", "Southbank Melbourne bars"],
  },
  紐約: {
    sight: ["Statue of Liberty New York", "Central Park New York", "Times Square New York"],
    coffee: ["New York specialty coffee", "Brooklyn cafe New York"],
    district: ["Fifth Avenue New York", "SoHo New York shopping"],
    food: ["New York pizza", "New York restaurants", "Manhattan food"],
    night: ["Times Square night New York", "Brooklyn nightlife New York"],
  },
};

export function resolveCityEnglishQueryName(cityLabel: string): string {
  const city = normalizeDestinationLabel(cityLabel.trim());
  return CITY_EN_QUERY_NAMES[city] ?? city;
}

function buildCategoryEnglishFallbackQueries(categoryId: string, enName: string): string[] {
  switch (categoryId) {
    case "sight":
      return [
        `${enName} tourist attractions`,
        `${enName} landmarks`,
        `${enName} museums`,
        `${enName} parks`,
        `${enName} things to do`,
      ];
    case "coffee":
      return [
        `${enName} cafe`,
        `${enName} coffee shop`,
        `${enName} specialty coffee`,
      ];
    case "district":
      return [
        `${enName} shopping mall`,
        `${enName} department store`,
        `${enName} shopping street`,
        `${enName} market`,
      ];
    case "food":
      return [
        `${enName} restaurants`,
        `${enName} food`,
        `${enName} local food`,
        `${enName} ramen`,
        `${enName} best restaurants`,
      ];
    case "night":
      return [
        `${enName} nightlife`,
        `${enName} bar`,
        `${enName} izakaya`,
        `${enName} night market`,
        `${enName} night view`,
      ];
    default:
      return [];
  }
}

/** 城市模式：完整分類 query fallback 清單（依序嘗試） */
export function buildCityCategoryFetchQueries(
  categoryId: string,
  cityLabel: string,
  options?: { popularQueries?: string[] },
): string[] {
  const label = normalizeDestinationLabel(cityLabel.trim());
  if (!label || categoryId === "all") return [];

  const en = resolveCityEnglishQueryName(label);
  const extras = CITY_CATEGORY_EXTRA_QUERIES[label]?.[categoryId] ?? [];
  const base = cityCategoryTextQueries(categoryId, label);
  const enFallback = buildCategoryEnglishFallbackQueries(categoryId, en);
  const popular = options?.popularQueries ?? [];

  if (categoryId === "sight") {
    return [...new Set([...extras, ...popular, ...base, ...enFallback])];
  }

  return [...new Set([...extras, ...base, ...enFallback])];
}
