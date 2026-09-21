import {
  classifyRecommendationBadgeToken,
  projectRecommendationBadge,
} from "@/lib/ai/recommendation-badge-display";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/types";

/** Only for new client-generated copy. Never apply to history, user input or place names. */
export function chatRuntimeCopy(
  key: string,
  locale: Locale = effectiveAppLocale(),
  vars?: Record<string, string | number>,
): string {
  return translate(locale, `chatRuntime.${key}`, vars);
}

export function isChatRuntimeCopy(text: string, key: string): boolean {
  return (["zh-TW", "en", "ja", "ko"] as const).some(
    (locale) => text === chatRuntimeCopy(key, locale),
  );
}

export function isChatRuntimeCopyPrefix(text: string, key: string): boolean {
  return (["zh-TW", "en", "ja", "ko"] as const).some((locale) => {
    const copy = chatRuntimeCopy(key, locale);
    return text === copy || text.startsWith(copy);
  });
}

/**
 * Projects an already-selected badge semantic into the active locale.
 * Known internal routing tokens never fall back to their raw label.
 * Unclassified text is user or external content and stays unchanged.
 */
export function chatMoodDisplay(value: string, locale: Locale): string {
  const classified = classifyRecommendationBadgeToken(value);
  if (!classified) return value;
  if (!classified.displayable) return "";
  return projectRecommendationBadge(classified.key, locale);
}

export type ChatLoadingPhase = "recommendations" | "planning" | "itinerary_route_recommendation";
export function chatLoadingCopy(phase: ChatLoadingPhase, locale: Locale): string {
  return chatRuntimeCopy(`loading_${phase}`, locale);
}
