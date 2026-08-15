/**
 * Unified Recommendation Search Scope Resolver.
 *
 * Priority:
 * 1. Explicit destination in this message
 * 2. Conversation trip destination
 * 3. Itinerary / planning destination
 * 4. Selected place context (place-detail nearby)
 * 5. Device location — only for explicit 「我現在附近」style requests
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
import { resolveDestinationApproxCenter } from "@/lib/ai/destination-geocode";
import { isPlaceDetailChatActive } from "@/lib/ai/place-detail-chat";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { parsePlaceRecommendationIntent } from "@/lib/ai/place-recommendation-intent/parse";
import { resolveDestinationAreaScope } from "@/lib/ai/destination-travel-profile";

export type RecommendationSearchScopeSource =
  | "explicit_user_destination"
  | "conversation_trip_destination"
  | "itinerary_destination"
  | "selected_place_context"
  | "current_device_location";

export type RecommendationSearchScope = {
  destinationName?: string;
  resolvedSearchCity?: string;
  destinationArea?: string;
  searchScope?: "city" | "area";
  latitude?: number;
  longitude?: number;
  source: RecommendationSearchScopeSource;
  deviceLocationIgnored: boolean;
};

/** Device GPS only when user clearly asks for current physical location. */
const EXPLICIT_DEVICE_NEARBY_RE =
  /(?:我現在附近|我目前所在|離我最近|以現在定位|用定位搜|我這邊附近|我这边附近|around\s*me|near\s*me|我的附近|今天附近可以|現在附近有)/i;

export function isExplicitDeviceNearbyRequest(text: string): boolean {
  return EXPLICIT_DEVICE_NEARBY_RE.test(text.trim());
}

function accept(label: string | undefined | null): string | undefined {
  if (!label?.trim()) return undefined;
  return coerceTravelDestination(label) ?? undefined;
}

export function logRecommendationScopeResolved(scope: RecommendationSearchScope): void {
  logAiPipeline(
    "[RECOMMENDATION_SCOPE_RESOLVED]",
    `destination=${scope.destinationName ?? ""}`,
    `source=${scope.source}`,
    `deviceLocationIgnored=${scope.deviceLocationIgnored}`,
  );
}

export function logRecommendationScopeMismatch(params: {
  expectedDestination: string;
  actualSource: string;
}): void {
  logAiPipeline(
    "[RECOMMENDATION_SCOPE_MISMATCH]",
    `expectedDestination=${params.expectedDestination}`,
    `actualSource=${params.actualSource}`,
  );
}

/**
 * Resolve where place recommendations should search.
 * Trip destination beats bare 「附近」and device GPS.
 */
export function resolveRecommendationSearchScope(params: {
  userText: string;
  session: ChatPlanningSession;
  context?: CanonicalTravelContext | null;
}): RecommendationSearchScope | null {
  const { userText, session, context } = params;
  const parsed = parsePlaceRecommendationIntent(userText);

  const fromMessage =
    accept(parsed?.destinationDisplayLabel ?? parsed?.destinationName) ||
    accept(resolveDestinationFromText(userText));
  if (fromMessage) {
    const scope = finalize(fromMessage, "explicit_user_destination", session, true);
    logRecommendationScopeResolved(scope);
    return scope;
  }

  if (isExplicitDeviceNearbyRequest(userText)) {
    const city = accept(session.location?.city);
    const lat = session.location?.lat;
    const lng = session.location?.lng;
    if (city || (lat != null && lng != null)) {
      const scope: RecommendationSearchScope = {
        destinationName: city,
        resolvedSearchCity: city,
        latitude: lat ?? undefined,
        longitude: lng ?? undefined,
        source: "current_device_location",
        deviceLocationIgnored: false,
      };
      logRecommendationScopeResolved(scope);
      return scope;
    }
  }

  if (isPlaceDetailChatActive(session) && session.placeDetailFocus) {
    const focus = session.placeDetailFocus;
    const scope: RecommendationSearchScope = {
      destinationName:
        accept(focus.city) ||
        accept(focus.name) ||
        accept(context?.destination) ||
        undefined,
      resolvedSearchCity: accept(focus.city) || accept(context?.destination),
      latitude: focus.lat ?? undefined,
      longitude: focus.lng ?? undefined,
      source: "selected_place_context",
      deviceLocationIgnored: true,
    };
    logRecommendationScopeResolved(scope);
    return scope;
  }

  const fromTrip = accept(
    context?.destination ||
      session.travelContext?.destination ||
      session.tripPlanningContext?.destination ||
      session.activeRecommendationContext?.destinationDisplayName ||
      session.activeRecommendationContext?.destinationName,
  );
  if (fromTrip) {
    const scope = finalize(fromTrip, "conversation_trip_destination", session, true);
    logRecommendationScopeResolved(scope);
    return scope;
  }

  const fromItinerary = accept(
    session.tripDestination?.displayLabel ||
      session.tripDestination?.city ||
      session.pendingQuestion?.baseDestination ||
      session.lastResolvedPendingQuestion?.baseDestination,
  );
  if (fromItinerary) {
    const scope = finalize(fromItinerary, "itinerary_destination", session, true);
    logRecommendationScopeResolved(scope);
    return scope;
  }

  const city = accept(session.location?.city);
  if (city || (session.location?.lat != null && session.location?.lng != null)) {
    const scope: RecommendationSearchScope = {
      destinationName: city,
      resolvedSearchCity: city,
      latitude: session.location?.lat ?? undefined,
      longitude: session.location?.lng ?? undefined,
      source: "current_device_location",
      deviceLocationIgnored: false,
    };
    logRecommendationScopeResolved(scope);
    return scope;
  }

  return null;
}

