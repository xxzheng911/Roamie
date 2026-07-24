/**
 * Place Display Name Resolver — single source for itinerary / cards / share names.
 *
 * Internal resolution order for zh-TW (and zh-Hant):
 * 1. Google Places zh-TW localized name
 * 2. Google Places zh-Hant localized name
 * 3. App verified Traditional Chinese place data
 * 4. Verifiable Traditional Chinese translation / transliteration (confidence gate)
 * 5. Brand exception (Latin stem + 繁中 type)
 * 6. English name (intermediate only — NOT a Combination Gate pass)
 * 7. Local original name (intermediate only)
 *
 * UI / Combination Gate must read localizedDisplayName; English is not a complete
 * localization for zh-TW travelers unless brand_exception applies.
 */
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import type { Locale } from "@/lib/i18n/types";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import { lookupCanonicalPlaceTranslation } from "@/lib/place-localization/canonical-place-translations";
import {
  buildLocalizedPlaceNameCacheKey,
  getLocalizedPlaceNameCache,
  setLocalizedPlaceNameCache,
} from "@/lib/place-localization/localized-place-name-cache";
import {
  formatBrandDisplayNameZh,
  isBrandName,
  resolveTranslationPolicy,
} from "@/lib/place-localization/place-name-translation-policy";
import { lookupVerifiedPlaceTranslation } from "@/lib/place-localization/verified-place-translations";

const HAS_CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const HAS_KANA_RE = /[\u3040-\u30ff]/;
const HAS_HANGUL_RE = /[\uac00-\ud7a3]/;
const HAS_LATIN_RE = /[A-Za-z]/;
/** Thai */
const HAS_THAI_RE = /[\u0e00-\u0e7f]/;
/** Greek */
const HAS_GREEK_RE = /[\u0370-\u03ff\u1f00-\u1fff]/;
/** Arabic */
const HAS_ARABIC_RE = /[\u0600-\u06ff]/;
/** Cyrillic */
const HAS_CYRILLIC_RE = /[\u0400-\u04ff]/;
/** Myanmar (Burmese) */
const HAS_MYANMAR_RE = /[\u1000-\u109f\uAA60-\uAA7F]/;
/**
 * Latin Extended / Vietnamese-specific letters (ă â ê ô ơ ư đ + tones).
 * These are local-script for VI destinations and must not pass as "English".
 */
const HAS_VIETNAMESE_LATIN_RE =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;
/** Generic Latin with combining marks (NFD) — local romanization, not English. */
const HAS_COMBINING_DIACRITIC_RE = /[\u0300-\u036f]/;

export type PlaceNameLocalizationSource =
  | "google_zh_TW"
  | "google_zh_Hant"
  | "verified_zh"
  | "canonical_zh"
  | "brand_exception"
  | "google_locale"
  | "english"
  | "english_fallback"
  | "original"
  | "raw_name"
  | "google_default"
  | "passthrough";

export type ResolvedPlaceDisplayName = {
  originalName: string;
  englishName?: string;
  localizedDisplayName: string;
  languageCode: string;
  localizationSource: PlaceNameLocalizationSource;
  translationConfidence?: number;
  placeId?: string;
  canonicalPlaceId?: string;
  requestedLocale?: Locale;
  resolvedLanguage?: string;
  translationPolicy?: string;
  isBrandName?: boolean;
  translatedAt?: number;
};

export type PlaceNameResolveInput = {
  /** Current display / Google language-localized name */
  name?: string | null;
  /** Explicit original / local-script name when known */
  originalName?: string | null;
  /** Google localized name for app locale (zh-TW etc.) */
  localizedName?: string | null;
  /** Alternate Google names by language code */
  localizedNames?: Partial<Record<string, string>> | null;
  /** English fallback */
  englishName?: string | null;
  placeId?: string | null;
  canonicalPlaceId?: string | null;
  countryCode?: string | null;
  types?: string[] | null;
  primaryType?: string | null;
};

function pickFirstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const v of values) {
    const t = (v ?? "").trim();
    if (t) return t;
  }
  return "";
}

function looksTraditionalChinese(text: string): boolean {
  return HAS_CJK_RE.test(text);
}

/**
 * True when text looks like a destination-local Latin name (Vietnamese etc.),
 * not plain English ASCII suitable as an intermediate fallback.
 */
export function hasLocalLatinDiacritics(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (HAS_VIETNAMESE_LATIN_RE.test(t)) return true;
  // NFD form: base letter + combining mark (Vietnamese / Portuguese / … romanization)
  const nfd = t.normalize("NFD");
  return HAS_COMBINING_DIACRITIC_RE.test(nfd) && HAS_LATIN_RE.test(t);
}

/** Scripts that are foreign relative to the App locale (must not be preferred display). */
export function hasForeignLocalScript(text: string, locale: Locale): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (
    HAS_THAI_RE.test(t) ||
    HAS_GREEK_RE.test(t) ||
    HAS_ARABIC_RE.test(t) ||
    HAS_CYRILLIC_RE.test(t) ||
    HAS_MYANMAR_RE.test(t)
  ) {
    return true;
  }
  // Vietnamese / local romanization with diacritics is not App-language English.
  if (locale !== "en" && hasLocalLatinDiacritics(t)) return true;
  if (locale !== "ja" && HAS_KANA_RE.test(t)) return true;
  if (locale !== "ko" && HAS_HANGUL_RE.test(t)) return true;
  // CJK for non-Chinese App locales is treated as foreign local script.
  if (locale !== "zh-TW" && HAS_CJK_RE.test(t) && !HAS_LATIN_RE.test(t)) return true;
  return false;
}

/** True when display name is understandable for the App locale (looser — not Gate completeness). */
export function isReadablePlaceNameForLocale(name: string, locale: Locale): boolean {
  const t = (name ?? "").trim();
  if (!t) return false;
  if (hasForeignLocalScript(t, locale)) return false;
  if (locale === "zh-TW") return HAS_CJK_RE.test(t) || HAS_LATIN_RE.test(t);
  if (locale === "ja") return HAS_CJK_RE.test(t) || HAS_KANA_RE.test(t) || HAS_LATIN_RE.test(t);
  if (locale === "ko") return HAS_HANGUL_RE.test(t) || HAS_LATIN_RE.test(t);
  return HAS_LATIN_RE.test(t);
}

const INCOMPLETE_SOURCES = new Set<PlaceNameLocalizationSource>([
  "english",
  "english_fallback",
  "original",
  "raw_name",
  "google_default",
  "passthrough",
]);

/**
 * Strict completeness for Combination Localization Gate.
 * For zh-TW: English-only delivery is incomplete unless brand_exception with CJK type.
 */
