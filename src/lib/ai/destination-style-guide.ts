import {
  isKnownCountryLabel,
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
} from "@/lib/ai/trip-planning-context";
import {
  buildDestinationCombinationSuggestionsReply,
  getDestinationCombinations,
  hasDestinationCombinations,
  isSuggestionInDestinationScope,
} from "@/lib/ai/destination-combination-suggestions";

export type DestinationStyleGuide = {
  styleOptions: string[];
  hotRoutes: string[];
  themeDescription: string;
  durationOptions?: string[];
};

const GUIDES: Record<string, DestinationStyleGuide> = {
  蒙古: {
    styleOptions: ["自然景觀草原", "戈壁沙漠", "文化歷史", "蒙古包體驗"],
    hotRoutes: [
      "烏蘭巴托",
      "特勒吉國家公園",
      "哈拉和林",
      "戈壁沙漠",
      "草原蒙古包體驗",
    ],
    themeDescription: "自然景觀、草原、沙漠和文化體驗",
    durationOptions: ["5～7 天", "8～10 天", "先幫我建議天數"],
  },
  日本: {
    styleOptions: ["經典景點", "美食咖啡", "動漫購物", "慢步調散策"],
    hotRoutes: ["東京", "京都", "大阪", "北海道", "沖繩"],
    themeDescription: "城市文化、美食、購物與自然風光",
    durationOptions: ["5 天", "7 天", "10 天"],
  },
  泰國: {
    styleOptions: ["城市探索", "美食按摩", "海島放鬆", "文化古蹟"],
    hotRoutes: ["曼谷", "清邁", "普吉島", "喀比", "蘇梅島"],
    themeDescription: "城市美食、按摩、海島與文化古蹟",
    durationOptions: ["4 天", "5 天", "7 天"],
  },
  韓國: {
    styleOptions: ["城市散策", "美食咖啡", "海景放鬆", "文化體驗"],
    hotRoutes: ["首爾", "釜山", "濟州島", "江原道", "慶州"],
    themeDescription: "城市散策、美食、海景與傳統文化",
    durationOptions: ["4 天", "5 天", "7 天"],
  },
};

const ANIME_FRIENDLY = new Set(["日本", "東京", "大阪", "京都", "橫濱", "名古屋", "福岡", "北海道", "沖繩"]);

const DEFAULT_GUIDE: DestinationStyleGuide = {
  styleOptions: ["經典景點", "美食文化", "自然風光", "慢步調散策"],
  hotRoutes: [],
  themeDescription: "文化、美食和自然風光",
  durationOptions: ["5 天", "7 天", "10 天"],
};

export function getDestinationStyleGuide(destination: string): DestinationStyleGuide {
  const label = normalizeDestinationLabel(destination);

  if (hasDestinationCombinations(label)) {
    const combos = getDestinationCombinations(label);
    return {
      styleOptions: combos.map((c) => c.title),
      hotRoutes: combos.flatMap((c) => c.places).filter((p) => isSuggestionInDestinationScope(p, label)),
      themeDescription: `${label}文化、美食與經典景點`,
      durationOptions: ["5 天", "7 天", "10 天"],
    };
  }

  if (GUIDES[label]) return GUIDES[label];

  if (ANIME_FRIENDLY.has(label)) {
    return GUIDES["日本"];
  }

  if (isKnownTouristCityLabel(label)) {
    return {
      styleOptions: ["經典景點", "美食文化", "商圈購物", "慢步調散策"],
      hotRoutes: [`${label}經典地標`, `${label}特色商圈`, `${label}在地美食`],
      themeDescription: `${label}文化、美食與經典景點`,
      durationOptions: ["5 天", "7 天", "10 天"],
    };
  }

  if (isKnownCountryLabel(label)) {
    return {
      ...DEFAULT_GUIDE,
      hotRoutes: [`${label}經典城市`, `${label}自然風光`, `${label}文化體驗`],
    };
  }

  return {
    ...DEFAULT_GUIDE,
    hotRoutes: [
      `${label}市中心`,
      `${label}經典景區`,
      `${label}周邊自然景點`,
    ],
  };
}

export function buildDestinationStyleChoiceQuestion(
  destination: string,
  opts?: { days?: number; month?: string },
): string {
  const label = normalizeDestinationLabel(destination);
  const guide = getDestinationStyleGuide(label);
  const daysLabel = opts?.days ? ` ${opts.days} 天` : "";
  const monthLabel = opts?.month ? `（${opts.month}）` : "";

  if (hasDestinationCombinations(label) && opts?.days) {
    const comboReply = buildDestinationCombinationSuggestionsReply(label, opts.days, {
      weatherLine: `好，我先幫你抓${label}${daysLabel}${monthLabel}的方向。`,
    });
    if (comboReply) return comboReply;
  }

  return [
    `好，我先幫你抓${label}${daysLabel}${monthLabel}的方向。`,
    "你想要偏向：",
    ...guide.styleOptions.map((option, index) => `${index + 1}. ${option}`),
    "",
    "也可以直接跟我說偏好，或回「都可以」讓我依建議組合安排。",
  ].join("\n");
}

export function buildDefaultRoutesReply(
  destination: string,
  country?: string,
): { reply: string; durationOptions: string[] } {
  const label = normalizeDestinationLabel(destination);
  const guide = getDestinationStyleGuide(label);

  if (hasDestinationCombinations(label)) {
    const days = 5;
    const comboReply =
      buildDestinationCombinationSuggestionsReply(label, days, {
        weatherLine: `如果都可以，我會依${label}的建議組合幫你抓方向。`,
      }) ?? "";
    return {
      reply: comboReply,
      durationOptions: guide.durationOptions ?? DEFAULT_GUIDE.durationOptions!,
    };
  }

  const routeList = guide.hotRoutes
    .filter((route) => isSuggestionInDestinationScope(route, label))
    .map((route, index) => `${index + 1}. ${route}`)
    .join("\n");

  return {
    reply: [
      `如果都可以，我會先用${label}經典熱門路線幫你抓方向。`,
      `${label}比較適合走${guide.themeDescription}：`,
      "",
      routeList,
      "",
      "你這趟大概想排幾天？我可以幫你抓 5～7 天或 8～10 天的節奏。",
    ].join("\n"),
    durationOptions: guide.durationOptions ?? DEFAULT_GUIDE.durationOptions!,
  };
}
