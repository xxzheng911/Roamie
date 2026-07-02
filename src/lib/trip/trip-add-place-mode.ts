import type { ChatPlanningSession } from "@/lib/chat-session";

export function isTripAddPlaceMode(session: ChatPlanningSession): boolean {
  return Boolean(
    session.fromTripAddPlace &&
      session.tripAddPlaceContext &&
      session.conversationMode === "trip_add_place",
  );
}

export function shouldShowTripAddPlacePlusUpsell(session: ChatPlanningSession): boolean {
  return !isTripAddPlaceMode(session);
}

export function logTripAddPlaceMode(
  session: ChatPlanningSession,
  sourceRoute: string,
): void {
  const ctx = session.tripAddPlaceContext;
  console.info("[TRIP_ADD_PLACE_MODE]", {
    isTripAddPlaceMode: isTripAddPlaceMode(session),
    tripId: ctx?.tripId ?? null,
    dayIndex: ctx?.dayIndex ?? null,
    sourceRoute,
    hasSession: Boolean(session.tripAddPlaceRecommendationSession),
    hasContext: Boolean(ctx),
    handoffDone: Boolean(session.tripAddPlaceHandoffDone),
    shouldShowPlusUpsell: shouldShowTripAddPlacePlusUpsell(session),
  });
}

export const TRIP_ADD_PLACE_EMPTY_HINT =
  "我可以依照目前行程幫你找順路地點。告訴我想找景點、咖啡廳或餐廳，也可以說「還有嗎」。";
