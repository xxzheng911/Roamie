/**
 * ResolvedTripDestination — single source of truth for planning destination.
 *
 * Chat / Planning / Trip Context / Combination Guard / Travel Profile /
 * Candidate Pool / Region Adjacency / Planner all read via resolvePlanningDestination.
 */
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  resolveDestinationEntity,
  type DestinationEntityType,
} from "@/lib/ai/destination-entity";
import { resolveDestinationScopeFields } from "@/lib/ai/destination-scope";
import {
  countryCodeForCountryName,
  getResolvedDestinationScope,
} from "@/lib/ai/resolved-destination-scope";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { resolveDestinationApproxCenter } from "@/lib/ai/destination-geocode";

export type ResolvedTripDestination = {
  label: string;
  city?: string;
  country?: string;
  countryCode?: string;
  type: DestinationEntityType | "unknown";
  latitude?: number;
  longitude?: number;
  placeId?: string;
  source: string;
  scopeId?: string;
  scopeLocked: boolean;
};

export type PlanningDestinationInput = {
  destination?: string | null;
  destinationType?: string | null;
  destinationCountry?: string | null;
  destinationCity?: string | null;
  destinationRegion?: string | null;
  destinationCountryCode?: string | null;
  destinationScopeId?: string | null;
  destinationCoordinates?: { lat?: number; lng?: number } | null;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
  tripDestination?: ChatPlanningSession["tripDestination"];
};

export function isValidCoordinate(
  lat?: number | null,
  lng?: number | null,
): boolean {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return true;
}

function pickLabel(input: PlanningDestinationInput): string | undefined {
  const candidates = [
    input.destination,
    input.destinationCity,
    input.tripDestination?.displayLabel,
    input.tripDestination?.city,
  ];
  for (const c of candidates) {
    const label = c?.trim() ? normalizeDestinationLabel(c) : undefined;
    if (label) return label;
  }
  return undefined;
}

/**
 * Unify destination fields from context, tripDestination stub, and locked scope.
 */
export function resolvePlanningDestination(
  input: PlanningDestinationInput | CanonicalTravelContext | null | undefined,
  session?: ChatPlanningSession | null,
): ResolvedTripDestination | null {
  const bag: PlanningDestinationInput = {
    ...(input ?? {}),
    tripDestination:
      (input as PlanningDestinationInput | null | undefined)?.tripDestination ??
      session?.tripDestination,
    destination:
      (input as PlanningDestinationInput | null | undefined)?.destination ??
      session?.travelContext?.destination ??
      session?.tripPlanningContext?.destination,
    destinationType:
      (input as PlanningDestinationInput | null | undefined)?.destinationType ??
      session?.travelContext?.destinationType,
    destinationCountry:
      (input as PlanningDestinationInput | null | undefined)?.destinationCountry ??
      session?.travelContext?.destinationCountry,
    destinationCity:
      (input as PlanningDestinationInput | null | undefined)?.destinationCity ??
      session?.travelContext?.destinationCity,
  };

  const label = pickLabel(bag);
  if (!label) return null;

  const entity = resolveDestinationEntity(label);
  const scopeFields = resolveDestinationScopeFields(
    label,
    bag.destinationCountry ?? entity.country,
  );
  const locked = getResolvedDestinationScope(label);

  const type = (scopeFields.destinationType ||
    bag.destinationType ||
    entity.type ||
    "unknown") as DestinationEntityType | "unknown";

  const country =
    locked?.country ??
    scopeFields.destinationCountry ??
    bag.destinationCountry ??
    entity.country ??
    (type === "city_state" || type === "country" ? label : undefined);

  const city =
    scopeFields.destinationCity ??
    bag.destinationCity ??
    (type === "city" || type === "city_state" ? label : undefined);

  const countryCode =
    locked?.countryCode ??
    bag.destinationCountryCode?.trim()?.toUpperCase() ??
    countryCodeForCountryName(country) ??
    countryCodeForCountryName(label);

  const tripLat = bag.tripDestination?.lat;
  const tripLng = bag.tripDestination?.lng;
  const fromTrip = isValidCoordinate(tripLat, tripLng)
    ? { lat: tripLat!, lng: tripLng! }
    : null;
  const fromBag = isValidCoordinate(
    bag.destinationCoordinates?.lat,
    bag.destinationCoordinates?.lng,
  )
    ? {
        lat: bag.destinationCoordinates!.lat!,
        lng: bag.destinationCoordinates!.lng!,
      }
    : isValidCoordinate(bag.latitude, bag.longitude)
      ? { lat: bag.latitude!, lng: bag.longitude! }
      : null;
  const fromLocked =
    locked && isValidCoordinate(locked.latitude, locked.longitude)
      ? { lat: locked.latitude, lng: locked.longitude }
      : null;
  const approx = resolveDestinationApproxCenter(label, country);
  const fromApprox =
    approx && isValidCoordinate(approx.lat, approx.lng) ? approx : null;

  const coords = fromLocked ?? fromBag ?? fromTrip ?? fromApprox;
  const source = fromLocked
    ? `destination_scope_lock:${locked!.source}`
    : fromBag
      ? "context_coordinates"
      : fromTrip
        ? "trip_destination"
        : fromApprox
          ? "approx_center"
          : "entity_scope_fields";

  const placeId = bag.placeId ?? bag.tripDestination?.placeId;

  return {
    label,
    city,
    country,
    countryCode,
    type,
    latitude: coords?.lat,
    longitude: coords?.lng,
    placeId: placeId?.trim() ? placeId : undefined,
    source,
    scopeId: locked?.scopeId ?? bag.destinationScopeId ?? undefined,
    scopeLocked: Boolean(locked && isValidCoordinate(locked.latitude, locked.longitude)),
  };
}

