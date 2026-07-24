/**
 * Combination Localization Gate — runs before combination delivery to chat.
 *
 * Ensures every place uses resolvePlaceDisplayName / localizedDisplayName.
 * For zh-TW: English fallback is NOT a pass — only official/verified/canonical
 * 繁中 (or brand_exception with 繁中 type) may be delivered.
 */
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  deriveCombinationThemeTitle,
  isMechanicalCombinationTitle,
  localizeCombinationThemeTitle,
} from "@/lib/ai/combination-theme-titles";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import type { Locale } from "@/lib/i18n/types";
import {
  hasForeignLocalScript,
  isCompleteLocalizationForLocale,
  resolvePlaceDisplayName,
  type PlaceNameLocalizationSource,
} from "@/lib/place-display-name";

const HAS_CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const HAS_LATIN_RE = /[A-Za-z]/;

/** zh-TW requires full coverage; other locales keep a soft readable floor. */
const MIN_READABLE_RATIO_NON_ZH = 0.8;

export type CombinationPlaceLocalizationFields = {
  localizedDisplayName?: string;
  originalName?: string;
  languageCode?: string;
  localizationSource?: PlaceNameLocalizationSource | string;
  englishName?: string;
  translationConfidence?: number;
};

export type GateCombinationPlaceCandidate = {
  name: string;
  googlePlaceId?: string;
  searchCandidateId?: string;
  coordinates?: { lat: number; lng: number };
  address?: string;
  district?: string;
  types: string[];
  primaryType?: string | null;
  rating?: number | null;
  normalizedCategory?: string;
  combinationId?: string;
} & CombinationPlaceLocalizationFields;

export type GateStructuredCombinationOption = {
  combinationId: string;
  title: string;
  theme: string;
  placeCandidates: GateCombinationPlaceCandidate[];
  primaryCandidates?: GateCombinationPlaceCandidate[];
  fallbackCandidates?: GateCombinationPlaceCandidate[];
};

export type LocalizedCombinationPlace = GateCombinationPlaceCandidate & {
  localizedDisplayName: string;
  originalName: string;
  languageCode: string;
  localizationSource: PlaceNameLocalizationSource;
  englishName?: string;
  translationConfidence?: number;
};

export type CombinationLocalizationGateResult = {
  ok: boolean;
  combinations: GateStructuredCombinationOption[];
  droppedForeignScript: number;
  droppedUnreadable: number;
  droppedEnglishFallback: number;
  englishFallbackCount: number;
  originalFallbackCount: number;
  verifiedTranslationCount: number;
  zhTwResolvedCount: number;
  brandNameExceptionCount: number;
  mixedLanguageCount: number;
  rejectedCombinationCount: number;
  localizationCoverage: number;
  readableRatio: number;
  reason?: string;
};

function isDebugLocalization(): boolean {
  try {
    return (
      (typeof import.meta !== "undefined" &&
        Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV)) ||
      process.env.NODE_ENV === "development" ||
      process.env.VITE_DEBUG_PLACE_LOCALIZATION === "1"
    );
  } catch {
    return process.env.VITE_DEBUG_PLACE_LOCALIZATION === "1";
  }
}

function logPlaceTrace(entry: {
  placeId?: string;
  canonicalPlaceId?: string;
  rawName: string;
  englishName?: string;
  requestedLocale: Locale;
  resolvedName: string;
  resolvedLanguage: string;
  localizationSource: string;
  translationConfidence?: number;
  gateResult: "pass" | "fail";
  reason: string;
}): void {
  if (!isDebugLocalization() && entry.gateResult === "pass") return;
  logAiPipeline(
    "[PLACE_LOCALIZATION_TRACE]",
    `placeId=${entry.placeId ?? ""}`,
    `canonicalPlaceId=${entry.canonicalPlaceId ?? ""}`,
    `rawName=${entry.rawName}`,
    `englishName=${entry.englishName ?? ""}`,
    `requestedLocale=${entry.requestedLocale}`,
    `resolvedName=${entry.resolvedName}`,
    `resolvedLanguage=${entry.resolvedLanguage}`,
    `localizationSource=${entry.localizationSource}`,
    `translationConfidence=${entry.translationConfidence ?? ""}`,
    `gateResult=${entry.gateResult}`,
    `reason=${entry.reason}`,
  );
}

