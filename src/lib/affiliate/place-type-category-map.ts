/** Roamie 中文類別 → Google Places type（affiliate / 篩選共用） */
export const PLACE_TYPE_CATEGORY_MAP: Record<string, string> = {
  景點: "tourist_attraction",
  景區: "tourist_attraction",
  地標: "landmark",
  展覽: "exhibition",
  展館: "exhibition",
  樂園: "theme_park",
  博物館: "museum",
  美術館: "art_gallery",
  水族館: "aquarium",
  動物園: "zoo",
  觀景台: "observation_deck",
  溫泉: "spa",
  神社: "place_of_worship",
  寺廟: "place_of_worship",
  教堂: "church",
  商圈: "district",
  市集: "market",
  體驗: "experience",
  文化體驗: "cultural_center",
  美食: "restaurant",
  餐廳: "restaurant",
  咖啡: "cafe",
  咖啡廳: "cafe",
  酒吧: "bar",
  住宿: "lodging",
  飯店: "lodging",
  酒店: "lodging",
  商店: "store",
  購物: "shopping_mall",
};

const EXCLUDED_CATEGORY_LABELS = new Set([
  "美食",
  "餐廳",
  "餐厅",
  "咖啡",
  "咖啡廳",
  "咖啡厅",
  "酒吧",
  "住宿",
  "飯店",
  "饭店",
  "酒店",
  "商店",
  "購物",
  "购物",
  "便利商店",
  "超商",
]);

export function mapPlaceLabelToGoogleType(label?: string | null): string | null {
  const raw = label?.trim();
  if (!raw) return null;
  return PLACE_TYPE_CATEGORY_MAP[raw] ?? PLACE_TYPE_CATEGORY_MAP[raw.toLowerCase()] ?? null;
}

export function isExcludedAffiliateCategory(label?: string | null): boolean {
  const raw = label?.trim();
  if (!raw) return false;
  if (EXCLUDED_CATEGORY_LABELS.has(raw)) return true;
  return /美食|餐廳|餐厅|咖啡|酒吧|住宿|飯店|饭店|酒店|商店|購物|购物|便利|超商/i.test(raw);
}

export function isAttractionAffiliateCategory(label?: string | null): boolean {
  const raw = label?.trim();
  if (!raw) return false;
  if (isExcludedAffiliateCategory(raw)) return false;
  return /景點|景區|地標|地标|展覽|展览|展館|樂園|乐园|博物|美術|美术|水族|動物|动物|觀景|观摩|體驗|体验|文化|神社|寺廟|寺庙|church|landmark|attraction/i.test(
    raw,
  );
}