function finalize(
  display: string,
  source: RecommendationSearchScopeSource,
  session: ChatPlanningSession,
  deviceLocationIgnored: boolean,
): RecommendationSearchScope {
  const label = normalizeDestinationLabel(display);
  const areaScope = resolveDestinationAreaScope(label);
  const entity = resolveDestinationEntity(label);
  const approx = resolveDestinationApproxCenter(label);
  const activeCity =
    session.activeRecommendationContext?.resolvedSearchCity ||
    session.recommendationSession?.activeSearchCity;
  const resolvedSearchCity =
    resolveRegionPrimaryCity(label) || activeCity || label;
  const snapshotLat =
    session.activeRecommendationContext?.latitude ??
    session.recommendationSession?.searchCentroid?.lat;
  const snapshotLng =
    session.activeRecommendationContext?.longitude ??
    session.recommendationSession?.searchCentroid?.lng;
  return {
    destinationName: areaScope?.displayLabel ?? label,
    resolvedSearchCity: areaScope?.parentCity ?? resolvedSearchCity,
    destinationArea: areaScope?.area,
    searchScope: areaScope ? "area" : "city",
    latitude: snapshotLat ?? approx?.lat,
    longitude: snapshotLng ?? approx?.lng,
    source,
    deviceLocationIgnored,
    ...(entity.country ? {} : {}),
  };
}

/** True when trip/conversation destination must drive search (not device GPS). */
export function shouldPreferDestinationOverDevice(
  userText: string,
  session: ChatPlanningSession,
  context?: CanonicalTravelContext | null,
): boolean {
  if (isExplicitDeviceNearbyRequest(userText)) return false;
  const scope = resolveRecommendationSearchScope({ userText, session, context });
  if (!scope) return false;
  return (
    scope.source === "explicit_user_destination" ||
    scope.source === "conversation_trip_destination" ||
    scope.source === "itinerary_destination"
  );
}

/**
 * Single Search Center for the recommendation Places request.
 * Resolved once; downstream must not re-pick GPS / destination independently.
 */
export type RecommendationSearchCenter = {
  mode: "destination" | "current_location" | "explicit_place";
  latitude: number;
  longitude: number;
  label?: string;
  destination?: string;
  source:
    | "destination_anchor"
    | "recommendation_snapshot"
    | "explicit_current_location"
    | "explicit_place";
  deviceLocationAvailable: boolean;
  deviceLocationUsed: boolean;
};

export type RecommendationPlacesRequest = {
  searchMode: "destination" | "current_location";
  center: { latitude: number; longitude: number };
  centerSource: RecommendationSearchCenter["source"] | "gps";
  destination?: string;
  category: string;
  query?: string;
  radiusMeters: number;
  excludedPlaceIds?: string[];
};

function hasCoords(lat?: number | null, lng?: number | null): lat is number {
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    (Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001)
  );
}

/**
 * Unique Search Center Resolution step.
 * Priority:
 * 1. Explicit destination in this message (+ coords if available)
 * 2. Continue Recommendation Snapshot anchor
 * 3. Conversation destination + approx/anchor
 * 4. Explicit current-location request → device GPS
 * 5. No destination → device GPS
 */
