import type { Locale } from "@/lib/i18n/types";

const HAS_CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

/** 常見英文 POI 名稱 → 繁中（Google 未回 zh-TW 時） */
const EN_PLACE_NAME_ZH: Record<string, string> = {
  "dry food market": "乾貨市場",
  "traditional market": "傳統市場",
  "wet market": "傳統市場",
  "night market": "夜市",
  "flea market": "跳蚤市場",
  "shopping mall": "購物中心",
  "department store": "百貨公司",
  "food court": "美食街",
};

const EN_PLACE_NAME_PATTERNS: Array<{ re: RegExp; zh: string }> = [
  { re: /dry\s*food\s*market/i, zh: "乾貨市場" },
  { re: /traditional\s*market/i, zh: "傳統市場" },
  { re: /wet\s*market/i, zh: "傳統市場" },
  { re: /night\s*market/i, zh: "夜市" },
  { re: /flea\s*market/i, zh: "跳蚤市場" },
];

/** 探索／地圖卡片：優先保留 Google 繁中名稱，英文則對照翻譯 */
export function localizePlaceDisplayName(name: string, locale: Locale = "zh-TW"): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "Unknown") return trimmed;
  if (locale !== "zh-TW" || HAS_CJK_RE.test(trimmed)) return trimmed;

  const lower = trimmed.toLowerCase();
  const exact = EN_PLACE_NAME_ZH[lower];
  if (exact) return exact;

  for (const { re, zh } of EN_PLACE_NAME_PATTERNS) {
    if (re.test(trimmed)) return zh;
  }

  return trimmed;
}
