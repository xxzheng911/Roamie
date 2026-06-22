import type { Locale, LocalePreference } from "@/lib/i18n/types";

export function detectDeviceLocale(): Locale {
  if (typeof navigator === "undefined") return "zh-TW";
  const lang = (navigator.language || "zh-TW").toLowerCase();
  if (lang.startsWith("zh-hans") || lang === "zh-cn") return "en";
  if (lang.startsWith("zh")) return "zh-TW";
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("ko")) return "ko";
  return "en";
}

export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  if (value === "system") return null;
  if (value === "zh-Hans" || value === "zh-CN" || value === "zh-cn") return "en";
  if (value === "zh-TW" || value === "zh" || value === "zh-Hant") return "zh-TW";
  if (value === "en" || value.startsWith("en")) return "en";
  if (value === "ja" || value.startsWith("ja")) return "ja";
  if (value === "ko" || value.startsWith("ko")) return "ko";
  return null;
}

export function coerceLocalePreference(value: string | null | undefined): LocalePreference {
  if (value === "system") return "system";
  return normalizeLocale(value) ?? "zh-TW";
}

export function resolveLocaleFromPreference(preference: LocalePreference): Locale {
  if (preference === "system") return detectDeviceLocale();
  return preference;
}

export const LOCALE_STORAGE_KEY = "roamie:locale";
export const LOCALE_PREFERENCE_KEY = "roamie:locale-preference";

export function readLocalePreference(): LocalePreference | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCALE_PREFERENCE_KEY);
    if (raw === "system") return "system";
    return normalizeLocale(raw);
  } catch {
    return null;
  }
}

export function writeLocalePreference(_preference: LocalePreference): void {
  /* App 語言跟隨裝置，不再寫入 localStorage */
}

export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return normalizeLocale(raw);
  } catch {
    return null;
  }
}

export function writeStoredLocale(_locale: Locale): void {
  /* App 語言跟隨裝置，不再寫入 localStorage */
}

/** 清除舊版 App 內語言覆寫（升級後僅跟隨系統） */
export function clearStoredLocaleOverrides(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LOCALE_PREFERENCE_KEY);
    localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
