/**
 * Combination Localization Repair / Display Gate.
 *
 * Localizes place display names before combination delivery.
 * Every delivered place must be complete in the App locale (or an explicit brand exception).
 *
 * Reject only when the name is empty, Plus Code-only, unreadable symbols,
 * foreign-script with no English repair, or otherwise undeliverable.
 *
 * localizationCoverage is a display-quality metric — not combo life/death.
 */
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  deriveCombinationThemeTitle,
  isMechanicalCombinationTitle,
  localizeCombinationThemeTitle,
} from "@/lib/ai/combination-theme-titles";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import type { Locale } from "@/lib/i18n/types";
import { resolvePlaceCategoryFamily } from "@/lib/ai/place-category-family";
import type { PlaceResult } from "@/lib/place-result";
import {
  hasForeignLocalScript,
  isCompleteLocalizationForLocale,
  isDeliverablePlaceNameForLocale,
  isPlusCodeOnlyName,
  isReadablePlaceNameForLocale,
  isUnreadablePlaceName,
  resolvePlaceDisplayName,
  type PlaceLocalizationStatus,
  type PlaceNameLocalizationSource,
} from "@/lib/place-display-name";

const HAS_CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const HAS_LATIN_RE = /[A-Za-z]/;

/** Soft floor for non-zh locales: fraction of places with a readable display name. */
const MIN_READABLE_RATIO_NON_ZH = 0.8;

/** Absolute minimum combinations for trip delivery (degradation floor). */
const ABSOLUTE_MIN_COMBINATIONS = 2;

export type CombinationPlaceLocalizationFields = {
  localizedDisplayName?: string;
  originalName?: string;
  languageCode?: string;
  localizationSource?: PlaceNameLocalizationSource | string;
  englishName?: string;
  translationConfidence?: number;
  brandNameException?: boolean;
  localizationStatus?: PlaceLocalizationStatus;
  isReadableFallback?: boolean;
  effectiveDisplayName?: string;
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
  localizationStatus?: PlaceLocalizationStatus;
  localizationCoverage?: number;
};

export type LocalizedCombinationPlace = GateCombinationPlaceCandidate & {
  localizedDisplayName: string;
  effectiveDisplayName: string;
  originalName: string;
  languageCode: string;
  localizationSource: PlaceNameLocalizationSource;
  englishName?: string;
  translationConfidence?: number;
  localizationStatus: PlaceLocalizationStatus;
  isReadableFallback: boolean;
};

export type CombinationLocalizationGateResult = {
  /** @deprecated Prefer tripCombinationDeliveryPass — kept for callers. */
  ok: boolean;
  combinations: GateStructuredCombinationOption[];
  droppedForeignScript: number;
  droppedUnreadable: number;
  /** Always 0 after Repair Gate — English fallback is retained. */
  droppedEnglishFallback: number;
  englishFallbackCount: number;
  originalFallbackCount: number;
  verifiedTranslationCount: number;
  zhTwResolvedCount: number;
  brandNameExceptionCount: number;
  mixedLanguageCount: number;
  rejectedCombinationCount: number;
  localizationCompleteCount: number;
  localizationPartialCount: number;
  unreadableRejectedCount: number;
  localizationCoverage: number;
  readableRatio: number;
  localizationDisplayPass: boolean;
  minimumCombinationCountPass: boolean;
  placeQualityPass: boolean;
  tripCombinationDeliveryPass: boolean;
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
  localizationStatus: PlaceLocalizationStatus;
  gateResult: "pass" | "repaired" | "partial" | "fail";
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
    `localizationStatus=${entry.localizationStatus}`,
    `gateResult=${entry.gateResult}`,
    `reason=${entry.reason}`,
  );
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
    const n = p.effectiveDisplayName || p.localizedDisplayName;
    if (HAS_CJK_RE.test(n) && !HAS_LATIN_RE.test(n)) cjk += 1;
    else if (HAS_LATIN_RE.test(n) && !HAS_CJK_RE.test(n)) latinOnly += 1;
    else if (HAS_CJK_RE.test(n) && HAS_LATIN_RE.test(n)) {
      if (p.localizationSource !== "brand_exception") cjk += 1;
    }
  }
  return cjk > 0 && latinOnly > 0 ? latinOnly : 0;
}

