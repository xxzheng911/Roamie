import { userExplicitlyWantsNearbyPlaces, type NearbyPlaceIntent } from "@/lib/ai/chat-intent";
import { parsePlaceRecommendationIntent } from "@/lib/ai/place-recommendation-intent/parse";
import type { TripLocation } from "@/lib/location/types";

export const NEARBY_LOCATION_CLARIFICATION_COPY = "你是指哪個地區的呢？";
export const NEARBY_CLARIFICATION_CONTRACT_VERSION = "nearby-clarification-v2";

export type PendingNearbyLocationRequest = {
  intent: NearbyPlaceIntent;
  category: "restaurant" | "cafe" | "attraction";
  originalUserText: string;
  originalQuery: string;
  nearbyIntent: NearbyPlaceIntent;
  requestedScope: "nearby";
  originalAuthority: "nearby";
  originalSearchMode: "location_clarification";
  queryCategory: string;
  subtype?: string;
  mealSlot?: "breakfast" | "lunch" | "dinner" | "late_night";
  createdAt: string;
};

export type ChatRouteAuthority = "nearby" | "destination_category" | "shortcut" | "other";

/**
 * Selects the single recommendation dispatcher for a chat turn.
 * Explicit Nearby wording and a pending Nearby location answer outrank the
 * destination-category route. A genuine destination-category request still
 * owns the turn when no Nearby scope was explicitly requested.
 */
export function resolveChatRouteAuthority(params: {
  structuredShortcut?: boolean;
  explicitNearbyRequest?: boolean;
  pendingNearbyLocationRequest?: boolean;
  resolvedNearbyIntent?: NearbyPlaceIntent | null;
  categoryPlaceQuery?: boolean;
}): ChatRouteAuthority {
  if (params.structuredShortcut) return "shortcut";
  if (params.pendingNearbyLocationRequest || params.explicitNearbyRequest) return "nearby";
  if (params.categoryPlaceQuery) return "destination_category";
  if (params.resolvedNearbyIntent) return "nearby";
  return "other";
}

/**
 * A resolved Nearby authority owns dispatch for the turn. The legacy fetch
 * eligibility remains authoritative for every non-Nearby route.
 */
export function shouldAllowNearbyDispatch(params: {
  selectedAuthority: ChatRouteAuthority;
  nearbyIntent?: NearbyPlaceIntent | null;
  legacyShouldFetch: boolean;
}): boolean {
  if (params.selectedAuthority === "nearby" && params.nearbyIntent != null) return true;
  return params.legacyShouldFetch;
}

export function createPendingNearbyLocationRequest(
  intent: NearbyPlaceIntent,
  originalUserText: string,
): PendingNearbyLocationRequest {
  const originalQuery = originalUserText.trim();
  const semantics = resolveNearbyClarificationSemantics(originalQuery, intent);
  return {
    intent,
    category: intent === "cafe" ? "cafe" : intent === "restaurant" ? "restaurant" : "attraction",
    originalUserText: originalQuery,
    originalQuery,
    nearbyIntent: intent,
    requestedScope: "nearby",
    originalAuthority: "nearby",
    originalSearchMode: "location_clarification",
    queryCategory: semantics.categoryLabel,
    subtype: semantics.subtype,
    mealSlot: semantics.mealSlot,
    createdAt: new Date().toISOString(),
  };
}

export function resolveNearbyClarificationSemantics(
  originalQuery: string,
  intent: NearbyPlaceIntent,
): {
  categoryLabel: string;
  subtype?: string;
  mealSlot?: "breakfast" | "lunch" | "dinner" | "late_night";
} {
  const parsed = parsePlaceRecommendationIntent(originalQuery);
  if (parsed?.mealSlot === "breakfast") {
    return { categoryLabel: "早餐店", subtype: "breakfast", mealSlot: "breakfast" };
  }
  if (parsed?.subtypes.includes("izakaya") || /居酒屋/.test(originalQuery)) {
    return { categoryLabel: "居酒屋", subtype: "izakaya", mealSlot: parsed?.mealSlot };
  }
  if (intent === "cafe") return { categoryLabel: "咖啡廳" };
  if (intent === "restaurant") return { categoryLabel: "餐廳", mealSlot: parsed?.mealSlot };
  return { categoryLabel: "景點" };
}

export function buildNearbyLocationClarificationCopy(
  originalQuery: string,
  intent: NearbyPlaceIntent,
): { categoryLabel: string; renderedCopy: string } {
  const categoryLabel = resolveNearbyClarificationSemantics(originalQuery, intent).categoryLabel;
  return { categoryLabel, renderedCopy: NEARBY_LOCATION_CLARIFICATION_COPY };
}

export function normalizeNearbyClarificationQuery(rawQuery: string): string {
  return rawQuery.normalize("NFKC").replace(/[,，、；;]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isUsableNearbyClarificationLocation(
  location: TripLocation | null | undefined,
): location is TripLocation {
  const displayLabel =
    location?.displayLabel?.trim() ||
    location?.formattedName?.trim() ||
    location?.address?.trim() ||
    location?.city?.trim();
  return Boolean(
    hasUsableNearbyCoordinates(location) &&
      displayLabel &&
      !location?.placeId?.startsWith("approx:") &&
      !location?.placeId?.startsWith("scope:"),
  );
}

export function hasUsableNearbyCoordinates(
  location:
    | {
        lat?: number | null;
        lng?: number | null;
      }
    | null
    | undefined,
): boolean {
  const lat = location?.lat;
  const lng = location?.lng;
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    (Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001)
  );
}

export function shouldResolveNearbyCurrentLocation(params: {
  userText: string;
  structuredShortcut?: boolean;
}): boolean {
  return params.structuredShortcut === true || userExplicitlyWantsNearbyPlaces(params.userText);
}
