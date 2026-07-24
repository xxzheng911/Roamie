import {
  isKnownCountryLabel,
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
} from "@/lib/ai/trip-planning-context";
import {
  resolveDestinationEntity,
  type DestinationEntityType,
} from "@/lib/ai/destination-entity";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export type DestinationScopeFields = {
  destinationName: string;
  destinationType: DestinationEntityType;
  destinationCountry?: string;
  destinationCity?: string;
  destinationRegion?: string;
};

/** Country-level labels that require a city/region before Places / combinations. */
export function isCountryLevelDestination(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  const label = normalizeDestinationLabel(name);
  // City-states are valid travel destinations (same label as country).
  if (label === "新加坡" || label === "香港" || label === "澳門" || label === "澳门") {
    return false;
  }
  if (isKnownTouristCityLabel(label) && !isKnownCountryLabel(label)) return false;
  if (isKnownCountryLabel(label) && !isKnownTouristCityLabel(label)) return true;
  const entity = resolveDestinationEntity(label);
  return entity.type === "country";
}

/**
 * True when Places discovery / combination generation may run.
 * Country without a city must never run city-radius Places search.
 */
export function canDiscoverDestinationPlaces(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  if (isCountryLevelDestination(name)) return false;
  const entity = resolveDestinationEntity(name);
  return (
    entity.type === "city" ||
    entity.type === "region" ||
    entity.type === "island" ||
    entity.type === "state" ||
    entity.type === "attraction" ||
    isKnownTouristCityLabel(name)
  );
}

export function resolveDestinationScopeFields(
  name: string,
  previousCountry?: string | null,
): DestinationScopeFields {
  const label = normalizeDestinationLabel(name);
  const entity = resolveDestinationEntity(label);
  const country =
    entity.type === "country"
      ? label
      : entity.country ??
        (previousCountry ? normalizeDestinationLabel(previousCountry) : undefined);

  // Entity resolver already emits DESTINATION_ENTITY_RESOLVED — avoid duplicate spam.

  if (entity.type === "country") {
    return {
      destinationName: label,
      destinationType: "country",
      destinationCountry: label,
    };
  }

  if (entity.type === "region" || entity.type === "island" || entity.type === "state") {
    return {
      destinationName: label,
      destinationType: entity.type,
      destinationCountry: country,
      destinationRegion: label,
      destinationCity: undefined,
    };
  }

  if (entity.type === "attraction") {
    return {
      destinationName: label,
      destinationType: "attraction",
      destinationCountry: country,
      destinationRegion: undefined,
      destinationCity: undefined,
    };
  }

  return {
    destinationName: label,
    destinationType: "city",
    destinationCountry: country,
    destinationCity: label,
  };
}

export type DestinationScopePrecision =
  | "country"
  | "region"
  | "state"
  | "city"
  | "district"
  | "landmark"
  | "unknown";

export type DestinationScopeGate = {
  destination: string;
  destinationType: DestinationEntityType | "unknown";
  countryCode?: string;
  scopePrecision: DestinationScopePrecision;
  requestedIntent?: string;
  placesCallBlocked: boolean;
  reason?: string;
  requiresDestinationRefinement: boolean;
  placesCallAllowed: boolean;
};

function mapScopePrecision(
  type: DestinationEntityType | undefined,
): DestinationScopePrecision {
  if (!type) return "unknown";
  if (type === "country") return "country";
  if (
    type === "region" ||
    type === "island" ||
    type === "archipelago" ||
    type === "resort_area"
  ) {
    return "region";
  }
  if (type === "state" || type === "province" || type === "administrative_area") {
    return "state";
  }
  if (type === "city") return "city";
  if (type === "district") return "district";
  if (type === "attraction") return "landmark";
  return "unknown";
}

/**
 * Destination Scope Gate — country-level destinations must refine to city/region
 * before any Places Nearby / Text Search / place cards.
 */
export function evaluateDestinationScopeGate(params: {
  destination?: string | null;
  destinationType?: DestinationEntityType | string | null;
  countryCode?: string | null;
  requestedIntent?: string | null;
}): DestinationScopeGate {
  const destination = params.destination?.trim()
    ? normalizeDestinationLabel(params.destination)
    : "";
  const entity = destination ? resolveDestinationEntity(destination) : null;
  const destinationType = (params.destinationType ??
    entity?.type ??
    "unknown") as DestinationEntityType | "unknown";
  const countryLevel =
    destinationType === "country" ||
    (destination ? isCountryLevelDestination(destination) : false);
  const scopePrecision = countryLevel
    ? "country"
    : mapScopePrecision(
        destinationType === "unknown" ? entity?.type : (destinationType as DestinationEntityType),
      );
  const requiresDestinationRefinement = countryLevel;
  const placesCallAllowed =
    Boolean(destination) && !requiresDestinationRefinement && canDiscoverDestinationPlaces(destination);
  const placesCallBlocked = Boolean(destination) && !placesCallAllowed;

  return {
    destination: destination || "none",
    destinationType,
    countryCode: params.countryCode?.trim() || entity?.country || undefined,
    scopePrecision,
    requestedIntent: params.requestedIntent ?? undefined,
    placesCallBlocked,
    reason: placesCallBlocked ? "country_scope_requires_refinement" : undefined,
    requiresDestinationRefinement,
    placesCallAllowed,
  };
}