function comboLocalizationStatus(
  places: LocalizedCombinationPlace[],
): PlaceLocalizationStatus {
  if (!places.length) return "fallback";
  if (places.every((p) => p.localizationStatus === "complete")) return "complete";
  if (places.some((p) => p.localizationStatus === "complete")) return "partial";
  if (places.every((p) => p.localizationStatus === "partial")) return "partial";
  return "fallback";
}

/** Repair a single place name for display without dropping a valid real place solely for language. */
function localizeCandidate(
  candidate: GateCombinationPlaceCandidate,
  locale: Locale,
): LocalizedCombinationPlace | null {
  const originalName = (candidate.originalName ?? candidate.name ?? "").trim();
  if (!originalName || isUnreadablePlaceName(originalName)) {
    if (originalName) {
      logPlaceTrace({
        placeId: candidate.googlePlaceId,
        canonicalPlaceId: candidate.googlePlaceId,
        rawName: originalName,
        englishName: candidate.englishName,
        requestedLocale: locale,
        resolvedName: "",
        resolvedLanguage: "und",
        localizationSource: "raw_name",
        localizationStatus: "fallback",
        gateResult: "fail",
        reason: isPlusCodeOnlyName(originalName) ? "plus_code_only" : "unreadable_symbols",
      });
    }
    return null;
  }

  let resolved = resolvePlaceDisplayName(
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

  let display = resolved.localizedDisplayName.trim();
  let localizationSource = resolved.localizationSource;
  let languageCode = resolved.languageCode;

  // Repair: foreign script → English when available.
  if (display && hasForeignLocalScript(display, locale)) {
    const english = (
      resolved.englishName ||
      candidate.englishName ||
      (HAS_LATIN_RE.test(originalName) && !hasForeignLocalScript(originalName, locale)
        ? originalName
        : "")
    ).trim();
    if (english && isReadablePlaceNameForLocale(english, locale)) {
      display = english;
      localizationSource = "english_fallback";
      languageCode = "en";
      resolved = {
        ...resolved,
        localizedDisplayName: english,
        englishName: english,
        localizationSource: "english_fallback",
        languageCode: "en",
        translationConfidence: 0,
      };
    }
  }

  if (!display) {
    logPlaceTrace({
      placeId: candidate.googlePlaceId,
      canonicalPlaceId: candidate.googlePlaceId,
      rawName: originalName,
      englishName: resolved.englishName ?? candidate.englishName,
      requestedLocale: locale,
      resolvedName: "",
      resolvedLanguage: languageCode,
      localizationSource,
      translationConfidence: resolved.translationConfidence,
      localizationStatus: "fallback",
      gateResult: "fail",
      reason: "empty_display_name",
    });
    return null;
  }

  const deliverable = isDeliverablePlaceNameForLocale(
    {
      localizedDisplayName: display,
      localizationSource,
      languageCode,
      originalName,
      englishName: resolved.englishName ?? candidate.englishName,
    },
    locale,
  );

  if (!deliverable.ok) {
    logPlaceTrace({
      placeId: candidate.googlePlaceId,
      canonicalPlaceId: candidate.googlePlaceId,
      rawName: originalName,
      englishName: resolved.englishName ?? candidate.englishName,
      requestedLocale: locale,
      resolvedName: display,
      resolvedLanguage: languageCode,
      localizationSource,
      translationConfidence: resolved.translationConfidence,
      localizationStatus: deliverable.status,
      gateResult: "fail",
      reason: deliverable.reason ?? "undeliverable",
    });
    return null;
  }

  const complete = isCompleteLocalizationForLocale(
    {
      localizedDisplayName: display,
      localizationSource,
      languageCode,
      originalName,
    },
    locale,
  );
  const explicitBrandException =
    localizationSource === "brand_exception" && resolved.brandNameException === true;
  if (locale === "zh-TW" && !complete.ok && !explicitBrandException) {
    logAiPipeline(
      "[PLACE_LOCALIZATION_INCOMPLETE]",
      `placeId=${candidate.googlePlaceId ?? ""}`,
      `placeName=${display}`,
      `localizationSource=${localizationSource}`,
      `resolvedLanguage=${languageCode}`,
      `translationConfidence=${resolved.translationConfidence ?? 0}`,
      `reason=${complete.reason ?? "incomplete"}`,
      "action=keep_with_warning",
    );
  }
  const status = deliverable.status;
  const isReadableFallback = status !== "complete";
  const gateResult: "pass" | "repaired" | "partial" =
    status === "complete"
      ? "pass"
      : deliverable.reason === "repaired_to_english"
        ? "repaired"
        : "partial";

  logPlaceTrace({
    placeId: candidate.googlePlaceId,
    canonicalPlaceId: candidate.googlePlaceId,
    rawName: originalName,
    englishName: resolved.englishName ?? candidate.englishName,
    requestedLocale: locale,
    resolvedName: display,
    resolvedLanguage: languageCode,
    localizationSource,
    translationConfidence: resolved.translationConfidence,
    localizationStatus: status,
    gateResult,
    reason: complete.ok ? "localized" : (deliverable.reason ?? "readable_fallback"),
  });

  return {
    name: display,
    localizedDisplayName: display,
    effectiveDisplayName: display,
    originalName: resolved.originalName || originalName,
    englishName: resolved.englishName ?? candidate.englishName,
    languageCode,
    localizationSource,
    translationConfidence: resolved.translationConfidence,
    brandNameException: explicitBrandException,
    localizationStatus: status,
    isReadableFallback,
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

/**
 * Localize + soft-validate combination options for the effective App locale.
 * Repairs names; keeps readable English fallback; never rejects a combo solely
 * for partial localization / english_fallback / translationConfidence=0.
 */
export function applyCombinationLocalizationGate(
  combinations: GateStructuredCombinationOption[],
  opts?: {
    locale?: Locale;
    minPlacesPerCombo?: number;
    minCombinations?: number;
    /** Preferred combination count (soft target; degradation may deliver fewer). */
    preferredCombinations?: number;
  },
): CombinationLocalizationGateResult {
  const locale = opts?.locale ?? effectiveAppLocale();
  const minPlaces = opts?.minPlacesPerCombo ?? 2;
  const minCombos = opts?.minCombinations ?? ABSOLUTE_MIN_COMBINATIONS;
  const preferredCombos = opts?.preferredCombinations ?? Math.max(minCombos, 3);

  let droppedForeignScript = 0;
  let droppedUnreadable = 0;
  const droppedEnglishFallback = 0;
  let englishFallbackCount = 0;
  let originalFallbackCount = 0;
  let verifiedTranslationCount = 0;
  let zhTwResolvedCount = 0;
  let brandNameExceptionCount = 0;
  let mixedLanguageCount = 0;
  let rejectedCombinationCount = 0;
  let localizationCompleteCount = 0;
  let localizationPartialCount = 0;
  let unreadableRejectedCount = 0;
  let totalPlaces = 0;
  let validRealPlaceCount = 0;

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
          droppedUnreadable += 1;
        }
        unreadableRejectedCount += 1;
        continue;
      }

      validRealPlaceCount += 1;
      if (localized.localizationStatus === "complete") localizationCompleteCount += 1;
      else localizationPartialCount += 1;

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
      if (
        localized.localizationSource === "original" ||
        localized.localizationSource === "raw_name" ||
        localized.localizationSource === "passthrough"
      ) {
        originalFallbackCount += 1;
      }
      localizedPool.push(localized);
    }

    mixedLanguageCount += countMixedLanguage(localizedPool);

    // Prefer locale-tier names first, then brand, then readable English.
    localizedPool.sort((a, b) => {
      const ta = scriptTier(a.localizationSource, a.languageCode);
      const tb = scriptTier(b.localizationSource, b.languageCode);
      const rank = (t: "locale" | "brand" | "english" | "other") =>
        t === "locale" ? 0 : t === "brand" ? 1 : t === "english" ? 2 : 3;
      return rank(ta) - rank(tb);
    });

    // Combination-level hard diversity: representative places may not repeat a
    // normalized capped family (park/garden, wildlife, museum, market, viewpoint,
    // cafe or shopping). Fallbacks remain available for later replacement.
    const cappedFamilies = new Set([
      "park_family", "wildlife_family", "museum_family", "market_family",
      "viewpoint_family", "cafe", "shopping",
    ]);
    const usedFamilies = new Set<string>();
    const primary: LocalizedCombinationPlace[] = [];
    const fallback: LocalizedCombinationPlace[] = [];
    for (const place of localizedPool) {
      const family = resolvePlaceCategoryFamily(place as unknown as PlaceResult);
      if (
        primary.length < 3 &&
        (!cappedFamilies.has(family) || !usedFamilies.has(family))
      ) {
        primary.push(place);
        if (cappedFamilies.has(family)) usedFamilies.add(family);
      } else {
        fallback.push(place);
      }
    }

    const comboCoverage =
      pool.length === 0 ? 0 : localizedPool.length / Math.max(1, pool.length);
    const locStatus = comboLocalizationStatus(localizedPool);

    // Delivery: real place count only — NOT localization completeness.
    const placeValidityPass = localizedPool.length >= minPlaces;
    const tourismQualityPass = primary.length >= minPlaces;
    const rejected = !placeValidityPass || !tourismQualityPass;
    // Soft reasons that must NEVER reject a combination.
    const softOnlyReasons = [
      "english_fallback",
      "partial_localization",
      "translationConfidence=0",
      "incomplete_source:english_fallback",
    ];
    void softOnlyReasons;

    if (rejected) {
      rejectedCombinationCount += 1;
      const rejectionReason = !placeValidityPass
        ? `real_places_below_minimum:${localizedPool.length}<${minPlaces}`
        : `primary_places_below_minimum:${primary.length}<${minPlaces}`;
      logAiPipeline(
        "[COMBINATION_REJECTION_TRACE]",
        `combinationId=${combo.combinationId}`,
        `theme=${combo.theme}`,
        `realPlaceCount=${localizedPool.length}`,
        `placeValidityPass=${placeValidityPass}`,
        `tourismQualityPass=${tourismQualityPass}`,
        `localizationStatus=${locStatus}`,
        `localizationCoverage=${comboCoverage.toFixed(2)}`,
        "rejected=true",
        `rejectionReason=${rejectionReason}`,
      );
      logAiPipeline(
        "[COMBINATION_LOCALIZATION_GATE]",
        `combinationId=${combo.combinationId}`,
        "status=rejected",
        `complete=${localizationCompleteCount}`,
        `partial=${localizedPool.filter((p) => p.localizationStatus === "partial").length}`,
        `raw=${pool.length}`,
        `coverage=${comboCoverage.toFixed(2)}`,
        `localizationStatus=${locStatus}`,
        `title=${combo.title}`,
        `reason=${rejectionReason}`,
      );
      continue;
    }

    logAiPipeline(
      "[COMBINATION_REJECTION_TRACE]",
      `combinationId=${combo.combinationId}`,
      `theme=${combo.theme}`,
      `realPlaceCount=${localizedPool.length}`,
      "placeValidityPass=true",
      "tourismQualityPass=true",
      `localizationStatus=${locStatus}`,
      `localizationCoverage=${comboCoverage.toFixed(2)}`,
      "rejected=false",
      "rejectionReason=",
    );

    const toCandidate = (p: LocalizedCombinationPlace): GateCombinationPlaceCandidate => ({
      name: p.effectiveDisplayName,
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
      effectiveDisplayName: p.effectiveDisplayName,
      originalName: p.originalName,
      englishName: p.englishName,
      languageCode: p.languageCode,
      localizationSource: p.localizationSource,
      translationConfidence: p.translationConfidence,
      localizationStatus: p.localizationStatus,
      isReadableFallback: p.isReadableFallback,
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
      localizationStatus: locStatus,
      localizationCoverage: comboCoverage,
    });
  }

  const localizationCoverage =
    totalPlaces === 0 ? 0 : localizationCompleteCount / totalPlaces;
  const readableRatio =
    totalPlaces === 0 ? 0 : validRealPlaceCount / totalPlaces;

  // Display pass: every retained place has a readable name (by construction).
  const localizationDisplayPass =
    gated.length === 0
      ? false
      : gated.every((c) =>
          (c.placeCandidates ?? []).every((p) => {
            const name = (p.effectiveDisplayName || p.localizedDisplayName || p.name || "").trim();
            return Boolean(name) && isReadablePlaceNameForLocale(name, locale);
          }),
        ) &&
        (locale === "zh-TW" ? true : readableRatio >= MIN_READABLE_RATIO_NON_ZH * 0.75);

  const placeQualityPass =
    validRealPlaceCount >= minPlaces * ABSOLUTE_MIN_COMBINATIONS && gated.length > 0;

  const minimumCombinationCountPass = gated.length >= minCombos;
  const preferredCombinationCountPass = gated.length >= preferredCombos;

  // Trip delivery: quality + absolute minimum combo count (not localization completeness).
  const tripCombinationDeliveryPass = placeQualityPass && minimumCombinationCountPass;

  // Legacy `ok` mirrors trip delivery (not localization completeness).
  const ok = tripCombinationDeliveryPass;

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
    `localizationCompleteCount=${localizationCompleteCount}`,
    `localizationPartialCount=${localizationPartialCount}`,
    `localizationCoverage=${localizationCoverage.toFixed(2)}`,
    `localizationDisplayPass=${localizationDisplayPass}`,
    `minimumCombinationCountPass=${minimumCombinationCountPass}`,
    `preferredCombinationCountPass=${preferredCombinationCountPass}`,
    `placeQualityPass=${placeQualityPass}`,
    `tripCombinationDeliveryPass=${tripCombinationDeliveryPass}`,
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
    `localizationDisplayPass=${localizationDisplayPass}`,
    `minimumCombinationCountPass=${minimumCombinationCountPass}`,
    `tripCombinationDeliveryPass=${tripCombinationDeliveryPass}`,
  );

  logAiPipeline(
    "[COMBINATION_DELIVERY_SUMMARY]",
    `destination=`,
    `tripDays=`,
    `candidatePlaceCount=${totalPlaces}`,
    `validRealPlaceCount=${validRealPlaceCount}`,
    `qualityRejectedCount=${unreadableRejectedCount}`,
    `localizationCompleteCount=${localizationCompleteCount}`,
    `localizationPartialCount=${localizationPartialCount}`,
    `englishFallbackCount=${englishFallbackCount}`,
    `unreadableRejectedCount=${unreadableRejectedCount}`,
    `combinationTargetCount=${preferredCombos}`,
    `combinationBuiltCount=${combinations.length}`,
    `combinationDeliveredCount=${gated.length}`,
    `deliveryPass=${tripCombinationDeliveryPass}`,
    `failureReason=${ok ? "" : !placeQualityPass ? "place_quality_insufficient" : "minimum_combination_count"}`,
  );
  logAiPipeline(
    "[COMBINATION_PIPELINE_SUMMARY]",
    "destination=",
    `candidateCount=${totalPlaces}`,
    `localizedCount=${localizationCompleteCount + localizationPartialCount}`,
    `rejectedForLocalization=${droppedForeignScript + droppedUnreadable}`,
    `finalCombinationCount=${gated.length}`,
    `failureStage=${ok ? "" : !placeQualityPass ? "quality" : "minimum_combination_count"}`,
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
    localizationCompleteCount,
    localizationPartialCount,
    unreadableRejectedCount,
    localizationCoverage,
    readableRatio,
    localizationDisplayPass,
    minimumCombinationCountPass,
    placeQualityPass,
    tripCombinationDeliveryPass,
    reason: ok
      ? undefined
      : !placeQualityPass
        ? "place_quality_insufficient"
        : "minimum_combination_count",
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
    let display = resolved.localizedDisplayName.trim();
    if (!display) continue;

    if (hasForeignLocalScript(display, locale)) {
      const english = (resolved.englishName ?? "").trim();
      if (english && isReadablePlaceNameForLocale(english, locale)) {
        display = english;
      } else {
        continue;
      }
    }

    const deliverable = isDeliverablePlaceNameForLocale(
      {
        localizedDisplayName: display,
        localizationSource:
          display === resolved.localizedDisplayName
            ? resolved.localizationSource
            : "english_fallback",
        languageCode:
          display === resolved.localizedDisplayName ? resolved.languageCode : "en",
        originalName: resolved.originalName,
        englishName: resolved.englishName,
      },
      locale,
    );
    if (!deliverable.ok) continue;
    out.push(display);
  }
  return out;
}
