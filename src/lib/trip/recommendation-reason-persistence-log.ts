import type { AddToTripSurface } from "@/lib/trip/trip-place-input";

type ReasonTarget = "place_detail" | "add_to_trip" | "itinerary_stop" | "trip_to_detail";

export function logRecommendationReasonHandoff(input: {
  surface: AddToTripSurface;
  canonicalPlaceId?: string;
  hasReason: boolean;
  reasonSource?: string;
  target: ReasonTarget;
}): void {
  console.info("[RECOMMENDATION_REASON_HANDOFF]", {
    surface: input.surface,
    hasCanonicalPlaceId: Boolean(input.canonicalPlaceId),
    hasReason: input.hasReason,
    reasonSource: input.reasonSource ?? "",
    target: input.target,
  });
}

export function logItineraryReasonPersistence(input: {
  canonicalPlaceId?: string;
  stored: boolean;
  hydrated: boolean;
  source?: string;
  fallbackUsed: boolean;
  dropStage?: string;
}): void {
  console.info("[ITINERARY_REASON_PERSISTENCE]", {
    hasCanonicalPlaceId: Boolean(input.canonicalPlaceId),
    stored: input.stored,
    hydrated: input.hydrated,
    source: input.source ?? "",
    fallbackUsed: input.fallbackUsed,
    dropStage: input.dropStage ?? "",
  });
}