export function isCompleteLocalizationForLocale(
  resolved: Pick<
    ResolvedPlaceDisplayName,
    "localizedDisplayName" | "localizationSource" | "languageCode" | "originalName"
  >,
  locale: Locale,
): { ok: boolean; reason?: string } {
  const display = (resolved.localizedDisplayName ?? "").trim();
  if (!display) return { ok: false, reason: "empty_display_name" };
  if (hasForeignLocalScript(display, locale)) {
    return { ok: false, reason: "foreign_local_script" };
  }

  if (locale === "zh-TW") {
    const source = resolved.localizationSource;
    if (INCOMPLETE_SOURCES.has(source)) {
      return { ok: false, reason: `incomplete_source:${source}` };
    }
    if (resolved.languageCode === "en" && source !== "brand_exception") {
      return { ok: false, reason: "resolved_language_en" };
    }
    if (!HAS_CJK_RE.test(display)) {
      return { ok: false, reason: "missing_zh_script" };
    }
    // Same as raw English with no CJK improvement
    const raw = (resolved.originalName ?? "").trim();
    if (
      raw &&
      display === raw &&
      HAS_LATIN_RE.test(display) &&
      !HAS_CJK_RE.test(display)
    ) {
      return { ok: false, reason: "display_equals_english_raw" };
    }
    return { ok: true };
  }

  if (locale === "ja") {
    if (HAS_KANA_RE.test(display) || HAS_CJK_RE.test(display)) return { ok: true };
    if (sourceIsEnglish(resolved.localizationSource)) {
      return { ok: false, reason: "english_fallback_for_ja" };
    }
    return HAS_LATIN_RE.test(display)
      ? { ok: false, reason: "latin_only_for_ja" }
      : { ok: true };
  }

  if (locale === "ko") {
    if (HAS_HANGUL_RE.test(display)) return { ok: true };
    if (sourceIsEnglish(resolved.localizationSource)) {
      return { ok: false, reason: "english_fallback_for_ko" };
    }
    return HAS_LATIN_RE.test(display)
      ? { ok: false, reason: "latin_only_for_ko" }
      : { ok: true };
  }

  return { ok: true };
}

function sourceIsEnglish(source: PlaceNameLocalizationSource): boolean {
  return source === "english" || source === "english_fallback";
}

export type PlaceLocalizationFallbackLog = {
  placeId?: string;
  originalName: string;
  requestedLocale: Locale;
  resolvedName: string;
  resolvedLanguage: string;
  localizationSource: PlaceNameLocalizationSource;
  reason: string;
};

let placeLocalizationFallbackVerbose = false;

/** Debug-only: emit per-place fallback detail (default = summary counters only). */
export function setPlaceLocalizationFallbackVerbose(enabled: boolean): void {
  placeLocalizationFallbackVerbose = enabled;
}

const fallbackSummary = {
  count: 0,
  byReason: {} as Record<string, number>,
};

export function getPlaceLocalizationFallbackSummary(): typeof fallbackSummary {
  return { count: fallbackSummary.count, byReason: { ...fallbackSummary.byReason } };
}

export function resetPlaceLocalizationFallbackSummary(): void {
  fallbackSummary.count = 0;
  fallbackSummary.byReason = {};
}

function logPlaceLocalizationFallback(entry: PlaceLocalizationFallbackLog): void {
  fallbackSummary.count += 1;
  fallbackSummary.byReason[entry.reason] = (fallbackSummary.byReason[entry.reason] ?? 0) + 1;

  if (!placeLocalizationFallbackVerbose) {
    if (fallbackSummary.count === 1 || fallbackSummary.count % 10 === 0) {
      console.info(
        "[PLACE_LOCALIZATION_FALLBACK]",
        `summaryCount=${fallbackSummary.count}`,
        `lastReason=${entry.reason}`,
        `requestedLocale=${entry.requestedLocale}`,
      );
    }
    return;
  }

  console.info(
    [
      "[PLACE_LOCALIZATION_FALLBACK]",
      `placeId=${entry.placeId ?? ""}`,
      `originalName=${entry.originalName}`,
      `requestedLocale=${entry.requestedLocale}`,
      `resolvedName=${entry.resolvedName}`,
      `resolvedLanguage=${entry.resolvedLanguage}`,
      `localizationSource=${entry.localizationSource}`,
      `reason=${entry.reason}`,
    ].join(" "),
  );
}

function extractCjkSegment(name: string): string | null {
  if (!HAS_CJK_RE.test(name) || !HAS_LATIN_RE.test(name)) return null;
  const cjkParts = name.match(
    /[\u4e00-\u9fff\u3400-\u4dbf]+(?:[\u4e00-\u9fff\u3400-\u4dbf\s]*)*/g,
  );
  if (!cjkParts?.length) return null;
  const joined = cjkParts.join("").replace(/\s+/g, "").trim();
  return joined.length >= 2 ? joined : null;
}