export function resolveRecommendationSearchCenter(params: {
  userText: string;
  session: ChatPlanningSession;
  context?: CanonicalTravelContext | null;
  /** Already-resolved destination coords (e.g. from ChatPlaceSearchContext) */
  destinationLatLng?: { lat: number; lng: number } | null;
  destinationName?: string;
  deviceLatLng?: { lat: number; lng: number } | null;
  /** Place-detail focus center */
  explicitPlace?: {
    lat: number;
    lng: number;
    name?: string;
  } | null;
}): RecommendationSearchCenter | null {
  const { userText, session, context, destinationLatLng, deviceLatLng, explicitPlace } =
    params;
  const deviceLocationAvailable = hasCoords(deviceLatLng?.lat, deviceLatLng?.lng);

  if (explicitPlace && hasCoords(explicitPlace.lat, explicitPlace.lng)) {
    const center: RecommendationSearchCenter = {
      mode: "explicit_place",
      latitude: explicitPlace.lat,
      longitude: explicitPlace.lng,
      label: explicitPlace.name,
      source: "explicit_place",
      deviceLocationAvailable,
      deviceLocationUsed: false,
    };
    logRecommendationSearchCenter(center);
    return center;
  }

  // 1. Explicit destination in this message (beats snapshot / sticky trip dest)
  const fromMessageScope = resolveRecommendationSearchScope({
    userText,
    session,
    context,
  });
  if (fromMessageScope?.source === "explicit_user_destination" && fromMessageScope.destinationName) {
    const messageCoords =
      (params.destinationName &&
        accept(params.destinationName) === accept(fromMessageScope.destinationName) &&
        destinationLatLng) ||
      (hasCoords(fromMessageScope.latitude, fromMessageScope.longitude)
        ? { lat: fromMessageScope.latitude!, lng: fromMessageScope.longitude! }
        : null) ||
      resolveDestinationApproxCenter(fromMessageScope.destinationName);
    if (messageCoords && hasCoords(messageCoords.lat, messageCoords.lng)) {
      const center: RecommendationSearchCenter = {
        mode: "destination",
        latitude: messageCoords.lat,
        longitude: messageCoords.lng,
        label: fromMessageScope.destinationName,
        destination: fromMessageScope.destinationName,
        source: "destination_anchor",
        deviceLocationAvailable,
        deviceLocationUsed: false,
      };
      logRecommendationSearchCenter(center);
      return center;
    }
  }

  if (isExplicitDeviceNearbyRequest(userText)) {
    if (!deviceLocationAvailable) return null;
    const center: RecommendationSearchCenter = {
      mode: "current_location",
      latitude: deviceLatLng!.lat,
      longitude: deviceLatLng!.lng,
      label: session.location?.city,
      source: "explicit_current_location",
      deviceLocationAvailable: true,
      deviceLocationUsed: true,
    };
    logRecommendationSearchCenter(center);
    return center;
  }

  const snapshot = session.activeRecommendationContext;
  const recSession = session.recommendationSession;
  const snapshotDest =
    accept(snapshot?.destinationDisplayName) ||
    accept(snapshot?.destinationName) ||
    accept(recSession?.destination);
  const snapshotLat = snapshot?.latitude ?? recSession?.searchCentroid?.lat;
  const snapshotLng = snapshot?.longitude ?? recSession?.searchCentroid?.lng;

  if (snapshotDest && hasCoords(snapshotLat, snapshotLng)) {
    const center: RecommendationSearchCenter = {
      mode: "destination",
      latitude: snapshotLat as number,
      longitude: snapshotLng as number,
      label: snapshotDest,
      destination: snapshotDest,
      source: "recommendation_snapshot",
      deviceLocationAvailable,
      deviceLocationUsed: false,
    };
    logRecommendationSearchCenter(center);
    return center;
  }

  const scope = fromMessageScope;
  const destName =
    accept(params.destinationName) ||
    accept(scope?.destinationName) ||
    accept(context?.destination) ||
    snapshotDest;

  if (destName) {
    const fromResolved = destinationLatLng;
    const fromScope =
      hasCoords(scope?.latitude, scope?.longitude)
        ? { lat: scope!.latitude!, lng: scope!.longitude! }
        : null;
    const fromApprox = resolveDestinationApproxCenter(destName);
    const coords = fromResolved ?? fromScope ?? fromApprox;
    if (coords && hasCoords(coords.lat, coords.lng)) {
      const center: RecommendationSearchCenter = {
        mode: "destination",
        latitude: coords.lat,
        longitude: coords.lng,
        label: destName,
        destination: destName,
        source: "destination_anchor",
        deviceLocationAvailable,
        deviceLocationUsed: false,
      };
      logRecommendationSearchCenter(center);
      return center;
    }
    // Destination known but no coords — never fall back to GPS
    logAiPipeline(
      "[RECOMMENDATION_SEARCH_CENTER]",
      `mode=destination`,
      `destination=${destName}`,
      `coords=unavailable`,
      `deviceLocationAvailable=${deviceLocationAvailable}`,
      `deviceLocationUsed=false`,
    );
    return null;
  }

  if (deviceLocationAvailable) {
    const center: RecommendationSearchCenter = {
      mode: "current_location",
      latitude: deviceLatLng!.lat,
      longitude: deviceLatLng!.lng,
      label: session.location?.city,
      source: "explicit_current_location",
      deviceLocationAvailable: true,
      deviceLocationUsed: true,
    };
    logRecommendationSearchCenter(center);
    return center;
  }

  return null;
}

