/**
 * Destination resolution for place recommendation — context-first, not re-ask.
 *
 * Priority:
 * 1. Explicit destination in this message
 * 2. ActiveRecommendationContext.destination
 * 3. CurrentTripContext / travelContext.destination
 * 4. Planning conversation destination
 * 5. Workspace destination (tripDestination)
 * 6. Device location — only for「附近」requests (caller decides)
 */
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import {
  coerceTravelDestination,
  normalizeDestinationLabel,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";
import { resolveRegionPrimaryCity } from "@/lib/ai/shopping-search-scope";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import type { PlaceRecommendationIntent } from "@/lib/ai/place-recommendation-intent/types";

export type ResolvedPlaceRecommendationDestination = {
  destinationDisplayName: string;
  resolvedSearchCity: string;
  countryCode?: string;
  source:
    | "message"
    | "active_recommendation"
    | "trip_context"
    | "planning"
    | "workspace"
    | "nearby_device";
};

function accept(label: string | undefined | null): string | undefined {
  if (!label?.trim()) return undefined;
  return coerceTravelDestination(label) ?? undefined;
}

export function resolvePlaceRecommendationDestination(params: {
  userText: string;
  session: ChatPlanningSession;
  context?: CanonicalTravelContext | null;
  parsed?: PlaceRecommendationIntent | null;
  /** Only when user asked for nearby / around me */
  allowDeviceLocation?: boolean;
}): ResolvedPlaceRecommendationDestination | null {
  const { userText, session, context, parsed, allowDeviceLocation } = params;

  const fromMessage =
    accept(parsed?.destinationName) ||
    accept(resolveDestinationFromText(userText));
  if (fromMessage) {
    return finalize(fromMessage, "message", session, parsed);
  }

  const fromActive = accept(
    session.activeRecommendationContext?.destinationDisplayName ||
      session.activeRecommendationContext?.destinationName,
  );
  if (fromActive) {
    const city =
      session.activeRecommendationContext?.resolvedSearchCity ||
      resolveRegionPrimaryCity(fromActive) ||
      fromActive;
    return {
      destinationDisplayName: fromActive,
      resolvedSearchCity: city,
      countryCode:
        session.activeRecommendationContext?.countryCode ||
        countryCodeFor(fromActive),
      source: "active_recommendation",
    };
  }

  const fromTrip = accept(
    context?.destination ||
      session.travelContext?.destination ||
      session.tripPlanningContext?.destination,
  );
  if (fromTrip) {
    return finalize(fromTrip, "trip_context", session, parsed);
  }

  const fromPlanning = accept(
    session.pendingQuestion?.baseDestination ||
      session.lastResolvedPendingQuestion?.baseDestination,
  );
  if (fromPlanning) {
    return finalize(fromPlanning, "planning", session, parsed);
  }

  const fromWorkspace = accept(
    session.tripDestination?.displayLabel || session.tripDestination?.city,
  );
  if (fromWorkspace) {
    return finalize(fromWorkspace, "workspace", session, parsed);
  }

  if (
    allowDeviceLocation &&
    /附近|附近的|around\s*me|nearby/i.test(userText) &&
    session.location?.city
  ) {
    const city = accept(session.location.city);
    if (city) {
      return {
        destinationDisplayName: city,
        resolvedSearchCity: city,
        source: "nearby_device",
      };
    }
  }

  return null;
}

function countryCodeFor(destination: string): string | undefined {
  const entity = resolveDestinationEntity(destination);
  return entity?.country ?? undefined;
}

function finalize(
  display: string,
  source: ResolvedPlaceRecommendationDestination["source"],
  session: ChatPlanningSession,
  parsed?: PlaceRecommendationIntent | null,
): ResolvedPlaceRecommendationDestination {
  const label = normalizeDestinationLabel(display);
  const activeCity = session.activeRecommendationContext?.resolvedSearchCity;
  const activeDest = normalizeDestinationLabel(
    session.activeRecommendationContext?.destinationDisplayName ||
      session.activeRecommendationContext?.destinationName ||
      "",
  );
  // When destination switched via message, do not keep previous region's search city
  const canReuseActiveCity =
    Boolean(activeCity) &&
    (!activeDest || activeDest === label) &&
    source !== "message";

  const resolvedSearchCity =
    parsed?.resolvedSearchCity ||
    (canReuseActiveCity ? activeCity : undefined) ||
    (source !== "message"
      ? session.recommendationSession?.activeSearchCity
      : undefined) ||
    resolveRegionPrimaryCity(label) ||
    label;
  return {
    destinationDisplayName: label,
    resolvedSearchCity,
    countryCode:
      parsed?.countryCode ||
      (canReuseActiveCity
        ? session.activeRecommendationContext?.countryCode
        : undefined) ||
      countryCodeFor(label),
    source,
  };
}
