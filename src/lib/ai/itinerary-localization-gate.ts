/**
 * Itinerary Localization Gate — final-trip name SoT before save / delivery.
 *
 * UI may only show localizedDisplayName. Missing / foreign-script names are
 * repaired via resolvePlaceDisplayName(effectiveAppLocale) before gate recheck.
 */
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { RoamieItineraryItem } from "@/lib/ai/types";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import type { Locale } from "@/lib/i18n/types";
import {
  hasForeignLocalScript,
  hasLocalLatinDiacritics,
  isCompleteLocalizationForLocale,
  resolvePlaceDisplayName,
  type PlaceNameLocalizationSource,
} from "@/lib/place-display-name";

const HAS_CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

export type ItineraryLocalizationStopTrace = {
  day: number;
  order: number;
  placeId: string;
  originalName: string;
  persistedName: string;
  localizedDisplayName: string;
  requestedLocale: Locale;
  resolvedLanguage: string;
  localizationSource: PlaceNameLocalizationSource | string;
  translationConfidence?: number;
  renderedName: string;
  fallbackReason?: string;
  gateResult: "pass" | "repaired" | "english_fallback" | "original_fallback" | "foreign_script";
};

export type ItineraryLocalizationGateResult = {
  ok: boolean;
  items: RoamieItineraryItem[];
  totalStops: number;
  localizedStops: number;
  verifiedZhTwStops: number;
  verifiedTranslationStops: number;
  englishFallbackStops: number;
  originalFallbackStops: number;
  foreignScriptStops: number;
  mixedLanguageStops: number;
  localizationCoverage: number;
  gatePass: boolean;
  traces: ItineraryLocalizationStopTrace[];
  reason?: string;
};

