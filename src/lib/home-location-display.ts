import { REGION_NODES } from "@/lib/ai/region-adjacency/graph";
import { applyCityLocaleAlias, canonicalFromDisplayName } from "@/lib/ai/destination-locale-aliases";
import { itineraryDestinationDisplay } from "@/lib/native-qa-display";
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
  if (isReliableHomeLocalityLabel(label)) {
    return locale === "zh-TW" ? label : (knownCityDisplay(label, locale) ?? label);
  }
  return localizedCurrentLocationLabel(locale);
}

const ADMIN_SUFFIX = /(?:特別市|市|縣|県|都|府)$/u;

/**
 * Existing city display tables only (via itineraryDestinationDisplay). A label is localized
 * only when the table knows it; unknown labels return undefined so callers keep the raw string.
 */
function knownCityDisplay(label: string, locale: Locale): string | undefined {
  if (!LOCAL_SCRIPT.test(label)) {
    const canonical = applyCityLocaleAlias(label);
    if (canonical === label) return undefined;
    return displayFromBases([canonical], locale);
  }
  const hangul = (name: string | undefined) => Boolean(name && /\p{Script=Hangul}/u.test(name));
  const full = displayFromBases([label, ...otherScriptCanonical(label)], locale);
  if (full && (locale !== "ko" || hangul(full))) return full;
  const stripped = label.replace(ADMIN_SUFFIX, "");
  const base = stripped !== label && stripped.length >= 2
    ? withAdminSuffix(displayFromBases([stripped, ...otherScriptCanonical(stripped)], locale), label.slice(stripped.length), locale)
    : undefined;
  if (locale === "ko") return [full, base].find(hangul) ?? full ?? base;
  return base;
}

/**
 * 「新竹縣」is not「新竹市」: a county keeps its suffix (Hsinchu County, 新竹県). ja 「新北市」 keeps
 * 市 (「新北」 alone is not the city's name); other cities stay as before (高雄市 → 高雄).
 */
function withAdminSuffix(base: string | undefined, suffix: string, locale: Locale): string | undefined {
  if (!base) return undefined;
  if (suffix === "縣" && locale !== "ja" && /^[\p{Script=Latin}\s.'-]+$/u.test(base)) return `${base} County`;
  if (locale === "ja" && suffix === "縣") return `${base}県`;
  if (locale === "ja" && suffix === "市" && base === "新北") return "新北市";
  return base;
}

/** 「서울」「ソウル」「교토」: the canonical label of a known city written in another script. */
function otherScriptCanonical(label: string): string[] {
  const canonical = canonicalFromDisplayName(label) ?? applyCityLocaleAlias(label);
  return canonical && canonical !== label ? [canonical] : [];
}

function displayFromBases(bases: string[], locale: Locale): string | undefined {
  const candidates = [
    ...new Set(bases.flatMap((base) => [base, base.replace(/台/g, "臺"), base.replace(/臺/g, "台")])),
  ];
  const displays = candidates
    .filter((candidate) => itineraryDestinationDisplay(candidate, "en") !== candidate)
    .map((candidate) => itineraryDestinationDisplay(candidate, locale))
    .filter(Boolean);
  if (locale === "ko") return displays.find((name) => /\p{Script=Hangul}/u.test(name)) ?? displays[0];
  return displays[0];
}
