import type { Locale } from "@/lib/i18n/types";

/** Google Places / Geocoding languageCode — 依使用者語言，不依所在地 */
export function localeToGoogleLanguageCode(locale: Locale): string {
  switch (locale) {
    case "en":
      return "en";
    case "ja":
      return "ja";
    case "ko":
      return "ko";
    case "zh-TW":
    default:
      return "zh-TW";
  }
}

export function localeToGeocodeRegion(locale: Locale): string | undefined {
  switch (locale) {
    case "zh-TW":
      return "tw";
    case "ja":
      return "jp";
    case "ko":
      return "kr";
    case "en":
      return undefined;
    default:
      return undefined;
  }
}
