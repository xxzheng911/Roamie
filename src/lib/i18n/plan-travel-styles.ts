import type { Locale } from "@/lib/i18n/types";

export type PlanTravelStyleCard = {
  id: string;
  label: string;
  suitableFor: string[];
};

const STYLES_ZH: PlanTravelStyleCard[] = [
  {
    id: "slow",
    label: "慢旅放空",
    suitableFor: ["散步", "咖啡廳", "海景", "療癒行程"],
  },
  {
    id: "food",
    label: "在地美食",
    suitableFor: ["小吃", "市場", "必吃餐廳", "美食探索"],
  },
  {
    id: "photo",
    label: "攝影打卡",
    suitableFor: ["熱門景點", "絕美景觀", "網美景點", "建築拍攝"],
  },
  {
    id: "literary",
    label: "文青探索",
    suitableFor: ["咖啡館", "書店", "老宅", "展覽"],
  },
  {
    id: "nature",
    label: "自然戶外",
    suitableFor: ["森林", "步道", "湖泊", "海岸", "瀑布"],
  },
  {
    id: "luxury",
    label: "豪華享受",
    suitableFor: ["五星飯店", "SPA", "景觀餐廳", "一泊二食"],
  },
  {
    id: "glamping",
    label: "豪華露營",
    suitableFor: ["Glamping", "露營車", "星空體驗", "營火活動"],
  },
  {
    id: "onsen",
    label: "溫泉療癒",
    suitableFor: ["溫泉旅館", "泡湯", "放鬆旅程"],
  },
  {
    id: "nightlife",
    label: "夜生活",
    suitableFor: ["夜景", "酒吧", "夜市", "深夜散步"],
  },
  {
    id: "family",
    label: "親子旅行",
    suitableFor: ["動物園", "樂園", "親子景點"],
  },
  {
    id: "art",
    label: "藝術展覽",
    suitableFor: ["美術館", "博物館", "展覽活動"],
  },
];

const STYLES_EN: PlanTravelStyleCard[] = [
  { id: "slow", label: "Slow travel", suitableFor: ["Walks", "Cafés", "Ocean views", "Wellness"] },
  { id: "food", label: "Local food", suitableFor: ["Street food", "Markets", "Must-eat spots"] },
  { id: "photo", label: "Photo spots", suitableFor: ["Landmarks", "Scenery", "Architecture"] },
  { id: "literary", label: "Arts & culture", suitableFor: ["Cafés", "Bookstores", "Heritage", "Exhibits"] },
  { id: "nature", label: "Outdoors", suitableFor: ["Forest", "Trails", "Lakes", "Coast"] },
  { id: "luxury", label: "Luxury", suitableFor: ["5-star hotels", "SPA", "Fine dining"] },
  { id: "glamping", label: "Glamping", suitableFor: ["Glamping", "Camper vans", "Stargazing"] },
  { id: "onsen", label: "Hot springs", suitableFor: ["Onsen hotels", "Soaking", "Relaxation"] },
  { id: "nightlife", label: "Nightlife", suitableFor: ["Night views", "Bars", "Night markets"] },
  { id: "family", label: "Family", suitableFor: ["Zoos", "Theme parks", "Kid-friendly"] },
  { id: "art", label: "Museums", suitableFor: ["Museums", "Galleries", "Exhibitions"] },
];

export function getPlanTravelStyleCards(locale: Locale): PlanTravelStyleCard[] {
  if (locale === "en") return STYLES_EN;
  if (locale === "ja" || locale === "ko") return STYLES_ZH;
  return STYLES_ZH;
}

export function resolveStyleLabelsFromIds(
  locale: Locale,
  selectedIds: string[],
): string[] {
  const cards = getPlanTravelStyleCards(locale);
  return selectedIds
    .map((id) => cards.find((c) => c.id === id)?.label)
    .filter((x): x is string => Boolean(x));
}
