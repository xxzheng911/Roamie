import type { Locale } from "@/lib/i18n/types";

export type PlaceAddressFields = {
  formattedAddress?: string | null;
  formatted_address?: string | null;
  shortFormattedAddress?: string | null;
  vicinity?: string | null;
  /** handoff / cache — detail 頁 googleFieldsOnly 時不使用 */
  address?: string | null;
};

const INVALID_LITERALS = new Set(["undefined", "null", "unknown", "—", "-"]);

/** 過濾空值、JSON 字串、undefined/null 字面量 */
export function normalizePlaceAddressText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (INVALID_LITERALS.has(lower)) return null;
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return null;
  }
  return trimmed;
}

const ZH_TW_ADDRESS_REPLACEMENTS: Array<[RegExp, string]> = [
  [/台湾/g, "台灣"],
  [/区/g, "區"],
  [/号/g, "號"],
  [/县/g, "縣"],
  [/乡/g, "鄉"],
  [/镇/g, "鎮"],
  [/楼/g, "樓"],
  [/东/g, "東"],
  [/广/g, "廣"],
  [/国/g, "國"],
  [/汇/g, "匯"],
  [/馆/g, "館"],
  [/场/g, "場"],
  [/层/g, "層"],
  [/园/g, "園"],
  [/庄/g, "莊"],
  [/岭/g, "嶺"],
  [/湾/g, "灣"],
  [/邮/g, "郵"],
];

/** Google 仍回少量簡體時，依 App locale 正規化地址用字（主要仍靠 API languageCode=zh-TW） */
export function normalizeAddressScriptForLocale(text: string, locale?: Locale): string {
  if (locale && locale !== "zh-TW") return text;
  let s = text;
  for (const [pattern, replacement] of ZH_TW_ADDRESS_REPLACEMENTS) {
    s = s.replace(pattern, replacement);
  }
  // 807台灣高雄市三民區三民區… → 合併連續重複的行政／路名片段
  s = s.replace(/([\u4e00-\u9fff\d]{2,10})\1+/g, "$1");
  return s;
}

// Valid short/full Plus Code alphabet; do not consume alphanumeric street names or 門牌.
const PLUS_CODE = /(?<![a-z0-9])(?:[23456789CFGHJMPQRVWX]{2}){1,4}\+[23456789CFGHJMPQRVWX]{2,3}(?![a-z0-9]|號|巷|弄)/gi;

function stripDisplayPlusCode(text: string): string {
  const withoutCode = text.replace(PLUS_CODE, "");
  if (withoutCode === text) return text;
  return withoutCode
    // Only remove a Taiwan postal prefix when an explicit city/county follows.
    .replace(/^\s*\d{3}(?:\d{2,3})?\s*(?=(?:台灣|臺灣|台湾)?[\u4e00-\u9fff]{2,3}[市縣县])/, "")
    .replace(/^[\s,，]+|[\s,，]+$/g, "")
    .replace(/\s*[,，]\s*[,，]\s*/g, ", ")
    .trim();
}

/**
 * 修正 Google formattedAddress 常見異常（不自行拼接 postal/city/street）。
 * - 號號 → 號
 * - 尾端多餘「前」（非地址本體）
 */
export function sanitizeGooglePlaceAddress(text: string, locale?: Locale): string {
  let s = stripDisplayPlusCode(text).replace(/\s+/g, " ");
  s = s.replace(/號{2,}/g, "號");
  if (/[號\d]\s*前$/u.test(s)) {
    s = s.replace(/\s*前$/u, "");
  }
  s = s.trim();
  return normalizeAddressScriptForLocale(s, locale);
}

/**
 * Google Places 地址顯示優先序（僅 API 欄位；不依 AI / 天氣 city 覆寫）。
 * 1) formattedAddress / formatted_address
 * 2) vicinity
 * 3) shortFormattedAddress
 * 4) address（handoff / cache，googleFieldsOnly 時略過）
 */
export function resolvePlaceDisplayAddress(
  fields: PlaceAddressFields,
  options?: {
    fallbackCity?: string | null;
    hasCoords?: boolean;
    locale?: Locale;
    /** 詳情頁：只用 Google API 欄位，不用 handoff cache */
    googleFieldsOnly?: boolean;
  },
): string | null {
  const locale = options?.locale ?? "zh-TW";
  const ordered: Array<string | null | undefined> = [
    fields.formattedAddress,
    fields.formatted_address,
    fields.vicinity,
    fields.shortFormattedAddress,
  ];
  if (!options?.googleFieldsOnly) {
    ordered.push(fields.address);
  }

  let codeAreaFallback: string | null = null;
  for (const candidate of ordered) {
    const normalized = normalizePlaceAddressText(candidate);
    if (!normalized) continue;
    const display = sanitizeGooglePlaceAddress(normalized, locale);
    if (!display) continue;
    if (stripDisplayPlusCode(normalized) === normalized) return display;
    codeAreaFallback ??= display;
  }
  if (codeAreaFallback) return codeAreaFallback;

  if (options?.googleFieldsOnly) {
    if (options.hasCoords) {
      return options?.locale === "en"
        ? "Near your location"
        : options?.locale === "ja"
          ? "現在地付近"
          : options?.locale === "ko"
            ? "현재 위치 근처"
            : "目前位置附近";
    }
    return null;
  }

  const city = normalizePlaceAddressText(options?.fallbackCity);
  if (city && city !== "目前位置") {
    const display = sanitizeGooglePlaceAddress(city, locale);
    if (display) return display;
  }

  if (options?.hasCoords) {
    return options?.locale === "en"
      ? "Near your location"
      : options?.locale === "ja"
        ? "現在地付近"
        : options?.locale === "ko"
          ? "현재 위치 근처"
          : "目前位置附近";
  }

  return null;
}
