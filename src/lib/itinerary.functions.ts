import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import type {
  RoamiePayloadV2,
  RoamieRecommendationItem,
  RoamieItineraryItem,
  RoamieResponse,
  TripTransportMode,
} from "@/lib/ai/types";
import { buildOutfitAdviceForTrip } from "@/lib/outfit/build-advice";
import { normalizeTime } from "@/lib/picker-utils";
import {
  INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
  invalidItineraryStopReason,
  isGenericPlaceLabel,
  isValidItineraryStopPlace,
} from "@/lib/ai/generic-place-label";
import {
  buildFallbackItineraryFromPlaces,
  coalesceItineraryItems,
  groupItineraryItemsByDay,
  type GenerateItineraryResult,
} from "@/lib/trip/itinerary-guards";
import {
  buildPlannerRequiredAnchors,
  preparePlacesForItineraryBuild,
} from "@/lib/place-planning-memory";
import type { PlaceResult } from "@/lib/place-result";
import { placeMatchesExcludedCategories } from "@/lib/ai/recommendation-exclusion";
import { dedupeLandmarkItems } from "@/lib/ai/landmark-cluster";
import { validateCrossDayGeographicAllocation } from "@/lib/ai/geographic-clustering";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { logAffiliateFactualEvidenceLifecycle } from "@/lib/affiliate/factual-evidence-lifecycle";
import {
  validateFinalItineraryIntegrity,
  validateGeneratedItinerary,
  groupStopsByTripDays,
} from "@/lib/ai/combination-itinerary-integrity";
import {
  buildRequiredAnchorPlaces,
  buildSelectedPlaceLock,
  recommendationIntegrityCheck,
  plannerDeliveryCheck,
} from "@/lib/ai/required-anchor-runtime";
import {
  isItineraryValidatorEnabled,
  validateItineraryPlan,
  shouldBlockItineraryDelivery,
  logItineraryDeliveryBlocked,
  logItineraryDeliveryAllowed,
  dayCountsOfPlans,
  compareItineraryPersistenceDayCounts,
  ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
} from "@/lib/ai/itinerary-validator";
import { applyItineraryLocalizationGate } from "@/lib/ai/itinerary-localization-gate";
import { buildLegMinutesFromPlaces } from "@/lib/ai/estimate-place-visit-duration";
import { resolvePlannerPaceFromProfile } from "@/lib/ai/required-anchor-runtime";
import {
  applyComposedPlansToItineraryItems,
  composedPlansFromItineraryItems,
} from "@/lib/ai/itinerary-validator/from-payload";
import {
  classifyRequiredIdentityAvailability,
  evaluateRequiredPlaceCoverage,
  repairRequiredPlaceCoverage,
  replanUntilItineraryValid,
} from "@/lib/ai/itinerary-validator/replan";
import type { ItineraryValidatorInput } from "@/lib/ai/itinerary-validator/types";
import { resolvePlannerStyleKey, type ComposedDayPlan } from "@/lib/ai/ai-day-plan-source";
import {
  inspectItineraryIdentityLookup,
  itineraryInternalIdentityHashes,
  itineraryIdentityCounts,
  itineraryStopHash,
  recoverItineraryGoogleIdentities,
} from "@/lib/ai/itinerary-google-identity";
import { resolveAdministrativeScope } from "@/lib/ai/administrative-locality";
import {
  buildDeliverableItineraryCandidatePool,
  assessDeterministicRebuildCapacity,
  type ItineraryCandidateSourceType,
} from "@/lib/ai/itinerary-deliverable-candidate";
import { isHardGooglePlaceId } from "@/lib/ai/planning-place-id";
import {
  applyFinalDayRouteOrdering,
  type ItineraryRouteOrderStage,
} from "@/lib/ai/final-day-route-ordering";
import { repairCrossDayGeographicCohesion } from "@/lib/ai/cross-day-geographic-cohesion";
import { isExcludedByPlaceOrAncestor } from "@/lib/ai/venue-hierarchy-relation";
import { resolveItineraryCandidateCapacityTarget } from "@/lib/ai/real-place-supplement";

type GeographicScopeResult = "in_scope" | "out_of_scope" | "unknown";

export type ItineraryGeographicScopeDecision = {
  country?: string;
  destinationCityResolved: string;
  candidateCityResolved: string;
  districtResolved: string;
  destinationNormalized: string;
  candidateCityNormalized: string;
  candidateDistrictNormalized: string;
  evidenceSource:
    | "destination_alias"
    | "formatted_address_city"
    | "formatted_address_district"
    | "none";
  decision: GeographicScopeResult;
  mismatchReason: "city_match" | "city_mismatch" | "destination_unknown" | "no_reliable_locality";
};

type ItineraryScopeCandidate = {
  address?: string | null;
  destinationScope?: "primary" | "nearby_extension";
  extensionDestination?: string;
  sourceRegionCandidate?: string;
};

export function itineraryGeographicScopeDecision(
  place: ItineraryScopeCandidate,
  destination: string,
): ItineraryGeographicScopeDecision {
  const { destinationLocality, candidateLocality } = resolveAdministrativeScope(
    destination,
    place.address,
  );
  const destinationCity = destinationLocality.canonicalCity ?? "";
  const candidateCity = candidateLocality.canonicalCity ?? "";
  const district = candidateLocality.canonicalDistrict ?? "";
  const common = {
    country: candidateLocality.country ?? destinationLocality.country,
    destinationCityResolved: destinationCity,
    candidateCityResolved: candidateCity,
    districtResolved: district,
    destinationNormalized: destinationCity,
    candidateCityNormalized: candidateCity,
    candidateDistrictNormalized: district,
    evidenceSource: candidateLocality.evidenceSource,
  };
  if (!destinationCity) {
    return { ...common, decision: "unknown", mismatchReason: "destination_unknown" };
  }
  if (!candidateCity) {
    return { ...common, decision: "unknown", mismatchReason: "no_reliable_locality" };
  }
  const matches = candidateCity === destinationCity;
  return {
    ...common,
    decision: matches ? "in_scope" : "out_of_scope",
    mismatchReason: matches ? "city_match" : "city_mismatch",
  };
}

export function classifyItineraryGeographicScope(
  place: ItineraryScopeCandidate,
  destination: string,
): GeographicScopeResult {
  return itineraryGeographicScopeDecision(place, destination).decision;
}

export type RequiredCoverageDropReason =
  | "none"
  | "not_generated"
  | "removed_by_replan"
  | "removed_by_dedupe"
  | "removed_by_scope"
  | "removed_by_operational"
  | "removed_by_invalid_place"
  | "removed_by_capacity"
  | "other";

function stopMatchesRequired(
  stop: RoamieItineraryItem,
  required: RoamieRecommendationItem,
): boolean {
  const requiredId = required.googlePlaceId?.trim();
  const requiredName = (required.placeName ?? required.name).trim().toLowerCase();
  return Boolean(
    (requiredId && stop.googlePlaceId?.trim() === requiredId) ||
    (stop.placeName ?? stop.title).trim().toLowerCase() === requiredName,
  );
}

export function buildRequiredCoverageDecisions(
  requiredPlaces: readonly RoamieRecommendationItem[],
  stages: {
    initial: readonly RoamieItineraryItem[];
    afterReplan: readonly RoamieItineraryItem[];
    afterRebuild: readonly RoamieItineraryItem[];
    preValidator: readonly RoamieItineraryItem[];
    rebuildAttempted: boolean;
  },
) {
  return requiredPlaces.map((required, requiredIndex) => {
    const presentInInitial = stages.initial.some((stop) => stopMatchesRequired(stop, required));
    const presentAfterReplan = stages.afterReplan.some((stop) =>
      stopMatchesRequired(stop, required),
    );
    const presentAfterRebuild = stages.afterRebuild.some((stop) =>
      stopMatchesRequired(stop, required),
    );
    const presentPreValidator = stages.preValidator.some((stop) =>
      stopMatchesRequired(stop, required),
    );
    let dropReasonCode: RequiredCoverageDropReason = "none";
    if (!presentPreValidator) {
      if (!presentInInitial) dropReasonCode = "not_generated";
      else if (!presentAfterReplan) dropReasonCode = "removed_by_replan";
      else if (stages.rebuildAttempted && !presentAfterRebuild) {
        dropReasonCode = "removed_by_capacity";
      } else {
        dropReasonCode = "other";
      }
    }
    return {
      requiredIndex,
      presentInInitial,
      presentAfterReplan,
      presentAfterRebuild,
      presentPreValidator,
      dropReasonCode,
    };
  });
}

export type ItineraryDeliveryQuality = {
  populatedDayCount: number;
  requiredCoverageCount: number;
  blockingFailedRuleCount: number;
  totalValidEntryCount: number;
};

export function shouldReplaceItineraryWithRebuild(
  current: ItineraryDeliveryQuality,
  rebuilt: ItineraryDeliveryQuality,
): boolean {
  if (current.totalValidEntryCount > 0 && rebuilt.totalValidEntryCount === 0) return false;
  if (rebuilt.populatedDayCount < current.populatedDayCount) return false;
  if (rebuilt.requiredCoverageCount < current.requiredCoverageCount) return false;
  return (
    rebuilt.populatedDayCount > current.populatedDayCount ||
    rebuilt.requiredCoverageCount > current.requiredCoverageCount ||
    rebuilt.blockingFailedRuleCount < current.blockingFailedRuleCount ||
    rebuilt.totalValidEntryCount > current.totalValidEntryCount
  );
}

const PlaceSchema = z
  .object({
    name: z.string(),
    type: z.string().optional(),
    primaryType: z.string().nullable().optional(),
    types: z.array(z.string()).optional(),
    description: z.string().optional(),
    reason: z.string().optional(),
    estimatedTime: z.string().optional(),
    address: z.string().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    googleMapsUrl: z.string().optional(),
    placeName: z.string().optional(),
    googlePlaceId: z.string().optional(),
    reasonSource: z.enum(["template", "ai", "evidence", "fallback"]).optional(),
    sourceCombinationId: z.number().optional(),
    sourceCombinationIds: z.array(z.number()).optional(),
    matchedCombinationIds: z.array(z.number()).optional(),
    matchedSelectedCombinationIds: z.array(z.number()).optional(),
    sourceRegionCandidate: z.string().optional(),
    destinationScope: z.enum(["primary", "nearby_extension"]).optional(),
    extensionDestination: z.string().optional(),
    isRequiredBySelection: z.boolean().optional(),
    photoName: z.string().nullable().optional(),
    rating: z.number().nullable().optional(),
    userRatingCount: z.number().nullable().optional(),
    businessStatus: z.string().nullable().optional(),
    openStatusLabel: z.string().optional(),
    todayHoursLabel: z.string().optional(),
  })
  .transform((raw) => ({
    name: raw.name,
    type: raw.type ?? "地點",
    ...(raw.primaryType != null ? { primaryType: raw.primaryType } : {}),
    types: raw.types,
    description: raw.description ?? "",
    reason: raw.reason ?? "",
    estimatedTime: raw.estimatedTime ?? "1-2 小時",
    address: raw.address ?? "",
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    googleMapsUrl: raw.googleMapsUrl ?? "",
    placeName: raw.placeName ?? raw.name,
    googlePlaceId: raw.googlePlaceId,
    reasonSource: raw.reasonSource ?? "template",
    sourceCombinationId: raw.sourceCombinationId,
    sourceCombinationIds: raw.sourceCombinationIds,
    matchedCombinationIds: raw.matchedCombinationIds,
    matchedSelectedCombinationIds: raw.matchedSelectedCombinationIds,
    sourceRegionCandidate: raw.sourceRegionCandidate,
    destinationScope: raw.destinationScope,
    extensionDestination: raw.extensionDestination,
    isRequiredBySelection: raw.isRequiredBySelection,
    photoName: raw.photoName,
    rating: raw.rating,
    userRatingCount: raw.userRatingCount,
    businessStatus: raw.businessStatus,
    openStatusLabel: raw.openStatusLabel,
    todayHoursLabel: raw.todayHoursLabel,
  }));

