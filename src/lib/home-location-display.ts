import { REGION_NODES } from "@/lib/ai/region-adjacency/graph";
import type { Locale } from "@/lib/i18n/types";
import { translate } from "@/lib/i18n/translate";

const CURRENT_LOCATION_KEY = "uiCoverage.weatherCurrentLocation";
const LOCALES = ["zh-TW", "en", "ja", "ko"] as const;
const LOCAL_SCRIPT =
  /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Exact legacy / localized sentinel. Substring matches such as 目前位置咖啡館 stay place names. */
export function isCurrentLocationSentinel(value: string): boolean {
  const label = value.trim();
  return LOCALES.some((locale) => label === translate(locale, CURRENT_LOCATION_KEY));
}

export function localizedCurrentLocationLabel(locale: Locale): string {
  return translate(locale, CURRENT_LOCATION_KEY);
}

function latinLocalityToken(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Latin labels are displayable only when they match a known city or district.
 * OpenWeather `name` and raw reverse-geocode localities (for example a GeoNames
 * populated place) are not confirmed just because they are non-empty.
 */
function isConfirmedLatinLocality(label: string): boolean {
  const token = latinLocalityToken(label);
  if (!token || /\d/.test(token)) return false;
  const padded = ` ${token} `;
  for (const node of REGION_NODES) {
    const labels = [
      node.id,
      ...(node.aliases ?? []),
      node.adminArea,
      ...(node.administrativeAliases ?? []),
      ...(node.districtAliases ?? []),
    ];
    for (const raw of labels) {
      if (!raw || LOCAL_SCRIPT.test(raw)) continue;
      const alias = latinLocalityToken(raw);
      if (!alias) continue;
      if (token === alias || padded.includes(` ${alias} `)) return true;
    }
  }
  return false;
}

/** City / district a traveler can read. Unconfirmed geocoder tokens are not. */
export function isReliableHomeLocalityLabel(value: string | null | undefined): boolean {
  const label = value?.trim() ?? "";
  if (!label || label.length > 40 || isCurrentLocationSentinel(label)) return false;
  if (/[0-9_+]/.test(label) || /^ChIJ/i.test(label)) return false;
  if (LOCAL_SCRIPT.test(label)) return true;
  return isConfirmedLatinLocality(label);
}

/**
 * Shared Home Weather / Outfit label for the current-location city string.
 * Empty input stays empty so callers can keep their existing empty-state copy.
 * A real destination or confirmed locality is returned unchanged.
 */
export function resolveHomeLocationDisplayLabel(
  city: string | null | undefined,
  locale: Locale,
): string | null {
  const label = city?.trim() ?? "";
  if (!label) return null;
  if (isReliableHomeLocalityLabel(label)) return label;
  return localizedCurrentLocationLabel(locale);
}
