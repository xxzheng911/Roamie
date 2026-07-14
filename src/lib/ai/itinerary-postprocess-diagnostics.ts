import type { PlaceResult } from "@/lib/place-result";
import { normalizeGooglePlaceId } from "@/lib/ai/normalize-google-place";
import {
  isPlaceholderPlanningPlaceName,
  resolvePlanningPlaceId,
} from "@/lib/ai/planning-real-place";
import { isHardGooglePlaceId } from "@/lib/ai/planning-place-id";
import { resolveTripPlaceId } from "@/lib/ai/ai-trip-place-allocator";
import {
  hasOpeningHoursData,
  isBarBistroPlace,
  isFoodVenuePlace,
  requiresOpeningHours,
} from "@/lib/ai/ai-day-plan-slot-rules";
import { isLocalLifeExcludedPlace } from "@/lib/ai/ai-local-life-rules";
import { classifyTripPlaceCategory } from "@/lib/ai/trip-place-scoring";

export type PostprocessDropCounters = {
  inputCount: number;
  outputCount: number;
  droppedMissingPlaceId: number;
  droppedInvalidName: number;
  droppedPlaceholder: number;
  droppedWrongDestination: number;
  droppedDuplicate: number;
  droppedChildLandmark: number;
  droppedTypeMismatch: number;
  droppedMissingOpeningHours: number;
  droppedClosedAtSlot: number;
  droppedInvalidCoordinates: number;
  droppedMissingDetails: number;
  droppedMealClassification: number;
  droppedLocalLifeFilter: number;
  droppedAlreadyUsed: number;
};

export function emptyPostprocessCounters(inputCount = 0): PostprocessDropCounters {
  return {
    inputCount,
    outputCount: 0,
    droppedMissingPlaceId: 0,
    droppedInvalidName: 0,
    droppedPlaceholder: 0,
    droppedWrongDestination: 0,
    droppedDuplicate: 0,
    droppedChildLandmark: 0,
    droppedTypeMismatch: 0,
    droppedMissingOpeningHours: 0,
    droppedClosedAtSlot: 0,
    droppedInvalidCoordinates: 0,
    droppedMissingDetails: 0,
    droppedMealClassification: 0,
    droppedLocalLifeFilter: 0,
    droppedAlreadyUsed: 0,
  };
}

export function mergePostprocessCounters(
  a: PostprocessDropCounters,
  b: PostprocessDropCounters,
): PostprocessDropCounters {
  const keys = Object.keys(a) as (keyof PostprocessDropCounters)[];
  const merged = { ...a };
  for (const key of keys) {
    if (key === "inputCount" || key === "outputCount") continue;
    merged[key] = (a[key] ?? 0) + (b[key] ?? 0);
  }
  merged.inputCount = a.inputCount + b.inputCount;
  merged.outputCount = a.outputCount + b.outputCount;
  return merged;
}

export function logItineraryPostprocessSummary(
  stage: string,
  counters: PostprocessDropCounters,
  extra?: string,
): void {
  const parts = [
    `[ITINERARY_POSTPROCESS_SUMMARY]`,
    `stage=${stage}`,
    `input=${counters.inputCount}`,
    `output=${counters.outputCount}`,
    counters.droppedMissingPlaceId ? `missingPlaceId=${counters.droppedMissingPlaceId}` : "",
    counters.droppedInvalidName ? `invalidName=${counters.droppedInvalidName}` : "",
    counters.droppedPlaceholder ? `placeholder=${counters.droppedPlaceholder}` : "",
    counters.droppedWrongDestination ? `wrongDestination=${counters.droppedWrongDestination}` : "",
    counters.droppedDuplicate ? `duplicate=${counters.droppedDuplicate}` : "",
    counters.droppedChildLandmark ? `childLandmark=${counters.droppedChildLandmark}` : "",
    counters.droppedTypeMismatch ? `typeMismatch=${counters.droppedTypeMismatch}` : "",
    counters.droppedMissingOpeningHours ? `missingOpeningHours=${counters.droppedMissingOpeningHours}` : "",
    counters.droppedClosedAtSlot ? `closedAtSlot=${counters.droppedClosedAtSlot}` : "",
    counters.droppedInvalidCoordinates ? `invalidCoordinates=${counters.droppedInvalidCoordinates}` : "",
    counters.droppedMissingDetails ? `missingDetails=${counters.droppedMissingDetails}` : "",
    counters.droppedMealClassification ? `mealClassification=${counters.droppedMealClassification}` : "",
    counters.droppedLocalLifeFilter ? `localLifeFilter=${counters.droppedLocalLifeFilter}` : "",
    counters.droppedAlreadyUsed ? `alreadyUsed=${counters.droppedAlreadyUsed}` : "",
    extra ?? "",
  ].filter(Boolean);
  console.warn(parts.join(" "));
}