const InputSchema = z.object({
  destination: z.string().min(1).max(100),
  days: z.number().int().min(1).max(14),
  budget: z.enum(["low", "medium", "high"]).default("medium"),
  style: z.string().max(120).optional().default(""),
  mood: z.string().max(120).optional().default(""),
  interests: z.string().max(4000).optional().default(""),
  conversationSummary: z.string().max(4000).optional().default(""),
  startDate: z.string().max(40).optional().default(""),
  endDate: z.string().max(40).optional().default(""),
  origin: z.string().max(120).optional().default(""),
  travelers: z.number().int().min(1).max(20).optional(),
  transport: z.string().max(120).optional().default(""),
  /** User-selected places are the complete/authoritative place pool. */
  placeAuthority: z.enum(["selected_only"]).optional(),
  selectedPlaces: z.array(PlaceSchema).max(70).optional().default([]),
  selectedCombinationIds: z.array(z.number().int().positive()).max(10).optional().default([]),
  nearbyExtensions: z.array(z.string().max(80)).max(10).optional().default([]),
  excludedCategories: z.array(z.string().max(40)).max(30).optional().default([]),
  excludedPlaceIds: z.array(z.string().min(1).max(300)).max(100).optional().default([]),
  /** Existing candidate metadata only; enables parent→proven-descendant exclusion without a new request. */
  excludedPlaces: z.array(PlaceSchema).max(100).optional().default([]),
  preferences: z.record(z.unknown()).optional(),
  location: z.object({ lat: z.number(), lng: z.number(), city: z.string().optional() }).optional(),
  weather: z.record(z.unknown()).nullable().optional(),
  time: z.string().optional(),
  /** 穿搭風格（文青、韓系、極簡等），來自個人檔案 */
  fashionStyle: z.string().max(80).optional().default(""),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
  generationStartedAt: z.number().int().positive().optional(),
  generationTimingId: z.string().max(120).optional(),
  /** Correlates the client handoff, server planner, result normalization and persistence logs. */
  generationId: z.string().min(1).max(120).optional(),
});

function inferTripTransport(transport?: string): TripTransportMode {
  const t = (transport ?? "").toLowerCase();
  if (/機車|scooter|摩托/.test(t)) return "scooter";
  if (/開車|自驾|自駕|drive|car|租車/.test(t)) return "drive";
  if (/捷運|地鐵|地铁|大眾|公車|公交|transit|mrt|metro/.test(t)) return "transit";
  return "walk";
}

function filterValidSelectedPlaces(
  places: RoamieRecommendationItem[],
  destination: string,
): RoamieRecommendationItem[] {
  return preparePlacesForItineraryBuild(
    places.map((p) => ({
      ...p,
      placeId: p.googlePlaceId ?? (p as RoamieRecommendationItem & { placeId?: string }).placeId,
    })),
    destination,
  );
}

function enrichItineraryFromSelectedPlaces(
  items: RoamieItineraryItem[],
  selectedPlaces: RoamieRecommendationItem[],
  destination: string,
): RoamieItineraryItem[] {
  const byId = new Map(
    selectedPlaces.filter((p) => p.googlePlaceId?.trim()).map((p) => [p.googlePlaceId!.trim(), p]),
  );
  const byName = new Map(selectedPlaces.map((p) => [(p.placeName ?? p.name).trim(), p]));

  return items
    .map((item) => {
      const name = (item.placeName ?? item.title).trim();
      if (!name || isGenericPlaceLabel(name, destination)) return null;

      const match =
        (item.googlePlaceId?.trim() && byId.get(item.googlePlaceId.trim())) ||
        byName.get(name) ||
        byName.get(item.title.trim());

      const enriched: RoamieItineraryItem = match
        ? {
            ...item,
            placeName: match.placeName ?? match.name,
            title: item.title?.trim() ? item.title : match.name,
            googlePlaceId: match.googlePlaceId,
            lat: match.lat,
            lng: match.lng,
            address: item.address?.trim() ? item.address : match.address,
            placeType: item.placeType || match.type,
            photoName: item.photoName ?? match.photoName,
            rating: item.rating ?? match.rating,
            userRatingCount: item.userRatingCount ?? match.userRatingCount,
            businessStatus: item.businessStatus ?? match.businessStatus,
            openStatusLabel: item.openStatusLabel || match.openStatusLabel,
            todayHoursLabel: item.todayHoursLabel || match.todayHoursLabel,
            types: item.types?.length ? item.types : match.type ? [match.type] : undefined,
            placeSnapshotSource: item.placeSnapshotSource ?? "selected_place",
            sourceCombinationId: item.sourceCombinationId ?? match.sourceCombinationId,
            matchedCombinationIds: item.matchedCombinationIds ?? match.matchedCombinationIds,
            matchedSelectedCombinationIds:
              item.matchedSelectedCombinationIds ?? match.matchedSelectedCombinationIds,
          }
        : item;

      if (
        !isValidItineraryStopPlace(
          {
            placeName: enriched.placeName,
            name: enriched.title,
            placeId: enriched.googlePlaceId,
            googlePlaceId: enriched.googlePlaceId,
            address: enriched.address,
            lat: enriched.lat,
            lng: enriched.lng,
          },
          destination,
        )
      ) {
        return null;
      }
      return enriched;
    })
    .filter((item): item is RoamieItineraryItem => item != null);
}

function buildItineraryFromSelectedPlaces(
  selectedPlaces: RoamieRecommendationItem[],
  days: number,
  startDate: string,
  destination?: string,
  selectedCombinationIds?: number[],
  requireDeliverableCandidates = false,
): RoamieItineraryItem[] {
  return buildFallbackItineraryFromPlaces(selectedPlaces, days, startDate, destination, {
    selectedCombinationIds,
    requireDeliverableCandidates,
  });
}

function buildFallbackTripPayload(
  data: ItineraryInput,
  items: RoamieItineraryItem[],
  selectedPlaces: RoamieRecommendationItem[],
): RoamiePayloadV2 {
  const placeNames = selectedPlaces.map((p) => p.placeName ?? p.name).join("、");
  return {
    version: 2,
    title: `${data.destination} ${data.days} 天`,
    summary: `依你選的地點排成 ${data.days} 天節奏：${placeNames}`,
    moodTag: data.mood ?? "",
    recommendations: selectedPlaces,
    itinerary: items,
    destination: data.destination,
    days: data.days,
    generatedAt: new Date().toISOString(),
  };
}

export type ItineraryInput = z.infer<typeof InputSchema>;

/** @deprecated Legacy format — kept for backward-compatible trip display */
export type ItineraryBlock = {
  time: string;
  title: string;
  type: "place" | "food" | "transit" | "rest" | "experience";
  description: string;
  duration_minutes: number;
  estimated_cost: string;
  tags: string[];
};

export type ItineraryDay = {
  day: number;
  date?: string;
  theme: string;
  weather_note?: string;
  blocks: ItineraryBlock[];
  rainy_alternative?: string;
  estimated_daily_cost: string;
};

export type Itinerary = {
  title: string;
  destination: string;
  days: number;
  mood: string;
  summary: string;
  total_estimated_cost: string;
  transport_tips: string;
  daily_plan: ItineraryDay[];
};

