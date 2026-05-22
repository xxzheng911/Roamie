import type { Locale } from "@/lib/i18n/types";

const DEFAULTS: Record<Locale, { displayName: string; bio: string }> = {
  "zh-TW": { displayName: "旅人", bio: "慢慢的旅人" },
  en: { displayName: "Traveler", bio: "A gentle traveler" },
  ja: { displayName: "旅人", bio: "ゆっくり歩く旅人" },
  ko: { displayName: "여행자", bio: "천천히 걷는 여행자" },
};

export function getDefaultDisplayName(locale: Locale): string {
  return DEFAULTS[locale].displayName;
}

export function getDefaultBio(locale: Locale): string {
  return DEFAULTS[locale].bio;
}
