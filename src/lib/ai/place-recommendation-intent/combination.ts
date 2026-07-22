/**
 * Combination-selection grammar vs place-intent bypass.
 *
 * Only messages that match combination selection grammar may enter
 * combination selection while pending combination_choice.
 * Explicit place recommendation intent always bypasses.
 */
import {
  isUserAllOrAutoCombinationReply,
  parseCombinationSelectionIndices,
  resolveSelectedCombinations,
} from "@/lib/ai/destination-combination-suggestions";
import {
  hasExplicitPlaceRecommendationIntent,
  parsePlaceRecommendationIntent,
} from "@/lib/ai/place-recommendation-intent/parse";
import type { PlaceRecommendationIntent } from "@/lib/ai/place-recommendation-intent/types";

const COMBINATION_GENERATE_RE =
  /^(可以)?幫我生成|就照這些安排|就照這樣安排|照這些安排|混搭全部|幫我混搭|^都要$|^全都要$/i;

const COMBINATION_TITLE_HINT_RE =
  /經典|慢遊|文化|博物館|藝文|地標|歷史|自然|美食|夜景|組合/;

/**
 * True when the message is a combination selection reply (numbers / all / titles / generate).
 * Must NOT match place recommendation requests.
 */
export function isCombinationSelectionGrammar(
  text: string,
  opts?: {
    combinationCount?: number;
    destination?: string;
  },
): boolean {
  const t = text.trim();
  if (!t) return false;

  // Place intent never counts as combination grammar
  if (hasExplicitPlaceRecommendationIntent(t)) return false;

  if (isUserAllOrAutoCombinationReply(t) || COMBINATION_GENERATE_RE.test(t)) {
    return true;
  }

  const count = Math.max(1, opts?.combinationCount ?? 8);
  const indices = parseCombinationSelectionIndices(t, count);
  if (indices.length > 0) {
    // Bare / listed numbers or 「選 1 和 3」
    if (/^[\d\s、,，和跟與選选第組个個]+$/.test(t.replace(/\s+/g, ""))) return true;
    if (/(?:選|选|第|組|组)/.test(t) && indices.length > 0) return true;
    // Pure number list like「1、2」
    if (/^\d+(?:\s*[、,，和跟與]\s*\d+)*$/.test(t)) return true;
  }

  if (opts?.destination) {
    const resolved = resolveSelectedCombinations(opts.destination, t);
    if (resolved?.titles.length) return true;
  }

  // Soft title-style without destination allowlist
  if (COMBINATION_TITLE_HINT_RE.test(t) && t.length <= 24 && !/推薦|推荐|想吃|有嗎|有吗/.test(t)) {
    return true;
  }

  return false;
}

export function shouldBypassCombinationPending(
  text: string,
  opts?: {
    hasActiveRecommendationContext?: boolean;
  },
): { bypass: boolean; intent: PlaceRecommendationIntent | null; reason?: string } {
  const intent = parsePlaceRecommendationIntent(text, {
    hasActiveRecommendationContext: opts?.hasActiveRecommendationContext,
  });
  if (intent && hasExplicitPlaceRecommendationIntent(text, opts)) {
    return {
      bypass: true,
      intent,
      reason: "explicit_place_recommendation_intent",
    };
  }
  return { bypass: false, intent: null };
}

export function logCombinationPendingBypassed(
  message: string,
  intent: PlaceRecommendationIntent,
  reason = "explicit_place_recommendation_intent",
): void {
  console.info(
    "[COMBINATION_PENDING_BYPASSED]",
    `message=${message.trim().slice(0, 80)}`,
    `reason=${reason}`,
    `detectedIntent=${intent.primaryType}`,
    `detectedSubtype=${intent.subtypes.join(",")}`,
  );
}
