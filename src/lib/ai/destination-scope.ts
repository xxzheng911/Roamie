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

export function logCountryLevelPlacesBlocked(
  country: string,
  reason = "city_required",
): void {
  logAiPipeline(
    "[COUNTRY_LEVEL_PLACES_BLOCKED]",
    `country=${normalizeDestinationLabel(country)}`,
    `reason=${reason}`,
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
