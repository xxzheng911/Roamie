import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeRecommendationItem } from "@/lib/ai/types";
import {
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
} from "@/lib/ai/trip-planning-context";

export type DestinationCombination = {
  title: string;
  places: string[];
};

type DestinationCombinationGuide = {
  country: string;
  combinations: DestinationCombination[];
};

const DESTINATION_COMBINATIONS: Record<string, DestinationCombinationGuide> = {
  首爾: {
    country: "韓國",
    combinations: [
      { title: "經典首爾組合", places: ["景福宮", "北村韓屋村", "仁寺洞", "光化門"] },
      { title: "年輕商圈組合", places: ["弘大", "梨大", "聖水洞", "延南洞"] },
      { title: "購物美食組合", places: ["明洞", "東大門", "廣藏市場", "樂天世界塔"] },
      { title: "夜景放鬆組合", places: ["南山首爾塔", "漢江", "汝矣島"] },
      { title: "近郊備案", places: ["水原華城", "南怡島", "坡州"] },
    ],
  },
  東京: {
    country: "日本",
    combinations: [
      { title: "經典東京組合", places: ["淺草寺", "東京晴空塔", "上野公園", "阿美橫町"] },
      { title: "時尚商圈組合", places: ["澀谷十字路口", "原宿", "表參道", "新宿"] },
      { title: "文化歷史組合", places: ["明治神宮", "皇居外苑", "日本橋", "東京站"] },
      { title: "夜景地標組合", places: ["東京塔", "六本木", "台場", "東京灣"] },
      { title: "近郊備案", places: ["鎌倉", "箱根", "橫濱"] },
    ],
  },
  大阪: {
    country: "日本",
    combinations: [
      { title: "經典大阪組合", places: ["大阪城", "道頓堀", "心齋橋", "黑門市場"] },
      { title: "美食探索組合", places: ["新世界", "通天閣", "難波", "美國村"] },
      { title: "親子娛樂組合", places: ["環球影城", "海遊館", "天保山"] },
      { title: "近郊備案", places: ["奈良", "京都", "神戶"] },
    ],
  },
  京都: {
    country: "日本",
    combinations: [
      { title: "經典京都組合", places: ["清水寺", "伏見稻荷大社", "祇園", "八坂神社"] },
      { title: "竹林禪意組合", places: ["嵐山", "竹林小徑", "天龍寺", "渡月橋"] },
      { title: "金閣銀閣組合", places: ["金閣寺", "銀閣寺", "哲學之道", "南禪寺"] },
      { title: "近郊備案", places: ["宇治", "奈良", "大阪"] },
    ],
  },
  台東: {
    country: "台灣",
    combinations: [
      { title: "海岸公路組合", places: ["多良車站", "小野柳", "加路蘭", "三仙台"] },
      { title: "市區文化組合", places: ["鐵花村", "台東森林公園", "卑南遺址", "台東觀光夜市"] },
      { title: "縱谷慢旅組合", places: ["池上", "伯朗大道", "鹿野高台", "初鹿牧場"] },
      { title: "離島備案", places: ["綠島", "蘭嶼"] },
    ],
  },
  曼谷: {
    country: "泰國",
    combinations: [
      { title: "經典曼谷組合", places: ["大皇宮", "玉佛寺", "鄭王廟", "臥佛寺"] },
      { title: "市集購物組合", places: ["恰圖恰市集", "ICONSIAM", "暹羅商圈", "CentralWorld"] },
      { title: "夜生活組合", places: ["喬德夜市", "考山路", "Asiatique", "湄南河"] },
      { title: "近郊備案", places: ["水上市場", "美功鐵道市場", "大城"] },
    ],
  },
};

/** 已知目的地時，禁止出現的其他城市／錯誤模板關鍵字 */
const REJECTED_SCOPE_MARKERS: Record<string, readonly string[]> = {
  首爾: ["東京", "京都", "大阪", "台北", "臺北", "象山", "九份", "夜市模板", "信義區"],
  東京: ["首爾", "台北", "臺北", "象山", "高雄", "台中", "臺中"],
  大阪: ["首爾", "台北", "臺北", "象山", "曼谷"],
  京都: ["首爾", "台北", "臺北", "象山", "曼谷"],
  台東: ["東京", "京都", "大阪", "首爾", "象山", "台北101"],
  臺東: ["東京", "京都", "大阪", "首爾", "象山", "台北101"],
};

const GLOBAL_CITY_LIST_RE =
  /^(東京|京都|大阪|首爾|台北|臺北|曼谷|高雄|台中|臺中)(、|,|\s|$)/;

function resolveCombinationGuide(destination: string): DestinationCombinationGuide | null {
  const label = normalizeDestinationLabel(destination.trim());
  if (DESTINATION_COMBINATIONS[label]) return DESTINATION_COMBINATIONS[label];

  if (label.includes("首爾")) return DESTINATION_COMBINATIONS["首爾"] ?? null;
  if (label.includes("東京")) return DESTINATION_COMBINATIONS["東京"] ?? null;
  if (label.includes("大阪")) return DESTINATION_COMBINATIONS["大阪"] ?? null;
  if (label.includes("京都")) return DESTINATION_COMBINATIONS["京都"] ?? null;
  if (label.includes("台東") || label.includes("臺東")) {
    return DESTINATION_COMBINATIONS["台東"] ?? null;
  }
  if (label.includes("曼谷")) return DESTINATION_COMBINATIONS["曼谷"] ?? null;

  return null;
}

