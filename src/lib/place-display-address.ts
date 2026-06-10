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

/**
 * 修正 Google formattedAddress 常見異常（不自行拼接 postal/city/street）。
 * - 號號 → 號
 * - 尾端多餘「前」（非地址本體）
 */
export function sanitizeGooglePlaceAddress(text: string): string {
  let s = text.trim().replace(/\s+/g, " ");
  s = s.replace(/號{2,}/g, "號");
  if (/[號\d]\s*前$/u.test(s)) {
    s = s.replace(/\s*前$/u, "");
  }
  return s.trim();
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
  const ordered: Array<string | null | undefined> = [
    fields.formattedAddress,
    fields.formatted_address,
    fields.vicinity,
    fields.shortFormattedAddress,
  ];
  if (!options?.googleFieldsOnly) {
    ordered.push(fields.address);
  }

  for (const candidate of ordered) {
    const normalized = normalizePlaceAddressText(candidate);
    if (normalized) return sanitizeGooglePlaceAddress(normalized);
  }

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
  if (city && city !== "目前位置") return sanitizeGooglePlaceAddress(city);

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