function localizeCandidate(
  candidate: GateCombinationPlaceCandidate,
  locale: Locale,
): LocalizedCombinationPlace | null {
  const originalName = (candidate.originalName ?? candidate.name ?? "").trim();
  if (!originalName) return null;

  const resolved = resolvePlaceDisplayName(
    {
      name: candidate.localizedDisplayName || candidate.name,
      originalName,
      englishName: candidate.englishName,
      placeId: candidate.googlePlaceId,
      canonicalPlaceId: candidate.googlePlaceId,
      types: candidate.types,
      primaryType: candidate.primaryType,
    },
    locale,
  );

  const display = resolved.localizedDisplayName.trim();
  if (!display) {
    logPlaceTrace({
      placeId: candidate.googlePlaceId,
      canonicalPlaceId: candidate.googlePlaceId,
      rawName: originalName,
      englishName: resolved.englishName ?? candidate.englishName,
      requestedLocale: locale,
      resolvedName: "",
      resolvedLanguage: resolved.languageCode,
      localizationSource: resolved.localizationSource,
      translationConfidence: resolved.translationConfidence,
      gateResult: "fail",
      reason: "empty_display_name",
    });
    return null;
  }

  if (hasForeignLocalScript(display, locale)) {
    logPlaceTrace({
      placeId: candidate.googlePlaceId,
      canonicalPlaceId: candidate.googlePlaceId,
      rawName: originalName,
      englishName: resolved.englishName ?? candidate.englishName,
      requestedLocale: locale,
      resolvedName: display,
      resolvedLanguage: resolved.languageCode,
      localizationSource: resolved.localizationSource,
      translationConfidence: resolved.translationConfidence,
      gateResult: "fail",
      reason: "foreign_local_script_blocked",
    });
    return null;
  }

  const completeness = isCompleteLocalizationForLocale(
    {
      localizedDisplayName: display,
      localizationSource: resolved.localizationSource,
      languageCode: resolved.languageCode,
      originalName,
    },
    locale,
  );

  if (!completeness.ok) {
    logPlaceTrace({
      placeId: candidate.googlePlaceId,
      canonicalPlaceId: candidate.googlePlaceId,
      rawName: originalName,
      englishName: resolved.englishName ?? candidate.englishName,
      requestedLocale: locale,
      resolvedName: display,
      resolvedLanguage: resolved.languageCode,
      localizationSource: resolved.localizationSource,
      translationConfidence: resolved.translationConfidence,
      gateResult: "fail",
      reason: completeness.reason ?? "incomplete_localization",
    });
    return null;
  }

  logPlaceTrace({
    placeId: candidate.googlePlaceId,
    canonicalPlaceId: candidate.googlePlaceId,
    rawName: originalName,
    englishName: resolved.englishName ?? candidate.englishName,
    requestedLocale: locale,
    resolvedName: display,
    resolvedLanguage: resolved.languageCode,
    localizationSource: resolved.localizationSource,
    translationConfidence: resolved.translationConfidence,
    gateResult: "pass",
    reason: "localized",
  });

  return {
    name: display,
    localizedDisplayName: display,
    originalName: resolved.originalName || originalName,
    englishName: resolved.englishName ?? candidate.englishName,
    languageCode: resolved.languageCode,
    localizationSource: resolved.localizationSource,
    translationConfidence: resolved.translationConfidence,
    googlePlaceId: candidate.googlePlaceId,
    searchCandidateId:
      candidate.searchCandidateId ??
      candidate.googlePlaceId ??
      `name:${display}`,
    coordinates: candidate.coordinates,
    address: candidate.address,
    district: candidate.district,
    types: candidate.types ?? [],
    primaryType: candidate.primaryType,
    rating: candidate.rating,
    normalizedCategory: candidate.normalizedCategory,
    combinationId: candidate.combinationId,
  };
}

