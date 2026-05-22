export type Locale = "zh-TW" | "en" | "ja" | "ko";

export const SUPPORTED_LOCALES: Locale[] = ["zh-TW", "en", "ja", "ko"];

export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
};
