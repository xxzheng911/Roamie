import type { ChatPlanningSession } from "@/lib/chat-session";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import { getTripAddPlaceCopy } from "@/lib/i18n/trip-add-place-copy";
import type { Locale } from "@/lib/i18n/types";

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

export function tripAddPlaceEmptyHint(locale: Locale = effectiveAppLocale()): string {
  return getTripAddPlaceCopy(locale).emptyHint;
}
