import { detectDeviceLocale } from "@/lib/i18n/detect-locale";
import type { Locale, LocalePreference } from "@/lib/i18n/types";

/** App UI 語言一律跟隨裝置系統語言 */
export function resolveLocaleSync(): Locale {
  return detectDeviceLocale();
}

export function resolveLocalePreferenceSync(): LocalePreference {
  return detectDeviceLocale();
}

export async function resolveLocaleAsync(): Promise<Locale> {
  return detectDeviceLocale();
}

export async function resolveLocalePreferenceAsync(): Promise<LocalePreference> {
  return detectDeviceLocale();
}

export function coerceLocale(value: string | null | undefined): Locale {
  return detectDeviceLocale();
}
