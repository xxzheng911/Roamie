import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import {
  coerceTravelDestination,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";
import {
  hasCategoryPlaceQuery,
  isPlaceRecommendationQuery,
} from "@/lib/ai/chat-place-category-types";
import { logChatPlaceDestination } from "@/lib/ai/chat-place-flow-log";
import { resolveDestinationAreaScope } from "@/lib/ai/destination-travel-profile";

function acceptCategorySearchDestination(label: string | undefined): string | undefined {
  if (!label?.trim()) return undefined;
  const coerced = coerceTravelDestination(label);
  if (coerced) {
    logChatPlaceDestination(coerced, "context");
    return coerced;
  }
  return undefined;
}

/** 類別地點搜尋用目的地解析 — 獨立模組，避免 travel-context 循環 import */
export function resolveDestinationForCategorySearch(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText?: string,
): string | undefined {
  // 1. Explicit city/region in this message wins over trip context
  if (userText?.trim()) {
    const areaScope = resolveDestinationAreaScope(userText);
    const fromText = acceptCategorySearchDestination(
      areaScope?.displayLabel ?? resolveDestinationFromText(userText),
    );
    if (fromText) {
      logChatPlaceDestination(fromText, "user_text");
      return fromText;
    }
  }

  const fromCtx = acceptCategorySearchDestination(ctx.destination?.trim());
  if (fromCtx) return fromCtx;

  const candidates = [
    session.travelContext?.destination,
    session.tripPlanningContext?.destination,
    session.tripDestination?.city,
    session.tripDestination?.displayLabel,
    session.preferredArea,
  ];
  for (const c of candidates) {
    const label = acceptCategorySearchDestination(c?.trim());
    if (label) {
      logChatPlaceDestination(label, "session");
      return label;
    }
  }

  return undefined;
}

/** 目的地 + 類別地點查詢 — 必須直接搜尋實際地點 */
export function isDestinationCategoryPlaceRequest(
  userText: string,
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): boolean {
  const t = userText.trim();
  if (!t || !hasCategoryPlaceQuery(t)) return false;
  return Boolean(resolveDestinationForCategorySearch(ctx, session, t));
}

/** 類別地點推薦 intent（含無目的地時仍鎖定類別，但需另問目的地） */
export function isPlaceCategoryRecommendationRequest(userText: string): boolean {
  return isPlaceRecommendationQuery(userText);
}