export const generateItinerary = createServerFn({ method: "POST" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<GenerateItineraryResult> => {
    const generationId = data.generationId ?? data.generationTimingId ?? "";
    console.info("[ITINERARY_SERVER_REQUEST]", {
      generationId,
      received: true,
      transport: "tanstack_createServerFn",
    });
    console.info("[ITINERARY_DAYS_AUTHORITY]", {
      generationId,
      stage: "server_parse",
      explicitDays: data.days,
      derivedDays: null,
      effectiveDays: data.days,
      startDatePresent: Boolean(data.startDate?.trim()),
      endDatePresent: Boolean(data.endDate?.trim()),
      source: "explicit_days",
    });
    const finish = (result: GenerateItineraryResult): GenerateItineraryResult => {
      const trip = result.success ? result.trip : undefined;
      const failure = result.success ? undefined : result;
      console.info("[ITINERARY_SERVER_RESULT]", {
        generationId,
        topLevelKeys: Object.keys(result).sort(),
        successPresent: Object.prototype.hasOwnProperty.call(result, "success"),
        successDiscriminant: result.success,
        errorCode: failure?.errorCode ?? "",
        failureReason: failure?.failureReason ?? "",
        failedRuleCount: failure?.failedRules?.length ?? 0,
        tripPresent: Boolean(trip),
        payloadPresent: Boolean(trip?.payload),
        transport: "tanstack_createServerFn",
      });
      return result;
    };
    let timingLastAt = Date.now();
    const logGenerationTiming = (stage: string, success = true, failureReason = "") => {
      if (data.placeAuthority !== "selected_only") return;
      const now = Date.now();
      console.info("[PLANNING_SELECTION_GENERATION_TIMING]", {
        generationId: data.generationId ?? data.generationTimingId ?? "",
        stage,
        elapsedMs: data.generationStartedAt ? now - data.generationStartedAt : 0,
        stageDurationMs: now - timingLastAt,
        selectedCount: data.selectedPlaces.length,
        tripDays: data.days,
        success,
        failureReason,
        timingId: data.generationTimingId ?? "",
      });
      timingLastAt = now;
    };
    const [{ callRoamieAI }, { buildTransitLegsForItinerary }, { openWeatherGetForecast }] =
      await Promise.all([
        import("@/lib/ai/service.server"),
        import("@/lib/transit/build-legs.server"),
        import("@/lib/weather/openweather.server"),
      ]);
    const excludedPlaceIds = new Set(data.excludedPlaceIds.map((id) => id.trim()));
    const explicitExcludedPlaces = data.excludedPlaces as RoamieRecommendationItem[];
    const exclusionDecision = (place: RoamieRecommendationItem) =>
      isExcludedByPlaceOrAncestor(
        {
          googlePlaceId: place.googlePlaceId,
          name: place.placeName ?? place.name,
          address: place.address ?? null,
          lat: place.lat ?? null,
          lng: place.lng ?? null,
          primaryType: place.primaryType ?? place.type ?? null,
          types: place.types ?? (place.type ? [place.type] : null),
        },
        [...excludedPlaceIds],
        explicitExcludedPlaces.map((excluded) => ({
          googlePlaceId: excluded.googlePlaceId,
          name: excluded.placeName ?? excluded.name,
          address: excluded.address ?? null,
          lat: excluded.lat ?? null,
          lng: excluded.lng ?? null,
          primaryType: excluded.primaryType ?? excluded.type ?? null,
          types: excluded.types ?? (excluded.type ? [excluded.type] : null),
        })),
      );
    const inputPlaces = (data.selectedPlaces ?? []) as RoamieRecommendationItem[];
    const inputRequiredPlaces =
      data.placeAuthority === "selected_only"
        ? inputPlaces
        : inputPlaces.filter((place) => place.isRequiredBySelection !== false);
    const inputSupplementalCandidates =
      data.placeAuthority === "selected_only"
        ? []
        : inputPlaces.filter((place) => place.isRequiredBySelection === false);
    const filterExcluded = (place: RoamieRecommendationItem) =>
      !exclusionDecision(place).excluded &&
      !placeMatchesExcludedCategories(
        {
          name: place.placeName ?? place.name,
          address: place.address ?? null,
          type: place.type,
          description: place.description,
          primaryType: place.primaryType ?? place.type ?? null,
          types: place.types ?? (place.type ? [place.type] : null),
        },
        data.excludedCategories,
      );
    // Explicitly accepted required anchors use the Planner surface. Do not run
    // them through the generic Home/Explore recommendation-label gate again.
    const requiredBeforeExclusion = buildPlannerRequiredAnchors(
      inputRequiredPlaces,
      data.destination,
      true,
    );
    const requiredSelectedPlaces = requiredBeforeExclusion.filter(filterExcluded);
    const inputSupplementalPlaces = filterValidSelectedPlaces(
      inputSupplementalCandidates,
      data.destination,
    ).filter(filterExcluded);
    const requiredRejectedCount = Math.max(
      0,
      inputRequiredPlaces.length - requiredSelectedPlaces.length,
    );
    const requiredRejectionReasonCounts: Record<string, number> = {};
    const acceptedRequiredKeys = new Set(
      requiredSelectedPlaces.map(
        (place) =>
          place.googlePlaceId?.trim() ||
          `${(place.placeName ?? place.name).trim().toLowerCase()}@${place.address ?? ""}`,
      ),
    );
    const seenRequiredKeys = new Set<string>();
    for (const place of inputRequiredPlaces) {
      const key =
        place.googlePlaceId?.trim() ||
        `${(place.placeName ?? place.name).trim().toLowerCase()}@${place.address ?? ""}`;
      if (acceptedRequiredKeys.has(key) && !seenRequiredKeys.has(key)) {
        seenRequiredKeys.add(key);
        continue;
      }
      let reason = "other";
      const status = (place.businessStatus ?? "").toUpperCase();
      const hasIdentity = Boolean(place.googlePlaceId?.trim());
      const hasCoordinates =
        Number.isFinite(place.lat) &&
        Number.isFinite(place.lng) &&
        (Math.abs(place.lat ?? 0) > 0.001 || Math.abs(place.lng ?? 0) > 0.001);
      if (seenRequiredKeys.has(key)) reason = "duplicate";
      else if (exclusionDecision(place).excluded) reason = "excluded";
      else if (status === "CLOSED_TEMPORARILY") reason = "closed_temporarily";
      else if (status === "CLOSED_PERMANENTLY") reason = "closed_permanently";
      else if ((place.lat != null || place.lng != null) && !hasCoordinates && !hasIdentity)
        reason = "invalid_coordinates";
      else if (!hasIdentity && !hasCoordinates) reason = "invalid_identity";
      else if (!isValidItineraryStopPlace(place, data.destination)) reason = "unsuitable_type";
      requiredRejectionReasonCounts[reason] = (requiredRejectionReasonCounts[reason] ?? 0) + 1;
      seenRequiredKeys.add(key);
    }
    console.info("[ITINERARY_REQUIRED_SERVER_FILTER]", {
      generationId,
      inputCount: inputRequiredPlaces.length,
      eligibleCount: requiredSelectedPlaces.length,
      rejectedCount: requiredRejectedCount,
      rejectionReasonCounts: requiredRejectionReasonCounts,
    });
    const supplementalScope = inputSupplementalPlaces.map((place, candidateIndex) => {
      const scopeDecision = itineraryGeographicScopeDecision(place, data.destination);
      console.info("[ITINERARY_SUPPLEMENT_SCOPE_DECISION]", {
        generationId,
        candidateIndex,
        country: scopeDecision.country,
        destinationCityResolved: scopeDecision.destinationCityResolved,
        candidateCityResolved: scopeDecision.candidateCityResolved,
        districtResolved: scopeDecision.districtResolved,
        destinationNormalized: scopeDecision.destinationNormalized,
        candidateCityNormalized: scopeDecision.candidateCityNormalized,
        candidateDistrictNormalized: scopeDecision.candidateDistrictNormalized,
        evidenceSource: scopeDecision.evidenceSource,
        decision: scopeDecision.decision,
        mismatchReason: scopeDecision.mismatchReason,
      });
      return { place, scope: scopeDecision.decision };
    });
    const supplementalPlaces = supplementalScope
      .filter(({ scope }) => scope !== "out_of_scope")
      .map(({ place }) => place);
    const selectedPlaces = [...requiredSelectedPlaces, ...supplementalPlaces];
    for (const place of selectedPlaces) {
      logAffiliateFactualEvidenceLifecycle("server_input", place, generationId);
    }
    const serverCapacityTarget = resolveItineraryCandidateCapacityTarget(data.days);
    const serverDeliverablePool = buildDeliverableItineraryCandidatePool(
      selectedPlaces.map((candidate) => ({
        candidate,
        sourceType: candidate.isRequiredBySelection === false
          ? ("supplemental_pool" as const)
          : ("legacy_selected_places" as const),
      })),
      data.destination,
    );
    console.info("[ITINERARY_CANDIDATE_CAPACITY]", {
      generationId,
      stage: "server_input",
      tripDays: data.days,
      requiredCount: requiredSelectedPlaces.length,
      supplementalSeedCount: supplementalPlaces.length,
      rawCandidateCount: inputPlaces.length,
      deliverableCandidateCount: serverDeliverablePool.deliverableCount,
      hardMinimum: serverCapacityTarget.hardMinimum,
      preferredTarget: serverCapacityTarget.preferredTarget,
      expansionNeeded: serverDeliverablePool.deliverableCount < serverCapacityTarget.hardMinimum,
      expansionAttempted: false,
      expansionAddedCount: 0,
      finalDeliverableCount: serverDeliverablePool.deliverableCount,
      expansionSkippedReason: "client_preflight_authority",
    });
    const stopOrigins = new Map<
      string,
      | "initial_ai"
      | "required_repair"
      | "supplemental_repair"
      | "replan"
      | "deterministic_rebuild"
      | "preserved"
      | "unknown"
    >();
    const logAssemblyStage = (stage: string, stops: readonly RoamieItineraryItem[]) => {
      const plans = composedPlansFromItineraryItems(stops, data.days, data.startDate);
      const identityCounts = itineraryIdentityCounts(stops, selectedPlaces);
      console.info("[ITINERARY_ASSEMBLY_STAGE]", {
        generationId,
        stage,
        requestedDays: data.days,
        dayArrayCount: plans.length,
        populatedDayCount: plans.filter((plan) => plan.entries.length > 0).length,
        totalEntryCount: plans.reduce((count, plan) => count + plan.entries.length, 0),
        requiredPoolCount: requiredSelectedPlaces.length,
        supplementalPoolCount: supplementalPlaces.length,
      });
      console.info("[ITINERARY_IDENTITY_PROPAGATION]", {
        generationId,
        stage,
        totalCount: identityCounts.totalStopCount,
        googleIdPresentCount: identityCounts.googleIdentityCount,
        internalOnlyCount: identityCounts.internalOnlyIdentityCount,
        lostGoogleIdCount: identityCounts.lostGoogleIdCount,
        internalOnlyIdentityHashes: itineraryInternalIdentityHashes(stops),
      });
      for (const stop of stops) {
        const stopHash = itineraryStopHash(stop);
        const lookup = inspectItineraryIdentityLookup(stop, selectedPlaces);
        console.info("[ITINERARY_STOP_ORIGIN]", {
          generationId,
          anonymousStopHash: stopHash,
          createdBy: stopOrigins.get(stopHash) ?? "unknown",
          googlePlaceIdPresent: lookup.reason === "already_google",
          canonicalIdentityPresent: Boolean(
            stop.googlePlaceId?.trim() || stop.placeName?.trim() || stop.title.trim(),
          ),
          sourceCandidateIndexPresent: lookup.candidateIndex != null,
          provenanceKeyPresent: lookup.candidate != null,
        });
      }
    };
    console.info("[ITINERARY_SUPPLEMENT_SCOPE_FILTER]", {
      generationId,
      inputSupplementalCount: inputSupplementalPlaces.length,
      inScopeSupplementalCount: supplementalScope.filter(({ scope }) => scope === "in_scope")
        .length,
      droppedOutOfScopeCount: supplementalScope.filter(({ scope }) => scope === "out_of_scope")
        .length,
      unknownScopeCount: supplementalScope.filter(({ scope }) => scope === "unknown").length,
    });

    if (selectedPlaces.length < 1) {
      return finish({
        success: false,
        errorCode: "insufficient_places",
        message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
      });
    }

    if (data.placeAuthority !== "selected_only" && selectedPlaces.length < data.days) {
      logAiPipeline(
        "[INSUFFICIENT_REAL_PLACES_DETECTED]",
        `tripDays=${data.days}`,
        `resolvedPlaces=${selectedPlaces.length}`,
        `minimumRequired=${data.days}`,
        "stage=generate_itinerary_entry",
      );
      return finish({
        success: false,
        errorCode: "insufficient_places",
        message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
      });
    }

    const analyticsOperationId =
      data.generationId?.trim() ||
      data.generationTimingId?.trim() ||
      data.generationStartedAt?.toString() ||
      crypto.randomUUID();
    const { analyticsOperationEventId } = await import("@/lib/analytics/events");
    const { recordAnalyticsEventServer } = await import("@/lib/analytics/record.server");
    const recordGenerationOutcome = async (success: boolean, failureCode?: string) =>
      recordAnalyticsEventServer({
        eventId: analyticsOperationEventId(analyticsOperationId, success ? "succeeded" : "failed"),
        eventName: success ? "itinerary_generation_succeeded" : "itinerary_generation_failed",
        failureCode,
      });
    await recordAnalyticsEventServer({
      eventId: analyticsOperationEventId(analyticsOperationId, "started"),
      eventName: "itinerary_generation_started",
    });

    const interestsText = [data.interests, data.conversationSummary].filter(Boolean).join("\n\n");
    const startDate = data.startDate?.trim() || new Date().toISOString().slice(0, 10);
    const selectedCombinationIds = data.selectedCombinationIds ?? [];
    const requiredPlaceNames = requiredSelectedPlaces.map((p) => p.placeName ?? p.name);

    logAiPipeline("[SELECTED_COMBINATIONS_CONFIRMED]", `ids=[${selectedCombinationIds.join(",")}]`);
    logAiPipeline(
      "[SELECTED_PLACE_POOL_BUILT]",
      `count=${selectedPlaces.length}`,
      `places=[${requiredPlaceNames.join(",")}]`,
    );

    logAiPipeline(
      "[ITINERARY_PLANNER_START]",
      `generationId=${data.generationId ?? ""}`,
      `destination=${data.destination}`,
      `days=${data.days}`,
      `selectedPlaces=${selectedPlaces.length}`,
      `requiredPlaces=${requiredSelectedPlaces.length}`,
      `supplementalPlaces=${supplementalPlaces.length}`,
      `selectedCombinationIds=${selectedCombinationIds.join(",")}`,
    );
    console.info("[ITINERARY_DAYS_AUTHORITY]", {
      generationId,
      stage: "planner",
      explicitDays: data.days,
      derivedDays: null,
      effectiveDays: data.days,
      startDatePresent: Boolean(data.startDate?.trim()),
      endDatePresent: Boolean(data.endDate?.trim()),
      source: "explicit_days",
    });
    logGenerationTiming("route_day_assembly_start");

    let ai: RoamiePayloadV2 | null = null;
    let usedDeterministic = false;
    const initialAiStopHashes = new Set<string>();

    // When the user locked combination selections, the deterministic geography-first
    // allocator is authoritative. AI may only rearrange; coverage failures rebuild.
    if (selectedCombinationIds.length > 0) {
      const builtItems = buildItineraryFromSelectedPlaces(
        selectedPlaces,
        data.days,
        startDate,
        data.destination,
        selectedCombinationIds,
      );
      const coverageCheck = validateGeneratedItinerary({
        tripDays: data.days,
        startDate,
        selectedCombinationIds,
        days: groupStopsByTripDays(builtItems, data.days, startDate),
        resolvedPlaces: selectedPlaces,
        destination: data.destination,
        placeAuthority: data.placeAuthority,
      });
      if (coverageCheck.ok || builtItems.length >= selectedCombinationIds.length) {
        ai = buildFallbackTripPayload(data, builtItems, selectedPlaces);
        usedDeterministic = true;
        logAiPipeline(
          "[ITINERARY_BUILD_PATH]",
          "path=deterministic_selected_combinations",
          `places=${builtItems.length}`,
        );
      }
    }

    if (!ai) {
      try {
        const aiResponse: RoamieResponse = await callRoamieAI({
          mode: "itinerary",
          locale: data.locale,
          mood: data.mood,
          preferences: data.preferences as never,
          location: data.location,
          weather: data.weather as never,
          time: data.time,
          planningHints: {
            transportation: data.transport,
            budget: data.budget === "low" ? "省錢" : data.budget === "high" ? "舒適" : "適中",
            conversationSummary: data.conversationSummary,
          },
          itineraryRequest: {
            destination: data.destination,
            days: data.days,
            budget: data.budget,
            style: data.style,
            mood: data.mood,
            interests: interestsText,
            startDate: data.startDate,
            endDate: data.endDate,
            origin: data.origin,
            travelers: data.travelers,
            transport: data.transport,
            selectedPlaces,
            selectedCombinationIds,
          },
        });

        let rawItinerary = coalesceItineraryItems(aiResponse.itinerary);
        if (rawItinerary.length > 0) {
          const initialIdentityRecovery = recoverItineraryGoogleIdentities({
            stops: rawItinerary,
            candidates: selectedPlaces,
          });
          rawItinerary = initialIdentityRecovery.items;
          for (const stop of rawItinerary) initialAiStopHashes.add(itineraryStopHash(stop));
          console.info("[ITINERARY_IDENTITY_LOOKUP]", {
            generationId,
            stage: "initial_normalization",
            inputMissingCount:
              initialIdentityRecovery.restoredFromCandidatePoolCount +
              initialIdentityRecovery.unrecoverableCount,
            canonicalMatchCount: initialIdentityRecovery.lookupReasonCounts.canonical_identity ?? 0,
            sourceKeyMatchCount: initialIdentityRecovery.lookupReasonCounts.source_key ?? 0,
            nameAddressMatchCount: initialIdentityRecovery.lookupReasonCounts.name_address ?? 0,
            nameCoordinateMatchCount:
              initialIdentityRecovery.lookupReasonCounts.name_coordinate ?? 0,
            ambiguousCount: initialIdentityRecovery.lookupReasonCounts.ambiguous ?? 0,
            noMatchCount: initialIdentityRecovery.lookupReasonCounts.no_match ?? 0,
            sourceCandidateMissingGoogleIdCount:
              initialIdentityRecovery.lookupReasonCounts.source_candidate_missing_google_id ?? 0,
          });
          const enrichedItinerary = enrichItineraryFromSelectedPlaces(
            rawItinerary,
            selectedPlaces,
            data.destination,
          );
          if (enrichedItinerary.length > 0) {
            const aiCoverage = validateGeneratedItinerary({
              tripDays: data.days,
              startDate,
              selectedCombinationIds,
              days: groupStopsByTripDays(enrichedItinerary, data.days, startDate),
              resolvedPlaces: selectedPlaces,
              destination: data.destination,
              placeAuthority: data.placeAuthority,
            });
            if (!aiCoverage.ok && selectedCombinationIds.length > 0) {
              logAiPipeline(
                "[ITINERARY_AI_COVERAGE_FAILED]",
                `reasons=${aiCoverage.reasons.join("|")}`,
              );
            } else {
              ai = {
                ...aiResponse,
                itinerary: enrichedItinerary,
              } as RoamiePayloadV2;
              logAiPipeline("[ITINERARY_BUILD_PATH]", "path=ai");
            }
          }
        }
      } catch (e) {
        console.warn("[Roamie] AI itinerary generation failed", e);
      }
    }

    if (!ai || coalesceItineraryItems(ai.itinerary).length < 1) {
      devVerboseInfo("[AI_ITINERARY_BUILD] building from selectedPlaces", {
        count: selectedPlaces.length,
        days: data.days,
      });
      const builtItems = buildItineraryFromSelectedPlaces(
        selectedPlaces,
        data.days,
        startDate,
        data.destination,
        selectedCombinationIds,
      );
      ai = buildFallbackTripPayload(data, builtItems, selectedPlaces);
      usedDeterministic = true;
      logAiPipeline(
        "[ITINERARY_BUILD_PATH]",
        "path=deterministic_fallback",
        `places=${builtItems.length}`,
      );
    }

    // Global landmark dedupe must run before final day geography is trusted.
    // For AI paths that already assigned dates, rebuild via deterministic allocator
    // when nearby main/sub landmarks remain or selected coverage is incomplete.
    {
      const itemToPlace = (item: RoamieItineraryItem): PlaceResult =>
        ({
          id: item.googlePlaceId?.trim() || item.placeName || item.title,
          name: item.placeName || item.title,
          address: item.address ?? null,
          lat: item.lat ?? null,
          lng: item.lng ?? null,
          rating: item.rating ?? null,
          userRatingCount: item.userRatingCount ?? null,
          photoName: item.photoName ?? null,
          primaryType: item.placeType ?? null,
          types: item.types ?? (item.placeType ? [item.placeType] : null),
          businessStatus: item.businessStatus ?? null,
          openStatus: "unknown",
          openStatusLabel: item.openStatusLabel ?? "",
          todayHoursLabel: item.todayHoursLabel ?? "",
          closingSoonNote: "",
          nextOpenHint: "",
          destinationScope: item.destinationScope,
          extensionDestination: item.extensionDestination,
          sourceRegionCandidate: item.sourceRegionCandidate,
        }) as unknown as PlaceResult;

      const current = coalesceItineraryItems(ai.itinerary);
      const { kept, removed } = dedupeLandmarkItems(current, itemToPlace);
      if (removed.length) {
        for (const r of removed) {
          logAiPipeline(
            "[SELECTED_PLACE_MERGED]",
            `source=${r.item.placeName ?? r.item.title}`,
            `representative=${kept.find((k) => k.googlePlaceId === r.item.googlePlaceId)?.placeName ?? "cluster"}`,
            `reason=${r.reason}`,
          );
          logAiPipeline(
            "[DUPLICATE_LANDMARK_REMOVED]",
            `day=${(r.item.dayIndex ?? 0) + 1}`,
            `place=${r.item.placeName ?? r.item.title}`,
            `reason=${r.reason}`,
          );
        }
        logAiPipeline("[ITINERARY_TIMELINE_RECALCULATED]", `removedPlaceCount=${removed.length}`);
        ai = { ...ai, itinerary: kept };
      }

      const dateOrder: string[] = [];
      for (const item of kept) {
        const d = item.date?.trim();
        if (d && !dateOrder.includes(d)) dateOrder.push(d);
      }
      const entries = kept.map((item) => ({
        place: itemToPlace(item),
        day:
          item.dayIndex != null
            ? item.dayIndex + 1
            : Math.max(1, dateOrder.indexOf(item.date?.trim() ?? "") + 1),
      }));
      const geoCheck = validateCrossDayGeographicAllocation(entries, data.days);
      if (!geoCheck.ok && !usedDeterministic) {
        logAiPipeline(
          "[ITINERARY_GEOGRAPHIC_REALLOCATION]",
          `reason=nearby_places_split_across_days`,
          `details=${geoCheck.reasons.join("|")}`,
        );
        // Rebuild with geography-first allocator instead of keeping a broken AI layout.
        const rebuilt = buildItineraryFromSelectedPlaces(
          selectedPlaces,
          data.days,
          startDate,
          data.destination,
          selectedCombinationIds,
        );
        ai = buildFallbackTripPayload(data, rebuilt, selectedPlaces);
        usedDeterministic = true;
      } else if (!geoCheck.ok) {
        logAiPipeline(
          "[ITINERARY_GEOGRAPHIC_REALLOCATION]",
          `reason=nearby_places_split_across_days`,
          `details=${geoCheck.reasons.join("|")}`,
        );
      }
    }

    let finalStops = coalesceItineraryItems(ai.itinerary);
    const routeFinalStops = (stage: ItineraryRouteOrderStage): void => {
      let composedPlans = composedPlansFromItineraryItems(finalStops, data.days, startDate);
      if (
        stage === "post_required_repair" ||
        stage === "post_redistribution" ||
        stage === "post_rebuild" ||
        stage === "final_pre_persistence"
      ) {
        composedPlans = repairCrossDayGeographicCohesion(composedPlans, {
          generationId,
          stage,
          plannedDate: startDate,
          pace: resolvePlannerPaceFromProfile({
            style: data.style,
            quizPace: data.preferences?.pace as "slow" | "medium" | "active" | null,
          }),
        });
      }
      const routedPlans = applyFinalDayRouteOrdering(composedPlans, {
        generationId,
        stage,
        plannedDate: startDate,
      });
      finalStops = applyComposedPlansToItineraryItems(finalStops, routedPlans, startDate);
      ai = { ...ai!, itinerary: finalStops };
    };
    let requiredCoverageInitialStops = [...finalStops];
    let requiredCoverageAfterReplanStops = [...finalStops];
    let requiredCoverageAfterRebuildStops = [...finalStops];
    let requiredCoverageRebuildAttempted = false;
    const exclusionViolations = finalStops.filter(
      (stop) =>
        isExcludedByPlaceOrAncestor(
          {
            googlePlaceId: stop.googlePlaceId,
            name: stop.placeName ?? stop.title,
            address: stop.address ?? null,
            lat: stop.lat ?? null,
            lng: stop.lng ?? null,
            primaryType: stop.placeType ?? null,
            types: stop.types ?? null,
          },
          [...excludedPlaceIds],
          explicitExcludedPlaces.map((excluded) => ({
            googlePlaceId: excluded.googlePlaceId,
            name: excluded.placeName ?? excluded.name,
            address: excluded.address ?? null,
            lat: excluded.lat ?? null,
            lng: excluded.lng ?? null,
            primaryType: excluded.primaryType ?? excluded.type ?? null,
            types: excluded.types ?? (excluded.type ? [excluded.type] : null),
          })),
        ).excluded,
    );
    if (exclusionViolations.length) {
      const rebuilt = buildItineraryFromSelectedPlaces(
        selectedPlaces,
        data.days,
        startDate,
        data.destination,
        selectedCombinationIds,
      );
      ai = buildFallbackTripPayload(data, rebuilt, selectedPlaces);
      finalStops = coalesceItineraryItems(ai.itinerary);
      logAiPipeline(
        "[PLANNING_EXCLUSION_INVARIANT]",
        `violations=${exclusionViolations.length}`,
        `rebuiltStops=${finalStops.length}`,
      );
    }
    const requiredAnchors = buildRequiredAnchorPlaces({
      selectedPlaceNames: requiredPlaceNames,
      placeIdsByName: Object.fromEntries(
        requiredSelectedPlaces
          .filter((p) => (p.placeName ?? p.name) && p.googlePlaceId)
          .map((p) => [p.placeName ?? p.name, p.googlePlaceId!]),
      ),
    });
    const selectedLock = buildSelectedPlaceLock({ anchors: requiredAnchors });
    const toReplanPlace = (place: RoamieRecommendationItem): PlaceResult => ({
      id: (place.googlePlaceId ?? place.name).trim(),
      googlePlaceId: place.googlePlaceId?.trim() || null,
      plannerProvenanceKey: place.googlePlaceId?.trim()
        ? `google:${place.googlePlaceId.trim()}`
        : `candidate:${selectedPlaces.indexOf(place)}`,
      sourceCandidateIndex: selectedPlaces.indexOf(place),
      name: place.placeName ?? place.name,
      address: place.address ?? null,
      lat: place.lat ?? null,
      lng: place.lng ?? null,
      rating: place.rating ?? null,
      userRatingCount: place.userRatingCount ?? null,
      photoName: place.photoName ?? null,
      primaryType: place.primaryType ?? place.type ?? null,
      types: place.types?.length ? place.types : place.type ? [place.type] : null,
      businessStatus: place.businessStatus ?? null,
      openStatus: "unknown",
      openStatusLabel: "",
      todayHoursLabel: "",
      closingSoonNote: "",
      nextOpenHint: "",
      openNow: null,
    });
    const requiredPool = requiredSelectedPlaces.map(toReplanPlace);
    if (data.placeAuthority !== "selected_only" && requiredPool.length) {
      const initialPlans = composedPlansFromItineraryItems(finalStops, data.days, startDate);
      const repairedInitial = repairRequiredPlaceCoverage({
        plans: initialPlans,
        requiredPlaces: requiredPool,
        days: data.days,
        generationId: data.generationId,
      });
      if (repairedInitial.insertedCount > 0) {
        finalStops = applyComposedPlansToItineraryItems(
          finalStops,
          repairedInitial.plans,
          startDate,
        );
        ai = { ...ai, itinerary: finalStops };
      }
      routeFinalStops("post_required_repair");
    }
    for (const stop of finalStops) {
      const stopHash = itineraryStopHash(stop);
      stopOrigins.set(
        stopHash,
        initialAiStopHashes.has(stopHash)
          ? "initial_ai"
          : usedDeterministic
            ? "deterministic_rebuild"
            : "required_repair",
      );
    }
    requiredCoverageInitialStops = [...finalStops];
    requiredCoverageAfterReplanStops = [...finalStops];
    requiredCoverageAfterRebuildStops = [...finalStops];
    logAssemblyStage("initial_result", finalStops);
    logAssemblyStage("normalized", finalStops);
    if (data.placeAuthority === "selected_only") {
      const originalStopCount = finalStops.length;
      const selectedNames = new Set(
        requiredSelectedPlaces.map((place) => (place.placeName ?? place.name).trim().toLowerCase()),
      );
      const selectedIds = new Set(
        requiredSelectedPlaces.map((place) => place.googlePlaceId?.trim()).filter(Boolean),
      );
      const authoritativeStops = finalStops.filter((stop) => {
        const id = stop.googlePlaceId?.trim();
        const name = (stop.placeName ?? stop.title).trim().toLowerCase();
        return Boolean((id && selectedIds.has(id)) || selectedNames.has(name));
      });
      const deliveredIds = new Set(
        authoritativeStops.map((stop) => stop.googlePlaceId?.trim()).filter(Boolean),
      );
      const deliveredNames = new Set(
        authoritativeStops.map((stop) => (stop.placeName ?? stop.title).trim().toLowerCase()),
      );
      const missingSelected = requiredSelectedPlaces.some((place) => {
        const id = place.googlePlaceId?.trim();
        const name = (place.placeName ?? place.name).trim().toLowerCase();
        return !((id && deliveredIds.has(id)) || deliveredNames.has(name));
      });
      if (missingSelected) {
        finalStops = buildItineraryFromSelectedPlaces(
          selectedPlaces,
          data.days,
          startDate,
          data.destination,
          selectedCombinationIds,
        );
        ai = { ...ai, itinerary: finalStops };
      } else {
        finalStops = authoritativeStops;
        ai = { ...ai, itinerary: finalStops };
      }
      logAiPipeline(
        "[SELECTION_PLACE_AUTHORITY_APPLIED]",
        `selected=${requiredSelectedPlaces.length}`,
        `scheduled=${finalStops.length}`,
        `removedUnselected=${Math.max(0, originalStopCount - authoritativeStops.length)}`,
        `rebuiltForMissing=${missingSelected}`,
      );
    } else {
      const deliveredIds = new Set(
        finalStops.map((stop) => stop.googlePlaceId?.trim()).filter(Boolean),
      );
      const deliveredNames = new Set(
        finalStops.map((stop) => (stop.placeName ?? stop.title).trim().toLowerCase()),
      );
      const missingRequired = requiredSelectedPlaces.filter((place) => {
        const id = place.googlePlaceId?.trim();
        const name = (place.placeName ?? place.name).trim().toLowerCase();
        return !((id && deliveredIds.has(id)) || deliveredNames.has(name));
      });
      if (missingRequired.length) {
        finalStops = buildItineraryFromSelectedPlaces(
          selectedPlaces,
          data.days,
          startDate,
          data.destination,
          selectedCombinationIds,
        );
        ai = { ...ai, itinerary: finalStops };
      }
      console.info("[ITINERARY_REQUIRED_ANCHOR_COVERAGE]", {
        generationId,
        clientRequiredCount: data.selectedPlaces.filter(
          (place) => place.isRequiredBySelection !== false,
        ).length,
        serverInputRequiredCount: requiredSelectedPlaces.length,
        plannerRequiredCount: requiredSelectedPlaces.length,
        generatedSatisfiedCount: requiredSelectedPlaces.length - missingRequired.length,
        missingCount: missingRequired.length,
        droppedBeforePlannerCount: Math.max(
          0,
          data.selectedPlaces.filter((place) => place.isRequiredBySelection !== false).length -
            requiredSelectedPlaces.length,
        ),
        droppedDuringAssemblyCount: missingRequired.length,
        recoveryApplied: missingRequired.length > 0,
      });
    }
    if (data.placeAuthority !== "selected_only") {
      const requiredIds = new Set(
        requiredSelectedPlaces.map((place) => place.googlePlaceId?.trim()).filter(Boolean),
      );
      const requiredNames = new Set(
        requiredSelectedPlaces.map((place) => (place.placeName ?? place.name).trim().toLowerCase()),
      );
      const initialScope = finalStops.map((stop) => ({
        stop,
        scope: classifyItineraryGeographicScope(stop, data.destination),
        required:
          requiredIds.has(stop.googlePlaceId?.trim()) ||
          requiredNames.has((stop.placeName ?? stop.title).trim().toLowerCase()),
      }));
      const outOfScopeSupplemental = initialScope.filter(
        ({ scope, required }) => scope === "out_of_scope" && !required,
      );
      if (outOfScopeSupplemental.length) {
        finalStops = buildItineraryFromSelectedPlaces(
          selectedPlaces,
          data.days,
          startDate,
          data.destination,
          selectedCombinationIds,
        );
        ai = { ...ai, itinerary: finalStops };
      }
      const finalScope = finalStops.map((stop) => ({
        scope: classifyItineraryGeographicScope(stop, data.destination),
        required:
          requiredIds.has(stop.googlePlaceId?.trim()) ||
          requiredNames.has((stop.placeName ?? stop.title).trim().toLowerCase()),
      }));
      const violations = finalScope.filter(
        ({ scope, required }) => scope === "out_of_scope" && !required,
      ).length;
      console.info("[ITINERARY_GEOGRAPHIC_SCOPE]", {
        generationId,
        destinationScopePresent: finalStops.some((stop) => Boolean(stop.destinationScope)),
        finalPlaceCount: finalStops.length,
        inScopeCount: finalScope.filter(({ scope }) => scope === "in_scope").length,
        outOfScopeCount: finalScope.filter(({ scope }) => scope === "out_of_scope").length,
        unknownScopeCount: finalScope.filter(({ scope }) => scope === "unknown").length,
        violationCount: violations,
      });
      if (violations) {
        await recordGenerationOutcome(false, "geographic_scope_mismatch");
        return finish({
          success: false,
          errorCode: "itinerary_integrity_failed",
          failureReason: "geographic_scope_mismatch",
          message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
        });
      }
    }
    routeFinalStops("initial");
    logGenerationTiming("route_day_assembly_done");
    const integrity = validateFinalItineraryIntegrity({
      selectedCombinationIds,
      sessionSelectedCombinationIds: selectedCombinationIds,
      requiredPlaceNames,
      scheduledStops: finalStops,
      resolvedPlaces: selectedPlaces,
      tripDays: data.days,
      startDate,
      destination: data.destination,
      placeAuthority: data.placeAuthority,
    });
    const recommendationIntegrity = recommendationIntegrityCheck({
      selectedPlaces: requiredPlaceNames,
      anchors: requiredAnchors,
      scheduledPlaceNames: finalStops.map((s) => s.placeName ?? s.title),
    });
    const delivery = plannerDeliveryCheck({
      integrity: recommendationIntegrity,
      validatorOk: integrity.ok || selectedCombinationIds.length === 0,
      qualityGateOk: true,
      routeOk: true,
    });

    logAiPipeline(
      "[ITINERARY_SAVE_STATS]",
      `expectedPlaces=${selectedPlaces.length}`,
      `savedPlaces=${finalStops.length}`,
      `integrityOk=${integrity.ok}`,
      `recommendationIntegrityOk=${recommendationIntegrity.ok}`,
      `coveragePercent=${recommendationIntegrity.coveragePercent}`,
      `delivery=${delivery.deliveryResult}`,
    );

    if (
      (!integrity.ok || !recommendationIntegrity.ok || !delivery.ok) &&
      selectedCombinationIds.length > 0
    ) {
      // Hard gate: do not persist a half-built selected-combination itinerary.
      const critical = [
        ...integrity.reasons.filter(
          (r) =>
            r.startsWith("fallback_over_selected") ||
            r.startsWith("silent_drop") ||
            r.startsWith("unselected_combination_place") ||
            r.startsWith("missing_combination") ||
            r.startsWith("empty_day") ||
            r.startsWith("empty_non_free_day") ||
            r.startsWith("insufficient_real_places"),
        ),
        ...recommendationIntegrity.reasons,
        ...delivery.reasons.filter((r) => r.startsWith("missing_") || r.startsWith("coverage")),
      ];
      if (critical.length || !recommendationIntegrity.ok) {
        const capacityTarget = resolveItineraryCandidateCapacityTarget(data.days);
        const plans = composedPlansFromItineraryItems(finalStops, data.days, startDate);
        const capacityFailure = critical.some((reason) =>
          reason.startsWith("insufficient_real_places"),
        );
        const failureReason = capacityFailure
          ? "insufficient_deliverable_capacity"
          : "selected_combination_integrity_failed";
        logAiPipeline(
          "[ITINERARY_INTEGRITY_BLOCKED_SAVE]",
          `reasons=${critical.join("|") || recommendationIntegrity.reasons.join("|")}`,
          `coveragePercent=${recommendationIntegrity.coveragePercent}`,
        );
        console.info("[ITINERARY_INTEGRITY_FAILURE]", {
          generationId,
          failedStage: "selected_combination_pre_validator",
          failureReason,
          dynamicMinimumViableStopCount: capacityTarget.hardMinimum,
          validatorMinimumRequiredStopCount: capacityTarget.hardMinimum,
          finalStopCount: finalStops.length,
          populatedDayCount: plans.filter((plan) => plan.entries.length > 0).length,
          emptyDayCount: plans.filter((plan) => plan.entries.length === 0).length,
          insufficientCapacity: capacityFailure,
        });
        await recordGenerationOutcome(false, "itinerary_integrity_failed");
        return finish({
          success: false,
          errorCode: "itinerary_integrity_failed",
          failureReason,
          failedRules: capacityFailure ? ["day_place_count"] : undefined,
          message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
        });
      }
    }

    // Explicit duration remains authoritative even when dates are absent. Repair
    // an assembly that lost every stop/day before entering the strict validator.
    const preValidatorPlans = composedPlansFromItineraryItems(finalStops, data.days, startDate);
    if (finalStops.length === 0 || preValidatorPlans.some((plan) => plan.entries.length === 0)) {
      const rebuilt = buildItineraryFromSelectedPlaces(
        selectedPlaces,
        data.days,
        startDate,
        data.destination,
        selectedCombinationIds,
      );
      if (rebuilt.length > finalStops.length) {
        finalStops = rebuilt;
        ai = { ...ai, itinerary: finalStops };
      }
    }
    console.info("[ITINERARY_DAYS_AUTHORITY]", {
      generationId,
      stage: "output",
      explicitDays: data.days,
      derivedDays: null,
      effectiveDays: data.days,
      startDatePresent: Boolean(data.startDate?.trim()),
      endDatePresent: Boolean(data.endDate?.trim()),
      source: "explicit_days",
      outputDayCount: composedPlansFromItineraryItems(finalStops, data.days, startDate).filter(
        (plan) => plan.entries.length > 0,
      ).length,
    });

    // P4.2：Itinerary Validator — direct / selected_places 建立路徑
    if (isItineraryValidatorEnabled()) {
      logGenerationTiming("validator_start");
      const composed = composedPlansFromItineraryItems(finalStops, data.days, startDate);
      logAssemblyStage("pre_replan", finalStops);
      const plannerDayCounts = dayCountsOfPlans(composed);
      const styleKey = resolvePlannerStyleKey(data.style);
      const creationPath = selectedCombinationIds.length > 0 ? "selected_places" : "direct";
      logAiPipeline(
        "[ITINERARY_PLANNER_RESULT]",
        `success=true`,
        `stopCount=${finalStops.length}`,
        `dayCounts=${plannerDayCounts.join(",")}`,
        `path=${usedDeterministic ? "deterministic" : "ai"}`,
      );
      const validatorInputBase: Omit<ItineraryValidatorInput, "plans"> = {
        generationId,
        validationStage: "initial",
        requestedDays: data.days,
        style: styleKey,
        plannedDate: startDate,
        endDate: data.endDate?.trim() || undefined,
        nearbyExtensions: data.nearbyExtensions,
        excludedCategories: data.excludedCategories,
        excludePlaceIds: [...excludedPlaceIds],
        excludedPlaces: explicitExcludedPlaces.map(toReplanPlace),
        userText: [data.interests, data.conversationSummary].filter(Boolean).join("\n"),
        destination: data.destination,
        creationPath: creationPath as ItineraryValidatorInput["creationPath"],
        placeAuthority: data.placeAuthority,
        lockedPlaceIds: requiredSelectedPlaces
          .map((place) => place.googlePlaceId?.trim())
          .filter((id): id is string => Boolean(id)),
        lockedPlaceNames: requiredSelectedPlaces.map((place) => place.placeName ?? place.name),
      };
      console.info("[ITINERARY_EXCLUSION_AUTHORITY]", {
        generationId,
        explicitPlaceCount: excludedPlaceIds.size,
        explicitCategoryCount: data.excludedCategories.length,
        hierarchyExclusionCount: inputPlaces.filter((place) => {
          const decision = exclusionDecision(place);
          return decision.excluded && decision.matchReason === "ancestor_excluded";
        }).length,
        aliasCount: 0,
        correlated: Boolean(generationId),
        correlationUnavailable: !generationId,
        legacyTextFallbackUsed: false,
        validatorTextInferenceUsed: false,
      });
      let validation = validateItineraryPlan({
        plans: composed,
        ...validatorInputBase,
        validationStage: "initial",
      });
      requiredCoverageAfterReplanStops = [...finalStops];
      requiredCoverageAfterRebuildStops = [...finalStops];
      const logDayPlaceCounts = (
        currentValidation: typeof validation,
        currentPlans: typeof composed,
      ) => {
        const failedDays = new Set(
          currentValidation.failedRules
            .filter((rule) => rule.code === "day_place_count")
            .flatMap((rule) => (rule.day == null ? [] : [rule.day])),
        );
        const requiredIds = new Set(
          requiredSelectedPlaces
            .map((place) => place.googlePlaceId?.trim())
            .filter((id): id is string => Boolean(id)),
        );
        for (const plan of currentPlans) {
          console.info("[ITINERARY_DAY_PLACE_COUNT]", {
            generationId,
            dayIndex: plan.day,
            actualPlaceCount: plan.entries.length,
            minimumPlaceCount: 2,
            requiredAnchorCountOnDay: plan.entries.filter((entry) =>
              requiredIds.has(entry.place.id.trim()),
            ).length,
            supplementalCountOnDay: plan.entries.filter(
              (entry) => !requiredIds.has(entry.place.id.trim()),
            ).length,
            failed: failedDays.has(plan.day),
          });
        }
      };
      logDayPlaceCounts(validation, composed);
      const pool: PlaceResult[] = selectedPlaces.map(toReplanPlace);
      const requiredCoverageBeforeReplan = evaluateRequiredPlaceCoverage(composed, requiredPool);
      if (!validation.pass || !requiredCoverageBeforeReplan.complete) {
        const replanned = replanUntilItineraryValid(
          {
            generationId,
            plans: composed as unknown as ComposedDayPlan[],
            pool,
            days: data.days,
            style: styleKey,
            plannedDate: startDate,
            nearbyExtensions: data.nearbyExtensions,
            validatorInput: validatorInputBase,
            requiredPlaces: data.placeAuthority === "selected_only" ? [] : requiredPool,
          },
          validation,
        );
        validation = replanned.validation;
        const replannedCounts = dayCountsOfPlans(replanned.plans);
        const composedIds = new Set(
          composed.flatMap((plan) => plan.entries.map((entry) => entry.place.id.trim())),
        );
        const newlyInsertedIds = replanned.plans
          .flatMap((plan) => plan.entries.map((entry) => entry.place.id.trim()))
          .filter((id) => id && !composedIds.has(id));
        const requiredPoolIds = new Set(
          requiredSelectedPlaces.map((place) => (place.googlePlaceId ?? place.name).trim()),
        );
        const supplementalPoolIds = new Set(
          supplementalPlaces.map((place) => (place.googlePlaceId ?? place.name).trim()),
        );
        const requiredInsertedCount = newlyInsertedIds.filter((id) =>
          requiredPoolIds.has(id),
        ).length;
        const supplementalInsertedCount = newlyInsertedIds.filter((id) =>
          supplementalPoolIds.has(id),
        ).length;
        console.info("[ITINERARY_SUPPLEMENT_RECOVERY]", {
          generationId,
          inputSupplementalCount: inputSupplementalCandidates.length,
          eligibleSupplementalCount: supplementalPlaces.length,
          attemptedCount: supplementalPlaces.length,
          requiredInsertedCount,
          supplementalInsertedCount,
          insertedCount: supplementalInsertedCount,
          rejectedCount: Math.max(0, supplementalPlaces.length - supplementalInsertedCount),
          rejectionReasonCounts:
            supplementalInsertedCount < supplementalPlaces.length
              ? { not_inserted: supplementalPlaces.length - supplementalInsertedCount }
              : {},
          finalDayPlaceCounts: replannedCounts,
        });
        if (replanned.plans.length) {
          finalStops = applyComposedPlansToItineraryItems(finalStops, replanned.plans, startDate);
          ai = { ...ai, itinerary: finalStops };
        }
        for (const stop of finalStops) {
          const stopHash = itineraryStopHash(stop);
          if (!stopOrigins.has(stopHash)) stopOrigins.set(stopHash, "replan");
        }
        requiredCoverageAfterReplanStops = [...finalStops];
        requiredCoverageAfterRebuildStops = [...finalStops];
        logAssemblyStage("post_replan", finalStops);
        const postReplanIds = new Set(
          finalStops.map((stop) => stop.googlePlaceId?.trim()).filter(Boolean),
        );
        const postReplanNames = new Set(
          finalStops.map((stop) => (stop.placeName ?? stop.title).trim().toLowerCase()),
        );
        const postReplanMissingRequired = requiredSelectedPlaces.filter((place) => {
          const id = place.googlePlaceId?.trim();
          const name = (place.placeName ?? place.name).trim().toLowerCase();
          return !((id && postReplanIds.has(id)) || postReplanNames.has(name));
        });
        const postReplanMissingDays = validation.failedRules.some(
          (rule) => rule.code === "missing_days",
        );
        if (postReplanMissingRequired.length || postReplanMissingDays || finalStops.length === 0) {
          requiredCoverageRebuildAttempted = true;
          const sourcedRebuildInput = [
            ...requiredSelectedPlaces.map((candidate) => ({
              candidate,
              sourceType: "legacy_selected_places" as ItineraryCandidateSourceType,
            })),
            ...supplementalPlaces.map((candidate) => ({
              candidate,
              sourceType: (candidate.destinationScope === "nearby_extension" ||
              candidate.extensionDestination
                ? "extension_pool"
                : "supplemental_pool") as ItineraryCandidateSourceType,
            })),
          ];
          const deliverablePool = buildDeliverableItineraryCandidatePool(
            sourcedRebuildInput,
            data.destination,
          );
          for (const sourceType of [
            ...new Set(sourcedRebuildInput.map((item) => item.sourceType)),
          ]) {
            const sourceCandidates = sourcedRebuildInput.filter(
              (item) => item.sourceType === sourceType,
            );
            const eligibleDeliverableCount = deliverablePool.eligible.filter(
              (item) => item.sourceType === sourceType,
            ).length;
            console.info("[ITINERARY_REBUILD_CANDIDATE_SOURCE]", {
              generationId,
              sourceType,
              totalCount: sourceCandidates.length,
              googleIdentityCount: sourceCandidates.filter((item) =>
                isHardGooglePlaceId(item.candidate.googlePlaceId),
              ).length,
              missingGoogleIdentityCount:
                sourceCandidates.length -
                sourceCandidates.filter((item) => isHardGooglePlaceId(item.candidate.googlePlaceId))
                  .length,
              eligibleDeliverableCount,
            });
          }
          console.info("[ITINERARY_REBUILD_DELIVERABLE_POOL]", {
            generationId,
            inputCount: deliverablePool.inputCount,
            googleIdentityCount: deliverablePool.googleIdentityCount,
            deliverableCount: deliverablePool.deliverableCount,
            rejectedCount: deliverablePool.rejectedCount,
            rejectionReasonCounts: deliverablePool.rejectionReasonCounts,
          });
          const rebuildCapacity = assessDeterministicRebuildCapacity(
            deliverablePool.deliverableCount,
            data.days,
          );
          const { minimumRequiredEntries } = rebuildCapacity;
          const insufficientDeliverableCapacity = !rebuildCapacity.sufficient;
          const rebuildInput = deliverablePool.eligible.map(({ candidate }) => candidate);
          let rebuiltStops = insufficientDeliverableCapacity
            ? []
            : buildItineraryFromSelectedPlaces(
                rebuildInput,
                data.days,
                startDate,
                data.destination,
                selectedCombinationIds,
                true,
              );
          if (rebuiltStops.length) {
            const rebuiltRoutedPlans = applyFinalDayRouteOrdering(
              composedPlansFromItineraryItems(rebuiltStops, data.days, startDate),
              {
                generationId,
                stage: "post_rebuild",
                plannedDate: startDate,
              },
            );
            rebuiltStops = applyComposedPlansToItineraryItems(
              rebuiltStops,
              rebuiltRoutedPlans,
              startDate,
            );
          }
          requiredCoverageAfterRebuildStops = insufficientDeliverableCapacity
            ? [...finalStops]
            : [...rebuiltStops];
          const rebuiltPlans = composedPlansFromItineraryItems(rebuiltStops, data.days, startDate);
          const rebuiltValidation = validateItineraryPlan({
            plans: rebuiltPlans,
            ...validatorInputBase,
          });
          const coverageCount = (stops: readonly RoamieItineraryItem[]) => {
            const ids = new Set(stops.map((stop) => stop.googlePlaceId?.trim()).filter(Boolean));
            const names = new Set(
              stops.map((stop) => (stop.placeName ?? stop.title).trim().toLowerCase()),
            );
            return requiredSelectedPlaces.filter((place) => {
              const id = place.googlePlaceId?.trim();
              const name = (place.placeName ?? place.name).trim().toLowerCase();
              return Boolean((id && ids.has(id)) || names.has(name));
            }).length;
          };
          const currentPlans = composedPlansFromItineraryItems(finalStops, data.days, startDate);
          const currentValidation = validateItineraryPlan({
            plans: currentPlans,
            ...validatorInputBase,
          });
          const currentQuality: ItineraryDeliveryQuality = {
            populatedDayCount: currentPlans.filter((plan) => plan.entries.length > 0).length,
            requiredCoverageCount: coverageCount(finalStops),
            blockingFailedRuleCount: currentValidation.failedRules.length,
            totalValidEntryCount: currentPlans.reduce(
              (count, plan) => count + plan.entries.length,
              0,
            ),
          };
          const rebuiltQuality: ItineraryDeliveryQuality = {
            populatedDayCount: rebuiltPlans.filter((plan) => plan.entries.length > 0).length,
            requiredCoverageCount: coverageCount(rebuiltStops),
            blockingFailedRuleCount: rebuiltValidation.failedRules.length,
            totalValidEntryCount: rebuiltPlans.reduce(
              (count, plan) => count + plan.entries.length,
              0,
            ),
          };
          const rebuildAccepted =
            !insufficientDeliverableCapacity &&
            shouldReplaceItineraryWithRebuild(currentQuality, rebuiltQuality);
          console.info("[ITINERARY_REBUILD_ELIGIBILITY]", {
            generationId,
            inputCount: deliverablePool.inputCount,
            eligibleCount: deliverablePool.deliverableCount,
            rejectedCount: deliverablePool.rejectedCount,
            rejectionReasonCounts: deliverablePool.rejectionReasonCounts,
            buildBlockedReason: rebuildCapacity.buildBlockedReason,
            buildBlockingReasonCounts: insufficientDeliverableCapacity
              ? { insufficient_deliverable_capacity: 1 }
              : {},
            requiredCandidateCount: requiredSelectedPlaces.length,
            supplementalCandidateCount: supplementalPlaces.length,
            rebuildAccepted,
            currentQuality,
            rebuiltQuality,
          });
          const rebuiltIdentityCounts = itineraryIdentityCounts(rebuiltStops, rebuildInput);
          console.info("[ITINERARY_REBUILD_RESULT]", {
            generationId,
            requestedDays: data.days,
            minimumRequiredEntries,
            deliverablePoolCount: deliverablePool.deliverableCount,
            entriesInserted: rebuiltStops.length,
            internalOnlyInsertedCount: rebuiltIdentityCounts.internalOnlyIdentityCount,
            missingGoogleInsertedCount:
              rebuiltIdentityCounts.totalStopCount - rebuiltIdentityCounts.googleIdentityCount,
            replacementAccepted: rebuildAccepted,
          });
          for (const stop of rebuiltStops) {
            stopOrigins.set(itineraryStopHash(stop), "deterministic_rebuild");
          }
          logAssemblyStage("deterministic_rebuild", rebuiltStops);
          if (rebuildAccepted) {
            finalStops = rebuiltStops;
            ai = { ...ai, itinerary: finalStops };
            validation = rebuiltValidation;
          } else {
            validation = currentValidation;
          }
        }
      }
      const { unavailableCount: requiredIdentityUnavailableCount } =
        classifyRequiredIdentityAvailability(requiredPool);
      if (requiredIdentityUnavailableCount > 0) {
        console.info("[ITINERARY_DELIVERY_IDENTITY]", {
          generationId,
          totalStopCount: finalStops.length,
          googleIdentityCount: itineraryIdentityCounts(finalStops, selectedPlaces)
            .googleIdentityCount,
          missingIdentityCount: itineraryIdentityCounts(finalStops, selectedPlaces)
            .missingIdentityCount,
          unrecoverableCount: requiredIdentityUnavailableCount,
          failureReason: "required_identity_unavailable",
        });
        await recordGenerationOutcome(false, "required_identity_unavailable");
        return finish({
          success: false,
          errorCode: "itinerary_integrity_failed",
          message: ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
          failureReason: "required_identity_unavailable",
          failedRules: ["required_anchor_coverage"],
          diagnostics: {
            stopCount: finalStops.length,
            invalidPlaceCount: 0,
            requiredAnchorCount: requiredSelectedPlaces.length,
            requiredAnchorSatisfiedCount: Math.max(
              0,
              requiredSelectedPlaces.length - requiredIdentityUnavailableCount,
            ),
            missingRequiredAnchorCount: requiredIdentityUnavailableCount,
            ...itineraryIdentityCounts(finalStops, selectedPlaces),
          },
        });
      }
      const identityRecovery = recoverItineraryGoogleIdentities({
        stops: finalStops,
        candidates: selectedPlaces,
        supplementalCandidates: supplementalPlaces,
      });
      finalStops = identityRecovery.items;
      ai = { ...ai, itinerary: finalStops };
      for (const stop of finalStops) {
        const stopHash = itineraryStopHash(stop);
        if (!stopOrigins.has(stopHash)) stopOrigins.set(stopHash, "supplemental_repair");
      }
      console.info("[ITINERARY_IDENTITY_RECOVERY]", {
        generationId,
        internalOnlyCount: itineraryIdentityCounts(finalStops, selectedPlaces)
          .internalOnlyIdentityCount,
        recoveredFromCandidatePoolCount: identityRecovery.restoredFromCandidatePoolCount,
        replacedFromSupplementalPoolCount: identityRecovery.replacedFromSupplementalPoolCount,
        unrecoverableCount: identityRecovery.unrecoverableCount,
        unrecoverableStopHashes: identityRecovery.unrecoverableHashes,
      });
      console.info("[ITINERARY_IDENTITY_LOOKUP]", {
        generationId,
        stage: "pre_validator_recovery",
        inputMissingCount:
          identityRecovery.restoredFromCandidatePoolCount +
          identityRecovery.replacedFromSupplementalPoolCount +
          identityRecovery.unrecoverableCount,
        canonicalMatchCount: identityRecovery.lookupReasonCounts.canonical_identity ?? 0,
        sourceKeyMatchCount: identityRecovery.lookupReasonCounts.source_key ?? 0,
        nameAddressMatchCount: identityRecovery.lookupReasonCounts.name_address ?? 0,
        nameCoordinateMatchCount: identityRecovery.lookupReasonCounts.name_coordinate ?? 0,
        ambiguousCount: identityRecovery.lookupReasonCounts.ambiguous ?? 0,
        noMatchCount: identityRecovery.lookupReasonCounts.no_match ?? 0,
        sourceCandidateMissingGoogleIdCount:
          identityRecovery.lookupReasonCounts.source_candidate_missing_google_id ?? 0,
      });
      logAssemblyStage("pre_validator", finalStops);
      if (identityRecovery.unrecoverableCount > 0) {
        await recordGenerationOutcome(false, "delivery_identity_mismatch");
        return finish({
          success: false,
          errorCode: "itinerary_integrity_failed",
          message: ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
          failureReason: "delivery_identity_mismatch",
          failedRules: ["delivery_identity"],
          diagnostics: {
            stopCount: finalStops.length,
            invalidPlaceCount: identityRecovery.unrecoverableCount,
            ...itineraryIdentityCounts(finalStops, selectedPlaces),
          },
        });
      }
      // P46: the response authority is a fresh validation of the exact final
      // itinerary state. Intermediate repair results remain diagnostics only.
      routeFinalStops("final_pre_persistence");
      const finalGeographicValidation = validateCrossDayGeographicAllocation(
        composedPlansFromItineraryItems(finalStops, data.days, startDate).flatMap((plan) =>
          plan.entries.map((entry) => ({ place: entry.place, day: plan.day })),
        ),
        data.days,
      );
      console.info("[ITINERARY_CROSS_DAY_GEOGRAPHIC_VALIDATION]", {
        generationId,
        stage: "final_pre_persistence",
        pass: finalGeographicValidation.ok,
        splitClusterCount: finalGeographicValidation.splitClusterCount,
      });
      validation = validateItineraryPlan({
        plans: composedPlansFromItineraryItems(finalStops, data.days, startDate),
        ...validatorInputBase,
        validationStage: "final",
      });
      for (const decision of buildRequiredCoverageDecisions(requiredSelectedPlaces, {
        initial: requiredCoverageInitialStops,
        afterReplan: requiredCoverageAfterReplanStops,
        afterRebuild: requiredCoverageAfterRebuildStops,
        preValidator: finalStops,
        rebuildAttempted: requiredCoverageRebuildAttempted,
      })) {
        console.info("[ITINERARY_REQUIRED_COVERAGE_DECISION]", {
          generationId,
          ...decision,
        });
      }
      const stopIndexesByDay = new Map<number, number>();
      const invalidFinalStops = finalStops.flatMap((stop) => {
        const reason = invalidItineraryStopReason(stop, data.destination);
        const dayIndex = (stop.dayIndex ?? 0) + 1;
        const stopIndex = (stopIndexesByDay.get(dayIndex) ?? 0) + 1;
        stopIndexesByDay.set(dayIndex, stopIndex);
        if (!reason) return [];
        console.info("[ITINERARY_INVALID_STOP]", {
          generationId,
          dayIndex,
          stopIndex,
          reason,
        });
        return [{ stop, reason }];
      });
      const finalRequiredIds = new Set(
        finalStops.map((stop) => stop.googlePlaceId?.trim()).filter(Boolean),
      );
      const finalRequiredNames = new Set(
        finalStops.map((stop) => (stop.placeName ?? stop.title).trim().toLowerCase()),
      );
      const satisfiedRequiredCount = requiredSelectedPlaces.filter((place) => {
        const id = place.googlePlaceId?.trim();
        const name = (place.placeName ?? place.name).trim().toLowerCase();
        return (id && finalRequiredIds.has(id)) || finalRequiredNames.has(name);
      }).length;
      console.info("[ITINERARY_REQUIRED_ANCHOR_COVERAGE]", {
        generationId,
        eligibleRequiredCount: requiredSelectedPlaces.length,
        satisfiedRequiredCount,
        missingRequiredCount: Math.max(0, requiredSelectedPlaces.length - satisfiedRequiredCount),
        droppedDuringAssemblyCount: Math.max(
          0,
          requiredSelectedPlaces.length - satisfiedRequiredCount,
        ),
      });
      if (satisfiedRequiredCount !== requiredSelectedPlaces.length) {
        validation = {
          ...validation,
          pass: false,
          failedRules: [
            ...validation.failedRules,
            {
              code: "persistence_mismatch",
              message: "required_anchor_coverage_mismatch",
              severity: "fail",
            },
          ],
        };
      }
      if (shouldBlockItineraryDelivery(validation)) {
        logGenerationTiming("validator_done", false, "validator_failed");
        logItineraryDeliveryBlocked("validator_failed", validation);
        await recordGenerationOutcome(false, "itinerary_validator_failed");
        const finalIdentities = finalStops.map((stop) =>
          (stop.googlePlaceId?.trim() || stop.placeName?.trim() || stop.title.trim()).toLowerCase(),
        );
        const finalIdentitySet = new Set(finalIdentities);
        const requiredIdentities = requiredSelectedPlaces.map((place) =>
          (
            place.googlePlaceId?.trim() ||
            place.placeName?.trim() ||
            place.name.trim()
          ).toLowerCase(),
        );
        const requiredAnchorSatisfiedCount = requiredIdentities.filter((identity) =>
          finalIdentitySet.has(identity),
        ).length;
        console.info("[ITINERARY_REQUIRED_ANCHOR_COVERAGE]", {
          generationId,
          clientRequiredCount: data.selectedPlaces.filter(
            (place) => place.isRequiredBySelection !== false,
          ).length,
          serverInputRequiredCount: requiredSelectedPlaces.length,
          plannerRequiredCount: requiredIdentities.length,
          generatedSatisfiedCount: requiredAnchorSatisfiedCount,
          missingCount: Math.max(0, requiredIdentities.length - requiredAnchorSatisfiedCount),
          droppedBeforePlannerCount: Math.max(
            0,
            data.selectedPlaces.filter((place) => place.isRequiredBySelection !== false).length -
              requiredSelectedPlaces.length,
          ),
          droppedDuringAssemblyCount: Math.max(
            0,
            requiredIdentities.length - requiredAnchorSatisfiedCount,
          ),
        });
        const failedRuleCodes = validation.failedRules.map((rule) => rule.code);
        const finalExclusionRules = validation.failedRules.filter(
          (rule) => rule.code === "user_exclusions",
        );
        const excludedViolationKeys = new Set(
          finalExclusionRules.flatMap((rule) =>
            rule.placeIds?.length ? rule.placeIds : [`${rule.day ?? 0}:${rule.message}`],
          ),
        );
        const capacityOnlyFailure =
          failedRuleCodes.length > 0 &&
          failedRuleCodes.every((code) => code === "day_capacity_pace_lock");
        return finish({
          success: false,
          errorCode: "itinerary_validator_failed",
          message: capacityOnlyFailure
            ? "目前安排的地點較多，我需要重新調整每天的安排。"
            : ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
          failureReason: "validator_failed",
          failedRules: validation.failedRules.map((rule) => rule.code),
          diagnostics: {
            affectedDays: validation.affectedDays,
            dayCount: data.days,
            stopCount: finalStops.length,
            details: validation.failedRules.map((rule) => rule.message),
            inputDayCount: data.days,
            outputDayCount: new Set(finalStops.map((stop) => stop.dayIndex ?? stop.date)).size,
            requiredAnchorCount: requiredIdentities.length,
            requiredAnchorSatisfiedCount,
            missingRequiredAnchorCount: Math.max(
              0,
              requiredIdentities.length - requiredAnchorSatisfiedCount,
            ),
            excludedCount: excludedPlaceIds.size,
            excludedViolationCount: excludedViolationKeys.size,
            duplicateCount: Math.max(0, finalIdentities.length - finalIdentitySet.size),
            invalidPlaceCount: invalidFinalStops.length,
            invalidDayCount: new Set(
              validation.failedRules
                .filter((rule) => rule.code === "missing_days")
                .flatMap((rule) => (rule.day == null ? [] : [rule.day])),
            ).size,
            routeViolationCount: failedRuleCodes.filter(
              (code) => code === "route_travel_time" || code === "route_backtrack",
            ).length,
            capacityViolationCount: failedRuleCodes.filter(
              (code) => code === "day_capacity_pace_lock",
            ).length,
          },
        });
      }
      logGenerationTiming("validator_done");
      const finalDayCounts = dayCountsOfPlans(
        composedPlansFromItineraryItems(finalStops, data.days, startDate),
      );
      const compare = compareItineraryPersistenceDayCounts({
        plannerDayCounts: finalDayCounts,
        validatedDayCounts: finalDayCounts,
        persistedDayCounts: finalDayCounts,
        uiDayCounts: finalDayCounts,
      });
      if (!compare.matched) {
        logItineraryDeliveryBlocked("persistence_mismatch", validation);
        await recordGenerationOutcome(false, "persistence_mismatch");
        return finish({
          success: false,
          errorCode: "persistence_mismatch",
          message: ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
        });
      }
      logItineraryDeliveryAllowed(validation, finalDayCounts);
    } else {
      logGenerationTiming("validator_start");
      logAiPipeline(
        "[ITINERARY_PLANNER_RESULT]",
        `success=true`,
        `stopCount=${finalStops.length}`,
        `path=${usedDeterministic ? "deterministic" : "ai"}`,
      );
      logGenerationTiming("validator_done");
    }

    const deliveryIdentityRecovery = recoverItineraryGoogleIdentities({
      stops: finalStops,
      candidates: selectedPlaces,
      supplementalCandidates: supplementalPlaces,
    });
    finalStops = deliveryIdentityRecovery.items;
    for (const stop of finalStops) {
      logAffiliateFactualEvidenceLifecycle("pre_persistence", stop, generationId);
    }
    ai = { ...ai, itinerary: finalStops };
    const deliveryIdentityCounts = itineraryIdentityCounts(finalStops, selectedPlaces);
    console.info("[ITINERARY_IDENTITY_RECOVERY]", {
      generationId,
      stage: "pre_delivery",
      internalOnlyCount: deliveryIdentityCounts.internalOnlyIdentityCount,
      recoveredFromCandidatePoolCount: deliveryIdentityRecovery.restoredFromCandidatePoolCount,
      replacedFromSupplementalPoolCount: deliveryIdentityRecovery.replacedFromSupplementalPoolCount,
      unrecoverableCount: deliveryIdentityRecovery.unrecoverableCount,
    });
    console.info("[ITINERARY_IDENTITY_PROPAGATION]", {
      generationId,
      stage: "pre_delivery",
      totalCount: deliveryIdentityCounts.totalStopCount,
      googleIdPresentCount: deliveryIdentityCounts.googleIdentityCount,
      internalOnlyCount: deliveryIdentityCounts.internalOnlyIdentityCount,
      lostGoogleIdCount: deliveryIdentityCounts.lostGoogleIdCount,
      internalOnlyIdentityHashes: itineraryInternalIdentityHashes(finalStops),
    });
    console.info("[ITINERARY_DELIVERY_IDENTITY]", {
      generationId,
      totalStopCount: deliveryIdentityCounts.totalStopCount,
      googleIdentityCount: deliveryIdentityCounts.googleIdentityCount,
      internalOnlyCount: deliveryIdentityCounts.internalOnlyIdentityCount,
      missingIdentityCount: deliveryIdentityCounts.missingIdentityCount,
      invalidGoogleIdentityCount: deliveryIdentityCounts.invalidGoogleIdentityCount,
    });
    if (
      deliveryIdentityRecovery.unrecoverableCount > 0 ||
      deliveryIdentityCounts.googleIdentityCount !== deliveryIdentityCounts.totalStopCount
    ) {
      await recordGenerationOutcome(false, "delivery_identity_mismatch");
      return finish({
        success: false,
        errorCode: "itinerary_integrity_failed",
        message: ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
        failureReason: "delivery_identity_mismatch",
        failedRules: ["delivery_identity"],
        diagnostics: {
          stopCount: finalStops.length,
          invalidPlaceCount:
            deliveryIdentityCounts.totalStopCount - deliveryIdentityCounts.googleIdentityCount,
          ...deliveryIdentityCounts,
        },
      });
    }

    logAiPipeline(
      "[ITINERARY_SAVE_RESULT]",
      "success=true",
      `stops=${finalStops.length}`,
      `days=${data.days}`,
    );

    const dayStats = groupStopsByTripDays(finalStops, data.days, startDate)
      .map((d, i) => `day${i + 1}=${d.places.length}`)
      .join(" ");
    logAiPipeline("[DAILY_ALLOCATION_STATS]", dayStats);

    const lat = data.location?.lat;
    const lng = data.location?.lng;

    let outfitAdvice: RoamiePayloadV2["outfitAdvice"];
    if (data.placeAuthority !== "selected_only" && lat != null && lng != null) {
      try {
        const forecast = await openWeatherGetForecast(lat, lng, data.days);
        outfitAdvice = await buildOutfitAdviceForTrip({
          destination: data.destination,
          startDate,
          days: data.days,
          forecast,
          itinerary: ai.itinerary,
          fashionStyle: data.fashionStyle || undefined,
          mood: data.mood || undefined,
        });
      } catch (e) {
        console.warn("[Roamie] outfit advice skipped", e);
      }
    }

    let tripSettings: RoamiePayloadV2["tripSettings"];
    try {
      if (data.placeAuthority === "selected_only") {
        throw new Error("selection_optional_transit_deferred");
      }
      const weatherHint = data.weather as {
        condition?: string;
        precipProbability?: number;
        tempC?: number;
        feelsLikeC?: number;
        isDaytime?: boolean;
        uvi?: number;
      } | null;
      const temp = weatherHint?.feelsLikeC ?? weatherHint?.tempC;
      const transit = await buildTransitLegsForItinerary({
        items: ai.itinerary.map((i) => ({
          placeName: i.placeName,
          title: i.title,
          lat: i.lat,
          lng: i.lng,
          date: i.date,
          time: i.time,
        })),
        destination: data.destination,
        preferences: {
          transportation: data.transport,
          pace: data.preferences?.pace as string | undefined,
        },
        weather: weatherHint
          ? {
              ...weatherHint,
              isRainy:
                (weatherHint.precipProbability ?? 0) >= 40 ||
                (weatherHint.condition ?? "").includes("雨"),
              isHot: temp != null && temp >= 32,
              isNight: weatherHint.isDaytime === false,
              uvi: weatherHint.uvi ?? null,
            }
          : undefined,
        time: data.time,
        useAiReasons: true,
      });
      const pace = resolvePlannerPaceFromProfile({
        style: resolvePlannerStyleKey(data.style),
        quizPace: data.preferences?.pace as "slow" | "medium" | "active" | null,
      });
      const localizedGate = applyItineraryLocalizationGate(coalesceItineraryItems(ai.itinerary), {
        softPassEnglish: true,
      });
      ai = { ...ai, itinerary: localizedGate.items };
      const seededLegMinutes = buildLegMinutesFromPlaces(localizedGate.items, pace);
      tripSettings = {
        startTime: data.time
          ? normalizeTime(data.time)
          : (coalesceItineraryItems(ai.itinerary)[0]?.time?.slice(0, 5) ?? "09:30"),
        tripStartDate: data.startDate?.trim() || undefined,
        tripEndDate: data.endDate?.trim() || undefined,
        transport: inferTripTransport(data.transport),
        legMinutes: seededLegMinutes,
        transitLegs: Object.fromEntries(transit.legs.map((l) => [l.legKey, l])),
        transportTips: transit.transportTips,
      };
    } catch (e) {
      if (data.placeAuthority === "selected_only") {
        logAiPipeline(
          "[ITINERARY_OPTIONAL_ENRICHMENT_DEFERRED]",
          "weatherForecast=true",
          "outfitAdvice=true",
          "transitLegs=true",
        );
      } else {
        console.warn("[Roamie] transit legs skipped on generate", e);
      }
    }

    const gated = applyItineraryLocalizationGate(coalesceItineraryItems(ai.itinerary), {
      softPassEnglish: true,
    });
    const itineraryItems = gated.items;
    const paceForLegs = resolvePlannerPaceFromProfile({
      style: resolvePlannerStyleKey(data.style),
      quizPace: data.preferences?.pace as "slow" | "medium" | "active" | null,
    });
    if (!tripSettings) {
      tripSettings = {
        startTime: coalesceItineraryItems(itineraryItems)[0]?.time?.slice(0, 5) ?? "09:30",
        tripStartDate: data.startDate?.trim() || undefined,
        tripEndDate: data.endDate?.trim() || undefined,
        transport: inferTripTransport(data.transport),
        legMinutes: buildLegMinutesFromPlaces(itineraryItems, paceForLegs),
      };
    } else if (!tripSettings.legMinutes || !Object.keys(tripSettings.legMinutes).length) {
      tripSettings = {
        ...tripSettings,
        legMinutes: buildLegMinutesFromPlaces(itineraryItems, paceForLegs),
      };
    }
    const payload: RoamiePayloadV2 = {
      ...ai,
      version: 2,
      destination: data.destination,
      days: data.days,
      generatedAt: new Date().toISOString(),
      outfitAdvice,
      tripSettings,
      itinerary: itineraryItems,
    };

    await recordGenerationOutcome(true);
    return finish({
      success: true,
      trip: {
        id: `trip-${Date.now()}`,
        title: payload.title || `${data.destination} ${data.days} 天`,
        destination: data.destination,
        days: data.days,
        itinerary: groupItineraryItemsByDay(itineraryItems, startDate),
        payload,
      },
    });
  });
