import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { hasActiveTripPlanningSession } from "@/lib/ai/chat-planning-state";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  resolveTripStyleFromContext,
  tripStyleDisplayTag,
  type TripStyleKey,
} from "@/lib/ai/ai-trip-style";

/** 目的地快捷分類標籤 — 行程規劃中不可覆蓋風格標籤 */
const DESTINATION_SHORTCUT_TAGS = new Set([
  "動漫購物",
  "美食咖啡",
  "經典景點",
  "美食文化",
  "自然風光",
  "商圈購物",
  "城市散策",
]);

export function logAiStyleTagResolved(label: string, style: TripStyleKey): void {
  logAiPipeline("[AI_STYLE_TAG_RESOLVED]", `label=${label}`, `style=${style}`);
}

export function logAiTagContextSource(source: string): void {
  logAiPipeline("[AI_TAG_CONTEXT_SOURCE]", `source=${source}`);
}

export function resolveRecommendationStyleTag(
  session: ChatPlanningSession,
  context?: CanonicalTravelContext,
): string {
  const travel = context ?? session.travelContext ?? { interests: [] };
  const inPlanning = hasActiveTripPlanningSession(session, travel);
  const style = resolveTripStyleFromContext(travel, session);

  if (inPlanning || travel.planningTripStyle || travel.mustVisitGenerated) {
    if (style) {
      const label = tripStyleDisplayTag(style);
      logAiStyleTagResolved(label, style);
      logAiTagContextSource(inPlanning ? "activePlanningSession" : "planningTripStyle");
      return label;
    }
  }

  if (style && (travel.planningTripStyle || travel.selectedTripStyle)) {
    const label = tripStyleDisplayTag(style);
    logAiStyleTagResolved(label, style);
    logAiTagContextSource("planningTripStyle");
    return label;
  }

  if (!inPlanning && !travel.mustVisitGenerated) {
    if (session.fromMoodCard || session.fromMoodFlow) {
      const mood = session.selectedMood?.trim() || session.mood?.trim();
      if (mood && !DESTINATION_SHORTCUT_TAGS.has(mood)) {
        logAiTagContextSource("moodCard");
        return mood;
      }
    }

    const mood = session.selectedMood?.trim() || travel.mood?.trim() || session.mood?.trim();
    if (mood && !DESTINATION_SHORTCUT_TAGS.has(mood)) {
      logAiTagContextSource("sessionMood");
      return mood;
    }
  }

  if (style) {
    const label = tripStyleDisplayTag(style);
    logAiStyleTagResolved(label, style);
    logAiTagContextSource("tripStyleFallback");
    return label;
  }

  logAiTagContextSource("none");
  return "";
}

export function applyRecommendationStyleTagToPayload<
  T extends { moodTag?: string },
>(payload: T, session: ChatPlanningSession, context?: CanonicalTravelContext): T {
  const tag = resolveRecommendationStyleTag(session, context);
  if (!tag) return payload;
  return { ...payload, moodTag: tag };
}