export type RealPlaceFilterOptions = {
  stage?: string;
  requireCoordinates?: boolean;
};

/** Filter to real Google ChIJ places with aggregated drop counters. */
export function filterRealPlanningPlacesWithDiagnostics(
  places: PlaceResult[],
  options?: RealPlaceFilterOptions,
): { places: PlaceResult[]; counters: PostprocessDropCounters } {
  const stage = options?.stage ?? "real_place_filter";
  const counters = emptyPostprocessCounters(places.length);
  const out: PlaceResult[] = [];

  for (const place of places) {
    const rawId = resolvePlanningPlaceId(place);
    const id = normalizeGooglePlaceId(rawId);
    const name = (place.name ?? "").trim();

    if (!name) {
      counters.droppedInvalidName += 1;
      continue;
    }
    if (isPlaceholderPlanningPlaceName(name)) {
      counters.droppedPlaceholder += 1;
      continue;
    }
    if (!id) {
      counters.droppedMissingPlaceId += 1;
      continue;
    }
    if (!isHardGooglePlaceId(id)) {
      counters.droppedMissingPlaceId += 1;
      continue;
    }
    if (!/^ChIJ[\w-]+$/i.test(id)) {
      counters.droppedMissingPlaceId += 1;
      continue;
    }
    if (options?.requireCoordinates !== false) {
      if (place.lat == null || place.lng == null) {
        counters.droppedInvalidCoordinates += 1;
        continue;
      }
    }

    out.push({ ...place, id });
  }

  counters.outputCount = out.length;
  logItineraryPostprocessSummary(stage, counters);
  return { places: out, counters };
}

export function filterLocalLifeCandidatesWithDiagnostics(
  places: PlaceResult[],
  options?: { strict?: boolean },
): { places: PlaceResult[]; counters: PostprocessDropCounters } {
  const counters = emptyPostprocessCounters(places.length);
  const out: PlaceResult[] = [];
  const seen = new Set<string>();

  for (const place of places) {
    const id = resolveTripPlaceId(place);
    if (!id) {
      counters.droppedMissingPlaceId += 1;
      continue;
    }
    if (seen.has(id)) {
      counters.droppedDuplicate += 1;
      continue;
    }
    if (isLocalLifeExcludedPlace(place)) {
      counters.droppedLocalLifeFilter += 1;
      continue;
    }

    if (options?.strict) {
      const category = classifyTripPlaceCategory(place);
      const types = `${place.primaryType ?? ""} ${(place.types ?? []).join(" ")}`.toLowerCase();
      const hasUsefulType =
        /restaurant|food|cafe|coffee|tourist_attraction|shopping|market|museum|park|point_of_interest/.test(
          types,
        ) || category !== "generic";
      if (!hasUsefulType) {
        counters.droppedTypeMismatch += 1;
        continue;
      }
    }

    seen.add(id);
    out.push(place);
  }

  counters.outputCount = out.length;
  logItineraryPostprocessSummary("local_life_filter", counters);
  return { places: out, counters };
}

export type CategoryPoolCounts = {
  breakfast: number;
  attraction: number;
  lunch: number;
  cafe: number;
  dinner: number;
  evening: number;
  total: number;
};

export function logCategoryPoolCounts(stage: string, counts: CategoryPoolCounts): void {
  console.warn(
    "[ITINERARY_POOL_COUNTS]",
    `stage=${stage}`,
    `breakfast=${counts.breakfast}`,
    `attraction=${counts.attraction}`,
    `lunch=${counts.lunch}`,
    `cafe=${counts.cafe}`,
    `dinner=${counts.dinner}`,
    `evening=${counts.evening}`,
    `total=${counts.total}`,
  );
}

export function logItineraryPipelineSummary(params: {
  searchCount: number;
  normalizedCount: number;
  detailsEnrichedCount: number;
  postprocessCount: number;
  poolCounts?: CategoryPoolCounts;
  plannerItemCount: number;
  validationOk: boolean;
  renderedCardsCount: number;
}): void {
  console.warn(
    "[ITINERARY_PIPELINE_SUMMARY]",
    `search=${params.searchCount}`,
    `normalized=${params.normalizedCount}`,
    `details=${params.detailsEnrichedCount}`,
    `postprocess=${params.postprocessCount}`,
    params.poolCounts
      ? `pools=b${params.poolCounts.breakfast}/a${params.poolCounts.attraction}/l${params.poolCounts.lunch}/c${params.poolCounts.cafe}/d${params.poolCounts.dinner}/e${params.poolCounts.evening}`
      : "",
    `plannerItems=${params.plannerItemCount}`,
    `validation=${params.validationOk}`,
    `cards=${params.renderedCardsCount}`,
  );
}