function scriptTier(
  source: PlaceNameLocalizationSource,
  languageCode: string,
): "locale" | "brand" | "english" | "other" {
  if (
    source === "google_zh_TW" ||
    source === "google_zh_Hant" ||
    source === "verified_zh" ||
    source === "canonical_zh" ||
    source === "google_locale"
  ) {
    return "locale";
  }
  if (source === "brand_exception") return "brand";
  if (source === "english" || source === "english_fallback" || languageCode === "en") {
    return "english";
  }
  return "other";
}

function countMixedLanguage(places: LocalizedCombinationPlace[]): number {
  let cjk = 0;
  let latinOnly = 0;
  for (const p of places) {
    const n = p.localizedDisplayName;
    if (HAS_CJK_RE.test(n) && !HAS_LATIN_RE.test(n)) cjk += 1;
    else if (HAS_LATIN_RE.test(n) && !HAS_CJK_RE.test(n)) latinOnly += 1;
    else if (HAS_CJK_RE.test(n) && HAS_LATIN_RE.test(n)) {
      // brand mix is OK; still counts toward mixed if no brand source
      if (p.localizationSource !== "brand_exception") cjk += 1;
    }
  }
  return cjk > 0 && latinOnly > 0 ? latinOnly : 0;
}

/**
 * Localize + validate combination options for the effective App locale.
 * Mutates place names onto localizedDisplayName; drops incomplete places;
 * rejects combos below coverage / min place count.
 */
