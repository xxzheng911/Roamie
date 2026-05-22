import { readStoredLocale, detectDeviceLocale, normalizeLocale } from "@/lib/i18n/detect-locale";
import { getProfileLanguage } from "@/lib/profile-storage";
import type { Locale } from "@/lib/i18n/types";

/** 同步：localStorage → 裝置 → zh-TW */
export function resolveLocaleSync(): Locale {
  return readStoredLocale() ?? detectDeviceLocale();
}

/** 非同步：個人檔案 language → localStorage → 裝置 → zh-TW */
export async function resolveLocaleAsync(): Promise<Locale> {
  try {
    const profileLang = await getProfileLanguage();
    if (profileLang) return profileLang;
  } catch {
    /* guest / offline */
  }
  return resolveLocaleSync();
}

export function coerceLocale(value: string | null | undefined): Locale {
  return normalizeLocale(value) ?? "zh-TW";
}
