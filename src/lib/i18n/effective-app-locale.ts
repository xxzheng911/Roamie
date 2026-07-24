/**
 * Single source of truth for App display / Places / combination language.
 *
 * Do NOT mix with: device region, destination country language,
 * Google Places default language, browser leftovers, or prior chat language.
 */
import { resolveLocaleSync } from "@/lib/i18n/resolve-locale";
import type { Locale } from "@/lib/i18n/types";

/** Current effective App locale (follows system language). */
export function effectiveAppLocale(): Locale {
  return resolveLocaleSync();
}
