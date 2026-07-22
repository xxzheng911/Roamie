/**
 * Nearby extension requirements — itinerary hard requirements, not soft preferences.
 * e.g. 東京 6 天 + 箱根 → dedicate Day 6 to Hakone with its own candidate sub-pool.
 */
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export const NEARBY_EXTENSION_MIN_STOPS = 2;
export const NEARBY_EXTENSION_PREFERRED_STOPS = 3;
export const NEARBY_EXTENSION_MAX_STOPS = 4;
export const NEARBY_EXTENSION_SEARCH_TARGET = 8;

export type NearbyExtensionRequirement = {
  destination: string;
  normalizedDestination: string;
  minimumDays: number;
  minimumStops: number;
  preferredStops: number;
  dedicatedDay: boolean;
};

export type NearbyExtensionPoolStatus = {
  extension: string;
  candidateCount: number;
  requiredStops: number;
  enough: boolean;
};

export type NearbyExtensionInsufficientStatus = {
  nearbyExtensionInsufficient: true;
  extensionDestination: string;
  requiredStops: number;
  availableStops: number;
  replanReasons: ["nearby_extension_insufficient"];
};

export function buildNearbyExtensionRequirements(
  extensions: string[] | undefined | null,
): NearbyExtensionRequirement[] {
  const seen = new Set<string>();
  const out: NearbyExtensionRequirement[] = [];
  for (const raw of extensions ?? []) {
    const normalized = normalizeDestinationLabel(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({
      destination: raw.trim() || normalized,
      normalizedDestination: normalized,
      minimumDays: 1,
      minimumStops: NEARBY_EXTENSION_MIN_STOPS,
      preferredStops: NEARBY_EXTENSION_PREFERRED_STOPS,
      dedicatedDay: true,
    });
  }
  return out;
}

/**
 * Assign dedicated days from the end of the trip.
 * 6 days + 箱根 → Day 6; 6 days + 箱根,橫濱 → Day 6 / Day 5.
 */
export function allocateNearbyExtensionDays(
  days: number,
  extensions: string[],
): Map<string, number> {
  const safe = Math.max(1, days);
  const reqs = buildNearbyExtensionRequirements(extensions);
  const map = new Map<string, number>();
  for (let i = 0; i < reqs.length; i += 1) {
    const day = Math.max(1, safe - i);
    map.set(reqs[i]!.normalizedDestination, day);
  }
  return map;
}

/** Single-extension helper (backward compatible). Last day when days ≥ 1. */
export function resolveNearbyExtensionDedicatedDay(days: number): number {
  return Math.max(1, days);
}

export function evaluateNearbyExtensionPoolStatus(params: {
  extension: string;
  candidateCount: number;
  requiredStops?: number;
}): NearbyExtensionPoolStatus {
  const required = params.requiredStops ?? NEARBY_EXTENSION_MIN_STOPS;
  const enough = params.candidateCount >= required;
  return {
    extension: normalizeDestinationLabel(params.extension) || params.extension,
    candidateCount: params.candidateCount,
    requiredStops: required,
    enough,
  };
}

export function buildNearbyExtensionInsufficient(
  extension: string,
  availableStops: number,
  requiredStops = NEARBY_EXTENSION_MIN_STOPS,
): NearbyExtensionInsufficientStatus {
  return {
    nearbyExtensionInsufficient: true,
    extensionDestination: normalizeDestinationLabel(extension) || extension,
    requiredStops,
    availableStops,
    replanReasons: ["nearby_extension_insufficient"],
  };
}

export function logNearbyExtensionContext(params: {
  primary: string;
  extensions: string[];
  selectedCombinations?: number[];
  tripDays?: number;
}): void {
  logAiPipeline(
    "[NEARBY_EXTENSION_CONTEXT]",
    `primary=${params.primary}`,
    `extensions=${params.extensions.join(",") || "(none)"}`,
    `selectedCombinations=${(params.selectedCombinations ?? []).join(",") || "(none)"}`,
    `tripDays=${params.tripDays ?? "?"}`,
  );
}

export function logNearbyExtensionPool(status: NearbyExtensionPoolStatus): void {
  logAiPipeline(
    "[NEARBY_EXTENSION_POOL]",
    `extension=${status.extension}`,
    `candidateCount=${status.candidateCount}`,
    `requiredStops=${status.requiredStops}`,
    `enough=${status.enough}`,
  );
}

export function logNearbyExtensionDayAllocation(params: {
  extension: string;
  assignedDay: number;
  minimumStops: number;
  selectedStops: number;
}): void {
  logAiPipeline(
    "[NEARBY_EXTENSION_DAY_ALLOCATION]",
    `extension=${params.extension}`,
    `assignedDay=${params.assignedDay}`,
    `minimumStops=${params.minimumStops}`,
    `selectedStops=${params.selectedStops}`,
  );
}

export function logNearbyExtensionPlannerResult(params: {
  extension: string;
  plannedStops: number;
  droppedStops: number;
  dropReasons: string[];
}): void {
  logAiPipeline(
    "[NEARBY_EXTENSION_PLANNER_RESULT]",
    `extension=${params.extension}`,
    `plannedStops=${params.plannedStops}`,
    `droppedStops=${params.droppedStops}`,
    `dropReasons=${params.dropReasons.join("|") || "(none)"}`,
  );
}

export function logNearbyExtensionPersistence(params: {
  extension: string;
  savedDay: number;
  savedStopCount: number;
}): void {
  logAiPipeline(
    "[NEARBY_EXTENSION_PERSISTENCE]",
    `extension=${params.extension}`,
    `savedDay=${params.savedDay}`,
    `savedStopCount=${params.savedStopCount}`,
  );
}

export function logNearbyExtensionUiCompare(params: {
  extension: string;
  plannerStopCount: number;
  persistedStopCount: number;
  uiStopCount: number;
}): void {
  logAiPipeline(
    "[NEARBY_EXTENSION_UI_COMPARE]",
    `extension=${params.extension}`,
    `plannerStopCount=${params.plannerStopCount}`,
    `persistedStopCount=${params.persistedStopCount}`,
    `uiStopCount=${params.uiStopCount}`,
  );
}
