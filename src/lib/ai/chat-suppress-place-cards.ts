import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";

/**
 * Destination itinerary chat pipeline must never render place / candidate cards.
 * Allowed surfaces: text, choice chips, loading, error, success redirect.
 */
export function shouldSuppressChatPlaceCards(
  session: ChatPlanningSession,
  opts?: {
    generating?: boolean;
    context?: CanonicalTravelContext | null;
  },
): boolean {
  if (opts?.generating) return true;

  const purpose =
    opts?.context?.tripPurpose ?? session.travelContext?.tripPurpose ?? "";
  const pending = session.pendingQuestion?.type;
  const aiState = session.aiItineraryState;
  const planningState = session.chatPlanningState;

  // Category / more-place recommendations must keep Place Cards even inside
  // destination_planning (e.g. after dates/combinations were collected).
  if (
    purpose === "recommend_places" ||
    purpose === "more_place_recommendations" ||
    purpose === "alternative_recommendations" ||
    purpose === "refresh_recommendations" ||
    purpose === "must_visit_places"
  ) {
    return false;
  }
  if (
    session.phase === "recommend" &&
    (session.activeCategoryIntent || session.recommendationSession)
  ) {
    return false;
  }

  if (pending === "combination_choice") return true;
  if (session.phase === "generating") return true;
  if (planningState === "generatingPlan" || planningState === "generationFailed") {
    return true;
  }
  if (
    aiState === "CREATING_TRIP" ||
    aiState === "SEARCHING_PLACES" ||
    aiState === "RANKING" ||
    aiState === "BUILDING_ITINERARY" ||
    aiState === "FAILED"
  ) {
    return true;
  }

  if (
    purpose === "combination_suggestions_offered" ||
    purpose === "route_combination_selected" ||
    purpose === "direct_itinerary_generation" ||
    purpose === "create_itinerary" ||
    purpose === "create_itinerary_from_accepted" ||
    purpose === "ready_for_itinerary"
  ) {
    return true;
  }

  if (session.conversationMode === "destination_planning") {
    // New-trip combination / date collection flow — text only until Trip is created.
    if (
      pending === "ask_days" ||
      pending === "ask_preference" ||
      pending === "ask_trip_style" ||
      pending === "combination_choice" ||
      pending === "duration_choice" ||
      pending === "itinerary_next_step"
    ) {
      return true;
    }
    if (
      purpose === "duration_selected" ||
      purpose === "region_selected" ||
      purpose === "destination_selection" ||
      purpose === "itinerary_planning"
    ) {
      return true;
    }
  }

  return false;
}