export function logDestinationScopeBlocked(gate: DestinationScopeGate): void {
  logAiPipeline(
    "[DESTINATION_SCOPE_BLOCKED]",
    `destination=${gate.destination}`,
    `destinationType=${gate.destinationType}`,
    `countryCode=${gate.countryCode ?? "none"}`,
    `scopePrecision=${gate.scopePrecision}`,
    `requestedIntent=${gate.requestedIntent ?? "none"}`,
    `placesCallBlocked=${gate.placesCallBlocked}`,
    `reason=${gate.reason ?? "none"}`,
  );
}

export function logTripIntentScopeSummary(params: {
  userTextSummary: string;
  intent: string;
  destination?: string | null;
  destinationType?: string | null;
  countryCode?: string | null;
  travelMonth?: string | number | null;
  travelDates?: string | null;
  scopePrecision?: string | null;
  requiresDestinationRefinement: boolean;
  placesCallAllowed: boolean;
  nextState: string;
  responseType: string;
}): void {
  logAiPipeline(
    "[TRIP_INTENT_SCOPE_SUMMARY]",
    `userTextSummary=${params.userTextSummary.slice(0, 80)}`,
    `intent=${params.intent}`,
    `destination=${params.destination ?? "none"}`,
    `destinationType=${params.destinationType ?? "none"}`,
    `countryCode=${params.countryCode ?? "none"}`,
    `travelMonth=${params.travelMonth ?? "none"}`,
    `travelDates=${params.travelDates ?? "none"}`,
    `scopePrecision=${params.scopePrecision ?? "none"}`,
    `requiresDestinationRefinement=${params.requiresDestinationRefinement}`,
    `placesCallAllowed=${params.placesCallAllowed}`,
    `nextState=${params.nextState}`,
    `responseType=${params.responseType}`,
  );
}

export function logUnexpectedPlacesCall(params: {
  trigger: string;
  intent?: string | null;
  destinationType?: string | null;
  scopePrecision?: string | null;
  callPath: string;
}): void {
  logAiPipeline(
    "[UNEXPECTED_PLACES_CALL]",
    `trigger=${params.trigger}`,
    `intent=${params.intent ?? "none"}`,
    `destinationType=${params.destinationType ?? "none"}`,
    `scopePrecision=${params.scopePrecision ?? "none"}`,
    `callPath=${params.callPath}`,
  );
}

export function logCountryLevelPlacesBlocked(
  country: string,
  reason = "city_required",
): void {
  logAiPipeline(
    "[COUNTRY_LEVEL_PLACES_BLOCKED]",
    `country=${normalizeDestinationLabel(country)}`,
    `reason=${reason}`,
  );
  logDestinationScopeBlocked(
    evaluateDestinationScopeGate({
      destination: country,
      destinationType: "country",
      requestedIntent: reason,
    }),
  );
}

export function logDestinationCityRequired(params: {
  country: string;
  month?: number | string | null;
}): void {
  const month =
    params.month == null || params.month === ""
      ? "none"
      : String(params.month);
  logAiPipeline(
    "[DESTINATION_CITY_REQUIRED]",
    `country=${normalizeDestinationLabel(params.country)}`,
    `month=${month}`,
  );
}

export function logDestinationCitySelected(params: {
  country?: string | null;
  city: string;
}): void {
  logAiPipeline(
    "[DESTINATION_CITY_SELECTED]",
    `country=${params.country ? normalizeDestinationLabel(params.country) : "unknown"}`,
    `city=${normalizeDestinationLabel(params.city)}`,
  );
}

export function logDestinationSearchScopeUpdated(params: {
  from: string;
  to: string;
  city: string;
}): void {
  logAiPipeline(
    "[DESTINATION_SEARCH_SCOPE_UPDATED]",
    `from=${params.from}`,
    `to=${params.to}`,
    `city=${normalizeDestinationLabel(params.city)}`,
  );
}

export function logCombinationFlowTriggered(params: {
  city: string;
  tripDays: number;
  startDate?: string | null;
  endDate?: string | null;
}): void {
  logAiPipeline(
    "[COMBINATION_FLOW_TRIGGERED]",
    `city=${normalizeDestinationLabel(params.city)}`,
    `tripDays=${params.tripDays}`,
    `startDate=${params.startDate?.trim() || "none"}`,
    `endDate=${params.endDate?.trim() || "none"}`,
  );
}

export function logConversationStageTransition(from: string, to: string): void {
  logAiPipeline("[CONVERSATION_STAGE_TRANSITION]", `from=${from}`, `to=${to}`);
}
