export const ANALYTICS_TRACKING_STARTED_AT = "2026-09-05T00:00:00Z";

export const ANALYTICS_EVENT_NAMES = [
  "chat_session_started",
  "itinerary_generation_started",
  "itinerary_generation_succeeded",
  "itinerary_generation_failed",
  "recommendation_requested",
  "recommendation_surfaced",
  "place_card_opened",
  "affiliate_cta_impression",
  "affiliate_cta_clicked",
  "affiliate_outbound_open_succeeded",
] as const;
export type AnalyticsEventNameV1 = (typeof ANALYTICS_EVENT_NAMES)[number];
export type AnalyticsSurface =
  | "home"
  | "chat"
  | "explore"
  | "selection"
  | "favorites"
  | "itinerary"
  | "map";

export type AnalyticsEventV1 = {
  eventId: string;
  eventName: AnalyticsEventNameV1;
  occurredAt?: string;
  tier?: "free" | "plus";
  sessionId?: string;
  surface?: AnalyticsSurface;
  placeId?: string;
  recommendationFamily?: string;
  provider?: string;
  failureCode?: string;
};

export function analyticsOperationEventId(operationId: string, phase: string): string {
  return `${operationId.trim()}:${phase}`;
}
