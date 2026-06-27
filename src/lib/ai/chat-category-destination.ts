import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { resolveDestinationFromText } from "@/lib/ai/trip-planning-context";
import {
  hasCategoryPlaceQuery,
  isPlaceRecommendationQuery,
} from "@/lib/ai/chat-place-category-types";
import { logChatPlaceDestination } from "@/lib/ai/chat-place-flow-log";

/** 類別地點搜尋用目的地解析 — 獨立模組，避免 travel-context 循環 import */
export function resolveDestinationForCategorySearch(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText?: string,
): string | undefined {
  const fromCtx = ctx.destination?.trim();
  if (fromCtx) {
    logChatPlaceDestination(fromCtx, "context");
    return fromCtx;
  }

  const candidates = [
    session.travelContext?.destination,
    session.tripPlanningContext?.destination,
    session.tripDestination?.city,
    session.tripDestination?.displayLabel,
    session.preferredArea,
  ];
  for (const c of candidates) {
    const label = c?.trim();
    if (label) {
      logChatPlaceDestination(label, "session");
      return label;
    }
  }

  if (userText?.trim()) {
    const fromText = resolveDestinationFromText(userText);
    if (fromText) {
      logChatPlaceDestination(fromText, "user_text");
      return fromText;
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