export function assertDestinationConsistency(
  resolved: ResolvedTripDestination | null | undefined,
): { ok: boolean; missingFields: string[] } {
  const missingFields: string[] = [];
  if (!resolved?.label?.trim()) missingFields.push("label");
  if (!resolved?.countryCode?.trim()) missingFields.push("countryCode");
  if (!resolved || !isValidCoordinate(resolved.latitude, resolved.longitude)) {
    missingFields.push("coordinates");
  }
  if (!resolved?.type || resolved.type === "unknown" || resolved.type === "country") {
    missingFields.push("type");
  }
  return { ok: missingFields.length === 0, missingFields };
}

/** Guard-facing completeness: label + countryCode + coords, not bare country. */
export function hasCompleteResolvedDestination(
  resolved: ResolvedTripDestination | null | undefined,
): boolean {
  if (!resolved?.label) return false;
  if (resolved.type === "country") return false;
  const check = assertDestinationConsistency(resolved);
  return check.ok;
}

export function logPlanningDestinationSummary(
  resolved: ResolvedTripDestination | null | undefined,
  extras?: { hasDestination?: boolean },
): void {
  const check = assertDestinationConsistency(resolved);
  const hasDestination =
    extras?.hasDestination ?? hasCompleteResolvedDestination(resolved);
  logAiPipeline(
    "[PLANNING_DESTINATION_SUMMARY]",
    `label=${resolved?.label ?? ""}`,
    `city=${resolved?.city ?? ""}`,
    `country=${resolved?.country ?? ""}`,
    `countryCode=${resolved?.countryCode ?? ""}`,
    `type=${resolved?.type ?? ""}`,
    `lat=${resolved?.latitude ?? ""}`,
    `lng=${resolved?.longitude ?? ""}`,
    `placeId=${resolved?.placeId ?? ""}`,
    `scopeLocked=${resolved?.scopeLocked ?? false}`,
    `source=${resolved?.source ?? ""}`,
    `hasDestination=${hasDestination}`,
    `missingFields=[${check.missingFields.join(",")}]`,
  );
}

export function logCombinationFailureChain(params: {
  destinationLabel?: string | null;
  destinationResolved: boolean;
  destinationLocked: boolean;
  guardHasDestination: boolean;
  primaryReason: string;
  secondaryReason?: string;
  terminalReason?: string;
}): void {
  logAiPipeline(
    "[COMBINATION_FAILURE_CHAIN]",
    JSON.stringify({
      destinationLabel: params.destinationLabel ?? "",
      destinationResolved: params.destinationResolved,
      destinationLocked: params.destinationLocked,
      guardHasDestination: params.guardHasDestination,
      primaryReason: params.primaryReason,
      secondaryReason: params.secondaryReason ?? "",
      terminalReason: params.terminalReason ?? "",
    }),
  );
}

export function logDestinationContextInvalid(
  resolved: ResolvedTripDestination | null | undefined,
  missingFields: string[],
): void {
  logAiPipeline(
    "[DESTINATION_CONTEXT_INVALID]",
    `destination=${resolved?.label ?? ""}`,
    `missingFields=[${missingFields.join(",")}]`,
    `scopeLocked=${resolved?.scopeLocked ?? false}`,
    `type=${resolved?.type ?? ""}`,
  );
}

/** Snapshot locked destination fields for date-change reset restore. */
export function captureLockedDestinationSnapshot(
  session: ChatPlanningSession,
): ResolvedTripDestination | null {
  return resolvePlanningDestination(session.travelContext, session);
}

export function restoreLockedDestinationToContext(
  resolved: ResolvedTripDestination,
  base?: CanonicalTravelContext,
): CanonicalTravelContext {
  const coordsOk = isValidCoordinate(resolved.latitude, resolved.longitude);
  return {
    ...(base ?? { interests: [] }),
    interests: base?.interests ?? [],
    destination: resolved.label,
    destinationCity: resolved.city ?? resolved.label,
    destinationCountry: resolved.country ?? resolved.label,
    destinationType:
      resolved.type === "unknown" ? undefined : (resolved.type as DestinationEntityType),
    destinationCountryCode: resolved.countryCode,
    destinationScopeId: resolved.scopeId,
    destinationCoordinates: coordsOk
      ? { lat: resolved.latitude!, lng: resolved.longitude! }
      : undefined,
  };
}
