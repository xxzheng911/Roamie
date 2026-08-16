import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { hasActiveTripPlanningSession } from "@/lib/ai/chat-planning-state";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  resolveTripStyleFromContext,
  tripStyleDisplayTag,
  type TripStyleKey,
} from "@/lib/ai/ai-trip-style";
import { resolvePresentableMoodTag, shouldDisplayMoodPresentation } from "@/lib/ai/mood-presentation";

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
    if (shouldDisplayMoodPresentation(session, travel)) {
      const mood = resolvePresentableMoodTag(session, travel);
      if (mood) {
        logAiTagContextSource("moodCard");
        return mood;
      }
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