function isDebug(): boolean {
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

function dayOf(item: RoamieItineraryItem): number {
  if (item.dayIndex != null && Number.isFinite(item.dayIndex)) {
    return Math.floor(item.dayIndex) + 1;
  }
  return 1;
}

function orderOf(item: RoamieItineraryItem, fallback: number): number {
  if (item.sortIndex != null && Number.isFinite(item.sortIndex)) return item.sortIndex;
  if (item.order != null && Number.isFinite(item.order)) return item.order;
  return fallback;
}

function localizeItem(
  item: RoamieItineraryItem,
  locale: Locale,
  order: number,
): { item: RoamieItineraryItem; trace: ItineraryLocalizationStopTrace } {
  const persistedName = (item.placeName || item.title || "").trim();
  const originalName = (item.originalName || item.placeName || item.title || "").trim();
  const placeId = (item.googlePlaceId ?? "").trim();

  const resolved = resolvePlaceDisplayName(
    {
      name: item.localizedDisplayName || persistedName,
      originalName: originalName || persistedName,
      englishName:
        item.localizationSource === "english" || item.localizationSource === "english_fallback"
          ? persistedName
          : undefined,
      placeId,
      canonicalPlaceId: placeId,
      types: item.types,
      primaryType: item.placeType,
    },
    locale,
  );

  const display = resolved.localizedDisplayName.trim();
  const complete = isCompleteLocalizationForLocale(resolved, locale);
  const foreign =
    hasForeignLocalScript(display, locale) || hasLocalLatinDiacritics(display);
  const mixed =
    HAS_CJK_RE.test(display) &&
    /[A-Za-z]{3,}/.test(display) &&
    resolved.localizationSource !== "brand_exception";

  let gateResult: ItineraryLocalizationStopTrace["gateResult"] = "pass";
  let fallbackReason: string | undefined;
  if (foreign) {
    gateResult = "foreign_script";
    fallbackReason = "foreign_local_script";
  } else if (!complete.ok) {
    if (
      resolved.localizationSource === "english" ||
      resolved.localizationSource === "english_fallback"
    ) {
      gateResult = "english_fallback";
    } else if (
      resolved.localizationSource === "original" ||
      resolved.localizationSource === "raw_name" ||
      resolved.localizationSource === "passthrough"
    ) {
      gateResult = "original_fallback";
    } else {
      gateResult = "repaired";
    }
    fallbackReason = complete.reason;
  } else if (display !== persistedName) {
    gateResult = "repaired";
  }

  const next: RoamieItineraryItem = {
    ...item,
    title: display || item.title,
    placeName: display || item.placeName,
    localizedDisplayName: display,
    originalName: resolved.originalName || originalName,
    languageCode: resolved.languageCode,
    localizationSource: resolved.localizationSource,
    translationConfidence: resolved.translationConfidence,
    brandNameException: resolved.brandNameException === true,
  };

  const trace: ItineraryLocalizationStopTrace = {
    day: dayOf(item),
    order: orderOf(item, order),
    placeId,
    originalName: resolved.originalName || originalName,
    persistedName,
    localizedDisplayName: display,
    requestedLocale: locale,
    resolvedLanguage: resolved.resolvedLanguage ?? resolved.languageCode,
    localizationSource: resolved.localizationSource,
    translationConfidence: resolved.translationConfidence,
    renderedName: display,
    fallbackReason,
    gateResult,
  };

  return { item: next, trace };
}

/**
 * Repair + gate itinerary stop names. Prefer auto-repair over hard fail.
 * For zh-TW: foreign-script stops must be 0 for gatePass.
 */
export function applyItineraryLocalizationGate(
  items: readonly RoamieItineraryItem[],
  opts?: { locale?: Locale; tripId?: string; softPassEnglish?: boolean },
): ItineraryLocalizationGateResult {
  const locale = opts?.locale ?? effectiveAppLocale();
  const traces: ItineraryLocalizationStopTrace[] = [];
  const out: RoamieItineraryItem[] = [];

  let verifiedZhTwStops = 0;
  let verifiedTranslationStops = 0;
  let englishFallbackStops = 0;
  let originalFallbackStops = 0;
  let foreignScriptStops = 0;
  let mixedLanguageStops = 0;
  let localizedStops = 0;

  items.forEach((item, idx) => {
    const { item: next, trace } = localizeItem(item, locale, idx);
    out.push(next);
    traces.push(trace);

    const display = trace.localizedDisplayName;
    if (display && !hasForeignLocalScript(display, locale) && !hasLocalLatinDiacritics(display)) {
      localizedStops += 1;
    }
    if (
      trace.localizationSource === "google_zh_TW" ||
      trace.localizationSource === "google_zh_Hant" ||
      trace.localizationSource === "google_locale"
    ) {
      verifiedZhTwStops += 1;
    }
    if (
      trace.localizationSource === "verified_zh" ||
      trace.localizationSource === "canonical_zh" ||
      trace.localizationSource === "brand_exception"
    ) {
      verifiedTranslationStops += 1;
    }
    if (
      trace.localizationSource === "english" ||
      trace.localizationSource === "english_fallback"
    ) {
      englishFallbackStops += 1;
    }
    if (
      trace.localizationSource === "original" ||
      trace.localizationSource === "raw_name" ||
      trace.localizationSource === "passthrough"
    ) {
      originalFallbackStops += 1;
    }
    if (trace.gateResult === "foreign_script") foreignScriptStops += 1;
    if (
      HAS_CJK_RE.test(display) &&
      /[A-Za-z]{3,}/.test(display) &&
      trace.localizationSource !== "brand_exception"
    ) {
      mixedLanguageStops += 1;
    }

    if (isDebug()) {
      logAiPipeline(
        "[ITINERARY_PLACE_LOCALIZATION_TRACE]",
        `day=${trace.day}`,
        `order=${trace.order}`,
        `placeId=${trace.placeId}`,
        `originalName=${trace.originalName}`,
        `persistedName=${trace.persistedName}`,
        `localizedDisplayName=${trace.localizedDisplayName}`,
        `requestedLocale=${trace.requestedLocale}`,
        `resolvedLanguage=${trace.resolvedLanguage}`,
        `localizationSource=${trace.localizationSource}`,
        `renderedName=${trace.renderedName}`,
        `fallbackReason=${trace.fallbackReason ?? ""}`,
        `gateResult=${trace.gateResult}`,
      );
      logAiPipeline(
        "[PLACE_DISPLAY_NAME_TRACE]",
        `placeId=${trace.placeId}`,
        `originalName=${trace.originalName}`,
        `localizedDisplayName=${trace.localizedDisplayName}`,
        `requestedLocale=${trace.requestedLocale}`,
        `localizationSource=${trace.localizationSource}`,
        `translationConfidence=${trace.translationConfidence ?? ""}`,
        `finalDisplayedName=${trace.renderedName}`,
      );
    }
  });

  const totalStops = out.length;
  const localizationCoverage = totalStops > 0 ? localizedStops / totalStops : 1;

  const zhStrict = locale === "zh-TW";
  const missingLocalized = out.filter((i) => !(i.localizedDisplayName ?? "").trim()).length;
  const gatePass = zhStrict
    ? foreignScriptStops === 0 &&
      missingLocalized === 0 &&
      localizationCoverage >= 1 &&
      englishFallbackStops + originalFallbackStops === 0 &&
      mixedLanguageStops === 0
    : foreignScriptStops === 0 && missingLocalized === 0 && localizationCoverage >= 0.9;

  const result: ItineraryLocalizationGateResult = {
    ok: gatePass,
    items: out,
    totalStops,
    localizedStops,
    verifiedZhTwStops,
    verifiedTranslationStops,
    englishFallbackStops,
    originalFallbackStops,
    foreignScriptStops,
    mixedLanguageStops,
    localizationCoverage,
    gatePass,
    traces,
    reason: gatePass
      ? undefined
      : `foreign=${foreignScriptStops};english=${englishFallbackStops};original=${originalFallbackStops};coverage=${localizationCoverage.toFixed(2)}`,
  };

  if (!gatePass) {
    for (const trace of traces.filter((entry) => entry.gateResult !== "pass" && entry.gateResult !== "repaired")) {
      logAiPipeline(
        "[PLACE_LOCALIZATION_INCOMPLETE]",
        `day=${trace.day}`,
        `placeId=${trace.placeId}`,
        `placeName=${trace.localizedDisplayName}`,
        `localizationSource=${trace.localizationSource}`,
        `resolvedLanguage=${trace.resolvedLanguage}`,
        `reason=${trace.fallbackReason ?? trace.gateResult}`,
        "action=replan_or_replace",
      );
    }
  }

  logAiPipeline(
    "[ITINERARY_LOCALIZATION_SUMMARY]",
    `tripId=${opts?.tripId ?? ""}`,
    `effectiveAppLocale=${locale}`,
    `totalStops=${totalStops}`,
    `localizedStops=${localizedStops}`,
    `verifiedTranslationStops=${verifiedTranslationStops}`,
    `englishFallbackStops=${englishFallbackStops}`,
    `originalFallbackStops=${originalFallbackStops}`,
    `foreignScriptStops=${foreignScriptStops}`,
    `mixedLanguageStops=${mixedLanguageStops}`,
    `localizationCoverage=${localizationCoverage.toFixed(3)}`,
    `gatePass=${gatePass}`,
  );

  return result;
}