/** Aggregated drop reasons across normalize + real-place filter stages. */
export function logPlaceNormalizeDropSummary(params: {
  input: number;
  output: number;
  normalizeCounters?: Partial<PostprocessDropCounters>;
  realFilterCounters?: Partial<PostprocessDropCounters>;
  unsupportedPayload?: number;
  other?: number;
}): void {
  const nc = params.normalizeCounters ?? {};
  const rc = params.realFilterCounters ?? {};
  const missingId =
    (nc.droppedMissingPlaceId ?? 0) + (rc.droppedMissingPlaceId ?? 0);
  const missingName =
    (nc.droppedInvalidName ?? 0) + (rc.droppedInvalidName ?? 0);
  const invalidCoordinates = rc.droppedInvalidCoordinates ?? 0;
  const wrongDestination = rc.droppedWrongDestination ?? 0;
  const duplicate =
    (nc.droppedDuplicate ?? 0) + (rc.droppedDuplicate ?? 0);
  const placeholder = rc.droppedPlaceholder ?? 0;
  const other =
    (params.other ?? 0) +
    (params.unsupportedPayload ?? 0) +
    (nc.droppedTypeMismatch ?? 0) +
    (rc.droppedTypeMismatch ?? 0) +
    (rc.droppedMissingDetails ?? 0) +
    (rc.droppedLocalLifeFilter ?? 0);

  console.warn(
    "[PLACE_NORMALIZE_DROP_SUMMARY]",
    `input=${params.input}`,
    `output=${params.output}`,
    missingId ? `missingId=${missingId}` : "",
    missingName ? `missingName=${missingName}` : "",
    invalidCoordinates ? `invalidCoordinates=${invalidCoordinates}` : "",
    wrongDestination ? `wrongDestination=${wrongDestination}` : "",
    duplicate ? `duplicate=${duplicate}` : "",
    placeholder ? `placeholder=${placeholder}` : "",
    other ? `other=${other}` : "",
  );
}

export type SlotDeficitCounts = {
  breakfastNeeded: number;
  attractionNeeded: number;
  lunchNeeded: number;
  cafeNeeded: number;
  dinnerNeeded: number;
  eveningNeeded: number;
};

const SLOTS_PER_DAY = {
  breakfast: 1,
  attraction: 2,
  lunch: 1,
  cafe: 1,
  dinner: 1,
  evening: 1,
} as const;

export function computeSlotDeficitFromPools(
  days: number,
  poolCounts: CategoryPoolCounts,
): SlotDeficitCounts {
  const safeDays = Math.max(1, days);
  return {
    breakfastNeeded: Math.max(0, safeDays * SLOTS_PER_DAY.breakfast - poolCounts.breakfast),
    attractionNeeded: Math.max(0, safeDays * SLOTS_PER_DAY.attraction - poolCounts.attraction),
    lunchNeeded: Math.max(0, safeDays * SLOTS_PER_DAY.lunch - poolCounts.lunch),
    cafeNeeded: Math.max(0, safeDays * SLOTS_PER_DAY.cafe - poolCounts.cafe),
    dinnerNeeded: Math.max(0, safeDays * SLOTS_PER_DAY.dinner - poolCounts.dinner),
    eveningNeeded: Math.max(0, safeDays * SLOTS_PER_DAY.evening - poolCounts.evening),
  };
}

export function logItinerarySlotDeficit(deficit: SlotDeficitCounts): void {
  console.warn(
    "[ITINERARY_SLOT_DEFICIT]",
    `breakfastNeeded=${deficit.breakfastNeeded}`,
    `attractionNeeded=${deficit.attractionNeeded}`,
    `lunchNeeded=${deficit.lunchNeeded}`,
    `cafeNeeded=${deficit.cafeNeeded}`,
    `dinnerNeeded=${deficit.dinnerNeeded}`,
    `eveningNeeded=${deficit.eveningNeeded}`,
  );
}

export function hasSlotDeficit(deficit: SlotDeficitCounts): boolean {
  return (
    deficit.breakfastNeeded > 0 ||
    deficit.attractionNeeded > 0 ||
    deficit.lunchNeeded > 0 ||
    deficit.cafeNeeded > 0 ||
    deficit.dinnerNeeded > 0 ||
    deficit.eveningNeeded > 0
  );
}

/** Classify whether a place lacks hours data needed for meal slots (for enrichment queue). */
export function placeNeedsHoursEnrichment(place: PlaceResult): boolean {
  if (hasOpeningHoursData(place)) return false;
  return requiresOpeningHours(place) || isFoodVenuePlace(place) || isBarBistroPlace(place);
}

export function countPlacesNeedingHoursEnrichment(places: PlaceResult[]): number {
  return places.filter(placeNeedsHoursEnrichment).length;
}
