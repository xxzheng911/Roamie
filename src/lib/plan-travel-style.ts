import type { RecommendationCategoryId } from "@/lib/recommendation/types";

/** 規劃表單旅遊風格（zh-TW 主鍵；其他語系選項需能對應到此集合） */
export const PLAN_TRAVEL_STYLE_ZH = [
  "美食探索",
  "文青咖啡",
  "自然戶外",
  "城市漫遊",
  "藝術展覽",
  "文化體驗",
  "親子同遊",
  "露營野遊",
] as const;

export type PlanTravelStyleZh = (typeof PLAN_TRAVEL_STYLE_ZH)[number];

type StyleProfile = {
  searchQueries: string[];
  categoryBoost: RecommendationCategoryId[];
  aiHints: string[];
};

const STYLE_PROFILES: Record<PlanTravelStyleZh, StyleProfile> = {
  美食探索: {
    searchQueries: [
      "在地特色美食",
      "夜市 小吃",
      "特色餐廳",
      "燒肉",
      "壽司",
      "火鍋",
      "甜點",
      "宵夜",
    ],
    categoryBoost: ["food", "district"],
    aiHints: [
      "優先 Google 評論數高、評分 ≥ 4.5 的餐廳",
      "涵蓋夜市、小吃、特色餐廳、燒肉、壽司、火鍋、甜點、宵夜等，避免只推同類型",
      "保持類型多樣性，不要連續推薦同一種料理",
    ],
  },
  文青咖啡: {
    searchQueries: ["特色咖啡廳", "老宅咖啡", "景觀咖啡", "文創市集", "選物空間", "藝文空間"],
    categoryBoost: ["coffee", "sight", "district"],
    aiHints: [
      "特色咖啡廳、老宅咖啡、景觀咖啡、文創市集、選物空間、藝文空間",
      "不需要特別推薦書店",
    ],
  },
  自然戶外: {
    searchQueries: ["海邊", "湖泊", "山林", "森林", "瀑布", "步道", "自然景觀"],
    categoryBoost: ["park", "sight", "walking"],
    aiHints: ["海邊、湖泊、山林、森林、瀑布、步道、自然景觀"],
  },
  城市漫遊: {
    searchQueries: ["商圈", "百貨公司", "夜市", "市集", "街區散策"],
    categoryBoost: ["district", "food", "walking"],
    aiHints: ["商圈、百貨、夜市、一般市集、街區散策；不包含文創市集（避免與文青咖啡重疊）"],
  },
  藝術展覽: {
    searchQueries: ["美術館", "特展", "藝術空間", "攝影展", "展覽館"],
    categoryBoost: ["sight", "indoor", "photo"],
    aiHints: ["美術館、特展、藝術空間、攝影展、展覽館"],
  },
  文化體驗: {
    searchQueries: ["古蹟", "歷史建築", "老街", "傳統聚落", "地方文化景點"],
    categoryBoost: ["sight", "walking", "district"],
    aiHints: ["古蹟、歷史建築、老街、傳統聚落、地方文化景點"],
  },
  親子同遊: {
    searchQueries: ["動物園", "農場", "親子樂園", "親子館", "互動體驗館"],
    categoryBoost: ["sight", "park", "indoor"],
    aiHints: ["動物園、農場、親子樂園、親子館、互動體驗館"],
  },
  露營野遊: {
    searchQueries: ["露營區", "車宿", "野營", "觀星", "戶外基地"],
    categoryBoost: ["park", "sight", "walking"],
    aiHints: ["露營區、車宿、野營、觀星、戶外基地"],
  },
};

/** 將表單選項（任意語系標籤）正規化為 zh-TW 主鍵 */
export function normalizePlanTravelStyles(
  styles: string[],
  localeStyleOptions: string[],
): PlanTravelStyleZh[] {
  const out: PlanTravelStyleZh[] = [];
  for (const s of styles) {
    const idx = localeStyleOptions.indexOf(s);
    if (idx >= 0 && idx < PLAN_TRAVEL_STYLE_ZH.length) {
      out.push(PLAN_TRAVEL_STYLE_ZH[idx]);
      continue;
    }
    if ((PLAN_TRAVEL_STYLE_ZH as readonly string[]).includes(s)) {
      out.push(s as PlanTravelStyleZh);
    }
  }
  return [...new Set(out)];
}

export function buildTravelStyleAiContext(styles: PlanTravelStyleZh[]): string {
  if (!styles.length) return "";
  const lines = ["【旅遊風格推薦邏輯】"];
  for (const style of styles) {
    const profile = STYLE_PROFILES[style];
    lines.push(`- ${style}：${profile.aiHints.join("；")}`);
    lines.push(`  搜尋關鍵字參考：${profile.searchQueries.join("、")}`);
  }
  lines.push("- 推薦地點必須為 Google Places 可查的真實地點");
  lines.push("- 依使用者選擇的風格、心情、交通方式、天數與目的地推薦");
  lines.push("- 不要一進聊天就直接輸出完整多日行程；先推薦 3 個左右，維持對話感");
  return lines.join("\n");
}

export function styleCategoryBoosts(styles: PlanTravelStyleZh[]): RecommendationCategoryId[] {
  const set = new Set<RecommendationCategoryId>();
  for (const s of styles) {
    for (const id of STYLE_PROFILES[s].categoryBoost) set.add(id);
  }
  return [...set];
}

export function styleSearchQueries(styles: PlanTravelStyleZh[]): string[] {
  const set = new Set<string>();
  for (const s of styles) {
    for (const q of STYLE_PROFILES[s].searchQueries) set.add(q);
  }
  return [...set];
}