export function applyCombinationLocalizationGate(
  combinations: GateStructuredCombinationOption[],
  opts?: {
    locale?: Locale;
    minPlacesPerCombo?: number;
    minCombinations?: number;
  },
): CombinationLocalizationGateResult {
  const locale = opts?.locale ?? effectiveAppLocale();
  const minPlaces = opts?.minPlacesPerCombo ?? 2;
  const minCombos = opts?.minCombinations ?? 2;
  const requireFullCoverage = locale === "zh-TW";

  let droppedForeignScript = 0;
  let droppedUnreadable = 0;
  let droppedEnglishFallback = 0;
  let englishFallbackCount = 0;
  let originalFallbackCount = 0;
  let verifiedTranslationCount = 0;
  let zhTwResolvedCount = 0;
  let brandNameExceptionCount = 0;
  let mixedLanguageCount = 0;
  let rejectedCombinationCount = 0;
  let completePlaces = 0;
  let totalPlaces = 0;

  const gated: GateStructuredCombinationOption[] = [];
  const usedTitles = new Set<string>();

  for (const combo of combinations) {
    const pool = combo.placeCandidates ?? [];
    const localizedPool: LocalizedCombinationPlace[] = [];

    for (const place of pool) {
      totalPlaces += 1;
      const before = (place.originalName ?? place.name ?? "").trim();
      const localized = localizeCandidate(
        {
          ...place,
          originalName: place.originalName ?? place.name,
          localizedDisplayName: place.localizedDisplayName,
          languageCode: place.languageCode,
          localizationSource: place.localizationSource,
          englishName: place.englishName,
        },
        locale,
      );

      if (!localized) {
        if (before && hasForeignLocalScript(before, locale)) {
          droppedForeignScript += 1;
        } else {
          // Probe why — english vs other
          const probe = resolvePlaceDisplayName(
            {
              name: place.name,
              originalName: before,
              englishName: place.englishName,
              placeId: place.googlePlaceId,
              types: place.types,
              primaryType: place.primaryType,
            },
            locale,
          );
          if (
            probe.localizationSource === "english" ||
            probe.localizationSource === "english_fallback" ||
            probe.languageCode === "en"
          ) {
            droppedEnglishFallback += 1;
            englishFallbackCount += 1;
          } else {
            droppedUnreadable += 1;
          }
          if (probe.localizationSource === "original") originalFallbackCount += 1;
        }
        continue;
      }

      completePlaces += 1;
      const tier = scriptTier(localized.localizationSource, localized.languageCode);
      if (tier === "locale") {
        zhTwResolvedCount += 1;
        if (
          localized.localizationSource === "verified_zh" ||
          localized.localizationSource === "canonical_zh"
        ) {
          verifiedTranslationCount += 1;
        }
      }
      if (tier === "brand") brandNameExceptionCount += 1;
      if (tier === "english") englishFallbackCount += 1;
      if (localized.localizationSource === "original") originalFallbackCount += 1;
      localizedPool.push(localized);
    }

    mixedLanguageCount += countMixedLanguage(localizedPool);

    // Prefer locale-tier names first, then brand — never keep incomplete English.
    localizedPool.sort((a, b) => {
      const ta = scriptTier(a.localizationSource, a.languageCode);
      const tb = scriptTier(b.localizationSource, b.languageCode);
      const rank = (t: "locale" | "brand" | "english" | "other") =>
        t === "locale" ? 0 : t === "brand" ? 1 : t === "english" ? 2 : 3;
      return rank(ta) - rank(tb);
    });

    const primaryCount = Math.min(3, localizedPool.length);
    const primary = localizedPool.slice(0, primaryCount);
    const fallback = localizedPool.slice(primaryCount);

    const comboCoverage =
      pool.length === 0 ? 0 : localizedPool.length / Math.max(1, pool.length);
    const comboMixed = countMixedLanguage(localizedPool);
    const deliveredEnglish = localizedPool.filter(
      (p) =>
        p.localizationSource === "english" ||
        p.localizationSource === "english_fallback" ||
        (p.languageCode === "en" && p.localizationSource !== "brand_exception"),
    ).length;

    // Delivered pool must be fully localized; incomplete places were already dropped.
    // zh-TW: require enough complete places, zero delivered English, zero mixed leftover.
    if (
      primary.length < minPlaces ||
      deliveredEnglish > 0 ||
      (requireFullCoverage
        ? localizedPool.length < minPlaces || comboMixed > 0
        : comboCoverage < MIN_READABLE_RATIO_NON_ZH)
    ) {
      rejectedCombinationCount += 1;
      logAiPipeline(
        "[COMBINATION_LOCALIZATION_GATE]",
        `combinationId=${combo.combinationId}`,
        "status=rejected",
        `complete=${localizedPool.length}`,
        `raw=${pool.length}`,
        `coverage=${comboCoverage.toFixed(2)}`,
        `mixed=${comboMixed}`,
        `deliveredEnglish=${deliveredEnglish}`,
        `title=${combo.title}`,
      );
      continue;
    }

    const toCandidate = (p: LocalizedCombinationPlace): GateCombinationPlaceCandidate => ({
      name: p.localizedDisplayName,
      googlePlaceId: p.googlePlaceId,
      searchCandidateId: p.searchCandidateId,
      coordinates: p.coordinates,
      address: p.address,
      district: p.district,
      types: p.types,
      primaryType: p.primaryType,
      rating: p.rating,
      normalizedCategory: p.normalizedCategory,
      combinationId: p.combinationId,
      localizedDisplayName: p.localizedDisplayName,
      originalName: p.originalName,
      englishName: p.englishName,
      languageCode: p.languageCode,
      localizationSource: p.localizationSource,
      translationConfidence: p.translationConfidence,
    });

    const localizedTitle = isMechanicalCombinationTitle(combo.title)
      ? deriveCombinationThemeTitle(localizedPool, {
          locale,
          baseTitle: combo.title,
          usedTitles,
        })
      : localizeCombinationThemeTitle(combo.title, locale);
    usedTitles.add(localizedTitle);

    gated.push({
      ...combo,
      title: localizedTitle,
      placeCandidates: localizedPool.map(toCandidate),
      primaryCandidates: primary.map(toCandidate),
      fallbackCandidates: fallback.map(toCandidate),
    });
  }

  // Coverage of places that still need localization among inputs.
  // Delivered combinations are 100% complete by construction; leftover English was dropped.
  const localizationCoverage = totalPlaces === 0 ? 0 : completePlaces / totalPlaces;
  const readableRatio = localizationCoverage;
  const deliveredPlaceCount = gated.reduce(
    (n, c) => n + (c.placeCandidates?.length ?? 0),
    0,
  );
  const deliveredCoverage = deliveredPlaceCount === 0 ? 0 : 1;

  const ok =
    gated.length >= minCombos &&
    gated.every((c) => (c.primaryCandidates?.length ?? 0) >= minPlaces) &&
    (requireFullCoverage
      ? deliveredCoverage >= 1 && mixedLanguageCount === 0
      : readableRatio >= MIN_READABLE_RATIO_NON_ZH * 0.75);

  logAiPipeline(
    "[COMBINATION_LOCALIZATION_SUMMARY]",
    `effectiveAppLocale=${locale}`,
    `totalPlaces=${totalPlaces}`,
    `zhTwResolvedCount=${zhTwResolvedCount}`,
    `verifiedTranslationCount=${verifiedTranslationCount}`,
    `englishFallbackCount=${englishFallbackCount}`,
    `originalFallbackCount=${originalFallbackCount}`,
    `brandNameExceptionCount=${brandNameExceptionCount}`,
    `mixedLanguageCount=${mixedLanguageCount}`,
    `droppedForeignScript=${droppedForeignScript}`,
    `droppedUnreadable=${droppedUnreadable}`,
    `droppedEnglishFallback=${droppedEnglishFallback}`,
    `localizationCoverage=${localizationCoverage.toFixed(2)}`,
    `gatePass=${ok}`,
    `combinations=${gated.length}/${combinations.length}`,
  );

  logAiPipeline(
    "[COMBINATION_LOCALIZATION_GATE]",
    `status=${ok ? "pass" : "fail"}`,
    `locale=${locale}`,
    `combinations=${gated.length}/${combinations.length}`,
    `droppedForeignScript=${droppedForeignScript}`,
    `droppedUnreadable=${droppedUnreadable}`,
    `droppedEnglishFallback=${droppedEnglishFallback}`,
    `englishFallback=${englishFallbackCount}`,
    `originalFallback=${originalFallbackCount}`,
    `coverage=${localizationCoverage.toFixed(2)}`,
  );

  return {
    ok,
    combinations: gated,
    droppedForeignScript,
    droppedUnreadable,
    droppedEnglishFallback,
    englishFallbackCount,
    originalFallbackCount,
    verifiedTranslationCount,
    zhTwResolvedCount,
    brandNameExceptionCount,
    mixedLanguageCount,
    rejectedCombinationCount,
    localizationCoverage,
    readableRatio,
    reason: ok ? undefined : "incomplete_localization_for_app_locale",
  };
}

/** Localize a flat list of place-name strings for chat reply assembly. */
export function localizeCombinationPlaceNames(
  names: string[],
  locale: Locale = effectiveAppLocale(),
): string[] {
  const out: string[] = [];
  for (const name of names) {
    const resolved = resolvePlaceDisplayName(name, locale);
    const display = resolved.localizedDisplayName.trim();
    if (!display) continue;
    const complete = isCompleteLocalizationForLocale(
      {
        localizedDisplayName: display,
        localizationSource: resolved.localizationSource,
        languageCode: resolved.languageCode,
        originalName: resolved.originalName,
      },
      locale,
    );
    if (!complete.ok) continue;
    if (hasForeignLocalScript(display, locale)) continue;
    out.push(display);
  }
  return out;
}