export function hasDestinationCombinations(destination: string): boolean {
  return resolveCombinationGuide(destination) != null;
}

export function logChatDestinationScopeLock(destination: string): void {
  console.info("[CHAT_DESTINATION_SCOPE_LOCK]", `destination=${normalizeDestinationLabel(destination)}`);
}

export function isSuggestionInDestinationScope(
  suggestionText: string,
  destination: string,
): boolean {
  const label = normalizeDestinationLabel(destination);
  const text = suggestionText.trim();
  if (!text) return false;

  const rejected = REJECTED_SCOPE_MARKERS[label] ?? [];
  for (const marker of rejected) {
    if (text.includes(marker)) {
      console.info(
        "[CHAT_WRONG_CITY_SUGGESTION_REJECTED]",
        `destination=${label}`,
        `suggestion=${text.slice(0, 40)}`,
        `marker=${marker}`,
      );
      return false;
    }
  }

  if (isKnownTouristCityLabel(label) && GLOBAL_CITY_LIST_RE.test(text)) {
    console.info(
      "[CHAT_WRONG_CITY_SUGGESTION_REJECTED]",
      `destination=${label}`,
      `reason=global_city_list`,
      `suggestion=${text.slice(0, 40)}`,
    );
    return false;
  }

  return true;
}

export function filterSuggestionsByDestinationScope<T extends { name?: string; placeName?: string }>(
  suggestions: T[],
  destination: string,
): T[] {
  logChatDestinationScopeLock(destination);
  return suggestions.filter((item) => {
    const name = (item.placeName ?? item.name ?? "").trim();
    if (!name) return false;
    return isSuggestionInDestinationScope(name, destination);
  });
}

export function getDestinationCombinations(destination: string): DestinationCombination[] {
  const guide = resolveCombinationGuide(destination);
  if (!guide) return [];
  return guide.combinations.filter((combo) =>
    combo.places.every((place) => isSuggestionInDestinationScope(place, destination)),
  );
}

export function flattenDestinationCombinationPlaces(destination: string): string[] {
  const combos = getDestinationCombinations(destination);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const combo of combos) {
    for (const place of combo.places) {
      if (!seen.has(place) && isSuggestionInDestinationScope(place, destination)) {
        seen.add(place);
        out.push(place);
      }
    }
  }
  return out;
}

export function buildDestinationCombinationSuggestionsReply(
  destination: string,
  days: number,
  opts?: { startDate?: string; weatherLine?: string | null },
): string | null {
  const label = normalizeDestinationLabel(destination);
  const combos = getDestinationCombinations(label);
  if (!combos.length) return null;

  logChatDestinationScopeLock(label);

  const header = [
    opts?.weatherLine?.trim() || `好，我先記下 ${label} ${days} 天行程方向。`,
    "",
    `以下是${label}的建議組合搭配，你可以選一組或多組混搭：`,
    "",
    ...combos.map((combo, index) => `${index + 1}. ${combo.title}：${combo.places.join("、")}`),
    "",
    ...(opts?.startDate ? [`出發：${opts.startDate}`, ""] : []),
    "想直接排完整行程，回「幫我排」或「都可以」；想先看必去點也可以跟我說。",
  ];

  return header.join("\n");
}

export function buildCombinationRecommendations(destination: string): RoamieRecommendationItem[] {
  const label = normalizeDestinationLabel(destination);
  const combos = getDestinationCombinations(label);
  const items: RoamieRecommendationItem[] = [];

  for (const combo of combos) {
    for (const place of combo.places) {
      if (!isSuggestionInDestinationScope(place, label)) continue;
      items.push(
        normalizeRecommendationItem({
          name: place,
          placeName: place,
          type: "景點",
          description: `${combo.title}推薦`,
          reason: `${combo.title}推薦`,
          reasonSource: "template",
          estimatedTime: "1-2 小時",
          address: label,
        }),
      );
    }
  }

  return items;
}

/** 組合推薦失敗時，退回 flatten 後的簡單 destination suggestions */
export function buildSafeCombinationRecommendations(destination: string): RoamieRecommendationItem[] {
  try {
    return buildCombinationRecommendations(destination);
  } catch (error) {
    console.warn(
      "[CHAT_COMBINATION_RECOMMENDATIONS_FALLBACK]",
      error instanceof Error ? error.message : String(error),
    );
    const label = normalizeDestinationLabel(destination);
    return flattenDestinationCombinationPlaces(label).map((place) =>
      normalizeRecommendationItem({
        name: place,
        placeName: place,
        type: "景點",
        description: "建議組合",
        reason: "建議組合",
        reasonSource: "template",
        estimatedTime: "1-2 小時",
        address: label,
      }),
    );
  }
}

export function hasDestinationPlanningBasics(ctx: {
  destination?: string;
  days?: number;
  startDate?: string;
}): boolean {
  return Boolean(ctx.destination?.trim() && ctx.days && ctx.days > 0);
}