export function logRecommendationSearchCenter(center: RecommendationSearchCenter): void {
  logAiPipeline(
    "[RECOMMENDATION_SEARCH_CENTER]",
    `mode=${center.mode}`,
    `destination=${center.destination ?? center.label ?? ""}`,
    `lat=${center.latitude.toFixed(4)}`,
    `lng=${center.longitude.toFixed(4)}`,
    `source=${center.source}`,
    `deviceLocationAvailable=${center.deviceLocationAvailable}`,
    `deviceLocationUsed=${center.deviceLocationUsed}`,
  );
}

export function logRecommendationScopeRuntimeReady(params: {
  isNearbyPlaceIntent: boolean;
  scope: RecommendationSearchCenter["mode"] | string;
}): void {
  logAiPipeline(
    "[RECOMMENDATION_SCOPE_RUNTIME_READY]",
    `isNearbyPlaceIntent=${params.isNearbyPlaceIntent}`,
    `scope=${params.scope}`,
  );
}

export function logContinueRecommendationResolved(params: {
  route: string;
  category: string;
  destination: string;
}): void {
  logAiPipeline(
    "[CONTINUE_RECOMMENDATION_RESOLVED]",
    `route=${params.route}`,
    `category=${params.category}`,
    `destination=${params.destination}`,
  );
}

export function logRecommendationPlacesRequest(params: {
  mode: string;
  category: string;
  destination?: string;
  lat: number;
  lng: number;
  excludedCount?: number;
}): void {
  logAiPipeline(
    "[RECOMMENDATION_PLACES_REQUEST]",
    `mode=${params.mode}`,
    `category=${params.category}`,
    `destination=${params.destination ?? ""}`,
    `lat=${params.lat.toFixed(4)}`,
    `lng=${params.lng.toFixed(4)}`,
    `excludedCount=${params.excludedCount ?? 0}`,
  );
}

export function logRecommendationGpsOverrideBlocked(params: {
  destination: string;
  reason: string;
}): void {
  logAiPipeline(
    "[RECOMMENDATION_GPS_OVERRIDE_BLOCKED]",
    `destination=${params.destination}`,
    `reason=${params.reason}`,
  );
}

export function logRecommendationCategoryRestored(params: {
  from: string;
  to: string;
  source: string;
}): void {
  logAiPipeline(
    "[RECOMMENDATION_CATEGORY_RESTORED]",
    `from=${params.from}`,
    `to=${params.to}`,
    `source=${params.source}`,
  );
}

/**
 * Hard guard: destination-scoped search must never ship with GPS center.
 */
export function assertDestinationRequestNotUsingGps(
  request: RecommendationPlacesRequest,
): { ok: true } | { ok: false; reason: string } {
  if (request.searchMode === "destination" && !request.destination) {
    return { ok: false, reason: "destination_missing" };
  }
  if (request.searchMode === "destination" && request.centerSource === "gps") {
    return { ok: false, reason: "destination_request_using_gps" };
  }
  return { ok: true };
}

/** Restore category from snapshot when continue route would otherwise default. */
export function restoreContinueRecommendationCategory(params: {
  resolvedRoute: string;
  requestCategory: string;
  snapshotCategory?: string | null;
}): string {
  if (
    params.resolvedRoute === "MORE_RECOMMENDATIONS" &&
    params.snapshotCategory &&
    params.requestCategory !== params.snapshotCategory
  ) {
    logRecommendationCategoryRestored({
      from: params.requestCategory,
      to: params.snapshotCategory,
      source: "previous_recommendation_snapshot",
    });
    return params.snapshotCategory;
  }
  return params.requestCategory;
}