function detectEnglishName(raw: PlaceNameResolveInput, originalName: string): string {
  return pickFirstNonEmpty(
    raw.englishName,
    raw.localizedNames?.en,
    raw.localizedNames?.["en-US"],
    HAS_LATIN_RE.test(originalName) && !hasForeignLocalScript(originalName, "zh-TW")
      ? originalName
      : null,
    HAS_LATIN_RE.test(raw.name ?? "") && !hasForeignLocalScript(raw.name ?? "", "zh-TW")
      ? raw.name
      : null,
  );
}

/**
 * Shared verified translation pipeline for zh-TW:
 * original/English → verified dict → canonical/structural → brand policy.
 */
export function resolveVerifiedLocalizedPlaceName(
  input: PlaceNameResolveInput | string,
  locale: Locale = effectiveAppLocale(),
): ResolvedPlaceDisplayName {
  return resolvePlaceDisplayName(input, locale);
}

/**
 * Resolve a single display name for the given app locale.
 * Defaults to effectiveAppLocale() — never destination / Google / browser leftovers.
 */
export function resolvePlaceDisplayName(
  input: PlaceNameResolveInput | string,
  locale: Locale = effectiveAppLocale(),
): ResolvedPlaceDisplayName {
  const raw: PlaceNameResolveInput =
    typeof input === "string" ? { name: input } : (input ?? {});

  const originalName = pickFirstNonEmpty(raw.originalName, raw.name, "Unknown");
  const languageCode = localeToGoogleLanguageCode(locale);
  const placeId = pickFirstNonEmpty(raw.placeId, raw.canonicalPlaceId) || undefined;
  const canonicalPlaceId = raw.canonicalPlaceId?.trim() || placeId;
  const countryCode = raw.countryCode?.trim() || undefined;
  const englishName = detectEnglishName(raw, originalName) || undefined;
  const translatedAt = Date.now();

  const cacheKey = buildLocalizedPlaceNameCacheKey({
    placeId,
    canonicalPlaceId,
    originalName,
    languageCode: locale === "zh-TW" ? "zh-TW" : languageCode,
    countryCode,
  });
  const cached = getLocalizedPlaceNameCache(cacheKey);
  if (cached) {
    return {
      originalName: cached.originalName,
      englishName: cached.englishName,
      localizedDisplayName: cached.localizedDisplayName,
      languageCode: cached.languageCode,
      localizationSource: cached.localizationSource as PlaceNameLocalizationSource,
      translationConfidence: cached.translationConfidence,
      placeId: cached.placeId,
      canonicalPlaceId: cached.canonicalPlaceId,
      requestedLocale: locale,
      resolvedLanguage: cached.resolvedLanguage ?? cached.languageCode,
      translatedAt: cached.translatedAt,
    };
  }

  const remember = (resolved: ResolvedPlaceDisplayName): ResolvedPlaceDisplayName => {
    const withMeta: ResolvedPlaceDisplayName = {
      ...resolved,
      englishName: resolved.englishName ?? englishName,
      requestedLocale: locale,
      resolvedLanguage: resolved.resolvedLanguage ?? resolved.languageCode,
      translatedAt: resolved.translatedAt ?? translatedAt,
    };
    setLocalizedPlaceNameCache(cacheKey, {
      originalName: withMeta.originalName,
      englishName: withMeta.englishName,
      localizedDisplayName: withMeta.localizedDisplayName,
      languageCode: withMeta.languageCode,
      resolvedLanguage: withMeta.resolvedLanguage,
      localizationSource: withMeta.localizationSource,
      translationConfidence: withMeta.translationConfidence ?? 1,
      placeId: withMeta.placeId ?? placeId,
      canonicalPlaceId: withMeta.canonicalPlaceId ?? canonicalPlaceId,
      countryCode,
      requestedLocale: locale,
      translatedAt: withMeta.translatedAt,
    });
    return withMeta;
  };

  const emitFallback = (
    reason: string,
    resolved: ResolvedPlaceDisplayName,
  ): ResolvedPlaceDisplayName => {
    logPlaceLocalizationFallback({
      placeId,
      originalName,
      requestedLocale: locale,
      resolvedName: resolved.localizedDisplayName,
      resolvedLanguage: resolved.languageCode,
      localizationSource: resolved.localizationSource,
      reason,
    });
    return remember(resolved);
  };

  if (locale === "zh-TW" || languageCode === "zh-TW") {
    // 1. Google Places zh-TW
    const zhTw = pickFirstNonEmpty(
      raw.localizedNames?.["zh-TW"],
      raw.localizedNames?.["zh_TW"],
      languageCode === "zh-TW" ? raw.localizedName : null,
    );
    if (
      zhTw &&
      looksTraditionalChinese(zhTw) &&
      !hasForeignLocalScript(zhTw, "zh-TW")
    ) {
      return remember({
        originalName,
        englishName,
        localizedDisplayName: zhTw,
        languageCode: "zh-TW",
        localizationSource: "google_zh_TW",
        translationConfidence: 1,
        placeId,
        canonicalPlaceId,
        translationPolicy: "locale_passthrough",
      });
    }

    // 2. Google Places zh-Hant (incl. zh-HK / zh-MO)
    const zhHant = pickFirstNonEmpty(
      raw.localizedNames?.["zh-Hant"],
      raw.localizedNames?.["zh_Hant"],
      raw.localizedNames?.["zh-HK"],
      raw.localizedNames?.["zh-MO"],
    );
    if (
      zhHant &&
      looksTraditionalChinese(zhHant) &&
      !hasForeignLocalScript(zhHant, "zh-TW")
    ) {
      return remember({
        originalName,
        englishName,
        localizedDisplayName: zhHant,
        languageCode: "zh-Hant",
        localizationSource: "google_zh_Hant",
        translationConfidence: 1,
        placeId,
        canonicalPlaceId,
        translationPolicy: "locale_passthrough",
      });
    }

    // Current name already Traditional Chinese (API requested zh-TW)
    if (
      looksTraditionalChinese(originalName) &&
      !HAS_KANA_RE.test(originalName) &&
      !hasForeignLocalScript(originalName, "zh-TW")
    ) {
      const cjkOnly = extractCjkSegment(originalName);
      if (cjkOnly && cjkOnly !== originalName) {
        return remember({
          originalName,
          englishName,
          localizedDisplayName: cjkOnly,
          languageCode: "zh-TW",
          localizationSource: "verified_zh",
          translationConfidence: 0.95,
          placeId,
          canonicalPlaceId,
          translationPolicy: "locale_passthrough",
        });
      }
      return remember({
        originalName,
        englishName,
        localizedDisplayName: originalName,
        languageCode: "zh-TW",
        localizationSource: "google_locale",
        translationConfidence: 1,
        placeId,
        canonicalPlaceId,
        translationPolicy: "locale_passthrough",
      });
    }

    const lookupNames = [
      originalName,
      englishName,
      raw.name,
    ].filter((v, i, arr): v is string => Boolean(v?.trim()) && arr.indexOf(v) === i);

    const lookupBase = {
      placeId,
      canonicalPlaceId,
      countryCode,
      types: raw.types,
      primaryType: raw.primaryType,
      englishName,
    };

    // 3. App verified 繁中 dictionary (try all name variants)
    for (const candidateName of lookupNames) {
      const verified = lookupVerifiedPlaceTranslation({
        ...lookupBase,
        originalName: candidateName,
      });
      if (verified) {
        return remember({
          originalName,
          englishName,
          localizedDisplayName: verified.localizedDisplayName,
          languageCode: verified.languageCode,
          localizationSource: "verified_zh",
          translationConfidence: verified.translationConfidence,
          placeId: verified.placeId ?? placeId,
          canonicalPlaceId: verified.canonicalPlaceId ?? canonicalPlaceId,
          translationPolicy: "landmark_translate",
          isBrandName: false,
        });
      }
    }

    // 4. Canonical / structural / transliteration (confidence-gated)
    for (const candidateName of lookupNames) {
      const canonical = lookupCanonicalPlaceTranslation({
        ...lookupBase,
        originalName: candidateName,
      });
      if (canonical) {
        return remember({
          originalName,
          englishName,
          localizedDisplayName: canonical.localizedDisplayName,
          languageCode: canonical.languageCode,
          localizationSource: canonical.localizationSource,
          translationConfidence: canonical.translationConfidence,
          placeId: canonical.placeId ?? placeId,
          canonicalPlaceId: canonical.canonicalPlaceId ?? canonicalPlaceId,
          translationPolicy: resolveTranslationPolicy({
            name: candidateName,
            types: raw.types,
            primaryType: raw.primaryType,
          }),
          isBrandName: canonical.localizationSource === "brand_exception",
        });
      }
    }

    // 5. Brand exception even when canonical missed type formatting
    const brandSourceName = englishName || originalName;
    if (
      isBrandName({
        name: brandSourceName,
        types: raw.types,
        primaryType: raw.primaryType,
      })
    ) {
      const brandZh = formatBrandDisplayNameZh(brandSourceName);
      if (brandZh && HAS_CJK_RE.test(brandZh)) {
        return remember({
          originalName,
          englishName,
          localizedDisplayName: brandZh,
          languageCode: "zh-TW",
          localizationSource: "brand_exception",
          translationConfidence: 0.9,
          placeId,
          canonicalPlaceId,
          translationPolicy: "brand_keep_with_type",
          isBrandName: true,
        });
      }
    }

    // 6. English — intermediate only (Gate must reject for zh-TW)
    if (
      englishName &&
      !HAS_KANA_RE.test(englishName) &&
      !HAS_HANGUL_RE.test(englishName) &&
      !hasForeignLocalScript(englishName, "zh-TW")
    ) {
      return emitFallback("no_verified_zh_hant_name_english_intermediate", {
        originalName,
        englishName,
        localizedDisplayName: englishName,
        languageCode: "en",
        localizationSource: "english_fallback",
        translationConfidence: 0,
        placeId,
        canonicalPlaceId,
        translationPolicy: "incomplete",
        isBrandName: false,
      });
    }

    // 7. Local original — last resort
    const reason = hasForeignLocalScript(originalName, "zh-TW")
      ? "foreign_local_script_no_english"
      : "no_verified_zh_hant_name";
    return emitFallback(reason, {
      originalName,
      englishName,
      localizedDisplayName: originalName,
      languageCode: "und",
      localizationSource: "original",
      translationConfidence: 0,
      placeId,
      canonicalPlaceId,
      translationPolicy: "incomplete",
    });
  }

  // Non zh-TW locales: prefer Google localized name for locale, else English, else original.
  const localized = pickFirstNonEmpty(
    raw.localizedName,
    raw.localizedNames?.[languageCode],
    raw.name,
  );
  if (localized && !hasForeignLocalScript(localized, locale)) {
    return remember({
      originalName,
      englishName,
      localizedDisplayName: localized,
      languageCode,
      localizationSource: "google_locale",
      translationConfidence: 1,
      placeId,
      canonicalPlaceId,
    });
  }

  const englishFallback = pickFirstNonEmpty(
    raw.englishName,
    raw.localizedNames?.en,
    HAS_LATIN_RE.test(originalName) ? originalName : null,
  );
  if (englishFallback && !hasForeignLocalScript(englishFallback, locale)) {
    return emitFallback("locale_name_missing_use_english", {
      originalName,
      englishName: englishFallback,
      localizedDisplayName: englishFallback,
      languageCode: "en",
      localizationSource: "english_fallback",
      translationConfidence: 0,
      placeId,
      canonicalPlaceId,
    });
  }

  if (localized) {
    return emitFallback("foreign_local_script_no_english", {
      originalName,
      englishName,
      localizedDisplayName: localized,
      languageCode: "und",
      localizationSource: "original",
      translationConfidence: 0,
      placeId,
      canonicalPlaceId,
    });
  }

  return remember({
    originalName,
    englishName,
    localizedDisplayName: originalName,
    languageCode,
    localizationSource: "passthrough",
    translationConfidence: 1,
    placeId,
    canonicalPlaceId,
  });
}

