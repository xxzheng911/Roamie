import type { Locale } from "@/lib/i18n/types";

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
  if (value === "zh-Hans" || value === "zh-CN" || value === "zh-cn") return "en";
  if (value === "zh-TW" || value === "zh" || value === "zh-Hant") return "zh-TW";
  if (value === "en" || value.startsWith("en")) return "en";
  if (value === "ja" || value.startsWith("ja")) return "ja";
  if (value === "ko" || value.startsWith("ko")) return "ko";
  return null;
}

export const LOCALE_STORAGE_KEY = "roamie:locale";

export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return normalizeLocale(raw);
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}