/** 探索／地圖卡片：優先保留 Google 繁中名稱，英文則對照翻譯 */
export function localizePlaceDisplayName(
  name: string,
  locale: Locale = effectiveAppLocale(),
): string {
  return resolvePlaceDisplayName(name, locale).localizedDisplayName;
}

/**
 * UI / persistence display name — always prefer localizedDisplayName.
 * Re-resolves Latin-only persisted names for zh-TW so verified translations apply.
 */
export function displayNameForPlaceLike(
  item: {
    name?: string | null;
    placeName?: string | null;
    title?: string | null;
    localizedDisplayName?: string | null;
    originalName?: string | null;
    googlePlaceId?: string | null;
    placeId?: string | null;
    countryCode?: string | null;
    types?: string[] | null;
    primaryType?: string | null;
  },
  locale: Locale = effectiveAppLocale(),
): string {
  const persistedLocalized = (item.localizedDisplayName ?? "").trim();
  const rawName = pickFirstNonEmpty(
    item.originalName,
    item.placeName,
    item.title,
    item.name,
  );

  if (locale === "zh-TW" || localeToGoogleLanguageCode(locale) === "zh-TW") {
    const candidate = persistedLocalized || rawName;
    const needsResolve =
      Boolean(candidate) &&
      (!HAS_CJK_RE.test(candidate) ||
        hasForeignLocalScript(candidate, locale) ||
        hasLocalLatinDiacritics(candidate));
    // Re-resolve Latin / local-diacritic / foreign-script names so verified translations apply.
    if (needsResolve) {
      return resolvePlaceDisplayName(
        {
          name: candidate,
          originalName: rawName || candidate,
          placeId: item.googlePlaceId ?? item.placeId,
          canonicalPlaceId: item.googlePlaceId ?? item.placeId,
          countryCode: item.countryCode,
          types: item.types,
          primaryType: item.primaryType,
        },
        locale,
      ).localizedDisplayName;
    }
    if (persistedLocalized && HAS_CJK_RE.test(persistedLocalized)) return persistedLocalized;
  } else if (persistedLocalized) {
    return persistedLocalized;
  }

  return resolvePlaceDisplayName(
    {
      name: rawName,
      originalName: rawName,
      placeId: item.googlePlaceId ?? item.placeId,
      canonicalPlaceId: item.googlePlaceId ?? item.placeId,
      countryCode: item.countryCode,
      types: item.types,
      primaryType: item.primaryType,
    },
    locale,
  ).localizedDisplayName;
}

/** Apply resolver onto a place-like object; returns display fields to persist. */
export function applyPlaceDisplayNameResolver<
  T extends { name?: string | null; originalName?: string | null; id?: string | null },
>(
  place: T,
  locale: Locale = effectiveAppLocale(),
  extras?: Omit<PlaceNameResolveInput, "name" | "originalName">,
): T & ResolvedPlaceDisplayName {
  const resolved = resolvePlaceDisplayName(
    {
      name: place.name,
      originalName: place.originalName ?? place.name,
      placeId: extras?.placeId ?? place.id,
      canonicalPlaceId: extras?.canonicalPlaceId ?? place.id,
      ...extras,
    },
    locale,
  );
  return {
    ...place,
    name: resolved.localizedDisplayName,
    ...resolved,
  };
}
